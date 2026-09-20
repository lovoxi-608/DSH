/* ═══════════════════════════════════════════════════════════════════════════
   空间页（/space）：打开本机文件、记住位置、保存 / 调用
   ───────────────────────────────────────────────────────────────────────────
   用到的浏览器能力（Chromium 内核支持最好：Chrome / Edge / VS Code 内置浏览器）：
     fileHandle.getFile() / createWritable()  读写本机文件
     window.showDirectoryPicker()             选文件夹（写权限）
     window.showOpenFilePicker()              选单个文件
     IndexedDB                                记住「文件句柄」，下次免选
   不支持上述 API 时自动降级：input[webkitdirectory] 列表只读打开、保存变成下载副本。
   发给聊天页的「文件内容 / 图片」走 localStorage["mogao-space-payload"]，
   由 web/app.js 在加载时读取并挂成输入框附件（见 app.js 的 consumeSpacePayload）。
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  var DB_NAME = "mogao-space";
  var DB_STORE = "handles";
  var DIR_KEY = "space-dir";
  var PAYLOAD_KEY = "mogao-space-payload";

  var TEXT_EXT = [".txt", ".md", ".markdown", ".json", ".jsonl", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx",
    ".py", ".css", ".scss", ".less", ".html", ".htm", ".xml", ".yaml", ".yml", ".toml", ".csv", ".tsv",
    ".log", ".ini", ".cfg", ".conf", ".env", ".sh", ".bat", ".ps1", ".sql", ".java", ".c", ".h", ".cpp",
    ".hpp", ".go", ".rs", ".rb", ".php", ".vue", ".svelte"];
  var IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico", ".avif", ".apng"];

  var TEXT_WARN_BYTES = 1024 * 1024;          // 超过 1MB 提示会卡
  var TEXT_MAX_BYTES = 8 * 1024 * 1024;       // 超过 8MB 直接拒绝打开
  var SEND_TEXT_CHARS = 12000;                // 发送到对话的文本上限（与后端 ATTACH_TEXT_LIMIT 对应）
  var SEND_IMAGE_BYTES = 700 * 1024;          // 图片转 dataURL 的上限

  var state = {
    dir: null,
    fileHandle: null,
    file: null,          // 只读来源（拖入 / 降级选择）时保存 File 对象
    fileName: "",
    kind: "",            // "text" | "image" | ""
    fileSize: 0,
    dirty: false,
    objectUrl: "",
    mode: "local",       // "local" = 浏览器直连；"ai" = 服务端 AI 空间（模型也能读写）
    aiRoot: "",          // AI 空间根目录（绝对路径）
    aiRel: "",           // AI 空间当前子目录（相对）
    aiPath: "",          // 当前打开的 AI 空间文件（相对）
  };

  var el = {};
  function $(selector) { return document.querySelector(selector); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>'"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
    });
  }
  function extOf(name) {
    var index = String(name || "").lastIndexOf(".");
    return index >= 0 ? String(name).slice(index).toLowerCase() : "";
  }
  function isImageName(name) { return IMAGE_EXT.indexOf(extOf(name)) >= 0; }
  function isTextName(name) { return TEXT_EXT.indexOf(extOf(name)) >= 0; }
  function formatSize(bytes) {
    if (!bytes) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  }
  function setStatus(text, tone) {
    if (!el.status) return;
    el.status.textContent = text;
    el.status.classList.toggle("is-error", tone === "error");
    el.status.classList.toggle("is-ok", tone === "ok");
  }

  /* ── IndexedDB：把文件夹句柄存下来，下次直接调用 ───────────────────── */
  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("浏览器不支持 IndexedDB"));
      var request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }
  function idbGet(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readonly");
        var request = tx.objectStore(DB_STORE).get(key);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }
  function idbPut(key, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function idbDel(key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ── 权限：queryPermission 不弹窗；requestPermission 必须在用户点击时调用 ── */
  async function ensurePermission(handle, mode) {
    var options = { mode: mode || "readwrite" };
    try {
      if (typeof handle.queryPermission !== "function") return true;
      if ((await handle.queryPermission(options)) === "granted") return true;
      return (await handle.requestPermission(options)) === "granted";
    } catch (error) {
      return false;
    }
  }

  /* ── 位置（文件夹） ─────────────────────────────────────────────────── */
  async function activateDir(handle) {
    state.dir = handle;
    el.reconnect.hidden = true;
    el.loc.textContent = "📂 " + handle.name;
    el.loc.title = "当前使用的位置：" + handle.name;
    try { await idbPut(DIR_KEY, handle); } catch (error) { console.warn("位置保存失败", error); }
    await listDir();
  }

  async function restoreDir() {
    var handle = null;
    try { handle = await idbGet(DIR_KEY); } catch (error) { console.warn("位置读取失败", error); }
    if (!handle) {
      setStatus(window.showDirectoryPicker
        ? "还没有选择位置：点「选择文件夹」开始，或把文件夹直接拖进本页。"
        : "当前浏览器不支持写入本机文件夹，可以用「打开单个文件」或拖拽打开（只读）。");
      return;
    }
    state.dir = handle;
    el.loc.textContent = "📂 " + handle.name;
    el.loc.title = "上次使用的位置：" + handle.name;
    var granted = false;
    try { granted = (await handle.queryPermission({ mode: "readwrite" })) === "granted"; } catch (error) { granted = false; }
    if (granted) {
      await listDir();
      setStatus("已调用上次的位置：" + handle.name + "（不用重新选）", "ok");
      return;
    }
    el.reconnect.hidden = false;
    setStatus("上次的位置「" + handle.name + "」已记住，点「重新连接上次位置」授权一次即可直接调用。");
  }

  async function listDir() {
    if (!state.dir) return;
    var items = [];
    try {
      for await (var entry of state.dir.entries()) {
        var name = entry[0];
        var handle = entry[1];
        if (String(name).startsWith(".")) continue;
        if (handle.kind === "directory") {
          items.push({ name: name, kind: "dir", handle: handle, size: 0 });
          continue;
        }
        var size = 0;
        try { size = (await handle.getFile()).size; } catch (error) { size = 0; }
        items.push({ name: name, kind: "file", handle: handle, size: size });
      }
    } catch (error) {
      setStatus("读取文件夹失败：" + (error && error.message ? error.message : error), "error");
      return;
    }
    items.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    });
    renderList(items);
    el.count.textContent = items.length ? items.length + " 项" : "空文件夹";
  }

  function renderList(items) {
    if (!items.length) {
      el.list.innerHTML = '<div class="space-empty">这个文件夹里没有可显示的文件。</div>';
      return;
    }
    el.list.innerHTML = items.map(function (item, index) {
      var icon = item.kind === "dir" ? "📁" : (isImageName(item.name) ? "🖼" : (isTextName(item.name) ? "📄" : "📦"));
      return '<button class="space-file' + (item.kind === "dir" ? " is-dir" : "") + '" type="button" data-index="' + index + '">' +
        '<span class="f-icon">' + icon + "</span>" +
        '<span class="f-name">' + esc(item.name) + "</span>" +
        '<span class="f-size">' + (item.kind === "dir" ? "" : formatSize(item.size)) + "</span>" +
        "</button>";
    }).join("");
    el.list.querySelectorAll("[data-index]").forEach(function (button) {
      button.addEventListener("click", function () {
        var item = items[Number(button.dataset.index)];
        if (!item) return;
        el.list.querySelectorAll(".space-file").forEach(function (node) { node.classList.remove("active"); });
        button.classList.add("active");
        if (item.kind === "dir") activateDir(item.handle);
        else openHandle(item.handle, item.name, item.size);
      });
    });
  }

  /* ── 打开文件：有句柄可写回，只有 File 对象就只读 ───────────────────── */
  function markEditor(kind, name, size) {
    state.kind = kind;
    state.fileName = name || "";
    state.fileSize = size || 0;
    state.dirty = false;
    el.fileName.textContent = name || "未打开文件";
    el.badge.textContent = (kind === "image" ? "图片" : "文本") + " · " + formatSize(size || 0);
    el.save.disabled = kind !== "text";
    el.download.disabled = !name;
    el.send.disabled = !name;
  }

  async function openHandle(handle, name, size) {
    state.fileHandle = handle;
    state.file = null;
    state.aiPath = "";
    var kind = isImageName(name || handle.name) ? "image" : "text";
    try {
      var file = await handle.getFile();
      await openBlob(kind, name || handle.name, file);
    } catch (error) {
      setStatus("打开失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function openFile(file) {
    state.fileHandle = null;
    state.file = file;
    state.aiPath = "";
    var kind = isImageName(file.name) ? "image" : "text";
    await openBlob(kind, file.name, file);
    if (kind === "text") setStatus("已打开（只读）：" + file.name + "，编辑后点「下载副本」保存到本机。", "ok");
  }

  async function openBlob(kind, name, file) {
    if (kind === "image") {
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = URL.createObjectURL(file);
      el.image.src = state.objectUrl;
      el.imageWrap.hidden = false;
      el.text.hidden = true;
      markEditor("image", name, file.size);
      setStatus("图片预览：" + name + " · " + formatSize(file.size) + "（可「发送到对话」）", "ok");
      return;
    }
    if (file.size > TEXT_MAX_BYTES) {
      setStatus("文件太大（" + formatSize(file.size) + "），超过 8MB 不打开，避免浏览器卡住。", "error");
      return;
    }
    var text = await file.text();
    el.text.value = text;
    el.text.hidden = false;
    el.imageWrap.hidden = true;
    markEditor("text", name, file.size);
    setStatus("已打开：" + name + " · " + formatSize(file.size) +
      (file.size > TEXT_WARN_BYTES ? "（文件较大，编辑可能有点卡）" : ""), "ok");
  }

  /* ── 保存 / 下载 / 新建 / 发送到对话 ───────────────────────────────── */
  async function saveFile() {
    if (state.kind !== "text") return;
    if (state.mode === "ai" && state.aiPath) { await saveAiFile(); return; }
    var text = el.text.value;
    if (!state.fileHandle) {
      await saveBlobByPicker(new Blob([text], { type: "text/plain;charset=utf-8" }), state.fileName || "未命名.txt");
      return;
    }
    try {
      var granted = await ensurePermission(state.fileHandle, "readwrite");
      if (!granted) throw new Error("没有拿到读写权限");
      var writable = await state.fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      state.dirty = false;
      updateDirtyBadge();
      setStatus("已保存到本机：" + state.fileName, "ok");
    } catch (error) {
      setStatus("保存失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  function downloadBlob(blob, name) {
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name || "download";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  /* ── 保存到本机（统一入口）：点一下就弹「选择文件夹」对话框，写进你选的那个文件夹 ──
     与聊天页同一套交互；浏览器不支持 File System Access 时退回普通下载。
     ⚠ 必须在点击里最先调用，否则浏览器会以「不是用户点的」为由拒绝弹窗。 */
  async function pickFolderForSave() {
    if (typeof window.showDirectoryPicker !== "function") return "unsupported";
    try {
      return await window.showDirectoryPicker({ id: "mogao-save-folder", mode: "readwrite" });
    } catch (error) {
      if (error && error.name === "AbortError") return "cancelled";
      setStatus("选择文件夹失败：" + (error && error.message ? error.message : error), "error");
      return null;
    }
  }

  async function writeBlobToFolder(folder, blob, name) {
    try {
      var handle = await folder.getFileHandle(name || "download", { create: true });
      var writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("已保存到「" + folder.name + "」· " + (name || "download"), "ok");
      return true;
    } catch (error) {
      setStatus("写入失败：" + (error && error.message ? error.message : error), "error");
      return false;
    }
  }

  async function saveBlobByPicker(blob, name) {
    var folder = await pickFolderForSave();
    if (folder === "cancelled") return;
    if (folder === "unsupported" || folder === null) {
      downloadBlob(blob, name);
      setStatus("这个浏览器不支持选择文件夹，已改为默认下载位置保存", "ok");
      return;
    }
    await writeBlobToFolder(folder, blob, name);
  }

  async function newTextFile() {
    if (state.mode === "ai") {
      if (!state.aiRoot) { setStatus("先在左边粘贴文件夹路径并绑定 AI 空间，再新建文件。", "error"); return; }
      var aiName = prompt("新文件名（相对 AI 空间根目录，可带子目录）", "新建文本.md");
      if (!aiName) return;
      aiName = aiName.trim();
      if (!aiName) return;
      try {
        var data = await fetchJson("/api/space/write", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: aiName, content: "" }),
        });
        if (!data.ok) throw new Error(data.error || "新建失败");
        await listAiDir(state.aiRel);
        await openAiFile({ name: data.name, size: data.size, path: data.path });
        setStatus("已在 AI 空间新建：" + data.path + "，编辑后点「保存」。", "ok");
      } catch (error) {
        setStatus("新建失败：" + (error && error.message ? error.message : error), "error");
      }
      return;
    }
    if (!state.dir) {
      setStatus("先「选择文件夹」或拖入一个文件夹，再新建文件。", "error");
      return;
    }
    var name = prompt("新文件名（没有扩展名会自动补 .txt）", "新建文本.txt");
    if (!name) return;
    name = name.trim();
    if (!name) return;
    if (!extOf(name)) name += ".txt";
    try {
      var granted = await ensurePermission(state.dir, "readwrite");
      if (!granted) throw new Error("没有拿到读写权限");
      var handle = await state.dir.getFileHandle(name, { create: true });
      await listDir();
      await openHandle(handle, name, 0);
      setStatus("已新建：" + name + "，编辑后点「保存」写入本机。", "ok");
    } catch (error) {
      setStatus("新建失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error || new Error("读取失败")); };
      reader.readAsDataURL(file);
    });
  }

  async function sendToChat() {
    if (!state.fileName) return;
    try {
      var payload;
      var file = state.file || (state.fileHandle ? await state.fileHandle.getFile() : null);
      if (!file && state.mode === "ai" && state.aiPath && state.kind === "image") {
        // AI 空间的图片：从服务端拉一次字节，流程和浏览器直连保持一致
        var raw = await fetch(aiRawUrl(state.aiPath));
        if (!raw.ok) throw new Error("读取图片失败");
        var blob = await raw.blob();
        file = new File([blob], state.fileName || "space-image", { type: blob.type || "image/png" });
      }
      if (state.kind === "image") {
        if (!file) throw new Error("还没有打开图片");
        if (file.size > SEND_IMAGE_BYTES) {
          throw new Error("图片超过 " + formatSize(SEND_IMAGE_BYTES) + "，改用「把图片直接拖进聊天输入框」，会自动生成缩略图");
        }
        payload = { name: state.fileName, kind: "image", dataUrl: await readAsDataUrl(file), size: file.size };
      } else {
        var text = el.text.value;
        if (!text.trim()) throw new Error("文件内容是空的");
        payload = {
          name: state.fileName,
          kind: "text",
          text: text.slice(0, SEND_TEXT_CHARS),
          size: text.length,
          truncated: text.length > SEND_TEXT_CHARS,
        };
      }
      localStorage.setItem(PAYLOAD_KEY, JSON.stringify(payload));
      setStatus("已带上《" + state.fileName + "》，正在回到聊天页…", "ok");
      location.href = "/";
    } catch (error) {
      setStatus("发送到对话失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  /* ── AI 空间（服务端读写：聊天里的模型也用同一套接口看 / 写文件） ─────
     绑定后模型就能通过工具列出、读取、写入这个文件夹；
     它在聊天里写出的文件会以卡片形式出现，可从这里继续编辑。
     接口：/api/space/{state,root,list,read,write,raw}（见 web_app.py）。 ── */
  async function fetchJson(url, options) {
    var response = await fetch(url, options);
    return response.json();
  }

  function aiRawUrl(path, download) {
    return "/api/space/raw?path=" + encodeURIComponent(path || "") + (download ? "&download=1" : "");
  }

  var AI_HINT_DEFAULT = '浏览器拿不到「选择文件夹」的真实路径，所以这里需要<b>手动粘贴一次文件夹路径</b>' +
    '（在文件资源管理器地址栏复制即可）。绑定后，聊天里的 AI 就能列出、读取、写入这个文件夹，它保存的文件会以卡片出现在对话里。';

  async function refreshAiState() {
    try {
      var data = await fetchJson("/api/space/state");
      if (data.ok && data.root) {
        state.aiRoot = data.root;
        el.aiRootInput.value = data.root;
        el.aiHint.innerHTML = "已绑定：<b>" + esc(data.root) + "</b>" +
          (data.exists ? "" : "（路径现在不存在，请重新绑定）") +
          "。聊天里的 AI 可以直接列出、读取、写入这个文件夹，它保存的文件会以卡片出现在对话里。";
      } else {
        state.aiRoot = "";
        el.aiHint.innerHTML = AI_HINT_DEFAULT;
      }
    } catch (error) {
      setStatus("AI 空间状态读取失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function bindAiRoot() {
    var path = String(el.aiRootInput.value || "").trim();
    if (!path) { setStatus("先粘贴一个文件夹路径，例如 D:\\笔记", "error"); return; }
    try {
      var data = await fetchJson("/api/space/root", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path }),
      });
      if (!data.ok) throw new Error(data.error || "绑定失败");
      await refreshAiState();
      setSpaceMode("ai");
      setStatus("已绑定给 AI：" + data.root + "，现在聊天里就能直接读写它了。", "ok");
    } catch (error) {
      setStatus("绑定失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function unbindAiRoot() {
    try {
      await fetchJson("/api/space/root", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "" }),
      });
      await refreshAiState();
      if (state.mode === "ai") {
        el.list.innerHTML = '<div class="space-empty">已解除 AI 空间绑定。</div>';
        el.count.textContent = "未绑定";
      }
      setStatus("已解除 AI 空间绑定。", "ok");
    } catch (error) {
      setStatus("解除绑定失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function listAiDir(rel) {
    state.aiRel = rel || "";
    if (!state.aiRoot) {
      el.list.innerHTML = '<div class="space-empty">还没有绑定 AI 空间：在左边粘贴文件夹路径，点「绑定给 AI」。</div>';
      el.count.textContent = "未绑定";
      return;
    }
    try {
      var data = await fetchJson("/api/space/list?path=" + encodeURIComponent(state.aiRel));
      if (!data.ok) throw new Error(data.error || "读取失败");
      renderAiList(data.entries || [], state.aiRel);
      el.count.textContent = state.aiRel ? "📂 " + state.aiRel : "📂 根目录";
    } catch (error) {
      el.list.innerHTML = '<div class="space-empty">读取失败：' + esc(error && error.message ? error.message : error) + "</div>";
      setStatus("AI 空间读取失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  function renderAiList(items, rel) {
    var html = [];
    if (rel) {
      html.push('<button class="space-file is-dir" type="button" data-ai-up="1"><span class="f-icon">↩</span><span class="f-name">返回上一层</span><span class="f-size"></span></button>');
    }
    items.forEach(function (item, index) {
      var icon = item.kind === "dir" ? "📁" : (isImageName(item.name) ? "🖼" : (isTextName(item.name) ? "📄" : "📦"));
      html.push('<button class="space-file' + (item.kind === "dir" ? " is-dir" : "") + '" type="button" data-ai-index="' + index + '">' +
        '<span class="f-icon">' + icon + '</span>' +
        '<span class="f-name">' + esc(item.name) + '</span>' +
        '<span class="f-size">' + (item.kind === "dir" ? "" : formatSize(item.size)) + "</span>" +
        "</button>");
    });
    el.list.innerHTML = html.length ? html.join("") : '<div class="space-empty">这个文件夹是空的。</div>';
    el.list.querySelectorAll("[data-ai-up]").forEach(function (button) {
      button.addEventListener("click", function () {
        var parts = state.aiRel.split("/");
        parts.pop();
        listAiDir(parts.join("/"));
      });
    });
    el.list.querySelectorAll("[data-ai-index]").forEach(function (button) {
      button.addEventListener("click", function () {
        var item = items[Number(button.dataset.aiIndex)];
        if (!item) return;
        el.list.querySelectorAll(".space-file").forEach(function (node) { node.classList.remove("active"); });
        button.classList.add("active");
        if (item.kind === "dir") listAiDir(item.path);
        else openAiFile(item);
      });
    });
  }

  async function openAiFile(item) {
    state.fileHandle = null;
    state.file = null;
    state.aiPath = item.path;
    var kind = isImageName(item.name) ? "image" : "text";
    if (kind === "image") {
      if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = "";
      el.image.src = aiRawUrl(item.path);
      el.imageWrap.hidden = false;
      el.text.hidden = true;
      markEditor("image", item.name, item.size);
      setStatus("图片预览（AI 空间）：" + item.name, "ok");
      return;
    }
    try {
      var data = await fetchJson("/api/space/read?path=" + encodeURIComponent(item.path));
      if (!data.ok) throw new Error(data.error || "读取失败");
      el.text.value = data.text;
      el.text.hidden = false;
      el.imageWrap.hidden = true;
      markEditor("text", item.name, data.size);
      state.aiPath = data.path;
      setStatus("已打开（AI 空间）：" + data.path + (data.truncated ? "（内容过长，只显示了一部分）" : ""), "ok");
    } catch (error) {
      setStatus("打开失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function saveAiFile() {
    if (!state.aiPath) return;
    try {
      var data = await fetchJson("/api/space/write", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: state.aiPath, content: el.text.value }),
      });
      if (!data.ok) throw new Error(data.error || "保存失败");
      state.dirty = false;
      state.fileSize = data.size;
      updateDirtyBadge();
      setStatus("已保存到 AI 空间：" + data.path, "ok");
    } catch (error) {
      setStatus("保存失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  function setSpaceMode(mode) {
    state.mode = mode === "ai" ? "ai" : "local";
    document.querySelectorAll("[data-space-mode]").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.spaceMode === state.mode);
    });
    if (state.mode === "ai") {
      listAiDir(state.aiRel || "");
      return;
    }
    if (state.dir) {
      listDir();
    } else {
      el.count.textContent = "未选择位置";
      el.list.innerHTML = '<div class="space-empty">还没有选择位置。点左边的「选择文件夹」，或把文件 / 文件夹直接拖到本页。</div>';
    }
  }

  /* ── 选择位置 / 文件的入口（含降级） ───────────────────────────────── */
  async function pickDir() {
    if (!window.showDirectoryPicker) { el.dirInput.click(); return; }
    try {
      var handle = await window.showDirectoryPicker({ id: "mogao-space", mode: "readwrite" });
      await activateDir(handle);
      setStatus("已选择位置：" + handle.name + "，下次打开本页会自动调用（可能要点一次授权）。", "ok");
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setStatus("选择文件夹失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function pickFile() {
    if (!window.showOpenFilePicker) { el.fileInput.click(); return; }
    try {
      var handles = await window.showOpenFilePicker({ multiple: false });
      if (handles && handles[0]) {
        await openHandle(handles[0], handles[0].name, 0);
        setStatus("已打开：" + handles[0].name, "ok");
      }
    } catch (error) {
      if (error && error.name === "AbortError") return;
      setStatus("打开文件失败：" + (error && error.message ? error.message : error), "error");
    }
  }

  async function forgetDir() {
    try { await idbDel(DIR_KEY); } catch (error) { console.warn("删除位置失败", error); }
    state.dir = null;
    el.reconnect.hidden = true;
    el.loc.textContent = "未选择位置";
    el.loc.title = "当前使用的位置";
    el.count.textContent = "未选择位置";
    el.list.innerHTML = '<div class="space-empty">已忘记上次的位置。点「选择文件夹」重新开始。</div>';
    setStatus("已忘记这个位置。");
  }

  function updateDirtyBadge() {
    if (!state.fileName) return;
    el.badge.textContent = (state.kind === "image" ? "图片" : "文本") + " · " + formatSize(state.fileSize) + (state.dirty ? " · 未保存" : "");
  }

  /* ── 拖拽：文件夹会成为当前位置，文件直接打开 ──────────────────────── */
  function dragHasFiles(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    return types ? Array.prototype.indexOf.call(types, "Files") >= 0 : false;
  }

  async function handleDrop(event) {
    var dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    var handles = [];
    var files = [];
    var items = dataTransfer.items ? Array.prototype.slice.call(dataTransfer.items) : [];
    for (var index = 0; index < items.length; index++) {
      var item = items[index];
      if (item.kind !== "file") continue;
      if (typeof item.getAsFileSystemHandle === "function") handles.push({ at: index, promise: item.getAsFileSystemHandle() });
      else files.push({ at: index, promise: Promise.resolve(item.getAsFile()) });
    }
    var results = await Promise.all(handles.concat(files).map(function (entry) {
      return entry.promise.then(function (value) { return { at: entry.at, value: value }; }).catch(function () { return { at: entry.at, value: null }; });
    }));
    results.sort(function (a, b) { return a.at - b.at; });
    for (var cursor = 0; cursor < results.length; cursor++) {
      var value = results[cursor].value;
      if (!value) continue;
      if (value.kind === "directory") {
        state.dir = value;
        await activateDir(value);
        setStatus("已把拖入的文件夹设为当前位置：" + value.name, "ok");
        return;
      }
      await openHandle(value, value.name, 0);
      setStatus("已打开拖入的文件：" + value.name, "ok");
      return;
    }
    var plain = dataTransfer.files && dataTransfer.files[0];
    if (plain) {
      await openFile(plain);
      setStatus("已打开拖入的文件（只读）：" + plain.name, "ok");
    }
  }

  /* ── 初始化 ─────────────────────────────────────────────────────────── */
  window.addEventListener("DOMContentLoaded", async function () {
    el.loc = $("#spaceLoc");
    el.hint = $("#spaceHint");
    el.list = $("#spaceFileList");
    el.count = $("#spaceCount");
    el.fileName = $("#spaceFileName");
    el.badge = $("#spaceFileBadge");
    el.text = $("#spaceText");
    el.imageWrap = $("#spaceImageWrap");
    el.image = $("#spaceImagePreview");
    el.status = $("#spaceStatus");
    el.save = $("#spaceSave");
    el.download = $("#spaceDownload");
    el.send = $("#spaceSend");
    el.reconnect = $("#spaceReconnect");
    el.dirInput = $("#spaceDirInput");
    el.fileInput = $("#spaceFileInput");
    el.aiRootInput = $("#spaceAiRoot");
    el.aiHint = $("#spaceAiHint");

    document.documentElement.dataset.theme = localStorage.getItem("mogao-theme") || "jiangnan";
    var logo = $("#spaceLogo");
    if (logo) logo.src = (typeof BRAND_LOGO_SRC !== "undefined" && BRAND_LOGO_SRC) ? BRAND_LOGO_SRC : "/assets/brand/deepseek.png";

    $("#spacePickDir").addEventListener("click", pickDir);
    $("#spacePickFile").addEventListener("click", pickFile);
    $("#spaceNewFile").addEventListener("click", newTextFile);
    $("#spaceForget").addEventListener("click", forgetDir);
    $("#spaceAiBind").addEventListener("click", bindAiRoot);
    $("#spaceAiUnbind").addEventListener("click", unbindAiRoot);
    document.querySelectorAll("[data-space-mode]").forEach(function (button) {
      button.addEventListener("click", function () { setSpaceMode(button.dataset.spaceMode); });
    });
    el.aiRootInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter") { event.preventDefault(); bindAiRoot(); }
    });
    el.save.addEventListener("click", saveFile);
    el.send.addEventListener("click", sendToChat);
    el.download.addEventListener("click", async function () {
      /* 下载副本 = 选一个文件夹存进去（AI 空间里的文件先从服务端抓内容） */
      if (state.mode === "ai" && state.aiPath) {
        var folder = await pickFolderForSave();
        if (folder === "cancelled") return;
        try {
          var response = await fetch(aiRawUrl(state.aiPath, false));
          if (!response.ok) throw new Error("HTTP " + response.status);
          var blob = await response.blob();
          if (folder === "unsupported" || folder === null) {
            downloadBlob(blob, state.fileName || "download");
            setStatus("这个浏览器不支持选择文件夹，已改为默认下载位置保存", "ok");
            return;
          }
          await writeBlobToFolder(folder, blob, state.fileName || "download");
        } catch (error) {
          setStatus("下载失败：" + (error && error.message ? error.message : error), "error");
        }
        return;
      }
      if (state.kind === "image" && state.file) { await saveBlobByPicker(state.file, state.fileName); return; }
      await saveBlobByPicker(new Blob([el.text.value], { type: "text/plain;charset=utf-8" }), state.fileName || "未命名.txt");
    });
    el.reconnect.addEventListener("click", async function () {
      if (!state.dir) return;
      var granted = await ensurePermission(state.dir, "readwrite");
      if (!granted) { setStatus("没有拿到授权，无法调用这个位置。", "error"); return; }
      el.reconnect.hidden = true;
      await listDir();
      setStatus("已重新连接：" + state.dir.name, "ok");
    });
    el.text.addEventListener("input", function () {
      state.dirty = true;
      updateDirtyBadge();
    });
    el.text.addEventListener("keydown", function (event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveFile();
      }
    });
    el.dirInput.addEventListener("change", function () {
      var files = Array.prototype.slice.call(el.dirInput.files || []);
      if (!files.length) return;
      state.dir = null;
      el.reconnect.hidden = true;
      var folder = (files[0].webkitRelativePath || "").split("/")[0] || "（只读文件夹）";
      el.loc.textContent = "🖿 " + folder;
      el.count.textContent = files.length + " 项";
      el.list.innerHTML = files.map(function (file, index) {
        return '<button class="space-file" type="button" data-fallback="' + index + '">' +
          '<span class="f-icon">' + (isImageName(file.name) ? "🖼" : "📄") + "</span>" +
          '<span class="f-name">' + esc(file.name) + "</span>" +
          '<span class="f-size">' + formatSize(file.size) + "</span></button>";
      }).join("");
      el.list.querySelectorAll("[data-fallback]").forEach(function (button) {
        button.addEventListener("click", async function () {
          await openFile(files[Number(button.dataset.fallback)]);
        });
      });
      setStatus("当前浏览器不支持写入本机文件夹，这个列表是只读的（保存会变成下载副本）。");
    });
    el.fileInput.addEventListener("change", async function () {
      var file = (el.fileInput.files || [])[0];
      if (file) await openFile(file);
    });

    if (!window.showDirectoryPicker) {
      el.hint.classList.add("is-warn");
      setStatus("当前浏览器不支持 File System Access API：可用「打开单个文件」或拖拽（只读）。");
    }

    document.addEventListener("dragover", function (event) {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      document.body.classList.add("space-dragging");
    });
    document.addEventListener("dragleave", function (event) {
      if (event.relatedTarget) return;
      document.body.classList.remove("space-dragging");
    });
    document.addEventListener("drop", function (event) {
      if (!dragHasFiles(event)) return;
      event.preventDefault();
      document.body.classList.remove("space-dragging");
      handleDrop(event).catch(function (error) {
        setStatus("拖入处理失败：" + (error && error.message ? error.message : error), "error");
      });
    });

    await restoreDir();
    await refreshAiState();
    // 已绑定 AI 空间就默认看它（模型读写的就是这个文件夹），否则先看本机位置
    setSpaceMode(state.aiRoot ? "ai" : "local");
    if (state.aiRoot) setStatus("AI 空间已连接：" + state.aiRoot + "，聊天里的 AI 也能读写这里。", "ok");
  });
})();
