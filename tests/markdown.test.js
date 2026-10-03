import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMarkdown} from '../src/markdown.js';
test('AI Markdown renders tables, code and all supported math delimiters',()=>{
  const html=renderMarkdown('# Ответ\n\n**Важно** $x$ \\(y\\)\n\n\\[\\boxed{z=1}\\]\n\n```latex\n\\implies\n```\n\n| А | Б |\n|---|---|\n| 1 | 2 |');
  assert.match(html,/<h1>Ответ/);assert.match(html,/<table>/);assert.match(html,/<pre><code class="language-latex">\\implies/);assert.equal((html.match(/class="katex"/g)||[]).length,3);
});
test('Model HTML is escaped, unsafe links and images cannot load',()=>{
  const html=renderMarkdown('<script>alert(1)</script> ![pic](https://example.com/a.png) [x](javascript:alert(1))');
  assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('href="javascript:'));
});
