# 输入框背景图放在这里

> ⚠ 说明：输入框背景图功能已从页面上移除（本文件为旧版遗留说明）。
> 现在用到这里图片的是「思考强度背景」：见同目录的 `MIND_BG.md`（`mind-1.svg` ~ `mind-5.svg`）。

## 怎么用

1. 准备一张图片（推荐横向，宽度 1200px 以上，如 `.jpg` / `.png` / `.webp`）。
2. 把图片**改名成 `input-bg.png`**，放进本目录：

   ```
   web/assets/bg/input-bg.png
   ```

3. 刷新页面，输入框后侧就会显示这张背景图。

## 换文件名 / 换图片

方式一（改代码，全局默认值）——打开 `web/theme.js`，改最上面那行：

```js
const INPUT_BG_DEFAULT = "/assets/bg/input-bg.png";
```

方式二（页面上改，只影响当前浏览器）——右下角 **用户菜单 → 输入框背景图**，
填入图片地址后点「应用」。需要恢复默认就点「恢复默认」。

支持填写：

- 站点内路径：`/assets/bg/input-bg.png`
- 完整网址：`https://example.com/bg.jpg`
- 留空表示不使用背景图

## 小提示

- 图片加载失败时会自动忽略（不会出现破图），控制台会给出提示。
- 输入框内文字是深色的，背景图建议选浅色、低对比度的，避免影响阅读。
- 想调整显示方式（平铺 / 居中 / 大小），改 `web/theme.css` 里
  `.composer-area` 的 `background-size` / `background-position`。
