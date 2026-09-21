/* 对话核心：会话、消息、上下文控制器、历史存档 */
const STORAGE_KEY = "mogao-five-realms-v1";

/* ═══════════════════════════════════════════════════════════════════
   ★ AI 头像：想换成自己的图片，只改下面这一行
     图片放到 web/assets/ai/ 下，例如 "avatar.png" → "/assets/ai/avatar.png"
   ═══════════════════════════════════════════════════════════════════ */
const AI_AVATAR_SRC = "/assets/ai/dafeiyu.png";

/* ★ 思考强度 5 个档位各自对应的「聊天背景图」（键 = 档位 1~5）
   图片放 web/assets/bg/ 下，想换图只改这里的地址即可 */
const MIND_BG_IMAGES = {
  1: "/assets/bg/1.png",
  2: "/assets/bg/2.png",
  3: "/assets/bg/3.png",
  4: "/assets/bg/4.png",
  5: "/assets/bg/5.png",
};
const EFFORT_LEVEL_KEY = "mogao-effort-level";  // 记住上次选的思考强度
const MIND_BG_SWITCH_KEY = "mogao-mind-bg";     // 「背景随强度」开关（"1" = 开）

/* 后端 /api/config 会返回同名的 effort_levels（单一数据源），
   这里只是接口读不到时的兜底，字段含义与 web_app.py 的 EFFORT_LEVELS 一致 */
const FALLBACK_EFFORT_LEVELS = [
  { level: 1, key: "eco", label: "极简", thinking: false, effort: "low", max_tokens: 1024, temperature: 0.3, note: "关闭思考链，思考消耗为 0，最省 token" },
  { level: 2, key: "light", label: "轻量", thinking: false, effort: "low", max_tokens: 2048, temperature: 0.5, note: "关闭思考链，回答简短，适合闲聊与查资料" },
  { level: 3, key: "balance", label: "均衡", thinking: true, effort: "low", max_tokens: 4096, temperature: 0.6, note: "开启思考，思维链较短，默认档" },
  { level: 4, key: "deep", label: "深入", thinking: true, effort: "medium", max_tokens: 8192, temperature: 0.7, note: "中等思维链，适合代码与数学" },
  { level: 5, key: "max", label: "极致", thinking: true, effort: "high", max_tokens: 16384, temperature: 0.8, note: "最长思维链与输出上限，最耗 token" },
];

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const state = {
  sessionId: uid(),
  historyId: null,
  messages: [],
  summary: "",
  model: "",
  models: [],
  effortLevel: 3,        // 当前思考强度档位（1~5），会真的传给后端
  effortLevels: [],      // 档位表（来自 /api/config）
  bgFollow: false,       // 背景是否跟随思考强度
  lastUsage: null,       // 上一次回答的 token 用量（后端回传）
  lastEffort: null,      // 上一次回答用的档位
  thinking: [],
  thinkingVisible: false,
  thinkingCollapsed: false,
  thinkingDone: false,
  requestError: "",
};

const $ = (selector) => document.querySelector(selector);
const messagesEl = $("#messages");
const workspaceEl = $("#conversationWorkspace");
const inputEl = $("#messageInput");
const formEl = $("#chatForm");
const sendButton = $("#sendButton");
const modelSelect = $("#modelSelect");
const controller = $("#contextController");
const controllerHandle = $("#controllerHandle");

/* ══════════════════════════════════════════════════════════════
   生成中的回答（按会话各存一份，互不干扰）
   ──────────────────────────────────────────────────────────────
   · key = session_id，value = 「流上下文」stream（在 sendMessage 里创建）；
   · 前台流 = 当前正显示的会话：照旧打字机 + 自动跟随滚动；
   · 后台流 = 你切走之后仍在生成的会话：静默把回答攒进它自己的消息对象里，
     生成完自动写回它自己那条会话存档 —— 所以「生成中切走」不会吞回答。
   ══════════════════════════════════════════════════════════════ */
const activeChatStreams = new Map();

/* 当前显示会话的流（没有就是 null）：输入框可用性 / 状态栏文案都看它 */
function foregroundStream() {
  return activeChatStreams.get(state.sessionId) || null;
}

/* 输入区可用性：只有「正在看的这段会话在生成中」才锁住输入框；
   后台流不锁 —— 生成中也能点「新聊天」开始新对话。 */
function syncComposer() {
  const busy = !!foregroundStream();
  sendButton.disabled = busy;
  inputEl.disabled = busy;
  if (busy) $("#typingState").textContent = "思考中...";
}

/* ══════════════════════════════════════════════════════════════
   消息流滚动：只有「本来就停在最底部」才会自动跟随，
   往上翻看历史时绝不把镜头拉回来（想看最新就点「回到最新」）。
   ══════════════════════════════════════════════════════════════ */
let messagesPinned = true;
const NEAR_BOTTOM_PX = 56;

function nearMessagesBottom() {
  return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= NEAR_BOTTOM_PX;
}

function updateScrollLatestHint() {
  $("#scrollLatestBtn")?.classList.toggle("is-away", !messagesPinned && state.messages.length > 0);
}

/* force = true 时无视位置强制到底（切换会话用）；否则只在贴底时才跟随 */
function scrollMessagesToBottom(force) {
  if (!force && !messagesPinned) return;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

/* ========== 身份 / 头像 / 模型名 ========== */
/* 注意：变量名不能和 auth.js / pet.js / theme.js 里同作用域的 const 重名，
   否则后来的脚本会抛 SyntaxError 而整个失效（auth.js 里也有个人形图标常量）。 */
const AVATAR_FALLBACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

function currentUser() {
  return window.currentAuthUser || window.authPointer?.getUser?.() || null;
}

function userAvatarMarkup(user) {
  if (user?.avatar) return `<img src="${escapeHtml(user.avatar)}" alt="">`;
  const initial = String(user?.name || "").trim().slice(0, 1);
  return initial ? escapeHtml(initial) : AVATAR_FALLBACK_ICON;
}

/* 气泡上方的名字 = 当前模型（如 deepseek-flash 4.1） */
function modelLabel(id) {
  return state.models.find((model) => model.id === id)?.label || id || "模型";
}

/* 「模型选择」下拉框的淡蓝皮肤：当前用的是 DeepSeek 时加 .is-deepseek（样式在 app.css） */
function applyModelSelectTint() {
  modelSelect.classList.toggle("is-deepseek", /^deepseek/i.test(String(state.model || "")));
}

/* 用户消息上方显示发送者昵称（鼠标悬停气泡头像可看到用户 id），没登录才是「访客」。
   发送时会把当时的身份记进消息里，所以历史消息不会被后来的登录/退出改写。 */
function senderLabel(item) {
  const sender = item?.sender;
  if (sender?.name && sender.name !== "访客") return sender.name;
  if (sender?.id) return sender.id;              // 老消息只存了 id 时兜底
  const user = currentUser();
  return user?.name || user?.id || "访客";
}

function senderIdOf(item) {
  return item?.sender?.id || currentUser()?.id || "";
}

/* ========== 本地状态 ========== */
function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    sessionId: state.sessionId,
    historyId: state.historyId,
    messages: state.messages,
    summary: state.summary,
    model: state.model,
  }));
}

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored) return;
    state.sessionId = stored.sessionId || state.sessionId;
    state.historyId = stored.historyId || null;
    state.messages = Array.isArray(stored.messages)
      ? stored.messages.filter((item) => !item.streaming && !(item.role === "assistant" && !String(item.content || "").trim()))
      : [];
    state.summary = stored.summary || "";
    state.model = stored.model || "";
  } catch (error) {
    console.warn("无法读取本地对话记录", error);
  }
}

/* ========== 渲染 ========== */
/* 「新聊天」仅在当前不在任何历史对话中时保持选中，避免与历史条目同时高亮 */
function syncNavSelection() {
  const newChatButton = $("#navNewChat");
  if (newChatButton) newChatButton.classList.toggle("active", !state.historyId);
}

function updateWorkspace() {
  workspaceEl.classList.toggle("has-messages", state.messages.length > 0);
}

/* 圈形进度条：viewBox 36×36、半径 15 → 周长 2πr ≈ 94.25（与 app.css 里 .ring-bar 的 dasharray 一致） */
const RING_CIRCUMFERENCE = 2 * Math.PI * 15;

/* 百分比不再直接写在界面上，而是画成圈；数字放进 data-tip，鼠标悬停才显示 */
function updateRing(ringEl, barEl, percent, tip) {
  if (!barEl) return;
  const clamped = Math.max(0, Math.min(100, percent));
  barEl.style.strokeDasharray = String(RING_CIRCUMFERENCE);
  barEl.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - clamped / 100));
  if (!ringEl) return;
  ringEl.dataset.tip = tip;
  ringEl.setAttribute("aria-label", `上下文占用 ${tip}`);
  ringEl.classList.toggle("is-warn", clamped >= 80);   // 快满了变红
}

/* ══════════════════════════════════════════════════════
   上下文进度：读「当前模型最近一次调用」上报的上下文大小
   ──────────────────────────────────────────────────────
   · 数据源是模型自己回的 usage（后端 done 事件原样透传），挂在每条回答 item.usage 上；
   · 取 prompt_tokens = 这次回答生成前发出去的上下文（即「上次会话前所获取的」），
     没有 prompt_tokens 时退回 total_tokens；
   · 上限按 1M（1,000,000 tokens）折算百分比，**消息条数不再参与进度换算**（条数只在侧栏显示）。
   ══════════════════════════════════════════════════════ */
const CONTEXT_LIMIT_TOKENS = 100000;

function contextUsage() {
  let latest = null;   // 当前模型没记录时，退回整段会话里最近一次的用量
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const item = state.messages[index];
    const usage = item?.usage;
    if (!usage) continue;
    const tokens = Number(usage.prompt_tokens) || Number(usage.total_tokens) || 0;
    if (!tokens) continue;
    const record = { tokens, model: item.model || "", modelLabel: item.modelLabel || item.model || "" };
    if (state.model && item.model === state.model) return record;
    if (!latest) latest = record;
  }
  return latest;
}

function formatTokenCount(tokens) {
  const value = Number(tokens) || 0;
  if (value >= 10000) return `${Math.round(value / 1000)}k`;   // 38213 → 38k
  return value.toLocaleString("en-US");
}

function updateMemoryMeters() {
  const usage = contextUsage();
  const tokens = usage ? usage.tokens : 0;
  const percent = Math.min(100, (tokens / CONTEXT_LIMIT_TOKENS) * 100);
  // 1M 上限下日常对话比例很小（几百 tokens 才 0.0x%），小数位随量级走，别让进度看着像 0
  const percentLabel = percent <= 0
    ? "0"
    : percent < 1 ? percent.toFixed(2)
      : percent < 10 ? percent.toFixed(1) : String(Math.round(percent));
  /* 鼠标悬停提示只显示百分比（不再带 tokens / 模型名等说明） */
  const tip = `${percentLabel}%`;
  $("#memoryPercent").textContent = `${percentLabel}%`;
  $("#memoryPercent").title = tip;
  $("#memoryBar").style.width = `${percent}%`;
  $("#collapsedBar").style.width = `${percent}%`;
  // 侧边栏导航项 + 控制器卡片头部：两个圈形进度条
  updateRing($("#navControllerRing"), $("#navRingBar"), percent, tip);
  updateRing($("#collapsedPercent"), $("#collapsedRingBar"), percent, tip);
  $("#messageCount").textContent = state.messages.length;
}

function renderMessages(options) {
  const forceBottom = options?.bottom === true;
  syncNavSelection();
  updateWorkspace();
  messagesEl.innerHTML = state.messages.map((item, index) => {
    const isUser = item.role === "user";
    /* AI 名字优先用「发送那一刻记下的显示名」（modelLabel）：
       之后换模型、改模型目录都不会改写老气泡上的名字 */
    const meta = isUser ? senderLabel(item) : (item.modelLabel || modelLabel(item.model || state.model));
    const uid = isUser ? senderIdOf(item) : "";
    const avatar = isUser
      ? `<span class="message-avatar" title="${escapeHtml(uid ? `${meta} · ${uid}` : meta)}">${userAvatarMarkup(currentUser())}</span>`
      : `<span class="message-avatar ai" title="${escapeHtml(`${meta}${item.model ? ` · ${item.model}` : ""}`)}"><img src="${escapeHtml(AI_AVATAR_SRC)}" alt=""></span>`;
    // AI 的正文会把 ```代码块``` 渲染成「文件预览」，所以走单独的函数
    const body = isUser ? escapeHtml(item.content) : assistantContentMarkup(item, index);
    // 交付小卡牌（保存到本机）挂在气泡外面，不塞进聊天气泡里
    const tray = isUser ? "" : assistantDeliverTrayMarkup(item, index);
    /* 名字 / id 独立于气泡之外：放在气泡正上方，加粗放大（样式见 app.css 的 .message-meta）。
       鼠标悬停可以看到更完整的身份：用户是「昵称 · 账号 id」，AI 是「模型名 · 模型 id」。 */
    const metaTitle = isUser
      ? (uid ? ` title="${escapeHtml(`${meta} · ${uid}`)}"` : "")
      : ` title="${escapeHtml(`${meta}${item.model ? ` · ${item.model}` : ""}`)}"`;
    return `
    <article class="message ${isUser ? "user" : "assistant"}">
      ${avatar}
      <div class="message-body">
        <span class="message-meta"${metaTitle}>${escapeHtml(meta)}</span>
        <div class="bubble">${messageAttachmentsMarkup(item)}${body}</div>
        ${tray}
      </div>
    </article>`;
  }).join("");

  if (state.thinkingVisible) {
    const collapsedClass = state.thinkingCollapsed ? "is-collapsed" : "";
    const marker = state.thinkingDone ? '<span class="thinking-check">✓</span>' : '<span class="thinking-orbit"></span>';
    const tail = state.thinkingDone ? '<span class="thinking-done">已完成</span>' : '<span class="thinking-dots">···</span>';
    messagesEl.insertAdjacentHTML("beforeend", `
      <div class="thinking-card ${collapsedClass}">
        <div class="thinking-title">${marker}<strong>思考过程 · 阶段记录</strong>${tail}</div>
        <div class="thinking-lines">${state.thinking.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
        <button class="thinking-toggle" type="button">${state.thinkingCollapsed ? "展开思考过程" : "收起思考过程"}</button>
      </div>`);
    const thinkingCard = messagesEl.querySelector(".thinking-card");
    thinkingCard?.querySelector(".thinking-toggle")?.addEventListener("click", () => {
      state.thinkingCollapsed = !state.thinkingCollapsed;
      thinkingCard.classList.toggle("is-collapsed", state.thinkingCollapsed);
      thinkingCard.querySelector(".thinking-toggle").textContent = state.thinkingCollapsed ? "展开思考过程" : "收起思考过程";
    });
  }

  updateMemoryMeters();
  if (state.messages.length) {
    if (forceBottom) messagesPinned = true;   // 切会话 / 删会话 → 从头看最新，允许强制到底
    scrollMessagesToBottom(forceBottom);      // 生成中的重渲染：只有贴底才跟随
  }
  updateScrollLatestHint();
}

function renderModels() {
  modelSelect.innerHTML = state.models.map((model) => `
    <option value="${escapeHtml(model.id)}" ${model.available ? "" : "disabled"}>
      ${escapeHtml(model.label)}${model.available ? "" : "（未配置）"}
    </option>`).join("");
  const available = state.models.find((model) => model.available);
  state.model = state.model && state.models.some((model) => model.id === state.model && model.available)
    ? state.model
    : available?.id || "";
  modelSelect.value = state.model;
  modelSelect.title = available ? `当前模型：${available.label}` : "暂无可用模型";
  $("#activeModel").textContent = state.model || "未配置";
  applyModelSelectTint();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await response.json();
    state.models = config.models || [];
    state.model = state.model || config.model || "";
    // 思考强度档位表：后端是唯一数据源，前端滑块/节点/文案都按它渲染
    if (Array.isArray(config.effort_levels) && config.effort_levels.length) {
      state.effortLevels = config.effort_levels;
      if (config.default_effort_level && !localStorage.getItem(EFFORT_LEVEL_KEY)) {
        state.effortLevel = Number(config.default_effort_level) || state.effortLevel;
      }
      renderMindUI(false);
    }
    $("#connectionLabel").textContent = config.configured ? "已连接" : "等待配置";
    renderModels();
    renderMessages();   // 已知模型名后，把气泡上的 AI 名字刷新成当前模型
  } catch (error) {
    $("#connectionLabel").textContent = "读取失败";
    $("#activeModel").textContent = "未配置";
    console.warn("配置读取失败", error);
  }
}

/* ========== 对话发送 ==========
   ★ 生成中的回答按会话分开存（activeChatStreams，见文件顶部说明）：
     生成中切到别的会话 / 刷新页面都不会再吞掉回答。 */
async function sendMessage(message, attachments) {
  const files = Array.isArray(attachments) ? attachments : [];
  if (foregroundStream()) return;   // 当前会话还在生成（输入框此时也是锁着的），防重复发送
  const sessionId = state.sessionId;
  state.requestError = "";
  state.thinking = ["已收到问题，正在连接当前模型"];
  state.thinkingVisible = true;
  state.thinkingCollapsed = false;
  state.thinkingDone = false;
  const sender = currentUser();
  state.messages.push({
    role: "user",
    content: message,
    // 附件只存显示需要的字段（名字/类型/大小/缩略图），文本内容由后端拼接后进模型
    attachments: files.map((item) => ({ name: item.name, kind: item.kind, size: item.size, preview: item.preview || "" })),
    // 记下发送时的身份：登录后就是用户 id，没登录才算访客
    sender: sender ? { id: sender.id, name: sender.name, avatar: sender.avatar || "" } : { id: "", name: "访客" },
  });
  // 记下这次回答用的是哪个模型（id + 当时的显示名），气泡上的名字以后再也不会变
  const responseMessage = { role: "assistant", content: "", streaming: true, model: state.model, modelLabel: modelLabel(state.model), effort: state.effortLevel };
  state.messages.push(responseMessage);
  /* 这段会话的「流上下文」：切到别的会话后它还在，回答继续攒进 responseMessage，
     生成完写回本会话自己的存档 —— 只要这段会话没被删，回答就不会丢。 */
  const stream = {
    sessionId,
    historyId: state.historyId,
    messages: state.messages,
    summary: state.summary,
    message: responseMessage,
    thinking: state.thinking,
    answer: "",
    usage: null,
    effort: null,
    cancelled: false,
    finished: false,
    controller: new AbortController(),
  };
  activeChatStreams.set(sessionId, stream);
  renderMessages({ bottom: true });
  syncComposer();
  saveState();
  // ★ 第一次输入后立即建档；promise 挂在流上，后台结束时用同一个 historyId 更新同一条存档
  stream.persistPromise = persistConversation(stream);

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: stream.controller.signal,
      body: JSON.stringify({
        session_id: sessionId,
        message,
        model: state.model,
        effort_level: state.effortLevel,
        // 拖进来的文件：文本内容交给后端拼进消息（图片仅提示文件名）
        attachments: files.map((item) => ({ name: item.name, kind: item.kind, size: item.size, text: item.text || "" })),
      }),
    });
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
        await handleStreamEvent(stream, JSON.parse(line));
      }
      if (done) break;
    }
    await finishChatStream(stream);
  } catch (error) {
    failChatStream(stream, error);
  }
}

/* 一条流事件（status / delta / file / image / done / error）：
   前台流实时打字 + 重渲染；后台流只往 message 里攒内容，绝不碰当前界面。 */
async function handleStreamEvent(stream, event) {
  const isCurrent = () => stream.sessionId === state.sessionId;
  if (event.event === "status") {
    stream.thinking.push(event.label);
    if (isCurrent()) {
      if (state.thinking.length > 3) state.thinkingCollapsed = true;
      renderMessages();
    }
    return;
  }
  if (event.event === "delta") {
    if (isCurrent()) {
      state.thinkingVisible = false;
      await typeAnswer(stream, event.text, event.fast);
    } else {
      stream.answer += event.text;   // 后台流：整段攒着，切回来直接看到
      stream.message.content = stream.answer;
    }
    return;
  }
  if (event.event === "file") {
    // AI 把文件写进了空间：在气泡外的小卡牌上挂一行（可打开 / 保存到本机）
    stream.message.files = stream.message.files || [];
    stream.message.files.push({ name: event.name, path: event.path, size: event.size });
    if (isCurrent()) renderMessages();
    return;
  }
  if (event.event === "image") {
    // 文生图模型（Agnes 图片生成等）：把图片挂到这条回答上
    stream.message.images = stream.message.images || [];
    stream.message.images.push({ url: event.url, prompt: event.prompt || "", model: event.model || "" });
    if (isCurrent()) renderMessages();
    return;
  }
  if (event.event === "done") {
    // 后端回传的真实 token 用量挂到这条回答上（「上下文进度」就是读它）
    if (event.usage && (event.usage.total_tokens || event.usage.prompt_tokens)) stream.message.usage = event.usage;
    if (event.usage && event.usage.total_tokens) stream.usage = event.usage;
    stream.effort = event.effort || null;
    if (isCurrent()) {
      if (event.session_id) state.sessionId = event.session_id;
      state.lastUsage = stream.usage || state.lastUsage;
      state.lastEffort = stream.effort;
    }
    return;
  }
  if (event.event === "error") throw new Error(event.error || "模型请求失败");
}

/* 前台流的打字机：一个字一个字推；若中途被切走，剩下的整段一次性攒进消息（不丢内容） */
async function typeAnswer(stream, text, fast) {
  // fast = 后端一次性给的整段回答（空间工具链路）：按小块快速推，别让长文卡半天
  const step = fast && text.length > 24 ? Math.max(6, Math.ceil(text.length / 400)) : 0;
  if (step) {
    for (let index = 0; index < text.length; index += step) {
      if (stream.cancelled) return;
      if (stream.sessionId !== state.sessionId) {
        stream.answer += text.slice(index);
        stream.message.content = stream.answer;
        return;
      }
      stream.answer += text.slice(index, index + step);
      stream.message.content = stream.answer;
      renderStreamingAnswer(stream);
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return;
  }
  for (let index = 0; index < text.length; index += 1) {
    if (stream.cancelled) return;
    if (stream.sessionId !== state.sessionId) {
      stream.answer += text.slice(index);
      stream.message.content = stream.answer;
      return;
    }
    const character = text[index];
    stream.answer += character;
    stream.message.content = stream.answer;
    renderStreamingAnswer(stream);
    await new Promise((resolve) => setTimeout(resolve, character.trim() ? 17 : 4));
  }
}

function renderStreamingAnswer(stream) {
  if (stream.sessionId !== state.sessionId) return;   // 后台流不碰界面
  const bubble = messagesEl.querySelector(".message.assistant:last-of-type .bubble");
  if (bubble) {
    // 返回的图片 / 文件要待在正文最下面，所以流式文字一律插在它们前面，打字不会插到卡片下面
    const returns = bubble.querySelector(".bubble-returns");
    let text = bubble.querySelector(".streaming-text");
    if (!text) {
      text = document.createElement("span");
      text.className = "streaming-text";
      if (returns) bubble.insertBefore(text, returns); else bubble.append(text);
    }
    text.textContent = displayAnswer(stream.answer);   // 打字期间同样不留首尾空行
    if (!bubble.querySelector(".cursor-block")) {
      const cursor = document.createElement("span");
      cursor.className = "cursor-block";
      if (returns) bubble.insertBefore(cursor, returns); else bubble.append(cursor);
    }
  }
  scrollMessagesToBottom(false);   // 贴底才跟随；往上翻看历史时不再被强行拉回底部
}

/* 生成正常结束：落进消息 → 写回「它自己那条」会话存档 →（前台时）收尾界面 */
async function finishChatStream(stream) {
  if (stream.finished) return;
  stream.finished = true;
  if (stream.poller) clearTimeout(stream.poller);
  const registered = activeChatStreams.get(stream.sessionId);
  if (registered === stream) activeChatStreams.delete(stream.sessionId);
  if (stream.cancelled) return;
  const wasCurrent = stream.sessionId === state.sessionId;
  stream.message.content = stream.answer;
  delete stream.message.streaming;
  if (!String(stream.answer || "").trim() && !(stream.message.files || []).length && !(stream.message.images || []).length) {
    // 服务端重启 / 记录过期：这段回答没能补回来，撤掉占位气泡，不留空壳
    const index = stream.messages.indexOf(stream.message);
    if (index >= 0) stream.messages.splice(index, 1);
    if (wasCurrent) {
      state.thinkingVisible = false;
      state.thinkingDone = false;
      saveState();
      renderMessages();
      syncComposer();
      $("#typingState").textContent = "这段回答没能补回来，请重新发一次";
    }
    return;
  }
  try { await stream.persistPromise; } catch (error) { console.warn("等待存档失败", error); }
  await persistConversation(stream);   // 后台流也会自己落档，且不会污染当前界面
  if (!wasCurrent) {
    window.historyListPointer?.refresh?.();
    return;
  }
  state.thinking.push("回答生成完成，已存进当前对话");
  if (stream.usage) {
    const think = stream.usage.reasoning_tokens ? `思考过程 ${stream.usage.reasoning_tokens} tokens` : "未开启思考链";
    state.thinking.push(`本次消耗 ${stream.usage.total_tokens} tokens（${think}）`);
  }
  state.thinkingVisible = true;
  state.thinkingDone = true;
  saveState();
  renderMessages();
  syncComposer();
  renderMindUsage();
  $("#typingState").textContent = "已保存";
}

/* 请求失败 / 被掐断：撤掉这段会话里的占位气泡；只有前台才动界面和状态栏 */
function failChatStream(stream, error) {
  if (stream.finished) return;
  stream.finished = true;
  if (stream.poller) clearTimeout(stream.poller);
  const registered = activeChatStreams.get(stream.sessionId);
  if (registered === stream) activeChatStreams.delete(stream.sessionId);
  const index = stream.messages.indexOf(stream.message);
  if (index >= 0) stream.messages.splice(index, 1);
  if (stream.cancelled) return;   // 删掉会话导致的取消：静默收场
  if (stream.sessionId !== state.sessionId) return;   // 后台流失败：不打扰当前界面
  state.thinkingVisible = false;
  state.thinkingDone = false;
  state.requestError = error.message;
  saveState();
  renderMessages();
  syncComposer();   // 前台流已从注册表移除 → 输入框恢复可用
  $("#typingState").textContent = `请求失败：${error.message}`;
}

/* 掐掉某段会话还在生成的流（删会话 / 清空上下文时用）：中止请求，且不再回写存档 */
function cancelChatStream(sessionId) {
  const stream = activeChatStreams.get(sessionId);
  if (!stream) return;
  stream.cancelled = true;
  activeChatStreams.delete(sessionId);
  try { stream.controller.abort(); } catch (error) { console.warn("中止生成失败", error); }
}

/* ══════════════════════════════════════════════════════════════
   离开页面期间被「吞掉」的回答：回来时和服务端对一次账
   ──────────────────────────────────────────────────────────────
   切页 / 刷新会让浏览器掐断 fetch，但服务端会把回答继续生成完
   （web_app.py 的 STREAM_RECORDS）。回到页面后：
     · 服务端还在生成 → 挂一个「重连流」，跟着轮询直到完成；
     · 服务端已经生成完、本地却没有 → 直接把这条回答补进当前会话并存档。
   ══════════════════════════════════════════════════════════════ */
const STREAM_POLL_MS = 2500;

async function syncSessionFromServer() {
  const requestedSession = state.sessionId;
  if (activeChatStreams.has(requestedSession)) return;   // 页内已经有活着的流，不用对账
  let data;
  try {
    const response = await fetch("/api/session/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: requestedSession }),
    });
    data = await response.json();
  } catch (error) {
    console.warn("会话状态同步失败", error);
    return;
  }
  if (state.sessionId !== requestedSession) return;   // 对账期间用户又切走了，丢弃
  const streaming = data.streaming;
  if (streaming) {
    const lastLocal = state.messages[state.messages.length - 1];
    const alreadyShown = !streaming.running
      && lastLocal && lastLocal.role === "assistant"
      && String(lastLocal.content || "") === String(streaming.answer || "");
    if (!alreadyShown) reattachServerStream(requestedSession, streaming);
    return;
  }
  const serverMessages = Array.isArray(data.messages) ? data.messages : [];
  const lastServer = serverMessages[serverMessages.length - 1];
  const lastLocal = state.messages[state.messages.length - 1];
  if (lastServer && lastServer.role === "assistant" && String(lastServer.content || "").trim()
      && (!lastLocal || lastLocal.role === "user")) {
    state.messages.push({
      role: "assistant",
      content: String(lastServer.content),
      model: data.model_id || state.model,
      modelLabel: data.model_label || modelLabel(state.model),
    });
    saveState();
    renderMessages({ bottom: true });
    persistCurrentConversation();
    $("#typingState").textContent = "已把离开期间生成完的回答补回来";
  }
}

/* 服务端还在生成：挂一个流上下文，每 2.5 秒问一次进度（用的还是同一套 message 对象） */
function reattachServerStream(sessionId, streaming) {
  let message = state.messages[state.messages.length - 1];
  if (!message || message.role !== "assistant" || !message.streaming) {
    message = {
      role: "assistant",
      content: "",
      streaming: true,
      model: state.model,
      modelLabel: streaming.model_label || modelLabel(state.model),
      effort: state.effortLevel,
      reconnected: true,
    };
    state.messages.push(message);
  }
  const stream = {
    sessionId,
    historyId: state.historyId,
    messages: state.messages,
    summary: state.summary,
    message,
    thinking: state.thinking,
    answer: String(streaming.answer || ""),
    usage: null,
    effort: null,
    cancelled: false,
    finished: false,
    reconnected: true,
    controller: new AbortController(),   // 本地没有 fetch 可掐，占位而已
  };
  message.content = stream.answer;
  activeChatStreams.set(sessionId, stream);
  state.thinkingVisible = true;
  state.thinkingDone = false;
  renderMessages({ bottom: true });
  syncComposer();
  $("#typingState").textContent = "思考中...";
  if (streaming.running) pollServerStream(stream);
  else finishChatStream(stream);
}

function pollServerStream(stream, delay) {
  stream.pollCount = (stream.pollCount || 0) + 1;
  stream.poller = setTimeout(async () => {
    if (stream.cancelled) return;
    if (stream.pollCount > 120) {   // 最多跟 5 分钟，别无限轮询
      await finishChatStream(stream);
      return;
    }
    let data = null;
    try {
      const response = await fetch("/api/session/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: stream.sessionId }),
      });
      data = await response.json();
    } catch (error) {
      console.warn("轮询回答进度失败", error);
    }
    if (stream.cancelled) return;
    const record = data?.streaming;
    if (record && String(record.answer || "").length >= stream.answer.length) {
      stream.answer = String(record.answer || "");
      stream.message.content = stream.answer;
    }
    if (record && record.running) {
      if (stream.sessionId === state.sessionId) renderMessages();
      pollServerStream(stream, STREAM_POLL_MS);
      return;
    }
    /* 生成完了（或记录已过期）：用服务端最终答案收尾 */
    if (record) stream.answer = String(record.answer || stream.answer);
    await finishChatStream(stream);
  }, delay || STREAM_POLL_MS);
}

/* ========== 附件：把本机文件 / 图片拖进输入框 ========== */
/* 说明：
   - 文本类文件（.txt .md .json .js .py .css .html …）读取内容，发送时随消息一起交给后端；
   - 图片生成 320px 缩略图，气泡里直接显示小图（文本模型只收到文件名提示）；
   - 其它二进制文件只记名字与大小。真正的「拼接」在后端 web_app.py 的 compose_message_with_attachments()。 */
const ATTACH_TEXT_LIMIT = 12000;    // 单个文本附件读取上限（字符），与后端 ATTACH_TEXT_LIMIT 对应
const ATTACH_PREVIEW_MAX = 320;     // 图片缩略图最长边（像素）
const ATTACH_TEXT_EXT = [".txt", ".md", ".markdown", ".json", ".jsonl", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx",
  ".py", ".css", ".scss", ".less", ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".log",
  ".ini", ".cfg", ".conf", ".env", ".sh", ".bat", ".ps1", ".sql", ".java", ".c", ".h", ".cpp", ".hpp", ".go",
  ".rs", ".rb", ".php", ".vue", ".svelte"];

let pendingAttachments = [];   // 还没发送的附件
let attachmentSeq = 0;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function isImageFile(file) {
  if (String(file.type || "").startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg|ico|avif|apng)$/i.test(String(file.name || ""));
}

function isTextLikeFile(file) {
  const type = String(file.type || "");
  if (type.startsWith("text/")) return true;
  if (["application/json", "application/javascript", "application/xml", "application/x-yaml", "application/x-sh", "application/sql"].includes(type)) return true;
  const name = String(file.name || "").toLowerCase();
  return ATTACH_TEXT_EXT.some((ext) => name.endsWith(ext));
}

/* 图片 → 小缩略图（dataURL）。存进 localStorage 的历史记录里也不会太大 */
function fileToThumb(file) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, ATTACH_PREVIEW_MAX / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      } catch (error) {
        resolve("");   // SVG 里带外链等情况会画不出来，忽略即可
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(""); };
    image.src = objectUrl;
  });
}

async function addFilesToAttachments(fileList) {
  const files = Array.from(fileList || []).slice(0, 10);
  if (!files.length) return;
  for (const file of files) {
    const attachment = { id: `att-${++attachmentSeq}`, name: file.name || "未命名文件", size: file.size || 0, kind: "file", text: "", preview: "" };
    if (isImageFile(file)) {
      attachment.kind = "image";
      attachment.preview = await fileToThumb(file);
    } else if (isTextLikeFile(file) && file.size <= 4 * 1024 * 1024) {
      try {
        attachment.kind = "text";
        attachment.text = (await file.text()).slice(0, ATTACH_TEXT_LIMIT);
      } catch (error) {
        attachment.kind = "file";
      }
    }
    pendingAttachments.push(attachment);
  }
  renderPendingAttachments();
  $("#typingState").textContent = `已添加 ${files.length} 个附件`;
  inputEl.focus();
}

function renderPendingAttachments() {
  const holder = $("#attachList");
  if (!holder) return;
  holder.hidden = !pendingAttachments.length;
  holder.innerHTML = pendingAttachments.map((item) => {
    const thumb = item.kind === "image" && item.preview
      ? `<img class="attach-thumb" src="${item.preview}" alt="">`
      : `<span class="attach-icon">${item.kind === "text" ? "📄" : item.kind === "image" ? "🖼" : "📦"}</span>`;
    return `<span class="attach-chip" title="${escapeHtml(item.name)}">
      ${thumb}
      <span class="attach-name">${escapeHtml(item.name)}</span>
      <span class="attach-size">${formatBytes(item.size)}</span>
      <button class="attach-remove" type="button" data-attach-id="${item.id}" aria-label="移除附件">×</button>
    </span>`;
  }).join("");
  holder.querySelectorAll("[data-attach-id]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingAttachments = pendingAttachments.filter((item) => item.id !== button.dataset.attachId);
      renderPendingAttachments();
    });
  });
}

/* 气泡上方展示附件（图片直接出缩略图） */
function messageAttachmentsMarkup(item) {
  const list = item.attachments || [];
  if (!list.length) return "";
  return `<div class="bubble-attachments">${list.map((file) => {
    const caption = `${escapeHtml(file.name)}${file.kind === "image" ? "" : ` · ${formatBytes(file.size)}`}`;
    if (file.kind === "image" && file.preview) {
      return `<span class="bubble-attach image"><img src="${file.preview}" alt="${escapeHtml(file.name)}"><span class="attach-caption">${caption}</span></span>`;
    }
    return `<span class="bubble-attach"><span>${file.kind === "text" ? "📄" : "📦"}</span>${caption}</span>`;
  }).join("")}</div>`;
}

/* ═══════════════════════════════════════════════════════════════
   ★ 交付格式规范（唯一出口，2026-09-13 定）★ 完整说明见 web/DELIVERY-FORMAT.md
   ───────────────────────────────────────────────────────────
   【铁则】页面上凡是「AI 返回文件」（markdown 代码块 / 写进空间的文件 / 生成的图片），
   一律走下面这条链路，不要再另写第二套卡片、也不要把按钮放回气泡里：
     ① 气泡里 = 内容本体：
          · 代码块 → assistantContentMarkup 的 <pre class="code-block">（无卡片边框、无按钮）
          · 图片   → assistantImagesMarkup 的 .deliver-image > img.deliver-photo
     ② 气泡外 = 操作集合：assistantDeliverTrayMarkup 生成 .deliver-tray 小卡牌
          （一行一个交付物：类型图标 + 名字 + 大小/行数 + 图标按钮「打开↗ / 保存⤓📁」）
     ③ 渲染入口只有 renderMessages() 一处（body 与 tray 成对生成）；新增交付类型就往
        assistantDeliverTrayMarkup 里加一行样式，不要新建 HTML 结构。
   【对不上号就会出错的两个 token 约定】
     · 代码块 code-{消息下标}-{块下标}：气泡里的 pre 与卡牌按钮共用，内容存在 codeFileStore；
     · 图片   shot-{消息下标}-{图下标}：data-shot ↔ [data-image-size]，图加载完回填宽高。
   ───────────────────────────────────────────────────────────
   【写 HTML 的坑】气泡是 white-space:pre-wrap，模板里的换行+缩进会被当空行渲染，
   交付区 HTML 一律拼成「一整行」（旧 .deliver-card 就因此比图高 158px，看着像一圈空框）。
   ═══════════════════════════════════════════════════════════════ */
const CODE_LANG_EXT = {
  python: "py", py: "py", javascript: "js", js: "js", typescript: "ts", ts: "ts",
  json: "json", markdown: "md", md: "md", html: "html", htm: "html", css: "css",
  bash: "sh", sh: "sh", shell: "sh", zsh: "sh", powershell: "ps1", ps1: "ps1",
  sql: "sql", java: "java", c: "c", cpp: "cpp", "c++": "cpp", csharp: "cs", cs: "cs",
  go: "go", rust: "rs", rs: "rs", ruby: "rb", rb: "rb", php: "php", kotlin: "kt",
  swift: "swift", yaml: "yaml", yml: "yml", toml: "toml", ini: "ini", cfg: "ini",
  text: "txt", txt: "txt", vue: "vue", jsx: "jsx", tsx: "tsx", xml: "xml", diff: "diff",
};
const codeFileStore = new Map();   // token → { name, lang, content }（气泡里的代码块与卡牌上的按钮共用）

function parseFenceInfo(info) {
  const raw = String(info || "").trim().replace(/^\{|\}$/g, "");
  let lang = "";
  let name = "";
  raw.split(/[\s,]+/).filter(Boolean).forEach((token) => {
    const explicit = token.match(/^(?:filename|file|name)[=:](.+)$/i);
    if (explicit && !name) { name = explicit[1].replace(/^["']|["']$/g, ""); return; }
    if (!name && /\.[A-Za-z0-9]{1,8}$/.test(token)) { name = token; return; }
    if (!lang && /^[A-Za-z][A-Za-z0-9+.#-]*$/.test(token)) lang = token.toLowerCase();
  });
  return { lang, name };
}

/* ★ AI 回复的显示正文：先去掉首尾空白再渲染。
   模型习惯以空行开头 / 结尾（实测存档里大量 "\n\n..."），气泡是 white-space:pre-wrap，
   这些空行会被原样渲染成一大段空白（用户反馈「文字不在最顶上，要一大段空气」）。
   只影响显示 —— 存档内容、发给模型的上下文都保持原样。 */
function displayAnswer(raw) {
  return String(raw ?? "").replace(/^\s+|\s+$/g, "");
}

/* 把正文切成「文字片段 / 代码块」：气泡内渲染与气泡外的下载小卡牌都读这一份结果，
   两边因此拿到同一个 token（code-{消息下标}-{块下标}）—— 这也是交付格式规范的一部分。 */
function messageParts(content, messageIndex) {
  const parts = [];
  const pattern = /```([^\n`]*)\r?\n([\s\S]*?)(?:```(?:\s*\n|$)|$)/g;
  let cursor = 0;
  let match;
  let codeIndex = 0;
  while ((match = pattern.exec(content))) {
    const before = content.slice(cursor, match.index);
    if (before) parts.push({ type: "text", text: before });
    const info = parseFenceInfo(match[1]);
    parts.push({
      type: "code",
      token: `code-${messageIndex}-${codeIndex++}`,
      name: info.name,
      lang: info.lang,
      content: match[2] || "",
    });
    cursor = match.index + match[0].length;
  }
  const rest = content.slice(cursor);
  if (rest) parts.push({ type: "text", text: rest });
  return parts;
}

/* ══════════════════════════════════════════════════════════════
   AI 交付区（唯一渲染出口；规范见文件头「交付格式规范」/ web/DELIVERY-FORMAT.md）
   ───────────────────────────────────────────────────────────
   · 气泡里（内容本体）：代码块 .code-block、图片 .deliver-image + .deliver-photo；
     一律平铺，不套带边框的卡片 —— 边上不留任何「无名框」，也不放按钮；
   · 气泡外（操作集合）：.deliver-tray 小卡牌，一行一个交付物
     = 类型图标 + 文件名 + 大小/行数 + 图标按钮；
   · 图标按钮：打开 ↗、保存到本机 ⤓/📁（点一下就弹「选择文件夹」对话框，
     见 saveBlobToPickedFolder / saveRemoteImageToPickedFolder / saveSpaceFileToPickedFolder）
   ⚠ 这里的模板字符串一律写成「一整行」：气泡是 white-space:pre-wrap，
     模板里的缩进换行会被当成空行渲染，内容边上就会多出莫名其妙的空白。
   ══════════════════════════════════════════════════════════════ */

/* 交付区用的小图标（线稿风格，颜色跟随 CSS 的 currentColor） */
const DELIVER_ICON = {
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 20"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  space: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><path d="M12 10v6"/><path d="M9.4 13.4L12 16l2.6-2.6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
};

function imageFileName(image) {
  const base = String(image.prompt || "").trim().replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 24) || "AI绘图";
  return `${base}-${String(Date.now()).slice(-6)}.png`;
}

/* 外链图片拿不到真实文件大小：dataURL 能直接从 base64 算，其它等图加载完用「宽 × 高」补上 */
function dataUrlBytes(src) {
  const base64 = String(src).split(",")[1] || "";
  const padding = (base64.match(/=+$/) || [""])[0].length;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function imageMetaLabel(image, src) {
  if (Number(image.size)) return formatBytes(image.size);
  if (/^data:image\//i.test(src)) {
    const bytes = dataUrlBytes(src);
    if (bytes) return formatBytes(bytes);
  }
  return "";   // 空着，等 load 事件补「宽 × 高」
}

/* 文件卡片左侧的类型图标：图片 / 代码 / 普通文件 */
function fileTypeIcon(name) {
  if (/\.(png|jpe?g|gif|webp|svg|bmp|ico|avif|apng)$/i.test(name)) return DELIVER_ICON.image;
  if (/\.(py|js|mjs|cjs|ts|jsx|tsx|css|scss|less|html?|xml|json|jsonl|csv|md|ya?ml|toml|java|c|h|cpp|hpp|go|rs|rb|php|vue|svelte|sh|bat|ps1|sql|ini|cfg|conf|log|txt)$/i.test(name)) return DELIVER_ICON.code;
  return DELIVER_ICON.file;
}

/* 气泡里的图和气泡外卡牌里的那一行，靠这个 token 对上（图加载完用它回填「宽 × 高」） */
function imageShotToken(messageIndex, imageIndex) {
  return `shot-${messageIndex}-${imageIndex}`;
}

/* ① 气泡里的图片：只负责「显示」+ 淡入 / 破图两种状态，没有边框、没有内边距 */
function assistantImagesMarkup(item, messageIndex) {
  const images = Array.isArray(item.images) ? item.images : [];
  const blocks = images.map((image, imageIndex) => {
    const src = String(image.url || "");
    if (!src) return "";
    const prompt = String(image.prompt || "AI 生成图片");
    return `<div class="deliver-image" data-shot="${imageShotToken(messageIndex, imageIndex)}"><img class="deliver-photo" src="${escapeHtml(src)}" alt="${escapeHtml(prompt)}" loading="lazy"><span class="deliver-broken">图片没能加载出来，点小卡牌上的「打开」去原图看看</span></div>`;
  }).filter(Boolean).join("");
  return blocks ? `<div class="bubble-returns">${blocks}</div>` : "";
}

/* ② 气泡外面的「下载小卡牌」：图片 / 代码块 / 空间文件共用一套行样式（图标 + 名字 + 说明 + 按钮） */
function assistantDeliverTrayMarkup(item, messageIndex) {
  const files = Array.isArray(item.files) ? item.files : [];
  const images = Array.isArray(item.images) ? item.images : [];
  // markdown 代码块也算「返回的文件」，同样在这里出一行
  // ⚠ 必须与 assistantContentMarkup 用同一条 displayAnswer 正文，token 才对得上
  const codeParts = messageParts(displayAnswer(item.content), messageIndex).filter((part) => part.type === "code");
  if (!files.length && !images.length && !codeParts.length) return "";

  const imageRows = images.map((image, imageIndex) => {
    const src = String(image.url || "");
    if (!src) return "";
    const name = imageFileName(image);
    const prompt = String(image.prompt || "AI 生成图片");
    const meta = imageMetaLabel(image, src);
    // 外链图 / 内嵌图都提供保存按钮（点开就是「选择文件夹」对话框，存进所选文件夹）
    const spaceBtn = /^https?:/i.test(src)
      ? `<button type="button" class="deliver-icon-btn" data-image-action="space" data-image-url="${escapeHtml(src)}" data-image-name="${escapeHtml(name)}" title="选择文件夹保存（想给 AI 用就选 AI 空间目录）">${DELIVER_ICON.space}</button>`
      : "";
    return `<div class="tray-row">` +
      `<span class="tray-icon">${DELIVER_ICON.image}</span>` +
      `<span class="tray-name" title="${escapeHtml(prompt)}">${escapeHtml(name)}</span>` +
      `<span class="tray-size" data-image-size="${imageShotToken(messageIndex, imageIndex)}">${escapeHtml(meta)}</span>` +
      `<span class="tray-actions">` +
        `<a class="deliver-icon-btn" href="${escapeHtml(src)}" target="_blank" rel="noopener" title="在新标签页看原图">${DELIVER_ICON.open}</a>` +
        `<button type="button" class="deliver-icon-btn" data-image-action="download" data-image-url="${escapeHtml(src)}" data-image-name="${escapeHtml(name)}" title="选择文件夹，保存到本机">${DELIVER_ICON.download}</button>` +
        spaceBtn +
      `</span></div>`;
  }).join("");

  const codeRows = codeParts.map((part) => {
    const label = part.name || (part.lang ? `${part.lang} 代码` : "代码片段");
    const lines = part.content.trim() ? part.content.trim().split("\n").length : 0;
    // 代码内容在这里登记（气泡里的 pre 不存副本）：卡牌上的保存按钮按同一个 token 取
    codeFileStore.set(part.token, { name: part.name, lang: part.lang, content: part.content });
    return `<div class="tray-row">` +
      `<span class="tray-icon">${DELIVER_ICON.code}</span>` +
      `<span class="tray-name" title="${escapeHtml(label)}">${escapeHtml(label)}</span>` +
      `<span class="tray-size">${escapeHtml(`${part.lang || "代码"} · ${lines} 行`)}</span>` +
      `<span class="tray-actions">` +
        `<button type="button" class="deliver-icon-btn" data-code-action="download" data-code-id="${part.token}" title="选择文件夹，保存到本机">${DELIVER_ICON.download}</button>` +
        `<button type="button" class="deliver-icon-btn" data-code-action="space" data-code-id="${part.token}" title="选择文件夹保存（想给 AI 用就选 AI 空间目录）">${DELIVER_ICON.space}</button>` +
      `</span></div>`;
  }).join("");

  const fileRows = files.map((file) => {
    const name = String(file.name || file.path || "文件");
    const path = String(file.path || name);
    const size = Number(file.size) || 0;
    const openHref = `/api/space/raw?path=${encodeURIComponent(path)}`;
    return `<div class="tray-row">` +
      `<span class="tray-icon">${fileTypeIcon(name)}</span>` +
      `<span class="tray-name" title="${escapeHtml(path)}">${escapeHtml(name)}</span>` +
      `<span class="tray-size">${size ? formatBytes(size) : "已写进空间"}</span>` +
      `<span class="tray-actions">` +
        `<a class="deliver-icon-btn" href="${openHref}" target="_blank" rel="noopener" title="在浏览器里打开">${DELIVER_ICON.open}</a>` +
        `<button type="button" class="deliver-icon-btn" data-space-action="save" data-space-path="${escapeHtml(path)}" data-space-name="${escapeHtml(name)}" title="选择文件夹，保存到本机">${DELIVER_ICON.download}</button>` +
      `</span></div>`;
  }).join("");

  // 顺序固定：图片 → 代码块 → 空间文件（气泡内也是「先正文（含代码）、后图片」）
  const rows = imageRows + codeRows + fileRows;
  return rows ? `<div class="deliver-tray">${rows}</div>` : "";
}

/* AI 正文：文字照常显示，```代码块``` 只把代码本体平铺出来（无边框卡片、无按钮）；
   保存到本机（弹文件夹选择器）的操作统一在气泡外的小卡牌上（assistantDeliverTrayMarkup）。
   → 这是「交付格式规范」的核心约定，新增交付类型前先看 web/DELIVERY-FORMAT.md。 */
function assistantContentMarkup(item, messageIndex) {
  let html = "";
  const content = displayAnswer(item.content);   // 首尾空白会导致气泡顶部/底部多出空行
  // 正在打字时文字用 .streaming-text 包住，后面重渲染时不会把已有文字再显示一遍
  const textClass = item.streaming ? "streaming-text" : "message-text";
  if (item.streaming) {
    /* 流式期间先不切代码块：整段文字放进唯一的 .streaming-text
       （renderStreamingAnswer 每次只更新这一个 span，切了就会多处正文重复）；
       打字结束、item.streaming 消失后的下一次渲染再切成代码块。 */
    if (content) html += `<span class="${textClass}">${escapeHtml(content)}</span>`;
  } else {
    messageParts(content, messageIndex).forEach((part) => {
      if (part.type === "text") {
        if (part.text) html += `<span class="${textClass}">${escapeHtml(part.text)}</span>`;
        return;
      }
      html += `<pre class="code-block"><code>${escapeHtml(part.content)}</code></pre>`;
    });
  }
  html += assistantImagesMarkup(item, messageIndex);
  if (item.streaming) html += '<span class="cursor-block"></span>';
  return html;
}

function codeFileDownloadName(entry) {
  const ext = CODE_LANG_EXT[entry.lang] || "txt";
  if (!entry.name) return `代码片段.${ext}`;
  return /\.[A-Za-z0-9]{1,8}$/.test(entry.name) ? entry.name : `${entry.name}.${ext}`;
}

/* ══════════════════════════════════════════════════════════════
   ★ 保存到本机（交付小卡牌上所有「下载 / 存到空间」按钮的唯一出口）
   ──────────────────────────────────────────────────────────────
   点一下就弹出「选择文件夹」对话框，直接写进你选的那个文件夹，
   不用再去 /space 页粘贴路径绑定；
   浏览器不支持 File System Access（Firefox / Safari 等）时退回默认下载位置。
   ⚠ pickSaveFolder 必须在点击手势里最先调用：fetch 之后再弹窗，
     浏览器会认为「不是用户点的」而拒绝打开。
   ══════════════════════════════════════════════════════════════ */
const SAVE_FOLDER_ID = "mogao-save-folder";   // 让浏览器记住上次选的保存位置
let lastSaveDirHandle = null;                 // 下次用 startIn 从上次的位置打开

/* 返回目录句柄；用户点取消 → "cancelled"，浏览器不支持 → "unsupported"，其它错误 → null */
async function pickSaveFolder() {
  if (typeof window.showDirectoryPicker !== "function") return "unsupported";
  const options = { id: SAVE_FOLDER_ID, mode: "readwrite" };
  if (lastSaveDirHandle) options.startIn = lastSaveDirHandle;   // 默认从上次的位置打开
  try {
    const handle = await window.showDirectoryPicker(options);
    lastSaveDirHandle = handle;
    return handle;
  } catch (error) {
    if (error && error.name === "AbortError") return "cancelled";   // 用户点了取消
    if (lastSaveDirHandle) {
      /* 记着的旧句柄可能已失效（文件夹被删/改名）：去掉起始位置再试一次 */
      try {
        const handle = await window.showDirectoryPicker({ id: SAVE_FOLDER_ID, mode: "readwrite" });
        lastSaveDirHandle = handle;
        return handle;
      } catch (retryError) {
        if (retryError && retryError.name === "AbortError") return "cancelled";
      }
    }
    console.warn("选择保存文件夹失败", error);
    return null;
  }
}

/* 不支持文件夹选择器时的兜底：走浏览器自己的下载 */
function browserDownloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function writeBlobIntoFolder(folder, blob, name) {
  try {
    const fileHandle = await folder.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    window.themeHint?.(`已保存到「${folder.name}」· ${name}`);
    return true;
  } catch (error) {
    console.warn("写入所选文件夹失败", error);
    window.themeHint?.(`写入失败：${error.message}`);
    return false;
  }
}

/* 返回 "saved"（存进所选文件夹）/ "downloaded"（退回默认下载）/ "cancelled" / "failed" */
async function saveBlobToPickedFolder(blob, name) {
  const folder = await pickSaveFolder();
  if (folder === "cancelled") return "cancelled";
  if (folder === "unsupported" || folder === null) {
    browserDownloadBlob(blob, name);
    window.themeHint?.("这个浏览器不支持选择文件夹，已改存到默认下载位置");
    return "downloaded";
  }
  return (await writeBlobIntoFolder(folder, blob, name)) ? "saved" : "failed";
}

/* 代码块等纯文本：内容已经在手，直接包成 blob 存 */
async function saveTextToPickedFolder(name, text) {
  return saveBlobToPickedFolder(new Blob([text], { type: "text/plain;charset=utf-8" }), name || "download.txt");
}

/* 外链图片：先弹文件夹（必须在点击手势里），再抓成 blob 写进去；图床挡跨域就退回打开原图 */
async function saveRemoteImageToPickedFolder(src, name) {
  const folder = await pickSaveFolder();
  if (folder === "cancelled") return "cancelled";
  try {
    const response = await fetch(src, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (folder === "unsupported" || folder === null) {
      browserDownloadBlob(blob, name || "AI图片.png");
      window.themeHint?.("这个浏览器不支持选择文件夹，已改存到默认下载位置");
      return "downloaded";
    }
    return (await writeBlobIntoFolder(folder, blob, name || "AI图片.png")) ? "saved" : "failed";
  } catch (error) {
    window.open(src, "_blank", "noopener");
    window.themeHint?.("这个图床不允许直接下载，已在新标签打开原图，右键可以另存为");
    return "failed";
  }
}

/* 空间里的文件（AI 写进去的）：先弹文件夹，再从服务端抓内容写进去 */
async function saveSpaceFileToPickedFolder(path, name) {
  const folder = await pickSaveFolder();
  if (folder === "cancelled") return "cancelled";
  try {
    const response = await fetch(`/api/space/raw?path=${encodeURIComponent(path)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (folder === "unsupported" || folder === null) {
      browserDownloadBlob(blob, name || "download");
      window.themeHint?.("这个浏览器不支持选择文件夹，已改存到默认下载位置");
      return "downloaded";
    }
    return (await writeBlobIntoFolder(folder, blob, name || "download")) ? "saved" : "failed";
  } catch (error) {
    window.themeHint?.(`下载失败：${error.message}`);
    return "failed";
  }
}

/* 保存成功后给按钮换成对勾（鼠标悬停能看到状态） */
function markDeliverButtonDone(button, title) {
  button.innerHTML = DELIVER_ICON.check;
  button.classList.add("is-done");
  button.title = title || "已保存";
}

/* ══════════════════════════════════════════════════════════════
   「所有存储库」按钮（输入框工具栏）：点一下直接弹「选择文件夹」，
   把选中的文件夹定为默认保存 / 存储位置 —— 按钮上显示名字，句柄存进
   IndexedDB（下次打开页面还在），以后保存文件时选择器默认从这里开始。
   （浏览器拿不到文件夹的绝对路径，所以「记住」靠的是文件句柄。）
   ══════════════════════════════════════════════════════════════ */
const REPO_DB_NAME = "mogao-repo";
const REPO_DB_STORE = "handles";
const REPO_HANDLE_KEY = "repo-dir";
const REPO_NAME_KEY = "mogao-repo-name";

function openRepoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REPO_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(REPO_DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbPutRepoHandle(handle) {
  const db = await openRepoDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(REPO_DB_STORE, "readwrite");
    tx.objectStore(REPO_DB_STORE).put(handle, REPO_HANDLE_KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGetRepoHandle() {
  const db = await openRepoDb();
  const handle = await new Promise((resolve, reject) => {
    const request = db.transaction(REPO_DB_STORE, "readonly").objectStore(REPO_DB_STORE).get(REPO_HANDLE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return handle;
}

function updateRepoLabel(name) {
  const label = $("#repoName");
  const button = $("#repoButton");
  if (label) label.textContent = name ? `· ${name}` : "";
  if (button) button.title = name ? `默认保存位置：${name}（点击更换）` : "选择要保存到本机的文件夹（默认保存位置）";
}

async function setupRepoButton() {
  const button = $("#repoButton");
  if (!button) return;
  const storedName = localStorage.getItem(REPO_NAME_KEY) || "";
  if (storedName) updateRepoLabel(storedName);
  try {
    const handle = await idbGetRepoHandle();
    if (handle) {
      lastSaveDirHandle = handle;   // 供保存选择器当起始位置
      if (!storedName) updateRepoLabel(handle.name);
    }
  } catch (error) {
    console.warn("读取默认保存位置失败", error);
  }
  button.addEventListener("click", async () => {
    const folder = await pickSaveFolder();   // 直接弹「选择文件夹」
    if (folder === "cancelled") return;
    if (folder === "unsupported" || folder === null) {
      window.themeHint?.("这个浏览器不支持选择文件夹（建议用 Chrome / Edge），唔~");
      return;
    }
    updateRepoLabel(folder.name);
    localStorage.setItem(REPO_NAME_KEY, folder.name);
    try { await idbPutRepoHandle(folder); } catch (error) { console.warn("记住默认保存位置失败", error); }
    window.themeHint?.(`已把「${folder.name}」定为默认保存位置，保存文件时会从这里开始，唔~`);
  });
}

/* 小卡牌上的按钮（事件委托，渲染后重新绑也能用）
   —— 代码块 / 图片 / 空间文件的保存按钮都走「弹文件夹 → 写进去」这条链路 */
messagesEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-code-action]");
  if (!button) return;
  const entry = codeFileStore.get(button.dataset.codeId);
  if (!entry) return;
  button.disabled = true;
  const result = await saveTextToPickedFolder(codeFileDownloadName(entry), entry.content);
  button.disabled = false;
  if (result === "saved" || result === "downloaded") markDeliverButtonDone(button);
});

/* 小卡牌上的图片按钮：两个按钮现在都是「弹文件夹 → 存到本机」 */
messagesEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-image-action]");
  if (!button) return;
  button.disabled = true;
  const result = await saveRemoteImageToPickedFolder(button.dataset.imageUrl, button.dataset.imageName);
  button.disabled = false;
  if (result === "saved" || result === "downloaded") markDeliverButtonDone(button);
});

/* 空间文件行：弹文件夹 → 从服务端抓内容写进所选文件夹 */
messagesEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-space-action]");
  if (!button) return;
  button.disabled = true;
  const result = await saveSpaceFileToPickedFolder(button.dataset.spacePath, button.dataset.spaceName);
  button.disabled = false;
  if (result === "saved" || result === "downloaded") markDeliverButtonDone(button);
});

/* 交付图片的加载状态：
   · load  → 图片容器加 .is-ready（淡入），拿不到文件大小的外链图顺便补成「宽 × 高」（写进气泡外卡牌的那一行）
   · error → 容器加 .is-broken，用一句提示代替破图（外链过期 / 图床挡外链） */
messagesEl.addEventListener("load", (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement)) return;
  const shot = image.closest(".deliver-image");
  if (!shot) return;
  shot.classList.add("is-ready");
  const token = shot.dataset.shot;
  const sizeEl = token ? shot.closest(".message")?.querySelector(`[data-image-size="${token}"]`) : null;
  if (sizeEl && !sizeEl.textContent.trim() && image.naturalWidth) {
    sizeEl.textContent = `${image.naturalWidth} × ${image.naturalHeight}`;
  }
}, true);

messagesEl.addEventListener("error", (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement) image.closest(".deliver-image")?.classList.add("is-broken");
}, true);

/* 整页接收拖拽：拖到哪都算（输入框区域也会给出提示层） */
function setupAttachmentDrop() {
  const main = $(".main");
  const attachInput = $("#attachInput");
  $("#attachButton")?.addEventListener("click", () => attachInput?.click());
  attachInput?.addEventListener("change", () => {
    addFilesToAttachments(attachInput.files);
    attachInput.value = "";
  });

  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  document.addEventListener("dragover", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    main?.classList.add("drop-active");
  });
  document.addEventListener("dragleave", (event) => {
    if (event.relatedTarget) return;   // 还在页面里移动，不收起提示
    main?.classList.remove("drop-active");
  });
  document.addEventListener("drop", (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    main?.classList.remove("drop-active");
    addFilesToAttachments(event.dataTransfer.files);
  });
  /* 截图 / 图片可以直接 Ctrl+V 粘进输入框 */
  document.addEventListener("paste", (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    addFilesToAttachments(files);
  });
}

/* 空间页（/space）「发送到对话」留下的文件，回到聊天页时挂成附件 */
function consumeSpacePayload() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem("mogao-space-payload") || "null");
  } catch (error) {
    payload = null;
  }
  if (!payload) return;
  localStorage.removeItem("mogao-space-payload");
  const isImage = payload.kind === "image";
  pendingAttachments.push({
    id: `att-space-${++attachmentSeq}`,
    name: payload.name || "来自空间的文件",
    size: payload.size || 0,
    kind: isImage ? "image" : "text",
    text: isImage ? "" : String(payload.text || "").slice(0, ATTACH_TEXT_LIMIT),
    preview: isImage ? String(payload.dataUrl || "") : "",
  });
  renderPendingAttachments();
  inputEl.focus();
  $("#typingState").textContent = `已带上《${payload.name}》，写点什么再发送`;
}

/* ========== 「问」：随机日常问题（点一条填进输入框，不会自动发送） ========== */
/* 想加自己的问题：往这个数组里继续写字符串就行，每次点开随机抽 6 条 */
const ASK_QUESTIONS = [
  "今天晚饭吃什么好？给三个省事的选项",
  "帮我想一句发朋友圈的文案，别太矫情",
  "最近总失眠，有什么温和的助眠办法？",
  "周末一个人在家，可以做点什么有意思的事？",
  "帮我列一份本周的买菜清单",
  "想学做一道简单的家常菜，推荐哪个？",
  "怎么把房间收拾得更清爽？给几个小技巧",
  "帮我正经地写一条请假理由",
  "最近总是犯困，什么原因？要怎么调整",
  "送朋友生日礼物，预算 200 以内，有什么推荐？",
  "帮我给小猫取 5 个可爱的名字",
  "怎么才能早起不痛苦？",
  "帮我写一段安慰失恋朋友的话",
  "电脑越用越卡，有什么不花钱的提速办法？",
  "想减肥又管不住嘴，给点实际建议",
  "帮我写一句适合发在群里的邀请通知",
  "推荐几部适合下雨天看的电影",
  "怎么跟人道歉才显得真诚？",
  "帮我安排一条不太累的一日游路线",
  "手机内存总是不够，怎么清理比较靠谱？",
  "帮我想几个不加班也能提升自己的小习惯",
  "心情不好，讲个冷笑话让我开心一下",
  "帮我写一份简单的月度开销记录模板",
  "第一次去健身房应该注意什么？",
  "怎么礼貌地拒绝别人的请求？",
  "帮我给这段话润色一下，让它更通顺",
  "通勤路上有什么适合听的东西推荐？",
  "家里养绿萝总养不活，问题出在哪？",
];

function pickAskQuestions(count) {
  const pool = ASK_QUESTIONS.slice();
  const picked = [];
  while (pool.length && picked.length < count) {
    picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return picked;
}

function closeAskMenu() {
  const menu = $("#askMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("#askButton")?.classList.remove("is-open");
  $("#askButton")?.setAttribute("aria-expanded", "false");
}

function openAskMenu() {
  const menu = $("#askMenu");
  if (!menu) return;
  menu.innerHTML = '<p class="ask-menu-title">随机挑几个日常问题 · 点一条填进输入框</p>'
    + pickAskQuestions(6).map((question) => `<button type="button" role="menuitem" data-ask="${escapeHtml(question)}">${escapeHtml(question)}</button>`).join("");
  menu.hidden = false;
  $("#askButton")?.classList.add("is-open");
  $("#askButton")?.setAttribute("aria-expanded", "true");
}

/* 选中后只填进输入框（不自动发送），光标放到末尾，用户可以先改再发 */
function insertAskQuestion(question) {
  inputEl.value = question;
  inputEl.dispatchEvent(new Event("input"));   // 交给已有的 input 监听去自动撑高输入框
  inputEl.focus();
  inputEl.setSelectionRange(question.length, question.length);
  closeAskMenu();
  $("#typingState").textContent = "问题已填好，确认无误再点发送";
}

function setupAskMenu() {
  const button = $("#askButton");
  const menu = $("#askMenu");
  if (!button || !menu) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (menu.hidden) openAskMenu(); else closeAskMenu();
  });
  menu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-ask]");
    if (item) insertAskQuestion(item.dataset.ask);
  });
  document.addEventListener("click", (event) => {
    if (menu.hidden) return;
    if (event.target.closest("#askMenu") || event.target.closest("#askButton")) return;
    closeAskMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAskMenu();
  });
}

/* ========== 历史存档（过去 7 天） ==========
   传进来的 conversation 只要有 { historyId, sessionId, messages, summary } 就能存：
     · 当前会话 → persistCurrentConversation（用 state 拼一个）
     · 后台还在生成的会话 → 直接传它自己的流上下文（回答生成完写回它自己的存档） */
async function persistConversation(conversation) {
  // 只有附件的消息（没写字）也算有效内容，不能被过滤掉
  const clean = conversation.messages.filter((item) => String(item.content || "").trim() || (item.attachments || []).length);
  if (!clean.length) return null;
  const first = clean.find((item) => item.role === "user") || clean[0];
  const payload = {
    id: conversation.historyId || undefined,
    session_id: conversation.sessionId,
    title: String(first.content || first.attachments?.[0]?.name || "附件消息").trim().replace(/\s+/g, " ").slice(0, 28),
    messages: conversation.messages,
    summary: conversation.summary,
  };
  try {
    const response = await fetch("/api/history/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok || !data.item) return null;
    conversation.historyId = data.item.id;
    /* 保存期间用户可能已经切到别的会话：只更新「正在看的这段」的界面状态，
       另一段会话的 historyId 已经写回它自己的上下文里，不会丢 */
    if (conversation.sessionId === state.sessionId) {
      state.historyId = data.item.id;
      syncNavSelection();
      $("#savedConversationMeta").textContent = "刚刚保存";
    }
    window.historyListPointer?.refresh?.();
    return data.item;
  } catch (error) {
    console.warn("历史记录保存失败", error);
    return null;
  }
}

function persistCurrentConversation() {
  const conversation = {
    historyId: state.historyId,
    sessionId: state.sessionId,
    messages: state.messages,
    summary: state.summary,
  };
  return persistConversation(conversation).then((item) => {
    /* ⚠ 保存期间可能已经切到别的会话：晚到的响应不能污染新会话的 historyId，
       否则下一次保存会带着旧 id 把两条存档互相顶替（实测踩过）。 */
    if (item && conversation.sessionId === state.sessionId) state.historyId = item.id;
    return item;
  });
}

async function restoreConversation(item) {
  const targetSessionId = item.session_id || item.id;
  const live = activeChatStreams.get(targetSessionId);   // 这段会话还在生成？直接用内存里那份
  if (!live) {
    try {
      await fetch("/api/session/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: targetSessionId, messages: item.messages || [], summary: item.summary || "" }),
      });
    } catch (error) {
      console.warn("服务端会话恢复失败", error);
    }
  }
  state.sessionId = targetSessionId;
  state.historyId = item.id || live?.historyId || state.historyId;
  state.messages = live
    ? live.messages
    : (Array.isArray(item.messages)
      ? item.messages.filter((message) => String(message.content || "").trim() || (message.files || []).length || (message.images || []).length)
      : []);
  state.summary = live ? live.summary : (item.summary || "");
  state.thinking = live ? live.thinking : [];
  state.thinkingVisible = live ? live.thinking.length > 0 : false;
  state.thinkingCollapsed = live ? live.thinking.length > 3 : false;
  state.thinkingDone = false;
  state.requestError = "";
  saveState();
  renderMessages({ bottom: true });
  syncComposer();
  $("#savedConversationMeta").textContent = "已恢复历史对话";
  if (live) $("#typingState").textContent = "思考中...";
  else $("#typingState").textContent = "已恢复";
  window.historyListPointer?.refresh?.();
  if (!live) syncSessionFromServer();   // 看服务端有没有「离开时生成完、但没显示」的回答，有就补上
}

/* ========== 新聊天 ==========
   ★ 正在生成的回答不用等：它会在后台自己跑完、写回旧会话的存档，
     这里只把「正在看的这段」换成新会话；后台流不锁输入框。 */
function startNewConversation() {
  persistCurrentConversation();
  state.sessionId = uid();
  state.historyId = null;
  state.messages = [];
  state.summary = "";
  state.thinking = [];
  state.thinkingVisible = false;
  state.thinkingCollapsed = false;
  state.thinkingDone = false;
  state.requestError = "";
  saveState();
  renderMessages({ bottom: true });
  syncComposer();
  $("#savedConversationMeta").textContent = "刚刚新建";
  const background = activeChatStreams.size;   // 还开着几段后台流
  $("#typingState").textContent = background ? `新对话就绪（有 ${background} 段回答在后台继续生成）` : "新对话就绪";
  window.historyListPointer?.refresh?.();
  inputEl.focus();
}

/* ========== 右键删除会话（只在左侧栏） ==========
   侧栏「会话」列表里右键某一条 → 小菜单「删除这条会话」（贴鼠标位置弹出）；
   删的就是正在聊的那条时，会同时清空聊天区。
   两段式确认：第一次点变「再点一次确认删除」，第二次才真删（没有撤销，留一步缓冲）。
   ★ 按用户要求，聊天区右键不再提供删除入口（删除只在左侧栏）。 */
let sessionMenuEl = null;
let sessionMenuTarget = null;
let sessionMenuArmed = false;

function sessionMenuButton() {
  return sessionMenuEl?.querySelector("[data-session-action]") || null;
}

function buildSessionMenu() {
  if (sessionMenuEl) return sessionMenuEl;
  const menu = document.createElement("div");
  menu.className = "session-menu";
  menu.hidden = true;
  menu.innerHTML = '<div class="session-menu-title"></div><button type="button" class="session-menu-item danger" data-session-action="delete"></button>';
  menu.addEventListener("click", (event) => {
    const button = event.target.closest("[data-session-action]");
    if (!button) return;
    if (!sessionMenuArmed) {            // 第一次点：进入待确认状态
      sessionMenuArmed = true;
      menu.classList.add("is-armed");
      button.textContent = "再点一次确认删除";
      return;
    }
    const target = sessionMenuTarget;
    closeSessionMenu();
    deleteConversation(target);
  });
  document.body.appendChild(menu);
  sessionMenuEl = menu;
  return menu;
}

function openSessionMenu(event, target) {
  const menu = buildSessionMenu();
  sessionMenuTarget = target;
  sessionMenuArmed = false;
  menu.classList.remove("is-armed");
  menu.querySelector(".session-menu-title").textContent = `会话 · ${target.title || "未命名对话"}`;
  sessionMenuButton().textContent = "删除这条会话";
  menu.hidden = false;
  // 贴着鼠标放，贴近视口边缘时往回收一点
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - rect.height - 8))}px`;
}

function closeSessionMenu() {
  if (sessionMenuEl) sessionMenuEl.hidden = true;
  sessionMenuEl?.classList.remove("is-armed");
  sessionMenuTarget = null;
  sessionMenuArmed = false;
}

/* 清空聊天区（删掉正在聊的那条会话时用）：开一段新对话，不把旧内容写回存档 */
function resetConversationState() {
  cancelChatStream(state.sessionId);   // 正在生成的回答一并掐掉，避免回头又写回一条存档
  state.sessionId = uid();
  state.historyId = null;
  state.messages = [];
  state.summary = "";
  state.thinking = [];
  state.thinkingVisible = false;
  state.thinkingCollapsed = false;
  state.thinkingDone = false;
  state.requestError = "";
  state.lastUsage = null;
  saveState();
  renderMessages({ bottom: true });
  syncComposer();
  $("#savedConversationMeta").textContent = "会话已删除";
  $("#typingState").textContent = "已删除，可以重新开始";
}

/* 真删：先删服务端存档（后端顺带清掉内存会话），删的是当前会话就重置聊天区 */
async function deleteConversation(target) {
  if (!target) return;
  const isCurrent = target.kind === "current"
    || !!(target.item && (target.item.id === state.historyId || (target.item.session_id && target.item.session_id === state.sessionId)));
  const payload = isCurrent
    ? { id: state.historyId || "", session_id: state.sessionId }
    : { id: target.item?.id || "", session_id: target.item?.session_id || "" };
  try {
    const response = await fetch("/api/history/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "删除失败");
  } catch (error) {
    window.themeHint?.(`删除失败：${error.message}`);
    return;
  }
  /* 这段会话如果还在生成：把后台流一并掐掉，别让它回头又写一条存档回来 */
  cancelChatStream(payload.session_id);
  if (isCurrent) resetConversationState();
  window.themeHint?.(isCurrent ? "已删除当前会话，唔~" : "会话已删除");
  window.historyListPointer?.refresh?.();
}

function setupSessionMenu() {
  /* 侧栏「会话」列表：右键某一条 → 删那一条（名字用列表里显示的那个）。
     ★ 聊天区不再弹删除菜单（用户要求：删除只在左侧栏）。 */
  $("#savedConversation")?.addEventListener("contextmenu", (event) => {
    const button = event.target.closest("[data-history-id]");
    if (!button) return;
    event.preventDefault();
    openSessionMenu(event, {
      kind: "history",
      title: button.querySelector(".h-title")?.textContent || "",
      item: { id: button.dataset.historyId || "", session_id: button.dataset.historySession || "" },
    });
  });
  /* 点别处 / 按 Esc / 滚动消息流都收起菜单 */
  document.addEventListener("pointerdown", (event) => {
    if (sessionMenuEl && !sessionMenuEl.hidden && !sessionMenuEl.contains(event.target)) closeSessionMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSessionMenu();
  });
  messagesEl.addEventListener("scroll", closeSessionMenu);
  window.addEventListener("resize", closeSessionMenu);
}

/* ========== 上下文控制器 ========== */
function toggleController(forceCollapsed) {
  const collapsed = typeof forceCollapsed === "boolean" ? forceCollapsed : !controller.classList.contains("collapsed");
  controller.classList.toggle("collapsed", collapsed);
  $("#toggleController").textContent = collapsed ? "+" : "−";
  $("#navController").setAttribute("aria-expanded", String(!collapsed));
  if (!collapsed) controller.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function compressContext() {
  if (foregroundStream()) {   // 正在生成时压缩会把这条回答弄丢，先拦住
    $("#compressionNote").textContent = "当前回答还在生成，等它说完再压缩，唔~";
    return;
  }
  const keepRecent = Number($("#keepRecent").value);
  $("#compressionNote").textContent = "正在整理较早的对话...";
  try {
    const response = await fetch("/api/context/compress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, messages: state.messages, keep_recent: keepRecent }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "压缩失败");
    state.messages = data.messages || state.messages;
    state.summary = data.summary || "";
    saveState();
    renderMessages();
    $("#compressionNote").textContent = state.summary
      ? "较早内容已整理为摘要，最近对话保持原样。"
      : "消息还不多，暂时无需压缩。";
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
  cancelChatStream(state.sessionId);   // 正在生成的回答一并停掉，避免清完了又冒出来
  try {
    await fetch("/api/session/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
  } catch (error) {
    console.warn("服务端上下文重置失败", error);
  }
  state.messages = [];
  state.summary = "";
  state.thinking = [];
  state.thinkingVisible = false;
  state.thinkingDone = false;
  saveState();
  renderMessages({ bottom: true });
  syncComposer();
  $("#compressionNote").textContent = "上下文已清空，可以重新开始提问。";
  $("#savedConversationMeta").textContent = "上下文已清空";
}

/* ========== 思考强度（真实调节 thinking / reasoning_effort / max_tokens / temperature） ========== */
function effortLevels() {
  return state.effortLevels.length ? state.effortLevels : FALLBACK_EFFORT_LEVELS;
}

function currentEffort() {
  const levels = effortLevels();
  return levels.find((item) => item.level === state.effortLevel) || levels[levels.length - 1];
}

/* 展示上一次回答的真实 token 消耗，档位越高越费 token 能直接看出来 */
function renderMindUsage() {
  const target = $("#mindUsage");
  if (!target) return;
  const effort = currentEffort();
  if (state.lastUsage?.total_tokens) {
    const label = state.lastEffort?.label || effort.label;
    const think = state.lastUsage.reasoning_tokens
      ? `其中思考 ${state.lastUsage.reasoning_tokens}`
      : "未开启思考";
    target.textContent = `上次消耗 ${state.lastUsage.total_tokens} tokens（${think}）· ${label}档，本档上限 ${effort.max_tokens} tokens。`;
    return;
  }
  target.textContent = `${effort.note || "档位越高思维链越长，消耗的 token 与费用越多。"}（本档上限 ${effort.max_tokens} tokens）`;
}

/* 每个档位节点都带一张小缩略图，点它可直接跳到该档位 */
function renderMindNodes() {
  const holder = $("#mindNodes");
  if (!holder) return;
  holder.innerHTML = effortLevels().map((item) => {
    const bg = MIND_BG_IMAGES[item.level] || "";
    return `
    <button class="mind-node ${item.level === state.effortLevel ? "is-active" : ""}" type="button" data-level="${item.level}"
            title="档位 ${item.level} · ${escapeHtml(item.label)}｜背景 ${escapeHtml(bg)}"
            style="--node-thumb:url('${escapeHtml(bg)}')">
      <span class="mind-node-dot"></span>
      <span class="mind-node-label">${escapeHtml(item.label)}</span>
    </button>`;
  }).join("");
  holder.querySelectorAll("[data-level]").forEach((button) => {
    button.addEventListener("click", () => setEffortLevel(button.dataset.level));
  });
}

/* 背景是否跟着档位换：开关关掉就完全不碰背景层 */
function applyMindBackground(fade) {
  const layer = $("#chatBg");
  if (!layer) return;
  const src = MIND_BG_IMAGES[state.effortLevel] || "";
  const visible = Boolean(state.bgFollow && src);
  // 面板（气泡/输入框）据此切成半透明，详见 app.css 的 body.has-chat-bg
  document.body.classList.toggle("has-chat-bg", visible);
  if (!visible) {
    layer.classList.remove("show");
    layer.dataset.src = "";
    return;
  }
  if (layer.dataset.src === src) {
    layer.classList.add("show");
    return;
  }
  const show = () => {
    layer.style.backgroundImage = `url("${src}")`;
    layer.dataset.src = src;
    layer.classList.add("show");
  };
  if (!fade) { show(); return; }
  layer.classList.remove("show");   // 先淡出再换图，切档位时不会硬闪
  setTimeout(show, 170);
}

function renderMindUI(fade) {
  const effort = currentEffort();
  const range = $("#mindRange");
  if (!range) return;
  const total = effortLevels().length;
  const detail = effort.thinking
    ? `思考开启 · reasoning_effort=${effort.effort} · temperature ${effort.temperature} · 上限 ${effort.max_tokens} tokens`
    : `思考关闭 · temperature ${effort.temperature} · 上限 ${effort.max_tokens} tokens`;
  // 工具栏里只保留一条可拖动的条，档位细节挂在 title / aria 与设置弹窗里
  range.max = String(total);
  range.value = String(effort.level);
  range.title = `思考强度 ${effort.level}/${total} · ${effort.label}（${detail}）`;
  range.setAttribute("aria-valuetext", `${effort.label}：${detail}`);
  const info = $("#mindSettingState");
  if (info) info.textContent = `当前：${effort.label}（${effort.level}/${total}）· ${detail}`;
  const toggle = $("#mindBgToggle");
  if (toggle) toggle.checked = state.bgFollow;
  renderMindNodes();
  renderMindUsage();
  applyMindBackground(fade);
}

function setEffortLevel(level) {
  const max = effortLevels().length;
  const next = Math.max(1, Math.min(Number(level) || state.effortLevel, max));
  // 拖动时 input 事件会连续触发，档位没变就不重新渲染（避免无谓的重绘与背景闪动）
  if (next === state.effortLevel) return;
  state.effortLevel = next;
  localStorage.setItem(EFFORT_LEVEL_KEY, String(state.effortLevel));
  renderMindUI(true);
}

/* ========== 事件绑定 ========== */
formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (sendButton.disabled) return;
  // 只发附件（不写字）也可以
  if (!message && !pendingAttachments.length) return;
  const attachments = pendingAttachments;
  pendingAttachments = [];
  inputEl.value = "";
  inputEl.style.height = "auto";
  renderPendingAttachments();
  sendMessage(message, attachments);
});

inputEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    formEl.requestSubmit();
  }
});

inputEl.addEventListener("input", () => {
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 180)}px`;
});

modelSelect.addEventListener("change", () => {
  state.model = modelSelect.value;
  saveState();
  $("#activeModel").textContent = state.model;
  applyModelSelectTint();   // 切到 DeepSeek 时下拉框变淡蓝
  // 只影响「之后」的新消息：老气泡上的名字用发送时记下的 modelLabel，不会跟着换
});

$("#mindRange").addEventListener("input", (event) => setEffortLevel(event.target.value));
$("#mindBgToggle").addEventListener("change", (event) => {
  state.bgFollow = event.target.checked;
  localStorage.setItem(MIND_BG_SWITCH_KEY, state.bgFollow ? "1" : "0");
  applyMindBackground(true);
});

$("#keepRecent").addEventListener("input", (event) => {
  $("#keepRecentValue").textContent = event.target.value;
});

$("#compressButton").addEventListener("click", compressContext);

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

$("#toggleController").addEventListener("click", (event) => {
  event.stopPropagation();
  toggleController();
});
controllerHandle.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  toggleController();
});
$("#navController").addEventListener("click", () => {
  toggleController();
});

$("#navNewChat").addEventListener("click", startNewConversation);

/* 「空间」按钮：直接在当前页换成 /DSH/space（本机文件页），不新开标签 */
$("#navSpace").addEventListener("click", () => {
  location.href = "/DSH/space";
});

/* 「小应用」按钮：换成预留的小应用页 /lab（同样是替换当前页，不新开标签）。
   页面本身与聊天页完全独立，接入点在 web/lab.js 顶部 LAB_APP（详见 web/lab/README.md）。 */
$("#navLab").addEventListener("click", () => {
  location.href = "lab.html";
});

/* 「回到最新」：把视图拉回底部，然后恢复自动跟随 */
$("#scrollLatestBtn").addEventListener("click", () => {
  messagesPinned = true;
  updateScrollLatestHint();
  messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: "smooth" });
});

/* 消息流滚动位置：贴底才自动跟随；一旦往上翻就彻底不动镜头 */
messagesEl.addEventListener("scroll", () => {
  messagesPinned = nearMessagesBottom();
  updateScrollLatestHint();
});

/* ========== 对外接口（theme.js 调用） ========== */
window.chatApp = {
  getState: () => ({ sessionId: state.sessionId, historyId: state.historyId, messages: state.messages, summary: state.summary }),
  restore: restoreConversation,
  save: persistCurrentConversation,
  compress: compressContext,
  clear: clearContext,
  newChat: startNewConversation,
};

/* ========== 初始化 ========== */
state.effortLevel = Number(localStorage.getItem(EFFORT_LEVEL_KEY)) || 3;
state.bgFollow = localStorage.getItem(MIND_BG_SWITCH_KEY) === "1";
loadState();
renderMindUI(false);
renderMessages({ bottom: true });
updateMemoryMeters();
loadConfig();
setupAttachmentDrop();
setupAskMenu();          // 「问」的随机日常问题菜单
setupRepoButton();       // 「所有存储库」：选文件夹定为默认保存位置
setupSessionMenu();      // 右键删除会话（只在左侧栏）
consumeSpacePayload();   // 从 /space 带回来的文件
syncSessionFromServer(); // 刷新 / 切页回来时：把服务端正在生成或已生成完、但没显示的回答补回来

/* auth.js 登录/退出/改头像后广播，这里据此刷新「用户 id + 头像」 */
window.addEventListener("authchange", (event) => {
  window.currentAuthUser = event.detail?.user || null;
  renderMessages();
});
