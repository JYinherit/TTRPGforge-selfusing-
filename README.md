# 自用跑团工具箱（ClueForge + 地图工坊）

给 KP 用的离线跑团工具箱。原始 ClueForge（地图批注 / 线索墙 / 道具生成 / 时间线）保持原样，
在此基础上增量加了一个 **地图工坊**：房间、墙体、门洞、尺寸元数据、程序化楼层生成，
数据随 `.clueforge` 工程一起保存，旧存档照样能读。

## 直接用（KP 版）

双击 `dist/index.html` 即可，完全离线（无 CDN、无网络请求）。浏览器建议 Edge / Chrome。

- 「地图批注」：把地图图片拖进来，画圈、写批注。
- 「地图工坊」：
  - `V` 选择 / `R` 房间（按住拖出矩形，自动吸附网格）/ `W` 墙体（点击落点连墙，双击或 Enter 结束）/ `D` 门（点墙上放门，门型可选平开/窗/暗门）/ `X` 擦除。
  - 按住 `Alt` 时可以落点不吸附网格（放尺寸奇怪的房间时用）。
  - 双击房间改名；检查器里能看像素尺寸和按「1 格 = N 米」换算的米数。
  - `M` 标记：点格子放 Token / 物件，可选颜色、字形、1–4 格大小；「上传图」可给标记换成自己的图片（图片存在工程里，单张 ≤300KB）。
  - 多选：拖框或 `Shift+点击` 框住一片，检查器会给出「房间 N / 墙 N / 门 N / 标记 N」统计，改一个就能批量移动（按格吸附）或「删除这 N 个」。
  - 「生成楼层」按 seed 生成整层平面：房间、墙体、门、走廊一次出齐，改 seed 就换一套，同一 seed 永远同一张图，方便反复调。
  - `导出 PNG` 出干净底图（不含选择框），`导出 JSON` / `导入 JSON` 单独搬一张地图。
  - 撤销/重做 `Ctrl+Z` / `Ctrl+Y`，删除 `Delete`。
- 工程保存：顶部「保存」/ 自动保存都写到浏览器 IndexedDB；导出 `.clueforge` 文件同样包含地图工坊的数据。
  旧版本 ClueForge 读新文件时会忽略这个新字段，不会报错。

## 开发版

```bash
npm install
npm run typecheck     # TS 类型检查
npm run build         # 先 tsc --noEmit 门禁，通过后才产出 dist/（单文件 bundle + 老应用静态资源）
npm run serve         # 本地起 5173 预览 dist
```

- 需要 Node >= 20（见 `package.json` 的 `engines`）；类型检查不过就不会出包，避免把坏包交给 `dist/`。
- 新代码在 `src/`，入口 `src/main.ts` → `src/modules/mapstudio/`。
- 老应用代码原封不动放在 `ClueForge/`，只做了四处接线（见下），构建时整体拷进 `dist/`。
- 打包用 Vite library 模式，输出 IIFE 的 `dist/clueforge-studio.js`；fabric / roughjs / marked 全部打进 bundle，因此 `dist/index.html` 不引用任何 CDN。

### 与老应用的接线点

| 文件 | 改动 |
| --- | --- |
| `ClueForge/index.html` | 去掉 3 个 CDN 的 `<script>`；加「🏰 地图工坊」tab 和 `#mapStudioPanel` 容器；加 `clueforge-studio.js`（在 `eventbus.js` 之后、`app.js` 之前） |
| `ClueForge/ui.js` | tab 切换里加 `mapstudio` 分支，并通知 bundle 里的 `ClueForgeBridge.onTabShown` |
| `ClueForge/project.js` | 存档里追加可选字段 `mapStudio`；启动恢复缓存和打开工程文件两处都调用 `restoreMapStudio(project)`（无该字段直接跳过） |
| `ClueForge/eventbus.js` | 末尾加一行 `window.Bus = Bus;`，让新代码能触发老应用的 `project:auto-save` |
| `ClueForge/style.css` | 末尾追加 `.cf-ms-*` 面板样式，沿用原有主题变量 |

### 数据结构

`mapStudio` 存的是纯数据（不含 fabric 对象）：

```json
{
  "version": 1,
  "name": "生成的楼层",
  "grid": { "kind": "square", "cell": 40, "originX": 0, "originY": 0, "metersPerCell": 1.5 },
  "rooms": [{ "id": "room_x", "left": 80, "top": 80, "width": 240, "height": 120, "meters": { "w": 9, "h": 4.5 } }],
  "walls": [{ "id": "wall_x", "points": [{ "x": 0, "y": 0 }], "unit": "m" }],
  "doors": [{ "id": "door_x", "x": 120, "y": 80, "angle": 90, "width": 40, "kind": "door" }],
  "corridors": [{ "id": "corr_x", "left": 0, "top": 0, "width": 40, "height": 40 }],
  "markers": [{ "id": "mk_x", "shape": "token", "x": 120, "y": 120, "sizeCells": 1, "color": "#d0564f", "glyph": "A", "assetId": "asset_x" }],
  "assets": [{ "id": "asset_x", "hash": "…", "kind": "token", "dataUrl": "data:image/png;base64,…", "w": 64, "h": 64, "bytes": 1905 }],
  "backgroundRepeat": false,
  "size": { "width": 1040, "height": 720 }
}
```

`metersPerCell` 是尺寸口径（1 格 = 多少米），改它只影响米数显示和存档里的 `meters`，不动像素布局。
`markers` 是 Token / 物件（`shape` 取 `token` / `prop`），`assets` 是图片资产池：只收内嵌 `data:image/`，
单张 ≤300KB、总量 ≤6MB、最多 40 张，撤销只回滚文档不回滚资产池。

- `version` 固定为 `1`；不能识别的更高版本（`version > 1`）会被拒绝加载并提示，而不是猜着读。
- `background` 只接受内嵌的 `data:image/...`，外部 URL 会被忽略——双击打开的 `file://` 页面不应该因为一份地图 JSON 就对外发请求。
- 导入时会校验根结构（四个数组、有限数字的 `grid.cell`）并对坐标/尺寸/成员数做夹取，校验不过的 JSON 不会改动当前画布。

### 版本与回滚

- 回滚 = 用备份的 `dist/` 目录**整体替换**新的 `dist/`，不要只换其中一个文件：`index.html` 和 `clueforge-studio.js` 是配套的，混搭会接线失败。
- 工程数据存在浏览器 IndexedDB 里，不随 `dist/` 回滚而清空；回滚后双击 `dist/index.html` 即可回到旧版界面，数据仍在（必要时先导出 `.clueforge` 备份）。

### 已知限制

- 墙体是折线，暂不支持弧墙；门只能放在已有墙段上。
- 地图工坊与「地图批注」是两块画布，同一张图要分别导入（下一步可以把生成结果一键送到批注层）。
- 生成器只出单层矩形房间，没有斜角/圆形房间。
- 标记/物件是「静态战斗地图」层：能摆、能换图、能随工程存；还没有 FVTT 的角色卡、可见性、光照、宏。图片资产只压缩内嵌，不做格式转换。

## 设计令牌（tokens.css）

颜色 / 字号 / 间距 / 圆角只允许写在 `ClueForge/tokens.css`，组件里一律 `var(--cf-*)`。
`npm run build` 会先跑 `scripts/lint-tokens.mjs`：地图工坊样式段里出现裸 px / 裸 hex 直接构建失败。

- 字号 4 档：10 / 11 / 12 / 16
- 间距 4 基：4 / 8 / 12 / 16 / 24
- 圆角：4 / 6 / 10；控件高：30（主）/ 26（小）
- 断点（CSS 变量写不进 media）：1180 收检查器、860 收窄左栏

## v0.6 变更（2026-10-28）

- 导出 PNG 支持 1x / 2x 与带不带格线；文件名带地图名（标题双击可改）。
- 令牌化收口：`tokens.css` 唯一真源 + lint 门禁，旧硬编码全部清掉。
- 空态卡片可直接「生成楼层」；检查器空态给出「点房间/墙体/门分别看什么」。
- 数据安全：读档保留房间 tags/level 等扩展字段；走廊可选中可删除；
  生成覆盖前二次确认；房间重名自动加序号。
- 状态栏镜像自动存档反馈（有更改… → 已自动保存 hh:mm:ss）。

## v0.7 变更（2026-10-29）

- **批量选择 / 批量删除**：拖框或 Shift+点击多选，检查器给出分类统计；
  批量拖动按格吸附并写回文档（房间/墙/门/走廊/标记一起走），「删除这 N 个」一次删干净，可撤销。
- **标记（Token / 物件）**：`M` 放标记，颜色 6 色、字形、1–4 格大小；
  「上传图」把标记换成自己的图片（圆形裁切），图片随工程保存。
- **地板材质**：底图可勾选「按格平铺」，铺满整张图做地砖/墙纸。
- 撤销/保存语义：资产池常驻会话，撤销只回滚文档对象，不会把图片资产一起撤掉。
