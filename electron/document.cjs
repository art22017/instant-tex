const fs=require('node:fs/promises'),path=require('node:path');
const MAX_RESOURCE=16*1024*1024,MAX_TOTAL=64*1024*1024;
const imageTypes=new Set(['image/png','image/jpeg','image/webp','image/gif']);
function safeName(name){return typeof name==='string'&&name.length<200&&!name.includes('\\')&&!name.includes(':')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&/^[\p{L}\p{N}_. -]+$/u.test(p));}
function rasterMime(bytes){if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return'image/png';if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return'image/jpeg';if(/^GIF8[79]a/.test(bytes.subarray(0,6).toString()))return'image/gif';if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return'image/webp';return null;}
function validateDocument(value){
  if(typeof value==='string')value={text:value,assets:{}};
  if(!value||typeof value.text!=='string'||value.text.length>2_000_000)throw new Error('Лимит текста — 2 МБ');
  const assets=Object.create(null);let total=0;const entries=Object.entries(value.assets||{});if(entries.length>200)throw new Error('Не больше 200 вложений');
  for(const [name,a] of entries){if(!safeName(name)||!a||typeof a.data!=='string')throw new Error('Некорректное вложение');
    if(a.mime==='application/x-bibtex'){if(a.data.length>MAX_RESOURCE)throw new Error('Слишком большой .bib');total+=Buffer.byteLength(a.data);assets[name]={mime:a.mime,data:a.data};}
    else{if(!imageTypes.has(a.mime)||a.data.length>MAX_RESOURCE*1.4||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.data))throw new Error('Некорректное изображение');const bytes=Buffer.from(a.data,'base64');if(bytes.length>MAX_RESOURCE||rasterMime(bytes)!==a.mime)throw new Error('Некорректный формат изображения');total+=bytes.length;assets[name]={mime:a.mime,data:a.data};}
    if(total>MAX_TOTAL)throw new Error('Общий лимит вложений — 64 МБ');
  }return{text:value.text,assets};
}
async function readResource(file){const size=(await fs.stat(file)).size;if(size>MAX_RESOURCE)throw new Error('Лимит вложения — 16 МБ');const bytes=await fs.readFile(file);const name=path.basename(file);if(/\.bib$/i.test(name))return{name,mime:'application/x-bibtex',data:bytes.toString('utf8').replace(/^\uFEFF/,'')};const mime=rasterMime(bytes);if(!mime)throw new Error('Поддерживаются PNG, JPEG, WebP, GIF и .bib');return{name,mime,data:bytes.toString('base64')};}
async function openDocument(file){
  if((await fs.stat(file)).size>100*1024*1024)throw new Error('Слишком большой документ');const text=(await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'');
  if(/\.itex$/i.test(file)){const value=JSON.parse(text);if(value.format!=='instant-tex'||value.version!==1)throw new Error('Неизвестный формат документа');return validateDocument(value);}
  if(text.length>2_000_000)throw new Error('Лимит текста — 2 МБ');const assets=Object.create(null),root=await fs.realpath(path.dirname(file));
  const names=[...text.matchAll(/\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}|\\bibliography\{([^}]+)\}/g)].flatMap(m=>m[1]?[m[1]]:m[2].split(',').map(n=>n.trim().replace(/\.bib$/,'')+'.bib'));
  for(const name of new Set(names)){if(!safeName(name))continue;try{const resolved=await fs.realpath(path.join(root,name)),relative=path.relative(root,resolved);if(relative.startsWith('..')||path.isAbsolute(relative))continue;const resource=await readResource(resolved);assets[name]={mime:resource.mime,data:resource.data};}catch{/* Missing resources are diagnosed by preview. */}}
  return validateDocument({text,assets});
}
async function saveDocument(file,value,beforeWrite=async()=>{}){const doc=validateDocument(value);if(/\.itex$/i.test(file)){const text=JSON.stringify({format:'instant-tex',version:1,...doc});await beforeWrite();await fs.writeFile(file,text,'utf8');return;}
  const root=path.dirname(file);for(const [name,a] of Object.entries(doc.assets)){const target=path.resolve(root,name),relative=path.relative(root,target);if(relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Недопустимый путь вложения');await fs.mkdir(path.dirname(target),{recursive:true});const actualRoot=await fs.realpath(root),actualParent=await fs.realpath(path.dirname(target)),actualRelative=path.relative(actualRoot,actualParent);if(actualRelative.startsWith('..')||path.isAbsolute(actualRelative))throw new Error('Папка вложений выходит за каталог документа');try{if((await fs.lstat(target)).isSymbolicLink())throw new Error('Нельзя записать вложение через символическую ссылку');}catch(e){if(e.code!=='ENOENT')throw e;}const bytes=a.mime==='application/x-bibtex'?Buffer.from(a.data,'utf8'):Buffer.from(a.data,'base64');try{const existing=await fs.readFile(target);if(!existing.equals(bytes))throw new Error(`Файл ${name} уже существует с другим содержимым. Сохрани .itex или выбери другую папку.`);}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(target,bytes,{flag:'wx'});}}await beforeWrite();await fs.writeFile(file,doc.text,'utf8');
}
module.exports={validateDocument,readResource,openDocument,saveDocument,safeName,rasterMime};
