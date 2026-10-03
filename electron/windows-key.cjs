const {spawn}=require('node:child_process');
// Windows user protection is independent of Electron's Chromium profile and build path.
// The plaintext key only crosses the child's stdin/stdout; never argv, logs or a file.
const setup="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $dir=Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'InstantTeX'; $file=Join-Path $dir 'openrouter.dpapi'; $entropy=[Text.Encoding]::UTF8.GetBytes('InstantTeX.OpenRouter.v1'); ";
function run(script,input=''){
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-WindowStyle','Hidden','-Command',setup+script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let output='',error='';const timer=setTimeout(()=>child.kill(),15000);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
    child.on('error',()=>{clearTimeout(timer);reject(new Error('Не удалось открыть хранилище ключа Windows'));});
    child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(output.trim());else reject(new Error('Windows не смог прочитать или сохранить ключ OpenRouter'));});
    child.stdin.on('error',()=>{});child.stdin.end(input);
  });
}
async function read(){return run("if(Test-Path -LiteralPath $file){$bytes=[IO.File]::ReadAllBytes($file); $plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))}");}
async function save(key){
  if(typeof key!=='string'||!/^sk-or-[a-zA-Z0-9-]+$/.test(key)||key.length>300)throw new Error('Введи ключ OpenRouter');
  await run("$plain=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd()); $bytes=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [IO.Directory]::CreateDirectory($dir) | Out-Null; [IO.File]::WriteAllBytes(($file+'.tmp'),$bytes); Move-Item -LiteralPath ($file+'.tmp') -Destination $file -Force",key);
}
module.exports={read,save};
