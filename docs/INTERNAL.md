# 内部实现说明

## 项目定位

AgentDesk 是一个本地桌面工具，用来管理 Claude / Codex 的本地账号槽位和会话索引。

它不是密码管理器，也不是聊天客户端。它只做三件事：

- 管理本地账号槽位
- 扫描本地会话元信息
- 复制会话交接信息给新会话

## 核心概念

### 账号槽位

账号槽位是一个本地身份容器。每个槽位至少包含两个路径：

- `profilePath`：官方 App 的本地数据目录，用于登录态、缓存、浏览器数据
- `sessionRoot`：本工具扫描会话的根目录

Claude 默认情况下这两个路径通常相同：

```text
~/Library/Application Support/Claude
```

Codex 默认情况下这两个路径通常不同：

```text
profilePath: ~/Library/Application Support/Codex
sessionRoot: ~/.codex
```

这是产品里最容易误解的点，所以 UI 里必须同时显示两个路径，并提供「路径」配置入口。

### 会话记录

会话记录是扫描本地文件得到的元信息，不是完整聊天内容。

字段：

- `id`
- `appId`
- `title`
- `createdAt`
- `updatedAt`
- `projectPath`
- `source`
- `status`
- `model`
- `filePath`
- `address`

默认复制交接信息时不复制完整对话内容，避免把隐私或大段上下文误传到新会话。

## 目录结构

```text
agent-desk/
  assets/              应用图标
  docs/                产品、场景、Windows、内部说明
  release/             打包产物
  scripts/             维护脚本
  src/
    main.js            Electron 主进程，本地文件/启动/诊断/IPC
    windows.js         Windows 启动器、MSIX 数据路径与迁移解析（纯 Node）
    path-utils.js      打开文件前的存在性检查与上级目录回退（纯 Node）
    json-store.js      配置原子写入、备份和恢复（纯 Node）
    settings.js        稳定界面偏好结构与旧版迁移（纯 Node）
    updater.js         GitHub Release 解析、资产选择与 portable 替换脚本（纯 Node）
    quota.js           额度数据脱敏与统一结构（纯 Node）
    codex-quota.js     Codex 官方 app-server 额度读取（纯 Node）
    quota-service.js   分槽位缓存、限流和 provider 降级（纯 Node）
    runtime.js         内嵌 Shell / Agent 适配器、安全边界和进程生命周期（纯 Node）
    sessions.js        会话扫描（纯 Node，可单元测试）
    activity.js        活跃度探测（stat-only，纯 Node，驱动庭院状态）
    preload.js         安全桥接 IPC
    renderer.js        UI 状态与交互（经典视图 + 庭院视图）
    index.html         页面结构
    styles.css         界面样式（经典 porcelain 皮肤）
    yard/              猫猫庭院视图（见 docs/YARD.md）
      cats.js          状态机 + 外观默认值（纯函数，可单测）
      energy.js        与活动正交的额度能量轴（纯函数，可单测）
      companion.js     陪伴账本 reducer（纯函数，可单测）
      atmosphere.js    系统时段和自动天气（纯函数，可单测）
      interactions.js  场景语义区域与拖放意图（纯函数，可单测）
      sprites.js       像素猫资产与分层合成
      scene.js         画布引擎（8fps、移动、命中、昼夜、fx）
      yard.css         庭院布局与像素皮肤
  test/                单元测试（sessions / activity / cats / companion）
  package.json         npm 脚本和 electron-builder 配置
```

猫猫庭院是账号槽位的像素化替代视图（默认），经典三栏视图完整保留、可一键切换。详见 [YARD.md](YARD.md)。

## 数据存储

配置文件由 Electron 的 `app.getPath('userData')` 决定。

macOS 当前示例：

```text
~/Library/Application Support/AgentDesk/profiles.json
~/Library/Application Support/AgentDesk/settings.json
```

配置结构：

```json
{
  "version": 2,
  "profiles": [
    {
      "id": "...",
      "appId": "claude",
      "name": "默认 Claude",
      "profilePath": "...",
      "sessionRoot": "...",
      "profilePathMode": "auto",
      "sessionRootMode": "auto",
      "executablePath": null,
      "isProtected": true,
      "createdAt": "...",
      "lastLaunchedAt": null,
      "group": "",
      "note": ""
    }
  ]
}
```

默认槽位 `isProtected: true`，不能从列表移除。`profilePathMode` / `sessionRootMode`：

- `auto`：每次启动重新解析当前系统的默认目录，Windows 可在传统目录和 MSIX LocalCache 间切换
- `managed`：AgentDesk 创建并维护的独立槽位
- `custom`：用户手动指定，不自动改写

账号外观、名称、路径等保存在 `profiles.json`；主题、庭院时间/天气、视图、提醒和今日账本保存在 `settings.json`。旧版仅存在 `localStorage` 的界面偏好会在首次启动时迁移到 `settings.json`。

两个文件写入时都先生成完整临时文件并 `fsync`，再替换主文件，同时保留 `.bak`。主文件损坏时会依次从常规备份和 `.pre-update.bak` 恢复，而不是静默清空或重置。Windows portable 真正替换 exe 前，还会额外保存一份更新前快照。

账号写回采用“重新读取最新配置，只修改目标字段”的方式。尤其 Windows 启动器发现和路径迁移可能耗时数秒，不能把异步操作开始前的整份旧快照写回，否则会覆盖用户同期修改的猫咪毛色、项圈、分组或备注。

额度快照只保存在进程内缓存，不写入 `profiles.json` / `settings.json`。Codex 查询以槽位 `sessionRoot` 作为 `CODEX_HOME` 调官方 app-server；发送给 renderer 前会移除账号邮箱、token 和原始 provider 响应。Claude / Cursor 在没有稳定公开接口时返回结构化 `unsupported`，不尝试浏览器 Cookie。

## 主进程职责

文件：[main.js](../src/main.js)

主进程负责所有本地能力：

- 读写 `profiles.json`
- 读写 `settings.json`，迁移旧版界面偏好
- 创建新槽位目录
- 启动 Claude / Codex 官方 App
- 扫描 Claude / Codex 会话（逻辑在 `sessions.js`，主进程调用）
- 打开 Finder / Explorer
- 写入剪贴板
- 选择目录
- 生成诊断信息
- 检查 GitHub Release，并在受支持的 Windows portable 环境执行校验更新
- 读取、缓存并脱敏 Codex 各槽位官方额度
- 从内置适配器启动 Shell / Codex / Claude Code，并约束工作目录和生命周期

渲染进程不直接访问文件系统。

## IPC 接口

暴露在 `window.manager`：

```js
checkForUpdates()
installUpdate()
listApps()
getSettings(legacySettings)
updateSettings(patch)
listProfiles()
addProfile(input)
updateProfile(input)
removeProfile(id)
migrateWindowsProfilePath(id)
launchProfile(id)
listSessions(profile)
revealSession(input)
listActivity()
listQuotas(options)
getDiagnostics(profile)
listTerminalAdapters(profileId)
startTerminal({ profileId, adapterId, sessionId })
sendTerminal({ profileId, runtimeId, text })
stopTerminal({ profileId, runtimeId })
onTerminalEvent(callback)
pickDirectory(options)
pickFile(options)
showItem(path)
openPath(path)
writeClipboard(value)
```

终端 IPC 不接受 renderer 提供的 executable、argv、env 或 cwd。main 只从已保存 profile 和重新扫描得到的 session ID 解析工作目录；首次开启还有原生系统确认。详情见 [YARD.md](YARD.md)。

## 会话扫描规则

### Claude

扫描根目录：

```text
profile.sessionRoot
```

扫描位置：

```text
claude-code-sessions/**/local_*.json
local-agent-mode-sessions/**/local_*.json
```

读取字段优先级：

```text
id: sessionId -> cliSessionId -> 文件名
title: title -> Claude 会话 <id前8位>
createdAt: createdAt -> 文件创建时间
updatedAt: lastActivityAt -> lastFocusedAt -> 文件修改时间
projectPath: cwd -> originCwd
model: model -> effort
status: isArchived ? 已归档 : 可用
```

### Codex

扫描根目录：

```text
profile.sessionRoot
```

默认是：

```text
~/.codex
```

扫描位置：

```text
session_index.jsonl
sessions/**/*.jsonl
archived_sessions/**/*.jsonl
```

读取字段优先级：

```text
id: payload.id -> payload.session_id -> 文件名 UUID -> 文件名
title: session_index.thread_name（按 session_id 关联）-> payload.title -> Codex 会话 <id前8位>
createdAt: 第一行 timestamp -> 文件创建时间
updatedAt: session_index.updated_at -> 文件修改时间
projectPath: payload.cwd -> payload.current_dir
model: payload.model -> payload.model_provider
status: archived_sessions 内为已归档，否则可用
```

注意：`session_index.jsonl` 用 `session_id` 做键，而它和 `payload.id` 在多数 rollout 里并不相同，所以关联标题必须用 `session_id`，否则大部分会话读不到标题。

## 启动官方 App

### macOS

优先查找：

```text
/Applications/<App>.app/Contents/MacOS/<App>
~/Applications/<App>.app/Contents/MacOS/<App>
```

如果找不到，回退：

```bash
open -n -a <App> --args --user-data-dir=<profilePath>
```

Codex 启动时额外设置：

```text
CODEX_HOME=<sessionRoot>
```

### Windows

Windows 适配集中在 [windows.js](../src/windows.js)。启动器依次覆盖：

- 用户手动指定路径
- `%LOCALAPPDATA%\Microsoft\WindowsApps\<App>.exe` Store 执行别名
- `%LOCALAPPDATA%\Programs` / `Program Files` 等传统目录
- Claude 旧版 Squirrel `AnthropicClaude\app-*`
- `App Paths` 注册表
- `Get-AppxPackage` 返回的当前 MSIX 包
- 每用户 AppModel 包仓库注册表的 `PackageRootFolder`
- 自动默认槽位的 `claude://` / `codex://` 协议回退

npm / WinGet Links 中的同名 CLI shim 会被排除。启动是异步确认的：`spawn` 失败或进程立即非零退出时继续尝试下一个候选。

MSIX 发现刻意保留两条互相独立的动态通道。包仓库注册表无需列举受 ACL 保护的 `WindowsApps`，并按 `<Name>_<Version>_<Architecture>_<ResourceId>_<PublisherId>` 解析包身份、数值比较四段版本；`Get-AppxPackage` 是受支持的系统查询，还会读取 manifest 中声明的非标准 executable。任一通道不可用都不会阻断另一条。

处于 `auto` 路径模式的默认槽位不强制传 `--user-data-dir`，让 Store/MSIX 使用官方默认容器；独立槽位使用 `%USERPROFILE%\.agentdesk\profiles\<App>\<profile-id>` 下的稳定 ASCII ID 目录并传入隔离参数。手动修改过路径的默认槽位也按自定义目录启动。Windows 运行探测对自动默认槽位按无隔离参数的桌面进程判断，其余槽位仍按数据目录精确匹配。

Windows 默认数据目录会在传统 `%APPDATA%\<App>` 与包私有 `LocalCache\Roaming\<App>` 中自动选择。旧版本位于 AppData 的独立槽位可通过诊断面板复制迁移到安全目录，旧数据不删除。

打开会话位置前会按会话 ID 重新扫描并验证磁盘路径。失效或过长路径只打开最近可访问的上级目录，不再直接触发 Explorer 的“位置不可用”弹窗。

### GitHub 更新

更新逻辑分成两层：

- [updater.js](../src/updater.js) 是纯 Node 安全边界：固定仓库、语义版本比较、平台/架构资产选择、URL 白名单、GitHub digest 解析和 Windows 替换脚本。
- [main.js](../src/main.js) 使用 Electron `net.fetch` 查询 Release，再用 `net.request` 手动审核每次下载重定向；同时限制响应大小和超时，校验文件大小及 SHA-256，最后启动独立 PowerShell 进程完成替换。

只有打包后的 Windows portable 进程、可写的 `PORTABLE_EXECUTABLE_FILE` 和带 SHA-256 digest 的匹配 `.exe` 同时成立时，`installSupported` 才为真。其余情况统一退化为打开该版本的 GitHub Release 页面。

替换器先把下载文件复制为目标目录中的 `.update`，等待当前进程退出后把旧文件移动到 `.old`，再将 `.update` 放到原路径。中途失败会恢复 `.old` 并尝试重启原程序。这样 portable 文件即使被用户移动或改名，也更新当前实际启动的那一份。

发布工作流先验证 tag 与 `package.json` 版本一致，再分别构建 macOS / Windows 产物、生成 `SHA256SUMS.txt` 并创建草稿 Release。正式发布后，GitHub `releases/latest` 才会把它暴露给客户端。

## 诊断面板

诊断面板用于解释为什么读不到会话或打不开 App。

检查项：

- 当前平台
- 官方 App 是否可启动、使用哪种启动方式
- 所有 executable / MSIX 数据目录候选
- App Paths、MSIX 包仓库注册表和 `Get-AppxPackage` 各通道的返回数量
- 账号目录是否存在、可读、可写
- 会话根目录是否存在、可读、可写
- AppData 虚拟化、非 ASCII 和长路径风险
- 是否需要执行 Windows 路径迁移
- 会话扫描位置是否存在
- 当前扫描到的会话数量
- 配置文件路径

诊断结果可以复制，用于排查用户机器上的问题。

## 交接信息格式

复制交接信息输出：

```text
请帮我继续理解这个会话：

应用：Codex
账号槽位：默认 Codex
标题：...
新建时间：...
最后活跃：...
来源：...
状态：...
项目目录：...
会话标识：...
会话文件：...
线程 ID：...

请基于这些信息判断这个会话在做什么，并继续处理。
```

## 测试

会话扫描逻辑抽到 `sessions.js`（纯 Node，不依赖 Electron），可直接单元测试：

```bash
npm test
```

覆盖字段解析、Claude / Codex 夹具扫描、容错、Windows 启动器候选、MSIX 路径映射、失效路径回退、Windows 进程命令行匹配、Release 版本/资产/URL/摘要/替换脚本，以及一条针对真实 `~/.codex` 的冒烟测试（本机数据缺失时自动跳过）。

## 打包

语法检查：

```bash
npm run check
```

macOS：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build:mac
```

Windows：

```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build:win
```

产物：

```text
release/AgentDesk-0.2.1-universal.dmg
release/AgentDesk-0.2.1-portable-x64.exe
```

## 已验证

在 macOS 上已验证：

- 开发版可启动
- 打包版可启动
- Claude 默认槽位可扫描到本地会话
- Codex 默认槽位可扫描到本地会话
- 路径设置弹窗可打开
- 诊断弹窗可显示真实路径和扫描数量
- 复制交接信息可写入剪贴板

## 尚未完成

这些不影响内部使用，但影响正式对外发布：

- Windows 真机发布矩阵验证（详见 [WINDOWS.md](WINDOWS.md)）
- macOS Developer ID 签名与公证
- Windows 代码签名
- 对完整聊天内容的可选导出，目前刻意不做默认能力

## 维护注意事项

- 不要保存账号密码或 token。
- 不要默认复制完整聊天内容。
- 改扫描逻辑时优先保持容错，单个坏文件不能中断整个扫描。
- Codex 的 `profilePath` 和 `sessionRoot` 要继续分开处理。
- Windows 路径不要写死单一安装位置。
- Windows 独立槽位不要重新放回 AppData；MSIX 会产生逻辑路径与物理路径分叉。
- 不要把 npm / WinGet Links 中的 Claude/Codex CLI 当成桌面 App。
