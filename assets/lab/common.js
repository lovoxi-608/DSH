/* ═══════════════════════════════════════════════════════════════════════
   DFH · 三角洲口琴工作室 —— 公共引擎 common.js
   被三处共用：
     · /lab 工作室（app.js 动态加载本文件）
     · 乐谱库 library.html
     · 曲谱详情 score.html
   内容：音高/键位映射 · 标准 MIDI 文件解析与导出 · 两种 txt 谱面解析 ·
        主旋律提取/八度折叠 · 真实口琴采样试听 · localStorage 曲库
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* 定位本文件所在目录（用于加载 sounds/ 与 samples/，同源相对路径，可静态部署） */
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (!s) s = window.DFH_BOOT_BASE || "";
    try { return new URL(".", s).href; } catch (e) { return window.DFH_BOOT_BASE || ""; }
  })();

  /* ────────────────────────── 常量：三角洲口琴体系 ────────────────────────── */
  var KEY_LIST = ["z", "x", "c", "v", "b", "n", "m"];        // do..si
  var KEY_SEM = { z: 0, x: 2, c: 4, v: 5, b: 7, n: 9, m: 11 };
  var TOP_KEY = ",";                                          // 高音 do
  var SHARP_PC = [1, 3, 6, 8, 10];
  var DIATONIC_INDEX = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  var NAME12 = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var DEG = ["do", "#do", "re", "#re", "mi", "fa", "#fa", "sol", "#sol", "la", "#la", "si"];
  var MOD_INFO = [
    { slot: 0, sharp: false, label: "基准", mouse: "不按修饰键", cls: "hk-mod-mid" },
    { slot: -1, sharp: false, label: "低八度", mouse: "按住鼠标左键", cls: "hk-mod-low" },
    { slot: 1, sharp: false, label: "高八度", mouse: "按住鼠标右键", cls: "hk-mod-high" },
    { slot: 0, sharp: true, label: "升半音", mouse: "按住鼠标中键", cls: "hk-mod-sharp" },
    { slot: -1, sharp: true, label: "低八度+升半音", mouse: "按住左键+中键", cls: "hk-mod-low-sharp" },
    { slot: 1, sharp: true, label: "高八度+升半音", mouse: "按住右键+中键", cls: "hk-mod-high-sharp" }
  ];
  var TAG_PRESETS = ["动漫", "游戏", "流行", "古典", "影视", "儿歌", "圣诞", "练习", "原创", "未标注"];

  /* ────────────────────────── 小工具 ────────────────────────── */
  function mod12(p) { return ((p % 12) + 12) % 12; }
  function pitchName(p) { return NAME12[mod12(p)] + (Math.floor(p / 12) - 1); }
  function regOf(p, b) {
    var d = Math.floor(p / 12) - 1 - b;
    return d <= -1 ? "低" : d === 0 ? "中" : d === 1 ? "高" : "高高";
  }
  function degName(p) { return DEG[mod12(p)]; }
  function keyOfPitch(pitch) {
    var pc = mod12(pitch);
    var idx = DIATONIC_INDEX[pc];
    if (idx === undefined) { pc = mod12(pc - 1); idx = DIATONIC_INDEX[pc]; }
    return KEY_LIST[idx];
  }
  function isSharpPitch(pitch) { return SHARP_PC.indexOf(mod12(pitch)) >= 0; }
  function reachable(pitch, baseOct) {
    var d = Math.floor(pitch / 12) - 1 - baseOct;
    if (d >= -1 && d <= 1) return true;
    if (d === 2) { var pc = mod12(pitch); return pc === 0 || pc === 1; }
    return false;
  }
  function autoBaseOctave(pitches) {
    if (!pitches.length) return 5;
    var minO = 1e9, maxO = -1e9, sumO = 0;
    pitches.forEach(function (p) {
      var o = Math.floor(p / 12) - 1;
      if (o < minO) minO = o;
      if (o > maxO) maxO = o;
      sumO += o;
    });
    var meanO = sumO / pitches.length;
    var bestB = minO, bestPlay = -1;
    for (var b = Math.max(1, minO); b <= Math.min(8, maxO); b++) {
      var play = 0;
      pitches.forEach(function (p) { if (reachable(p, b)) play++; });
      if (play > bestPlay || (play === bestPlay && Math.abs(b - meanO) < Math.abs(bestB - meanO))) {
        bestPlay = play; bestB = b;
      }
    }
    return bestB;
  }
  /* 音高 → 键位映射 */
  function mapNote(midi, baseOct) {
    if (midi < 0 || midi > 127) return { key: " ", sharp: false, slot: 0, inRange: false };
    var oct = Math.floor(midi / 12) - 1;
    var d = oct - baseOct;
    var pc = mod12(midi);
    if (d < -1 || d > 2) return { key: keyOfPitch(midi), sharp: isSharpPitch(midi), slot: 0, inRange: false };
    if (d === 2) {
      if (pc !== 0 && pc !== 1) return { key: TOP_KEY, sharp: pc === 1, slot: 2, inRange: false };
      return { key: TOP_KEY, sharp: pc === 1, slot: 2, inRange: true, pitch: midi };
    }
    return { key: keyOfPitch(midi), sharp: isSharpPitch(midi), slot: d, inRange: true, pitch: midi };
  }
  function modInfo(slot, sharp) {
    for (var i = 0; i < MOD_INFO.length; i++)
      if (MOD_INFO[i].slot === slot && MOD_INFO[i].sharp === !!sharp) return MOD_INFO[i];
    return MOD_INFO[0];
  }

  /* ────────────────────────── 简谱记法 ────────────────────────── */
  var JP_KEY = { "1": "z", "2": "x", "3": "c", "4": "v", "5": "b", "6": "n", "7": "m", "i": "," };
  var KEY_JP = { z: "1", x: "2", c: "3", v: "4", b: "5", n: "6", m: "7", ",": "i" };
  function jianpuOf(key, slot, sharp) {
    var s = (sharp ? "#" : "") + KEY_JP[key];
    if (slot === -1) return "【" + s + "】";
    if (slot === 1) return "{" + s + "}";
    return s;
  }
  function parseJianpuToken(tok) {
    if (!tok) return null;
    var t = String(tok).trim();
    if (!t) return null;
    var slot = 0, sharp = 0;
    if (t.charAt(0) === "【" && t.charAt(t.length - 1) === "】") { slot = -1; t = t.slice(1, -1); }
    else if (t.charAt(0) === "{" && t.charAt(t.length - 1) === "}") { slot = 1; t = t.slice(1, -1); }
    if (t.charAt(0) === "#") { sharp = 1; t = t.slice(1); }
    var key = JP_KEY[t];
    if (!key) return null;
    return { key: key, slot: slot, sharp: sharp };
  }
  function jianpuToMidi(key, slot, sharp, baseOct) {
    var pc = (KEY_SEM[key] !== undefined ? KEY_SEM[key] : 0) + sharp;
    var oct = baseOct + slot + (key === TOP_KEY ? 1 : 0);
    return (oct + 1) * 12 + pc;
  }
  function parsePitchName(s) {
    var m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(s).trim());
    if (!m) return null;
    var pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1].toUpperCase()];
    if (m[2] === "#") pc += 1; else if (m[2] === "b") pc -= 1;
    return (parseInt(m[3], 10) + 1) * 12 + pc;
  }

  /* 通用文本解码：UTF-8 严格失败则回退 GBK（Windows 记事本默认 ANSI 保存） */
  function decodeText(buffer) {
    var arr = (buffer instanceof ArrayBuffer) ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(arr); }
    catch (e1) {
      try { return new TextDecoder("gbk").decode(arr); }
      catch (e2) { return new TextDecoder("utf-8").decode(arr); }
    }
  }

  /* ══════════════════════════ 标准 MIDI 文件解析 ══════════════════════════ */
  function parseMidi(buffer) {
    var d = new Uint8Array(buffer);
    var dv = new DataView(buffer);
    var p = 0;
    function rs(n) { var s = ""; for (var i = 0; i < n; i++) s += String.fromCharCode(d[p + i]); p += n; return s; }
    function u32() { var v = dv.getUint32(p); p += 4; return v; }
    function u16() { var v = dv.getUint16(p); p += 2; return v; }
    function u8() { return d[p++]; }
    function vlq() { var v = 0, c; do { c = u8(); v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; }
    /* MIDI 里的中文音轨名常见 GBK 编码：先严格 UTF-8，失败回退 GBK */
    function decodeName(off, n) {
      var arr = d.subarray(off, off + n);
      try { return new TextDecoder("utf-8", { fatal: true }).decode(arr); }
      catch (e1) {
        try { return new TextDecoder("gbk").decode(arr); }
        catch (e2) { return new TextDecoder("utf-8").decode(arr); }
      }
    }

    if (rs(4) !== "MThd") throw new Error("不是标准 MIDI 文件（缺少 MThd 标识）");
    var hlen = u32();
    var fmt = u16(), ntrk = u16(), division = u16();
    p += hlen - 6;
    if (division & 0x8000) throw new Error("暂不支持 SMPTE 时间码 MIDI");
    var ppq = division || 480;

    var tempos = [{ tick: 0, usPerQ: 500000 }];
    var tracks = [];

    for (var ti = 0; ti < ntrk && p < d.length - 8; ti++) {
      var id = rs(4);
      var len = u32();
      if (id !== "MTrk") { p += len; ti--; continue; }
      var end = p + len;
      var tr = { name: "", program: 0, events: [], raw: [] };
      var tick = 0, running = 0, chans = {};
      var open = {};   // key ch*128+note -> {startTick, vel}
      while (p < end) {
        tick += vlq();
        var st = u8();
        if (st < 0x80) { running = running || 0; p--; st = running; }
        else if ((st & 0xf0) !== 0xf0) running = st;   /* meta(0xFF)/sysex(0xF0/0xF7) 不参与 running status */
        var hi = st & 0xf0, ch = st & 0x0f;
        if (st === 0xFF) {
          var mt = u8(), ml = vlq(), mp = p; p += ml;
          if (mt === 0x51 && ml >= 3) {
            tempos.push({ tick: tick, usPerQ: (d[mp] << 16) | (d[mp + 1] << 8) | d[mp + 2] });
          } else if ((mt === 0x03 || mt === 0x04) && !tr.name) {
            tr.name = decodeName(mp, ml).replace(/\0+$/, "").trim();
          }
        } else if (st === 0xF0 || st === 0xF7) {
          p += vlq();
        } else if (hi === 0x80 || hi === 0x90 || hi === 0xA0 || hi === 0xB0 || hi === 0xE0) {
          var d1 = u8(), d2 = u8();
          chans[ch] = 1;
          if (hi === 0x90 && d2 > 0) {
            open[ch * 128 + d1] = { startTick: tick, vel: d2 };
          } else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) {
            var key2 = ch * 128 + d1;
            var on = open[key2];
            if (on) {
              tr.raw.push({ midi: d1, startTick: on.startTick, endTick: tick, velocity: on.vel, channel: ch });
              delete open[key2];
            }
          } else if (hi === 0xB0 && d1 === 0) { /* bank */ }
        } else if (hi === 0xC0 || hi === 0xD0) {
          var pd = u8();
          if (hi === 0xC0) tr.program = pd;
        } else {
          // 未识别事件，跳过一个字节（大多数情况不会走到）
        }
      }
      tr.drum = !!chans[9];
      p = end;
      tracks.push(tr);
    }

    /* tempo map → 秒（按 tempo 变化点分段累加） */
    tempos.sort(function (a, b) { return a.tick - b.tick; });
    function tickToSec(tick) {
      var sec = 0;
      var segStartTick = tempos[0].tick, segUs = tempos[0].usPerQ;
      for (var j = 1; j < tempos.length; j++) {
        if (tempos[j].tick <= tick) {
          sec += (tempos[j].tick - segStartTick) * segUs / (ppq * 1e6);
          segStartTick = tempos[j].tick; segUs = tempos[j].usPerQ;
        } else break;
      }
      sec += Math.max(0, tick - segStartTick) * segUs / (ppq * 1e6);
      return sec;
    }

    var outTracks = [];
    var duration = 0;
    var bpm = Math.round(60000000 / tempos[tempos.length - 1].usPerQ);
    tracks.forEach(function (tr, idx) {
      var notes = tr.raw.map(function (e) {
        var start = tickToSec(e.startTick), end = tickToSec(Math.max(e.endTick, e.startTick + 1));
        return { midi: e.midi, start: start, dur: Math.max(0.05, end - start), velocity: e.vel / 127 };
      }).sort(function (a, b) { return a.start - b.start || b.midi - a.midi; });
      var last = notes.length ? notes[notes.length - 1].start + notes[notes.length - 1].dur : 0;
      if (last > duration) duration = last;
      if (!tr.name) tr.name = "MIDITrack";
      var loM = notes.length ? Math.min.apply(null, notes.map(function (n) { return n.midi; })) : 0;
      var hiM = notes.length ? Math.max.apply(null, notes.map(function (n) { return n.midi; })) : 0;
      if (!notes.length) return;   /* 丢弃只有 tempo / meta 的空音轨 */
      outTracks.push({
        name: tr.name, program: tr.program, notes: notes, index: idx,
        drum: !!tr.drum, lowest: loM, highest: hiM
      });
    });
    return { format: fmt, ppq: ppq, bpm: bpm, tracks: outTracks, duration: duration };
  }

  /* 猜测主旋律音轨：排除鼓组（第 10 通道），优先音高中区偏高、音域宽、音符多 */
  function guessLeadTrack(tracks) {
    var best = -1, bestScore = -Infinity;
    tracks.forEach(function (t, i) {
      var notes = t.notes || [];
      if (!notes.length) return;
      var span = (t.highest || 0) - (t.lowest || 0);
      var sorted = notes.map(function (n) { return n.midi; }).sort(function (a, b) { return a - b; });
      var median = sorted[Math.floor(sorted.length / 2)];
      var score;
      if (t.drum) score = -1e9 + notes.length;
      else {
        score = median * 100 + notes.length;
        if (span < 3) score -= 5000;   /* 音域过窄（疑似打击/铺底） */
      }
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best < 0 ? 0 : best;
  }

  /* ══════════════════════════ MIDI 文件导出（单轨） ══════════════════════════ */
  function buildMidi(notes, opts) {
    opts = opts || {};
    var ppq = 480, bpm = opts.bpm || 120;
    var us = Math.round(60000000 / bpm);
    var evs = [];
    function push(tick, bytes) { evs.push({ tick: tick, bytes: bytes }); }
    // 轨名
    var nameBytes = [];
    var nm = (opts.trackName || "HARMONICA STUDIO");
    push(0, [0xFF, 0x03, nm.length].concat(nm.split("").map(function (c) { return c.charCodeAt(0) & 0x7f; })));
    push(0, [0xFF, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
    push(0, [0xFF, 0x58, 0x04, 4, 2, 24, 8]);
    notes.forEach(function (n) {
      var st = Math.max(0, Math.round(n.start * ppq * bpm / 60));
      var en = Math.max(st + 1, Math.round((n.start + Math.max(0.08, n.dur)) * ppq * bpm / 60));
      push(st, [0x90, n.midi & 0x7f, Math.round((n.velocity || 0.85) * 100) & 0x7f]);
      push(en, [0x80, n.midi & 0x7f, 0]);
    });
    evs.sort(function (a, b) { return a.tick - b.tick; });
    function vlqBytes(v) {
      var out = [v & 0x7f]; v >>= 7;
      while (v > 0) { out.unshift((v & 0x7f) | 0x80); v >>= 7; }
      return out;
    }
    var body = [];
    var prev = 0;
    evs.forEach(function (e) {
      body = body.concat(vlqBytes(Math.max(0, e.tick - prev))).concat(e.bytes);
      prev = e.tick;
    });
    body = body.concat([0x00, 0xFF, 0x2F, 0x00]);
    function str(s) { var o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 0xff); return o; }
    function chunk(id, data) {
      var l = data.length, out = str(id).concat([(l >> 24) & 0xff, (l >> 16) & 0xff, (l >> 8) & 0xff, l & 0xff]).concat(data);
      return out;
    }
    var header = chunk("MThd", [0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff]);
    var track = chunk("MTrk", body);
    return new Uint8Array(header.concat(track));
  }

  /* ══════════════════════════ 三角洲节拍谱 txt（第二种格式） ══════════════════════════ */
  function deltaBeats(tok) {
    tok = String(tok).trim();
    if (!tok || tok === "—" || tok === "－" || tok === "-") return 1;
    var bm = tok.match(/^([0-9]+(?:\.[0-9]+)?)\s*b$/i);
    if (bm) return parseFloat(bm[1]);
    var dotted = tok.indexOf("·") >= 0;
    var base = tok.replace(/·/g, "").trim();
    var map = { "1": 4, "2": 2, "4": 1, "8": 0.5, "16": 0.25, "32": 0.125 };
    var beats = Object.prototype.hasOwnProperty.call(map, base) ? map[base] : parseFloat(base);
    if (isNaN(beats) || beats <= 0) beats = 1;
    if (dotted) beats *= 1.5;
    return beats;
  }
  function parseDeltaTxt(text) {
    var bpm = 190;
    var bpmM = String(text).match(/BPM\s*[:：]?\s*(\d+)/i);
    if (bpmM) bpm = parseInt(bpmM[1], 10);
    var transposeM = String(text).match(/移调\s*(-?\d+)/);
    var transpose = transposeM ? parseInt(transposeM[1], 10) : 0;
    var beatMs = 60000 / Math.max(30, bpm);
    var lines = String(text).split(/\r?\n/);
    var measures = [], cur = null;
    lines.forEach(function (line) {
      var hm = line.match(/^\s*小节\s*(\d+)\s*(?:\(\s*(\d+)\s*\/\s*(\d+)\s*\))?([\s\S]*)$/);
      if (hm) {
        if (cur) measures.push(cur);
        var barBeats = hm[2] && hm[3] ? (4 * parseInt(hm[2], 10) / parseInt(hm[3], 10)) : 4;
        cur = { no: +hm[1], barBeats: barBeats, empty: /—|－|--/.test(hm[4] || ""), jp: null, rh: null };
        return;
      }
      if (!cur) return;
      var mj = line.match(/^\s*简谱[\s:：]+([\s\S]*)$/);
      var mr = line.match(/^\s*键位[\s:：]+([\s\S]*)$/);
      var mrh = line.match(/^\s*节奏[\s:：]+([\s\S]*)$/);
      if (mj) cur.jp = mj[1].trim().split(/\s+/).filter(Boolean);
      else if (mr) cur.keyLine = mr[1].trim().split(/\s+/).filter(Boolean);
      else if (mrh) cur.rh = mrh[1].trim().split(/\s+/).filter(Boolean);
    });
    if (cur) measures.push(cur);

    var raw = [], cursor = 0;
    /* 键位 token（Z/V/B/N#/, 等）→ 简谱记法（1..7/i/#/【】/{}） */
    function keyTokenToName(tok0) {
      var tok = String(tok0).trim();
      var slotPre = "";
      if (tok.charAt(0) === "+") { slotPre = "high"; tok = tok.slice(1); }
      else if (tok.charAt(0) === "-") { slotPre = "low"; tok = tok.slice(1); }
      else if (tok.charAt(tok.length - 1) === "+") { slotPre = "high"; tok = tok.slice(0, -1); }
      else if (tok.charAt(tok.length - 1) === "-") { slotPre = "low"; tok = tok.slice(0, -1); }
      var sharp = /#/.test(tok);
      var letter = tok.replace(/[#']/g, "").toLowerCase();
      var deg = letter === "," || letter === "'" ? "i" : KEY_JP[letter];
      if (!deg) return null;
      var core = (sharp ? "#" : "") + deg;
      if (slotPre === "high") return "{" + core + "}";
      if (slotPre === "low") return "【" + core + "】";
      return core;
    }
    measures.forEach(function (mm) {
      var barBeats = mm.barBeats || 4;
      var mStart = (mm.no - 1) * barBeats;
      if (mm.empty) { cursor = mStart + barBeats; return; }
      if (!mm.rh) return;
      /* 优先使用「键位」行（最精确），否则用「简谱」行 */
      var names = null;
      if (mm.keyLine && mm.keyLine.length >= mm.rh.length) {
        names = mm.keyLine.map(keyTokenToName);
      } else if (mm.jp) {
        names = mm.jp.map(function (jtok) {
          var m = String(jtok).match(/^(#?)([1-7])([.']?)$/);
          if (!m) return null;
          var core = (m[1] ? "#" : "") + m[2];
          if (m[3] === ".") return "【" + core + "】";
          if (m[3] === "'") return m[2] === "1" ? "i" : "{" + core + "}";
          return core;
        });
      }
      if (!names) return;
      var local = Math.max(cursor, mStart);
      var n = Math.min(names.length, mm.rh.length);
      for (var k = 0; k < n; k++) {
        var name = names[k];
        if (!name) { local += deltaBeats(mm.rh[k]); continue; }
        var b = deltaBeats(mm.rh[k]);
        raw.push({ name: name, start: local, durBeats: b });
        local += b;
      }
      cursor = local;
    });

    var notes = [];
    for (var i = 0; i < raw.length; i++) {
      var r = raw[i];
      var dur = Math.max(30, Math.round(r.durBeats * beatMs));
      var gapBeats = (i + 1 < raw.length) ? (raw[i + 1].start - r.start) : r.durBeats;
      if (!(gapBeats > 0)) gapBeats = r.durBeats;
      var gap = Math.max(30, Math.round(gapBeats * beatMs));
      notes.push({ name: r.name, midi: null, jp: parseJianpuToken(r.name), dur: dur, gap: gap });
    }
    return { bpm: bpm, transpose: transpose, notes: notes };
  }
  function isDeltaTxt(text) {
    return /^\s*小节\s*\d+/m.test(text) && /简谱/.test(text) && /节奏/.test(text);
  }

  /* ══════════════════════════ 约定格式 txt（音阶·持续·间隔三元组） ══════════════════════════ */
  function parseNoteTxt(text) {
    if (!text) return { bpm: 0, notes: [] };
    var bpm = 0;
    var bpmM = String(text).match(/BPM\s*[:：]?\s*(\d+)/i);
    if (bpmM) bpm = parseInt(bpmM[1], 10);
    var raw = String(text).replace(/[“”‘’]/g, '"').replace(/[，；]/g, ",");
    var blocks = raw.match(/\(([^)]*)\)/g) || [];
    var tokens = [];
    blocks.forEach(function (b) {
      b.slice(1, -1).split(",").forEach(function (s) {
        s = s.trim().replace(/^["']|["']$/g, "");
        if (s) tokens.push(s);
      });
    });
    if (!tokens.length) tokens = raw.split(/[\s,]+/).filter(Boolean);
    function parseMs(s) { var v = parseInt(String(s).replace(/[^0-9]/g, ""), 10); return (isNaN(v) || v < 10) ? 200 : v; }
    var notes = [];
    var i = 0;
    while (i < tokens.length) {
      var pitchTok = tokens[i], dur = 200, gap = 200;
      if (i + 2 < tokens.length && /ms$/i.test(tokens[i + 2])) {
        dur = parseMs(tokens[i + 1]); gap = parseMs(tokens[i + 2]); i += 3;
      } else if (i + 1 < tokens.length && /ms$/i.test(tokens[i + 1])) {
        gap = parseMs(tokens[i + 1]); dur = Math.max(50, Math.round(gap * 0.8)); i += 2;
      } else { i += 1; continue; }
      var jp = parseJianpuToken(pitchTok), midi = null, name = pitchTok;
      if (jp) name = jianpuOf(jp.key, jp.slot, jp.sharp);
      else { midi = parsePitchName(pitchTok); if (midi === null) continue; name = pitchName(midi); }
      notes.push({ name: name, midi: midi, jp: jp, dur: dur, gap: gap });
    }
    return { bpm: bpm, notes: notes };
  }

  /* txt 音符（ms）→ 秒轴音符，并解析出实际 midi/键位 */
  function txtNotesToMelody(parsed) {
    var notes = parsed.notes;
    var namedMidis = notes.filter(function (n) { return n.midi !== null; }).map(function (n) { return n.midi; });
    var base = namedMidis.length ? autoBaseOctave(namedMidis) : 5;
    var cursor = 0;
    var mel = [];
    notes.forEach(function (n) {
      var midi;
      if (n.jp) midi = jianpuToMidi(n.jp.key, n.jp.slot, n.jp.sharp, base);
      else midi = n.midi;
      n.midi = midi; n.base = base;
      var m = mapNote(midi, base);
      n.key = m.key; n.slot = m.slot; n.sharp = m.sharp; n.inRange = m.inRange;
      mel.push({ midi: midi, start: cursor, dur: Math.min(n.dur, n.gap) / 1000,
        key: m.key, slot: m.slot, sharp: m.sharp, inRange: m.inRange, folded: false });
      cursor += n.gap / 1000;
    });
    return { base: base, melody: mel, duration: cursor };
  }

  /* ══════════════════════════ 主旋律提取（和弦取最高音 + 重叠简化） ══════════════════════════ */
  function extractMelody(rawNotes) {
    var sorted = rawNotes.slice().sort(function (a, b) { return a.start - b.start || b.midi - a.midi; });
    var mel = [], chordSkipped = 0;
    var lastStart = -1, lastEnd = -1, EPS = 0.03;
    sorted.forEach(function (n) {
      if (mel.length && Math.abs(n.start - lastStart) <= EPS) {
        // 同一时刻的和弦音：保留最高音（排序已保证最高在前），其余跳过
        chordSkipped++;
        return;
      }
      if (mel.length && n.start < lastEnd - 0.06 && n.midi <= mel[mel.length - 1].midi) {
        // 前音未结束时的低位重叠音，视为和弦/重叠简化
        chordSkipped++;
        return;
      }
      mel.push({ midi: n.midi, start: n.start, dur: n.dur, velocity: n.velocity || 0.85 });
      lastStart = n.start; lastEnd = n.start + n.dur;
    });
    return { melody: mel, chordSkipped: chordSkipped };
  }

  /* 把秒轴旋律映射成口琴演奏音符（移调 / 基准八度 / 八度折叠） */
  function resolveMelody(melody, opts) {
    opts = opts || {};
    var transpose = opts.transpose | 0;
    var shifted = melody.map(function (n) { return Object.assign({}, n, { midi: n.midi + transpose }); });
    var base = opts.baseOct === "auto" || opts.baseOct === undefined || opts.baseOct === null
      ? autoBaseOctave(shifted.map(function (n) { return n.midi; }))
      : parseInt(opts.baseOct, 10);
    var foldedCount = 0;
    shifted.forEach(function (n) {
      var m0 = n.midi, finalMidi = m0, folded = false;
      if (opts.fold && !reachable(m0, base)) {
        var best = null;
        for (var step = 1; step <= 3; step++) {
          if (reachable(m0 + step * 12, base)) { best = m0 + step * 12; break; }
          if (reachable(m0 - step * 12, base)) { best = m0 - step * 12; break; }
        }
        if (best !== null) { finalMidi = best; folded = true; foldedCount++; }
      }
      var mp = mapNote(finalMidi, base);
      n.midi = finalMidi;
      n.origMidi = m0;
      n.key = mp.key; n.slot = mp.slot; n.sharp = mp.sharp; n.inRange = mp.inRange;
      n.folded = folded;
      n.name = mp.inRange ? jianpuOf(mp.key, mp.slot, mp.sharp) : pitchName(finalMidi);
    });
    return { base: base, notes: shifted, foldedCount: foldedCount };
  }

  /* ══════════════════════════ 约定格式 txt 导出 ══════════════════════════ */
  function buildTupleTxt(title, resolved, baseOct) {
    var playable = resolved.notes.filter(function (n) { return n.inRange; });
    if (!playable.length) playable = resolved.notes;
    var pairs = [];
    for (var i = 0; i < playable.length; i++) {
      var n = playable[i];
      var nextStart = null;
      for (var j = i + 1; j < playable.length; j++) {
        if (playable[j].start > n.start) { nextStart = playable[j].start; break; }
      }
      var dur = Math.max(50, Math.round(n.dur * 1000));
      var gap = nextStart !== null ? Math.max(50, Math.round((nextStart - n.start) * 1000))
        : Math.max(100, Math.round(n.dur * 1000));
      var jp = jianpuOf(n.key, n.slot, n.sharp);
      pairs.push('"' + jp + '","' + dur + 'ms","' + gap + 'ms"');
    }
    return [
      "# 口琴谱 v2.1 · 简谱·持续·间隔（HARMONICA STUDIO 导出）",
      "曲名: " + (title || "未命名曲目"),
      "BPM: " + (resolved.bpm || 120),
      "基准八度: " + baseOct,
      "# 每音三个值：音阶, 持续时间(ms), 到下一音间隔(ms)",
      '# 记法：1234567i = do re mi fa sol la si 高音do（键 z x c v b n m ,）；【】=低八度（左键）；{}=高八度（右键）；#=升半音（中键）',
      "(" + pairs.join(",") + ")"
    ].join("\n");
  }

  /* ══════════════════════════ 试听音频引擎（真实口琴采样 + 合成兜底） ══════════════════════════ */
  var audioCtx = null, activeSources = [];
  var SOUND_SAMPLES = [60, 64, 67, 72];
  var hkBaseSamples = {}, hkKeySamples = {};
  var hkVolume = 0.2;
  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
    return audioCtx;
  }
  function loadAudioFile(url) {
    return fetch(url, { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      return new Promise(function (res, rej) { ensureAudio().decodeAudioData(ab, res, rej); });
    }).catch(function () { return null; });
  }
  var soundsStarted = false;
  function loadSounds() {
    if (soundsStarted) return; soundsStarted = true;
    var dir = BASE + "sounds/";
    var jobs = [];
    /* 仅加载确定存在的 4 个基础采样（C4/E4/G4/C5），其余音高变速播放；
       如以后要加逐键采样，把文件放进 sounds/ 并在此登记文件名即可。 */
    SOUND_SAMPLES.forEach(function (m) {
      jobs.push(loadAudioFile(dir + ("00" + m).slice(-3) + ".wav").then(function (b) { if (b) hkBaseSamples[m] = b; }));
    });
    return Promise.all(jobs);
  }
  function pickSample(midi) {
    for (var i = 0; i < KEY_LIST.length + 1; i++) {
      var ch = i < KEY_LIST.length ? KEY_LIST[i] : TOP_KEY;
      var sem = i < KEY_LIST.length ? KEY_SEM[ch] : 0;
      var oct = Math.floor(midi / 12) - 1;
      var nat = oct * 12 + sem;
      if (midi === nat && hkKeySamples[i]) return { buf: hkKeySamples[i], rate: 1 };
    }
    var mids = []; for (var m in hkBaseSamples) mids.push(+m);
    if (!mids.length) return null;
    var best = mids[0];
    for (var j = 1; j < mids.length; j++) if (Math.abs(mids[j] - midi) < Math.abs(best - midi)) best = mids[j];
    var rate = Math.max(0.25, Math.min(5.0, Math.pow(2, (midi - best) / 12)));
    return { buf: hkBaseSamples[best], rate: rate };
  }
  function playSynthFallback(midi, dur, when, vol) {
    var ctx = audioCtx; if (!ctx) return;
    var v = vol === undefined ? hkVolume : vol;
    var t0 = when || (ctx.currentTime + 0.02);
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.4 * v, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.16 * v, t0 + 0.14);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.08);
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = freq * 4; lp.Q.value = 0.8;
    var o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = freq;
    var o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = freq * 2;
    var g2 = ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(ctx.destination);
    o1.start(t0); o2.start(t0); o1.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
    activeSources.push(o1, o2);
  }
  function playNote(midi, dur, when, vol) {
    var ctx = ensureAudio(); if (!ctx) return;
    var src = pickSample(midi);
    if (!src) { playSynthFallback(midi, dur || 0.4, when, vol); return; }
    var t0 = when || (ctx.currentTime + 0.02);
    var d = Math.max(0.12, dur || 0.4);
    var s = ctx.createBufferSource();
    s.buffer = src.buf; s.playbackRate.value = src.rate;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.85 * hkVolume, t0 + 0.012);
    g.gain.setValueAtTime(0.85 * hkVolume, t0 + Math.max(0.04, d - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t0 + d + 0.12);
    s.connect(g); g.connect(ctx.destination);
    s.start(t0); s.stop(t0 + d + 0.18);
    activeSources.push(s);
  }
  function stopAllSounds() {
    try { activeSources.forEach(function (s) { s.stop && s.stop(); }); } catch (e) { }
    activeSources = [];
  }

  /* ══════════════════════════ localStorage 曲库 ══════════════════════════ */
  var K = {
    scores: "dfh.scores.v1", favs: "dfh.favs.v1", archive: "dfh.archive.v1",
    likes: "dfh.likes.v1", seeded: "dfh.seeded.v1"
  };
  var SEED_VERSION = "2";   /* 解析逻辑升级后 bump：旧版内置曲会被清除并重新播种 */
  function readJSON(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function writeJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.warn("本地存储失败（空间不足？）", e); return false; }
  }
  function uid() { return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var Store = {
    KEYS: K,
    TAG_PRESETS: TAG_PRESETS,
    list: function () { return readJSON(K.scores, []); },
    get: function (id) { return this.list().filter(function (s) { return s.id === id; })[0] || null; },
    save: function (rec) {
      var all = this.list();
      var i = -1;
      all.forEach(function (s, idx) { if (s.id === rec.id) i = idx; });
      if (i >= 0) all[i] = Object.assign({}, all[i], rec); else all.unshift(rec);
      writeJSON(K.scores, all);
      if (typeof Cloud !== "undefined" && Cloud.schedule) Cloud.schedule();
      return rec;
    },
    remove: function (id) {
      writeJSON(K.scores, this.list().filter(function (s) { return s.id !== id; }));
      if (typeof Cloud !== "undefined" && Cloud.schedule) Cloud.schedule();
    },
    incDownload: function (id) {
      var rec = this.get(id); if (!rec) return;
      rec.downloads = (rec.downloads || 0) + 1; this.save(rec);
    },
    /* 收藏 */
    favs: function () { return readJSON(K.favs, {}); },
    isFav: function (id) { return !!this.favs()[id]; },
    toggleFav: function (id) {
      var f = this.favs(); f[id] ? delete f[id] : f[id] = 1; writeJSON(K.favs, f); return !!f[id];
    },
    /* 点赞（每浏览器一次） */
    likes: function () { return readJSON(K.likes, {}); },
    isLiked: function (id) { return !!this.likes()[id]; },
    toggleLike: function (id) {
      var l = this.likes();
      var rec = this.get(id); if (!rec) return false;
      if (l[id]) { delete l[id]; rec.likes = Math.max(0, (rec.likes || 0) - 1); }
      else { l[id] = 1; rec.likes = (rec.likes || 0) + 1; }
      writeJSON(K.likes, l); this.save(rec); return !!l[id];
    },
    /* 云存档（本地） */
    archive: function () { return readJSON(K.archive, []); },
    isArchived: function (id) { return this.archive().indexOf(id) >= 0; },
    toggleArchive: function (id) {
      var a = this.archive();
      var i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else a.unshift(id);
      writeJSON(K.archive, a); return i < 0;
    },
    seeded: function () { return localStorage.getItem(K.seeded) === SEED_VERSION; },
    markSeeded: function () { localStorage.setItem(K.seeded, SEED_VERSION); }
  };

  /* ══════════════════════════ GitHub 云同步（曲谱库服务器存储） ══════════════════════════
     纯前端实现：曲谱库数据存到 GitHub 仓库的 JSON 文件，静态托管（GitHub Pages）也可用。
     上传/删除曲谱自动推送；乐谱库打开时自动拉取。Token 仅保存在本机浏览器。 */
  var Cloud = {
    KEY: "dfh.cloud.v1",
    cfg: function () {
      return readJSON(Cloud.KEY, null) || { token: "", repo: "", branch: "main", path: "updream-data/scores.json" };
    },
    saveCfg: function (c) { writeJSON(Cloud.KEY, c); return true; },
    isOn: function () { var c = Cloud.cfg(); return !!(c.token && c.repo); },
    enc: function (s) { return btoa(unescape(encodeURIComponent(s))); },
    dec: function (b) { return decodeURIComponent(escape(atob(b))); },
    apiUrl: function () { var c = Cloud.cfg(); return "https://api.github.com/repos/" + c.repo + "/contents/" + c.path; },
    headers: function () { return { "Authorization": "Bearer " + Cloud.cfg().token, "Accept": "application/vnd.github+json" }; },
    note: function (msg, kind) {
      var el = document.getElementById("hkCloudNote");
      if (el) { el.textContent = msg; el.className = "auth-note" + (kind === "ok" ? " is-ok" : kind === "error" ? " is-error" : ""); }
    },
    /* 整库推送到 GitHub */
    push: function () {
      if (!Cloud.isOn()) return Promise.resolve(false);
      var body = {
        message: "sync scores " + new Date().toISOString(),
        content: Cloud.enc(JSON.stringify({ v: 1, scores: Store.list() }))
      };
      return fetch(Cloud.apiUrl(), { method: "GET", headers: Cloud.headers() })
        .then(function (res) {
          if (res.status === 404) return null;
          if (!res.ok) throw new Error("读取云端失败 HTTP " + res.status);
          return res.json();
        })
        .then(function (meta) {
          if (meta && meta.sha) body.sha = meta.sha;
          return fetch(Cloud.apiUrl(), {
            method: "PUT",
            headers: Object.assign(Cloud.headers(), { "Content-Type": "application/json" }),
            body: JSON.stringify(body)
          });
        })
        .then(function (res) {
          if (!res.ok) return res.json().then(function (j) { throw new Error(j.message || "推送失败 HTTP " + res.status); });
          Cloud.note("已同步到 GitHub ✓", "ok");
          return true;
        })
        .catch(function (e) { Cloud.note("云同步失败：" + e.message, "error"); return false; });
    },
    /* 从 GitHub 拉取并替换本地曲库 */
    pull: function () {
      var c = Cloud.cfg();
      if (!Cloud.isOn()) return Promise.resolve(false);
      return fetch("https://raw.githubusercontent.com/" + c.repo + "/" + c.branch + "/" + c.path)
        .then(function (res) {
          if (res.status === 404) return null;
          if (!res.ok) throw new Error("拉取失败 HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          if (data && data.scores) {
            writeJSON(K.scores, data.scores);
            Cloud.note("已从 GitHub 拉取 " + data.scores.length + " 首曲谱", "ok");
            window.dispatchEvent(new CustomEvent("dfh-cloud-sync"));
            return true;
          }
          return false;
        })
        .catch(function (e) { Cloud.note("云同步失败：" + e.message, "error"); return false; });
    },
    /* 测试连接 */
    test: function () {
      var c = Cloud.cfg();
      if (!c.token || !c.repo) return Promise.resolve({ ok: false, error: "请先填写 Token 与仓库" });
      return fetch("https://api.github.com/repos/" + c.repo, { headers: Cloud.headers() })
        .then(function (res) { return res.json(); })
        .then(function (j) {
          if (j.full_name) return { ok: true, info: j.full_name };
          return { ok: false, error: j.message || "连接失败" };
        })
        .catch(function (e) { return { ok: false, error: e.message }; });
    },
    _timer: null,
    schedule: function () {
      clearTimeout(Cloud._timer);
      Cloud._timer = setTimeout(function () { Cloud.push(); }, 900);
    }
  };

  /* 把解析结果统一整理成曲库记录 */
  function buildRecord(o) {
    // o: {title, composer, uploader, tags, source, bpm, transpose, fold, baseOct, tracks, trackIndex, parsedTxt}
    var tracks = o.tracks || [];
    var trackIndex = o.trackIndex;
    if (trackIndex === undefined || trackIndex < 0) {
      trackIndex = guessLeadTrack(tracks);
    }
    var melody = [], chordSkipped = 0, foldedCount = 0, base = o.baseOct, bpm = o.bpm || 120;
    if (o.source === "midi") {
      var tr = tracks[trackIndex] || tracks[0];
      var ex = extractMelody(tr.notes);
      chordSkipped = ex.chordSkipped;
      var res = resolveMelody(ex.melody, { transpose: o.transpose || 0, fold: o.fold !== false, baseOct: o.baseOct || "auto" });
      base = res.base; melody = res.notes; foldedCount = res.foldedCount; bpm = o.bpm || 120;
    } else if (o.parsedTxt) {
      var r = txtNotesToMelody(o.parsedTxt);
      var raw = r.melody.map(function (n) { return { midi: n.midi, start: n.start, dur: n.dur }; });
      var res2 = resolveMelody(raw, { transpose: o.transpose || 0, fold: o.fold !== false, baseOct: o.baseOct || r.base });
      base = res2.base; melody = res2.notes; foldedCount = res2.foldedCount;
      bpm = o.bpm || o.parsedTxt.bpm || 120;
    }
    var duration = melody.length ? melody[melody.length - 1].start + melody[melody.length - 1].dur : 0;
    var playable = melody.filter(function (n) { return n.inRange; });
    var rec = {
      id: o.id || uid(),
      title: o.title || "未命名曲目",
      composer: o.composer || "未标注原作者",
      uploader: o.uploader || "匿名投稿者",
      tags: (o.tags && o.tags.length) ? o.tags : ["未标注"],
      source: o.source,
      bpm: bpm,
      baseOct: base,
      transpose: o.transpose || 0,
      fold: o.fold !== false,
      tracks: o.source === "midi" ? tracks.map(function (t) {
        return { name: t.name, program: t.program || 0, notes: t.notes };
      }) : [{ name: o.source === "delta" ? "三角洲节拍谱" : "约定格式谱", notes: melody }],
      trackIndex: trackIndex,
      melody: melody,
      noteCount: melody.length,
      playableCount: playable.length,
      chordSkipped: chordSkipped,
      foldedCount: foldedCount,
      duration: Math.round(duration * 1000) / 1000,
      downloads: o.downloads || 0,
      likes: o.likes || 0,
      builtin: !!o.builtin,
      createdAt: o.createdAt || Date.now()
    };
    rec.scoreText = buildTupleTxt(rec.title, { notes: melody, bpm: bpm }, base);
    return rec;
  }

  /* 首次运行：用 samples/ 里的样例播种曲库（失败则留空，不影响上传） */
  function seedLibrary(onprogress) {
    if (Store.seeded()) return Promise.resolve([]);
    var jobs = [
      { file: "samples/sample-zenzen-delta.txt", title: "前前前世", composer: "RADWIMPS", tags: ["动漫", "流行"], source: "delta" },
      { file: "samples/sample-3-jingle-multitrack.mid", title: "铃儿响叮当", composer: "James Lord Pierpont", tags: ["圣诞", "儿歌"], source: "midi" },
      { file: "samples/sample-1-twinkle.mid", title: "小星星", composer: "法国民谣", tags: ["儿歌", "练习"], source: "midi" },
      { file: "samples/sample-2-sharps-high.mid", title: "升降与高音演示", composer: "练习曲", tags: ["练习"], source: "midi" },
      { file: "samples/sample-4-scale.mid", title: "五八度上行音阶", composer: "练习曲", tags: ["练习"], source: "midi" }
    ];
    var done = 0;
    return Promise.all(jobs.map(function (j) {
      return fetch(BASE + j.file).then(function (r) {
        if (!r.ok) throw new Error("missing");
        return j.source === "midi" ? r.arrayBuffer() : r.text();
      }).then(function (data) {
        var rec;
        if (j.source === "midi") {
          var midi = parseMidi(data);
          rec = buildRecord({
            title: j.title, composer: j.composer, uploader: "DFH 官方", tags: j.tags,
            source: "midi", bpm: midi.bpm, tracks: midi.tracks, fold: true, builtin: true,
            id: "builtin-" + j.file.replace(/[^a-z0-9]+/gi, "-").toLowerCase()
          });
        } else {
          var parsed = parseDeltaTxt(data);
          rec = buildRecord({
            title: j.title, composer: j.composer, uploader: "DFH 官方", tags: j.tags,
            source: "delta", bpm: parsed.bpm,
            /* 不传 parsed.transpose：节拍谱的「键位」行已是绝对键位，
               头部移调值仅作展示，再平移会把 Z V B 整体带偏 */
            parsedTxt: parsed,
            fold: true, builtin: true, id: "builtin-zenzen"
          });
        }
        if (onprogress) onprogress(++done, jobs.length, rec);
        return rec;
      }).catch(function () { if (onprogress) onprogress(++done, jobs.length, null); return null; });
    })).then(function (recs) {
      var ok = recs.filter(Boolean);
      if (ok.length) {
        /* 清掉旧版本内置曲（用户上传的非 builtin 记录保留），再写入新的 */
        var all = Store.list().filter(function (r) { return r.id !== "builtin-zenzen" && r.id.indexOf("builtin-") !== 0; });
        ok.forEach(function (r) { if (!Store.get(r.id)) all.push(r); });
        writeJSON(K.scores, all);
      }
      Store.markSeeded();
      return ok;
    });
  }

  /* ────────────────────────── 杂项 ────────────────────────── */
  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60), ms = Math.floor((sec * 1000) % 1000);
    function pad(v, n) { return String(v).padStart(n || 2, "0"); }
    return pad(m) + ":" + pad(s) + "." + String(ms).padStart(3, "0");
  }
  function formatClock(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function downloadBlob(filename, blob) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  }
  function downloadText(filename, text) {
    downloadBlob(filename, new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" }));
  }
  function downloadBytes(filename, bytes) {
    downloadBlob(filename, new Blob([bytes], { type: "audio/midi" }));
  }
  /* 登录态：继承主站（auth.js 提供 window.authPointer / currentAuthUser + authchange 事件） */
  function currentUser() {
    if (window.authPointer && window.authPointer.getUser) return window.authPointer.getUser();
    return window.currentAuthUser || null;
  }
  function onAuthChange(cb) {
    window.addEventListener("authchange", function () { cb(currentUser()); });
  }
  /* ══════════════════════════ 管理员系统 ══════════════════════════
     最高管理员：固定手机号（13868870815 / 19588194643）
     次级管理员：localStorage 维护（dfh.admins.v1 = { sub: [phone...] }）
     权限：最高管理员可增删次级；最高/次级均可在乐谱库右键删除曲谱 */
  var ADMIN_KEY = "dfh.admins.v1";
  var SESSION_KEY = "dfh.adminSession.v1";
  function sha256Hex(s) {
    if (window.crypto && crypto.subtle) {
      return crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      });
    }
    /* 无 WebCrypto 时的简易回退（非加密用途，仅作口令比对混淆） */
    var h = 5381, i, c;
    for (i = 0; i < s.length; i++) { c = s.charCodeAt(i); h = ((h << 5) + h + c) & 0x7fffffff; }
    return Promise.resolve("djb2-" + h.toString(16) + "-" + s.length);
  }
  var OWNER_PHONES = ["13868870815", "19588194643"];
  var Admin = {
    KEY: ADMIN_KEY,
    owners: function () { return OWNER_PHONES.slice(); },
    /* 次级管理员号码列表 */
    subs: function () {
      var v = readJSON(ADMIN_KEY, null);
      return (v && v.sub && v.sub.length) ? v.sub.slice() : [];
    },
    isOwnerPhone: function (phone) { return OWNER_PHONES.indexOf(String(phone || "")) >= 0; },
    isSubPhone: function (phone) { return Admin.subs().indexOf(String(phone || "")) >= 0; },
    isAdminPhone: function (phone) { return Admin.isOwnerPhone(phone) || Admin.isSubPhone(phone); },
    /* 当前登录用户角色："owner" / "admin" / null */
    role: function () {
      var u = currentUser();
      var phone = (u && (u.phone_raw || u.phoneRaw || u.phone || u.mobile)) || "";
      if (!phone) {
        /* 静态部署无后端时 currentUser 拿不到，回退本地缓存的登录号 */
        var s = readJSON(SESSION_KEY, null);
        phone = (s && s.phone) || "";
      }
      if (Admin.isOwnerPhone(phone)) return "owner";
      if (Admin.isSubPhone(phone)) return "admin";
      return null;
    },
    /* 登录态本地缓存（页面 renderLogin 时调用；静态部署下管理员识别依赖它） */
    setSession: function (u) {
      var phone = (u && (u.phone_raw || u.phoneRaw || u.phone || u.mobile)) || "";
      if (phone) writeJSON(SESSION_KEY, { phone: phone });
      else try { localStorage.removeItem(SESSION_KEY); } catch (e) { }
    },
    isOwner: function () { return Admin.role() === "owner"; },
    isAdmin: function () { return !!Admin.role(); },
    /* 静态部署（GitHub Pages 等无登录后端）时的管理员口令：
       口令哈希仅存本机浏览器；验证通过即按最高管理员登录（写会话缓存）。 */
    PIN_KEY: "dfh.adminPin.v1",
    hasPin: function () { var v = readJSON(Admin.PIN_KEY, null); return !!(v && v.hash); },
    setPin: function (pin) {
      pin = String(pin || "");
      if (pin.length < 6) return { ok: false, error: "口令至少 6 位" };
      return sha256Hex(pin).then(function (hash) {
        writeJSON(Admin.PIN_KEY, { hash: hash });
        Admin.setSession({ phone: OWNER_PHONES[0] });
        return { ok: true };
      });
    },
    verifyPin: function (pin) {
      var v = readJSON(Admin.PIN_KEY, null);
      if (!v || !v.hash) return Promise.resolve({ ok: false, error: "尚未设置管理员口令" });
      return sha256Hex(String(pin || "")).then(function (h) {
        if (h !== v.hash) return { ok: false, error: "口令不正确" };
        Admin.setSession({ phone: OWNER_PHONES[0] });
        return { ok: true };
      });
    },
    clearPin: function () { try { localStorage.removeItem(Admin.PIN_KEY); } catch (e) { } },
    addSub: function (phone) {
      phone = String(phone || "").trim();
      if (!/^1[3-9]\d{9}$/.test(phone)) return { ok: false, error: "手机号格式不正确" };
      if (Admin.isOwnerPhone(phone)) return { ok: false, error: "该号码是最高管理员，无需添加" };
      var list = Admin.subs();
      if (list.indexOf(phone) >= 0) return { ok: false, error: "已是次级管理员" };
      list.push(phone);
      writeJSON(ADMIN_KEY, { sub: list });
      return { ok: true };
    },
    removeSub: function (phone) {
      var list = Admin.subs().filter(function (p) { return p !== String(phone || ""); });
      writeJSON(ADMIN_KEY, { sub: list });
      return { ok: true };
    },
    /* 仅 owner 可操作次级管理员列表 */
    canManage: function () { return Admin.isOwner(); },
    /* 设置弹窗内管理员区块（登录设置 → 管理员） */
    bindSettings: function () {
      if (Admin.__settingsBound) return Admin.__settingsRefresh || null;
      var zone = document.getElementById("hkAdminZone");
      if (!zone) return null;
      Admin.__settingsBound = true;
      var roleEl = document.getElementById("hkAdminRoleText");
      var addBtn = document.getElementById("hkAdminAddBtn2");
      var listBtn = document.getElementById("hkAdminListBtn2");
      var addBox = document.getElementById("hkAdminAddBox2");
      var listBox = document.getElementById("hkAdminListBox2");
      var phone = document.getElementById("hkAdminPhone2");
      var okBtn = document.getElementById("hkAdminAddOk2");
      var cancelBtn = document.getElementById("hkAdminAddCancel2");
      var list = document.getElementById("hkAdminList2");
      var note = document.getElementById("hkAdminNote2");
      if (!addBtn) return null;

      function renderList() {
        var subs = Admin.subs();
        if (!subs.length) { if (list) list.innerHTML = ""; if (listBox) listBox.hidden = true; return; }
        if (listBox) listBox.hidden = false;
        list.innerHTML = subs.map(function (ph) {
          return '<div class="hk-admin-item" style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #eef2f7"><span>' + ph + '</span><button type="button" class="auth-code-btn ghost" data-del2="' + ph + '">删除</button></div>';
        }).join("");
        Array.prototype.forEach.call(list.querySelectorAll("[data-del2]"), function (b) {
          b.addEventListener("click", function () {
            var ph = b.getAttribute("data-del2");
            Admin.removeSub(ph);
            renderList();
            if (note) { note.textContent = "已移除：" + ph; note.className = "auth-note"; }
          });
        });
      }
      function refresh() {
        var role = Admin.role();
        zone.hidden = !role;
        /* 静态部署口令区：无后端登录且非管理员时显示 */
        if (pinBox) {
          var staticNeed = !currentUser() && !role;
          pinBox.hidden = !staticNeed;
          if (staticNeed && pinHint) {
            if (!Admin.hasPin()) {
              pinHint.textContent = "静态部署未接入登录服务，请先设置管理员口令（验证通过即为最高管理员，口令仅存本机浏览器）";
              pinHint.className = "auth-note";
            } else if (pinInput) {
              pinHint.textContent = "输入管理员口令登录";
              pinHint.className = "auth-note";
            }
          }
        }
        /* 云同步区：与管理员区同显隐 */
        var cz = document.getElementById("hkCloudZone");
        if (cz) {
          cz.hidden = !role;
          if (role) {
            var c = Cloud.cfg();
            var tk = document.getElementById("hkCloudToken"), rp = document.getElementById("hkCloudRepo");
            var br = document.getElementById("hkCloudBranch"), pt = document.getElementById("hkCloudPath");
            if (tk) tk.value = c.token; if (rp) rp.value = c.repo;
            if (br) br.value = c.branch; if (pt) pt.value = c.path;
            var cnote = document.getElementById("hkCloudNote");
            if (cnote && cnote.textContent.indexOf("已同步") < 0 && cnote.textContent.indexOf("失败") < 0 && cnote.textContent.indexOf("拉取") < 0) {
              cnote.textContent = Cloud.isOn() ? "已配置 ✓（保存/删除曲谱将自动同步）" : "未配置：GitHub Token 仅存本机浏览器";
              cnote.className = "auth-note";
            }
          }
        }
        if (!role) return;
        if (roleEl) roleEl.textContent = role === "owner" ? "最高管理员（可增删次级管理员）" : "次级管理员（可删除曲谱）";
        if (addBtn) addBtn.hidden = role !== "owner";
        if (listBtn) listBtn.hidden = role !== "owner";
        if (addBox) addBox.hidden = true;
        if (listBox) listBox.hidden = true;
        if (note) { note.textContent = ""; note.className = "auth-note"; }
      }
      if (addBtn) addBtn.addEventListener("click", function () { addBox.hidden = false; if (listBox) listBox.hidden = true; if (note) note.textContent = ""; });
      if (cancelBtn) cancelBtn.addEventListener("click", function () { addBox.hidden = true; });
      if (okBtn) okBtn.addEventListener("click", function () {
        var ph = phone.value.trim();
        var res = Admin.addSub(ph);
        if (!res.ok) { if (note) { note.textContent = res.error; note.className = "auth-note is-error"; } return; }
        phone.value = "";
        addBox.hidden = true;
        renderList();
        if (note) { note.textContent = "已添加：" + ph; note.className = "auth-note"; }
      });
      if (listBtn) listBtn.addEventListener("click", function () { if (addBox) addBox.hidden = true; renderList(); if (note) note.textContent = ""; });
      /* 静态部署管理员口令 */
      var pinBox = document.getElementById("hkAdminPinBox");
      var pinInput = document.getElementById("hkAdminPin");
      var pinBtn = document.getElementById("hkAdminPinBtn");
      var pinHint = document.getElementById("hkAdminPinHint");
      if (pinBtn && pinInput) {
        pinBtn.addEventListener("click", function () {
          var val = pinInput.value.trim();
          if (!val) { if (pinHint) { pinHint.textContent = "请输入口令"; pinHint.className = "auth-note is-error"; } return; }
          if (Admin.hasPin()) {
            Admin.verifyPin(val).then(function (res) {
              if (res.ok) {
                if (pinHint) { pinHint.textContent = "已以最高管理员身份登录 ✓"; pinHint.className = "auth-note is-ok"; }
                pinInput.value = "";
                refresh(); refreshCloud(); if (D && D.bindUserPop) D.bindUserPop();
              } else if (pinHint) { pinHint.textContent = res.error; pinHint.className = "auth-note is-error"; }
            });
          } else {
            Admin.setPin(val).then(function (res) {
              if (res.ok) {
                if (pinHint) { pinHint.textContent = "口令已设置（当前会话已登录为最高管理员）✓"; pinHint.className = "auth-note is-ok"; }
                pinInput.value = "";
                refresh(); refreshCloud();
              } else if (pinHint) { pinHint.textContent = res.error; pinHint.className = "auth-note is-error"; }
            });
          }
        });
      }
      function refreshCloud() {
        var cz = document.getElementById("hkCloudZone");
        if (cz) cz.hidden = !Admin.role();
      }
      /* 云同步区事件 */
      (function () {
        var cSave = document.getElementById("hkCloudSaveBtn");
        var cTest = document.getElementById("hkCloudTestBtn");
        var cPush = document.getElementById("hkCloudPushBtn");
        var cPull = document.getElementById("hkCloudPullBtn");
        function readForm() {
          return {
            token: (document.getElementById("hkCloudToken") || {}).value || "",
            repo: ((document.getElementById("hkCloudRepo") || {}).value || "").trim(),
            branch: ((document.getElementById("hkCloudBranch") || {}).value || "main").trim(),
            path: ((document.getElementById("hkCloudPath") || {}).value || "updream-data/scores.json").trim()
          };
        }
        if (cSave) cSave.addEventListener("click", function () {
          Cloud.saveCfg(readForm());
          Cloud.note(Cloud.isOn() ? "配置已保存 ✓" : "配置已保存（Token 或仓库为空）");
        });
        if (cTest) cTest.addEventListener("click", function () {
          Cloud.saveCfg(readForm());
          Cloud.note("测试连接中…");
          Cloud.test().then(function (res) {
            if (res.ok) Cloud.note("连接成功：" + res.info, "ok");
            else Cloud.note("连接失败：" + (res.error || "未知错误"), "error");
          });
        });
        if (cPush) cPush.addEventListener("click", function () {
          Cloud.saveCfg(readForm());
          if (!Cloud.isOn()) { Cloud.note("请先填写 Token 与仓库", "error"); return; }
          Cloud.note("推送中…");
          Cloud.push().then(function (ok) { if (!ok && !document.getElementById("hkCloudNote").textContent.indexOf("失败")) Cloud.note("推送完成"); });
        });
        if (cPull) cPull.addEventListener("click", function () {
          Cloud.saveCfg(readForm());
          if (!Cloud.isOn()) { Cloud.note("请先填写 Token 与仓库", "error"); return; }
          Cloud.note("拉取中…");
          Cloud.pull().then(function (ok) { if (!ok) Cloud.note("云端暂无数据（或已是最新）"); });
        });
      })();
      var sm = document.getElementById("settingsMask");
      if (sm && window.MutationObserver) {
        new MutationObserver(function () {
          if (sm.classList.contains("show")) refresh();
        }).observe(sm, { attributes: true, attributeFilter: ["class"] });
      }
      Admin.__settingsRefresh = refresh;
      refresh();
      return refresh;
    }
  };

  window.DFH = {
    BASE: BASE,
    KEY_LIST: KEY_LIST, KEY_SEM: KEY_SEM, TOP_KEY: TOP_KEY, NAME12: NAME12, DEG: DEG, MOD_INFO: MOD_INFO,
    TAG_PRESETS: TAG_PRESETS,
    mod12: mod12, pitchName: pitchName, regOf: regOf, degName: degName, keyOfPitch: keyOfPitch,
    isSharpPitch: isSharpPitch, reachable: reachable, autoBaseOctave: autoBaseOctave,
    mapNote: mapNote, modInfo: modInfo,
    jianpuOf: jianpuOf, parseJianpuToken: parseJianpuToken, jianpuToMidi: jianpuToMidi, parsePitchName: parsePitchName,
    parseMidi: parseMidi, buildMidi: buildMidi, guessLeadTrack: guessLeadTrack,
    parseDeltaTxt: parseDeltaTxt, isDeltaTxt: isDeltaTxt, parseNoteTxt: parseNoteTxt,
    txtNotesToMelody: txtNotesToMelody,
    extractMelody: extractMelody, resolveMelody: resolveMelody, buildTupleTxt: buildTupleTxt,
    audio: {
      ensure: ensureAudio, loadSounds: loadSounds, play: playNote, stop: stopAllSounds,
      setVolume: function (v) { hkVolume = v; }, get volume() { return hkVolume; }
    },
    Store: Store, Cloud: Cloud, buildRecord: buildRecord, seedLibrary: seedLibrary, uid: uid,
    formatTime: formatTime, formatClock: formatClock, escapeHtml: escapeHtml, decodeText: decodeText,
    /* 右上角登录展开面板：个人设置 / 管理员管理 / 退出登录 */
    bindUserPop: function () {
      if (window.__hkUserPopBound) return;
      window.__hkUserPopBound = true;
      var pop = document.getElementById("hkUserPop");
      var login = document.getElementById("hkLogin");
      if (!pop || !login) return;
      var av = document.getElementById("hkPopAvatar");
      var nm = document.getElementById("hkPopName");
      var ph = document.getElementById("hkPopPhone");
      var setBtn = document.getElementById("hkPopSettings");
      var outBtn = document.getElementById("hkPopLogout");
      function closePop() { pop.hidden = true; }
      function refreshPop() {
        var u = currentUser();
        if (!u) { closePop(); return; }
        var name = u.name || "用户";
        if (av) av.innerHTML = u.avatar ? '<img src="' + escapeHtml(u.avatar) + '" alt="">' : escapeHtml(name.slice(0, 1));
        if (nm) nm.textContent = name;
        if (ph) ph.textContent = u.phone || "";
      }
      login.addEventListener("click", function (e) {
        e.preventDefault();
        if (!currentUser()) { if (window.authPointer) window.authPointer.open(); return; }
        refreshPop();
        pop.hidden = !pop.hidden;
      });
      document.addEventListener("click", function (e) {
        if (!pop.hidden && !pop.contains(e.target) && !login.contains(e.target)) closePop();
      });
      if (setBtn) setBtn.addEventListener("click", function () {
        closePop();
        if (window.authPointer) window.authPointer.openSettings();
      });
      if (outBtn) outBtn.addEventListener("click", function () {
        closePop();
        if (window.authPointer) window.authPointer.logout();
      });
      refreshPop();
    },
    downloadText: downloadText, downloadBytes: downloadBytes, downloadBlob: downloadBlob,
    currentUser: currentUser, onAuthChange: onAuthChange, Admin: Admin
  };
})();
