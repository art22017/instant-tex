const {watch}=require('node:fs');
const path=require('node:path');
const {createHash,randomUUID}=require('node:crypto');
const {openDocument}=require('./document.cjs');

function revision(doc){const hash=createHash('sha256').update(doc.text);for(const name of Object.keys(doc.assets).sort()){const a=doc.assets[name];hash.update('\0'+name+'\0'+a.mime+'\0'+a.data);}return hash.digest('hex');}
const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
// One native directory subscription survives atomic replace/rename by editors.
// No polling, renderer IPC, hashes or document reads while the file is idle.
class FileWatch{
  constructor(send){this.send=send;this.current=null;}
  stop(){const c=this.current;this.current=null;if(c){clearTimeout(c.timer);c.watcher?.close();}}
  start(file,doc){this.stop();const c={id:randomUUID(),file,revision:revision(doc),textLength:doc.text.length,timer:null,reading:false,again:false,retries:0,emptyRetry:false};this.current=c;
    try{c.watcher=watch(path.dirname(file),{persistent:false},(_type,name)=>{if(!name||String(name).toLowerCase()===path.basename(file).toLowerCase())this.schedule(c);});c.watcher.on('error',()=>this.error(c,'Не удалось следить за файлом. Открой его повторно.'));}
    catch{this.error(c,'Не удалось следить за файлом. Открой его повторно.');}
    this.schedule(c);return{id:c.id,revision:c.revision};
  }
  schedule(c,delay=4){if(this.current!==c)return;if(c.reading||c.suspended){c.again=true;return;}if(c.timer)return;c.timer=setTimeout(()=>{c.timer=null;void this.read(c);},delay);}
  publish(c,doc){if(this.current!==c)return;if(c.suspended){c.again=true;return;}const next=revision(doc);if(next===c.revision){if(c.failed){c.failed=false;this.send({type:'recovered',id:c.id});}return;}c.failed=false;c.revision=next;c.textLength=doc.text.length;this.send({type:'changed',id:c.id,revision:next,...doc});}
  pause(file){const c=this.current;if(!c||!samePath(file,c.file))return()=>{};c.suspended=true;return()=>{if(this.current===c){c.suspended=false;this.schedule(c);}};}
  error(c,message){if(this.current===c&&c.failed!==message){c.failed=message;this.send({type:'error',id:c.id,message});}}
  async read(c){if(this.current!==c)return;c.reading=true;try{const doc=await openDocument(c.file);c.retries=0;if(c.textLength&&!doc.text.length&&!c.emptyRetry){c.emptyRetry=true;c.again=true;}else{c.emptyRetry=false;this.publish(c,doc);}}catch{if(++c.retries<=4)c.again=true;else this.error(c,'Файл временно недоступен или повреждён. Черновик сохранён в памяти.');}finally{c.reading=false;if(c.again){c.again=false;this.schedule(c,c.retries||c.emptyRetry?40:8);}}}
  async guard(file,expected){const c=this.current;if(!c||!samePath(file,c.file))return;const doc=await openDocument(file),actual=revision(doc);if(actual!==expected){this.publish(c,doc);throw new Error('Файл изменился извне. Дождись объединения правок и сохрани ещё раз.');}}
  async saved(file){return this.start(file,await openDocument(file));}
}
module.exports={FileWatch,revision};
