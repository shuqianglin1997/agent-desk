<p align="center">
  <img src="assets/icon.png" width="120" alt="AgentDesk" />
</p>

<h1 align="center">AgentDesk</h1>

<p align="center"><strong>Every AI-coding account and its local sessions — signed in, indexed, and one keystroke from handoff, in a single local window.</strong></p>

<p align="center">
  Keep every Claude / Codex account logged in at once — no collisions, no re-login.<br />
  Find any account's old session in seconds, and hand it to the next chat with one click.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/local-only%20·%20read--only-2e7d4f" alt="Local-only, read-only" />
</p>

<p align="center">
  <a href="#what-it-solves">Problem</a> ·
  <a href="#what-agentdesk-does">Features</a> ·
  <a href="#two-views">Views</a> ·
  <a href="#the-cat-yard-">Cat yard</a> ·
  <a href="#boundaries">Boundaries</a> ·
  <a href="#install">Install</a> ·
  <a href="#agentdesk-中文说明">中文</a>
</p>

![AgentDesk](assets/screenshots/app.png)

<sub>Session titles and paths above are illustrative. A dark theme ships too — see [`assets/screenshots/app-dark.png`](assets/screenshots/app-dark.png).</sub>

---

## In one line

AgentDesk is a **local, read-only cockpit** for people who run more than one AI-coding account. It keeps every Claude / Codex login isolated and simultaneously online, scans each one's local sessions into a single searchable table, and lets you hand any session off to a new chat — **without storing a single password or reading the full transcript.** Authentication always stays inside the official apps; AgentDesk never signs in for you.

> It **manages and indexes** accounts and sessions. It is deliberately **not** an embedded terminal or an agent-runner — see [Boundaries](#boundaries).

<a id="what-it-solves"></a>

## What it solves

Add a few logins and a few tools, and the login identity, the project directory and the old session tangle into one object — scattered across terminals and desktop apps that each assume **one identity per machine**:

- **Accounts collide.** Log into account B and it kicks account A offline. You can't keep a work login and a personal login open at once — you log out and back in all day.
- **Old sessions get lost.** Every account quietly piles up local sessions (Claude Code, Codex, and more), across different data folders and file formats. *"I did that last week — but in which account? which session?"* There's no single place to look.
- **Handing off context is manual.** To make a new chat continue an old one, you retype or copy-paste the context by hand — slow and easy to get wrong.
- **Every OS hides things somewhere else.** Official apps and their data sit in different places on macOS vs. Windows, so finding anything by hand is painful.

<a id="what-agentdesk-does"></a>

## What AgentDesk does

Each pain above maps to one thing it gives you:

- **Isolated account slots.** Each slot is its own local data directory; AgentDesk launches the official Claude / Codex app pointed at that directory, so **multiple accounts coexist — no collisions, no constant re-login.** This is the axis most tools skip.
- **Automatic session index.** It scans each account's session files into one table — title · last active · project directory · source — with search across title / project / thread ID. **Find any old session in seconds.** (The exact creation time and file path stay in the detail pane, one click away.)
- **One-click context handoff.** Select a session, hit **Copy handoff**, paste into a new chat. It copies **metadata only, never the full transcript** — nothing private leaks by accident.
- **Recognizes many agents.** Built-in adapters identify Codex and Claude Code sessions directly; Gemini CLI, OpenCode, Cursor Agent, GitHub Copilot CLI, goose, Kimi and Qwen Code are recognized as [Agent Client Protocol](https://agentclientprotocol.com/) tools. The **🔌 Connect** button in the top bar discovers installed agents and lets you register a custom ACP agent through a native file picker.
- **Notes & groups.** Give any slot a free-text note and drop it into a group (Work / Personal / Spare…). Accounts organize by group, like a contact list.
- **Same account, one identity.** When one login shows up as several client slots (desktop + CLI, or Kimi Code + Kimi Work), AgentDesk merges them into **one account** — one cat, one card — with sessions and quota flowing together.
- **Diagnostics.** A panel that explains *why* a session won't show up or an app won't launch: executable / Store candidates, MSIX-vs-legacy data paths, permissions, scanned locations, session count, and config location.
- **Per-account quota (Beta).** Codex slots read their own official rate-limit windows through the local Codex app-server and show remaining %, reset time, and plan. Claude / Cursor clearly show *unsupported* instead of scraping cookies or tokens.
- **Path control.** Set each slot's data directory, session root, and optional app executable. On Windows, old AppData slots copy to a stable non-virtualized location in one click.
- **GitHub updates.** The always-visible **↻ Update** button checks the latest published Release. Windows portable builds download, verify GitHub's SHA-256, replace themselves, and restart; other environments open the exact Release page.
- **macOS + Windows**, **light + dark** (follows your system theme; toggle with **◐**).

<a id="two-views"></a>

## Two views, one skeleton

AgentDesk has one layout — **top bar · account presenter · account console · [ session table │ session detail ] · status bar** — worn two ways. The **⇄** button flips between them; it's the same data underneath, so nothing is lost either way.

| | **🐈 Cat yard** (default) | **Classic** |
|---|---|---|
| Account presenter | a full-bleed pixel yard — one cat per account | a horizontal **roster band** of account cards (pixel cat avatars) |
| Skin | pixel-wood | precision-porcelain |
| Everything below | identical: console → session table │ detail → status bar |

The **account console** is one row: name plate + badges · **Open account** (primary) · Add / Path / Diagnostics / Refresh / Manage · quota chips (**self** / **all**). The **status bar** at the bottom gathers the quiet stuff into one line: today's companionship tally and a **⚠ needs-attention** count you can click open.

<a id="the-cat-yard-"></a>

## The cat yard 🐈

By default AgentDesk greets you with a **pixel cat yard** — the same accounts and sessions, in a place you'll actually want to leave open. Every pixel is drawn from real local data; nothing is faked.

![The cat yard](assets/screenshots/yard.png)

- **Every account is a cat.** The name plate *is* the account name — no separate pet name to sync. Coat, collar and accessory are yours to customize (Edit → dress it up); groups become fenced-off areas of the yard.
- **Cats live your accounts' rhythm.** Behavior comes from the account's real state: it sits at a desk typing while the account is *actually working* (its session record moved within the last minute), waits at its spot when the app is open but quiet, plays in the grass if it was active earlier today, naps after a few quiet days, and hibernates in a box after a week. "Working" reads the last-activity timestamp inside the session record — not just whether the app is open — so a busy account and an idle-but-open one look different. A broken session path shows a **?** over the cat — click it to open diagnostics.
- **Quota becomes energy, not activity.** Fresh / steady / tired / exhausted is a separate axis from the tightest current Codex limit. It nudges a tiny energy pip and typing pace without ever pretending a tired cat stopped working. Old or failed data never drives fatigue.
- **Atmosphere.** *Follow* tracks the system clock; *auto weather* shifts on a deterministic 20–45-minute rhythm. Manual day / dusk / night and clear / cloudy / rain / snow stay available. It's atmosphere, not a claim about real weather.
- **A gentle work/life balance.** A *today* ledger (in the status bar) tallies how many sessions wrapped and how long the cats kept you company. After 90 minutes of unbroken work a cat stretches and nudges you to do the same — a quiet status-bar note, never a popup, switchable off entirely.
- **Prefer the plain table?** One **⇄** switches to the classic view. Same data, nothing lost.

<a id="boundaries"></a>

## What it deliberately does *not* do

AgentDesk touches your accounts, so its boundaries matter. It is **local-only and read-only** by design:

- It **stores no passwords and no tokens**, and **never reads browser passwords** or saved credentials.
- **No embedded terminal, no agent runner.** AgentDesk manages and indexes; it does not run agents or shell commands for you. There is **no execution surface** in the app.
- It **does not bypass official login** — authentication happens inside the official Claude / Codex app.
- Quota checks **never read browser cookies or expose account e-mail / tokens**; only the sanitized result of Codex's official local RPC reaches the UI.
- The handoff copy **excludes the full conversation by default** — metadata only.
- In the account and session lists, your home directory is shortened to `~`. (The diagnostics panel shows full paths on purpose — it's a troubleshooting tool.)

Account and session discovery are local and read-only, full stop.

---

<a id="install"></a>

## Install

### Download a prebuilt package

Grab the latest from **[Releases](https://github.com/shuqianglin1997/agent-desk/releases)**:

- **macOS** — `AgentDesk-<version>-universal.dmg` (Apple Silicon + Intel)
- **Windows** — `AgentDesk-<version>-portable-x64.exe` (portable — no install, just run)

> **Heads-up: the packages are not code-signed** (this is a free, open tool). Your OS warns you the first time. That's expected:
>
> - **macOS** — move **AgentDesk.app** into `/Applications`, then clear the quarantine flag once (needed on recent macOS, where right-click → Open no longer bypasses Gatekeeper for unsigned apps):
>   ```bash
>   xattr -dr com.apple.quarantine "/Applications/AgentDesk.app"
>   ```
>   Or, after the first blocked launch: **System Settings → Privacy & Security → Open Anyway**.
> - **Windows** — SmartScreen shows *"Windows protected your PC"* → **More info** → **Run anyway**.

On Windows, AgentDesk supports both traditional Win32 and current Store/MSIX installs. New isolated slots live under `%USERPROFILE%\.agentdesk\profiles` instead of AppData, avoiding MSIX path virtualization; see [`docs/WINDOWS.md`](docs/WINDOWS.md).

### Or run / build from source

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm start              # run in dev mode
npm test               # run the test suite

npm run build:mac      # → universal .dmg in release/
npm run build:win      # → portable .exe in release/
npm run build:dir      # → unpacked .app/.exe for quick local testing
```

> Behind a slow mirror (e.g. mainland China), prefix installs and builds:
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

Cross-compiling Windows on macOS is fragile — build each platform on its own OS, or let CI do it.

## Releasing (maintainers)

CI ([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds both platforms natively, generates `SHA256SUMS.txt`, and publishes the GitHub Release after both builds pass. Set `version` in `package.json` to match your tag first (electron-builder names artifacts from `package.json`, not the git tag), then:

```bash
git tag v0.2.2
git push origin v0.2.2
```

## How it works

AgentDesk is a small [Electron](https://www.electronjs.org/) app:

- **Main process** (`src/main.js`) — all filesystem access, app launching, session scanning, diagnostics. The only place that touches disk.
- **Preload** (`src/preload.js`) — a narrow, `contextIsolation`-safe IPC bridge.
- **Renderer** (`src/renderer.js`, `src/index.html`, `src/styles.css`) — the UI. It never touches the filesystem directly.
- **Cat yard** (`src/yard/`) — the default pixel-yard view: a canvas scene engine plus pure-function modules for cat state, energy, the companion ledger, and palettes. See [`docs/YARD.md`](docs/YARD.md).

More detail (in Chinese) lives in [`docs/`](docs/): product notes, Windows specifics, internals, and the [cat yard](docs/YARD.md).

## License

[MIT](LICENSE) © hupo

---
---

<a id="agentdesk-中文说明"></a>

# AgentDesk（中文说明）

<p align="center"><strong>把你每一个 AI 编码账号和它的本地会话，收进一个本地窗口——全都在线、随手可查、一键交接。</strong></p>

所有 Claude / Codex 账号同时在线、各自隔离、互不挤号；任何账号的本地旧会话几秒钟找回，一键交给下一个对话接着干。**不保存任何密码，也不复制完整对话。** 登录始终发生在官方 App 里，AgentDesk 从不替你登录。

> 它负责**管理和索引**账号与会话，**刻意不做**内嵌终端、也不替你跑 Agent —— 见[安全边界](#安全边界)。

## 它解决什么痛点

账号和工具一多，登录身份、项目目录和旧会话就绑成一团，散落在一堆终端和客户端里 —— 而官方 App 还默认**一台机器一个身份**：

- **串号 —— 登录态互相覆盖。** 登进 B 号就把 A 号挤下线，工作号和个人号没法同时开着，只能一整天反复登出登入。
- **旧会话找不回。** 每个账号本地悄悄攒下一堆会话（Claude Code、Codex 等），散在不同数据目录、不同格式里。「那个活儿上周做过——在哪个号？哪个会话？」没有统一入口。
- **上下文交接全靠手打。** 想让新对话接着旧会话干，只能手动复述、复制，费劲又容易漏。
- **每个系统藏东西的地方都不一样。** macOS 和 Windows 上官方 App 和数据目录位置各不相同，手动找很痛。

## AgentDesk 怎么解决

上面每个痛点，都对应它给你的一样东西：

- **独立账号槽位。** 每个槽位是一份独立本地数据目录，AgentDesk 用该目录启动官方 App —— **多号并存、不串号、不用反复登录。** 这正是大多数工具跳过的一条轴。
- **自动会话索引。** 扫描每个账号的会话文件，汇成一张表：标题 · 最后活跃 · 项目目录 · 来源，可按标题 / 项目 / 线程 ID 搜索。**几秒钟找到任何旧会话。**（精确新建时间和文件路径收在右侧详情里，一点即看。）
- **一键交接上下文。** 选中会话点「复制交接信息」，粘到新对话即可。**只复制元信息，不含完整对话** —— 隐私不会被误传。
- **认识各种 Agent。** 内置适配器直接识别 Codex、Claude Code 的会话；Gemini CLI、OpenCode、Cursor Agent、GitHub Copilot CLI、goose、Kimi、Qwen Code 作为 [ACP](https://agentclientprotocol.com/) 工具被识别。顶栏「**🔌 接入**」会发现本机已装的 Agent，也能通过系统文件选择器登记自定义 ACP Agent。
- **备注与分组。** 给任意槽位加自由备注、丢进分组（工作 / 个人 / 备用……），像通讯录一样按分组管理。
- **同一账号只算一个。** 当一个登录以多个客户端形态出现（桌面 + CLI，或 Kimi Code + Kimi Work），AgentDesk 把它们合并成**一个账号** —— 一只猫、一张卡 —— 会话和额度一起合流。
- **诊断面板。** 解释「为什么读不到会话 / 打不开 App」：传统安装与 Store/MSIX 启动候选、真实数据目录、权限、扫描位置、会话数量和配置文件。
- **每账号额度（Beta）。** Codex 槽位通过本机 Codex 官方 app-server 读取各自真实额度周期，展示剩余百分比、重置时间和套餐；Claude / Cursor 明确显示暂不支持，不抓浏览器 Cookie 或 token。
- **路径可配。** 手动设置数据目录、会话根目录和可选的官方 App 可执行文件；Windows 旧 AppData 槽位可一键复制迁移到稳定目录。
- **GitHub 一键更新。** 常驻的「↻ 更新」检查正式 Release；Windows portable 会下载、核对 GitHub SHA-256、替换自身并重启，其他环境打开对应 Release 页面。
- **macOS + Windows**，**深色 / 浅色**跟随系统（随时用 **◐** 切换）。

## 两种视图，一套骨架

AgentDesk 只有一套布局 —— **顶栏 · 账号呈现层 · 账号控制条 · [ 会话表 │ 会话详情 ] · 状态栏** —— 用两种皮肤呈现。**⇄** 在两者间切换，底层是同一份数据，两边都不丢东西。

| | **🐈 猫猫庭院**（默认） | **经典** |
|---|---|---|
| 账号呈现层 | 满铺的像素庭院——一只猫 = 一个账号 | 顶部横向**名册带**（账号卡片 + 像素猫头像） |
| 皮肤 | 像素木质 | 素纸瓷白 |
| 往下 | 完全一致：控制条 → 会话表 │ 详情 → 状态栏 |

**账号控制条**是一行：名牌 + 徽章 · **打开账号**（主操作） · 新增 / 路径 / 诊断 / 刷新 / 管理 · 额度 chips（**本号** / **全院**）。底部**状态栏**把零碎信息收进一条：今日陪伴统计，加一个可点开的 **⚠ 需要留意** 计数。

## 猫猫庭院 🐈

默认打开时，迎接你的是一片**像素猫庭院** —— 还是那些账号和会话，只是换到一个你愿意一直开着的地方。每一个像素都由真实本地数据驱动，没有一处是假的。

![猫猫庭院](assets/screenshots/yard-dusk.png)

- **每个账号是一只猫。** 名牌就是账号名，不用另记宠物名；毛色、项圈、配饰随你定制（编辑账号即可换装），分组变成庭院里一块块围起来的区域。
- **猫跟着账号的节奏过日子。** 猫的行为由该账号真实状态决定：账号*真在干活*时（会话记录一分钟内还在动）它伏案打字，App 开着但会话安静时在自己地盘待命，今天早些时候活跃过就在草地玩耍，几天没动静就蜷着打盹，超过一周没碰就钻进纸箱冬眠。判「干活」看的是会话记录里的最后活跃时间戳，而不只是「App 开着」。会话路径失效的猫头顶挂个 **?**，点它直达诊断。
- **额度是能量，不是活动状态。** 元气 / 稳定 / 疲劳 / 快没电由当前最紧的 Codex 额度周期决定，只改变能量格和打字节奏；「正在干活」仍由真实会话活动决定。旧数据或失败数据不会驱动疲劳。
- **时间与天气。** 「跟随」按系统时钟变换昼夜，「自动天气」每 20–45 分钟按本地可复现节奏变化；也能手动锁定白天 / 黄昏 / 夜晚和晴 / 多云 / 雨 / 雪。它只是氛围，不冒充真实天气。
- **不打扰的劳逸平衡。** 状态栏里的「今日小账本」记下今天有多少次收工、猫陪你干了多久。连续工作 90 分钟，猫会伸个懒腰提醒你也起来动动 —— 只在状态栏轻声提示，绝不弹窗，也能整个关掉。
- **想要朴素的表格？** 点一下 **⇄** 切回经典视图，底层同一份数据，两边都不丢。

## 安全边界

它碰的是你的账号，所以边界很重要。它按设计是**纯本地、只读**的：

- **不保存任何密码、任何 token**，**不读取浏览器密码**或任何已存凭据。
- **没有内嵌终端，也不替你跑 Agent。** AgentDesk 只做管理和索引，App 里**没有任何执行入口**。
- **不绕过官方登录** —— 鉴权始终发生在官方 Claude / Codex App 里。
- 额度查询**不读浏览器 Cookie，也不向界面暴露账号邮箱 / token**；界面只收到 Codex 官方本机 RPC 的脱敏结果。
- 交接复制**默认不含完整对话** —— 只有元信息。
- 账号和会话列表里，你的用户主目录会被简写成 `~`。（诊断面板故意显示完整路径——它是排查工具。）

账号与会话发现，完全本地、只读，没有例外。

## 下载安装

到 **[Releases](https://github.com/shuqianglin1997/agent-desk/releases)** 下载最新版：

- **macOS** —— `AgentDesk-<版本>-universal.dmg`（Apple Silicon 和 Intel 都能跑）
- **Windows** —— `AgentDesk-<版本>-portable-x64.exe`（便携版，免安装，双击即用）

> **注意：安装包未做代码签名**（这是免费开源工具）。首次打开系统会拦一下，属正常：
>
> - **macOS** —— 把 **AgentDesk.app** 拖进 `/Applications`，再执行一次去掉隔离标记（较新 macOS 上未签名 App 已不能靠右键「打开」绕过）：
>   ```bash
>   xattr -dr com.apple.quarantine "/Applications/AgentDesk.app"
>   ```
>   或首次被拦后，打开**系统设置 → 隐私与安全性 → 仍要打开**。
> - **Windows** —— SmartScreen 弹「Windows 已保护你的电脑」→ **更多信息** → **仍要运行**。

Windows 同时支持传统 Win32 与 Store/MSIX。新独立槽位放在 `%USERPROFILE%\.agentdesk\profiles`，避开 MSIX 的 AppData 路径虚拟化；完整说明见 [`docs/WINDOWS.md`](docs/WINDOWS.md)。

### 或从源码运行 / 构建

需要 [Node.js](https://nodejs.org/) 20+。

```bash
npm install
npm start              # 开发模式运行
npm test               # 跑测试套件

npm run build:mac      # → release/ 下生成 universal .dmg
npm run build:win      # → release/ 下生成便携版 .exe
npm run build:dir      # → 未打包的 .app/.exe，本地快速验证用
```

> 国内网络较慢时，给安装和构建加镜像前缀：
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

在 macOS 上交叉编译 Windows 很脆弱 —— 尽量各平台在各自系统上构建，或交给 CI。

## 发布（维护者）

CI（[`.github/workflows/release.yml`](.github/workflows/release.yml)）在各自系统上原生构建两个平台，生成 `SHA256SUMS.txt`，两个构建都通过后自动发布 GitHub Release。先把 `package.json` 的 `version` 改成和 tag 一致（产物按 `package.json` 命名，不看 tag），再：

```bash
git tag v0.2.2
git push origin v0.2.2
```

## 工作原理

AgentDesk 是一个小型 [Electron](https://www.electronjs.org/) 应用：

- **主进程**（`src/main.js`）—— 所有文件系统访问、App 启动、会话扫描、诊断。唯一碰磁盘的地方。
- **预加载**（`src/preload.js`）—— 一层收窄的、`contextIsolation` 安全的 IPC 桥。
- **渲染层**（`src/renderer.js`、`src/index.html`、`src/styles.css`）—— 界面，从不直接碰文件系统。
- **猫猫庭院**（`src/yard/`）—— 默认像素庭院视图：canvas 场景引擎 + 猫状态 / 能量 / 陪伴账本 / 调色板等纯函数模块。见 [`docs/YARD.md`](docs/YARD.md)。

更多细节见 [`docs/`](docs/)：产品说明、Windows 细节、内部实现和[猫猫庭院](docs/YARD.md)。

## 许可证

[MIT](LICENSE) © hupo
