// Opt-in Windows smoke test; requires the user's separately installed local AI files.
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:process.env.INSTANT_EXE,args:process.env.INSTANT_EXE?[]:['.'],env});
const page=await app.firstWindow(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.waitForFunction(()=>window.instantDebug?.editor);
  for(const device of ['gpu','cpu','npu']){
    await page.locator('#autocomplete-toggle').click();
    await page.waitForFunction(()=>!document.getElementById('autocomplete-device').disabled);
    await page.locator('#autocomplete-device').selectOption(device);
    await page.waitForFunction(()=>!document.getElementById('autocomplete-start').disabled);
    await page.locator('#autocomplete-start').click();
    await page.waitForFunction(()=>document.getElementById('autocomplete-state').textContent.startsWith('Включено'),{},{timeout:180000});
    assert.equal(await page.locator('#autocomplete-device').isDisabled(),true);
    assert.equal(await page.evaluate(async device=>{try{await window.instant.configureAutocomplete({device:device==='gpu'?'cpu':'gpu',maxTokens:32});return false;}catch(error){return error.message.includes('Сначала останови');}},device),true);
    await page.locator('#autocomplete-close').click();
    const source='The roots of $ax^2+bx+c=0$ are\n\\[\nx = ◊\n\\]\n';
    await page.evaluate(source=>{const e=window.instantDebug.editor,pos=source.indexOf('◊');e.dispatch({changes:{from:0,to:e.state.doc.length,insert:source.replace('◊','')},selection:{anchor:pos}});e.focus();},source);
    await page.locator('.cm-local-ghost').waitFor({timeout:60000});
    const ghost=await page.locator('.cm-local-ghost').textContent();assert.ok(ghost.trim().length>0);
    if(device==='gpu')await page.screenshot({path:'test-results/autocomplete-live-ghost.png'});
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),source.replace('◊',ghost));
    console.log('PASS',device,JSON.stringify(ghost));
    await page.locator('#autocomplete-toggle').click();
    await page.locator('#autocomplete-stop').click();
    await page.waitForFunction(()=>!document.getElementById('autocomplete-device').disabled);
    await page.locator('#autocomplete-close').click();
  }
  await page.evaluate(()=>window.instant.configureAutocomplete({device:'gpu',maxTokens:32}));
  await fs.writeFile('test-results/autocomplete-live-errors.json',JSON.stringify(errors));assert.deepEqual(errors,[]);
}catch(error){await page.screenshot({path:'test-results/autocomplete-live-failure.png'});throw error;}
finally{
  await page.evaluate(()=>window.instant.stopAutocomplete()).catch(()=>{});
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(win=>win.destroy()));await app.close();
}
