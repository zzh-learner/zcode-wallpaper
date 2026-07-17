# 控制中心 UI 改版设计（macOS Big Sur 玻璃拟态）

- **日期**：2026-07-17
- **分支**：`feat/control-ui-revamp`
- **范围**：`control/control.css` / `control/index.html` / `control/control.js` / `control/lib/*.js` 的**视觉与布局层**改版。不改 server（`lib/control-server.cjs`）、不改各子系统动作逻辑（inject/transparent/rotate）、不改 lib 渲染函数的数据契约。
- **动机**：当前控制中心是 5 个面板单列堆叠、动作面板 9 个按钮无层级、面板几乎全透导致亮壁纸上文字吃力（教训 2 的"赌运气可读性"遗留）、皮肤编辑器挤、配色不统一。改版目标：macOS Big Sur 玻璃拟态质感 + 4 Tab 分区结构 + 统一调色板与交互反馈。

---

## 1. 已确认的设计决策（brainstorm 结论）

| 决策点 | 选择 | 备注 |
|---|---|---|
| 优化范围 | 全部四向（视觉质感/布局层级/交互反馈/皮肤编辑器） | 大改 |
| 主风格 | 深化玻璃拟态（macOS Big Sur 风） | 保透壁纸 |
| 面板透明度 | 均衡路线（macOS 原版）：alpha 0.55 + blur 24px | 文字永远清晰，解决教训 2 遗留 |
| 调色板 | macOS 系统调色板：蓝主 `#0a84ff` + 系统状态色 | 绿 `#30d158`/黄 `#ffd60a`/红 `#ff453a` |
| 布局结构 | Tab 切换分区 | 最紧凑、滚动最少 |
| Tab 分组 | 4 Tab：总览 / 壁纸 / 阅读 / 皮肤 | 书架+书签合并为「阅读」 |
| emoji | UI 图标换 SVG，用户 emoji（skin 角标）保留 | Lucide 风格，~6 个图标 |

---

## 2. 架构：4 Tab 分区结构

### 2.1 DOM 结构包装

现有 5 个 `<div class="panel">` 的 DOM **保留不动**，外面包一层 Tab 容器。JS 控制 `display` 切换显隐。

```html
<body>
  <div id="tabs" class="tab-bar">
    <button class="tab" data-tab="overview">总览</button>
    <button class="tab" data-tab="wallpaper">壁纸</button>
    <button class="tab" data-tab="reader">阅读</button>
    <button class="tab" data-tab="skin">皮肤</button>
  </div>
  <div id="tab-content">
    <section class="tab-pane" data-pane="overview">
      <div id="status-panel" class="panel"></div>
    </section>
    <section class="tab-pane" data-pane="wallpaper">
      <div id="actions" class="panel">...</div>
    </section>
    <section class="tab-pane" data-pane="reader">
      <div id="shelf-panel" class="panel">...</div>
      <div id="bookmark-panel" class="panel">...</div>
    </section>
    <section class="tab-pane" data-pane="skin">
      <div id="skin-panel" class="panel"></div>
    </section>
  </div>
</body>
```

### 2.2 Tab 切换逻辑（control.js 新增）

- 初始读 `localStorage["zcode-control:tab"]`，无则默认 `"overview"`。
- 点击 `.tab` → 切 `.active` class + 显示对应 `.tab-pane`（其余 `display:none`）。
- 写 localStorage 持久化。
- 切到「皮肤」Tab 时触发一次 `renderSkinPanel()`（避免首次进入皮肤 Tab 时空白，因为 skin-view 的 `structureBuilt` 状态可能滞后）。

### 2.3 Tab 容器宽度

整个控制中心 `max-width: 480px; margin: 0 auto`，在 webview 内居中。窄屏（<480px）自适应。

---

## 3. 设计 Token（CSS 变量，集中管理）

全部在 `:root`，替换现有散落的裸色值。

```css
:root {
  /* 玻璃面板（均衡路线） */
  --glass-bg:          rgba(28, 28, 36, 0.55);
  --glass-bg-elevated: rgba(44, 44, 54, 0.65);  /* 嵌套卡片 */
  --glass-blur:        24px;
  --glass-sat:         180%;
  --glass-border:      rgba(255, 255, 255, 0.12);
  --glass-border-strong: rgba(255, 255, 255, 0.22);
  --glass-shadow:      0 8px 32px rgba(0, 0, 0, 0.4);
  --glass-highlight:   inset 0 1px 0 rgba(255, 255, 255, 0.15);

  /* 圆角层级 */
  --radius-panel:   16px;
  --radius-card:    12px;
  --radius-control: 10px;

  /* macOS 系统调色板 */
  --accent:         #0a84ff;
  --accent-hover:   #3d94ff;
  --accent-pressed: #0060df;
  --ok:             #30d158;
  --warn:           #ffd60a;
  --err:            #ff453a;
  --muted:          rgba(235, 235, 245, 0.6);

  /* 文字层级 */
  --text-primary:   rgba(255, 255, 255, 0.96);
  --text-secondary: rgba(235, 235, 245, 0.6);

  /* Type scale */
  --fs-xs:   11px;
  --fs-sm:   12px;
  --fs-base: 13px;
  --fs-md:   14px;
  --fs-lg:   16px;

  /* 间距（8px 网格） */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
}
```

**字体保持** `"Microsoft YaHei", system-ui, sans-serif` 不变。控制中心几乎全中文，引入 Inter 只对英文有效且中英混排会跳脱，YAGNI。

---

## 4. 玻璃面板基础样式（替换现有 `.panel`）

```css
.panel {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-sat));
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-panel);
  box-shadow: var(--glass-shadow), var(--glass-highlight);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-3);
}
```

**变化对比**：
| 属性 | 现状 | 改版 | 理由 |
|---|---|---|---|
| background | `rgba(20,20,24,0)` 全透 | `rgba(28,28,36,0.55)` 均衡 | 解决教训 2 赌运气可读性 |
| backdrop-filter | `blur(3px)` | `blur(24px) saturate(180%)` | macOS 玻璃真身 |
| box-shadow | 无 | 投影 + 顶部高光 | Big Sur 浮起感 |
| border-radius | `8px` | `16px` | 大圆角 |
| border | `rgba(255,255,255,0.12)` | 同（保留） | — |

**text-shadow 保留**作为额外保险（面板内透明区域文字仍有兜底轮廓），但不再是唯一可读性来源。

**A1 红线保留**：`html, body { background: transparent !important }` 不动。壁纸靠 body 透出。

---

## 5. Tab 栏样式（macOS segmented control）

```css
.tab-bar {
  display: flex;
  gap: 2px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: var(--radius-control);
  padding: 3px;
  margin-bottom: var(--space-3);
}
.tab {
  flex: 1;
  background: transparent;
  border: none;
  border-radius: 7px;
  padding: 5px 14px;
  color: var(--text-secondary);
  font-size: var(--fs-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background 200ms ease, box-shadow 200ms ease, color 200ms ease;
}
.tab.active {
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  color: var(--text-primary);
  font-weight: 600;
}
.tab:hover:not(.active) { color: var(--text-primary); background: rgba(255,255,255,0.06); }
```

**选中态用浅色块**（macOS Big Sur segmented control 原版），不是蓝填色。蓝留给主操作按钮。

`.tab-pane` 默认 `display:none`，`.tab-pane.active` `display:block`。

---

## 6. 总览 Tab：状态行项重排

### 6.1 新结构（status-view.js `renderStatus` 重写返回值）

每项一行：左标题（主文字色）+ 右状态值（状态色/弱字色）+ 次要信息行（xs 弱字色）。

```html
<div class="status-row">
  <div class="status-main">
    <span class="status-label">ZCode</span>
    <span class="status-value ok"><span class="dot"></span>运行中</span>
  </div>
  <div class="status-sub">端口 9222 · 窗口 3</div>
</div>
```

6 行：ZCode / 壁纸 / 透明度 / 阅读器 / 轮播 / 资源。最后一行不画 `border-bottom`。

### 6.2 异常行高亮

调试端口未开、轮播 stale（进程退出）、依赖 ✗ 这类异常，整行弱底高亮：
- 警告类（端口未开）：`background: rgba(255, 214, 10, 0.08)`
- 错误类（依赖缺失）：`background: rgba(255, 69, 58, 0.08)`

### 6.3 CSS

```css
.status-row { padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,0.06); }
.status-row:last-child { border-bottom: none; }
.status-main { display: flex; justify-content: space-between; align-items: baseline; }
.status-label { color: var(--text-primary); font-size: var(--fs-base); }
.status-value { font-size: var(--fs-sm); font-weight: 500; }
.status-value.ok { color: var(--ok); }
.status-value.warn { color: var(--warn); }
.status-value.err { color: var(--err); }
.status-value .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; margin-right: 5px; vertical-align: middle; }
.status-sub { color: var(--text-secondary); font-size: var(--fs-xs); margin-top: 2px; }
.status-row.warn-row { background: rgba(255, 214, 10, 0.08); }
.status-row.err-row { background: rgba(255, 69, 58, 0.08); }
```

**`.ok`/`.warn`/`.err`/`.muted` class 名保留**（status-view.js 现有逻辑用），只改 CSS 值。`.muted` 在状态行里改用 `.status-sub`，但 `.muted` class 仍保留给其他地方（空状态等）。

### 6.4 测试影响

`statusviewtest.cjs` 断言 `renderStatus` 输出含特定子串。改了输出结构后**更新断言**匹配新 class/结构。这是纯函数（status JSON → HTML），单测覆盖可靠。

---

## 7. 壁纸 Tab：内部分组卡片

### 7.1 4 个分组

现有 `#actions` 内的按钮 + 透明度 + 轮播，分进 4 个嵌套卡片：

```html
<div id="actions" class="panel">
  <div class="action-group">
    <div class="group-title">壁纸操作</div>
    <button class="primary" data-action="injectImage">注入图片</button>
    <button class="primary" data-action="injectVideo">注入视频</button>
    <button data-action="muteVideo">...静音</button>
    <button data-action="unmuteVideo">...有声</button>
    <button class="danger" data-action="remove">移除壁纸</button>
  </div>
  <div class="action-group">
    <div class="group-title">窗口透明</div>
    <label>透明度 <input id="opacity" ...>%</label>
    <button data-action="setTransparent">设透明</button>
  </div>
  <div class="action-group">
    <div class="group-title">壁纸轮播</div>
    <fieldset class="rotate-section">...</fieldset>
  </div>
  <div class="action-group">
    <div class="group-title">维护</div>
    <button data-action="resize">重新缩图</button>
    <button data-action="setup">重装依赖</button>
  </div>
</div>
```

### 7.2 分组卡片样式（嵌套玻璃）

```css
.action-group {
  background: var(--glass-bg-elevated);
  border-radius: var(--radius-card);
  padding: var(--space-3);
  margin-bottom: var(--space-2);
}
.group-title {
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
}
```

### 7.3 按钮分级

```css
button {
  background: rgba(255,255,255,0.10);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-control);
  padding: 6px 14px;
  font-size: var(--fs-sm);
  color: var(--text-primary);
  cursor: pointer;
  margin: 2px;
  transition: all 200ms ease;
}
button:hover { background: rgba(255,255,255,0.18); }
button:active { transform: scale(0.97); }
button:disabled { opacity: 0.35; cursor: not-allowed; }
button.primary { background: var(--accent); border-color: transparent; color: #fff; }
button.primary:hover { background: var(--accent-hover); }
button.danger:hover { background: rgba(255,69,58,0.25); border-color: var(--err); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
```

**primary**：注入图片/注入视频/开始轮播（主 CTA）。
**danger**：移除壁纸/停止轮播/删除类（hover 红弱底）。
**普通白玻璃**：其余。

index.html 给对应按钮加 `class="primary"` / `class="danger"`。`data-action` 不动。

### 7.4 透明度输入

```css
#opacity { width: auto; min-width: 60px; }
input { background: rgba(0,0,0,0.3); color: var(--text-primary);
  border: 1px solid var(--glass-border); border-radius: var(--radius-control); padding: 4px 8px; }
input[type="radio"], input[type="checkbox"], input[type="range"] { accent-color: var(--accent); }
```

### 7.5 job-msg 改 sticky toast

现在 `#job-msg` 是按钮后跟的 muted span。改成壁纸 Tab 顶部 sticky 横幅：

```css
#job-msg {
  position: sticky; top: 0; z-index: 10;
  display: block; padding: 6px 12px; margin-bottom: var(--space-2);
  border-radius: var(--radius-control);
  background: rgba(10, 132, 255, 0.15);
  color: var(--text-primary); font-size: var(--fs-sm);
  opacity: 0; transition: opacity 200ms ease;
}
#job-msg.show { opacity: 1; }
#job-msg.ok { background: rgba(48, 209, 88, 0.15); }
#job-msg.err { background: rgba(255, 69, 58, 0.15); }
```

control.js `setJobMsg` 改：加 `.show` class 显示，2.5 秒后 fade out（除非还在"执行中"）。成功 `.ok`、失败 `.err`、执行中默认蓝。

---

## 8. 阅读 Tab：书架 + 书签合并

### 8.1 结构

两个分区在一个玻璃面板内，用分区小标题隔开（不各自独立卡片，避免太碎）：

```html
<section class="tab-pane" data-pane="reader">
  <div id="bm-port-warn" class="banner warn-banner" style="display:none">...</div>
  <div id="shelf-panel" class="panel">
    <div class="reader-section">
      <div class="reader-section-title">书架 <button id="open-reader" class="link-btn">打开阅读器 →</button></div>
      <div id="shelf-list"></div>
    </div>
  </div>
  <div id="bookmark-panel" class="panel">
    <div class="reader-section">
      <div class="reader-section-title">书签</div>
      <div class="bookmark-add">...</div>
      <div id="bookmark-list"></div>
    </div>
  </div>
</section>
```

### 8.2 分区标题

```css
.reader-section-title {
  font-size: var(--fs-md); font-weight: 600;
  color: var(--text-primary); margin-bottom: 10px;
  display: flex; align-items: center; justify-content: space-between;
}
.link-btn { background: transparent; border: none; color: var(--accent);
  font-size: var(--fs-sm); cursor: pointer; text-decoration: none; }
.link-btn:hover { color: var(--accent-hover); text-decoration: underline; }
```

`.link-btn` 色从绿 `#66bb6a` → 蓝 `--accent`（统一调色板）。`.shelf-head` 布局保留（h3 + 右上链接），改用 `.reader-section-title`。

现有橙色 `.shelf-section-title`（橙底分割线）→ 改中性灰主文字色标题，橙留给 stale 异常态。

### 8.3 列表项卡片化

书项和书签项从"底边线分隔"改成卡片：

```css
.list-item {
  background: var(--glass-bg-elevated);
  border-radius: var(--radius-control);
  padding: 8px 12px;
  margin-bottom: 4px;
  display: flex; align-items: center; gap: 8px;
  transition: background 150ms ease;
}
.list-item:hover { background: rgba(255,255,255,0.22); }
.list-item.stale { color: var(--err); border-left: 3px solid var(--err); }
```

- 书项：标题+章节信息 `flex:1`，✕/+ 按钮右对齐。`.book-open` 保留 cursor:pointer。
- 书签项：title 一行 + URL `<small>` 下一行（保留现有）。
- stale 书：`--err` 色文字 + 左红条。

**注意**：现有 CSS 用 `#shelf-list .book` / `#bookmark-list .book` 限定选择器（教训 27 真机抓到的）。改版后 renderShelf/renderBookmarks 生成的 class **同时输出两个**：`class="list-item book"`（`.list-item` 是新卡片样式，`.book` 保留以兼容现有 `#shelf-list .book` / `#bookmark-list .book` 选择器，避免改 CSS 时遗漏）。**保留 `#shelf-list` / `#bookmark-list` 容器 id**（control.js 事件委托靠它们）。CSS 里 `#shelf-list .book` / `#bookmark-list .book` 规则可以删除（被 `.list-item` 取代），但保留 id 容器。

### 8.4 书签添加表单

```css
.bookmark-add { display: flex; gap: var(--space-2); margin-bottom: var(--space-2); flex-wrap: wrap; }
.bookmark-add input { flex: 1; min-width: 120px; width: auto !important; }
```

去掉现有 `style="width:120px"` inline，用 flex 自适应。

### 8.5 bm-port-warn 横幅

debug port 未开时显示。现有黄字 div 改成 banner 样式（和 job-msg 同风格），顶部 sticky：

```css
.warn-banner { padding: 6px 12px; border-radius: var(--radius-control);
  background: rgba(255,214,10,0.12); color: var(--warn); font-size: var(--fs-sm); margin-bottom: var(--space-2); }
```

### 8.6 空状态

书架/书签空时，居中空状态卡：

```css
.empty-state { padding: 20px; text-align: center; color: var(--text-secondary); font-size: var(--fs-sm); }
```

---

## 9. 皮肤 Tab：编辑器折叠组重排

### 9.1 编辑器分 4 个折叠组

`skin-view.js` 的 `renderEditor` 返回值重组，把现有 flat 内容包进 4 个 `<details>`（原生，无需 JS）：

1. **基本信息**（默认展开）：名称 / 字体 / 圆角。
2. **颜色 (9)**（默认展开）：9 个色块网格。
3. **角标与闪光**（默认**折叠**）：闪光开关+数量、emoji 角标行。
4. **壁纸叠加**（沿用现有 `renderOverlaySection`，已是 `<details>`）。

```html
<fieldset class="skin-edit-fs">
  <legend>编辑: 深海蓝 [预设只读]</legend>
  <details open><summary>基本信息</summary>...</details>
  <details open><summary>颜色 (9)</summary>...</details>
  <details><summary>角标与闪光</summary>...</details>
  <details>壁纸叠加...</details>  <!-- 沿用 renderOverlaySection -->
  <button class="primary" data-skin-act="save">保存</button>
</fieldset>
```

**关键约束**：`renderEditor` / `collectEditor` 的 `data-field`/`data-ck`/`data-ck-text`/`data-ov-*`/`data-emoji-*` 等 attribute **全部不动**。只改外层包装（把 flat DOM 包进 details）。`collectEditor` 靠 querySelector 按属性收集，属性不变就能正常工作。

### 9.2 颜色卡片化

```css
.skin-color {
  background: var(--glass-bg-elevated);
  border-radius: var(--radius-control);
  padding: 8px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  font-size: var(--fs-xs); transition: background 150ms ease;
}
.skin-color:hover { background: rgba(255,255,255,0.22); }
.skin-color input[type="color"] { width: 100%; height: 40px; padding: 0; border: 1px solid var(--glass-border); border-radius: var(--radius-control); background: transparent; cursor: pointer; }
.skin-color input[type="text"] { width: 100%; text-align: center; font-size: var(--fs-xs); }
```

color picker 高度 24px → 40px（更好点）。

### 9.3 折叠组样式

```css
.skin-edit-fs details { border-top: 1px solid rgba(255,255,255,0.08); padding: var(--space-2) 0; }
.skin-edit-fs summary { font-size: var(--fs-sm); font-weight: 600; color: var(--text-primary); cursor: pointer; padding: var(--space-1) 0; }
.skin-edit-fs summary:hover { color: var(--accent); }
details > *:not(summary) { margin-top: var(--space-2); }
```

### 9.4 工具栏按钮分级

应用=primary 蓝，移除/删除=danger 红 hover，新建/复制=普通白。给 index.html（实际是 skin-view.js buildStructure 生成的）对应 `data-skin-act` 按钮加 class。

### 9.5 预设只读徽章

现在底部 muted 小字，改顶部 inline 徽章 `[预设只读]` 紧贴 legend。

### 9.6 测试影响

- `skin-view.js` 的渲染输出变了，但**没有专门的 skin-view 单测**（现有测试覆盖的是 `lib/skin.js` 纯函数：COLOR_KEYS/DECORATION_EMOJI_POSITIONS/isValidHex 等，不碰渲染 HTML）。
- skin 编辑器的折叠/收集逻辑靠**真机验证**（教训 12/13：前端 DOM + 表单收集是单测盲区）。
- 真机清单：折叠展开正常、颜色改完收集正确、emoji 增删正常、保存后主题生效、预设只读不可编辑。

---

## 10. SVG 图标系统

### 10.1 新增 `control/lib/icons.js`

Lucide 风格内联 SVG 字符串常量。24×24 viewBox，`stroke-width:1.5`，`stroke:currentColor`，`fill:none`。dual export（CommonJS + `window.__ccIcons`），对齐其他 lib。

```js
var ICONS = {
  volume: '<svg ...>...</svg>',        // 有声
  volumeX: '<svg ...>...</svg>',       // 静音
  check: '<svg ...>...</svg>',         // 依赖 ✓
  x: '<svg ...>...</svg>',             // 依赖 ✗ / 删除
  image: '<svg ...>...</svg>',         // 注入图片
  video: '<svg ...>...</svg>',         // 注入视频
  refresh: '<svg ...>...</svg>',       // 重新缩图/轮播
  externalLink: '<svg ...>...</svg>',  // 打开阅读器
  trash: '<svg ...>...</svg>'          // 移除/删除
};
if (typeof module !== "undefined" && module.exports) module.exports = ICONS;
if (typeof window !== "undefined") window.__ccIcons = ICONS;
```

index.html `<script src="lib/icons.js">` 在 control.js 之前加载。

### 10.2 替换点

| 位置 | 现在 | 改版 |
|---|---|---|
| 静音按钮 | `🔇 静音` | `ICONS.volumeX + 静音` |
| 取消静音 | `🔊 取消静音` | `ICONS.volume + 取消静音` |
| 状态栏有声/静音（status-view.js） | `🔊 有声`/`🔇 静音` | `ICONS.volume 有声`/`ICONS.volumeX 静音` |
| 依赖（status-view.js） | `✓`/`✗` | `ICONS.check`/`ICONS.x` |
| 打开阅读器链接 | `打开阅读器 →` | `打开阅读器 ICONS.externalLink` |
| 移除壁纸/删除按钮（可选） | `移除壁纸`/`✕` | 文字保留，`✕` 可保留或换 `ICONS.x` |

**skin 角标的用户 emoji 不动**（用户内容，`♡` 等是用户自选）。

### 10.3 SVG 尺寸

`.icon { width: 14px; height: 14px; vertical-align: middle; display: inline-block; }`（行内 14px，和文字基线对齐）。

### 10.4 测试

icons.js 是纯常量模块，可加最小化单测（断言每个 key 是非空字符串且含 `<svg`）。可选，YAGNI 倾向不加（和 shelf.js localStorage 函数不测同范式——纯数据）。

---

## 11. 全局交互反馈

### 11.1 统一 transition

所有 hover/active/切换 `transition: 200ms ease`（150-300ms 区间）。

### 11.2 按下反馈

`button:active { transform: scale(0.97) }`。

### 11.3 焦点环（a11y 红线）

```css
button:focus-visible, input:focus-visible, select:focus-visible, .tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

不用 `outline:none`。

### 11.4 toast 自动消失

- `setJobMsg`：显示 `.show`，成功 `.ok` 绿、失败 `.err` 红、执行中蓝。成功/失败 2.5 秒后移除 `.show`（fade out）。执行中不消失直到完成。
- `setBmMsg`：现有 2 秒硬切，统一改 fade out。

### 11.5 prefers-reduced-motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
  }
  button:active { transform: none; }
}
```

---

## 12. 工程约束（改前必读）

1. **A1 红线**：`html, body { background: transparent !important }` 保留。只改面板/控件样式。
2. **数据属性不动**：`data-action`/`data-tab`/`data-field`/`data-ck`/`data-ov-*`/`data-emoji-*`/`data-open`/`data-go`/`data-del`/`data-add`/`data-skin-act` 等全部保留。事件委托和 collectEditor 靠它们。
3. **lib 渲染函数签名不动**：`renderStatus(st)`/`renderSkinPanel()`/`renderShelf()`/`renderBookmarks()` 入参不变。
4. **localStorage key**：`zcode-reader:shelf`/`zcode-control:bookmarks`/皮肤 keys 不动。新增 `zcode-control:tab`。
5. **不引框架**：纯原生 JS + CSS，IIFE + 字符串拼 HTML。不引 Tailwind/React/Vue。
6. **文件编码**：改 `control/*.js`/`control/*.css`/`control/*.html`。这些无中文 BOM 问题（JS/CSS 走 UTF-8），LF/CRLF 都行。`.bat`/`.ps1` 本次不碰。
7. **测试必须全绿**：`npm test` 28 个文件。重点 statusviewtest（更新断言）。controlservertest 的 go.html `Content-Type: text/html` 断言不动。

---

## 13. 测试与验证

### 13.1 单测更新

- **`statusviewtest.cjs`**：`renderStatus` 输出结构变了，更新断言匹配新 class（`.status-row`/`.status-label`/`.status-value.ok` 等）。覆盖：正常运行、端口未开（warn-row）、壁纸模式 video/image、轮播 running/stale、资源缺失。
- 其余测试（controlservertest/shelftest/bookmarktest/menutest/webviewblankfixtest/skin 相关）**检查是否触及**，预期不破。

### 13.2 真机验证清单（教训 12/13/27：前端 + server↔浏览器契约是单测盲区）

在 webview（ZCode 浏览器面板）里实跑，逐项确认：

**结构层**：
- [ ] 4 个 Tab 显示，切换正常，刷新后保持上次 Tab。
- [ ] 每个 Tab 内容正确（总览=状态 / 壁纸=动作 / 阅读=书架+书签 / 皮肤=编辑器）。

**总览 Tab**：
- [ ] 6 行状态行项排版正确（左标题右状态）。
- [ ] 运行中绿点显示、端口未开黄底高亮、依赖缺失红底高亮。

**壁纸 Tab**：
- [ ] 4 个分组卡片显示，嵌套玻璃层次可见。
- [ ] 主按钮（注入图片/视频/开始轮播）蓝填色，破坏性按钮 hover 红。
- [ ] 按钮 disabled 态正确（端口未开时注入按钮禁用）。
- [ ] job-msg toast：执行中蓝、成功绿、失败红、2.5 秒淡出。
- [ ] 透明度输入 + 设透明生效。

**阅读 Tab**：
- [ ] 书架 + 书签在一个面板内，分区标题正确。
- [ ] 书项/书签项卡片化 + hover 高亮。
- [ ] 点书项跳 reader、✕ 删除、+ 加入正常。
- [ ] 书签添加 + 点跳 go.html + ✕ 删除正常。
- [ ] stale 书红条显示。
- [ ] bm-port-warn 在端口未开时显示。

**皮肤 Tab**：
- [ ] 主题选择/应用/新建/复制/删除正常。
- [ ] 编辑器 4 个折叠组：基本/颜色默认展开，角标闪光默认折叠，叠加沿用。
- [ ] 颜色卡片化 + picker 40px 好点。
- [ ] 改颜色/字体/圆角/闪光/角标/叠加 → 保存 → collectEditor 收集正确 → 应用生效。
- [ ] 预设只读徽章 + 不可编辑。

**视觉层**：
- [ ] 在亮壁纸（天空/雪景）上文字清晰（alpha 0.55 + blur 24 验证）。
- [ ] 在暗壁纸上对比度正常。
- [ ] SVG 图标显示正确（音量/勾叉/外链等），尺寸 14px 对齐文字。
- [ ] 玻璃面板投影 + 顶部高光可见。
- [ ] prefers-reduced-motion 下动画关闭。

**回归**：
- [ ] 壁纸透出正常（A1 红线未被破坏）。
- [ ] 控制中心在普通浏览器打开降级正常（无壁纸但控件可用）。

---

## 14. 已知遗留与边界

- **侧边栏硬画背景**：ZCode 框架硬画的深色侧栏 CSS 改不动（教训 2），不影响控制中心（控制中心在 webview 独立渲染进程）。
- **webview 加载首次延迟**：控制中心首次加载在 webview 内，皮肤/状态 poll 2 秒一次，首次内容可能短暂空白。
- **Tab 不持久化到 URL**：Tab 存 localStorage 不存 URL query（YAGNI，控制中心无深链需求，reader 的 `?book=` 深链不影响）。
- **emoji 在 SVG 替换后跨平台一致**：UI 图标统一了，但用户 skin 角标 emoji 仍跨平台渲染不同（用户内容，无法控制）。
- **普通浏览器打开**：降级体验（无壁纸透出，玻璃面板直接叠在浏览器白底上仍可用）。不做检测（YAGNI）。

---

## 15. 实施顺序（writing-plans 阶段细化）

建议分阶段（每阶段可独立验证）：

1. **Token + 玻璃面板基础**：写 `:root` 变量 + 改 `.panel` 样式。先让面板质感到位。
2. **按钮/输入/控件统一样式**。
3. **Tab 结构 + 切换逻辑**：index.html 包装 + control.js Tab 逻辑。
4. **总览 Tab 状态行项**：status-view.js 重写 + statusviewtest 更新。
5. **壁纸 Tab 分组卡片**：index.html 分组 + job-msg toast。
6. **阅读 Tab 书架书签**：renderShelf/renderBookmarks 输出 + CSS。
7. **皮肤 Tab 编辑器折叠组**：skin-view.js renderEditor 重组。
8. **SVG 图标系统**：icons.js + 各处替换。
9. **全局交互反馈 + a11y + reduced-motion**。
10. **真机验证清单逐项**。
11. **全量 `npm test` 绿**。
