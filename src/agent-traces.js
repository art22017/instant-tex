import DOMPurify from 'dompurify';
import {renderMarkdown} from './markdown.js';
import {icon} from './icons.js';
const markdown=text=>DOMPurify.sanitize(renderMarkdown(text),{FORBID_TAGS:['img','iframe','video','audio','style'],FORBID_ATTR:['id']});
export function traceEvent(turn,event){
  turn.trace??=[];
  if(event.type==='trace_wait'){turn.trace=turn.trace.filter(b=>b.kind!=='waiting');turn.trace.push({id:crypto.randomUUID(),kind:'waiting',status:'running'});return;}
  turn.trace=turn.trace.filter(b=>b.kind!=='waiting');
  const id=event.traceId?'message:'+event.traceId:'tool:'+event.toolCallId;
  let block=turn.trace.find(b=>b.id===id);
  if(!block){block={id,kind:event.kind||'tool',name:event.name,text:'',status:'running'};turn.trace.push(block);}
  if(event.type==='trace_delta'){block.text+=event.text;if(block.kind==='text')turn.answer+=(turn.answer&&block.text===event.text?'\n\n':'')+event.text;}
  if(event.type==='trace_end')block.status='done';
  if(event.type==='tool_start')Object.assign(block,{name:event.name,args:event.args});
  if(event.type==='tool_update')block.result=event.result;
  if(event.type==='tool_end')Object.assign(block,{result:event.result,status:event.isError?'error':'done'});
}
export function finishTrace(turn,error){
  turn.trace=(turn.trace||[]).filter(b=>b.kind!=='waiting');
  for(const block of turn.trace)if(block.status==='running')block.status=error?'interrupted':'done';
  if(error)turn.trace.push({id:crypto.randomUUID(),kind:'error',text:error,status:'error'});
}
export function renderTrace(container,turn,review){
  const blocks=turn.trace||[];
  const layout=turn.finished?'finished':'streaming';
  if(container.dataset.layout!==layout){container.replaceChildren();container.dataset.layout=layout;}
  if(!turn.finished){renderBlocks(container,blocks);return;}
  const final=blocks.findLast(b=>b.kind==='text'||b.kind==='error'),history=blocks.filter(b=>b!==final);
  let group=container.querySelector(':scope > .trace-history'),answer=container.querySelector(':scope > .trace-final');
  if(!group){group=document.createElement('details');group.className='trace-history';group.innerHTML='<summary></summary><div class="trace-history-body"></div>';container.append(group);}
  group.hidden=!history.length;group.firstChild.innerHTML=icon('ai');
  const caption=document.createElement('span'),count=history.filter(b=>b.kind==='tool').length;caption.textContent=count?`Thinking · ${count} tools`:'Thinking';group.firstChild.append(caption);
  renderBlocks(group.lastChild,history);
  if(!answer){answer=document.createElement('div');answer.className='trace-final';container.append(answer);}renderBlocks(answer,final?[final]:[]);
}
function renderBlocks(container,blocks){
  for(let i=0;i<blocks.length;i++){
    const block=blocks[i];let el=container.children[i];
    if(!el||el.dataset.traceId!==block.id){
      el=document.createElement(['thinking','tool'].includes(block.kind)?'details':'div');el.dataset.traceId=block.id;
      if(['thinking','tool'].includes(block.kind))el.innerHTML='<summary></summary><div class="trace-body"></div>';
      if(container.children[i])container.children[i].replaceWith(el);else container.append(el);
    }
    el.className='agent-trace trace-'+block.kind+' '+block.status;
    if(block.kind==='text'){if(el.lastText!==block.text){el.innerHTML=markdown(block.text);el.lastText=block.text;}continue;}
    if(block.kind==='error'){el.textContent=block.text;continue;}
    if(block.kind==='waiting'){el.innerHTML='<span class="trace-spinner"></span><span>Thinking</span>';continue;}
    const names={read_document:['read','Read черновик'],search_document:['search','Search'],check_latex:['check','Check LaTeX'],edit_document:['edit','Edited черновик']};
    const [symbol,label]=block.kind==='thinking'?['ai','Thinking']:names[block.name]||['settings',block.name];
    const summary=el.firstChild;summary.innerHTML=icon(symbol);
    const caption=document.createElement('span');caption.textContent=label;summary.append(caption);
    const badge=document.createElement('span');badge.className=block.status==='running'?'trace-spinner':'trace-state';badge.innerHTML=block.status==='running'?'':icon(block.status==='error'||block.status==='interrupted'?'close':'check');summary.append(badge);
    const body=el.lastChild;
    if(block.kind==='thinking'){if(body.lastText!==block.text){body.innerHTML=markdown(block.text);body.lastText=block.text;}}
    else if(body.lastText!==block.args+'|'+block.result){
      body.replaceChildren();for(const [label,text] of [['Arguments',block.args],['Result',block.result]])if(text){const heading=document.createElement('small');heading.textContent=label;const pre=document.createElement('pre');pre.textContent=text;body.append(heading,pre);}body.lastText=block.args+'|'+block.result;
    }
  }
  while(container.children.length>blocks.length)container.lastChild.remove();
}
export function renderWorkSummary(container,turn,review){
  container.replaceChildren();container.hidden=!turn.diff;
  if(!turn.diff)return;
  const label=document.createElement('button');label.className='work-tool-label';label.innerHTML=icon('edit');label.append('Черновик');label.onclick=()=>review.show();container.append(label);
  const counts=document.createElement('span');counts.className='work-line-counts';for(const n of ['+'+turn.diff.added,'−'+turn.diff.removed]){const span=document.createElement('span');span.textContent=n;counts.append(span);}container.append(counts);
  if(turn.diff.status==='pending')for(const [accepted,name] of [[true,'check'],[false,'close']]){const button=document.createElement('button');button.innerHTML=icon(name);button.title=accepted?'Принять':'Отклонить';button.setAttribute('aria-label',button.title);button.onclick=()=>review.decide(accepted);container.append(button);}
  else{const state=document.createElement('span');state.className='trace-state';state.innerHTML=icon(turn.diff.status==='accepted'?'check':'close');container.append(state);}
}
