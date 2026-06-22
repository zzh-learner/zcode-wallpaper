# 交接文档：视频→图片切换声音残留修复

> **分支**：`main`（已合并并推送，commit `e7b7c88`）
> **日期**：2026-06-22
> **状态**：✅ 已修复 + 已真机验证 + 已提交推送
> **前置分支**：`feat/video-wallpaper-audio`（给视频壁纸加声音的那次）

---

## 1. 这个修复做了什么

修一个**视频→图片切换时声音残留**的 bug：

- **现象**：先注入视频壁纸（有声），再注入图片壁纸 → 画面已经是图片了，
  **但旧视频的声音还在响**。
- **根因**：图片注入的 `buildExpression("inject", ...)` 原本只清旧的 `<style>`，
  不清旧的 `<video>` 元素。旧视频留在 DOM 里继续播放，声画不同步。
- **修复**：图片注入前也清掉 `VIDEO_EL_ID`，和 `--remove` / 视频注入对称。

这是 AGENTS.md 教训 1 的第 N 次重演——**同型清理逻辑只在 2/3 路径上有，
第三条就能各自再坏一次**。`--remove` 和视频注入都清两个元素（style + video），
图片注入只清一个，于是从视频切到图片时 video 漏网。

## 2. 改动一览（5 个文件）

| 文件 | 改动 |
|---|---|
| `lib/inject.cjs` | `buildExpression` 的 inject 分支加一行 `getElementById(VIDEO_EL_ID).remove()` |
| `test/selftest.cjs` | 新增 Test 4e：视频注入后再图片注入，验旧 `<video>` 被清掉（fake DOM 层） |
| `test/cdp-mock-test.cjs` | 新增第 5 步：视频→图片切换时，图片注入表达式引用 `VIDEO_EL_ID`（端到端） |
| `AGENTS.md` | "两个 id 一个 --remove" → "三个清理点一个目标"（补图片注入这条路径）；selftest/cdp-mock 测试描述补 Test 4e / 第 5 步 |
| `README.md` | 视频声音章节加"切换到图片会自动停声音"；移除章节加对称说明 |

## 3. 三条清理路径（修复后的对称设计）

**任意一条注入/移除路径都必须同时清掉这两个 id**（不管当前注的是图还是视频）：

| 路径 | 清 `<style>` | 清 `<video>` |
|---|---|---|
| `--remove`（`buildExpression("remove", ...)`） | ✅ 原本就有 | ✅ 原本就有 |
| 视频注入（`buildVideoExpression`） | ✅ 原本就有 | ✅ 原本就有 |
| **图片注入（`buildExpression("inject", ...)`）** | ✅ 原本就有 | ✅ **本次修复新增** |

用户不用记自己用了哪个模式、从哪个模式切过来。任一路径都保证两条腿走路。

## 4. 为什么单测当初没抓到

`selftest.cjs` 当时覆盖了：
- ✅ 图→图（Test 1/2/4）
- ✅ video 注入（Test 4b/4c）
- ✅ remove 清两个元素（Test 4d）

**唯独漏了"视频→图片"这个交叉 case**——图片注入的清理路径只在"从图片来"的上下文里测过，
没在"从视频来"的上下文里测过。所以图片注入漏清 video 的 bug 溜进来了。

这正是 AGENTS.md 教训 1/12 的同型：**单测覆盖的边界 = 你想到的边界，想不到的交叉 case 是盲区**。
本次修复用 Test 4e（fake DOM）+ cdp-mock 第 5 步（端到端）把这个 case 钉死。

## 5. 验证状态

### 单测（代码层）

```bash
npm test
```

期望全绿，关键的新增断言：
- `selftest`: `video->image: old <video> removed (no leftover audio)` ✓
- `cdp-mock-test`: `video->image: image inject expression references video id (cleanup)` ✓
- `cdp-mock-test`: `video->image: image inject did NOT create a new <video>` ✓

### 真机验证（已通过）

1. 双击 `wallpaper.bat` → 选 `7 启动带视频壁纸` → 听到视频声音 ✓
2. 双击 `start.vbs` → 控制中心 → 点"注入图片壁纸"
3. **画面切到图片，声音立即停止** ✓

跨进程胶水（CDP `Runtime.evaluate` → 真实 DOM `<video>.remove()` → 音频停止）
单测验不全（AGENTS.md 教训 12/13），这一步已真机验过。

## 6. 已知遗留

无。这次是个干净的 bug 修复，不引入新功能、不改外部接口、不动数据格式。
旧的视频壁纸/图片壁纸/移除/静音/轮播等所有功能行为不变。

## 7. 快速回退（如果某个场景反而坏了）

```bash
git revert e7b7c88
git push origin main
```

revert 后会回到修复前的状态：图片注入只清 `<style>`，视频→图片切换时声音会残留。
（即恢复到 `feat/video-wallpaper-audio` 合入时的行为。）

如果只是某次切换没停声音，先排查：
- 是不是 ZCode 没带 debug port 启动（图片注入走 CDP，端口不通注入根本没生效）
- 是不是同时有多个 page target（多个窗口时 inject 会遍历所有 target，确认每个都注入了图片）
- 控制台（F12）看图片注入的 fetch 响应是不是 `affected > 0`

---

**联系**：这个修复已完整交付（代码 + 测试 + 文档 + 真机验），无需后续动作。
如果发现新场景下仍有声音残留，回到本会话贴现象，单独排查。
