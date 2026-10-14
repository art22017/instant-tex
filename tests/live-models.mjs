import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});
try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);
  assert.equal((await page.evaluate(()=>window.instant.aiConfig())).hasKey,true);
  for(const model of ['openrouter/free','google/gemini-3.5-flash-lite']){
    const result=await page.evaluate(model=>new Promise(async resolve=>{
      const id=crypto.randomUUID();let chars=0;
      window.instant.onAIEvent(e=>{if(e.id!==id)return;if(e.type==='chunk')chars+=e.text.length;if(['done','error','stopped'].includes(e.type))resolve({type:e.type,chars,message:e.message});});
      try{await window.instant.askAI({id,model,context:'',selection:'',question:'Ответь одним словом: привет'});}catch(e){resolve({type:'error',message:e.message});}
    }),model);
    console.log(JSON.stringify({model,...result}));
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));
}finally{await app.close();}
