---
description: "doclib 文档库插件按「文档 / 元数据 / 上下文 / wiki」四条概念线落地到代码的实施规划。"
---

# doclib 实现规划

依据：`doclib 设计文档 v0.3`（2026-11-06，资料库页面 `SyBhiTKVg7fEPo97UKmsxW`）。
对照代码：`@local/dsh-plugin-doclib` 0.1.0（`index.js` 1526 行 / `client.js` 1261 行）。

这份文档只回答一件事：**四条概念线各自要在哪个文件里、按什么顺序、改出什么形状**。

> **实施状态（2026-11-09）**：P0、P1 已落地。源码在 `haiercash/builtin-plugins/hi-buddy-doclib-kit/`（`index.js` 只做装配，`client.js` 保持单文件）；实测数字与验收见 `evals/p1-results.json`，口径回写见 §10。下文保留原始论证，与代码冲突时以 §10 为准。

---

## 0. 结论先行

| 概念 | 一句话目标 | 主要落点 | 分期 |
|---|---|---|---|
| 文档 | 换主键：位置当身份，内容当版本，出处降级成数组 | `shared/pathKey` + `index` | P0–P1 |
| 元数据 | 从「描述」变成「判据」：每个字段必须能省掉一次读盘 | `index/fingerprint` + `index/refs` | P1–P2 |
| 上下文 | 新建一层只追加、不可重建的事实记录 | `store/context` | P1 |
| wiki | 跨文档才建页，页必须能自证来源与新旧 | `compiler/` + `validator/` | P6 |
| 规则（横切） | 何时该查、查什么、别乱查，全部是数据不是代码 | `rules/` + `inject/` | P4 |

排序不是偏好：**没有正确的主键，去重就是在放大错误；没有去重，蒸馏只会把同一份文档蒸成多页。**

---

## 1. 开工前必须拍定的三件事

这三条不定，后面每一项都会返工。

### 1.1 源码归位（已解决：方案 A）

**2026-11-09 已完成**：源码在 `haiercash/builtin-plugins/hi-buddy-doclib-kit/`，已进入 `pnpm-workspace.yaml`，`packages/bundle/web-app` 以 `workspace:*` 引用，`local-dsh-plugin-doclib-0.1.0.tgz` 只是旧产物。以下为当时的决策记录：

| 方案 | 做法 | 代价 |
|---|---|---|
| A（建议） | 解包成 `haiercash/builtin-plugins/local-dsh-plugin-doclib/`，源码进 git，加 `pnpm pack` 脚本产出同名 tgz | 一次搬家；需确认 `pnpm-workspace.yaml` 是否要纳入 |
| B | 保持 tgz 分发，源码放独立仓库 | 双仓同步，改一次要发两次 |
| C | 直接在 `.pnpm` 解包目录里改 | 不可持久，装一次就没；**不要选** |

选 A 时需要同时确认：`cordis.patch.yml` 里 `root: docs` 是否仍指向仓库根 `docs/`（当前 `DEFAULT_ROOT = 'docs'`）。

### 1.2 评测集口径

P0 就要建 15 条查询，且**必须同时记录命中的重复条数**。原因：现状 638 块里 507 块是重复副本，前三名常是同一文件的三个副本，只记 hit@1 会虚高——P2 去重之后的「提升」会被这条统计口径吃掉。

判定：`hit@1` = 第一条结果的 `pathKey` 命中预期文件；`dup@1` = 前 3 条里同 `pathKey` 出现次数 − 1。

### 1.3 聚合只做一次

现状搜索和面板各自聚合，所以「搜到了但表格里是两行」。定死一条：**聚合发生在 `index/` 产出的 `documentCache`，`search/`、`http/`、`client.js` 都只消费**。客户端不许再做 merge。

---

## 2. 现状基线（代码级事实）

| 项 | 实测（2026-11-09，仓库 `docs/` 语料） | 出处 |
|---|---|---|
| 索引版本 | v2 = 2；实现已升 v3 | `store/index-store.js` |
| 主键 | v2 `docKeyOf(sessionId, identity)`；v3 `pathKey` | `shared/pathKey.js` |
| 索引体积 | v2 10.88 MB → v3 355 KB（−96.8%，378 B/篇） | `evals/p1-results.json` |
| 记录 / 不同路径 | 962 / 962（v2 的 `path` 实际只有 1 个值：`[object Object]`） | 同上 |
| 检索块 | 7824 | 同上 |
| 类型分布 | v2 `folder` 962/962；v3 按扩展名分 `doc/code/config/data` | `shared/typeClass.js` |
| TTL | v2 单一 `ttlSeconds = 120`；v3 默认 0（只按写事件 + 指纹失效） | `index.js` `Config` |
| 工具 | 4 个不变：`doc_search` / `doc_read` / `doc_list` / `doc_status` | `tools/` |
| 面板路由 | 7 条 + `/context` | `http/routes.js` |
| 注入 | 无（P4） | — |
| `doc_read` 分页 | 仍按字符 `offset / maxChars`（P3 再加行号） | `tools/read.js` |
| `doc_list` 过滤 | `workspace / session / prefix / limit`，无时间窗 | `tools/list.js` |
| 上下文 | `<root>/.doclib/context.jsonl`，只追加 | `store/context-store.js` |

### 必须最先修的 bug（已修复）

原 `index.js:857`：

```js
path: entry.target ? String(entry.target) : '',
```

`entry.target` 是宿主 fs 的 `FsTarget` 对象（`{ targetKey, displayPath }`），`String()` 得到 `"[object Object]"`。**2026-11-09 实测不是 4 篇，而是 962 篇全部命中**，`path` 的不同值只有 1 个。两层后果：

1. `doc_read({ path })` 对目录文档永远失败，只能靠 `key` 兜底；
2. **按 path 去重会把 962 篇内容完全不同的文档聚成 1 篇**，用户看到的是数据丢失。

修法（已落地）：`sources/folder-source.js` 用 `path.resolve(rootPath, rel)` 产出真实绝对路径；路径查找先归一到 `pathKey`（`index/lookup.js`），不再依赖 `cwdKey` 模糊匹配。

这条 bug 说明一个顺序问题：**去重不能先做**。聚合键建立在 path 之上，path 是假的，去重就是在放大错误。所以 P0 修 bug，P1 才能动索引，P2 才谈去重。

### 一条可以关掉的未决项

设计文档里悬着「`ctx.on('tool/call')` 是否可拦截」。已核实：

- `tool/call` 是**会话事件**（`agent.session.append('tool/call', …)`，`packages/core/tools/src/batch.ts:247`），进 append-only 日志，可读不可拦；
- 真正可拦的是 `fs/write-intent` / `fs/edit-intent`（`packages/fs/fs/src/index.ts:66, 74`），waterfall，带已解析的 `target`。

⇒ **标脏方案不等 `tool/call`**，直接用 `fs/write-intent` + `fs/edit-intent` 拿到 target 就标脏，成本为零，且不依赖事件是否可消费。这条从「未决」降级为「已定」。

---

## 3. 四条概念线 → 具体改什么

### 3.1 文档线：先换主键，再谈去重

**要回答**：这是什么内容。

**核心动作**：把三重身份拆开，不要让它们挤在一个字段里。

| 身份 | 现状 | 目标 | 存哪 |
|---|---|---|---|
| 位置 | `path`（且 folder 类是假值） | `pathKey`，主键 | 索引 |
| 内容 | 无 | `contentHash: sha256:…`，版本标识 | 索引 |
| 出处 | `key = docKeyOf(sessionId, identity)` | `sessionIds: string[]`，降级为关系元数据 | 索引 + 上下文 |

`pathKey` 形式（唯一实现放 `shared/pathKey.js`，任何地方不得自行拼接）：

```
工作区文件   wb:<workspaceId>/<rel>        例：wb:haiercash/docs/architecture.md
会话附件     attachment:<attachmentId>
未归档       folder:<rel>
```

用 `workspaceId + rel` 而不是绝对路径：绝对路径换机器、换检出目录就变，而位置身份不该随环境漂移。

**连带后果**（必须在 P1 一起做，否则半成品）：

- `documentByKey()` 改为按 `pathKey` 取；`doc_read({ path })` 先归一成 `pathKey` 再查，不再靠 `cwdKey` 模糊匹配（`index.js:1180`）。
- `docKeyOf(sessionId, identity)` 从主键位置退场，改为 `pathKey` 的函数。**注意：这是破坏性变更**，旧索引里所有 `key` 都要迁移。
- 「同一文件被 3 个会话写过」从 3 条记录变 1 条记录 + `sessionIds.length === 3`，这就是搜索角标「3 个会话」的数据来源。

**验收**：35 个不同路径 → 35 条记录（现状 70 条）；`doc_read({ path })` 对 folder 类文档可读；同一文件三个会话只出现一次，角标显示 3。

### 3.2 元数据线：从「描述」变成「判据」

**要回答**：在哪、变没变。判据是「不读正文就能做出判断的最少信息」——一个字段值不值得存，看它能不能省掉一次读盘。

三类分开，各用各的失效条件：

| 类 | 字段 | 派生源 | 失效条件 |
|---|---|---|---|
| 固有 | `size` `lines` `ext` `contentHash` | 文档内容 | 指纹变化 |
| 关系 | `workspaceId` `sessionIds` `refs` `citedCount` | 上下文事件 | 事件追加 |
| 计算 | `chunks` 边界 `tokenCount` `typeClass` `headingTree` | 索引构建 | 前两者变化 |

**TTL 必须拆**。现状 `ttlSeconds: 120` 是单一值，而且方向是反的——没变的文档每两分钟重算一次，刚写的却要等两分钟才搜得到。目标：

- 固有元数据：按 `mtime + size` 判断，不变即命中缓存，**不设时间 TTL**；
- 关系元数据：由上下文事件驱动，不进 TTL；
- 计算元数据：按 `contentHash` 失效，指纹不变就不重算。

**引用图**（S4「还最新吗」的唯一支撑）：`refs: string[]`，存该文档正文里出现的、库内已知的相对路径。构建时机在切块之后、写索引之前。它能回答「deploy.md 引用的 deploy.sh 昨天改过」，这是现在答不出来的。

**类型准入**：`generated` 61/70，大量是源码，稀释了「资料」。加 `typeClass: doc | code | config | data`，检索默认隐藏 `code`，面板筛选也默认隐藏。

**验收**：索引 < 80 KB、冷启动 < 50 ms；改 1 个文件只重读该文件；`refs` 能列出某文档引用了哪些文件；搜索默认不出源码。

### 3.3 上下文线：新建一层不可重建的事实

**要回答**：谁在什么时候为什么要它。这是四条线里唯一**现在完全为空**的一层，也是权威序里排第二（仅次于文档）的一层——因为它记的是事实，元数据和 wiki 都是再造物。

**四类事件**，只追加，永不改写：

| 类型 | 何时写 | 携带 |
|---|---|---|
| `captured` | 文档首次入库 | `pathKey` `sessionId` `actor` |
| `read` | `doc_read` 命中 | `pathKey` `sessionId` `actor` `offset` |
| `cited` | `doc_search` 结果被模型引用 | `pathKey` `sessionId` `query` `rank` |
| `distilled` | wiki 页从该文档生成 | `pathKey` `pageKey` |

**粒度定死在文档级**（D6），段级定位另走 `page_sources`。理由：段级事件量级是文档级的十几倍，而 90% 的问题只需要「哪篇被引过」。

**存储**：`<root>/.doclib/context.jsonl`，单文件追加。与索引**分开存**——索引可弃、上下文不可。这条必须写成代码断言：

```js
// store/index 的重建路径里
assert(!rebuildTouches(contextPath), 'context.jsonl 不得随索引重建被删除或重写')
```

设计文档把它列为风险（「上下文被误删，使用历史永久丢失，无任何症状，只是排序慢慢变差」），无症状的丢失最危险，所以要用断言而不是靠自觉。

**反向查询**（S5「哪来的」，唯一用到反向可逆的场景）：`documentContext(pathKey)` → 事件列表 → 会话。现在只有「会话 → 文档」一个方向，所以「这个架构文档是谁写的、当时为什么这么定」的答案是「不知道」。

**验收**：`rm .doclib/index.json` 重建后 `context.jsonl` 字节不变；能从文档查到它来自哪几个会话的哪几次写入。

### 3.4 wiki 线：最后建，但格式先定

**要回答**：合起来说明什么。

结构上排最后（P6），因为 `5 个虚线模块里有 3 个集中在沉淀组`——那片没有可复用的旧代码。但**页格式要在 P1 就定下来**，否则 P6 会推翻前面所有 `page_sources` 口径。

三种页型，两种生命周期，原因不同：

| | 复盘页 | 决策页 | 概念页 |
|---|---|---|---|
| source | 会话事件 | 文档当前内容 | 多篇文档 |
| 源变了要不要重写 | **不要** | 要 | 要 |
| 更新方式 | 冻结，只在面板提示 | 增量合并 + `supersedes` | 增量合并 |
| 失效频率 | 几乎不失效 | 易过时 | 中 |

「复盘页描述当时怎么想，文档后来改了它依然准确——改它反而是篡改历史。」这条不是风格，是从 source 类型推出来的。

**唯一触发点**：会话结束。产 1 页复盘 + 判断这次任务有没有产生或推翻决策，有则入队一个工作区级更新。不给工作区级单独找触发时机——否则必然退化成「定期全量重蒸」，`supersedes` 链会变成噪声。

**三条硬约束**（对应 Karpathy 三层必须偏离的三处）：

1. **反向索引**：`source.contentHash` → 页。源改了页必须知道，否则 wiki 静默腐烂。
2. **来源标记**：`contentSource: external | agent | mixed`。61/70 是 agent 自产，整条链路 `agent 写 → 蒸成 wiki → 注入回 agent` 是闭环，错误会被放大而非纠正。注入时标「未经外部核验」。
3. **双作者**：人改过的段落加 `<!-- human -->` 标记，下次蒸馏跳过该段。否则人工修正会被静默吞掉。

**validator 的四条规则**（不通过就不入队）：

1. 候选页的 `sources` 去重后 `pathKey` 数 **≥ 2** —— 只来自一篇文档的，那是摘要，该由 `doc_read` 覆盖（D9）；
2. 每条 `source.contentHash` 必须能在当前索引找到；找不到标 `stale`，**不静默丢弃**；
3. `pageType === 'retro'` 时 `frozen === true`，拒绝任何重写；
4. 被新页 `supersedes` 的旧页 `status: superseded`，**不删除**（链路要可回溯）。

**验收**：改 1/5 个来源，页显示「1/5 已更新」仍可用；只来自单篇文档的候选页被拒。

### 3.5 规则线：横切四层，是第五个概念

设计文档的五个概念表里有一行「规则 —— 怎么维护上面四个 —— 行为失控 —— 靠版本化回滚」。它不占一条独立数据流，但四条线都要读它。

**现状是零注入**：四个工具常驻上下文，模型缺的不是入口而是使用时机。所以：

- **加注入片段，不加 SKILL.md**。加 skill 要多付一次「是否加载」的决策成本 + 一份常驻描述。
- **L1**：工作区文档目录（压缩到路径级）+ 使用规则（什么时候该查）；
- **L2**：自动召回，**默认关**——它只服务 S6「继续昨天」这种用户没给任何线索、模型要自己接上的场景，检索做不到；
- **L3**：`@` 引用源，与插入引用格式统一。

**反场景判据必须写进规则文件**（S8「写个 hello world」）：一个总在查库的助手比一个从不查库的更烦人。L2 一旦默认开又没有判据，会污染简单对话。

**规则是数据**：页规范、注入文案、字段约定都是可版本化实体，改它不该动代码，且必须能回滚（`rules/` 下带版本号的文件，不是常量）。

**验收**：12 条指令里 ≥ 10 条一次选对工具；注入 ≤ 1200 字符；关掉 `autoRecall` 时零注入。

---

## 4. 目标结构

从单文件 1526 行拆成目录。切分依据不是技术分层，而是「什么会变」——`search/` 只要拿到一个文档数组就能工作，它不该知道文档是从会话来的还是从目录扫的。

```
local-dsh-plugin-doclib/
  index.js              # 只做装配：读配置、注册工具/路由、订阅事件
  cordis.patch.yml
  client.js             # 只渲染，不再聚合
  shared/
    pathKey.js          # 归一化唯一实现（红线：不得有第二份）
    typeClass.js        # doc | code | config | data
    hash.js
  sources/
    session-source.js   # DocSource: collect() → DocRecord[]
    folder-source.js
    attachment-source.js
  index/
    build-index.js      # 唯一构建入口：收拢脏标记、指纹、缓存
    chunk.js            # 标题级切块，记 heading / endLine
    fingerprint.js
    refs.js             # 引用图
    dirty.js            # 订阅 fs/write-intent / fs/edit-intent
  search/
    tokenize.js
    postings.js
    rank.js             # 纯函数，不碰 I/O，可单测
  store/
    index-store.js      # 可弃
    context-store.js    # 不可弃，重建不得触碰
  tools/                # 4 个模型可见工具
  http/                 # 7 条面板路由
  inject/               # L1 / L2 / L3
  compiler/             # 蒸馏队列、复盘/决策/概念页模板
  validator/            # 页校验
  rules/                # 规则读取与版本
```

**六条硬边界**（接口存在即为了挡住某种退化）：

| 接口 | 职责 | 为什么必须存在 |
|---|---|---|
| `DocSource` | `collect()` 产出记录 | 新增来源不改上层 |
| `DocRecord` | 唯一的文档形状 | 否则字段会分裂成两三套 |
| `buildIndex()` | 唯一构建入口 | 收拢脏标记、指纹、缓存 |
| `search()` | 纯函数，不碰 I/O | 排序改动能在测试里做 |
| `ContextLog` | 只追加的事实 | 重建不得动它 |
| `Rules` | 规则读取与版本 | 改规则不该动代码 |

**只经门面读下层，不 import 内部模块**——将来可整体抽成独立包。

---

## 5. 三份数据契约

先定格式，再写代码。三份契约任何一处改动都要同步改本文档。

### 5.1 索引 v3（已按实现回写）

正文不进索引，分片按 `contentHash` 内容寻址落在 `<root>/.doclib/chunks/<前两位>/<32hex>.json`。

```jsonc
{
  "version": 3,
  "generatedAt": 1794190870256,
  "mode": "sessions",
  "truncated": false,
  "root": "/…/docs",
  "workspaces": [
    {
      "id": "w1", "title": "仓库", "path": "/…/repo",
      "sessions": [
        { "id": "s1", "title": "…", "createdAt": 0, "updatedAt": 0,
          "live": false, "error": null,
          "documents": ["wb:w1/docs/architecture.md"] }
      ]
    }
  ],
  "docs": {
    "wb:w1/docs/architecture.md": {
      "typeClass": "doc", "size": 12345, "lines": 312, "chunkCount": 14,
      "contentHash": "sha256:9f2c…", "fingerprint": "12345:ab12…",
      "kind": "generated", "sessionIds": ["s1", "s2", "s3"],
      "refs": ["docs/deploy.sh"], "searchable": true
    }
  }
}
```

与初版契约的三处必要差异：

- **`pathKey` 就是 `docs` 的 map key**；`rel` / `name` / `ext` / `abs` 在读取时回推（`normalizeStoredDoc`），不重复落盘。
- **`fingerprint = size + hash(后端 version)`**：`FsInfo` 只有 `size` 与不透明 `version`，没有 `mtimeMs`，所以不能按 mtime 建指纹。
- **默认值省略**（`false` / `0` / `[]`）由读取端恢复；962 篇下这一条省下约 40 KB。
- `workspaces` 只保留「工作区 → 会话 → 文档 key」骨架，供面板分组；同一文档只存一份，多出处靠 `sessionIds`。

### 5.2 上下文事件

```jsonc
{"t":1794190870256,"type":"cited","pathKey":"wb:haiercash/docs/architecture.md","sessionId":"s1","actor":"agent","detail":{"query":"索引方案","rank":1}}
```

`actor: user | agent | system`。按天聚合是**读取视图**，不是分文件——分文件会让「三个月前的上下文」走向量级碎片。

### 5.3 wiki 页

```yaml
---
pageKey: decision/doc-identity
pageType: decision          # decision | retro | concept
status: active              # active | superseded | contested
contentSource: mixed        # external | agent | mixed
frozen: false
sources:
  - pathKey: wb:haiercash/docs/architecture.md
    contentHash: sha256:9f2c…
    heading: "## 文档身份"
    sessionId: s1
    capturedAt: 1794190870256
supersedes: [decision/old-identity]
---
```

`page_sources` 五元组 = `pathKey + contentHash + heading + sessionId + capturedAt`。`contentHash` 是失效判据，`heading` 是漂移锚点（用标题路径不用行号，行号会随编辑失效），`capturedAt` 让「1/5 已更新」能说清是哪一次。

---

## 6. 分期执行

| 期 | 内容 | 验收 | 回退 |
|---|---|---|---|
| **P0** 校准 | 修 folder 文档 path 假值；建 15 条评测集（含 `dup@1`）；核验 `locale/` 仍在被宿主读取 | `node scripts/eval.mjs` 一条命令输出 `hit@1 / hit@3 / dup@1`；962 篇 path 均为真实绝对路径 | 纯增量，可逐条 revert |
| **P1** 索引 | v3 去正文；`pathKey` 唯一实现；指纹 + 脏标记 + 上下文存储；内容寻址分片 | 索引 355 KB（相对 v2 −96.8%、378 B/篇）；冷启动 5 ms；首搜 264 ms；写完立刻可搜；`context.jsonl` 重建后 SHA-256 不变；改 1 个文件只重读 1 次 | 保留 v2 读取分支（内存迁移），`version` 字段分支 |
| **P2** 检索 | `pathKey` 聚合；标题进倒排；类型权重；时效分带；停用词与查询预算 | `hit@1` 相对基线 ≥ +20%；`dup@1 = 0`；搜 `index` 只返回 1 条，角标 3 个会话 | 排序策略走 `rules/`，可整份换回 |
| **P3** 定位 | 标题级切块记 `heading/endLine`；`doc_read` 支持行号区间；附件文本落盘 | 结果能报 `docs/x.md:120（§2.3 消息协议）`；按行读与按字符读同区间一致 | 字符分页保留为默认 |
| **P4** 注入 | L1 目录 + 使用规则；L3 `@` 源；L2 召回（默认关） | 12 条指令 ≥ 10 条一次选对工具；注入 ≤ 1200 字符；关闭时零注入 | 单开关全关 |
| **P5** 面板 | 同 `pathKey` 合并一行 + 来源角标；类型筛选默认隐藏代码；引用卡片 + 定位联动 | 表格行数 = 去重后文档数；点 `[1]` 能落到面板对应段落 | 客户端独立发版 |
| **P6** 沉淀 | 复盘/决策/概念页；`page_sources`；validator；`contentSource`；双作者保护 | 改 1/5 来源 → 「1/5 已更新」仍可用；单篇来源候选页被拒 | wiki 作为内部挂载的第二插件，关掉零注入零成本 |

依赖：`P0 → P1 → P2 → {P3, P4, P5} → P6`。P6 额外硬依赖 P2 的两项产出（聚合与类型准入）——它们决定「哪些文档进蒸馏队列」。

**按场景看收益节奏**：P1 就能让 S3「存一下」和 S5「哪来的」可用；S1「上次那个」要等 P2+P3+P4；最需要延续感的 S6「继续昨天」要等到 P6。这个顺序是否可接受，取决于你认为哪个场景最值钱——**这是唯一需要产品判断而不是技术判断的地方**。

---

## 7. 迁移：先拆形状，再改行为

最大的一条纪律：**拆分与改数据结构不要在同一步做**，否则出问题时判断不了是拆错了还是改错了。六步，每步结束时插件都能跑。

| 步 | 动作 | 验收 |
|---|---|---|
| 1 | 抽 `shared/`，`pathKey` 归一化收成唯一实现 | `doc_search` 结果与改前**逐字相同** |
| 2 | 抽 `search/` 成纯函数，同时建评测集 | `hit@1` 与改前完全一致（纯重构不该有涨落） |
| 3 | 抽 `index/` + `sources/`，同时换 v3 索引 | 索引 < 80 KB；改一个文件只重读该文件；引用图可用 |
| 4 | 抽 `store/` 并加上下文 | `rm index.json` 重建后 `context.jsonl` 字节不变 |
| 5 | 抽 `tools/` `http/`，客户端只渲染 | 删掉客户端聚合后，表格行数与搜索条数一致；点 `[1]` 能定位 |
| 6 | wiki 作为内部挂载的第二插件 | 关掉 wiki 时零注入、零成本 |

第 1、2 步是纯重构，验收标准是「输出逐字不变」——这条比任何 code review 都有效。第 3 步才动数据结构，此时形状已经拆干净，出问题一定是数据层的问题。

---

## 8. 风险与未决

### 已定的

- ~~`ctx.on('tool/call')` 是否可拦截~~ → 不可拦（会话事件），改用 `fs/write-intent`（见 §2）。
- ~~源码放 A / B / C~~ → 已按 A 完成，见 §1.1。
- ~~`locale/` 是死引用~~ → **不是**。`packages/boot/app-boot/src/package-meta.ts` 通过 `exports['./locale/*.json']` 读取 `meta.title/description`；删除会丢面板标题。P0 改为「核验 locale 生效」。
- ~~`client.js` 也按 §4 拆分~~ → 不可行：浏览器侧由 `packages/client/modules` 原样串成 combo 脚本执行，`prepareSource` 不重写 import，且本 kit 不在 `tsdown.config.ts` 的 client workspace 内。§4 的拆分只作用于宿主 `index.js`。

### 仍需拍板的

| # | 问题 | 影响 | 建议 |
|---|---|---|---|
| 1 | ~~源码放 A / B / C~~ 已定 A | — | 见 §1.1 |
| 2 | `contested` 由谁判定 | 蒸馏一次还是两次 | 先 LLM 自评 + 记录分值，攒够样本再做独立 lint |
| 3 | 遗忘曲线多久开始降权 | 排序行为 | 先只「标记」不「降权」——没有真实使用数据前任何数字都是猜的 |
| 4 | 文件移动后 `pathKey` 变更，历史怎么迁 | 引用计数挂错行 | 靠 `contentHash` 迁移，时机未定；先做「迁移时打日志」 |
| 5 | L1 注入 1200 字符是否挤占其他插件 | 多插件共存 | 需在多插件 profile 实测，不能只看单插件 |

### 结构性的

- **自产内容闭环**：`agent 写 → 蒸 wiki → 注入回 agent`。61/70 是自产，错误会放大。三重防线：`contentSource` 标记、注入标注「未经外部核验」、冲突不静默。
- **两处做聚合**：搜索去重了、表格没去重。已在 §1.3 定死「服务端一次」。
- **工具 schema 吃 token**：工具数封顶 4 个，详细规则放注入片段，不再加工具。

---

## 9. 一页速查

**这轮活的重心不在加功能，而在换文档的身份模型。**

1. 先修 bug（`index.js:857`），否则去重在放大错误；
2. 再换主键（`pathKey`），消掉 79% 重复；
3. 然后瘦索引（去正文）、建上下文（不可重建）、补引用图（S4 的唯一支撑）；
4. 检索去重后，进入注入与面板；
5. wiki 最后建，但页格式现在就要定。

判断任何一个新需求该不该做，用这条：**它能不能省掉一次读盘，或者省掉一次「该不该查」的决策。** 两者都不能，就不进这个插件。

---

## 10. P0 / P1 落地回写（2026-11-09）

### 代码落点

```
hi-buddy-doclib-kit/
  index.js                 # 装配：配置、服务、注册、订阅、预热（632 行）
  client.js                # 未拆，只渲染
  shared/                  # pathKey / typeClass / hash / doc-record / text
  sources/                 # session / folder / attachment
  index/                   # build-index / aggregate / lookup / chunk / fingerprint / refs / dirty
  search/                  # tokenize / postings / rank
  store/                   # index-store / chunk-store / context-store
  tools/                   # search / read / list / status
  http/                    # routes / json
  scripts/                 # eval / golden / check-incremental / lib
  evals/                   # queries.json / baseline-docs.json / golden-docs.json / p1-results.json
```

`package.json` 的 `files` 已补上这些目录，`exports` 入口不变（宿主相对 import，客户端仍只有 `client.js`）。

### 验收命令

```bash
pnpm --filter @local/dsh-plugin-doclib eval     # hit@1 / hit@3 / dup@1
pnpm --filter @local/dsh-plugin-doclib check    # 9 条结构断言
```

### 与原文数字的偏差（以实测为准）

| 项 | 原文 | 实测 / 实现 | 原因 |
|---|---|---|---|
| 索引体积 | < 80 KB | 355 KB（−96.8%） | 80 KB 是按 35 篇推的；962 篇下每篇 378 B 已接近元数据下限 |
| 冷启动 | < 50 ms | 5 ms | 只读索引 + 建视图，不碰正文 |
| 首搜 | 未单列 | 264 ms（962 分片 + 建倒排） | 正文不进索引的必然代价，后续查询 1 ms |
| 记录 / 块 | 70 / 638 | 962 / 7824 | 语料已变大；`dup@1` 在单副本目录语料下恒为 0，聚合另用合成用例覆盖 |
| P0 修的 folder 文档 | 4 篇 | 962 篇 | v2 索引里所有 folder 文档的 `path` 都是假值 |

### 有意留到后续

- **排序仍可能被大文档主导**（tf 跨全部分片求和），`hit@1` 33% 是 P2 的起点，不是 P1 的回退。
- 目录文档 `updatedAt` 仍为 0：`FsDirEntry` 不带时间，`FsInfo.version` 不透明，面板显示 `—` 与改前一致。
- 引用图的 `rel` 命名空间按文档各自基准（`wb:` 相对工作区、`folder:` 相对 root），跨工作区引用暂不解析。
- 首搜 264 ms 可后续换成持久化倒排或分片预热；当前作为已知成本记录在 `evals/p1-results.json`。
