# 把小宠物图片放在这个文件夹里

## 怎么放

1. 准备一张宠物图片（推荐 **PNG 透明背景**，正方形，约 256×256；像素风更好看，也支持 GIF 动图）。
2. 把图片**改名成 `pet.png`**，放进本目录：

   ```
   web/assets/pet/pet.png
   ```

3. 刷新浏览器页面（http://127.0.0.1:8787/），右下角就会显示你的宠物。

## 换文件名 / 换格式

打开 `web/pet.js`，改最上面的那一行：

```js
const PET_IMAGE_CANDIDATES = ["/assets/pet/pet.png", "/assets/pet/pet.gif"];
```

- 想用 `pet.gif`：把 gif 放进本目录，保持数组里第二项不变即可（找不到 png 会自动用 gif）。
- 想用别的名字，比如 `cat.webp`：改成 `["/assets/pet/cat.webp"]`。
- 也可以直接写在线地址，例如 `["https://example.com/pet.png"]`。

## 找不到图片会怎样

不会报错，宠物位置会显示一个内置的占位小精灵（并提示“放 pet.png”），
等你放好图片后自动替换。

---

# 点击音效（可选）

## 怎么放

1. 准备一个短音效文件（**mp3 最通用**，也支持 wav / ogg，建议 0.2~0.5 秒的“捏响玩具鸭”声）。
2. 放进本目录，命名成 `duck.mp3`：

   ```
   web/assets/pet/duck.mp3
   ```

3. 刷新页面，点击宠物就会播放它。

## 不放文件会怎样

会自动使用内置的**合成音**（高音「唧~」+ 低音「嘟~」，用 Web Audio 现场生成），
不影响使用。

## 换文件名 / 换格式

打开 `web/pet.js`，改这一行：

```js
const PET_SOUND_CANDIDATES = ["/assets/pet/duck.mp3", "/assets/pet/duck.wav", "/assets/pet/duck.ogg"];
```

按顺序查找，命中哪个用哪个；都找不到就用合成音。数组里同样可以写在线地址，例如
`["https://example.com/squeak.mp3"]`。

> 提示：没放文件时，浏览器控制台会看到 3 条 `duck.*` 的 404 记录 —— 这是正常的“探测是否存在”，
> 放好文件后就不再出现。
