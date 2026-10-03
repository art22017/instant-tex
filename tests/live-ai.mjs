import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const key=env.OPENROUTER_KEY;delete env.OPENROUTER_KEY;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});
try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.result);
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('chats-save');ipcMain.handle('chats-save',()=>{});});
  if(key)await page.evaluate(k=>window.instant.setAIKey(k),key);
  const config=await page.evaluate(()=>window.instant.aiConfig());assert.equal(config.hasKey,true);
  await page.locator('#ai-toggle').click();await page.locator('#ai-question').fill('Ответь одним словом: готово');
  await page.locator('#ai-question').press('Control+Enter');
  await page.waitForFunction(()=>document.getElementById('ai-stop').hidden&&!document.getElementById('ai-send').disabled&&document.getElementById('ai-status').textContent!=='DeepSeek отвечает…',{timeout:120000});
  const status=await page.locator('#ai-status').innerText(),answer=await page.locator('#ai-answer .ai-response').last().innerText();
  console.log(JSON.stringify({model:config.model,status,answerCharacters:answer.length,streamWorks:status==='Готово'&&answer.length>0}));
  assert.equal(status,'Готово');assert.ok(answer.length>0);
}finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();}
