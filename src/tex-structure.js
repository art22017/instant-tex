// Lightweight structural scanner. No TeX process, filesystem or macro execution.
export const escapeHTML=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function groupAt(s,pos,open='{',close='}'){
  while(/\s/.test(s[pos]||'')&&pos<s.length)pos++;
  if(s[pos]!==open)throw new Error(`Ожидается ${open}`);
  const start=++pos;let depth=1;
  for(;pos<s.length;pos++){if(s[pos]==='\\'){pos++;continue;}if(s[pos]===open)depth++;if(s[pos]===close&&!--depth)return{value:s.slice(start,pos),end:pos+1};}
  throw new Error(`Не закрыта ${open}`);
}
export function commandArgs(s,pos,count=1){const args=[];for(let i=0;i<count;i++){const g=groupAt(s,pos);args.push(g.value);pos=g.end;}return{args,end:pos};}
export function splitTop(s,separator){
  const out=[];let start=0,depth=0,env=0;
  for(let i=0;i<s.length;i++){
    if(s[i]==='\\'){
      const m=/^\\(begin|end)\{[^}]+\}/.exec(s.slice(i));if(m){env+=m[1]==='begin'?1:-1;i+=m[0].length-1;continue;}
      if(separator==='\\\\'&&s[i+1]==='\\'&&!depth&&!env){out.push(s.slice(start,i));i++;const space=/^\[[^\]]*\]/.exec(s.slice(i+1));if(space)i+=space[0].length;start=i+1;continue;}
      i++;continue;
    }
    if(s[i]==='{')depth++;if(s[i]==='}')depth--;
    if(separator==='&'&&s[i]==='&'&&!depth&&!env){out.push(s.slice(start,i));start=i+1;}
  }out.push(s.slice(start));return out;
}
export function stripCommand(s,name,onValue=()=>{},preserve=false){
  const re=new RegExp('\\\\'+name+'\\s*\\{','g');let m,out='',pos=0;
  while((m=re.exec(s))){const g=groupAt(s,re.lastIndex-1);out+=s.slice(pos,m.index)+(preserve?' '.repeat(g.end-m.index):'');onValue(g.value);pos=g.end;re.lastIndex=pos;}
  return out+s.slice(pos);
}
const mathNames=new Set(['align','align*','aligned','gather','gather*','equation','equation*','multline','multline*','flalign','flalign*']);
const structural=new Set(['figure','figure*','table','table*','tabular','itemize','enumerate','description','thebibliography',...mathNames]);
function environment(s,start,limit){
  const re=/\\(begin|end)\{([^}]+)\}/g;re.lastIndex=start;let depth=0,m,first;
  while((m=re.exec(s))&&m.index<limit){if(!first)first=m;if(m[1]==='begin')depth++;else if(!--depth){if(m[2]!==first[2])throw new Error(`Ожидается \\end{${first[2]}}`);return{env:first[2],bodyStart:start+first[0].length,end:m.index,to:re.lastIndex};}}
  return{env:first?.[2],bodyStart:start+(first?.[0].length||0),end:limit,to:limit,incomplete:true};
}
export function scan(source,{prepared=false,base=0,depth=0}={}){
  if(depth>20)throw new Error('Слишком большая вложенность окружений');
  let s=source;
  if(!prepared){s=s.replace(/(?<!\\)%[^\n]*/g,m=>' '.repeat(m.length));const begin=s.indexOf('\\begin{document}');if(begin>=0)s=' '.repeat(begin+16)+s.slice(begin+16);else s=s.replace(/\\(?:documentclass|usepackage)(?:\[[^\]]*\])?\{[^}]*\}/g,m=>' '.repeat(m.length));s=s.replace(/\\end\{document\}/g,m=>' '.repeat(m.length));}
  const blocks=[];
  function text(start,end){
    const piece=s.slice(start,end);const re=/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;let m;
    while((m=re.exec(piece))){let pending='',offset=start+m.index,pendingStart=offset;const flush=()=>{if(pending.trim())blocks.push({kind:'text',raw:pending.trim(),from:base+pendingStart});pending='';};
      for(const line of m[0].split('\n')){const h=/^\s*\\(section|subsection|subsubsection)(\*?)\s*(?=\{)/.exec(line),md=/^\s*(#{1,3})\s+(.+)\s*$/.exec(line);if(h||md){flush();let raw;if(h){const g=groupAt(line,h[0].length);raw=g.value+line.slice(g.end);}else raw=md[2];blocks.push({kind:'heading',raw,level:md?.[1].length||({section:1,subsection:2,subsubsection:3}[h[1]]),star:!!md||!!h[2],from:base+offset});}else{if(!pending)pendingStart=offset;pending+=line+'\n';}offset+=line.length+1;}flush();
    }
  }
  const token=/\\begin\{([^}]+)\}|\\\[|(?<!\\)\$\$|\\(includegraphics|bibliography|bibliographystyle)\b/g;let pos=0,m;
  while((m=token.exec(s))){if(m.index&&s[m.index-1]==='\\')continue;if(m[1]&&!structural.has(m[1]))continue;text(pos,m.index);let to,block;
    try{
      if(m[1]){
        const e=environment(s,m.index,s.length);to=e.to;let bodyStart=e.bodyStart,option='';
        if(s[bodyStart]==='['){const g=groupAt(s,bodyStart,'[',']');option=g.value;bodyStart=g.end;}
        let spec='';if(e.env==='tabular'||e.env==='thebibliography'){const g=groupAt(s,bodyStart);spec=g.value;bodyStart=g.end;}
        block={kind:mathNames.has(e.env)?'math':e.env.replace('*',''),env:e.env,raw:s.slice(bodyStart,e.end),spec,option,from:base+m.index,incomplete:e.incomplete};
        if(['figure','table'].includes(block.kind)){
          let body=block.raw;block.labels=[];body=stripCommand(body,'label',v=>block.labels.push(v),true);body=stripCommand(body,'caption',v=>block.caption=v,true);body=body.replace(/\\centering\b/g,m=>' '.repeat(m.length));block.children=scan(body,{prepared:true,base:base+bodyStart,depth:depth+1});
        }
        if(['itemize','enumerate','description','thebibliography'].includes(block.kind)){
          const itemRe=block.kind==='thebibliography'?/\\bibitem(?:\[([^\]]*)\])?\{([^}]+)\}/g:/\\item(?:\[([^\]]*)\])?/g;let depthEnv=0,itemStart=0,current=null;block.items=[];
          const events=/\\(?:begin|end)\{[^}]+\}|\\(?:bibitem(?:\[[^\]]*\])?\{[^}]+\}|item(?:\[[^\]]*\])?)/g;let event;
          while((event=events.exec(block.raw))){if(event[0].startsWith('\\begin')){depthEnv++;continue;}if(event[0].startsWith('\\end')){depthEnv--;continue;}if(depthEnv)continue;itemRe.lastIndex=0;const item=itemRe.exec(event[0]);if(!item)continue;if(current){current.children=scan(block.raw.slice(itemStart,event.index),{prepared:true,base:base+bodyStart+itemStart,depth:depth+1});block.items.push(current);}current={term:item[1]||'',key:item[2],from:base+bodyStart+event.index};itemStart=events.lastIndex;}
          if(current){current.children=scan(block.raw.slice(itemStart),{prepared:true,base:base+bodyStart+itemStart,depth:depth+1});block.items.push(current);}
        }
      }else if(m[2]){
        let at=token.lastIndex,option='';if(s[at]==='['){const g=groupAt(s,at,'[',']');option=g.value;at=g.end;}const g=groupAt(s,at);to=g.end;block={kind:m[2],raw:g.value,option,from:base+m.index};
      }else{
        const close=m[0]==='$$'?'$$':'\\]';let end=s.indexOf(close,token.lastIndex);to=end<0?s.length:end+close.length;block={kind:'math',raw:s.slice(token.lastIndex,end<0?s.length:end),from:base+m.index,incomplete:end<0,env:''};
      }
    }catch(error){block={kind:'text',raw:s.slice(m.index),from:base+m.index,incomplete:true,error:error.message};to=s.length;}
    blocks.push(block);pos=to;token.lastIndex=to;
  }text(pos,s.length);return blocks;
}

export function parseBibtex(text){
  text=text.replace(/(?<!\\)%[^\n]*/g,m=>' '.repeat(m.length));
  const entries=[];const re=/@(\w+)\s*\{/g;let m;
  while((m=re.exec(text))){const entry=groupAt(text,re.lastIndex-1);re.lastIndex=entry.end;if(/^(comment|preamble|string)$/i.test(m[1]))continue;const comma=entry.value.indexOf(',');if(comma<0)continue;const key=entry.value.slice(0,comma).trim(),fields={};let pos=comma+1;
    while(pos<entry.value.length){const field=/^\s*,?\s*(\w+)\s*=\s*/.exec(entry.value.slice(pos));if(!field)break;pos+=field[0].length;let value;if(entry.value[pos]==='{'){const g=groupAt(entry.value,pos);value=g.value;pos=g.end;}else if(entry.value[pos]==='"'){let end=pos+1;while(end<entry.value.length&&(entry.value[end]!=='"'||entry.value[end-1]==='\\'))end++;value=entry.value.slice(pos+1,end);pos=end+1;}else{const end=entry.value.indexOf(',',pos);value=entry.value.slice(pos,end<0?entry.value.length:end).trim();pos=end<0?entry.value.length:end;}fields[field[1].toLowerCase()]=value;}
    if(key)entries.push({key,fields});
  }return entries;
}
