const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {preferences}=require('../electron/preferences.cjs');
test('Windows transient locks retry atomic preference replacement',async()=>{
  const base=path.resolve('test-results'),root=await fs.mkdtemp(path.join(base,'preferences-retry-')),rename=fs.rename;let attempts=0;
  try{const p=preferences({getPath:()=>root},{});await p.ready;
    fs.rename=async(from,to)=>{if(path.dirname(to)===root&&path.basename(to)==='commands.json'&&attempts++<2){const e=new Error('temporary lock');e.code='EPERM';throw e;}return rename(from,to);};
    await p.flush();assert.equal(attempts,3);assert.ok(await fs.readFile(path.join(root,'commands.json'),'utf8'));
  }finally{fs.rename=rename;assert.equal(path.dirname(root),base);for(const f of await fs.readdir(root))await fs.unlink(path.join(root,f));await fs.rmdir(root);}
});
test('Chat history and dark theme survive restart without persisting the full document',async()=>{
  const base=path.resolve('test-results');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'preferences-'));
  try{
    const app={getPath:()=>root},p=preferences(app,{});await p.ready;
    assert.equal(await p.getWorkEnabled(),false);
    await assert.rejects(p.setWorkEnabled(true,'неверная фраза'),/фразу/);
    assert.equal(await p.setWorkEnabled(true,'я понимаю что я бездарь и ничему не научусь'),true);
    p.saveAppearance({editorSize:17,previewSize:22,previewZoom:120,theme:'dark'});
    p.saveChats([{id:'one',created:1234,selection:{type:'preview',text:'\\boxed{x=1}',html:'<span>x=1</span>'},context:'DO NOT STORE WHOLE DOC',turns:[{question:'Что это?',answer:'**Формула** $x=1$',status:'Готово',mode:'work',trace:[{id:'a',kind:'thinking',text:'Проверка',status:'done'},{id:'b',kind:'tool',name:'read_document',result:'[]',status:'done'},{id:'c',kind:'text',text:'Ответ',status:'running'}],diff:{added:2,removed:1,status:'pending',before:'DO NOT STORE WHOLE DOC'}}]}]);
    await p.setModel('qwen/qwen3.8-27b:free');
    await assert.rejects(p.setModel('qwen/qwen3.8-27b'),/модель/);
    await p.flush();const restored=preferences(app,{});await restored.ready;
    assert.equal(await restored.getModel(),'qwen/qwen3.8-27b:free');
    assert.equal(await restored.getWorkEnabled(),true);
    assert.equal(await restored.setWorkEnabled(false,''),false);
    assert.equal((await restored.getAppearance()).theme,'dark');assert.equal((await restored.getChats())[0].turns[0].answer,'**Формула** $x=1$');
    const turn=(await restored.getChats())[0].turns[0];assert.equal(turn.mode,'work');assert.deepEqual(turn.trace.map(b=>b.kind),['thinking','tool','text']);assert.equal(turn.trace.at(-1).status,'interrupted');assert.equal(turn.diff.status,'interrupted');
    assert.ok(!(await fs.readFile(path.join(root,'chats.json'),'utf8')).includes('DO NOT STORE WHOLE DOC'));
  }finally{
    assert.equal(path.dirname(root),base);for(const f of await fs.readdir(root))await fs.unlink(path.join(root,f));await fs.rmdir(root);
  }
});
