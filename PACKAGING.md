# 打包说明（Windows）

本文档记录本机打包时必须注意的三件事，都是踩过坑之后写下来的。

## 1. 必须用管理员权限跑 electron-builder

```powershell
Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','D:\build.ps1'
```

非提权时 electron-builder 生成卸载器那一步会以 `__COMPAT_LAYER=RunAsInvoker` 执行中间安装器并 exit 2，`dist` 里只留一个约 151 KB 的空壳 setup.exe（大小看着"正常"，其实没有载荷）。

## 2. nsis 与 portable 必须分两次单独跑

```powershell
node node_modules\electron-builder\cli.js --win nsis
node node_modules\electron-builder\cli.js --win portable
```

合并成 `--win nsis portable` 时，portable 那一步会挂住（日志停在 `building target=portable`，进程消失，不产出文件）。挂住后先删 `dist\<name>-x64.nsis.7z` 再单独跑 portable。

## 3. 便携版要弹 UAC，得改 electron-builder 的模板

`nsis.requestExecutionLevel` 在 electron-builder 25.1.8 的 schema 里**不是合法字段**（会报 `configuration.nsis has an unknown property 'requestExecutionLevel'`），而 `win.requestedExecutionLevel` 只影响主 exe 的 manifest、且需要 `signAndEditExecutable: true`（本机开启后构建会卡死）。

唯一可行的做法是改模板第 8 行：

```
node_modules/app-builder-lib/templates/nsis/portable.nsi:8
- RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}
+ RequestExecutionLevel admin
```

改完后重装依赖会覆盖，需要重新执行一次：

```powershell
$tpl = "node_modules\app-builder-lib\templates\nsis\portable.nsi"
(Get-Content $tpl -Raw).Replace('RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}', 'RequestExecutionLevel admin') |
  Set-Content $tpl -NoNewline -Encoding utf8
```

验证方式：产物二进制里 `requireAdministrator` 出现 1 次、`asInvoker` 出现 0 次。

```powershell
$t = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes("dist\Hitouch-x.y.z-portable.exe"))
([regex]::Matches($t,'requireAdministrator')).Count   # 期望 1
([regex]::Matches($t,'asInvoker')).Count              # 期望 0
```

## 发版检查清单

1. 版本号同步四处：`package.json` 的 `version`、`src/index.html` 里两处 `foot-ver`、`README.md` / `README.en.md` 的 badge 与下载表、`docs/index.html`。
2. 产物断言：setup.exe > 60 MB、`requireAdministrator` ×1、FileVersion 正确、记录 sha256。
3. 冒烟：`/S /D=<无空格临时目录>` 安装 → 检查文件数与卸载项 → 卸载 → 确认目录与注册表都干净。
4. 双端发布：Gitee release（中文说明）+ GitHub release（英文说明），两边都传 setup / portable / SHA256SUMS / 两张展示图。
5. 落地页：更新 `docs/index.html` 的版本、字节数、两行 sha256，然后同步 `Sun2530/hitouch-site` 并触发 Pages 构建。
