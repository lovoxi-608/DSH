/* ═══════════════════════════════════════════════════════════
   口琴谱解析小应用 —— app.js
   · 拖入音频 → 本地解码 → 自相关音高检测 → 三角洲口琴体系映射
   · 键位：z x c v b n m = do re mi fa sol la si（基准八度）；逗号 = 高音 do
   · 修饰（鼠标）：左键 = 低八度(-12) · 右键 = 高八度(+12) · 中键 = 升半音(+1)
   · 可演奏范围 = 基准八度 ±1 八度 + 高高音 do / #do（右键+逗号，带#再加中键）
   · 基准八度自动选择（容纳最多音符）或手动 C3~C7
   · 谱面装饰化展示 + 导出曲谱（小程序可加载）
   · 口琴按键测试台（与《三角洲行动》一致）：钢琴条 / 虚拟键 / 指示灯
   · 试听：真实口琴采样（Hohner Silverstar CC0）+ 每键位自定义音色目录
   ═══════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── 三角洲口琴键位与修饰体系 ── */
  var KEY_LIST = ["z", "x", "c", "v", "b", "n", "m"];   // do..ti
  var KEY_SEM = { z: 0, x: 2, c: 4, v: 5, b: 7, n: 9, m: 11 };  // 各键相对 do 的半音
  var TOP_KEY = ",";                                     // 高高音 do 用键
  var SHARP_PC = [1, 3, 6, 8, 10];                       // 需要中键（升半音）的半音号
  var DIATONIC_INDEX = { 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 };
  var NAME12 = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var DEG = ["do", "#do", "re", "#re", "mi", "fa", "#fa", "sol", "#sol", "la", "#la", "si"];

  /* 六态修饰（槽位 × 升半音） */
  var MOD_INFO = [
    { slot: 0,  sharp: false, label: "基准",           mouse: "不按修饰键",         cls: "hk-mod-mid" },
    { slot: -1, sharp: false, label: "低八度",         mouse: "按住鼠标左键",       cls: "hk-mod-low" },
    { slot: 1,  sharp: false, label: "高八度",         mouse: "按住鼠标右键",       cls: "hk-mod-high" },
    { slot: 0,  sharp: true,  label: "升半音",         mouse: "按住鼠标中键",       cls: "hk-mod-sharp" },
    { slot: -1, sharp: true,  label: "低八度+升半音",  mouse: "按住左键+中键",      cls: "hk-mod-low-sharp" },
    { slot: 1,  sharp: true,  label: "高八度+升半音",  mouse: "按住右键+中键",      cls: "hk-mod-high-sharp" },
  ];

  var state = {
    file: null,
    objectUrl: "",
    audioBuffer: null,
    notes: [],          // 原始音高音符 {midi,start,end,dur,freq}
    baseOct: "auto",    // 基准八度："auto" 或 3..7
    usedBaseOct: 4,     // 实际使用的基准八度
    playing: false,
    truncated: false,
  };

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function hint(text, ms) { if (window.LabHost && LabHost.hint) LabHost.hint(text, ms); }

  function mod12(p) { return ((p % 12) + 12) % 12; }

  /* ── 音高工具（与 NoteMapper.cs 一致） ── */
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

  /* 某个音高在基准=baseOct 下是否可演奏：基准±1 八度 + 高高音 do/#do */
  function reachable(pitch, baseOct) {
    var d = Math.floor(pitch / 12) - 1 - baseOct;
    if (d >= -1 && d <= 1) return true;
    if (d === 2) { var pc = mod12(pitch); return pc === 0 || pc === 1; }
    return false;
  }

  /* 自动选出基准八度：使可演奏区容纳最多音符（均值破平局） */
  function autoBaseOctave(pitches) {
    if (!pitches.length) return 4;
    var minO = 1e9, maxO = -1e9, sumO = 0;
    pitches.forEach(function (p) {
      var o = Math.floor(p / 12) - 1;
      if (o < minO) minO = o;
      if (o > maxO) maxO = o;
      sumO += o;
    });
    var meanO = sumO / pitches.length;
    var bestB = minO, bestPlay = -1;
    for (var b = minO; b <= maxO; b++) {
      var play = 0;
      pitches.forEach(function (p) { if (reachable(p, b)) play++; });
      if (play > bestPlay || (play === bestPlay && Math.abs(b - meanO) < Math.abs(bestB - meanO))) {
        bestPlay = play; bestB = b;
      }
    }
    return bestB;
  }

  /* 音高 → {key, sharp, slot(-1低/0基准/1高/2高高), inRange, skipReason, pitch} */
  function mapNote(midi, baseOct) {
    if (midi < 0 || midi > 127) {
      return { key: " ", sharp: false, slot: 0, inRange: false, skipReason: "移调后超出 MIDI 音域" };
    }
    var oct = Math.floor(midi / 12) - 1;
    var d = oct - baseOct;
    var pc = mod12(midi);
    if (d < -1 || d > 2) {
      return { key: keyOfPitch(midi), sharp: isSharpPitch(midi), slot: 0, inRange: false,
               skipReason: "音区超出口琴可演奏范围（第" + oct + "八度）" };
    }
    if (d === 2) {
      if (pc !== 0 && pc !== 1) {
        return { key: TOP_KEY, sharp: pc === 1, slot: 2, inRange: false,
                 skipReason: "最高只能到 高高音#do" };
      }
      return { key: TOP_KEY, sharp: pc === 1, slot: 2, inRange: true, pitch: midi };
    }
    return { key: keyOfPitch(midi), sharp: isSharpPitch(midi), slot: d, inRange: true, pitch: midi };
  }

  function modInfo(slot, sharp) {
    for (var i = 0; i < MOD_INFO.length; i++) {
      if (MOD_INFO[i].slot === slot && MOD_INFO[i].sharp === !!sharp) return MOD_INFO[i];
    }
    return MOD_INFO[0];
  }

  /* ── 简谱记法（txt 音色格式）：1234567i = z x c v b n m ,；【】=低八度左键；{}=高八度右键；#=升半音中键 ── */
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
    var letter = m[1].toUpperCase();
    var acc = m[2];
    var oct = parseInt(m[3], 10);
    var pc = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[letter];
    if (acc === "#") pc += 1;
    else if (acc === "b") pc -= 1;
    return (oct + 1) * 12 + pc;
  }

  /* ── 音高检测：归一化自相关 ── */
  function corrAt(buf, lag) {
    var N = buf.length, num = 0, a = 0, b = 0;
    for (var i = 0; i < N - lag; i++) {
      var x = buf[i], y = buf[i + lag];
      num += x * y; a += x * x; b += y * y;
    }
    return num / Math.sqrt(a * b + 1e-9);
  }

  function detectPitch(buf, sr) {
    var N = buf.length, i, s = 0;
    for (i = 0; i < N; i++) { var v = buf[i]; s += v * v; }
    if (Math.sqrt(s / N) < 0.005) return 0;
    var minLag = Math.floor(sr / 2000), maxLag = Math.floor(sr / 55);
    var bestLag = -1, best = 0;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var c = corrAt(buf, lag);
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag < 0 || best < 0.80) return 0;
    var c1 = bestLag > minLag ? corrAt(buf, bestLag - 1) : 0;
    var c2 = best;
    var c3 = bestLag < maxLag ? corrAt(buf, bestLag + 1) : 0;
    var denom = c1 - 2 * c2 + c3;
    var delta = Math.abs(denom) > 1e-9 ? 0.5 * (c1 - c3) / denom : 0;
    return sr / (bestLag + delta);
  }

  function freqToMidi(f) { return 69 + 12 * Math.log2(f / 440); }

  /* ── 整段分析：保留原始音高（不做键位折叠） ── */
  function analyze(buffer, onProgress) {
    return new Promise(function (resolve) {
      var ch = buffer.numberOfChannels, len = buffer.length, i, c;
      var mono = new Float32Array(len);
      for (c = 0; c < ch; c++) {
        var d = buffer.getChannelData(c);
        for (i = 0; i < len; i++) mono[i] += d[i] / ch;
      }
      var SR = buffer.sampleRate, TARGET = 8000;
      var step = SR / TARGET, dl = Math.floor(len / step);
      var down = new Float32Array(dl);
      for (i = 0; i < dl; i++) down[i] = mono[Math.floor(i * step)];

      var MAX = TARGET * 180;
      state.truncated = dl > MAX;
      if (state.truncated) down = down.subarray(0, MAX);

      var FRAME = 2048, HOP = 512;
      var frameCount = Math.floor((down.length - FRAME) / HOP) + 1;
      if (frameCount < 1) { resolve([]); return; }

      var frames = new Array(frameCount);
      var idx = 0, BATCH = 80;
      var totalSec = (frameCount * HOP) / TARGET;

      function stepBatch() {
        var end = Math.min(idx + BATCH, frameCount);
        for (var j = idx; j < end; j++) {
          var off = j * HOP;
          frames[j] = detectPitch(down.subarray(off, off + FRAME), TARGET);
        }
        idx = end;
        if (onProgress) onProgress(idx / frameCount, "识别旋律 " + (idx * HOP / TARGET).toFixed(0) + "s / " + totalSec.toFixed(0) + "s");
        if (idx < frameCount) { setTimeout(stepBatch, 0); return; }

        var notes = [], cur = null;
        for (var k = 0; k < frameCount; k++) {
          var f = frames[k], t = k * HOP / TARGET;
          if (f > 0) {
            var midi = freqToMidi(f);
            if (cur && Math.abs(cur.midi - midi) < 0.5 && (t - cur.end) < 0.20) {
              cur.end = t + HOP / TARGET;
              cur.dur = cur.end - cur.start;
              cur.freq = f;
              cur.midi = (cur.midi * (cur.dur - HOP / TARGET) / cur.dur) + (midi * HOP / TARGET / cur.dur);
            } else {
              if (cur) notes.push(cur);
              cur = { midi: midi, start: t, end: t + HOP / TARGET, dur: HOP / TARGET, freq: f };
            }
          } else {
            if (cur) { notes.push(cur); cur = null; }
          }
        }
        if (cur) notes.push(cur);
        notes = notes.filter(function (n) { return n.dur >= 0.07; });
        /* 计算每个音符的间隔（到下一音符的开始间隔，ms；最后一个取自身时长） */
        notes.forEach(function (n, i) {
          if (i < notes.length - 1) {
            n.gap = Math.max(50, Math.round((notes[i + 1].start - n.start) * 1000));
          } else {
            n.gap = Math.max(100, Math.round(n.dur * 1000));
          }
        });
        resolve(notes);
      }
      stepBatch();
    });
  }

  /* ── 真实口琴音色（Hohner Silverstar · CC0 公共领域） ── */
  var audioCtx = null, activeSources = [], playTimers = [];
  var SOUND_BASE = "/assets/lab/sounds/";      // 内置采样目录（060=C4 / 064=E4 / 067=G4 / 072=C5）
  var SOUND_SAMPLES = [60, 64, 67, 72];        // 内置采样对应的 MIDI
  var KEY_FILE = { z: "z", x: "x", c: "c", v: "v", b: "b", n: "n", m: "m", ",": "comma" };
  var hkBaseSamples = {};   // midi -> AudioBuffer（内置）
  var hkKeySamples = {};    // keyIdx -> AudioBuffer（用户每键位音色）

  function ensureAudio() {
    if (!audioCtx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended" && audioCtx.resume) audioCtx.resume();
    return audioCtx;
  }

  function setSoundStatus(txt) {
    var el = $("#hkSoundStatus");
    if (el) el.textContent = txt;
  }

  function loadAudioFile(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.arrayBuffer();
    }).then(function (ab) {
      var ctx = ensureAudio();
      if (!ctx) return null;
      return new Promise(function (res, rej) { ctx.decodeAudioData(ab, res, rej); });
    });
  }

  /* 加载内置采样 + 用户每键位音色（用户目录里的 z/x/c/v/b/n/m/comma.* 优先） */
  function loadHarmonicaSounds(baseDir) {
    hkBaseSamples = {};
    hkKeySamples = {};
    var ctx = ensureAudio();
    if (!ctx) { setSoundStatus("浏览器不支持 WebAudio 试听"); return; }
    setSoundStatus("真实口琴采样：加载中…");
    var dir = String(baseDir || SOUND_BASE).replace(/[\\/]?$/, "/");
    var jobs = [];
    SOUND_SAMPLES.forEach(function (m) {
      var fname = ("00" + m).slice(-3) + ".wav";   // 采样文件为三位补零命名：060.wav / 064.wav ...
      jobs.push(loadAudioFile(SOUND_BASE + fname).then(function (b) {
        if (b) hkBaseSamples[m] = b;
      }).catch(function () { }));
    });
    ["z", "x", "c", "v", "b", "n", "m", "comma"].forEach(function (name, idx) {
      ["mp3", "wav", "ogg", "m4a"].forEach(function (ext) {
        jobs.push(loadAudioFile(dir + name + "." + ext).then(function (b) {
          if (b) hkKeySamples[idx] = b;
        }).catch(function () { }));
      });
    });
    Promise.all(jobs).then(function () {
      var nBase = 0, nKey = 0, keys = [];
      for (var k in hkBaseSamples) nBase++;
      for (var kk in hkKeySamples) { nKey++; keys.push(KEY_LIST[Number(kk)] || ","); }
      if (nKey > 0) {
        setSoundStatus("自定义键位音色 " + nKey + "/8（" + keys.join(" ") + "）· 内置采样 " + nBase + " 个备用");
      } else if (nBase > 0) {
        setSoundStatus("内置真实口琴采样 " + nBase + " 个就绪（C4/E4/G4/C5 · CC0）");
      } else {
        setSoundStatus("口琴采样加载失败，试听改用合成音色兜底");
      }
    });
  }

  /* 选取音色：优先用户每键位音色（键位自然音高精确匹配），否则最近内置采样 + 变速。
     变速范围 ±2 八度（0.25~5.0 倍），保证覆盖游戏全部可演奏区（基准±1 八度 + 高高音 do/#do，
     即从低八度最低 C 到高高音#do），高音区不再被压成同一个音。 */
  function pickSample(midi) {
    for (var i = 0; i < KEY_LIST.length + 1; i++) {
      var ch = i < KEY_LIST.length ? KEY_LIST[i] : TOP_KEY;
      var sem = i < KEY_LIST.length ? KEY_SEM[ch] : 0;
      var oct = Math.floor(midi / 12) - 1;
      var nat = oct * 12 + sem;
      if (midi === nat && hkKeySamples[i]) return { buf: hkKeySamples[i], rate: 1 };
    }
    var mids = [];
    for (var m in hkBaseSamples) mids.push(Number(m));
    if (!mids.length) return null;
    var best = mids[0];
    for (var j = 1; j < mids.length; j++) {
      if (Math.abs(mids[j] - midi) < Math.abs(best - midi)) best = mids[j];
    }
    var rate = Math.pow(2, (midi - best) / 12);
    rate = Math.max(0.25, Math.min(5.0, rate));
    return { buf: hkBaseSamples[best], rate: rate };
  }

  /* 合成兜底（采样不可用时） */
  function playSynthFallback(midi, dur, when, vol) {
    var ctx = audioCtx;
    if (!ctx) return;
    var v = (vol === undefined) ? hkVolume : vol;
    var t0 = when || (ctx.currentTime + 0.03);
    var freq = 440 * Math.pow(2, (midi - 69) / 12);
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.5 * v, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.2 * v, t0 + 0.14);
    g.gain.setValueAtTime(0.2 * v, t0 + Math.max(0.05, dur - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.08);
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = freq * 4; lp.Q.value = 0.8;
    var o1 = ctx.createOscillator(); o1.type = "sawtooth"; o1.frequency.value = freq;
    var o2 = ctx.createOscillator(); o2.type = "triangle"; o2.frequency.value = freq * 2;
    var g2 = ctx.createGain(); g2.gain.value = 0.28;
    o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(ctx.destination);
    o1.start(t0); o2.start(t0);
    o1.stop(t0 + dur + 0.1); o2.stop(t0 + dur + 0.1);
    activeSources.push(o1, o2);
  }

  var hkVolume = 0.2;  /* 口琴演奏音量 0~1（默认 20%） */

  function playHarmonicaNote(midi, dur, when) {
    var ctx = ensureAudio();
    if (!ctx) return;
    var vol = hkVolume;
    var src = pickSample(midi);
    if (!src) { playSynthFallback(midi, dur || 0.5, when, vol); return; }
    var t0 = when || (ctx.currentTime + 0.03);
    var d = Math.max(0.18, dur || 0.5);
    var s = ctx.createBufferSource();
    s.buffer = src.buf;
    s.playbackRate.value = src.rate;
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.9 * vol, t0 + 0.012);
    g.gain.setValueAtTime(0.9 * vol, t0 + Math.max(0.04, d - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t0 + d + 0.15);
    s.connect(g); g.connect(ctx.destination);
    s.start(t0); s.stop(t0 + d + 0.2);
    activeSources.push(s);
  }

  /* ── 渲染 ── */
  function clearHighlight() {
    $$(".hk-note.hk-note-playing").forEach(function (el) { el.classList.remove("hk-note-playing"); });
  }
  function highlightNote(idx) {
    clearHighlight();
    var el = document.querySelector('.hk-note[data-index="' + idx + '"]');
    if (el) el.classList.add("hk-note-playing");
  }

  function renderScore() {
    var score = $("#hkScore");
    score.innerHTML = "";
    var notes = state.notes;
    if (!notes.length) {
      score.innerHTML = '<div class="hk-empty-tip">没有识别到清晰的旋律音符 —— 试试更“干净”的人声或器乐旋律</div>';
      $("#hkResultMeta").textContent = "未识别到音符";
      $("#hkNoteCount").textContent = "0 个音符";
      return;
    }
    var pitches = notes.map(function (n) { return Math.round(n.midi); });
    state.usedBaseOct = state.baseOct === "auto" ? autoBaseOctave(pitches) : state.baseOct;
    var baseOct = state.usedBaseOct;

    var frag = document.createDocumentFragment();
    var skipped = 0;
    notes.forEach(function (n, i) {
      var m = mapNote(Math.round(n.midi), baseOct);
      var mod = modInfo(m.slot, m.sharp);

      var el = document.createElement("div");
      el.className = "hk-note" + (m.inRange ? "" : " hk-note-skip");
      el.dataset.index = i;
      el.dataset.pitch = m.pitch || 0;

      var wrap = document.createElement("div");
      wrap.className = "hk-keywrap" + (m.slot === 2 ? " hk-keywrap-top" : m.slot > 0 ? " hk-high" : m.slot < 0 ? " hk-low" : "");
      var ch = document.createElement("span");
      ch.className = "hk-keychar";
      ch.textContent = m.key === "," ? "，" : m.key.toUpperCase();
      wrap.appendChild(ch);

      var modEl = document.createElement("span");
      modEl.className = "hk-mod " + mod.cls;
      modEl.textContent = m.inRange ? mod.label : "跳过";
      modEl.title = m.inRange ? mod.mouse : m.skipReason;

      var nm = document.createElement("span");
      nm.className = "hk-note-name";
      nm.textContent = m.inRange ? (jianpuOf(m.key, m.slot, m.sharp) + " · " + regOf(m.pitch, baseOct) + degName(m.pitch) + " " + pitchName(m.pitch)) : "—";

      var dr = document.createElement("span");
      dr.className = "hk-note-dur";
      dr.textContent = "↳ " + n.gap + "ms";
      dr.title = "到下一音的间隔 " + n.gap + "ms（本音时长 " + (n.dur * 1000).toFixed(0) + "ms）";

      el.appendChild(wrap); el.appendChild(modEl); el.appendChild(nm); el.appendChild(dr);
      el.title = "第 " + (i + 1) + " 音 · 简谱 " + (m.inRange ? jianpuOf(m.key, m.slot, m.sharp) : "—") +
        " · 按键 " + (m.key === "," ? "，[高音do]" : m.key) +
        (m.inRange ? " · " + mod.label + "（" + mod.mouse + "）· " + pitchName(m.pitch) + "（" + regOf(m.pitch, baseOct) + "音区）" : " · " + m.skipReason) +
        " · 间隔 " + n.gap + "ms（时长 " + (n.dur * 1000).toFixed(0) + "ms）";
      if (!m.inRange) skipped++;
      frag.appendChild(el);
    });
    score.appendChild(frag);

    var total = (notes[notes.length - 1].end - notes[0].start).toFixed(1);
    $("#hkResultMeta").textContent = "识别到 " + notes.length + " 个音符 · 旋律时长约 " + total + "s · 基准八度 C" + baseOct +
      (state.baseOct === "auto" ? "（自动选择）" : "（手动）") + " · 键位 z x c v b n m ," +
      (skipped ? " · 跳过 " + skipped + " 音" : "") +
      (state.truncated ? "（仅前 3 分钟）" : "");
    $("#hkNoteCount").textContent = notes.length + " 个音符" + (skipped ? "（跳过 " + skipped + "）" : "");
    $("#hkKey").textContent = "基准八度 C" + baseOct;
    updateOctButtons();
  }

  function updateOctButtons() {
    $$(".hk-octbtn").forEach(function (b) {
      b.classList.toggle("active", String(state.baseOct) === b.dataset.oct);
    });
  }

  function stopScore() {
    if (audioCtx) {
      var now = audioCtx.currentTime;
      activeSources.forEach(function (s) { try { s.stop(now); } catch (e) { } });
    }
    activeSources = [];
    playTimers.forEach(clearTimeout); playTimers = [];
    clearHighlight();
    state.playing = false;
    updatePlayButtons();
  }

  function playScore() {
    stopScore();
    var notes = state.notes;
    if (!notes.length) return;
    var ctx = ensureAudio();
    if (!ctx) return;
    var pitches = notes.map(function (n) { return Math.round(n.midi); });
    state.usedBaseOct = state.baseOct === "auto" ? autoBaseOctave(pitches) : state.baseOct;
    var baseOct = state.usedBaseOct;
    var first = notes[0].start, startAt = ctx.currentTime + 0.15;
    var played = 0;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      var m = mapNote(Math.round(n.midi), baseOct);
      if (!m.inRange) continue;
      playHarmonicaNote(m.pitch, Math.max(0.16, n.dur), startAt + (n.start - first));
      (function (idx, offMs) {
        playTimers.push(setTimeout(function () { highlightNote(idx); }, offMs));
      })(i, (n.start - first) * 1000 + 60);
      played++;
    }
    playTimers.push(setTimeout(function () { clearHighlight(); }, ((notes[notes.length - 1].end - first) * 1000) + 400));
    state.playing = true;
    updatePlayButtons();
    hint("试听中：" + played + " 个可演奏音符（跳过 " + (notes.length - played) + "）", 2400);
  }

  function updatePlayButtons() {
    $("#hkPlay").disabled = state.playing;
    $("#hkStop").disabled = !state.playing;
  }

  /* ── 文件处理 ── */
  function formatSize(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(2) + " MB";
  }

  function resetResult() {
    stopScore();
    state.notes = [];
    state.baseOct = "auto";
    $("#hkResult").hidden = true;
  }

  function setFile(file) {
    if (!file) return;
    var ok = /^audio\//.test(file.type) || /\.(mp3|wav|m4a|ogg|flac|aac|webm|opus|wma)$/i.test(file.name);
    if (!ok) { hint("请选择音频文件（mp3 / wav / m4a / ogg 等）", 3200); return; }
    state.file = file;
    state.audioBuffer = null;
    $("#hkFileName").textContent = file.name;
    $("#hkFileSize").textContent = formatSize(file.size);
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = URL.createObjectURL(file);
    $("#hkPlayer").src = state.objectUrl;
    $("#hkFilebar").hidden = false;
    $("#hkDrop").hidden = true;
    $("#hkParse").disabled = false;
    $("#hkCtaSub").textContent = "点击「开始解析」，自动识别旋律并按三角洲口琴体系映射";
    resetResult();
  }

  function decode(buf) {
    try {
      var p = audioCtx.decodeAudioData(buf);
      if (p && typeof p.then === "function") return p;
    } catch (e) { }
    return new Promise(function (res, rej) { audioCtx.decodeAudioData(buf, res, rej); });
  }

  function startParse() {
    var file = state.file;
    if (!file) return;
    resetResult();
    var btn = $("#hkParse");
    btn.disabled = true;
    $("#hkProgress").hidden = false;
    setProgress(0, "解码中…");

    var reader = new FileReader();
    reader.onload = function () {
      ensureAudio();
      decode(reader.result).then(function (buf) {
        state.audioBuffer = buf;
        analyze(buf, setProgress).then(function (notes) {
          state.notes = notes;
          btn.disabled = false;
          $("#hkProgress").hidden = true;
          $("#hkResult").hidden = false;
          renderScore();
          $("#hkResult").scrollIntoView({ behavior: "smooth", block: "start" });
          if (notes.length) hint("解析完成：" + notes.length + " 个音符", 2600);
          else hint("没识别到清晰旋律，换一段试试", 3200);
        });
      }, function () {
        btn.disabled = false;
        $("#hkProgress").hidden = true;
        hint("解码失败：文件可能已损坏或格式不支持", 3200);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  function setProgress(p, txt) {
    var bar = $("#hkProgressBar");
    if (bar) bar.style.setProperty("width", Math.round(p * 100) + "%", "important");
    var t = $("#hkProgressText");
    if (t) t.textContent = txt || "解析中…";
  }

  /* ── 导出曲谱（v2.1 简谱·持续·间隔格式：("1","200ms","100ms","2","150ms","80ms")） ── */
  function exportScore() {
    var notes = state.notes;
    if (!notes.length) { hint("还没有可导出的曲谱", 2200); return; }
    var name = ($("#hkScoreName") && $("#hkScoreName").value.trim()) || "未命名曲目";
    var pitches = notes.map(function (n) { return Math.round(n.midi); });
    state.usedBaseOct = state.baseOct === "auto" ? autoBaseOctave(pitches) : state.baseOct;
    var baseOct = state.usedBaseOct;

    /* 只导出可演奏音，并按相邻可演奏音重新计算间隔 */
    var playable = [];
    notes.forEach(function (n) {
      var m = mapNote(Math.round(n.midi), baseOct);
      if (m.inRange) playable.push({ n: n, m: m });
    });
    if (!playable.length) { hint("没有可演奏的音符（全部超出可演奏范围），无法导出", 3200); return; }

    var pairs = [];
    for (var i = 0; i < playable.length; i++) {
      var p = playable[i];
      var dur = Math.max(50, Math.round(p.n.dur * 1000));
      var gap;
      if (i < playable.length - 1) {
        gap = Math.max(50, Math.round((playable[i + 1].n.start - p.n.start) * 1000));
      } else {
        gap = Math.max(100, Math.round(p.n.dur * 1000));
      }
      var jp = jianpuOf(p.m.key, p.m.slot, p.m.sharp);
      pairs.push('"' + jp + '","' + dur + 'ms","' + gap + 'ms"');
    }
    var line = "(" + pairs.join(",") + ")";

    var lines = [
      "# 口琴谱 v2.1 · 简谱·持续·间隔（拖入网页「乐谱视窗」可视化编辑 / 自动演奏）",
      "曲名: " + name,
      "基准八度: " + baseOct,
      "# 每音三个值：音阶, 持续时间(ms), 到下一音间隔(ms)",
      "# 记法：1234567i = do re mi fa sol la si 高音do（键 z x c v b n m ,）；【】=低八度（按住左键）；{}=高八度（按住右键）；#=升半音（按住中键）",
      "# 示例：(\"1\",\"200ms\",\"100ms\",\"2\",\"150ms\",\"80ms\",\"【5】\",\"300ms\",\"120ms\",\"{i}\",\"400ms\",\"200ms\")",
      line
    ];
    var text = lines.join("\n");
    var blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    hint("已导出 " + name + ".txt（" + playable.length + " 音 · 简谱·持续·间隔格式）", 3000);
  }

  /* ════════ 口琴按键测试台（依照《三角洲行动》测试台实现） ════════ */
  var rig = {
    baseOct: 5,        // 中音do 所在八度（测试台独立演示，默认 C5）
    shift: 0,          // -1 左键 / 0 默认 / +1 右键
    sharp: false,      // 中键
    held: [],          // 正在按住的物理键（后按的优先，单音）
  };
  var rigNote = { osc: null, gain: null, pitch: 0, on: false };

  function rigPitchFrom(key) {
    var pc = KEY_SEM[key] !== undefined ? KEY_SEM[key] : 0;
    var oct = (key === TOP_KEY) ? rig.baseOct + rig.shift + 1 : rig.baseOct + rig.shift;
    var p = (oct + 1) * 12 + pc;
    if (rig.sharp) p += 1;
    return p;
  }
  function rigActiveKey() { return rig.held.length ? rig.held[rig.held.length - 1] : null; }
  function rigPianoHighlight(p) {
    $$("#rigPiano .pk").forEach(function (el) {
      el.classList.toggle("on", p !== null && parseInt(el.dataset.p, 10) === p);
    });
  }
  function rigRefresh() {
    var key = rigActiveKey();
    var combo = "";
    if (key) {
      var p = rigPitchFrom(key);
      var reg = regOf(p, rig.baseOct);
      $("#rigNowName").textContent = reg + degName(p) + "  " + pitchName(p);
      var mods = [];
      if (rig.shift === -1) mods.push("按住左键");
      else if (rig.shift === 1) mods.push("按住右键");
      if (rig.sharp) mods.push("中键(升半音)");
      mods.push(key === "," ? "键[，]" : "键[" + key.toUpperCase() + "]");
      combo = "按下 " + mods.join(" + ") + " = " + pitchName(p) + "（" + reg + "音区）";
      rigPianoHighlight(p);
    } else {
      $("#rigNowName").textContent = "—";
      combo = "等待按键…";
      rigPianoHighlight(null);
    }
    $("#rigNowCombo").textContent = combo;
    $("#lampL").classList.toggle("on-left", rig.shift === -1);
    $("#lampR").classList.toggle("on-right", rig.shift === 1);
    $("#lampM").classList.toggle("on-mid", rig.sharp);
    $$("#rigKeys .gkey").forEach(function (el) {
      el.classList.toggle("down", rig.held.indexOf(el.dataset.key) >= 0);
    });
  }
  function rigVoiceStart(p) {
    if ($("#rigMute").checked) return;
    playHarmonicaNote(p, 0.5);
    rigNote.pitch = p; rigNote.on = true;
  }
  function rigPressKey(key) {
    if (swin.playing) swinStop(false);
    ensureAudio();
    if (rig.held.indexOf(key) < 0) rig.held.push(key);
    rigVoiceStart(rigPitchFrom(key));
    rigRefresh();
  }
  function rigReleaseKey(key) {
    var i = rig.held.indexOf(key);
    if (i >= 0) rig.held.splice(i, 1);
    rigRefresh();
    if (rig.held.length) rigVoiceStart(rigPitchFrom(rigActiveKey()));
  }
  /* 鼠标修饰键容错：鼠标输入结束后延迟 90ms 再应用，快速切换时只取最终稳定状态，防止连续串音 */
  var rigModTimer = null;
  var rigPending = { shift: 0, sharp: false };
  var RIG_MOD_DELAY = 90;
  function rigScheduleMods() {
    clearTimeout(rigModTimer);
    rigModTimer = setTimeout(function () {
      rig.shift = rigPending.shift;
      rig.sharp = rigPending.sharp;
      rigRefresh();
      if (rig.held.length) {
        stopScore();
        rigVoiceStart(rigPitchFrom(rigActiveKey()));
      }
    }, RIG_MOD_DELAY);
  }
  function rigUpdateMods() {
    /* 立即刷新 UI 显示，但发声走容错延迟 */
    rig.shift = rigPending.shift;
    rig.sharp = rigPending.sharp;
    rigRefresh();
    rigScheduleMods();
  }
  function rigReleaseAll() {
    rig.held = [];
    rig.shift = 0;
    rig.sharp = false;
    rigPending.shift = 0;
    rigPending.sharp = false;
    clearTimeout(rigModTimer);
    stopScore();
    rigRefresh();
  }
  function rigBtnState(button) {
    return button === 1 ? "middle" : button === 2 ? "right" : button === 0 ? "left" : null;
  }
  function rigBuildKeys() {
    var box = $("#rigKeys");
    box.innerHTML = "";
    var names = { z: "do", x: "re", c: "mi", v: "fa", b: "sol", n: "la", m: "si", ",": "高do" };
    KEY_LIST.concat([TOP_KEY]).forEach(function (k) {
      var d = document.createElement("div");
      d.className = "gkey";
      d.dataset.key = k;
      var k2 = k === "," ? "，" : k.toUpperCase();
      d.innerHTML = "<kbd>" + k2 + "</kbd><span class='nm'>" + names[k] + "</span>";
      d.addEventListener("pointerdown", function (ev) { ev.preventDefault(); rigPressKey(k); });
      d.addEventListener("pointerup", function () { rigReleaseKey(k); });
      d.addEventListener("pointerleave", function () { rigReleaseKey(k); });
      box.appendChild(d);
    });
  }
  function rigRebuildStrip() {
    var strip = $("#rigPiano");
    strip.innerHTML = "";
    var minP = (rig.baseOct + 1 - 1) * 12;       // 低音do
    var maxP = (rig.baseOct + 1 + 2) * 12 + 1;   // 高高音#do
    for (var p = minP; p <= maxP; p++) {
      var el = document.createElement("div");
      el.className = "pk" + (NAME12[mod12(p)].indexOf("#") >= 0 ? " sharps" : "");
      var reg = regOf(p, rig.baseOct);
      if (reg === "低") el.classList.add("reg-low");
      else if (reg === "高") el.classList.add("reg-high");
      else if (reg === "高高") el.classList.add("reg-top");
      el.dataset.p = p;
      el.textContent = pitchName(p);
      el.title = reg + degName(p) + " (" + pitchName(p) + ")";
      strip.appendChild(el);
    }
  }
  function rigInit() {
    var sel = $("#rigBaseSel");
    for (var o = 3; o <= 7; o++) {
      var op = document.createElement("option");
      op.value = o; op.textContent = "C" + o;
      if (o === rig.baseOct) op.selected = true;
      sel.appendChild(op);
    }
    sel.addEventListener("change", function (e) {
      rig.baseOct = parseInt(e.target.value, 10);
      rigReleaseAll();
      rigRebuildStrip();
      rigRefresh();
    });
    $("#rigClear").addEventListener("click", rigReleaseAll);

    /* 键盘：z x c v b n m , 实时按键（焦点在输入框时忽略） */
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var k = (e.key || "").toLowerCase();
      if (k === "，" || k === ",") k = ",";
      if (KEY_LIST.indexOf(k) >= 0 || k === TOP_KEY) {
        e.preventDefault();
        if (!e.repeat) rigPressKey(k);
      }
    });
    document.addEventListener("keyup", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      var k = (e.key || "").toLowerCase();
      if (k === "，" || k === ",") k = ",";
      if (KEY_LIST.indexOf(k) >= 0 || k === TOP_KEY) { e.preventDefault(); rigReleaseKey(k); }
    });
    window.addEventListener("blur", rigReleaseAll);

    /* 鼠标修饰：仅测试台卡片区域内生效（左=低八度 / 右=高八度 / 中=升半音），输入结束后延迟容错 */
    var card = $("#hkRig");
    card.addEventListener("mousedown", function (e) {
      var b = rigBtnState(e.button);
      if (b === "left") rigPending.shift = -1;
      else if (b === "right") { rigPending.shift = 1; e.preventDefault(); }
      else if (b === "middle") { rigPending.sharp = true; e.preventDefault(); }
      else return;
      ensureAudio();
      rigUpdateMods();
    });
    card.addEventListener("mouseup", function (e) {
      var b = rigBtnState(e.button);
      if (b === "left") rigPending.shift = 0;
      else if (b === "right") { if (rigPending.shift === 1) rigPending.shift = 0; e.preventDefault(); }
      else if (b === "middle") { rigPending.sharp = false; e.preventDefault(); }
      else return;
      rigUpdateMods();
    });
    card.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    rigBuildKeys();
    rigRebuildStrip();
    rigRefresh();
  }

  /* ── 事件绑定 ── */
  function bindEvents() {
    var drop = $("#hkDrop"), input = $("#hkFile");
    drop.addEventListener("click", function () { input.click(); });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); }
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("hk-dragover"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("hk-dragover"); });
    });
    drop.addEventListener("drop", function (e) { setFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]); });
    input.addEventListener("change", function () { setFile(input.files && input.files[0]); });
    $("#hkRechoose").addEventListener("click", function () {
      $("#hkFilebar").hidden = true;
      $("#hkDrop").hidden = false;
      $("#hkParse").disabled = true;
      $("#hkCtaSub").textContent = "请先拖入一个音频文件";
    });

    $("#hkParse").addEventListener("click", startParse);
    $("#hkExport").addEventListener("click", exportScore);

    /* 基准八度面板：自动 / C3~C7 */
    $$(".hk-octbtn").forEach(function (b) {
      b.addEventListener("click", function () {
        stopScore();
        state.baseOct = b.dataset.oct === "auto" ? "auto" : Number(b.dataset.oct);
        renderScore();
      });
    });

    /* 音符卡片点击试音 */
    $("#hkScore").addEventListener("click", function (e) {
      var note = e.target.closest ? e.target.closest(".hk-note") : null;
      if (!note || !note.dataset.pitch || Number(note.dataset.pitch) === 0) return;
      playHarmonicaNote(Number(note.dataset.pitch), 0.5);
    });
    $("#hkScore").addEventListener("contextmenu", function (e) { e.preventDefault(); });

    $("#hkPlay").addEventListener("click", playScore);
    $("#hkStop").addEventListener("click", stopScore);

    /* 音色目录：应用并记住 */
    var dirInput = $("#hkSoundDir");
    try {
      if (localStorage.getItem("hkSoundDir")) dirInput.value = localStorage.getItem("hkSoundDir");
    } catch (e) { }
    $("#hkSoundApply").addEventListener("click", function () {
      var dir = (dirInput.value || SOUND_BASE).trim() || SOUND_BASE;
      try { localStorage.setItem("hkSoundDir", dir); } catch (e) { }
      loadHarmonicaSounds(dir);
    });
  }

  /* ════════ 乐谱视窗（拖入 txt → 按键顺序 → 自动演奏） ════════ */
  var swin = {
    notes: [],       // [{name, midi, gap, key, slot, sharp, inRange, base, jp, dur}]
    base: "auto",
    playing: false,
    timer: null,
    idx: 0,
    lastAppendStart: 0,  /* 上次打拍追加的起始索引：非续写模式只替换从这里到末尾的一段 */
  };

  /* ── 三角洲小节谱 txt 解析（《前前前世》格式）→ 三元组 notes ──
     格式：
       前前前世 — 三角洲口琴谱
       BPM 190 · 503 音符 · 118 小节 · 移调 -6
       小节   1 (4/4)
         简谱  1 4  5
         键位  Z V  B
         节奏  4 4· 8
     节奏记号：数字=几分音符时值（1全/2二分/4四分/8八分/16十六分），·=附点×1.5；
               b 后缀（如 3.5b）表示拍数（该音延长）；— 空小节休止 */
  /* 三角洲节奏记号 → 拍数（以四分音符为 1 拍） */
  function deltaBeats(tok) {
    tok = String(tok).trim();
    if (!tok || tok === "—" || tok === "－" || tok === "-") return 1;
    /* Nb：数字直接为拍数，可跨小节延长（如 3.5b / 6b） */
    var bm = tok.match(/^([0-9]+(?:\.[0-9]+)?)\s*b$/i);
    if (bm) return parseFloat(bm[1]);
    var dotted = tok.indexOf("·") >= 0;
    var base = tok.replace(/·/g, "").trim();
    var map = { "1": 4, "2": 2, "4": 1, "8": 0.5, "16": 0.25, "32": 0.125 };
    var beats = Object.prototype.hasOwnProperty.call(map, base) ? map[base] : parseFloat(base);
    if (isNaN(beats) || beats <= 0) beats = 1;
    if (dotted) beats *= 1.5;       /* 附点 ×1.5 */
    return beats;
  }

  /* 三角洲小节谱 → 音符序列
     采用绝对时间轴：每个小节按小节号对齐理论边界，空小节整段休止，
     b 长音可跨小节延续；gap = 下一音起点 − 本音起点，因此长停顿/空小节
     造成的长间隔会自然落到前一音的 gap 上，不会丢失。 */
  function parseDeltaTxt(text) {
    var bpm = 190;
    var bpmM = String(text).match(/BPM\s*[:：]?\s*(\d+)/i);
    if (bpmM) bpm = parseInt(bpmM[1], 10);
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
    /* 键位 token（Z/V/B/N#/M-/,+ 等）→ 简谱记法（1..7/i/#/【】/{}） */
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
    return notes;
  }
  /* 判断文本是否为三角洲小节谱格式 */
  function isDeltaTxt(text) {
    return /^\s*小节\s*\d+/m.test(text) && /简谱/.test(text) && /节奏/.test(text);
  }

  function parseNoteTxt(text) {
    if (!text) return [];
    var raw = String(text)
      .replace(/[\u201c\u201d\u2018\u2019]/g, '"')
      .replace(/[，；]/g, ",");
    /* 提取所有 ( ... ) 块内的 token */
    var blocks = raw.match(/\(([^)]*)\)/g) || [];
    var tokens = [];
    blocks.forEach(function (b) {
      var inner = b.slice(1, -1);
      var parts = inner.split(",").map(function (s) {
        return s.trim().replace(/^["']|["']$/g, "");
      }).filter(Boolean);
      tokens = tokens.concat(parts);
    });
    /* 没有括号时按逗号/空白直接切分（兼容） */
    if (!tokens.length) {
      tokens = raw.split(/[\s,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
    }
    function parseMs(s) {
      var v = parseInt(String(s).replace(/[^0-9]/g, ""), 10);
      return (isNaN(v) || v < 10) ? 200 : v;
    }
    var notes = [];
    /* 三元组：音阶, 持续ms, 间隔ms；兼容旧二元组：音阶, 间隔ms（持续=间隔*0.8） */
    var i = 0;
    while (i < tokens.length) {
      var pitchTok = tokens[i];
      var dur = 200, gap = 200;
      if (i + 2 < tokens.length && /ms$/i.test(tokens[i + 2])) {
        /* 三元组 */
        dur = parseMs(tokens[i + 1]);
        gap = parseMs(tokens[i + 2]);
        i += 3;
      } else if (i + 1 < tokens.length) {
        /* 旧二元组 */
        gap = parseMs(tokens[i + 1]);
        dur = Math.max(50, Math.round(gap * 0.8));
        i += 2;
      } else {
        i += 1;
      }
      var jp = parseJianpuToken(pitchTok);
      var midi = null, name = pitchTok;
      if (jp) {
        name = jianpuOf(jp.key, jp.slot, jp.sharp);
      } else {
        midi = parsePitchName(pitchTok);
        if (midi === null) continue;
        name = pitchName(midi);
      }
      notes.push({ name: name, midi: midi, jp: jp, dur: dur, gap: gap });
    }
    return notes;
  }

  function swinResolve() {
    var namedMidis = swin.notes.filter(function (n) { return n.midi !== null; }).map(function (n) { return n.midi; });
    var base = swin.base === "auto"
      ? (namedMidis.length ? autoBaseOctave(namedMidis) : 5)
      : parseInt(swin.base, 10);
    swin.notes.forEach(function (n) {
      if (n.jp) {
        n.midi = jianpuToMidi(n.jp.key, n.jp.slot, n.jp.sharp, base);
        n.key = n.jp.key; n.slot = n.jp.slot; n.sharp = n.jp.sharp; n.inRange = true;
      } else {
        var m = mapNote(n.midi, base);
        n.key = m.key; n.slot = m.slot; n.sharp = m.sharp; n.inRange = m.inRange;
      }
      n.base = base;
    });
  }

  function renderSwinKeys() {
    var box = $("#swinKeys");
    box.innerHTML = "";
    if (!swin.notes.length) {
      box.innerHTML = '<div class="hk-swin-empty">拖入或粘贴 txt 后自动解析为按键顺序…</div>';
      $("#swinPlay").disabled = true; $("#swinStop").disabled = true;
      $("#swinMeta").textContent = ""; $("#swinStatus").textContent = "等待曲谱…";
      return;
    }
    var frag = document.createDocumentFragment();
    swin.notes.forEach(function (n, i) {
      var el = document.createElement("div");
      el.className = "hk-swin-key" + (n.inRange ? "" : " hk-swin-skip");
      el.dataset.idx = i;
      var k = document.createElement("span");
      k.className = "hk-swin-kchar";
      k.textContent = n.inRange ? (n.key === "," ? "，" : n.key.toUpperCase()) : "—";
      var mod = document.createElement("span");
      mod.className = "hk-swin-kmod " + (n.inRange ? modInfo(n.slot, n.sharp).cls : "hk-mod-skip");
      mod.textContent = n.inRange ? modInfo(n.slot, n.sharp).label : "跳过";
      var nm = document.createElement("span");
      nm.className = "hk-swin-knm";
      nm.textContent = n.name + (n.inRange ? " · " + pitchName(n.midi) : "");
      var gp = document.createElement("span");
      gp.className = "hk-swin-kgap";
      gp.textContent = "⏱ " + n.dur + " / ↳ " + n.gap + "ms";
      gp.title = "持续 " + n.dur + "ms · 到下一音间隔 " + n.gap + "ms";
      el.appendChild(k); el.appendChild(mod); el.appendChild(nm); el.appendChild(gp);
      frag.appendChild(el);
    });
    box.appendChild(frag);
    var playable = swin.notes.filter(function (n) { return n.inRange; }).length;
    $("#swinMeta").textContent = "共 " + swin.notes.length + " 音 · 可演奏 " + playable +
      (swin.notes[0] ? " · 基准 C" + swin.notes[0].base : "");
    $("#swinPlay").disabled = playable === 0;
    $("#swinStatus").textContent = playable ? "已解析，可自动演奏" : "无可演奏音";
  }

  function swinParse() {
    var text = $("#swinTxt").value;
    var fmt = getSelFormat();
    if (fmt === "delta" || (fmt === "harmonica" && isDeltaTxt(text))) {
      swin.notes = parseDeltaTxt(text);
    } else {
      swin.notes = parseNoteTxt(text);
    }
    swinResolve();
    swin.lastAppendStart = swin.notes.length;
    renderSwinKeys();
  }
  function getSelFormat() {
    var el = document.querySelector('input[name="hkFormat"]:checked');
    return el ? el.value : "harmonica";
  }

  function loadSwinFile(f) {
    var reader = new FileReader();
    reader.onload = function () {
      var txt = window.DFH && DFH.decodeText ? DFH.decodeText(reader.result) : reader.result;
      $("#swinTxt").value = txt;
      swinParse();
      renderVisualList();
      var converted = isDeltaTxt(txt) ? "（已翻译为音阶·持续·间隔）" : "";
      hint("已载入 " + f.name + "（" + swin.notes.length + " 音）" + converted, 2400);
    };
    reader.readAsArrayBuffer(f);
  }

  /* ── 自动演奏：驱动测试台虚拟键 / 钢琴条 / 悬浮窗 / 发声 ── */
  function autoRigShow(n) {
    $$("#rigKeys .gkey").forEach(function (el) {
      el.classList.toggle("down", el.dataset.key === n.key);
    });
    rigPianoHighlight(n.midi);
    var reg = regOf(n.midi, n.base || rig.baseOct);
    $("#rigNowName").textContent = reg + degName(n.midi) + "  " + pitchName(n.midi);
    var mods = [];
    if (n.slot === -1) mods.push("按住左键");
    else if (n.slot === 1) mods.push("按住右键");
    if (n.sharp) mods.push("中键(升半音)");
    mods.push(n.key === "," ? "键[，]" : "键[" + n.key.toUpperCase() + "]");
    $("#rigNowCombo").textContent = "按下 " + mods.join(" + ") + " = " + pitchName(n.midi);
    fscoreSet(n, swin.idx, swin.notes.length);
  }
  function autoRigClear() {
    $$("#rigKeys .gkey").forEach(function (el) { el.classList.remove("down"); });
    rigPianoHighlight(null);
    $("#rigNowName").textContent = "—";
    $("#rigNowCombo").textContent = "等待按键…";
  }

  function swinPlay() {
    if (!swin.notes.length || !swin.notes.some(function (n) { return n.inRange; })) return;
    swinStop(false);
    swin.playing = true;
    swin.idx = 0;
    $("#swinPlay").disabled = true;
    $("#swinStop").disabled = false;
    $("#swinStatus").textContent = "自动演奏中…";
    swinTick();
  }
  function swinTick() {
    if (!swin.playing) return;
    while (swin.idx < swin.notes.length && !swin.notes[swin.idx].inRange) swin.idx++;
    if (swin.idx >= swin.notes.length) { swinStop(true); return; }
    var n = swin.notes[swin.idx];
    autoRigShow(n);
    $$("#swinKeys .hk-swin-key").forEach(function (el, i) {
      el.classList.toggle("active", i === swin.idx);
    });
    if (!$("#rigMute").checked) {
      playHarmonicaNote(n.midi, Math.max(0.08, n.dur / 1000));
    }
    var gap = n.gap;
    swin.idx++;
    swin.timer = setTimeout(swinTick, gap);
  }
  function swinStop(finished) {
    if (swin.timer) { clearTimeout(swin.timer); swin.timer = null; }
    swin.playing = false;
    autoRigClear();
    $$("#swinKeys .hk-swin-key").forEach(function (el) { el.classList.remove("active"); });
    var hasPlayable = swin.notes.some(function (n) { return n.inRange; });
    $("#swinPlay").disabled = !hasPlayable;
    $("#swinStop").disabled = true;
    $("#swinStatus").textContent = finished ? "演奏完成" : "已停止";
    fscoreSet(null);
  }

  /* ── 连续输入音阶自动拆分：12345{i} → ["1","2","3","4","5","{1}","i"]；支持逗号分隔、【】{}、# ── */
  function expandBracket(open, inner) {
    /* 括号内多数字拆分：【12#3】→ ["【1】","【2】","【#3】"]；# 匹配在后面的数字上 */
    var close = open === "【" ? "】" : "}";
    var out = [];
    var j = 0;
    while (j < inner.length) {
      var c = inner[j];
      if (c === "#" && j + 1 < inner.length && /[1-7i]/.test(inner[j + 1])) {
        out.push(open + "#" + inner[j + 1] + close);
        j += 2;
      } else if (/[1-7i]/.test(c)) {
        out.push(open + c + close);
        j += 1;
      } else {
        j += 1;
      }
    }
    return out;
  }
  function splitPitches(input) {
    var s = String(input || "").trim();
    if (!s) return [];
    /* 有逗号/中文逗号时按分隔符拆 */
    if (/[,，]/.test(s)) {
      return s.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    /* 无逗号：逐字符扫描，识别 【】{} 包裹、# 前缀；括号内多数字自动拆分 */
    var result = [];
    var i = 0;
    while (i < s.length) {
      var ch = s[i];
      /* 【...】 / {...} 包裹：内部多数字拆成每个都带括号 */
      if (ch === "【" || ch === "{") {
        var close = ch === "【" ? "】" : "}";
        var end = s.indexOf(close, i + 1);
        if (end > 0) {
          result = result.concat(expandBracket(ch, s.slice(i + 1, end)));
          i = end + 1;
          continue;
        }
      }
      /* # 前缀：#1 / #i / #【12】 / #{45}（#应用到括号内每个数字） */
      if (ch === "#" && i + 1 < s.length) {
        var next = s[i + 1];
        if (next === "【" || next === "{") {
          var close2 = next === "【" ? "】" : "}";
          var e3 = s.indexOf(close2, i + 2);
          if (e3 > 0) {
            var expanded = expandBracket(next, s.slice(i + 2, e3));
            /* # 在括号外 → 移到括号内每个数字前：#【1】→【#1】 */
            expanded = expanded.map(function (t) { return t.charAt(0) + "#" + t.slice(1); });
            result = result.concat(expanded);
            i = e3 + 1;
            continue;
          }
        }
        if (/[1-7i]/.test(next)) { result.push("#" + next); i += 2; continue; }
      }
      /* 普通音阶字符 1-7, i */
      if (/[1-7i]/.test(ch)) result.push(ch);
      i++;
    }
    return result;
  }

  /* ── 音阶 token → 可显示/发声的 note 对象（打拍预览用，基准 C5） ── */
  function pitchTokenToNote(token) {
    var jp = parseJianpuToken(token);
    if (jp) {
      var midi = jianpuToMidi(jp.key, jp.slot, jp.sharp, 5);
      return { key: jp.key, slot: jp.slot, sharp: jp.sharp, midi: midi, name: jianpuOf(jp.key, jp.slot, jp.sharp) };
    }
    var midi2 = parsePitchName(token);
    if (midi2 === null) return null;
    var m = mapNote(midi2, 5);
    return { key: m.key, slot: m.slot, sharp: m.sharp, midi: m.pitch, name: token };
  }

  /* ── 打拍录制节奏 ── */
  var tapRec = {
    active: false,
    timestamps: [],
    pitches: [],
    defaultDur: 200,
  };
  function tapSpaceHandler(e) {
    if (e.code === "Space" && tapRec.active) {
      e.preventDefault();
      recordTap();
    }
  }
  function tapShowAndSound(idx) {
    /* 打拍时显示当前音 + 发声 */
    var total = tapRec.pitches.length;
    if (!total) return;
    var token = tapRec.pitches[Math.min(idx, total - 1)];
    var note = pitchTokenToNote(token);
    if (!note) return;
    fscoreSet(note);
    if (!$("#rigMute").checked) {
      playHarmonicaNote(note.midi, Math.max(0.12, tapRec.defaultDur / 1000));
    }
  }
  function recordTap() {
    tapRec.timestamps.push(performance.now());
    var n = tapRec.timestamps.length;
    var total = tapRec.pitches.length;
    var btn = $("#swinTapBtn");
    btn.textContent = "停止并生成（" + n + "/" + total + " 拍）";
    $("#swinTapStatus").textContent = "已打 " + n + " 拍 / 共 " + total + " 音" + (n >= total ? " ✓ 可停止生成" : "，继续打拍…");
    /* 打拍按钮视觉反馈 */
    var pad = $("#swinTapPad");
    pad.classList.add("tap-flash");
    setTimeout(function () { pad.classList.remove("tap-flash"); }, 120);
    /* 显示当前音 + 发声（第 n 拍对应第 n-1 个音） */
    tapShowAndSound(n - 1);
  }
  function startTapRecord() {
    var pitchInput = $("#swinTapPitches").value;
    tapRec.pitches = splitPitches(pitchInput);
    if (!tapRec.pitches.length) { hint("请先输入音阶序列（如 12345{i}）", 2600); return; }
    tapRec.defaultDur = parseInt($("#swinTapDur").value, 10) || 200;
    tapRec.timestamps = [performance.now()];
    tapRec.active = true;
    $("#swinTapBtn").textContent = "停止并生成（1/" + tapRec.pitches.length + " 拍）";
    $("#swinTapStatus").textContent = "录制中… 连续点击「打拍」或按空格键，第 1 拍已记录";
    document.addEventListener("keydown", tapSpaceHandler);
    /* 第一拍也显示/发声第一个音 */
    tapShowAndSound(0);
    hint("打拍录制开始：共 " + tapRec.pitches.length + " 音，连续打拍记录间隔", 2400);
  }
  function stopTapRecord() {
    if (!tapRec.active) return;
    tapRec.active = false;
    document.removeEventListener("keydown", tapSpaceHandler);
    var pitches = tapRec.pitches;
    var ts = tapRec.timestamps;
    if (ts.length < 2) {
      hint("至少打 2 拍才能记录间隔", 2500);
      $("#swinTapBtn").textContent = "开始打拍录制";
      $("#swinTapStatus").textContent = "输入音阶 → 点开始 → 连续打拍";
      return;
    }
    /* 生成音符：间隔 = 相邻打拍时间差；超出拍数用最后间隔补全 */
    var lastGap = Math.round(ts[ts.length - 1] - ts[ts.length - 2]);
    var syncDur = $("#swinTapSync") ? $("#swinTapSync").checked : false;
    var newNotes = [];
    for (var i = 0; i < pitches.length; i++) {
      var gap;
      if (i < ts.length - 1) {
        gap = Math.max(30, Math.round(ts[i + 1] - ts[i]));
      } else {
        gap = Math.max(30, lastGap);
      }
      var jp = parseJianpuToken(pitches[i]);
      newNotes.push({
        name: jp ? jianpuOf(jp.key, jp.slot, jp.sharp) : pitches[i],
        midi: jp ? null : parsePitchName(pitches[i]),
        jp: jp,
        dur: syncDur ? gap : tapRec.defaultDur,  /* 同步延迟：持续=间隔 */
        gap: gap
      });
    }
    /* 续写模式：追加到当前乐谱后面，并记录追加起始位置；
       非续写模式：只替换最后添加的那一段（从 lastAppendStart 截断），保留之前的乐谱 */
    var append = $("#swinTapAppend") ? $("#swinTapAppend").checked : true;
    if (append) {
      swin.lastAppendStart = swin.notes.length;
      swin.notes = swin.notes.concat(newNotes);
    } else {
      swin.notes = swin.notes.slice(0, swin.lastAppendStart);
      swin.notes = swin.notes.concat(newNotes);
    }
    swinResolve();
    $("#swinTxt").value = notesToTxt(swin.notes);
    renderSwinKeys();
    renderVisualList();
    $("#swinTapBtn").textContent = "开始打拍录制";
    var mode = append ? "续写" : "重写末段";
    $("#swinTapStatus").textContent = "已" + mode + " " + newNotes.length + " 音（打拍 " + ts.length + " 次，持续 " + tapRec.defaultDur + "ms），共 " + swin.notes.length + " 音";
    fscoreSet(null);  /* 停止打拍时清空悬浮窗预览 */
    hint("打拍录入完成：" + mode + " " + newNotes.length + " 个音符，当前共 " + swin.notes.length + " 音", 2800);
  }

  /* ── 乐谱保存 / 载入 / 清空（localStorage） ── */
  var SAVED_KEY = "hk_saved_scores";
  function getSavedScores() {
    try {
      return JSON.parse(localStorage.getItem(SAVED_KEY) || "{}");
    } catch (e) { return {}; }
  }
  function setSavedScores(obj) {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify(obj)); } catch (e) { }
  }
  function refreshSavedList() {
    var sel = $("#swinSavedList");
    var sel2 = $("#fscoreSavedList");
    if (!sel && !sel2) return;
    var saved = getSavedScores();
    var names = Object.keys(saved).sort(function (a, b) {
      return (saved[b].date || 0) - (saved[a].date || 0);
    });
    function fill(select) {
      if (!select) return;
      select.innerHTML = '<option value="">选择已保存乐谱…</option>';
      names.forEach(function (name) {
        var opt = document.createElement("option");
        opt.value = name;
        var count = saved[name].count || 0;
        opt.textContent = name + "（" + count + " 音）";
        select.appendChild(opt);
      });
    }
    fill(sel);
    fill(sel2);
  }
  function saveCurrentScore() {
    if (!swin.notes.length) { hint("没有可保存的乐谱", 2000); return; }
    var name = prompt("请输入乐谱名称：", "我的口琴谱 " + new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }));
    if (!name || !name.trim()) return;
    name = name.trim();
    var saved = getSavedScores();
    saved[name] = {
      txt: notesToTxt(swin.notes),
      count: swin.notes.length,
      date: Date.now()
    };
    setSavedScores(saved);
    refreshSavedList();
    hint("已保存：" + name + "（" + swin.notes.length + " 音）", 2600);
  }
  function loadSavedScore(name) {
    if (!name) return;
    var saved = getSavedScores();
    if (!saved[name]) { hint("未找到该乐谱", 2000); return; }
    $("#swinTxt").value = saved[name].txt;
    swinParse();
    renderVisualList();
    swin.lastAppendStart = swin.notes.length;
    hint("已载入：" + name + "（" + saved[name].count + " 音）", 2400);
  }
  function clearScore() {
    if (!swin.notes.length) return;
    if (!confirm("确定清空当前乐谱？（已保存的乐谱不受影响）")) return;
    swin.notes = [];
    swin.lastAppendStart = 0;
    $("#swinTxt").value = "";
    renderSwinKeys();
    renderVisualList();
    hint("已清空当前乐谱", 1800);
  }

  /* ── notes → txt 字符串（三元组） ── */
  function notesToTxt(notes) {
    if (!notes || !notes.length) return "";
    var parts = [];
    notes.forEach(function (n) {
      var pitch = n.name || "1";
      parts.push('"' + pitch + '","' + (n.dur || 200) + 'ms","' + (n.gap || 100) + 'ms"');
    });
    return "(" + parts.join(",") + ")";
  }

  /* ── 可视化编辑器：渲染逐音三输入框行 ── */
  function renderVisualList() {
    var box = $("#swinVList");
    if (!box) return;
    box.innerHTML = "";
    if (!swin.notes.length) {
      box.innerHTML = '<div class="hk-swin-empty">暂无音符，点下方「增加下一音」开始编辑…</div>';
      return;
    }
    var frag = document.createDocumentFragment();
    swin.notes.forEach(function (n, i) {
      var row = document.createElement("div");
      row.className = "hk-swin-vrow";
      row.dataset.idx = i;

      var idx = document.createElement("span");
      idx.className = "hk-swin-vcol hk-swin-vcol-idx";
      idx.textContent = (i + 1);

      var pIn = document.createElement("input");
      pIn.className = "hk-swin-vcol hk-swin-vpitch";
      pIn.type = "text";
      pIn.value = n.name || "1";
      pIn.placeholder = "1 / {2} / 【#3】 / i";
      pIn.title = "音阶：简谱 1234567i，【】低八度 {}高八度 #升半音；或音名 C4 D#5";

      var dIn = document.createElement("input");
      dIn.className = "hk-swin-vcol hk-swin-vdur";
      dIn.type = "number";
      dIn.min = "10";
      dIn.step = "10";
      dIn.value = n.dur || 200;
      dIn.title = "持续时间（发声时长，ms）";

      var gIn = document.createElement("input");
      gIn.className = "hk-swin-vcol hk-swin-vgap";
      gIn.type = "number";
      gIn.min = "10";
      gIn.step = "10";
      gIn.value = n.gap || 100;
      gIn.title = "到下一音的间隔（ms）";

      var del = document.createElement("button");
      del.className = "hk-swin-vcol hk-swin-vdel";
      del.type = "button";
      del.textContent = "✕";
      del.title = "删除此音";

      row.appendChild(idx); row.appendChild(pIn); row.appendChild(dIn); row.appendChild(gIn); row.appendChild(del);
      frag.appendChild(row);
    });
    box.appendChild(frag);
  }

  /* ── 可视化编辑后：更新 note + 重新映射 + 同步 textarea + 刷新按键列表 ── */
  function applyVisualEdit() {
    var rows = document.querySelectorAll("#swinVList .hk-swin-vrow");
    var newNotes = [];
    rows.forEach(function (row) {
      var pitch = row.querySelector(".hk-swin-vpitch").value.trim() || "1";
      var dur = parseInt(row.querySelector(".hk-swin-vdur").value, 10);
      var gap = parseInt(row.querySelector(".hk-swin-vgap").value, 10);
      if (isNaN(dur) || dur < 10) dur = 200;
      if (isNaN(gap) || gap < 10) gap = 100;
      var jp = parseJianpuToken(pitch);
      var midi = null, name = pitch;
      if (jp) { name = jianpuOf(jp.key, jp.slot, jp.sharp); }
      else {
        midi = parsePitchName(pitch);
        if (midi === null) { name = pitch; }
        else { name = pitchName(midi); }
      }
      newNotes.push({ name: name, midi: midi, jp: jp, dur: dur, gap: gap });
    });
    swin.notes = newNotes;
    swinResolve();
    swin.lastAppendStart = swin.notes.length;
    /* 同步 textarea（不触发 input 事件，避免循环） */
    var txt = $("#swinTxt");
    txt.value = notesToTxt(swin.notes);
    renderSwinKeys();
  }

  function initSwin() {
    var drop = $("#swinDrop"), file = $("#swinFile"), txt = $("#swinTxt");
    drop.addEventListener("click", function () { file.click(); });
    drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.classList.add("over"); });
    drop.addEventListener("dragleave", function () { drop.classList.remove("over"); });
    drop.addEventListener("drop", function (e) {
      e.preventDefault(); drop.classList.remove("over");
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) loadSwinFile(f);
    });
    file.addEventListener("change", function () { if (file.files[0]) loadSwinFile(file.files[0]); });
    var debounce = null;
    txt.addEventListener("input", function () {
      clearTimeout(debounce);
      debounce = setTimeout(function () { swinParse(); renderVisualList(); }, 300);
    });
    $("#swinParse").addEventListener("click", function () { swinParse(); renderVisualList(); });
    $("#swinBase").addEventListener("change", function () { swin.base = this.value; swinParse(); renderVisualList(); });
    $("#swinPlay").addEventListener("click", swinPlay);
    $("#swinStop").addEventListener("click", function () { swinStop(false); });
    $("#swinLoadExample").addEventListener("click", function () {
      txt.value = '("1","200ms","120ms","2","180ms","100ms","3","200ms","120ms","4","180ms","100ms","5","220ms","140ms","6","200ms","120ms","7","240ms","160ms","i","400ms","200ms","{1}","200ms","120ms","{2}","180ms","100ms","{3}","200ms","120ms","{i}","400ms","200ms","【5】","300ms","180ms","【3】","280ms","160ms","#4","200ms","120ms","5","400ms","200ms")';
      swinParse();
      renderVisualList();
    });

    /* ── 编辑模式切换 ── */
    $$(".hk-swin-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var mode = this.dataset.mode;
        $$(".hk-swin-tab").forEach(function (t) { t.classList.toggle("active", t === this); }, this);
        var textMode = $("#swinTextMode"), visMode = $("#swinVisualMode");
        if (mode === "visual") {
          textMode.hidden = true;
          visMode.hidden = false;
          renderVisualList();
        } else {
          textMode.hidden = false;
          visMode.hidden = true;
        }
      });
    });

    /* ── 可视化编辑器事件（事件委托） ── */
    var vbox = $("#swinVList");
    var vDebounce = null;
    vbox.addEventListener("input", function (e) {
      if (!e.target.classList.contains("hk-swin-vpitch") &&
          !e.target.classList.contains("hk-swin-vdur") &&
          !e.target.classList.contains("hk-swin-vgap")) return;
      clearTimeout(vDebounce);
      vDebounce = setTimeout(applyVisualEdit, 250);
    });
    vbox.addEventListener("click", function (e) {
      if (!e.target.classList.contains("hk-swin-vdel")) return;
      var row = e.target.closest(".hk-swin-vrow");
      if (row) row.remove();
      applyVisualEdit();
      renderVisualList();
    });
    $("#swinAddNote").addEventListener("click", function () {
      /* 追加新音：默认音阶 1，持续 200ms，间隔 100ms */
      var last = swin.notes.length ? swin.notes[swin.notes.length - 1] : null;
      swin.notes.push({
        name: last ? last.name : "1",
        midi: last ? last.midi : null,
        jp: last ? last.jp : null,
        dur: last ? last.dur : 200,
        gap: last ? last.gap : 100
      });
      swinResolve();
      swin.lastAppendStart = swin.notes.length;
      $("#swinTxt").value = notesToTxt(swin.notes);
      renderSwinKeys();
      renderVisualList();
      /* 滚动到最新行 */
      var rows = vbox.querySelectorAll(".hk-swin-vrow");
      if (rows.length) rows[rows.length - 1].scrollIntoView({ behavior: "smooth", block: "nearest" });
    });

    /* ── 打拍录入节奏面板 ── */
    $("#swinTapToggle").addEventListener("click", function () {
      var body = $("#swinTapBody");
      var arrow = $("#swinTapArrow");
      body.hidden = !body.hidden;
      arrow.textContent = body.hidden ? "▼" : "▲";
    });
    $("#swinTapBtn").addEventListener("click", function () {
      if (tapRec.active) stopTapRecord();
      else startTapRecord();
    });
    $("#swinTapPad").addEventListener("click", function () {
      if (tapRec.active) recordTap();
      else hint("请先点「开始打拍录制」", 2000);
    });

    /* ── 乐谱保存 / 载入 / 清空 ── */
    $("#swinSave").addEventListener("click", saveCurrentScore);
    $("#swinLoadSaved").addEventListener("click", function () {
      var name = $("#swinSavedList").value;
      if (name) loadSavedScore(name);
      else hint("请先在下拉框选择要载入的乐谱", 2000);
    });
    $("#swinSavedList").addEventListener("change", function () {
      if (this.value) loadSavedScore(this.value);
    });
    $("#swinClear").addEventListener("click", clearScore);
    refreshSavedList();

    /* ── 下载当前乐谱为 txt 文件 ── */
    $("#swinDownload").addEventListener("click", function () {
      if (!swin.notes.length) { hint("当前乐谱为空，无可下载内容", 2200); return; }
      var txt = notesToTxt(swin.notes);
      var blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "口琴谱_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".txt";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      hint("已下载乐谱 txt（" + swin.notes.length + " 音）", 2400);
    });

    /* ── 打拍设置面板：内联展开/收起 ── */
    $("#swinTapSetBtn").addEventListener("click", function () {
      var panel = $("#swinTapSetPanel");
      panel.hidden = !panel.hidden;
      this.classList.toggle("open", !panel.hidden);
    });

    /* ── 删除已保存乐谱（按钮 + 右键，均二次确认） ── */
    function deleteSavedByName(name) {
      if (!name) { hint("请先在下拉框选择要删除的乐谱", 2000); return; }
      if (!confirm("确定删除乐谱「" + name + "」？此操作不可撤销。")) return;
      var saved = getSavedScores();
      delete saved[name];
      setSavedScores(saved);
      refreshSavedList();
      hint("已删除乐谱「" + name + "」", 2200);
    }
    $("#swinDelSaved").addEventListener("click", function () {
      deleteSavedByName($("#swinSavedList").value);
    });
    $("#swinSavedList").addEventListener("contextmenu", function (e) {
      e.preventDefault();
      deleteSavedByName(this.value);
    });
  }

  /* ════════ 乐谱表悬浮窗（可拖动 / 调整大小，仅显示按键） ════════ */
  function fscoreSet(n, pos, total) {
    var now = $("#fscoreNow"), next = $("#fscoreNext");
    if (!n) {
      now.innerHTML = '<span class="hk-fscore-key">—</span><span class="hk-fscore-mod">等待乐谱</span><span class="hk-fscore-pos" id="fscorePos" hidden></span>';
      next.textContent = "";
      return;
    }
    var keyShow = n.key === "," ? "，" : n.key.toUpperCase();
    var mod = modInfo(n.slot, n.sharp);
    var posHtml = "";
    if (typeof pos === "number" && total) {
      posHtml = '<span class="hk-fscore-pos">' + (pos + 1) + ' / ' + total + '</span>';
    }
    now.innerHTML = '<span class="hk-fscore-key">' + keyShow + '</span>' +
      '<span class="hk-fscore-mod ' + mod.cls + '">' + mod.label + ' · ' + pitchName(n.midi) + '</span>' + posHtml;
    var upcoming = [];
    for (var i = swin.idx; i < Math.min(swin.idx + 4, swin.notes.length); i++) {
      var nn = swin.notes[i];
      if (!nn.inRange) continue;
      upcoming.push((nn.key === "," ? "，" : nn.key.toUpperCase()) + " " + modInfo(nn.slot, nn.sharp).label);
    }
    next.textContent = upcoming.join("   ");
  }

  function initFScore() {
    var win = $("#hkFScore"), bar = $("#fscoreBar"), rs = $("#fscoreResize");
    win.style.left = Math.max(16, window.innerWidth - 340) + "px";
    win.style.top = "120px";
    win.style.width = "300px";

    /* ── 乐谱/记事本底部切换条（不在最顶上） ── */
    $$(".hk-fscore-swbtn").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var view = this.dataset.view;
        $$(".hk-fscore-swbtn").forEach(function (t) { t.classList.toggle("active", t === this); }, this);
        $("#fscoreViewScore").hidden = (view !== "score");
        $("#fscoreViewNote").hidden = (view !== "note");
      });
    });
    /* ── 记事本：获取已保存乐谱的音阶顺序（仅音阶，不含时长/间隔；间隔≥1000ms处自动换行） ── */
    $("#fscoreGetSaved").addEventListener("click", function () {
      var name = $("#fscoreSavedList").value;
      if (!name) { hint("请先在下拉框选择已保存的乐谱", 2000); return; }
      var saved = getSavedScores();
      if (!saved[name]) return;
      var notes = parseNoteTxt(saved[name].txt);
      /* 生成音阶顺序文本，间隔≥1000ms处换行 */
      var lines = [];
      var curLine = [];
      for (var i = 0; i < notes.length; i++) {
        if (i > 0 && notes[i - 1].gap >= 1000) {
          lines.push(curLine.join(" "));
          curLine = [];
        }
        curLine.push(notes[i].name);
      }
      if (curLine.length) lines.push(curLine.join(" "));
      var text = lines.join("\n");
      var noteArea = $("#fscoreNote");
      if (noteArea.value.trim()) {
        noteArea.value = noteArea.value + "\n" + text;
      } else {
        noteArea.value = text;
      }
      hint("已获取「" + name + "」音阶顺序（" + notes.length + " 音，长间隔处已换行），追加到记事本", 2600);
    });
    /* 悬浮窗已保存列表：右键删除（二次确认） */
    $("#fscoreSavedList").addEventListener("contextmenu", function (e) {
      e.preventDefault();
      var name = this.value;
      if (!name) { hint("请先在下拉框选择要删除的乐谱", 2000); return; }
      if (!confirm("确定删除乐谱「" + name + "」？此操作不可撤销。")) return;
      var saved = getSavedScores();
      delete saved[name];
      setSavedScores(saved);
      refreshSavedList();
      hint("已删除乐谱「" + name + "」", 2200);
    });
    refreshSavedList();

    var drag = null;
    bar.addEventListener("mousedown", function (e) {
      if (e.target.closest("button")) return;
      drag = { x: e.clientX, y: e.clientY, l: win.offsetLeft, t: win.offsetTop };
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!drag) return;
      win.style.left = Math.max(0, Math.min(window.innerWidth - 80, drag.l + e.clientX - drag.x)) + "px";
      win.style.top = Math.max(0, Math.min(window.innerHeight - 40, drag.t + e.clientY - drag.y)) + "px";
    });
    document.addEventListener("mouseup", function () { drag = null; });

    var rz = null;
    rs.addEventListener("mousedown", function (e) {
      rz = { x: e.clientX, y: e.clientY, w: win.offsetWidth, h: win.offsetHeight };
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener("mousemove", function (e) {
      if (!rz) return;
      win.style.width = Math.max(200, Math.min(560, rz.w + e.clientX - rz.x)) + "px";
      win.style.height = Math.max(120, Math.min(480, rz.h + e.clientY - rz.y)) + "px";
    });
    document.addEventListener("mouseup", function () { rz = null; });

    $("#fscoreMin").addEventListener("click", function () { win.classList.toggle("minimized"); });
    $("#fscoreClose").addEventListener("click", function () { win.style.display = "none"; });
    $("#rigFScore").addEventListener("click", function () {
      win.style.display = (win.style.display === "none") ? "" : "none";
    });
  }

  /* ── 启动 ── */
  function init() {
    if (window.LabHost) {
      try {
        LabHost.setTitle("口琴谱解析");
        LabHost.hint("拖入音频 → 选格式 → 开始解析", 3800);
      } catch (e) { }
    }
    bindEvents();
    rigInit();
    initSwin();
    initFScore();
    /* 音量滑块 */
    var volSlider = $("#hkVolume");
    if (volSlider) {
      volSlider.addEventListener("input", function () {
        hkVolume = parseInt(this.value, 10) / 100;
        var val = $("#hkVolumeVal");
        if (val) val.textContent = this.value + "%";
      });
    }
    var saved = "";
    try { saved = localStorage.getItem("hkSoundDir") || ""; } catch (e) { }
    loadHarmonicaSounds(saved || SOUND_BASE);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* ═══════════════════════════════════════════════════════════════════════
   新功能模块（浅色风格，风格沿用上方原版 updream 主页）
   · MIDI（.mid/.midi）多轨分解 → 音轨展示框（卷帘 / 音轨选择 / 播放 / 导出 / 存库）
   · txt 双格式：约定格式（音阶·持续·间隔）与 节拍谱（小节/键位/节奏），自动识别
   · 选择解析格式：修复为可点击单选（radio + 高亮卡片）
   · 乐谱表：自动演奏时在悬浮窗显示当前演奏到第几个音（红色序号）
   · F8 播放/停止 · F9 存入乐谱库
   · 登录态继承主站（auth.js）
   ═══════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* 本文件与 common.js 同目录：从当前 script src 推导目录，动态加载 DFH 引擎 */
  function dfhBase() {
    try {
      var src = document.currentScript && document.currentScript.src;
      if (src) return src.replace(/[^/]*$/, "");
    } catch (e) { }
    return "/assets/lab/";
  }

  function loadCommon(cb) {
    if (window.DFH) { cb(window.DFH); return; }
    var s = document.createElement("script");
    s.src = dfhBase() + "common.js?v=20260917p";
    s.onload = function () { cb(window.DFH); };
    s.onerror = function () { console.warn("common.js 加载失败"); };
    document.head.appendChild(s);
  }

  loadCommon(function (D) {
    var $ = function (s) { return document.querySelector(s); };
    var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

    function toast(t) {
      var box = $("#hkToast");
      if (!box) {
        box = document.createElement("div");
        box.className = "hk-toast";
        box.id = "hkToast";
        document.body.appendChild(box);
      }
      box.textContent = t;
      box.classList.add("is-show");
      clearTimeout(box._t);
      box._t = setTimeout(function () { box.classList.remove("is-show"); }, 2600);
    }

    /* 根链接自适应：file:// / 静态托管用相对路径；服务器 /lab 模式保持 /lab */
    function fixRootLinks() {
      var isFile = location.protocol === "file:";
      var base = dfhBase();
      /* 导航链接绝对化：避免挂载（lab.html 基准）与直接打开（app.html 基准）的差异 */
      var navMap = {
        "lab.html": isFile ? base + "../../lab.html" : "/lab",
        "assets/lab/library.html": isFile ? base + "library.html" : "/assets/lab/library.html"
      };
      document.querySelectorAll(".hk-nav a[href]").forEach(function (a) {
        var h = a.getAttribute("href");
        if (navMap[h]) a.setAttribute("href", navMap[h]);
      });
      var onServerLab = location.pathname === "/lab" || location.pathname === "/lab/";
      var lab = isFile ? "lab.html" : (onServerLab ? "/lab" : "lab.html");
      var rootA = document.querySelector("a[href^='assets/lab/'], a[href='lab.html']");
      if (rootA && rootA.getAttribute("href") === "lab.html") rootA.setAttribute("href", lab);
      document.querySelectorAll("a[href^='/lab']").forEach(function (a) {
        var h = a.getAttribute("href");
        if (isFile) {
          a.setAttribute("href", "../../lab.html" + (h.indexOf("#") >= 0 ? h.slice(h.indexOf("#")) : ""));
        }
      });
    }
    fixRootLinks();

    function formatSize(b) {
      if (b < 1024) return b + " B";
      if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
      return (b / 1048576).toFixed(2) + " MB";
    }

    /* ════════ 登录态：继承主站（auth.js） ════════ */
    function renderLogin() {
      var u = D.currentUser();
      var el = $("#hkLogin");
      if (!el) return;
      el.classList.toggle("is-in", !!u);
      var txt = $("#hkLoginText");
      if (!txt) return;
      if (D.Admin && D.Admin.setSession) D.Admin.setSession(u);
      if (!u) { txt.textContent = "登录"; }
      else {
        var name = u.name || "用户";
        var idPart = u.phone ? u.phone.slice(-4) : "";
        var av = u.avatar ? '<i class="hk-avatar-mini"><img src="' + D.escapeHtml(u.avatar) + '" alt=""></i>' : '<i class="hk-avatar-mini">' + D.escapeHtml(name.slice(0, 1)) + '</i>';
        txt.innerHTML = av + D.escapeHtml(name + (idPart ? " #" + idPart : ""));
      }
      syncAdminGear();
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
    if (gearEl) {
      gearEl.addEventListener("click", function () {
        location.href = "assets/lab/library.html?admin=1";
      });
    }
    D.onAuthChange(renderLogin);
    renderLogin();
    syncAdminGear();
    if (D.Admin && D.Admin.bindSettings) D.Admin.bindSettings();

    /* ════════ 修复解析格式单选（点击卡片切换 radio + 高亮） ════════ */
    $$(".hk-format").forEach(function (label) {
      var input = label.querySelector('input[name="hkFormat"]');
      if (!input) return;
      label.addEventListener("click", function () {
        $$(".hk-format").forEach(function (l) {
          var i = l.querySelector('input[name="hkFormat"]');
          if (i) i.checked = false;
          l.classList.remove("hk-format-active");
        });
        input.checked = true;
        label.classList.add("hk-format-active");
      });
    });

    function getSelFormat() {
      var el = document.querySelector('input[name="hkFormat"]:checked');
      return el ? el.value : "harmonica";
    }

    /* ════════ 文件输入接管：MIDI / txt → DFH 解析；音频 → 原版流程 ════════ */
    var pending = { file: null, kind: null, parsed: null, source: "" };

    function isMidiName(n) { return /\.midi?$/i.test(n || ""); }
    function isTxtName(n) { return /\.txt$/i.test(n || ""); }

    function acceptFile(file) {
      if (!file) return null;
      if (isMidiName(file.name)) return "midi";
      if (isTxtName(file.name)) return "txt";
      return null;
    }

    /* 捕获阶段：先于原版 setFile 执行，MIDI/txt 在此接管 */
    document.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      var kind = acceptFile(f);
      if (!kind) return;                    /* 音频放行原版 */
      e.preventDefault();
      e.stopPropagation();
      handleNewFile(f, kind);
    }, true);
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || (t.id !== "hkFile" && t.id !== "swinFile")) return;
      if (t.id === "swinFile") return;      /* 原版乐谱视窗自己的 txt 拖入保持原样 */
      var f = t.files && t.files[0];
      var kind = acceptFile(f);
      if (!kind) return;                    /* 音频放行原版 */
      e.preventDefault();
      e.stopPropagation();
      handleNewFile(f, kind);
    }, true);

    function handleNewFile(file, kind) {
      pending = { file: file, kind: kind, parsed: null, source: "" };
      var name = file.name || "";
      $("#hkFileName").textContent = name;
      $("#hkFileSize").textContent = formatSize(file.size);
      if ($("#hkPlayer")) { try { URL.revokeObjectURL($("#hkPlayer").src); } catch (err) { } }
      $("#hkFilebar").hidden = false;
      $("#hkDrop").hidden = true;
      $("#hkParse").disabled = false;
      $("#hkCtaSub").textContent = kind === "midi"
        ? "点击「开始解析」：分解 MIDI 为多条音轨"
        : "点击「开始解析」：按所选格式解析 txt 曲谱";
      $("#hkResult").hidden = true;
    }

    /* ════════ 解析按钮：MIDI/txt 走新流程，音频走原版 ════════ */
    document.addEventListener("click", function (e) {
      if (e.target && e.target.id === "hkParse" && pending.file) {
        e.preventDefault();
        e.stopPropagation();
        runStudioParse();
      }
    }, true);

    function runStudioParse() {
      var f = pending.file;
      if (!f) return;
      var btn = $("#hkParse");
      btn.disabled = true;
      $("#hkProgress").hidden = false;
      setStudioProgress(0.05, "读取文件…");
      var reader = new FileReader();
      reader.onload = function () {
        try {
          if (pending.kind === "midi") {
            setStudioProgress(0.25, "解析 MIDI 音轨…");
            var midi = D.parseMidi(reader.result);
            if (!midi.tracks || !midi.tracks.some(function (t) { return t.notes && t.notes.length; })) {
              throw new Error("MIDI 中没有可识别的音符");
            }
            pending.source = "midi";
            pending.parsed = midi;
          } else {
            setStudioProgress(0.25, "解析 txt 曲谱…");
            var text = D.decodeText ? D.decodeText(reader.result) : reader.result;
            var fmt = getSelFormat();
            var isDelta = D.isDeltaTxt(text);
            if (isDelta || fmt === "delta") {
              pending.parsed = D.parseDeltaTxt(text);
              pending.source = "delta";
            } else {
              pending.parsed = D.parseNoteTxt(text);
              pending.source = "tuple";
            }
            if (!pending.parsed.notes || !pending.parsed.notes.length) {
              throw new Error("txt 中没有解析到音符");
            }
          }
          setStudioProgress(0.55, "生成音轨展示…");
          openStudioView();
          setStudioProgress(1, "完成");
          setTimeout(function () { $("#hkProgress").hidden = true; }, 500);
        } catch (err) {
          btn.disabled = false;
          $("#hkProgress").hidden = true;
          toast("解析失败：" + err.message);
          console.error(err);
        }
      };
      reader.onerror = function () {
        btn.disabled = false;
        $("#hkProgress").hidden = true;
        toast("读取文件失败");
      };
      if (pending.kind === "midi") reader.readAsArrayBuffer(f);
      else reader.readAsArrayBuffer(f);
    }

    function setStudioProgress(p, txt) {
      var bar = $("#hkProgressBar");
      if (bar) bar.style.setProperty("width", Math.round(p * 100) + "%", "important");
      var t = $("#hkProgressText");
      if (t) t.textContent = txt || "解析中…";
    }

    /* ════════ 音轨展示框 ════════ */
    var studio = {
      tracks: [],           /* [{name, notes}] */
      on: [],               /* 每轨开关 */
      sel: 0,               /* 当前选中轨 */
      bpm: 120,
      title: "",
      source: "",
      playing: false,
      raf: 0,
      ctx0: 0,
      idx: 0,
      seek: 0,
      melody: [],           /* 合并后按时间排序的音符 [{midi,start,dur}] */
      playable: [],         /* 映射后的口琴音符 [{key,slot,sharp,inRange,start,dur,midi}] */
      baseOct: "auto",
      foldedCount: 0,
      chordSkipped: 0
    };

    function openStudioView() {
      var src = pending.parsed, title = pending.file.name.replace(/\.[^.]+$/, "") || "未命名";
      studio.title = title;
      studio.source = pending.source;
      studio.bpm = src.bpm || 120;
      studio.on = [];
      if (pending.kind === "midi") {
        studio.tracks = src.tracks.filter(function (t) { return t.notes && t.notes.length; });
        if (!studio.tracks.length) studio.tracks = src.tracks;
        studio.sel = 0;
        /* 默认选中主旋律轨：优先名称含 melody/lead/vocal/main，否则第一条非鼓轨，否则第一条 */
        var best = 0;
        var leadIdx = -1, firstNondrum = -1;
        for (var i = 0; i < studio.tracks.length; i++) {
          var tn = (studio.tracks[i].name || "").toLowerCase();
          if (!studio.tracks[i].drum && firstNondrum < 0) firstNondrum = i;
          if (!studio.tracks[i].drum && /(melody|lead|vocal|main|主旋律|旋律|lead)/.test(tn)) { leadIdx = i; break; }
        }
        if (leadIdx >= 0) best = leadIdx;
        else if (firstNondrum >= 0) best = firstNondrum;
        studio.sel = best;
        studio.on = studio.tracks.map(function (_, i) { return i === best; });
      } else {
        /* txt 两种格式：先转成秒轴旋律（txtNotesToMelody），否则 start/dur 不可用 */
        var conv = D.txtNotesToMelody(src);
        studio.tracks = [{ name: pending.source === "delta" ? "节拍谱" : "约定格式", notes: conv.melody }];
        studio.baseOct = conv.base;
        studio.sel = 0;
        studio.on = [true];
      }
      $("#stName").value = title;
      $("#stKey").textContent = pending.kind === "midi" ? "MIDI · " + studio.tracks.length + " 轨" : "TXT";
      $("#stMeta").textContent = buildMetaLine();
      renderTrackSelect();
      renderTrackToggle();
      /* 重新解析：先重建当前音轨的旋律/映射，丢弃上一首的 */
      rebuildMelody();
      $("#stSeek").value = 0;
      studio.seek = 0;
      studio.playing = false;
      if (studio.raf) cancelAnimationFrame(studio.raf);
      studio.raf = 0;
      D.audio && D.audio.stop && D.audio.stop();
      $("#stPlay").disabled = false;
      $("#stStop").disabled = true;
      /* 解析框 → 音轨展示框 */
      $("#hkUpload").hidden = true;
      $("#hkFormat").hidden = true;
      $("#hkGo").hidden = true;
      $("#hkStudioView").hidden = false;
      $("#hkStudioView").scrollIntoView({ behavior: "smooth", block: "start" });
      toast("解析完成：" + studio.tracks.length + " 条音轨 / " + totalNoteCount() + " 音符");
    }

    function totalNoteCount() {
      return studio.tracks.reduce(function (s, t) { return s + (t.notes ? t.notes.length : 0); }, 0);
    }

    function buildMetaLine() {
      var n = totalNoteCount();
      var d = 0;
      studio.tracks.forEach(function (t) {
        (t.notes || []).forEach(function (x) {
          if (x.start + x.dur > d) d = x.start + x.dur;
        });
      });
      return n + " 音符 · 时长 " + D.formatClock(d) + " · BPM " + studio.bpm +
        (pending.kind === "midi" ? " · 已按时间合并音轨" : "") +
        (studio.source === "delta" ? " · 节拍谱" : studio.source === "tuple" ? " · 约定格式" : "");
    }

    function renderTrackSelect() {
      var sel = $("#stTrackSel");
      sel.innerHTML = "";
      studio.tracks.forEach(function (t, i) {
        var o = document.createElement("option");
        o.value = i;
        var nm = (t.name || ("音轨 " + (i + 1))).trim() || ("音轨 " + (i + 1));
        o.textContent = nm + "（" + (t.notes ? t.notes.length : 0) + " 音" + (t.drum ? "·鼓" : "") + "）";
        sel.appendChild(o);
      });
      sel.value = studio.sel;
    }

    function renderTrackToggle() {
      var box = $("#stTrackToggle");
      box.innerHTML = "";
      studio.tracks.forEach(function (t, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "hk-trackbtn" + (studio.on[i] ? " is-on" : "");
        var nm = (t.name || ("音轨 " + (i + 1))).trim() || ("音轨 " + (i + 1));
        b.textContent = (i + 1) + " " + nm + (t.drum ? "·鼓" : "");
        b.addEventListener("click", function () {
          studio.on[i] = !studio.on[i];
          b.classList.toggle("is-on", studio.on[i]);
          rebuildMelody();
        });
        box.appendChild(b);
      });
    }

    /* 合并开启音轨 → 排序 → 移调/折叠映射 */
    function rebuildMelody() {
      var merged = [];
      studio.tracks.forEach(function (t, i) {
        if (!studio.on[i]) return;
        (t.notes || []).forEach(function (x) {
          merged.push({ midi: x.midi, start: x.start, dur: x.dur });
        });
      });
      merged.sort(function (a, b) { return a.start - b.start || b.midi - a.midi; });
      var ex = D.extractMelody(merged);
      studio.chordSkipped = ex.chordSkipped;
      var transpose = Number($("#stTranspose").value || 0);
      var fold = $("#stFold").checked;
      var res = D.resolveMelody(ex.melody, { transpose: transpose, fold: fold, baseOct: "auto" });
      studio.melody = merged;
      studio.playable = res.notes;
      studio.baseOct = res.base;
      studio.foldedCount = res.foldedCount;
      renderStudioRoll();
    }

    /* ── 钢琴卷帘 ── */
    function studioGeom() {
      var el = $("#stRoll");
      var W = el.clientWidth || 800, H = el.clientHeight || 210;
      var padL = 34, padB = 16;
      var notes = studio.playable;
      var d = 0;
      notes.forEach(function (n) { if (n.start + n.dur > d) d = n.start + n.dur; });
      d = Math.max(1, d);
      var pxps = 40;  /* 固定 40px/秒，避免长曲被压缩成一屏 */
      var lo = 127, hi = 0;
      notes.forEach(function (n) {
        if (n.midi < lo) lo = n.midi;
        if (n.midi > hi) hi = n.midi;
      });
      if (!notes.length) { lo = 60; hi = 72; }
      lo = Math.floor((lo - 2) / 12) * 12;
      hi = Math.ceil((hi + 3) / 12) * 12;
      var rows = hi - lo, rowH = (H - padB) / rows;
      return { W: W, H: H, padL: padL, padB: padB, pxps: pxps, lo: lo, hi: hi, rowH: rowH, d: d };
    }

    function renderStudioRoll() {
      var g = studioGeom(), svg = $("#stSvg");
      var contentW = Math.max(g.W, g.padL + g.d * g.pxps + 6);
      svg.setAttribute("viewBox", "0 0 " + contentW + " " + g.H);
      svg.setAttribute("width", contentW);
      svg.setAttribute("data-content-w", contentW);
      var html = "";
      for (var m = g.lo; m <= g.hi; m++) {
        var y = g.H - g.padB - (m - g.lo) * g.rowH;
        var pc = D.mod12(m);
        if ([1, 3, 6, 8, 10].indexOf(pc) >= 0)
          html += '<rect x="' + g.padL + '" y="' + y + '" width="' + (contentW - g.padL) + '" height="' + g.rowH + '" fill="rgba(37,99,235,.035)"/>';
        if (pc === 0 || pc === 5 || pc === 7)
          html += '<text class="hk-rowlabel" x="3" y="' + (y + g.rowH * .7) + '">' + D.pitchName(m) + '</text>';
      }
      studio.playable.forEach(function (n) {
        var x = g.padL + n.start * g.pxps;
        var w = Math.max(3, n.dur * g.pxps - 1);
        var yy = g.H - g.padB - (n.midi - g.lo + .85) * g.rowH;
        var h = Math.max(3, g.rowH * .72);
        var cls = "hk-note-rect" + (!n.inRange ? " is-skip" : n.folded ? " is-fold" : "");
        html += '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + yy.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"/>';
      });
      html += '<line class="hk-playhead" id="stHead" x1="' + g.padL + '" y1="0" x2="' + g.padL + '" y2="' + (g.H - g.padB) + '"/>';
      svg.innerHTML = html;
      var d = studioGeom().d;
      $("#stDur").textContent = D.formatTime(d);
      $("#stCur").textContent = D.formatTime(0);
    }

    function studioUpdateHead() {
      var g = studioGeom(), line = $("#stHead");
      if (!line) return;
      var x = g.padL + studio.seek * g.pxps;
      line.setAttribute("x1", x);
      line.setAttribute("x2", x);
      $("#stCur").textContent = D.formatTime(studio.seek);
      /* 自动右滚：播放头越过容器右半区时跟随滚动 */
      var roll = $("#stRoll");
      if (roll) {
        var maxScroll = roll.scrollWidth - roll.clientWidth;
        var target = x - roll.clientWidth * 0.45;
        if (target > roll.scrollLeft && maxScroll > 0) {
          roll.scrollLeft = Math.min(target, maxScroll);
        }
      }
    }

    /* ── 播放（真实口琴采样） ── */
    function studioStop(silent) {
      studio.playing = false;
      if (studio.raf) cancelAnimationFrame(studio.raf);
      studio.raf = 0;
      D.audio.stop();
      $("#stPlay").disabled = false;
      $("#stStop").disabled = true;
      if (!silent) studio.seek = 0;
      studioUpdateHead();
    }
    /* 切屏：页面隐藏时暂停（保留进度），回到页面时从暂停处继续 */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (studio.playing) { studio.wasPlaying = true; studioStop(true); }
      } else {
        if (studio.wasPlaying) { studio.wasPlaying = false; studioPlay(); }
      }
    });
    /* 切屏：页面隐藏时暂停（保留进度），回到页面时从暂停处继续 */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (studio.playing) { studio.wasPlaying = true; studioStop(true); }
      } else {
        if (studio.wasPlaying) { studio.wasPlaying = false; studioPlay(); }
      }
    });

    function studioPlay() {
      D.audio.ensure();
      D.audio.loadSounds();
      if (D.audio.setVolume) D.audio.setVolume(Number($("#stVol").value || 80) / 100);
      studioStop(true);
      var dur = studioGeom().d;
      if (studio.seek >= dur - .05) studio.seek = 0;
      studio.playing = true;
      var ctx = D.audio.ensure();
      studio.ctx0 = ctx.currentTime - studio.seek;
      studio.idx = studio.playable.findIndex(function (n) { return n.start >= studio.seek - .02; });
      if (studio.idx < 0) studio.idx = 0;
      $("#stPlay").disabled = true;
      $("#stStop").disabled = false;
      var speed = Number($("#stSpeed").value || 100) / 100;
      var legato = Number($("#stLegato").value || 92) / 100;
      (function tick() {
        if (!studio.playing) return;
        var now = D.audio.ensure().currentTime;
        while (studio.idx < studio.playable.length) {
          var n = studio.playable[studio.idx];
          var when = studio.ctx0 + n.start / speed;
          if (when > now + .15) break;
          if (n.inRange && !$("#stMute").checked) {
            var nextStart = null;
            for (var j = studio.idx + 1; j < studio.playable.length; j++) {
              if (studio.playable[j].start > n.start) { nextStart = studio.playable[j].start; break; }
            }
            var gap = nextStart !== null ? (nextStart - n.start) / speed : n.dur / speed;
            try {
              D.audio.play(n.midi, Math.max(.1, Math.min(n.dur / speed, gap * legato)), Math.max(when, now - .02));
            } catch (audioErr) { }
          }
          /* 乐谱表悬浮窗：显示当前音 + 序号 */
          fscoreRender(n, studio.idx, studio.playable.length);
          studio.idx++;
        }
        studio.seek = Math.min(dur, (now - studio.ctx0) * speed);
        studioUpdateHead();
        var lastEnd = studio.playable.length
          ? (studio.playable[studio.playable.length - 1].start + studio.playable[studio.playable.length - 1].dur) / speed
          : dur;
        if (studio.seek >= Math.max(dur, lastEnd)) {
          studio.seek = dur;
          studioUpdateHead();
          studioStop(true);
          fscoreClear();
          return;
        }
        studio.raf = requestAnimationFrame(tick);
      })();
    }

    /* ── 乐谱表悬浮窗渲染（与原版 fscoreSet 同构 + 红色序号） ── */
    function fscoreRender(n, idx, total) {
      var now = $("#fscoreNow"), next = $("#fscoreNext");
      if (!now) return;
      var keyShow = n.key === "," ? "，" : n.key.toUpperCase();
      var mod = D.modInfo(n.slot, n.sharp);
      var posHtml = "";
      if (typeof idx === "number" && total) {
        posHtml = '<span class="hk-fscore-pos">' + (idx + 1) + " / " + total + "</span>";
      }
      now.innerHTML = '<span class="hk-fscore-key">' + keyShow + '</span>' +
        '<span class="hk-fscore-mod ' + mod.cls + '">' + mod.label + " · " + D.pitchName(n.midi) + "</span>" +
        posHtml;
      var upcoming = [];
      for (var i = idx + 1; i < Math.min(idx + 5, studio.playable.length); i++) {
        var nn = studio.playable[i];
        if (!nn.inRange) continue;
        upcoming.push((nn.key === "," ? "，" : nn.key.toUpperCase()) + " " + D.modInfo(nn.slot, nn.sharp).label);
      }
      if (next) next.textContent = upcoming.join("   ");
      var win = $("#hkFScore");
      if (win && win.hidden === false) { /* 保持原样 */ }
    }

    function fscoreClear() {
      var now = $("#fscoreNow"), next = $("#fscoreNext");
      if (now) now.innerHTML = '<span class="hk-fscore-key">—</span><span class="hk-fscore-mod">等待乐谱</span><span class="hk-fscore-pos" id="fscorePos" hidden></span>';
      if (next) next.textContent = "";
    }

    /* ════════ 导出 / 存库 ════════ */
    function exportTupleTxt() {
      if (!studio.playable.length) { toast("还没有可导出的曲谱"); return; }
      var name = ($("#stName").value || "").trim() || studio.title;
      var txt = D.buildTupleTxt(name, { notes: studio.playable, bpm: studio.bpm }, studio.baseOct);
      D.downloadText(name + ".txt", txt);
      toast("已导出约定格式 txt");
    }

    function exportMidi() {
      if (!studio.melody.length) { toast("还没有可导出的曲谱"); return; }
      var name = ($("#stName").value || "").trim() || studio.title;
      var notes = studio.melody.filter(function (n) { return n.midi > 0; });
      if (!notes.length) notes = studio.melody;
      var bytes = D.buildMidi(notes, { bpm: studio.bpm, trackName: name });
      D.downloadBytes(name + ".mid", bytes);
      toast("已导出 MIDI");
    }

    function saveToLibrary() {
      if (!studio.playable.length) { toast("还没有可保存的曲谱"); return; }
      var name = ($("#stName").value || "").trim() || studio.title;
      var user = D.currentUser();
      var uploader = user ? user.name : "匿名投稿者";
      var tags = pending.kind === "midi" ? ["MIDI", "多音轨"] : ["txt"];
      var rec;
      if (pending.source === "midi") {
        rec = D.buildRecord({
          title: name, composer: "未标注原作者", uploader: uploader, tags: tags,
          source: "midi", bpm: studio.bpm, tracks: studio.tracks, fold: $("#stFold").checked
        });
      } else {
        rec = D.buildRecord({
          title: name, composer: "未标注原作者", uploader: uploader, tags: tags,
          source: pending.source, bpm: studio.bpm, parsedTxt: pending.parsed, fold: $("#stFold").checked
        });
      }
      D.Store.save(rec);
      toast("已存入乐谱库：" + name);
    }

    function revertToParse() {
      studioStop(true);
      $("#hkStudioView").hidden = true;
      $("#hkUpload").hidden = false;
      $("#hkFormat").hidden = false;
      $("#hkGo").hidden = false;
      $("#hkFilebar").hidden = true;
      $("#hkDrop").hidden = false;
      $("#hkParse").disabled = true;
      $("#hkCtaSub").textContent = "请先拖入一个 MIDI / txt / 音频文件";
      pending = { file: null, kind: null, parsed: null, source: "" };
      $("#hkStudioView").scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /* ════════ 事件绑定 ════════ */
    $("#stTrackSel").addEventListener("change", function () {
      studio.sel = Number(this.value);
      /* 选中单轨展示（开关仍可合并） */
      studio.on = studio.tracks.map(function (_, i) { return i === studio.sel; });
      renderTrackToggle();
      rebuildMelody();
    });
    $("#stTranspose").addEventListener("input", function () {
      $("#stTransposeVal").textContent = (Number(this.value) > 0 ? "+" : "") + this.value;
      rebuildMelody();
    });
    $("#stFold").addEventListener("change", rebuildMelody);
    $("#stSpeed").addEventListener("input", function () { $("#stSpeedVal").textContent = this.value + "%"; });
    $("#stLegato").addEventListener("input", function () { $("#stLegatoVal").textContent = this.value + "%"; });
    $("#stBreath").addEventListener("input", function () { $("#stBreathVal").textContent = this.value + "%"; });
    $("#stVol").addEventListener("input", function () {
      var v = Number(this.value);
      $("#stVolVal").textContent = v + "%";
      if (D.audio && D.audio.setVolume) D.audio.setVolume(v / 100);
    });
    $("#stPlay").addEventListener("click", studioPlay);
    $("#stStop").addEventListener("click", function () { studioStop(false); });
    $("#stSeek").addEventListener("input", function () {
      if (studio.playing) { studioStop(true); }
      var dur = studioGeom().d;
      studio.seek = Number(this.value) / 1000 * dur;
      studioUpdateHead();
    });
    $("#stExportTxt").addEventListener("click", exportTupleTxt);
    $("#stExportMidi").addEventListener("click", exportMidi);
    $("#stSaveLib").addEventListener("click", saveToLibrary);
    $("#stRevert").addEventListener("click", revertToParse);
    var rechooseEl = $("#hkRechoose");
    if (rechooseEl) {
      rechooseEl.addEventListener("click", function () {
        pending = { file: null, kind: null, parsed: null, source: "" };
      });
    }
    window.addEventListener("resize", function () {
      if (!$("#hkStudioView").hidden) renderStudioRoll();
    });

    /* F8 播放/停止 · F9 存入乐谱库 */
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "F8") {
        e.preventDefault();
        if ($("#hkStudioView") && !$("#hkStudioView").hidden) {
          if (studio.playing) studioStop(false);
          else studioPlay();
        } else if ($("#swinPlay") && !$("#swinPlay").disabled) {
          $("#swinPlay").click();
        }
      } else if (e.key === "F9") {
        e.preventDefault();
        if ($("#hkStudioView") && !$("#hkStudioView").hidden) saveToLibrary();
        else if ($("#stSaveLib") && !$("#hkStudioView").hidden) saveToLibrary();
      }
    });
  });
})();
