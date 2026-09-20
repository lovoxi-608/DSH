# 思考强度背景图（聊天背景）

这 5 张图分别对应「思考强度」滑块的 5 个档位，拖动滑块就会切换：

| 档位 | 名称 | 图片文件 | 浏览器地址 |
| --- | --- | --- | --- |
| 1 | 极简 | `web/assets/bg/mind-1.svg` | `/assets/bg/mind-1.svg` |
| 2 | 轻量 | `web/assets/bg/mind-2.svg` | `/assets/bg/mind-2.svg` |
| 3 | 均衡 | `web/assets/bg/mind-3.svg` | `/assets/bg/mind-3.svg` |
| 4 | 深入 | `web/assets/bg/mind-4.svg` | `/assets/bg/mind-4.svg` |
| 5 | 极致 | `web/assets/bg/mind-5.svg` | `/assets/bg/mind-5.svg` |

## 换成自己的图片

打开 `web/app.js`，改最上面这段映射表即可（键是档位 1~5）：

```js
const MIND_BG_IMAGES = {
  1: "/assets/bg/mind-1.svg",
  ...
};
```

把图片放进 `web/assets/bg/`，然后把对应档位的地址改成你的文件名即可，
例如 `4: "/assets/bg/my-peak-night.jpg"`。

## 相关开关与代码位置

- 开关（`背景随强度`）：`web/index.html` 的 `#mindBgToggle`，状态存在 localStorage
  的 `mogao-mind-bg`（1 = 开启）。
- 背景层：`web/index.html` 的 `<div class="chat-bg" id="chatBg">`，
  样式在 `web/app.css` 的 `.chat-bg`（透明度、`background-size: cover` 都在那里调）。
- 渲染逻辑：`web/app.js` 的 `applyMindBackground()` / `renderMindNodes()`。
- 档位对应的真实模型参数（reasoning_effort / max_tokens / temperature）在后端
  `web_app.py` 的 `EFFORT_LEVELS` 里，前端滑块文案也来自这个接口。
