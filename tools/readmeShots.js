/* 仓库展示图（0.2.0）：注入一段中性演示对话（不调 API），截 主页 / 设置 / 技能 / 条款 */
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
  await send('Page.enable');
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 820, deviceScaleFactor: 2, mobile: false });
  await sleep(700);
  const vp = await js(`JSON.stringify({w:innerWidth,h:innerHeight})`);
  console.log('VIEWPORT', vp);
  const { w: VW, h: VH } = JSON.parse(vp);

  const shot = async (n) => {
    const s = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: VW, height: VH, scale: 1 },
    });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
    console.log('shot', n);
  };
  const crop = async (n, sel, pad = 12, scale = 2.6) => {
    const r = await js(`(()=>{const b=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    if (!r) { console.log('crop-miss', n); return; }
    const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad);
    const s = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false,
      clip: { x, y, width: Math.min(VW - x, r.w + pad * 2), height: Math.min(VH - y, r.h + pad * 2), scale },
    });
    fs.writeFileSync(`${OUT}/${n}.png`, Buffer.from(s.data, 'base64'));
    console.log('crop', n, Math.round(r.w), Math.round(r.h));
  };

  /* 注入演示对话（4 条，展示 markdown 列表/引用） */
  const inj = await js(`(async()=>{
    document.body.classList.remove('no-consent');
    const m=document.getElementById('consentModal');
    if(m){m.classList.remove('is-open');m.setAttribute('aria-hidden','true');}
    document.getElementById('input').disabled=false;
    CONFIG.hasKey=true; renderStatus(); renderModels();
    const pub=await api.saveSettings({historyEnabled:true,contextLimit:30});
    if(pub&&pub.history){CONFIG.history=pub.history;}
    applySettings();
    await api.historyClear();
    await api.historySave({
      id:'readme-demo-01', title:'本地记录与人设', personaId:'general',
      createdAt:new Date(Date.now()-3600e3).toISOString(),
      messages:[
        {role:'user',content:'本地记录存在哪？会不会上传？',ts:new Date(Date.now()-3600e3).toISOString()},
        {role:'assistant',content:'存在 \\\`%APPDATA%\\\\Hitouch\\\\conversations\\\`，每条对话一个文件，用 Windows DPAPI 加密。\\n\\n- **只在本机**：不上传、不同步\\n- **可以关**：设置里关掉「保存对话记录」\\n\\n换台电脑就打不开了，这是有意的。',ts:new Date(Date.now()-3500e3).toISOString()},
        {role:'user',content:'人设能自己写吗？',ts:new Date(Date.now()-1800e3).toISOString()},
        {role:'assistant',content:'能。左下角点人设 → 新建，写名字和一段提示词。比如：\\n\\n> 你是一位耐心的学习助教，先确认我卡在哪一步。\\n\\n选中的那个人设会跟着这段对话保存，下次打开还在。',ts:new Date(Date.now()-1700e3).toISOString()}
      ]
    });
    await openChat('readme-demo-01');
    document.getElementById('input').placeholder='发消息…';
    return 'ok';
  })()`);
  console.log('INJECT', inj);
  await sleep(700);
  await shot('home');

  /* 设置弹层 */
  await js(`(()=>{const c=document.querySelector('.thread .col');if(c)c.style.visibility='hidden';document.getElementById('setBtn').click();return 'ok'})()`);
  await sleep(500);
  await crop('settings', '#pop');
  await js(`document.getElementById('setBtn').click()`);
  await sleep(300);

  /* 关于 → 技能页 */
  await js(`document.getElementById('aboutBtn').click()`);
  await sleep(400);
  await js(`(()=>{const b=document.querySelector('#popAbout [data-go="skills"]');if(b)b.click();return 'ok'})()`);
  await sleep(500);
  await crop('skills', '#popAbout');
  await js(`(()=>{const b=document.getElementById('aboutBtn');if(b)b.click();const c=document.querySelector('.thread .col');if(c)c.style.visibility='';return 'ok'})()`);
  await sleep(400);

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
