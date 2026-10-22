import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:['.'],env});
const page=await app.firstWindow(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.waitForFunction(()=>window.instantDebug?.editor);
  await app.evaluate(({ipcMain})=>{
    const state={supported:true,device:'gpu',deviceName:'Intel Arc GPU',maxTokens:32,inlineMiddle:false,phase:'off',root:'User supplied AI files',epoch:0,pid:null};
    for(const channel of ['status','configure','start','stop','complete','cancel'])ipcMain.removeHandler('autocomplete-'+channel);
    ipcMain.handle('autocomplete-status',()=>({...state}));
    ipcMain.handle('autocomplete-configure',(_event,value)=>{Object.assign(state,value);return{...state};});
    ipcMain.handle('autocomplete-start',()=>{Object.assign(state,{phase:'on',pid:123,loadMs:900,epoch:state.epoch+1});return{...state};});
    ipcMain.handle('autocomplete-stop',()=>{Object.assign(state,{phase:'off',pid:null,epoch:state.epoch+1});return{...state};});
    ipcMain.handle('autocomplete-cancel',()=>{});
    ipcMain.handle('autocomplete-complete',async(_event,value)=>{
      globalThis.lastFIMRequest=value;await new Promise(resolve=>setTimeout(resolve,80));
      return{text:value.suffix?'middle + ':'the sum of the squares of its legs.',elapsedMs:80,tokensPerSecond:40};
    });
  });
  await page.locator('#autocomplete-toggle').click();
  await page.waitForFunction(()=>document.getElementById('autocomplete-state').textContent==='Модель выключена');
  await page.locator('#autocomplete-device').selectOption('cpu');
  await page.locator('#autocomplete-start').waitFor({state:'visible'});
  await page.waitForFunction(()=>!document.getElementById('autocomplete-start').disabled);
  await page.locator('#autocomplete-length').fill('48');await page.locator('#autocomplete-length').press('Tab');
  await page.waitForFunction(()=>!document.getElementById('autocomplete-start').disabled);
  await page.locator('#autocomplete-start').click();
  await page.waitForFunction(()=>document.getElementById('autocomplete-state').textContent.startsWith('Включено'));
  assert.equal(await page.locator('#autocomplete-device').isDisabled(),true);
  await page.locator('#autocomplete-close').click();
  const prefix='The square of the hypotenuse equals ';
  await page.evaluate(text=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:text},selection:{anchor:text.length}});e.focus();},prefix);
  await page.locator('.cm-local-ghost').waitFor();
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),prefix);
  assert.equal((await app.evaluate(()=>globalThis.lastFIMRequest)).prefix,prefix);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.cm-local-ghost').count(),0);
  await page.keyboard.press('Alt+Backslash');await page.locator('.cm-local-ghost').waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),prefix+'the sum of the squares of its legs.');
  await page.keyboard.press('Control+z');
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),prefix);
  await page.keyboard.press('Escape');
  const middleSource='value = left + right;',middlePos=middleSource.indexOf('right;');
  await page.evaluate(({text,pos})=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:text},selection:{anchor:pos}});e.focus();},{text:middleSource,pos:middlePos});
  await page.keyboard.press('Alt+Backslash');await page.waitForTimeout(500);
  assert.equal(await page.locator('.cm-local-ghost').count(),0,'middle hints disabled by default');
  const suffixX=()=>page.evaluate(()=>{
    const walker=document.createTreeWalker(document.querySelector('#editor .cm-content'),NodeFilter.SHOW_TEXT);
    while(walker.nextNode())if(walker.currentNode.textContent.includes('right;')){const node=walker.currentNode,range=document.createRange();range.setStart(node,node.textContent.indexOf('right;'));range.setEnd(node,node.textContent.indexOf('right;')+1);return range.getBoundingClientRect().x;}
  });
  const beforeX=await suffixX();
  await page.locator('#autocomplete-toggle').click();await page.locator('#autocomplete-middle').check();
  await page.waitForFunction(()=>!document.getElementById('autocomplete-length').disabled);
  await page.locator('#autocomplete-close').click();await page.keyboard.press('Alt+Backslash');
  await page.locator('.cm-local-ghost-middle').waitFor();
  await page.waitForFunction(()=>document.querySelector('.cm-local-ghost-middle')?.getAnimations().every(a=>a.playState==='finished'));
  assert.ok((await suffixX())>beforeX+20,'existing suffix moves right to make room for gray text');
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),middleSource);
  await page.screenshot({path:'test-results/autocomplete-middle.png'});
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),'value = left + middle + right;');
  await page.keyboard.press('Control+z');assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),middleSource);
  await page.keyboard.press('Escape');
  await page.locator('#autocomplete-toggle').click();await page.locator('#autocomplete-stop').click();
  await page.waitForFunction(()=>!document.getElementById('autocomplete-device').disabled);
  assert.equal(await page.locator('.cm-local-ghost').count(),0);
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/autocomplete-settings.png'});
  assert.deepEqual(errors,[]);console.log('PASS: device lock, max length, real ghost widget, Tab, Escape, undo, stop');
}catch(error){await page.screenshot({path:'test-results/autocomplete-ui-failure.png'});throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy()));await app.close();}
