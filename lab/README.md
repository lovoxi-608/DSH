# 小应用预留页（/lab）— 接入接口说明 + 给下一个 AI 的提示词

> 2026-09-14 由用户要求加：预留一个新网页地址（打开后替换当前网页），
> 聊天页与这个新页面互相独立；新应用写好后直接接上，不用再动聊天页。

## 一、已经留好的东西（现状）

| 项目 | 内容 |
| --- | --- |
| 页面地址 | `http://127.0.0.1:8787/lab` |
| 外壳文件 | `web/lab.html` + `web/lab.css` + `web/lab.js`（路由已加进 `web_app.py` 的 `STATIC_ROUTES`） |
| 打开方式 | 聊天页左侧导航「小应用」按钮 = `location.href="/lab"`（**替换当前页，不新开标签**）；外壳里「← 返回聊天」/ Esc = `location.href="/"` |
| 挂载点 | `#labMount`（`LabHost.mount`）—— 你的应用就挂在这里 |
| 你的应用文件 | `web/assets/lab/`：`app.html`（HTML 片段）+ `app.css` + `app.js` |
| 为什么放 assets | 后端对 `/assets/*` 自动静态服务 → **用户文件零路由改动**，放进去刷新即生效 |
| 接线开关 | `web/lab.js` 顶部 `LAB_APP = { title, html, css, js }`（默认就指向上面三个文件；换路径只改这里） |
| 就绪信号 | `window` 事件 `"lab:ready"` + `LabHost.onReady(cb)` |

### window.LabHost（外壳暴露给应用的接口）

| 成员 | 作用 |
| --- | --- |
| `LabHost.mount` | 挂载点元素（`#labMount`） |
| `LabHost.api(path, options)` | 同源 `fetch` 封装：自动 JSON/文本解析，非 2xx 抛 `Error`（带后端 `error` 字段） |
| `LabHost.hint(text, holdMs?)` | 顶栏小提示（默认 2.6s 消失，传 `0` 常驻） |
| `LabHost.setTitle(text)` | 顶栏标题 + 浏览器标签页标题 |
| `LabHost.go(path)` | 跳转（默认替换当前网页，不新开标签） |
| `LabHost.load(overrides?)` | 换一个应用装载（`overrides` 覆盖 `LAB_APP` 字段）；返回 `true/false` 表示是否接上 |
| `LabHost.onReady(cb)` | 应用就绪后回调（已就绪则立即执行） |
| `LabHost.config` | 当前 `LAB_APP` 配置副本 |

### 加载顺序（`LabHost.load()` 内部）

1. 并行：`fetch(app.html)` + 挂载 `app.css`（`<link>`）；
2. `app.html` 非空 → 注入 `#labMount`（会替换掉空壳占位），空 → 保留预留位并提示；
3. 挂载 `app.js`（`<script>`，执行时 `#labMount` 已就位）；
4. 派发 `"lab:ready"` 事件。

应用脚本的可用接口就是上面那张表；**没有别的隐式约定**。

## 二、给下一个 AI 的提示词（整段复制粘贴）

```text
这个工作区是一个本地 Python 聊天站（http://127.0.0.1:8787，入口 web_app.py，前端在 web/）。
站点里已经预留了一个与聊天页互相独立的「小应用」页：http://127.0.0.1:8787/lab，
外壳文件是 web/lab.html / web/lab.css / web/lab.js（路由已注册在 web_app.py 的 STATIC_ROUTES）。
现在请把我接下来描述的新小应用写出来，并接到这个预留位上。

接入接口（照用，不要改这套约定）：
1. 应用三件套放 web/assets/lab/：app.html（HTML 片段或整块结构）、app.css、app.js。
   该目录由后端 /assets/* 自动静态服务，不需要加任何路由；放好后刷新 /lab 会自动接上
   （web/lab.js 顶部 LAB_APP 默认已指向这三个文件；换路径只改 LAB_APP）。
2. 应用脚本里可以用 window.LabHost：
   · LabHost.mount            = 挂载点（#labMount），你的应用就长在这里
   · LabHost.api(path, opts)  = 同源 fetch 封装，自动解析 JSON/文本，非 2xx 抛 Error
   · LabHost.hint(text, ms)   = 顶栏小提示（ms=0 常驻）
   · LabHost.setTitle(text)   = 顶栏标题 + 标签页标题
   · LabHost.go(path)         = 跳转（替换当前网页，不新开标签）
   · LabHost.onReady(cb) / window 事件 "lab:ready" = 就绪回调（app.js 执行时 DOM 已就位）
3. 外壳（顶栏、返回聊天、#labMount）不要动；聊天页已加左侧「小应用」入口，也不要动聊天页。

必须遵守的约定与坑：
- web/app.js、web/theme.js、web/auth.js、web/pet.js 是共享全局作用域的普通脚本，
  给它们加顶层 const/let 前先 grep 重名，否则后加载的文件会整体 SyntaxError。
  （lab 页面是独立的，不加载这些文件，不受影响。）
- 新静态文件必须同步加进 web_app.py 的 STATIC_ROUTES，否则 404；
  但放 web/assets/lab/ 下的应用文件走 /assets/*，自动可访问，无需改路由。
- 改了 web_app.py 或任何 .py 后必须重启 8787：
  先 `Get-NetTCPConnection -LocalPort 8787 -State Listen` 找到 PID 并 Stop-Process
  （Windows 的 SO_REUSEADDR 允许新旧进程同时绑 8787，不杀旧进程会出现「新路由 404」），再启动。
- 不要动聊天页现有功能（气泡、交付卡、登录、宠物、上下文控制器等）。

动手前先读 web/lab/README.md 与 web/lab.js 确认接口；完成后告诉我怎么打开验证。
```

## 三、维护提示

- 改动外壳后刷新 `/lab` 即可，无需重启后端（只有改 `web_app.py` 才要重启 8787）。
- 目前 `web/assets/lab/` 还没有文件 → `/lab` 显示空壳预留位，这是正常状态。
- 想撤销这次预留：删掉 `web/lab*` 三个文件 + `STATIC_ROUTES` 里三条 `/lab*` 路由 +
  聊天页 `#navLab` 按钮和 `web/app.js` 里对应的两行跳转监听。
