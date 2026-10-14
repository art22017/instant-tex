import './style.css';
import './document.css';
import './export.css';
window.exportReady=(async()=>{
  document.documentElement.classList.add('export-document');
  document.getElementById('rendered').innerHTML=await window.exportBridge.getPayload();
  await document.fonts.ready;
  await Promise.all([...document.images].map(image=>image.decode()));
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {height:Math.ceil(document.body.getBoundingClientRect().height)};
})();
