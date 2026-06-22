# 设计稿：ZCode 控制中心书签管理

**日期**：2026-06-22
**状态**：待实现（spec 已与用户逐段确认：方案选择 / 架构 / 数据结构 / UI+中转页 / 错误边界 / 测试 共 5 节）
**作者**：brainstorming 会话产出
**分支**：`feat/bookmark`

---

## 1. 目标

在现有控制中心（`control/`）里加一个**书签管理功能**：用户手动添加常用网址（名称 + URL），
点击书签即可在 ZCode 浏览器面板（webview）里访问外部互联网站点。

### 起因（用户原话）

用户发现 ZCode 内置浏览器面板可以访问互联网——有 URL + 有网络，就能访问。于是想做一个
书签功能，放上常用几个网址，到时候直接点击就能访问。

### 核心定位（用户确认的三个决策）

1. **打开方式**：当前面板直接跳转（`location.href`，和现有「打开阅读器」按钮同一个机制）。
2. **书签管理**：完全手动增删（不预置、不从浏览器导入）。
3. **条目粒度**：名称 + URL（不抓 favicon、不分组、不搜索）。

### 和现有子系统的关系

书签是控制中心的**第四块面板**（前三块：状态 / 动作 / 书架）。它**完全纯前端 + 纯 localStorage**，
不触发任何现有子系统（inject/transparent/rotate），server 几乎不改。

对齐控制中心 spec 既定铁律："控制中心是触发器 + 状态显示器，不重写子系统动作"——书签连
"触发现有子系统"都不做，它是零服务端依赖的本地小工具。

### 显式非目标（YAGNI）

- **不**预置任何默认书签（完全手动）
- **不**抓取/显示 favicon（用户选了纯名称+URL）
- **不**做分组/标签/分类/搜索（"常用几个"，over-engineering）
- **不**做导入导出（localStorage 在那，需要时手动备份）
- **不**做书签同步/云存储（完全本地工具）
- **不**做书签 URL 去重（用户可能想要同 host 不同路径的两个书签）
- **不**在 iframe 嵌入外部站（主流站点 X-Frame-Options 拒绝嵌入，大面积失败）
- **不**调系统外部浏览器打开（违背用户选的"当前面板跳转"）

---

## 2. 方案选择（已确认：方案 A）

三个候选方案的对比，最终选 A：

| 方案 | 打开方式 | 回来路径 | 评价 |
|---|---|---|---|
| **A（选定）** | webview 跳中转页 go.html → 用户点"立即前往"跳外部站 | 浏览器后退回 go.html → 再后退/点"返回控制中心"回 control | 回来路径清晰，代码量少 |
| B | 直接 `location.href = 外部URL` | 只能手输 control URL 或退整个历史 | 回来几乎不可能，体验差 |
| C | `window.open` 调系统浏览器 | control 不离开 | 违背"当前面板跳转"；弹窗可能被拦 |

### 为什么 A：中转页 go.html 是核心

跳到外部站后，**外部页我们没控制权**——无法在它上面放"返回控制中心"按钮。中转页 go.html 是
**留在 `127.0.0.1:17890` origin 的最后一站**：

```
webview 浏览历史栈：
control/index  →  control/go.html  →  外部站（当前）
                  ↑
                  浏览器后退回到这里，再点"返回控制中心"
```

用户按浏览器后退：退一格回 go.html（显示静态按钮），再退一格或点 go.html 上的"返回控制中心"
回 control。**两条回来路径都通，无需手输 URL**。这是方案 A 比 B 强的核心。

---

## 3. 架构与文件清单

### 文件改动（新增 2 个，改 3 个，server 改 1 行）

**新增：**

| 文件 | 作用 | 范式参照 |
|---|---|---|
| `control/lib/bookmark.js` | 书签纯函数库：URL 校验/规范化、增删改查、中转 URL 生成。双导出（CommonJS + `window.__ccBookmark`） | `control/lib/shelf.js` |
| `control/go.html` | 中转页：显示目标 + 前往/返回按钮，内联 CSS/JS 自包含，二次校验 URL | 无（全新） |

**修改：**

| 文件 | 改动 |
|---|---|
| `control/index.html` | 加 `<div id="bookmark-panel">` 面板 + 引入 `lib/bookmark.js` |
| `control/control.js` | 加 `renderBookmarks()` 渲染 + 添加/删除表单事件 + 书签点击 → `location.href = buildGoUrl(...)` |
| `control/control.css` | 复用 shelf 的 `.book` 样式，加书签输入框宽度样式（`.wide-input`） |

**server 改动（极小，1 行）：**

`lib/control-server.cjs` 加一条重定向：`/control/go` → 302 `/control/go.html`。
和现有 `/control` → `/control/`（教训 18a）同一性质——防用户在地址栏输 `/control/go` 时
相对路径解析错位。go.html 本身靠现有 `/control/` 静态托管逻辑（`p.indexOf("/control/") === 0`
分支）自动服务，**不需要新加静态路由**。

**为什么 server 改这么少**：书签数据零服务端依赖（全 localStorage），中转页是纯静态 HTML。
正好踩在现有 server 的静态托管能力上，不引入新 API、新 spawn、新状态。

---

## 4. 数据结构

### localStorage shape

```
key:   "zcode-control:bookmarks"
value: JSON 数组，每项：
{
  id:        "bm_xxxxxx",        // 稳定唯一 id
  title:     "GitHub",            // 用户输入的名称（原样存，渲染时转义）
  url:       "http://github.com/",// 规范化后的 URL
  createdAt: 1719012345678        // 毫秒时间戳，用于稳定排序
}
```

**id 生成规则**：`"bm_" + Date.now().toString(36) + 随机 2 字符`。不用 shelf 的 filename hash
（书签 URL 可能重复，hash 撞 id 会误删）。时间戳+随机保证唯一。**显式不做 URL 去重**——
用户重复加是用户的事，去重会吞掉用户意图。

**排序**：按 `createdAt` 升序（先加的在前）。不提供拖拽排序（YAGNI）。

### URL 校验与规范化（核心安全面）

`normalizeUrl(input)` 纯函数规则（`bookmark.js` 导出）：

1. `trim()` 空白。
2. 无协议前缀（不含 `://`）→ **自动补 `http://`**（不补 https://——让浏览器/webview 处理
   http→https 升级，这一层不该假设目标支持 https）。`localhost:3000` / `127.0.0.1:8080` 也补 `http://`。
3. `new URL(normalized)` 解析。**失败 → `{ok:false}`**。
4. **协议白名单**：只允许 `http:` / `https:`。`javascript:` / `data:` / `file:` / `vbscript:` /
   `blob:` / `ftp:` 等一律 `{ok:false}`。**这是防 XSS 的命门，无例外。**
5. 通过则返回 `{ok:true, url: parsed.href}`（规范化形式）。

**校验返回值**：`{ ok: true, url: "..." }` 或 `{ ok: false, error: "..." }`。

### 中转 URL 生成

```
buildGoUrl(url, title?) -> "/control/go.html?url=" + encodeURIComponent(url)
                           + (title ? "&title=" + encodeURIComponent(title) : "")
```

`encodeURIComponent` 保证 URL 里的 `&`/`=`/`#` 不破坏 query string 解析。

---

## 5. 关键安全决策（写进 spec 钉死）

1. **协议白名单 http/https only**——`javascript:`/`data:`/`file:` 一律拒。防 XSS 底线，无例外。
2. **title 原样存、渲染必转义**——`bookmark.js` 数据层不转义，`control.js` 渲染时调 `esc()`
   （现有书架已在用的转义函数）写入 innerHTML。
3. **URL 在 go.html 显示用 `textContent`**（不是 innerHTML），防 URL 里藏 `<script>`。
4. **go.html 二次校验**——go.html 读 url 参数后**再跑一遍** `new URL` + 协议白名单。双保险：
   bookmark.js 存时校验一次，go.html 跳时校验一次。即使有人手输 `/control/go.html?url=javascript:...`
   也拦得住。
5. **不做 open-redirect 防护，但保留协议白名单**（两者不矛盾，区分清楚）：
   - **open-redirect 防护**（不做）= 限制能跳转的 http/https 目标域名范围。书签是**用户自己加的**，
     用户跳自己加的 URL 不存在被第三方诱导跳转的问题（不像服务端开放的 redirect endpoint）。
     go.html 的 url 参数由 bookmark.js 生成（已校验），不是用户直接构造的攻击向量。这条写清楚
     **为什么不做**，免得以后有人"好心"加域名白名单反而搞坏功能。
   - **协议白名单**（保留，即决策 1 + 决策 4）= 拒绝 `javascript:`/`data:`/`file:` 等危险协议。
     这是防 XSS，不是防 open-redirect。即使有人手输畸形 go.html URL，协议白名单兜底。
   - **一句话区分**：协议白名单挡的是"跳到危险协议执行代码"，open-redirect 防护挡的是"跳到
     危险域名钓鱼"。前者做（XSS 不可接受），后者不做（用户自加 URL 无诱导风险）。

### go.html 内联校验是 bookmark.js 的复制品（教训 17 同型）

go.html 的二次校验逻辑和 `bookmark.js` 的 `normalizeUrl` **相同**，但 go.html 刻意自包含
（不依赖 bookmark.js，它是一次性跳转页）。两份校验代码各自独立——**改一处必须同步另一处**，
和 reader codec 前后端两份实现的模式一致（教训 17：跨环境共享代码不能时，靠共享测试/同步
维护钉一致）。

---

## 6. 书签面板 UI（control/index.html 第四块面板）

紧挨在 shelf-panel 后面：

```html
<div id="bookmark-panel" class="panel">
  <h3>书签</h3>
  <div class="bookmark-add">
    <input id="bm-title" type="text" placeholder="名称" class="wide-input" style="width:120px">
    <input id="bm-url" type="text" placeholder="网址（如 github.com）" class="wide-input" style="width:220px">
    <button data-action="addBookmark">添加</button>
  </div>
  <div id="bookmark-list"></div>
  <span id="bm-msg" class="muted"></span>
</div>
```

### 书签列表渲染（control.js 的 renderBookmarks，仿 renderShelf）

```
□ GitHub                          ✕
  http://github.com/
□ Stack Overflow                  ✕
  https://stackoverflow.com/
```

- 每条：`title`（粗体，可点跳转）+ 下面一行小字显示 `url`（灰，`text-overflow: ellipsis`，
  `title` 属性显示完整 URL）+ 右侧 `✕` 删除。
- 点 title → `location.href = buildGoUrl(bm.url, bm.title)`。
- 点 `✕` → `removeBookmark(id)` + 重渲染。
- **空列表**：显示灰字"还没有书签，在上方添加（名称 + 网址）"。

复用 shelf 的 `.book` / `.book-open` / `.book-del` 样式。`.wide-input` 覆盖现有 `input { width:50px }`
（那是给数字框的）。

### 添加交互（control.js）

点"添加"按钮：

1. 读 `bm-title.value.trim()` 和 `bm-url.value.trim()`。
2. **title 为空 → 用 URL 的 host 当 title**（`new URL(normalizedUrl).hostname`）。用户常只输 URL
   不输名字，强制要名字反人类。
3. `normalizeUrl(urlInput)`：
   - `{ok:false}` → `#bm-msg` 显示红字错误（`.err` class，色 `#ff8a80`），2 秒自动清，**不加入**。
   - `{ok:true}` → `addBookmark({title, url})` 写 localStorage，清空两输入框，重渲染，`#bm-msg`
     显示绿字"已添加"1 秒。
4. **回车提交**：两输入框绑 `keydown Enter` → `e.preventDefault()` + 触发添加逻辑。输入框不在
   `<form>` 里（避免浏览器默认表单提交刷新页面），用原生 button click 逻辑。

---

## 7. 中转页 go.html（核心创新点）

极简独立页面，**纯静态、内联 CSS/JS、不依赖 bookmark.js**（自包含）。

### 布局

```
┌─────────────────────────────────────────┐
│         即将打开                         │
│         GitHub                          │  ← title（大字，textContent）
│         http://github.com/              │  ← url（小字灰，textContent）
│    [ 立即前往 ]   [ 返回控制中心 ]        │
└─────────────────────────────────────────┘
```

### 交互逻辑（内联 script）

1. 读 `location.search` 的 `url` + 可选 `title` 参数（`decodeURIComponent`）。
2. **二次校验**（双保险）：
   - url 缺失 / `new URL(url)` 抛错 / 协议非 http/https → 显示"无效的书签链接" + 只给
     "返回控制中心"按钮，**不显示前往按钮**。
3. 校验通过：title + url 用 `textContent` 写入（防 XSS）。
4. **"立即前往"按钮**：`location.href = url`。
5. **"返回控制中心"按钮**：`location.href = "/control/"`。

### 关键决定：不做自动跳转（砍掉 2 秒倒计时）

**最初设计**有 2 秒倒计时自动跳转。但砍掉了，理由：

- 用户按浏览器后退回到 go.html 时，页面重新执行 script，`setTimeout` 又跑倒计时又跳外部站——
  **"后退"变成"又跳走"，用户回不来**。这让方案 A 的核心价值（回来路径）失效。
- 解法是用 `performance.navigation.type` / `pageshow.persisted` 判断前进 vs 后退，但 **Electron
  webview 的 bfcache / navigation API 行为不可靠**，没有稳妥的判定方式。
- **权衡**：自动跳转是 nice-to-have，"后退不重跳"是 must-have。多一次"立即前往"点击完全
  可接受，彻底消除后退死循环风险。**YAGNI，砍掉倒计时。**

### 透明背景

go.html 复用控制中心视觉（透壁纸）。内联精简版透明 CSS（`body { background: transparent }`），
不引整个 control.css（go.html 极简，减少依赖）。

---

## 8. 错误处理与边界

### 处理的边界

**边界 1：URL 校验失败（用户输入）**

| 输入 | normalizeUrl 结果 | 前端反馈 |
|---|---|---|
| `github.com` | `{ok:true, url:"http://github.com/"}` | 加入 |
| `https://github.com` | `{ok:true, url:"https://github.com/"}` | 加入 |
| `  GitHub.com  ` | trim → `{ok:true}` | 加入 |
| `http://中文.com` | punycode → `{ok:true}` | 加入 |
| `localhost:3000` | 补 http:// → `{ok:true}` | 加入 |
| `javascript:alert(1)` | 协议白名单 → `{ok:false}` | 红字，不加 |
| `data:text/html,...` | `{ok:false}` | 红字，不加 |
| `file:///C:/x` | `{ok:false}` | 红字，不加 |
| `ftp://example.com` | `{ok:false}` | 红字，不加 |
| 空字符串 | `{ok:false, error:"网址不能为空"}` | 红字 |
| `not a url at all` | 补 http:// 后 new URL 抛 → `{ok:false}` | 红字 |

错误消息走 `#bm-msg`（`.err` class，2 秒自动清），不阻塞。

**边界 2：localStorage 异常**

- `localStorage` 禁用/满（QuotaExceeded）：`setBookmarks` try/catch 吞，但加书签操作给反馈——
  catch 后 `#bm-msg` 显示"保存失败（存储不可用）"。读取失败返回 `[]`（仿 shelf 模式）。
- JSON 坏了：`getBookmarks()` try/catch 返回 `[]`，**不自动修复**（YAGNI）。

**边界 3：端口漂移**——天然免疫。回来路径用相对路径 `"/control/"`，不带端口，端口漂移
（17890→17891）不影响。用户本地服务书签（如 `http://127.0.0.1:17890/某服务`）失效是用户
自己的地址，不是书签功能责任。

**边界 4：go.html URL 参数异常**——见 §5 决策 4 + §7 交互逻辑 2（二次校验兜底）。

**边界 7：title/url 过长**

- title 过长：CSS `word-break: break-all`，列表项自然换行。不截断。
- url 过长：列表那行 `text-overflow: ellipsis` + `title` 属性显示完整。**存不截断，渲染截断显示**。

### 不处理的边界（记入 spec）

- **边界 5**：外部站打不开/加载失败——webview 跳走后控制中心无感知，外部成败是网络/站点的事。
- **边界 6**：重复添加——允许，不去重（用户可能想要同 host 不同路径的两个）。
- **边界 8**：多 webview 标签并发编辑——现有书架也这模式没报过问题，每次 poll（2 秒）重渲染兜底。

---

## 9. 测试策略

项目测试哲学（AGENTS.md 教训 12-15）：**纯函数抽出来单测，跨进程胶水 + DOM/导航行为靠真机**。

### 第一层：bookmark.js 纯函数单测（必做，新建 `test/bookmarktest.cjs`）

仿 `test/shelftest.cjs` 风格，覆盖：

**`normalizeUrl(input)`**（最关键，XSS 防线）：
```
✓ "github.com"           → {ok:true, url:"http://github.com/"}
✓ "https://github.com"   → {ok:true, url:"https://github.com/"}
✓ "  GitHub.com  "       → {ok:true, url:"http://github.com/"} (trim)
✓ "http://中文.com"       → {ok:true} (punycode)
✓ "localhost:3000"       → {ok:true, url:"http://localhost:3000/"}
✓ "127.0.0.1:8080"       → {ok:true, url:"http://127.0.0.1:8080/"}
✓ "javascript:alert(1)"  → {ok:false} (协议白名单)
✓ "data:text/html,x"     → {ok:false}
✓ "file:///C:/x"         → {ok:false}
✓ "ftp://example.com"    → {ok:false}
✓ "vbscript:msgbox"      → {ok:false}
✓ ""                     → {ok:false}
✓ "   "                  → {ok:false}
✓ "not a url at all"     → {ok:false}
```

**`buildGoUrl(url, title?)`**：
```
✓ buildGoUrl("http://github.com/") → 含 encodeURIComponent 的 url 参数
✓ buildGoUrl("http://x.com/a?b=c&d=e") → & = # 正确编码
✓ buildGoUrl("http://x.com/", "My Title") → 含 title 参数
✓ buildGoUrl("http://x.com/", undefined) → 不含 title 参数
```

**localStorage 纯函数**（getBookmarks/addBookmark/removeBookmark）：
```
✓ 空存储 → []
✓ 坏 JSON → []
✓ addBookmark → 写入 + 返回 entry（id/title/url/createdAt 齐全）
✓ addBookmark 重复 URL → 两个条目都存在（钉死不去重）
✓ removeBookmark(id) → 删目标，其他不动
✓ removeBookmark 不存在的 id → 无副作用
✓ id 唯一性 → 连续 addBookmark 两次，id 不同
✓ 排序 → createdAt 升序稳定
```

**localStorage mock 注入**：bookmark.js 用模块级 `let store`，默认指向 `window.localStorage`，
导出 `_setStore(mock)` 供测试注入内存 mock（仿 shelftest 的可测性手法）。

### 第二层：server 路由单测（并入现有 controlservertest.cjs）

```
✓ GET /control/go → 302, Location: /control/go.html
✓ GET /control/go.html → 200, text/html（静态托管已覆盖，确认）
```

钉死"go.html 能被静态托管 + go 重定向"，仿 readerservertest 对 `/reader` → `/reader/` 的断言
（教训 18a 回归测试风格）。

### 第三层：go.html 二次校验——靠真机

go.html 的校验逻辑**内联在 HTML 里**（自包含，不依赖 bookmark.js），不像 bookmark.js 是独立
可 require 模块。**不做单测**，靠真机验证。理由：
- go.html 逻辑极简，抽出来单测要破坏自包含性。
- 二次校验是"双保险"，第一保险（bookmark.js）已单测覆盖核心规则。
- 教训 17：两份相同逻辑靠同步维护，bookmark.js 单测间接覆盖。

### 第四层：真机验证清单（必做）

**控制中心书签面板：**
1. [ ] 加书签（输 URL 不输名字）→ 列表出现，名字自动用 host
2. [ ] 加书签（输名字 + URL）→ 正常显示
3. [ ] 加非法 URL（`javascript:alert(1)`）→ 红字报错，不加
4. [ ] 加非法 URL（`not a url`）→ 红字报错
5. [ ] 删书签 → 列表立即更新
6. [ ] 回车键提交（URL 输入框按 Enter）→ 触发添加
7. [ ] localStorage 持久（刷新控制中心，书签还在）

**中转页 go.html：**
8. [ ] 点书签 → 跳到 go.html，显示 title + url + 两按钮
9. [ ] 点"立即前往"→ 跳外部站
10. [ ] 点"返回控制中心"→ 回到 `/control/`
11. [ ] **在外部站按浏览器后退 → 回到 go.html，不自动重跳**（最关键，钉死砍倒计时的决定）
12. [ ] 再后退一次 → 回到 control/index
13. [ ] 手输 `/control/go.html?url=javascript:alert(1)` → 显示"无效链接"，不执行（二次校验）
14. [ ] 手输 `/control/go.html`（无 url）→ 显示"无效链接" + 返回按钮

**外部站实际访问（验证用户最初的需求前提）：**
15. [ ] 一个真实 HTTPS 站（如 github.com）→ 能在 webview 打开
16. [ ] 一个真实 HTTP 站 → 能打开（验证自动补 http:// 不影响访问）

**最关键真机验证点：**
- **第 11 条**——后退不重跳是方案 A "回来路径"成立的基础。真机必须重点验，若失败整个方案 A 失败。
- **第 13 条**——go.html 二次校验，防 XSS 最后一道。
- **第 15/16 条**——验证 webview 确实能访问外部互联网（用户最初需求前提）。

### 不测的（对齐项目惯例）

- Win32 / webview 导航历史行为——OS/Chromium 行为，靠真机（教训 14）。
- 外部站加载结果——不在职责内（边界 5）。
- localStorage 配额异常——极小概率，try/catch 兜底，不造场景测。
- go.html 内联校验——靠真机 + bookmark.js 同款逻辑单测间接覆盖。

### npm test 集成

`package.json` test 脚本追加 `bookmarktest.cjs`，位置排在 `controlservertest` 之后
（书签依赖 control-server，逻辑顺序合理）。

---

## 10. 实现顺序（建议）

1. `control/lib/bookmark.js` + `test/bookmarktest.cjs`（纯函数先 + 测试，TDD）
2. `lib/control-server.cjs` 加 `/control/go` 重定向 + server 单测断言
3. `control/go.html`（中转页，自包含）
4. `control/index.html` + `control/control.js` + `control/control.css`（面板接线）
5. `package.json` 加 `bookmarktest` 到 test 脚本
6. 真机验证清单 16 条（重点 11/13/15/16）
