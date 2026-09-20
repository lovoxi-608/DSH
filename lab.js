/* ══════════════════════════════════════════════════════════════
   小应用预留页（/lab）—— 全部「接入点」都在这一个文件里
   ──────────────────────────────────────────────────────────────
   · 页面地址：http://127.0.0.1:8787/lab （聊天页左侧「小应用」按钮 = location.href="/lab"，
     替换当前页打开；本页「← 返回聊天」= location.href="/"）；
   · 你的新应用三件套放这里：web/assets/lab/
       app.html  应用 HTML（fetch 后注入 #labMount，可以是片段或整块结构）
       app.css   应用样式（动态 <link>，404 也没关系）
       app.js    应用脚本（动态 <script>，在 #labMount 就位之后执行）
     /assets/* 由后端自动静态服务 → **不用改 web_app.py 的任何路由**，
     放好文件刷新 /lab 即自动接上；
   · 路径不一样就只改下面 LAB_APP 的三个地址，其它一律不用动；
   · 应用脚本可以用 window.LabHost（见文件末尾），就绪后会派发 "lab:ready" 事件。
   ⚠ 本文件整体包在 IIFE 里：你的 app.js 会被加载进同一个页面作用域，
     这样它不会和外壳的内部变量撞名（顶层只暴露 LAB_APP / LabHost）。
   ══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ★★★ 唯一接入点：指向你自己的应用文件（默认就是 web/assets/lab/ 下的三件套） ★★★ */
  const LAB_APP = {
    title: "小应用",                       // 顶栏标题 + 浏览器标签页标题
    html: "assets/lab/app.html?v=20260917p",          // 应用 HTML
    css: "assets/lab/app.css?v=20260917p",            // 应用样式（可留空字符串）
    js: "assets/lab/app.js?v=20260917p",              // 应用脚本（可留空字符串）
  };

  const labMount = document.getElementById("labMount");
  const labTitleEl = document.getElementById("labTitle");
  const labHintEl = document.getElementById("labHint");
  const readyCallbacks = [];
  let readyFired = false;
  let hintTimer = 0;

  /* ---------- 内部工具 ---------- */
  function fireReady() {
    if (readyFired) return;
    readyFired = true;
    readyCallbacks.splice(0).forEach((callback) => {
      try { callback(window.LabHost); } catch (error) { console.warn("lab:ready 回调出错", error); }
    });
    window.dispatchEvent(new CustomEvent("lab:ready", { detail: window.LabHost }));
  }

  async function fetchText(url) {
    if (!url) return "";
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return "";
      return await response.text();
    } catch (error) {
      console.warn("读取失败", url, error);
      return "";
    }
  }

  function loadCss(href) {
    if (!href) return Promise.resolve(false);
    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.addEventListener("load", () => resolve(true));
      link.addEventListener("error", () => { link.remove(); resolve(false); });
      document.head.append(link);
    });
  }

  function loadScript(src) {
    if (!src) return Promise.resolve(false);
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = src;
      script.addEventListener("load", () => resolve(true));
      script.addEventListener("error", () => { script.remove(); resolve(false); });
      document.body.append(script);
    });
  }

  /* ---------- 对外接口：window.LabHost ---------- */
  const LabHost = {
    version: "1.0",
    /* 挂载点：你应用里的根容器（= index 里的 #labMount） */
    mount: labMount,
    /* 当前配置的副本；运行时改了它再调 load() 就能换一个应用 */
    config: Object.assign({}, LAB_APP),

    /* 顶栏小提示（默认 2.6s 后自动消失；传 0 表示常驻） */
    hint(text, holdMs) {
      if (!labHintEl) return;
      labHintEl.textContent = String(text ?? "");
      if (hintTimer) { clearTimeout(hintTimer); hintTimer = 0; }
      const hold = holdMs === 0 ? 0 : (Number(holdMs) || 2600);
      if (hold) hintTimer = setTimeout(() => { labHintEl.textContent = ""; hintTimer = 0; }, hold);
    },

    /* 顶栏标题 / 浏览器标签页标题 */
    setTitle(text) {
      const title = String(text || "").trim();
      if (!title) return;
      if (labTitleEl) labTitleEl.textContent = title;
      document.title = title;
    },

    /* 同源接口封装：自动 JSON / 文本解析，非 2xx 直接抛错（消息里带状态码） */
    async api(path, options) {
      const response = await fetch(path, options);
      const type = response.headers.get("content-type") || "";
      const payload = type.includes("application/json") ? await response.json() : await response.text();
      if (!response.ok) {
        const message = (payload && payload.error) || `${response.status} ${response.statusText}`;
        throw new Error(message);
      }
      return payload;
    },

    /* 跳转（默认就是替换当前网页，不新开标签） */
    go(path) { location.href = path; },

    /* 应用就绪回调：已经就绪就立即执行 */
    onReady(callback) {
      if (typeof callback !== "function") return;
      if (readyFired) callback(this);
      else readyCallbacks.push(callback);
    },

    /* 装载应用：html 注入 #labMount → css → js → 触发 lab:ready。返回是否接上 */
    async load(overrides) {
      const config = Object.assign({}, this.config, overrides || {});
      this.config = Object.assign({}, config);
      const [htmlText] = await Promise.all([fetchText(config.html), loadCss(config.css)]);
      if (!htmlText.trim()) {
        this.hint(`还没接上：找不到 ${config.html}，当前显示的是预留位`);
        return false;
      }
      this.setTitle(config.title);
      labMount.innerHTML = htmlText;
      const scriptLoaded = await loadScript(config.js);
      if (!scriptLoaded && config.js) this.hint(`应用脚本没加载上：${config.js}`);
      fireReady();
      return true;
    },
  };

  window.LabHost = LabHost;

  /* ---------- 外壳自身的行为 ---------- */
  document.getElementById("labBack")?.addEventListener("click", () => { location.href = "/"; });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") location.href = "/";   // Esc 直接回聊天页
  });

  LabHost.load();
})();
