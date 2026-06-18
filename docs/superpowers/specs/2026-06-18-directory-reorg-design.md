# 项目目录整理设计

- **日期**: 2026-06-18
- **状态**: 待审阅
- **前置**: buildExpression 同步修复已完成(inject.cjs 导出 buildExpression,selftest.cjs 改用 require),30 项测试全绿。

## 1. 背景与动机

zcode-wallpaper 根目录当前堆了 25 个条目(不含 node_modules),核心源码、启动脚本、测试、辅助脚本、运行时产物全部平铺在根。其中 `scripts/` 目录已存在但只放了 2 个文件,而性质相同的源码 `inject.cjs`/`setup.cjs`/`resize.cjs` 却留在根目录,分类不一致。6 个测试文件全在根目录无独立目录。另有 2 个本地产物(`screenshot.png`、`zcode-launch.log`)混入工作区。

本次整理目标:**让文件按角色归类,提升可读性和可维护性,同时不破坏任何现有功能。**

## 2. 范围

### 纳入

- 新建 `lib/`,收纳核心源码 `inject.cjs`、`setup.cjs`、`resize.cjs`、`wallpaper.css`。
- 新建 `test/`,收纳 6 个测试 `*test.cjs`。
- 删除本地产物 `screenshot.png`、`zcode-launch.log`。
- 同步修改所有因文件移动而失效的路径引用(详见第 4 节清单)。

### 不纳入(明确排除)

- `docs/` 及其所有内容(`docs/superpowers/` 名字、文件位置一字不动)。
- `scripts/` 目录及其内容(`inspect.cjs`、`screenshot.cjs` 原地不动)。
- 全部 `.bat` 启动脚本留在根目录(保"双击即用"体验),只改其内部 `node` 路径。
- `probe.ps1` 留根目录(与 `.bat` 同组)。
- `wallpapers/`、`wallpapers-thumb/`、`node_modules/` 不动。
- 任何业务逻辑、CSS 内容、测试断言不动。本次是纯"搬位置"。
- README.md 内对文件路径的文字描述(如有)不在本次范围 —— 防止范围蔓延,后续单独核对。

## 3. 目标结构

```
zcode-wallpaper/
├── lib/                          ← 新建:核心源码
│   ├── inject.cjs
│   ├── setup.cjs
│   ├── resize.cjs
│   └── wallpaper.css             ← inject.cjs 用 __dirname 相对读,放一起零路径改动
├── test/                         ← 新建:所有测试
│   ├── selftest.cjs
│   ├── cdp-mock-test.cjs
│   ├── cdp-retry-test.cjs
│   ├── setuptest.cjs
│   ├── resizetest.cjs
│   └── probetest.cjs
├── scripts/                      ← 已存在,原地不动
│   ├── inspect.cjs
│   └── screenshot.cjs
├── *.bat                         ← 全部留根目录
│   ├── start-zcode.bat
│   ├── inject-only.bat
│   ├── setup.bat
│   ├── resize.bat
│   └── remove-wallpaper.bat
├── probe.ps1                     ← 留根目录
├── docs/superpowers/             ← 完全不碰
├── wallpapers/  wallpapers-thumb/  node_modules/  (不动)
├── README.md  AGENTS.md  LICENSE  package.json  package-lock.json  EffectPreview.png
```

删除:`screenshot.png`、`zcode-launch.log`。

## 4. 路径迁移影响清单(执行阶段逐项核对)

这是本次整理的全部风险面。每一处都必须改,漏一处即出 bug。所有行号基于 buildExpression 修复后的当前状态(spec 自审阶段已核实)。

### A. `.bat` 里调 `.cjs` 的路径(5 处)

`.bat` 用 `%~dp0` 或 `%WP_DIR%`(脚本自身目录)定位。源码进 `lib/` 后加 `lib\` 前缀:

| 文件:行 | 现状 | 改为 |
|---------|------|------|
| `start-zcode.bat:67` | `node "%WP_DIR%\inject.cjs"` | `node "%WP_DIR%\lib\inject.cjs"` |
| `inject-only.bat:44` | `node "%WP_DIR%\inject.cjs"` | `node "%WP_DIR%\lib\inject.cjs"` |
| `remove-wallpaper.bat:4` | `node "%~dp0inject.cjs" --remove` | `node "%~dp0lib\inject.cjs" --remove` |
| `setup.bat:29` | `node "%~dp0setup.cjs"` | `node "%~dp0lib\setup.cjs"` |
| `resize.bat:29` | `node "%~dp0resize.cjs"` | `node "%~dp0lib\resize.cjs"` |

`probe.ps1` 留根目录,`-File "%WP_DIR%\probe.ps1"`(start-zcode.bat:52、inject-only.bat:19)**不用改**。

### B. `.cjs` 内部用 `__dirname` 定位的资源路径(3 处)

源码进 `lib/` 后,`__dirname` 从项目根变成 `lib/`。而 `wallpapers/`、`wallpapers-thumb/` 留在项目根 —— 所有指向它们的 `path.join(__dirname, ...)` 必须回退一层。`wallpaper.css` 跟 inject.cjs 一起进 lib/,其引用不用改:

| 文件:行 | 现状 | 改为 |
|---------|------|------|
| `inject.cjs:155` | `path.join(__dirname, "wallpapers-thumb")` | `path.join(__dirname, "..", "wallpapers-thumb")` |
| `inject.cjs:165` | `path.join(__dirname, "wallpaper.css")` | **不改**(css 跟 inject.cjs 同进 lib/) |
| `resize.cjs:55` | `path.join(__dirname, "wallpapers")` | `path.join(__dirname, "..", "wallpapers")` |
| `resize.cjs:56` | `path.join(__dirname, "wallpapers-thumb")` | `path.join(__dirname, "..", "wallpapers-thumb")` |
| `setup.cjs:100` | `path.join(__dirname, "wallpapers")` | `path.join(__dirname, "..", "wallpapers")` |

### C. 测试里 `require` 源码 + 读 wallpaper.css(4 处)

测试进 `test/`,相对 require 要回退一层到 `lib/`:

| 文件:行 | 现状 | 改为 |
|---------|------|------|
| `selftest.cjs:5` | `require("./inject.cjs")` | `require("../lib/inject.cjs")` |
| `selftest.cjs:11` | `require("./inject.cjs")` (buildExpression) | `require("../lib/inject.cjs")` |
| `selftest.cjs:55` | `path.join(__dirname, "wallpaper.css")` | `path.join(__dirname, "..", "lib", "wallpaper.css")` |
| `setuptest.cjs:2` | `require("./setup.cjs")` | `require("../lib/setup.cjs")` |
| `resizetest.cjs:5` | `require("./resize.cjs")` | `require("../lib/resize.cjs")` |

### D. CDP 测试用 `execFile` 把 inject.cjs 当子进程跑(2 处,最易漏)

这两个测试用相对路径字符串 + `cwd: __dirname` 跑 inject.cjs。进 test/ 后 cwd 变成 test/,**既要改路径字符串,也要把 cwd 改回项目根**:

| 文件:行 | 现状 | 改为 |
|---------|------|------|
| `cdp-mock-test.cjs:84-85` | `["inject.cjs", ...args]` + `cwd: __dirname` | `["lib/inject.cjs", ...args]` + `cwd: path.join(__dirname, "..")` |
| `cdp-retry-test.cjs:77-78` | `["inject.cjs"]` + `cwd: __dirname` | `["lib/inject.cjs"]` + `cwd: path.join(__dirname, "..")` |

注意:这两个文件**当前都没有 `require("path")`**(已核实:cdp-mock-test 只 require http/ws/child_process/util,cdp-retry-test 同)。D 类改动必须同时补一行 `const path = require("path");`(放在文件顶部现有 require 区)。

### E. `probetest.cjs` 调 `probe.ps1`(1 处)

`probe.ps1` 留根目录,测试进 test/,回退一层:

| 文件:行 | 现状 | 改为 |
|---------|------|------|
| `probetest.cjs:30` | `path.join(__dirname, "probe.ps1")` | `path.join(__dirname, "..", "probe.ps1")` |

probetest.cjs 已 `require("path")`(line 17),无需补。

### F. `package.json` 脚本(1 处,4 行)

```json
"inject": "node lib/inject.cjs",
"remove": "node lib/inject.cjs --remove",
"setup": "node lib/setup.cjs",
"test": "node test/selftest.cjs && node test/cdp-mock-test.cjs && node test/cdp-retry-test.cjs && node test/setuptest.cjs && node test/resizetest.cjs && node test/probetest.cjs"
```

### 小结

| 类别 | 处数 |
|------|------|
| A (.bat 调 .cjs) | 5 |
| B (.cjs 内 __dirname → wallpapers) | 4 |
| C (测试 require 源码 / 读 css) | 5 |
| D (CDP 测试 execFile 子进程) | 2 |
| E (probetest 调 probe.ps1) | 1 |
| F (package.json 脚本) | 4 行 |
| **合计需改动点** | **17 处 + 4 行脚本** |

## 5. 验证策略

实现完成后必须依次执行,全部通过才算成功:

1. **`npm test`**:30 项全绿(13 selftest + 3 cdp-mock + 1 cdp-retry + 4 setup + 5 resize + 4 probe)。任何一项红 = 路径迁移漏了一处。
2. **Grep 回扫**:全文搜 `node inject.cjs`、`require("./inject.cjs")`、`path.join(__dirname, "wallpapers` 等旧路径模式,确认无残留(除注释和文档外)。这是 AGENTS.md 教训 6 的应用 —— 改完 grep 同型写法。
3. **手动链路验证**(若用户在场 / 可启动 ZCode):`setup.bat` → `resize.bat` → `start-zcode.bat`,确认 .bat 能找到 lib/ 下的 .cjs,且 .cjs 能定位 ../wallpapers/ 和 ../wallpapers-thumb/。若无法启动 ZCode,则至少单独跑 `node lib/setup.cjs` 和 `node lib/resize.cjs` 确认无路径异常退出。

## 6. 风险与回滚

**主要风险**:D 类(execFile 子进程)最易漏 —— 它的 cwd 改动和路径字符串改动是耦合的,只改其一会报"找不到 inject.cjs"。执行时这两处必须成对改。

**回滚**:本次纯文件移动 + 路径替换,无逻辑改动。若验证失败,`git checkout -- .` 即可整体回退(所有改动均在工作区,未提交前可无损回滚)。建议执行阶段先移动文件 + 改引用,跑测试,全绿再提交。

## 7. 已知遗留(不在本次范围)

- selftest.cjs 的 Test 1~4 依赖手写玩具 DOM(`makeFakeDom`),只能验证 buildExpression 生成的字符串在玩具 DOM 里行为对,验证不了在真实浏览器 DOM 里跑通。本次仅修了"测副本 vs 测真身"的同步问题,玩具 DOM 局限留给 cdp-mock-test 端到端层覆盖,不在本次处理。
- README.md 中可能存在的文件路径文字描述未核对(防止范围蔓延)。
