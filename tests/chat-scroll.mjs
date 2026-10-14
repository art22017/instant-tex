import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({executablePath:env.INSTANT_EXE,args:env.INSTANT_EXE?[]:['.'],env});let page;const errors=[];
try{
  page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>window.instantDebug?.editor);
  await app.evaluate(({ipcMain})=>{
    globalThis.scrollCalls=0;globalThis.scrollJob=null;
    for(const name of ['ai-config','chats-load','chats-save','work-start','work-decision'])ipcMain.removeHandler(name);
    ipcMain.handle('ai-config',()=>({hasKey:true,workEnabled:true}));ipcMain.handle('chats-load',()=>[]);ipcMain.handle('chats-save',()=>true);
    ipcMain.handle('work-start',(event,payload)=>{
      const call=++globalThis.scrollCalls,emit=data=>event.sender.send('ai-event',{id:payload.id,...data});
      const text=(id,value,kind='text')=>{emit({type:'trace_start',traceId:id,kind});emit({type:'trace_delta',traceId:id,kind,text:value});emit({type:'trace_end',traceId:id,kind});};
      setTimeout(()=>text('thinking','Проверяю запрос','thinking'),30);
      if(call===2){
        const after=payload.context.replace('x=1','x=2');globalThis.scrollJob={emit,after};
        setTimeout(()=>{emit({type:'tool_start',toolCallId:'read',name:'read_document'});emit({type:'tool_end',toolCallId:'read',name:'read_document',result:'Документ прочитан'});text('commentary','Меняю формулу.');},80);
        setTimeout(()=>{emit({type:'tool_start',toolCallId:'edit',name:'edit_document'});emit({type:'draft_update',proposalId:'all',before:payload.context,after});emit({type:'tool_end',toolCallId:'edit',name:'edit_document',result:'Изменено'});},160);
        setTimeout(()=>{text('answer','Итоговый ответ второго вопроса: $x=2$.');emit({type:'edit_proposal',proposalId:'all',before:payload.context,after,added:1,removed:1});emit({type:'done'});},500);
      }else if(call===3){
        setTimeout(()=>{emit({type:'trace_start',traceId:'long',kind:'text'});emit({type:'trace_delta',traceId:'long',kind:'text',text:'Длинный ответ\n\n'+('Первая часть длинного ответа.\n\n').repeat(30)});},60);
        for(let i=1;i<=6;i++)setTimeout(()=>emit({type:'trace_delta',traceId:'long',kind:'text',text:('Новая часть '+i+'\n\n').repeat(10)}),300*i);
        setTimeout(()=>{emit({type:'trace_end',traceId:'long',kind:'text'});emit({type:'done'});},1900);
      }else setTimeout(()=>{text('answer',call===1?'Привет!\n\n'+('Описание черновика и приглашение прислать задачу.\n\n').repeat(35):'Ответ на следующий вопрос.');emit({type:'done'});},120);
      return true;
    });
    ipcMain.handle('work-decision',(_event,p)=>{const job=globalThis.scrollJob;job.emit({type:'edit_decision',proposalId:'all',accepted:p.accepted&&p.currentDocument===job.after});globalThis.scrollJob=null;return true;});
  });
  await page.evaluate(()=>{const e=window.instantDebug.editor;e.dispatch({changes:{from:0,to:e.state.doc.length,insert:'\\[x=1\\]'}});});
  await page.locator('#ai-toggle').click();await page.locator('#ai-work-mode').click();
  const question=async text=>{await page.locator('#ai-question').fill(text);await page.locator('#ai-question').press('Enter');};
  const idle=()=>page.waitForFunction(()=>document.getElementById('ai-stop').hidden);
  const bottom=()=>page.waitForFunction(()=>{const e=document.getElementById('ai-answer');return e.scrollHeight-e.scrollTop-e.clientHeight<3;});
  await question('Привет');await idle();await bottom();assert.equal(await page.locator('.ai-turn').count(),1);
  await page.locator('#ai-answer').evaluate(e=>{e.scrollTop=0;});
  await question('Исправь формулу');await page.waitForFunction(()=>window.instantDebug.editor.state.doc.toString().includes('x=2'));await bottom();
  assert.equal(await page.locator('.ai-turn').count(),2);assert.equal(await page.locator('.ai-user').last().innerText(),'Исправь формулу');
  await idle();await bottom();assert.ok((await page.locator('.trace-final').last().innerText()).startsWith('Итоговый ответ второго вопроса:'));assert.equal(await page.locator('.trace-final').last().locator('.katex').count(),1);
  assert.equal(await page.locator('.trace-history[open]').count(),0);
  await page.locator('#work-accept').click();await page.locator('#work-review').waitFor({state:'hidden'});await bottom();
  await question('Расскажи подробно');await page.waitForFunction(()=>document.getElementById('ai-answer').textContent.includes('Первая часть'));
  await bottom();await page.locator('#ai-answer').hover();await page.mouse.wheel(0,-10000);
  await page.waitForFunction(()=>document.getElementById('ai-answer').scrollTop<10);await idle();
  assert.ok(await page.locator('#ai-answer').evaluate(e=>e.scrollTop<10),'Streaming must not pull the reader out of history');
  await page.keyboard.press('Escape');await page.locator('#ai-toggle').click();await bottom();
  await page.locator('#ai-answer').evaluate(e=>e.scrollTop=0);await page.locator('#ai-history-toggle').click();await page.locator('.chat-history-open').first().click();await bottom();
  await page.locator('#ai-answer').evaluate(e=>e.scrollTop=0);await question('Следующий вопрос');await idle();await bottom();
  assert.equal(await page.locator('.ai-turn').count(),4);assert.equal(await page.locator('.trace-final').last().innerText(),'Ответ на следующий вопрос.');
  await fs.mkdir('test-results',{recursive:true});await page.screenshot({path:'test-results/chat-scroll.png'});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({status:'PASS',fourTurns:true,followStream:true,manualHistoryScroll:true,reopenAtBottom:true,historyAtBottom:true,collapsedCompletedTraces:true,approveUpdates:true}));
}catch(e){await page?.screenshot({path:'test-results/chat-scroll-failure.png'});throw e;}
finally{await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();}
