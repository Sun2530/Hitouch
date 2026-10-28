const { app, BrowserWindow, ipcMain, Menu, screen, net, safeStorage, Notification, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/* --- 透明效果开关：默认开启，允许用环境变量关闭 --- */
function readTransparency() {
  return process.env.HITOUCH_NO_TRANSPARENCY !== '1';
}

let win = null;

/* ============================================================
   DeepSeek 接入
   ------------------------------------------------------------
   规范已经写死在这里，用户只需要填 API Key：
     Base URL   https://api.deepseek.com      （OpenAI 兼容格式）
     端点       POST /chat/completions        stream: true
     测试       GET  /models
     鉴权       Authorization: Bearer <key>
   请求全部走主进程，避开渲染进程的跨域限制，Key 也不进页面。
   ============================================================ */

const DS_BASE = 'https://api.deepseek.com';

const DS_MODELS = [
  { id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
];

/* 条款版本：条款文字有实质改动时加 1，老用户会被重新要求同意 */
const CONSENT_VERSION = 1;

const cfg = {
  provider: 'deepseek',
  model: 'deepseek-flash',
  thinking: false,   // 思考模式：默认关闭，聊天才不用干等
  apiKey: '',        // 只在内存里，落盘时加密
  skills: { alarm: true, repair: true },
  alarms: [],        // [{ id, at: 'YYYY-MM-DD HH:mm', text }]
  consent: { version: 0, at: null },   // 同意过的条款版本与时间
};

const GITHUB_REPO = 'https://github.com/Sun2530/Hitouch';

const cfgPath = () => path.join(app.getPath('userData'), 'hitouch.json');

function sealKey(key) {
  if (!key) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(key).toString('base64');
    }
  } catch (_) {}
  return 'raw:' + Buffer.from(key, 'utf8').toString('base64');
}

function unsealKey(blob) {
  if (!blob) return '';
  try {
    if (blob.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(blob.slice(4), 'base64'));
    if (blob.startsWith('raw:')) return Buffer.from(blob.slice(4), 'base64').toString('utf8');
  } catch (_) {}
  return '';
}

function loadCfg() {
  try {
    const raw = JSON.parse(fs.readFileSync(cfgPath(), 'utf8'));
    cfg.model = DS_MODELS.some((m) => m.id === raw.model) ? raw.model : DS_MODELS[0].id;
    cfg.thinking = Boolean(raw.thinking);
    cfg.apiKey = unsealKey(raw.apiKey || '');
    if (raw.skills && typeof raw.skills === 'object') {
      cfg.skills.alarm = raw.skills.alarm !== false;
      cfg.skills.repair = raw.skills.repair !== false;
    }
    if (Array.isArray(raw.alarms)) {
      cfg.alarms = raw.alarms
        .filter((a) => a && a.id && a.at && typeof a.text === 'string')
        .slice(0, 20)
        .map((a) => ({ id: String(a.id), at: String(a.at), text: String(a.text) }));
    }
    if (raw.consent && typeof raw.consent === 'object') {
      cfg.consent = {
        version: Number(raw.consent.version) || 0,
        at: typeof raw.consent.at === 'string' ? raw.consent.at : null,
      };
    }
  } catch (_) {
    /* 首次运行没有配置文件，用默认值 */
  }
}

function saveCfg() {
  const data = {
    provider: 'deepseek',
    model: cfg.model,
    thinking: cfg.thinking,
    apiKey: sealKey(cfg.apiKey),
    skills: cfg.skills,
    alarms: cfg.alarms,
    consent: cfg.consent,
  };
  try {
    fs.mkdirSync(path.dirname(cfgPath()), { recursive: true });
    fs.writeFileSync(cfgPath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('[cfg] 写入失败', err.message);
  }
}

/* --- 错误码 → 人话 --- */
function humanError(status, body) {
  let detail = '';
  try {
    const j = JSON.parse(body);
    detail = j.error?.message || j.message || '';
  } catch (_) {
    detail = (body || '').slice(0, 120);
  }
  if (status === 401) return 'API Key 无效或已失效，请重新填写。';
  if (status === 402) return '账户余额不足，请到 DeepSeek 平台充值。';
  if (status === 422) return '请求参数有误：' + detail;
  if (status === 429) return '请求太频繁，稍等一下再发。';
  if (status === 503) return 'DeepSeek 服务繁忙，稍后再试。';
  if (status >= 500) return 'DeepSeek 服务异常（' + status + '）。';
  return detail ? '请求失败（' + status + '）：' + detail : '请求失败（' + status + '）。';
}

/* --- GET /models：只验证 key，不消耗 token --- */
function testKey(apiKey) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    let req;
    try {
      req = net.request({ method: 'GET', url: DS_BASE + '/models', redirect: 'follow' });
    } catch (err) {
      return finish({ ok: false, error: '无法发起请求：' + err.message });
    }
    req.setHeader('Authorization', 'Bearer ' + apiKey);
    req.setHeader('Accept', 'application/json');
    let body = '';
    req.on('response', (res) => {
      res.on('data', (c) => { body += c.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode === 200) {
          let ids = [];
          try { ids = (JSON.parse(body).data || []).map((m) => m.id); } catch (_) {}
          finish({ ok: true, models: ids });
        } else {
          finish({ ok: false, error: humanError(res.statusCode, body) });
        }
      });
      res.on('error', (err) => finish({ ok: false, error: '读取响应失败：' + err.message }));
    });
    req.on('error', (err) => finish({ ok: false, error: netError(err) }));
    const timer = setTimeout(() => { try { req.abort(); } catch (_) {} finish({ ok: false, error: '连接超时，检查网络能否访问 api.deepseek.com。' }); }, 20000);
    req.on('close', () => clearTimeout(timer));
    req.end();
  });
}

function netError(err) {
  const m = String(err && err.message || err);
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|EAI_AGAIN/i.test(m)) return '连不上 api.deepseek.com，请检查网络或代理。';
  if (/ECONNREFUSED|ECONNRESET/i.test(m)) return '连接被中断，可能是代理或防火墙拦住了。';
  if (/ETIMEDOUT/i.test(m)) return '连接超时，检查网络。';
  return '网络错误：' + m;
}

/* --- POST /chat/completions，流式 --- */
function streamChat({ messages, model, apiKey, thinking, onDelta, onReasoning }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };

    const payload = JSON.stringify({
      model,
      messages,
      stream: true,
      /* 滑块左=关闭、右=开启；字段按 DeepSeek 现行规范 thinking.type */
      thinking: { type: thinking ? 'enabled' : 'disabled' },
    });

    let req;
    try {
      req = net.request({ method: 'POST', url: DS_BASE + '/chat/completions', redirect: 'follow' });
    } catch (err) {
      return reject(new Error('无法发起请求：' + err.message));
    }

    req.setHeader('Content-Type', 'application/json');
    req.setHeader('Authorization', 'Bearer ' + apiKey);
    req.setHeader('Accept', 'text/event-stream');

    let full = '';
    let errBody = '';
    let buf = '';

    const timer = setTimeout(() => {
      try { req.abort(); } catch (_) {}
      done(reject, new Error('响应超时，检查网络或代理设置。'));
    }, 120000);

    req.on('response', (res) => {
      const status = res.statusCode;

      res.on('data', (chunk) => {
        if (settled) return;
        const text = chunk.toString('utf8');

        if (status !== 200) { errBody += text; return; }

        buf += text;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line || !line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const delta = j.choices && j.choices[0] && j.choices[0].delta;
            if (!delta) continue;
            /* 思考模式下会先推 reasoning_content，只用于提示“正在思考”，不当正文 */
            if (onReasoning && typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
              onReasoning(delta.reasoning_content);
            }
            if (typeof delta.content === 'string' && delta.content) {
              full += delta.content;
              onDelta(delta.content);
            }
          } catch (_) { /* 半截 JSON 等下一块 */ }
        }
      });

      res.on('end', () => {
        if (status !== 200) return done(reject, new Error(humanError(status, errBody)));
        if (!full.trim()) return done(reject, new Error('模型没有返回内容，换个说法再试。'));
        done(resolve, full);
      });

      res.on('error', (err) => done(reject, new Error('读取响应失败：' + err.message)));
    });

    req.on('error', (err) => done(reject, new Error(netError(err))));
    req.write(payload);
    req.end();
  });
}

/* ============================================================
   技能：闹钟提醒 / 系统修复
   ------------------------------------------------------------
   模型不直接调用系统，只说“要做什么”。主进程执行，结果再回给模型。
   调用格式 [[call]]{"skill":"…","args":{…}}[[/call]]
   ============================================================ */

const pad2 = (n) => String(n).padStart(2, '0');

function fmtAt(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseAt(at) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/.exec(String(at || '').trim());
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* --- 闹钟 --- */
const alarmTimers = new Map();

function scheduleAlarms() {
  alarmTimers.forEach((t) => clearTimeout(t));
  alarmTimers.clear();

  cfg.alarms.forEach((a) => {
    const at = parseAt(a.at);
    if (!at) return;
    const delay = at.getTime() - Date.now();
    if (delay > 7 * 24 * 3600 * 1000) return;      // 太远，下次启动再排
    if (delay <= 0) { fireAlarm(a.id); return; }
    alarmTimers.set(a.id, setTimeout(() => fireAlarm(a.id), delay));
  });
}

function fireAlarm(id) {
  const i = cfg.alarms.findIndex((a) => a.id === id);
  if (i < 0) return;
  const alarm = cfg.alarms[i];
  cfg.alarms.splice(i, 1);
  alarmTimers.delete(id);
  saveCfg();

  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('skill:alarm-fired', { at: alarm.at, text: alarm.text });
  }

  try {
    if (Notification.isSupported()) {
      new Notification({
        title: alarm.text,
        body: 'Hitouch 提醒 · ' + alarm.at.slice(11),
      }).show();
    }
  } catch (_) {}
}

function addAlarm({ at, text }) {
  if (!cfg.skills.alarm) return { ok: false, error: '闹钟技能已关闭。' };

  const when = parseAt(at);
  if (!when) return { ok: false, error: '时间格式不对，要 YYYY-MM-DD HH:mm。' };

  /* 模型算错、或用户说的是刚过去的时刻：顺延到最近的一个未来点 */
  let guard = 0;
  while (when.getTime() <= Date.now() && guard < 8) {
    when.setDate(when.getDate() + 1);
    guard += 1;
  }
  if (when.getTime() <= Date.now()) return { ok: false, error: '这个时间已经过去了。' };
  if (cfg.alarms.length >= 20) return { ok: false, error: '提醒太多了，先取消几个。' };

  const alarm = { id: 'a' + Date.now().toString(36), at: fmtAt(when), text: String(text || '提醒').slice(0, 120) };
  cfg.alarms.push(alarm);
  cfg.alarms.sort((a, b) => a.at.localeCompare(b.at));
  saveCfg();
  scheduleAlarms();
  return { ok: true, alarm };
}

/* --- 系统修复：DISM + SFC --- */
let repairing = false;
const ELEV_WAIT_MAX = 40 * 60 * 1000;

function runCmd(cmdline, onLine) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmdline, { shell: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return resolve({ code: -1, out: err.message });
    }

    let out = '';
    let buf = '';

    const take = (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.search(/[\r\n]/)) >= 0) {
        const line = buf.slice(0, i).replace(/[\r\n]+$/, '');
        buf = buf.slice(i + 1);
        const t = line.trim();
        if (!t) continue;
        out += t + '\n';
        onLine(t);
      }
    };

    child.stdout.on('data', take);
    child.stderr.on('data', take);
    child.on('error', (err) => resolve({ code: -1, out: out + '\n' + err.message }));
    child.on('close', (code) => {
      const t = buf.trim();
      if (t) { out += t + '\n'; onLine(t); }
      resolve({ code, out });
    });
  });
}

const REPAIR_STEPS = [
  {
    key: 'dism',
    title: 'DISM 修复组件存储',
    cmd: 'chcp 65001>nul & DISM.exe /Online /Cleanup-Image /RestoreHealth',
  },
  {
    key: 'sfc',
    title: 'SFC 校验系统文件',
    cmd: 'chcp 65001>nul & sfc /scannow',
  },
];

/* 从几百行输出里挑几句人话，既回给模型也留在界面上 */
function keyLines(out) {
  const want = /未检测到|未找到|没有找到|已成功|成功|修复|还原|损坏|冲突|错误|失败|无法|拒绝|需要管理员|error|restore|repair|corrupt/i;
  return out.split('\n')
    .map((s) => s.trim())
    .filter((s) => s && want.test(s) && s.length < 160)
    .slice(-10);
}

function pctOf(line, last) {
  const m = /(\d{1,3}(?:[.,]\d+)?)\s*%/.exec(line);
  if (!m) return null;
  const p = Math.min(100, Math.round(parseFloat(m[1].replace(',', '.'))));
  return p === last ? null : p;
}

/* DISM 与 SFC 都要管理员。应用自己没提权时，靠一个临时 ps1 再拉起一次。 */
function needsElevation(r) {
  return r.code === 740 ||
         /Elevated permissions are required|RunAs|需要提升|管理员权限|拒绝访问/i.test(r.out || '');
}

/* 提权跑：外层 ps1 拉起提权进程，内层真跑命令并把输出写日志，我们轮询日志 */
function runElevatedRepair(send) {
  const dir = app.getPath('temp');
  /* 每次跑一份独立日志：上一次没结束又点一次时，不要互相截断 */
  const stamp = Date.now().toString(36);
  const logPath = path.join(dir, `hitouch-repair-${stamp}.log`);
  const innerPath = path.join(dir, `hitouch-repair-${stamp}.ps1`);
  const outerPath = path.join(dir, `hitouch-repair-${stamp}-run.ps1`);
  const q = (s) => String(s).replace(/'/g, "''");

  /* 顺手清掉一小时前留下的临时文件 */
  try {
    fs.readdirSync(dir)
      .filter((f) => f.startsWith('hitouch-repair-'))
      .forEach((f) => {
        const p = path.join(dir, f);
        try {
          if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) fs.unlinkSync(p);
        } catch (_) {}
      });
  } catch (_) {}

  const inner = [
    `$log = '${q(logPath)}'`,
    `function W($t) { $t | Out-File -FilePath $log -Append -Encoding utf8 }`,
    `W '##DISM##'`,
    `& dism.exe /Online /Cleanup-Image /RestoreHealth 2>&1 | ForEach-Object { W $_.ToString() }`,
    `W '##SFC##'`,
    `& sfc.exe /scannow 2>&1 | ForEach-Object { W $_.ToString() }`,
    `W '##END##'`,
  ].join('\r\n');

  const outer = [
    `$ErrorActionPreference = 'Stop'`,
    `try {`,
    `  $p = Start-Process -FilePath 'powershell.exe' -Verb RunAs -PassThru -WindowStyle Hidden ` +
      `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${q(innerPath)}'`,
    `  $p.WaitForExit()`,
    `  exit $p.ExitCode`,
    `} catch {`,
    `  ('##ERR## ' + $_.Exception.Message) | Out-File -FilePath '${q(logPath)}' -Append -Encoding utf8`,
    `  exit 1`,
    `}`,
  ].join('\r\n');

  try {
    fs.writeFileSync(logPath, '', 'utf8');
    fs.writeFileSync(innerPath, inner, 'utf8');
    fs.writeFileSync(outerPath, outer, 'utf8');
  } catch (err) {
    return Promise.resolve({ ok: false, error: '写临时脚本失败：' + err.message, steps: [] });
  }

  return new Promise((resolve) => {
    const steps = [];
    let cur = null;
    let seen = 0;
    let carry = '';
    let errMsg = '';
    let stopped = false;

    const push = (key, title) => {
      cur = { key, title, code: 0, raw: '' };
      steps.push(cur);
      send({ type: 'step', key, title });
    };

    const finishStep = () => {
      if (!cur) return;
      const bad = /错误代码|Error:|失败|无法|拒绝/i.test(cur.raw);
      cur.code = bad ? 1 : 0;
      send({ type: 'done', key: cur.key, code: cur.code });
      cur = null;
    };

    const eat = (text) => {
      const parts = (carry + text).split(/\r?\n/);
      carry = parts.pop();
      parts.forEach((raw) => {
        const line = raw.trim();
        if (!line) return;
        if (line.startsWith('##DISM##')) return push('dism', REPAIR_STEPS[0].title);
        if (line.startsWith('##SFC##')) { finishStep(); return push('sfc', REPAIR_STEPS[1].title); }
        if (line.startsWith('##END##')) return finishStep();
        if (line.startsWith('##ERR##')) { errMsg = line.slice(7).trim(); return; }
        if (cur) {
          cur.raw += line + '\n';
          send({ type: 'line', key: cur.key, line, percent: pctOf(line, 0) });
        }
      });
    };

    const readOnce = () => {
      let text = '';
      try { text = fs.readFileSync(logPath, 'utf8').replace(/^\uFEFF/, ''); } catch (_) {}
      if (text.length > seen) {
        eat(text.slice(seen));
        seen = text.length;
      }
    };

    const timer = setInterval(readOnce, 800);
    const runner = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', outerPath],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });

    runner.stdout.on('data', () => {});
    runner.stderr.on('data', () => {});

    const stop = (note) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      readOnce();
      finishStep();
      if (note) errMsg = errMsg || note;
      const out = steps.map((s) => ({ key: s.key, title: s.title, code: s.code, lines: keyLines(s.raw) }));
      resolve({ ok: !errMsg && out.every((s) => s.code === 0), error: errMsg || undefined, steps: out });
    };

    const kill = setTimeout(() => {
      try { runner.kill(); } catch (_) {}
      stop('提权进程超过 40 分钟没有结束。');
    }, ELEV_WAIT_MAX);

    runner.on('error', (err) => { clearTimeout(kill); stop('起不了提权进程：' + err.message); });
    runner.on('close', (code) => {
      clearTimeout(kill);
      setTimeout(() => stop(code === 0 ? '' : (errMsg || `提权进程退出码 ${code}`)), 900);
    });
  });
}

async function runRepair(send) {
  if (!cfg.skills.repair) return { ok: false, error: '系统修复技能已关闭。', steps: [] };
  if (repairing) return { ok: false, error: '已经在跑一次修复了，等它结束。', steps: [] };

  repairing = true;
  try {
    /* 先直接跑第一步：应用本身是管理员时会一路跑完，不用折腾提权 */
    const first = REPAIR_STEPS[0];
    send({ type: 'step', key: first.key, title: first.title });
    let last = 0;
    const r1 = await runCmd(first.cmd, (line) => {
      const pct = pctOf(line, last);
      if (pct !== null) last = pct;
      send({ type: 'line', key: first.key, line, percent: pct });
    });

    if (needsElevation(r1)) {
      send({ type: 'elevate' });
      return await runElevatedRepair(send);
    }

    send({ type: 'done', key: first.key, code: r1.code });
    const steps = [{ key: first.key, title: first.title, code: r1.code, lines: keyLines(r1.out) }];

    const second = REPAIR_STEPS[1];
    send({ type: 'step', key: second.key, title: second.title });
    last = 0;
    const r2 = await runCmd(second.cmd, (line) => {
      const pct = pctOf(line, last);
      if (pct !== null) last = pct;
      send({ type: 'line', key: second.key, line, percent: pct });
    });
    send({ type: 'done', key: second.key, code: r2.code });
    steps.push({ key: second.key, title: second.title, code: r2.code, lines: keyLines(r2.out) });

    return { ok: steps.every((s) => s.code === 0), steps };
  } finally {
    repairing = false;
  }
}

/* --- 模型侧说明：只在有技能开着时注入 --- */
function skillPrompt() {
  const now = new Date();
  const week = '日一二三四五六'[now.getDay()];
  const on = [];
  if (cfg.skills.alarm) {
    on.push('- alarm — 设闹钟，到点由客户端弹窗提醒。args = {"at":"YYYY-MM-DD HH:mm","text":"提醒内容"}。' +
            'at 是本地时间、24 小时制；用户只说“几点”时按今天算，那个时刻已过就顺延到明天。text 写用户要被告知的那句话本身。');
  }
  if (cfg.skills.repair) {
    on.push('- repair — 在本机跑系统修复：先 DISM /Online /Cleanup-Image /RestoreHealth，再 sfc /scannow，' +
            '通常要 5 到 20 分钟。args = {}。');
  }
  if (!on.length) return '';

  return [
    '你在 Hitouch 桌面客户端里运行，可以直接让客户端在本机执行技能。',
    '',
    '调用方式：在回答里单独占一行，输出',
    '[[call]]{"skill":"名称","args":{...}}[[/call]]',
    '',
    '可用技能：',
    ...on,
    '',
    '规则：',
    '1. 只有用户明确要求时才调用；说法含糊就先问一句，别自己猜。',
    '2. 调用块单行、JSON 合法，不要加代码围栏、不要加注释、不要在正文里重复它。',
    `3. 当前本地时间是 ${fmtAt(now)}（周${week}），算时间以此为准。`,
    '4. 调用技能的那一轮不要先宣布结果（别写“已经设好了”“马上开始跑”），正文能省就省；' +
      '等客户端把真实结果给你，再用一句话确认，别假装已经做过。',
  ].join('\n');
}

/* --- IPC --- */
function publicConfig() {
  return {
    provider: 'deepseek',
    base: DS_BASE,
    models: DS_MODELS,
    model: cfg.model,
    thinking: cfg.thinking,
    hasKey: Boolean(cfg.apiKey),
    skills: { alarm: cfg.skills.alarm, repair: cfg.skills.repair },
    alarms: cfg.alarms.slice(),
    repairing,
    repo: GITHUB_REPO,
    consent: {
      version: cfg.consent.version,
      at: cfg.consent.at,
      current: CONSENT_VERSION,
      agreed: cfg.consent.version === CONSENT_VERSION,
    },
  };
}

ipcMain.handle('api:config', () => publicConfig());

ipcMain.handle('api:save', (_e, { apiKey, model, thinking }) => {
  if (typeof apiKey === 'string' && apiKey.trim()) cfg.apiKey = apiKey.trim();
  if (typeof model === 'string' && DS_MODELS.some((m) => m.id === model)) cfg.model = model;
  if (typeof thinking === 'boolean') cfg.thinking = thinking;
  saveCfg();
  return publicConfig();
});

ipcMain.handle('api:clear', () => {
  cfg.apiKey = '';
  saveCfg();
  return publicConfig();
});

/* --- 条款同意 / 拒绝 --- */
ipcMain.handle('consent:accept', () => {
  cfg.consent = { version: CONSENT_VERSION, at: new Date().toISOString() };
  saveCfg();
  return publicConfig();
});

ipcMain.handle('consent:decline', () => {
  app.quit();
  return { ok: true };
});

/* 仓库链接：交给系统浏览器，不在应用内开网页 */
ipcMain.handle('app:open-repo', async () => {
  try {
    await shell.openExternal(GITHUB_REPO);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('api:test', async (_e, { apiKey }) => {
  const key = (apiKey || cfg.apiKey || '').trim();
  if (!key) return { ok: false, error: 'API Key 是空的。' };
  return testKey(key);
});

ipcMain.handle('api:chat', async (event, { messages }) => {
  if (!cfg.apiKey) return { ok: false, error: '还没有接入模型。点右上角 ⓘ 里的「模型与接入」填 API Key。' };
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return { ok: false, error: '没有可发送的内容。' };

  /* 技能说明与当前时间放在系统消息里，不进历史，每轮重新生成 */
  const sys = skillPrompt();
  const payload = sys ? [{ role: 'system', content: sys }, ...list] : list;

  try {
    const text = await streamChat({
      messages: payload,
      model: cfg.model,
      apiKey: cfg.apiKey,
      thinking: cfg.thinking,
      onDelta: (delta) => {
        if (!event.sender.isDestroyed()) event.sender.send('api:delta', { delta });
      },
      onReasoning: (delta) => {
        if (!event.sender.isDestroyed()) event.sender.send('api:reasoning', { delta });
      },
    });
    return { ok: true, text };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

/* --- 技能 IPC --- */
ipcMain.handle('skill:config', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    if (typeof patch.alarm === 'boolean') cfg.skills.alarm = patch.alarm;
    if (typeof patch.repair === 'boolean') cfg.skills.repair = patch.repair;
    saveCfg();
  }
  return publicConfig();
});

ipcMain.handle('skill:alarm-add', (_e, args) => addAlarm(args || {}));

ipcMain.handle('skill:alarm-del', (_e, { id }) => {
  const i = cfg.alarms.findIndex((a) => a.id === id);
  if (i >= 0) {
    cfg.alarms.splice(i, 1);
    const t = alarmTimers.get(id);
    if (t) { clearTimeout(t); alarmTimers.delete(id); }
    saveCfg();
  }
  return publicConfig();
});

ipcMain.handle('skill:repair', async (event, _args) => {
  const send = (payload) => {
    if (!event.sender.isDestroyed()) event.sender.send('skill:repair:progress', payload);
  };
  const res = await runRepair(send);
  return { ...res, config: publicConfig() };
});

/* ============================================================
   窗口
   ============================================================ */

function createWindow() {
  const transparency = readTransparency();

  /* 窗口尺寸按可用工作区收敛，避免小屏溢出 */
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const w = Math.min(1000, Math.max(760, wa.width - 200));
  const h = Math.min(820, Math.max(600, wa.height - 120));

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 720,
    minHeight: 540,
    frame: false,
    thickFrame: true,
    backgroundColor: '#FFFFFF',
    show: false,
    title: 'Hitouch',
    icon: path.join(__dirname, 'src', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: [
        `--hitouch-transparency=${transparency ? '1' : '0'}`,
      ],
    },
  });

  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.webContents.send('win:shown');   // 窗口真正可见后再放启动动画
  });

  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('maximize', () => win.webContents.send('win:maximized', true));
  win.on('unmaximize', () => win.webContents.send('win:maximized', false));
  win.on('closed', () => { win = null; });
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  app.setAppUserModelId('dev.hitouch.app');
  loadCfg();
  scheduleAlarms();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('win:minimize', () => { if (win) win.minimize(); });
ipcMain.on('win:maximize', () => {
  if (!win) return;
  win.isMaximized() ? win.unmaximize() : win.maximize();
});
ipcMain.on('win:close', () => { if (win) win.close(); });
