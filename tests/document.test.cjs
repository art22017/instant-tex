const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {validateDocument,saveDocument,openDocument}=require('../electron/document.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
test('images and bibliography survive both self-contained and ordinary TeX saves',async()=>{
  const base=path.resolve('test-results'),root=await fs.mkdtemp(path.join(base,'document-'));const doc={text:'\\includegraphics{plot.png}\n\\bibliography{refs}',assets:{'plot.png':{mime:'image/png',data:png},'refs.bib':{mime:'application/x-bibtex',data:'@book{key,title={Физика}}'}}};
  try{for(const ext of ['itex','tex']){const file=path.join(root,'lab.'+ext);await saveDocument(file,doc);const result=await openDocument(file);assert.equal(result.text,doc.text);assert.deepEqual({...result.assets},doc.assets);}assert.throws(()=>validateDocument({...doc,assets:{'../escape.png':doc.assets['plot.png']}}),/вложение/);assert.throws(()=>validateDocument({...doc,assets:{'evil.png':{mime:'image/png',data:'aGVsbG8='}}}),/формат/);}
  finally{assert.equal(path.dirname(root),base);for(const name of await fs.readdir(root))await fs.unlink(path.join(root,name));await fs.rmdir(root);}
});
test('save rechecks disk after writing attachments and before replacing document',async()=>{
  const base=path.resolve('test-results'),root=await fs.mkdtemp(path.join(base,'document-'));
  try{for(const ext of ['tex','itex']){const file=path.join(root,'guard.'+ext);await fs.writeFile(file,'external version');let checked=false;await assert.rejects(saveDocument(file,{text:'local version',assets:{'guard.png':{mime:'image/png',data:png}}},async()=>{checked=true;if(ext==='tex')assert.equal((await fs.stat(path.join(root,'guard.png'))).isFile(),true);throw new Error('Disk changed');}),/Disk changed/);assert.equal(checked,true);assert.equal(await fs.readFile(file,'utf8'),'external version');}}
  finally{assert.equal(path.dirname(root),base);for(const name of await fs.readdir(root))await fs.unlink(path.join(root,name));await fs.rmdir(root);}
});
