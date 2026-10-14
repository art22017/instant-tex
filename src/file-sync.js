import {mergeText,resolveText,editorChanges,mergeAssets,sameAssets} from './file-merge.js';
export function initFileSync({api,$,editor,resources,renderer,scheduleRender,setDirty,toast,locked}){
  let watch=null,base=null,pending=null,plan=null,assetPlan=null,applying=false,queued=false,waiting=false;const early=new Map();
  function snapshot(){return{text:editor.state.doc.toString(),assets:{...resources.assets}};}
  function clear(){pending=null;plan=null;assetPlan=null;waiting=false;$('file-sync').hidden=true;$('file-conflicts').close();}
  function bind(doc,connection){clear();base=doc;watch=connection||null;const event=watch&&early.get(watch.id);early.clear();if(event)receive(event);}
  async function detach(){watch=null;base=null;clear();await api?.detachFile();}
  function refreshAssets(assets){if(sameAssets(resources.assets,assets))return;for(const [name,url] of resources.urls){const a=resources.assets[name],b=assets[name];if(!b||a.mime!==b.mime||a.data!==b.data){URL.revokeObjectURL(url);resources.urls.delete(name);}}resources.assets=Object.assign(Object.create(null),assets);renderer.invalidateAssets();scheduleRender();}
  function apply(text,assets){applying=true;try{refreshAssets(assets);if(text!==editor.state.doc.toString())editor.dispatch({changes:editorChanges(editor.state.doc.toString(),text)});base={text:pending.text,assets:pending.assets};watch.revision=pending.revision;setDirty(text!==base.text||!sameAssets(assets,base.assets));clear();}finally{applying=false;}}
  function recalculate(){if(!pending||!base||applying)return;if(locked()){waiting=true;show('Файл изменился извне. Объединение — после проверки правок AI.',false);return;}waiting=false;const local=snapshot();plan=mergeText(base.text,local.text,pending.text);assetPlan=mergeAssets(base.assets,local.assets,pending.assets);if(!plan.conflicts.length&&!assetPlan.conflicts.length){apply(plan.text,assetPlan.assets);return;}show('Есть пересекающиеся правки. Обе версии сохранены.',true);if($('file-conflicts').open)draw();}
  function show(message,review){$('file-sync').hidden=false;$('file-sync-message').textContent=message;$('file-sync-review').hidden=!review;}
  function choice(name,local,remote,isAsset=false){const section=document.createElement('section');section.className='file-conflict';const title=document.createElement('strong');title.textContent=name;section.append(title);const grid=document.createElement('div');grid.className='file-conflict-versions';
    for(const [value,label,text] of [['local','В редакторе',local],['remote','На диске',remote]]){const l=document.createElement('label'),radio=document.createElement('input');radio.type='radio';radio.name=name;radio.value=value;radio.checked=value==='local';l.append(radio,label);const pre=document.createElement('pre');pre.textContent=isAsset?(text?'Изменённое вложение':'Вложение удалено'):text;l.append(pre);grid.append(l);}section.append(grid);
    if(!isAsset){const l=document.createElement('label'),radio=document.createElement('input');radio.type='radio';radio.name=name;radio.value='both';l.append(radio,'Оставить оба: сначала текст редактора, затем текст с диска');section.append(l);}return section;
  }
  function draw(){const items=$('file-conflict-items');items.replaceChildren();plan.conflicts.forEach((p,i)=>items.append(choice('Фрагмент '+(i+1),p.local,p.remote)));assetPlan.conflicts.forEach(p=>items.append(choice(p.name,p.local,p.remote,true)));}
  $('file-sync-review').onclick=()=>{recalculate();if(pending&&plan){draw();$('file-conflicts').showModal();}};
  $('file-conflicts-close').onclick=()=>$('file-conflicts').close();
  $('file-conflicts-apply').onclick=()=>{if(!pending||!plan||locked())return;const selected=name=>[...$('file-conflict-items').querySelectorAll('input:checked')].find(el=>el.name===name)?.value;const choices=plan.conflicts.map((_,i)=>selected('Фрагмент '+(i+1)));const assets={...assetPlan.assets};for(const p of assetPlan.conflicts){const value=selected(p.name)==='remote'?p.remote:p.local;if(value)assets[p.name]=value;else delete assets[p.name];}apply(resolveText(plan,choices),assets);};
  function receive(event){if(!watch||event.id!==watch.id){early.set(event.id,event);if(early.size>8)early.delete(early.keys().next().value);return;}if(event.type==='error'){if(!pending)show(event.message,false);return;}if(event.type==='recovered'){if(!pending)$('file-sync').hidden=true;return;}if(event.revision===watch.revision)return;pending=event;recalculate();}
  api?.onFileEvent(receive);
  // No per-keystroke diff or IPC. Only a queued external conflict is reconsidered.
  function changed(){if(pending&&waiting&&!applying&&!queued&&!locked()){queued=true;queueMicrotask(()=>{queued=false;recalculate();});}}
  return{bind,detach,changed,get revision(){return watch?.revision;},get blocked(){return!!pending;},get pending(){return pending;}};
}
