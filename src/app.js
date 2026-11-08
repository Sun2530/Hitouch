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
  consent: { version: 0, at: null, current: 2, agreed: false },
  personaId: 'general',
  personas: [
    { id: 'general', name: '通用助手', desc: '默认，直接、克制', prompt: '' },
  ],
  history: { enabled: false, contextLimit: 30, encrypted: false, dir: '' },
  search: { enabled: false },
  memory: { enabled: false },
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
  if (busy) { sendBtn.disabled = false; return; }
  sendBtn.disabled = input.value.trim().length === 0;
}

function scrollBottom(smooth) {
  requestAnimationFrame(() => {
    thread.scrollTo({ top: thread.scrollHeight, behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
  });
}

/* ---------- 推理侧栏：程序员外观下，右侧滚动打印 reasoning_content ---------- */
let thinkBuf = '';
let thinkT0 = 0;
let thinkClosed = false;

function isProTheme() {
  return document.documentElement.dataset.theme === 'pro';
}

function thinkReset() {
  thinkBuf = '';
  thinkT0 = 0;
  thinkClosed = false;
  const body = $('#thinkBody');
  const meta = $('#thinkMeta');
  const app = $('#app');
  if (body) body.textContent = '';
  if (meta) meta.textContent = '';
  if (app) app.classList.remove('think-on');
}

function thinkPush(delta) {
  if (!isProTheme() || thinkClosed) return;
  const app = $('#app');
  const body = $('#thinkBody');
  const meta = $('#thinkMeta');
  if (!body || !app) return;
  if (!thinkT0) thinkT0 = Date.now();
  thinkBuf += delta;
  app.classList.add('think-on');
  body.textContent = thinkBuf;
  if (meta) {
    const secs = Math.max(1, Math.round((Date.now() - thinkT0) / 1000));
    meta.textContent = `${thinkBuf.length} chars · ${secs}s`;
  }
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
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

/* 每条消息底下的小按钮：复制 / 重新生成 */
function addMsgActs(node, kind, text) {
  if (!text || !String(text).trim()) return;
  const acts = document.createElement('div');
  acts.className = 'msg-acts';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'msg-act';
  copy.textContent = '复制';
  copy.addEventListener('click', async () => {
    const raw = kind === 'bot' ? (node.dataset.raw || text) : text;
    const ok = await copyText(raw);
    copy.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { copy.textContent = '复制'; }, 1200);
  });
  acts.appendChild(copy);

  if (kind === 'bot') {
    const re = document.createElement('button');
    re.type = 'button';
    re.className = 'msg-act';
    re.dataset.regen = '1';
    re.textContent = '重新生成';
    re.addEventListener('click', () => regenerate());
    acts.appendChild(re);
  }

  node.appendChild(acts);
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
  /* 顶栏 ⓘ 菜单里的状态小字（设置入口已移到输入框齿轮，这里可能不存在） */
  const tag = $('#provTag');
  if (tag) {
    tag.textContent = CONFIG.hasKey ? '已接入' : '未接入';
    tag.classList.toggle('is-on', CONFIG.hasKey);
  }

  /* 设置里「供应商」那行的状态 */
  const st = $('#dsState');
  if (st) {
    st.innerHTML = `<i></i>${CONFIG.hasKey ? '已接入' : '未接入'}`;
    st.classList.toggle('is-on', CONFIG.hasKey);
  }

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
const setBtn = $('#setBtn');

const PANELS = [];

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

/* 设置弹窗：左侧分类（通用设置 / 模型 / 对话设置 / 作者） */
function setPane(name) {
  if (!name) return;
  const navs = keyModal.querySelectorAll('.set-nav-i');
  const panes = keyModal.querySelectorAll('.set-pane');
  let hit = false;
  panes.forEach((s) => {
    const on = s.dataset.pane === name;
    if (on) hit = true;
    s.classList.toggle('is-on', on);
  });
  if (!hit) return;
  navs.forEach((b) => {
    const on = b.dataset.pane === name;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const box = keyModal.querySelector('.set-panes');
  if (box) box.scrollTop = 0;
}

function openKey() {
  pendingModel = CONFIG.model;
  pendingThinking = CONFIG.thinking;
  $('#keyInput').value = '';
  setProvMsg('');
  renderModels();
  renderStatus();
  renderThinkSwitch();

  /* 左侧分类：没接入时默认停在「模型」，否则停在「通用设置」 */
  setPane(CONFIG.hasKey ? 'general' : 'model');

  closeAll();
  keyModal.classList.add('is-open');
  keyModal.setAttribute('aria-hidden', 'false');
  if (window.HitouchI18n) window.HitouchI18n.apply(isProTheme() ? 'en' : 'zh');
  setTimeout(() => {
    const k = $('#keyInput');
    if (k && k.offsetParent) k.focus();
  }, 180);
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

async function runSearchSkill(args) {
  const query = String(args.query || '').trim();
  const act = addAct('联网搜索', query || '没给关键词');

  let r;
  try { r = await api.runSearch(query); }
  catch (err) { r = { ok: false, error: err.message }; }

  if (!r || !r.ok) {
    const why = (r && r.error) || '未知原因';
    act.err('没搜到');
    act.log(why);
    return { ok: false, text: `联网搜索失败：${why}。如实告诉用户没搜到，不要编。` };
  }

  const items = r.results || [];
  act.ok(`搜到 ${items.length} 条 · ${r.engine || ''}`);
  act.log(items.slice(0, 3).map((x) => x.title).join(' / '));
  const text = '［搜索结果：' + r.query + '，来源 ' + r.engine + '］\n' +
    items.map((x, i) => `${i + 1}. ${x.title}\n   ${x.snippet || '（没有摘要）'}\n   ${x.url}`).join('\n');
  return { ok: true, text };
}

async function runRememberSkill(args) {
  const text = String(args.text || '').trim();
  const act = addAct('记忆', text || '没给内容');

  let r;
  try { r = await api.memoryAppend(text); }
  catch (err) { r = { ok: false, error: err.message }; }

  if (!r || !r.ok) {
    const why = (r && r.error) || '未知原因';
    act.err('没记住');
    act.log(why);
    return { ok: false, text: `没有记住：${why}` };
  }

  act.ok('已记住');
  return { ok: true, text: `已写进本地记忆：「${text}」。用一句话告诉用户你记住了。` };
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
  if (name === 'web_search') {
    if (!(CONFIG.search || {}).enabled) return { ok: false, text: '联网搜索是关着的，没有执行。' };
    return runSearchSkill(args);
  }
  if (name === 'remember') {
    if (!(CONFIG.memory || {}).enabled) return { ok: false, text: '本地记忆是关着的，没有执行。' };
    return runRememberSkill(args);
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

  thinkReset();

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

  const offR = api.onReasoning(({ delta }) => {
    if (typeof delta === 'string') thinkPush(delta);
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
    res = await api.chat({ messages: history, requestId: currentReqId });
  } catch (err) {
    res = { ok: false, error: '请求出错：' + err.message };
  } finally {
    off();
    offR();
  }

  push(parser.flush());
  body.classList.remove('is-stream');

  /* 被用户按停：已经出来的部分保留，没出来就算了 */
  if (res && res.aborted) {
    if (!acc.trim()) {
      node.remove();
      scrollBottom(false);
      return { ok: false, aborted: true, visible: '', calls };
    }
    node.dataset.raw = acc;
    body.innerHTML = renderMd(acc);
    node.classList.add('is-stopped');
    addMsgActs(node, 'bot', acc);
    return { ok: true, aborted: true, visible: acc, calls };
  }

  if (!res.ok) {
    body.classList.add('is-err');
    body.textContent = res.error || '没有拿到回复。';
    return { ok: false, error: res.error || '没有拿到回复。' };
  }

  if (!acc.trim()) node.remove();
  else {
    node.dataset.raw = acc;
    body.innerHTML = renderMd(acc);
    addMsgActs(node, 'bot', acc);
  }

  return { ok: true, visible: acc, calls };
}

async function conversation(depth) {
  const r = await streamTurn();

  if (!r.ok) return { ok: false, aborted: !!r.aborted };

  history.push({
    role: 'assistant',
    content: r.visible.trim() || '（已调用技能）',
    ts: new Date().toISOString(),
  });

  if (!r.calls.length || depth >= 1) {
    schedulePersist();
    return { ok: true };
  }

  const results = [];
  for (const raw of r.calls) results.push(await runSkill(raw));
  if (!results.length) {
    schedulePersist();
    return { ok: true };
  }

  history.push({
    role: 'user',
    content: '［技能结果］\n' + results.map((x) => x.text).join('\n') +
             '\n（这是客户端刚执行完的真实结果。据此回应用户，不要重复调用同一个技能，不要说这两句是系统消息。）',
    ts: new Date().toISOString(),
  });

  await conversation(depth + 1);
  return { ok: true };
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

  /* 新对话的第一次发言：顺手把标题、时间定下来 */
  if (!currentId) {
    currentId = newId();
    currentTitle = titleOf(text);
    currentCreatedAt = new Date().toISOString();
  }
  currentPersonaId = CONFIG.personaId || 'general';

  const mine = addMsg('me', text);
  addMsgActs(mine, 'me', text);
  history.push({ role: 'user', content: text, ts: new Date().toISOString() });

  busy = true;
  currentReqId = newId();
  setBusy(true);

  try {
    const r = await conversation(0);
    if (!r.ok && !r.aborted) {
      /* 一句都没回成：把刚发的那句从历史里撤掉，免得下轮角色错位 */
      const last = history[history.length - 1];
      if (last && last.role === 'user' && last.content === text) history.pop();
    }
  } finally {
    busy = false;
    currentReqId = null;
    setBusy(false);
    refreshSend();
    scrollBottom(true);
    input.focus();
  }
}

/* 发送键：空闲时发送，生成中变成停止 */
function onSendClick() {
  if (busy) { stopGeneration(); return; }
  send();
}

async function stopGeneration() {
  if (!busy || !currentReqId || !api || !api.abort) return;
  try { await api.abort(currentReqId); } catch (_) {}
}

async function regenerate() {
  if (busy) return;
  const last = col.lastElementChild;
  if (!last || !last.classList.contains('is-bot') || last.nextElementSibling) return;

  const prev = history[history.length - 1];
  if (!prev || prev.role !== 'assistant') return;
  history.pop();
  last.remove();

  busy = true;
  currentReqId = newId();
  setBusy(true);
  try {
    await conversation(0);
  } finally {
    busy = false;
    currentReqId = null;
    setBusy(false);
    refreshSend();
    scrollBottom(true);
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

  sendBtn.addEventListener('click', onSendClick);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  /* 两枚入口按钮 */
  setBtn.addEventListener('click', (e) => { e.stopPropagation(); openKey(); });

  /* 技能 / 隐私声明：从设置里打开 */
  const openInfo = (id) => {
    const m = $('#' + id);
    if (!m) return;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    if (id === 'skillsModal') renderSkills();
  };
  const closeInfo = () => {
    ['skillsModal', 'privacyModal'].forEach((id) => {
      const m = $('#' + id);
      if (!m) return;
      m.classList.remove('is-open');
      m.setAttribute('aria-hidden', 'true');
    });
  };
  const openSkillsBtn = $('#openSkills');
  if (openSkillsBtn) openSkillsBtn.addEventListener('click', () => openInfo('skillsModal'));
  const openPrivacyBtn = $('#openPrivacy');
  if (openPrivacyBtn) openPrivacyBtn.addEventListener('click', () => openInfo('privacyModal'));
  document.querySelectorAll('[data-infoclose]').forEach((n) => n.addEventListener('click', closeInfo));

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

  /* 设置：左侧分类切换 */
  keyModal.querySelectorAll('.set-nav-i').forEach((b) => {
    b.addEventListener('click', () => setPane(b.dataset.pane));
  });

  /* 作者区的两个链接 */
  const repoBtn = $('#aboutRepo');
  if (repoBtn) repoBtn.addEventListener('click', () => api.openRepo());
  const siteBtn = $('#aboutSite');
  if (siteBtn) siteBtn.addEventListener('click', () => api.openExternal('https://sun2530.github.io/hitouch-site/'));
  const relBtn = $('#aboutReleases');
  if (relBtn) relBtn.addEventListener('click', () => api.openExternal('https://gitee.com/sunkuforgame/Hitouch/releases'));

  /* 外观切换：浅色 / 程序员（蓝黑 + 全英文） */
  const themeSeg = $('#themeSeg');
  if (themeSeg) {
    themeSeg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-theme-pick]');
      if (b) pickTheme(b.dataset.themePick);
    });
  }

  /* 右侧推理栏：收起 */
  const thinkClose = $('#thinkClose');
  if (thinkClose) {
    thinkClose.addEventListener('click', () => {
      thinkClosed = true;
      const app = $('#app');
      if (app) app.classList.remove('think-on');
    });
  }

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
  const repoBtnOld = $('#repoBtn');
  if (repoBtnOld) repoBtnOld.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAll();
    if (api && api.openRepo) api.openRepo();
  });

  bindExtras();
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

/* ---------------- 本地对话、人设与设置 ---------------- */
const side = $('#side');
const chatList = $('#chatList');
const storeState = $('#storeState');
const histBtn = $('#histBtn');
const personaBtn = $('#personaBtn');
const personaModal = $('#personaModal');
const personaListEl = $('#personaList');
const personaNameEl = $('#personaName');
const pmName = $('#pmName');
const pmPrompt = $('#pmPrompt');
const pmMsg = $('#pmMsg');
const saveToggle = $('#saveToggle');
const saveState = $('#saveState');
const ctxRange = $('#ctxRange');
const ctxVal = $('#ctxVal');

let chats = [];
let currentId = null;
let currentTitle = '';
let currentCreatedAt = '';
let currentPersonaId = 'general';
let currentReqId = null;
let pmEditId = null;
let persistTimer = null;

const SEND_ICON = sendBtn.innerHTML;
const STOP_ICON = '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">' +
  '<rect x="5" y="5" width="6" height="6" rx="1.2" fill="currentColor"/></svg>';

const newId = () => (window.crypto && crypto.randomUUID
  ? crypto.randomUUID()
  : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

const titleOf = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 24) || '未命名对话';
const isMeta = (m) => typeof m.content === 'string' && m.content.startsWith('［技能结果］');

function setBusy(on) {
  sendBtn.innerHTML = on ? STOP_ICON : SEND_ICON;
  sendBtn.classList.toggle('is-stop', on);
  sendBtn.title = on ? '停止生成' : '发送';
  sendBtn.disabled = false;
}

async function copyText(text) {
  const s = String(text == null ? '' : text);
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(s);
      return true;
    }
  } catch (_) { /* 退回到 execCommand */ }

  const ta = document.createElement('textarea');
  ta.value = s;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (_) {}
  ta.remove();
  return ok;
}

let toastTimer = null;
function toast(text) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = window.HitouchI18n ? window.HitouchI18n.t(text) : text;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2000);
}

function fmtWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return hm;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/* ---- 存盘（防抖，一轮结束后才写） ---- */
function schedulePersist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => { persist().catch(() => {}); }, 300);
}

async function persist() {
  const h = CONFIG.history || {};
  if (!h.enabled || !api || !api.historySave) return;

  const msgs = history
    .filter((m) => !isMeta(m))
    .map((m) => ({ role: m.role, content: m.content, ts: m.ts || new Date().toISOString() }));
  if (!msgs.length) return;

  if (!currentId) {
    currentId = newId();
    currentCreatedAt = new Date().toISOString();
  }

  const res = await api.historySave({
    id: currentId,
    title: currentTitle || titleOf(msgs[0].content),
    personaId: currentPersonaId,
    createdAt: currentCreatedAt || new Date().toISOString(),
    messages: msgs,
  });

  if (res && res.ok) refreshChats();
}

/* ---- 左侧列表 ---- */
async function refreshChats() {
  if (!api || !api.historyList) return;
  try { chats = await api.historyList(); } catch (_) { chats = []; }
  if (!Array.isArray(chats)) chats = [];
  renderChats();
  updateStoreState();
}

function renderChats() {
  if (!chats.length) {
    chatList.innerHTML = '<div class="ch-empty">还没有保存的对话</div>';
    return;
  }
  chatList.innerHTML = chats.map((c) => `
    <div class="ch${c.id === currentId ? ' is-on' : ''}" data-id="${escAttr(c.id)}">
      <div class="ch-main">
        <div class="ch-title">${escHtml(c.title || '未命名对话')}</div>
        <div class="ch-time">${fmtWhen(c.updatedAt)} · ${c.count || 0} 条</div>
      </div>
      <div class="ch-tools">
        <button class="ch-b" data-act="rename" title="重命名">✎</button>
        <button class="ch-b" data-act="export" title="导出 Markdown">⤓</button>
        <button class="ch-b" data-act="del" title="删除">✕</button>
      </div>
    </div>`).join('');
}

function updateStoreState() {
  const h = CONFIG.history || {};
  if (!h.enabled) {
    storeState.textContent = '记录已关闭';
    storeState.classList.add('is-off');
    return;
  }
  storeState.classList.remove('is-off');
  storeState.textContent = h.encrypted ? '加密保存在本机' : '保存在本机';
}

function openSide() {
  side.classList.add('is-open');
  side.setAttribute('aria-hidden', 'false');
  histBtn.classList.add('is-on');
  refreshChats();
}

function closeSide() {
  side.classList.remove('is-open');
  side.setAttribute('aria-hidden', 'true');
  histBtn.classList.remove('is-on');
}

function newChat() {
  if (busy) { toast('等这一轮回复结束'); return; }
  currentId = null;
  currentTitle = '';
  currentCreatedAt = '';
  currentPersonaId = CONFIG.personaId || 'general';
  resetThread();
  renderChats();
  closeSide();
  input.focus();
}

async function openChat(id) {
  if (busy) { toast('等这一轮回复结束再切换'); return; }

  let conv;
  try { conv = await api.historyGet(id); } catch (_) { return; }
  if (!conv) { toast('这条对话打不开了'); return; }

  col.innerHTML = '';
  history.length = 0;
  currentId = conv.id;
  currentTitle = conv.title;
  currentCreatedAt = conv.createdAt;
  currentPersonaId = conv.personaId || CONFIG.personaId || 'general';
  if (conv.personaId && conv.personaId !== CONFIG.personaId
      && (CONFIG.personas || []).some((p) => p.id === conv.personaId)) {
    CONFIG.personaId = conv.personaId;
    syncPersonaChip();
    api.selectPersona(conv.personaId).catch(() => {});
  }

  for (const m of conv.messages) {
    const kind = m.role === 'user' ? 'me' : 'bot';
    const node = addMsg(kind, '');
    const body = node.querySelector('.msg-body');
    if (kind === 'bot') {
      node.dataset.raw = m.content;
      body.innerHTML = renderMd(m.content);
    } else {
      body.textContent = m.content;
    }
    addMsgActs(node, kind, m.content);
    history.push({ role: m.role, content: m.content, ts: m.ts });
  }

  renderChats();
  closeSide();
  scrollBottom(false);
}

async function exportChat(id) {
  let r;
  try { r = await api.historyExport(id); } catch (_) { return; }
  if (!r) return;
  if (r.ok) toast('已导出到 ' + r.path);
  else if (!r.canceled) toast(r.error || '导出失败');
}

async function deleteChat(chat) {
  if (!window.confirm(`删除「${chat.title}」？只删这一条，不影响其他对话。`)) return;
  try { await api.historyDelete(chat.id); } catch (_) { return; }
  if (chat.id === currentId) newChat();
  refreshChats();
}

function startRename(row, chat) {
  const titleEl = row.querySelector('.ch-title');
  if (!titleEl) return;

  const field = document.createElement('input');
  field.className = 'ch-edit';
  field.value = chat.title;
  field.maxLength = 60;
  field.spellcheck = false;
  titleEl.replaceWith(field);
  field.focus();
  field.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const t = field.value.trim();
    if (save && t && t !== chat.title) {
      try { await api.historyRename(chat.id, t); } catch (_) {}
      if (chat.id === currentId) currentTitle = t;
    }
    field.replaceWith(titleEl);
    refreshChats();
  };

  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  field.addEventListener('blur', () => finish(true));
}

async function onChatListClick(e) {
  const row = e.target.closest('.ch');
  if (!row) return;
  const chat = chats.find((c) => c.id === row.dataset.id);
  if (!chat) return;

  const btn = e.target.closest('.ch-b');
  if (btn) {
    if (btn.dataset.act === 'rename') { startRename(row, chat); return; }
    if (btn.dataset.act === 'export') { await exportChat(chat.id); return; }
    if (btn.dataset.act === 'del') { await deleteChat(chat); return; }
  }

  await openChat(chat.id);
}

/* ---- 人设 ---- */
function renderPersonas() {
  const list = CONFIG.personas || [];
  personaListEl.innerHTML = list.map((p) => {
    const on = p.id === CONFIG.personaId;
    const custom = String(p.id).startsWith('u-');
    return `<div class="pi${on ? ' is-on' : ''}" data-pid="${escAttr(p.id)}">
      <span class="pi-name">${escHtml(p.name)}${custom ? '<em class="pi-custom">自定义</em>' : ''}</span>
      ${on ? TICK : ''}
      ${custom ? `<span class="pi-tool" data-pedit="${escAttr(p.id)}" title="编辑">✎</span>
        <span class="pi-tool" data-pdel="${escAttr(p.id)}" title="删除">✕</span>` : ''}
    </div>`;
  }).join('');
}

function syncPersonaChip() {
  const p = (CONFIG.personas || []).find((x) => x.id === CONFIG.personaId);
  const raw = p ? p.name : '通用助手';
  personaNameEl.textContent = window.HitouchI18n ? window.HitouchI18n.t(raw) : raw;
}

function openPersonas() {
  renderPersonas();
  pmMsg.textContent = '';
  personaModal.classList.add('is-open');
  personaModal.setAttribute('aria-hidden', 'false');
}

function closePersonas() {
  personaModal.classList.remove('is-open');
  personaModal.setAttribute('aria-hidden', 'true');
}

async function pickPersona(id) {
  if (busy) { toast('等这一轮回复结束再换'); return; }
  let cfg;
  try { cfg = await api.selectPersona(id); } catch (_) { return; }
  if (!cfg) return;
  CONFIG = cfg;
  currentPersonaId = id;
  syncPersonaChip();
  renderPersonas();
  closePersonas();
  if (currentId) schedulePersist();
}

async function removePersona(id) {
  if (!window.confirm('删除这个人设？')) return;
  let res;
  try { res = await api.deletePersona(id); } catch (_) { return; }
  if (!res || !res.ok) { toast((res && res.error) || '删除失败'); return; }
  CONFIG = res.config;
  if (pmEditId === id) { pmEditId = null; pmName.value = ''; pmPrompt.value = ''; }
  renderPersonas();
  syncPersonaChip();
}

async function savePersonaForm() {
  const name = pmName.value.trim();
  const prompt = pmPrompt.value.trim();
  if (!name) { pmMsg.textContent = '先给它起个名字。'; return; }
  if (!prompt) { pmMsg.textContent = '写一句提示词，告诉它该怎么说话。'; return; }

  let res;
  try { res = await api.savePersona({ id: pmEditId || '', name, prompt }); }
  catch (err) { pmMsg.textContent = '保存失败：' + err.message; return; }

  if (!res || !res.ok) { pmMsg.textContent = (res && res.error) || '保存失败。'; return; }

  CONFIG = res.config;
  pmEditId = null;
  pmName.value = '';
  pmPrompt.value = '';
  pmMsg.textContent = '已保存。';
  renderPersonas();
  syncPersonaChip();
}

async function onPersonaListClick(e) {
  const del = e.target.closest('[data-pdel]');
  if (del) { await removePersona(del.dataset.pdel); return; }

  const edit = e.target.closest('[data-pedit]');
  if (edit) {
    const p = (CONFIG.personas || []).find((x) => x.id === edit.dataset.pedit);
    if (!p) return;
    pmEditId = p.id;
    pmName.value = p.name;
    pmPrompt.value = p.prompt || '';
    pmMsg.textContent = '正在编辑「' + p.name + '」，保存后覆盖。';
    pmName.focus();
    return;
  }

  const item = e.target.closest('[data-pid]');
  if (item) await pickPersona(item.dataset.pid);
}

/* ---- 设置 ---- */
const searchToggle = $('#searchToggle');
const searchState = $('#searchState');
const memoryToggle = $('#memoryToggle');
const memoryState = $('#memoryState');
const memoryModal = $('#memoryModal');
const memText = $('#memText');
const memMsg = $('#memMsg');

function setToggle(btn, tag, on) {
  if (tag) tag.textContent = on ? '开' : '关';
  if (btn) {
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

function applySettings() {
  const h = CONFIG.history || {};
  const lim = Math.min(200, Math.max(6, Number(h.contextLimit) || 40));
  ctxRange.value = String(lim);
  ctxVal.textContent = String(lim);
  setToggle(saveToggle, saveState, !!h.enabled);
  setToggle(searchToggle, searchState, !!(CONFIG.search || {}).enabled);
  setToggle(memoryToggle, memoryState, !!(CONFIG.memory || {}).enabled);
  applyTheme(CONFIG.theme === 'pro' ? 'pro' : 'light');
  updateStoreState();
}

/* ---- 外观：light / pro（蓝黑 + 全英文 + 右侧推理栏） ---- */
function applyTheme(theme) {
  const pro = theme === 'pro';
  document.documentElement.dataset.theme = pro ? 'pro' : 'light';
  if (window.HitouchI18n) window.HitouchI18n.apply(pro ? 'en' : 'zh');
  const seg = $('#themeSeg');
  if (seg) {
    seg.querySelectorAll('.seg-b').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.themePick === (pro ? 'pro' : 'light'));
    });
  }
  const desc = $('#aboutDesc');
  if (desc) {
    desc.textContent = pro
      ? 'A quiet client built by one person: no sign-up, no login, no telemetry — chats stay on this machine by default. Most of the code was written by me together with an AI; the source is public, so you can build it yourself and compare.'
      : '一个人做的安静客户端：不注册、不登录、没有遥测，对话默认只留在这一台电脑上。代码大部分是我和 AI 一起写的，源码公开，可以自己编一遍再比对。';
  }
  if (!pro) {
    const app = $('#app');
    if (app) app.classList.remove('think-on');
  }
}

async function pickTheme(theme) {
  if (theme === (CONFIG.theme || 'light')) return;
  applyTheme(theme);
  let cfg;
  try { cfg = await api.saveSettings({ theme }); } catch (_) { return; }
  if (cfg) CONFIG = cfg;
}

async function flipSetting(patch) {
  let cfg;
  try { cfg = await api.saveSettings(patch); }
  catch (_) { return null; }
  if (cfg) { CONFIG = cfg; applySettings(); }
  return cfg;
}

async function toggleSave() {
  const cfg = await flipSetting({ historyEnabled: !CONFIG.history.enabled });
  if (cfg && CONFIG.history.enabled) schedulePersist();
}

async function toggleSearch() {
  const on = !(CONFIG.search || {}).enabled;
  const cfg = await flipSetting({ webSearch: on });
  if (cfg && on) toast('联网搜索已开：它会自己去 Bing/百度查实时信息');
}

async function toggleMemory() {
  const on = !(CONFIG.memory || {}).enabled;
  const cfg = await flipSetting({ memoryEnabled: on });
  if (cfg && on) toast('本地记忆已开：对它说「记住…」即可');
}

/* ---- 记忆弹窗 ---- */
async function openMemory() {
  if (!(CONFIG.memory || {}).enabled) {
    toast('先在设置里打开「本地记忆」');
    return;
  }
  memMsg.textContent = '';
  memText.value = '读取中…';
  memoryModal.classList.add('is-open');
  memoryModal.setAttribute('aria-hidden', 'false');
  try {
    const r = await api.memoryGet();
    memText.value = (r && r.text) || '';
  } catch (_) {
    memText.value = '';
    memMsg.textContent = '读取失败。';
  }
}

function closeMemory() {
  memoryModal.classList.remove('is-open');
  memoryModal.setAttribute('aria-hidden', 'true');
}

async function saveMemory() {
  let r;
  try { r = await api.memorySet(memText.value); }
  catch (err) { memMsg.textContent = '保存失败：' + err.message; return; }
  memMsg.textContent = (r && r.ok) ? '已保存。' : ((r && r.error) || '保存失败。');
}

async function clearMemory() {
  if (!window.confirm('清空全部记忆？删了就找不回来了。')) return;
  try { await api.memorySet(''); } catch (_) {}
  memText.value = '';
  memMsg.textContent = '已清空。';
}

async function onCtxInput() {
  ctxVal.textContent = String(ctxRange.value);
}

async function onCtxChange() {
  const n = Number(ctxRange.value);
  let cfg;
  try { cfg = await api.saveSettings({ contextLimit: n }); } catch (_) { return; }
  if (cfg) CONFIG = cfg;
  applySettings();
}

async function openStoreFolder() {
  try {
    const r = await api.historyOpenFolder();
    if (r && !r.ok) toast(r.error || '打不开文件夹');
  } catch (_) {}
}

/* ---- 正文里的复制代码 / 外链 ---- */
async function onThreadClick(e) {
  const cp = e.target.closest('.cb-copy');
  if (cp) {
    const box = cp.closest('.code');
    const code = box && box.querySelector('pre code');
    const ok = await copyText(code ? code.textContent : '');
    cp.textContent = ok ? '已复制' : '复制失败';
    setTimeout(() => { cp.textContent = '复制'; }, 1200);
    return;
  }

  const a = e.target.closest('a[data-ext]');
  if (!a) return;
  e.preventDefault();
  const url = a.getAttribute('href');
  if (!url) return;
  if (!window.confirm('用系统浏览器打开这个链接？\n\n' + url)) return;
  try { await api.openExternal(url); } catch (_) {}
}

/* ---- 绑定与初始化 ---- */
function bindExtras() {
  histBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (side.classList.contains('is-open')) closeSide();
    else openSide();
  });
  $('#newChat').addEventListener('click', newChat);
  $('#openStore').addEventListener('click', openStoreFolder);
  chatList.addEventListener('click', onChatListClick);
  document.addEventListener('click', (e) => {
    if (!side.classList.contains('is-open')) return;
    if (e.target.closest('#side') || e.target.closest('#histBtn')) return;
    closeSide();
  });

  personaBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAll();
    openPersonas();
  });
  personaModal.querySelectorAll('[data-pclose]').forEach((el) => {
    el.addEventListener('click', closePersonas);
  });
  personaListEl.addEventListener('click', onPersonaListClick);
  $('#pmSave').addEventListener('click', savePersonaForm);
  $('#pmNew').addEventListener('click', () => {
    pmEditId = null;
    pmName.value = '';
    pmPrompt.value = '';
    pmMsg.textContent = '';
    pmName.focus();
  });

  saveToggle.addEventListener('click', toggleSave);
  searchToggle.addEventListener('click', toggleSearch);
  memoryToggle.addEventListener('click', toggleMemory);
  $('#memoryEdit').addEventListener('click', () => { closeAll(); openMemory(); });
  memoryModal.querySelectorAll('[data-memclose]').forEach((el) => {
    el.addEventListener('click', closeMemory);
  });
  $('#memSave').addEventListener('click', saveMemory);
  $('#memClear').addEventListener('click', clearMemory);
  $('#storeFolder').addEventListener('click', openStoreFolder);
  ctxRange.addEventListener('input', onCtxInput);
  ctxRange.addEventListener('change', onCtxChange);

  thread.addEventListener('click', onThreadClick);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (memoryModal.classList.contains('is-open')) { closeMemory(); return; }
    if (personaModal.classList.contains('is-open')) { closePersonas(); return; }
    if (side.classList.contains('is-open')) closeSide();
  });
}

function initExtras() {
  applySettings();
  syncPersonaChip();
  renderPersonas();
  updateStoreState();
  refreshChats();
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
  initExtras();
});

/* 启动动画播完、配置也读回来，才决定是否弹条款 */
Promise.all([bootDone, configReady]).then(gateConsent);
