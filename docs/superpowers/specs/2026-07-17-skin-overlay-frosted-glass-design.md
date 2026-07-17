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

## 3. 底色来源机制（核心技术，2026-07-17 spike 后修订）

### 3.1 问题

rgba 公式 `rgba(R,G,B,α)` 必须有 RGB 值。删了用户颜色字段后，RGB 从哪来？

**答**：跟随 ZCode 主题色。ZCode 的 `--color-background` 等变量按主题（深色/浅色）不同。皮肤系统读取这些
变量的当前值，作为半透层的底色。

### 3.2 ~~原方案：备份原主题色到自定义变量~~（spike 失败，2026-07-17）

原方案是：在 wallpaper.css 顶部用 `--zcode-wp-orig-bg: var(--color-background)` 备份原主题色，
靠 CSS 自定义属性「求值即写入」保住快照。

**Spike 真机结果**：机制**不成立**。CSS 自定义属性是**按引用延迟解析**——读 `--zcode-wp-orig-bg` 时才
去解析 `var(--color-background)`，那时它已被 `transparent !important` 覆盖。备份变量读出来也是
`transparent`。原推断「求值即写入快照」错误。

> **教训**（AGENTS.md 教训 21）：CSS 级联机制是假设，只有 `getComputedStyle` 读到的真实值才是事实。
> 这次靠 spike 脚本（`scripts/inspect-skin2.cjs` 加 backupProbe）一跑就发现假设错误，避免了基于错误
> 假设写出整条实现链。

### 3.3 新方案：CSS `color-mix()` + 原生底层变量（spike 验证有效）

Spike 顺带挖出两条关键事实：

1. **ZCode 底层主题变量未被 wallpaper.css 覆盖**：
   - `--color-input` = `#2b2b2b`（hex，直接可用）
   - `--color-brand` = `#d4a017`（hex，直接可用）
   - `--color-foreground` = `#e8dcc8`（hex）
   - `--color-neutral-900` = `oklch(20.5% 0 0)`（深色主题底层灰）
   - `--color-neutral-950` = `oklch(14.5% 0 0)`（更深）
   - `--color-neutral-50` = `oklch(98.5% 0 0)`（浅色主题底层白）
   - 只有 `--color-background` 系列被 wallpaper.css 强制 transparent，**底层 neutral 完整保留**。

2. **CSS `color-mix()` 在 ZCode Chromium 上完美工作**（Chrome 146 / Electron 41，远超要求的 111+）：
   ```
   color-mix(in srgb, var(--color-neutral-900) 70%, transparent)
     → color(srgb 0.09 0.09 0.09 / 0.7)   ✓ 解析成半透明
   color-mix(in srgb, oklch(20.5% 0 0) 70%, transparent)
     → color(srgb 0.09 0.09 0.09 / 0.7)   ✓ oklch 也能 mix
   color-mix(in srgb, var(--color-brand) 70%, transparent)
     → color(srgb 0.83 0.62 0.09 / 0.7)   ✓ hex var 也能 mix
   ```

**新机制**：皮肤注入的 `<style>` 直接写 `color-mix(in srgb, var(--底层主题变量) N%, transparent)`，
让 CSS 引擎自己解析。**完全不需要**：
- ❌ 改 wallpaper.css 加备份声明
- ❌ JS 运行时读 computed value 转 RGB 元组
- ❌ Node 侧拼 rgba 字符串

只需在注入的 `<style>` 写：
```css
main, [role='main'] {
  background-color: color-mix(in srgb, var(--color-neutral-900) 70%, transparent) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
}
```

CSS 引擎在浏览器里实时解析 `var()`，ZCode 切主题时 `--color-neutral-900` 变化（深色↔浅色不同值），
磨砂层底色**真跟随主题**。

### 3.4 三区域 → 原生底层变量映射

| 区域 | overlay 字段前缀 | 用的原生变量 | spike 真机值 |
| --- | --- | --- | --- |
| 面板 | `panel*` | `--color-neutral-900` | `oklch(20.5% 0 0)` |
| 输入框 | `input*` | `--color-input` | `#2b2b2b`（hex） |
| 侧栏 | `sidebar*` | `--color-neutral-950` | `oklch(14.5% 0 0)`（侧栏更深，与面板区分） |
| sparkle 辉光 | （非 overlay） | `--color-brand` | `#d4a017`（hex） |

注意：侧栏用 `--color-neutral-950` 而不是 `--color-background-alt`，因为后者被 wallpaper.css 覆盖了，
而 neutral-950 没被覆盖，且更深一层（与面板 900 区分层次）。这是 spike 真机数据支持的选择，不是猜。

### 3.5 （已废弃）原回退方案

~~硬编码映射表~~：不再需要。新方案 §3.3 真机已验有效，且天然跟随主题（比硬编码好）。

**ZCode 升级风险**：若 ZCode 未来的主题改了 `--color-neutral-*` / `--color-input` / `--color-brand`
这些变量名（或换色彩系统），color-mix 会失效（var() 解析失败 → 元素无背景色）。这是可接受的脆弱性，
比硬编码映射表强（硬编码连主题色本身都跟不上）。spec §10 已记录此风险，提示实施者写探测脚本时把
这些变量名当 SPI（真机接口）对待，ZCode 升级要重跑探测。

## 4. CSS 注入规则（`renderSkinCss` 重写）

### 4.1 当前实现（`lib/skin-inject.cjs:33-69`）

注入 `rgba(用户色, 透明度) !important` 到元素选择器。

### 4.2 新规则（color-mix 方案）

注入「半透明 + 模糊」到元素选择器，**底色用 `color-mix(in srgb, var(--原生底层变量) N%, transparent)`**：

```js
// 伪代码
if (ov.enabled) {
  rules.push(`main, [role='main'] {
    background-color: color-mix(in srgb, var(--color-neutral-900) ${ov.panelOpacity}%, transparent) !important;
    backdrop-filter: blur(${ov.panelBlur}px) !important;
    -webkit-backdrop-filter: blur(${ov.panelBlur}px) !important;
  }`);
  // 输入框用 var(--color-input)，侧栏用 var(--color-neutral-950)，见 §3.4
}
```

**核心优势**：
- **零 JS 转换**——不需要 Runtime.evaluate 读 computed value，直接拼字符串注入 `<style>`。CSS 引擎
  在浏览器里自己解析 `var() + color-mix()`。
- **真跟随主题**——ZCode 切主题时，`--color-neutral-900` 的值会变（深色/浅色不同），磨砂层底色自动变。
- **不动 wallpaper.css**——新方案完全不碰 wallpaper.css（§6 整章废弃）。

### 4.3 实现简化（相比原方案）

原方案需要：`Runtime.evaluate 读备份变量 → parseBackupVarsResult → Node 拼字符串 → 二次 evaluate`。
新方案只需：`Node 拼字符串（直接写 color-mix）→ 单次 evaluate`。`buildSkinExpression` 回到**单步注入**，
不需要 `readBackupVarsExpression` / `parseBackupVarsResult` 这些胶水代码。注入更简单、更快、更脆点更少。

### 4.4 sparkle 辉光色

`skin-inject.cjs:197` 当前：
```js
var accentAlt = (theme.colors && theme.colors.accentAlt) || "#b45cff";
```

**改为**：直接在 CSS 里写 `var(--color-brand)`（spike 验过 hex 值，不需 color-mix——sparkle 辉光是完全
不透明的 box-shadow）。硬编码兜底 `#b45cff` 保留（防 ZCode 升级改了变量名）。具体在 `renderSkinChromeCss`
里：`box-shadow: 0 0 8px 2px var(--color-brand, #b45cff)`。CSS 引擎取不到 var 时自动用 fallback。

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

## 6. ~~wallpaper.css 连锁修改~~（2026-07-17 spike 后废弃）

**原方案**（已废弃）：在 wallpaper.css 顶部加备份声明 `--zcode-wp-orig-bg: var(--color-background)`。

**新方案**（§3.3 color-mix）：**wallpaper.css 完全不改**。

spike 失败证明备份机制不成立（CSS 自定义属性按引用延迟解析）。新方案绕开这个坑——直接在注入的
`<style>` 里用 `color-mix(in srgb, var(--color-neutral-900) N%, transparent)` 读原生底层变量
（`--color-neutral-*`、`--color-input`、`--color-brand` 都没被 wallpaper.css 覆盖），完全不需要改
wallpaper.css。这是新方案的最大优势之一：少改一个文件、少一个组件边界、少一份漂移风险。

### 6.1 overlay 未启用时的行为

overlay 关闭时，壁纸满强度透出（与当前一致），向后兼容。overlay 启用时由皮肤系统注入的磨砂层接管。

### 6.2 与视频壁纸的兼容

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

### 8.1 ~~备份变量 spike~~（已完成，2026-07-17）

原 spike 验证 CSS 自定义属性备份机制 → **失败**（详见 §3.2）。但 spike 顺带挖出新方案所需的真机数据：
- 原生底层变量未被覆盖（`--color-neutral-*`、`--color-input`、`--color-brand` 都有真色值）
- `color-mix(in srgb, var(--x) N%, transparent)` 在 ZCode Chromium 完美工作（§3.3 已验）

**新方案实施前不必再 spike**——color-mix 方案的核心机制已真机验过。后续 task 直接基于 §3.4 的变量映射实现。

### 8.2 单测改动

- `test/skintest.cjs`：重写覆盖新 `makeOverlay`/`makeSkinTheme` 字段集（删 colors、加 blur）
- 新增 `buildFrostRule(region, opacity, blur)` 纯函数测试（输入区域名 + 两个值，输出 CSS 规则字符串，
  断言含 `color-mix`、`var(--color-...)`、`backdrop-filter:blur`）
- 新增底层变量名 + 区域选择器常量镜像测试（防 `skin-selectors.cjs` 和 `skin-inject.cjs` 漂移，教训 17 同型）
- 删除：所有针对 `COLOR_KEYS` / 旧 colors 字段的断言

### 8.3 真机验证清单（CSS 层是单测盲区，教训 12/21）

1. **~~备份变量机制~~**（§8.1，已完成，废弃）
2. **overlay 启用时**：面板/输入框/侧栏呈磨砂玻璃，壁纸从后面透出且被模糊
3. **overlay 关闭时**：完全透明（壁纸满强度透出），与当前行为一致
4. **拖滑块实时生效**：透明度 0→100、模糊度 0→30 视觉连续变化
5. **切主题时**：磨砂层底色自动跟随（深色主题深灰磨砂、浅色主题白磨砂）—— **这是新方案的核心卖点**，
   必须验
6. **sparkle 辉光**：跟随主题 accent（`var(--color-brand)`），不再固定紫色
7. **装饰层不受影响**：sparkle 闪烁、emoji 角标位置正常
8. **视频壁纸叠加**：overlay 在视频壁纸上也正常（§6.2）
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
3. **`color-mix` / `backdrop-filter` 的 Chromium 版本依赖**：要求 Chromium 111+（color-mix）和
   Chromium 76+（backdrop-filter）。ZCode 当前是 Chrome 146（Electron 41），远超要求。若未来 ZCode
   降级到旧 Chromium（不太可能），这两个功能会失效。
4. **ZCode 主题变量名假设**：本设计依赖 ZCode 暴露 `--color-neutral-900` / `--color-neutral-950` /
   `--color-input` / `--color-brand` 这 4 个变量名（spike 2026-07-17 真机验过它们存在且有值）。
   若 ZCode 升级改名，`var()` 解析失败 → 元素无背景色。这是 SPI（真机接口），升级 ZCode 要重跑
   `scripts/inspect-skin2.cjs` 复验。`var(..., fallback)` 语法可加 hex 兜底防崩溃，但兜底色不会跟随
   主题。
5. **`font` / `radius` 字段保留**：这两个字段在 `skin-view.js` 的「基本信息」`<details>` 区块里
   （line 132-136，`data-field` 属性），与「颜色 (9)」`<details>`（COLOR_KEYS 主色面板，line 137-145）
   是平级兄弟节点。删主色面板不会连带删它们。本次保留不动，live-preview 的 `data-field` 触发分支
   （line 455-456）也照常工作。
6. **color-mix 输出格式**：spike 显示 ZCode Chromium 输出 `color(srgb R G B / A)` 而不是 `rgba(R,G,B,A)`。
   两种格式都是合法 CSS 颜色，浏览器都接受，但若有其他 CSS 工具/规则按 `rgba(...)` 字面匹配会读不到。
   本设计内用——磨砂层背景由我们自己注入的 `<style>` 控制，无外部匹配，无影响。

## 11. 实施顺序（给 writing-plans 的提示，2026-07-17 spike 后修订）

1. ~~Spike~~（已完成，§8.1）：备份变量机制失败，新方案是 color-mix（已验）。
2. ~~wallpaper.css 改动~~（已废弃，§6）：新方案不改 wallpaper.css。
3. **后端模型层**（§7.3）：`skin.cjs` 字段集更新 + `skin-inject.cjs` 重写 `renderSkinCss`（用 color-mix）+
   `skin-selectors.cjs` 加原生变量名映射。
4. **前端 UI**（§5）：删主色面板、改 overlay 双滑块、改默认主题。
5. **测试**（§8.2）：单测改写 + 新增。
6. **真机验证**（§8.3）：逐项跑清单（重点是 §8.3-5「切主题时跟随」）。
7. **回归**（§8.4）：`npm test` 全绿。

## 12. 不做的事（YAGNI）

- **不做**「磨砂预设」（轻烟/磨砂/强霜等一键切换）——用户已选「删全部颜色预设」，保持极简
- **不做** color-mix 解法（§4.3 已选 JS 读 computed value，更稳）
- **不做** 单独迁移脚本（§2.5 归一化兜底）
- **不做** backdrop-filter 性能优化（§10.2 记录遗留）
- **不做** `font` / `radius` UI 重排（§10.5 保持现状）
