import {initModelPicker} from './model-picker.js';
import DOMPurify from 'dompurify';
import {renderMarkdown} from './markdown.js';
import {icon} from './icons.js';
import {initWorkSettings} from './work-settings.js';
import {traceEvent,finishTrace,renderTrace,renderWorkSummary} from './agent-traces.js';
import {initChatScroll} from './chat-scroll.js';

const safe=html=>DOMPurify.sanitize(html,{FORBID_TAGS:['img','iframe','video','audio','style'],FORBID_ATTR:['id']});
const short=text=>text.length>420?text.slice(0,420)+'…':text;
export function previewSelection(range){
  const container=document.createElement('div');container.append(range.cloneContents());
  const closest=range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement;
  const math=closest.closest('.katex');
  if(math){container.replaceChildren(math.cloneNode(true));}
  const plain=container.cloneNode(true);
  plain.querySelectorAll('.katex').forEach(el=>{const tex=el.querySelector('annotation')?.textContent;el.replaceWith(document.createTextNode(tex?'\\('+tex+'\\)':el.textContent));});
  plain.querySelectorAll('.katex-mathml').forEach(el=>el.remove());
  const text=plain.textContent.trim();
  let budget=420;
  const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement.closest('.katex-mathml')?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(node.textContent.length<=budget){budget-=node.textContent.length;continue;}
    const cut=document.createRange(),formula=node.parentElement.closest('.katex');
    if(formula)cut.setStartAfter(formula);else cut.setStart(node,budget);
    cut.setEnd(container,container.childNodes.length);cut.deleteContents();container.append('…');break;
  }
  let html=safe(container.innerHTML);
  if(html.length>24000){container.textContent=short(text);html=container.innerHTML;}
  return{type:'preview',text,html};
}

export function initAI({api,$,getContext,getBibliographies=()=>({}),toast,workReview}){
  let chats=[],active=null,anchor=null,frame=0,position=null;
  let mode='ask',workEnabled=false;
  const modelPicker=initModelPicker({$,api,toast});
  const jobs=new Map();
  const chatScroll=initChatScroll($('ai-answer'));
  function updateModes(){const running=[...jobs.values()].some(j=>j.chat===active&&j.running!==false);$('ai-ask-mode').setAttribute('aria-selected',String(mode==='ask'));$('ai-work-mode').setAttribute('aria-selected',String(mode==='work'));$('ai-work-mode').disabled=!workEnabled||running;$('ai-ask-mode').disabled=running;modelPicker.disable(running);$('ai-work-mode').title=workEnabled?'Редактировать с Pi':'Включи Work в настройках';}
  function setMode(value){mode=value==='work'&&workEnabled?'work':'ask';if(active)active.mode=mode;updateModes();persist();}
  const workSettings=initWorkSettings({api,$,toast,onChange:value=>{workEnabled=value;if(!value){mode='ask';if(active)active.mode='ask';}updateModes();}});
  $('ai-ask-mode').onclick=()=>setMode('ask');$('ai-work-mode').onclick=()=>setMode('work');
  const ready=api?.loadChats().then(value=>{chats=value||[];}).catch(()=>toast('Не удалось загрузить историю чатов'))||Promise.resolve();
  const persist=()=>api?.saveChats(chats.filter(c=>c.turns.length).slice(0,60)).catch(()=>toast('Не удалось сохранить историю'));
  function locate(){
    const panel=$('ai-panel');
    panel.classList.toggle('selection-chat',!!anchor);
    panel.style.left='';panel.style.top='';panel.style.right='';panel.style.bottom='';
    if(position){place(position.x,position.y);return;}
    if(!anchor)return;
    const width=panel.offsetWidth,height=panel.offsetHeight,gap=12;
    let x,y;
    if(anchor.right+gap+width<=innerWidth-12){x=anchor.right+gap;y=anchor.top;}
    else if(anchor.left-gap-width>=12){x=anchor.left-gap-width;y=anchor.top;}
    else if(anchor.bottom+gap+height<=innerHeight-12){x=anchor.left;y=anchor.bottom+gap;}
    else{x=anchor.left;y=anchor.top-gap-height;}
    panel.style.left=Math.max(12,Math.min(innerWidth-width-12,x))+'px';
    panel.style.top=Math.max(44,Math.min(innerHeight-height-12,y))+'px';panel.style.right='auto';panel.style.bottom='auto';
  }
  function place(x,y){const panel=$('ai-panel');position={x:Math.max(8,Math.min(innerWidth-panel.offsetWidth-8,x)),y:Math.max(36,Math.min(innerHeight-panel.offsetHeight-8,y))};panel.style.left=position.x+'px';panel.style.top=position.y+'px';panel.style.right='auto';panel.style.bottom='auto';}
  const heading=$('ai-panel').querySelector('.ai-heading');let drag=null;
  heading.title='Перетащи, чтобы переместить окно';
  heading.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('button,input,[role="tablist"]'))return;const r=$('ai-panel').getBoundingClientRect();drag={dx:e.clientX-r.left,dy:e.clientY-r.top};modelPicker.close();heading.setPointerCapture(e.pointerId);e.preventDefault();});
  heading.addEventListener('pointermove',e=>{if(drag)place(e.clientX-drag.dx,e.clientY-drag.dy);});
  const endDrag=()=>{drag=null;};heading.addEventListener('pointerup',endDrag);heading.addEventListener('pointercancel',endDrag);heading.addEventListener('lostpointercapture',endDrag);
  function drawSelection(){
    const el=$('ai-selection'),s=active?.selection;
    el.hidden=!s?.text;el.className=s?.type==='preview'?'selection-preview':'selection-code';el.replaceChildren();
    if(!s?.text)return;
    const body=document.createElement('div');body.className='selection-excerpt';
    if(s.type==='preview')body.innerHTML=safe(s.html||'');else body.textContent=short(s.text);
    el.append(body);
  }
  function renderConversation(forceBottom=false){
    if(frame)cancelAnimationFrame(frame);frame=0;chatScroll.beforeRender();const el=$('ai-answer');
    const turns=active?.turns||[];
    const hadTurns=$('ai-panel').classList.contains('has-turns');$('ai-panel').classList.toggle('has-turns',turns.length>0);
    if(hadTurns!==(turns.length>0))locate();
    // Reuse settled turns; only the currently streamed Markdown changes.
    turns.forEach((turn,i)=>{
      let row=el.children[i];
      if(!row){row=document.createElement('section');row.className='ai-turn';const q=document.createElement('div');q.className='ai-user';const a=document.createElement('div');a.className='ai-response';const tools=document.createElement('div');tools.className='work-tools';row.append(q,a,tools);el.append(row);}
      if(row.turn!==turn){row.turn=turn;row.lastAnswer=undefined;row.children[1].replaceChildren();delete row.children[1].dataset.layout;}
      row.firstChild.textContent=turn.question;
      if(turn.mode==='work'||turn.trace){row.lastAnswer=undefined;row.children[1].className='ai-response agent-traces';renderTrace(row.children[1],turn,workReview);row.lastChild.className='work-summary';renderWorkSummary(row.lastChild,turn,workReview);}
      else{row.children[1].className='ai-response';if(row.lastAnswer!==turn.answer){row.children[1].innerHTML=safe(renderMarkdown(turn.answer));row.lastAnswer=turn.answer;}row.lastChild.hidden=true;}
    });
    while(el.children.length>turns.length)el.lastChild.remove();
    const last=turns.at(-1),running=[...jobs.values()].find(j=>j.chat===active&&j.running!==false);
    $('ai-copy').disabled=!last?.answer;$('ai-stop').hidden=!running;$('ai-send').hidden=!!running;$('ai-send').disabled=!!running;
    $('ai-status').textContent=last?.mode==='work'?'':running?'Отвечает…':last?.status||'';updateModes();
    chatScroll.afterRender(forceBottom===true);
  }
  function renderHistory(){
    const el=$('ai-history');el.replaceChildren();
    const saved=chats.filter(c=>c.turns.length);
    if(!saved.length){const p=document.createElement('p');p.textContent='Пока нет чатов';el.append(p);}
    for(const chat of saved){
      const row=document.createElement('div');row.className='chat-history-row';
      const open=document.createElement('button');open.className='chat-history-open';
      const label=document.createElement('strong');label.textContent=chat.turns[0].question.slice(0,80);
      const detail=document.createElement('small');detail.textContent=(chat.selection?.type==='preview'?'Превью':chat.selection?.text?'Код':'Документ')+' · '+new Date(chat.created).toLocaleDateString('ru-RU');open.append(label,detail);
      open.onclick=()=>{active=chat;setMode(chat.mode);anchor=null;$('ai-question').value='';setHistory(false);drawSelection();renderConversation(true);locate();};
      const remove=document.createElement('button');remove.innerHTML=icon('trash');remove.title='Удалить чат';remove.setAttribute('aria-label','Удалить чат');
      remove.onclick=()=>{for(const [id,job] of jobs)if(job.chat===chat){api?.cancelAI(id);if(workReview?.pending?.id===id)workReview.settle({proposalId:workReview.pending.proposalId,accepted:false});jobs.delete(id);}chats=chats.filter(c=>c!==chat);if(active===chat){active=null;drawSelection();renderConversation();}persist();renderHistory();};
      row.append(open,remove);el.append(row);
    }
  }
  function setHistory(show){$('ai-history').hidden=!show;$('ai-answer').hidden=show;$('ai-form').hidden=show;$('ai-selection').hidden=show||!active?.selection?.text;$('ai-history-toggle').setAttribute('aria-pressed',String(show));if(show)renderHistory();else chatScroll.toBottom();}
  function newChat(selection=null){
    active={id:crypto.randomUUID(),created:Date.now(),mode,selection:selection?{type:selection.type,text:selection.text,html:selection.html||''}:null,turns:[]};
    chats.unshift(active);chats=chats.slice(0,60);anchor=selection?.rect||null;if(selection)position=null;$('ai-question').value='';setHistory(false);drawSelection();renderConversation(true);locate();
  }
  async function open(selection=null){
    await ready;$('ai-panel').hidden=false;
    if(selection||!active||active.selection)newChat(selection);else{anchor=null;setHistory(false);drawSelection();renderConversation(true);locate();}
    $('ai-question').focus();
    try{const config=await workSettings.refresh();modelPicker.update(config);$('ai-key-form').hidden=!!config?.hasKey;if(!config?.hasKey)$('ai-status').textContent='Добавь ключ OpenRouter';}catch(e){toast(e.message);}
  }
  api?.onAIEvent(event=>{
    const job=jobs.get(event.id);if(!job)return;
    if(event.type==='chunk'){job.turn.answer+=event.text;if(job.chat===active&&!frame)frame=requestAnimationFrame(renderConversation);return;}
    if(['trace_wait','trace_start','trace_delta','trace_end','tool_start','tool_update','tool_end'].includes(event.type)){
      traceEvent(job.turn,event);if(job.chat===active&&!frame)frame=requestAnimationFrame(renderConversation);return;
    }
    if(event.type==='draft_update'){workReview?.stage(event);return;}
    if(event.type==='edit_proposal'){job.proposal=event;return;}
    if(event.type==='edit_decision'){
      workReview?.settle(event);if(job.turn.diff)job.turn.diff.status=event.accepted?'accepted':'rejected';if(job.running===false)jobs.delete(event.id);
      if(job.chat===active)renderConversation();persist();return;
    }
    job.running=false;
    if(job.mode==='work'){
      job.turn.finished=true;
      finishTrace(job.turn,event.type==='error'?event.message:event.type==='stopped'?'Остановлено':null);
      if(event.type==='done'&&job.proposal&&workReview?.propose(job.proposal)){job.turn.diff={added:job.proposal.added,removed:job.proposal.removed,status:'pending'};}
      else{if(workReview?.pending?.id===event.id)workReview.settle({proposalId:workReview.pending.proposalId,accepted:false});jobs.delete(event.id);}
    }else jobs.delete(event.id);
    job.turn.status=event.type==='done'?'Готово':event.type==='stopped'?'Остановлено':event.message;
    if(job.chat===active){if(frame)cancelAnimationFrame(frame);renderConversation();}persist();
  });
  $('ai-form').onsubmit=async e=>{
    if(workReview?.pending){e.preventDefault();toast('Прими или отклони правку');return;}
    e.preventDefault();const question=$('ai-question').value.trim();if(!question||[...jobs.values()].some(j=>j.chat===active&&j.running!==false))return;
    if(!api){toast('AI доступен в десктоп-приложении');return;}if(!active)newChat();
    const id=crypto.randomUUID(),chat=active;
    const history=chat.turns.filter(t=>t.answer).slice(-10).map(t=>({question:t.question,answer:t.answer}));
    const turn={question,answer:'',mode,status:mode==='work'?'':'Отвечает…'};if(mode==='work')traceEvent(turn,{type:'trace_wait'});chat.turns.push(turn);jobs.set(id,{chat,turn,mode,running:true});$('ai-question').value='';renderConversation(true);persist();
    try{await (mode==='work'?api.startWork:api.askAI)({id,model:modelPicker.value,context:getContext(),selection:chat.selection?.text||'',question,history,...(mode==='work'?{bibliographies:getBibliographies()}:{} )});}
    catch(error){if(workReview?.pending?.id===id)workReview.settle({proposalId:workReview.pending.proposalId,accepted:false});jobs.delete(id);turn.status=error.message;if(mode==='work'){turn.finished=true;finishTrace(turn,error.message);}renderConversation();persist();}
  };
  $('ai-question').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('ai-form').requestSubmit();}};
  $('ai-copy').onclick=()=>api?.copyText(active?.turns.at(-1)?.answer||'').then(()=>toast('Ответ скопирован')).catch(e=>toast(e.message));
  $('ai-stop').onclick=()=>{for(const [id,job] of jobs)if(job.chat===active)api?.cancelAI(id);};
  $('ai-new').onclick=()=>{newChat();$('ai-question').focus();};
  $('ai-history-toggle').onclick=()=>setHistory($('ai-history').hidden);
  $('ai-toggle').onclick=()=>open();$('ai-close').onclick=()=>{modelPicker.close();$('ai-panel').hidden=true;};
  $('ai-key-save').onclick=async()=>{try{await api?.setAIKey($('ai-key').value.trim());$('ai-key').value='';$('ai-key-form').hidden=true;renderConversation();}catch(e){$('ai-status').textContent=e.message;}};
  $('ai-settings').onclick=()=>{$('ai-key-form').hidden=!$('ai-key-form').hidden;if(!$('ai-key-form').hidden)$('ai-key').focus();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){modelPicker.close();$('ai-panel').hidden=true;}});
  // Links stay inside the chat; copying source Markdown keeps LaTeX intact.
  $('ai-answer').addEventListener('click',e=>{if(e.target.closest('a'))e.preventDefault();});
  window.addEventListener('resize',()=>{if(!$('ai-panel').hidden)locate();});
  return{open};
}
