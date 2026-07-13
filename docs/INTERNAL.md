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
    main.js            Electron 主进程，本地文件/启动/扫描/诊断
    preload.js         安全桥接 IPC
    renderer.js        UI 状态与交互
    index.html         页面结构
    styles.css         界面样式
  package.json         npm 脚本和 electron-builder 配置
```

## 数据存储

配置文件由 Electron 的 `app.getPath('userData')` 决定。

macOS 当前示例：

```text
~/Library/Application Support/AgentDesk/profiles.json
```

配置结构：

```json
{
  "version": 1,
  "profiles": [
    {
      "id": "...",
      "appId": "claude",
      "name": "默认 Claude",
      "profilePath": "...",
      "sessionRoot": "...",
      "isProtected": true,
      "createdAt": "...",
      "lastLaunchedAt": null
    }
  ]
}
```

默认槽位 `isProtected: true`，不能从列表移除。

## 主进程职责

文件：[main.js](../src/main.js)

主进程负责所有本地能力：

- 读写 `profiles.json`
- 创建新槽位目录
- 启动 Claude / Codex 官方 App
- 扫描 Claude / Codex 会话
- 打开 Finder / Explorer
- 写入剪贴板
- 选择目录
- 生成诊断信息

渲染进程不直接访问文件系统。

## IPC 接口

暴露在 `window.manager`：

```js
listProfiles()
addProfile(input)
updateProfile(input)
removeProfile(id)
launchProfile(id)
listSessions(profile)
getDiagnostics(profile)
pickDirectory(options)
showItem(path)
openPath(path)
writeClipboard(value)
```

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
title: session_index.thread_name -> payload.title -> Codex 会话 <id前8位>
createdAt: 第一行 timestamp -> 文件创建时间
updatedAt: session_index.updated_at -> 文件修改时间
projectPath: payload.cwd -> payload.current_dir
model: payload.model -> payload.model_provider
status: archived_sessions 内为已归档，否则可用
```

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

会检查多个候选路径，包括：

```text
%LOCALAPPDATA%/Programs/<App>/<App>.exe
%APPDATA%/<App>/<App>.exe
%ProgramFiles%/<App>/<App>.exe
%ProgramFiles%/OpenAI/<App>/<App>.exe
%ProgramFiles%/Anthropic/<App>/<App>.exe
```

Windows 真机需要继续验证 Claude / Codex 官方安装器实际落点。

## 诊断面板

诊断面板用于解释为什么读不到会话或打不开 App。

检查项：

- 当前平台
- 官方 App 是否找到
- 账号目录是否存在、可读、可写
- 会话根目录是否存在、可读、可写
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
会话地址：...
会话文件：...
线程 ID：...

请基于这些信息判断这个会话在做什么，并继续处理。
```

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
release/AgentDesk-0.2.0-universal.dmg
release/AgentDesk 0.2.0.exe
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

- Windows 真机验证
- macOS Developer ID 签名与公证
- Windows 代码签名
- 对完整聊天内容的可选导出，目前刻意不做默认能力

## 维护注意事项

- 不要保存账号密码或 token。
- 不要默认复制完整聊天内容。
- 改扫描逻辑时优先保持容错，单个坏文件不能中断整个扫描。
- Codex 的 `profilePath` 和 `sessionRoot` 要继续分开处理。
- Windows 路径不要写死单一安装位置。
