# 宠物泡泡里的图片 / GIF 放在这里

## 怎么用

1. 把你的图片（png / jpg / webp / svg / gif）放进本目录，例如：

   ```
   web/assets/pet/bubble/我的图.gif
   ```

2. 打开 `web/pet.js`，在 **②** 那一段的 `PET_MESSAGES` 数组里加一行：

   ```js
   const PET_MESSAGES = [
     "饿了",
     { image: "/assets/pet/bubble/我的图.gif", alt: "说明" },   // ← 加这一行
   ];
   ```

3. 刷新页面，点一下宠物就会随机抽到它（字符串是文案，对象是图片）。

支持三种写法：

- 站点内路径：`/assets/pet/bubble/xx.gif`
- 完整网址：`https://example.com/xx.gif`
- 手动指定停留时长：`{ image: "...", holdMs: 3000 }`

## GIF 会完整播完

脚本会自己读 GIF 的每一帧延时（GIF89a 的图形控制块），把总时长算出来，
泡泡会一直留到 GIF 完整播完一遍再加 0.4 秒才切回金额 —— **不用手填时长**。
相关常量在 `web/pet.js` 顶部：

| 常量 | 默认值 | 作用 |
| --- | --- | --- |
| `PET_MEDIA_HOLD_MS` | 2600 | 静态图片停留多久 |
| `PET_GIF_EXTRA_MS` | 400 | GIF 播完后多留的时间 |
| `PET_GIF_FALLBACK_MS` | 4000 | GIF 时长解析失败时的兜底 |
| `PET_HOLD_MAX_MS` | 20000 | 停留上限 |

## 目录里已有的示例

| 文件 | 说明 |
| --- | --- |
| `heart.gif` | 12 帧 × 0.2s = **2.4 秒** 的跳动爱心 |
| `wave.gif` | 8 帧 × 0.15s = **1.2 秒** 的浮动小星 |
| `star.png` | 静态图片示例 |

## 浏览器控制台里预览任意一张图

```js
petPointer.showMessage({ image: "/assets/pet/bubble/你的图.gif" })   // 直接显示在泡泡里
petPointer.gifDuration("/assets/pet/bubble/你的图.gif")            // 查它的完整播放时长（毫秒）
```
