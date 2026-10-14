const PHRASE='я понимаю что я бездарь и ничему не научусь';
export function initWorkSettings({api,$,onChange,toast}){
  let enabled=false,revision=0;
  function update(value){revision++;enabled=value===true;$('work-enabled-state').textContent=enabled?'Work включён':'Work отключён';$('work-disable').hidden=!enabled;$('work-enable-form').hidden=enabled;$('work-phrase').value='';onChange(enabled);}
  async function refresh(){const at=revision,config=await api?.aiConfig();if(at===revision)update(config?.workEnabled);return config;}
  async function open(){try{await refresh();}catch(e){toast(e.message);}$('work-settings-dialog').showModal();}
  for(const id of ['work-settings-toggle','ai-work-settings'])$(id).onclick=open;
  $('work-settings-close').onclick=()=>$('work-settings-dialog').close();
  $('work-disable').onclick=async()=>{try{update(await api.setWorkEnabled(false,''));}catch(e){toast(e.message);}};
  $('work-enable-form').onsubmit=async e=>{e.preventDefault();if($('work-phrase').value!==PHRASE){$('work-phrase').setCustomValidity('Введи фразу полностью, без изменений');$('work-phrase').reportValidity();return;}try{update(await api.setWorkEnabled(true,$('work-phrase').value));$('work-settings-dialog').close();}catch(e){toast(e.message);}};
  $('work-phrase').oninput=()=>$('work-phrase').setCustomValidity('');
  for(const type of ['paste','drop'])$('work-phrase').addEventListener(type,e=>e.preventDefault());
  $('work-phrase').addEventListener('beforeinput',e=>{if(['insertFromPaste','insertFromDrop','insertReplacementText'].includes(e.inputType))e.preventDefault();});
  for(const id of ['appearance-options','ai-key-form','work-settings-dialog'])for(const type of ['copy','cut','contextmenu'])$(id).addEventListener(type,e=>e.preventDefault());
  if(api)void refresh().catch(()=>{});
  return{update,refresh,open,get enabled(){return enabled;}};
}
