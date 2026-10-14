import {scan} from './tex-structure.js';
export class ResourceStore{
  constructor(){this.assets=Object.create(null);this.urls=new Map();}
  clear(){for(const url of this.urls.values())URL.revokeObjectURL(url);this.urls.clear();this.assets=Object.create(null);}
  load(assets={}){this.clear();Object.assign(this.assets,assets);}
  add({name,mime,data}){for(const [existing,a] of Object.entries(this.assets))if(a.mime===mime&&a.data===data)return existing;const size=a=>a.mime==='application/x-bibtex'?new TextEncoder().encode(a.data).length:a.data.length*3/4;if(Object.keys(this.assets).length>=200||Object.values(this.assets).reduce((n,a)=>n+size(a),0)+size({mime,data})>64*1024*1024)throw new Error('Лимит вложений — 200 файлов / 64 МБ');const dot=name.lastIndexOf('.'),base=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';let unique=name,n=2;while(Object.hasOwn(this.assets,unique))unique=base+'-'+(n++)+ext;this.assets[unique]={mime,data};return unique;}
  image(name){const resource=this.assets[name];if(!resource?.mime.startsWith('image/'))return null;if(!this.urls.has(name)){const bytes=Uint8Array.from(atob(resource.data),c=>c.charCodeAt(0));this.urls.set(name,URL.createObjectURL(new Blob([bytes],{type:resource.mime})));}return this.urls.get(name);}
  bibliography(name){const a=this.assets[name];return a?.mime==='application/x-bibtex'?a.data:null;}
  exportHTML(html){for(const [name,url] of this.urls){const a=this.assets[name];html=html.replaceAll(url,`data:${a.mime};base64,${a.data}`);}return html;}
}
export function initResources({editor,store,$,api,toast,changed,locked}){
  async function insert(resources){if(locked()){toast('Сначала заверши проверку правки');return;}const snippets=[];
    for(const resource of resources){const name=store.add(resource);if(resource.mime==='application/x-bibtex')snippets.push(`\\bibliographystyle{plain}\n\\bibliography{${name.replace(/\.bib$/,'')}}`);else snippets.push(`\\begin{figure}[h]\n\\centering\n\\includegraphics[width=0.8\\linewidth]{${name}}\n\\caption{Подпись рисунка}\n\\label{fig:${crypto.randomUUID().slice(0,8)}}\n\\end{figure}`);}
    const source=editor.state.doc.toString(),range=editor.state.selection.main,begin=source.indexOf('\\begin{document}'),bodyStart=begin<0?0:begin+16,closing=source.lastIndexOf('\\end{document}'),bodyEnd=closing<bodyStart?source.length:closing;
    let at=Math.max(bodyStart,Math.min(bodyEnd,range.head));
    // Figures are block content: never put one inside a formula, caption or preamble.
    if(resources.some(r=>r.mime==='application/x-bibtex'))at=bodyEnd;
    else{const blocks=scan(source);for(let i=blocks.length-1;i>=0;i--)if(blocks[i].from<=at){at=blocks[i].incomplete?blocks[i].from:Math.min(bodyEnd,blocks[i+1]?.from??bodyEnd);break;}}
    const text='\n'+snippets.join('\n\n')+'\n';editor.dispatch({changes:{from:at,to:at,insert:text},selection:{anchor:at+text.length},scrollIntoView:true});changed();editor.focus();
  }
  async function files(list){try{const resources=[];let total=Object.values(store.assets).reduce((n,a)=>n+a.data.length,0);for(const file of list){if(file.size>16*1024*1024)throw new Error('Лимит вложения — 16 МБ');if(total+file.size*1.4>85*1024*1024)throw new Error('Общий лимит вложений — 64 МБ');const bib=/\.bib$/i.test(file.name);if(!bib&&!/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw new Error('Поддерживаются PNG, JPEG, WebP, GIF и .bib');const data=bib?await file.text():await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result.split(',')[1]);r.onerror=reject;r.readAsDataURL(file);});total+=data.length;let name=file.name.replace(/[^\p{L}\p{N}_. -]/gu,'_');if(!name||name==='.'||name==='..')name='image.png';resources.push({name,mime:bib?'application/x-bibtex':file.type,data});}await insert(resources);}catch(e){toast(e.message);}}
  $('insert-resource').onclick=async()=>{try{const resources=await api?.importResources();if(resources?.length)await insert(resources);}catch(e){toast(e.message);}};
  editor.dom.addEventListener('paste',e=>{const images=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(images.length){e.preventDefault();e.stopPropagation();void files(images);}},{capture:true});
  editor.dom.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
  editor.dom.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();e.stopPropagation();const at=editor.posAtCoords({x:e.clientX,y:e.clientY});if(at!=null&&!locked())editor.dispatch({selection:{anchor:at}});void files([...e.dataTransfer.files]);}},{capture:true});
}
