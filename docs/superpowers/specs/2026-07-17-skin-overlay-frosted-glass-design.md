# 皮肤系统重构：从「颜色叠加」到「磨砂玻璃」设计

**日期**：2026-07-17
**重构对象**：[2026-07-16-skin-system-design.md](./2026-07-16-skin-system-design.md) 引入的皮肤系统
**分支**：`feat/skin-frosted-glass`（实施时新建）

## 0. 背景与动机

当前皮肤系统的「壁纸叠加」功能（`theme.overlay`）实现为：给面板/输入框/侧栏各注入一层
`rgba(用户选的颜色, 用户选的透明度) !important`。语义错位——拖「透明度」滑块时感觉是「颜色在变淡」，
而不是「壁纸在透出来」。叠加层实际是「挡壁纸」的，不是「让壁纸透出来」的。

用户原话：**"我不想要在面板、输入框、侧栏上再加一层颜色，我的主体依然是壁纸功能。我在设置了壁纸后，
可以通过调整面板、输入框、侧栏的透明度，或者让他们模糊化，而不是再加一层颜色。"**

**重构定位**：壁纸是主体。皮肤系统职责从「给 UI 涂色」转为「让 UI 面板半透明 + 模糊化，使壁纸从面板
后面透出来」。删除一切「给 UI 加颜色层」的概念。

## 1. 设计决策汇总（用户逐题确认）

| 决策点 | 选择 |
| --- | --- |
| 每区域调节模型 | **透明度 + 模糊度 双滑块**（删除颜色字段） |
| 改动范围 | overlay 改双滑块 + **删整个主色面板**（7 个颜色选择器全删） + 装饰层不动 |
| 半透层底色来源 | **跟随 ZCode 主题色**（用户不选颜色） |
| 底色实现机制 | **备份原主题色到自定义 CSS 变量**（如 `--zcode-wp-orig-bg`） |
| 底色备份粒度 | **三区域各备份一个**（面板/输入框/侧栏分别对应不同主题色变量） |
| overlay 默认状态 | **默认启用**，透明度 70% + 模糊 12px |
| sparkle 辉光色 | 跟随主题 accent（从备份变量 `--zcode-wp-orig-accent` 读） |
| UI 区块标题 | 「壁纸叠加」**改名**为「磨砂玻璃」 |
| 主题预设 | **删全部颜色预设**（只留「默认主题」一个） |
| 装饰层默认状态 | **默认关闭**（sparkle/emoji 新用户首次打开看不到，手动启用） |

## 2. 数据模型变更

### 2.1 新 overlay 字段（删颜色，加模糊）

**旧**（每个区域：颜色 + 透明度）：
```js
{ enabled, panelBg, panelOpacity, inputBg, inputOpacity, sidebarBg, sidebarOpacity }
```

**新**（每个区域：透明度 + 模糊度，**无颜色**）：
```js
{
  enabled: true,                    // 默认启用
  panelOpacity: 70,                 // 0-100，0=壁纸满透、100=不透盖死
  panelBlur: 12,                    // 0-30（px），0=清晰壁纸、30=强磨砂
  inputOpacity: 70,
  inputBlur: 12,
  sidebarOpacity: 70,
  sidebarBlur: 12
}
```

### 2.2 删除字段

`theme.colors` **整个对象删除**（含 `background/panel/accent/accentAlt/text/muted/sidebarBg/inputBg/inputBorder`）。
对应主色面板 UI 整块删除。

### 2.3 保留字段

- `theme.id` / `theme.name` / `theme.isBuiltin`：不变
- `theme.decorations`：原样保留（`sparkle`/`sparkleCount`/`emojiBadges` 等字段不动），但默认值改（见 §2.4）
- `theme.font` / `theme.radius`：保留字段定义，但 UI 编辑器是否暴露**本次不动**（保持现状）

### 2.4 默认值变更

- `theme.decorations.sparkle` 默认：`true` → **`false`**（装饰层默认关）
- `theme.decorations.emojiBadges` 默认：`[]`（保持空）
- `theme.overlay.enabled` 默认：`false` → **`true`**
- `theme.overlay.{panel,input,sidebar}Opacity` 默认：**70**
- `theme.overlay.{panel,input,sidebar}Blur` 默认：**12**

### 2.5 迁移规则（读取旧 localStorage 数据）

`makeTheme` / `makeOverlay` 归一化函数兜底，读到啥缺啥补啥：
- 旧 `theme.colors` 字段：**直接丢弃**（不报错）
- 旧 overlay 里的 `panelBg/inputBg/sidebarBg`：丢弃
- overlay 里缺 `*Blur`：补默认 12
- overlay 里缺 `*Opacity`：补默认 70
- overlay `enabled` 缺：补 true
- decorations 缺：补默认关闭集

**不做单独迁移脚本**——归一化函数天然兜底。

## 3. 底色来源机制（核心技术）

### 3.1 问题

rgba 公式 `rgba(R,G,B,α)` 必须有 RGB 值。删了用户颜色字段后，RGB 从哪来？

**答**：跟随 ZCode 主题色。ZCode 的 `--color-background` 等变量按主题（深色/浅色）不同。皮肤系统读取这些
变量的当前值，作为半透层的底色。

### 3.2 取值路径：备份原主题色到自定义变量

当前 `lib/wallpaper.css:36-48` 把所有 UI 颜色变量强制设 `transparent !important`，所以主题变量读不出值。
方案：在 wallpaper.css **顶部**（transparent 覆盖之前）先备份 ZCode 原主题色到自定义变量：

```css
/* === 主题色备份（必须在 transparent 覆盖之前）=== */
:root {
  --zcode-wp-orig-bg: var(--color-background);           /* 给面板 */
  --zcode-wp-orig-panel: var(--color-background-alt);    /* 给侧栏 */
  --zcode-wp-orig-input: var(--color-input);             /* 给输入框 */
  --zcode-wp-orig-accent: var(--color-brand);            /* 给 sparkle 辉光 */
}

/* === 下面是现有的 transparent 覆盖（不变）=== */
:root {
  --color-background: transparent !important;
  --color-background-alt: transparent !important;
  --color-input: transparent !important;
  /* ... 其他不变 ... */
}
```

### 3.3 为什么有效（CSS 级联机制）

CSS 自定义属性在级联里**求值即写入**。第一段 `--zcode-wp-orig-bg: var(--color-background)` 执行时，
`--color-background` 还是 ZCode 原色（未被覆盖），值被「快照」进 `--zcode-wp-orig-bg`。第二段把
`--color-background` 改成 transparent，但**已经写入的快照不会被回溯修改**。

> ⚠️ **这是 CSS 级联机制的推断，必须真机验**（AGENTS.md 教训 21：「应该能 X」是假设，探测真实 state 是
> 事实）。spec §8.1 把这条列为**实施第一步必须 spike 验证**——若机制不成立，回退方案见 §3.5。

### 3.4 三区域 → 四个备份变量的映射

| 区域 | overlay 字段前缀 | 读取的备份变量 | 对应原 ZCode 变量 |
| --- | --- | --- | --- |
| 面板 | `panel*` | `--zcode-wp-orig-bg` | `--color-background` |
| 输入框 | `input*` | `--zcode-wp-orig-input` | `--color-input` |
| 侧栏 | `sidebar*` | `--zcode-wp-orig-panel` | `--color-background-alt` |
| sparkle 辉光 | （非 overlay） | `--zcode-wp-orig-accent` | `--color-brand` |

这样三区域的磨砂层底色各自跟随主题里对应的色变量，保留视觉层次（深色主题下输入框往往略浅于背景）。

### 3.5 回退方案（若 §3.3 机制不成立）

若真机验发现备份变量也变成 transparent（级联机制与预期不符），回退为**硬编码主题映射表**：
- 深色主题：`rgba(18, 18, 22, α)`
- 浅色主题：`rgba(255, 255, 255, α)`
- accent 默认：`#b45cff`

代价：不是真「跟随」，是「模拟跟随」，ZCode 主题升级后可能偏色。但稳定可控。**回退时需用户重新确认**。

## 4. CSS 注入规则（`renderSkinCss` 重写）

### 4.1 当前实现（`lib/skin-inject.cjs:33-69`）

注入 `rgba(用户色, 透明度) !important` 到元素选择器。

### 4.2 新规则

注入「半透明 + 模糊」到元素选择器，**底色来自运行时读取的备份变量**：

```js
// 伪代码（实际实现见 §4.3）
if (ov.enabled) {
  rules.push(`main, [role='main'] {
    background-color: rgba(${bgRgbTuple}, ${ov.panelOpacity / 100}) !important;
    backdrop-filter: blur(${ov.panelBlur}px) !important;
    -webkit-backdrop-filter: blur(${ov.panelBlur}px) !important;
  }`);
  // inputBg / sidebarBg 同理，分别用 inputRgbTuple / sidebarRgbTuple
}
```

### 4.3 RGB 元组的运行时读取（解法 C：JS 读 computed value）

CSS 没法直接 `rgba(var(--x), 0.7)`（因为变量值是 `#121216` 不是 `18,18,22`）。**不用 `color-mix`**
（虽 Chromium 111+ 支持，但增加 CSS 版本依赖）。**用 JS 运行时读 computed value 拼字符串**：

CDP 注入时 `Runtime.evaluate` 先读 4 个备份变量的 computed value：
```js
(function(){
  var root = getComputedStyle(document.documentElement);
  function toTuple(varName, fallback) {
    var hex = root.getPropertyValue(varName).trim() || fallback;
    // 解析 #RRGGBB 或 rgb() 为 "R, G, B"
    return hexToRgbTuple(hex);
  }
  return JSON.stringify({
    bg: toTuple('--zcode-wp-orig-bg', '#121216'),
    input: toTuple('--zcode-wp-orig-input', '#1a1a20'),
    panel: toTuple('--zcode-wp-orig-panel', '#16161a'),
    accent: toTuple('--zcode-wp-orig-accent', '#b45cff')
  });
})()
```

拿到 JSON 后，在 Node 侧（`skin-inject.cjs`）拼装完整的 `<style>` 字符串，再注入。这样：
- 无 CSS 版本依赖
- 无颜色格式兼容问题
- 注入表达式稍长但清晰

### 4.4 sparkle 辉光色

`skin-inject.cjs:197` 当前：
```js
var accentAlt = (theme.colors && theme.colors.accentAlt) || "#b45cff";
```

**改为**：用 §4.3 读到的 `accent` RGB 元组拼成 `#RRGGBB`（或直接用 hex），硬编码兜底 `#b45cff` 保留（防
备份变量机制失效）。sparkle 辉光自动跟随主题 accent。

### 4.5 选择器（保持不变）

| 区域 | CSS 选择器（`lib/skin-inject.cjs`） |
| --- | --- |
| 面板 | `main, [role='main']` |
| 输入框 | `.chat-composer-region, .bg-input, .focus-within\\:bg-input-focused` |
| 侧栏 | `#sidebar, aside.h-full` |

来源：`scripts/inspect-skin2.cjs` 真机探测（2026-07-16，ZCode 3.3.6）。**不动**。

### 4.6 已知遗留：侧栏硬画背景

AGENTS.md「核心教训 2」记录：侧边栏有一块实色深色背景是 ZCode 框架硬画的，不走任何变量/Tailwind 类，
**CSS 改不动**。新设计的侧栏磨砂玻璃**只能作用于 `#sidebar, aside.h-full` 命中范围**，那块硬画背景仍是
新坑（与现状一致，不恶化）。spec 必须记录，避免实施者误以为「侧栏磨砂已搞定」。

## 5. 前端 UI 重构（`control/lib/skin-view.js`）

### 5.1 删除的 UI

- 主色面板整块（所有 `data-ck` / `data-ck-text` 颜色选择器、COLOR_KEYS 相关字段渲染）
- 主题预设里的颜色组合部分（见 §5.4）
- overlay 里的颜色选择器（`data-ov-ck-text` / `data-ov-ck`）

### 5.2 新 overlay 区结构（双滑块）

| 调节项 | data 属性 | UI 控件 | 范围 |
| --- | --- | --- | --- |
| 启用磨砂玻璃 | `data-ov-field="enabled"` | checkbox | - |
| 面板透明度 | `data-ov-op="panelOpacity"` | range | 0-100 |
| 面板模糊度 | `data-ov-blur="panelBlur"` | range | 0-30 |
| 输入框透明度 | `data-ov-op="inputOpacity"` | range | 0-100 |
| 输入框模糊度 | `data-ov-blur="inputBlur"` | range | 0-30 |
| 侧栏透明度 | `data-ov-op="sidebarOpacity"` | range | 0-100 |
| 侧栏模糊度 | `data-ov-blur="sidebarBlur"` | range | 0-30 |

区块标题「壁纸叠加」**改名**为「磨砂玻璃」。

### 5.3 新 skin 面板整体布局

```
┌─ 主题选择 ─────────────────────────────┐
│  [下拉: 默认主题]  [新建] [复制] [删除]  │
│  [应用] [移除]                          │
│  （删除按钮对 builtin 主题禁用，对用户  │
│   自建主题可用）                        │
├─ 磨砂玻璃 ─────────────────────────────┤
│  ☑ 启用磨砂玻璃                         │
│                                          │
│  面板                                    │
│    透明度  ████████░░░░  70%            │
│    模糊度  ███████░░░░░  12px           │
│                                          │
│  输入框                                  │
│    透明度  ████████░░░░  70%            │
│    模糊度  ███████░░░░░  12px           │
│                                          │
│  侧栏                                    │
│    透明度  ████████░░░░  70%            │
│    模糊度  ███████░░░░░  12px           │
├─ 装饰层 ──────────────────────────────┤
│  ☐ sparkle 粒子    数量 [12]            │
│  emoji 角标 [...]  位置 [下拉]           │
└────────────────────────────────────────┘
```

### 5.4 主题预设处理

**删除全部颜色预设**（`skin-pink-builtin` / `skin-darkgold-builtin` / `skin-sepia-builtin` 三个内置主题）。
新 localStorage 首次注入时只建**一个**「默认主题」（`skin-default-builtin`）：
- overlay：默认值（enabled:true, 70%, 12px）
- decorations：默认值（sparkle:false, emojiBadges:[]）

`ensureBuiltinPresets` 改为只注入这一个。用户可「复制」后只调 overlay/装饰层。

### 5.5 实时预览

保留当前逻辑（`skin-view.js:452-485`）：拖滑块/改 checkbox 250ms 防抖后 `POST /api/action applySkin`。
新增 `data-ov-blur` 滑块也走同一逻辑。

### 5.6 轮询刷新

保留 `control.js` 每 2s 调 `renderSkinPanel()` + `listSignature()` diff（避免重建 DOM 清用户输入）。签名
函数要加上新字段（blur 值）。

## 6. `wallpaper.css` 连锁修改

### 6.1 改动

1. 文件**最顶部**加 4 行备份声明（§3.2）。
2. **保留**所有 transparent 覆盖不变。

### 6.2 overlay 未启用时的行为

overlay 关闭时，壁纸满强度透出（与当前一致），向后兼容。overlay 启用时由皮肤系统注入的磨砂层接管。

### 6.3 与视频壁纸的兼容

视频壁纸层在 body，磨砂层在面板（`backdrop-filter` 模糊面板后面的内容，包括视频）。机制相同，无需特殊
处理。spec §8.4 列为真机验证项。

## 7. 后端 / 状态查询

### 7.1 `lib/control-server.cjs`

`applySkin` / `removeSkin` action 处理逻辑不变（line 297-336）。`validateTheme` 要更新——去掉 `colors`
字段的校验，加上 `overlay.*Blur` 字段的 0-30 clamp。

### 7.2 `lib/status.cjs` / `lib/cdp.cjs`

`probeSkinMode`（`cdp.cjs:81-94`）读 `#zcode-user-skin` 的存在与 `data-theme-name`。**不动**——皮肤是否
应用只看 `<style>` 元素在不在，和内部字段结构无关。`status.skin = {applied, themeName}` 不变。

### 7.3 `lib/skin.cjs` / `lib/skin-inject.cjs`

- `skin.cjs`：删 `COLOR_KEYS`、`hexToRgba`（或保留但不引用）、预设主题定义；`makeTheme`/`makeOverlay`
  字段集更新；新增 `BLUR_RANGE = { min: 0, max: 30 }`、`OPACITY_RANGE = { min: 0, max: 100 }` 常量
- `skin-inject.cjs`：重写 `renderSkinCss`（§4），`renderSkinChromeCss` 改 sparkle 辉光色来源（§4.4），
  注入表达式加「读备份变量」步骤（§4.3）

## 8. 测试策略与真机验证清单

### 8.1 实施 spike（第一步，必跑）

**验证 CSS 自定义属性备份机制是否成立**：

```bash
# 改一版 scripts/inspect-skin2.cjs（或临时脚本）
# 注入含备份声明的 wallpaper.css → 读 computed value
node -e "
const cdp = require('./lib/cdp.cjs');
// 连 page target → Runtime.evaluate:
//   getComputedStyle(document.documentElement).getPropertyValue('--zcode-wp-orig-bg')
// 期望: 真主题色（如 'rgb(18, 18, 22)' 或 '#121216'），不是 'transparent'
"
```

**失败处理**：若读到 transparent，回退 §3.5（硬编码映射表），需重新与用户确认。

### 8.2 单测改动

- `test/skintest.cjs`（若存在）或对应测试文件：重写覆盖新 `makeOverlay`/`makeTheme` 字段集
- 新增 `buildBlurRule(region, opacity, blur)` 纯函数测试（输入区域名 + 两个值，输出 CSS 规则字符串）
- 新增备份变量名常量镜像测试（防 `wallpaper.css` 和 `skin-inject.cjs` 漂移，教训 17 同型）
- 删除：所有针对 `COLOR_KEYS` / `hexToRgba` / 旧 colors 字段的断言

### 8.3 真机验证清单（CSS 层是单测盲区，教训 12/21）

1. **备份变量机制**（§8.1）—— spike 第一步
2. **overlay 启用时**：面板/输入框/侧栏呈磨砂玻璃，壁纸从后面透出且被模糊
3. **overlay 关闭时**：完全透明（壁纸满强度透出），与当前行为一致
4. **拖滑块实时生效**：透明度 0→100、模糊度 0→30 视觉连续变化
5. **切主题时**：磨砂层底色自动跟随（深色主题深灰磨砂、浅色主题白磨砂）
6. **sparkle 辉光**：跟随主题 accent，不再固定紫色
7. **装饰层不受影响**：sparkle 闪烁、emoji 角标位置正常
8. **视频壁纸叠加**：overlay 在视频壁纸上也正常（§6.3）
9. **新用户首次打开**：只看到磨砂玻璃效果（overlay 默认开、装饰层默认关），画面干净
10. **旧 localStorage 数据兼容**：之前存过带 colors 的主题，读取时不报错、字段自动归一化

### 8.4 回归

`npm test` 全套保持绿（含 selftest/cdp-mock-test/skintest/controlservertest/statusviewtest 等）。

## 9. 对其他子系统的影响

| 子系统 | 影响 |
| --- | --- |
| 壁纸注入（inject.cjs） | 零影响（不碰皮肤） |
| 视频壁纸 / 视频 mute | 零影响（壁纸层独立） |
| 窗口透明（transparent.ps1） | 零影响（不同层） |
| 阅读器 / epub | 零影响（webview 独立渲染进程） |
| 书签管理 / blankfix | 零影响（不读 colors 字段） |
| 控制中心后端 status/action | 仅 `validateTheme` 字段集更新 |

## 10. 已知遗留与边界

1. **侧栏硬画背景**（§4.6）：ZCode 框架硬画的侧栏实色背景不改任何 CSS 变量，磨砂玻璃只作用于
   `#sidebar, aside.h-full` 命中范围。与现状一致，不恶化。
2. **`backdrop-filter` 性能**：模糊是大开销 GPU 操作。低端机 / 大屏 + 高 blur 值可能掉帧。本次不优化，
   用户可自主调低 blur。记录为已知遗留。
3. **备份变量机制依赖 CSS 级联求值时机**（§3.3）：理论成立但需真机验。失败回退见 §3.5。
4. **主题色变量名假设**：本设计假设 ZCode 用 `--color-background` / `--color-background-alt` /
   `--color-input` / `--color-brand` 这 4 个变量名（来源 `lib/skin-selectors.cjs:15-37`）。
   若 ZCode 升级后改名，备份会失效（读到空 → 走 fallback hex）。**spec §8.1 spike 同时验变量名是否
   还有值**。
5. **`font` / `radius` 字段保留**：这两个字段在 `skin-view.js` 的「基本信息」`<details>` 区块里
   （line 132-136，`data-field` 属性），与「颜色 (9)」`<details>`（COLOR_KEYS 主色面板，line 137-145）
   是平级兄弟节点。删主色面板不会连带删它们。本次保留不动，live-preview 的 `data-field` 触发分支
   （line 455-456）也照常工作。

## 11. 实施顺序（给 writing-plans 的提示）

1. **Spike**（§8.1）：先验备份变量机制。失败则停下来与用户确认回退方案。
2. **wallpaper.css 改动**（§6）：加备份声明。
3. **后端模型层**（§7.3）：`skin.cjs` 字段集更新 + `skin-inject.cjs` 重写 `renderSkinCss`。
4. **前端 UI**（§5）：删主色面板、改 overlay 双滑块、改默认主题。
5. **测试**（§8.2）：单测改写 + 新增。
6. **真机验证**（§8.3）：逐项跑清单。
7. **回归**（§8.4）：`npm test` 全绿。

## 12. 不做的事（YAGNI）

- **不做**「磨砂预设」（轻烟/磨砂/强霜等一键切换）——用户已选「删全部颜色预设」，保持极简
- **不做** color-mix 解法（§4.3 已选 JS 读 computed value，更稳）
- **不做** 单独迁移脚本（§2.5 归一化兜底）
- **不做** backdrop-filter 性能优化（§10.2 记录遗留）
- **不做** `font` / `radius` UI 重排（§10.5 保持现状）
