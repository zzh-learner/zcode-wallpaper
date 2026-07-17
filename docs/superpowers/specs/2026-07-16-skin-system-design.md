# 皮肤系统（Skin System）设计

**日期**：2026-07-16
**参考**：[Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的 windows/ 实现（配色/装饰 DOM/主题定制）
**分支**：`feat/skin-system`

## 1. 目标与范围

给 ZCode 增加**第 10 种能力**：一套独立的「皮肤/主题」子系统，抄 Codex-Dream-Skin 的三项视觉能力：

1. **改 UI 配色**（侧边栏 / 输入框 / 按钮 / 卡片 / 字体 / 圆角）
2. **注入装饰 DOM**（闪光粒子 / Emoji 角标 / 品牌文字）
3. **主题定制系统**（带 GUI 编辑器，用户自建/编辑主题）

**显式不做**（用户决策）：
- **不重排原生页面布局** —— 不像 Dream Skin 那样重排首页 hero 区。只通过 CSS 上色 + 注入装饰层，ZCode 原生布局完全保留。理由：重排依赖 ZCode 首页具体 DOM 结构，ZCode 一更新就可能坏，且每个主题都要针对首页写 CSS，脆且收益低。
- **不支持主题带图片资产** —— 纯 CSS 主题（颜色/字体/圆角/装饰 DOM），没有 polaroid 相框那种图片。理由：多一层图片管理（存图/server 端点），YAGNI。

## 2. 与现有子系统的关系

**独立子系统，与壁纸互斥**（用户决策）：

- 皮肤和壁纸（图片/视频/透明）**不能同时应用**。原因：现有透明壁纸把 UI 背景变量强制 `transparent !important` 让壁纸透出，这会覆盖皮肤设的 UI 配色——两者在同一层冲突。
- **互斥行为**（用户决策：自动移除冲突方）：应用皮肤时若壁纸还开着，server 自动先 `spawn inject.cjs --remove` 清壁纸再注皮肤；反之 `injectImage/injectVideo` action 前自动清皮肤。用户不需要手动移除。
- 透明窗口模式（Win32 层）**不互斥**——透明改的是窗口 alpha 不碰 CDP/DOM，皮肤可叠加（半透明窗口 + 里面的 UI 配色）。

**注入位置（不串扰）**：
- 壁纸：`#zcode-user-wallpaper`（style）+ `#zcode-user-wallpaper-video`（video）
- 皮肤：`#zcode-user-skin`（style）+ `#zcode-user-skin-chrome`（装饰 div）
- 两套 id 完全不同，各自的 `--remove` 只清自己。

## 3. 模块 A：数据模型与主题格式

### 3.1 存储

localStorage key `zcode-control:skins`（对齐 `zcode-control:bookmarks` / `zcode-reader:shelf` 范式）。值结构：
```js
{
  activeId: "skin_xxx" | null,        // 当前激活主题 id（null = 无皮肤）
  themes: { [id]: Theme }              // 所有主题（builtin + 用户）
}
```

### 3.2 单个主题 schema

```js
{
  id: "skin_<base36时间戳><2随机字符>",  // 对齐 bookmarkId 生成方式
  name: "粉紫梦境",                      // 用户可编辑
  isBuiltin: false,                      // 预设 true（不可删不可改），用户主题 false
  colors: {
    background: "#fff9fc",               // body 背景
    panel: "#ffffff",                    // 面板/卡片背景
    accent: "#8b3dce",                   // 主强调色（主按钮/链接）
    accentAlt: "#b45cff",                // 次强调
    text: "#4c2364",                     // 主文字
    muted: "#9e58bd",                    // 次要文字
    sidebarBg: "#fff3f9",                // 侧边栏背景
    inputBg: "#fff5fa",                  // 输入框背景
    inputBorder: "#e484bc"               // 输入框边框
  },
  font: "Microsoft YaHei UI" | null,     // 字体族，null = 不覆盖
  radius: 16 | null,                     // 圆角 px，null = 不覆盖
  decorations: {
    brand: "我的 ZCode 皮肤" | null,      // 顶角品牌文字，null = 不显示
    sparkle: true,                        // 闪光粒子开关
    emojiBadge: "♡" | null,               // 输入框角标 emoji，null = 不显示
    emojiPosition: "top-left"             // top-left/top-right/bottom-left/bottom-right
  }
}
```

### 3.3 内置预设

首次加载 localStorage 空时注入 3 套预设（`ensureBuiltinPresets`）：
- `skin-pink-builtin` 粉紫梦境（抄 Dream Skin 主色）
- `skin-darkgold-builtin` 暗夜金（深背景 + 金强调）
- `skin-sepia-builtin` 护眼米黄（米色背景 + 棕字）

`isBuiltin:true` 不可删不可改字段，只能「复制」成用户主题再编辑。

## 4. 模块 B：注入链路（`lib/skin-inject.cjs`）

### 4.1 模块定位

**写操作模块，独立成模块，复用 `cdp.cjs` 中性工具**（对齐 `video-mute.cjs` / `webview-blankfix.cjs`）。不塞进只读的 cdp.cjs。复用 `cdp.cjs` 的 `listTargets` / `filterTargets` / `connect`。

### 4.2 纯函数层

- `renderSkinCss(theme)` —— theme → CSS 字符串。把 theme.colors 映射到 ZCode 真实选择器。
- `renderSkinChrome(theme)` —— theme → 装饰 DOM HTML 字符串（品牌 div / 闪光 i 粒子 / emoji 角标）。
- `buildSkinExpression(theme)` —— 组装上面两个成 `Runtime.evaluate` 的 IIFE 表达式，幂等（先删 `#zcode-user-skin` + `#zcode-user-skin-chrome` 再建）。
- `buildSkinRemoveExpression()` —— 清两个皮肤 id 的 IIFE 表达式。

### 4.3 关键：先探 ZCode 真实 DOM 选择器

**实施第一步**：写 `scripts/inspect-skin.cjs`（对齐 `scripts/inspect.cjs` / `inspect-webview.cjs` 范式），用 CDP 读 ZCode 主页面的侧边栏 / 输入框 / 主按钮 / 卡片的**真实 class 或 data-testid**。教训 21：不用 CSS 常识猜选择器，用探测脚本读真实 computed state / DOM 结构。

探到的选择器写进 `lib/skin-selectors.cjs`（纯数据模块，便于 selector 变了只改一处）。`renderSkinCss` 从这个模块读选择器。

### 4.4 CSS 模板形状（示意，真实选择器待探测）

```css
/* 注入的 <style id="zcode-user-skin"> 内容 */
html body {
  background: <colors.background> !important;
  color: <colors.text> !important;
}
/* 仅当 font 非 null */
html body, html body * { font-family: <font> !important; }
<侧边栏选择器> {
  background: <colors.sidebarBg> !important;
  border-radius: <radius>px !important;
}
<输入框选择器> {
  background: <colors.inputBg> !important;
  border-color: <colors.inputBorder> !important;
}
<主按钮选择器> {
  background: <colors.accent> !important;
}
<卡片/面板选择器> {
  background: <colors.panel> !important;
  border-radius: <radius>px !important;
}
```

`!important` 是有意的：皮肤注入的 `<style>` 在 ZCode 自有样式之后加载，必须 `!important` 才能覆盖（对齐 `wallpaper.css` 的做法）。

### 4.5 装饰 DOM 形状

`#zcode-user-skin-chrome` 是 `position:fixed; pointer-events:none; z-index:31` 的覆盖层（pointer-events:none 保证不挡操作，对齐 Dream Skin）。内部根据 theme.decorations 决定渲染：
- `brand` 非 null → `<div class="skin-brand">品牌文字</div>` 定位在顶角
- `sparkle` true → `<div class="skin-sparkles"><i></i>×6</div>` 6 个发光圆点（纯 CSS 伪元素做十字光芒）
- `emojiBadge` 非 null → `<div class="skin-emoji-badge">♡</div>` 按位置定位

### 4.6 注入调用方式（关键设计决定）

**皮肤不走 spawn 独立 .cjs，走 server 内联 `require`**：

```
控制中心 GUI → POST /api/action {action:"applySkin", theme: {完整对象}}
  → server 收到完整 theme（不依赖 localStorage，localStorage 在浏览器）
  → server 先 spawn inject.cjs --remove（互斥，清壁纸）
  → 等 remove exit
  → server require('./skin-inject.cjs').applySkin(theme)
    → applySkin 用 cdp.cjs 的 listTargets/filterTargets/connect
    → Runtime.evaluate 注入 <style> + <div>
    → verify 读回 DOM 确认 #zcode-user-skin 存在
  → 返回 jobId
```

**为什么不 spawn 独立 .cjs**：theme 是结构化对象（JSON），传给独立进程要么写临时文件要么走 stdin，都比 server 直接 `require().applySkin(theme)` 复杂。皮肤是低频操作（不像 rotate 要常驻），server 内联调用够了。

### 4.7 CLI 入口（备用）

`node lib/skin-inject.cjs --theme-file <path>` / `--remove`：从 JSON 文件读 theme 注入。供命令行/菜单场景用（菜单加场景 14「应用皮肤」时用）。但 GUI 路径不走 CLI，走 server 内联。

## 5. 模块 C：控制中心 GUI 编辑器

### 5.1 新面板结构

`control/index.html` 加 `#skin-panel`（插在书签面板下方），对齐现有 `.panel` 风格：

```
皮肤
[主题选择下拉] [应用] [移除] [新建] [复制] [删除]
──── 编辑区（选中主题后展开）────
名称: [输入框]
配色: 背景[color] 面板[color] 主色[color] 次色[color]
      文字[color] 侧栏[color] 输入框背景[color] 输入框边框[color]
字体: [输入框 留空=不覆盖]  圆角: [数字 留空=不覆盖]
装饰: 品牌文字[输入框]  ☑闪光粒子  Emoji角标[输入框] 角标位置[下拉]
[保存]
```

### 5.2 前端 lib

`control/lib/skin.js` 双导出（CommonJS + `window.__ccSkin`），对齐 `shelf.js` / `bookmark.js`。纯函数：
- `loadSkins()` / `saveSkins(state)` —— localStorage 读写
- `getActiveSkin(state)` —— 当前激活主题或 null
- `makeSkinTheme(partial)` —— 生成完整 Theme 对象
- `validateTheme(theme)` —— 校验 colors 合法 hex / radius 数字，返回 `{ok, errors}`
- `ensureBuiltinPresets(state)` —— 首次注入 3 套预设
- `duplicateTheme(state, id)` —— 复制成用户主题

### 5.3 渲染 + 事件

`control/lib/skin-view.js`（对齐 `status-view.js`）。轮询时 `renderSkinPanel()` 重读 localStorage 刷新下拉/编辑区。「应用」按钮 → POST `/api/action {action:"applySkin", theme: <完整对象>}`（theme 随请求体传）。

颜色用原生 `<input type="color">` + 文本框双绑（拾色器 + 手输 hex）。内置主题编辑按钮禁用（只能复制成用户主题再改）。

## 6. 模块 D：互斥与状态查询

### 6.1 双向互斥

`control-server.cjs` 的 `/api/action` 分支：
- 收到 `applySkin` → 先 `spawn inject.cjs --remove`（清壁纸）→ 等 exit → `require('./skin-inject.cjs').applySkin(theme)`
- 收到 `injectImage` / `injectVideo` → 先 `require('./skin-inject.cjs').removeSkin()`（清皮肤）→ 再走原 spawn inject.cjs
- `remove`（移除壁纸）/ `removeSkin` 各自只清自己子系统的 id，不串扰

### 6.2 状态探测（`status.cjs` snapshot 加第 6 项）

- 探测方式：每个 page target `Runtime.evaluate` 读 `document.getElementById('zcode-user-skin')` 是否存在 + `data-theme-name` 属性
- 复用 `cdp.cjs` 的 `filterTargets` / `connect`（对齐 `probeWallpaperMode`）
- 返回 `{applied: bool, themeName: string|null}`
- 探测失败不致命（null + `_meta.probeErrors`，整体 200）

### 6.3 状态权威

**DOM 是单一权威**，server 内存不存 skin 状态（对齐 video-mute.cjs 的 `video.muted` 单一权威原则）。透明窗口要记 hwnd 是因为 Win32 查询贵且要 read-host；皮肤查询是 CDP 读 DOM，直接读即可。

### 6.4 status 显示

`status-view.js` 皮肤状态行：`皮肤: 粉紫梦境（已应用）` / `皮肤: 无` / `皮肤: 未知（ZCode 未开）`。

## 7. 测试策略

对齐项目惯例（纯函数单测，跨进程胶水靠真机验）：

- **`test/skintest.cjs`** 测 `lib/skin.cjs` / `control/lib/skin.js` 纯函数：
  - `makeSkinTheme` / `validateTheme`（合法/非法 hex、radius 数字/null 字段）
  - `loadSkins`/`saveSkins`（localStorage mock）
  - `ensureBuiltinPresets`（首次注入 3 套、已有不重复注入）
  - `duplicateTheme`（builtin → 用户、新 id、isBuiltin:false）
  - 前端 lib 双导出镜像一致性（CommonJS require + window 全局）
- **`test/skininjecttest.cjs`** 测 `lib/skin-inject.cjs` 纯函数：
  - `renderSkinCss`（colors 全填 / font null 跳过 / radius null 跳过 / `!important` 存在）
  - `renderSkinChrome`（sparkle 6 粒子 / brand null 不渲染 / emojiPosition 四位置）
  - `buildSkinExpression`（幂等删旧再建、IIFE 返回 'ok'）
  - `buildSkinRemoveExpression`（清两个 id）
  - 镜像 `STYLE_ID`/`CHROME_ID` 常量防漂移（对齐 videomutetest 镜像 VIDEO_EL_ID）
- **跨进程胶水靠真机验**（教训 12/13）：applySkin 的 CDP 注入、互斥时序、状态探测、装饰 DOM 的 pointer-events、配色真生效——单测盲区，靠真机清单（§8）验。

## 8. 真机验证清单

实施后必须真机跑（单测盲区）：
1. 控制中心皮肤面板显示，3 套内置预设可见
2. 应用皮肤 → ZCode UI 配色真变化（侧栏/输入框/按钮/卡片）
3. 装饰 DOM 显示（闪光粒子动 / emoji 角标 / 品牌文字），且**不挡操作**（pointer-events:none）
4. 应用皮肤时若壁纸开着 → 自动清壁纸（互斥生效）
5. 应用壁纸时若皮肤开着 → 自动清皮肤（反向互斥）
6. 皮肤状态正确显示在控制中心状态栏
7. 新建主题 → 改色 → 保存 → 应用 → 生效
8. 复制内置预设 → 改色 → 应用 → 生效
9. 移除皮肤 → ZCode 恢复原样（装饰 DOM 和 style 都清掉）
10. 字体/圆角 null 时不覆盖（保留 ZCode 原值）

## 9. 改动清单

### 新增文件
- `lib/skin.cjs` —— 主题模型纯函数（server 端用）
- `lib/skin-selectors.cjs` —— ZCode DOM 选择器数据（探测后填充）
- `lib/skin-inject.cjs` —— 注入链路（renderSkinCss / renderSkinChrome / applySkin / removeSkin）
- `control/lib/skin.js` —— 前端 lib（双导出，localStorage 读写）
- `control/lib/skin-view.js` —— 皮肤面板渲染
- `scripts/inspect-skin.cjs` —— ZCode DOM 选择器探测脚本
- `test/skintest.cjs` —— 主题模型纯函数测试
- `test/skininjecttest.cjs` —— 注入纯函数测试

### 修改文件
- `control/index.html` —— 加 `#skin-panel`
- `control/control.css` —— 皮肤面板样式
- `control/control.js` —— 皮肤面板事件绑定
- `lib/control-server.cjs` —— `applySkin`/`removeSkin` action + 互斥守卫 + skin 状态探测端点（status 内联）
- `lib/status.cjs` —— snapshot 加第 6 项 skin 探测
- `lib/cdp.cjs` —— 加 `probeSkinMode`（或复用 probeWallpaperMode 模式新写一个）
- `package.json` —— `test` 脚本加 skintest + skininjecttest
- `AGENTS.md` —— 加皮肤系统章节

## 10. 已知遗留 / 边界

- **ZCode 更新后选择器失效**：皮肤 CSS 依赖 ZCode 具体选择器（侧栏/输入框 class），ZCode 更新可能改 class 导致配色部分失效。`inspect-skin.cjs` 是诊断工具，失效时重跑探测更新 `skin-selectors.cjs`。这是 CDP 注入方案固有的脆性（和壁纸同款），记录在案。
- **`!important` 覆盖范围**：皮肤用 `!important` 覆盖 ZCode 配色，但 ZCode 某些元素若用更高特异性（多层 class + inline style）可能覆盖不掉——真机验清单第 2 条专门查这个。
- **装饰 DOM 与 ZCode 重渲染**：Dream Skin 用 MutationObserver + setInterval 兜底重注入防 SPA 重渲染冲掉装饰层。本项目第一版**不加自动重注入**（YAGNI，皮肤是低频手动应用，不是 rotate 那样需要韧性）。若真机发现 SPA 导航后皮肤丢失，再加 watch 机制（对齐 Codex-Dream-Skin 的 injector.mjs --watch）。
- **互斥不覆盖透明窗口**：透明（Win32 层）和皮肤不互斥，可叠加。用户若同时开了透明窗口 + 皮肤，看到的是半透明窗口里的 UI 配色——这是允许的组合。
- **主题不带图片**：纯 CSS 主题，不支持 polaroid 相框那种图片装饰。未来要加图片需另开 spec（涉及图片存取/server 端点，类比 wallpapers-thumb 目录管理）。
