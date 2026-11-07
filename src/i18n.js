/* i18n.js — 程序员外观（pro theme）用的中英对照
 * 做法：只翻译"操作面"（标题栏、抽屉、输入区、设置、技能、隐私、作者页、常见提示）。
 * 使用条款与同意页保持中文原文——那是法律文本，以中文为准，不做二次翻译。
 */
(function () {
  'use strict';

  const MAP = {
    /* ---- 标题栏 / 浮层 ---- */
    '设置': 'Settings',
    '未接入': 'Not connected',
    '已接入': 'Connected',
    '技能': 'Skills',
    '隐私声明': 'Privacy',
    'GitHub 仓库': 'GitHub repo',
    '作者页': 'About the author',
    '作者': 'Author',
    'Hitouch 作者': 'About Hitouch',

    /* ---- 左抽屉 ---- */
    '对话': 'Chats',
    '本地保存': 'Saved locally',
    '保存': 'Save',
    '打开': 'Open',
    '还没有保存的对话': 'No saved chats yet',
    '记录已关闭': 'Persistence off',
    '保存在本机': 'Saved locally',
    '加密保存在本机': 'Encrypted locally',

    /* ---- 空状态 ---- */
    '你好，我是 Hitouch。': "Hi, I'm Hitouch.",
    '先随便聊聊，看这个框顺不顺手。': 'Say something — see if the box feels right.',
    '还没接入模型。点输入框左边的齿轮 →「设置」，填一个 DeepSeek 的 API Key，就能真的聊了。':
      'No model yet. Click the gear by the input → Settings, paste a DeepSeek API key, and you can actually talk.',
    '通用助手': 'General assistant',

    /* ---- 输入区 ---- */
    '发消息…': 'Message…',
    '发送': 'Send',
    '选择人设': 'Choose persona',
    '推理': 'Reasoning',
    '关': 'Off',
    '开': 'On',

    /* ---- 设置 ---- */
    '通用设置': 'General',
    '外观': 'Appearance',
    '浅色': 'Light',
    '程序员': 'Engineer',
    '浅色日常用；程序员是蓝黑界面 + 全英文术语':
      'Light for everyday use. Engineer is the blue-black UI with English terms.',
    '模型与接入': 'Model & Access',
    '源码仓库': 'Source',
    '主页': 'Homepage',
    '当前模型': 'Current model',
    '供应商': 'Provider',
    '模型': 'Model',
    '用 Windows 的加密接口存在本机，不上传到任何别处。':
      'Encrypted with the Windows data-protection API. Never leaves this machine.',
    '测试连接': 'Test connection',
    '保存并启用': 'Save & enable',
    '对话设置': 'Chat settings',
    '先想再答，慢一点但更准': 'Think first — slower, sharper',
    '保存对话记录': 'Persist chats',
    '关：关掉窗口就没了；开：加密存在本机': 'Off: gone on close. On: encrypted at rest.',
    '联网搜索': 'Web search',
    '让它自己去查实时信息': 'Let it look up live data',
    '本地记忆': 'Local memory',
    '你说「记住…」它才写，加密存本机': 'Writes only on “remember …”. Encrypted locally.',
    '它记住的事': 'Memory store',
    '看看记了什么，可以改或清空': 'Inspect, edit or wipe',
    '查看': 'View',
    '会话文件夹': 'Chat directory',
    '保存的对话存在这里': 'Where persisted chats live',
    '上下文': 'Context window',
    '轮': 'turns',
    '带动多少轮对话进上下文。数值越大越记得住，也越慢。':
      'How many turns to carry into the context window. Higher keeps more, costs more.',

    /* ---- 人设 / 记忆弹窗 ---- */
    '人设': 'Persona',
    '新建 / 编辑': 'New / Edit',
    '清空表单': 'Clear form',
    '保存人设': 'Save persona',
    '一行一条，加密存在本机；清空即彻底删除': 'One per line, encrypted locally; clearing wipes it',
    '全部清空': 'Wipe all',
    '保存修改': 'Save changes',
    '知道了': 'Got it',
    '还没有记住任何事。对它说「记住我喜欢…」试试。':
      'Nothing stored yet. Try telling it: “remember I like …”.',

    /* ---- 技能页 ---- */
    '闹钟提醒': 'Alarm',
    '到点弹窗提醒，模型可以直接设定': 'Pops a reminder on time; the model can set it',
    '系统修复': 'System repair',
    'DISM 修复组件存储，SFC 校验系统文件': 'DISM for the component store, SFC for system files',
    '立即运行': 'Run now',
    '提醒': 'Reminders',
    '还没有提醒': 'No reminders',
    '取消': 'Cancel',
    '未设定': 'Not set',

    /* ---- 隐私页 ---- */
    'Hitouch 在你自己的电脑上运行。界面本身不联网，只有你跟模型说话时，那一段内容才会发给你选的供应商。':
      'Hitouch runs on your own machine. The UI itself makes no network calls; only the message you send goes to the provider you picked.',
    '不收集使用数据，不需要账号，没有埋点。': 'No usage data, no account, no analytics.',
    '对话只存在于当前窗口，关掉就没了，不写入磁盘。想留下记录，可以在设置里打开「保存对话记录」：开启后对话加密存在本机（%APPDATA%\\Hitouch\\conversations），只有这台电脑这个账户能解开。':
      'Chats live in the current window and vanish on close — nothing hits the disk. To keep them, turn on “Persist chats” in Settings: they are encrypted at %APPDATA%\\Hitouch\\conversations and only this Windows account can open them.',
    '存在本机的有两样：你选的模型，和你的 API Key。Key 用 Windows 自带的加密接口保存，明文不落盘。':
      'Two things are stored: the model you picked and your API key. The key is sealed by the Windows data-protection API — never written in plain text.',
    '联网搜索和本地记忆都默认关闭，由你在设置里手动打开。搜索只把关键词发给 Bing 或百度，不带别的；记忆加密存在本机，随时可看、可清。':
      'Web search and local memory are off by default and only you can enable them. Search sends the keywords to Bing or Baidu and nothing else; memory is encrypted locally and you can read or wipe it anytime.',
    '发出去的内容按 DeepSeek 的隐私政策处理，那部分不归 Hitouch 管。':
      'What you send is governed by DeepSeek’s privacy policy — that part is outside Hitouch’s hands.',

    /* ---- 常见提示 ---- */
    '先填 API Key。': 'Enter an API key first.',
    '先填 API Key，再保存。': 'Enter an API key, then save.',
    '已保存。': 'Saved.',
    '保存失败。': 'Save failed.',
    '已复制': 'Copied',
    '复制': 'Copy',
    '复制失败': 'Copy failed',
    '删除': 'Delete',
    '编辑': 'Edit',
    '重命名': 'Rename',
    '重新生成': 'Regenerate',
    '停止生成': 'Stop',
    '导出 Markdown': 'Export Markdown',
    '已导出到 ': 'Exported to ',
    '导出失败': 'Export failed',
    '读取中…': 'Loading…',
    '读取失败。': 'Load failed.',
    '正在验证…': 'Verifying…',
    '正在连 api.deepseek.com…': 'Connecting to api.deepseek.com…',
    '连接正常': 'Connection OK',
    '连接失败。': 'Connection failed.',
    '验证失败，没有保存。': 'Verification failed — not saved.',
    '没有拿到回复。': 'No reply came back.',
    '请求出错：': 'Request failed: ',
    '未命名对话': 'Untitled chat',
    '这条对话打不开了': 'This chat cannot be opened',
    '同意条款后即可使用': 'Accept the terms to start',
    '未接入模型': 'No model',
    '去接入': 'Connect',
    '个': '',
    '条': '',
  };

  const ATTRS = ['placeholder', 'title', 'aria-label'];

  /* 记住每个节点第一次见到的中文原文，之后动态重建的节点也能被翻译 */
  const origText = new WeakMap();
  const origAttr = new WeakMap();

  function trimText(s) {
    return s.replace(/^\s+|\s+$/g, '');
  }

  function collect() {
    const rec = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      let raw = origText.get(n);
      if (raw == null) {
        const cur = n.nodeValue;
        const t = trimText(cur);
        if (t && /[\u4e00-\u9fa5]/.test(t)) { raw = cur; origText.set(n, raw); }
      }
      if (raw == null) continue;
      const key = trimText(raw);
      if (key) rec.push({ type: 'text', node: n, raw, key });
    }
    const els = document.body.querySelectorAll('*');
    for (const el of els) {
      let store = origAttr.get(el);
      for (const a of ATTRS) {
        const v = el.getAttribute && el.getAttribute(a);
        if (!store) { store = {}; origAttr.set(el, store); }
        if (!(a in store)) {
          if (v && /[\u4e00-\u9fa5]/.test(v)) store[a] = v;
          else continue;
        }
        rec.push({ type: 'attr', node: el, attr: a, raw: store[a], key: store[a] });
      }
    }
    return rec;
  }

  /* 把 raw 里的中文段替换成英文，保留前后空白 */
  function translate(raw, key) {
    const en = MAP[key];
    if (!en) return null;
    const lead = raw.match(/^\s*/)[0];
    const tail = raw.match(/\s*$/)[0];
    return lead + en + tail;
  }

  function apply(lang) {
    const pro = lang === 'en';
    const list = collect();
    for (const r of list) {
      if (r.type === 'text') {
        if (pro) {
          const v = translate(r.raw, r.key);
          if (v != null && r.node.nodeValue !== v) r.node.nodeValue = v;
        } else if (r.node.nodeValue !== r.raw) {
          r.node.nodeValue = r.raw;
        }
      } else {
        if (pro) {
          const en = MAP[r.key];
          if (en && r.node.getAttribute(r.attr) !== en) r.node.setAttribute(r.attr, en);
        } else if (r.node.getAttribute(r.attr) !== r.raw) {
          r.node.setAttribute(r.attr, r.raw);
        }
      }
    }
    document.documentElement.lang = pro ? 'en' : 'zh-CN';
  }

  /* 动态文本（toast / 状态行）：pro 时按整句查表 */
  function t(s) {
    if (document.documentElement.dataset.theme !== 'pro') return s;
    return MAP[String(s).trim()] || s;
  }

  window.HitouchI18n = { apply, t, map: MAP };
})();
