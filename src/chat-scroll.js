// Follow new messages until the user deliberately scrolls back into history.
export function initChatScroll(element){
  let follow=true,rendering=false,frame=0;
  const nearBottom=()=>element.scrollHeight-element.clientHeight-element.scrollTop<70;
  const bottom=()=>{if(follow&&!element.hidden)element.scrollTop=element.scrollHeight;};
  element.addEventListener('scroll',()=>{if(!rendering)follow=nearBottom();});
  element.addEventListener('wheel',e=>{if(e.deltaY<0)follow=false;else requestAnimationFrame(()=>{if(nearBottom())follow=true;});},{passive:true});
  element.addEventListener('pointerdown',e=>{if(e.clientX>=element.getBoundingClientRect().right-18)follow=false;});
  element.addEventListener('click',e=>{if(e.target.closest('summary'))follow=false;});
  element.addEventListener('keydown',e=>{if(['ArrowUp','PageUp','Home'].includes(e.key))follow=false;});
  let touchY=0;element.addEventListener('touchstart',e=>{touchY=e.touches[0]?.clientY||0;},{passive:true});
  element.addEventListener('touchmove',e=>{if((e.touches[0]?.clientY||0)>touchY)follow=false;},{passive:true});
  function afterRender(force=false){
    if(force)follow=true;rendering=true;bottom();cancelAnimationFrame(frame);
    frame=requestAnimationFrame(()=>{bottom();frame=requestAnimationFrame(()=>{bottom();rendering=false;});});
  }
  const observer=new ResizeObserver(()=>{if(follow)afterRender();});observer.observe(element);
  return{beforeRender(){rendering=true;},afterRender,toBottom(){afterRender(true);}};
}
