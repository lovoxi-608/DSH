# 自定义字体（聊天正文 Grasser ｜ logo 后文字与宠物气泡 思源黑体）

页面用两套自定义字体，各自一个 `@font-face` + 一个 CSS 变量（都在 `theme.css` 顶部）：

| 字体 | 变量 | 用在哪儿 |
| --- | --- | --- |
| **Grasser** | `--font-grasser` | 聊天正文（含 AI 输出、气泡上的名字）、「问」的随机问题菜单 |
| **思源黑体** | `--font-hanhei` | logo 后面的文字（左上角两段标题、中央 logo 后的一句话）、宠物头顶的气泡 |

## 一、Grasser（聊天正文）

对应的 `@font-face`：

```css
@font-face{
  font-family:"Grasser";
  src:local("Grasser"),
      url("/assets/fonts/Grasser.woff2") format("woff2"),
      url("/assets/fonts/Grasser.ttf") format("truetype"),
      url("/assets/fonts/Grasser.otf") format("opentype");
}
```

用到的地方：

| 位置 | 选择器 | 文件 |
| --- | --- | --- |
| 聊天正文（含 AI 输出、气泡上的名字） | `.message .bubble` / `.message-meta` | `app.css` |
| 「问」的随机问题菜单 | `.ask-menu button` | `app.css` |

## 二、思源黑体（logo 后文字 / 宠物气泡）

对应 的 `@font-face`：

```css
@font-face{
  font-family:"Source Han Sans SC";
  src:local("Source Han Sans SC"),local("Source Han Sans CN"),local("思源黑体"),
      url("/assets/fonts/SourceHanSansSC-Regular.woff2") format("woff2"),
      url("/assets/fonts/SourceHanSansSC-Regular.otf") format("opentype");
}
```

用到的地方：

| 位置 | 选择器 | 文件 |
| --- | --- | --- |
| 左上角 logo 后的两段标题 | `.brand-title-main` / `.brand-title-sub` | `theme.css` |
| 中央 logo 后的一句话 | `.center-slogan` | `theme.css` |
| 宠物头顶的泡泡 | `.pet-bubble` | `pet.css` |

找字体的顺序：**系统里的思源黑体 → 本目录的字体文件 → Noto Sans SC 兜底**。
所以：

1. 电脑里装了「思源黑体 / Source Han Sans SC」就能直接看到效果，什么都不用放；
2. 想用自己的字体文件，命名成下面任意一个拷进本目录即可（优先级从高到低）：
   - `SourceHanSansSC-Regular.woff2`
   - `SourceHanSansSC-Regular.otf`
3. 什么都没有时退回 `--font-hanhei` 后面的 `Noto Sans SC`（页面已从 CDN 加载），观感几乎一致。

## 怎么让它生效（两种方式，任选其一）

1. **放文件（推荐）**：把字体文件复制到本目录，文件名按上面两节命名；
2. **装系统字体**：把字体装进系统字体库，家族名保持 `Grasser` / `Source Han Sans SC` 即可被 `local()` 命中。

## 文件还没放时

不会报错：浏览器跳过 `@font-face`，文字退回各自的兜底栈
（Grasser → 楷体 → Noto Serif SC；思源黑体 → Noto Sans SC）。只是控制台会有几条 404，不影响页面。

## 换成别的字体名

只想换字体家族名（例如系统里叫别的名字），改 `theme.css` 里对应变量的**第一项**即可，例如：

```css
--font-grasser:"LXGW WenKai","楷体",KaiTi,serif;   /* 聊天正文 */
--font-hanhei:"HarmonyOS Sans SC","Noto Sans SC",sans-serif;   /* logo 后文字 / 宠物气泡 */
```

> 提醒：`web_app.py` 的 `/assets/` 路由会直接把这些文件发给浏览器，**不需要**改 `STATIC_ROUTES`。
