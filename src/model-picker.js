import {icon} from './icons.js';

export function initModelPicker({$,api,toast}){
  const button=$('ai-model'),menu=$('ai-model-menu');
  let models=[],selected='deepseek/deepseek-v4.1-flash',saving=false;
  function close(){menu.hidden=true;button.setAttribute('aria-expanded','false');}
  function label(){button.innerHTML='';const name=document.createElement('span');name.textContent=models.find(m=>m.id===selected)?.name||'DeepSeek V4.1 Flash';button.append(name);button.insertAdjacentHTML('beforeend',icon('chevron'));button.title=selected;}
  function position(){const r=button.getBoundingClientRect(),width=Math.min(340,innerWidth-24);menu.style.width=width+'px';menu.style.left=Math.max(12,Math.min(innerWidth-width-12,r.right-width))+'px';menu.style.maxHeight=Math.max(100,Math.min(330,r.top-20))+'px';menu.style.top=Math.max(12,r.top-menu.offsetHeight-8)+'px';}
  function rows(){return [...menu.querySelectorAll('[role="option"]')];}
  function draw(){
    menu.replaceChildren();
    for(const [heading,free] of [['BYOK',false],['Free',true]]){
      const group=document.createElement('div');group.className='model-group';group.setAttribute('role','group');group.setAttribute('aria-label',heading);
      const title=document.createElement('div');title.className='model-group-title';title.textContent=heading;group.append(title);
      for(const model of models.filter(m=>!!m.free===free)){
        const row=document.createElement('button');row.type='button';row.role='option';row.dataset.model=model.id;row.setAttribute('aria-selected',String(model.id===selected));row.title=model.id;
        const name=document.createElement('span');name.textContent=model.name;row.append(name);
        if(model.id===selected)row.insertAdjacentHTML('beforeend',icon('check'));
        row.onclick=async()=>{const previous=selected;close();selected=model.id;label();saving=true;button.disabled=true;try{selected=await api.setAIModel(model.id);}catch(e){selected=previous;toast(e.message);}finally{saving=false;button.disabled=false;label();draw();button.focus();}};
        group.append(row);
      }menu.append(group);
    }
  }
  button.onclick=()=>{if(!menu.hidden){close();return;}if(!models.length)return;draw();menu.hidden=false;button.setAttribute('aria-expanded','true');position();(rows().find(r=>r.getAttribute('aria-selected')==='true')||rows()[0])?.focus();};
  button.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(menu.hidden)button.click();}};
  menu.onkeydown=e=>{const items=rows(),index=items.indexOf(document.activeElement);if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();button.focus();}if(e.key==='Tab')close();};
  document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!button.contains(e.target))close();});
  window.addEventListener('resize',close);
  label();
  return{get value(){return selected;},close,disable(value){button.disabled=value||saving;if(value)close();},update(config){if(!config?.models)return;models=config.models;selected=config.model;label();draw();}};
}
