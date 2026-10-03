const {app,BrowserWindow,ipcMain,dialog,clipboard,Menu,session,safeStorage}=require('electron');
const {MODEL,streamAnswer}=require('./ai.cjs');
const {preferences}=require('./preferences.cjs');
const fs=require('node:fs/promises');
const path=require('node:path');
let main,dirty=false,allowClose=false,lastPath=null,closePending=false;
let settings;
const aiJobs=new Map();
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
ipcMain.handle('save-text',async(event,text)=>{
  checkSender(event);if(typeof text!=='string'||text.length>10_000_000)throw new Error('Слишком большой текст');
  const {canceled,filePath}=await dialog.showSaveDialog(main,{title:'Сохранить черновик',defaultPath:lastPath||'Черновик.tex',filters:[{name:'LaTeX / текст UTF-8',extensions:['tex','txt']}]});
  if(canceled||!filePath)return null;
  await fs.writeFile(filePath,text,'utf8');lastPath=filePath;return path.basename(filePath);
});
ipcMain.handle('open-text',async event=>{
  checkSender(event);
  const {canceled,filePaths}=await dialog.showOpenDialog(main,{title:'Открыть текст',properties:['openFile'],filters:[{name:'LaTeX / текст',extensions:['tex','txt','md']}]});
  if(canceled)return null;
  if((await fs.stat(filePaths[0])).size>2_000_000)throw new Error('Для живого черновика лимит — 2 МБ');
  const text=(await fs.readFile(filePaths[0],'utf8')).replace(/^\uFEFF/,'');lastPath=filePaths[0];return{text,name:path.basename(lastPath)};
});

ipcMain.handle('dictionary-load',async event=>{checkSender(event);return settings.getDictionary();});
ipcMain.handle('dictionary-save',(event,entries)=>{checkSender(event);settings.saveDictionary(entries);});
ipcMain.handle('appearance-load',async event=>{checkSender(event);return settings.getAppearance();});
ipcMain.handle('appearance-save',(event,value)=>{checkSender(event);settings.saveAppearance(value);});
ipcMain.handle('chats-load',async event=>{checkSender(event);return settings.getChats();});
ipcMain.handle('chats-save',(event,value)=>{checkSender(event);settings.saveChats(value);});
ipcMain.handle('ai-config',async event=>{checkSender(event);return{model:MODEL,hasKey:!!await settings.key()};});
ipcMain.handle('ai-key',async(event,key)=>{checkSender(event);await settings.setKey(key);return true;});
ipcMain.handle('ai-start',async(event,payload)=>{
  checkSender(event);
  if(!payload||typeof payload.id!=='string'||payload.id.length>100)throw new Error('Некорректный запрос');
  const key=await settings.key();if(!key)throw new Error('Добавь ключ OpenRouter в настройках AI');
  for(const job of aiJobs.values())job.abort();
  const controller=new AbortController();aiJobs.set(payload.id,controller);
  const timer=setTimeout(()=>controller.abort('timeout'),120000);
  const emit=data=>{if(!event.sender.isDestroyed())event.sender.send('ai-event',{id:payload.id,...data});};
  // Dedicated Chromium session honors Windows proxy settings; editor networking stays blocked.
  const aiFetch=(...args)=>session.fromPartition('ai-network').fetch(...args);
  void streamAnswer(payload,key,controller.signal,text=>emit({type:'chunk',text}),aiFetch).then(()=>emit({type:'done'})).catch(error=>emit({type:controller.signal.aborted?'stopped':'error',message:controller.signal.reason==='timeout'?'Время ожидания истекло':String(error.message).replaceAll(key,'[key]').slice(0,500)})).finally(()=>{clearTimeout(timer);aiJobs.delete(payload.id);});
  return true;
});
ipcMain.handle('ai-cancel',(event,id)=>{checkSender(event);aiJobs.get(id)?.abort();});
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
  if(!payload||!['pdf','png','clipboard'].includes(payload.format)||typeof payload.html!=='string'||payload.html.length>20_000_000)throw new Error('Некорректный экспорт');
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
app.on('window-all-closed',()=>{for(const job of aiJobs.values())job.abort();settings?.flush().finally(()=>app.quit());});
