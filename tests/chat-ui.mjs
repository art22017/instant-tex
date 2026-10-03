import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});
let page,originalAppearance;const errors=[];
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.instantDebug?.editor);
  originalAppearance=await page.evaluate(()=>window.instant.loadAppearance());
  const answer='# Ответ\n\n**Важно:** $x^2$ и \\(y=2\\).\n\n\\[\\boxed{x=\\frac{1}{2}}\\]\n\n```latex\n\\implies\n```\n\n| Команда | Значение |\n|---|---|\n| `\\implies` | ⇒ |\n\n<script>bad()</script>\n\n![image](https://example.com/remote.png)';
  await app.evaluate(({ipcMain},answer)=>{
    globalThis.chatPayloads=[];
    ipcMain.removeHandler('chats-save');ipcMain.handle('chats-save',(_e,value)=>{globalThis.testChats=value;});
    ipcMain.removeHandler('ai-start');ipcMain.handle('ai-start',(event,payload)=>{
      globalThis.chatPayloads.push(payload);
      const half=Math.floor(answer.length/2);
      setTimeout(()=>event.sender.send('ai-event',{id:payload.id,type:'chunk',text:answer.slice(0,half)}),10);
      setTimeout(()=>event.sender.send('ai-event',{id:payload.id,type:'chunk',text:answer.slice(half)}),50);
      setTimeout(()=>event.sender.send('ai-event',{id:payload.id,type:'done'}),100);return true;
    });
  },answer);
  assert.equal(await page.locator('#new svg.lucide-new').count(),1);
  await page.locator('#ai-toggle').click();await page.locator('#ai-panel').waitFor({state:'visible'});
  const height=await page.locator('#ai-panel').evaluate(e=>e.getBoundingClientRect().height);assert.ok(height<=await page.evaluate(()=>innerHeight*.45));
  await page.locator('#ai-question').fill('Вопрос');await page.locator('#ai-question').press('Shift+Enter');await page.keyboard.insertText('строка');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>document.getElementById('ai-status').textContent==='Готово');
  assert.equal(await page.locator('#ai-answer h1').innerText(),'Ответ');assert.equal(await page.locator('#ai-answer table').count(),1);
  assert.equal(await page.locator('#ai-answer pre code').innerText(),'\\implies\n');assert.ok(await page.locator('#ai-answer .katex').count()>=3);
  assert.equal(await page.locator('#ai-answer script,#ai-answer img').count(),0);
  assert.equal((await app.evaluate(()=>globalThis.chatPayloads)).at(-1).question,'Вопрос\nстрока');
  await page.locator('#ai-question').fill('Продолжи');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('ai-status').textContent==='Готово');
  assert.equal((await app.evaluate(()=>globalThis.chatPayloads)).at(-1).history.length,1);
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/chat-global.png'});
  await page.keyboard.press('Escape');assert.equal(await page.locator('#ai-panel').isVisible(),false);
  await page.evaluate(()=>{const e=window.instantDebug.editor,text=Array.from({length:100},(_,i)=>'Строка '+i+' с длинным решением').join('\n');e.dispatch({changes:{from:0,to:e.state.doc.length,insert:text},selection:{anchor:0,head:text.length},scrollIntoView:true});e.focus();});
  await page.locator('#selection-ai').waitFor({state:'visible'});await page.locator('#selection-ai').click();
  await page.locator('#ai-panel.selection-chat').waitFor();assert.equal(await page.locator('#ai-answer .ai-turn').count(),0);
  assert.ok((await page.locator('#ai-selection .selection-excerpt').innerText()).length<=421);
  assert.ok(await page.locator('#ai-selection .selection-excerpt').evaluate(e=>getComputedStyle(e).fontFamily.includes('JetBrains Mono')));
  const box=await page.locator('#ai-panel').boundingBox(),viewport=await page.evaluate(()=>({w:innerWidth,h:innerHeight}));assert.ok(box.x>=0&&box.y>=36&&box.x+box.width<=viewport.w&&box.y+box.height<=viewport.h);
  await page.locator('#ai-question').fill('Новый выбор');await page.keyboard.press('Enter');await page.waitForFunction(()=>document.getElementById('ai-status').textContent==='Готово');
  const selectionPayload=(await app.evaluate(()=>globalThis.chatPayloads)).at(-1);assert.equal(selectionPayload.history.length,0);assert.ok(selectionPayload.selection.length>2000);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:'Решение\n\\[\\boxed{x=1}\\]'},selection:{anchor:0}});});
  await page.waitForFunction(()=>document.querySelector('#rendered .katex'));
  await page.evaluate(()=>{const math=document.querySelector('#rendered .katex'),r=document.createRange();r.selectNode(math);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
  await page.locator('#selection-ai').click();await page.locator('#ai-selection.selection-preview').waitFor();
  assert.equal(await page.locator('#ai-selection .katex').count(),1);
  assert.equal(await page.locator('#ai-selection .selection-excerpt').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(255, 255, 255)');
  await page.screenshot({path:'test-results/chat-selection.png'});
  await page.keyboard.press('Escape');await page.locator('#theme-toggle').click();
  const theme=await page.locator('html').getAttribute('data-theme');assert.equal(theme,originalAppearance.theme==='dark'?'light':'dark');
  await page.screenshot({path:'test-results/chat-theme.png'});
  await page.locator('#ai-toggle').click();await page.locator('#ai-history-toggle').click();assert.ok(await page.locator('.chat-history-row').count()>=2);
  await page.locator('.chat-history-open').first().click();assert.equal(await page.locator('#ai-answer .ai-turn').count(),1);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'PASS',lucide:true,markdownMath:true,selectionPopup:true,shortExcerpt:true,history:true,theme:true,enterEscape:true}));
}catch(error){await page?.screenshot({path:'test-results/chat-failure.png'});console.log('CHAT FAILURE',error.message,errors);throw error;}
finally{
  if(originalAppearance){await page.evaluate(value=>window.instant.saveAppearance(value),originalAppearance);await new Promise(r=>setTimeout(r,450));}
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();
}
