# AI 头像放在这里

## 现在用的是哪张图

```
web/assets/ai/avatar.svg      ← 文件位置
/assets/ai/avatar.svg         ← 浏览器地址（对话框里 AI 图标用的就是它）
```

## 换成自己的图片（两种方式）

**方式一：直接替换同名文件（推荐，零改代码）**

1. 准备一张正方形图片（建议 128×128 以上，1:1，比如 `avatar.png`）。
2. 放进本目录并改名成 `avatar.svg`？不行——格式要对得上，所以请用下面的方式二，
   或者把图片转成 SVG；更省事的做法是：删掉 `avatar.svg`，放入 `avatar.png`，
   然后按方式二把代码里的后缀改成 `.png`。

**方式二：改一行代码**

打开 `web/app.js`，改最上面的常量：

```js
const AI_AVATAR_SRC = "/assets/ai/avatar.png";   // ★ 换成你自己的图片地址
```

支持三类写法：

- 站点内路径：`/assets/ai/my-avatar.png`
- 完整网址：`https://example.com/avatar.png`
- 用户登录头像规则也在同一段代码里（`userAvatarMarkup` 函数）

## 说明

- 头像显示在每条 AI 消息气泡左侧，尺寸 34×34，圆形裁切（`object-fit: cover`）。
- 用户消息气泡右侧显示登录用户的头像；没登录时显示默认人形图标。
