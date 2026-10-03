import {snippet,acceptCompletion,completionStatus,startCompletion} from '@codemirror/autocomplete';
import {Prec} from '@codemirror/state';
import {keymap} from '@codemirror/view';

const entry=(name,template,detail)=>({name:'\\'+name,template,detail});
const env=(name,detail)=>entry(`begin{${name}}`,`\\begin{${name}}\n\t\${}\n\\end{${name}}`,detail);
export const builtins = [
  entry('frac','\\frac{${}}{${}}','Дробь'),entry('dfrac','\\dfrac{${}}{${}}','Дробь в полный размер'),
  entry('tfrac','\\tfrac{${}}{${}}','Маленькая дробь'),entry('sqrt','\\sqrt{${}}','Корень'),
  ...['binom','dbinom','tbinom','overset','underset','stackrel','textcolor'].map(n=>entry(n,`\\${n}{\${}}{\${}}`,n)),
  ...['cancel','bcancel','xcancel','boldsymbol','phantom','hphantom','vphantom','color'].map(n=>entry(n,`\\${n}{\${}}`,n)),
  entry('underbrace','\\underbrace{${}}_{${}}','Подпись под выражением'),entry('overbrace','\\overbrace{${}}^{${}}','Подпись над выражением'),
  entry('sqrt[n]','\\sqrt[${}]{${}}','Корень n-й степени'),entry('boxed','\\boxed{${}}','Ответ в рамке'),
  ...['text','textbf','textit','emph','underline','overline','vec','hat','bar','dot','ddot','mathbb','mathcal','mathrm','mathbf','mathit','operatorname','section','subsection','subsubsection'].map(n=>entry(n,`\\${n}{\${}}`,n)),
  ...['sum','prod','int','iint','oint'].map(n=>entry(n,`\\${n}_{\${}}^{\${}} \${}`,n)),
  entry('lim','\\lim_{${}} ${}','Предел'),
  entry('left','\\left( ${} \\right)','Авторазмер скобок'),
  entry('left[','\\left[ ${} \\right]','Квадратные скобки'),
  entry('left\\{','\\left\\{ ${} \\right\\}','Фигурные скобки'),
  entry('[','\\[\n\t${}\n\\]','Отдельная формула'),entry('(','\\(${}\\)','Формула в строке'),
  ...['gather','gather*','align','align*','aligned','gathered','equation','equation*','cases','pmatrix','bmatrix','matrix','vmatrix','Vmatrix','split'].map(n=>env(n,'Окружение '+n)),
  ...['gather','gather*','align','align*','aligned','gathered','equation','equation*','cases','pmatrix','bmatrix','matrix','vmatrix','Vmatrix','split'].map(n=>entry(`end{${n}}`,`\\end{${n}}`,'Закрыть окружение')),
  ...('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi varpi rho varrho sigma varsigma tau upsilon phi varphi chi psi omega Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega infty partial nabla forall exists nexists in notin ni subset subseteq supset supseteq emptyset cup cap setminus land lor neg implies iff to mapsto rightarrow leftarrow Rightarrow Leftarrow Leftrightarrow cdot dots ldots cdots vdots ddots times div pm mp le leq ge geq neq approx sim simeq equiv propto perpendicular perp parallel angle triangle square qed quad qquad sin cos tan cot arcsin arccos arctan sinh cosh log ln exp min max sup inf det gcd limsup liminf big Big bigg Bigg displaystyle textstyle').split(' ').map(n=>entry(n,'\\'+n,n))
];

export function extractCommands(source) {
  const found=new Map();
  for(const m of source.matchAll(/\\[a-zA-Z]+\*?|\\[()[\]]/g)) {
    let name=m[0],cursor=m.index+name.length,arity=0;
    if(name==='\\begin'||name==='\\end'){
      const e=/^\{([a-zA-Z]+\*?)\}/.exec(source.slice(cursor));
      if(e){name+=e[0];cursor+=e[0].length;}
    } else {
      while(arity<8&&source[cursor]==='{'){
        let depth=1;cursor++;
        while(cursor<source.length&&depth){if(source[cursor]==='{'&&source[cursor-1]!=='\\')depth++;if(source[cursor]==='}'&&source[cursor-1]!=='\\')depth--;cursor++;}
        if(depth)break;arity++;
      }
    }
    if(name.startsWith('\\end'))continue;
    const template=name.startsWith('\\begin{')?`${name}\n\t\${}\n\\end{${name.slice(7,-1)}}`:name+'{${}}'.repeat(arity);
    const old=found.get(name);
    if(!old||template.length>old.template.length)found.set(name,{name,template,detail:'Из документа'});
  }
  return [...found.values()];
}

export class CommandDictionary {
  constructor(saved=[],persist=()=>{},now=()=>Date.now()){
    this.saved=new Map(saved.map(e=>[e.name,e]));this.persist=persist;this.now=now;this.stable=new Map();this.pendingCounts=new Map();
  }
  options(source){
    const merged=new Map(builtins.map(e=>[e.name,{...e,uses:this.saved.get(e.name)?.uses||0}]));
    for(const e of this.saved.values())if(!merged.has(e.name))merged.set(e.name,e);
    for(const e of extractCommands(source))if(!merged.has(e.name))merged.set(e.name,{...e,uses:this.pendingCounts.get(e.name)||0});
    return [...merged.values()].sort((a,b)=>(b.uses||0)-(a.uses||0)||a.name.localeCompare(b.name));
  }
  used(item){
    if(!this.saved.has(item.name)&&!builtins.some(e=>e.name===item.name)){this.pendingCounts.set(item.name,(this.pendingCounts.get(item.name)||0)+1);return;}
    const old=this.saved.get(item.name);this.saved.set(item.name,{name:item.name,template:item.template,detail:item.detail,uses:(old?.uses||0)+1});this.persist([...this.saved.values()]);
  }
  observe(source,valid){
    if(!valid){this.stable.clear();return;}
    const commands=extractCommands(source),seen=new Set(commands.map(e=>e.name));
    for(const name of this.stable.keys())if(!seen.has(name))this.stable.delete(name);
    let changed=false;
    for(const item of commands){
      const prior=this.stable.get(item.name);
      if(!prior||prior.template!==item.template)this.stable.set(item.name,{template:item.template,since:this.now()});
      else if(this.now()-prior.since>=60000&&!this.saved.has(item.name)){
        this.saved.set(item.name,{...item,uses:this.pendingCounts.get(item.name)||0});changed=true;
      }
    }
    if(changed)this.persist([...this.saved.values()]);
  }
}

function matchingPositions(name,query,offset){
  if(!query)return[];const positions=[];let from=0;
  for(const c of query){const at=name.indexOf(c,from);if(at<0)return null;positions.push(at+offset,at+offset+1);from=at+1;}
  return positions;
}
export function rankedCommands(items,typed){
  const text=typed.replace(/^\\/,'');
  const wrapper=/^(begin|end)(?:\{([^}]*)(?:\})?)?$/.exec(text)||
    ('begin'.startsWith(text)&&text.length>=3?['','begin','']:'end'.startsWith(text)&&text.length>=2?['','end','']:null);
  const query=(wrapper?wrapper[2]||'':text).toLowerCase();
  return items.map(item=>{
    const environment=/^\\(begin|end)\{([^}]+)\}$/.exec(item.name);
    if(wrapper&&(!environment||environment[1]!==wrapper[1]))return null;
    const name=(environment?environment[2]:item.name.slice(1)).toLowerCase();
    const matches=matchingPositions(name,query,environment?(environment[1]==='begin'?7:5):1);if(matches===null)return null;
    const group=environment?(environment[1]==='end'?2:query?0:1):(query?1:0);
    const prefix=name.startsWith(query)?0:1;
    return{...item,matches,group,prefix};
  }).filter(Boolean).sort((a,b)=>a.group-b.group||a.prefix-b.prefix||(b.uses||0)-(a.uses||0)||a.name.localeCompare(b.name));
}
export function completionSource(dictionary){
  return ctx=>{
    const line=ctx.state.doc.lineAt(ctx.pos),prefix=ctx.state.doc.sliceString(line.from,ctx.pos);
    const match=/\\(?:(?:begin|end)\{[^}]*\}?|[a-zA-Z]*\*?|[()[\]])$/.exec(prefix);
    if(!match&&!ctx.explicit)return null;
    const from=match?ctx.pos-match[0].length:ctx.pos;
    const source=ctx.state.doc.toString();
    const vocabulary=source.slice(0,from)+' '.repeat(ctx.pos-from)+source.slice(ctx.pos);
    const options=rankedCommands(dictionary.options(vocabulary),match?.[0]||'').map(item=>({
      label:item.name,detail:item.uses?`${item.detail} · ${item.uses}`:item.detail,type:'keyword',matches:item.matches,
      apply(view,completion,start,end){snippet(item.template.replace(/\\(?=[{}])/g,'\\\\'))(view,completion,start,end);dictionary.used(item);},
    }));
    // Our order is semantic. Native fuzzy scores/section ranks must not move end above begin.
    return{from,options,filter:false,getMatch:completion=>completion.matches};
  };
}

export function insideDisplay(source,pos){
  const before=source.slice(0,pos).replace(/(?<!\\)%[^\n]*/g,'');
  const stack=[];
  const re=/\\\[|\\\]|(?<!\\)\$\$|\\(begin|end)\{(gather\*?|align\*?|aligned|gathered|equation\*?|cases|[pbvBV]?matrix|split)\}/g;
  for(const m of before.matchAll(re)){
    if(m[0]==='\\[')stack.push('bracket');else if(m[0]==='\\]'){if(stack.at(-1)==='bracket')stack.pop();}
    else if(m[0]==='$$'){if(stack.at(-1)==='dollar')stack.pop();else stack.push('dollar');}
    else if(m[1]==='begin')stack.push(m[2]);else if(stack.at(-1)===m[2])stack.pop();
  }
  return stack.length>0;
}

export function smartEnter(view){
  if(completionStatus(view.state)==='active'&&acceptCompletion(view))return true;
  const range=view.state.selection.main;
  if(!range.empty)return false;
  const source=view.state.doc.toString(),line=view.state.doc.lineAt(range.head);
  if(!insideDisplay(source,range.head))return false;
  const left=source.slice(line.from,range.head),indent=/^\s*/.exec(line.text)[0];
  const content=left.trim();
  const addBreak=content&&!/^\\(?:begin\{[^}]+\}|\[)$/.test(content)&&!content.endsWith('\\\\');
  const text=(addBreak?' \\\\':'')+'\n'+indent;
  view.dispatch({changes:{from:range.head,insert:text},selection:{anchor:range.head+text.length},userEvent:'input'});
  return true;
}
export const completionKeys=Prec.highest(keymap.of([
  {key:'Ctrl-Space',run:startCompletion},{key:'Mod-Space',run:startCompletion},
  {key:'Tab',run:view=>completionStatus(view.state)==='active'&&acceptCompletion(view)},
  {key:'Enter',run:smartEnter},{key:'Shift-Enter',run:view=>{const r=view.state.selection.main;view.dispatch({changes:{from:r.from,to:r.to,insert:'\n'},selection:{anchor:r.from+1}});return true;}}
]));
