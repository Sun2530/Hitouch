<div align="center">

# Hitouch

在自己电脑上和一个模型说话。

<br />

<img src="assets/home.png" alt="Hitouch 主界面" width="880" />

</div>

<br />

## 是什么

Hitouch 是一个跑在 Windows 上的桌面对话客户端。它不提供算力，只做两件事：把你输入的内容交给你自己配置的模型（当前支持 DeepSeek），再把回答呈现出来。

没有账号体系，没有云端同步，没有推荐，没有信息流。打开就是一个输入框。

## 界面

白底、留白、极细的分隔线。所有图标都是手画的，没有一处是通用图标库里的东西。

<div align="center">
<img src="assets/settings.png" alt="设置面板" width="420" />
</div>

设置只有五件事：模型与接入、技能、隐私声明、GitHub 仓库、作者页。没有一层套一层的二级菜单。

## 能做什么

**对话**
流式输出，等宽处理代码块，支持 Markdown 的粗体、列表、引用、行内代码。回车发送，Shift + 回车换行。

**推理开关**
输入框右下角那条滑轨控制是否让模型先想再说。关掉更快，打开更稳，选哪个由你。

**模型**
DeepSeek-V4.1-Flash 与 DeepSeek-V4-Pro 二选一，随时切换。

**技能**
内置两个，可以在设置里单独关掉：

<div align="center">
<img src="assets/skills.png" alt="技能面板" width="420" />
</div>

- **闹钟提醒** — 直接跟模型说「明天八点提醒我」，它会把这个意图转成一条定时任务，到点弹窗。不用记格式。
- **系统修复** — 让模型调用 Windows 自带的 DISM 与 SFC，校验并修复本机系统文件。需要管理员权限时会请求提权，执行日志每次单独成文件。

**使用条款**
第一次打开会要求阅读并同意使用条款与未成年人保护条款，不同意则无法使用。条款版本与同意时间记录在本机。

## 安装

从 [Releases](https://github.com/Sun2530/Hitouch/releases) 下载 `Hitouch-x.y.z-portable.exe`，双击即可，不需要安装。

体积偏大是因为里面打包了 Electron 运行时，属于单文件绿色版的代价。

**首次使用**：点右上角 `i` → 模型与接入 → 填入自己的 DeepSeek API Key → 选模型 → 保存。Key 会立刻用 Windows DPAPI 加密后存在本机，不经过任何第三方服务器。

## 数据

- API Key：DPAPI 加密，存于本机用户目录，只有当前 Windows 账户能解开。
- 对话内容：不落盘，关掉窗口就没了。唯一例外是你让它设的闹钟，那需要存在本地才能在到点触发。
- 除模型供应商外，软件不向任何服务器发送数据。

## 自己构建

需要 Node.js 18 以上。

```bash
npm install
npm start          # 开发模式
npm run dist       # 产出 dist/Hitouch-<version>-portable.exe
```

技术栈只有 Electron 和原生 HTML/CSS/JS，没有前端框架，没有打包器。

## 说明

这是一个个人项目，由一个人维护，更新不承诺频率。用之前请先读软件内的使用条款——它同样适用于通过本仓库获取的版本。

## 许可

[MIT](LICENSE) © 2026 Sun2530
