import test from 'node:test';
import assert from 'node:assert/strict';
import {DraftRenderer} from '../src/render.js';
import {parseBibtex} from '../src/tex-structure.js';
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
import fs from 'node:fs';
const lab=fs.readFileSync(new URL('../examples/lab.tex',import.meta.url),'utf8');
test('lab supports images, captions, nested lists, tables, bibliography and forward references',()=>{
  const r=new DraftRenderer({resolveImage:name=>name==='plot.png'?image:null}).render(lab);assert.deepEqual(r.issues,[]);
  const html=r.blocks.map(b=>b.html).join('');assert.match(html,/<img class="tex-image"/);assert.match(html,/width:80%/);assert.match(html,/Рисунок 1/);assert.match(html,/Таблица 1/);assert.match(html,/colspan="2"/);assert.match(html,/<ol class="tex-list">/);assert.match(html,/<ul class="tex-list">/);assert.match(html,/tex-equation-number">\(3\)/);assert.doesNotMatch(html,/tex-equation-number">\(4\)/);assert.match(html,/>2\.1<\/a>/);assert.match(html,/Список литературы/);assert.doesNotMatch(html,/\?\?/);
});
test('renumbering propagates to earlier references and unchanged equations reuse KaTeX',()=>{
  const renderer=new DraftRenderer();const source=String.raw`См. \eqref{e}.
\begin{equation}x=1\label{e}\end{equation}`;
  const a=renderer.render(source);assert.deepEqual(a.issues,[]);const size=renderer.mathCache.size;
  renderer.render(source.replace('См.','Смотри'));assert.equal(renderer.mathCache.size,size);
  const b=renderer.render(source.replace('\\begin{equation}',String.raw`\begin{equation}y=2\end{equation}\begin{equation}`));assert.match(b.blocks[0].html,/>\(2\)<\/a>/);
});
test('table borders follow column rules and horizontal commands; inline section labels work',()=>{
  const renderer=new DraftRenderer();
  const plain=renderer.render(String.raw`\begin{tabular}{cc}a&b\end{tabular}`);assert.deepEqual(plain.issues,[]);assert.doesNotMatch(plain.blocks[0].html,/border-/);
  const ruled=renderer.render(String.raw`\begin{tabular}{|cc|}\toprule a&b\\\cline{2-2}c&d\\\bottomrule\end{tabular}`);assert.deepEqual(ruled.issues,[]);assert.match(ruled.blocks[0].html,/border-top:2px/);assert.match(ruled.blocks[0].html,/border-bottom:2px/);assert.match(ruled.blocks[0].html,/border-right:1px/);
  const section=renderer.render(String.raw`\section{Раздел}\label{sec:test}
См. \ref{sec:test}.`);assert.deepEqual(section.issues,[]);assert.match(section.blocks[1].html,/>1<\/a>/);
});
test('BibTeX nested braces, multiple citations and imported bibliography',()=>{
  const bib='@book{a, author={Иванов and Петров}, title={Основы {физики}}, year="2024", publisher={Издательство}}\n@article{b, title={Статья}, journal={Журнал}, year=2025}';assert.equal(parseBibtex(bib).length,2);
  const r=new DraftRenderer({getBibliography:n=>n==='refs.bib'?bib:null}).render(String.raw`См. \cite{a,b}.
\bibliographystyle{plain}
\bibliography{refs}`);assert.deepEqual(r.issues,[]);assert.match(r.blocks.at(-1).html,/Основы физики/);assert.match(r.blocks[0].html,/>2<\/a>/);
});
test('cached bibliography refreshes when resources change',()=>{
  let text='@book{a,title={Первое издание}}';const renderer=new DraftRenderer({getBibliography:()=>text});const source=String.raw`\bibliography{refs}`;
  assert.match(renderer.render(source).blocks[0].html,/Первое издание/);
  text='@book{a,title={Новое издание}}';renderer.invalidateAssets();
  const refreshed=renderer.render(source);assert.deepEqual(refreshed.issues,[]);assert.match(refreshed.blocks[0].html,/Новое издание/);assert.doesNotMatch(refreshed.blocks[0].html,/Первое издание/);
});
test('draft errors retain valid structural blocks; URLs and image attributes are not executed',()=>{
  const renderer=new DraftRenderer();const good=renderer.render(String.raw`\begin{tabular}{cc}a&b\\c&d\end{tabular}`).blocks[0].html;
  const bad=renderer.render(String.raw`\begin{tabular}{cc}a&b`);assert.ok(bad.issues.length);assert.equal(bad.blocks[0].html,good);
  const unsafe=new DraftRenderer({resolveImage:()=> 'https://example.com/image.png'}).render(String.raw`\includegraphics{evil}`);assert.ok(unsafe.issues.length);assert.ok(!unsafe.blocks[0].html.includes('src="https:'));
});
test('warm large lab render stays cached and image resolver is not called for every keystroke',()=>{
  let resolutions=0;const renderer=new DraftRenderer({resolveImage:()=>{resolutions++;return image;}});const source=lab+('\n\n'+String.raw`\[\frac{x^2+1}{\sqrt{x+2}}\]`).repeat(150);
  renderer.render(source);const samples=[];for(let i=0;i<15;i++){const r=renderer.render(source+'\n\nЧерновик '+i);assert.deepEqual(r.issues,[]);samples.push(r.ms);}samples.sort((a,b)=>a-b);assert.equal(resolutions,1);assert.ok(samples[7]<80,`warm median ${samples[7].toFixed(1)}ms`);
});
