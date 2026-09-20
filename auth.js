/* ═══════════════════════════════════════════════════════════════════════════
   【登录系统】手机号注册 / 登录 + 微信登录入口
   ───────────────────────────────────────────────────────────────────────────
   ★ 相关文件只看这 3 个：
       1. web/auth.js   ← 当前文件（接口地址、登录态、头像规则）
       2. web/auth.css  ← 弹窗外观
       3. web/index.html 里的 id="authMask" 那一整段结构
   ★ 后端在 web_app.py 的「登录系统」段落，用户存在 data/users.json。
   ★ 验证码目前是「开发模式」：没接短信服务商，验证码会直接显示在弹窗里
     （同时打印到服务端控制台）。接了短信服务后改 web_app.py 的 auth_send_code。
   ★ 微信登录：需要微信开放平台 AppID/AppSecret + 已备案的公网回调域名，
     在 7878.env 里配 WECHAT_APP_ID / WECHAT_APP_SECRET 才会变成可用状态，
     没配置时按钮是灰的（这是有意为之，避免点进去报错）。
   ★ 头像：默认用昵称首字生成；用户上传的图片会在浏览器里压成 160×160 的
     JPEG data URL 再存，所以不会把 users.json 撑大。
   ═══════════════════════════════════════════════════════════════════════════ */

const AUTH_TOKEN_KEY = "mogao-auth-token";
const AUTH_AVATAR_SIZE = 160;              // 上传头像统一压到这个尺寸（像素）
const AUTH_CODE_COUNTDOWN = 60;            // 「获取验证码」倒计时（秒）

const AUTH_ENDPOINTS = {
  me: "/api/auth/me",
  providers: "/api/auth/providers",
  sendCode: "/api/auth/send_code",
  register: "/api/auth/register",
  login: "/api/auth/login",
  profile: "/api/auth/profile",
  logout: "/api/auth/logout",
  wechat: "/api/auth/wechat",
};

const PERSON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';

(function initAuth() {
  const $ = (selector) => document.querySelector(selector);

  let currentUser = null;
  let authTab = "register";
  let countdownTimer = null;
  let pendingAvatar = "";        // 设置弹窗里待保存的头像
  let authFromSettings = false;  // 是不是从「设置」里点进登录弹窗的

  const mask = $("#authMask");
  const form = $("#authForm");
  const note = $("#authNote");
  const submitButton = $("#authSubmit");
  const sendCodeButton = $("#authSendCode");
  const wechatButton = $("#authWechat");
  const wechatTip = $("#authWechatTip");
  const tabs = $("#authTabs");
  const settingsMask = $("#settingsMask");
  const profileNote = $("#profileNote");

  const getToken = () => localStorage.getItem(AUTH_TOKEN_KEY) || "";
  const setToken = (token) => localStorage.setItem(AUTH_TOKEN_KEY, token);
  const clearToken = () => localStorage.removeItem(AUTH_TOKEN_KEY);

  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

  function setNote(text, kind = "") {
    note.textContent = text || "";
    note.className = `auth-note${kind ? ` is-${kind}` : ""}`;
  }
  function setProfileNote(text, kind = "") {
    profileNote.textContent = text || "";
    profileNote.className = `auth-note${kind ? ` is-${kind}` : ""}`;
  }

  async function api(path, body, method = "POST") {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const response = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return await response.json();
  }

  /* ── 头像：有图用图，没图就用昵称首字（背景色跟着主题变量走） ── */
  function avatarMarkup(user) {
    if (user?.avatar) return `<img src="${escapeHtml(user.avatar)}" alt="" />`;
    const initial = (user?.name || "").trim().slice(0, 1);
    return initial ? escapeHtml(initial) : PERSON_ICON;
  }

  /* ── 设置弹窗里的个人信息（头像预览） ── */
  function renderProfileAvatar() {
    const holder = $("#profileAvatar");
    if (!holder || !currentUser) return;
    holder.innerHTML = avatarMarkup({ ...currentUser, avatar: pendingAvatar });
  }

  /* ── 左下角那张「横标」 ── */
  function renderUserCard() {
    const avatarEl = $("#userAvatar");
    const nameEl = $("#userName");
    const subEl = $("#userSub");
    if (avatarEl) avatarEl.innerHTML = currentUser ? avatarMarkup(currentUser) : PERSON_ICON;
    if (nameEl) nameEl.textContent = currentUser ? currentUser.name : "未登录";
    if (subEl) {
      if (!currentUser) subEl.textContent = "点击登录 / 注册";
      else if (currentUser.source === "wechat") subEl.textContent = "微信登录";
      else subEl.textContent = currentUser.phone || "已登录";
    }
    // 已登录就不必再显示「登录 / 注册」入口
    const loginItem = $("#menuLoginItem");
    if (loginItem) loginItem.hidden = Boolean(currentUser);
    // 广播登录态：web/app.js 监听 authchange，用来刷新消息上的「用户 id」与头像
    window.currentAuthUser = currentUser;
    window.dispatchEvent(new CustomEvent("authchange", { detail: { user: currentUser } }));
  }

  /* ── 弹窗开关 ── */
  function setTab(tab) {
    authTab = tab;
    tabs?.querySelectorAll("[data-auth-tab]").forEach((item) => item.classList.toggle("is-active", item.dataset.authTab === tab));
    document.querySelectorAll("[data-register-only]").forEach((item) => { item.hidden = tab !== "register"; });
    $("#authTitle").textContent = tab === "register" ? "创建账号" : "欢迎回来";
    $("#authSubtitle").textContent = tab === "register"
      ? "用手机号注册，登录后左下角会显示你的头像和名字"
      : "输入手机号和密码继续";
    submitButton.textContent = tab === "register" ? "注册并登录" : "登录";
    $("#authPassword").setAttribute("autocomplete", tab === "register" ? "new-password" : "current-password");
    setNote("");
  }

  function openAuth() {
    if (!mask) return;
    closeSettings();                       // 两个弹窗不同时出现
    mask.classList.add("show");
    mask.setAttribute("aria-hidden", "false");
    setTab(authTab);
    setTimeout(() => $("#authPhone")?.focus(), 60);
  }

  function closeAuth() {
    // 先移走焦点，否则 aria-hidden 会作用在仍聚焦的输入框上（浏览器会告警）
    if (mask?.contains(document.activeElement)) document.activeElement.blur();
    mask?.classList.remove("show");
    mask?.setAttribute("aria-hidden", "true");
    setNote("");
  }

  /* ── 设置弹窗：个人信息（上）+ 账号与登录（下） ── */
  function renderSettings() {
    const loggedIn = Boolean(currentUser);
    pendingAvatar = currentUser?.avatar || "";
    const avatarHolder = $("#profileAvatar");
    if (avatarHolder) avatarHolder.innerHTML = loggedIn ? avatarMarkup(currentUser) : PERSON_ICON;
    $("#profileName").textContent = loggedIn ? currentUser.name : "未登录";
    $("#profilePhone").textContent = loggedIn
      ? (currentUser.source === "wechat" ? "微信登录" : (currentUser.phone || ""))
      : "登录后可设置头像与昵称";
    $("#profileNameInput").value = loggedIn ? currentUser.name : "";
    $("#profileNameInput").disabled = !loggedIn;
    $("#profileAvatarBtn").disabled = !loggedIn;
    $("#profileAvatarClear").disabled = !loggedIn;
    $("#profileSave").disabled = !loggedIn;
    $("#accountState").textContent = loggedIn
      ? `已登录：${currentUser.name}${currentUser.phone ? `（${currentUser.phone}）` : ""}`
      : "当前未登录，注册后头像和昵称会显示在左下角";
    $("#settingsLogin").hidden = loggedIn;
    $("#settingsLogout").hidden = !loggedIn;
    setProfileNote("");
  }

  function openSettings() {
    if (!settingsMask) return;
    closeAuth();
    renderSettings();
    settingsMask.classList.add("show");
    settingsMask.setAttribute("aria-hidden", "false");
  }

  function closeSettings() {
    if (settingsMask?.contains(document.activeElement)) document.activeElement.blur();
    settingsMask?.classList.remove("show");
    settingsMask?.setAttribute("aria-hidden", "true");
    setProfileNote("");
  }

  /* ── 登录态 ── */
  async function loadCurrentUser() {
    if (!getToken()) { renderUserCard(); return; }
    try {
      const data = await api(AUTH_ENDPOINTS.me, null, "GET");
      currentUser = data.user || null;
      if (!currentUser) clearToken();
    } catch (error) {
      console.warn("读取登录态失败", error);
    }
    renderUserCard();
  }

  async function refreshProviders() {
    try {
      const data = await api(AUTH_ENDPOINTS.providers, null, "GET");
      const ready = Boolean(data.wechat);
      wechatButton?.classList.toggle("is-disabled", !ready);
      if (wechatButton) wechatButton.dataset.ready = ready ? "1" : "";
      if (wechatTip) wechatTip.textContent = ready
        ? "点击后用微信扫码授权登录"
        : "未配置：需要微信开放平台 AppID/AppSecret 和已备案的回调域名（在 7878.env 里设置 WECHAT_APP_ID / WECHAT_APP_SECRET）";
    } catch (error) {
      console.warn("读取登录方式失败", error);
      if (wechatTip) wechatTip.textContent = "无法读取登录方式配置";
    }
  }

  /* ── 验证码 ── */
  function startCountdown() {
    let left = AUTH_CODE_COUNTDOWN;
    clearInterval(countdownTimer);
    sendCodeButton.disabled = true;
    sendCodeButton.textContent = `${left}s 后重发`;
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(countdownTimer);
        sendCodeButton.disabled = false;
        sendCodeButton.textContent = "获取验证码";
      } else {
        sendCodeButton.textContent = `${left}s 后重发`;
      }
    }, 1000);
  }

  async function sendCode() {
    const phone = $("#authPhone").value.trim();
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      setNote("请输入 11 位有效手机号", "error");
      return;
    }
    sendCodeButton.disabled = true;
    sendCodeButton.textContent = "发送中…";
    try {
      const data = await api(AUTH_ENDPOINTS.sendCode, { phone, purpose: authTab });
      if (!data.ok) {
        setNote(data.error || "验证码发送失败", "error");
        sendCodeButton.disabled = false;
        sendCodeButton.textContent = "获取验证码";
        return;
      }
      // 开发模式：后端直接把验证码给回来，顺手填进输入框，省得手动抄
      if (data.dev_mode && data.code) {
        $("#authCode").value = data.code;
        setNote(`开发模式：验证码 ${data.code}（已验证，可直接继续）`, "ok");
      } else {
        setNote("验证码已发送，请查看短信", "ok");
      }
      startCountdown();
    } catch (error) {
      console.warn("验证码发送失败", error);
      setNote("网络异常，请稍后重试", "error");
      sendCodeButton.disabled = false;
      sendCodeButton.textContent = "获取验证码";
    }
  }

  /* ── 注册 / 登录提交 ── */
  async function submitAuth() {
    const phone = $("#authPhone").value.trim();
    const password = $("#authPassword").value;
    if (!/^1[3-9]\d{9}$/.test(phone)) { setNote("请输入 11 位有效手机号", "error"); return; }
    if (password.length < 6) { setNote("密码至少 6 位", "error"); return; }

    submitButton.disabled = true;
    submitButton.textContent = authTab === "register" ? "注册中…" : "登录中…";
    try {
      const payload = { phone, password };
      if (authTab === "register") {
        payload.code = $("#authCode").value.trim();
        payload.name = $("#authName").value.trim();
        if (!payload.code) {
          setNote("请先获取并填写验证码", "error");
          return;
        }
      }
      const data = await api(authTab === "register" ? AUTH_ENDPOINTS.register : AUTH_ENDPOINTS.login, payload);
      if (!data.ok) { setNote(data.error || "操作失败", "error"); return; }
      setToken(data.token);
      currentUser = data.user;
      renderUserCard();
      setNote(`登录成功，欢迎你，${currentUser.name}`, "ok");
      const backToSettings = authFromSettings;
      authFromSettings = false;
      setTimeout(() => {
        closeAuth();
        if (backToSettings) openSettings();     // 从设置里点进来的，登录完自动回到设置
      }, 700);
    } catch (error) {
      console.warn("登录失败", error);
      setNote("网络异常，请稍后重试", "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = authTab === "register" ? "注册并登录" : "登录";
    }
  }

  /* ── 个人信息保存 / 退出 ── */
  async function saveProfile() {
    if (!currentUser) { setProfileNote("请先登录", "error"); return; }
    const name = $("#profileNameInput").value.trim();
    if (!name) { setProfileNote("昵称不能为空", "error"); return; }
    const button = $("#profileSave");
    button.disabled = true;
    button.textContent = "保存中…";
    try {
      const data = await api(AUTH_ENDPOINTS.profile, { name, avatar: pendingAvatar });
      if (!data.ok) { setProfileNote(data.error || "保存失败", "error"); return; }
      currentUser = data.user;
      renderUserCard();
      renderSettings();
      setProfileNote("已保存", "ok");
    } catch (error) {
      console.warn("保存个人信息失败", error);
      setProfileNote("网络异常，请稍后重试", "error");
    } finally {
      button.disabled = false;
      button.textContent = "保存个人信息";
    }
  }

  async function logout() {
    try {
      await api(AUTH_ENDPOINTS.logout, { token: getToken() });
    } catch (error) {
      console.warn("退出登录请求失败（本地登录态已清除）", error);
    }
    clearToken();
    currentUser = null;
    pendingAvatar = "";
    renderUserCard();
    renderSettings();          // 保持设置里的表单状态与登录态一致
    closeAuth();
    closeSettings();
  }

  /* ── 上传头像：先压到 160×160 再转 data URL ── */
  function readAvatarFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("文件读取失败"));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error("这不是有效的图片"));
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = AUTH_AVATAR_SIZE;
          canvas.height = AUTH_AVATAR_SIZE;
          const context = canvas.getContext("2d");
          const scale = Math.max(AUTH_AVATAR_SIZE / image.width, AUTH_AVATAR_SIZE / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.drawImage(image, (AUTH_AVATAR_SIZE - width) / 2, (AUTH_AVATAR_SIZE - height) / 2, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.86));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── 事件绑定 ── */
  tabs?.querySelectorAll("[data-auth-tab]").forEach((item) => item.addEventListener("click", () => setTab(item.dataset.authTab)));
  $("#authClose")?.addEventListener("click", closeAuth);

  /* 点遮罩空白处关闭：必须「按下」和「松开」都发生在遮罩上才算。
     否则在卡片里选中文字、按住鼠标拖到卡片外面再松手时，浏览器会把这次操作
     当成点击遮罩（click 的 target 取按下与松手的公共祖先），弹窗就会莫名关掉。 */
  function bindMaskClose(element, close) {
    if (!element) return;
    let pressedOnMask = false;
    element.addEventListener("pointerdown", (event) => { pressedOnMask = event.target === element; });
    element.addEventListener("pointerup", (event) => {
      const shouldClose = pressedOnMask && event.target === element;
      pressedOnMask = false;
      if (shouldClose) close();
    });
    // 指针移出遮罩外松手 / 指针被取消，都要复位，避免残留状态影响下一次判断
    element.addEventListener("pointerleave", () => { pressedOnMask = false; });
    element.addEventListener("pointercancel", () => { pressedOnMask = false; });
  }
  bindMaskClose(mask, closeAuth);
  bindMaskClose(settingsMask, closeSettings);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (mask?.classList.contains("show")) closeAuth();
    if (settingsMask?.classList.contains("show")) closeSettings();
  });
  form?.addEventListener("submit", (event) => { event.preventDefault(); submitAuth(); });
  sendCodeButton?.addEventListener("click", sendCode);

  /* ── 设置弹窗 ── */
  $("#settingsClose")?.addEventListener("click", closeSettings);
  $("#settingsLogin")?.addEventListener("click", () => { authFromSettings = true; setTab(authTab); openAuth(); });
  $("#settingsLogout")?.addEventListener("click", logout);
  $("#profileSave")?.addEventListener("click", saveProfile);
  $("#profileAvatarBtn")?.addEventListener("click", () => $("#profileAvatarFile").click());
  $("#profileAvatarClear")?.addEventListener("click", () => {
    pendingAvatar = "";
    renderProfileAvatar();
    setProfileNote("已恢复默认头像，记得点保存", "ok");
  });
  $("#profileAvatarFile")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      pendingAvatar = await readAvatarFile(file);
      renderProfileAvatar();
      setProfileNote("头像已就绪，记得点保存", "ok");
    } catch (error) {
      setProfileNote(error.message || "头像读取失败", "error");
    } finally {
      event.target.value = "";
    }
  });

  wechatButton?.addEventListener("click", async () => {
    if (!wechatButton.dataset.ready) {
      setNote("微信登录未配置：需要 AppID/AppSecret + 已备案回调域名", "error");
      return;
    }
    try {
      const data = await api(AUTH_ENDPOINTS.wechat, {});
      if (!data.ok) setNote(data.error || "微信登录不可用", "error");
    } catch (error) {
      setNote("微信登录不可用", "error");
    }
  });

  /* ── 给 theme.js 用：菜单项的点击由这里接管 ── */
  window.authPointer = {
    open: openAuth,
    openSettings,
    logout,
    isLoggedIn: () => Boolean(currentUser),
    getUser: () => currentUser,
    handleMenuAction(action) {
      if (action === "个人设置" || action === "个人信息" || action === "我的账户") {
        openSettings();
        return true;
      }
      if (action === "登录 / 注册") {
        openAuth();
        return true;
      }
      if (action === "退出登录") {
        if (currentUser) logout();
        else window.themeHint?.("当前未登录");
        return true;
      }
      return false;
    },
  };

  /* ── 启动：先按本地令牌渲染一次，再向服务端确认 ── */
  function boot() {
    renderUserCard();
    refreshProviders();
    loadCurrentUser();
  }
  if (document.readyState === "loading") window.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
