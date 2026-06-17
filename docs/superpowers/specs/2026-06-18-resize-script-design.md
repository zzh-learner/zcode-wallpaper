# 设计文档：壁纸缩图脚本（resize.bat + resize.cjs）

**日期**：2026-06-18
**状态**：待评审
**目标**：提供缩图脚本，把 `wallpapers/` 里的相机原图（30-39MB）批量缩成 Electron 能渲染的小图（~1-3MB），输出到 `wallpapers-thumb/`，inject 改读该目录。

---

## 1. 背景与动机

随机壁纸功能上线后，实测发现"启动后看不到壁纸"。系统化调试定位根因：

- inject 注入成功、CSS 正确、body 背景图路径正确、文件存在、透明度规则全部生效
- 用纯红色 body 背景测试 → **窗口变红了**，证明 body 背景能正常显示、无遮挡层
- 排除所有 CSS/注入/路径问题后，唯一变量是图本身
- 检查文件：33 张图全部 **30-39MB**（相机原图，6000×4000 级别），合法 JPEG 但体积过大
- 根因：Electron/Chromium 的 `background-image: url(file:///...)` 加载本地超大图时解码失败（38MB JPEG 解码后是几百 MB 位图，触发内存/尺寸限制），背景图静默加载失败

用户明确要"加缩图脚本"而非手动缩图。本设计提供独立的 resize 脚本解决这个问题。

---

## 2. 范围

**包含：**
- `resize.bat` + `resize.cjs`：增量缩图（sharp 库，2560px/质量85，输出 jpg 到 wallpapers-thumb/）
- `resizetest.cjs`：resize 纯函数自检（5 项）
- `inject.cjs` 改动：listWallpapers 读取目录从 wallpapers/ 改成 wallpapers-thumb/
- `.gitignore`：忽略 wallpapers-thumb/
- `package.json`：加 sharp 依赖、test 串入 resizetest
- `README.md`：新增缩图说明、文件表、验证状态

**不包含：**
- 运行时自动缩图（明确排除——独立脚本手动跑，职责清晰）
- svg/gif 缩图（动画/矢量不适合栅格化缩放，不支持）
- 保留源扩展名（统一输出 .jpg，体积最小）

---

## 3. 架构

### 目录布局
```
wallpapers/          ← 用户放原图（gitignore，源，30-39MB）
wallpapers-thumb/    ← resize 产物（gitignore，inject 读这里，~1-3MB）
```

### 工作流
```
用户加图到 wallpapers/
  → 双击 resize.bat
       → 扫 wallpapers/ 原图
       → 增量：wallpapers-thumb/ 已有同名且 mtime ≥ 源的就跳过
       → 否则 sharp 缩到 2560px / 质量85 → 输出 wallpapers-thumb/<basename>.jpg
  → 双击 start-zcode.bat
       → inject 从 wallpapers-thumb/ 随机选一张缩图注入
```

### 职责划分
- **resize.cjs**：原图 → 缩图（栅格化、降体积）
- **inject.cjs**：缩图 → 注入（从 wallpapers-thumb/ 随机选）
- **wallpapers/ 与 wallpapers-thumb/ 分离**：源与产物不混，原图不被破坏

---

## 4. resize.cjs 详细逻辑

### 4.1 常量与纯函数

```js
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];  // 不含 .gif/.svg
const MAX_WIDTH = 2560;
const JPEG_QUALITY = 85;

// 列出源目录的栅格图片文件名。
function listSourceImages(dir) {
  try {
    var entries = fs.readdirSync(dir);
  } catch (e) {
    return [];
  }
  return entries.filter(function (name) {
    var ext = path.extname(name).toLowerCase();
    return IMAGE_EXTS.indexOf(ext) !== -1;
  });
}

// 判断某张图是否需要缩（增量判断）。
//   thumb 存在 且 thumb.mtime >= src.mtime → false（跳过）
//   否则 → true（需缩）
function needsResize(srcPath, thumbPath) {
  try {
    var srcStat = fs.statSync(srcPath);
    var thumbStat = fs.statSync(thumbPath);
    return thumbStat.mtimeMs < srcStat.mtimeMs;
  } catch (e) {
    return true;  // thumb 不存在或 stat 失败 → 要缩
  }
}

// 用 sharp 缩一张：长边 ≤ 2560，输出 JPEG 质量 85。
async function resizeOne(srcPath, thumbPath) {
  await sharp(srcPath)
    .resize({
      width: MAX_WIDTH,
      height: MAX_WIDTH,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toFile(thumbPath);
}
```

### 4.2 main() 流程

```js
async function main() {
  var srcDir = path.join(__dirname, "wallpapers");
  var thumbDir = path.join(__dirname, "wallpapers-thumb");

  console.log("[wallpaper] Step 1: scan source images");
  var images = listSourceImages(srcDir);
  if (images.length === 0) {
    console.log("[wallpaper]   wallpapers/ 为空，没图可缩。把图放进 wallpapers/ 后重跑。");
    process.exit(0);
  }
  console.log("[wallpaper]   found " + images.length + " images");

  console.log("[wallpaper] Step 2: ensure wallpapers-thumb/");
  fs.mkdirSync(thumbDir, { recursive: true });

  console.log("[wallpaper] Step 3: resize (skip already-resized)");
  var added = 0, skipped = 0, failed = 0;
  for (var i = 0; i < images.length; i++) {
    var name = images[i];
    var srcPath = path.join(srcDir, name);
    var base = name.replace(/\.[^.]+$/, "");  // 去扩展名
    var thumbPath = path.join(thumbDir, base + ".jpg");
    if (!needsResize(srcPath, thumbPath)) {
      skipped++;
      continue;
    }
    try {
      await resizeOne(srcPath, thumbPath);
      var kb = Math.round(fs.statSync(thumbPath).size / 1024);
      console.log("[wallpaper]   " + base + ".jpg  (" + kb + " KB)");
      added++;
    } catch (e) {
      console.error("[wallpaper]   " + name + " FAILED: " + e.message);
      failed++;
    }
  }

  console.log("[wallpaper] ========================================");
  console.log("[wallpaper]  缩图完成: 新增 " + added + " / 跳过 " + skipped + " / 失败 " + failed);
  console.log("[wallpaper]  inject 会从 wallpapers-thumb/ 随机选图");
  console.log("[wallpaper] ========================================");
  process.exit(failed > 0 ? 1 : 0);
}

module.exports = { listSourceImages, needsResize, MAX_WIDTH, JPEG_QUALITY };
if (require.main === module) {
  main().catch(function (e) { console.error(e); process.exit(1); });
}
```

### 4.3 输出扩展名约定

源图无论什么格式（jpg/jpeg/png/webp），缩图产物**统一输出 `.jpg`**：
- JPEG 对照片类壁纸体积最小
- inject.listWallpapers 认 .jpg
- 增量比对靠 basename（去扩展名）匹配：源 `a.png` → thumb `a.jpg`，调用方负责 `thumbPath = base + ".jpg"`

---

## 5. inject.cjs 改动

### 5.1 listWallpapers 读取目录

inject.cjs main() 里（MODE === "inject" 分支）：
```js
// 当前：
var wallpapersDir = path.join(__dirname, "wallpapers");
// 改为：
var wallpapersDir = path.join(__dirname, "wallpapers-thumb");
```

### 5.2 空目录提示文案

inject.cjs main() 空目录分支，当前：
```js
console.log("[wallpaper] 把图片放进 " + wallpapersDir + " 后重跑 inject-only.bat。");
```
改为：
```js
console.log("[wallpaper] wallpapers-thumb/ 为空。双击 resize.bat 生成缩图后再启动。");
console.log("[wallpaper] （把原图放进 wallpapers/，resize 会自动缩到 wallpapers-thumb/）");
```

### 5.3 降级行为

用户没跑过 resize → wallpapers-thumb/ 不存在 → listWallpapers 返回 [] → 不注入 + 清晰提示。不崩。✓

### 5.4 selftest 影响

selftest 测的是 inject 的 listWallimages/toFileUrl/pickRandom 纯函数（接收 dir 参数），函数逻辑没变，测试不受影响。✓

---

## 6. 其他文件改动

### 6.1 .gitignore

加：
```
# Resized wallpaper thumbnails (generated by resize.cjs from wallpapers/)
wallpapers-thumb/
```

### 6.2 package.json

- dependencies 加 `"sharp": "^0.33.5"`（或当前稳定版）
- scripts.test 改为：
```json
"test": "node selftest.cjs && node cdp-mock-test.cjs && node setuptest.cjs && node resizetest.cjs"
```

### 6.3 README.md

**a) 新增「缩图（重要）」一节**（紧跟「壁纸图（随机轮播）」之后）：
- 相机原图（30-39MB）Electron 渲染不动，必须先缩图
- 双击 `resize.bat`：扫 wallpapers/ → 缩到 2560px/质量85 → 输出 wallpapers-thumb/
- 增量：重复跑只缩新图
- 加新图完整流程：图放 wallpapers/ → resize.bat → start-zcode.bat

**b)「壁纸图（随机轮播）」补一句**：inject 实际从 wallpapers-thumb/（缩图产物）读，先跑 resize.bat。

**c) 文件说明表加 3 行**：resize.bat / resize.cjs / resizetest.cjs

**d) 验证状态加一行**：`resize 逻辑自检 node resizetest.cjs → 5/5 通过`

**e) 安装/setup 一节**：说明 sharp 随 setup 的 npm install 一起装。

---

## 7. 测试策略

### 7.1 resizetest.cjs（5 项纯函数自检）

| 测试项 | 被测 | 断言 |
|--------|------|------|
| listSourceImages 空目录 | listSourceImages(不存在) | `[]` |
| listSourceImages 过滤扩展名 | 临时目录 a.jpg + b.txt + c.png + d.svg | `["a.jpg","c.png"]`（不含 d.svg） |
| needsResize thumb 不存在 | needsResize(src, 不存在thumb) | `true` |
| needsResize thumb 比 src 新 | 先建 src 后建 thumb | `false` |
| needsResize thumb 比 src 旧 | 先建 thumb 后改 src mtime | `true` |

用 mkdtempSync 建真实临时目录、测完 rmSync 清理。不测真实 sharp（慢 + 依赖环境），靠手动验证。

### 7.2 不测的部分
- 真实 sharp 缩图：慢、依赖 sharp 安装、要真实图。靠 §7.3 手动验证。
- resize.bat 的 node 预检：批处理难自动化，靠代码审查 + 手动验证。

### 7.3 手动验证清单（实现后执行）
1. `node -e "require('sharp');console.log('sharp ok')"` → sharp 装好
2. `npm test` → selftest 13 + cdp-mock 3 + setuptest 4 + resizetest 5 = 25 项全过
3. `node resize.cjs` → 33 张图缩到 wallpapers-thumb/，每张 ~1-3MB
4. 重复跑 resize → 增量（added=0 skipped=33）
5. 往 wallpapers/ 加 1 张新图 → resize → added=1 skipped=33
6. `node inject.cjs` → 从 wallpapers-thumb/ 随机选、注入成功
7. CDP 探针验证 body 背景图指向 wallpapers-thumb/ 某图 + file exists
8. **ZCode 窗口实际看到壁纸**（缩图后体积小，Electron 能渲染）

---

## 8. 文件清单（实现产出）

| 文件 | 类型 | 说明 |
|------|------|------|
| `resize.bat` | 新增 | 薄入口（预检 node + 调 cjs） |
| `resize.cjs` | 新增 | 增量缩图逻辑（sharp，module.exports + require.main 守卫） |
| `resizetest.cjs` | 新增 | 5 项纯函数自检 |
| `inject.cjs` | 改 | listWallpapers 读 wallpapers-thumb/ + 空目录提示文案 |
| `.gitignore` | 改 | 加 wallpapers-thumb/ |
| `package.json` | 改 | 加 sharp 依赖 + test 串 resizetest |
| `README.md` | 改 | 新增缩图节 + 文件表 + 验证状态 + 安装说明 |

---

## 9. 错误处理 & 边界情况

| 情况 | 处理 | 退出码 |
|------|------|--------|
| wallpapers/ 不存在或空 | 打印"没图可缩" + exit 0 | 0 |
| wallpapers/ 有图 | 缩图，按结果 | 0/1 |
| 某张图 sharp 处理失败（损坏/不支持） | 打印 FAILED + failed++，继续处理剩余图；最后 `exit(failed > 0 ? 1 : 0)`，即有任何失败就非 0 | 1（若有失败） |
| sharp 未安装（npm install 没跑） | require('sharp') 抛错，main().catch 兜底打印 | 1 |
| 重复跑 resize | 增量跳过已缩的（mtime 比对） | 0 |
| 原图被替换（同名新内容，mtime 更新） | needsResize 返回 true，重缩覆盖旧 thumb | 0 |
| wallpapers-thumb/ 被手动删 | 下次 resize 全量重生成 | 0 |
| inject 时 wallpapers-thumb/ 不存在 | listWallpapers 返回 []，不注入 + 提示跑 resize | 0 |

---

## 10. 设计决策记录

- **为何用 sharp**：业界标准（libvips 底层），快、稳、有预编译二进制无需本地编译。jimp 纯 JS 但极慢（38MB 图要好几秒/张）；ImageMagick 要用户预装，Windows 默认没有。
- **为何独立 resize 脚本而非 inject 自动缩**：缩图是日常维护操作（加图后跑一次），与 inject（每次启动跑）职责不同；独立脚本职责清晰、用户可控时机、inject 保持轻快。
- **为何输出到 wallpapers-thumb/ 而非覆盖原图**：源与产物分离，原图不被破坏；用户可随时清空 thumb 重新生成。
- **为何统一输出 .jpg**：JPEG 对照片体积最小；inject 已认 .jpg；统一扩展名简化增量比对（basename 匹配）。
- **为何不缩 svg/gif**：svg 是矢量（缩放无意义，且 sharp 栅格化 svg 需额外依赖）；gif 可能是动画（缩会丢帧）。两者作为壁纸极少见，YAGNI。
- **为何 2560px/质量85**：覆盖 2K/高分屏，体积压到 1-3MB Electron 轻松渲染，画质在主流屏幕看不出与原图差别。
- **为何 mtime 比对做增量**：简单可靠，不需要额外的 hash/manifest 文件；覆盖了"新增图"和"原图被替换"两种场景。
- **为何 inject 改读 thumb 后用红色测试法定位根因**：当时 CSS/路径/文件都对但图不显示，红色 body 测试是决定性诊断——变红证明 body 背景能显示，从而锁定问题是图本身（体积过大）而非 CSS/遮挡。
