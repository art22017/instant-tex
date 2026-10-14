const {app,BrowserWindow,ipcMain,dialog,clipboard,Menu,session,safeStorage}=require('electron');
const {streamAnswer,requestBody}=require('./ai.cjs');
const {MODELS}=require('./models.cjs');
const {preferences}=require('./preferences.cjs');
const fs=require('node:fs/promises');
const {validateDocument,readResource,openDocument,saveDocument}=require('./document.cjs');
const path=require('node:path');
let main,dirty=false,allowClose=false,lastPath=null,closePending=false;
let settings;
const {FileWatch}=require('./file-watch.cjs');
const fileWatch=new FileWatch(data=>{if(main&&!main.webContents.isDestroyed())main.webContents.send('file-event',data);});
const aiJobs=new Map();
const workJobs=new Map();
function cancelWork(job){job.controller.abort();if(job.done)job.finish(false);}
const {randomUUID}=require('node:crypto');
app.setPath('userData',path.join(app.getPath('appData'),'InstantTeX'));
const exportJobs=new Map();
const preload=path.join(__dirname,'preload.cjs');
function checkSender(event){if(event.sender!==main?.webContents)throw new Error('Unknown sender');}
function safeWindow(options={}){
  const win=new BrowserWindow({...options,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,...options.webPreferences}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',e=>e.preventDefault());
  return win;
}
async function createWindow(){
  Menu.setApplicationMenu(null);
  main=safeWindow({width:1420,height:1000,minWidth:900,minHeight:600,backgroundColor:'#eef1ed',title:'Instant TeX',icon:path.join(__dirname,'../assets/icon.png'),show:false});
  main.webContents.setZoomFactor(1);
  await main.loadFile(path.join(__dirname,'../dist/index.html'));
  main.show();
  main.on('close',async e=>{
    if(!dirty||allowClose)return;
    e.preventDefault();if(closePending)return;closePending=true;
    try{
      const {response}=await dialog.showMessageBox(main,{type:'question',title:'Несохранённый черновик',message:'Черновик хранится только в памяти.',detail:'Сохрани текст, чтобы продолжить позже.',buttons:['Продолжить писать','Сохранить','Закрыть без сохранения'],defaultId:0,cancelId:0,noLink:true});
      if(response===1)main.webContents.send('save-request');
      if(response===2){allowClose=true;main.close();}
    }finally{closePending=false;}
  });
}
ipcMain.on('dirty',(event,value)=>{checkSender(event);dirty=!!value;});
ipcMain.handle('confirm-replace',async event=>{
  checkSender(event);
  const {response}=await dialog.showMessageBox(main,{type:'question',title:'Заменить черновик?',message:'Текущий текст не сохранён.',buttons:['Оставить текст','Заменить'],defaultId:0,cancelId:0,noLink:true});
  return response===1;
});
ipcMain.handle('save-text',async(event,value)=>{
  checkSender(event);const doc=validateDocument(value),hasAssets=Object.keys(doc.assets).length>0;
  const {canceled,filePath}=await dialog.showSaveDialog(main,{title:'Сохранить черновик',defaultPath:lastPath||('Черновик.'+(hasAssets?'itex':'tex')),filters:hasAssets?[{name:'Instant TeX · текст и вложения',extensions:['itex']},{name:'LaTeX · вложения рядом с .tex',extensions:['tex']}]:[{name:'LaTeX / текст UTF-8',extensions:['tex','txt']},{name:'Instant TeX',extensions:['itex']}]});
  if(canceled||!filePath)return null;await fileWatch.guard(filePath,value?.fileRevision);const resume=fileWatch.pause(filePath);try{await saveDocument(filePath,doc,()=>fileWatch.guard(filePath,value?.fileRevision));lastPath=filePath;return{name:path.basename(filePath),watch:await fileWatch.saved(filePath)};}finally{resume();}
});
ipcMain.handle('open-text',async event=>{
  checkSender(event);const {canceled,filePaths}=await dialog.showOpenDialog(main,{title:'Открыть документ',properties:['openFile'],filters:[{name:'Instant TeX / LaTeX / текст',extensions:['itex','tex','txt','md']}]});
  if(canceled)return null;const doc=await openDocument(filePaths[0]);lastPath=filePaths[0];return{...doc,name:path.basename(lastPath),watch:fileWatch.start(lastPath,doc)};
});
ipcMain.handle('file-detach',event=>{checkSender(event);fileWatch.stop();lastPath=null;});
ipcMain.handle('import-resources',async event=>{
  checkSender(event);const {canceled,filePaths}=await dialog.showOpenDialog(main,{title:'Изображения или библиография',properties:['openFile','multiSelections'],filters:[{name:'Изображения / BibTeX',extensions:['png','jpg','jpeg','webp','gif','bib']}]});
  if(canceled)return[];if(filePaths.length>200)throw new Error('Не больше 200 вложений');const resources=[];let size=0;
  for(const file of filePaths){const r=await readResource(file);size+=r.data.length;if(size>85*1024*1024)throw new Error('Общий лимит вложений — 64 МБ');resources.push(r);}return resources;
});

ipcMain.handle('dictionary-load',async event=>{checkSender(event);return settings.getDictionary();});
ipcMain.handle('dictionary-save',(event,entries)=>{checkSender(event);settings.saveDictionary(entries);});
ipcMain.handle('appearance-load',async event=>{checkSender(event);return settings.getAppearance();});
ipcMain.handle('appearance-save',(event,value)=>{checkSender(event);settings.saveAppearance(value);});
ipcMain.handle('chats-load',async event=>{checkSender(event);return settings.getChats();});
ipcMain.handle('chats-save',(event,value)=>{checkSender(event);settings.saveChats(value);});
ipcMain.handle('ai-config',async event=>{checkSender(event);return{models:MODELS,model:await settings.getModel(),hasKey:!!await settings.key(),workEnabled:await settings.getWorkEnabled()};});
ipcMain.handle('work-enable',async(event,value,phrase)=>{checkSender(event);if(typeof value!=='boolean')throw new Error('Некорректная настройка');const enabled=await settings.setWorkEnabled(value,phrase);if(!enabled)for(const job of workJobs.values())cancelWork(job);return enabled;});
ipcMain.handle('ai-model',async(event,value)=>{checkSender(event);return settings.setModel(value);});
ipcMain.handle('ai-key',async(event,key)=>{checkSender(event);await settings.setKey(key);return true;});
ipcMain.handle('ai-start',async(event,payload)=>{
  checkSender(event);
  if(!payload||typeof payload.id!=='string'||payload.id.length>100)throw new Error('Некорректный запрос');
  payload={...payload,model:payload.model??await settings.getModel()};requestBody(payload);
  const key=await settings.key();if(!key)throw new Error('Добавь ключ OpenRouter в настройках AI');
  for(const job of aiJobs.values())job.abort();
  for(const job of workJobs.values())cancelWork(job);
  const controller=new AbortController();aiJobs.set(payload.id,controller);
  const timer=setTimeout(()=>controller.abort('timeout'),120000);
  const emit=data=>{if(!event.sender.isDestroyed())event.sender.send('ai-event',{id:payload.id,...data});};
  // Dedicated Chromium session honors Windows proxy settings; editor networking stays blocked.
  const aiFetch=(...args)=>session.fromPartition('ai-network').fetch(...args);
  void streamAnswer(payload,key,controller.signal,text=>emit({type:'chunk',text}),aiFetch).then(()=>emit({type:'done'})).catch(error=>emit({type:controller.signal.aborted?'stopped':'error',message:controller.signal.reason==='timeout'?'Время ожидания истекло':String(error.message).replaceAll(key,'[key]').slice(0,500)})).finally(()=>{clearTimeout(timer);aiJobs.delete(payload.id);});
  return true;
});
ipcMain.handle('ai-cancel',(event,id)=>{checkSender(event);aiJobs.get(id)?.abort();const job=workJobs.get(id);if(job)cancelWork(job);});
ipcMain.handle('work-decision',async(event,payload)=>{
  checkSender(event);const job=workJobs.get(payload?.id);
  if(!job?.done||job.proposalId!==payload.proposalId)throw new Error('Сначала дождись завершения агента');
  if(typeof payload.currentDocument!=='string'||payload.currentDocument.length>2_000_000)throw new Error('Некорректный документ');
  const accepted=payload.accepted===true&&await settings.getWorkEnabled()&&payload.currentDocument===job.after;
  job.finish(accepted);return true;
});
ipcMain.handle('work-start',async(event,payload)=>{
  checkSender(event);if(!payload||typeof payload.id!=='string'||payload.id.length>100)throw new Error('Некорректный запрос');payload={...payload,model:payload.model??await settings.getModel()};requestBody(payload);
  if(!await settings.getWorkEnabled())throw new Error('Work отключён в настройках');
  const key=await settings.key();if(!key)throw new Error('Добавь ключ OpenRouter');
  for(const job of aiJobs.values())job.abort();for(const job of workJobs.values())cancelWork(job);
  const controller=new AbortController(),job={controller,before:payload.context,after:payload.context,proposalId:randomUUID(),done:false};workJobs.set(payload.id,job);
  const emit=data=>{if(!event.sender.isDestroyed())event.sender.send('ai-event',{id:payload.id,...data});};
  job.finish=accepted=>{if(!workJobs.has(payload.id))return;emit({type:'edit_decision',proposalId:job.proposalId,accepted});workJobs.delete(payload.id);};
  const stage=proposal=>{if(controller.signal.aborted)throw new Error('Остановлено');job.after=proposal.after;emit({type:'draft_update',proposalId:job.proposalId,before:job.before,after:job.after});};
  void import('./work.mjs').then(async({runWork,changeCounts})=>{
    await runWork(payload,key,controller.signal,emit,(...args)=>session.fromPartition('ai-network').fetch(...args),stage);
    if(controller.signal.aborted)throw new Error('Остановлено');job.done=true;
    if(job.after!==job.before)emit({type:'edit_proposal',proposalId:job.proposalId,before:job.before,after:job.after,...changeCounts(job.before,job.after)});
    else job.finish(false);
    emit({type:'done'});
  }).catch(error=>{job.finish(false);emit({type:controller.signal.aborted?'stopped':'error',message:String(error.message).replaceAll(key,'[key]').slice(0,500)});});
  return true;
});
async function writeClipboard(write,verify){
  for(let attempt=0;attempt<5;attempt++){
    try{write();if(verify())return true;}catch{}
    await new Promise(r=>setTimeout(r,150));
  }
  throw new Error('Буфер обмена Windows недоступен. Попробуй скопировать ещё раз.');
}
ipcMain.handle('copy-text',async(event,text)=>{
  checkSender(event);if(typeof text!=='string'||text.length>=2_000_000)throw new Error('Некорректный текст');
  return writeClipboard(()=>clipboard.writeText(text),()=>clipboard.readText().replaceAll('\r\n','\n')===text.replaceAll('\r\n','\n'));
});

// Export a snapshot in a separate window; the editor and draft never touch disk.
async function exportBuffer(payload){
  const win=safeWindow({show:false,width:960,height:1000,useContentSize:true,webPreferences:{preload:path.join(__dirname,'export-preload.cjs'),offscreen:true,partition:'instant-export'}});
  exportJobs.set(win.webContents.id,payload.html);
  try{
    win.webContents.setZoomFactor(1);
    await win.loadFile(path.join(__dirname,'../dist/export.html'));
    win.webContents.setZoomFactor(1);
    const size=await win.webContents.executeJavaScript('window.exportReady');
    if(payload.format==='pdf')return await win.webContents.printToPDF({printBackground:true,pageSize:'A4',margins:{top:0.4,bottom:0.4,left:0.4,right:0.4},preferCSSPageSize:true});
    if(size.height>6000)throw new Error('Картинка слишком длинная. Экспортируй PDF или сократи черновик.');
    const deviceScale=await win.webContents.executeJavaScript('window.devicePixelRatio');
    const scale=2/deviceScale,width=Math.ceil(960*scale),height=Math.ceil(size.height*scale);
    win.webContents.setZoomFactor(scale);
    win.setContentSize(width,height);
    await win.webContents.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    let image;
    for(let attempt=0;attempt<3;attempt++){
      try{image=await win.webContents.capturePage({x:0,y:0,width,height},{stayHidden:true,stayAwake:true});break;}
      catch(error){if(attempt===2)throw error;await new Promise(r=>setTimeout(r,100));}
    }
    const normalized=image.resize({width:1920,height:size.height*2,quality:'best'});
    if(payload.format==='clipboard')return await writeClipboard(()=>clipboard.writeImage(normalized),()=>{const copied=clipboard.readImage();return !copied.isEmpty()&&copied.getSize().width===1920;});
    return normalized.toPNG();
  }finally{exportJobs.delete(win.webContents.id);win.destroy();}
}
ipcMain.handle('export-payload',event=>{
  if(!exportJobs.has(event.sender.id))throw new Error('Unknown export window');
  return exportJobs.get(event.sender.id);
});
ipcMain.handle('export-draft',async(event,payload)=>{
  checkSender(event);
  if(!payload||!['pdf','png','clipboard'].includes(payload.format)||typeof payload.html!=='string'||payload.html.length>100_000_000)throw new Error('Некорректный экспорт');
  let filePath;
  if(payload.format!=='clipboard'){
    const chosen=await dialog.showSaveDialog(main,{title:'Экспорт превью',defaultPath:`Черновик.${payload.format}`,filters:[{name:payload.format.toUpperCase(),extensions:[payload.format]}]});
    if(chosen.canceled)return null;filePath=chosen.filePath;
  }
  const buffer=await exportBuffer(payload);
  if(payload.format==='clipboard')return true;
  await fs.writeFile(filePath,buffer);return path.basename(filePath);
});
app.whenReady().then(async()=>{
  settings=preferences(app,safeStorage);await settings.ready;
  // All runtime resources are bundled locally; block network traffic, including pasted URLs.
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:/^https?:|^wss?:/i.test(details.url)}));
  await createWindow();
});
app.on('window-all-closed',()=>{fileWatch.stop();for(const job of aiJobs.values())job.abort();for(const job of workJobs.values())cancelWork(job);settings?.flush().finally(()=>app.quit());});
