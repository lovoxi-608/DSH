const STORAGE_KEY = "huipai-pixel-workshop-v1";
const POINTER_KEY = "contextController";
const state = {
  sessionId: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
  messages: [],
  summary: "",
  model: "",
  models: [],
  thinking: [],
  thinkingVisible: false,
  thinkingCollapsed: false,
  thinkingDone: false,
  streamingAnswer: "",
  streamingMessageIndex: -1,
  requestError: "",
};

const $ = (selector) => document.querySelector(selector);
const messagesEl = $("#messages");
const inputEl = $("#messageInput");
const formEl = $("#chatForm");
const sendButton = $("#sendButton");
const modelSelect = $("#modelSelect");
const controller = $("#contextController");
const controllerHandle = $("#controllerHandle");

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessionId: state.sessionId, messages: state.messages, summary: state.summary, model: state.model }));
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored) return;
    state.sessionId = stored.sessionId || state.sessionId;
    state.messages = Array.isArray(stored.messages)
      ? stored.messages.filter((item) => !item.streaming && !(item.role === "assistant" && !String(item.content || "").trim()))
      : [];
    state.summary = stored.summary || "";
    state.model = stored.model || "";
  } catch (error) {
    console.warn("无法读取本地对话记录", error);
  }
}

function renderMessages() {
  if (!state.messages.length) {
    messagesEl.innerHTML = '<div class="empty-state"><div><strong>欢迎来到天井会客厅</strong><p>从一声问候开始，留下你的想法。<br />这段对话会被安静地保存下来。</p></div></div>';
  } else {
    messagesEl.innerHTML = state.messages.map((item) => `
      <article class="message ${item.role === "user" ? "user" : "assistant"}">
        <div class="bubble"><span class="message-meta">${item.role === "user" ? "访客" : "工坊助手"}</span>${escapeHtml(item.content)}</div>
      </article>`).join("");
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
  if (state.thinkingVisible) {
    const collapsedClass = state.thinkingCollapsed ? "is-collapsed" : "";
    const doneClass = state.thinkingDone ? "is-done" : "";
    const marker = state.thinkingDone ? '<span class="thinking-check">✓</span>' : '<span class="thinking-orbit"></span>';
    const tail = state.thinkingDone ? '<span class="thinking-done">已完成</span>' : '<span class="thinking-dots">···</span>';
    messagesEl.insertAdjacentHTML("beforeend", `<div class="thinking-card ${collapsedClass} ${doneClass}"><div class="thinking-title">${marker}<strong>思考过程 · 阶段记录</strong>${tail}</div><div class="thinking-lines">${state.thinking.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div><button class="thinking-toggle" type="button">展开思考过程</button></div>`);
    const thinkingCard = messagesEl.querySelector(".thinking-card");
    thinkingCard?.querySelector(".thinking-toggle")?.addEventListener("click", () => {
      state.thinkingCollapsed = !state.thinkingCollapsed;
      thinkingCard.classList.toggle("is-collapsed", state.thinkingCollapsed);
      thinkingCard.querySelector(".thinking-toggle").textContent = state.thinkingCollapsed ? "展开思考过程" : "收起思考过程";
    });
  }
  $("#messageCount").textContent = state.messages.length;
  const percent = Math.min(100, Math.round((state.messages.length / 20) * 100));
  $("#memoryPercent").textContent = `${percent}%`;
  $("#memoryBar").style.width = `${percent}%`;
  $("#collapsedPercent").textContent = `${percent}%`;
  $("#collapsedBar").style.width = `${percent}%`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function renderModels() {
  modelSelect.innerHTML = state.models.map((model) => `<option value="${escapeHtml(model.id)}" ${model.available ? "" : "disabled"}>${escapeHtml(model.label)} · ${escapeHtml(model.provider)}${model.available ? "" : "（未配置 API）"}</option>`).join("");
  const available = state.models.find((model) => model.available);
  state.model = state.model && state.models.some((model) => model.id === state.model && model.available) ? state.model : available?.id || "";
  modelSelect.value = state.model;
  $("#activeModel").textContent = state.model || "未配置";
  $("#modelHint").textContent = available ? `已连接：${available.label}` : "暂无可用模型，请配置 API";
}

async function loadConfig() {
  const response = await fetch("/api/config");
  const config = await response.json();
  state.models = config.models || [];
  state.model = state.model || config.model || "";
  $("#connectionLabel").textContent = config.configured ? "API 已连接" : "等待 API 配置";
  renderModels();
}

async function sendMessage(message) {
  setBusy(true);
  state.requestError = "";
  state.thinking = ["已收到问题，正在连接当前模型"];
  state.thinkingVisible = true;
  state.thinkingCollapsed = false;
  state.thinkingDone = false;
  state.streamingAnswer = "";
  state.messages.push({ role: "user", content: message });
  state.messages.push({ role: "assistant", content: "", streaming: true });
  state.streamingMessageIndex = state.messages.length - 1;
  renderMessages();
  saveState();
  try {
    const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: state.sessionId, message, model: state.model }) });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || "请求失败");
    }
    if (!response.body) throw new Error("浏览器不支持流式响应");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        if (event.event === "status") {
          state.thinking.push(event.label);
          if (state.thinking.length > 3) state.thinkingCollapsed = true;
          renderMessages();
        } else if (event.event === "delta") {
          state.thinkingVisible = false;
          await typeAnswer(event.text);
        } else if (event.event === "done") {
          state.sessionId = event.session_id || state.sessionId;
        } else if (event.event === "error") {
          throw new Error(event.error || "模型请求失败");
        }
      }
      if (done) break;
    }
    if (state.streamingMessageIndex >= 0) {
      state.messages[state.streamingMessageIndex].content = state.streamingAnswer;
      delete state.messages[state.streamingMessageIndex].streaming;
    }
    state.streamingAnswer = "";
    state.streamingMessageIndex = -1;
    state.thinking.push("回答生成完成，已发送到会客厅");
    state.thinkingVisible = true;
    state.thinkingDone = true;
    saveState();
    renderMessages();
    window.persistCurrentConversation?.();
    $("#typingState").textContent = "已保存";
  } catch (error) {
    if (state.streamingMessageIndex >= 0) state.messages.splice(state.streamingMessageIndex, 1);
    state.thinkingVisible = false;
    state.thinkingDone = false;
    state.streamingAnswer = "";
    state.streamingMessageIndex = -1;
    renderMessages();
    state.requestError = error.message;
    $("#typingState").textContent = `请求失败：${error.message}`;
  } finally {
    setBusy(false, state.requestError ? `请求失败：${state.requestError}` : "就绪");
  }
}

async function typeAnswer(text) {
  for (const character of text) {
    state.streamingAnswer += character;
    renderStreamingAnswer();
    await new Promise((resolve) => setTimeout(resolve, character.trim() ? 17 : 4));
  }
}

function renderStreamingAnswer() {
  if (state.streamingMessageIndex >= 0) state.messages[state.streamingMessageIndex].content = state.streamingAnswer;
  const bubble = messagesEl.querySelector(".message.assistant:last-of-type .bubble");
  if (bubble) {
    bubble.querySelector(".message-meta").textContent = "工坊助手 · 输出中";
    let text = bubble.querySelector(".streaming-text");
    if (!text) {
      text = document.createElement("span");
      text.className = "streaming-text";
      bubble.append(text);
    }
    text.textContent = state.streamingAnswer;
    if (!bubble.querySelector(".cursor-block")) bubble.insertAdjacentHTML("beforeend", '<span class="cursor-block"></span>');
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(busy, statusText) {
  sendButton.disabled = busy;
  inputEl.disabled = busy;
  $("#typingState").textContent = busy ? "思考中..." : (statusText || "就绪");
}

async function compressContext() {
  const keepRecent = Number($("#keepRecent").value);
  $("#compressionNote").textContent = "正在整理较早的对话...";
  try {
    const response = await fetch("/api/context/compress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: state.sessionId, messages: state.messages, keep_recent: keepRecent }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "压缩失败");
    state.messages = data.messages || state.messages;
    state.summary = data.summary || "";
    saveState();
    renderMessages();
    $("#compressionNote").textContent = state.summary ? "较早内容已整理为摘要，最近对话保持原样。" : "消息还不多，暂时无需压缩。";
  } catch (error) {
    $("#compressionNote").textContent = error.message;
  }
}

let clearArmed = false;
let clearTimer = null;

function resetClearButton() {
  clearArmed = false;
  clearTimeout(clearTimer);
  const button = $("#clearContextButton");
  button.textContent = "✕ 清空当前上下文";
  button.classList.remove("is-armed");
}

async function clearContext() {
  try {
    await fetch("/api/session/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ session_id: state.sessionId }) });
  } catch (error) {
    console.warn("服务端上下文重置失败", error);
  }
  state.messages = [];
  state.summary = "";
  state.thinking = [];
  state.thinkingVisible = false;
  state.thinkingDone = false;
  state.streamingAnswer = "";
  state.streamingMessageIndex = -1;
  saveState();
  renderMessages();
  $("#compressionNote").textContent = "上下文已清空，可以重新开始提问。";
  $("#savedConversationMeta").textContent = "上下文已清空";
}

$("#clearContextButton").addEventListener("click", async () => {
  const button = $("#clearContextButton");
  if (!clearArmed) {
    clearArmed = true;
    button.classList.add("is-armed");
    button.textContent = "再次点击确认删除";
    $("#compressionNote").textContent = "删除后当前对话与摘要无法恢复，请再次点击确认。";
    clearTimer = setTimeout(resetClearButton, 3000);
    return;
  }
  await clearContext();
  resetClearButton();
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (!message || sendButton.disabled) return;
  inputEl.value = "";
  inputEl.style.height = "auto";
  sendMessage(message);
});
inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});
inputEl.addEventListener("input", () => { inputEl.style.height = "auto"; inputEl.style.height = `${Math.min(inputEl.scrollHeight, 140)}px`; });
modelSelect.addEventListener("change", () => { state.model = modelSelect.value; saveState(); $("#activeModel").textContent = state.model; });
$("#keepRecent").addEventListener("input", (event) => { $("#keepRecentValue").textContent = event.target.value; });
$("#compressButton").addEventListener("click", compressContext);
$("#toggleController").addEventListener("click", () => { controller.classList.toggle("collapsed"); $("#toggleController").textContent = controller.classList.contains("collapsed") ? "+" : "−"; });
function startNewConversation() {
  window.persistCurrentConversation?.();
  state.sessionId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  state.messages = [];
  state.summary = "";
  state.thinking = [];
  state.thinkingVisible = false;
  state.thinkingCollapsed = false;
  state.thinkingDone = false;
  state.streamingAnswer = "";
  state.streamingMessageIndex = -1;
  state.requestError = "";
  saveState();
  renderMessages();
  $("#savedConversationMeta").textContent = "刚刚新建";
}
$("#newChat").addEventListener("click", startNewConversation);
$("#savedConversation").addEventListener("click", () => messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" }));

// 上下文控制器现在嵌在侧边栏里（不再悬浮），所以只有「浮动定位」时才允许拖动。
// 若以后又改回悬浮面板，这条判断会自动重新启用拖动，无需改动这里。
const controllerCanDrag = () => getComputedStyle(controller).position === "fixed";

let dragState = null;
controllerHandle.addEventListener("pointerdown", (event) => {
  if (event.target.closest("button")) return;
  if (!controllerCanDrag()) return;
  const rect = controller.getBoundingClientRect();
  dragState = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
  controllerHandle.setPointerCapture(event.pointerId);
  controller.style.right = "auto";
  controller.style.bottom = "auto";
});
controllerHandle.addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const maxX = Math.max(8, window.innerWidth - controller.offsetWidth - 8);
  const maxY = Math.max(8, window.innerHeight - controller.offsetHeight - 8);
  controller.style.left = `${Math.max(8, Math.min(event.clientX - dragState.offsetX, maxX))}px`;
  controller.style.top = `${Math.max(8, Math.min(event.clientY - dragState.offsetY, maxY))}px`;
});
controllerHandle.addEventListener("pointerup", () => { dragState = null; });
controllerHandle.addEventListener("pointercancel", () => { dragState = null; });

// 独立指针：后续修改上下文控制器或新对话行为时，直接调用这两个入口。
window.contextControllerPointer = {
  element: controller,
  compress: compressContext,
  getState: () => ({ sessionId: state.sessionId, messages: state.messages, summary: state.summary }),
};
window.newConversationPointer = { start: startNewConversation, element: $("#newChat") };
window.clearContextPointer = { clear: clearContext, element: $("#clearContextButton") };
window.restoreConversationPointer = {
  restore: async (item) => {
    await fetch("/api/session/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: item.session_id || item.id, messages: item.messages || [], summary: item.summary || "" }),
    });
    state.sessionId = item.session_id || item.id;
    state.messages = Array.isArray(item.messages) ? item.messages : [];
    state.summary = item.summary || "";
    state.thinking = [];
    state.thinkingVisible = false;
    state.thinkingCollapsed = false;
    state.thinkingDone = false;
    state.streamingAnswer = "";
    state.streamingMessageIndex = -1;
    state.requestError = "";
    saveState();
    renderMessages();
    $("#savedConversationMeta").textContent = "已恢复历史对话";
    $("#typingState").textContent = "已恢复";
  },
};

loadState();
renderMessages();
loadConfig().catch((error) => { $("#modelHint").textContent = `配置读取失败：${error.message}`; });
