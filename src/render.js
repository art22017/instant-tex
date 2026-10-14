import katex from 'katex';
import {scan,escapeHTML,groupAt,commandArgs,stripCommand,splitTop,parseBibtex} from './tex-structure.js';
export {escapeHTML};
export const parse=scan;

export const example = String.raw`\section{Непрерывность функции}

Проверим непрерывность в точке \(x_0 = 1\).
\[
\boxed{f(x)=x^2+2x,\qquad x_0=1}
\]

\subsection{01. По определению}

Пусть \(\varepsilon > 0\). Нужно подобрать \(\delta\), чтобы
\[
|x-1|<\delta \quad\Longrightarrow\quad |f(x)-f(1)|<\varepsilon.
\]

Разложим разность на множители:
\begin{align*}
|f(x)-f(1)| &= |x^2+2x-3| \\
&= |x-1|\,|x+3|.
\end{align*}

Если \(|x-1|<1\), то \(|x+3|<5\). Поэтому достаточно взять
\[
\boxed{\delta = \min\!\left(1,\frac{\varepsilon}{5}\right)}.
\]

\textbf{Ответ.} Функция непрерывна в точке \(x_0=1\).`;

function walk(blocks,fn){for(const b of blocks){fn(b);if(b.children)walk(b.children,fn);for(const item of b.items||[])walk(item.children,fn);}}
const anchor=key=>'tex-'+encodeURIComponent(key);
function tableRows(raw){
  const rows=[];
  for(let chunk of splitTop(raw,'\\\\')){
    const lines=[...chunk.matchAll(/\\(hline|toprule|midrule|bottomrule)\b|\\cline\{(\d+)-(\d+)\}/g)].map(m=>({from:m[2]?Number(m[2]):1,to:m[3]?Number(m[3]):30,width:/toprule|bottomrule/.test(m[1])?2:1}));
    chunk=chunk.replace(/\\(?:hline|toprule|midrule|bottomrule)\b|\\cline\{\d+-\d+\}/g,'');
    if(chunk.trim())rows.push({raw:chunk,top:lines,bottom:[]});else if(rows.length)rows.at(-1).bottom.push(...lines);
  }return rows;
}
function columnRules(spec){let index=0,depth=0;const borders=new Set();for(let i=0;i<spec.length;i++){if(spec[i]==='{'){depth++;continue;}if(spec[i]==='}'){depth--;continue;}if(depth)continue;if(spec[i]==='|')borders.add(index);else if(/[lcrpmb]/.test(spec[i]))index++;else if(spec[i]==='*'){const g=commandArgs(spec,i+1,2);for(let n=0;n<Number(g.args[0]);n++){for(const boundary of columnRules(g.args[1]))borders.add(index+boundary);index+=columns(g.args[1]).length;}i=g.end-1;}}return borders;}
function columns(spec){const cols=[];for(let i=0;i<spec.length;i++){if(/[lcr]/.test(spec[i]))cols.push({align:{l:'left',c:'center',r:'right'}[spec[i]]});else if(/[pmb]/.test(spec[i])&&spec[i+1]==='{'){const g=groupAt(spec,i+1);cols.push({align:'left',width:/^\d+(?:\.\d+)?(?:cm|mm|em|pt)$/.test(g.value)?g.value:''});i=g.end-1;}else if(spec[i]==='*'){const g=commandArgs(spec,i+1,2),n=Number(g.args[0]);if(!Number.isInteger(n)||n<1||n>30)throw new Error('Некорректные столбцы таблицы');for(let j=0;j<n;j++)cols.push(...columns(g.args[1]));i=g.end-1;}else if(!/[\s|]/.test(spec[i]))throw new Error(`Столбец ${spec[i]} не поддерживается`);}if(!cols.length||cols.length>30)throw new Error('В таблице должно быть от 1 до 30 столбцов');return cols;}

export class DraftRenderer{
  constructor({resolveImage=()=>null,getBibliography=()=>null}={}){this.cache=new Map();this.mathCache=new Map();this.bibCache=new Map();this.previous=[];this.resolveImage=resolveImage;this.getBibliography=getBibliography;this.assetVersion=0;this.referenceVersion=0;this.referenceSignature='';}
  invalidateAssets(){this.assetVersion++;this.bibCache.clear();}
  formula(tex,display){const key=(display?'d:':'i:')+tex;let html=this.mathCache.get(key);if(html===undefined){html=katex.renderToString(tex,{displayMode:display,throwOnError:true,strict:'ignore',trust:false,output:'htmlAndMathml',maxExpand:500,maxSize:20});this.mathCache.set(key,html);}return html;}
  plan(blocks){
    const refs=new Map(),citations=new Map(),counts={equation:0,figure:0,table:0},sections=[0,0,0];let lastNumber='';
    const remember=(key,number)=>{if(refs.has(key))throw new Error(`Повторная метка: ${key}`);refs.set(key,String(number));};
    const visit=(list,listPath=[])=>{for(const b of list){
      b.ids=[];
      if(b.kind==='heading'&&!b.star){sections[b.level-1]++;for(let i=b.level;i<3;i++)sections[i]=0;b.number=sections.slice(0,b.level).join('.');lastNumber=b.number;}
      if(b.kind==='math'){
        const numbered=!!b.env&&!b.env.endsWith('*')&&b.env!=='aligned';
        const rows=/^(align|gather|flalign)/.test(b.env)?splitTop(b.raw,'\\\\'):[b.raw];b.rows=[];
        for(let row of rows){if(!row.trim())continue;const ids=[];row=stripCommand(row,'label',v=>ids.push(v));let tag;row=stripCommand(row,'tag',v=>tag=v);const skip=/\\(?:notag|nonumber)\b/.test(row);row=row.replace(/\\(?:notag|nonumber)\b/g,'');const number=tag??(numbered&&!skip?String(++counts.equation):'');for(const id of ids)remember(id,number||lastNumber);b.rows.push({tex:row.trim(),number,ids});if(number)lastNumber=number;}
        b.numbered=b.rows.some(r=>r.number);continue;
      }
      if(b.kind==='figure'||b.kind==='table'){b.number=b.caption!==undefined?String(++counts[b.kind]):lastNumber;lastNumber=b.number;for(const id of b.labels||[]){remember(id,b.number);b.ids.push(id);}visit(b.children,listPath);continue;}
      if(b.kind==='itemize'||b.kind==='enumerate'||b.kind==='description'){
        b.items.forEach((item,i)=>{item.number=b.kind==='enumerate'?listPath.concat(i+1).join('.'):'';lastNumber=item.number||lastNumber;visit(item.children,b.kind==='enumerate'?listPath.concat(i+1):listPath);});continue;
      }
      if(b.kind==='thebibliography'){for(const item of b.items){if(citations.has(item.key))throw new Error(`Повторный источник: ${item.key}`);item.number=String(citations.size+1);citations.set(item.key,item.number);}continue;}
      if(b.kind==='bibliography'){
        b.entries=[];for(const name of b.raw.split(',').map(s=>s.trim())){const text=this.getBibliography(name.replace(/\.bib$/,'')+'.bib');if(text==null)throw new Error(`Библиография ${name}.bib не загружена. Используй кнопку импорта .bib.`);const filename=name.replace(/\.bib$/,'')+'.bib';let cached=this.bibCache.get(filename);if(!cached||cached.text!==text){cached={text,entries:parseBibtex(text)};this.bibCache.set(filename,cached);}b.entries.push(...cached.entries);}
        for(const entry of b.entries){if(citations.has(entry.key))throw new Error(`Повторный источник: ${entry.key}`);entry.number=String(citations.size+1);citations.set(entry.key,entry.number);}continue;
      }
      // Labels in normal text inherit the preceding section, item or equation.
      if(b.raw.includes('\\label'))b.raw=stripCommand(b.raw,'label',id=>{remember(id,lastNumber);b.ids.push(id);});
    }};visit(blocks);return{refs,citations,signature:JSON.stringify([[...refs],[...citations]])};
  }
  inline(s,ctx,level=0){
    if(level>30)throw new Error('Слишком большая вложенность текста');let html='',pos=0;const re=/\\(?:\(|[a-zA-Z]+\*?|[%&#_$~{}\\])|(?<!\\)\$(?!\$)/g;let m;
    const plain=text=>escapeHTML(text).replace(/~/g,'&nbsp;').replace(/\n/g,'<br>');
    while((m=re.exec(s))){html+=plain(s.slice(pos,m.index));const name=m[0];let end=re.lastIndex;
      if(name==='\\('||name==='$'){const close=name==='$'?'$':'\\)';end=s.indexOf(close,end);if(end<0)throw new Error('Формула ещё не закрыта: '+close);html+=this.formula(s.slice(re.lastIndex,end),false);end+=close.length;}
      else if(/^\\[%&#_$~{}]$/.test(name))html+=escapeHTML(name[1]);
      else if(name==='\\\\'){html+='<br>';if(s[end]==='[')end=groupAt(s,end,'[',']').end;}
      else if(['\\centering','\\small','\\normalsize','\\noindent','\\par','\\newpage','\\clearpage'].includes(name)){if(name==='\\par')html+='<br><br>';if(name==='\\newpage'||name==='\\clearpage')html+='<span class="tex-page-break"></span>';}
      else if(name==='\\textwidth'||name==='\\linewidth')throw new Error(`${name} используется в размере изображения`);
      else if(['\\textbf','\\textit','\\emph','\\underline','\\texttt','\\ref','\\eqref','\\cite','\\url','\\label'].includes(name)){
        let note='';if(name==='\\cite'&&s[end]==='['){const g=groupAt(s,end,'[',']');note=g.value;end=g.end;}
        const g=groupAt(s,end);end=g.end;
        if(name==='\\ref'||name==='\\eqref'){const n=ctx.refs.get(g.value);if(n===undefined)ctx.warn(`Не найдена метка: ${g.value}`);html+=`<a class="tex-reference" href="#${escapeHTML(anchor(g.value))}">${name==='\\eqref'?'(':''}${escapeHTML(n??'??')}${name==='\\eqref'?')':''}</a>`;}
        else if(name==='\\cite'){html+='['+g.value.split(',').map(k=>{k=k.trim();const n=ctx.citations.get(k);if(!n)ctx.warn(`Не найден источник: ${k}`);return `<a class="tex-reference" href="#${escapeHTML(anchor('bib:'+k))}">${escapeHTML(n??'?')}</a>`;}).join(', ')+(note?', '+this.inline(note,ctx,level+1):'')+']';}
        else if(name==='\\label'){}
        else if(name==='\\url'){html+=`<span class="tex-url">${escapeHTML(g.value)}</span>`;}
        else{const tag={'\\textbf':'strong','\\textit':'em','\\emph':'em','\\underline':'u','\\texttt':'code'}[name];html+=`<${tag}>${this.inline(g.value,ctx,level+1)}</${tag}>`;}
      }else throw new Error(`Команда ${name} не поддерживается в черновом тексте`);
      pos=end;re.lastIndex=end;
    }return html+plain(s.slice(pos));
  }
  renderBlock(b,ctx){
    if(b.incomplete)throw new Error(b.error||'Блок ещё не закрыт');const ids=(b.ids||[]).map(id=>`<span id="${escapeHTML(anchor(id))}"></span>`).join('');let html='';
    if(b.kind==='math'){
      const format=tex=>{if(/^(align|flalign)/.test(b.env)||b.env==='aligned')return `\\begin{aligned}${tex}\\end{aligned}`;if(/^(gather|multline)/.test(b.env)||tex.includes('\\\\'))return `\\begin{gathered}${tex}\\end{gathered}`;return tex;};
      if(b.numbered)html=b.rows.map(row=>`<div class="tex-equation">${row.ids.map(id=>`<span class="tex-anchor" id="${escapeHTML(anchor(id))}"></span>`).join('')}<div>${this.formula(format(row.tex),true)}</div><span class="tex-equation-number">${row.number?'('+escapeHTML(row.number)+')':''}</span></div>`).join('');
      else html=b.rows.flatMap(r=>r.ids).map(id=>`<span id="${escapeHTML(anchor(id))}"></span>`).join('')+this.formula(format(b.rows.map(r=>r.tex).join('\\\\')),true);
    }else if(b.kind==='heading')html=`<h${b.level}>${b.number?escapeHTML(b.number)+' ':''}${this.inline(b.raw,ctx)}</h${b.level}>`;
    else if(b.kind==='text')html=b.raw.trim()?`<p>${this.inline(b.raw,ctx)}</p>`:'';
    else if(b.kind==='bibliographystyle')html='';
    else if(b.kind==='includegraphics'){
      const url=this.resolveImage(b.raw);if(!url){const error=new Error(`Изображение ${b.raw} не загружено`);error.code='asset';throw error;}
      if(!/^(blob:|data:image\/(?:png|jpeg|webp);base64,)/.test(url))throw new Error('Разрешены только локально импортированные изображения');
      let style='',match;const width=/(?:^|,)\s*width\s*=\s*([^,]+)/.exec(b.option||'')?.[1]?.trim();
      if(width){if((match=/^(\d*(?:\.\d+)?)\\(?:textwidth|linewidth)$/.exec(width)))style=`width:${Math.max(1,Math.min(100,Number(match[1]||1)*100))}%`;else if(/^\d+(?:\.\d+)?(?:cm|mm|pt|em|px)$/.test(width))style=`width:${width}`;else throw new Error('Размер изображения: width=0.8\\linewidth или width=8cm');}
      html=`<img class="tex-image" src="${escapeHTML(url)}" alt="${escapeHTML(b.raw)}" style="${style}" decoding="async">`;
    }else if(b.kind==='figure'||b.kind==='table'){
      const caption=b.caption?`<figcaption>${b.kind==='figure'?'Рисунок':'Таблица'} ${b.number}. ${this.inline(b.caption,ctx)}</figcaption>`:'';const children=b.children.map(child=>this.renderBlock(child,ctx)).join('');html=`<figure class="tex-${b.kind}">${b.kind==='table'?caption:''}${children}${b.kind==='figure'?caption:''}</figure>`;
    }else if(b.kind==='tabular'){
      const cols=columns(b.spec),borders=columnRules(b.spec),rows=tableRows(b.raw);
      html='<div class="tex-table-scroll"><table class="tex-tabular"><tbody>'+rows.map(row=>{let col=0;return '<tr>'+splitTop(row.raw,'&').map(cell=>{
        let span=1,alignment;const multi=/^\s*\\multicolumn/.exec(cell);if(multi){const g=commandArgs(cell,multi[0].length,3);span=Number(g.args[0]);if(!Number.isInteger(span)||span<1||span>cols.length)throw new Error('Некорректный multicolumn');alignment={l:'left',c:'center',r:'right'}[g.args[1].replace(/\|/g,'')];cell=g.args[2];}
        const start=col,spec=cols[col];if(!spec||col+span>cols.length)throw new Error('В строке больше ячеек, чем столбцов');col+=span;
        let style=`text-align:${alignment||spec.align};${spec.width?'width:'+spec.width+';':''}`;
        if(borders.has(start))style+='border-left:1px solid currentColor;';if(borders.has(col))style+='border-right:1px solid currentColor;';
        for(const side of ['top','bottom']){const line=row[side].find(line=>start+1<=line.to&&col>=line.from);if(line)style+=`border-${side}:${line.width}px solid currentColor;`;}
        return `<td colspan="${span}" style="${style}">${this.inline(cell.trim(),ctx)}</td>`;
      }).join('')+'</tr>';}).join('')+'</tbody></table></div>';
    }else if(['enumerate','itemize','description'].includes(b.kind)){
      const tag=b.kind==='enumerate'?'ol':b.kind==='itemize'?'ul':'dl';html=`<${tag} class="tex-list">`+b.items.map(item=>b.kind==='description'?`<dt>${this.inline(item.term,ctx)}</dt><dd>${item.children.map(child=>this.renderBlock(child,ctx)).join('')}</dd>`:`<li>${item.term?'<span class="tex-item-label">'+this.inline(item.term,ctx)+'</span>':''}${item.children.map(child=>this.renderBlock(child,ctx)).join('')}</li>`).join('')+`</${tag}>`;
    }else if(b.kind==='thebibliography'||b.kind==='bibliography'){
      const entries=b.kind==='thebibliography'?b.items:b.entries;html='<section class="tex-bibliography"><h2>Список литературы</h2><ol>'+entries.map(entry=>{
        let body;if(b.kind==='thebibliography')body=entry.children.map(child=>this.renderBlock(child,ctx)).join('');else{const f=entry.fields;body=[f.author?.replace(/\s+and\s+/g,', '),f.title,f.journal||f.booktitle||f.publisher,f.year,f.doi?'DOI: '+f.doi:f.url].filter(Boolean).map(v=>this.inline(v.replace(/[{}]/g,''),ctx)).join('. ');}
        return `<li id="${escapeHTML(anchor('bib:'+entry.key))}" value="${entry.number}">${body}</li>`;
      }).join('')+'</ol></section>';
    }return ids+html;
  }
  render(source){
    const started=performance.now(),issues=[];let blocks,plan;
    try{blocks=scan(source);plan=this.plan(blocks);}catch(error){return{blocks:this.previous,issues:[{from:0,message:error.message}],ms:performance.now()-started};}
    if(plan.signature!==this.referenceSignature){this.referenceSignature=plan.signature;this.referenceVersion++;}
    const rendered=blocks.map((block,i)=>{
      const ctx={...plan,warn:message=>issues.push({from:block.from,message})};
      const key=JSON.stringify([block,this.referenceVersion,this.assetVersion],(key,value)=>key==='from'||key==='entries'?undefined:value);let html;
      try{const cached=this.cache.get(key);if(cached){html=cached.html;for(const message of cached.warnings)ctx.warn(message);}else{const start=issues.length;html=this.renderBlock(block,ctx);this.cache.set(key,{html,warnings:issues.slice(start).map(i=>i.message)});}return{...block,html,valid:true};}
      catch(error){issues.push({from:block.from,message:error.message.replace(/^KaTeX parse error: /,''),code:error.code});const old=this.previous[i],retained=old?.kind===block.kind&&old.valid;html=retained?old.html:`<div class="unfinished">${escapeHTML(block.raw||'Пиши формулу…')}</div>`;return{...block,html,valid:retained,stale:true};}
    });this.previous=rendered;
    if(this.cache.size>600)this.cache=new Map([...this.cache].slice(-300));if(this.mathCache.size>1000)this.mathCache=new Map([...this.mathCache].slice(-600));
    return{blocks:rendered,issues,ms:performance.now()-started};
  }
}
