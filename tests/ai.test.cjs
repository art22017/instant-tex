const test=require('node:test'),assert=require('node:assert/strict');
const {MODEL,requestBody,streamAnswer}=require('../electron/ai.cjs');
test('AI uses fixed DeepSeek model and structured context/selection/question',()=>{
  const payload={context:'Текст \\[x\\]',selection:'x',question:'Объясни'};
  const body=requestBody(payload);assert.equal(body.model,'deepseek/deepseek-v4.1-flash');assert.equal(body.stream,true);
  assert.deepEqual(JSON.parse(body.messages[1].content),payload);assert.ok(!body.models);
});
test('stream handles split UTF-8, keepalive, usage and DONE',async()=>{
  const bytes=new TextEncoder().encode(':keepalive\n\ndata: '+JSON.stringify({model:MODEL,choices:[{delta:{content:'Привет'}}]})+'\n\ndata: {"choices":[],"usage":{}}\n\ndata: [DONE]\n\n');
  const body=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=3)c.enqueue(bytes.slice(i,i+3));c.close();}});
  let result='';await streamAnswer({context:'',selection:'',question:'Привет'},'test',null,t=>result+=t,async()=>({ok:true,body}));assert.equal(result,'Привет');
});
test('Follow-up sends prior conversation without changing structured JSON or model',()=>{
  const payload={context:'Документ',selection:'x',question:'Продолжи',history:[{question:'Что это?',answer:'Формула'}]};
  const body=requestBody(payload);assert.equal(body.model,MODEL);assert.equal(body.messages[2].role,'assistant');
  assert.deepEqual(JSON.parse(body.messages.at(-1).content),{context:payload.context,selection:'x',question:'Продолжи'});
  assert.throws(()=>requestBody({...payload,history:[{question:1,answer:'x'}]}),/история/);
});
test('mid-stream errors and truncated streams remain errors',async()=>{
  const payload={context:'',selection:'',question:'?'},mock=text=>async()=>({ok:true,body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(text));c.close();}})});
  await assert.rejects(streamAnswer(payload,'test',null,()=>{},mock('data: {"error":{"message":"Provider error"}}\n\n')),/Provider error/);
  await assert.rejects(streamAnswer(payload,'test',null,()=>{},mock('data: {"choices":[{"delta":{"content":"часть"}}]}\n\n')),/оборвался/);
});
