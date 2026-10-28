/* ============================================================
   Hitouch — 聊天与接入
   五件事：启动动画 / 发消息 / 模型与接入 / 设置面板 / 窗口控制
   模型请求全部走主进程，页面里没有 Key。
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const reduceMotion = () => motionQuery.matches;
const api = window.hitouch || null;

/* ---------------- 接入配置 ---------------- */
let CONFIG = {
  provider: 'deepseek',
  base: 'https://api.deepseek.com',
  models: [
    { id: 'deepseek-flash', name: 'deepseek-flash' },
    { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' },
  ],
  model: 'deepseek-flash',
  thinking: false,
  hasKey: false,
  skills: { alarm: true, repair: true },
  alarms: [],
  repo: 'https://github.com/Sun2530/Hitouch',
  consent: { version: 0, at: null, current: 1, agreed: false },
};

/* 设置页里暂存的选择，保存时才提交 */
let pendingModel = CONFIG.model;
let pendingThinking = CONFIG.thinking;

const TICK = `<svg class="pi-tick" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M3.2 8.4l3.1 3.1 6.5-6.9" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ARROW = `<svg class="pi-arrow" viewBox="0 0 16 16" aria-hidden="true">
  <path d="M6.5 4.4L10.1 8l-3.6 3.6" fill="none" stroke="currentColor"
        stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ---------------- 输入区 ---------------- */
const input = $('#input');
const composer = $('#composer');
const sendBtn = $('#sendBtn');
const thread = $('#thread');
const col = $('#col');
const dial = $('#dial');
const dialTrack = $('#dialTrack');
const dialKnob = $('#dialKnob');
const dialState = $('#dialState');

/* 真实对话历史，只放用户说的话和模型说的话 */
const history = [];

function resizeInput() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 168) + 'px';
}

function refreshSend() {
  sendBtn.disabled = input.value.trim().length === 0;
}

function scrollBottom(smooth) {
  requestAnimationFrame(() => {
    thread.scrollTo({ top: thread.scrollHeight, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  });
}

function addMsg(kind, text) {
  const node = document.createElement('div');
  node.className = `msg is-${kind}`;
  const body = document.createElement('div');
  body.className = 'msg-body';
  if (text) body.textContent = text;
  node.appendChild(body);
  col.appendChild(node);
  scrollBottom(true);
  return node;
}

/* ---------------- 极简 markdown ---------------- */
function escHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function renderMd(src) {
  const codes = [];
  let s = escHtml(src);

  s = s.replace(/```[a-zA-Z0-9+#-]*\n?([\s\S]*?)```/g, (_m, code) => {
    codes.push(code.replace(/\n$/, ''));
    return `\u0000${codes.length - 1}\u0000`;
  });

  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');

  s = s.split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');

  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<pre><code>${codes[+i]}</code></pre>`);
  return s;
}

/* ---------------- 模型列表 ---------------- */
/* id 用于请求，name 用于显示 */
function modelLabel(id) {
  const m = (CONFIG.models || []).find((x) => x.id === id);
  return m ? m.name : id;
}

function modelItem(m) {
  const on = m.id === CONFIG.model;
  return `<button class="pi${on ? ' is-on' : ''}" data-model="${m.id}">
      <span class="pi-name">${m.name}</span>${TICK}
    </button>`;
}

function renderModels() {
  const list = $('#modelList');
  const provList = $('#provModels');

  if (CONFIG.hasKey) {
    list.innerHTML = CONFIG.models.map((m) => modelItem(m)).join('');
  } else {
    list.innerHTML = `<button class="pi pi-go" id="goProvider">
        <span class="pi-name">未接入模型</span>
        <span class="pi-tag">去接入</span>${ARROW}
      </button>`;
  }

  provList.innerHTML = CONFIG.models.map((m) => {
    const on = m.id === pendingModel;
    return `<button class="pi${on ? ' is-on' : ''}" data-pmodel="${m.id}">
        <span class="pi-name">${m.name}</span>${TICK}
      </button>`;
  }).join('');
}

function renderStatus() {
  /* 设置面板主视图右侧的小字 */
  const tag = $('#provTag');
  tag.textContent = CONFIG.hasKey ? '已接入' : '未接入';
  tag.classList.toggle('is-on', CONFIG.hasKey);

  /* 接入页的供应商状态 */
  const st = $('#dsState');
  st.innerHTML = `<i></i>${CONFIG.hasKey ? '已接入' : '未接入'}`;
  st.classList.toggle('is-on', CONFIG.hasKey);

  /* 深度思考：主页滑轨 + 弹窗开关，都只反映已保存的值 */
  renderDial();
  renderThinkSwitch();

  const keyInput = $('#keyInput');
  if (keyInput) keyInput.placeholder = CONFIG.hasKey ? '已保存，留空则不修改' : 'sk-…';

  renderSkills();
}

/* ---------------- 技能面板 ---------------- */
const X_ICON = `<svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true">
  <path d="M2.6 2.6l4.8 4.8M7.4 2.6L2.6 7.4" stroke="currentColor"
        stroke-width="1.1" stroke-linecap="round"/>
</svg>`;

function parseAtLocal(at) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(String(at || '').trim());
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function hhmm(at) {
  const d = parseAtLocal(at);
  return d ? hm(d) : String(at || '');
}

/* 今天 / 明天 / 10-30 这样的短写法 */
function whenShort(at) {
  const d = parseAtLocal(at);
  if (!d) return String(at || '');
  const now = new Date();
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round(
    (new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0.getTime()) / 86400000,
  );
  if (diff === 0) return `今天 ${hm(d)}`;
  if (diff === 1) return `明天 ${hm(d)}`;
  if (diff === 2) return `后天 ${hm(d)}`;
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${hm(d)}`;
}

function renderSkills() {
  const s = CONFIG.skills || {};
  const swA = $('#swAlarm');
  const swR = $('#swRepair');
  if (swA) swA.setAttribute('aria-checked', s.alarm ? 'true' : 'false');
  if (swR) swR.setAttribute('aria-checked', s.repair ? 'true' : 'false');

  const n = [s.alarm, s.repair].filter(Boolean).length;
  const tag = $('#skillTag');
  if (tag) tag.textContent = `${n} 个`;

  const list = $('#alarmList');
  if (!list) return;

  const al = CONFIG.alarms || [];
  if (!al.length) {
    list.innerHTML = '<div class="sk-empty">还没有提醒</div>';
    return;
  }
  list.innerHTML = al.map((a) => `<div class="sk-item">
      <span class="sk-when">${whenShort(a.at)}</span>
      <span class="sk-what">${escHtml(a.text)}</span>
      <button class="sk-x" data-del="${a.id}" title="取消">${X_ICON}</button>
    </div>`).join('');
}

async function loadConfig() {
  if (!api || !api.getConfig) return;
  try {
    CONFIG = await api.getConfig();
    pendingModel = CONFIG.model;
    pendingThinking = CONFIG.thinking;
  } catch (_) {}
  renderModels();
  renderStatus();
}

/* ---------------- 弹层 ---------------- */
const pop = $('#pop');
const setBtn = $('#setBtn');
const popAbout = $('#popAbout');
const aboutBtn = $('#aboutBtn');

const PANELS = [
  { el: pop, btn: setBtn },
  { el: popAbout, btn: aboutBtn },
];

function closeAll() {
  PANELS.forEach(({ el, btn }) => {
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    btn.classList.remove('is-on');
  });
}

function openPanel(el, btn, page) {
  closeAll();
  el.dataset.page = page || 'main';
  el.classList.add('is-open');
  el.setAttribute('aria-hidden', 'false');
  btn.classList.add('is-on');
}

function togglePanel(el, btn) {
  const open = el.classList.contains('is-open');
  closeAll();
  if (open) return;
  openPanel(el, btn, 'main');
}

/* ---------------- 模型与接入：居中弹窗 ---------------- */
const keyModal = $('#keyModal');

/* ---------------- 深度思考：主页拟物滑轨 ---------------- */
const knobX = () => {
  const m = /translateX\((-?[\d.]+)px\)/.exec(dialKnob.style.transform || '');
  return m ? parseFloat(m[1]) : 0;
};
const dialTravel = () => Math.max(0, dialTrack.clientWidth - dialKnob.offsetWidth - 6);

function renderDial() {
  const on = Boolean(CONFIG.thinking);
  dial.dataset.on = on ? 'true' : 'false';
  dialTrack.setAttribute('aria-valuenow', on ? '1' : '0');
  dialState.textContent = on ? '开' : '关';
  dialKnob.style.transform = `translateX(${on ? dialTravel() : 0}px)`;
}

async function setThinking(on) {
  const changed = on !== Boolean(CONFIG.thinking);
  CONFIG.thinking = on;
  pendingThinking = on;
  renderDial();
  renderThinkSwitch();
  if (!changed || !api || !api.saveConfig) return;
  try {
    CONFIG = await api.saveConfig({ thinking: on });
    renderDial();
    renderThinkSwitch();
  } catch (_) {}
}

let drag = null;

function bindDial() {
  dialTrack.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const rect = dialTrack.getBoundingClientRect();
    const travel = Math.max(0, rect.width - dialKnob.offsetWidth - 6);
    drag = {
      id: e.pointerId,
      rect,
      travel,
      startX: e.clientX,
      base: CONFIG.thinking ? travel : 0,
      moved: false,
    };
    try { dialTrack.setPointerCapture(e.pointerId); } catch (_) {}
    dial.classList.add('is-drag');
    e.preventDefault();
  });

  dialTrack.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 2) drag.moved = true;
    const x = Math.min(drag.travel, Math.max(0, drag.base + dx));
    dialKnob.style.transform = `translateX(${x}px)`;
    const on = x > drag.travel / 2;
    if ((dial.dataset.on === 'true') !== on) {
      dial.dataset.on = on ? 'true' : 'false';
      dialState.textContent = on ? '开' : '关';
    }
  });

  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { travel, rect, moved } = drag;
    const on = moved ? knobX() > travel / 2 : (e.clientX - rect.left) > rect.width / 2;
    drag = null;
    dial.classList.remove('is-drag');
    try { dialTrack.releasePointerCapture(e.pointerId); } catch (_) {}
    setThinking(on);
  };

  dialTrack.addEventListener('pointerup', endDrag);
  dialTrack.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => { if (!drag) renderDial(); });
}

function renderThinkSwitch() {
  const sw = $('#thinkSw');
  if (sw) sw.setAttribute('aria-checked', pendingThinking ? 'true' : 'false');
}

function openKey() {
  pendingModel = CONFIG.model;
  pendingThinking = CONFIG.thinking;
  $('#keyInput').value = '';
  setProvMsg('');
  renderModels();
  renderStatus();
  renderThinkSwitch();

  closeAll();
  keyModal.classList.add('is-open');
  keyModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#keyInput').focus(), 170);
}

function closeKey() {
  if (!keyModal.classList.contains('is-open')) return;
  keyModal.classList.remove('is-open');
  keyModal.setAttribute('aria-hidden', 'true');
  setTimeout(() => input.focus(), 200);
}

/* ---------------- 接入操作 ---------------- */
function setProvMsg(text, isErr) {
  const el = $('#provMsg');
  el.textContent = text || '';
  el.classList.toggle('is-err', Boolean(isErr));
}

async function testConnection() {
  const btn = $('#testBtn');
  const key = $('#keyInput').value.trim();
  if (!key && !CONFIG.hasKey) return setProvMsg('先填 API Key。', true);

  btn.disabled = true;
  setProvMsg('正在连 api.deepseek.com…', false);
  const res = await api.testKey({ apiKey: key });
  btn.disabled = false;

  if (res.ok) {
    const n = res.models && res.models.length ? `，可用模型 ${res.models.length} 个` : '';
    setProvMsg(`连接正常${n}。`, false);
  } else {
    setProvMsg(res.error || '连接失败。', true);
  }
}

async function saveProvider() {
  const btn = $('#saveBtn');
  const key = $('#keyInput').value.trim();

  if (!key && !CONFIG.hasKey) return setProvMsg('先填 API Key，再保存。', true);

  btn.disabled = true;
  $('#testBtn').disabled = true;

  /* 有新 key 就先验一次；沿用旧 key 就直接存 */
  if (key) {
    setProvMsg('正在验证…', false);
    const check = await api.testKey({ apiKey: key });
    if (!check.ok) {
      btn.disabled = false;
      $('#testBtn').disabled = false;
      return setProvMsg(check.error || '验证失败，没有保存。', true);
    }
  }

  const wasConnected = CONFIG.hasKey;
  try {
    CONFIG = await api.saveConfig({ apiKey: key, model: pendingModel, thinking: pendingThinking });
  } catch (err) {
    btn.disabled = false;
    $('#testBtn').disabled = false;
    return setProvMsg('保存失败：' + err.message, true);
  }

  btn.disabled = false;
  $('#testBtn').disabled = false;
  $('#keyInput').value = '';

  renderModels();
  renderStatus();
  renderThinkSwitch();
  setProvMsg(`已接入 · ${modelLabel(CONFIG.model)}${CONFIG.thinking ? ' · 思考开启' : ''}。`, false);

  if (!wasConnected) resetThread();

  /* 存好了就收起来，回到聊天 */
  setTimeout(closeKey, 760);
}

/* ---------------- 对话 ---------------- */
const CALL_OPEN = '[[call]]';
const CALL_CLOSE = '[[/call]]';

let busy = false;

function resetThread() {
  col.innerHTML = '';
  history.length = 0;
  if (CONFIG.hasKey) {
    addMsg('bot', `已接入 · ${modelLabel(CONFIG.model)}。`);
  }
}

/* 流式把调用块吃掉：页面上不出现 JSON，尾部半截标记先压着不发 */
function makeCallParser() {
  let buf = '';
  const keepTail = (s) => {
    const max = Math.min(s.length, CALL_OPEN.length - 1);
    for (let k = max; k > 0; k -= 1) {
      if (s.endsWith(CALL_OPEN.slice(0, k))) return k;
    }
    return 0;
  };

  return {
    feed(chunk) {
      let out = '';
      const calls = [];
      buf += chunk;

      for (;;) {
        const i = buf.indexOf(CALL_OPEN);
        if (i < 0) {
          const keep = keepTail(buf);
          if (buf.length > keep) out += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          break;
        }
        if (i > 0) { out += buf.slice(0, i); buf = buf.slice(i); }
        const j = buf.indexOf(CALL_CLOSE, CALL_OPEN.length);
        if (j < 0) break;
        calls.push(buf.slice(CALL_OPEN.length, j).trim());
        buf = buf.slice(j + CALL_CLOSE.length);
      }
      return { out, calls };
    },
    flush() { const r = buf; buf = ''; return r; },
  };
}

/* 一条动作条：技能在做什么、做到哪一步 */
function addAct(tag, what) {
  const el = document.createElement('div');
  el.className = 'act';
  el.innerHTML = `<div class="act-head">
      <span class="act-tag">${escHtml(tag)}</span>
      <span class="act-what">${escHtml(what)}</span>
      <span class="act-st">进行中</span>
    </div>
    <div class="act-bar"><i></i></div>
    <div class="act-log" hidden></div>`;
  col.appendChild(el);
  scrollBottom(true);

  const q = (s) => el.querySelector(s);
  return {
    setWhat(t) { q('.act-what').textContent = t; },
    progress(p) {
      /* 还没拿到百分比就先不画，免得出现一截莫名的小短条 */
      q('.act-bar i').style.width = p > 0 ? Math.min(100, p) + '%' : '0';
    },
    log(line) {
      const l = q('.act-log');
      l.hidden = false;
      l.textContent = line || '';
    },
    label(t) { q('.act-st').textContent = t; },
    ok(t) { el.classList.add('is-ok', 'is-done'); q('.act-st').textContent = t || '完成'; },
    err(t) { el.classList.add('is-err', 'is-done'); q('.act-st').textContent = t || '失败'; },
  };
}

/* ---- 技能执行 ---- */
async function runAlarmSkill(args) {
  const at = String(args.at || '').trim();
  const text = String(args.text || '').trim() || '提醒';
  const act = addAct('闹钟', `${at || '没给时间'} · ${text}`);

  let r;
  try { r = await api.addAlarm({ at, text }); }
  catch (err) { r = { ok: false, error: err.message }; }

  if (!r || !r.ok) {
    const why = (r && r.error) || '未知原因';
    act.err('未设定');
    act.log(why);
    return { ok: false, text: `闹钟没有设成：${why}` };
  }

  act.setWhat(`${whenShort(r.alarm.at)} · ${r.alarm.text}`);
  act.ok('已设定');
  try { CONFIG = await api.getConfig(); renderSkills(); } catch (_) {}
  return {
    ok: true,
    text: `闹钟已设定：${r.alarm.at}（${whenShort(r.alarm.at)}），内容「${r.alarm.text}」。到点客户端会弹窗。`,
  };
}

async function runRepairSkill() {
  const act = addAct('系统修复', '准备中');

  const off = api.onRepair((p) => {
    if (p.type === 'step') { act.setWhat(p.title); act.progress(0); }
    else if (p.type === 'line') {
      if (p.percent != null) act.progress(p.percent);
      if (p.line) act.log(p.line);
    } else if (p.type === 'done') act.progress(100);
  });

  let res;
  try { res = await api.runRepair(); }
  catch (err) { res = { ok: false, error: err.message, steps: [] }; }
  finally { off(); }

  if (!res || res.error) {
    const why = (res && res.error) || '未知原因';
    act.err('未运行');
    act.log(why);
    return { ok: false, text: `系统修复没有执行：${why}` };
  }

  const steps = res.steps || [];
  const fails = steps.filter((s) => s.code !== 0);
  const lines = steps
    .flatMap((s) => (s.lines || []).map((l) => `[${s.key}] ${l}`))
    .slice(-8);

  if (fails.length) act.err('有错误'); else act.ok('完成');
  act.log(lines.slice(-2).join('  ') || (fails.length ? '返回码 ' + fails.map((f) => f.code).join('/') : '没有输出'));

  return {
    ok: !fails.length,
    text: `系统修复跑完了（${res.ok ? '全部成功' : '有步骤返回非 0'}）。输出摘要：\n` +
          (lines.join('\n') || '（没有值得摘录的行）'),
  };
}

async function runSkill(raw) {
  let payload;
  try { payload = JSON.parse(raw); }
  catch (_) { return { ok: false, text: '调用块不是合法 JSON，没有执行。' }; }

  const name = String((payload && payload.skill) || '');
  const args = payload && payload.args && typeof payload.args === 'object' ? payload.args : {};
  const sk = CONFIG.skills || {};

  if (name === 'alarm') {
    if (!sk.alarm) return { ok: false, text: '闹钟技能是关着的，没有执行。' };
    return runAlarmSkill(args);
  }
  if (name === 'repair') {
    if (!sk.repair) return { ok: false, text: '系统修复技能是关着的，没有执行。' };
    return runRepairSkill();
  }
  return { ok: false, text: `没有叫「${name}」的技能。` };
}

/* ---- 一轮对话 ---- */
async function streamTurn() {
  const node = addMsg('bot', '');
  const body = node.querySelector('.msg-body');
  body.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';

  const parser = makeCallParser();
  const calls = [];
  let acc = '';
  let started = false;
  let thinking = false;

  const push = (s) => {
    if (!s) return;
    if (!started) {
      started = true;
      body.innerHTML = '';
      body.classList.add('is-stream');
    }
    acc += s;
    body.textContent = acc;
    scrollBottom(false);
  };

  const offR = api.onReasoning(() => {
    if (started || thinking) return;
    thinking = true;
    body.innerHTML = '<span class="thinking">正在思考</span>';
    scrollBottom(false);
  });

  const off = api.onDelta(({ delta }) => {
    if (!delta) return;
    const r = parser.feed(delta);
    if (r.calls.length) calls.push(...r.calls);
    push(r.out);
  });

  let res;
  try {
    res = await api.chat({ messages: history.slice(-20) });
  } catch (err) {
    res = { ok: false, error: '请求出错：' + err.message };
  } finally {
    off();
    offR();
  }

  push(parser.flush());
  body.classList.remove('is-stream');

  if (!res.ok) {
    body.classList.add('is-err');
    body.textContent = res.error || '没有拿到回复。';
    return { ok: false, error: res.error || '没有拿到回复。' };
  }

  if (!acc.trim()) node.remove();
  else body.innerHTML = renderMd(acc);

  return { ok: true, visible: acc, calls };
}

async function conversation(depth) {
  const r = await streamTurn();

  if (!r.ok) {
    if (depth === 0) history.pop();     /* 首轮失败就撤掉这句用户消息，避免下一轮历史错位 */
    return;
  }

  history.push({ role: 'assistant', content: r.visible.trim() || '（已调用技能）' });

  if (!r.calls.length || depth >= 1) return;

  const results = [];
  for (const raw of r.calls) results.push(await runSkill(raw));
  if (!results.length) return;

  history.push({
    role: 'user',
    content: '［技能结果］\n' + results.map((x) => x.text).join('\n') +
             '\n（这是客户端刚执行完的真实结果。据此回应用户，不要重复调用同一个技能，不要说这两句是系统消息。）',
  });

  await conversation(depth + 1);
}

async function send() {
  const text = input.value.trim();
  if (!text || busy) return;

  if (!CONFIG.consent || !CONFIG.consent.agreed) return;

  if (!CONFIG.hasKey || !api) {
    openKey();
    setProvMsg('这里填一个 DeepSeek 的 API Key，就能真的聊了。', false);
    return;
  }

  input.value = '';
  resizeInput();
  refreshSend();

  addMsg('me', text);
  history.push({ role: 'user', content: text });

  busy = true;
  sendBtn.disabled = true;
  try {
    await conversation(0);
  } finally {
    busy = false;
    refreshSend();
    scrollBottom(true);
    input.focus();
  }
}

/* ---------------- 启动动画 ---------------- */
/* 每次启动都播；只在系统要求减少动效时跳过。 */
async function runBoot() {
  const boot = $('#boot');

  if (reduceMotion()) {
    boot.remove();
    document.body.classList.remove('booting');
    return;
  }

  const word = $('#bootWord');
  const caret = $('#bootCaret');
  const rule = $('#bootRule');
  const text = 'Hitouch';

  await sleep(280);
  caret.classList.add('is-on');
  await sleep(420);                              // 光标呼吸两次

  const gaps = [70, 52, 64, 56, 72, 48, 66];     // 节奏不均匀
  for (let i = 0; i < text.length; i += 1) {
    word.textContent = text.slice(0, i + 1);
    await sleep(gaps[i]);
  }

  await sleep(120);
  caret.style.transition = 'transform 220ms var(--ease), opacity 220ms var(--ease)';
  caret.style.transform = 'translateX(10px)';
  caret.style.opacity = '0';

  await sleep(60);
  rule.style.width = '118px';

  await sleep(400);
  boot.classList.add('is-out');
  document.body.classList.remove('booting');

  await sleep(380);
  boot.remove();
}

/* 等窗口真正显示再开播，避免动画在隐藏窗口里跑完 */
function startBoot() {
  return new Promise((resolve) => {
    let fired = false;
    const go = () => {
      if (fired) return;
      fired = true;
      runBoot().then(resolve);
    };
    if (api && api.onShown) {
      api.onShown(go);
      setTimeout(go, 1500);                        // 兜底
    } else {
      go();
    }
  });
}

/* ---------------- 使用条款与未成年人保护 ---------------- */
const consentModal = $('#consentModal');
const ckBox = $('#ctCheck');
const ckAccept = $('#ctAccept');

function openConsent() {
  document.body.classList.add('no-consent');
  input.disabled = true;
  input.placeholder = '同意条款后即可使用';
  ckBox.setAttribute('aria-checked', 'false');
  ckAccept.disabled = true;
  consentModal.classList.add('is-open');
  consentModal.setAttribute('aria-hidden', 'false');
  $('#ctBody').scrollTop = 0;
}

function closeConsent() {
  document.body.classList.remove('no-consent');
  input.disabled = false;
  input.placeholder = '发消息…';
  consentModal.classList.remove('is-open');
  consentModal.setAttribute('aria-hidden', 'true');
}

async function acceptConsent() {
  try {
    CONFIG = await api.acceptConsent();
  } catch (_) {
    return;
  }
  closeConsent();
  input.focus();
}

async function declineConsent() {
  try {
    await api.declineConsent();
  } catch (_) {
    window.close();
  }
}

/* 启动动画播完、配置读回来之后再决定要不要拦 */
function gateConsent() {
  if (CONFIG.consent && CONFIG.consent.agreed) return;
  openConsent();
}

/* ---------------- 事件绑定 ---------------- */
function bind() {
  $$('[data-win]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.win;
      if (!api) return;
      if (act === 'min') api.minimize();
      else if (act === 'max') api.maximize();
      else if (act === 'close') api.close();
    });
  });

  input.addEventListener('input', () => { resizeInput(); refreshSend(); });
  input.addEventListener('focus', () => composer.classList.add('is-focus'));
  input.addEventListener('blur', () => composer.classList.remove('is-focus'));

  sendBtn.addEventListener('click', send);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  /* 两枚入口按钮 */
  setBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(pop, setBtn); });
  aboutBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePanel(popAbout, aboutBtn); });

  /* 弹层内：进入二级页 / 返回 */
  PANELS.forEach(({ el }) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const go = e.target.closest('[data-go]');
      if (go) {
        if (go.dataset.go === 'provider') return openKey();
        el.dataset.page = go.dataset.go;
        return;
      }
      if (e.target.closest('[data-back]')) el.dataset.page = 'main';
    });
  });

  /* 居中弹窗：关闭方式只有两种，右上角 ✕ 与点遮罩 */
  $('#keyClose').addEventListener('click', closeKey);
  keyModal.querySelector('[data-mclose]').addEventListener('click', closeKey);

  /* 深度思考滑块：左关、右开 */
  $('#thinkSw').addEventListener('click', () => {
    pendingThinking = !pendingThinking;
    renderThinkSwitch();
    setProvMsg('');
  });

  document.addEventListener('click', closeAll);
  window.addEventListener('resize', closeAll);

  /* 底部模型列表 */
  $('#modelList').addEventListener('click', (e) => {
    if (e.target.closest('#goProvider')) {
      openKey();
      return;
    }
    const item = e.target.closest('.pi[data-model]');
    if (!item) return;
    pickModel(item.dataset.model);
  });

  /* 设置页里选模型（暂存） */
  $('#provModels').addEventListener('click', (e) => {
    const item = e.target.closest('.pi[data-pmodel]');
    if (!item) return;
    pendingModel = item.dataset.pmodel;
    renderModels();
    setProvMsg('');
  });

  $('#testBtn').addEventListener('click', testConnection);
  $('#saveBtn').addEventListener('click', saveProvider);

  $('#keyInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveProvider(); }
  });

  motionQuery.addEventListener('change', () => {
    document.body.classList.toggle('no-motion', reduceMotion());
  });

  /* 技能开关与提醒列表 */
  $('#swAlarm').addEventListener('click', () => toggleSkill('alarm'));
  $('#swRepair').addEventListener('click', () => toggleSkill('repair'));
  $('#alarmList').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    try { CONFIG = await api.delAlarm(btn.dataset.del); renderSkills(); } catch (_) {}
  });
  $('#repairNow').addEventListener('click', () => { closeAll(); runRepairSkill(); });

  /* 闹钟到点 */
  $('#alarmOk').addEventListener('click', closeAlarm);
  $('#alarmMask').addEventListener('click', closeAlarm);
  if (api && api.onAlarm) api.onAlarm(showAlarm);

  /* 使用条款：勾选才点亮同意按钮，遮罩与 Esc 都不关 */
  ckBox.addEventListener('click', () => {
    const on = ckBox.getAttribute('aria-checked') === 'true';
    ckBox.setAttribute('aria-checked', on ? 'false' : 'true');
    ckAccept.disabled = on;
  });
  ckAccept.addEventListener('click', acceptConsent);
  $('#ctDecline').addEventListener('click', declineConsent);

  /* GitHub 仓库：交给系统浏览器 */
  $('#repoBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    closeAll();
    if (api && api.openRepo) api.openRepo();
  });

  bindDial();
}

async function toggleSkill(key) {
  const on = !(CONFIG.skills || {})[key];
  try { CONFIG = await api.saveSkills({ [key]: on }); }
  catch (_) { return; }
  renderSkills();
}

/* ---------------- 闹钟到点提示 ---------------- */
const alarmModal = $('#alarmModal');

function showAlarm({ at, text }) {
  $('#alarmWhen').textContent = hhmm(at);
  $('#alarmText').textContent = text || '时间到了';
  alarmModal.classList.add('is-open');
  alarmModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#alarmOk').focus(), 160);

  if (api && api.getConfig) {
    api.getConfig().then((c) => { CONFIG = c; renderSkills(); }).catch(() => {});
  }
}

function closeAlarm() {
  alarmModal.classList.remove('is-open');
  alarmModal.setAttribute('aria-hidden', 'true');
  input.focus();
}

async function pickModel(id) {
  if (id === CONFIG.model) return closeAll();
  try {
    CONFIG = await api.saveConfig({ model: id });
  } catch (_) {
    return;
  }
  renderModels();
  renderStatus();
  closeAll();
}

/* ---------------- 启动 ---------------- */
document.body.classList.toggle('no-motion', reduceMotion());
if (api && api.transparency === false) {
  document.body.classList.add('no-glow');
}

bind();
resizeInput();
refreshSend();
renderDial();

const bootDone = startBoot();
const configReady = loadConfig().then(() => {
  if (CONFIG.hasKey) resetThread();
});

/* 启动动画播完、配置也读回来，才决定是否弹条款 */
Promise.all([bootDone, configReady]).then(gateConsent);
