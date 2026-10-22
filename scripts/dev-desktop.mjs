import {createServer} from 'vite';
import electron from 'electron';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const vite=await createServer({root,server:{host:'127.0.0.1',port:5176,strictPort:true}});
await vite.listen();
const env={...process.env,INSTANT_TEX_DEV_URL:'http://127.0.0.1:5176/'};
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(electron,['.'],{cwd:root,env,stdio:'inherit',windowsHide:false});
let closing=false;
async function close(code=0){if(closing)return;closing=true;child.kill();await vite.close();process.exit(code);}
child.on('error',error=>{console.error(error);close(1);});
child.on('exit',code=>close(code??0));
process.on('SIGINT',()=>close());process.on('SIGTERM',()=>close());
console.log('Instant TeX · Dev · http://127.0.0.1:5176/');
