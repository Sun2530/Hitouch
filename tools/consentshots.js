/* 条款弹窗验证：初始态 / 勾选态 / 滚到底 / 同意后主页 / 设置里的 GitHub 行 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.argv[3] || '9222';
const OUT = process.argv[2] || 'shots-consent';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT + '/run.log', '');
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const send = (m, p = {}) => new Promise((r) => {
    const i = ++id;
    pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const log = (m) => { try { fs.appendFileSync(OUT + '/run.log', m + '\n'); } catch (_) {} };
  const js = async (x) => {
    log('js> ' + String(x).replace(/\s+/g, ' ').slice(0, 60));
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    log('js< ' + JSON.stringify(r).slice(0, 90));
    return r.result ? r.result.value : undefined;
  };
  await send('Page.bringToFront');
  const shot = async (n) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
  };
  const crop = async (n, sel, pad = 12, scale = 2) => {
    const r = await js(`(()=>{const b=document.querySelector('${sel}').getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale },
    });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
  };

  const st = await js(`JSON.stringify({open:document.getElementById('consentModal').classList.contains('is-open'),noConsent:document.body.classList.contains('no-consent'),disabled:document.getElementById('input').disabled,vis:document.visibilityState})`);
  console.log('STATE', st);
  if (!JSON.parse(st).open) {
    await js(`(()=>{
      document.body.classList.add('no-consent');
      const m=document.getElementById('consentModal');
      m.classList.add('is-open'); m.setAttribute('aria-hidden','false');
      document.getElementById('ctCheck').setAttribute('aria-checked','false');
      document.getElementById('ctAccept').disabled=true;
      document.getElementById('ctBody').scrollTop=0;
      return 'forced';
    })()`);
    await sleep(500);
  }
  await shot('c0-open');
  await crop('c1-card', '.consent-card', 14, 2.4);

  const meta = await js(`JSON.stringify((()=>{
    const c=document.querySelector('.consent-card'), b=document.getElementById('ctBody');
    return {cardH:c.offsetHeight, bodyH:b.clientHeight, scrollH:b.scrollHeight, canScroll:b.scrollHeight>b.clientHeight+2,
            acceptDisabled:document.getElementById('ctAccept').disabled};
  })())`);
  console.log('META', meta);

  /* 勾选 */
  await js(`document.getElementById('ctCheck').click()`);
  await sleep(320);
  const checked = await js(`JSON.stringify({aria:document.getElementById('ctCheck').getAttribute('aria-checked'),disabled:document.getElementById('ctAccept').disabled})`);
  console.log('CHECKED', checked);
  await crop('c2-checked', '.ct-foot', 12, 3);

  /* 滚到底 */
  await js(`(()=>{const b=document.getElementById('ctBody');b.scrollTop=b.scrollHeight;return b.scrollTop})()`);
  await sleep(400);
  await shot('c3-bottom');

  /* 点同意 */
  await js(`document.getElementById('ctAccept').click()`);
  await sleep(700);
  const after = await js(`JSON.stringify({open:document.getElementById('consentModal').classList.contains('is-open'), noConsent:document.body.classList.contains('no-consent'), agreed:CONFIG.consent.agreed, disabled:document.getElementById('input').disabled})`);
  console.log('AFTER', after);
  await shot('c4-home');

  /* 设置面板里的 GitHub 行 */
  await js(`document.getElementById('aboutBtn').click()`);
  await sleep(400);
  await crop('c5-about', '.pop-top', 14, 2.4);
  const repo = await js(`JSON.stringify({exists:!!document.getElementById('repoBtn'), label:document.getElementById('repoBtn').innerText.trim()})`);
  console.log('REPO', repo);

  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
