import test from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentTools,runWork} from '../electron/work.mjs';

test('tools edit the working copy immediately; later reads and checks see all edits',async()=>{
  const proposals=[];
  const tools=createDocumentTools('a\nx=1\nb',p=>proposals.push(p));
  const edit=tools.find(t=>t.name==='edit_document'),read=tools[0];
  await edit.execute('edit-1',{oldText:'x=1',newText:'x=2'},new AbortController().signal);
  assert.equal(proposals[0].after,'a\nx=2\nb');
  assert.ok((await read.execute('',{})).content[0].text.includes('x=2'));
  await edit.execute('edit-2',{oldText:'x=2',newText:'x=3'},new AbortController().signal);
  assert.equal(tools.document,'a\nx=3\nb');
  assert.ok((await read.execute('',{})).content[0].text.includes('x=3'));
  await assert.rejects(edit.execute('',{oldText:'missing',newText:'x'},new AbortController().signal),/не найден/);
});

test('Pi finishes multiple edits without approval; text and tools retain event order',async()=>{
  let calls=0;const events=[],proposals=[];
  const mockFetch=async(_url,init)=>{
    const body=JSON.parse(init.body);assert.equal(body.model,'deepseek/deepseek-v4.1-flash');
    assert.ok(body.tools.some(t=>t.function.name==='edit_document'));assert.ok(!body.tools.some(t=>t.function.name==='bash'));
    calls++;
    const delta=calls<=2?{tool_calls:[{index:0,id:'call-edit-'+calls,type:'function',function:{name:'edit_document',arguments:JSON.stringify({oldText:'x='+calls,newText:'x='+(calls+1)})}}]}:{content:'Итог: $x=3$'};
    const lines=[{id:'test',model:body.model,choices:[{index:0,delta:{reasoning_content:'Проверяю шаг '+calls},finish_reason:null}]},{id:'test',model:body.model,choices:[{index:0,delta:{content:'Шаг '+calls},finish_reason:null}]},{id:'test',model:body.model,choices:[{index:0,delta,finish_reason:null}]},{id:'test',model:body.model,choices:[{index:0,delta:{},finish_reason:calls<=2?'tool_calls':'stop'}]}];
    return new Response(lines.map(v=>'data: '+JSON.stringify(v)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
  };
  const result=await runWork({context:'\\[x=1\\]',selection:'',question:'Измени x'},'test-key',new AbortController().signal,e=>events.push(e),mockFetch,p=>proposals.push(p));
  assert.equal(calls,3);assert.equal(proposals.length,2);assert.equal(result.document,'\\[x=3\\]');
  assert.ok(events.some(e=>e.type==='tool_start'&&e.name==='edit_document'));
  assert.equal(events.find(e=>e.type==='trace_delta').kind,'thinking');
  const sequence=events.filter(e=>(e.type==='trace_delta'&&e.kind==='text')||e.type==='tool_start').map(e=>e.text||e.name);
  assert.deepEqual(sequence,['Шаг 1','edit_document','Шаг 2','edit_document','Шаг 3','Итог: $x=3$']);
});
