/* 宣传用界面图：注入一段更像样的对话，截整窗 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = process.argv[2] || '9444';
const OUT = process.argv[3] || 'promo';

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
  await sleep(400);
  /* 压矮视口，避免截图上方大片空白 */
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1000, height: 640, deviceScaleFactor: 2, mobile: false,
  });
  await sleep(500);
  const vp = JSON.parse(await js(`JSON.stringify({w:innerWidth,h:innerHeight})`));
  console.log('VIEWPORT', vp);

  const inj = await js(`(()=>{
    document.body.classList.remove('no-consent');
    const m=document.getElementById('consentModal');
    m.classList.remove('is-open'); m.setAttribute('aria-hidden','true');
    document.getElementById('input').disabled=false;
    CONFIG.hasKey=true; renderStatus();
    col.innerHTML='';
    addMsg('bot','已接入 · DeepSeek-V4.1-Flash。');
    addMsg('me','帮我把这周做的事写成三句话，别太正式。');
    const a=addMsg('bot','');
    a.querySelector('.msg-body').innerHTML=renderMd('登录页重做完了，移动端还剩三个适配问题，下周一发。');
    addMsg('me','再短一点。');
    const b=addMsg('bot','');
    b.querySelector('.msg-body').innerHTML=renderMd('登录改完了，移动端还差三处，下周一发。');
    addMsg('me','明天八点提醒我交简历。');
    const c=addMsg('bot','');
    c.querySelector('.msg-body').innerHTML=renderMd('好，明天 8:00 提醒你交简历。到点会弹窗，想改时间随时说。');
    scrollBottom(false);
    return 'ok';
  })()`);
  console.log('INJECT', inj);
  await sleep(800);

  const s = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: vp.w, height: vp.h, scale: 2 },
  });
  fs.writeFileSync(`${OUT}/app.png`, Buffer.from(s.data, 'base64'));
  console.log('saved', `${OUT}/app.png`, vp.w * 2, 'x', vp.h * 2);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
