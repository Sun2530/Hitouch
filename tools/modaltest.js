/* 在真实窗口里走一遍：打开居中弹窗 → 拨滑块 → 真实保存 → 真实发消息 */
const fs = require('fs');
const OUT = process.argv[2];
const KEY = process.argv[3];
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const send = (m, p = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const js = async (x) => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result.value;
  const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64')); };
  const crop = async (n, x, y, w, h, scale) => { const s = await send('Page.captureScreenshot', { format: 'png', clip: { x, y, width: w, height: h, scale } }); fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64')); };

  /* 等启动动画结束 */
  for (let i = 0; i < 60; i++) {
    if (await js(`document.readyState==='complete' && !document.getElementById('boot') && !document.body.classList.contains('booting')`)) break;
    await sleep(250);
  }
  await sleep(500);

  /* 1. 打开 ⓘ → 模型与接入 */
  await js(`document.getElementById('aboutBtn').click();'ok'`);
  await sleep(350);
  await shot('m1-about-pop');
  await js(`document.querySelector('#popAbout [data-go="provider"]').click();'ok'`);
  await sleep(600);
  await shot('m2-modal');
  const geo = await js(`(()=>{const c=document.querySelector('.modal-card').getBoundingClientRect();return JSON.stringify({w:Math.round(c.width),h:Math.round(c.height),cx:Math.round(c.left+c.width/2),cy:Math.round(c.top+c.height/2),vw:innerWidth,vh:innerHeight})})()`);
  console.log('弹窗几何', geo);

  await crop('m3-modal-zoom', 0, 0, 0, 0, 1).catch(() => {});

  /* 2. 滑块：默认关 → 点开 */
  console.log('滑块初始', await js(`document.getElementById('thinkSw').getAttribute('aria-checked')`));
  await js(`document.getElementById('thinkSw').click();'ok'`);
  await sleep(450);
  console.log('滑块点后', await js(`document.getElementById('thinkSw').getAttribute('aria-checked')`));
  await shot('m4-switch-on');

  /* 3. 填 key 并保存（真实校验） */
  await js(`document.getElementById('keyInput').value=${JSON.stringify(KEY)};'ok'`);
  await sleep(200);
  await js(`document.getElementById('saveBtn').click();'ok'`);
  for (let i = 0; i < 40; i++) {
    const t = await js(`document.getElementById('provMsg').textContent`);
    if (t && !/正在/.test(t)) { console.log('保存结果:', t); break; }
    await sleep(500);
  }
  await shot('m5-saved');
  console.log('hasKey =', await js(`JSON.stringify(CONFIG.hasKey)`), ' thinking =', await js(`JSON.stringify(CONFIG.thinking)`));
  await sleep(1200);
  console.log('弹窗已关闭 =', await js(`!document.getElementById('keyModal').classList.contains('is-open')`));
  await shot('m6-after-save');

  /* 4. 真实发一条，验证流式 */
  await js(`document.getElementById('input').value='用一句话说说你自己是谁。';document.getElementById('input').dispatchEvent(new Event('input'));'ok'`);
  await sleep(200);
  await js(`document.getElementById('sendBtn').click();'ok'`);
  for (let i = 0; i < 80; i++) {
    const done = await js(`document.querySelectorAll('.msg.is-bot').length>0 && !document.querySelector('.msg.is-bot:last-child .typing')`);
    const busy = await js(`document.querySelector('.msg-body.is-stream')===null`);
    const txt = await js(`[...document.querySelectorAll('.msg.is-bot .msg-body')].pop()?.textContent||''`);
    if (txt && txt.length > 6 && /[。！？.!?a-zA-Z]/.test(txt)) { console.log('回复长度', txt.length); break; }
    await sleep(500);
  }
  await sleep(600);
  await shot('m7-real-reply');
  console.log('回复 =', await js(`[...document.querySelectorAll('.msg.is-bot .msg-body')].pop()?.textContent.slice(0,80)`));

  console.log('DONE');
  ws.close();
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
