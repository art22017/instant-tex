import katex from 'katex';

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

export const escapeHTML = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mathEnvs = 'align\\*?|aligned|gather\\*?|equation\\*?|multline\\*?|flalign\\*?';
const displayStart = new RegExp('\\\\\\[|\\$\\$|\\\\begin\\{(' + mathEnvs + ')\\}', 'g');
function escaped(s, i) { let n = 0; while (i > 0 && s[--i] === '\\') n++; return n % 2 === 1; }
function findClose(s, close, from) { let i = s.indexOf(close, from); while (i >= 0 && escaped(s, i)) i = s.indexOf(close, i + close.length); return i; }

// Preserve offsets so diagnostics always point into the original editor buffer.
function prepare(source) {
  let s = source.replace(/(?<!\\)%[^\n]*/g, m => ' '.repeat(m.length));
  const begin = s.indexOf('\\begin{document}');
  if (begin >= 0) s = ' '.repeat(begin + 16) + s.slice(begin + 16);
  else s = s.replace(/\\(?:documentclass|usepackage)(?:\[[^\]]*\])?\{[^}]*\}/g, m => ' '.repeat(m.length));
  return s.replace(/\\end\{document\}/g, m => ' '.repeat(m.length));
}

export function parse(source) {
  const s = prepare(source), blocks = [];
  function textBlocks(start, end) {
    const piece = s.slice(start, end);
    const pattern = /[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g;
    for (const m of piece.matchAll(pattern)) {
      const raw = m[0].trim();
      if (!raw) continue;
      // Headings remain separate even without blank lines.
      const lines = m[0].split('\n');
      let offset = start + m.index, pending = '', pendingStart = offset;
      const flush = () => { if (pending.trim()) blocks.push({kind:'text', raw:pending.trim(), from:pendingStart}); pending = ''; };
      for (const line of lines) {
        const h = /^\s*(?:\\(section|subsection|subsubsection)\*?\{(.*)\}|(#{1,3})\s+(.+))\s*$/.exec(line);
        if (h) { flush(); blocks.push({kind:'heading',raw:h[2] || h[4],level:h[3]?.length || ({section:1,subsection:2,subsubsection:3}[h[1]]),from:offset}); }
        else { if (!pending) pendingStart = offset; pending += line + '\n'; }
        offset += line.length + 1;
      }
      flush();
    }
  }
  let pos = 0, match;
  displayStart.lastIndex = 0;
  while ((match = displayStart.exec(s))) {
    if (escaped(s, match.index)) continue;
    textBlocks(pos, match.index);
    const env = match[1], open = match[0];
    const close = env ? `\\end{${env}}` : open === '$$' ? '$$' : '\\]';
    const bodyStart = match.index + open.length;
    const end = findClose(s, close, bodyStart);
    let raw = s.slice(bodyStart, end < 0 ? s.length : end);
    if(!env&&raw.includes('\\\\'))raw=`\\begin{gathered}${raw}\\end{gathered}`;
    if (env && !/^(equation|gather|multline)/.test(env)) raw = `\\begin{${env === 'aligned' ? 'aligned' : 'aligned'}}${raw}\\end{aligned}`;
    else if (env && /^(gather|multline)/.test(env)) raw = `\\begin{gathered}${raw}\\end{gathered}`;
    blocks.push({kind:'math',raw:raw.trim(),from:match.index,incomplete:end < 0});
    pos = end < 0 ? s.length : end + close.length;
    displayStart.lastIndex = pos;
  }
  textBlocks(pos, s.length);
  return blocks;
}

function formula(s, display) {
  return katex.renderToString(s, {displayMode:display,throwOnError:true,strict:'ignore',trust:false,output:'htmlAndMathml',maxExpand:500,maxSize:20});
}

function inline(s) {
  let html = '', pos = 0;
  const re = /\\\(|(?<!\\)\$(?!\$)|\\(textbf|textit|emph|underline)\{/g;
  let m;
  while ((m = re.exec(s))) {
    if (escaped(s, m.index)) continue;
    html += escapeHTML(s.slice(pos, m.index));
    if (m[1]) {
      let depth = 1, end = re.lastIndex;
      while (end < s.length && depth) { if (!escaped(s,end)) { if (s[end] === '{') depth++; if (s[end] === '}') depth--; } end++; }
      if (depth) throw new Error('Не закрыта скобка в \\' + m[1]);
      const tag = m[1] === 'textbf' ? 'strong' : m[1] === 'underline' ? 'u' : 'em';
      html += `<${tag}>${inline(s.slice(re.lastIndex,end-1))}</${tag}>`;
      pos = end;
    } else {
      const close = m[0] === '\\(' ? '\\)' : '$';
      const end = findClose(s, close, re.lastIndex);
      if (end < 0) throw new Error('Формула ещё не закрыта: ' + close);
      html += formula(s.slice(re.lastIndex,end),false);
      pos = end + close.length;
    }
    re.lastIndex = pos;
  }
  html += escapeHTML(s.slice(pos));
  return html.replace(/\\\\/g,'<br>').replace(/\\([%&#_$])/g,'$1').replace(/~/g,'&nbsp;');
}

export class DraftRenderer {
  constructor() { this.cache = new Map(); this.previous = []; }
  render(source) {
    const started = performance.now(), blocks = parse(source), issues = [];
    const rendered = blocks.map((block, i) => {
      const key = `${block.kind}:${block.level || 0}:${block.raw}`;
      let html;
      try {
        if (block.incomplete) throw new Error('Формула ещё не закрыта');
        // Unsupported text commands are visible and diagnosed, never silently executed.
        if (block.kind !== 'math') {
          const unsupported = /\\(?!textbf\b|textit\b|emph\b|underline\b)[a-zA-Z]+/.exec(block.raw.replace(/\\\([\s\S]*?\\\)|\$[^$]*\$/g,''));
          if (unsupported) throw new Error(`Команда ${unsupported[0]} не поддерживается в черновом тексте`);
        }
        html = this.cache.get(key);
        if (html === undefined) {
          html = block.kind === 'math' ? formula(block.raw,true) : block.kind === 'heading' ? `<h${block.level}>${inline(block.raw)}</h${block.level}>` : `<p>${inline(block.raw).replace(/\n/g,'<br>')}</p>`;
          this.cache.set(key,html);
        }
        return {...block,html,valid:true};
      } catch (e) {
        issues.push({from:block.from,message:e.message.replace(/^KaTeX parse error: /,'')});
        const old = this.previous[i];
        const retained = old?.kind === block.kind && old.valid;
        html = retained ? old.html : `<div class="unfinished">${escapeHTML(block.raw || 'Пиши формулу…')}</div>`;
        return {...block,html,valid:retained,stale:true};
      }
    });
    this.previous = rendered;
    if (this.cache.size > 600) this.cache = new Map([...this.cache].slice(-300));
    return {blocks:rendered,issues,ms:performance.now()-started};
  }
}
