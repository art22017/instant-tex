const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {preferences}=require('../electron/preferences.cjs');
test('Chat history and dark theme survive restart without persisting the full document',async()=>{
  const base=path.resolve('test-results');await fs.mkdir(base,{recursive:true});const root=await fs.mkdtemp(path.join(base,'preferences-'));
  try{
    const app={getPath:()=>root},p=preferences(app,{});await p.ready;
    p.saveAppearance({editorSize:17,previewSize:22,previewZoom:120,theme:'dark'});
    p.saveChats([{id:'one',created:1234,selection:{type:'preview',text:'\\boxed{x=1}',html:'<span>x=1</span>'},context:'DO NOT STORE WHOLE DOC',turns:[{question:'Что это?',answer:'**Формула** $x=1$',status:'Готово'}]}]);
    await p.flush();const restored=preferences(app,{});await restored.ready;
    assert.equal((await restored.getAppearance()).theme,'dark');assert.equal((await restored.getChats())[0].turns[0].answer,'**Формула** $x=1$');
    assert.ok(!(await fs.readFile(path.join(root,'chats.json'),'utf8')).includes('DO NOT STORE WHOLE DOC'));
  }finally{
    assert.equal(path.dirname(root),base);for(const f of await fs.readdir(root))await fs.unlink(path.join(root,f));await fs.rmdir(root);
  }
});
