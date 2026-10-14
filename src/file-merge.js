import {diffArrays,diffChars} from 'diff';
function lineDiff(a,b){
  // Unique unchanged lines are cheap anchors: scattered edits stay linear/log-linear.
  const positions=new Map(),counts=new Map();a.forEach((line,i)=>positions.set(line,positions.has(line)?-1:i));b.forEach(line=>counts.set(line,(counts.get(line)||0)+1));
  const pairs=[];b.forEach((line,j)=>{const i=positions.get(line);if(i>=0&&counts.get(line)===1)pairs.push({i,j,prev:-1});});
  const tails=[];pairs.forEach((p,k)=>{let l=0,r=tails.length;while(l<r){const m=(l+r)>>1;if(pairs[tails[m]].i<p.i)l=m+1;else r=m;}p.prev=l?tails[l-1]:-1;tails[l]=k;});
  const anchors=[];for(let k=tails.at(-1);k!==undefined&&k>=0;k=pairs[k].prev)anchors.push(pairs[k]);anchors.reverse();
  if(!anchors.length)return diffArrays(a,b,{timeout:20,maxEditLength:4000});
  const out=[];let i=0,j=0;
  for(const anchor of [...anchors,{i:a.length,j:b.length}]){if(anchor.i>i||anchor.j>j){const gap=diffArrays(a.slice(i,anchor.i),b.slice(j,anchor.j),{timeout:10,maxEditLength:2000});if(gap)out.push(...gap);else{out.push({removed:true,value:a.slice(i,anchor.i)},{added:true,value:b.slice(j,anchor.j)});}}if(anchor.i<a.length)out.push({value:[a[anchor.i]]});i=anchor.i+1;j=anchor.j+1;}return out;
}
function edits(base,next,chars=false){
  if(base===next)return[];
  const parts=chars?diffChars(base,next,{timeout:15,maxEditLength:4000}):lineDiff(base.match(/[^\n]*\n|[^\n]+$/g)||[],next.match(/[^\n]*\n|[^\n]+$/g)||[]);
  if(!parts){let from=0,end=0;while(from<base.length&&from<next.length&&base[from]===next[from])from++;while(end<base.length-from&&end<next.length-from&&base[base.length-1-end]===next[next.length-1-end])end++;return[{from,to:base.length-end,insert:next.slice(from,next.length-end)}];}
  let at=0,pending=null;const changes=[];
  for(const p of parts){const text=chars?p.value:p.value.join('');if(p.added||p.removed){pending??={from:at,to:at,insert:''};if(p.added)pending.insert+=text;else{at+=text.length;pending.to=at;}}else{if(pending){changes.push(pending);pending=null;}at+=text.length;}}
  if(pending)changes.push(pending);if(chars)return changes;
  return changes.flatMap(c=>{const old=base.slice(c.from,c.to).match(/[^\n]*\n|[^\n]+$/g)||[],next=c.insert.match(/[^\n]*\n|[^\n]+$/g)||[];if(!old.length||!next.length)return[c];let at=c.from;const split=[];for(let i=0;i<Math.max(old.length,next.length);i++){const to=at+(old[i]?.length||0);split.push({from:at,to,insert:next[i]||''});at=to;}return split;});
}
function overlaps(a,b){if(a.from===a.to&&b.from===b.to)return a.from===b.from;if(a.from===a.to)return a.from>b.from&&a.from<b.to;if(b.from===b.to)return b.from>a.from&&b.from<a.to;return Math.max(a.from,b.from)<Math.min(a.to,b.to);}
function apply(base,changes,offset=0){let at=offset,out='';for(const c of changes){out+=base.slice(at-offset,c.from-offset)+c.insert;at=c.to;}return out+base.slice(at-offset);}
function readableConflicts(plan){
  // Review complete lines, not isolated matching letters inside two different words.
  const ranges=plan.conflicts.map(p=>({from:plan.base.lastIndexOf('\n',p.from-1)+1,to:(()=>{const n=plan.base.indexOf('\n',Math.max(p.from,p.to-1));return n<0?plan.base.length:n+1;})()}));
  for(const r of ranges){let again=true;while(again){again=false;for(const p of plan.parts)if(overlaps(r,p)&&(p.from<r.from||p.to>r.to)){r.from=Math.min(r.from,p.from);r.to=Math.max(r.to,p.to);again=true;}}}
  ranges.sort((a,b)=>a.from-b.from);const merged=[];for(const r of ranges){const last=merged.at(-1);if(last&&r.from<last.to)last.to=Math.max(last.to,r.to);else merged.push(r);}
  const used=new Set(),parts=[];for(const r of merged){const inside=plan.parts.filter(p=>p.from>=r.from&&p.to<=r.to&&(p.from<r.to||r.from===r.to||r.to===plan.base.length));inside.forEach(p=>used.add(p));const base=plan.base.slice(r.from,r.to),variant=side=>apply(base,inside.map(p=>({...p,insert:p.insert??p[side]})),r.from);parts.push({...r,base,local:variant('local'),remote:variant('remote'),conflict:0});}parts.push(...plan.parts.filter(p=>!used.has(p)));return parts.sort((a,b)=>a.from-b.from||a.to-b.to);
}
export function mergeText(base,local,remote,refine=true){
  if(local===base)return{parts:[],conflicts:[],text:remote};if(remote===base||remote===local)return{parts:[],conflicts:[],text:local};
  const changes=[...edits(base,local,!refine).map(c=>({...c,side:'local'})),...edits(base,remote,!refine).map(c=>({...c,side:'remote'}))].sort((a,b)=>a.from-b.from||a.to-b.to);
  const groups=[];
  for(const c of changes){const last=groups.at(-1);if(last&&last.some(p=>overlaps(p,c)))last.push(c);else groups.push([c]);}
  const parts=[],conflicts=[];
  for(const group of groups){const from=Math.min(...group.map(c=>c.from)),to=Math.max(...group.map(c=>c.to)),old=base.slice(from,to),mine=group.filter(c=>c.side==='local'),theirs=group.filter(c=>c.side==='remote');
    const l=apply(old,mine,from),r=apply(old,theirs,from);let insert;
    if(!mine.length)insert=r;else if(!theirs.length||l===r)insert=l;
    else if(refine){const sub=mergeText(old,l,r,false);if(!sub.conflicts.length)insert=sub.text;else{for(const p of readableConflicts(sub)){const mapped={...p,from:p.from+from,to:p.to+from};if(p.conflict!==undefined){mapped.conflict=conflicts.length;conflicts.push(mapped);}parts.push(mapped);}continue;}}
    const part={from,to,insert,local:l,remote:r,base:old};if(insert===undefined){part.conflict=conflicts.length;conflicts.push(part);}parts.push(part);
  }
  const plan={base,parts,conflicts};plan.text=resolveText(plan);return plan;
}
export function resolveText(plan,choices=[]){if(!plan.parts.length)return plan.text;return apply(plan.base,plan.parts.map(p=>({...p,insert:p.insert??(choices[p.conflict]==='remote'?p.remote:choices[p.conflict]==='both'?p.local+(p.local.endsWith('\n')||p.remote.startsWith('\n')?'':'\n')+p.remote:p.local)})));}
export function editorChanges(before,after){return edits(before,after);}
const same=(a,b)=>a===b||!!a&&!!b&&a.mime===b.mime&&a.data===b.data;
export function mergeAssets(base,local,remote){const assets=Object.create(null),conflicts=[];for(const name of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)])){const b=base[name],l=local[name],r=remote[name];if(same(l,b)){if(r)assets[name]=r;}else if(same(r,b)||same(l,r)){if(l)assets[name]=l;}else{if(l)assets[name]=l;conflicts.push({name,local:l,remote:r});}}return{assets,conflicts};}
export function sameAssets(a,b){const names=Object.keys(a);return names.length===Object.keys(b).length&&names.every(n=>same(a[n],b[n]));}
