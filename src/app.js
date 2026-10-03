import './style.css';
import '@fontsource-variable/jetbrains-mono';
import './interface.css';
import {EditorState,Compartment} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,highlightActiveLineGutter,drawSelection} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab} from '@codemirror/commands';
import {StreamLanguage,syntaxHighlighting,HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import {autocompletion} from '@codemirror/autocomplete';
import {DraftRenderer,example} from './render.js';
import {documentTemplate,startPosition} from './template.js';
import {CommandDictionary,completionSource,completionKeys} from './completion.js';
import {mountIcons,icon} from './icons.js';
import {initAI,previewSelection} from './ai-ui.js';

const $=id=>document.getElementById(id),api=window.instant,renderer=new DraftRenderer();
mountIcons();
let saved=[];try{saved=await api?.loadDictionary()||[];}catch{}
let appearance={editorSize:14,editorWeight:670,previewSize:19,previewZoom:100,theme:'light'};
try{appearance={...appearance,...await api?.loadAppearance()};}catch{}
const dictionary=new CommandDictionary(saved,entries=>api?.saveDictionary(entries).catch(()=>toast('Не удалось сохранить словарь')));
let frame=0,result,zoom=appearance.previewZoom,dirty=false,sourceName='Мой черновик',exporting=false;
let selected=null;
const editorTheme=new Compartment();
function themeExtension(){
  const dark=appearance.theme==='dark';
  return[EditorView.theme({'&':{backgroundColor:dark?'#202725':'#f8faf7',color:dark?'#d0d9cf':'#293b31'},'.cm-content':{caretColor:dark?'#b0dfc1':'#315e48'}},{dark}),syntaxHighlighting(HighlightStyle.define([{tag:tags.keyword,color:dark?'#a1cda9':'#34745a'},{tag:tags.bracket,color:dark?'#d6b582':'#896325'},{tag:tags.number,color:dark?'#b6c2dc':'#596a9c'},{tag:tags.comment,color:dark?'#82998b':'#88958a',fontStyle:'italic'}]))];
}
const tex=StreamLanguage.define({token(stream){
  if(stream.match(/^%.*$/))return 'comment';if(stream.match(/^\\(?:[a-zA-Z]+\*?|.)/))return 'keyword';
  if(stream.match(/^[{}\[\]$&^_]/))return 'bracket';if(stream.match(/^\d+(?:\.\d+)?/))return 'number';stream.next();return null;
}});
const editor=new EditorView({state:EditorState.create({doc:documentTemplate,selection:{anchor:startPosition},extensions:[
  lineNumbers(),highlightActiveLine(),highlightActiveLineGutter(),drawSelection(),history(),EditorView.lineWrapping,tex,
  autocompletion({override:[completionSource(dictionary)],activateOnTyping:true,maxRenderedOptions:100,interactionDelay:0,icons:false}),completionKeys,
  keymap.of([{key:'Mod-s',run:()=>{save();return true;}},{key:'Mod-o',run:()=>{open();return true;}},{key:'Mod-n',run:()=>{newDraft();return true;}},{key:'Mod-Shift-f',run:()=>{toggleFocus();return true;}},...defaultKeymap,...historyKeymap,indentWithTab]),
  editorTheme.of(themeExtension()),
  EditorView.updateListener.of(update=>{
    if(update.docChanged){setDirty(true);scheduleRender();}
    if(update.selectionSet||update.docChanged){updateCursor();queueMicrotask(editorSelection);}
  })
]}),parent:$('editor')});
function updateCursor(){const p=editor.state.selection.main.head,l=editor.state.doc.lineAt(p);$('cursor').textContent=`${l.number}:${p-l.from+1}`;}
function setDirty(value){dirty=value;api?.setDirty(value);document.title=`${dirty?'• ':''}Instant TeX — ${sourceName}`;}
function scheduleRender(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;render();});}
function render(){
  const start=performance.now();result=renderer.render(editor.state.doc.toString());const parent=$('rendered');
  result.blocks.forEach((b,i)=>{
    let el=parent.children[i];if(!el){el=document.createElement('div');parent.append(el);}
    el.className='render-block'+(b.stale?' stale':'');el.dataset.from=b.from;
    if(el.renderHTML!==b.html){el.innerHTML=b.html;el.renderHTML=b.html;}
    el.title=b.stale?'Незаконченный блок; показан последний успешный вид':'';
  });
  while(parent.children.length>result.blocks.length)parent.lastChild.remove();
  if(!result.blocks.length)parent.innerHTML='<div style="color:#a0a9a0">Начни писать…</div>';
  const ms=performance.now()-start;$('render-status').textContent=ms.toFixed(1)+' мс';
  $('issues-toggle').hidden=!result.issues.length;$('issues-toggle').textContent=`${result.issues.length} замечаний`;
  $('issues').replaceChildren(...result.issues.map(issue=>{
    const b=document.createElement('button');b.textContent=`Строка ${editor.state.doc.lineAt(issue.from).number}: ${issue.message}`;
    b.onclick=()=>{editor.dispatch({selection:{anchor:issue.from},scrollIntoView:true});editor.focus();};return b;
  }));
  if(!result.issues.length)$('issues').hidden=true;
  dictionary.observe(editor.state.doc.toString(),!result.issues.length);
  window.instantDebug={editor,renderer,dictionary,get result(){return result;},lastRenderMs:ms};
}
setInterval(()=>dictionary.observe(editor.state.doc.toString(),!result?.issues.length),1000);
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
async function save(){
  if(!api){toast('Сохранение доступно в десктоп-приложении');return;}
  const snapshot=editor.state.doc.toString();
  try{const name=await api.saveText(snapshot);if(name){sourceName=name;setDirty(editor.state.doc.toString()!==snapshot);toast('Текст сохранён');}}catch(e){toast('Не удалось сохранить: '+e.message);}
}
async function canReplace(){return !dirty||(api?api.confirmReplace():confirm('Заменить несохранённый текст?'));}
function replaceDoc(text,name,anchor=0){
  renderer.previous=[];editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:text},selection:{anchor},scrollIntoView:true});sourceName=name;setDirty(false);editor.focus();$('selection-ai').hidden=true;
}
async function newDraft(){if(await canReplace())replaceDoc(documentTemplate,'Мой черновик',startPosition);}
async function open(){
  if(!api){toast('Открытие доступно в десктоп-приложении');return;}if(!await canReplace())return;
  try{const file=await api.openText();if(file)replaceDoc(file.text,file.name);}catch(e){toast('Не удалось открыть: '+e.message);}
}
async function exportDraft(format){
  $('export-options').hidden=true;$('export-toggle').setAttribute('aria-expanded','false');
  if(!api){toast('Экспорт доступен в десктоп-приложении');return;}if(exporting)return;
  if(frame){cancelAnimationFrame(frame);frame=0;}render();
  if(result.issues.length){$('issues').hidden=false;toast('Сначала заверши формулы: экспорт не включает устаревшие блоки.');return;}
  if(!result.blocks.length){toast('Сначала напиши что-нибудь');return;}
  exporting=true;$('export-toggle').disabled=true;
  try{const response=await api.exportDraft({format,html:result.blocks.map(b=>`<div class="render-block">${b.html}</div>`).join('')});if(response)toast(format==='clipboard'?'Картинка скопирована':`Готово: ${response}`);}
  catch(e){toast('Не удалось экспортировать: '+e.message);}finally{exporting=false;$('export-toggle').disabled=false;}
}
function toggleFocus(){$('workspace').classList.toggle('preview-only');}
function applyAppearance(persist=true){
  document.documentElement.dataset.theme=appearance.theme;
  const themeButton=$('theme-toggle');themeButton.innerHTML=icon(appearance.theme==='dark'?'sun':'moon');themeButton.title=appearance.theme==='dark'?'Светлая тема':'Тёмная тема';
  document.documentElement.style.setProperty('--editor-size',appearance.editorSize+'px');
  document.documentElement.style.setProperty('--editor-weight',appearance.editorWeight);
  $('editor-weight').value=appearance.editorWeight;$('editor-weight-label').value=appearance.editorWeight;
  document.documentElement.style.setProperty('--preview-size',appearance.previewSize+'px');
  $('editor-size').value=appearance.editorSize;$('preview-size').value=appearance.previewSize;
  zoom=appearance.previewZoom;$('paper').style.zoom=zoom/100;$('zoom-label').textContent=zoom+'%';
  editor.requestMeasure();
  if(persist)api?.saveAppearance({...appearance}).catch(()=>toast('Не удалось сохранить настройки шрифта'));
}
function setZoom(delta){appearance.previewZoom=Math.max(50,Math.min(250,zoom+delta));applyAppearance();}
function setFontSize(name,value){
  if(!Number.isFinite(value))return;
  appearance[name]=Math.max(name==='editorSize'?9:12,Math.min(40,Math.round(value)));applyAppearance();
}
for(const [id,name] of [['editor-size','editorSize'],['preview-size','previewSize']]){
  $(id).oninput=e=>{if(e.target.value)setFontSize(name,e.target.valueAsNumber);};
  $(id).onchange=()=>applyAppearance(false);
}
$('appearance-toggle').onclick=()=>{const open=$('appearance-options').hidden;$('appearance-options').hidden=!open;$('appearance-toggle').setAttribute('aria-expanded',String(open));};
$('editor-weight').oninput=e=>{appearance.editorWeight=e.target.valueAsNumber;applyAppearance();};
$('appearance-reset').onclick=()=>{appearance={...appearance,editorSize:14,editorWeight:670,previewSize:19,previewZoom:100};applyAppearance();};
$('theme-toggle').onclick=()=>{appearance.theme=appearance.theme==='dark'?'light':'dark';editor.dispatch({effects:editorTheme.reconfigure(themeExtension())});applyAppearance();};
document.addEventListener('click',e=>{if(!e.target.closest('.appearance-menu')){$('appearance-options').hidden=true;$('appearance-toggle').setAttribute('aria-expanded','false');}});
for(const [element,change] of [[$('editor'),direction=>setFontSize('editorSize',appearance.editorSize+direction)],[$('preview-scroll'),direction=>setZoom(direction*10)]]){
  element.addEventListener('wheel',e=>{
    if(!e.ctrlKey||e.deltaY===0)return;
    e.preventDefault();e.stopPropagation();change(e.deltaY<0?1:-1);
  },{passive:false,capture:true});
}
applyAppearance(false);document.fonts.ready.then(()=>editor.requestMeasure());

const aiUI=initAI({api,$,getContext:()=>editor.state.doc.toString(),toast});
function selectionTooltip(selection,rect){
  selected={...selection,rect:{left:rect.left,right:rect.right??rect.left,top:rect.top,bottom:rect.bottom??rect.top}};
  $('selection-ai').hidden=false;$('selection-ai').style.left=Math.max(5,Math.min(innerWidth-100,rect.left))+'px';
  $('selection-ai').style.top=Math.max(38,Math.min(innerHeight-36,rect.top-36))+'px';
}
function editorSelection(){
  const r=editor.state.selection.main;
  if(!r.empty){const rect=editor.coordsAtPos(r.from)||editor.coordsAtPos(r.head);if(rect)selectionTooltip({type:'code',text:editor.state.doc.sliceString(r.from,r.to)},rect);}
  else if(document.activeElement?.closest('.cm-editor'))$('selection-ai').hidden=true;
}
document.addEventListener('pointerup',()=>{
  const selection=window.getSelection();if(selection?.rangeCount&&!selection.isCollapsed){const range=selection.getRangeAt(0);
    if($('paper').contains(range.commonAncestorContainer)&&selection.toString().trim())selectionTooltip(previewSelection(range),range.getBoundingClientRect());
  }
});
$('selection-ai').onpointerdown=e=>e.preventDefault();
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#selection-ai'))$('selection-ai').hidden=true;});
$('selection-ai').onclick=()=>{if(selected)aiUI.open({...selected});$('selection-ai').hidden=true;};
$('save').onclick=save;$('open').onclick=open;$('new').onclick=newDraft;
$('example').onclick=async()=>{if(await canReplace()){replaceDoc(example,'Пример');setDirty(true);}};
$('help').onclick=()=>$('help-dialog').showModal();$('close-help').onclick=()=>$('help-dialog').close();
$('export-toggle').onclick=()=>{const open=$('export-options').hidden;$('export-options').hidden=!open;$('export-toggle').setAttribute('aria-expanded',String(open));};
document.addEventListener('click',e=>{if(!e.target.closest('.export-menu')){$('export-options').hidden=true;$('export-toggle').setAttribute('aria-expanded','false');}});
$('pdf').onclick=()=>exportDraft('pdf');$('png').onclick=()=>exportDraft('png');$('copy-image').onclick=()=>exportDraft('clipboard');
$('zoom-out').onclick=()=>setZoom(-10);$('zoom-in').onclick=()=>setZoom(10);$('focus').onclick=toggleFocus;
$('issues-toggle').onclick=()=>$('issues').hidden=!$('issues').hidden;
$('rendered').ondblclick=e=>{const b=e.target.closest('[data-from]');if(b){editor.dispatch({selection:{anchor:Number(b.dataset.from)},scrollIntoView:true});editor.focus();}};
document.addEventListener('keydown',e=>{
  if(e.key==='F1'){e.preventDefault();$('help-dialog').showModal();}if(e.key==='Escape'){$('export-options').hidden=true;$('selection-ai').hidden=true;$('appearance-options').hidden=true;$('appearance-toggle').setAttribute('aria-expanded','false');}
  if(!(e.ctrlKey||e.metaKey)||e.target.closest('.cm-editor')||e.target.closest('#ai-panel'))return;
  const key=e.key.toLowerCase();if(key==='s'){e.preventDefault();save();}if(key==='o'){e.preventDefault();open();}if(key==='n'){e.preventDefault();newDraft();}if(key==='f'&&e.shiftKey){e.preventDefault();toggleFocus();}
});
const divider=$('divider');divider.onpointerdown=e=>divider.setPointerCapture(e.pointerId);
divider.onpointermove=e=>{if(divider.hasPointerCapture(e.pointerId)){const box=$('workspace').getBoundingClientRect();$('workspace').style.setProperty('--source-width',Math.max(25,Math.min(75,(e.clientX-box.left)/box.width*100))+'%');}};
divider.onpointerup=e=>divider.releasePointerCapture(e.pointerId);
divider.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const current=parseFloat(getComputedStyle($('workspace')).getPropertyValue('--source-width'));$('workspace').style.setProperty('--source-width',Math.max(25,Math.min(75,current+(e.key==='ArrowLeft'?-2:2)))+'%');}};
api?.onSaveRequest(save);render();setDirty(false);updateCursor();editor.focus();
