/* 宣传图渲染窗口：只加载 promo/poster.html，供 CDP 截图 */
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.commandLine.appendSwitch('disable-lcd-text');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1080,
    height: 980,
    show: true,
    backgroundColor: '#FBFAF7',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'promo', 'poster.html'));
  win.once('ready-to-show', () => win.focus());
});

app.on('window-all-closed', () => app.quit());
