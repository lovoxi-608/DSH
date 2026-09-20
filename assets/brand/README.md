# 左上角 Logo（品牌图）

## 现在用的是哪张图

```
web/assets/brand/logo.svg      ← 文件位置
/assets/brand/logo.svg         ← 浏览器地址（页面左上角显示的就是它）
```

## 换成自己的图片

**方式一（推荐，只改一行）**

1. 把图片放进本目录，比如 `web/assets/brand/my-logo.png`
   （建议高度 48px 以上、透明背景 PNG，宽高比自由）。
2. 打开 `web/theme.js`，改最上面那行：

```js
const BRAND_LOGO_SRC = "/assets/brand/my-logo.png";   // ★ 换成你的图片地址
```

支持站点内路径（`/assets/brand/my-logo.png`）和完整网址（`https://…/logo.png`）。
图片地址写错时，页面会自动退回 `index.html` 里写死的 `/assets/brand/logo.svg`，不会出现破图。

**方式二（零改代码）**

直接把 `web/assets/brand/logo.svg` 这个文件替换成你自己的同名 SVG 文件。

## 显示尺寸怎么调

样式在 `web/theme.css` 的 `.brand-logo`：

```css
.brand-logo{ height:26px; width:auto; }   /* 改 height 即可整体缩放 */
```
