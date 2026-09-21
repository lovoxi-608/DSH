/* 主题切换、用户菜单、「过去 7 天」历史列表 */

const THEME_KEY = "mogao-theme";
const THEMES = ["jiangnan", "palace", "huizhou", "minnan", "zen"];
const GH_PAGES_BASE = "/DSH";

/* ═══════════════════════════════════════════════════════════════════
   ★ 品牌图：想换成自己的图片，只改下面这两行
     图片放到 web/assets/brand/ 下，例如 "my-logo.png" → "/DSH/assets/brand/my-logo.png"
     （说明见 web/assets/brand/README.md）
   ═══════════════════════════════════════════════════════════ */
const BRAND_LOGO_SRC = `${GH_PAGES_BASE}/assets/brand/deepseek.png`;        // 顶部左上角的横标
const BRAND_MARK_SRC = `${GH_PAGES_BASE}/assets/brand/deepseek.png`;        // 左侧边栏的圆标（建议用正方形图）
const BRAND_LOGO_FALLBACK = `${GH_PAGES_BASE}/assets/brand/deepseek.png`;   // 地址写错时退回这张，不会出现破图

function bindBrandImage(selector, src) {
  const image = document.querySelector(selector);
  if (!image) return;
  image.addEventListener("error", () => {
    if (image.getAttribute("src") !== BRAND_LOGO_FALLBACK) {
      image.src = BRAND_LOGO_FALLBACK;
      return;
    }
    image.style.display = "none";   // 连默认图都加载不到就干脆不显示
  });
  image.src = src || BRAND_LOGO_FALLBACK;
}

function applyBrandImages() {
  bindBrandImage("#brandLogo", BRAND_LOGO_SRC);
  bindBrandImage("#brandMark", BRAND_MARK_SRC);
  bindBrandImage("#centerLogo", BRAND_LOGO_SRC);   // 新聊天输入框上方的大 logo（跟左上角同一张图）
}

function switchTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll("[data-theme-menu]").forEach((item) => item.classList.toggle("active", item.dataset.themeMenu === theme));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatHistoryDate(value) {
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "刚刚";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `今天 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  }
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

/* ========== 「过去 7 天」历史列表 ========== */
function renderHistory(items) {
  const list = document.querySelector("#savedConversation");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="history-empty">第一次发送后，对话会保存在这里</div>';
    return;
  }
  const currentSession = window.chatApp?.getState?.().sessionId;
  list.innerHTML = items.map((item) => `
    <button class="history-item ${item.session_id === currentSession ? "active" : ""}" type="button" data-history-id="${escapeHtml(item.id)}" data-history-session="${escapeHtml(item.session_id || "")}">
      <span class="h-title">${escapeHtml(item.title || "未命名对话")}</span>
      <small>${formatHistoryDate(item.updated_at)} · ${item.messages?.length || 0} 条消息</small>
    </button>`).join("");
  list.querySelectorAll("[data-history-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const item = items.find((entry) => entry.id === button.dataset.historyId);
      if (item) window.chatApp?.restore?.(item);
    });
  });
}

async function loadHistory() {
  try {
    const response = await fetch("/api/history");
    const data = await response.json();
    renderHistory(data.items || []);
  } catch (error) {
    console.warn("历史记录读取失败", error);
  }
}

window.historyListPointer = { refresh: loadHistory };

/* ========== 用户菜单 ========== */
function closeUserMenu() {
  document.querySelector("#userMenu")?.classList.remove("show");
  document.querySelector("#userRow")?.classList.remove("open");
}

function showHint(text) {
  const target = document.querySelector("#typingState");
  if (!target) return;
  target.textContent = text;
  setTimeout(() => { target.textContent = "就绪"; }, 2400);
}

/* ========== 初始化 ========== */
window.addEventListener("DOMContentLoaded", () => {
  applyBrandImages();
  /* 聊天不透明度：/tuner 页面保存的设置，在聊天页生效（数值写在 body 的 CSS 变量上） */
  window.MogaoTuner?.apply?.(document.body);
  switchTheme(localStorage.getItem(THEME_KEY) || document.documentElement.dataset.theme || "jiangnan");
  document.querySelectorAll("[data-theme-menu]").forEach((item) => item.addEventListener("click", () => {
    switchTheme(item.dataset.themeMenu);
    closeUserMenu();
  }));

  const userRow = document.querySelector("#userRow");
  userRow?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelector("#userMenu")?.classList.toggle("show");
    userRow.classList.toggle("open");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#userRow") && !event.target.closest("#userMenu")) closeUserMenu();
  });

  /* 用户菜单动作：登录 / 注册、个人设置、退出登录 交给 auth.js 处理（auth.js 在本文件之后加载，
     所以只能在点击时去取 window.authPointer，不能在绑定时就取）。*/
  document.querySelectorAll("[data-menu-action]").forEach((item) => item.addEventListener("click", () => {
    const action = item.dataset.menuAction;
    closeUserMenu();
    if (window.authPointer?.handleMenuAction?.(action)) return;
    showHint(`【${action}】暂未开放`);
  }));

  /* 用户菜单里带 data-menu-url 的项：直接去那个地址（例如 /tuner 聊天透明度调节） */
  document.querySelectorAll("[data-menu-url]").forEach((item) => item.addEventListener("click", () => {
    closeUserMenu();
    window.open(item.dataset.menuUrl, "_blank", "noopener");
  }));

  // auth.js 复用这个小提示
  window.themeHint = showHint;

  loadHistory();
});
