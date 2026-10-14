import test from 'node:test';
import assert from 'node:assert/strict';
import catalog from '../electron/models.cjs';
import ai from '../electron/ai.cjs';
import {runWork} from '../electron/work.mjs';
const {MODELS,resolveModel}=catalog;
test('catalog preserves free routing IDs and rejects unsupported alternatives',()=>{
  assert.equal(MODELS.length,11);
  for(const m of MODELS){assert.equal(ai.requestBody({context:'',selection:'',question:'?',model:m.id}).model,m.id);assert.equal(m.free===true,m.id==='openrouter/free'||m.id.endsWith(':free'));}
  assert.throws(()=>resolveModel('qwen/qwen3.8-27b'),/модель/);
});
test('Ask accepts the actual model returned by the free router',async()=>{
  let answer='';await ai.streamAnswer({context:'',selection:'',question:'?',model:'openrouter/free'},'test',null,t=>answer+=t,async(_url,init)=>{
    assert.equal(JSON.parse(init.body).model,'openrouter/free');
    return new Response('data: {"model":"some-free-provider/model","choices":[{"delta":{"content":"Ответ"}}]}\n\ndata: [DONE]\n\n');
  });assert.equal(answer,'Ответ');
});
test('Pi sends each selected model with tools and appropriate reasoning options',async()=>{
  for(const m of MODELS){let requested=false;
    await runWork({context:'x=1',selection:'',question:'Привет',model:m.id},'test-key',new AbortController().signal,()=>{},async(_url,init)=>{
      const body=JSON.parse(init.body);requested=true;assert.equal(body.model,m.id);assert.ok(body.tools.length===4);
      if(m.reasoningEffort===false)assert.deepEqual(body.reasoning,{enabled:true});
      return new Response('data: '+JSON.stringify({id:'test',model:m.id,choices:[{index:0,delta:{content:'Привет'},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'test',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
    },()=>{});assert.ok(requested,m.id);
  }
});
