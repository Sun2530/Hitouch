/* Hitouch · Markdown 渲染（无依赖，highlight.js 可选） */
(function () {
  'use strict';

  function escHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  const escAttr = (s) => escHtml(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* 只认 http/https；javascript:、file: 之类一律不生成链接 */
  function safeHref(raw) {
    const u = String(raw).replace(/&amp;/g, '&').trim();
    if (!/^https?:\/\//i.test(u)) return '';
    try { return new URL(u).href; } catch (_) { return ''; }
  }

  function inlineMd(s) {
    const spans = [];

    /* 行内代码先挖出来，免得里面的星号被后面的规则误伤 */
    s = s.replace(/`([^`\n]+)`/g, (_m, code) => {
      spans.push(`<code>${code}</code>`);
      return `\u0001${spans.length - 1}\u0001`;
    });

    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, text, url) => {
      const h = safeHref(url);
      return h ? `<a href="${escAttr(h)}" data-ext="1">${text}</a>` : m;
    });

    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
      const h = safeHref(url);
      return h ? `${pre}<a href="${escAttr(h)}" data-ext="1">${url}</a>` : m;
    });

    s = s.replace(/\u0001(\d+)\u0001/g, (_m, i) => spans[+i]);
    return s;
  }

  function codeHtml(block) {
    const lang = block.lang || '';
    let body;
    try {
      if (window.hljs && lang && window.hljs.getLanguage(lang)) {
        body = window.hljs.highlight(block.code, { language: lang, ignoreIllegals: true }).value;
      } else {
        body = escHtml(block.code);
      }
    } catch (_) {
      body = escHtml(block.code);
    }

    return `<div class="code"><div class="cb-bar"><span class="cb-lang">${escHtml(lang || 'code')}</span>` +
      '<button class="cb-copy" type="button">复制</button></div>' +
      `<pre><code class="hljs">${body}</code></pre></div>`;
  }

  const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?(\s*\|\s*:?-{2,}:?)+\s*\|?\s*$/;
  const splitRow = (line) => {
    let t = line.trim();
    if (t.startsWith('|')) t = t.slice(1);
    if (t.endsWith('|')) t = t.slice(0, -1);
    return t.split('|').map((c) => c.trim());
  };

  function renderMd(src) {
    const blocks = [];
    let s = String(src || '');

    /* 围栏代码块先整段取走，剩下的才按行排版 */
    s = s.replace(/```([a-zA-Z0-9_+#.-]*)[ \t]*\n([\s\S]*?)```/g, (_m, lang, code) => {
      blocks.push({ lang: lang.toLowerCase(), code: code.replace(/\n$/, '') });
      return `\u0000B${blocks.length - 1}\u0000`;
    });

    s = escHtml(s);
    const lines = s.split('\n');
    const out = [];
    let i = 0;

    const startsBlock = (idx) => {
      const l = lines[idx];
      return /^#{1,6}\s/.test(l) ||
        /^\s*&gt;/.test(l) ||
        /^\s*([-*+]|\d+[.)])\s+/.test(l) ||
        /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) ||
        /^\u0000B\d+\u0000$/.test(l.trim()) ||
        (l.includes('|') && idx + 1 < lines.length && TABLE_SEP.test(lines[idx + 1]));
    };

    while (i < lines.length) {
      const line = lines[i];

      if (!line.trim()) { i += 1; continue; }

      const ph = /^\u0000B(\d+)\u0000$/.exec(line.trim());
      if (ph) { out.push(codeHtml(blocks[+ph[1]])); i += 1; continue; }

      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      if (h) {
        const n = h[1].length;
        out.push(`<h${n}>${inlineMd(h[2])}</h${n}>`);
        i += 1;
        continue;
      }

      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push('<hr>'); i += 1; continue; }

      if (/^\s*&gt;/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*&gt;/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*&gt;\s?/, ''));
          i += 1;
        }
        out.push(`<blockquote>${inlineMd(buf.join('<br>'))}</blockquote>`);
        continue;
      }

      if (line.includes('|') && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
        const head = splitRow(line).map(inlineMd);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
          rows.push(splitRow(lines[i]).map(inlineMd));
          i += 1;
        }
        out.push('<div class="tbl"><table><thead><tr>' +
          head.map((c) => `<th>${c}</th>`).join('') +
          '</tr></thead><tbody>' +
          rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('') +
          '</tbody></table></div>');
        continue;
      }

      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        while (i < lines.length) {
          const m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
          if (!m) {
            /* 缩进续行并进上一条 */
            if (items.length && /^\s{2,}\S/.test(lines[i])) {
              items[items.length - 1] += '<br>' + inlineMd(lines[i].trim());
              i += 1;
              continue;
            }
            break;
          }
          items.push(inlineMd(m[2]));
          i += 1;
        }
        out.push(ordered
          ? `<ol>${items.map((x) => `<li>${x}</li>`).join('')}</ol>`
          : `<ul>${items.map((x) => `<li>${x}</li>`).join('')}</ul>`);
        continue;
      }

      const buf = [line];
      i += 1;
      while (i < lines.length && lines[i].trim() && !startsBlock(i)) {
        buf.push(lines[i]);
        i += 1;
      }
      out.push(`<p>${inlineMd(buf.join('<br>'))}</p>`);
    }

    return out.join('');
  }

  window.escHtml = escHtml;
  window.escAttr = escAttr;
  window.safeHref = safeHref;
  window.renderMd = renderMd;
})();
