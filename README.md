# AgentDesk

**A desk for every Claude / Codex identity.** Run multiple accounts side by side without them clobbering each other's login, find any past session across all of them, and hand a session's context off to a fresh chat in one click.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)

> 中文说明见 [下方](#agentdesk-中文说明).

![AgentDesk](assets/screenshots/app.png)

<sub>Session titles and paths above are illustrative. A dark theme ships too — see [`assets/screenshots/app-dark.png`](assets/screenshots/app-dark.png).</sub>

---

## The problem it solves

If you use more than one Claude or Codex account — a work account, a personal one, a spare, or several team seats — the official desktop apps get in your way, because they assume **one identity per machine**:

- **Accounts collide.** Log into account B and it kicks account A offline. You can't keep a work login and a personal login open at the same time — you end up logging out and back in all day.
- **Old sessions get lost.** Every account quietly piles up local sessions (Claude Code, Codex), scattered across different data folders and file formats. *"I did that a week ago — but in which account? which session?"* There's no single place to look.
- **Handing off context is all manual.** When you want a new chat to pick up where an old one left off, you retype or copy-paste the context by hand. Slow and easy to get wrong.
- **Every OS hides things somewhere else.** The official apps and their data live in different places on macOS vs. Windows, so finding anything by hand is painful.

## What AgentDesk does

Each pain above maps to one thing AgentDesk gives you:

- **Isolated account slots.** Each slot is its own local data directory. AgentDesk launches the official Claude / Codex app pointed at that directory, so **multiple accounts coexist — no collisions, no constant re-login.**
- **Notes & groups.** Give any slot a free-text note and drop it into a group (Work / Personal / Spare…). The sidebar organizes accounts by group — manage them like a contact list.
- **Automatic session index.** It scans each account's session files and lists them in one table — title, last active, created, project directory, source — with search across title / project / thread ID. **Find any old session in seconds.**
- **One-click context handoff.** Select a session, hit *Copy handoff*, and paste into a new chat. It copies **metadata only, never the full transcript** — so nothing private leaks by accident.
- **Diagnostics.** A panel that explains *why* a session won't show up or an app won't launch: does the path exist, is it readable/writable, was the official app found, which locations were scanned, how many sessions matched, where the config lives.
- **Path control.** Set each slot's data directory and session root by hand — important because Codex keeps those two in different places.
- **macOS + Windows** from the same tool.
- **Light & dark**, following your system theme — toggle any time with the ◐ button.

## What it deliberately does *not* do

AgentDesk touches your accounts, so its boundaries matter:

- It **stores no passwords and no tokens.**
- It **does not read browser passwords** or any saved credentials.
- It **does not bypass official login** — authentication still happens inside the official Claude / Codex app.
- The handoff copy **excludes the full conversation by default.**
- In the account and session lists, your home directory is shortened to `~`. (The diagnostics panel shows full paths on purpose — it's a troubleshooting tool.)

It only manages **local data slots** and a **read-only session index**. That's it.

## The cat yard 🐈

By default AgentDesk greets you with a **pixel cat yard** — the same accounts and sessions, in a place you'll actually want to leave open. Every pixel is drawn from real local data; nothing is faked.

![The cat yard](assets/screenshots/yard.png)

- **Every account is a cat.** The name plate *is* the account name — no separate pet name to keep in sync. Its coat, collar and accessory are yours to customize (Edit → dress it up), and groups become fenced-off areas of the yard.
- **Cats live your accounts' rhythm.** A cat's behavior comes from that account's real session activity: it sits at a desk typing while a session is being written, plays in the grass if the account was active today, curls up to nap after a few quiet days, or hibernates in a box after a week. A broken session path shows a **?** over the cat — click it to open diagnostics.
- **Sessions are the day's catch.** The full session table lives right below the yard — same search, same one-click handoff, same details. Finding old work never got slower.
- **A gentle work/life balance.** A *today* ledger tallies how many work sessions wrapped up and how long the cats kept you company. After 90 minutes of unbroken work, a cat stretches and nudges you to do the same — a quiet status-bar note, never a popup, and switchable off entirely.
- **Time & weather.** A control in the corner sets the yard to day / dusk / night (or *follow* your theme) and clear / cloudy / rain / snow. Purely atmospheric — set the mood you like.
- **Prefer the plain table?** One click on **⇄** switches back to the classic three-pane view below. It's the same data underneath, so nothing is lost either way.

## Interface

The yard is the default; the **⇄** button flips to a classic three-pane workbench (and back):

- **Left** — your account slots (Claude / Codex). Add, rename, remove, launch.
- **Middle** — the session table for the selected account, with search and sort by last active.
- **Right** — the selected session's details, plus copy actions (handoff / address / project path) and *reveal file*.

---

## Install

### Download a prebuilt package

Grab the latest from **[Releases](https://github.com/shuqianglin1997/agent-desk/releases)**:

- **macOS** — `AgentDesk-<version>-universal.dmg` (runs on both Apple Silicon and Intel)
- **Windows** — `AgentDesk <version>.exe` (portable — no install, just run)

> **Heads-up: the packages are not code-signed** (this is a free, open tool). Your OS will warn you the first time. That's expected — here's how to get past it:
>
> - **macOS** — move **AgentDesk.app** into `/Applications`, then clear the quarantine flag once (needed on recent macOS, where right-click → Open no longer bypasses Gatekeeper for unsigned apps):
>   ```bash
>   xattr -dr com.apple.quarantine "/Applications/AgentDesk.app"
>   ```
>   Or, after the first blocked launch, open **System Settings → Privacy & Security** and click **Open Anyway**.
> - **Windows** — SmartScreen shows *"Windows protected your PC"* → click **More info** → **Run anyway**.

### Or run / build from source

Requires [Node.js](https://nodejs.org/) 20+.

```bash
npm install
npm start              # run in dev mode
npm test               # run the session-scanner test suite

npm run build:mac      # → universal .dmg in release/
npm run build:win      # → portable .exe in release/
```

> Behind a slow mirror (e.g. in mainland China), prefix installs and builds with:
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

Cross-compiling Windows on macOS is fragile — prefer building each platform on its own OS, or just let CI do it (below).

## Releasing (maintainers)

CI ([`.github/workflows/release.yml`](.github/workflows/release.yml)) builds both platforms natively and attaches the installers to a **draft** GitHub Release. Set `version` in `package.json` to match your tag first — electron-builder names the artifacts from `package.json`, not the git tag — then:

```bash
git tag v0.2.0
git push origin v0.2.0
```

Then review the draft release on GitHub and publish it.

## How it works

AgentDesk is a small [Electron](https://www.electronjs.org/) app:

- **Main process** (`src/main.js`) — all filesystem access, app launching, session scanning, and diagnostics.
- **Preload** (`src/preload.js`) — a narrow, `contextIsolation`-safe IPC bridge.
- **Renderer** (`src/renderer.js`, `src/index.html`, `src/styles.css`) — the UI. It never touches the filesystem directly.
- **Cat yard** (`src/yard/`) — the default pixel-yard view: a canvas scene engine plus pure-function modules for cat state, the companion ledger, and palettes. See [`docs/YARD.md`](docs/YARD.md).

More detail (in Chinese) lives in [`docs/`](docs/): product notes, scenarios, Windows specifics, internals, and the [cat yard](docs/YARD.md).

## License

[MIT](LICENSE) © hupo

---
---

# AgentDesk（中文说明）

**给你每个 Claude / Codex 身份一张独立的「工作台」。** 多个账号并排运行、互不挤下线；跨所有账号秒找任何一条旧会话；一键把某个会话的上下文交接给新对话继续。

## 它解决什么痛点

只要你用不止一个 Claude / Codex 账号（工作号、个人号、备用号，或多个团队席位），官方桌面 App 就会卡你，因为它默认**一台机器一个身份**：

- **串号 —— 登录态互相覆盖。** 登进 B 号就把 A 号挤下线，工作号和个人号没法同时开着，只能一整天反复登出登入。
- **旧会话找不回。** 每个账号本地悄悄攒下一堆会话（Claude Code、Codex），散在不同数据目录、不同文件格式里。「那个活儿上周做过——在哪个号？哪个会话？」没有统一入口。
- **上下文交接全靠手打。** 想让新对话接着旧会话干，只能手动复述、复制，费劲又容易漏。
- **每个系统藏东西的地方都不一样。** macOS 和 Windows 上官方 App 和数据目录位置各不相同，手动找很痛。

## AgentDesk 怎么解决

上面每一个痛点，都对应它给你的一样东西：

- **独立账号槽位。** 每个槽位是一份独立的本地数据目录，AgentDesk 用该目录启动官方 App —— **多号并存、不串号、不用反复登录。**
- **备注与分组。** 给任意槽位加自由备注、丢进分组（工作 / 个人 / 备用……），侧栏按分组归拢账号，像通讯录一样管理。
- **自动会话索引。** 扫描每个账号的会话文件，汇成一张表：标题 / 最后活跃 / 新建 / 项目目录 / 来源，可按标题、项目、线程 ID 搜索。**几秒钟找到任何旧会话。**
- **一键交接上下文。** 选中会话点「复制交接信息」，粘到新对话即可。**只复制元信息，不含完整对话** —— 隐私不会被误传。
- **诊断面板。** 解释「为什么读不到会话 / 打不开 App」：路径在不在、可不可读写、官方 App 找没找到、扫了哪些位置、匹配到几条会话、配置文件在哪。
- **路径可配。** 手动设置每个槽位的数据目录和会话根目录 —— 这点很关键，因为 Codex 把这两者放在不同地方。
- **macOS + Windows** 同一套能力。
- **深色 / 浅色** 跟随系统，随时用 ◐ 按钮切换。

## 猫猫庭院 🐈

默认打开时，AgentDesk 迎接你的是一片**像素猫庭院** —— 还是那些账号和会话，只是换到一个你愿意一直开着的地方。每一个像素都由真实本地数据驱动，没有一处是假的。

![猫猫庭院](assets/screenshots/yard-dusk.png)

- **每个账号是一只猫。** 名牌就是账号名，不用另记一个宠物名；毛色、项圈、配饰随你定制（编辑账号即可换装），分组变成庭院里一块块围起来的区域。
- **猫跟着账号的节奏过日子。** 猫的行为由该账号的真实会话活动决定：有会话正在写入时它伏案打字，账号今天活跃过就在草地玩耍，几天没动静就蜷着打盹，超过一周没碰就钻进纸箱冬眠。会话路径失效的猫头顶挂个 **?**，点它直达诊断。
- **会话是这一天的渔获。** 完整会话表就在庭院下方 —— 搜索、一键交接、详情一样不少，找旧会话不会因此变慢。
- **不打扰的劳逸平衡。** 「今日小账本」记下今天有多少次收工、猫陪你干了多久。连续工作 90 分钟，猫会伸个懒腰提醒你也起来动动 —— 只在状态栏轻声提示，绝不弹窗，也能整个关掉。
- **时间与天气。** 角落的控件把庭院切成 白天 / 黄昏 / 夜晚（或**跟随**主题）与 晴 / 多云 / 雨 / 雪，纯氛围，调成你喜欢的样子。
- **想要朴素的表格？** 点一下 **⇄** 切回下方的经典三栏视图，底层是同一份数据，两边都不丢东西。

## 它刻意不做的事

它碰的是你的账号，所以边界很重要：

- **不保存任何密码、任何 token。**
- **不读取浏览器密码**或任何已存凭据。
- **不绕过官方登录** —— 鉴权始终发生在官方 Claude / Codex App 里。
- 交接复制**默认不含完整对话**。
- 账号列表和会话列表里，你的用户主目录会被简写成 `~`。（诊断面板故意显示完整路径——它是排查工具。）

它只管理**本地数据槽位**和一份**只读的会话索引**，仅此而已。

## 下载安装

到 **[Releases](https://github.com/shuqianglin1997/agent-desk/releases)** 下载最新版：

- **macOS** —— `AgentDesk-<版本>-universal.dmg`（Apple Silicon 和 Intel 都能跑）
- **Windows** —— `AgentDesk <版本>.exe`（便携版，免安装，双击即用）

> **注意：安装包未做代码签名**（这是免费开源工具）。首次打开系统会拦一下，属正常，绕过方法：
>
> - **macOS** —— 把 **AgentDesk.app** 拖进 `/Applications`，再执行一次去掉隔离标记（较新的 macOS 上，未签名 App 已不能靠右键「打开」绕过）：
>   ```bash
>   xattr -dr com.apple.quarantine "/Applications/AgentDesk.app"
>   ```
>   或者首次被拦后，打开**系统设置 → 隐私与安全性**，点**仍要打开**。
> - **Windows** —— SmartScreen 弹「Windows 已保护你的电脑」→ 点**更多信息**→**仍要运行**。

### 或从源码运行 / 构建

需要 [Node.js](https://nodejs.org/) 20+。

```bash
npm install
npm start              # 开发模式运行
npm test               # 跑会话扫描测试

npm run build:mac      # → release/ 下生成 universal .dmg
npm run build:win      # → release/ 下生成便携版 .exe
```

> 国内网络较慢时，给安装和构建加镜像前缀：
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
> ```

在 macOS 上交叉编译 Windows 很脆弱 —— 尽量各平台在各自系统上构建，或直接交给 CI。

## 发布（维护者）

CI（[`.github/workflows/release.yml`](.github/workflows/release.yml)）会在各自系统上原生构建两个平台，并把安装包挂到一个**草稿** Release。先把 `package.json` 的 `version` 改成和 tag 一致（构建产物按 `package.json` 命名，不看 tag），再：

```bash
git tag v0.2.0
git push origin v0.2.0
```

然后在 GitHub 上审阅草稿 Release 再发布。

## 安全边界

AgentDesk 不保存账号密码，不读取浏览器明文密码，不绕过官方登录，默认不复制完整聊天内容。它只管理本地数据槽位和会话索引。

## 许可证

[MIT](LICENSE) © hupo
