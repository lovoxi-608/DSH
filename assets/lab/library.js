/* ═══════════════════════════════════════════════════════════════════════
   乐谱库 library.js
   · 首次进入用 samples/ 播种官方示例曲；之后全部读写 localStorage
   · 搜索 / 排序 / 上传（MIDI、两种 txt）/ 标签选择
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var D = window.DFH;
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function toast(t) {
    var box = $("#hkToast");
    if (!box) { box = document.createElement("div"); box.className = "hk-toast"; box.id = "hkToast"; document.body.appendChild(box); }
    box.textContent = t; box.classList.add("is-show");
    clearTimeout(box._t); box._t = setTimeout(function () { box.classList.remove("is-show"); }, 2600);
  }

  /* ───────── 列表渲染 ───────── */
  function statBlock(n, label) {
    return '<div class="hk-stat"><b>' + n + '</b><span>' + label + '</span></div>';
  }
  var favOnly = false;
  function render() {
    var q = $("#hkSearch").value.trim().toLowerCase();
    var sort = $("#hkSort").value;
    var list = D.Store.list().slice();
    if (favOnly) {
      var favs = D.Store.favs();
      list = list.filter(function (r) { return !!favs[r.id]; });
    }
    if (q) {
      list = list.filter(function (r) {
        var hay = [r.title, r.composer, r.uploader, (r.tags || []).join(" ")].join(" ").toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }
    list.sort(function (a, b) {
      if (sort === "notes") return b.noteCount - a.noteCount;
      if (sort === "downloads") return (b.downloads || 0) - (a.downloads || 0);
      if (sort === "likes") return (b.likes || 0) - (a.likes || 0);
      return b.createdAt - a.createdAt;
    });
    var box = $("#hkList");
    if (!list.length) {
      if (favOnly) {
        box.innerHTML = '<div class="hk-lib-empty"><h2>还没有收藏任何曲子</h2>' +
          '<p>在曲谱详情页点「♡ 收藏」，就会出现在这里。</p></div>';
      } else {
        box.innerHTML = '<div class="hk-lib-empty"><h2>曲谱库还是空的</h2>' +
          '<p>上传第一个 MIDI / txt 曲谱，或检查 samples/ 目录是否随站点一起部署。</p>' +
          '<button class="hk-btn hk-btn-primary" onclick="document.getElementById(\'hkUploadBtn\').click()">↑ 上传曲谱</button></div>';
      }
      return;
    }
    box.innerHTML = list.map(function (r) {
      var tags = (r.tags.length ? r.tags : ["未标注"]).map(function (t) {
        return '<span class="hk-tagchip">' + D.escapeHtml(t) + '</span>';
      }).join("");
      var likedCls = D.Store.isLiked(r.id) ? " is-on" : "";
      return '<div class="hk-score-row" data-id="' + r.id + '" title="点击在新窗口查看详情">' +
        '<button class="hk-score-row-main" type="button" data-open="1">' +
          '<span class="hk-kicker-2">SCORE</span>' +
          '<h3 class="hk-score-row-title">' + D.escapeHtml(r.title) + '</h3>' +
          '<p class="hk-score-row-author">' + D.escapeHtml(r.composer) + ' · ' + D.escapeHtml(r.uploader) + '</p>' +
          '<span class="hk-score-row-tags">' + tags + '</span>' +
        '</button>' +
        '<span class="hk-score-row-stats">' +
          '<span class="hk-stat hk-stat-like">' +
            '<span class="hk-like-line"><button class="hk-like-btn' + likedCls + '" type="button" data-like="1" title="点赞">♥</button><b>' + (r.likes || 0) + '</b></span>' +
            '<span>点赞</span>' +
          '</span>' +
          statBlock(r.noteCount, "音符") + statBlock(r.downloads || 0, "下载") +
        '</span>' +
      '</div>';
    }).join("");
    $$(".hk-score-row").forEach(function (row) {
      row.addEventListener("click", function (e) {
        if (e.target.closest && e.target.closest("[data-like]")) return;
        window.open("score.html?id=" + encodeURIComponent(row.dataset.id), "_blank");
      });
      var likeBtn = row.querySelector("[data-like]");
      if (likeBtn) likeBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        D.Store.toggleLike(row.dataset.id);
        likeBtn.classList.toggle("is-on", D.Store.isLiked(row.dataset.id));
        var b = row.querySelector(".hk-stat-like b");
        var rec = D.Store.get(row.dataset.id);
        if (b && rec) b.textContent = rec.likes || 0;
      });
      /* 管理员右键删除 */
      if (D.Admin && D.Admin.isAdmin()) {
        row.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          var rec = D.Store.get(row.dataset.id);
          if (!rec) return;
          if (rec.builtin && !(D.Admin && D.Admin.isOwner())) { toast("内置示例曲仅最高管理员可删除"); return; }
          if (confirm("删除曲谱「" + rec.title + "」？此操作不可恢复。")) {
            D.Store.remove(row.dataset.id);
            toast("已删除：" + rec.title);
            render();
          }
        });
        row.classList.add("is-admin-ctx");
      }
    });
  }

  /* ───────── 上传弹窗 ───────── */
  var up = { file: null, tags: {}, parsed: null, source: "" };

  function openUpload() {
    up = { file: null, tags: {}, parsed: null, source: "" };
    $("#hkUploadFile").value = "";
    $("#hkUpTitle").value = "";
    $("#hkUpComposer").value = "";
    $("#hkUpCustomTag").value = "";
    $("#hkUploadPreview").hidden = true;
    $("#hkUploadSubmit").disabled = true;
    renderTagPicker();
    var u = D.currentUser();
    if (u) $("#hkUpComposer").placeholder = "原作者 / 出处（投稿者将记为 " + u.name + "）";
    $("#hkUploadMask").classList.add("is-show");
  }
  function closeUpload() { $("#hkUploadMask").classList.remove("is-show"); }

  function renderTagPicker() {
    var box = $("#hkTagPicker");
    box.innerHTML = "";
    D.TAG_PRESETS.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hk-tag-opt" + (up.tags[t] ? " is-on" : "");
      b.textContent = t;
      b.addEventListener("click", function () {
        if (up.tags[t]) delete up.tags[t]; else up.tags[t] = 1;
        b.classList.toggle("is-on");
      });
      box.appendChild(b);
    });
  }

  function previewParsed() {
    var p = $("#hkUploadPreview");
    if (!up.parsed) { p.hidden = true; return; }
    var info;
    if (up.source === "midi") {
      var m = up.parsed;
      info = "✓ MIDI 解析成功：" + m.tracks.length + " 条音轨，默认选取旋律音符最多的音轨，BPM " + m.bpm + "，时长 " + D.formatClock(m.duration);
    } else {
      info = "✓ txt 解析成功：" + up.parsed.notes.length + " 个音符" + (up.parsed.bpm ? "，BPM " + up.parsed.bpm : "");
    }
    p.textContent = info; p.hidden = false;
    $("#hkUploadSubmit").disabled = false;
  }

  function handleFile(file) {
    var name = file.name || "";
    var lower = name.toLowerCase();
    var isMidi = /\.midi?$/.test(lower);
    var isTxt = /\.txt$/.test(lower);
    if (!isMidi && !isTxt) { toast("请选择 .mid / .midi / .txt 文件"); return; }
    up.file = file;
    $("#hkUpTitle").value = name.replace(/\.[^.]+$/, "");
    var reader = new FileReader();
    reader.onload = function () {
      try {
        if (isMidi) {
          up.parsed = D.parseMidi(reader.result);
          up.source = "midi";
          if (!up.parsed.tracks.some(function (t) { return t.notes.length; })) throw new Error("MIDI 中没有音符");
        } else {
          var text = D.decodeText ? D.decodeText(reader.result) : reader.result;
          var delta = D.isDeltaTxt(text);
          up.parsed = delta ? D.parseDeltaTxt(text) : D.parseNoteTxt(text);
          up.source = delta ? "delta" : "tuple";
          if (!up.parsed.notes.length) throw new Error("txt 中没有解析到音符");
        }
        previewParsed();
      } catch (err) {
        up.parsed = null; previewParsed();
        toast("解析失败：" + err.message);
      }
    };
    if (isMidi) reader.readAsArrayBuffer(file); else reader.readAsArrayBuffer(file);
  }

  function submitUpload() {
    if (!up.parsed) { toast("请先选择并成功解析文件"); return; }
    var title = $("#hkUpTitle").value.trim() || (up.file ? up.file.name.replace(/\.[^.]+$/, "") : "未命名曲目");
    var composer = $("#hkUpComposer").value.trim() || "未标注原作者";
    var user = D.currentUser();
    var uploader = user ? user.name : "匿名投稿者";
    var tags = Object.keys(up.tags);
    if (!tags.length) tags = ["未标注"];
    var rec;
    if (up.source === "midi") {
      rec = D.buildRecord({
        title: title, composer: composer, uploader: uploader, tags: tags,
        source: "midi", bpm: up.parsed.bpm, tracks: up.parsed.tracks, fold: true
      });
    } else {
      rec = D.buildRecord({
        title: title, composer: composer, uploader: uploader, tags: tags,
        source: up.source, bpm: up.parsed.bpm || 120, parsedTxt: up.parsed, fold: true
      });
    }
    D.Store.save(rec);
    closeUpload();
    render();
    toast("已发布到曲谱库：" + title);
  }

  /* ───────── 登录态 ───────── */
  function renderLogin() {
    var u = D.currentUser();
    $("#hkLogin").classList.toggle("is-in", !!u);
    var txt = $("#hkLoginText");
    if (D.Admin && D.Admin.setSession) D.Admin.setSession(u);
    if (!u) { if (txt) txt.textContent = "登录"; }
    else {
      var name = u.name || "用户";
      var idPart = u.phone ? u.phone.slice(-4) : "";
      if (txt) {
        var av = u.avatar ? '<i class="hk-avatar-mini"><img src="' + D.escapeHtml(u.avatar) + '" alt=""></i>' : '<i class="hk-avatar-mini">' + D.escapeHtml(name.slice(0, 1)) + '</i>';
        txt.innerHTML = av + D.escapeHtml(name + (idPart ? " #" + idPart : ""));
      }
    }
    syncAdminGear();
    if (D.Admin && D.Admin.__settingsRefresh) D.Admin.__settingsRefresh();
  }
  function syncAdminGear() {
    var gear = $("#hkAdminGear");
    if (!gear) return;
    gear.hidden = !(D.Admin && D.Admin.isAdmin());
    var hnav = gear.closest(".hk-nav");
    if (hnav) hnav.classList.toggle("has-admin", !gear.hidden);
  }

  /* ───────── 初始化 ───────── */
  function bind() {
    $("#hkSearch").addEventListener("input", render);
    $("#hkSort").addEventListener("change", render);
    var favsBtn = $("#hkFavsBtn");
    if (favsBtn) favsBtn.addEventListener("click", function () {
      favOnly = !favOnly;
      this.classList.toggle("is-on", favOnly);
      this.textContent = favOnly ? "♥ 我的收藏" : "♡ 我的收藏";
      render();
    });
    $("#hkUploadBtn").addEventListener("click", openUpload);
    $("#hkUploadClose").addEventListener("click", closeUpload);
    $("#hkUploadCancel").addEventListener("click", closeUpload);
    $("#hkUploadMask").addEventListener("click", function (e) { if (e.target === this) closeUpload(); });
    $("#hkUploadFile").addEventListener("change", function () { if (this.files[0]) handleFile(this.files[0]); });
    $("#hkUploadSubmit").addEventListener("click", submitUpload);
    $("#hkUpCustomTag").addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var v = this.value.trim();
        if (v && !up.tags[v]) { up.tags[v] = 1; this.value = ""; renderTagPicker(); }
      }
    });
    if (D.bindUserPop) D.bindUserPop();
    window.__hkOpenAdminPanel = openAdminPanel;
    D.onAuthChange(renderLogin);

  /* ───────── 管理员面板 ───────── */
  function adminNote(msg, kind) {
    var n = $("#hkAdminNote");
    if (!n) return;
    n.textContent = msg || "";
    n.className = "hk-admin-note" + (kind ? " is-" + kind : "");
  }
  function openAdminPanel() {
    var role = D.Admin && D.Admin.role();
    if (!role) return;
    $("#hkAdminRole").textContent = role === "owner" ? "最高管理员（可管理次级管理员）" : "次级管理员";
    $("#hkAdminAddBox").hidden = true;
    $("#hkAdminListBox").hidden = true;
    $("#hkAdminPhone").value = "";
    adminNote("");
    renderAdminList();
    var canManage = D.Admin.canManage();
    $("#hkAdminAddBtn").hidden = !canManage;
    $("#hkAdminListBtn").hidden = !canManage;
    if (!canManage) adminNote("当前为次级管理员，仅可删除曲谱");
    $("#hkAdminMask").classList.add("is-show");
  }
  function closeAdminPanel() { $("#hkAdminMask").classList.remove("is-show"); }
  function renderAdminList() {
    var box = $("#hkAdminList");
    if (!box) return;
    var subs = D.Admin.subs();
    if (!subs.length) { box.innerHTML = '<p class="hk-admin-empty">暂无次级管理员</p>'; return; }
    box.innerHTML = subs.map(function (ph) {
      return '<div class="hk-admin-item"><span>' + ph + '</span>' +
        '<button class="hk-btn hk-btn-stop hk-btn-sm" type="button" data-del="' + ph + '">删除</button></div>';
    }).join("");
    $$("#hkAdminList [data-del]").forEach(function (b) {
      b.addEventListener("click", function () {
        var ph = b.getAttribute("data-del");
        if (confirm("移除次级管理员 " + ph + " ？")) {
          D.Admin.removeSub(ph);
          toast("已移除：" + ph);
          renderAdminList();
        }
      });
    });
  }
  function bindAdmin() {
    var gear = $("#hkAdminGear");
    if (gear) gear.addEventListener("click", openAdminPanel);
    $("#hkAdminClose").addEventListener("click", closeAdminPanel);
    $("#hkAdminMask").addEventListener("click", function (e) { if (e.target === this) closeAdminPanel(); });
    $("#hkAdminAddBtn").addEventListener("click", function () {
      $("#hkAdminAddBox").hidden = false;
      $("#hkAdminListBox").hidden = true;
      adminNote("");
    });
    $("#hkAdminAddCancel").addEventListener("click", function () {
      $("#hkAdminAddBox").hidden = true;
    });
    $("#hkAdminAddOk").addEventListener("click", function () {
      var ph = $("#hkAdminPhone").value.trim();
      var res = D.Admin.addSub(ph);
      if (!res.ok) { adminNote(res.error, "error"); return; }
      toast("已添加次级管理员：" + ph);
      $("#hkAdminPhone").value = "";
      $("#hkAdminAddBox").hidden = true;
      adminNote("");
      renderAdminList();
    });
    $("#hkAdminListBtn").addEventListener("click", function () {
      $("#hkAdminListBox").hidden = false;
      $("#hkAdminAddBox").hidden = true;
      renderAdminList();
      adminNote("");
    });
  }
  bindAdmin();
  syncAdminGear();
  if (D.Admin && D.Admin.bindSettings) D.Admin.bindSettings();
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeUpload();
    });
  }

  bind();
  renderLogin();
  render();
  /* 从详情页齿轮进入时自动打开管理面板 */
  if (location.search.indexOf("admin=1") >= 0 && D.Admin && D.Admin.isAdmin()) {
    if (typeof openAdminPanel === "function") setTimeout(openAdminPanel, 300);
  }
  /* 首次播种官方示例（samples/ 取不到时静默跳过） */
  if (!D.Store.seeded()) {
    $("#hkList").innerHTML = '<div class="hk-lib-empty">正在初始化官方示例曲谱…</div>';
    D.seedLibrary(function (done, total, rec) {
      if (rec) console.log("seeded", rec.title);
    }).then(function () { render(); });
  }
})();
