import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import catalog from '../electron/models.cjs';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});
try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);
  await app.evaluate(({ipcMain},models)=>{
    globalThis.picked='deepseek/deepseek-v4.1-flash';globalThis.pickerRequests=[];
    for(const channel of ['ai-config','ai-model','ai-start','work-start','chats-save'])ipcMain.removeHandler(channel);
    ipcMain.handle('ai-config',()=>({hasKey:true,workEnabled:true,models,model:globalThis.picked}));
    ipcMain.handle('ai-model',(_e,id)=>{globalThis.picked=id;return id;});ipcMain.handle('chats-save',()=>true);
    for(const mode of ['ai-start','work-start'])ipcMain.handle(mode,(event,payload)=>{
      globalThis.pickerRequests.push({mode,model:payload.model});
      setTimeout(()=>{event.sender.send('ai-event',{id:payload.id,type:'chunk',text:'Ответ'});event.sender.send('ai-event',{id:payload.id,type:'done'});},250);return true;
    });
  },catalog.MODELS);
  await page.locator('#ai-toggle').click();await page.waitForFunction(()=>document.querySelectorAll('#ai-model-menu [role=option]').length===11);
  for(const id of ['google/gemma-4-31b-it','openrouter/free','qwen/qwen3.8-27b:free']){
    await page.locator('#ai-model').click();await page.locator('#ai-model-menu [data-model="'+id+'"]').click();await page.waitForFunction(()=>!document.getElementById('ai-model').disabled);
    await page.locator('#ai-question').fill('Тест модели');await page.locator('#ai-question').press('Enter');
    assert.equal(await page.locator('#ai-model').isDisabled(),true);await page.waitForFunction(()=>!document.getElementById('ai-send').disabled);
  }
  await page.locator('#ai-work-mode').click();await page.locator('#ai-model').click();await page.locator('#ai-model-menu [data-model="nvidia/nemotron-3.5-lightning:free"]').click();
  await page.waitForFunction(()=>!document.getElementById('ai-model').disabled);
  await page.locator('#ai-question').fill('Работа');await page.locator('#ai-question').press('Enter');await page.waitForFunction(()=>!document.getElementById('ai-send').disabled);
  assert.deepEqual(await app.evaluate(()=>globalThis.pickerRequests),[
    {mode:'ai-start',model:'google/gemma-4-31b-it'},{mode:'ai-start',model:'openrouter/free'},
    {mode:'ai-start',model:'qwen/qwen3.8-27b:free'},{mode:'work-start',model:'nvidia/nemotron-3.5-lightning:free'}
  ]);
  await page.locator('#ai-close').click();await page.locator('#ai-toggle').click();
  assert.equal(await page.locator('#ai-model').getAttribute('title'),'nvidia/nemotron-3.5-lightning:free');
  await page.locator('#ai-model').click();await page.locator('#ai-model-menu').waitFor({state:'visible'});
  await page.screenshot({path:'test-results/model-picker.png'});await page.keyboard.press('Escape');assert.equal(await page.locator('#ai-model-menu').isVisible(),false);assert.equal(await page.locator('#ai-panel').isVisible(),true);await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.locator('#ai-model').click();assert.equal(await page.locator('#ai-model-menu').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(36, 46, 40)');await page.screenshot({path:'test-results/model-picker-dark.png'});await page.keyboard.press('Escape');console.log('PASS: 11 options, Ask/Work routing, busy state and retained choice');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));
}finally{await app.close();}
