import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});let page;const errors=[];
const phrase='я понимаю что я бездарь и ничему не научусь';
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.instantDebug?.editor);
  await app.evaluate(({ipcMain})=>{
    globalThis.workEnabled=false;globalThis.workJob=null;
    ipcMain.removeHandler('chats-save');ipcMain.handle('chats-save',()=>true);
    ipcMain.removeHandler('ai-config');ipcMain.handle('ai-config',()=>({hasKey:true,workEnabled:globalThis.workEnabled}));
    ipcMain.removeHandler('work-enable');ipcMain.handle('work-enable',(_e,value,phrase)=>{
      if(value&&phrase!=='я понимаю что я бездарь и ничему не научусь')throw Error('phrase');
      globalThis.workEnabled=value;
      if(!value&&globalThis.workJob){const j=globalThis.workJob;j.emit({type:'edit_decision',proposalId:'proposal',toolCallId:'edit',accepted:false});j.emit({type:'stopped'});globalThis.workJob=null;}
      return value;
    });
    ipcMain.removeHandler('work-start');ipcMain.handle('work-start',(event,payload)=>{
      if(!globalThis.workEnabled)throw Error('disabled');
      const emit=data=>event.sender.send('ai-event',{id:payload.id,...data});
      const after=payload.context.replace('x=1','x=3'),j={emit,payload,after,done:false};globalThis.workJob=j;
      const text=(traceId,text,kind='text')=>{emit({type:'trace_start',traceId,kind});emit({type:'trace_delta',traceId,kind,text});emit({type:'trace_end',traceId,kind});};
      setTimeout(()=>{
        if(globalThis.workJob!==j)return;text('thinking','Проверяю формулу','thinking');text('before','Сначала изменю значение.');
        emit({type:'tool_start',name:'edit_document',toolCallId:'edit',args:'{"oldText":"x=1","newText":"x=2"}'});
        emit({type:'draft_update',proposalId:'proposal',before:payload.context,after:payload.context.replace('x=1','x=2')});
        emit({type:'tool_end',name:'edit_document',toolCallId:'edit',result:'{"updated":true}'});
      },60);
      setTimeout(()=>{
        if(globalThis.workJob!==j)return;text('between','Уточню результат.');emit({type:'tool_start',name:'edit_document',toolCallId:'edit-2'});
        emit({type:'draft_update',proposalId:'proposal',before:payload.context,after});emit({type:'tool_end',toolCallId:'edit-2',name:'edit_document',result:'{"updated":true}'});
        text('check','Проверю LaTeX.');emit({type:'tool_start',name:'check_latex',toolCallId:'check'});emit({type:'tool_end',toolCallId:'check',name:'check_latex',result:'[]'});text('final','Итог: $x=3$.');
        j.done=true;emit({type:'edit_proposal',proposalId:'proposal',before:payload.context,after,added:1,removed:1});emit({type:'done'});
      },1000);return true;
    });
    ipcMain.removeHandler('work-decision');ipcMain.handle('work-decision',(_e,p)=>{
      const j=globalThis.workJob;if(!j||!j.done)throw Error('not finished');
      const accepted=p.accepted&&p.currentDocument===j.after;
      j.emit({type:'edit_decision',proposalId:'proposal',accepted});globalThis.workJob=null;return true;
    });
    ipcMain.removeHandler('ai-cancel');ipcMain.handle('ai-cancel',()=>{const j=globalThis.workJob;if(j){globalThis.workJob=null;j.emit({type:'edit_decision',proposalId:'proposal',accepted:false});j.emit({type:'stopped'});}});
  });
  await page.locator('#ai-toggle').click();assert.equal(await page.locator('#ai-work-mode').isDisabled(),true);
  await page.locator('#ai-settings').click();await page.locator('#ai-work-settings').click();
  assert.equal(await page.locator('#work-settings-dialog').evaluate(e=>e.dispatchEvent(new Event('copy',{cancelable:true,bubbles:true}))),false);
  assert.equal(await page.locator('#work-phrase').evaluate(e=>e.dispatchEvent(new Event('paste',{cancelable:true,bubbles:true}))),false);
  await page.locator('#work-phrase').pressSequentially(phrase);await page.locator('#work-enable-form button').click();
  await page.waitForFunction(()=>!document.getElementById('ai-work-mode').disabled);
  await page.locator('#ai-settings').click();await page.locator('#ai-work-mode').click();assert.equal(await page.locator('#ai-work-mode').getAttribute('aria-selected'),'true');
  const original='Решение\n\\[x=1\\]';
  const setDoc=()=>page.evaluate(text=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:text}});},original);
  const doc=()=>page.evaluate(()=>window.instantDebug.editor.state.doc.toString());
  const send=async()=>{await page.locator('#ai-question').fill('Исправь x');await page.locator('#ai-question').press('Enter');await page.locator('#work-review').waitFor({state:'visible'});};
  await setDoc();await page.locator('#ai-question').fill('Исправь x');await page.locator('#ai-question').press('Enter');
  await page.waitForFunction(()=>window.instantDebug.editor.state.doc.toString().includes('x=2'));
  assert.equal(await page.locator('#work-review').isVisible(),false);assert.equal(await page.locator('.work-summary:visible').count(),0);
  await page.locator('#work-review').waitFor({state:'visible'});assert.equal(await doc(),original.replace('x=1','x=3'));
  assert.equal(await page.locator('.cm-deletedChunk').count(),1);assert.equal(await page.locator('.work-summary:visible').count(),1);
  assert.equal(await page.locator('.trace-history').last().getAttribute('open'),null);
  const kinds=await page.locator('.agent-traces').last().locator('.agent-trace').evaluateAll(els=>els.map(e=>e.className.split(' ')[1]));
  assert.deepEqual(kinds,['trace-thinking','trace-text','trace-tool','trace-text','trace-tool','trace-text','trace-tool','trace-text']);
  assert.equal(await page.locator('#ai-status').innerText(),'');assert.equal(await page.locator('.trace-spinner').count(),0);
  await page.locator('.trace-history>summary').first().click();await page.locator('.trace-tool summary').first().click();assert.ok((await page.locator('.trace-tool .trace-body').first().innerText()).includes('updated'));
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/work-diff.png'});
  await page.locator('#work-reject').click();await page.locator('#work-review').waitFor({state:'hidden'});assert.equal(await doc(),original);
  await page.waitForFunction(()=>!document.getElementById('ai-send').disabled);
  await send();await page.locator('#work-accept').click();await page.locator('#work-review').waitFor({state:'hidden'});assert.equal(await doc(),original.replace('x=1','x=3'));
  await page.locator('.cm-content').click();await page.keyboard.press('Control+z');assert.equal(await doc(),original);
  await page.waitForFunction(()=>!document.getElementById('ai-send').disabled);
  await page.locator('#ai-question').fill('Исправь x');await page.locator('#ai-question').press('Enter');
  await page.waitForFunction(()=>window.instantDebug.editor.state.doc.toString().includes('x=2'));await page.locator('#ai-stop').click();
  await page.waitForFunction(()=>document.getElementById('ai-stop').hidden);assert.equal(await doc(),original);assert.equal(await page.locator('#work-review').isVisible(),false);
  await page.locator('#ai-question').fill('Исправь x');await page.locator('#ai-question').press('Enter');
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:'Моя ручная правка'}});});
  await page.waitForFunction(()=>document.getElementById('ai-stop').hidden);assert.equal(await doc(),'Моя ручная правка');assert.equal(await page.locator('#work-review').isVisible(),false);
  await setDoc();
  await send();await page.locator('#ai-settings').click();await page.locator('#ai-work-settings').click();await page.locator('#work-disable').click();
  await page.locator('#work-review').waitFor({state:'hidden'});assert.equal(await doc(),original);assert.equal(await page.locator('#ai-work-mode').isDisabled(),true);
  await page.screenshot({path:'test-results/work-settings.png'});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',defaultOff:true,manualEnable:true,copyPasteBlocked:true,diff:true,acceptReject:true,undoAccepted:true,staleDocumentPreserved:true,disableRollback:true}));
}catch(error){await page?.screenshot({path:'test-results/work-failure.png'});console.log('WORK FAILURE',error.message,errors);throw error;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();}
