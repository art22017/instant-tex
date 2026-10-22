const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {FileWatch}=require('../electron/file-watch.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await wait(10);}throw new Error('Watcher timeout');}
test('native events survive atomic replacement, idle is silent, save guard rejects stale disk',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'instant-watch-')),file=path.join(root,'note.tex'),events=[];const watcher=new FileWatch(e=>events.push(e));
  try{await fs.writeFile(file,'first');const initial=watcher.start(file,{text:'first',assets:{}});await wait(80);assert.equal(events.length,0);
    await fs.writeFile(file,'second');await until(()=>events.some(e=>e.text==='second'));const second=events.at(-1);await assert.rejects(watcher.guard(file,initial.revision),/изменился/);await watcher.guard(file,second.revision);
    const replacement=path.join(root,'replacement.tmp');await fs.writeFile(replacement,'third');await fs.rename(replacement,file);await until(()=>events.some(e=>e.text==='third'));
    const n=events.length;await wait(100);assert.equal(events.length,n);watcher.stop();await fs.writeFile(file,'detached');await wait(50);assert.equal(events.length,n);
  }finally{watcher.stop();for(const name of await fs.readdir(root))await fs.unlink(path.join(root,name));await fs.rmdir(root);}
});
test('invalid partial itex and temporary removal retain document and recover on next write',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'instant-watch-')),file=path.join(root,'note.itex'),events=[],watcher=new FileWatch(e=>events.push(e)),doc={format:'instant-tex',version:1,text:'first',assets:{}};
  try{await fs.writeFile(file,JSON.stringify(doc));watcher.start(file,doc);await wait(50);await fs.writeFile(file,'{');await until(()=>events.some(e=>e.type==='error'));assert.ok(!events.some(e=>e.type==='changed'));
    await fs.unlink(file);await wait(40);await fs.writeFile(file,JSON.stringify({...doc,text:'recovered'}));await until(()=>events.some(e=>e.text==='recovered'));
  }finally{watcher.stop();for(const name of await fs.readdir(root))await fs.unlink(path.join(root,name));await fs.rmdir(root);}
});
