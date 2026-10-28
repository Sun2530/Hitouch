/* 仓库展示图：注入一段中性演示对话（不调 API），截 主页 / 设置 / 条款 三张 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = process.argv[3] || 'assets';
const PORT = process.argv[2] || '9222';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  const js = async (x) => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) console.log('JS-ERR', JSON.stringify(r.exceptionDetails).slice(0, 200));
    return r.result ? r.result.value : undefined;
  };
  await send('Page.bringToFront');
  const vp = await js(`JSON.stringify({w:innerWidth,h:innerHeight})`);
  console.log('VIEWPORT', vp);
  const { w: VW, h: VH } = JSON.parse(vp);
  await sleep(300);

  const shot = async (n) => {
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: VW, height: VH, scale: 2 },
    });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
    console.log('shot', n);
  };

  const crop = async (n, sel, pad = 10, scale = 2.6) => {
    const r = await js(`(()=>{const b=document.querySelector('${sel}').getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    if (!r) { console.log('crop-miss', n); return; }
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      clip: {
        x: Math.max(0, r.x - pad),
        y: Math.max(0, r.y - pad),
        width: Math.min(VW - Math.max(0, r.x - pad), r.w + pad * 2),
        height: Math.min(VH - Math.max(0, r.y - pad), r.h + pad * 2),
        scale,
      },
    });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
    console.log('crop', n, Math.round(r.w), Math.round(r.h));
  };

  /* 注入演示对话 */
  const inj = await js(`(()=>{
    document.body.classList.remove('no-consent');
    const m=document.getElementById('consentModal');
    m.classList.remove('is-open'); m.setAttribute('aria-hidden','true');
    document.getElementById('input').disabled=false;
    CONFIG.hasKey=true; renderStatus();
    col.innerHTML='';
    addMsg('bot','已接入 · DeepSeek-V4.1-Flash。');
    addMsg('me','这段话太长了，帮我压成一句。\\n\\n“这次更新主要修复了窗口在切换显示器之后尺寸错乱的问题，顺便把发送按钮在输入为空时的禁用状态也修好了，另外还调整了设置面板里几处文案。”');
    const n=addMsg('bot','');
    n.querySelector('.msg-body').innerHTML=renderMd('这次更新修了两个问题：切显示器后窗口尺寸错乱、输入为空时发送按钮没禁用，并顺手理顺了设置里的几处文案。');
    addMsg('me','好。那下一版我想加个本地历史记录。');
    const b2=addMsg('bot','');
    b2.querySelector('.msg-body').innerHTML=renderMd('可以，但先把三件事定下来：\\n\\n- **存哪里**：本地文件，不用数据库，够用就好\\n- **存多久**：默认全留，允许一键清空\\n- **加密吗**：不加密，History 里只有你自己\\n\\n定完这三条再动代码，比边写边改省事。');
    scrollBottom(false);
    return 'ok';
  })()`);
  console.log('INJECT', inj);
  await sleep(600);
  await shot('home');

  /* 设置面板 */
  await js(`(()=>{col.style.visibility='hidden';document.getElementById('aboutBtn').click();return 'ok'})()`);
  await sleep(650);
  await crop('settings', '.pop-top', 14, 2.6);

  /* 技能面板 */
  await js(`(()=>{document.querySelector('#popAbout [data-go="skills"]').click();return 'ok'})()`);
  await sleep(600);
  await crop('skills', '.pop-top', 14, 2.6);
  await js(`(()=>{const b=document.getElementById('aboutBtn');if(b)b.click();return 'ok'})()`);
  await sleep(400);
  await js(`(()=>{col.style.visibility='';return 'ok'})()`);
  await sleep(200);

  /* 条款弹窗 */
  await js(`(()=>{
    document.body.classList.add('no-consent');
    const m=document.getElementById('consentModal');
    m.classList.add('is-open'); m.setAttribute('aria-hidden','false');
    document.getElementById('ctBody').scrollTop=0;
    return 'ok';
  })()`);
  await sleep(600);
  await shot('consent');

  /* 还原 */
  await js(`(()=>{
    const m=document.getElementById('consentModal');
    m.classList.remove('is-open'); m.setAttribute('aria-hidden','true');
    document.body.classList.remove('no-consent');
    document.getElementById('input').disabled=false;
    return 'ok';
  })()`);
  await sleep(300);
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
