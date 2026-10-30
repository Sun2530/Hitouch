/* 把 promo/poster.html 的每个 section 分别截成 3:4 / 9:16 图 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.argv[2] || '9333';
const OUT = process.argv[3] || 'promo';
const NAMES = ['01-cover', '02-ui', '03-privacy', '04-download', '05-cover-9x16'];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  await send('Page.enable');
  // 等字体与图片就绪
  await js(`(async()=>{ await document.fonts.ready;
    await Promise.all([...document.images].map(i=>i.complete?1:new Promise(r=>{i.onload=i.onerror=r})));
    return document.images.length })()`);
  await sleep(600);

  const info = JSON.parse(await js(`JSON.stringify([...document.querySelectorAll('.poster')].map(e=>{
    const r=e.getBoundingClientRect();
    return { id:e.id, x:Math.round(r.left+scrollX), y:Math.round(r.top+scrollY),
             w:Math.round(r.width), h:Math.round(r.height) };
  }))`));
  console.log('sections', JSON.stringify(info));

  for (let i = 0; i < info.length; i++) {
    const s = info[i];
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: { x: s.x, y: s.y, width: s.w, height: s.h, scale: 2 },
    });
    const name = NAMES[i] || `shot-${i}`;
    fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(shot.data, 'base64'));
    console.log('shot', name, s.w + 'x' + s.h, '-> x2');
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
