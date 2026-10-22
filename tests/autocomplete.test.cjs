const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {Autocomplete,validateConfig,makePrompt,cleanCompletion}=require('../electron/autocomplete.cjs');

test('local completion validates devices and token bounds, retains FIM whitespace',()=>{
  assert.deepEqual(validateConfig({device:'npu',maxTokens:128}),{device:'npu',maxTokens:128,inlineMiddle:false});
  assert.equal(validateConfig({device:'gpu',maxTokens:32,inlineMiddle:true}).inlineMiddle,true);
  for(const input of [{device:'auto',maxTokens:32},{device:'cpu',maxTokens:0},{device:'gpu',maxTokens:129},{device:'gpu',maxTokens:8.5}])assert.throws(()=>validateConfig(input));
  assert.equal(makePrompt('x = ','\n\\]'),'<|fim_prefix|>x = <|fim_suffix|>\n\\]<|fim_middle|>');
  assert.equal(cleanCompletion(' \\frac{1}{3}\n\\]<|fim_pad|>junk','\n\\]'),' \\frac{1}{3}');
});

test('hardware cannot change while running or starting; length persists; non-Windows is unsupported',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'instant-fim-'));
  try{
    const runner=new Autocomplete(root,{platform:'win32'});await runner.ready;
    for(const phase of ['starting','on','stopping']){
      runner.phase=phase;
      await assert.rejects(runner.configure({device:'cpu',maxTokens:32}),/Сначала останови/);
    }
    runner.phase='on';await runner.configure({device:'gpu',maxTokens:64});
    runner.phase='off';await runner.configure({device:'npu',maxTokens:16,inlineMiddle:true});
    const restored=new Autocomplete(root,{platform:'win32'});await restored.ready;
    assert.equal(restored.status().device,'npu');assert.equal(restored.status().maxTokens,16);
    assert.equal(restored.status().inlineMiddle,true);
    const linux=new Autocomplete(root,{platform:'linux'});await linux.ready;
    assert.equal(linux.status().supported,false);await assert.rejects(linux.start(),/Windows/);
  }finally{assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});

test('runner sends bounded FIM and token setting, discards results after stop',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'instant-fim-'));
  let body,release;
  const server=http.createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer test-token');
    let raw='';for await(const chunk of req)raw+=chunk;body=JSON.parse(raw);
    await new Promise(resolve=>{release=resolve;});
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({content:'answer',timings:{predicted_per_second:30}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const runner=new Autocomplete(root,{platform:'win32'});await runner.ready;
    runner.phase='on';runner.port=server.address().port;runner.token='test-token';runner.config.maxTokens=48;
    const request=runner.complete({prefix:'a'.repeat(6000),suffix:'b'.repeat(2000)});
    while(!release)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(body.prefix.length,5000);assert.equal(body.suffix.length,1500);assert.equal(body.n_predict,48);
    await runner.stop();release();assert.equal((await request).text,'');assert.equal(runner.status().phase,'off');
  }finally{release?.();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(root),os.tmpdir());await fs.rm(root,{recursive:true,force:true});}
});
