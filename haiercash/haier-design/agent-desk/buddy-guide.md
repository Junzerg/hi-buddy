# AgentDeck 接入指南（buddy 侧）

> 供 buddy（海智伙伴）团队接入使用。本文只写接入所需内容：检测、启动、参数、引导、联调。
>
> 目标：buddy 侧一个入口按钮，拉起 AgentDeck 桌面程序，用户带着海尔蓝主题进入（视觉连续）。
>
> **生效版本**：本文全部能力（参数解析 / `agentdeck://` 协议注册 / `--version`）自
> **我方通知的首发版本**起可用（版本格式 `1.0.<yyyymmdd><seq>`，如 `1.0.2026112001`）。
> 在此之前已发布的旧版本：`spawn` 拉起可用，但所有参数被忽略、无协议注册、无 `--version`。
>
> **下载入口（2026-11-20 起）**：官网 `https://agentdeck.haierxj.cn/`，版本真理源 = 站上
> `version.json`（下载接口契约与校验逻辑见 §5.1；截至本文更新最新版本 `1.0.2026112003`）。

---

## 1. 启动通道

buddy 的检测/启动执行体是本地进程：

| 通道 | 机制 | 定位 |
|---|---|---|
| **spawn argv（主通道）** | `spawn(exePath, ['--from','hibuddy','--theme','haier','--focus'])` | 本地直起，参数显式、可探测、可控 |
| **deep-link `agentdeck://`** | `agentdeck://open?theme=haier&...` | 供浏览器/网页入口；协议注册键由 AgentDeck 安装器写入（§3.1 级 1），同一解析器处理 |

两种形态 Windows 上最终都以 argv 到达 AgentDeck，参数语义完全一致。

## 2. 参数契约

```
# argv 形态（主通道；workspace 可选，默认不传——恢复用户上次活跃空间）
AgentDeck.exe --from hibuddy [--workspace "<绝对路径>"] [--theme haier] [--focus]

# URL 形态（deep-link，同参数语义）
agentdeck://open?from=hibuddy&theme=haier&focus=1
```

| 参数 | 必传 | 语义 | 行为 |
|---|---|---|---|
| `--from hibuddy` | 建议 | 来源标记 | 首次显示欢迎 toast「已从海智伙伴进入」 |
| `--theme haier` | **是**（保证海尔蓝） | **会话级主题覆盖**：内存态生效、**不写设置**，退出即还原（下次用户自己打开仍是其默认主题）；用户在会话中手动切主题视为用户意图优先，覆盖自动让位 | 白名单校验（system/light/dark/eye-care/sepia/nord/haier），非法值忽略；不传则按用户自己的主题设置启动 |
| `--workspace <path>` | 否（**推荐默认不传**） | 工作空间目录 | **不传 → 不动工作空间，恢复上次活跃**（干扰最小）；已注册 → 激活该空间；未注册 → 静默创建（无弹窗）；仅接受**存在的绝对路径**（URL 形态需编码），否则视为不传 |
| `--focus` | 是 | 已运行时聚焦 | 与单实例锁联动（§6）：运行中再拉起会把参数转发给既有实例（聚焦 + 切主题 + workspace 编排） |

所有非法参数（未知 theme / 相对路径或不存在 workspace / 畸形 URL）一律**静默丢弃该项**，不影响启动。

## 3. 安装与版本检测（buddy 本地进程）

### 3.1 是否已安装（三级探测，从准到宽）

| 级 | 探测物 | 命令 | 拿到什么 |
|---|---|---|---|
| 1 | **协议注册键** | `reg query "HKCU\Software\Classes\agentdeck\shell\open\command" /ve` | 存在=可唤起（**安装时写入**，`/S` 静默装同样写入，装完即可用；应用启动时幂等覆盖同值）；值形如 `"C:\...\AgentDeck.exe" "%1"`，**解析引号内即 exe 路径**（含自定义安装位） |
| 2 | **卸载注册键**（最权威） | `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall /s /f "AgentDeck" /d`（按 DisplayName 搜；键名是 appId 派生 GUID 不用猜） | 命中键下再查 `DisplayVersion`（版本）、`InstallLocation`、`DisplayIcon`（通常即 exe 路径） |
| 3 | 默认路径兜底 | `existsSync(%LOCALAPPDATA%\Programs\AgentDeck\AgentDeck.exe)` | 仅默认位命中（安装器允许改目录，所以是兜底） |

全 miss → 未安装，走 §5 引导。**检测时机**：入口按钮点击时现查，**不要长缓存**（用户升级后旧缓存会误判）。

### 3.2 版本信息（三法，按可靠度排序）

| 法 | 适用 | 做法 |
|---|---|---|
| 卸载键 `DisplayVersion` | 安装版（**首选**） | §3.1 级 2 的键里直接读，不碰 exe |
| exe 文件版本资源 | 拿到 exe 路径即可 | `powershell -NoProfile -c "(Get-Item '<exe>').VersionInfo.ProductVersion"`（与右键属性同源） |
| `--version` 参数 | 首发版本起 | `AgentDeck.exe --version` → stdout 打印版本号后退出。⚠️ Windows GUI 子系统 stdout pipe 偶发兼容坑，不稳则弃用——前两法已够 |

三法同源（构建时统一注入），不会不一致。

### 3.3 运行中检测（可选，UI 状态用）

`tasklist /FI "IMAGENAME eq AgentDeck.exe"`。运行中**无需特殊处理**：照常 spawn `--focus`，
单实例锁会把参数转发给既有实例。

### 3.4 升级协商（建议实现）

推荐**动态协商**：拉 `https://agentdeck.haierxj.cn/version.json` 取 `latest`（契约见 §5.1），
与本地版本比较，低于 latest → 入口提示"请升级 AgentDeck"（引导到官网下载页，或 buddy 代下载
+ 静默装，逻辑见 §5.1）。另内置 `MIN_AGENTDECK_VERSION` 常量兜底（清单拉取失败时不阻断引导）。
版本比较 buddy 自备（格式 `1.0.<yyyymmdd><seq>`，三段均按整数比）。
升级方式 = 下载新 Setup **覆盖安装**（保数据，见 §5.2）。

## 4. 启动模块（可直接抄）

**`agentdeck-launcher.js`（Node ≥16）**：

```js
'use strict';
const { spawn, execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');

// 兜底下限（离线/清单拉取失败时用；格式 1.0.<yyyymmdd><seq>，三段均按整数比较）。
// 在线场景建议直接拉官网 version.json 的 latest 动态协商（§5.1），免随发版维护此常量；
// 1.0.2026112001 = 首发能力版本（参数解析/协议注册/--version 齐备）
const MIN_VERSION = '1.0.2026112001';

function reg(args) {
  try { return execFileSync('reg', args, { encoding: 'utf8', windowsHide: true }); }
  catch { return null; }
}
const val = (out, name) => out?.match(new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`, 'i'))?.[1]?.trim();
const quotedPath = (s) => s?.match(/"([^"]+)"/)?.[1] ?? null;

/** 安装探测（§3.1 三级）。返回 { exe, version? } 或 null */
function detect() {
  // ① 协议注册键（安装时写入；值形如 "C:\...\AgentDeck.exe" "%1"）
  const proto = reg(['query', 'HKCU\\Software\\Classes\\agentdeck\\shell\\open\\command', '/ve']);
  const protoExe = quotedPath(val(proto, ''));
  if (protoExe && existsSync(protoExe)) return { exe: protoExe };

  // ② 卸载注册键（含 DisplayVersion / InstallLocation）
  const hit = reg(['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
                   '/s', '/f', 'AgentDeck', '/d']);
  const key = hit?.match(/^(HKEY\S+)$/im)?.[1]; // /f 命中块的键行，按实际输出微调
  if (key) {
    const version = val(reg(['query', key, '/v', 'DisplayVersion']), 'DisplayVersion');
    const loc = val(reg(['query', key, '/v', 'InstallLocation']), 'InstallLocation');
    const exe = loc ? path.join(loc, 'AgentDeck.exe') : null;
    if (exe && existsSync(exe)) return { exe, version };
  }

  // ③ 默认位兜底
  const def = path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'AgentDeck', 'AgentDeck.exe');
  return existsSync(def) ? { exe: def, version: null } : null;
}

/** 拉起 AgentDeck 带海尔蓝进入（§2 契约）。workspace 可选。返回 false=未安装 */
function launch({ workspace } = {}) {
  const d = detect();
  if (!d) return false;
  const args = ['--from', 'hibuddy', '--theme', 'haier',
    ...(workspace ? ['--workspace', workspace] : []), '--focus'];
  spawn(d.exe, args, { detached: true, stdio: 'ignore' }).unref(); // 脱离 buddy 进程树
  return true;
}

module.exports = { detect, launch, MIN_VERSION };
```

入口按钮：`const d = detect(); if (!d) showInstallGuide(); else launch();`
（默认不带 workspace——AgentDeck 恢复用户上次活跃空间；仅在需要"从 buddy 当前项目无缝续接"时才透传，见 §8 FAQ）

**浏览器入口（可选）**：`location.href = 'agentdeck://open?from=hibuddy&theme=haier...'`
（未装兜底用页面 blur/超时启发式判断协议无 handler）。

## 5. 未装引导与分发

### 5.1 下载接口与逻辑（官网 version.json，唯一分发入口）

AgentDeck 的版本发布与分发走官网静态站，**站上 `version.json` 是版本真理源**——AgentDeck
应用内自更新、官网下载页、buddy 引导，三方消费同一份清单：

| 接口 | 地址 | 用途 |
|---|---|---|
| 官网下载页 | `https://agentdeck.haierxj.cn/` | 人工下载（安装版推荐 + 绿色版 + 版本历史） |
| 版本清单 | `GET https://agentdeck.haierxj.cn/version.json` | **程序化检测/下载的唯一入口**：最新版本号、产物直链、sha256、更新策略 |
| 产物直链 | `https://agentdeck.haierxj.cn/<asset.url>` | `asset.url` 是站根相对路径（如 `downloads/AgentDeck-Setup-1.0.2026112003.exe`），**以清单为准拼接，不要自行拼文件名** |

**version.json 契约**（`schemaVersion: 1`；不认识的 `schemaVersion` 视为清单不可用，buddy 应回退内置兜底而非报错）：

```json
{
  "schemaVersion": 1,
  "latest": "1.0.2026112003",
  "versions": [
    {
      "version": "1.0.2026112003",
      "releasedAt": "2026-11-20",
      "policy": "optional",
      "notes": "…",
      "assets": {
        "installer": {
          "url": "downloads/AgentDeck-Setup-1.0.2026112003.exe",
          "size": 134381949,
          "sha256": "d0114408ab27dbc06819b8308aa96add2bdda6470ca85284d0dbdd3e6f98ec9b"
        },
        "portable": {
          "url": "downloads/AgentDeck-1.0.2026112003-win.zip",
          "size": 200564113,
          "sha256": "5ae677ad5599eab628d9e8ca353a4936720958d5c46c656c7120ee41f32568da"
        }
      }
    }
  ]
}
```

| 字段 | 语义 | buddy 需要关心 |
|---|---|---|
| `latest` | 最新已发布版本号（指向 `versions[]` 中某条；缺失按 `versions[0]` 兜底） | **是**（升级协商的动态下限） |
| `versions[].version` | 版本号 `1.0.<yyyymmdd><seq>`，列表新在上 | 是 |
| `assets.installer` | NSIS 安装版产物（url/size/sha256），**buddy 分发用这个** | 是 |
| `assets.portable` | 绿色版 zip（仅 AgentDeck 自更新/人工下载用） | 否 |
| `size` | 字节（安装版 ~128 MiB / 绿色版 ~191 MiB，以清单为准） | 参考（带宽规划） |
| `sha256` | 下载后强校验 | **是**（见下方逻辑） |
| `policy` / `notes` / `releasedAt` | 仅影响 AgentDeck **应用内**更新提示强度与文案 | 否 |

**buddy 侧下载/升级逻辑**（与 AgentDeck 应用内自更新同一安全口径，照抄即可）：

1. **取清单**：GET `version.json` → 按 `latest` 命中 `versions[]` 条目（缺失退 `versions[0]`）。
   ⚠️ 清单是纯静态站资源，**未开放跨域**——buddy 入口若是纯网页，须经 buddy 本地进程/服务端
   代理拉取，不要在浏览器里直接 fetch；
2. **比版本**：三段式数值比较，**第三段按整数比**（`2026111902 < 2026112001` 成立）；
   清单版本 ≤ 本地已装 → 无需动作（降级守卫，站点误配/回滚不影响已升级用户）；
3. **下载**：`new URL(asset.url, 'https://agentdeck.haierxj.cn/')` 拼绝对地址——**只接受该域 +
   https**，清单里出现外域绝对 URL / 非 https 一律拒收（防清单被篡改后诱导下载任意 exe）；
4. **校验**：下载完成后 sha256（流式）与 `asset.sha256` 比对，**不过即删、绝不执行**；
5. **安装**：`AgentDeck-Setup-<版本>.exe /S` 静默覆盖安装（per-user 无需管理员，保数据）。
   注意 AgentDeck 应用内自更新用的是 `/S /relaunch`（装完自动重启应用）——buddy 随装/引导升级
   **不带 `/relaunch`**，装完不自启，由用户经 buddy 入口自然拉起。

兼容性承诺：域名、`version.json` 路径、上表字段是稳定契约；后续演进只加字段（向前兼容），
破坏性变更才会升 `schemaVersion`。当前最新版本以清单为准（截至本文更新 = `1.0.2026112003`）。

### 5.2 AgentDeck 安装版事实（对接必读）

| 项 | 值 |
|---|---|
| 产物 | `AgentDeck-Setup-{ver}.exe`（NSIS，per-user，**无需管理员**） |
| 默认安装位 | `%LOCALAPPDATA%\Programs\AgentDeck`（用户可改目录） |
| 卸载行为 | 删程序**留数据**（数据在 `%APPDATA%\AgentDeck`；卸载向导另有"删数据"勾选页，默认不勾） |
| `agentdeck://` 注册 | **安装时写入** `HKCU\Software\Classes`（per-user 无需管理员，含 `/S` 静默装；应用启动时幂等覆盖同值作自愈）；卸载时由卸载器清理（安装写入/卸载清理均自 2026-11-20 起的版本；更早版本为应用首次运行写入、卸载后键残留，探测按 exe 存在性自动失效） |
| 升级 | 覆盖安装（保数据） |
| 引擎二进制 | **不进安装包**，用户首启向导走下载链路：内置源 **Nexus（内网）`http://nexus.haiercash.net/repository/npm-group`**（默认优选）+ 官方 npm / npmmirror 兜底，按 npm registry 协议拉包 `@anthropic-ai/claude-agent-sdk-win32-x64`（下载含 SHA512 校验）。**内网只需放通 nexus 域**（或保证至少一个源可达），无需人工分发 claude.exe |

### 5.3 可选：随 buddy 静默安装

若组织要求"装 buddy 必有 AgentDeck"，可在 buddy 安装器尾部静默执行
`AgentDeck-Setup-x.y.z.exe /S`（per-user，无需管理员；Setup 经 §5.1 接口下载并 sha256 校验）。注意：

- **已装守卫**：仅当 §3.1 探测全 miss 时才执行静默装；已装（无论版本）一律不动，避免降级覆盖；
- AgentDeck 独立安装到标准位置，**不装进 buddy 的安装目录**——两程序安装/卸载/数据互相独立
  （buddy 卸载不得连带删 AgentDeck 程序或用户会话数据）；
- **实测坑**：NSIS 静默参数经脚本中转时必须用 **cmd 批处理**——git-bash/MSYS 环境下 `/S`
  会被路径转换吃掉（参数变 `S:/`），静默装变交互装。

## 6. 用户体验时序（三种状态全覆盖）

```
未安装        → §3.1 探测全 miss → 引导（官网下载页 / version.json 代下载 + sha256 校验 + 一键静默装 Setup /S，§5.1）
已装·未运行   → spawn 冷启动 → AgentDeck 首帧前应用 haier（无闪白）→ 欢迎 toast
                → workspace 编排（传了才动：激活已有空间 / 静默创建）
已装·运行中   → spawn --focus → 单实例锁转发参数 → 聚焦主窗口 + 切 haier（会话级）
                + workspace 编排（buddy 无需枚举窗口，AgentDeck 已处理）
```

## 7. 联调 checklist

1. `detect()` 三级各验一遍：默认位安装 / 改目录安装 / 未安装（null）
2. `detect().version` 与实际安装版本一致（卸载键 DisplayVersion）
3. `launch()`（不带 workspace）：未跑 → 冷启动进海尔蓝、欢迎 toast、退出重开回默认主题
4. `launch()`（带 workspace）：已注册空间 → 激活；未注册 → 静默创建无弹窗
5. 运行中再点入口 → 聚焦 + 切海尔蓝 + workspace 编排（单实例转发链路）
6. 未装场景引导页：官网 `agentdeck.haierxj.cn` 可达；version.json 拉取 → 下载 → sha256 校验通过；`/S` 静默装经 cmd 批处理验证
7. 清单防御：version.json 塞外域绝对 URL / 错误 sha256 → buddy 拒收拒执行（§5.1）
8. 低版本场景：人为调高 `MIN_VERSION` / mock 清单 `latest` → 入口提示升级
9. 参数边界：非法 theme / 相对路径 workspace → AgentDeck 静默忽略正常启动
10. `agentdeck://open?theme=haier` 浏览器/`start` 命令唤起可用（需已装首发版本）

## 8. FAQ

**Q：workspace 不传行吗？**
行，推荐默认就不传——AgentDeck 恢复用户上次活跃的工作空间，干扰最小。仅当需要"从 buddy
当前项目无缝续接"时才透传（必须存在的绝对路径，URL 形态需编码）。

**Q：theme 不传会怎样？**
AgentDeck 按用户自己的主题设置启动（默认亮）。buddy 想保证海尔蓝观感就**总是传** `--theme haier`。
它只影响本次会话，不写设置、退出即还原——不会改变用户在 AgentDeck 里的主题偏好。

**Q：AgentDeck 正在运行时再点入口？**
照常 `launch()`。单实例锁会阻止双开，把参数转发给运行中实例（聚焦 + 切主题 + workspace 编排）。

**Q：用户卸载 AgentDeck 会影响 buddy 吗？反之呢？**
互不影响。两者独立安装独立卸载；AgentDeck 用户数据（会话记录）在 `%APPDATA%\AgentDeck`，
卸载程序默认保留。

**Q：AgentDeck 自己会更新吗？buddy 要负责推送升级吗？**
不用。AgentDeck 内置自更新（与 §5.1 同一份 version.json）：启动 ~5s 后、每 6h、电源恢复/解锁、
设置页手动四个时机轮询；安装版自动"下载 → sha256 校验 → 退出静默装 `/S /relaunch` → 装完自启"，
绿色版下载 zip 后打开文件夹由用户手动替换；`policy=forced` 时应用内强提示。buddy 的版本协商
（§3.4）与升级引导只是兜底，覆盖"久不开 AgentDeck"的用户。

**Q：AgentDeck 升级后 buddy 要做什么？**
无需更新（探测是动态的；升级协商走 version.json 的话连 `MIN_VERSION` 都不用改）。升级 =
覆盖安装保数据。

**Q：安全与隐私边界？**
AgentDeck 不读取 buddy 的任何配置/凭据文件；启动参数是唯一输入面且逐项校验（theme/from
白名单、workspace 绝对路径 + 存在性）；buddy 也不需要向 AgentDeck 传任何凭据。

**Q：`--version` 拿不到输出？**
Windows GUI 子系统 stdout pipe 兼容坑——用前两法（卸载键 / exe 版本资源）替代即可。
