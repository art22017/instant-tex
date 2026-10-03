import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftRenderer,parse,example} from '../src/render.js';

test('Russian solution: boxed, inline math and align without a TeX distribution',()=>{
  const result=new DraftRenderer().render(example);
  assert.deepEqual(result.issues,[]);
  assert.ok(result.blocks.some(b=>b.html.includes('Непрерывность')));
  assert.ok(result.blocks.some(b=>b.html.includes('fbox')));
  assert.ok(result.blocks.some(b=>b.html.includes('mtable')));
});
test('complete Overleaf input ignores preamble but preserves editor offsets',()=>{
  const source=String.raw`\documentclass{article}
\usepackage[russian]{babel}
\begin{document}
Русский \(x\).
\[\boxed{x=1}\]
\end{document}`;
  const r=new DraftRenderer().render(source);
  assert.equal(r.issues.length,0);
  assert.equal(r.blocks.length,2);
  assert.equal(r.blocks[1].from,source.indexOf('\\['));
});
test('unfinished/invalid math retains last valid block until fixed',()=>{
  const renderer=new DraftRenderer();
  const original=renderer.render(String.raw`\[\frac{1}{2}\]`).blocks[0].html;
  const broken=renderer.render(String.raw`\[\frac{1}{`);
  assert.equal(broken.issues.length,1);
  assert.equal(broken.blocks[0].html,original);
  assert.equal(broken.blocks[0].stale,true);
  assert.equal(renderer.render(String.raw`\[\frac{1}{3}\]`).issues.length,0);
});
test('untrusted HTML is text and KaTeX does not execute URLs',()=>{
  const r=new DraftRenderer().render('<img src=x onerror=alert(1)>');
  assert.ok(r.blocks[0].html.includes('&lt;img'));
  const dangerous=new DraftRenderer().render(String.raw`\[\href{javascript:alert(1)}{X}\]`);
  assert.ok(!dangerous.blocks[0].html.includes('href="javascript:'));
});
test('mixed delimiters, comments, environments and multiline paragraphs',()=>{
  const r=new DraftRenderer().render(String.raw`# Ответ
Русский $x_0$ и \(\text{предел}\). % COMMENT_SHOULD_BE_REMOVED

$$\begin{pmatrix}1&0\\0&1\end{pmatrix}$$
\begin{equation}x=2\end{equation}
\begin{gather*}a=b\\c=d\end{gather*}`);
  assert.equal(r.issues.length,0);
  assert.equal(r.blocks.length,5);
  assert.ok(!r.blocks[1].html.includes('COMMENT_SHOULD_BE_REMOVED'));
});
test('unsupported draft features are diagnosed rather than silently omitted',()=>{
  const r=new DraftRenderer().render(String.raw`\includegraphics{a.png}`);
  assert.equal(r.issues.length,1);
});
test('escaped dollar and percent stay literal',()=>{
  const r=new DraftRenderer().render(String.raw`Цена: 10\$; 50\%.`);
  assert.equal(r.issues.length,0);
  assert.ok(r.blocks[0].html.includes('10$'));
  assert.ok(r.blocks[0].html.includes('50%'));
});
test('position offsets include blank lines',()=>{
  const blocks=parse('Первая\n\n\nВторая\n\n\\[x\\]');
  assert.equal(blocks[1].from,9);
  assert.equal(blocks[2].from,17);
});
