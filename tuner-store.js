/* ═══════════════════════════════════════════════════════════════════════════
   聊天不透明度调节 · 唯一数据源
   ───────────────────────────────────────────────────────────────────────────
   ★ 调界面的地址（浏览器直接打开）：http://127.0.0.1:8787/tuner
   ★ 想手动改默认值：只改下面的 DEFAULTS（全部是「百分比 / px」）
   ★ 保存位置：localStorage["mogao-tuner-v1"]（清空浏览器缓存会回到默认值）

   数值 → CSS 变量（真正生效的样式在 web/app.css 的 body.has-chat-bg 一段）：
     panel → --chat-panel-mix   助手气泡 / 思考卡片 / 输入框 / 上下文控制器 保留的不透明度（越小越透）
     user  → --chat-user-mix    自己的气泡保留的不透明度
     blur  → --chat-panel-blur  毛玻璃模糊半径（px，越大背景越虚化）
     bg    → --chat-bg-opacity  背景图本身的浓度（0~100，越大背景越明显）
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var STORAGE_KEY = "mogao-tuner-v1";
  var DEFAULTS = { panel: 70, user: 88, blur: 8, bg: 62 };
  var LIMITS = {
    panel: [10, 100, 1],
    user: [20, 100, 1],
    blur: [0, 24, 1],
    bg: [0, 100, 1],
  };

  function clampNumber(key, value) {
    var limit = LIMITS[key] || [0, 100, 1];
    var number = Number(value);
    if (!isFinite(number)) number = DEFAULTS[key];
    return Math.max(limit[0], Math.min(limit[1], Math.round(number)));
  }

  function read() {
    var values = { panel: DEFAULTS.panel, user: DEFAULTS.user, blur: DEFAULTS.blur, bg: DEFAULTS.bg };
    try {
      var stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (stored && typeof stored === "object") {
        Object.keys(values).forEach(function (key) {
          if (stored[key] !== undefined) values[key] = clampNumber(key, stored[key]);
        });
      }
    } catch (error) {
      console.warn("不透明度设置读取失败，用默认值", error);
    }
    return values;
  }

  function write(values) {
    var merged = read();
    Object.keys(merged).forEach(function (key) {
      if (values && values[key] !== undefined) merged[key] = clampNumber(key, values[key]);
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (error) {
      console.warn("不透明度设置写入失败", error);
    }
    return merged;
  }

  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.warn("不透明度设置重置失败", error);
    }
    return read();
  }

  /* 把设置写成 body 上的行内 CSS 变量（行内样式优先级最高，能盖住 app.css 里的默认值） */
  function apply(root) {
    var target = root || document.body;
    if (!target) return read();
    var values = read();
    target.style.setProperty("--chat-panel-mix", values.panel + "%");
    target.style.setProperty("--chat-user-mix", values.user + "%");
    target.style.setProperty("--chat-panel-blur", values.blur + "px");
    target.style.setProperty("--chat-bg-opacity", String(values.bg / 100));
    return values;
  }

  window.MogaoTuner = {
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    LIMITS: LIMITS,
    read: read,
    write: write,
    reset: reset,
    apply: apply,
  };
})();
