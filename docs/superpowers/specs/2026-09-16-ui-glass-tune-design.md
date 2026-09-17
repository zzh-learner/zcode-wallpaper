# 设计稿:控制中心「玻璃调节」——ZCode 各区域透明度/模糊度独立调节

**日期**:2026-09-16
**状态**:待实现(spec 已与用户逐段确认:区域范围 / 方案选择 / 架构 / CSS 形状 / 生效链路 / 错误边界 / 测试 共 6 节)
**作者**:brainstorming 会话产出
**分支**:`feat/ui-glass-tune`

---

## 1. 目标

在控制中心「壁纸」tab 新增**玻璃调节**能力:对 ZCode 主页面的五个区域
(侧边栏 / 主对话区 / 输入框区 / 顶栏 / 面板)分别调节:

- **不透明度**(0-100%,区域玻璃底色的 alpha)
- **模糊度**(0-24px,`backdrop-filter: blur`)

让每个区域变成可调的"毛玻璃":壁纸从底层透出、区域底色半透明压住、blur 把壁纸纹理揉开,
解决"全透明模式下字直接压在壁纸上不可读"的核心痛点(AGENTS.md 核心教训 2 的后续诉求)。

### 起因(用户原话)

"现在控制中心中的壁纸功能,我想新增一个功能:单独调整 zcode 各部分的透明度模糊度"

### 用户确认的决策

1. **区域范围(多选,全选)**:侧边栏 / 主对话区 / 输入框区 / 顶栏。
   **弹窗/确认对话框这期不做**——它们需要强对比保证可读,误调全透明会看不清按钮。
2. **实现路线:方案 A**——独立第二层玻璃样式,原地实时更新,不碰 wallpaper.css。

### 和现有子系统的关系

壁纸子系统的**增量能力**,不是新子系统。注入对象仍是主 renderer page target(走 CDP),
控制中心仍是"触发器 + 状态显示器"(动作逻辑在新写模块 `lib/ui-tune.cjs`,对齐 video-mute 范式)。
默认(全 0)**行为与现状完全一致**——玻璃层整个不存在。

### 显式非目标(YAGNI)

- **不**做弹窗/对话框玻璃(用户确认)
- **不**做每区域自定义色调(固定"跟主题"双套:深色主题深烟灰、浅色主题浅白霜)
- **不**做多套预设 profile 切换
- **不**调控制中心/阅读器 webview 内部的透明度(它们是独立页面,自己的 CSS 管自己)
- **不**做全局"壁纸变暗/变淡"旋钮(那是核心教训 2 证伪过的方向,别回头)

---

## 2. 方案选择(已确认:方案 A)

| 方案 | 机制 | 评价 |
|---|---|---|
| **A(选定)** | 独立第二层 `<style id="zcode-user-ui-tune">` + CDP Runtime.evaluate 原地更新 | 调参不重注入(壁纸不闪);不碰 wallpaper.css;全默认=移除层 |
| B | 改 wallpaper.css,transparent → 变量化,注入时按配置填值 | 变量是全局粒度做不到按区域;**每次调参要重跑 inject → 换随机壁纸**;动教训 2 血换来的稳定层 |

**方案 A 的决定性理由**:实时调参必须原地写。重跑 `inject.cjs` 会重新随机选壁纸,
拖滑块壁纸闪来闪去没法用——这一条直接杀死 B。

---

## 3. 架构与文件清单

### 新增

| 文件 | 作用 | 范式参照 |
|---|---|---|
| `lib/ui-tune.cjs` | 玻璃调节写模块:纯函数(`normalizeConfig`/`buildTuneStyle`/`buildTuneExpression`)+ effectful(`applyTune` CDP 原地写) | `lib/video-mute.cjs`(写模块独立于只读 cdp.cjs,但复用其中性工具) |
| `test/uitunetest.cjs` | 纯函数单测 | `test/videomutetest.cjs` |
| `scripts/inspect-regions.cjs` | 区域结构探测脚本(本次 brainstorm 已真机跑过,转正当选择器回归诊断工具) | `scripts/inspect.cjs` |
| `ui-tune.json`(项目根,进 .gitignore) | 持久化配置(运行时产物,用户状态) | — |

### 修改

| 文件 | 改动 |
|---|---|
| `lib/control-server.cjs` | 加 `GET /api/uitune`(读配置回填滑块)+ `POST /api/uitune`(normalize + 原子写 + applyTune,即时面对齐 muteVideo,不走 jobId/全局锁) |
| `lib/inject.cjs` | ①图片/视频注入时读 `ui-tune.json`,非默认则附带注入玻璃层(重启后效果保持);②**三条清理路径都清 `zcode-user-ui-tune`**(remove / 图片注入 / 视频注入——"三个清理点一个目标"老规矩);remove 清了不重建,注入路径清了按配置重建 |
| `control/index.html` | 壁纸 tab 加「玻璃调节」组(4 区域 × 2 滑块 + 重置按钮) |
| `control/control.js` | 滑块接线:加载时 GET 回填,input 防抖 300ms POST,结果显示 applied/affected 或降级横幅 |
| `control/control.css` | 滑块行布局样式(区域名 + 两个滑块 + 数值) |
| `.gitignore` | 加 `ui-tune.json` |
| `package.json` | test 脚本追加 `uitunetest.cjs` |
| `test/selftest.cjs` + `test/cdp-mock-test.cjs` | 新 id 进三条清理路径的断言(镜像视频清理的既有回归) |
| `test/controlservertest.cjs` | GET/POST /api/uitune 断言 |

### 模块边界(对齐既有分层)

- `lib/cdp.cjs` 保持**只读**:`applyTune` 是写操作,必须独立模块(AGENTS.md 铁律),
  但**复用** `cdp.listTargets`/`cdp.connect`/`cdp.filterTargets` 中性工具(教训 1:复用连接逻辑,不复用"只读"语义)。
- **applyTune 的目标范围**:`cdp.filterTargets` 过滤后的 page targets(排除控制中心/阅读器工具页,
  对齐 inject.cjs 的注入对象)。玻璃样式绝不能注进工具页——reader/control 自己的 UI 会被误盖。
- 状态单一权威:**`ui-tune.json` 是持久状态的唯一权威**,style 元素是页面内的投影,
  不设 server 内存副本(避免两份漂移,教训 1)。

---

## 4. 数据结构

### `ui-tune.json` shape

```json
{
  "version": 1,
  "regions": {
    "sidebar": { "alpha": 55, "blur": 12 },
    "chat":    { "alpha": 0,  "blur": 0  },
    "input":   { "alpha": 40, "blur": 8  },
    "topbar":  { "alpha": 0,  "blur": 0  }
  }
}
```

- `alpha`:0-100 整数(UI 语义"不透明度百分比"),CSS 里换算 0-1。
- `blur`:0-24 整数(px)。
- `version !== 1` → 整个文件当默认(全 0)处理。
- 未知 region key / 坏值 → `normalizeConfig` 丢弃/回退 0,**不抛错**。

### `normalizeConfig(raw)` 纯函数规则(单一权威,三处读取共用)

1. 非对象 / JSON 解析失败 → 返回默认全 0。
2. `version !== 1` → 默认全 0。
3. 每区域:`alpha = clamp(floor(Number) , 0, 100)`,NaN/undefined → 0;`blur` 同理 clamp 0-24。
4. 只认 `sidebar/chat/input/topbar` 四个 key,其余丢弃。
5. 全区域全 0 → `isDefault: true`(调用方据此决定移除层/跳过注入)。

### `buildTuneStyle(config)` 纯函数

- 输入 normalize 后的 config,输出**完整 CSS 字符串**;某区域 `alpha===0 && blur===0` → 跳过该区域规则;
  全区域跳过 → 返回 `null`(调用方 = 应移除 style 元素)。
- 每区域规则形如(以 sidebar 为例):

```css
aside[data-testid="sidebar"]{
  background-color: rgba(24,24,28,0.55) !important;
  backdrop-filter: blur(12px) !important;
  -webkit-backdrop-filter: blur(12px) !important;
}
```

- **双主题色调**:按 `<html>` 的 `.theme-zai-dark` / `.theme-zai-light` 分发两套 tint——
  深色 `rgba(24,24,28,α)`(深烟灰)、浅色 `rgba(248,248,248,α)`(浅白霜,色值取 ZCode 浅色实测背景)。
  与 wallpaper.css 用同一信号源。
- **已知限制(记录权衡)**:主页面 html 的 theme class 已知**不实时跟随主题切换**
  (控制中心主题工作时真机实证过,memory: control-center-theme-shipped)。后果 = 切主题后玻璃色调可能滞后,
  重注壁纸/刷新页面后按 class 取到新值。接受(YAGNI);若日后体验差,再考虑 CDP 读 matchMedia 动态生成。

### 区域锚点表(`REGIONS` 常量,ui-tune.cjs 单一权威)

| region | 选择器(初版) | 依据 |
|---|---|---|
| `sidebar` | `aside[data-testid="sidebar"]` | 真机探测(2026-09-16):ASIDE,310px 全高 |
| `chat` | `[data-testid="conversation-column"]` 或 `[data-testid="conversation"]`(二选一) | 真机存在两个 testid,**实施第一步用 inspect-regions 按 rect 钉死** |
| `input` | `[data-testid="conversation-bottom-dock-transition"]` + `.bg-input` | 真机存在;`.bg-input` 已被 wallpaper.css 强制透明,玻璃层后注入同 `!important`,cascade 后者赢。**防双层叠加**:dock wrapper 与 `.bg-input` 可能嵌套(两层都上玻璃 = 双重加深),只给实际画背景的那层,实施第一步以探测 rect + computed bg 钉死 |
| `topbar` | `[data-testid="workspace-header"]` | 真机存在;容器矩形实施时核对 |
| `panel` | `[data-testid="browser"]` | **2026-09-17 用户验收反馈补加**(原四区域遗漏):右侧面板(浏览器面板,控制中心所在的 719px 整块,含地址栏行)。panel-probe2/4 实测:该容器及祖先链 computed bg 全透明(webview 内联白底已被 wallpaper.css §5 压住、控制页 body 透明),玻璃直接画在壁纸上、透过透明 webview 可见。多会话多实例并存时 querySelectorAll 全命中,隐藏实例零面积无视觉副作用(AGENTS.md 教训 34 拓扑) |

**选择器失配防御**:ZCode 更新改 DOM → `querySelectorAll` 找不到 → 该区域无效果、不报错;
`scripts/inspect-regions.cjs` 是诊断工具。改选择器只动 `REGIONS` 常量。

---

## 5. 生效链路

```
滑块 input(防抖 300ms)
  → POST /api/uitune { regions: {...} }
    → server: normalizeConfig → 原子写 ui-tune.json(临时文件 + rename,防半写)
    → uiTune.applyTune(config):遍历 filterTargets 后的 page targets
      → Runtime.evaluate:同一次 evaluate 内删旧 <style id="zcode-user-ui-tune"> 再建新
        (等效原地,不重注入壁纸不闪;层序与滑杆路径略有差异但选择器互不重叠);
        isDefault 则只删不建(buildTuneStyle 返 null)
    → 响应 { saved, applied, affected, total, reason? }   ← 即时面,不进 jobId/全局锁
  → 前端显示「已应用到 N 个窗口」或降级横幅

控制中心打开时:GET /api/uitune → 回填滑块
重启链:start-zcode.bat → inject.cjs 注壁纸 → 读 ui-tune.json 非默认则附带注入玻璃层 → 重启不丢
```

- **原地更新是命门**:任何"调参走重注入"的实现都会换随机壁纸,禁止。
- style 元素 `id="zcode-user-ui-tune"`,与壁纸 `<style id="zcode-user-wallpaper">` 完全独立。
- **未注壁纸时**:滑块仍可调、配置照存(applyTune 无害);前端按 `status.wallpaper.mode` 显示
  提示"尚未注入壁纸,玻璃效果需壁纸在底层才可见"。

---

## 6. 错误处理与边界

| 边界 | 处理 |
|---|---|
| 9222 不通(ZCode 没带调试端口) | 配置**照存**,POST 返回 `applied:false, reason:"cdp-unreachable"` → 前端横幅「未连接 ZCode,下次注入壁纸时生效」 |
| `ui-tune.json` 损坏/半写 | `normalizeConfig` 容错回退全 0(GET/POST/inject 三处读取共用同一函数,单一权威) |
| 原子写 | 先写 `ui-tune.json.tmp` 再 `rename`,半写不会毁配置 |
| 区域选择器失配(ZCode 更新) | 静默无效不报错;inspect-regions 诊断 |
| per-target CDP 失败 | 跳过继续,响应 `affected` 如实计数(对齐 video-mute 的 per-target 容错) |
| 并发 POST(滑块连拖) | server 端串行化不必要——normalize+写文件+evaluate 幂等,最后一次为准;前端 300ms 防抖已挡大部分 |
| **侧边栏硬画实色遗留(核心教训 2)** | **实施第一步验证项**:注壁纸后用 inspect-regions 复测 sidebar computed bg。若仍有 CSS 够不到的硬画块,`applyTune` 的表达式加 JS inline-style 覆盖分支(逐元素设 style),单独真机验证——不默认 CSS 全搞定(教训 9/21) |
| backdrop-filter 性能 | 4 个大区域同时 blur 的 GPU 开销需真机验(Electron/Chromium 146);滑杆上限 24px 防极端值;真机清单含"拖动流畅度" |
| remove 壁纸 | 三路径清理保证玻璃层一起清(不留孤儿层) |

---

## 7. 测试策略

项目哲学(教训 12-15):纯函数单测,跨进程胶水 + DOM 视觉靠真机。

### 第一层:`test/uitunetest.cjs`(纯函数)

**`normalizeConfig`**:
```
✓ 默认/undefined/null/坏 JSON 字符串 → 全 0 + isDefault
✓ version 缺失/≠1 → 全 0
✓ alpha:55→55; -5→0; 150→100; "40"→40; NaN/undefined→0
✓ blur:12→12; -1→0; 99→24; "8"→8; NaN→0
✓ 未知区域 key 丢弃;未知顶层 key 丢弃
✓ 全 0 → isDefault:true
```

**`buildTuneStyle`**:
```
✓ 单区域非 0 → 含该区域选择器 + rgba alpha 换算(55 → 0.55)+ blur px
✓ alpha=0 blur=12 → 只输出 backdrop-filter 规则,不输出 background-color(α=0 的底色是废规则)
✓ 区域全 0 → 该区域规则不出现
✓ 全区域全 0 → null
✓ 双主题:输出含 .theme-zai-dark 与 .theme-zai-light 两套 tint,色值正确
✓ 输出含 -webkit-backdrop-filter 前缀
```

**`buildTuneExpression(styleId, cssOrNull)`**(evaluate 表达式构造,镜像 buildMuteExpression):
```
✓ css 非 null → 建更 style 且 textContent 注入
✓ css = null → remove 元素
✓ 表达式返回 JSON 可解析({ok:true} 形状)
```

### 第二层:server 路由(并入 `controlservertest.cjs`)

```
✓ GET /api/uitune(无配置文件)→ 200,全 0 默认
✓ POST /api/uitune 合法 body → 200 + 配置文件落盘内容正确(round-trip)
✓ POST 坏 JSON → 400
✓ POST 后 GET → 读回 POST 的值
✓ POST alpha 越界(999)→ 落盘 100(clamp 生效)
```

### 第三层:注入/清理回归(`selftest.cjs` + `cdp-mock-test.cjs`)

```
✓ inject.cjs 三条路径(remove/图片/视频)的表达式都含 zcode-user-ui-tune 清理(字符串断言,镜像 VIDEO_EL_ID 的钉法)
✓ 图片/视频注入路径:配置非默认时附带注入玻璃层;默认时不注
```

### 第四层:真机验证清单(必做,人工)

**前置:注壁纸(start-zcode.bat 场景)**
1. [ ] 控制中心 → 壁纸 tab 出现「玻璃调节」组,滑块回填上次配置
2. [ ] 拖侧边栏不透明度 → 立即生效(壁纸不闪、不重注入)
3. [ ] 拖侧边栏模糊度 → 壁纸纹理在侧边栏后变糊,平滑
4. [ ] 四区域逐一有效;全拉 0 → 玻璃层消失,回到现状全透明
5. [ ] **拖动流畅度**(GPU):四区域同时开 blur 不卡界面
6. [ ] 刷新控制中心 → 滑块值保持(json 落盘)
7. [ ] 重启 ZCode(start-zcode.bat)→ 壁纸 + 玻璃层一起回来
8. [ ] 移除壁纸 → 玻璃层一起消失
9. [ ] 关掉 ZCode 改用不带调试端口启动 → 调滑块 → 配置照存 + 横幅提示
10. [ ] 切浅色主题 → 重注后玻璃变浅白霜(注意已知限制:不实时跟随)
11. [ ] **实施第一步专项**:注壁纸后 sidebar computed bg 复测——确认"硬画实色"现状,决定是否需要 JS inline 覆盖分支

---

## 8. 实现顺序(建议)

1. **实施第一步(spike,先于一切)**:注壁纸 → `scripts/inspect-regions.cjs` 复测 →
   钉死 chat/topbar/input 最终选择器 + sidebar 硬画现状结论(写回本 spec 附录)
2. `lib/ui-tune.cjs` 纯函数 + `test/uitunetest.cjs`(TDD)
3. `lib/control-server.cjs` GET/POST 路由 + controlservertest 断言
4. `lib/inject.cjs` 三路径清理 + 配置附带注入 + selftest/cdp-mock-test 断言
5. `control/` UI 接线(HTML/CSS/JS)
6. `package.json` test 脚本追加 + 全量 `npm test`
7. 真机验证清单 11 条(重点 2/5/7/11)

---

## 附录:实施 spike 结论(2026-09-16)

Task 1 真机 spike 完成(分支 `feat/ui-glass-tune`,壁纸已注入保持到 Task 7)。
探测工具:`scripts/inspect-regions.cjs`(已扩 ANCHORS 段)+ 一次性脚本
`.superpowers/sdd/2026-09-16-ui-glass-tune/smoke-blur.cjs`(自然态对比/嵌套验证/sidebar 全深度扫描/冒烟)。
**本附录是 Task 2 `REGIONS` 常量的唯一依据。**

### A. REGIONS 最终选择器表

| region | 最终选择器 | 探测依据(2026-09-16 真机) |
|---|---|---|
| `sidebar` | `aside[data-testid="sidebar"]` | count=1;rect [0,0,310,1032](310px 全高左栏);自身子树全透明(见 B) |
| `chat` | `[data-testid="conversation-column"]` | 两个候选嵌套:**conversation-column 是外层**(contains conversation,`colContainsConv=true`),两者 rect 完全相同 [314,4,W,1024],x=314≥310 不吞侧边栏;按判定规则取"实际覆盖内容区的外层"。外层更稳(内层 conversation 是内容滚动包装,外层 rect 覆盖整个主列) |
| `input` | `[data-testid="conversation-bottom-dock-transition"] .bg-input`(**必须带 dock 前缀限定**) | dock wrapper 自然态无背景无 bg 类(`grid w-full`)→ 只是动画壳,按规则只留 `.bg-input`;**裸 `.bg-input` 全页命中不稳定**(第一次探测 3 个、第二次 5 个,含顶栏小按钮/右面板输入框/隐藏 input),`dock .bg-input` 恰好命中 1 个 = 输入卡 [379,905,W,106]。裸用会误伤顶栏/右面板控件 |
| `topbar` | `[data-testid="workspace-header"]` | count=1;rect y=5、height=48 <100,顶部横条 ✓ |

**⚠️ 布局是动态的,禁止硬编码坐标**:两次探测间隔几分钟,右面板(chat-summary-panel,
320px 实色白底浮层)开合导致 conversation 宽度 1602↔879、`.bg-input` 数量 3↔5 变化。
Task 2 的表达式只依赖选择器 + 运行时 `getBoundingClientRect`,不写死任何 rect。

### B. sidebar 硬画判定:不需要 JS inline 覆盖分支

- aside 自身 computed bg:**注入态和自然态(临时 disable 壁纸 style 同步读)都是 `rgba(0,0,0,0)`**。
- 子树全深度扫描(1025 个后代,突破 inspect-regions walk 的 4 层深度限制):42 个"非透明"命中
  全部为无害项——27 个零面积 DIV(0.8px radial-gradient 装饰,rect [0,0,0,0])、
  14 个 6×6px 状态圆点(bg-sky-500)、1 个激活会话项的 `rgba(13,13,13,0.05)` 悬停浅染(95% 透)。
  **无任何不透明实色块。**
- **结论:AGENTS.md 核心教训 2 的"侧边栏硬画实色"遗留,在当前 ZCode 版本 + wallpaper.css 注入态下
  不再复现**(版本绑定结论,同教训 21 子坑 A 的 webview 白底翻转——ZCode 更新后必须用
  inspect-regions 复测,别当永久事实)。Task 2 Step 5 的条件块(inline 覆盖分支)**不启用**。
- 范围说明:第 4 个 ASIDE `chat-summary-panel`(右面板,自然态实色 `rgb(255,255,255)`)
  不在四区域内(用户已确认弹窗/浮层这期不做),玻璃层不碰它。

### C. backdrop-filter 冒烟:可用 ✓

- 注入 `<style id="smoke-blur">`(带 id,验证后已移除并复核 `backdropFilter` 回到 `none`):
  `aside[data-testid="sidebar"]{backdrop-filter:blur(20px) !important;}` →
  computed `backdropFilter: "blur(20px)"`(预期值,教训 21 式确认而非假设)。
- 像素级证据(sharp 区域 diff,shot-baseline.png vs shot-smoke.png):sidebar 区域
  meanAbsDiff=1.789,静态对照区(顶栏 0.000、右面板 0.000)完全为 0——**视觉变化精确集中在
  被 blur 的 sidebar 区域**。本壁纸底图本身柔和,20px blur 的肉眼差异偏淡但真实存在;
  Task 4 真机清单第 3 条仍需人眼终验。

### D. 给 Task 2 的执行要点(由本 spike 直接推出)

1. `REGIONS` 常量照 A 表逐字抄;`input` 的选择器是**带前缀的组合选择器**,`querySelectorAll`
   语义即可,无需拆两段。
2. sidebar 不加 inline 覆盖分支(见 B);真机清单第 11 条在实施时按本次结论勾掉。
3. CSS 生成用 `backdrop-filter` + `-webkit-backdrop-filter` 双写(冒烟验证的是标准属性,
   -webkit- 前缀为 Safari 惯例兜底,Chromium 146 两者都认)。
4. 证据文件存于 `.superpowers/sdd/2026-09-16-ui-glass-tune/`(shot-baseline.png、
   shot-smoke.png、compare-shot.cjs、smoke-blur.cjs),inspect-regions.cjs 已转正当诊断工具。
