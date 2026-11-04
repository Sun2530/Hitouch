/* ============================================================
   本地会话存储
   ------------------------------------------------------------
   一个会话一个文件，放在 userData/conversations/<id>.json。
   文件内容默认用 Electron safeStorage（Windows 下是 DPAPI）加密，
   同一台电脑、同一个 Windows 账户才能解开；DPAPI 不可用时退回明文，
   并在 storageInfo() 里如实说明，不假装加密。

   目录结构：
     conversations/index.json     会话索引（标题、时间、条数）
     conversations/<id>.json      单个会话
   ============================================================ */

const fs = require('fs');
const path = require('path');

const FILE_VERSION = 1;
const ID_RE = /^[A-Za-z0-9-]{6,64}$/;

const nowIso = () => new Date().toISOString();
const clampText = (s, max) => String(s == null ? '' : s).slice(0, max);

function createHistoryStore({ dir, safeStorage }) {
  const indexFile = path.join(dir, 'index.json');
  const convFile = (id) => path.join(dir, `${id}.json`);

  const canEncrypt = () => {
    try {
      return Boolean(safeStorage && safeStorage.isEncryptionAvailable());
    } catch (_) {
      return false;
    }
  };

  const wrap = (obj) => {
    if (canEncrypt()) {
      const buf = safeStorage.encryptString(JSON.stringify(obj));
      return { v: FILE_VERSION, enc: 1, data: buf.toString('base64') };
    }
    return { v: FILE_VERSION, enc: 0, data: obj };
  };

  const unwrap = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.enc === 1) {
      if (!canEncrypt()) return null;          /* 换了账户或系统，解不开 */
      const buf = Buffer.from(String(raw.data || ''), 'base64');
      return JSON.parse(safeStorage.decryptString(buf));
    }
    return raw.data && typeof raw.data === 'object' ? raw.data : null;
  };

  const read = (file) => {
    try {
      return unwrap(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (_) {
      return null;
    }
  };

  const write = (file, obj) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(wrap(obj)), 'utf8');
    fs.renameSync(tmp, file);                  /* 原子替换，别把旧会话写坏 */
  };

  const ensureDir = () => fs.mkdirSync(dir, { recursive: true });

  const cleanMessages = (list) => (Array.isArray(list) ? list : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-400)
    .map((m) => ({
      role: m.role,
      content: clampText(m.content, 200000),
      ts: typeof m.ts === 'string' ? m.ts : nowIso(),
    }));

  const normalize = (conv) => {
    const id = String((conv && conv.id) || '');
    if (!ID_RE.test(id)) throw new Error('会话 id 不合法');
    const messages = cleanMessages(conv.messages);
    const title = clampText(conv.title || '未命名对话', 60).trim() || '未命名对话';
    return {
      id,
      title,
      personaId: clampText(conv.personaId || 'general', 40),
      createdAt: typeof conv.createdAt === 'string' ? conv.createdAt : nowIso(),
      updatedAt: nowIso(),
      messages,
    };
  };

  /* ---- 索引 ---- */

  const metaOf = (conv) => ({
    id: conv.id,
    title: conv.title,
    personaId: conv.personaId,
    createdAt: conv.createdAt,
    updatedAt: conv.updatedAt,
    count: conv.messages.length,
  });

  const writeIndex = (items) => {
    const sorted = items.slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    write(indexFile, { v: FILE_VERSION, items: sorted });
    return sorted;
  };

  const readIndex = () => {
    const data = read(indexFile);
    return data && Array.isArray(data.items) ? data.items : null;
  };

  const rebuildIndex = () => {
    ensureDir();
    const items = [];
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.json') || name === 'index.json') continue;
      const conv = read(path.join(dir, name));
      if (conv && conv.id && Array.isArray(conv.messages)) items.push(metaOf(conv));
    }
    return writeIndex(items);
  };

  const list = () => {
    ensureDir();
    let items = readIndex();
    if (!items) items = rebuildIndex();
    return items;
  };

  const touchIndex = (meta) => {
    const items = (readIndex() || []).filter((x) => x.id !== meta.id);
    items.push(meta);
    writeIndex(items);
  };

  /* ---- 会话 ---- */

  const get = (id) => {
    if (!ID_RE.test(String(id || ''))) return null;
    const conv = read(convFile(id));
    if (!conv || conv.id !== id) return null;
    return { ...conv, messages: cleanMessages(conv.messages) };
  };

  const save = (input) => {
    ensureDir();
    const conv = normalize(input);
    write(convFile(conv.id), conv);
    touchIndex(metaOf(conv));
    return metaOf(conv);
  };

  const remove = (id) => {
    if (!ID_RE.test(String(id || ''))) return false;
    try { fs.unlinkSync(convFile(id)); } catch (_) { /* 已经不在了 */ }
    writeIndex((readIndex() || []).filter((x) => x.id !== id));
    return true;
  };

  const clear = () => {
    ensureDir();
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.json') || name.endsWith('.tmp')) {
        try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
      }
    }
    writeIndex([]);
  };

  const rename = (id, title) => {
    const conv = get(id);
    if (!conv) return null;
    conv.title = clampText(title, 60).trim() || conv.title;
    conv.updatedAt = nowIso();
    write(convFile(id), conv);
    const meta = metaOf(conv);
    touchIndex(meta);
    return meta;
  };

  const storageInfo = () => {
    let count = 0;
    try { count = list().length; } catch (_) { /* 目录不可写时不能让整个设置页崩掉 */ }
    return { dir, encrypted: canEncrypt(), count };
  };

  return { list, get, save, remove, clear, rename, storageInfo, dir };
}

module.exports = { createHistoryStore };
