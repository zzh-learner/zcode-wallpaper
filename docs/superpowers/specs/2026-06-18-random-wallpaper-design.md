# 设计文档：启动时随机壁纸（取消固定路径）

**日期**：2026-06-18
**状态**：待评审
**目标**：取消 wallpaper.svg 固定测试图与手动路径配置，改为 inject 时从 `wallpapers/` 目录随机选一张图；目录为空则不注入，ZCode 保持默认外观。

---

## 1. 背景与动机

上一轮迭代（setup 脚本）引入了"setup 把本机绝对路径填进 wallpaper.css 的占位符"的机制。实际使用中发现两个问题：

1. **路径脆弱**：wallpaper.css 里的绝对路径一旦被手动编辑就容易出错（上一会话就遇到 `.jpg` 扩展名被弄丢、导致壁纸不显示的 bug）。任何路径写法都依赖用户正确维护 file:/// 形式。
2. **单图固定**：只能用一张图，用户其实有 34 张壁纸想轮换。

本次改用"目录驱动 + 随机选图"消除路径维护负担：用户只管往 `wallpapers/` 加图/删图，inject 启动时自动随机选一张。目录空就完全不注入，回到 ZCode 原生外观。

---

## 2. 范围

**包含：**
- inject.cjs 加扫描+随机选图逻辑；空目录跳过注入
- inject.cjs 加 `require.main === module` 守卫（为可测性）
- wallpaper.css 去掉 background-image 行与占位符
- setup.cjs 删除占位符替换相关代码（toFileUrl/hasPlaceholder/replacePlaceholder/Step 4）
- setuptest.cjs 删除对应测试项
- selftest.cjs 加 inject 选图纯函数测试
- 删除 wallpaper.svg 文件；.gitignore 清理 `!wallpaper.svg`
- README 更新

**不包含：**
- 运行时定时切换（明确排除——仅"启动时随机选一张"）
- 可复现随机（--seed 之类，YAGNI）
- 新建独立 injecttest.cjs（测试并入 selftest.cjs）

---

## 3. 架构

新行为流：

```
用户双击 start-zcode.bat
  → 启动带调试端口的 ZCode（不变）
  → 调 node inject.cjs
       → [新] 扫描 wallpapers/ 图片扩展名
       → [新] 空：打印提示，不注入，exit 0
       → [新] 非空：随机选一张，读 wallpaper.css + 追加 background-image 规则
       → 连 CDP 注入（不变）
```

职责划分：
- **wallpaper.css**：只管样式偏好（透明度、主题变量、背景尺寸/定位/重复/固定）。不再含具体图路径。
- **inject.cjs**：管"用哪张图"——扫描、随机、动态追加 background-image 规则。
- **setup.cjs**：只管环境（node 版本、ZCode 探测、wallpapers 目录、依赖）。不再碰 wallpaper.css。

---

## 4. inject.cjs 详细改动

### 4.1 新增常量与函数（顶部，require 之后）

```js
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"];

// Convert a Windows absolute path to a file:/// URL.
// "C:\\a\\b" -> "file:///C:/a/b"  (prefix + backslash -> slash)
function toFileUrl(p) {
  return "file:///" + String(p).replace(/\\/g, "/");
}

// List image filenames in dir (by extension). Returns [] if dir missing/empty.
function listWallpapers(dir) {
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

// Pick a random item. Returns null for empty list.
function pickRandom(items) {
  if (items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)];
}
```

### 4.2 导出纯函数（文件末尾，加守卫）

inject.cjs 现在是顶层直接调 main()。改为：

```js
module.exports = { toFileUrl, listWallpapers, pickRandom };

if (require.main === module) {
  main();
}
```

（把原来 `main();` 的顶层调用替换掉）

### 4.3 main() 选图分支

在 main() 开头加选图逻辑。**关键守卫**：只有 `MODE === "inject"` 才选图；`--remove` / `--list` 走原路：

```js
async function main() {
  let css = "";

  if (MODE === "inject") {
    // [新] 从 wallpapers/ 随机选一张图
    var wallpapersDir = path.join(__dirname, "wallpapers");
    var images = listWallpapers(wallpapersDir);
    if (images.length === 0) {
      console.log("[wallpaper] wallpapers/ 为空，不注入壁纸（ZCode 保持默认外观）。");
      console.log("[wallpaper] 把图片放进 " + wallpapersDir + " 后重跑 inject-only.bat。");
      process.exit(0);
    }
    var chosen = pickRandom(images);
    var fileUrl = toFileUrl(path.join(wallpapersDir, chosen));
    css = fs.readFileSync(path.join(__dirname, "wallpaper.css"), "utf8");
    css = css + "\n/* 本次启动随机选中的壁纸 */\n" +
          'body { background-image: url("' + fileUrl + '") !important; }\n';
    console.log("[wallpaper] 选中壁纸: " + chosen + " （共 " + images.length + " 张可选）");
  }

  // 原有 listTargets / connect / 注入循环（用上面这个 css）...
}
```

注意：原 main() 里 `if (MODE === "inject") { css = fs.readFileSync(...) }` 这段（inject.cjs:122-127）被上面这段扩展取代——原代码只读 css，新代码先选图再读 css 再追加规则。`--remove` 分支本来就不用 css（buildExpression 的 remove 模式用空字符串），保持原样。

### 4.4 不变的部分

- `buildExpression(mode, css)`、`listTargets()`、`connect()`、`fixWsHost()` 不动
- `--remove` / `--list` 模式逻辑不动
- MODE 判断、httpGetJson 不动

---

## 5. wallpaper.css 改动

删除 background-image 行 + 占位符，保留其余背景样式：

```css
body {
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-attachment: fixed !important;
}
```

（删掉 `background-image: url("__WALLPAPER__/wallpaper.svg") !important;` 那行）

顶部注释段更新："[图]" 说明改为"背景图由 inject 从 wallpapers/ 随机选；这里只管尺寸/定位/透明度"。

inject 追加的 `body { background-image: ... }` 会与这里保留的 size/position 规则合并（同为 body 选择器，浏览器正常层叠）。

其余部分（`.theme-zai-dark/light` 透明度、`.bg-background` 兜底、毛玻璃注释段）全部不动。

---

## 6. setup.cjs / setuptest.cjs 简化

### 6.1 setup.cjs

删除：
- 常量 `PLACEHOLDER`（`__WALLPAPER__`）
- 函数 `toFileUrl`、`hasPlaceholder`、`replacePlaceholder`（迁到 inject.cjs / 不再需要）
- module.exports 里对应三项
- main() 的 Step 4（占位符替换）整段删除

main() 步骤重新编号：
| 编号 | 内容 |
|------|------|
| Step 1 | 检查 node 版本（不变） |
| Step 2 | 探测 ZCode.exe（不变） |
| Step 3 | 确保 wallpapers/ 目录（不变） |
| Step 4 | npm install（原 Step 5） |
| Step 5 | 打印总结（原 Step 6） |

总结文案调整："壁纸路径已配置 → wallpaper.svg" 改为 "壁纸目录就绪，inject 时从 wallpapers/ 随机选图"。下一步提示加"每次启动随机换图"。

### 6.2 setuptest.cjs

删除 Task 2（toFileUrl）和 Task 3（hasPlaceholder/replacePlaceholder）的 5 项测试。保留：
- Task 1 的 3 项（parseNodeVersion/isNodeVersionOk）
- Task 4 的 1 项（detectZcode）

结果：9 项 → 4 项。

---

## 7. selftest.cjs 扩展

inject.cjs 加守卫后，selftest.cjs 可 `require("./inject.cjs")` 测试纯函数。新增 5 项：

| 测试项 | 被测 | 断言 |
|--------|------|------|
| toFileUrl 路径转换 | `inject.toFileUrl("C:\\a\\b")` | `=== "file:///C:/a/b"` |
| listWallpapers 空目录 | `inject.listWallpapers(不存在的目录)` | `[]` |
| listWallpapers 过滤扩展名 | 临时目录放 a.jpg + b.txt + c.png | 返回 ["a.jpg","c.png"]（排序后比较） |
| pickRandom 空列表 | `inject.pickRandom([])` | `null` |
| pickRandom 返回列表内某项 | `inject.pickRandom(["a","b","c"])` 多次 | 结果总在列表内 |

临时目录测试用 `fs.mkdtempSync` 建真实目录、测完 `fs.rmSync` 清理（避免 mock，测真实文件系统行为）。

结果：selftest 8 项 → 13 项。

---

## 8. 删除 wallpaper.svg + 清理 .gitignore

- 删除文件 `wallpaper.svg`
- `.gitignore` 删除 `!wallpaper.svg` 这一行（保留 `!EffectPreview.png`）

git 会跟踪到 wallpaper.svg 的删除，正常提交。

---

## 9. README 更新

### 9.1「换自己的壁纸图」一节重写
- 壁纸由 inject 从 `wallpapers/` **随机**选一张，每次启动换一张
- 换图只需往 `wallpapers/` 加图/删图，不用改任何 CSS 或路径
- `wallpapers/` 为空 → ZCode 保持默认外观
- 删掉旧的"file:/// 路径转换规则"段落（不再需要手动改路径）
- 保留"文件名用英文、别用中文/空格"提醒（文件名仍走 file://）

### 9.2 文件说明表
- 删 `wallpaper.svg` 行
- inject.cjs 描述改为"核心注入器（CDP + 从 wallpapers/ 随机选图）"
- wallpapers/ 行描述改为"放壁纸图，inject 启动时随机选一张"

### 9.3 验证状态
- selftest 项数更新为 13（selftest 8 + 新增 5，见 §7）
- setuptest 项数更新为 4（setuptest 9 - 删除 5，见 §6.2）

### 9.4 安装一节
- setup 列表里"把壁纸路径自动配置好（指向 wallpaper.svg）"改为"准备 wallpapers 目录（inject 时从中随机选图）"

---

## 10. 错误处理 & 边界情况

| 情况 | 处理 | 退出码 |
|------|------|--------|
| wallpapers/ 不存在 | listWallpapers try/catch 返回 [] → 空目录处理 | 0 |
| wallpapers/ 无图 | 打印"为空不注入" + 放图路径提示 | 0 |
| wallpapers/ 有图 | 随机选一张，追加规则，正常注入 | 0/1（按注入结果） |
| 选中图文件损坏 | inject 只写 url 不验证可读性，浏览器层面加载失败但不报错（与现状一致） | 0 |
| `--remove` 模式 | `MODE !== "inject"` 守卫跳过选图，直接删 style | 0 |
| 重复跑 inject | buildExpression 的 inject 路径先删旧 style 再 append，无重复 | 0 |
| 连不上 9222 | 原逻辑报错 | 1 |
| node < 18（setup） | 不变 | 1 |

---

## 11. 测试策略总览

| 测试文件 | 改动 | 项数 |
|----------|------|------|
| selftest.cjs | +5 项（toFileUrl/listWallpapers/pickRandom） | 8 → 13 |
| cdp-mock-test.cjs | 不动 | 3 |
| setuptest.cjs | -5 项（删 toFileUrl/placeholder 相关） | 9 → 4 |

`npm test` 总计：13 + 3 + 4 = 20 项。

### 手动验证清单（实现后执行）
1. wallpapers/ 有图 → `node inject.cjs` → 注入成功 + DOM body 背景图指向 wallpapers/ 里某张真实存在的图
2. 连跑 3 次 inject → 每次日志"选中壁纸"文件名不同（3 次全相同算异常）
3. wallpapers/ 清空 → inject → 打印"为空不注入" + exit 0 + ZCode 默认外观
4. `node inject.cjs --remove` → 能删 style（不受空目录影响）
5. `npm test` → 20 项全过
6. `node setup.cjs` → 不碰 wallpaper.css（git diff 无 wallpaper.css 改动）

---

## 12. 文件清单（实现产出）

| 文件 | 类型 | 说明 |
|------|------|------|
| `inject.cjs` | 改 | 加 toFileUrl/listWallpapers/pickRandom + 守卫 + main 选图分支 |
| `wallpaper.css` | 改 | 删 background-image 行 + 占位符，更新注释 |
| `setup.cjs` | 改 | 删 toFileUrl/hasPlaceholder/replacePlaceholder + Step 4，重编号 |
| `setuptest.cjs` | 改 | 删 5 项测试 |
| `selftest.cjs` | 改 | 加 5 项测试 |
| `.gitignore` | 改 | 删 `!wallpaper.svg` |
| `wallpaper.svg` | 删 | 文件删除 |
| `README.md` | 改 | 换图/文件说明/验证状态/安装 4 处更新 |

---

## 13. 设计决策记录

- **为何"启动时随机选一张"而非定时切换**：定时切换需要常驻进程或注入定时器逻辑，复杂度高几个数量级；启动时选一张完全契合现有"start-zcode.bat → inject"架构，零架构改动。
- **为何 wallpaper.css 只删 background-image 行、保留 size/position**：这些是纯样式偏好，放用户可改的 CSS 里比藏进 inject.cjs 代码直观。inject 只动态决定"用哪张图"。
- **为何 setup 删掉占位符替换逻辑**：路径不再写进 CSS（inject 自己用 `__dirname` 算），占位符机制完全多余。删掉减少表面积和出错点。
- **为何删 wallpaper.svg**：用户明确要求；且新机制下"默认测试图"概念已无意义（空目录就是默认外观）。
- **为何空目录 exit 0**：空目录是合法状态（用户可能先初始化环境、之后再放图），不是故障。exit 0 让 start-zcode.bat 不报"issue"。
- **为何给 inject.cjs 加 require.main 守卫**：让纯函数可被 selftest 测试，与 setup.cjs 一致，是 node 惯例；顺手补上 inject.cjs 本该有的可测性。
- **为何测真实临时目录而非 mock fs**：listWallpapers 核心就是 readdir+filter，mock fs 等于测 mock 自己；用 mkdtempSync 建真实目录测真实行为。
