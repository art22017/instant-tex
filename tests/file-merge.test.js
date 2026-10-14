import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeText,resolveText,mergeAssets,editorChanges} from '../src/file-merge.js';
test('independent edits, appended local work and same-line edits survive',()=>{
  assert.equal(mergeText('a\nb\nc\n','a\nb\nc\nlocal\n','A\nb\nc\n').text,'A\nb\nc\nlocal\n');
  assert.equal(mergeText('x=1; y=2','x=3; y=2','x=1; y=4').text,'x=3; y=4');
  assert.equal(mergeText('abc','abc!','Abc').text,'Abc!');
  assert.equal(mergeText('one\ntwo\n','ONE\ntwo\n','ONE\ntwo\n').text,'ONE\ntwo\n');
  const plan=mergeText('Первый\nВторой\nТретий\n','Первый\nВторой\nМоя версия\nМой новый текст\n','Первый\nВторой\nВнешняя версия\n');assert.equal(resolveText(plan,['remote']),'Первый\nВторой\nВнешняя версия\nМой новый текст\n');
});
test('only overlaps require a decision; all other changes remain',()=>{
  const plan=mergeText('a\nb\nc\n','a\nlocal\nc\nappend\n','A\nremote\nc\n');
  assert.equal(plan.conflicts.length,1);assert.equal(resolveText(plan,['remote']),'A\nremote\nc\nappend\n');
  assert.equal(resolveText(plan,['local']),'A\nlocal\nc\nappend\n');
  assert.equal(resolveText(plan,['both']),'A\nlocal\nremote\nc\nappend\n');
  assert.equal(mergeText('abc','axc','ayc').conflicts.length,1);
  assert.equal(mergeText('x','xA','xB').conflicts.length,1);
});
test('editor changes reconstruct text and preserve untouched positions',()=>{
  const before='a\nb\nc\n',after='A\nb\nc\nnew\n',changes=editorChanges(before,after);let text=before;for(const c of changes.toReversed())text=text.slice(0,c.from)+c.insert+text.slice(c.to);assert.equal(text,after);assert.equal(changes.length,2);
});
test('asset merge preserves local imports and exposes same-image collisions',()=>{
  const a={mime:'image/png',data:'A'},b={mime:'image/png',data:'B'},c={mime:'image/png',data:'C'};
  const result=mergeAssets({img:a},{img:b,new:a},{img:c,remote:a});assert.equal(result.conflicts.length,1);assert.deepEqual({...result.assets},{img:b,new:a,remote:a});
  assert.equal(mergeAssets({img:a},{img:a},{}).assets.img,undefined);
});
test('disjoint changes across hundreds of lines merge without conflict',()=>{const lines=Array.from({length:500},(_,i)=>`line${i}\n`),base=lines.join(''),l=[...lines],r=[...lines];for(let i=0;i<500;i+=4)l[i]='local'+i+'\n';for(let i=2;i<500;i+=4)r[i]='remote'+i+'\n';const merged=mergeText(base,l.join(''),r.join(''));assert.equal(merged.conflicts.length,0);assert.ok(merged.text.includes('local496\nline497\nremote498\n'));});
