import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});
let app=await launch(),original,page;
const close=async()=>{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();};
try{
  page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);
  original=await page.evaluate(()=>window.instant.loadAppearance());
  await page.locator('#appearance-toggle').click();await page.locator('#appearance-reset').click();
  await page.evaluate(()=>document.fonts.ready);
  const style=await page.locator('.cm-scroller').evaluate(e=>{const s=getComputedStyle(e);return{font:s.fontFamily,ligatures:s.fontVariantLigatures,features:s.fontFeatureSettings};});
  assert.ok(style.font.includes('JetBrains Mono'));assert.equal(style.ligatures,'none');assert.ok(style.features.includes('"calt" 0'));
  assert.ok(await page.evaluate(()=>document.fonts.check('14px "JetBrains Mono"','|=| русский')));
  await page.locator('#editor-size').fill('18');await page.locator('#editor-size').press('Tab');
  await page.locator('#preview-size').fill('23');await page.locator('#preview-size').press('Tab');
  assert.equal(await page.locator('.cm-editor').evaluate(e=>getComputedStyle(e).fontSize),'18px');
  assert.equal(await page.locator('#paper').evaluate(e=>getComputedStyle(e).fontSize),'23px');
  await page.keyboard.press('Escape');
  const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  for(const [selector,expectedFont,expectedZoom] of [['#editor',19,'100%'],['#preview-scroll',19,'110%']]){
    const rect=await page.locator(selector).boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
    await page.keyboard.down('Control');await page.mouse.wheel(0,-100);await page.keyboard.up('Control');
    await page.waitForFunction(([font,zoom])=>getComputedStyle(document.querySelector('.cm-editor')).fontSize===font+'px'&&document.getElementById('zoom-label').textContent===zoom,[expectedFont,expectedZoom]);
  }
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()),before);
  await page.evaluate(()=>{const e=window.instantDebug.editor;const text='|=|   !=   =>   <=   ||   русский текст\n\\[\\boxed{x=1}\\]';e.dispatch({changes:{from:0,to:e.state.doc.length,insert:text}});});
  await page.waitForFunction(()=>window.instantDebug.result.blocks.some(b=>b.html.includes('fbox')));
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/font-settings.png'});
  await page.waitForTimeout(450);await close();app=await launch();page=await app.firstWindow();await page.waitForFunction(()=>window.instantDebug?.editor);
  const restored=await page.evaluate(()=>window.instant.loadAppearance());assert.deepEqual(restored,{editorSize:19,previewSize:23,previewZoom:110,theme:original.theme});
  assert.equal(await page.locator('.cm-editor').evaluate(e=>getComputedStyle(e).fontSize),'19px');
  console.log(JSON.stringify({status:'PASS',font:style.font,ligatures:style.ligatures,independentWheelZoom:true,persistentSettings:true,screenshot:path.resolve('test-results/font-settings.png')}));
}finally{
  try{if(original){await page.evaluate(value=>window.instant.saveAppearance(value),original);await new Promise(r=>setTimeout(r,450));}}
  finally{await close();}
}
