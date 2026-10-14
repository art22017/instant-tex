import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});let page,enabled;
try{
  page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);
  const config=await page.evaluate(()=>window.instant.aiConfig());enabled=config.workEnabled;assert.equal(config.hasKey,true);
  await page.evaluate(()=>window.instant.setWorkEnabled(true,'я понимаю что я бездарь и ничему не научусь'));
  const result=await page.evaluate(()=>new Promise((resolve,reject)=>{
    const id=crypto.randomUUID(),tools=[];let chars=0,proposals=0;
    const timer=setTimeout(()=>{window.instant.cancelAI(id);reject(Error('Timeout'));},120000);
    window.instant.onAIEvent(e=>{
      if(e.id!==id)return;
      if(e.type==='tool_start')tools.push(e.name);
      if(e.type==='trace_delta'&&e.kind==='text')chars+=e.text.length;
      if(e.type==='edit_proposal'){proposals++;void window.instant.decideWork({id,proposalId:e.proposalId,accepted:true,currentDocument:e.after});}
      if(['done','error','stopped'].includes(e.type)){clearTimeout(timer);resolve({tools,chars,proposals,status:e.type,message:e.message});}
    });
    window.instant.startWork({id,context:'Решение\n\\[x=1\\]',selection:'',question:'Используй read_document, затем edit_document, чтобы заменить x=1 на x=2. Сразу после редактирования проверь check_latex и кратко ответь.'}).catch(e=>{clearTimeout(timer);reject(e);});
  }));
  console.log(JSON.stringify(result));assert.equal(result.status,'done');assert.ok(result.tools.includes('edit_document'));assert.ok(result.proposals>=1);assert.ok(result.chars>0);
}finally{
  if(enabled!==undefined)await page.evaluate(value=>window.instant.setWorkEnabled(value,value?'я понимаю что я бездарь и ничему не научусь':''),enabled);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();
}
