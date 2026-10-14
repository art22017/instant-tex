import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});let page,original;
try{
  page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);original=(await page.evaluate(()=>window.instant.aiConfig())).workEnabled;
  await app.evaluate(({session})=>{let calls=0;session.fromPartition('ai-network').fetch=async(_url,init)=>{
    const body=JSON.parse(init.body),tool=++calls===1,delta=tool?{tool_calls:[{index:0,id:'check',type:'function',function:{name:'check_latex',arguments:'{}'}}]}:{content:'Проверено'};
    const chunk=(delta,finish_reason)=>({id:'test',model:body.model,choices:[{index:0,delta,finish_reason}]});
    return new Response('data: '+JSON.stringify(chunk(delta,null))+'\n\ndata: '+JSON.stringify(chunk({},tool?'tool_calls':'stop'))+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };});
  await page.evaluate(()=>window.instant.setWorkEnabled(true,'я понимаю что я бездарь и ничему не научусь'));
  const result=await page.evaluate(()=>new Promise(async(resolve,reject)=>{
    const id=crypto.randomUUID(),events=[],timer=setTimeout(()=>reject(new Error('Work smoke test timed out')),30000);
    window.instant.onAIEvent(e=>{if(e.id!==id)return;events.push(e);if(['done','error','stopped'].includes(e.type)){clearTimeout(timer);resolve(events);}});
    try{await window.instant.startWork({id,model:'deepseek/deepseek-v4.1-flash',context:'См. \\cite{a}.\n\\begin{enumerate}\\item Первый\\end{enumerate}\n\\begin{tabular}{cc}a&b\\end{tabular}\n\\bibliography{refs}',selection:'',question:'Проверь документ',bibliographies:{'refs.bib':'@book{a,title={Физика},year={2026}}'}});}catch(e){clearTimeout(timer);reject(e);}
  }));assert.equal(result.at(-1).type,'done');const check=result.find(e=>e.type==='tool_end'&&e.name==='check_latex');assert.equal(JSON.parse(check.result).content[0].text,'[]');console.log('PASS: packaged Pi check_latex loads structural renderer and bibliography; no network request');
}finally{if(page&&original!==undefined)await page.evaluate(value=>window.instant.setWorkEnabled(value,value?'я понимаю что я бездарь и ничему не научусь':''),original).catch(()=>{});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();}
