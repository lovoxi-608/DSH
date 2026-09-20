/* ═══════════════════════════════════════════════════════════════════════
   曲谱详情 score.js
   卡片 1：作品信息 / 标签 / 收藏 / 分享
   卡片 2：总音符数 / 时长等统计
   卡片 3：演奏预览（迷你卷帘 + 试听）
   卡片 4：当前曲谱（键位序列）
   卡片 5：保存 txt / midi
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var D = window.DFH;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  function toast(t) {
    var box = $("#hkToast");
    if (!box) { box = document.createElement("div"); box.className = "hk-toast"; box.id = "hkToast"; document.body.appendChild(box); }
    box.textContent = t; box.classList.add("is-show");
    clearTimeout(box._t); box._t = setTimeout(function () { box.classList.remove("is-show"); }, 2600);
  }

  var id = new URLSearchParams(location.search).get("id");
  var rec = id ? D.Store.get(id) : null;
  var body = $("#hkDetailBody");

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
    if (D.Admin && D.Admin.__settingsRefresh) D.Admin.__settingsRefresh();
  }
  if (D.bindUserPop) D.bindUserPop();
  function syncAdminGear() {
    var gear = $("#hkAdminGear");
    if (!gear) return;
    gear.hidden = !(D.Admin && D.Admin.isAdmin());
    var hnav = gear.closest(".hk-nav");
    if (hnav) hnav.classList.toggle("has-admin", !gear.hidden);
  }
  var gearEl = $("#hkAdminGear");
  if (gearEl) gearEl.addEventListener("click", function () {
    location.href = "library.html?admin=1";
  });
  D.onAuthChange(function () { renderLogin(); syncAdminGear(); });
  if (D.Admin && D.Admin.bindSettings) D.Admin.bindSettings();
  syncAdminGear();
  renderLogin();

  if (!rec) {
    body.innerHTML = '<section class="hk-card hk-lib-empty">' +
      '<h2>找不到这首曲谱</h2><p>它可能还没有上传到这台设备的本地曲库。</p>' +
      '<p><a class="hk-btn hk-btn-primary" href="library.html">返回曲谱库</a></p></section>';
    return;
  }
  document.title = rec.title + " · updream 口琴谱";

  var sourceLabel = rec.source === "midi" ? "MIDI 音轨" : rec.source === "delta" ? "三角洲节拍谱 txt" : "约定格式 txt";
  var shortId = String(rec.id).slice(-10);

  /* ═══════════ 卡片 1：作品信息 + 收藏 / 分享 ═══════════ */
  var tagsHtml = (rec.tags.length ? rec.tags : ["未标注"])
    .map(function (t) { return '<span class="hk-tagchip">' + D.escapeHtml(t) + '</span>'; }).join("");

  body.innerHTML =
    '<section class="hk-card">' +
      '<div class="hk-detail-head">' +
        '<div>' +
          '<div class="hk-kicker-2">PUBLIC SCORE / ' + D.escapeHtml(shortId) + '</div>' +
          '<h1 class="hk-detail-title">' + D.escapeHtml(rec.title) + '</h1>' +
          '<p class="hk-detail-author">' + D.escapeHtml(rec.composer) + ' · 投稿者 ' + D.escapeHtml(rec.uploader) + '</p>' +
          '<div class="hk-score-row-tags">' + tagsHtml + '</div>' +
        '</div>' +
        '<div class="hk-detail-actions">' +
          '<button class="hk-btn" id="btnShare" type="button">分享</button>' +
          '<button class="hk-btn" id="btnQr" type="button">二维码分享</button>' +
          '<button class="hk-btn" id="btnFav" type="button">♡ 收藏</button>' +
          '<button class="hk-btn" id="btnArchive" type="button">保存到云存档</button>' +
          '<a class="hk-btn" href="library.html">返回曲库</a>' +
          '<button class="hk-btn hk-btn-stop" id="btnDel" type="button" hidden>删除</button>' +
        '</div>' +
      '</div>' +
    '</section>' +

    /* ═══════════ 卡片 2：统计 ═══════════ */
    '<section class="hk-card">' +
      '<div class="hk-card-title"><span>曲谱信息</span>' +
        '<button class="hk-btn hk-btn-ghost" id="btnLike" type="button">♡ 点赞 <b id="likeNum">0</b></button>' +
      '</div>' +
      '<div class="hk-stat-grid">' +
        '<div class="hk-stat-tile"><b>' + rec.noteCount + '</b><span>总音符数</span></div>' +
        '<div class="hk-stat-tile"><b>' + D.formatClock(rec.duration) + '</b><span>总时长</span></div>' +
        '<div class="hk-stat-tile"><b>' + (rec.bpm || "—") + '</b><span>BPM</span></div>' +
        '<div class="hk-stat-tile"><b>' + rec.playableCount + '</b><span>可演奏音符</span></div>' +
      '</div>' +
      '<p class="hk-warn">来源：' + sourceLabel + ' · 基准八度 C' + rec.baseOct +
        (rec.foldedCount ? ' · 八度折叠 ' + rec.foldedCount + ' 音' : '') +
        (rec.chordSkipped ? ' · 简化和弦/重叠 ' + rec.chordSkipped + ' 处' : '') + '</p>' +
    '</section>' +

    /* ═══════════ 卡片 3：演奏预览 ═══════════ */
    '<section class="hk-card">' +
      '<div class="hk-card-title"><span>演奏预览</span><span class="hk-card-hint">真实口琴采样试听 · 金线为播放位置</span></div>' +
      '<div class="hk-roll" id="pvRoll" style="height:150px"><svg id="pvSvg" preserveAspectRatio="none"></svg></div>' +
      '<div class="hk-preview-bar">' +
        '<button class="hk-btn hk-btn-primary" id="pvPlay" type="button">▶ 播放试听</button>' +
        '<button class="hk-btn hk-btn-stop" id="pvStop" type="button">■ 停止</button>' +
        '<label class="hk-rig-vol">音量 <input type="range" id="pvVol" min="0" max="100" value="20"> <span id="pvVolVal">20%</span></label>' +
        '<span class="hk-preview-time"><span id="pvCur">00:00.000</span> / <span id="pvDur">00:00.000</span></span>' +
      '</div>' +
    '</section>' +

    /* ═══════════ 卡片 4：当前曲谱 ═══════════ */
    '<section class="hk-card">' +
      '<div class="hk-card-title"><span>当前曲谱（三角洲口琴键位）</span>' +
        '<span class="hk-card-hint">左键低八度 · 右键高八度 · 中键升半音</span></div>' +
      '<div class="hk-score-chips" id="pvChips"></div>' +
      '<div class="hk-legend">' +
        '<span><i style="background:#8dd8c8"></i>基准</span>' +
        '<span><i style="background:#5a8fd6"></i>低八度（左键）</span>' +
        '<span><i style="background:#6fc7b5"></i>高八度（右键）</span>' +
        '<span><i style="background:#b07cd8"></i>升半音（中键）</span>' +
        '<span><i style="background:#5a6b86"></i>超出范围（跳过）</span>' +
      '</div>' +
    '</section>' +

    /* ═══════════ 卡片 5：保存 ═══════════ */
    '<section class="hk-card">' +
      '<div class="hk-card-title"><span>保存曲谱</span></div>' +
      '<p class="hk-dl-desc">txt 为约定的「简谱·持续·间隔」编排格式，可直接导入口琴助手；MIDI 为标准 SMF 文件，可在任意编曲软件打开。</p>' +
      '<div class="hk-dl-grid">' +
        '<a class="hk-btn hk-btn-primary" id="dlTxt" href="#">⬇ 保存 txt（编排曲谱）</a>' +
        '<a class="hk-btn hk-btn-primary" id="dlMidi" href="#">⬇ 保存 MIDI（.mid）</a>' +
      '</div>' +
    '</section>';

  /* ───────── 收藏 / 点赞 / 云存档 ───────── */
  function syncButtons() {
    var fav = D.Store.isFav(rec.id), arc = D.Store.isArchived(rec.id), liked = D.Store.isLiked(rec.id);
    $("#btnFav").classList.toggle("is-on", fav);
    $("#btnFav").textContent = fav ? "♥ 已收藏" : "♡ 收藏";
    $("#btnArchive").classList.toggle("is-on", arc);
    $("#btnArchive").textContent = arc ? "✓ 已在云存档" : "保存到云存档";
    $("#btnLike").classList.toggle("is-on", liked);
    $("#likeNum").textContent = rec.likes || 0;
  }
  $("#btnFav").addEventListener("click", function () {
    toast(D.Store.toggleFav(rec.id) ? "已收藏" : "已取消收藏"); syncButtons();
  });
  var delBtn = $("#btnDel");
  if (delBtn) {
    var syncDel = function () { delBtn.hidden = !(D.Admin && D.Admin.isAdmin()); };
    syncDel();
    window.addEventListener("authchange", syncDel);
    delBtn.addEventListener("click", function () {
      if (rec.builtin && !(D.Admin && D.Admin.isOwner())) { toast("内置示例曲仅最高管理员可删除"); return; }
      if (confirm("删除曲谱「" + rec.title + "」？此操作不可恢复。")) {
        D.Store.remove(rec.id);
        toast("已删除：" + rec.title);
        setTimeout(function () { location.href = "library.html"; }, 900);
      }
    });
  }
  $("#btnArchive").addEventListener("click", function () {
    toast(D.Store.toggleArchive(rec.id) ? "已保存到云存档（本机）" : "已从云存档移除"); syncButtons();
  });
  $("#btnLike").addEventListener("click", function () {
    D.Store.toggleLike(rec.id); rec = D.Store.get(rec.id); syncButtons();
  });
  syncButtons();

  /* ───────── 分享 / 二维码 ───────── */
  function copyLink() {
    var url = location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { toast("分享链接已复制"); }, function () { prompt("复制此链接分享：", url); });
    } else { prompt("复制此链接分享：", url); }
  }
  $("#btnShare").addEventListener("click", copyLink);
  $("#btnQr").addEventListener("click", function () {
    var url = location.href;
    $("#hkQrUrl").textContent = url;
    var img = $("#hkQrImg"), fail = $("#hkQrFail");
    fail.hidden = true;
    img.style.display = ""; img.hidden = false;
    img.src = "https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=" + encodeURIComponent(url);
    img.onerror = function () {
      img.hidden = true; fail.hidden = false;
    };
    /* 6 秒还没加载出来也降级（离线环境） */
    clearTimeout(img._t);
    img._t = setTimeout(function () { if (!img.naturalWidth) { img.hidden = true; fail.hidden = false; } }, 6000);
    $("#hkQrMask").classList.add("is-show");
  });
  $("#hkQrClose").addEventListener("click", function () { $("#hkQrMask").classList.remove("is-show"); });
  $("#hkQrMask").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("is-show"); });
  $("#hkQrCopy").addEventListener("click", copyLink);

  /* ───────── 下载 ───────── */
  $("#dlTxt").addEventListener("click", function (e) {
    e.preventDefault();
    D.Store.incDownload(rec.id);
    D.downloadText(rec.title + ".txt", rec.scoreText);
    toast("已保存 txt");
  });
  $("#dlMidi").addEventListener("click", function (e) {
    e.preventDefault();
    D.Store.incDownload(rec.id);
    var notes = rec.melody.filter(function (n) { return n.inRange; });
    if (!notes.length) notes = rec.melody;
    var bytes = D.buildMidi(notes, { bpm: rec.bpm || 120, trackName: rec.title });
    D.downloadBytes(rec.title + ".mid", bytes);
    toast("已保存 MIDI");
  });

  /* ═══════════ 卡片 4：曲谱 chips ═══════════ */
  function renderChips() {
    var box = $("#pvChips");
    box.innerHTML = rec.melody.map(function (n, i) {
      var cls = "hk-chip";
      if (!n.inRange) cls += " is-skip";
      else if (n.sharp) cls += " is-sharp";
      else if (n.slot === -1) cls += " is-low";
      else if (n.slot === 1 || n.slot === 2) cls += " is-high";
      var ch = n.inRange ? (n.key === "," ? "，" : n.key.toUpperCase()) : "—";
      var lb = n.inRange ? D.modInfo(n.slot, n.sharp).label : "跳过";
      return '<span class="' + cls + '" data-idx="' + i + '" title="' + D.pitchName(n.midi) + '"><b>' +
        ch + '</b><i>' + lb + '</i></span>';
    }).join("");
  }
  renderChips();

  /* ═══════════ 卡片 3：迷你卷帘 + 试听 ═══════════ */
  var PV = { playing: false, raf: 0, ctx0: 0, idx: 0, seek: 0 };
  function pvGeom() {
    var el = $("#pvRoll");
    var W = el.clientWidth, H = el.clientHeight;
    var padL = 34, padB = 16;
    var d = Math.max(1, rec.duration);
    var pxps = 40;  /* 固定 40px/秒，长曲不压缩 */
    var lo = 127, hi = 0;
    rec.melody.forEach(function (n) { if (n.midi < lo) lo = n.midi; if (n.midi > hi) hi = n.midi; });
    lo = Math.floor((lo - 2) / 12) * 12; hi = Math.ceil((hi + 3) / 12) * 12;
    var rows = hi - lo, rowH = (H - padB) / rows;
    return { W: W, H: H, padL: padL, padB: padB, pxps: pxps, lo: lo, hi: hi, rowH: rowH, d: d };
  }
  function renderPvRoll() {
    var g = pvGeom(), svg = $("#pvSvg");
    var contentW = Math.max(g.W, g.padL + g.d * g.pxps + 6);
    svg.setAttribute("viewBox", "0 0 " + contentW + " " + g.H);
    svg.setAttribute("width", contentW);
    var html = "";
    for (var m = g.lo; m <= g.hi; m++) {
      var y = g.H - g.padB - (m - g.lo) * g.rowH;
      var pc = D.mod12(m);
      if ([1, 3, 6, 8, 10].indexOf(pc) >= 0)
        html += '<rect x="' + g.padL + '" y="' + y + '" width="' + (contentW - g.padL) + '" height="' + g.rowH + '" fill="rgba(255,255,255,.025)"/>';
      if (pc === 0 || pc === 5 || pc === 7)
        html += '<text class="hk-rowlabel" x="3" y="' + (y + g.rowH * .7) + '">' + D.pitchName(m) + '</text>';
    }
    rec.melody.forEach(function (n) {
      var x = g.padL + n.start * g.pxps;
      var w = Math.max(3, n.dur * g.pxps - 1);
      var y = g.H - g.padB - (n.midi - g.lo + .85) * g.rowH;
      var h = Math.max(3, g.rowH * .72);
      var cls = "hk-note-rect" + (!n.inRange ? " is-skip" : n.folded ? " is-fold" : "");
      html += '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
    });
    html += '<line class="hk-playhead" id="pvHead" x1="' + g.padL + '" y1="0" x2="' + g.padL + '" y2="' + (g.H - g.padB) + '"/>';
    svg.innerHTML = html;
    $("#pvDur").textContent = D.formatTime(rec.duration);
  }
  function pvUpdateHead() {
    var g = pvGeom(), line = $("#pvHead");
    if (!line) return;
    var x = g.padL + PV.seek * g.pxps;
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    $("#pvCur").textContent = D.formatTime(PV.seek);
    /* 自动右滚：播放头越过容器右半区时跟随滚动 */
    var roll = $("#pvRoll");
    if (roll) {
      var maxScroll = roll.scrollWidth - roll.clientWidth;
      var target = x - roll.clientWidth * 0.45;
      if (target > roll.scrollLeft && maxScroll > 0) roll.scrollLeft = Math.min(target, maxScroll);
    }
  }
  function pvStop(silent) {
    PV.playing = false;
    if (PV.raf) cancelAnimationFrame(PV.raf);
    PV.raf = 0;
    D.audio.stop();
    $$("#pvChips .hk-chip").forEach(function (c) { c.classList.remove("is-cur"); });
    $("#pvPlay").disabled = false;
    if (!silent) PV.seek = 0;
    pvUpdateHead();
  }
  /* 切屏：页面隐藏时暂停（保留进度），回到页面时从暂停处继续 */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (PV.playing) { PV.wasPlaying = true; pvStop(true); }
    } else {
      if (PV.wasPlaying) { PV.wasPlaying = false; pvPlay(); }
    }
  });
  function pvPlay() {
    D.audio.ensure(); D.audio.loadSounds();
    pvStop(true, true);
    if (PV.seek >= rec.duration - .05) PV.seek = 0;
    PV.playing = true;
    var ctx = D.audio.ensure();
    PV.ctx0 = ctx.currentTime - PV.seek;
    PV.idx = rec.melody.findIndex(function (n) { return n.start >= PV.seek - .02; });
    if (PV.idx < 0) PV.idx = 0;
    $("#pvPlay").disabled = true;
    (function tick() {
      if (!PV.playing) return;
      var now = D.audio.ensure().currentTime;
      while (PV.idx < rec.melody.length) {
        var n = rec.melody[PV.idx];
        var when = PV.ctx0 + n.start;
        if (when > now + .15) break;
        if (n.inRange) {
          var nextStart = null;
          for (var j = PV.idx + 1; j < rec.melody.length; j++) {
            if (rec.melody[j].start > n.start) { nextStart = rec.melody[j].start; break; }
          }
          var gap = nextStart !== null ? nextStart - n.start : n.dur;
          try { D.audio.play(n.midi, Math.max(.1, Math.min(n.dur, gap * .92)), Math.max(when, now - .02)); }
          catch (audioErr) { /* 音频不可用时仍推进可视化 */ }
        }
        $$("#pvChips .hk-chip").forEach(function (c, ci) { c.classList.toggle("is-cur", ci === PV.idx); });
        var chip = $('#pvChips .hk-chip[data-idx="' + PV.idx + '"]');
        if (chip) {
          /* 只在 chips 容器内滚动，绝不滚动整页 */
          var chipsBox = $("#pvChips");
          if (chipsBox) {
            var target = chip.offsetLeft - chipsBox.clientWidth / 2;
            chipsBox.scrollLeft = Math.max(0, Math.min(target, chipsBox.scrollWidth - chipsBox.clientWidth));
          }
        }
        PV.idx++;
      }
      PV.seek = Math.min(rec.duration, now - PV.ctx0);
      pvUpdateHead();
      var pvLastEnd = rec.melody.length ? rec.melody[rec.melody.length - 1].start + rec.melody[rec.melody.length - 1].dur : rec.duration;
      if (PV.seek >= Math.max(rec.duration, pvLastEnd)) { PV.seek = rec.duration; pvUpdateHead(); pvStop(true); return; }
      PV.raf = requestAnimationFrame(tick);
    })();
  }
  $("#pvVol").addEventListener("input", function () {
    var v = Number(this.value);
    $("#pvVolVal").textContent = v + "%";
    if (D.audio && D.audio.setVolume) D.audio.setVolume(v / 100);
  });
  var _pvOrigPlay = pvPlay;
  pvPlay = function () {
    if (D.audio.setVolume) D.audio.setVolume(Number($("#pvVol").value || 20) / 100);
    _pvOrigPlay();
  };
  $("#pvPlay").addEventListener("click", pvPlay);
  $("#pvStop").addEventListener("click", function () { pvStop(false); });
  window.addEventListener("resize", renderPvRoll);
  renderPvRoll();
})();
