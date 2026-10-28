#!/bin/bash
# Hitouch 打包。三步走，绕开两个坑：
#   1. electron-builder 打包期间 exe 被自己占着句柄，rcedit 写不进去
#      → 先只构建目录，退出后等 20 秒再写
#   2. 写入失败会把 exe 改坏
#      → 每次尝试前从干净副本恢复
set -e
cd "$(dirname "$0")/.."

CLI=node_modules/electron-builder/cli.js
RC="/c/Users/Administrator/AppData/Local/electron-builder/Cache/winCodeSign/086808031/rcedit-x64.exe"
OUT=D:/hb-build
EXE=$OUT/win-unpacked/Hitouch.exe
CLEAN=$OUT/hitouch.clean
VER=$(node -p "require('./package.json').version")

echo "==> 1/3 构建目录 → $OUT"
HITOUCH_SKIP_RCEDIT=1 node $CLI --win --dir --config.directories.output=$OUT >/tmp/ht1.log 2>&1 \
  || { tail -20 /tmp/ht1.log; exit 1; }

cp -f "$EXE" "$CLEAN"
echo "    已备份干净副本"

write_res() {
  "$RC" "$EXE" \
    --set-icon build/icon.ico \
    --set-file-version "$VER" \
    --set-product-version "$VER" \
    --set-version-string ProductName Hitouch \
    --set-version-string FileDescription Hitouch \
    --set-version-string CompanyName Sun2530 \
    --set-version-string LegalCopyright "Copyright (C) 2026 Sun2530" \
    --set-version-string OriginalFilename Hitouch.exe \
    --set-version-string InternalName Hitouch
}

echo "==> 2/3 写入图标与版本信息（等 20 秒让句柄释放）"
sleep 20
ok=0
for i in 1 2 3 4 5; do
  if write_res; then ok=1; echo "    第 $i 次成功"; break; fi
  echo "    第 $i 次失败，恢复副本后重试"
  cp -f "$CLEAN" "$EXE"
  sleep 10
done
[ "$ok" = 1 ] || { echo "    写入失败，放弃"; exit 1; }

echo "==> 3/3 生成便携版"
HITOUCH_SKIP_RCEDIT=1 node $CLI --prepackaged "$OUT/win-unpacked" --win portable >/tmp/ht3.log 2>&1 \
  || { tail -20 /tmp/ht3.log; exit 1; }

ls -lh dist/*.exe
echo "完成"
