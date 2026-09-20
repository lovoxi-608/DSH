# updream 口琴谱 · GitHub Pages 部署说明

## 网页应用构成（web/ 目录）
| 页面 | 文件 | 说明 |
|---|---|---|
| 主页（口琴谱解析） | web/lab.html + lab.js + assets/lab/app.* | 上传 MIDI/txt → 多轨音轨展示 → 游戏键位谱 |
| 乐谱库 | assets/lab/library.html | 上传/收藏/点赞/试听/云同步/管理员 |
| 曲谱详情 | assets/lab/score.html | 演奏预览/当前曲谱/保存 txt+midi/删除 |
| 主站入口 | web/index.html | 聊天壳（可选，可只部署 lab 三件套） |

## 部署步骤（GitHub Pages）
1. 新建 GitHub 仓库（如 `harmonica-scores`），把 **web/ 目录内的所有内容** 上传到仓库根目录
   （保持目录结构：index.html、lab.html、assets/、auth.js 等都在根下）
2. 仓库 Settings → Pages → Source 选 **Deploy from a branch** → 分支 `main` → 目录 `/(root)` → Save
3. 等待 1-2 分钟，访问 `https://<你的用户名>.github.io/<仓库名>/`

> 访问入口：`https://<用户名>.github.io/<仓库名>/lab.html` 直接进口琴谱应用；
> 若也部署了 index.html，从主页点「口琴谱」进入。

## 静态托管的说明
- **登录**：GitHub Pages 是纯静态托管，没有手机号登录后端，普通用户登录不可用。
- **管理员**：不受影响 —— 打开**设置 → 管理员**，首次会提示「设置管理员口令」（≥6 位，
  仅存本机浏览器，验证通过即最高管理员），可管理次级管理员、云同步配置、删除曲谱。
- **曲谱库数据**：默认存本机浏览器；配置 **GitHub 云同步**（设置 → 云同步，填 Token/仓库）后，
  上传/删除曲谱自动推送服务器文件，多设备自动拉取。

## 云同步 Token 获取
GitHub → Settings → Developer settings → Personal access tokens → Tokens(classic)
→ Generate new token → 勾选 `repo` → 生成 `ghp_...` → 填入网页「设置 → 云同步」。
