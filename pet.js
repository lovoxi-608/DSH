/* ═══════════════════════════════════════════════════════════════════════════
   【小宠物 PET】交互脚本
   ───────────────────────────────────────────────────────────────────────────
   ★ 想找宠物相关代码？只看这 3 个文件就够了：
       1. web/pet.js    ← 当前文件（图片地址、泡泡文案/图片、摸头/拖动逻辑）
       2. web/pet.css   ← 宠物 / 泡泡 / 局部布局微调（左下角控制器等）
       3. web/index.html 里有 `id="pet"` 的那一小段结构
   ★ 宠物图片放置位置： web/assets/pet/pet.png
   ★ 泡泡里的图片 / GIF 放置位置： web/assets/pet/bubble/（地址填进下面的 PET_MESSAGES）
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── ① 宠物图片地址 ───────────────────────────────────────────────────────
      把图片放到 web/assets/pet/ 目录下，默认文件名 pet.png 即可自动显示。
      如果你用的是 gif / webp，或者想换成别的名字，改下面这个数组就行。
      （也可以直接写 http(s):// 的在线图片地址。）
   ──────────────────────────────────────────────────────────────────────── */
const PET_IMAGE_CANDIDATES = ["/assets/pet/pet.png", "/assets/pet/pet.gif"];

/* ── ② 点击宠物时，泡泡里出现的内容（文案 / 图片 / GIF）────────────────
      字符串 = 一句文案；对象 = 一张图片或 GIF。随便增删，每次点击随机抽一条。
      ★ 图片 / GIF 放到 web/assets/pet/bubble/ 目录下，地址填在 image 字段：
            { image: "/assets/pet/bubble/我的图.gif", alt: "说明" }
        也支持 png / jpg / webp / svg，以及 http(s):// 在线地址。
      ★ GIF **不用填时长**：脚本会自己解析它的帧延时，保证完整播完一遍再切回金额；
        想手动指定就加 holdMs: 3000（毫秒）。静态图片默认停 PET_MEDIA_HOLD_MS。
   ──────────────────────────────────────────────────────────────────────── */
const PET_MESSAGES = [
  "饿了",
  "给我整点tonken！！！",
  "傻福挂噶唐鼠",
  // ↓ 图片 / GIF 示例（换地址即可用你自己的图）
  { image: "/assets/pet/bubble/sq1.gif", alt: "生气砸锅" },
  { image: "/assets/pet/bubble/sq2.gif", alt: "生气1" },
  { image: "/assets/pet/bubble/hq1.jpg", alt: "哈气" },
  { image: "/assets/pet/bubble/shaxiao1.png", alt: "傻笑" },
  { image: "/assets/pet/bubble/benti1.png", alt: "本体" },
  { image: "/assets/pet/bubble/yaofan.png", alt: "yaofan" },
  { image: "/assets/pet/bubble/chibaifan.jpg", alt: "吃白饭" },
  { image: "/assets/pet/bubble/xuanfan.gif", alt: "炫饭" },
  { image: "/assets/pet/bubble/fanne.jpg", alt: "饭呢" },
  
];

/* ── ③ 鼠标悬停在宠物上时，泡泡显示的金额模板 ─────────────────────────────
      %a = 剩余金额（来自 DeepSeek 余额接口）
      %b = 今日使用金额（后端用余额变化估算，见 web_app.py 里的说明）
      %b 的字号更小、透明度更低，样式在 web/pet.css 的 .pet-amount-b
   ──────────────────────────────────────────────────────────────────────── */
const PET_USAGE_TEMPLATE = "剩余金额：%a，今日使用金额：%b";
const PET_USAGE_API = "/api/usage";
const PET_USAGE_CACHE_MS = 30000;      // 金额缓存 30 秒，避免频繁请求
const PET_DRAG_THRESHOLD = 6;          // 位移超过该像素数就算「拖动」而不是「摸头」
const PET_MESSAGE_HOLD_MS = 1800;      // 点击弹出的文案停留多久，之后切回金额
const PET_MEDIA_HOLD_MS = 2600;        // 静态图片的停留时长
const PET_GIF_EXTRA_MS = 400;          // GIF 播完后再多留一点，确保完整展示
const PET_GIF_FALLBACK_MS = 4000;      // GIF 时长解析失败时的兜底时长
const PET_HOLD_MAX_MS = 20000;         // 停留上限，避免超长 GIF 把泡泡按太久

/* ── 点击音效（玩具鸭「唧~嘟~」）─────────────────────────────────────────
      ★ 想换成自己的音效：把音频文件（mp3 / wav / ogg）放到 web/assets/pet/ 下，
        文件名用 duck.mp3（或 duck.wav / duck.ogg）即可自动生效；
        也可以直接改下面这个数组，支持 http(s):// 在线地址。
      ★ 三个文件都不存在时，自动退回内置合成音：高音「唧~」+ 低音「嘟~」。
   ──────────────────────────────────────────────────────────────────────── */
const PET_SOUND_CANDIDATES = ["/assets/pet/duck.mp3", "/assets/pet/duck.wav", "/assets/pet/duck.ogg"];

/* ── ④ 北京时间 + 高峰 / 低峰判定（泡泡第三行）──────────────────────────
      时间来源：后端 /api/time（用 UTC+8 硬算，见 web_app.py），
                取不到时自动退回浏览器时区库（Asia/Shanghai）。
      ★ 高峰时段在这里改：每段是 [起, 止]，起点算高峰、终点不算。
        例如 [9, 12] = 9:00 到 12:00 之前；想把 12:00 整也算进去就写 [9, 13]。
   ──────────────────────────────────────────────────────────────────────── */
const PET_TIME_API = "/api/time";
const PET_PEAK_PERIODS = [[9, 12], [14, 18]];
const PET_TIME_CACHE_MS = 30000;       // 时间缓存 30 秒

(function initPet() {
  const petEl = document.querySelector("#pet");
  if (!petEl) {
    console.warn("没有找到 #pet 节点，宠物未启动");
    return;
  }
  const petBody = document.querySelector("#petBody");
  const petImage = document.querySelector("#petImage");
  const bubbleEl = document.querySelector("#petBubble");

  let press = null;            // 当前按压状态：{ pointerId, startX, startY, dragging, offsetX, offsetY }
  let usageCache = { at: 0, data: null };
  let timeCache = { at: 0, data: null };
  let usageToken = 0;          // 用来丢弃「已松手」之后才回来的余额结果
  let holdTimer = null;        // 点击后「随机对话 → 金额」的延时切换
  let holdToken = 0;           // 丢弃过期的「停留时长 → 定时器」回调
  let holdMsPromise = Promise.resolve(PET_MESSAGE_HOLD_MS);  // 当前泡泡内容该停留多久
  const gifDurationCache = new Map();   // gif 地址 → 毫秒（解析结果缓存）
  let audioContext = null;     // 合成音效用的 Web Audio 上下文（首次点击时才创建）
  let soundFile = null;        // 命中音频文件时用它播放；为 null 则用合成音

  function clearHoldTimer() {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  }

  /* ── 音效文件：放到 web/assets/pet/duck.mp3 即自动启用 ── */
  function loadPetSound(index) {
    if (index >= PET_SOUND_CANDIDATES.length) return;    // 都没有 → 一直用合成音
    const audio = new Audio();
    audio.preload = "auto";
    const ready = () => { soundFile = audio; };
    audio.addEventListener("canplay", ready, { once: true });
    audio.addEventListener("loadeddata", ready, { once: true });
    audio.addEventListener("error", () => loadPetSound(index + 1), { once: true });
    audio.src = PET_SOUND_CANDIDATES[index];
    try {
      audio.load();
    } catch (error) {
      console.warn("音效文件读取失败", error);
    }
  }
  loadPetSound(0);

  /* ── 点击时发声：优先用音频文件，没有就现场合成 ── */
  function playDuckSqueak() {
    if (soundFile) {
      try {
        soundFile.currentTime = 0;
        const played = soundFile.play();
        if (played && typeof played.catch === "function") played.catch(() => synthDuckSqueak());
        return;
      } catch (error) {
        console.warn("音效文件播放失败，改用合成音", error);
      }
    }
    synthDuckSqueak();
  }

  /* ── 内置合成音：高音「唧~」+ 低音「嘟~」，模拟捏响橡胶玩具鸭 ── */
  function synthDuckSqueak() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioContext ||= new Ctx();
      if (audioContext.state === "suspended") audioContext.resume();
      const ctx = audioContext;
      const now = ctx.currentTime;

      // 低通滤掉过尖的高频，听感更接近橡胶而不是电子蜂鸣
      const shaper = ctx.createBiquadFilter();
      shaper.type = "lowpass";
      shaper.frequency.value = 3400;
      shaper.connect(ctx.destination);

      /* ① 「唧」：三角波快速上滑，再叠一点 42Hz 抖动，像橡胶被捏响 */
      const squeak = ctx.createOscillator();
      const squeakGain = ctx.createGain();
      const wobble = ctx.createOscillator();
      const wobbleDepth = ctx.createGain();
      squeak.type = "triangle";
      squeak.frequency.setValueAtTime(760, now);
      squeak.frequency.exponentialRampToValueAtTime(1650, now + 0.035);
      squeak.frequency.exponentialRampToValueAtTime(880, now + 0.15);
      wobble.frequency.value = 42;
      wobbleDepth.gain.value = 90;
      wobble.connect(wobbleDepth).connect(squeak.frequency);
      squeakGain.gain.setValueAtTime(0.0001, now);
      squeakGain.gain.exponentialRampToValueAtTime(0.30, now + 0.010);
      squeakGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
      squeak.connect(squeakGain).connect(shaper);
      squeak.start(now);
      wobble.start(now);
      squeak.stop(now + 0.17);
      wobble.stop(now + 0.17);

      /* ② 「嘟」：低音正弦顺势下沉，像鸭子肚子里的气声 */
      const toot = ctx.createOscillator();
      const tootGain = ctx.createGain();
      toot.type = "sine";
      const at = now + 0.10;
      toot.frequency.setValueAtTime(430, at);
      toot.frequency.exponentialRampToValueAtTime(240, at + 0.13);
      tootGain.gain.setValueAtTime(0.0001, at);
      tootGain.gain.exponentialRampToValueAtTime(0.22, at + 0.012);
      tootGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      toot.connect(tootGain).connect(shaper);
      toot.start(at);
      toot.stop(at + 0.18);
    } catch (error) {
      console.warn("玩具鸭音效不可用", error);
    }
  }

  /* ── 图片加载：依次尝试候选地址，全都失败就显示占位小精灵 ── */
  function loadPetImage(index) {
    if (index >= PET_IMAGE_CANDIDATES.length) {
      petBody.classList.add("is-missing");
      return;
    }
    petImage.onerror = () => loadPetImage(index + 1);
    petImage.onload = () => petBody.classList.remove("is-missing");
    petImage.src = PET_IMAGE_CANDIDATES[index];
  }
  loadPetImage(0);

  /* ── 泡泡 ── */
  function setBubble(html, isMedia) {
    bubbleEl.innerHTML = html;
    bubbleEl.classList.toggle("has-media", Boolean(isMedia));
    bubbleEl.classList.add("is-visible");
  }
  function hideBubble() {
    clearHoldTimer();
    holdToken += 1;
    usageToken += 1;                                   // 作废还没回来的金额请求，离开后不再冒出泡泡
    bubbleEl.classList.remove("is-visible");
  }

  /* 图片 / GIF 条目：{ image: "地址", alt: "说明", holdMs?: 时长 } */
  function isMediaEntry(entry) {
    return Boolean(entry) && typeof entry === "object" && entry.image;
  }
  const isGifSrc = (src) => /\.gif(\?|#|$)/i.test(String(src));

  /* ── GIF 真实时长：浏览器不给 gif 的播放事件，只能自己数帧延时 ──
        00 21 F9 04 <packed> <delay 2字节> <透明色索引> 00，delay 单位 1/100 秒；
        把每帧延时加起来就是完整播一遍的时长。解析不出来就用兜底时长。 */
  async function gifDurationMs(src) {
    if (gifDurationCache.has(src)) return gifDurationCache.get(src);
    let duration = PET_GIF_FALLBACK_MS;
    try {
      const buffer = await (await fetch(src)).arrayBuffer();
      duration = parseGifDuration(new Uint8Array(buffer)) || PET_GIF_FALLBACK_MS;
    } catch (error) {
      console.warn("GIF 时长解析失败，改用兜底时长", src, error);
    }
    gifDurationCache.set(src, duration);
    return duration;
  }

  function skipGifSubBlocks(bytes, offset) {
    while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
    return offset + 1;
  }

  function parseGifDuration(bytes) {
    if (bytes.length < 14) return 0;
    const header = String.fromCharCode.apply(null, Array.from(bytes.slice(0, 6)));
    if (header !== "GIF87a" && header !== "GIF89a") return 0;
    let offset = 6;
    const screenPacked = bytes[offset + 4];
    offset += 7;
    if (screenPacked & 0x80) offset += 3 * (1 << ((screenPacked & 0x07) + 1));   // 跳过全局色表
    let total = 0;
    while (offset < bytes.length) {
      const marker = bytes[offset++];
      if (marker === 0x3B) break;                        // 文件结束
      if (marker === 0x21) {                             // 扩展块
        const label = bytes[offset++];
        if (label === 0xF9 && offset + 3 < bytes.length) {          // 图形控制扩展：帧延时
          const delay = bytes[offset + 2] | (bytes[offset + 3] << 8);
          total += (delay < 2 ? 10 : delay) * 10;        // 0/1 会被浏览器当成 10，这里保持一致
        }
        offset = skipGifSubBlocks(bytes, offset);
        continue;
      }
      if (marker === 0x2C) {                             // 图像描述块
        const localPacked = bytes[offset + 8];
        offset += 9;
        if (localPacked & 0x80) offset += 3 * (1 << ((localPacked & 0x07) + 1));  // 跳过局部色表
        offset += 1;                                     // LZW 最小码长
        offset = skipGifSubBlocks(bytes, offset);
        continue;
      }
      break;                                             // 未知块，停止解析
    }
    return total;
  }

  /* 泡泡里的图片：加载失败时给一句可排查的提示 */
  function showMediaBubble(src, alt) {
    setBubble(`<img class="pet-bubble-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}" draggable="false" />`, true);
    bubbleEl.querySelector("img")?.addEventListener("error", () => {
      holdMsPromise = Promise.resolve(PET_MESSAGE_HOLD_MS);
      setBubble(bubbleLines("图片没找到，检查 web/assets/pet/bubble/ 里的地址"));
    });
  }

  function showRandomMessage() {
    showPetMessage(PET_MESSAGES[Math.floor(Math.random() * PET_MESSAGES.length)]);
  }

  /* 显示指定内容：字符串当文案，对象当图片 / GIF（点击宠物时随机抽一条） */
  function showPetMessage(entry) {
    clearHoldTimer();
    holdToken += 1;
    usageToken += 1;                                   // 作废还没回来的余额请求
    if (!isMediaEntry(entry)) {
      holdMsPromise = Promise.resolve(PET_MESSAGE_HOLD_MS);
      setBubble(bubbleLines(entry == null ? "" : String(entry)));       // 文案里出现「，」同样会换行
      return;
    }
    const src = String(entry.image);
    showMediaBubble(src, entry.alt);
    if (Number(entry.holdMs) > 0) {
      holdMsPromise = Promise.resolve(Number(entry.holdMs));
      return;
    }
    // 静态图用固定时长；GIF 等解析出真实时长，保证完整播完一遍
    holdMsPromise = isGifSrc(src)
      ? gifDurationMs(src).then((ms) => Math.min(ms + PET_GIF_EXTRA_MS, PET_HOLD_MAX_MS))
      : Promise.resolve(PET_MEDIA_HOLD_MS);
  }

  /* ── 泡泡文案排版：出现「，」就换行 ── */
  function bubbleLines(text) {
    return String(text)
      .split("，")
      .map((line) => escapeHtml(line))
      .join("，<br>");
  }

  /* ── 高峰 / 低峰判定：9:00-12:00、14:00-18:00 为高峰期 ── */
  function isPeakTime(hour, minute) {
    const minutes = hour * 60 + minute;
    return PET_PEAK_PERIODS.some(([start, end]) => minutes >= start * 60 && minutes < end * 60);
  }
  function peakHtml(peak) {
    if (!peak) return '<span class="pet-peak-wait">判断中…</span>';
    return peak.isPeak
      ? '<span class="pet-peak-high">高峰期</span>'      // 红色
      : '<span class="pet-peak-low">低峰期</span>';      // 淡蓝色
  }

  /* ── 金额 + 高峰判定：模板里的 %a / %b 替换成带样式的金额，第三行是高峰/低峰 ── */
  function usageHtml(balanceText, todayText, peak) {
    // 用哨兵字符占位，避免金额文案被二次匹配（例如两个值都是「—」时）
    const raw = PET_USAGE_TEMPLATE.replace("%a", "\u0001").replace("%b", "\u0002");
    const html = bubbleLines(raw)
      .replace("\u0001", `<span class="pet-amount-a">${escapeHtml(balanceText)}</span>`)
      .replace("\u0002", `<span class="pet-amount-b">${escapeHtml(todayText)}</span>`);
    return `${html}<br>${peakHtml(peak)}`;
  }

  /* ── 北京时间：优先问后端 /api/time，失败则用浏览器时区库兜底 ── */
  function beijingFromBrowser() {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false, hourCycle: "h23",
      }).formatToParts(new Date());
      const pick = (type) => Number((parts.find((item) => item.type === type) || {}).value || 0);
      return { hour: pick("hour"), minute: pick("minute"), source: "browser" };
    } catch (error) {
      console.warn("浏览器无法计算北京时间", error);
      return null;
    }
  }
  async function fetchBeijingTime() {
    if (timeCache.data && Date.now() - timeCache.at < PET_TIME_CACHE_MS) return timeCache.data;
    let clock = null;
    try {
      const data = await (await fetch(PET_TIME_API)).json();
      if (data.ok) clock = { hour: data.hour, minute: data.minute, source: "server" };
    } catch (error) {
      console.warn("北京时间接口不可用，改用浏览器时间", error);
    }
    clock = clock || beijingFromBrowser();
    if (!clock) return null;
    clock.isPeak = isPeakTime(clock.hour, clock.minute);
    timeCache = { at: Date.now(), data: clock };
    return clock;
  }
  function formatAmount(value, currency) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";
    const symbol = currency === "CNY" ? "¥" : (currency ? `${currency} ` : "");
    return `${symbol}${number.toFixed(2)}`;
  }
  async function fetchUsage() {
    if (usageCache.data && Date.now() - usageCache.at < PET_USAGE_CACHE_MS) return usageCache.data;
    try {
      const response = await fetch(PET_USAGE_API);
      const data = await response.json();
      // 后端现在给的是「今日使用金额」：优先 today_spent，老字段 spent 兜底
      const todayValue = data.today_spent !== undefined ? data.today_spent : data.spent;
      const result = data.ok
        ? { balance: formatAmount(data.balance, data.currency), today: formatAmount(todayValue, data.currency) }
        : { balance: "—", today: "—" };
      if (data.ok) usageCache = { at: Date.now(), data: result };
      return result;
    } catch (error) {
      console.warn("余额读取失败", error);
      return { balance: "—", today: "—" };
    }
  }
  function showUsageMessage() {
    clearHoldTimer();
    const token = ++usageToken;
    setBubble(usageHtml("读取中…", "读取中…", null));
    Promise.all([fetchUsage(), fetchBeijingTime()]).then(([data, clock]) => {
      if (token === usageToken) setBubble(usageHtml(data.balance, data.today, clock));
    });
  }

  /* ── 悬停：泡泡显示金额（剩余 / 今日使用）── */
  petEl.addEventListener("pointerenter", () => { if (!press) showUsageMessage(); });
  petEl.addEventListener("pointerleave", () => { if (!press) hideBubble(); });

  /* ── 左键按住：压扁宠物（摸头）+ 泡泡切换成随机对话 ── */
  petEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;                    // 只响应鼠标左键
    press = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false };
    // 先出效果再抓指针：即使捕获失败（例如合成事件）也不影响摸头动画
    petEl.classList.add("is-patting");
    playDuckSqueak();                                  // 按住瞬间响一声「玩具鸭」
    showRandomMessage();
    try {
      petEl.setPointerCapture(event.pointerId);
    } catch (error) {
      console.warn("指针捕获失败，摸头效果仍可用", error);
    }
    event.preventDefault();
  });

  /* ── 按住后移动：变成拖动宠物 ── */
  petEl.addEventListener("pointermove", (event) => {
    if (!press || press.pointerId !== event.pointerId) return;
    if (!press.dragging) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < PET_DRAG_THRESHOLD) return;
      press.dragging = true;
      petEl.classList.remove("is-patting");
      petEl.classList.add("is-dragging");
      const rect = petEl.getBoundingClientRect();
      press.offsetX = event.clientX - rect.left;
      press.offsetY = event.clientY - rect.top;
      petEl.style.right = "auto";
      petEl.style.bottom = "auto";
      petEl.style.left = `${rect.left}px`;
      petEl.style.top = `${rect.top}px`;
    }
    const maxX = Math.max(8, window.innerWidth - petEl.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - petEl.offsetHeight - 8);
    petEl.style.left = `${Math.max(8, Math.min(event.clientX - press.offsetX, maxX))}px`;
    petEl.style.top = `${Math.max(8, Math.min(event.clientY - press.offsetY, maxY))}px`;
  });

  /* ── 松手：弹回原形，随机内容停留一会儿再切回金额（鼠标还停在宠物上时）── */
  function endPress(event) {
    if (!press || press.pointerId !== event.pointerId) return;
    press = null;
    petEl.classList.remove("is-patting", "is-dragging");
    if (petEl.matches(":hover")) {
      clearHoldTimer();
      const token = ++holdToken;
      // 等「该停多久」算出来（GIF 要解析帧时长）再开定时器，保证 GIF 能完整播完
      holdMsPromise.then((wait) => {
        if (token !== holdToken || press) return;      // 期间又摸了头 / 在拖动 → 放弃这次切换
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (!press && petEl.matches(":hover")) showUsageMessage();
        }, Math.max(wait, PET_MESSAGE_HOLD_MS));
      });
    } else {
      hideBubble();
    }
  }
  petEl.addEventListener("pointerup", endPress);
  petEl.addEventListener("pointercancel", endPress);

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  // 独立指针：以后想扩展宠物行为，从这里入手即可。
  window.petPointer = {
    element: petEl,
    showRandomMessage,
    showMessage: showPetMessage,          // 想预览自己的图：petPointer.showMessage({ image: "/assets/pet/bubble/xx.gif" })
    gifDuration: gifDurationMs,           // 查某个 gif 的完整播放时长（毫秒）
    refreshUsage: () => { usageCache = { at: 0, data: null }; return fetchUsage(); },
    refreshTime: () => { timeCache = { at: 0, data: null }; return fetchBeijingTime(); },
    isPeakTime,
  };
})();
