const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');

const DEVICES={gpu:'Intel Arc GPU',cpu:'Intel CPU',npu:'Intel NPU'};
const STOPS=['<|endoftext|>','<|fim_pad|>','<|file_sep|>','<|fim_prefix|>','<|fim_suffix|>','<|fim_middle|>','<|im_end|>'];
function validateConfig(value){
  if(!value||!Object.hasOwn(DEVICES,value.device))throw new Error('Выбери Intel CPU, Intel Arc GPU или Intel NPU');
  if(!Number.isInteger(value.maxTokens)||value.maxTokens<8||value.maxTokens>128)throw new Error('Длина подсказки: от 8 до 128 токенов');
  if(value.inlineMiddle!==undefined&&typeof value.inlineMiddle!=='boolean')throw new Error('Некорректная настройка подсказок внутри строки');
  return{device:value.device,maxTokens:value.maxTokens,inlineMiddle:value.inlineMiddle??false};
}
function makePrompt(prefix,suffix){return `<|fim_prefix|>${prefix}<|fim_suffix|>${suffix}<|fim_middle|>`;}
function cleanCompletion(text,suffix){
  for(const stop of STOPS)text=text.split(stop)[0];
  text=text.split(/\n[\t ]*\n/)[0];
  for(let n=Math.min(text.length,suffix.length);n>0;n--)if(text.endsWith(suffix.slice(0,n))){text=text.slice(0,-n);break;}
  return text;
}
const alive=proc=>proc&&proc.exitCode===null&&proc.signalCode===null;
async function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port));});});}

class Autocomplete {
  constructor(root,{platform=process.platform,adapter=path.join(__dirname,'autocomplete-npu.py')}={}){
    this.root=root;this.platform=platform;this.adapter=adapter;
    this.config={device:'gpu',maxTokens:32,inlineMiddle:false};this.phase='off';this.error=null;this.proc=null;this.epoch=0;this.pending=null;this.loadMs=null;this.operation=null;
    this.ready=this.readConfig();
  }
  async readConfig(){
    if(this.platform!=='win32')return;
    await fs.mkdir(this.root,{recursive:true});
    try{this.config=validateConfig(JSON.parse(await fs.readFile(path.join(this.root,'settings.json'),'utf8')));}catch{}
  }
  status(){return{supported:this.platform==='win32',...this.config,deviceName:DEVICES[this.config.device],phase:this.phase,error:this.error,loadMs:this.loadMs,root:this.root,pid:this.proc?.pid??null,epoch:this.epoch};}
  async configure(value){
    await this.ready;const next=validateConfig(value);
    if((this.phase!=='off'&&this.phase!=='error'||alive(this.proc))&&next.device!==this.config.device)throw new Error('Сначала останови модель, чтобы выбрать другое устройство');
    const previous=this.config;this.config=next;
    try{await fs.writeFile(path.join(this.root,'settings.json'),JSON.stringify(next,null,2),'utf8');}
    catch(error){this.config=previous;throw error;}
    this.cancel();return this.status();
  }
  cancel(){
    const pending=this.pending;this.pending=null;
    if(!pending)return;
    pending.abort();
    if(this.config.device==='npu')fetch(`${this.url()}/cancel`,{method:'POST',headers:this.headers(),body:JSON.stringify({request_id:pending.requestId}),signal:AbortSignal.timeout(1500)}).catch(()=>{});
  }
  async terminate(){
    const proc=this.proc;
    if(alive(proc)){
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(new Error('Не удалось остановить процесс модели')),5000);
        proc.once('exit',()=>{clearTimeout(timer);resolve();});
        proc.kill();
      });
    }
    this.proc=null;
  }
  async stop(){
    this.epoch++;this.phase='stopping';this.cancel();
    // Also cancels a load that is waiting for health; wait for its cleanup before returning.
    await this.terminate();
    if(this.operation)await this.operation.catch(()=>{});
    this.phase='off';this.error=null;this.loadMs=null;return this.status();
  }
  async start(){
    await this.ready;
    if(this.platform!=='win32')throw new Error('Локальное автодополнение доступно только в Windows');
    if(this.phase!=='off'&&this.phase!=='error'||alive(this.proc)||this.operation)throw new Error('Модель уже включена или запускается');
    const epoch=++this.epoch;this.phase='starting';this.error=null;this.loadMs=null;
    const task=this.launch(epoch);
    this.operation=task;
    try{await task;}finally{if(this.operation===task)this.operation=null;}
    return this.status();
  }
  async launch(epoch){
    const start=performance.now(),npu=this.config.device==='npu';let log;
    try{
      const exe=path.join(this.root,npu?'python/Scripts/python.exe':'llama/llama-server.exe');
      const weights=path.join(this.root,npu?'ov-int4/openvino_model.xml':'qwen-base-q4_k_m.gguf');
      for(const file of [exe,weights])try{await fs.access(file);}catch{throw new Error(`Не найден ${file}. Модель и раннер устанавливаются отдельно; см. LOCAL-AUTOCOMPLETE.md.`);}
      this.port=await freePort();this.token=randomUUID();
      await fs.mkdir(path.join(this.root,'logs'),{recursive:true});
      log=await fs.open(path.join(this.root,'logs',`${this.config.device}.log`),'a');
      if(epoch!==this.epoch)return;
      const args=npu?['-u',this.adapter,this.root,String(this.port)]:['-m',weights,'-ngl',this.config.device==='gpu'?'99':'0','-t','8','-tb','8','-c','4096','-np','1','--host','127.0.0.1','--port',String(this.port),'--no-webui','--api-key',this.token];
      const proc=spawn(exe,args,{windowsHide:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,INSTANT_FIM_TOKEN:this.token,PYTHONIOENCODING:'utf-8'}});
      this.proc=proc;let spawnError;
      proc.on('error',error=>{spawnError=error;});
      proc.on('exit',()=>{
        if(this.proc===proc&&this.phase==='on'){
          this.cancel();this.phase='error';this.error='Процесс модели завершился. Подробности в папке logs.';this.epoch++;
        }
      });
      for(let i=0;i<360;i++){
        if(epoch!==this.epoch)return;
        if(spawnError)throw spawnError;
        if(!alive(proc))throw new Error(`Не удалось запустить модель. Подробности: logs/${this.config.device}.log`);
        try{
          const response=await fetch(`${this.url()}/health`,{headers:this.headers(),signal:AbortSignal.timeout(700)});
          if(response.ok){if(epoch!==this.epoch)return;this.phase='on';this.loadMs=Math.round(performance.now()-start);return;}
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      throw new Error('Модель не запустилась за 3 минуты. Подробности в папке logs.');
    }catch(error){
      if(epoch===this.epoch){await this.terminate();this.phase='error';this.error=error.message;throw error;}
    }finally{await log?.close();}
  }
  url(){return `http://127.0.0.1:${this.port}`;}
  headers(){return{'Content-Type':'application/json',Authorization:`Bearer ${this.token}`};}
  async complete(input){
    if(this.phase!=='on')return{text:''};
    if(!input||typeof input.prefix!=='string'||typeof input.suffix!=='string'||input.prefix.length+input.suffix.length>100000)throw new Error('Некорректный запрос автодополнения');
    this.cancel();const controller=new AbortController();controller.requestId=randomUUID();this.pending=controller;
    const epoch=this.epoch,prefix=input.prefix.slice(-5000),suffix=input.suffix.slice(0,1500),started=performance.now();
    const timer=setTimeout(()=>{if(this.pending===controller)this.cancel();else controller.abort();},60000);
    try{
      const body=JSON.stringify({request_id:controller.requestId,prefix,suffix,prompt:makePrompt(prefix,suffix),n_predict:this.config.maxTokens,temperature:0,repeat_penalty:1,cache_prompt:true,stream:false,stop:STOPS});
      let response;
      while(!controller.signal.aborted){
        response=await fetch(`${this.url()}/completion`,{method:'POST',headers:this.headers(),signal:controller.signal,body});
        if(response.status!==429||this.config.device!=='npu')break;
        await response.arrayBuffer();
        // The NPU may finish prefill before observing cancellation. Keep only the newest
        // editor request waiting, rather than queueing stale generations in Python.
        await new Promise(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,150);controller.signal.addEventListener('abort',done,{once:true});});
      }
      if(controller.signal.aborted)return{text:''};
      const data=await response.json();
      if(!response.ok)throw new Error(data.error?.message||data.error||`HTTP ${response.status}`);
      if(controller.signal.aborted||epoch!==this.epoch)return{text:''};
      return{text:cleanCompletion(data.content||'',suffix),elapsedMs:Math.round(performance.now()-started),tokensPerSecond:data.timings?.predicted_per_second};
    }catch(error){if(controller.signal.aborted)return{text:''};throw error;}
    finally{clearTimeout(timer);if(this.pending===controller)this.pending=null;}
  }
  close(){this.epoch++;this.cancel();if(alive(this.proc))this.proc.kill();}
}
module.exports={Autocomplete,validateConfig,makePrompt,cleanCompletion};
