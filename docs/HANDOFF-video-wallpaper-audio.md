# 交接文档：视频壁纸加声音 — 新机部署测试

> **分支**：`feat/video-wallpaper-audio`（已推送远程，未 merge main）
> **日期**：2026-06-22
> **状态**：代码 + 单测完成（全绿），**待真机验证（Task 0 + Task 7）**
> **设计 spec**：`docs/superpowers/specs/2026-06-22-video-wallpaper-audio-design.md`
> **实施 plan**：`docs/superpowers/plans/2026-06-22-video-wallpaper-audio.md`

---

## 1. 这个分支做了什么

给视频壁纸加了**声音**（之前强制静音）：

- **默认有声**：启动 ZCode 时带 `--autoplay-policy=no-user-gesture-required` flag，让 unmuted 视频能自动播。
- **自动降级**：如果 flag 没生效（直接双击开的 ZCode），视频自动降级回静音，保证至少有画面。
- **实时切静音**：控制中心加"🔇 静音 / 🔊 取消静音"按钮，点一下瞬间切（不重建视频元素、不闪屏）。
- **状态显示**：状态条显示"视频壁纸 | 🔊 有声 / 🔇 静音"。

## 2. 新机前置要求

| 项 | 要求 |
|---|---|
| OS | Windows（本项目是 Windows-only，用了 Win32 + .bat） |
| Node.js | v18+（https://nodejs.org 下 LTS） |
| ZCode 客户端 | 已安装 |
| Git | 已安装，能 clone/pull |
| 一个带声音的视频 | `.mp4`（或 `.webm`/`.mov`），**文件名纯英文**（中文路径在 file:// 可能翻车） |
| 音频输出 | 能听声音（耳机/音箱，别用静音的蓝牙设备） |

## 3. 部署步骤（一步步来）

### 3.1 拉代码

```bash
git clone https://github.com/zzh-learner/zcode-wallpaper.git
cd zcode-wallpaper
git fetch origin
git checkout feat/video-wallpaper-audio
git pull
```

确认在 feat 分支：
```bash
git branch --show-current
# 期望输出：feat/video-wallpaper-audio
```

### 3.2 装依赖

```bash
npm install
```

装的是 `sharp`（缩图）+ `ws`（CDP WebSocket）。如果报 sharp 的 native build 错，试 `npm install --build-from-source` 或换 Node LTS 版。

### 3.3 跑测试确认代码完整

```bash
npm test
```

**期望**：全部 PASS，无 FAIL。共 23 个测试文件，含新增的 `videomutetest.cjs`。

如果某个 FAIL，先不要继续真机验证——把失败的那条贴回来，代码可能在推送/拉取过程中出问题。

### 3.4 准备测试视频

把一个**带声音的短视频**（10-60 秒最好，体积几十 MB）放进项目根的 `wallpapers-video/` 目录。

> ⚠️ 文件名**纯英文**，如 `test-sound.mp4`。不要用中文/空格。
> ⚠️ 确认视频本身有音轨（用普通播放器先听一下）。

### 3.5 确认 ZCode 安装位置

脚本会自动探测 ZCode.exe，顺序：
1. 正在运行的 ZCode 进程路径
2. 注册表 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\ZCode.exe`
3. 常见路径：`%LOCALAPPDATA%\Programs\ZCode\ZCode.exe`、`D:\zcode\`、`C:\Program Files\ZCode\`、`C:\Program Files (x86)\ZCode\`

如果都不在，启动脚本会报 `ZCode.exe not found`，手动编辑 `bin/launch-zcode.bat` 的 `ZCODE_EXE` 变量。

---

## 4. 真机验证清单（Task 0 + Task 7 合并）

> **这是关键步骤**。代码全绿不等于功能跑得通——跨进程胶水（flag ↔ Electron ↔ play() Promise ↔ CDP）必须真机验（AGENTS.md 教训 12/13/21）。
> 每条都要实际操作，不能跳。

### 验证前：完全退出 ZCode

ZCode 是单实例，残留进程会让带 flag 的新实例起不来。**所有窗口 + 右下角托盘图标都关掉**。确认：
```bash
tasklist /fi "imagename eq ZCode.exe"
# 期望：INFO: No tasks are running ...
```

如果还有，`taskkill /f /im ZCode.exe`。

---

### ✅ 清单（8 条，逐条打勾）

#### 第 1 条【GATE】flag 生效 — 视频壁纸默认有声

**操作**：双击 `wallpaper.bat` → 选 `7 启动带视频壁纸`

**期望**：
- ZCode 弹出
- 看到视频画面
- **听到声音** ✅

**判断**：
- ✅ 有声音 → flag 生效，继续后面的条目
- ❌ 没声音（只有画面）→ flag 没生效。**停下来**，看下面"❌ 如果第 1 条没声音"小节

---

#### 第 2 条 实时静音（不闪屏）

**前提**：第 1 条通过，视频壁纸正在播（有声）。

**操作**：双击 `start.vbs`（无 cmd 黑窗）→ ZCode 浏览器面板粘 `http://127.0.0.1:17890/control/` → 点"🔇 静音"

**期望**：
- **瞬间无声**
- 视频画面**没有闪/重新加载/跳帧**
- 按钮区域显示"已静音（1/1 窗口）"

---

#### 第 3 条 实时取消静音

**操作**：点"🔊 取消静音"

**期望**：
- **瞬间有声**
- 画面不闪
- 按钮区域显示"已取消静音（1/1 窗口）"

---

#### 第 4 条 状态条同步

**操作**：点"🔇 静音"，等最多 2 秒（轮询周期）

**期望**：状态条"视频壁纸"那行显示 `视频壁纸 | 注入 1/1 | 🔇 静音`

点"🔊 取消静音"，等 2 秒 → 显示 `视频壁纸 | 注入 1/1 | 🔊 有声`

---

#### 第 5 条 非视频模式按钮禁用（移除后）

**操作**：点"移除壁纸"，等 1-2 秒

**期望**：
- 状态条显示"未注入"
- 🔇 和 🔊 按钮**都变灰（disabled）**

---

#### 第 6 条 非视频模式按钮禁用（图片模式）

**操作**：点"注入图片壁纸"

**期望**：
- 状态条显示"图片壁纸 | 注入 1/1"（**无** 🔊/🔇 标注）
- 🔇 和 🔊 按钮**都灰**

---

#### 第 7 条 flag 不破坏透明链路

**操作**：完全退出 ZCode → 双击 `wallpaper.bat` → 选 `9 启动带透明窗口` → 输透明度 `50`

**期望**：
- ZCode 启动，窗口变半透明（能看到桌面）
- **没有因 flag 报错**（flag 对透明无副作用，只是个 autoplay 策略开关）

---

#### 第 8 条 inject 后声音重置

**操作**：回到控制中心场景（重新 start.vbs + 控制中心 + 注入视频壁纸）→ 点"🔇 静音"确认无声 → 点"注入视频壁纸"换一个

**期望**：
- 新视频**默认有声**（mute 状态不跨 inject 持久化，这是设计决定，不是 bug）

---

## 5. 验证结果处理

### ✅ 如果 8 条全过

功能完成。在新机上告诉我（或直接回到原机器告诉我），我用 finishing-a-development-branch 技能帮你 merge `feat/video-wallpaper-audio` 到 main。

### ❌ 如果第 1 条没声音（flag 没生效）

**这是最关键的情况**。说明 Electron 不透传 `--autoplay-policy` flag，或 ZCode 用 webPreferences 覆盖了。

**不要继续后面 7 条**（都没意义）。收集这些信息贴回来：

1. `zcode-launch.log` 的内容（项目根目录）：
   ```bash
   type zcode-launch.log
   ```
2. ZCode 的版本（帮助/关于里看）
3. 启动时 cmd 窗口的完整输出（如果用 wallpaper.bat 跑的）

**下一步**：开方案 B 的 spec（用户手势路线——注入时 muted，等用户点一下再 unmute）。当前 feat 分支**不 merge main**，但代码本身是安全的（会自动降级回 muted，行为和原来一样）。

### ⚠️ 如果第 1 条过了但后面某条不符

把不符合的那条的**现象 + 期望**贴回来，单独排查那条。常见可能：
- 第 2/3 条静音切换不生效：检查控制台（F12）看 fetch `/api/action muteVideo` 的响应
- 第 4 条状态不更新：刷新控制中心 webview（F5），可能是轮询时序
- 第 8 条新视频没声音：可能是那个视频本身音轨问题，换个视频试

---

## 6. 实施中的偏离记录（给排查用）

代码实施时和 plan 有 3 处偏离，都是合理的修正，不是 bug：

1. **Task 2 selftest 断言**：plan 写 `indexOf("v.muted=true;") === -1` 太严（catch 回退路径本来就该有 `v.muted=true`）。改成"恰好 2 次，都在 fallback 路径内"。
2. **Task 5 controlservertest 断言**：plan 假设测试环境 CDP 不通，但实测 9222 可能有响应。改成不假设 accepted 值，只验"路由正确 + 响应是即时路径（无 jobId）"。
3. **Task 5 await 语法**：plan 用 `await` 但 `/api/action` 的回调不是 async。改用 `.then().catch()` 链，不动回调签名。

---

## 7. 文件改动一览（给 code review 用）

| 文件 | 改动 |
|---|---|
| `bin/launch-zcode.bat` | Step 2 加 `--autoplay-policy=no-user-gesture-required` flag |
| `lib/inject.cjs` | `buildVideoExpression` 去强制 muted，加 `play().catch` 自动降级 |
| `lib/cdp.cjs` | `classifyWallpaperDom` 返回 `{mode, videoMuted}`；`probeWallpaperMode` DOM 查询加 `videoMuted` 字段 |
| `lib/status.cjs` | `probeZcodeAndWallpaper` 透传 `videoMuted` 到 wallpaper 快照 |
| `lib/video-mute.cjs` | **新建**：实时切静音（`buildMuteExpression` + `setVideoMuted`） |
| `lib/control-server.cjs` | 加 `muteVideo`/`unmuteVideo` 即时 action（走 video-mute.cjs，非 spawn） |
| `control/index.html` | 加 🔇 静音 / 🔊 取消静音 按钮 |
| `control/control.js` | poll 里根据 `videoMuted` 切按钮 disabled；click 处理对 mute 响应结构友好 |
| `control/lib/status-view.js` | video 模式状态条加 🔊 有声 / 🔇 静音 标注 |
| `test/selftest.cjs` | Test 4b 去 muted 断言；Test 4c 改为"v.muted=true 只在 fallback"精确断言 |
| `test/cdptest.cjs` | classifyWallpaperDom 断言改为 `.mode` + `videoMuted` 字段 |
| `test/videomutetest.cjs` | **新建**：测 buildMuteExpression 纯函数 + fake DOM 执行 |
| `test/controlservertest.cjs` | 加 muteVideo/unmuteVideo action 路由断言 |
| `test/statusviewtest.cjs` | 加 videoMuted 显示断言 |
| `package.json` | test 串加 `videomutetest` |
| `README.md` | 视频壁纸章节加"声音"小节；控制中心动作按钮加 🔇/🔊；文件表加 video-mute.cjs |
| `AGENTS.md` | 视频壁纸章节加"默认有声"+"实时切静音"小节；测试章节加 videomutetest；修正旧的 muted 描述 |

---

## 8. 快速回退（如果完全不想用这个功能）

```bash
git checkout main
```

main 分支完全没有这些改动，行为和原来一模一样（视频壁纸静音）。feat 分支留在远程不影响 main。

---

**联系**：验证完任何结果（全过 / 第 1 条没声音 / 某条不符），回到原会话告诉我，我接着处理（merge / 开方案 B / 排查）。
