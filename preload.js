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
