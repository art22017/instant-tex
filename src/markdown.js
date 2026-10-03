import MarkdownIt from 'markdown-it';
import texmath from 'markdown-it-texmath';
import katex from 'katex';
const md=new MarkdownIt({html:false,linkify:false,breaks:true}).use(texmath,{engine:katex,delimiters:['dollars','brackets','beg_end'],katexOptions:{trust:false,strict:'ignore',throwOnError:false,maxExpand:1000}});
md.renderer.rules.image=(tokens,i)=>md.utils.escapeHtml(tokens[i].content);
export const renderMarkdown=text=>md.render(text||'');
