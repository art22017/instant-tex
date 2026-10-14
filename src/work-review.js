import {Compartment,EditorState,StateEffect,Transaction} from '@codemirror/state';
import {EditorView} from '@codemirror/view';
import {unifiedMergeView} from '@codemirror/merge';

export function initWorkReview({editor,api,$,toast,getDirty=()=>true,restoreDirty=()=>{},onSettled=()=>{}}){
  const review=new Compartment();let pending=null;
  editor.dispatch({effects:StateEffect.appendConfig.of(review.of([]))});
  function show(){if(!pending)return;editor.dispatch({selection:{anchor:pending.at},scrollIntoView:true});}
  async function decide(accepted){
    if(!pending?.ready||pending.sending)return;
    pending.sending=true;$('work-accept').disabled=true;$('work-reject').disabled=true;
    try{await api.decideWork({id:pending.id,proposalId:pending.proposalId,accepted,currentDocument:accepted?editor.state.doc.toString():pending.before});}
    catch(error){if(pending)pending.sending=false;$('work-accept').disabled=false;$('work-reject').disabled=false;toast(error.message);}
  }
  function stage(event){
    const current=editor.state.doc.toString();
    if((pending&&(pending.id!==event.id||current!==pending.after))||(!pending&&current!==event.before)){
      void api.cancelAI(event.id);toast('Документ изменился во время запроса. Правки агента отменены.');return false;
    }
    let at=0;while(at<event.before.length&&at<event.after.length&&event.before[at]===event.after[at])at++;
    pending={selection:editor.state.selection,wasDirty:getDirty(),...pending,...event,at,ready:false};
    editor.dispatch({annotations:Transaction.addToHistory.of(false),effects:review.reconfigure([unifiedMergeView({original:event.before,mergeControls:false,highlightChanges:true,gutter:true}),EditorState.readOnly.of(true),EditorView.editable.of(false)]),changes:{from:0,to:editor.state.doc.length,insert:event.after},selection:{anchor:at},scrollIntoView:true});
    $('work-review').hidden=true;return true;
  }
  function propose(event){
    if(!stage(event))return false;pending.ready=true;
    $('work-review').hidden=false;$('work-counts').textContent=`+${event.added} −${event.removed}`;$('work-accept').disabled=false;$('work-reject').disabled=false;return true;
  }
  function settle(event){
    if(!pending||pending.proposalId!==event.proposalId)return;
    const p=pending;pending=null;
    editor.dispatch({annotations:Transaction.addToHistory.of(false),effects:review.reconfigure([]),changes:{from:0,to:editor.state.doc.length,insert:p.before},selection:{anchor:Math.min(p.selection.main.head,p.before.length)}});
    if(event.accepted)editor.dispatch({changes:{from:0,to:editor.state.doc.length,insert:p.after},selection:{anchor:p.at},annotations:Transaction.userEvent.of('input.work')});
    $('work-review').hidden=true;
    if(!event.accepted)restoreDirty(p.wasDirty);
    onSettled();
  }
  $('work-accept').onclick=()=>decide(true);$('work-reject').onclick=()=>decide(false);
  return{stage,propose,settle,decide,show,get pending(){return pending;}};
}
