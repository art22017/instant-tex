import {Prec,StateEffect,StateField} from '@codemirror/state';
import {Decoration,EditorView,ViewPlugin,WidgetType,keymap} from '@codemirror/view';
import {completionStatus,closeCompletion} from '@codemirror/autocomplete';
import './local-autocomplete.css';

const showGhost=StateEffect.define();
function removeRepeatedClosers(text,suffix){
  const suffixClosers=new Set([...suffix.matchAll(/\\end\{[^}\r\n]+\}/g)].map(match=>match[0]));
  for(const match of text.matchAll(/\\end\{[^}\r\n]+\}/g)){
    if(suffixClosers.has(match[0]))return text.slice(0,match.index).replace(/[\t \r\n]+$/,'');
  }
  return text;
}
class Ghost extends WidgetType {
  constructor(text,middle=false){super();this.text=text;this.middle=middle;}
  eq(other){return other.text===this.text&&other.middle===this.middle;}
  toDOM(view){
    const span=document.createElement('span');
    span.className='cm-local-ghost'+(this.middle?' cm-local-ghost-middle':'');
    span.textContent=this.text;span.setAttribute('aria-hidden','true');span.contentEditable='false';
    if(this.middle&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const single=!this.text.includes('\n');
      if(single)span.classList.add('cm-local-ghost-single');
      span.ghostFrame=requestAnimationFrame(()=>{
        if(!span.isConnected)return;
        const width=span.getBoundingClientRect().width;
        span.ghostAnimation=span.animate(single?[{width:'0px',opacity:0},{width:`${width}px`,opacity:.8}]:[{opacity:0},{opacity:.8}],{duration:160,easing:'ease-out'});
        span.ghostAnimation.finished.then(()=>{if(span.isConnected)view.requestMeasure();}).catch(()=>{});
      });
    }
    return span;
  }
  destroy(dom){cancelAnimationFrame(dom.ghostFrame);dom.ghostAnimation?.cancel();}
  ignoreEvent(){return true;}
}
export const ghostField=StateField.define({
  create:()=>null,
  update(value,tr){
    if(tr.docChanged||tr.selection)value=null;
    for(const effect of tr.effects)if(effect.is(showGhost))value=effect.value;
    return value;
  },
  provide:field=>EditorView.decorations.from(field,value=>value?Decoration.set([Decoration.widget({widget:new Ghost(value.text,value.middle),side:1}).range(value.pos)]):Decoration.none),
});

export function localAutocomplete({api,toast}){
  if(api?.platform!=='win32')return{extension:[],mount(){}};
  let view,locked=()=>false,ready=false,sequence=0,timer,lastEpoch,lastPhase,busy=false,middleEnabled=false;
  const $=id=>document.getElementById(id);
  function cancel(){clearTimeout(timer);sequence++;api.cancelAutocomplete().catch(()=>{});}
  function clear(){cancel();if(view&&!view.destroyed&&view.state.field(ghostField))view.dispatch({effects:showGhost.of(null)});}
  function inMiddle(){const pos=view.state.selection.main.head;return !!view.state.doc.sliceString(pos,view.state.doc.lineAt(pos).to).trim();}
  function allowed(){return ready&&!busy&&!locked()&&view.hasFocus&&view.state.selection.main.empty&&!view.composing&&(middleEnabled||!inMiddle());}
  async function request(){
    clearTimeout(timer);
    if(!allowed()||completionStatus(view.state))return;
    const id=++sequence,doc=view.state.doc,pos=view.state.selection.main.head;
    const prefix=doc.sliceString(Math.max(0,pos-5000),pos),suffix=doc.sliceString(pos,Math.min(doc.length,pos+1500));
    if(prefix.trim().length<3)return;
    $('autocomplete-detail').textContent='Готовлю подсказку…';
    try{
      const result=await api.completeLocally({prefix,suffix});
      if(id!==sequence||view.destroyed||view.state.doc!==doc||view.state.selection.main.head!==pos||!allowed()||completionStatus(view.state))return;
      const suggestion=removeRepeatedClosers(result.text||'',suffix);
      if(suggestion)view.dispatch({effects:showGhost.of({pos,text:suggestion,middle:inMiddle()})});
      $('autocomplete-detail').textContent=suggestion?`Подсказка за ${result.elapsedMs} мс${result.tokensPerSecond?` · ${result.tokensPerSecond.toFixed(0)} ток/с`:''}`:'Продолжения нет — попробуй дописать строку';
    }catch(error){if(id===sequence)$('autocomplete-detail').textContent=error.message;}
  }
  function schedule(){cancel();if(allowed())timer=setTimeout(request,350);}
  const extension=[ghostField,Prec.highest(keymap.of([
    {key:'Tab',run:editor=>{
      const ghost=editor.state.field(ghostField);
      if(!ghost||!allowed()||completionStatus(editor.state))return false;
      cancel();editor.dispatch({changes:{from:ghost.pos,insert:ghost.text},selection:{anchor:ghost.pos+ghost.text.length},userEvent:'input.complete'});return true;
    }},
    {key:'Escape',run:editor=>{const visible=!!editor.state.field(ghostField);clear();return visible;}},
    {key:'Alt-\\',run:()=>{if(!ready)return false;closeCompletion(view);clear();request();return true;}},
  ])),ViewPlugin.fromClass(class{
    update(update){if(update.docChanged||update.selectionSet)schedule();}
    destroy(){cancel();}
  }),EditorView.domEventHandlers({blur:()=>{clear();return false;},compositionstart:()=>{clear();return false;},compositionend:()=>{schedule();return false;}})];
  function paint(state){
    const enabled=state.phase==='on';
    if(state.epoch!==lastEpoch||state.phase!==lastPhase||middleEnabled!==!!state.inlineMiddle){clear();lastEpoch=state.epoch;lastPhase=state.phase;}
    middleEnabled=!!state.inlineMiddle;
    ready=enabled;
    const loading=state.phase==='starting'||state.phase==='stopping',running=loading||enabled||!!state.pid;
    $('autocomplete-device').value=state.device;
    $('autocomplete-device').disabled=running||busy;
    if(document.activeElement!==$('autocomplete-length'))$('autocomplete-length').value=state.maxTokens;
    $('autocomplete-length').disabled=loading||busy;
    $('autocomplete-middle').checked=middleEnabled;
    $('autocomplete-middle').disabled=loading||busy;
    $('autocomplete-start').disabled=running||busy;
    $('autocomplete-stop').disabled=!running||state.phase==='stopping'||busy;
    const labels={off:'Модель выключена',starting:'Включаю модель…',stopping:'Останавливаю модель…',on:`Включено · ${state.deviceName}`,error:'Не удалось запустить модель'};
    $('autocomplete-state').textContent=state.error||labels[state.phase];
    $('autocomplete-state').classList.toggle('error',!!state.error);
    $('autocomplete-toggle').classList.toggle('active',enabled);
    $('autocomplete-toggle').title=labels[state.phase];
    $('autocomplete-path').textContent=state.root;
    $('autocomplete-load-time').textContent=enabled&&state.loadMs!=null?`Запуск занял ${(state.loadMs/1000).toFixed(2)} с`:'';
  }
  async function refresh(){if(busy)return;try{paint(await api.autocompleteStatus());}catch(error){ready=false;clear();$('autocomplete-state').textContent=error.message;}}
  async function act(fn){
    if(busy)return;busy=true;ready=false;clear();
    $('autocomplete-device').disabled=true;$('autocomplete-length').disabled=true;$('autocomplete-start').disabled=true;$('autocomplete-stop').disabled=true;
    try{await fn();}catch(error){toast(error.message);}finally{busy=false;await refresh();}
  }
  return{extension,mount(editor,options={}){
    view=editor;locked=options.locked||locked;
    $('autocomplete-toggle').hidden=false;
    $('autocomplete-toggle').onclick=()=>{$('autocomplete-dialog').showModal();refresh();};
    $('autocomplete-close').onclick=()=>$('autocomplete-dialog').close();
    $('autocomplete-dialog').addEventListener('close',()=>editor.focus());
    const saveConfig=()=>{const value={device:$('autocomplete-device').value,maxTokens:Number($('autocomplete-length').value),inlineMiddle:$('autocomplete-middle').checked};act(()=>api.configureAutocomplete(value));};
    $('autocomplete-device').onchange=saveConfig;
    $('autocomplete-length').onchange=saveConfig;
    $('autocomplete-middle').onchange=saveConfig;
    $('autocomplete-start').onclick=()=>{
      // Starting is asynchronous so polling and Stop remain available during NPU compilation.
      ready=false;clear();$('autocomplete-state').textContent='Включаю модель…';
      $('autocomplete-start').disabled=true;$('autocomplete-device').disabled=true;
      api.startAutocomplete().catch(error=>toast(error.message)).finally(refresh);
      setTimeout(refresh,50);
    };
    $('autocomplete-stop').onclick=()=>act(()=>api.stopAutocomplete());
    $('autocomplete-folder').onclick=()=>api.openAutocompleteFolder().catch(error=>toast(error.message));
    refresh();const poll=setInterval(refresh,1000);window.addEventListener('beforeunload',()=>{clearInterval(poll);cancel();},{once:true});
  }};
}
