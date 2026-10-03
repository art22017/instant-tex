import './style.css';
import './export.css';
window.exportReady=(async()=>{
  document.documentElement.classList.add('export-document');
  document.getElementById('rendered').innerHTML=await window.exportBridge.getPayload();
  await document.fonts.ready;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {height:Math.ceil(document.body.getBoundingClientRect().height)};
})();
