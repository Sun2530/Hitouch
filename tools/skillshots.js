/* 技能相关截图：顶栏绿点 / 设置入口 / 技能页 / 动作条 / 闹钟弹窗 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const port = process.argv[3] || '9222';
  const outDir = process.argv[2] || 'shots-skill';
  fs.mkdirSync(outDir, { recursive: true });

  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  const send = (m, p = {}) => new Promise((r) => {
    const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p }));
  });
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const js = async (x) => (await send('Runtime.evaluate', {
    expression: x, returnByValue: true, awaitPromise: true,
  })).result.value;
  const shot = async (name) => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(s.data, 'base64'));
  };
  const crop = async (name, sel, pad = 12, scale = 3) => {
    const r = await js(`(()=>{const b=document.querySelector('${sel}').getBoundingClientRect();
      return {x:b.x,y:b.y,w:b.width,h:b.height}})()`);
    const s = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + pad * 2, height: r.h + pad * 2, scale },
    });
    fs.writeFileSync(`${outDir}/${name}.png`, Buffer.from(s.data, 'base64'));
  };

  await js('closeKey()');
  console.error('step0 ok');
  await sleep(400);

  /* 1. 顶栏 */
  await crop('s1-bar', '.bar', 6, 4);
  console.error('step1 ok');

  /* 2. 设置主面板 */
  await js("document.getElementById('aboutBtn').click()");
  await sleep(450);
  await crop('s2-about', '.pop-top', 14, 3);
  console.error('step2 ok');

  /* 3. 技能页 */
  await js("document.querySelector('#popAbout [data-go=\"skills\"]').click()");
  await sleep(400);
  await crop('s3-skills', '.pop-top', 14, 3);
  console.error('step3 ok');

  /* 4. 模拟模型下发的两个调用，看动作条 */
  await js('closeAll()');
  await js(`(async () => {
    await runSkill('{"skill":"alarm","args":{"at":"2026-10-28 21:30","text":"起来走两圈"}}');
    await runSkill('{"skill":"nope","args":{}}');
  })()`);
  await sleep(600);
  console.error('step4 acts done');
  await shot('s4-acts');
  await crop('s4-acts-crop', '#col', 10, 2);

  /* 5. 闹钟到点弹窗 */
  await js("showAlarm({at:'2026-10-28 21:30', text:'起来走两圈'})");
  console.error('step5 alarm done');
  await sleep(500);
  await shot('s5-alarm');

  console.log(await js(`JSON.stringify({
    skills: CONFIG.skills,
    alarms: (CONFIG.alarms||[]).length,
    mark: getComputedStyle(document.querySelector('.bar-mark')).backgroundColor,
  })`));

  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
