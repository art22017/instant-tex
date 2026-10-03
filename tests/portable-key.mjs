import {chromium} from 'playwright';
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.resolve('release-v5/Instant-TeX-0.5.0-Windows.exe'),['--remote-debugging-port='+port],{env,cwd:os.tmpdir(),windowsHide:true,stdio:'ignore'});
let browser,page;
try{
  let version;
  for(let attempt=0;attempt<120;attempt++){
    try{version=await fetch('http://127.0.0.1:'+port+'/json/version').then(r=>r.json());break;}catch{await new Promise(r=>setTimeout(r,250));}
  }
  assert.ok(version,'Portable debugging endpoint was not available');
  browser=await chromium.connectOverCDP(version.webSocketDebuggerUrl);page=browser.contexts()[0].pages()[0];
  await page.waitForFunction(()=>window.instantDebug?.editor);
  const config=await page.evaluate(()=>window.instant.aiConfig());assert.equal(config.hasKey,true);
  assert.equal(await page.locator('.cm-content').evaluate(e=>getComputedStyle(e).fontWeight),'670');
  console.log(JSON.stringify({status:'PASS',portableKeyAvailable:true,launchedOutsideProject:true,fontWeight:670}));
}finally{
  if(page)await page.evaluate(()=>window.close()).catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  // Only this test's own launcher is eligible for cleanup.
  if(child.exitCode===null)child.kill();
}
