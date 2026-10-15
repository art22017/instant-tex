import test from 'node:test';
import assert from 'node:assert/strict';
import {builtins,CommandDictionary,extractCommands,insideDisplay,insideMatrix,insideTable,matrixColumnSpace,smartEnter,rankedCommands} from '../src/completion.js';
import {DraftRenderer} from '../src/render.js';
import {documentTemplate,startPosition} from '../src/template.js';

test('new document includes Russian preamble and a ready, valid gather block',()=>{
  assert.ok(documentTemplate.includes('\\usepackage[russian]{babel}'));
  assert.ok(documentTemplate.slice(0,startPosition).includes('\\begin{gather*}'));
  assert.equal(new DraftRenderer().render(documentTemplate).issues.length,0);
});
test('frac has two independent empty tab stops, gather inserts matching end',()=>{
  assert.equal(builtins.find(e=>e.name==='\\frac').template,'\\frac{${}}{${}}');
  const gather=builtins.find(e=>e.name==='\\begin{gather}');
  assert.ok(gather.template.includes('\\end{gather}'));
});
test('document vocabulary detects balanced argument counts',()=>{
  const entries=extractCommands(String.raw`\mycommand{a{b}}{c} \begin{gather}x\end{gather}`);
  assert.equal(entries.find(e=>e.name==='\\mycommand').template,'\\mycommand{${}}{${}}');
  assert.ok(entries.find(e=>e.name==='\\begin{gather}').template.includes('\\end{gather}'));
});
test('learning needs a continuous minute without errors and survives edited documents',()=>{
  let now=0,persisted;
  const dict=new CommandDictionary([],entries=>persisted=entries,()=>now);
  const source=String.raw`\[\newthing{x}{y}\]`;
  dict.observe(source,true);now=59999;dict.observe(source,true);assert.equal(dict.saved.size,0);
  now=60000;dict.observe(source,true);assert.ok(persisted.some(e=>e.name==='\\newthing'));
  const broken=new CommandDictionary([],()=>{},()=>now);broken.observe(source,true);now+=60000;broken.observe(source,false);broken.observe(source,true);assert.equal(broken.saved.size,0);
  dict.used(builtins.find(e=>e.name==='\\frac'));dict.used(builtins.find(e=>e.name==='\\frac'));
  assert.equal(dict.options('')[0].name,'\\frac');
});
test('math context distinguishes display delimiters, gather and plain text',()=>{
  for(const s of ['\\[x','$$x','\\begin{gather}x','\\begin{gather*}x'])assert.equal(insideDisplay(s,s.length),true);
  for(const s of ['\\[x\\]','$$x$$','\\(x','Текст'])assert.equal(insideDisplay(s,s.length),false);
});
test('matrix spaces after numbers become column separators only inside matrix rows',()=>{
  for(const name of ['matrix','pmatrix','bmatrix','Bmatrix','vmatrix','Vmatrix','smallmatrix','array']){
    const source=`\\begin{${name}}\n2`;
    assert.equal(insideMatrix(source,source.length),true,name);
    let transaction;
    const view={state:{selection:{main:{empty:true,head:source.length}},doc:{toString:()=>source,lineAt:()=>({from:source.lastIndexOf('\n')+1,text:'2'})}},dispatch:t=>transaction=t};
    assert.equal(matrixColumnSpace(view),true,name);
    assert.equal(transaction.changes.insert,' & ',name);
    assert.equal(transaction.selection.anchor,source.length+3,name);
  }
  const closed='\\begin{pmatrix}\n2\\end{pmatrix}';
  assert.equal(insideMatrix(closed,closed.length),false);
  for(const source of ['\\begin{gather}\n2','Текст 2','\\begin{pmatrix}\nx','\\begin{pmatrix}\n% comment 2','% \\begin{pmatrix}\n2']){
    const head=source.length,line=source.slice(source.lastIndexOf('\n')+1);let transaction;
    const view={state:{selection:{main:{empty:true,head}},doc:{toString:()=>source,lineAt:()=>({from:source.lastIndexOf('\n')+1,text:line})}},dispatch:t=>transaction=t};
    assert.equal(matrixColumnSpace(view),false,source);
    assert.equal(transaction,undefined,source);
  }
});
test('table spaces after numbers become column separators inside tabular rows',()=>{
  for(const name of ['tabular','tabular*','tabularx','longtable']){
    const source=`\\begin{${name}}{cc}\n2`;
    assert.equal(insideTable(source,source.length),true,name);
    let transaction;
    const view={state:{selection:{main:{empty:true,head:source.length}},doc:{toString:()=>source,lineAt:()=>({from:source.lastIndexOf('\n')+1,text:'2'})}},dispatch:t=>transaction=t};
    assert.equal(matrixColumnSpace(view),true,name);
    assert.equal(transaction.changes.insert,' & ',name);
    assert.equal(transaction.selection.anchor,source.length+3,name);
  }
  const closed='\\begin{tabular}{cc}\n2\\end{tabular}';
  assert.equal(insideTable(closed,closed.length),false);
  for(const source of ['\\begin{table}\n2','\\begin{tabular}{cc}\n% 2','\\begin{tabular}{cc}\nx']){
    const head=source.length,line=source.slice(source.lastIndexOf('\n')+1);let transaction;
    const view={state:{selection:{main:{empty:true,head}},doc:{toString:()=>source,lineAt:()=>({from:source.lastIndexOf('\n')+1,text:line})}},dispatch:t=>transaction=t};
    assert.equal(matrixColumnSpace(view),false,source);
    assert.equal(transaction,undefined,source);
  }
});
test('Environment name opens begin first regardless of closing frequency; explicit end stays end',()=>{
  const items=builtins.map(e=>({...e,uses:e.name==='\\end{pmatrix}'?100000:0}));
  const options=rankedCommands(items,'\\pma');assert.equal(options[0].name,'\\begin{pmatrix}');assert.equal(options.at(-1).name,'\\end{pmatrix}');
  assert.equal(rankedCommands(items,'\\end{pma')[0].name,'\\end{pmatrix}');
  assert.equal(rankedCommands(items,'\\begin{pma')[0].name,'\\begin{pmatrix}');
  assert.ok(rankedCommands(items,'\\beg').every(e=>e.name.startsWith('\\begin{')));
  assert.equal(rankedCommands(items,'\\fr')[0].name,'\\frac');
});
test('smart Enter adds one line break, not duplicates or breaks after opening delimiters',()=>{
  function apply(source){let transaction;const head=source.length,from=source.lastIndexOf('\n')+1;const view={state:{selection:{main:{empty:true,head}},doc:{toString:()=>source,lineAt:()=>({from,text:source.slice(from)})},field:()=>null},dispatch:t=>transaction=t};smartEnter(view);return transaction?.changes.insert;}
  assert.equal(apply('\\[\nx=1'),' \\\\\n');
  assert.equal(apply('$$\nx=1 \\\\'),'\n');
  assert.equal(apply('\\begin{gather}'),'\n');
});
