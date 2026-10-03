const fs=require('node:fs/promises');
const path=require('node:path');
const windowsKey=require('./windows-key.cjs');
function preferences(app,safeStorage){
  const root=app.getPath('userData'),keyPath=path.join(root,'openrouter-key.bin'),dictPath=path.join(root,'commands.json');
  const appearancePath=path.join(root,'appearance.json');
  const chatsPath=path.join(root,'chats.json');
  let chats=[],dictionary=[],appearance={editorSize:14,editorWeight:670,previewSize:19,previewZoom:100,theme:'light'},writeTimer,writeChain=Promise.resolve();
  const ready=Promise.all([
    fs.readFile(dictPath,'utf8').then(s=>{dictionary=validate(JSON.parse(s));}).catch(()=>{}),
    fs.readFile(appearancePath,'utf8').then(s=>{appearance=validateAppearance(JSON.parse(s));}).catch(()=>{}),
    fs.readFile(chatsPath,'utf8').then(s=>{chats=validateChats(JSON.parse(s));}).catch(()=>{})
  ]);
  function validateAppearance(value){
    const bounded=(name,min,max,fallback)=>Number.isFinite(value?.[name])?Math.max(min,Math.min(max,Math.round(value[name]))):fallback;
    return{editorSize:bounded('editorSize',9,40,14),editorWeight:bounded('editorWeight',400,800,670),previewSize:bounded('previewSize',12,40,19),previewZoom:bounded('previewZoom',50,250,100),theme:value?.theme==='dark'?'dark':'light'};
  }
  function validateChats(value){
    if(!Array.isArray(value))throw new Error('Некорректная история');
    const list=value.slice(0,60).filter(c=>c&&typeof c.id==='string'&&Array.isArray(c.turns)).map(c=>({
      id:c.id.slice(0,100),created:Number.isFinite(c.created)?c.created:Date.now(),
      selection:c.selection&&typeof c.selection.text==='string'?{type:c.selection.type==='preview'?'preview':'code',text:c.selection.text.slice(0,200000),html:String(c.selection.html||'').slice(0,24000)}:null,
      turns:c.turns.slice(-50).filter(t=>typeof t?.question==='string'&&typeof t.answer==='string').map(t=>({question:t.question.slice(0,20000),answer:t.answer.slice(0,100000),status:String(t.status||'Готово').slice(0,500)}))
    }));
    while(JSON.stringify(list).length>20_000_000)list.pop();return list;
  }
  function validate(entries){
    if(!Array.isArray(entries))throw new Error('Некорректный словарь');
    return entries.slice(0,5000).filter(e=>e&&typeof e.name==='string'&&/^\\(?:[a-zA-Z]+\*?(?:\{[a-zA-Z]+\*?\}|\[[a-zA-Z]+\]|\[|\\\{)?|[()[\]])$/.test(e.name)&&typeof e.template==='string'&&e.template.length<1000).map(e=>({name:e.name,template:e.template,detail:String(e.detail||'Из документа').slice(0,120),uses:Math.min(1_000_000,Math.max(0,Number(e.uses)||0))}));
  }
  let cachedKey;
  async function key(){
    if(cachedKey)return cachedKey;
    if(process.platform==='win32'){
      // A damaged/missing DPAPI record must not block recovery from the older
      // Electron safeStorage file, which is how previous portable builds saved it.
      try{const saved=await windowsKey.read();if(saved){cachedKey=saved;return saved;}}catch{}
      // Upgrade an existing key in place, without asking the user to paste it again.
      try{const old=safeStorage.decryptString(await fs.readFile(keyPath));cachedKey=old;await windowsKey.save(old).catch(()=>{});return old;}catch{return '';}
    }
    try{const stored=safeStorage.decryptString(await fs.readFile(keyPath));cachedKey=stored;return stored;}catch{return '';}
  }
  async function setKey(value){
    if(typeof value!=='string'||!/^sk-or-[a-zA-Z0-9-]+$/.test(value)||value.length>300)throw new Error('Введи ключ OpenRouter');
    if(process.platform==='win32')await windowsKey.save(value);
    else{if(!safeStorage.isEncryptionAvailable())throw new Error('Система не предоставила шифрование ключа');await fs.mkdir(root,{recursive:true});await fs.writeFile(keyPath,safeStorage.encryptString(value));}
    cachedKey=value;
  }
  function flush(){
    clearTimeout(writeTimer);const snapshots=[[dictPath,JSON.stringify(dictionary)],[appearancePath,JSON.stringify(appearance)],[chatsPath,JSON.stringify(chats)]];
    writeChain=writeChain.catch(()=>{}).then(async()=>{await fs.mkdir(root,{recursive:true});for(const [file,text] of snapshots){await fs.writeFile(file+'.tmp',text,'utf8');await fs.rename(file+'.tmp',file);}});return writeChain;
  }
  const schedule=()=>{clearTimeout(writeTimer);writeTimer=setTimeout(()=>flush().catch(()=>{}),300);};
  return{ready,key,setKey,flush,getChats:async()=>{await ready;return chats;},saveChats(value){chats=validateChats(value);schedule();},getAppearance:async()=>{await ready;return appearance;},saveAppearance(value){appearance=validateAppearance(value);schedule();},getDictionary:async()=>{await ready;return dictionary;},saveDictionary(entries){dictionary=validate(entries);schedule();}};
}
module.exports={preferences};
