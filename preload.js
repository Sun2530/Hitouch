const { contextBridge, ipcRenderer } = require('electron');

const arg = (key, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`));
  return hit ? hit.split('=')[1] : fallback;
};

contextBridge.exposeInMainWorld('hitouch', {
  transparency: arg('hitouch-transparency', '1') === '1',
  reduceMotion: false,
  onShown: (cb) => ipcRenderer.once('win:shown', () => cb()),
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),

  /* --- DeepSeek 接入 --- */
  getConfig: () => ipcRenderer.invoke('api:config'),
  saveConfig: (payload) => ipcRenderer.invoke('api:save', payload),
  clearKey: () => ipcRenderer.invoke('api:clear'),
  testKey: (payload) => ipcRenderer.invoke('api:test', payload),
  chat: (payload) => ipcRenderer.invoke('api:chat', payload),
  abort: (requestId) => ipcRenderer.invoke('api:abort', { requestId }),
  onDelta: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('api:delta', handler);
    return () => ipcRenderer.removeListener('api:delta', handler);
  },
  onReasoning: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('api:reasoning', handler);
    return () => ipcRenderer.removeListener('api:reasoning', handler);
  },

  /* --- 人设 / 设置 --- */
  personaList: () => ipcRenderer.invoke('persona:list'),
  selectPersona: (id) => ipcRenderer.invoke('persona:select', { id }),
  savePersona: (payload) => ipcRenderer.invoke('persona:save', payload),
  deletePersona: (id) => ipcRenderer.invoke('persona:delete', { id }),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  /* --- 本地会话 --- */
  historyList: () => ipcRenderer.invoke('history:list'),
  historyGet: (id) => ipcRenderer.invoke('history:get', { id }),
  historySave: (conv) => ipcRenderer.invoke('history:save', { conv }),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', { id }),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historyRename: (id, title) => ipcRenderer.invoke('history:rename', { id, title }),
  historyInfo: () => ipcRenderer.invoke('history:info'),
  historyOpenFolder: () => ipcRenderer.invoke('history:open-folder'),
  historyExport: (id) => ipcRenderer.invoke('history:export', { id }),
  openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),

  /* --- 联网搜索 / 本地记忆 --- */
  runSearch: (query) => ipcRenderer.invoke('search:run', { query }),
  memoryGet: () => ipcRenderer.invoke('memory:get'),
  memorySet: (text) => ipcRenderer.invoke('memory:set', { text }),
  memoryAppend: (text) => ipcRenderer.invoke('memory:append', { text }),

  /* --- 条款与仓库 --- */
  acceptConsent: () => ipcRenderer.invoke('consent:accept'),
  declineConsent: () => ipcRenderer.invoke('consent:decline'),
  openRepo: () => ipcRenderer.invoke('app:open-repo'),

  /* --- 技能 --- */
  saveSkills: (patch) => ipcRenderer.invoke('skill:config', patch),
  addAlarm: (args) => ipcRenderer.invoke('skill:alarm-add', args),
  delAlarm: (id) => ipcRenderer.invoke('skill:alarm-del', { id }),
  runRepair: () => ipcRenderer.invoke('skill:repair', {}),
  onRepair: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('skill:repair:progress', handler);
    return () => ipcRenderer.removeListener('skill:repair:progress', handler);
  },
  onAlarm: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('skill:alarm-fired', handler);
    return () => ipcRenderer.removeListener('skill:alarm-fired', handler);
  },
});
