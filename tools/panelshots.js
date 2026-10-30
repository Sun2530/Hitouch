/* 只重截设置面板与技能面板：向内缩边，去掉截图四周的背景色 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.argv[2] || '9555';
const OUT = process.argv[3] || 'assets';

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const send = (m, p = {}) => new Promise((r) => {
    const i = ++id; pend.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const js = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.log('JS-ERR', JSON.stringify(r.exceptionDetails).slice(0, 300));
    return r.result ? r.result.value : undefined;
  };

  await send('Page.bringToFront');
  await sleep(400);
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1360, height: 980, deviceScaleFactor: 2, mobile: false,
  });
  await sleep(500);

  /* 关掉条款弹窗，保证面板可点；接入状态与封面保持一致 */
  await js(`(()=>{
    document.body.classList.remove('no-consent');
    const m=document.getElementById('consentModal');
    if(m){m.classList.remove('is-open'); m.setAttribute('aria-hidden','true');}
    CONFIG.hasKey=true;
    if(typeof renderStatus==='function') renderStatus();
    return 'ok';
  })()`);
  await sleep(300);

  const crop = async (n, sel, inset = 7) => {
    const r = await js(`(()=>{const e=document.querySelector('${sel}');if(!e)return null;
      const b=e.getBoundingClientRect();
      return {x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    if (!r) { console.log('miss', n, sel); return; }
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: {
        x: r.x + inset,
        y: r.y + inset,
        width: r.w - inset * 2,
        height: r.h - inset * 2,
        scale: 3,
      },
    });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
    console.log('crop', n, Math.round(r.w) + 'x' + Math.round(r.h), '-> inset', inset);
  };

  /* 设置面板 */
  await js(`(()=>{const b=document.getElementById('aboutBtn');b&&b.click();return 'ok'})()`);
  await sleep(700);
  await crop('settings', '.pop-top');

  /* 技能面板 */
  await js(`(()=>{const t=document.querySelector('#popAbout [data-go="skills"]');if(t){t.click();return 'ok'}return 'miss'})()`);
  await sleep(650);
  await crop('skills', '.pop-top');

  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
