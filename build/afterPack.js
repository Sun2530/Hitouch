/* 打包钩子：signAndEditExecutable 关掉了 electron-builder 自带的 rcedit，
   所以在这里手动把图标和版本信息写进内层 exe（外层 portable 的图标由 NSIS 自己嵌）。 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const CACHE = path.join(process.env.LOCALAPPDATA, 'electron-builder', 'Cache', 'winCodeSign');

function findRcedit() {
  if (!fs.existsSync(CACHE)) return null;
  for (const dir of fs.readdirSync(CACHE)) {
    const p = path.join(CACHE, dir, 'rcedit-x64.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;

  /* 构建脚本会在这一阶段跳过，等 electron-builder 完全释放 exe 句柄后
     再单独调 rcedit，最后用 --prepackaged 压成便携版。 */
  if (process.env.HITOUCH_SKIP_RCEDIT === '1') {
    console.log('[afterPack] 按 HITOUCH_SKIP_RCEDIT 跳过 rcedit');
    return;
  }

  const exe = path.join(context.appOutDir, 'Hitouch.exe');
  if (!fs.existsSync(exe)) {
    console.log('[afterPack] exe 不存在，跳过：', exe);
    return;
  }

  const rcedit = findRcedit();
  if (!rcedit) {
    console.log('[afterPack] 没找到 rcedit，跳过');
    return;
  }

  const icon = path.join(__dirname, 'icon.ico');
  const version = context.packager.appInfo.version;

  const args = [
    exe,
    '--set-icon', icon,
    '--set-file-version', version,
    '--set-product-version', version,
    '--set-version-string', 'ProductName', 'Hitouch',
    '--set-version-string', 'FileDescription', 'Hitouch',
    '--set-version-string', 'CompanyName', 'Sun2530',
    '--set-version-string', 'LegalCopyright', 'Copyright (C) 2026 Sun2530',
    '--set-version-string', 'OriginalFilename', 'Hitouch.exe',
    '--set-version-string', 'InternalName', 'Hitouch',
  ];

  /* 杀软会在刚写出的 exe 上抢句柄，rcedit 会报 Unable to commit changes。
     同步重试，最多 8 次，每次间隔 1.2s。 */
  const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      execFileSync(rcedit, args, { stdio: 'pipe' });
      console.log(`[afterPack] 已写入图标与版本信息（第 ${attempt} 次成功）：`, exe);
      return;
    } catch (err) {
      const out = `${err.stdout || ''}${err.stderr || ''}`.trim().split('\n')[0];
      console.log(`[afterPack] 第 ${attempt} 次写入失败：${out || err.message}`);
      if (attempt === 8) throw err;
      nap(1200);
    }
  }
};
