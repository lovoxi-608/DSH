/* ═══════════════════════════════════════════════════════════════════════════
   /tuner 聊天不透明度调节页
   ───────────────────────────────────────────────────────────────────────────
   逻辑非常简单：滑动 → 写 localStorage（MogaoTuner.write）→ 应用到 body 的 CSS 变量。
   聊天页（index.html）会在加载时读取同一份设置并生效，见 web/theme.js 的 applyTuner()。
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var tuner = window.MogaoTuner;
  if (!tuner) return;

  /* 背景图预览：跟聊天页一样按「思考强度档位」取图（对应 web/app.js 的 MIND_BG_IMAGES） */
  var BG_IMAGES = {
    1: "/assets/bg/1.png",
    2: "/assets/bg/2.png",
    3: "/assets/bg/3.png",
    4: "/assets/bg/4.png",
    5: "/assets/bg/5.png",
  };

  var FIELDS = [
    { key: "panel", slider: "#sliderPanel", output: "#outPanel", unit: "%" },
    { key: "user", slider: "#sliderUser", output: "#outUser", unit: "%" },
    { key: "blur", slider: "#sliderBlur", output: "#outBlur", unit: "px" },
    { key: "bg", slider: "#sliderBg", output: "#outBg", unit: "%" },
  ];

  var inputs = {};

  function render() {
    var values = tuner.apply(document.body);
    FIELDS.forEach(function (field) {
      var input = inputs[field.key];
      if (!input) return;
      input.value = String(values[field.key]);
      var output = document.querySelector(field.output);
      if (output) output.textContent = values[field.key] + field.unit;
    });
  }

  function renderPreview(theme) {
    if (theme) document.documentElement.dataset.theme = theme;

    /* 背景图 */
    var level = Number(localStorage.getItem("mogao-effort-level")) || 3;
    var layer = document.querySelector("#tunerBg");
    if (layer) layer.style.backgroundImage = 'url("' + (BG_IMAGES[level] || BG_IMAGES[3]) + '")';

    /* 品牌图 / 助手头像：与聊天页保持同一份地址（theme.js / app.js 顶部常量） */
    var brandSrc = (typeof BRAND_LOGO_SRC !== "undefined" && BRAND_LOGO_SRC) ? BRAND_LOGO_SRC : "/assets/brand/deepseek.png";
    var logo = document.querySelector("#tunerLogo");
    if (logo) logo.src = brandSrc;
    var avatar = document.querySelector("#tunerAiAvatar");
    if (avatar) avatar.src = "/assets/ai/dafeiyu.png";
  }

  window.addEventListener("DOMContentLoaded", function () {
    /* 预览区要跟聊天页一样处于「有背景图」状态，气泡/输入框的半透明规则才会启用 */
    document.body.classList.add("has-chat-bg");
    renderPreview(localStorage.getItem("mogao-theme") || "jiangnan");

    FIELDS.forEach(function (field) {
      var input = document.querySelector(field.slider);
      if (!input) return;
      inputs[field.key] = input;
      input.addEventListener("input", function () {
        var patch = {};
        patch[field.key] = Number(input.value);
        tuner.write(patch);
        render();
      });
    });

    document.querySelector("#tunerReset")?.addEventListener("click", function () {
      tuner.reset();
      render();
    });

    render();

    /* 换主题（左上角没有主题按钮，但聊天页换主题后本页跟着变） */
    window.addEventListener("storage", function (event) {
      if (event.key === "mogao-theme") renderPreview(event.newValue);
    });
  });
})();
