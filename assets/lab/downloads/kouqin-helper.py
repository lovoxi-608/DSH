# -*- coding: utf-8 -*-
"""
口琴助手 v2 —— 游戏口琴曲谱悬浮引导小程序（圆角 · 毛玻璃质感）
===============================================================
· 无边框置顶半透明悬浮窗，可拖动 / 缩放，叠在游戏画面上
· 整体 Canvas 自绘：所有面板 / 按钮 / 列表 / 滑杆均为圆角，窗口圆角 + 亚克力毛玻璃
· 布局参照游戏内口琴面板：左侧 = 曲名 / 剩余 / 移调 / 检测到 / 曲谱列表 / 热键；右侧 = 下落音符
· 8 个按键通道（z x c v b n m ,）下落式引导，提示何时按哪个键、按哪个鼠标修饰键
· 修饰键与游戏一致（三角洲口琴体系）：鼠标左键=低八度 · 右键=高八度 · 中键=升半音（基准音不按修饰键）
· 纯视觉辅助（无发声）：只告诉使用者该按哪个键
· 加载「口琴谱解析」网页导出的 .txt 曲谱；内置示例曲目
· 全局热键（全部需按住 Shift / Ctrl）：
    Shift+F6  隐藏 / 显示窗口        Shift+F7  下一首
    Shift+F8  锁定 / 解锁布局(拖动缩放) Shift+F9  从头重来
    Shift+F10 面板穿透(鼠标透给游戏)  Shift+F11 添加曲谱
    Ctrl+Alt+Q 退出程序
依赖：仅 Python 标准库（tkinter / ctypes）
"""
import ctypes
import math
import os
import queue
import sys
import threading
import tkinter as tk
import tkinter.filedialog as filedialog
import tkinter.messagebox as messagebox
from ctypes import wintypes

# ═══════════ 常量（三角洲口琴体系：左键低八度 · 右键高八度 · 中键升半音） ═══════════
KEYS = ["z", "x", "c", "v", "b", "n", "m", ","]      # 游戏口琴基础键（z..m = do~si，, = 高音do）
KEY_SEM = [0, 2, 4, 5, 7, 9, 11, 0]                  # 各键相对 do 的半音（逗号 pc=0，八度+1）
COM_KEY_IDX = 7
SHARP_PC = [1, 3, 6, 8, 10]                           # 需要中键（升半音）的半音号
DEFAULT_BASE_OCT = 4                                  # 默认基准八度（C4=60）
# 修饰 = (槽位 slot, 升半音 sharp)：slot -1=低八度 / 0=基准 / 1=高八度
MOD_LABEL = {(0, 0): "基准", (-1, 0): "低八度", (1, 0): "高八度",
             (0, 1): "升半音", (-1, 1): "低八度+升半音", (1, 1): "高八度+升半音"}
MOD_MOUSE = {(0, 0): "不按修饰键", (-1, 0): "按住鼠标左键", (1, 0): "按住鼠标右键",
             (0, 1): "按住鼠标中键", (-1, 1): "按住左键+中键", (1, 1): "按住右键+中键"}
MOD_COLOR = {(0, 0): "#8b95a5", (-1, 0): "#4d8dff", (1, 0): "#ff6b6b",
             (0, 1): "#3ecb7a", (-1, 1): "#3ec6d9", (1, 1): "#ffb454"}
# v1.0 旧谱修饰近似转换（旧: 本音/降调/升调/半+降/半+升）
OLD_MOD_MAP = {"本音": (0, 0), "降调": (-1, 0), "升调": (1, 0),
               "半+降": (-1, 1), "半+升": (1, 1)}
OLD_MOD_INT = {-2: (-1, 0), 2: (1, 0), -1: (-1, 1), 1: (1, 1), 0: (0, 0)}

# ── 主题色 ──
C_BG      = "#0d1420"   # 窗口底色
C_PANEL   = "#131c2c"   # 左卡片
C_BORDER  = "#26385a"
C_CARD2   = "#0a111d"   # 右画布卡片
C_BTN     = "#1c2a44"
C_BTN_H   = "#2a3f66"
C_BTN_A   = "#3a5780"
C_GREEN   = "#1e7a44"
C_GREEN_H = "#2a9c58"
C_TEXT    = "#dbe6f2"
C_SUB     = "#8fa6c0"
C_DIM     = "#5c6f8a"
C_ACCENT  = "#5b9bff"
C_GOLD    = "#ffc34d"

F_TITLE  = ("Microsoft YaHei UI", 12, "bold")
F_NORM   = ("Microsoft YaHei UI", 10)
F_SMALL  = ("Microsoft YaHei UI", 9)
F_TINY   = ("Microsoft YaHei UI", 8)
F_KEY    = ("Consolas", 11, "bold")

VERSION = "v2.1"


# ═══════════ 曲谱解析与内置示例 ═══════════
def parse_score_text(text, fallback_name="未命名曲目"):
    """解析导出的曲谱文本 → {name, baseOct, notes:[{k,m,s,d}]}
    m = (slot, sharp)：slot -1=低八度 / 0=基准 / 1=高八度；sharp=是否升半音"""
    name = fallback_name
    base_oct = DEFAULT_BASE_OCT
    notes = []
    pos = 0.0
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("曲名:"):
            v = line.split(":", 1)[1].strip()
            if v:
                name = v
            continue
        if line.startswith("基准八度:"):
            try:
                base_oct = int(line.split(":", 1)[1].strip())
            except Exception:
                pass
            continue
        if ":" in line and line.split(":", 1)[0].strip() in ("BPM", "bpm", "速度"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        ch = parts[0].lower()
        if ch not in KEYS:
            continue
        k = KEYS.index(ch)
        mod_raw = parts[1]
        try:
            if mod_raw in MOD_LABEL.values():
                m = [mm for mm in MOD_LABEL if MOD_LABEL[mm] == mod_raw][0]
            elif mod_raw in OLD_MOD_MAP:
                m = OLD_MOD_MAP[mod_raw]
            else:
                n = int(mod_raw)
                m = OLD_MOD_INT.get(n, (0, 0))
        except Exception:
            m = (0, 0)
        if len(parts) >= 4:
            try:
                s = float(parts[2])
                d = max(0.08, float(parts[3]))
            except Exception:
                s, d = pos, 0.4
        else:
            s, d = pos, 0.4
        notes.append({"k": k, "m": m, "s": s, "d": d})
        pos = max(pos, s + d)
    return {"name": name, "baseOct": base_oct, "notes": notes}


def parse_score_file(path):
    with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
        return parse_score_text(f.read(), os.path.splitext(os.path.basename(path))[0])


def build_song(chars, mods=None, dur=0.5, gap=0.0, bpm=None):
    """把字符串键位（如 'zzbbnnb'）转成曲谱对象；mods 可选同长度修饰列表 [(slot,sharp),...]"""
    notes = []
    t = 0.0
    for i, ch in enumerate(chars):
        if ch == " " or ch == "/":
            continue
        if ch not in KEYS:
            continue
        m = (0, 0)
        if mods and i < len(mods):
            m = mods[i]
        d = dur
        if bpm:
            d = 60.0 / bpm
        notes.append({"k": KEYS.index(ch), "m": m, "s": t, "d": d})
        t += d + gap
    return notes


BUILTIN_SONGS = [
    {"name": "1. See You Again", "notes": build_song("n b , b n m m , n , b n , b", dur=0.5)},
    {"name": "2. 小星星", "notes": build_song(
        "zzbbnnb vvccxxz bb nn m mn vvccxxz".replace(" ", ""), dur=0.45)},
    {"name": "3. 欢乐颂", "notes": build_song(
        "ccvbbvcx zzxc cxx zzxc cxx".replace(" ", ""), dur=0.45)},
    {"name": "4. 父亲(筷子兄弟)", "notes": build_song(
        "nmmnnb bnm m , b n m v v c c x x z".replace(" ", ""), dur=0.45)},
    {"name": "5. 音域与变调练习", "notes": build_song(
        "zxcvbnm," + ",mnbvcxz", mods=[(0, 0)] * 8 + [(0, 0)] * 8, dur=0.4)},
]


# ═══════════ 全局热键（ctypes RegisterHotKey + 消息窗口） ═══════════
WM_HOTKEY = 0x0312
MOD_SHIFT = 0x0004
MOD_CONTROL = 0x0002
MOD_ALT = 0x0001
HWND_MESSAGE = None


def _load_wintypes():
    global HWND_MESSAGE
    HWND_MESSAGE = wintypes.HWND(-3)
    return wintypes


WNDPROC = None
_hotkey_queue = queue.Queue()
_hotkey_hwnd = None
_hotkey_proc_ref = None
HOTKEYS = [
    (1, MOD_SHIFT, 0x75),   # Shift+F6   隐藏/显示
    (2, MOD_SHIFT, 0x76),   # Shift+F7   下一首
    (3, MOD_SHIFT, 0x77),   # Shift+F8   锁定/解锁布局
    (4, MOD_SHIFT, 0x78),   # Shift+F9   从头重来
    (5, MOD_SHIFT, 0x79),   # Shift+F10  面板穿透
    (6, MOD_SHIFT, 0x7A),   # Shift+F11  添加曲谱
    (7, MOD_ALT | MOD_CONTROL, 0x51),  # Ctrl+Alt+Q 退出
]


def start_hotkeys():
    global WNDPROC, _hotkey_proc_ref, _hotkey_hwnd
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    wt = _load_wintypes()

    kernel32.GetModuleHandleW.argtypes = [wt.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wt.HMODULE
    user32.RegisterClassW.argtypes = [ctypes.c_void_p]
    user32.RegisterClassW.restype = wt.ATOM
    user32.CreateWindowExW.argtypes = [
        wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD,
        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
        wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
    user32.CreateWindowExW.restype = wt.HWND
    user32.RegisterHotKey.argtypes = [wt.HWND, ctypes.c_int, wt.UINT, wt.UINT]
    user32.RegisterHotKey.restype = wt.BOOL
    user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
    user32.DefWindowProcW.restype = ctypes.c_longlong  # LRESULT

    def _wndproc(hwnd, msg, wparam, lparam):
        if msg == WM_HOTKEY:
            _hotkey_queue.put(int(wparam))
            return 0
        return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

    WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_longlong, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)
    _hotkey_proc_ref = WNDPROC(_wndproc)

    class WNDCLASSW(ctypes.Structure):
        _fields_ = [
            ("style", wt.UINT),
            ("lpfnWndProc", WNDPROC),
            ("cbClsExtra", ctypes.c_int),
            ("cbWndExtra", ctypes.c_int),
            ("hInstance", wt.HINSTANCE),
            ("hIcon", wt.HICON),
            ("hCursor", wt.HANDLE),
            ("hbrBackground", wt.HBRUSH),
            ("lpszMenuName", wt.LPCWSTR),
            ("lpszClassName", wt.LPCWSTR),
        ]

    wc = WNDCLASSW()
    wc.lpfnWndProc = _hotkey_proc_ref
    wc.hInstance = kernel32.GetModuleHandleW(None)
    wc.lpszClassName = "KouqinHelperHotkeyWin"
    if not user32.RegisterClassW(ctypes.byref(wc)):
        return
    _hotkey_hwnd = user32.CreateWindowExW(
        0, wc.lpszClassName, "hk", 0, 0, 0, 0, 0,
        ctypes.c_void_p(-3), None, wc.hInstance, None)
    if not _hotkey_hwnd:
        return
    for hid, mods, vk in HOTKEYS:
        user32.RegisterHotKey(_hotkey_hwnd, hid, mods, vk)

    def pump():
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

    threading.Thread(target=pump, daemon=True).start()


def stop_hotkeys():
    if _hotkey_hwnd:
        user32 = ctypes.windll.user32
        for hid, _, _ in HOTKEYS:
            user32.UnregisterHotKey(_hotkey_hwnd, hid)
        user32.DestroyWindow(_hotkey_hwnd)


# ═══════════ 自绘控件 ═══════════
def _rr(c, x1, y1, x2, y2, r, **kw):
    """圆角矩形（smooth 多边形）"""
    pts = [x1 + r, y1, x2 - r, y1, x2, y1, x2, y1 + r, x2, y2 - r, x2, y2,
           x2 - r, y2, x1 + r, y2, x1, y2, x1, y2 - r, x1, y1 + r, x1, y1]
    return c.create_polygon(pts, smooth=True, **kw)


class Btn:
    """Canvas 自绘圆角按钮（支持 hover / 按下 / 激活态）"""
    def __init__(self, c, x, y, w, h, text, cmd=None, r=10,
                 fg=C_TEXT, bg=C_BTN, hov=C_BTN_H, act=C_BTN_A, on=C_GREEN, on_hov=C_GREEN_H,
                 font=F_NORM, bold=False, enabled=True):
        self.c, self.x, self.y, self.w, self.h = c, x, y, w, h
        self.cmd = cmd
        self.text = text
        self.fg, self.bg, self.hov, self.act, self.on, self.on_hov = fg, bg, hov, act, on, on_hov
        self.font = (font[0], font[1], "bold") if bold else font
        self.enabled = enabled
        self.active = False
        self.hover = False
        self.tag = "ui_btn%d" % id(self)
        self.bgid = _rr(c, x, y, x + w, y + h, r, fill=bg, outline=bg, tags=self.tag)
        self.txt = c.create_text(x + w / 2, y + h / 2, text=text, fill=fg, font=self.font, tags=self.tag)
        c.tag_bind(self.tag, "<Enter>", lambda e: self._hover(True))
        c.tag_bind(self.tag, "<Leave>", lambda e: self._hover(False))
        c.tag_bind(self.tag, "<ButtonPress-1>", lambda e: self._press())
        c.tag_bind(self.tag, "<ButtonRelease-1>", lambda e: self._release())
        self.paint()

    def _hover(self, on):
        self.hover = on
        self.paint()

    def _press(self):
        if self.enabled:
            self.c.itemconfig(self.bgid, fill=self.act, outline=self.act)

    def _release(self):
        if self.enabled:
            self.paint()
            if self.cmd:
                self.cmd()

    def paint(self):
        if not self.enabled:
            fill, out = "#263248", "#263248"
            fg = "#6b7c95"
        elif self.active:
            fill, out = (self.on_hov if self.hover else self.on), (self.on_hov if self.hover else self.on)
            fg = "#ffffff"
        else:
            fill, out = self.hov if self.hover else self.bg, self.hov if self.hover else self.bg
            fg = self.fg
        self.c.itemconfig(self.bgid, fill=fill, outline=out)
        self.c.itemconfig(self.txt, fill=fg)

    def set_text(self, t):
        self.text = t
        self.c.itemconfig(self.txt, text=t)

    def set_active(self, on):
        self.active = on
        self.paint()

    def set_enabled(self, on):
        self.enabled = on
        self.paint()

    def hit(self, x, y):
        return self.x <= x <= self.x + self.w and self.y <= y <= self.y + self.h


class Slider:
    """Canvas 自绘圆角滑杆"""
    def __init__(self, c, x, y, w, val, minv, maxv, cb, r=8):
        self.c, self.x, self.y, self.w, self.h = c, x, y, w, 16
        self.minv, self.maxv, self.cb = minv, maxv, cb
        self.val = val
        self.tag = "ui_sl%d" % id(self)
        self.track = _rr(c, x, y + 6, x + w, y + 10, r, fill="#101a2c", outline="#26385a", tags=self.tag)
        self.fill = _rr(c, x, y + 6, x + w, y + 10, r, fill="#3a6db5", outline="#3a6db5", tags=self.tag)
        self.knob = c.create_oval(0, 0, 0, 0, fill="#e8eef6", outline="#ffffff", tags=self.tag)
        c.tag_bind(self.tag, "<Button-1>", lambda e: self._drag(e))
        c.tag_bind(self.tag, "<B1-Motion>", lambda e: self._drag(e))
        self._place()

    def _place(self):
        f = (self.val - self.minv) / max(1e-6, self.maxv - self.minv)
        kx = self.x + f * self.w
        self.c.coords(self.fill, self.x, self.y + 6, kx, self.y + 10)
        self.c.coords(self.knob, kx - 6, self.y - 1, kx + 6, self.y + 17)
        self.c.tag_raise(self.knob)

    def _drag(self, e):
        f = max(0.0, min(1.0, (e.x - self.x) / self.w))
        self.val = self.minv + f * (self.maxv - self.minv)
        self._place()
        if self.cb:
            self.cb(self.val)


class SongList:
    """Canvas 自绘圆角曲目列表"""
    ROW_H = 23

    def __init__(self, c, x, y, w, h, on_pick, r=8):
        self.c, self.x, self.y, self.w, self.h = c, x, y, w, h
        self.on_pick = on_pick
        self.names = []
        self.sel = -1
        self.scroll = 0
        self.rows = []      # (bg, txt) 或 None
        self.tag = "ui_list%d" % id(self)
        for i in range(int(h / self.ROW_H)):
            ry = y + i * self.ROW_H + 2
            bg = _rr(c, x, ry, x + w, ry + self.ROW_H - 4, r, fill="#0e1726", outline="#0e1726", tags=self.tag)
            tx = c.create_text(x + 8, ry + (self.ROW_H - 4) / 2, text="", anchor="w",
                               fill=C_SUB, font=F_SMALL, tags=self.tag)
            self.rows.append([bg, tx])
        c.tag_bind(self.tag, "<Button-1>", self._click)

    def set(self, names, sel):
        self.names = names
        self.sel = sel
        self._clamp_scroll()
        self._draw()

    def _visible(self):
        return int(self.h / self.ROW_H)

    def _clamp_scroll(self):
        vis = self._visible()
        self.scroll = max(0, min(self.scroll, max(0, len(self.names) - vis)))

    def _draw(self):
        for i, (bg, tx) in enumerate(self.rows):
            idx = self.scroll + i
            if idx < len(self.names):
                self.c.itemconfig(tx, text=self.names[idx])
                if idx == self.sel:
                    self.c.itemconfig(bg, fill="#1e3a63", outline="#2b4f85")
                    self.c.itemconfig(tx, fill="#ffffff")
                else:
                    self.c.itemconfig(bg, fill="#0e1726", outline="#0e1726")
                    self.c.itemconfig(tx, fill=C_SUB)
            else:
                self.c.itemconfig(tx, text="")
                self.c.itemconfig(bg, fill="#0e1726", outline="#0e1726")

    def _click(self, e):
        vis = self._visible()
        i = int((e.y - (self.y + 2)) / self.ROW_H)
        idx = self.scroll + i
        if 0 <= idx < len(self.names):
            if self.on_pick:
                self.on_pick(idx)

    def wheel(self, e):
        d = -1 if e.delta > 0 else 1
        self.scroll = max(0, min(self.scroll + d, max(0, len(self.names) - self._visible())))
        self._draw()


# ═══════════ 悬浮窗 ═══════════
class KouqinHelper:
    def __init__(self, root):
        self.root = root
        self.songs = []
        self.cur = None
        self.tiles = []
        self.t = 0.0
        self.playing = False
        self.speed = 1.0
        self.base_oct_override = None   # None=随曲谱基准八度；3..7=手动
        self.passthrough = False
        self.locked = False
        self.alpha = 0.94
        self.hidden = False
        self.last_hit = None
        self.last_hit_key = None
        self.lead_in = 3.0
        self._last_size = (0, 0)

        # 文本项引用（由 _draw_ui 创建后赋值）
        self.txt_song = None
        self.txt_left = None
        self.txt_detect = None
        self.txt_hint = None
        self.txt_speed = None
        self.controls = {}
        self.shift_btns = []
        self.songlist = None
        self.alpha_slider = None

        self._build_window()
        for s in BUILTIN_SONGS:
            self.songs.append(s)
        self.select_song(0)
        self._load_settings()
        self.set_shift(None)
        self.root.after(50, self._poll)
        self._anim_loop()

    # ── 窗口与玻璃 ──
    def _build_window(self):
        r = self.root
        r.overrideredirect(True)
        r.attributes("-topmost", True)
        r.attributes("-alpha", self.alpha)
        r.update_idletasks()
        sw, sh = r.winfo_screenwidth(), r.winfo_screenheight()
        w0, h0 = 980, 560
        r.geometry(f"{w0}x{h0}+{max(0,(sw-w0)//2)}+{max(0,(sh-h0)//2)}")
        self._last_size = (w0, h0)
        self.canvas = tk.Canvas(r, bg=C_BG, highlightthickness=0)
        self.canvas.pack(fill="both", expand=True)
        r.bind("<Configure>", self._on_resize)
        self.canvas.bind("<MouseWheel>", self._on_wheel)
        self.canvas.bind("<Button-1>", self._drag_start)
        self.canvas.bind("<B1-Motion>", self._drag_move)
        self._draw_ui()
        self._apply_region()
        self._apply_glass()

    def _apply_region(self):
        try:
            hwnd = self.root.winfo_id()
            w, h = self.root.winfo_width(), self.root.winfo_height()
            if w < 40 or h < 40:
                w, h = self._last_size
            if w < 40 or h < 40:
                return
            gdi32 = ctypes.windll.gdi32
            user32 = ctypes.windll.user32
            gdi32.CreateRoundRectRgn.argtypes = [ctypes.c_int] * 6
            gdi32.CreateRoundRectRgn.restype = wintypes.HRGN
            user32.SetWindowRgn.argtypes = [wintypes.HWND, wintypes.HRGN, wintypes.BOOL]
            hrgn = gdi32.CreateRoundRectRgn(0, 0, w + 1, h + 1, 28, 28)
            user32.SetWindowRgn(hwnd, hrgn, True)
        except Exception:
            pass

    def _apply_glass(self):
        """毛玻璃质感：DWM 亚克力模糊（失败则保持半透明）"""
        try:
            hwnd = self.root.winfo_id()
            user32 = ctypes.windll.user32

            class ACCENT(ctypes.Structure):
                _fields_ = [("AccentState", ctypes.c_int),
                            ("AccentFlags", ctypes.c_int),
                            ("GradientColor", ctypes.c_uint),
                            ("AnimationId", ctypes.c_int)]

            class WCAD(ctypes.Structure):
                _fields_ = [("Attribute", ctypes.c_int),
                            ("Data", ACCENT),
                            ("SizeOfData", ctypes.c_int)]

            user32.SetWindowCompositionAttribute.argtypes = [wintypes.HWND, ctypes.c_void_p]
            user32.SetWindowCompositionAttribute.restype = ctypes.c_int
            data = WCAD()
            data.Attribute = 19                      # WCA_ACCENT_POLICY
            data.Data.AccentState = 4                # ACCENT_ENABLE_ACRYLICBLURBEHIND
            data.Data.AccentFlags = 2
            data.Data.GradientColor = 0xCC0D1420     # 深色毛玻璃底色（ABGR）
            data.SizeOfData = ctypes.sizeof(ACCENT)
            user32.SetWindowCompositionAttribute(hwnd, ctypes.byref(data))
        except Exception:
            pass

    # ── UI 布局（全部圆角，参照游戏面板） ──
    def _on_resize(self, e):
        if (e.width, e.height) == self._last_size:
            return
        self._last_size = (e.width, e.height)
        self._draw_ui()
        self._redraw_lanes()
        self._apply_region()

    def _draw_ui(self):
        c = self.canvas
        c.delete("ui")
        W, H = self.root.winfo_width(), self.root.winfo_height()
        if W < 40:
            return
        LW = 248                       # 左侧卡片宽
        LX = 14
        RX = LX + LW + 14              # 右侧卡片起点
        R_END = W - 14

        # ── 左侧卡片 ──
        _rr(c, LX, 14, LX + LW, H - 14, 20, fill=C_PANEL, outline=C_BORDER, width=1, tags="ui")
        # 玻璃质感：顶部高光条 + 内描边
        c.create_rectangle(LX + 22, 15, LX + LW - 22, 34, fill="#ffffff", stipple="gray25",
                           outline="", tags="ui")
        c.create_line(LX + 22, 17, LX + LW - 22, 17, fill="#33486b", tags="ui")
        c.create_line(LX + 22, 14 + 26, LX + LW - 22, 14 + 26, fill="#23334f", tags="ui")
        c.create_text(LX + 18, 30, text="口琴曲谱", anchor="w", fill=C_ACCENT, font=F_TITLE, tags="ui")
        self.txt_song = c.create_text(LX + 18, 54, text="", anchor="w", fill=C_TEXT, font=F_NORM, tags="ui")
        self.txt_left = c.create_text(LX + 18, 76, text="剩余 --/-- 音", anchor="w", fill=C_DIM, font=F_SMALL, tags="ui")

        # 基准八度（整曲移调）
        c.create_text(LX + 18, 102, text="基准八度（整曲移调）", anchor="w", fill=C_SUB, font=F_SMALL, tags="ui")
        self.shift_btns = []
        order = [(None, "谱面"), (3, "C3"), (4, "C4"), (5, "C5"), (6, "C6"), (7, "C7")]
        for i, (octv, label) in enumerate(order):
            bx = LX + 18 + (i % 3) * 74
            by = 116 + (i // 3) * 30
            b = Btn(c, bx, by, 70, 26, label, r=9,
                    cmd=lambda o=octv: self.set_shift(o), font=F_SMALL, enabled=True)
            self.shift_btns.append((octv, b))
        self.txt_hint = c.create_text(LX + 18, 188, text="基准八度=中音do所在八度", anchor="w", fill=C_DIM, font=F_TINY, tags="ui")
        self.txt_detect = c.create_text(LX + 18, 214, text="检测到：--", anchor="w", fill=C_GOLD, font=F_NORM, tags="ui")

        # 曲谱列表
        c.create_text(LX + 18, 240, text="曲谱列表", anchor="w", fill=C_SUB, font=F_SMALL, tags="ui")
        Btn(c, LX + LW - 66, 232, 52, 22, "＋ 添加", r=8,
            cmd=self.add_score, font=F_TINY, on=C_BTN_A).paint()
        list_h = min(6 * SongList.ROW_H + 4, H - 414)
        self.songlist = SongList(c, LX + 14, 250, LW - 28, list_h, self._on_pick)
        self._draw_songlist()

        # 热键
        hk_y = 250 + list_h + 12
        c.create_text(LX + 18, hk_y, text="热键（需按住 Shift）", anchor="w", fill=C_SUB, font=F_SMALL, tags="ui")
        rows = [
            ("隐藏窗口", "Shift+F6"), ("下一首", "Shift+F7"), ("锁定布局", "Shift+F8"),
            ("从头重来", "Shift+F9"), ("面板穿透", "Shift+F10"), ("添加曲谱", "Shift+F11"),
            ("退出程序", "Ctrl+Alt+Q"),
        ]
        ry = hk_y + 18
        for name, key in rows:
            c.create_text(LX + 24, ry, text=name, anchor="w", fill=C_DIM, font=F_TINY, tags="ui")
            c.create_text(LX + LW - 16, ry, text=key, anchor="e", fill="#7d94b5", font=("Consolas", 8), tags="ui")
            ry += 16

        # ── 右侧卡片（下落音符） ──
        _rr(c, RX, 14, R_END, H - 14, 20, fill=C_CARD2, outline=C_BORDER, width=1, tags="ui")
        c.create_rectangle(RX + 22, 15, R_END - 22, 34, fill="#ffffff", stipple="gray25",
                           outline="", tags="ui")
        c.create_line(RX + 22, 17, R_END - 22, 17, fill="#33486b", tags="ui")
        c.create_line(RX + 18, 14 + 26, R_END - 18, 14 + 26, fill="#1c2a44", tags="ui")

        # 顶侧控制条
        cy = 22
        self.controls = {}
        x = R_END - 14
        self.alpha_slider = Slider(c, x - 92, cy - 8, 88, self.alpha, 0.35, 1.0, self._alpha_changed)
        x -= 100
        c.create_text(x, cy + 4, text="透明", anchor="e", fill=C_DIM, font=F_TINY, tags="ui")
        x -= 40
        self.controls["lock"] = Btn(c, x - 36, cy - 2, 36, 24, "锁定", r=8, cmd=self.toggle_lock, font=F_TINY)
        x -= 44
        self.controls["pass"] = Btn(c, x - 46, cy - 2, 46, 24, "穿透", r=8, cmd=self.toggle_passthrough, font=F_TINY)
        x -= 54
        self.controls["hide"] = Btn(c, x - 36, cy - 2, 36, 24, "隐藏", r=8, cmd=self.toggle_hide, font=F_TINY)
        x -= 44
        Btn(c, x - 18, cy - 2, 20, 24, "＋", r=8, cmd=lambda: self.set_speed(self.speed + 0.25), font=F_SMALL, bold=True)
        x -= 26
        self.txt_speed = c.create_text(x - 20, cy + 4, text="1.00x", anchor="e", fill=C_TEXT, font=("Consolas", 9), tags="ui")
        x -= 46
        Btn(c, x - 18, cy - 2, 20, 24, "－", r=8, cmd=lambda: self.set_speed(self.speed - 0.25), font=F_SMALL, bold=True)
        x -= 26
        self.controls["next"] = Btn(c, x - 36, cy - 2, 36, 24, "⏭ 下一首", r=8, cmd=self.next_song, font=F_TINY)
        x -= 44
        self.controls["restart"] = Btn(c, x - 34, cy - 2, 34, 24, "↺", r=8, cmd=self.restart, font=F_NORM, bold=True)
        x -= 42
        self.controls["play"] = Btn(c, x - 46, cy - 4, 46, 28, "▶ 演奏", r=9, cmd=self.toggle_play, font=F_SMALL, bold=True)

        # ── 右下角缩放柄 ──
        self._resize_tag = "ui_rsz%d" % id(self)
        _rr(c, W - 34, H - 34, W - 12, H - 12, 9, fill=C_BTN, outline=C_BORDER, tags=(self._resize_tag, "ui"))
        c.create_text(W - 23, H - 23, text="⤡", fill=C_SUB, font=("Segoe UI", 11), tags=(self._resize_tag, "ui"))
        c.tag_bind(self._resize_tag, "<Button-1>", self._rsz_start)
        c.tag_bind(self._resize_tag, "<B1-Motion>", self._rsz_move)

        # ── 拖动区（左卡片 + 右卡片背景；交互控件不触发拖动） ──
        self._redraw_lanes()
        self._update_labels()

    def _is_interactive(self):
        """当前指针下是否命中交互控件（按钮/滑杆/列表/缩放柄）"""
        try:
            for item in self.canvas.find_withtag("current"):
                for t in self.canvas.gettags(item):
                    if t.startswith(("ui_btn", "ui_sl", "ui_list", "ui_rsz")):
                        return True
        except Exception:
            pass
        return False

    def _on_wheel(self, e):
        """滚轮：指针在曲谱列表内时滚动列表"""
        try:
            if (self.songlist and self.songlist.x <= e.x <= self.songlist.x + self.songlist.w
                    and self.songlist.y <= e.y <= self.songlist.y + self.songlist.h):
                self.songlist.wheel(e)
        except Exception:
            pass

    def _draw_songlist(self):
        if self.songlist is not None:
            idx = self.songs.index(self.cur) if self.cur in self.songs else 0
            self.songlist.set([s["name"] for s in self.songs], idx)

    # ── 拖动 / 缩放 ──
    def _drag_start(self, e):
        if self.locked or self._is_interactive():
            return
        self._dx, self._dy = e.x_root - self.root.winfo_x(), e.y_root - self.root.winfo_y()

    def _drag_move(self, e):
        if self.locked:
            return
        self.root.geometry(f"+{e.x_root - self._dx}+{e.y_root - self._dy}")

    def _rsz_start(self, e):
        if self.locked:
            return
        self._sx, self._sy = e.x_root, e.y_root
        self._sw, self._sh = self.root.winfo_width(), self.root.winfo_height()

    def _rsz_move(self, e):
        if self.locked:
            return
        w = max(860, self._sw + (e.x_root - self._sx))
        h = max(520, self._sh + (e.y_root - self._sy))
        self.root.geometry(f"{w}x{h}")

    # ── 曲目管理 ──
    def _on_pick(self, idx):
        self.select_song(idx)
        self.play()

    def select_song(self, idx):
        if not self.songs or idx >= len(self.songs):
            return
        self.cur = self.songs[idx]
        self.restart()
        self._draw_songlist()
        self._update_labels()
        if self.base_oct_override is None and self.txt_hint:
            self.canvas.itemconfig(self.txt_hint, text=f"基准八度：随曲谱（当前 C{self._cur_base_oct()}）")

    def next_song(self):
        if not self.songs:
            return
        self.select_song((self.songs.index(self.cur) + 1) % len(self.songs))

    def add_score(self):
        path = filedialog.askopenfilename(
            title="添加曲谱", filetypes=[("口琴曲谱", "*.txt"), ("所有文件", "*.*")])
        if not path:
            return
        try:
            song = parse_score_file(path)
        except Exception as ex:
            messagebox.showerror("口琴助手", f"读取曲谱失败：\n{ex}")
            return
        if not song["notes"]:
            messagebox.showwarning("口琴助手", "曲谱里没有可用的音符（需要 z x c v b n m , 键位行）")
            return
        self.songs.append(song)
        self.select_song(len(self.songs) - 1)

    # ── 播放控制 ──
    def toggle_play(self):
        if self.playing:
            self.playing = False
            self._set_play_btn()
        else:
            self.play()

    def play(self):
        if not self.cur or not self.cur["notes"]:
            return
        if self.t >= self._last_end():
            self.t = 0.0
        self.playing = True
        self._set_play_btn()

    def _set_play_btn(self):
        b = self.controls.get("play")
        if b:
            b.set_text("■ 暂停" if self.playing else "▶ 演奏")

    def restart(self):
        self.playing = False
        self.t = 0.0
        self.last_hit = None
        self.last_hit_key = None
        self._set_play_btn()
        self._update_detect("检测到：--")

    def _last_end(self):
        if not self.cur or not self.cur["notes"]:
            return 0.0
        return max(n["s"] + n["d"] for n in self.cur["notes"])

    def set_speed(self, v):
        self.speed = max(0.25, min(3.0, round(v, 2)))
        if self.txt_speed:
            self.canvas.itemconfig(self.txt_speed, text=f"{self.speed:.2f}x")

    def toggle_passthrough(self):
        self.set_passthrough(not self.passthrough)

    def set_passthrough(self, on):
        self.passthrough = on
        b = self.controls.get("pass")
        if b:
            b.set_active(on)
            b.set_text("穿透" if on else "穿透")
        self._apply_passthrough()

    def _apply_passthrough(self):
        try:
            hwnd = self.root.winfo_id()
            GWL_EXSTYLE = -20
            WS_EX_LAYERED = 0x00080000
            WS_EX_TRANSPARENT = 0x00000020
            user32 = ctypes.windll.user32
            style = user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)
            if self.passthrough:
                style |= WS_EX_LAYERED | WS_EX_TRANSPARENT
            else:
                style &= ~WS_EX_TRANSPARENT
            user32.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style)
        except Exception:
            pass

    def toggle_lock(self):
        self.locked = not self.locked
        b = self.controls.get("lock")
        if b:
            b.set_active(self.locked)

    def toggle_hide(self):
        self.hidden = not self.hidden
        if self.hidden:
            self.root.withdraw()
        else:
            self.root.deiconify()
        b = self.controls.get("hide")
        if b:
            b.set_text("显示" if self.hidden else "隐藏")
            b.set_active(self.hidden)

    def _cur_base_oct(self):
        if self.base_oct_override is not None:
            return self.base_oct_override
        return self.cur.get("baseOct", DEFAULT_BASE_OCT) if self.cur else DEFAULT_BASE_OCT

    def set_shift(self, octv):
        self.base_oct_override = octv
        for o, b in self.shift_btns:
            b.set_active(o == octv)
        if octv is None:
            hint_txt = f"基准八度：随曲谱（当前 C{self._cur_base_oct()}）"
        else:
            hint_txt = f"基准八度：C{octv}（整曲移调）"
        if self.txt_hint:
            self.canvas.itemconfig(self.txt_hint, text=hint_txt)
        self._redraw_lanes()

    def _alpha_changed(self, v):
        self.alpha = max(0.35, min(1.0, v))
        try:
            self.root.attributes("-alpha", self.alpha)
        except Exception:
            pass

    # ── 标签更新 ──
    def _update_labels(self):
        c = self.canvas
        if self.txt_song:
            c.itemconfig(self.txt_song, text="· " + (self.cur["name"] if self.cur else ""))
        self._update_progress()

    def _update_progress(self):
        if not self.txt_left:
            return
        if not self.cur or not self.cur["notes"]:
            self.canvas.itemconfig(self.txt_left, text="剩余 --/-- 音")
            return
        total = len(self.cur["notes"])
        left = sum(1 for n in self.cur["notes"] if n["s"] > self.t + 0.05)
        self.canvas.itemconfig(self.txt_left, text=f"剩余 {left}/{total} 音")

    def _update_detect(self, txt):
        if self.txt_detect:
            self.canvas.itemconfig(self.txt_detect, text=txt)

    # ── 渲染：泳道 ──
    def _redraw_lanes(self):
        c = self.canvas
        if not c.winfo_exists():
            return
        c.delete("lanes")
        W, H = self.root.winfo_width(), self.root.winfo_height()
        x0, x1 = 276 + 16, W - 30
        y0, y1 = 58, H - 34
        lane_w = max(40, (x1 - x0) / 8.0)
        hit_y = y1 - 16
        for i in range(8):
            x = x0 + i * lane_w
            fill = "#111b2d" if i % 2 == 0 else "#0e1726"
            c.create_rectangle(x, y0, x + lane_w, y1, fill=fill, outline="#1b2942", tags="lanes")
            kch = KEYS[i] if KEYS[i] != "," else "，"
            c.create_text(x + lane_w / 2, hit_y + 14, text=kch, fill="#7d94b5",
                          font=F_KEY, tags="lanes")
        c.create_line(x0, hit_y, x1, hit_y, fill="#2b5da8", width=2, tags="lanes")
        c.create_text(x0 + 4, hit_y - 8, text="▼", fill="#2b5da8", font=("Segoe UI", 8), anchor="w", tags="lanes")

    def _render_tiles(self):
        self.tiles = []
        if not self.cur:
            return
        W, H = self.root.winfo_width(), self.root.winfo_height()
        x0, x1 = 276 + 16, W - 30
        y0, y1 = 58, H - 34
        lane_w = max(40, (x1 - x0) / 8.0)
        hit_y = y1 - 16
        top_y = y0 + 4
        lead = max(1.2, self.lead_in / max(0.25, self.speed))
        span = hit_y - top_y
        for n in self.cur["notes"]:
            base = self._cur_base_oct()
            slot, sharp = n["m"]
            comma = 1 if n["k"] == COM_KEY_IDX else 0
            oct_num = base + slot + comma
            midi = (oct_num + 1) * 12 + KEY_SEM[n["k"]] + (1 if sharp else 0)
            k = n["k"]
            off = n["m"]
            x = x0 + k * lane_w + 3
            w = lane_w - 6
            appear = n["s"] - lead
            if self.t >= appear and self.t <= n["s"] + n["d"] + lead:
                frac = 1.0 if self.t >= n["s"] else (self.t - appear) / lead
                y = top_y + frac * span
                h = max(14, n["d"] / lead * span * 0.9)
                self.tiles.append({"k": k, "off": off, "x": x, "y": y, "w": w, "h": h,
                                   "s": n["s"], "d": n["d"], "hit": self.t >= n["s"]})
        self.tiles.sort(key=lambda t: (t["s"], t["k"]))

    def _anim_loop(self):
        if self.playing:
            self.t += 0.016 * self.speed
            if self.t > self._last_end() + 0.6:
                self.playing = False
                self._set_play_btn()
        self._render_tiles()
        c = self.canvas
        if c.winfo_exists():
            c.delete("note")
            for tile in self.tiles:
                color = MOD_COLOR.get(tile["off"], "#8b95a5")
                if tile["hit"]:
                    _rr(c, tile["x"], tile["y"], tile["x"] + tile["w"], tile["y"] + tile["h"],
                        8, fill=color, outline="#ffffff", width=2, tags="note")
                else:
                    _rr(c, tile["x"], tile["y"], tile["x"] + tile["w"], tile["y"] + tile["h"],
                        8, fill=color, outline="#0a111d", width=1, tags="note")
                kch = KEYS[tile["k"]] if KEYS[tile["k"]] != "," else "，"
                c.create_text(tile["x"] + tile["w"] / 2, tile["y"] + tile["h"] / 2,
                              text=kch, fill="#10151c", font=F_KEY, tags="note")
            self._check_hits()
            self._update_progress()
        self.root.after(16, self._anim_loop)

    def _check_hits(self):
        new_hit = None
        for tile in self.tiles:
            if tile["hit"] and (new_hit is None or tile["s"] > new_hit["s"]):
                new_hit = tile
        if new_hit:
            label = f"检测到：{KEYS[new_hit['k']] if KEYS[new_hit['k']] != ',' else '，'} · {MOD_LABEL.get(new_hit['off'], '基准')}"
            if MOD_MOUSE.get(new_hit["off"]) and new_hit["off"] != (0, 0):
                label += f"（{MOD_MOUSE[new_hit['off']]}）"
            key = (new_hit["k"], new_hit["s"], new_hit["off"])
            if key != self.last_hit_key:
                self.last_hit_key = key
                self.last_hit = new_hit
                self._update_detect(label)
                self._flash_key(new_hit["k"])
        elif self.last_hit is not None:
            self.last_hit = None

    def _flash_key(self, k):
        """泳道命中区闪烁提示"""
        c = self.canvas
        W, H = self.root.winfo_width(), self.root.winfo_height()
        x0, x1 = 276 + 16, W - 30
        lane_w = max(40, (x1 - x0) / 8.0)
        hit_y = H - 50
        x = x0 + k * lane_w
        c.delete("flash")
        _rr(c, x + 2, hit_y - 22, x + lane_w - 2, hit_y + 6, 8,
            fill="", outline=C_GOLD, width=3, tags="flash")
        c.create_text(x + lane_w / 2, hit_y - 8, text=KEYS[k] if KEYS[k] != "," else "，",
                      fill=C_GOLD, font=("Consolas", 13, "bold"), tags="flash")
        self.root.after(260, lambda: c.delete("flash"))

    # ── 热键分发 ──
    def _poll(self):
        try:
            while True:
                hid = _hotkey_queue.get_nowait()
                if hid == 1:
                    self.toggle_hide()
                elif hid == 2:
                    self.next_song()
                elif hid == 3:
                    self.toggle_lock()
                elif hid == 4:
                    self.restart()
                elif hid == 5:
                    self.toggle_passthrough()
                elif hid == 6:
                    self.add_score()
                elif hid == 7:
                    self.quit()
        except queue.Empty:
            pass
        self.root.after(60, self._poll)

    # ── 设置持久化 / 退出 ──
    def _settings_path(self):
        base = os.path.dirname(os.path.abspath(sys.argv[0]))
        try:
            os.makedirs(base, exist_ok=True)
            p = os.path.join(base, "kouqin-helper-settings.txt")
            open(p, "a").close()
            return p
        except Exception:
            return os.path.join(os.path.expanduser("~"), "kouqin-helper-settings.txt")

    def _save_settings(self):
        try:
            with open(self._settings_path(), "w", encoding="utf-8") as f:
                f.write(f"x={self.root.winfo_x()}\ny={self.root.winfo_y()}\n"
                        f"w={self.root.winfo_width()}\nh={self.root.winfo_height()}\n"
                        f"alpha={int(self.alpha*100)}\nspeed={self.speed}\n")
        except Exception:
            pass

    def _load_settings(self):
        try:
            with open(self._settings_path(), "r", encoding="utf-8") as f:
                kv = {}
                for line in f:
                    if "=" in line:
                        k, v = line.strip().split("=", 1)
                        kv[k] = v
            if "alpha" in kv:
                self.alpha = max(0.35, min(1.0, int(kv["alpha"]) / 100.0))
                if self.alpha_slider:
                    self.alpha_slider.val = self.alpha
                    self.alpha_slider._place()
                self.root.attributes("-alpha", self.alpha)
            if "speed" in kv:
                self.set_speed(float(kv["speed"]))
            g = None
            sw, sh = self.root.winfo_screenwidth(), self.root.winfo_screenheight()
            if all(k in kv for k in ("x", "y")):
                x, y = int(kv["x"]), int(kv["y"])
                if x < -100 or x > sw - 100 or y < -40 or y > sh - 80:
                    x, y = max(0, (sw - 980) // 2), max(0, (sh - 560) // 2)
                g = f"+{x}+{y}"
            w = int(kv.get("w", 980))
            h = int(kv.get("h", 560))
            self.root.geometry(f"{w}x{h}{g}" if g else f"{w}x{h}")
        except Exception:
            pass

    def quit(self):
        try:
            self._save_settings()
        except Exception:
            pass
        try:
            stop_hotkeys()
        except Exception:
            pass
        self.root.destroy()


def main():
    start_hotkeys()
    root = tk.Tk()
    app = KouqinHelper(root)
    root.protocol("WM_DELETE_WINDOW", app.quit)
    root.mainloop()


if __name__ == "__main__":
    main()
