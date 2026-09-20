/* 参考页面交互：主题切换、输入框背景图、过去七天历史记录。 */

/* ★ 默认输入框背景图地址：图片可放在 web/assets/bg/，也可填完整网址。 */
const INPUT_BG_DEFAULT = "/assets/bg/input-bg.png";
const THEME_KEY = "mogao-theme";
const INPUT_BG_KEY = "mogao-input-bg";
const THEMES = ["jiangnan", "palace", "huizhou", "minnan", "zen"];

function applyInputBg(url) {
  const value = String(url || "").trim();
  if (!value) {
    document.documentElement.style.setProperty("--input-bg-image", "none");
    return;
  }
  const probe = new Image();
  probe.onload = () => document.documentElement.style.setProperty("--input-bg-image", `url("${value}")`);
  probe.onerror = () => document.documentElement.style.setProperty("--input-bg-image", "none");
  probe.src = value;
}

function switchTheme(theme) {
  if (!THEMES.includes(theme)) return;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll(".theme-btn").forEach((button) => button.classList.toggle("active", button.dataset.theme === theme));
  document.querySelectorAll("[data-theme-menu]").forEach((item) => item.classList.toggle("active", item.dataset.themeMenu === theme));
}

function formatHistoryDate(value) {
  const date = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(date.getTime())) return "刚刚";
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function renderHistory(items) {
  const list = document.querySelector("#savedConversation");
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="history-empty">第一次发送后，对话会保存在这里</div>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <button class="history-item ${item.session_id === window.contextControllerPointer?.getState()?.sessionId ? "active" : ""}" type="button" data-history-id="${escapeHtml(item.id)}">
      ${escapeHtml(item.title || "未命名对话")}<small>${formatHistoryDate(item.updated_at)} · ${item.messages?.length || 0} 条消息</small>
    </button>`).join("");
  list.querySelectorAll("[data-history-id]").forEach((button) => {
    button.addEventListener("click", () => restoreHistory(button.dataset.historyId, items));
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

async function saveCurrentConversation() {
  const current = window.contextControllerPointer?.getState?.();
  if (!current?.messages?.some((item) => String(item.content || "").trim())) return;
  const first = current.messages.find((item) => String(item.content || "").trim());
  try {
    await fetch("/api/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: current.sessionId, messages: current.messages, summary: current.summary, title: String(first.content).slice(0, 28) }),
    });
    await loadHistory();
  } catch (error) {
    console.warn("历史记录保存失败", error);
  }
}

async function restoreHistory(id, items) {
  const item = items.find((entry) => entry.id === id);
  if (!item || !window.restoreConversationPointer?.restore) return;
  window.restoreConversationPointer.restore(item);
  renderHistory(items);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

window.persistCurrentConversation = saveCurrentConversation;

window.addEventListener("DOMContentLoaded", () => {
  switchTheme(localStorage.getItem(THEME_KEY) || document.documentElement.dataset.theme || "jiangnan");
  document.querySelectorAll(".theme-btn").forEach((button) => button.addEventListener("click", () => switchTheme(button.dataset.theme)));
  document.querySelectorAll("[data-theme-menu]").forEach((item) => item.addEventListener("click", () => switchTheme(item.dataset.themeMenu)));

  const bgInput = document.querySelector("#inputBgInput");
  const savedBg = localStorage.getItem(INPUT_BG_KEY);
  if (bgInput) bgInput.value = savedBg ?? INPUT_BG_DEFAULT;
  applyInputBg(savedBg ?? INPUT_BG_DEFAULT);
  document.querySelector("#inputBgApply")?.addEventListener("click", () => {
    const value = bgInput.value.trim();
    localStorage.setItem(INPUT_BG_KEY, value);
    applyInputBg(value);
  });
  document.querySelector("#inputBgReset")?.addEventListener("click", () => {
    localStorage.removeItem(INPUT_BG_KEY);
    bgInput.value = INPUT_BG_DEFAULT;
    applyInputBg(INPUT_BG_DEFAULT);
  });

  const userRow = document.querySelector("#userRow");
  userRow?.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelector("#userMenu")?.classList.toggle("show");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest("#userRow") && !event.target.closest("#userMenu")) document.querySelector("#userMenu")?.classList.remove("show");
  });

  document.querySelectorAll(".qa-btn").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "new-chat") window.newConversationPointer?.start();
    if (action === "compress") window.contextControllerPointer?.compress();
    if (action === "clear") window.clearContextPointer?.clear();
    if (action === "latest") document.querySelector("#messages")?.scrollTo({ top: document.querySelector("#messages").scrollHeight, behavior: "smooth" });
  }));
  loadHistory();
});
