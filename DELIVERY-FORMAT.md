# 交付格式规范（AI 返回文件 / 图片的唯一出口）

> 2026-09-13 定稿。凡是「AI 把文件、图片交给用户」的场景，**全部**走这套格式，不要再写第二套。
> 代码位置：`web/app.js` 顶部「★ 交付格式规范」横幅下的三个函数；样式在 `web/app.css` 的「AI 交付区」段。

## 一句话规则

**内容在气泡里（平铺，无边框卡片、无按钮）；操作（打开 / 保存到本机）在气泡外的小卡牌上。**

> 保存行为（2026-09-14 按用户要求改）：**所有保存按钮点一下就弹「选择文件夹」对话框，
> 直接写进你选的那个文件夹**（浏览器 File System Access 的 `showDirectoryPicker`），
> 不再需要先去 `/space` 页面粘贴路径绑定；浏览器不支持时退回默认下载位置。
> ⚠ 实现上 `pickSaveFolder()` 必须在点击事件里**最先**调用（在 `fetch` 之前），
> 否则浏览器会以「不是用户点的」为由拒绝弹出选择框。

```
┌─ 聊天气泡 .bubble ───────────────────────┐
│ AI 的文字说明                             │
│ <pre class="code-block">代码本体</pre>    │  ← 代码块只放代码
│ <img class="deliver-photo">               │  ← 图片只放图
└───────────────────────────────────────────┘
┌─ 下载小卡牌 .deliver-tray（气泡外面）─────┐
│ 🖼 生成搞笑-123456.png   1024 × 1024  ↗ ⤓ 📁 │  ← 一行一个交付物
│ «» hello.py              python · 24 行  ⤓ 📁 │
│ 📄 report.md             2.4 KB         ↗ ⤓   │
└────────────────────────────────────────────┘
```

## 三类交付物

| 交付物 | 来源 | 气泡里 | 卡牌行上的按钮 |
| --- | --- | --- | --- |
| **代码块** | 正文里的 ` ```lang filename=xxx ` 围栏 | `<pre class="code-block"><code>…</code></pre>` | 保存 ⤓ / 保存 📁（两个都是「弹文件夹选择器」） |
| **图片** | 后端 `image` 事件（`item.images`） | `.deliver-image > img.deliver-photo` | 打开 ↗ / 保存 ⤓ / 保存 📁 |
| **空间文件** | 后端 `file` 事件（`item.files`，AI 用空间工具写入） | 不占气泡 | 打开 ↗ / 保存 ⤓ |

## 两个 token 约定（对不上号按钮就失效）

| 交付物 | token | 气泡侧 | 卡牌侧 |
| --- | --- | --- | --- |
| 代码块 | `code-{消息下标}-{块下标}` | 代码存在 `codeFileStore` | 按钮 `data-code-id` |
| 图片 | `shot-{消息下标}-{图下标}` | 图片 `data-shot` | `[data-image-size]`（图加载完回填「宽 × 高」） |

## 卡牌行顺序

图片 → 代码块 → 空间文件（`assistantDeliverTrayMarkup` 里 `imageRows + codeRows + fileRows`），不要随意调换。

## 硬性约束

1. **不要新建第二套卡片样式**：`.code-card`、`.deliver-card`、`.bubble-image`、`.return-row`、`.return-btn` 都已删除，别再加回来。
2. **按钮不许放进气泡**：只放在 `.deliver-tray` 里，按钮样式统一 `.deliver-icon-btn`（`<a>` 与 `<button>` 长得一样，悬停变主题色）。
3. **模板字符串写成「一整行」**：气泡是 `white-space:pre-wrap`，模板里的换行 + 缩进会被渲染成空行（旧卡片曾因此比图片高 158px，看起来就是图片边上围了一圈空框）。CSS 侧 `.bubble-returns{white-space:normal}` 只做兜底。
4. **渲染入口只有一个**：`renderMessages()` 里 `assistantContentMarkup()`（气泡内容）与 `assistantDeliverTrayMarkup()`（气泡外卡牌）成对调用，改完保证两边 token 对得上。
5. **新增一种交付物** = ① `assistantContentMarkup` 里出内容（可选）② `assistantDeliverTrayMarkup` 里加一行 ③ 复用 `.tray-row` / `.tray-icon` / `.tray-name` / `.tray-size` / `.tray-actions` / `.deliver-icon-btn`，不要新造 HTML 结构。
6. **后端提示词同口径**：`web_app.py` 的 `build_system_prompt()` 里告诉模型「发文件就用 ` ```python filename=hello.py ` 围栏或写进空间」，保证模型产出的东西前端一定能接住。
7. **流式期间不切格式**：`item.streaming` 为真时 `assistantContentMarkup` 只输出一个 `.streaming-text`（把围栏原样当文字显示），代码块 / 卡牌行等结构等打字结束后的下一次渲染再切 —— 否则 `renderStreamingAnswer()` 只会更新第一个 span，正文会出现重复。

## 事件委托（都绑在 `messagesEl` 上）

- `[data-code-action="download" | "space"]` → 代码块行（内容从 `codeFileStore` 取，走 `saveTextToPickedFolder`）
- `[data-image-action="download" | "space"]` → 图片行（`saveRemoteImageToPickedFolder`：先弹文件夹，再抓 blob）
- `[data-space-action="save"]` → 空间文件行（`saveSpaceFileToPickedFolder`：先弹文件夹，再从 `/api/space/raw` 抓内容）
- 图片 `load` / `error`（捕获阶段）→ 卡牌行回填尺寸 / 气泡里换成破图提示 `.deliver-broken`
