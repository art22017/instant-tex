import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const out=path.resolve('test-results');
await fs.mkdir(out,{recursive:true});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const args=process.env.INSTANT_EXE?[]:['.'];
if(process.env.INSTANT_DPI)args.unshift('--force-device-scale-factor='+process.env.INSTANT_DPI);
const app=await electron.launch({executablePath:process.env.INSTANT_EXE,args,env});
let page;
const errors=[];
try{
  page=await app.firstWindow();
  const nativeClipboardAvailable=await app.evaluate(({clipboard})=>{clipboard.writeText('Instant TeX probe');return clipboard.readText()==='Instant TeX probe';});
  page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.instantDebug?.result?.blocks.length>0);
  assert.equal(await page.evaluate(()=>window.instantDebug.result.issues.length),0);
  assert.ok(await page.locator('#rendered').innerText().then(t=>t.includes('Задача')));
  assert.equal(await page.locator('.toolbar').evaluate(e=>e.getBoundingClientRect().height),36);
  assert.ok(await page.locator('#paper').evaluate(e=>getComputedStyle(e).fontFamily.includes('CMU Serif')));
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+Space');
  await page.locator('.cm-tooltip-autocomplete').waitFor();await page.keyboard.press('Escape');
  await page.evaluate(()=>{const e=window.instantDebug.editor,s='\\[\n\\fr\n\\]';e.dispatch({changes:{from:0,to:e.state.doc.length,insert:s},selection:{anchor:s.indexOf('\\fr')+3}});e.focus();});
  await page.keyboard.press('Control+Space');await page.locator('.cm-tooltip-autocomplete').waitFor();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString()),'\\[\n\\frac{}{}\n\\]');
  assert.equal(await page.evaluate(()=>window.instantDebug.editor.state.selection.main.head),9);
  await page.keyboard.type('a');await page.keyboard.press('Tab');await page.keyboard.type('b');
  assert.ok(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString().includes('\\frac{a}{b}')));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({selection:{anchor:e.state.doc.toString().indexOf('\n\\]')}});});
  await page.keyboard.press('Enter');
  assert.ok(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString().includes('\\frac{a}{b} \\\\\n')));
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:'\\begin{ga'},selection:{anchor:9}});e.focus();});
  await page.keyboard.press('Control+Space');await page.getByText('\\begin{gather}',{exact:true}).click();
  assert.ok(await page.evaluate(()=>window.instantDebug.editor.state.doc.toString().includes('\\end{gather}')));
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1});});
  await page.locator('#new').click();
  await page.waitForFunction(()=>window.instantDebug.editor.state.doc.toString().includes('\\usepackage[russian]{babel}'));
  await page.locator('#example').click();
  await page.waitForFunction(()=>document.getElementById('rendered').textContent.includes('Непрерывность'));
  await page.screenshot({path:path.join(out,'desktop.png')});
  // Source selection -> Ask AI, streamed answer -> copy. No external API in this test.
  await app.evaluate(({ipcMain})=>{
    ipcMain.removeHandler('chats-save');ipcMain.handle('chats-save',()=>{});
    ipcMain.removeHandler('ai-start');ipcMain.handle('ai-start',(event,payload)=>{
      globalThis.testAIPayload=payload;
      setTimeout(()=>event.sender.send('ai-event',{id:payload.id,type:'chunk',text:'Ответ по фрагменту.'}),10);
      setTimeout(()=>event.sender.send('ai-event',{id:payload.id,type:'done'}),30);return true;
    });
  });
  await page.evaluate(()=>{const e=window.instantDebug.editor,s=e.state.doc.toString(),from=s.indexOf('x_0');e.dispatch({selection:{anchor:from,head:from+3},scrollIntoView:true});e.focus();});
  await page.locator('#selection-ai').waitFor({state:'visible'});await page.locator('#selection-ai').click();
  assert.equal(await page.locator('#ai-selection .selection-excerpt').innerText(),'x_0');
  // The question keeps its selected subject even if the editor selection later changes.
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({selection:{anchor:0,head:8}});});
  await page.locator('#ai-question').fill('Объясни выделенное');await page.locator('#ai-question').press('Control+Enter');
  await page.waitForFunction(()=>document.getElementById('ai-status').textContent==='Готово');
  assert.equal(await page.locator('#ai-answer .ai-response').innerText(),'Ответ по фрагменту.');
  const aiPayload=await app.evaluate(()=>globalThis.testAIPayload);assert.equal(aiPayload.selection,'x_0');assert.ok(aiPayload.context.includes('Непрерывность'));
  await page.locator('#ai-copy').click();
  if(nativeClipboardAvailable){await page.waitForFunction(()=>document.getElementById('toast').textContent==='Ответ скопирован');assert.equal(await app.evaluate(({clipboard})=>clipboard.readText()),'Ответ по фрагменту.');}
  else await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Буфер обмена Windows недоступен'));
  await page.locator('#ai-close').click();
  await page.evaluate(()=>{const p=document.querySelector('#rendered p'),r=document.createRange();r.selectNodeContents(p);const s=getSelection();s.removeAllRanges();s.addRange(r);document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));});
  await page.locator('#selection-ai').waitFor({state:'visible'});await page.locator('#selection-ai').click();
  assert.ok(await page.locator('#ai-selection').innerText().then(t=>t.includes('Проверим')));await page.locator('#ai-close').click();
  await page.locator('#ai-toggle').click();assert.equal(await page.locator('#ai-selection').isVisible(),false);await page.locator('#ai-close').click();
  await page.locator('#help').click();assert.equal(await page.locator('#help-dialog').evaluate(el=>el.open),true);
  await page.locator('#close-help').click();
  await page.locator('#zoom-in').click();assert.equal(await page.locator('#zoom-label').innerText(),'110%');
  await page.locator('#zoom-out').click();
  await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+End');await page.keyboard.type('\n\n');
  await page.keyboard.insertText('Русский текст: \\(\\boxed{a=2}\\).');
  await page.waitForFunction(()=>document.getElementById('rendered').textContent.includes('Русский текст'));
  assert.equal(await page.evaluate(()=>window.instantDebug.result.issues.length),0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.waitForFunction(()=>!document.getElementById('rendered').textContent.includes('Русский текст'));
  // Real OS save/export paths, with only the native dialogs stubbed.
  await app.evaluate(({dialog},out)=>{
    dialog.showSaveDialog=async(_owner,options)=>({canceled:false,filePath:out+'\\'+options.defaultPath});
    dialog.showMessageBox=async()=>({response:1});
  },out);
  await page.locator('#save').click();
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('сохранён'));
  const saved=await fs.readFile(path.join(out,'Черновик.tex'),'utf8');assert.ok(saved.includes('Непрерывность'));
  await page.locator('#export-toggle').click();await page.locator('#pdf').click();
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Готово'),{timeout:30000});
  const pdf=await fs.readFile(path.join(out,'Черновик.pdf'));assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  await page.locator('#export-toggle').click();await page.locator('#png').click();
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('.png'),{timeout:30000});
  const png=await fs.readFile(path.join(out,'Черновик.png'));assert.equal(png.subarray(1,4).toString(),'PNG');
  const imageSize=await app.evaluate(({nativeImage},p)=>nativeImage.createFromPath(p).getSize(),path.join(out,'Черновик.png'));
  assert.equal(imageSize.width,1920);assert.ok(imageSize.height>1000);
  await page.locator('#export-toggle').click();await page.locator('#copy-image').click();
  if(nativeClipboardAvailable){await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('скопирована'),{timeout:30000});assert.equal(await app.evaluate(({clipboard})=>clipboard.readImage().isEmpty()),false);}
  else await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('Буфер обмена Windows недоступен'),{timeout:30000});
  await app.evaluate(({dialog},p)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[p]});},path.join(out,'Черновик.tex'));
  await page.locator('#open').click();await page.waitForFunction(()=>!document.title.startsWith('•'));
  // Export content longer than the screen to catch clipped offscreen rendering.
  await page.evaluate(()=>{const e=window.instantDebug.editor;const note=Array.from({length:18},(_,i)=>`Шаг ${i+1}\n\\[\\boxed{x=${i+1}}\\]\n`).join('\n')+'\nКОНЕЦ РЕШЕНИЯ';e.dispatch({changes:{from:0,to:e.state.doc.length,insert:note}});});
  await page.waitForFunction(()=>document.getElementById('rendered').textContent.includes('КОНЕЦ РЕШЕНИЯ'));
  await app.evaluate(({dialog},out)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:out+'\\long.png'});},out);
  await page.locator('#export-toggle').click();await page.locator('#png').click();
  await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('long.png'),{timeout:30000});
  const longSize=await app.evaluate(({nativeImage},p)=>nativeImage.createFromPath(p).getSize(),path.join(out,'long.png'));
  assert.equal(longSize.width,1920);assert.ok(longSize.height>3000);
  // An incomplete formula must remain visible and block stale exports.
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:'\\[\\boxed{x=1}\\]'}});});
  await page.waitForFunction(()=>window.instantDebug.result.blocks.length===1);
  const valid=await page.locator('#rendered').innerHTML();
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:e.state.doc.length-2,to:e.state.doc.length,insert:''}});});
  await page.waitForFunction(()=>window.instantDebug.result.issues.length===1);
  assert.equal(await page.locator('.render-block.stale').count(),1);
  assert.ok(await page.locator('#rendered').innerHTML().then(h=>h.includes('fbox')));
  await page.locator('#export-toggle').click();await page.locator('#pdf').click();
  await page.waitForFunction(()=>!document.getElementById('issues').hidden);
  assert.ok(await page.locator('#toast').innerText().then(t=>t.includes('заверши')));
  // Typical document timings and a larger 100-equation workload.
  const timings=await page.evaluate(async()=>{
    const {editor,renderer}=window.instantDebug;
    const source=Array.from({length:100},(_,i)=>`Задача ${i+1}\n\\[\\boxed{x_${i}=\\frac{${i+1}}{2}}\\]\n`).join('\n');
    editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:source}});
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const samples=[];
    for(let i=0;i<30;i++){
      const t=performance.now();editor.dispatch({changes:{from:0,to:0,insert:'а'}});
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      samples.push({totalMs:performance.now()-t,renderMs:window.instantDebug.lastRenderMs});
    }
    return samples;
  });
  await fs.writeFile(path.join(out,'timings.json'),JSON.stringify(timings,null,2));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',nativeClipboardAvailable,png:imageSize,pdfBytes:pdf.length,renderMedian:timings.map(x=>x.renderMs).sort((a,b)=>a-b)[15],frameMedian:timings.map(x=>x.totalMs).sort((a,b)=>a-b)[15],screenshot:path.join(out,'desktop.png')}));
}catch(e){
  console.log('DESKTOP FAILURE',e.message);
  console.log('TOAST',await page?.locator('#toast').textContent());
  console.log('PAGE ERRORS',errors);
  await page?.screenshot({path:path.join(out,'failure.png')});
  throw e;
}finally{
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));
  await app.close();
}
