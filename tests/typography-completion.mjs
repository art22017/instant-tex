import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});
let app=await launch();
const close=async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();};
try{
  const page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.cm-content').evaluate(e=>getComputedStyle(e).fontWeight),'670');
  assert.ok(await page.evaluate(()=>document.fonts.check('670 14px "JetBrains Mono Variable"','Код |=| pmatrix')));
  assert.ok(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily.includes('JetBrains Mono Variable')));
  await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('dictionary-save');ipcMain.handle('dictionary-save',()=>{});});
  await page.evaluate(()=>{const d=window.instantDebug.dictionary;d.saved.set('\\end{pmatrix}',{name:'\\end{pmatrix}',template:'\\end{pmatrix}',uses:100000});});
  for(const [typed,expected] of [['\\pma','\\begin{pmatrix}'],['\\end{pma','\\end{pmatrix}'],['\\beg','\\begin{']]){
    await page.evaluate(text=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:text},selection:{anchor:text.length}});e.focus();},typed);
    await page.keyboard.press('Control+Space');await page.locator('.cm-tooltip-autocomplete').waitFor();
    await page.waitForFunction(expected=>document.querySelector('.cm-tooltip-autocomplete .cm-completionLabel')?.textContent.startsWith(expected),expected);
    assert.ok((await page.locator('.cm-tooltip-autocomplete .cm-completionLabel').first().innerText()).startsWith(expected));
    for(const selector of ['.cm-completionLabel','.cm-completionDetail'])assert.ok(await page.locator(selector).first().evaluate(e=>getComputedStyle(e).fontFamily.includes('JetBrains Mono Variable')));
    assert.equal(await page.locator('.cm-completionDetail').first().evaluate(e=>getComputedStyle(e).fontStyle),'normal');
    if(typed==='\\pma'){await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/typography-completion.png'});}
    await page.keyboard.press('Tab');assert.ok(await page.evaluate(text=>window.instantDebug.editor.state.doc.toString().startsWith(text),expected));await page.keyboard.press('Escape');
  }
  assert.equal((await page.evaluate(()=>window.instant.aiConfig())).hasKey,true);
  await close();app=await launch();const second=await app.firstWindow();await second.waitForFunction(()=>window.instantDebug?.editor);
  assert.equal((await second.evaluate(()=>window.instant.aiConfig())).hasKey,true);
  console.log(JSON.stringify({status:'PASS',variableWeight:670,uiFont:'JetBrains Mono Variable',beginPriority:true,explicitEnd:true,keySurvivesRestart:true}));
}finally{await close();}
