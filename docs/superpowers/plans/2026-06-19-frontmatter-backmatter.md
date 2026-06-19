# 前言/后记识别 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `lib/reader-toc.cjs` 的 `parseTOC` 加前言 + 后记/番外章节识别，让目录正确显示开头简介和结尾的尾声/感言/番外，不再把后记并进最后一章。

**Architecture:** 纯函数增强——在 `parseTOC` 现有 chapter 构建循环（line 81-84 endOffset 赋值）之后、fallback（85-88）之前，插入两段独立逻辑：(1) 前言检测（第一章之前的内容，按标记词提标题，回退"前言"）；(2) 后记检测（最后一章正文里找标记词，切出独立后记章节）。数据结构 `{title, startOffset, endOffset}` 不变，前端不改。

**Tech Stack:** Node.js CommonJS（`.cjs`），无新依赖，纯正则 + 字符串切片。测试：`node test/readertoctest.cjs` 直接跑（无框架，assert + 自计数，参照现有风格）。

**Spec:** `docs/superpowers/specs/2026-06-19-frontmatter-backmatter-design.md`

---

## File Structure

- **Modify:** `lib/reader-toc.cjs`（`parseTOC` 函数，加前言/后记识别 + 两个辅助函数 + 两个标记词常量）
- **Modify:** `test/readertoctest.cjs`（加 6 本样本断言 + 守卫权衡用例）
- **Modify:** `scripts/batch-test-novels.cjs`（加前后记识别报告列）
- **不改：** `reader/reader.js`、`reader/book.js`、`reader/lib/toc.js`（前端 file: 兜底模式）、`reader-server.cjs`、`lib/reader-codec.cjs`

## 设计约束（从 spec + 真实样本）

**前言标题词**（优先级，第一个命中的作标题）：`楔子` / `序章` / `序言` / `序`（独立成行/行首） / `引子` / `引言` / `简介` / `书籍介绍` / `内容简介` / `作品相关` / `写在前面`。回退 `"前言"`。

**后记标记词**（优先级，第一个命中的决定标题）：
- `尾声` → `"尾声"`
- `番外` → `"番外"`
- `后记` / `完本感言` / `完结感言` / `感言` → `"后记"`
- `（全文完）` / `(全文完)` / `（全书完）` / `(全书完)` / `（全文终）` / `(全文终)` / `全书终` / `全文完` / `全文终` / `全书完` → `"后记"`

**前言过短不生成**：`beforeText` 非空行数 < 5 **或** 字符数 < 200 → 不生成。

**后记守卫**：标记词所在行 trim 后等于标记词本身，**或**以标记词开头且后跟标点（`。！）`或换行）才认。避免"全文完成XX任务"误匹。

**边界情况 A（回到明朝型）**：最后一章正文里无任何后记标记词 → 不切分，保持现状。记为已知遗留。

**6 本样本预期**（spec 表）：
| 书 | 前言 | 后记 |
|---|---|---|
| 回到明朝 | 有 "书籍介绍" | 无 |
| 天擎 | 无 | 有 "后记" |
| 惟我独仙 | 有 "楔子" | 有 "尾声" |
| 斗破苍穹 | 有 "前言" | 无 |
| 盘龙 | 无 | 有 "后记" |
| 纨绔才子 | 有 "前言" | 有 "后记" |

---

## Task 1: Commit menu fix #1 (separate, before feature work)

**Files:**
- Already modified: `lib/menu.cjs:61`（desc 已改，待提交）

- [ ] **Step 1: Verify menu fix still in place**

Run: `git diff lib/menu.cjs`
Expected: 显示 desc 行从 `Ctrl+Alt+↑/↓ 调` 改成 `输 0-100 选透明度，要改重跑`。

- [ ] **Step 2: Run menutest to confirm green**

Run: `node test/menutest.cjs`
Expected: 输出含 "passed" 且无 "failed"。

- [ ] **Step 3: Commit**

```bash
git add lib/menu.cjs
git commit -m "fix(menu): 场景9 desc 去掉已删除的 Ctrl+Alt 热键引用 (热键在 3017036 移除，菜单漏改)"
```

---

## Task 2: Write failing test — 前言识别（合成小样本）

**Files:**
- Modify: `test/readertoctest.cjs`（文件末尾、最后一个 `run()` 之前或现有 case 块风格内追加）

- [ ] **Step 1: 在 readertoctest.cjs 末尾追加前言测试 case**

参照文件现有 case 风格（构造 text、调 `parseTOC`、断言 `toc.chapters[0]`）。追加：

```javascript
// === 前言识别：第一章之前的内容应成为前言章节 ===
{
  const text = "楔子\n天空中两道身影对视。\n这是楔子正文第二段。\n第三段内容。\n第四段内容。\n第一章 开始\n正文一。\n第二章 结束\n正文二。\n";
  const toc = parseTOC(text, "test.txt");
  assert(toc.chapters.length === 3, "preface: should have 3 chapters (preface+2), got " + toc.chapters.length);
  assert(toc.chapters[0].title === "楔子", "preface: first chapter title should be '楔子', got " + toc.chapters[0].title);
  assert(toc.chapters[0].startOffset === 0, "preface: preface startOffset should be 0");
  // 第一章 title 应该是 "第一章 开始"
  assert(/第一章/.test(toc.chapters[1].title), "preface: second chapter should be 第一章, got " + toc.chapters[1].title);
  passed++;
}
// === 前言无标记词 -> 回退 "前言" ===
{
  const text = "《某书》\n作者：某人\n这是简介第一段。\n简介第二段。\n简介第三段。\n简介第四段。\n第一章 开始\n正文。\n";
  const toc = parseTOC(text, "test.txt");
  assert(toc.chapters[0].title === "前言", "preface-fallback: title should be '前言', got " + toc.chapters[0].title);
  passed++;
}
// === 前言过短不生成 ===
{
  // 只有 1 行简介 (< 5 行)，不应生成前言
  const text = "短简介。\n第一章 开始\n正文。\n";
  const toc = parseTOC(text, "test.txt");
  assert(toc.chapters[0].title !== "前言" && toc.chapters[0].title !== "短简介", "preface-short: should NOT generate preface, first is " + toc.chapters[0].title);
  assert(/第一章/.test(toc.chapters[0].title), "preface-short: first chapter should be 第一章, got " + toc.chapters[0].title);
  passed++;
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readertoctest.cjs`
Expected: FAIL，preface 相关断言失败（当前 parseTOC 不识别前言，`chapters[0]` 直接是"第一章"）。

- [ ] **Step 3: 暂不实现，进入 Task 3**

---

## Task 3: Write failing test — 后记识别（合成小样本）

**Files:**
- Modify: `test/readertoctest.cjs`

- [ ] **Step 1: 追加后记测试 case**

```javascript
// === 后记识别：最后一章正文里的"尾声"应切出独立后记章节 ===
{
  const text = "第一章 开始\n正文一。\n第二章 结束\n正文二正文二正文二。\n尾声\n这是作者的话。\n感言第二段。\n（全文完）\n";
  const toc = parseTOC(text, "test.txt");
  const last = toc.chapters[toc.chapters.length - 1];
  assert(last.title === "尾声", "afterword: last chapter should be '尾声', got " + last.title);
  // 倒数第二应该是"第二章 结束"，且 endOffset 截断到尾声前
  const secondLast = toc.chapters[toc.chapters.length - 2];
  assert(/第二章/.test(secondLast.title), "afterword: second-last should be 第二章, got " + secondLast.title);
  passed++;
}
// === 后记：完本声明类 (全文完) -> 标题"后记" ===
{
  const text = "第一章 开始\n正文一正文一正文一。\n（全文完）\n作者感言。\n第二段感言。\n第三段。\n第四段。\n";
  const toc = parseTOC(text, "test.txt");
  const last = toc.chapters[toc.chapters.length - 1];
  assert(last.title === "后记", "afterword-declare: last should be '后记', got " + last.title);
  passed++;
}
// === 后记守卫："全文完成XX任务"不应误匹 ===
{
  const text = "第一章 开始\n他终于全文完成了任务。\n大家都全文完成了。\n这是正文第三段。\n第四段。\n第五段。\n";
  const toc = parseTOC(text, "test.txt");
  // 不应切出后记，最后一章仍是"第一章 开始"，endOffset = text.length
  const last = toc.chapters[toc.chapters.length - 1];
  assert(/第一章/.test(last.title), "afterword-guard: no afterword, last is 第一章, got " + last.title);
  assert(last.endOffset === text.length, "afterword-guard: endOffset should be text.length (no split), got " + last.endOffset);
  passed++;
}
// === 无标记词不切分（边界情况A）===
{
  const text = "第一章 开始\n正文一。\n作者感言直接续在这里没有标记词。\n第二段感言。\n第三段。\n第四段。\n";
  const toc = parseTOC(text, "test.txt");
  const last = toc.chapters[toc.chapters.length - 1];
  assert(/第一章/.test(last.title), "afterword-none: no split, last is 第一章, got " + last.title);
  assert(last.endOffset === text.length, "afterword-none: endOffset = text.length, got " + last.endOffset);
  passed++;
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node test/readertoctest.cjs`
Expected: FAIL，afterword 相关断言失败。

---

## Task 4: Implement 前言 + 后记识别 in parseTOC

**Files:**
- Modify: `lib/reader-toc.cjs:34-90`（`parseTOC` 函数）

- [ ] **Step 1: 在 reader-toc.cjs 顶部（VOLHEAD_RE 定义后、parseTOC 前）加标记词常量 + 两个辅助函数**

在 line 32（`VOLHEAD_RE` 定义结束的 `);`）之后、line 34（`function parseTOC`）之前插入：

```javascript

// === 前言/后记识别（spec: 2026-06-19-frontmatter-backmatter-design.md）===
// 前言标题词：在 beforeText 里按优先级找，第一个命中的作标题。
// "序"单字需独立成行/行首（防"程序/序号"误匹），其他多字词直接 includes。
const PREFACE_TITLES = [
  { word: "楔子", title: "楔子" },
  { word: "序章", title: "序章" },
  { word: "序言", title: "序言" },
  { word: "引子", title: "引子" },
  { word: "引言", title: "引言" },
  { word: "书籍介绍", title: "书籍介绍" },
  { word: "内容简介", title: "内容简介" },
  { word: "作品相关", title: "作品相关" },
  { word: "写在前面", title: "写在前面" },
  { word: "简介", title: "简介" },
];
// "序" 单独处理：必须是独立行或行首词（后跟 ：/:/空格/换行）
function hasPrefaceTitleWord(beforeText) {
  for (const { word, title } of PREFACE_TITLES) {
    if (beforeText.includes(word)) return title;
  }
  // "序" 单字：独立行 ^序\s*$ 或 行首 ^序[：: ]
  if (/(?:^|\n)\s*序\s*([：:]\s*|\s|$)/.test(beforeText)) return "序";
  return null;
}

// 后记标记词：按优先级，第一个命中的决定标题。每个带 predicate 判断
// "标记词所在行是否满足守卫"（独立行 或 行首+标点）。
function lineMatchesGuard(line, word) {
  const t = line.trim();
  if (t === word) return true;                       // 整行就是标记词
  if (t.startsWith(word)) {                          // 行首 + 标点/换行
    const rest = t.slice(word.length);
    return /^[。！？!?)）\s]/.test(rest);
  }
  return false;
}
// 后记候选：标记词 -> 标题。扫描时按数组顺序，第一个在 lastBody 里有
// 守卫匹配的就用。
const AFTERWORD_CANDIDATES = [
  { word: "尾声",   title: "尾声" },
  { word: "番外",   title: "番外" },
  { word: "后记",   title: "后记" },
  { word: "完本感言", title: "后记" },
  { word: "完结感言", title: "后记" },
  { word: "感言",   title: "后记" },
  { word: "（全文完）", title: "后记" },
  { word: "(全文完)",  title: "后记" },
  { word: "（全书完）", title: "后记" },
  { word: "(全书完)",  title: "后记" },
  { word: "（全文终）", title: "后记" },
  { word: "(全文终)",  title: "后记" },
  { word: "全书终", title: "后记" },
  { word: "全文完", title: "后记" },
  { word: "全文终", title: "后记" },
  { word: "全书完", title: "后记" },
];

// 在 lastBody（最后一章从其 startOffset 起的文本）里找第一个满足守卫的后记标记词。
// 返回 {title, offset}（offset 是标记词在 lastBody 里的 char 偏移）或 null。
function findAfterword(lastBody) {
  // 按行扫，记录每行在 lastBody 里的起始偏移
  let lineStart = 0;
  const lines = lastBody.split(/(?<=\r?\n)/);
  for (const raw of lines) {
    const line = raw.trim();
    for (const { word, title } of AFTERWORD_CANDIDATES) {
      if (lineMatchesGuard(line, word)) {
        // 标记词在该行 trim 后内容里的位置 + 该行在 lastBody 里的偏移 + trim 前缀长度
        const trimPrefix = raw.length - raw.replace(/^\s+/, "").length;
        const wordIdxInRaw = raw.indexOf(word, trimPrefix);
        if (wordIdxInRaw >= 0) {
          return { title, offset: lineStart + wordIdxInRaw };
        }
      }
    }
    lineStart += raw.length;
  }
  return null;
}
```

- [ ] **Step 2: 在 parseTOC 的 endOffset 赋值循环（line 81-84）之后、fallback（85）之前，插入前言 + 后记逻辑**

把现有的 line 81-88 替换成：

```javascript
  for (let i = 0; i < chapters.length; i++) {
    chapters[i].endOffset = (i + 1 < chapters.length)
      ? chapters[i + 1].startOffset : text.length;
  }

  // === 前言识别（spec §1）：第一章之前的内容作前言章节 ===
  // 仅在识别出真章节时处理（fallback 全文章节不算）。
  if (chapters.length > 0 && chapters[0].title !== "全文") {
    const firstCh = chapters[0];
    const beforeText = text.slice(0, firstCh.startOffset);
    const nonEmptyLines = beforeText.split(/\r?\n/).filter(s => s.trim().length > 0).length;
    if (nonEmptyLines >= 5 || beforeText.length >= 200) {
      const titleWord = hasPrefaceTitleWord(beforeText);
      chapters.unshift({
        title: titleWord || "前言",
        startOffset: 0,
        endOffset: firstCh.startOffset
      });
    }
  }

  // === 后记识别（spec §2）：最后一章正文里的标记词切出独立后记章节 ===
  // 边界情况A（回到明朝型）：无标记词不切分。
  if (chapters.length > 0 && chapters[chapters.length - 1].title !== "全文") {
    const lastCh = chapters[chapters.length - 1];
    const lastBody = text.slice(lastCh.startOffset);
    const aw = findAfterword(lastBody);
    if (aw) {
      // 末章截断到标记词前，新增后记章节
      lastCh.endOffset = lastCh.startOffset + aw.offset;
      chapters.push({
        title: aw.title,
        startOffset: lastCh.startOffset + aw.offset,
        endOffset: text.length
      });
    }
  }

  // Fallback: no recognizable chapter -> whole text is one "全文" chapter
  if (chapters.length === 0) {
    chapters.push({ title: "全文", startOffset: 0, endOffset: text.length });
  }
  return { volumes, chapters };
```

- [ ] **Step 3: 跑 readertoctest 确认 Task 2/3 的合成样本用例全过**

Run: `node test/readertoctest.cjs`
Expected: PASS（前言 + 后记 + 守卫 + 边界A 用例全过）。

- [ ] **Step 4: 跑全量 npm test 确认无回归**

Run: `npm test`
Expected: 14 个测试文件全绿。

- [ ] **Step 5: Commit**

```bash
git add lib/reader-toc.cjs test/readertoctest.cjs
git commit -m "feat(reader): parseTOC 识别前言 + 后记/番外章节 (不再把后记并进末章)"
```

---

## Task 5: Add 6 real-book sample assertions to readertoctest

**Files:**
- Modify: `test/readertoctest.cjs`

**说明：** 测试用**合成小片段**而非整本文件（整本 7-10MB 进 git 不合理，且测试要快）。每本书构造一段能触发前言/后记识别的代表性片段，断言 parseTOC 输出符合 spec 表。

- [ ] **Step 1: 追加 6 本样本断言**

```javascript
// === 6 本真实样本的代表性片段断言（spec 表）===
// 每本构造一段触发前言/后记识别的片段，非整本（整本太大不进 git）。

// 回到明朝当王爷：前言="书籍介绍"，后记=无（边界情况A，末尾只有站点广告无标记词）
{
  const text = [
    "※※※※※※※※※※",
    "※　零点TXT书苑　 ※",
    "※※※※※※※※※※",
    "[回到明朝当王爷 / 月关 著 ]",
    "书籍介绍:",
    "一个速成的九世善人，被阴司判官送到了大明正德年间。",
    "自认没有一技之长、又对历史一知半解的穿越者。",
    "国家和个人的命运，就象历史洪流中的一条小船儿。",
    "第一章 九世善人",
    "正文开始正文开始正文开始。",
    "第二章 转世重生",
    "正文继续正文继续正文继续。",
    "※※※※※※※※※※",
    "※　零点TXT书苑　 ※",
    "※※※※※※※※※※",
    ""
  ].join("\n");
  const toc = parseTOC(text, "回到明朝当王爷.txt");
  assert(toc.chapters[0].title === "书籍介绍", "sample-回到明朝: preface title, got " + toc.chapters[0].title);
  const last = toc.chapters[toc.chapters.length - 1];
  assert(/第二章/.test(last.title), "sample-回到明朝: NO afterword (边界A), last is 第二章, got " + last.title);
  passed++;
}
// 天擎：无前言，后记="后记"（（全文完））
{
  const text = [
    "第一章 起源",
    "正文一正文一正文一正文一。",
    "第二章 发展",
    "正文二正文二正文二正文二。",
    "第二十二节 让我们的生命怒放",
    "段天狼笑着对苏荷说了一些话，然后结束了这一切。",
    "（全文完）",
    "这是作者的完本感言第一段。",
    "第二段感言内容。",
    "第三段感言。",
    ""
  ].join("\n");
  const toc = parseTOC(text, "天擎.txt");
  // 无前言：第一章直接是第一章
  assert(/第一章/.test(toc.chapters[0].title), "sample-天擎: no preface, first is 第一章, got " + toc.chapters[0].title);
  const last = toc.chapters[toc.chapters.length - 1];
  assert(last.title === "后记", "sample-天擎: afterword title '后记', got " + last.title);
  passed++;
}
// 惟我独仙：前言="楔子"，后记="尾声"（尾声先于全书完）
{
  const text = [
    "《惟我独仙》",
    "作者：唐家三少",
    "第一集楔子",
    "天空中两道身影相隔千米对视着。",
    "其中一道身影脚踏七彩祥云散发金色光芒。",
    "另外一道身影脚踏乌云一身黑袍。",
    "二十多岁的青年淡淡说道今天既然见到你就该了断。",
    "中年人哼了一声既然你想死本宗成全你。",
    "第一章 海龙",
    "海龙是主角正文开始。",
    "第224章惟我独仙（终章）",
    "终章正文终章正文终章正文。",
    "尾声",
    "又是一套书结束了这是我的第四套全本。",
    "熟悉小三的人都知道我的书绝不会太监。",
    "新书空速星痕希望大家一如既往支持。",
    "（全书完）",
    ""
  ].join("\n");
  const toc = parseTOC(text, "惟我独仙.txt");
  assert(toc.chapters[0].title === "楔子", "sample-惟我独仙: preface '楔子', got " + toc.chapters[0].title);
  const last = toc.chapters[toc.chapters.length - 1];
  assert(last.title === "尾声", "sample-惟我独仙: afterword '尾声' (先于全书完), got " + last.title);
  passed++;
}
// 斗破苍穹：前言="前言"（无标记词回退），后记=无（大结局即正文结尾）
{
  const text = [
    "《斗破苍穹》",
    "作者：天蚕土豆",
    "这里是属于斗气的世界。",
    "本书等级制度：斗者斗师大斗师斗灵。",
    "还有更高的斗王斗皇斗宗斗尊斗圣斗帝。",
    "第一章 陨落的天才",
    "萧炎是斗之气三段的少年。",
    "第一千六百四十八章 结束也是开始（大结局）",
    "萧炎深深吐了一口气平静了多年的漆黑双眸涌上火热。",
    "结束果然也是一种开始。",
    ""
  ].join("\n");
  const toc = parseTOC(text, "斗破苍穹.txt");
  assert(toc.chapters[0].title === "前言", "sample-斗破苍穹: preface fallback '前言', got " + toc.chapters[0].title);
  const last = toc.chapters[toc.chapters.length - 1];
  assert(/第一千六百四十八章/.test(last.title), "sample-斗破苍穹: NO afterword (大结局即结尾), last is 终章, got " + last.title);
  passed++;
}
// 盘龙：无前言，后记="后记"（全书终）
{
  const text = [
    "第一章 盘龙戒指",
    "林雷在祖屋里找到了盘龙戒指。",
    "第二章 成长",
    "林雷慢慢成长为一个强者。",
    "第四十三章 新的名字（大结局）（下）",
    "林雷成为鸿蒙掌控者回到家乡宇宙。",
    "贝贝感受到了林雷的灵魂气息欢呼起来。",
    "全书终",
    ""
  ].join("\n");
  const toc = parseTOC(text, "盘龙.txt");
  assert(/第一章/.test(toc.chapters[0].title), "sample-盘龙: no preface, first is 第一章, got " + toc.chapters[0].title);
  const last = toc.chapters[toc.chapters.length - 1];
  assert(last.title === "后记", "sample-盘龙: afterword '后记' (全书终), got " + last.title);
  passed++;
}
// 纨绔才子：前言="前言"，后记="后记"（（全文终））
{
  const text = [
    "纨绔才子",
    "作者：墨武",
    "隐者不遇",
    "这是简介内容第一段。",
    "简介第二段补充说明。",
    "第一章 初到贵地",
    "叶枫初到这个地方正文开始。",
    "第九十七节 花落花开(大结局)",
    "叶枫在香榭丽舍大街看到了熟悉的白影。",
    "人群慢慢汇聚只为那前所未有的凝聚力。",
    "（全文终）",
    ""
  ].join("\n");
  const toc = parseTOC(text, "纨绔才子.txt");
  assert(toc.chapters[0].title === "前言", "sample-纨绔才子: preface '前言', got " + toc.chapters[0].title);
  const last = toc.chapters[toc.chapters.length - 1];
  assert(last.title === "后记", "sample-纨绔才子: afterword '后记' (全文终), got " + last.title);
  passed++;
}
```

- [ ] **Step 2: 跑测试确认全过**

Run: `node test/readertoctest.cjs`
Expected: PASS，6 本样本断言全过。

- [ ] **Step 3: 跑全量 npm test**

Run: `npm test`
Expected: 全绿。

- [ ] **Step 4: Commit**

```bash
git add test/readertoctest.cjs
git commit -m "test(reader): 6 本真实样本钉死前言/后记识别预期 (spec 表)"
```

---

## Task 6: Extend batch-test-novels.cjs with front/back matter column

**Files:**
- Modify: `scripts/batch-test-novels.cjs`

- [ ] **Step 1: 改表头加列 + 在循环里报告前言/后记**

把 line 19（表头）改成（加 `pref` `aft` 两列）：

```javascript
console.log("file | sizeMB | encoding | chaps | vols | pref | aft | suspect | note");
console.log("-----|--------|----------|-------|------|------|-----|---------|-----");
```

把 line 40-55（循环体里 parseTOC 之后到 console.log）替换成：

```javascript
  const toc = parseTOC(text, name);
  const nchap = toc.chapters.length;
  const nvol = toc.volumes.length;
  // 前言：第一章标题不是"第X章/节/回"且不是"全文" -> 是前言/楔子类
  const firstCh = toc.chapters[0];
  const hasPreface = firstCh && firstCh.title !== "全文" && !/第[一二两三四五六七八九十百千零0-9]+(章|节|回)/.test(firstCh.title);
  const prefLabel = hasPreface ? firstCh.title.slice(0, 8) : "-";
  // 后记：最后一章标题不是"第X章/节/回"且不是"全文" -> 是尾声/后记类
  const lastCh = toc.chapters[toc.chapters.length - 1];
  const hasAfterword = lastCh && lastCh.title !== "全文" && !/第[一二两三四五六七八九十百千零0-9]+(章|节|回)/.test(lastCh.title) && toc.chapters.length > 1;
  const aftLabel = hasAfterword ? lastCh.title.slice(0, 8) : "-";
  // anomaly heuristics
  if (nchap === 1 && toc.chapters[0].title === "全文") { note = "FALLBACK全文"; anomalies.push({name, note}); }
  else if (nchap > 0 && nchap < 20) { note = "low chaps"; anomalies.push({name, note, nchap}); }
  const sizeMB = (bytes.length / 1024 / 1024).toFixed(1);
  console.log(
    name.slice(0,30).padEnd(30) + " | " +
    sizeMB.padStart(5) + " | " +
    enc.padEnd(8) + " | " +
    String(nchap).padStart(5) + " | " +
    String(nvol).padStart(4) + " | " +
    prefLabel.padEnd(8) + " | " +
    aftLabel.padEnd(6) + " | " +
    (suspect ? "  yes" : "   no") + " | " +
    note
  );
```

- [ ] **Step 2: 用本机 6 本验脚本本身能跑**

Run: `node scripts/batch-test-novels.cjs novels`
Expected: 表头含 pref/aft 列，6 本都有合理输出（回到明朝 pref=书籍介绍 aft=-，天擎 pref=- aft=后记，等等）。

- [ ] **Step 3: Commit**

```bash
git add scripts/batch-test-novels.cjs
git commit -m "feat(scripts): batch-test-novels 加前言/后记识别报告列"
```

---

## Task 7: Run 86-book batch validation + real-machine verify

**Files:** 无（验证步骤）

- [ ] **Step 1: 问用户 86 本小说目录路径**

向用户确认批量测试的 86 本起点完结小说在哪个目录（之前 AGENTS.md 提到的批量集）。如果用户说路径，跑：

Run: `node scripts/batch-test-novels.cjs "<用户给的路径>"`
Expected: 异常数 ≤ 4（改动前的基线，都是与本设计无关的格式问题：纯数字编号、易经卦名、单行文件、body-mention 假阳性）。如果异常数 > 4，检查是不是前言/后记守卫误伤，调 spec。

如果用户说没有 86 本集 / 不方便跑，跳过此步，靠本机 6 本 + 单测验证。

- [ ] **Step 2: 真机验证（核心教训 18：必须真机查运行时状态）**

启动 reader-server：`bin/reader-server.bat`（或让用户启动），然后在 ZCode 浏览器面板打开 reader URL。用 `scripts/inspect-reader.cjs` 或直接人眼看：
- 回到明朝当王爷：目录第一个是"书籍介绍"，最后一个是没有额外后记（保持原样）
- 惟我独仙：第一个是"楔子"，最后有"尾声"
- 斗破苍穹：第一个是"前言"，无额外后记

确认点进去内容对（前言点进去是简介正文，后记点进去是作者感言）。

- [ ] **Step 3: 最终全量 npm test**

Run: `npm test`
Expected: 14 个测试文件全绿。

- [ ] **Step 4: 更新 AGENTS.md 已知遗留**

修改 `AGENTS.md` 的「小说阅读器」已知遗留段：
- 把"最后一章吞后记/番外"那条标记为**已修复**（加注：v2 通过标记词切分，回到明朝型无标记词仍遗留）。
- 在已知遗留列表加一条：「无标记词的后记无法切分（回到明朝型），文件末尾只有站点广告或纯感言、无尾声/（全文完）类标记词时，后记仍并进末章」。

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md
git commit -m "docs(AGENTS): 更新已知遗留——后记识别已实现(回到明朝型仍遗留)"
```

---

## Self-Review (写计划者自查)

**1. Spec coverage：**
- spec §1 前言识别 → Task 2（测试）+ Task 4 Step 1-2（实现）✓
- spec §2 后记识别 → Task 3（测试）+ Task 4 ✓
- spec §3 边界情况A → Task 3 的"无标记词不切分"用例 + Task 5 回到明朝样本 ✓
- spec §4 数据结构不变 → Task 4 实现沿用 `{title,startOffset,endOffset}` ✓
- spec §5 实现位置（只改 reader-toc.cjs）→ Task 4 ✓
- spec 测试策略（6 本样本 + 守卫 + 批量）→ Task 5 + Task 6 ✓
- spec 验证清单 → Task 7 ✓

**2. Placeholder scan：** 无 TODO/TBD。所有代码块完整。Task 7 Step 1 的 86 本路径是"问用户"——这是合理的运行时输入，不是占位符。

**3. Type consistency：** `hasPrefaceTitleWord` / `findAfterword` / `lineMatchesGuard` 在 Task 4 定义、Task 4 Step 2 调用，名字一致。`AFTERWORD_CANDIDATES` / `PREFACE_TITLES` 常量名一致。`chapters.unshift` / `chapters.push` 用法正确。`{title, startOffset, endOffset}` 结构贯穿一致。

**潜在风险点（执行者注意）：**
- Task 4 Step 2 的 `chapters.unshift` 会改变 `chapters[0]`，后记逻辑用 `chapters[chapters.length-1]` 不受影响（前言在头部，后记在尾部，互不干扰）。✓
- 前言判断 `chapters[0].title !== "全文"` 确保 fallback 全文章节时不误加前言。✓
- 后记守卫 `lineMatchesGuard` 的 `t.startsWith(word)` + `^[。！？!?)）\s]` —— 注意 `（全文完）` 这类标记词本身以 `（` 开头，trim 后整行可能就是 `（全文完）`，走 `t === word` 分支。✓ 但如果行是 `（全文完）。` 则走 startsWith + rest=`）。` 匹配 `)`。✓
- "序" 单字正则 `(?:^|\n)\s*序\s*([：:]\s*|\s|$)` —— 注意 beforeText 可能以 `序` 开头无前导换行，`^` 分支覆盖。✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-19-frontmatter-backmatter.md`. 两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 派一个新 subagent，Task 间 review，迭代快
**2. Inline Execution** — 本会话内批量执行，带 checkpoint review

选哪种？
