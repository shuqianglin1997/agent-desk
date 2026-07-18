# AgentDesk 产品定义

## 一句话定位

AgentDesk 是一个本地优先的 **多 Agent 工作空间与运行控制台**：在同一窗口接入不同终端 Agent，为每个实例选择身份和项目，并行工作、切换输出、查看本地历史；Claude / Codex 客户端账号槽位是身份与会话来源之一，不是产品边界。

## 用户真正要管理的东西

一个完整的 Agent 工作单元由五个彼此独立的对象组成：

| 对象 | 回答的问题 | 例子 |
|---|---|---|
| Agent 适配器 | 谁来工作、用什么协议连接 | Codex 直连、OpenCode ACP、Shell |
| 身份 | 用哪份登录与额度 | 工作 Codex、个人 Claude、本机默认登录 |
| 工作区 | 在哪里工作 | 某条历史会话的项目、任意用户授权目录 |
| 运行实例 | 现在是哪一个进程 / ACP 会话 | 同时运行的 3 个 Codex 与 2 个 OpenCode |
| 历史会话 | 以前做过什么 | 本地扫描到的 Claude Code / Codex 记录 |

这五个对象不能再被“当前选中的客户端账号”绑死。用户应该能在没有任何桌面客户端槽位时启动 Agent，也能让同一 Agent 在不同工作区开多个实例，或让不同 Agent 并行处理同一个项目中的不同任务。

## 目标用户与核心场景

- 同时使用 Codex、Claude Code、Gemini CLI、OpenCode、Cursor Agent、Copilot、goose、Kimi、Qwen Code 或团队内部 Agent 的开发者。
- 有多个工作 / 个人 / 备用登录身份，需要避免本地登录态互相覆盖的人。
- 不想让多个桌面客户端和终端窗口铺满桌面，希望在一个工作空间内监管多个 Agent 的人。
- 需要跨身份搜索本地会话，并把旧会话上下文交给另一个 Agent 继续的人。

主要工作流：

1. 从 Agent 注册表选择一个已安装 Agent，或接入自定义 ACP Agent。
2. 可选绑定一个登录身份；不需要身份的 Agent 直接使用本机配置。
3. 从当前会话项目或系统目录选择器授权一个工作区。
4. 新建运行实例；同一 Agent、身份或工作区都允许存在多个实例。
5. 在实例列表间切换。未选中的 Agent 继续工作，输出按实例隔离。
6. 从历史会话复制交接信息，或把它加入某个就绪 Agent 的任务队列。

## Agent 接入范围

当前实现分三层，避免把产品限制在某一家客户端：

1. **本机直连**：Codex 与 Claude Code 使用各自结构化非交互 CLI，保留身份槽位和连续追问能力。
2. **Agent Client Protocol（ACP）**：以长驻 stdio 会话接入 Gemini CLI、OpenCode、Cursor Agent、GitHub Copilot、goose、Kimi、Qwen Code等常用 Agent，并允许用户通过文件选择器接入任何实现 ACP stdio 的本机 Agent。
3. **通用终端兜底**：暂未实现 ACP 的 CLI 可以在多个独立 Shell 实例中运行。当前是管道终端；需要完整 TTY 的工具属于后续 PTY / ConPTY 阶段。

AgentDesk 只发现本机安装，不静默下载或升级第三方 Agent。内置清单不是封闭白名单；自定义 ACP 接入负责覆盖团队内部工具和未来新增 Agent。

完整运行模型与安全边界见 [AGENT_FLEET.md](AGENT_FLEET.md)。

## 客户端账号与本地会话层

### 账号槽位

账号槽位是一份可选的本地身份容器，保存官方 App 自己产生的登录态、缓存和本地数据。字段包括应用、名称、分组、备注、`profilePath`、`sessionRoot`、可选 App 可执行文件、猫咪外观和最近打开时间。

本工具不保存密码，不绕过官方登录。登录和鉴权仍由对应官方 App / CLI 完成。

### 会话索引

会话来自本地只读扫描，不要求手动录入。统一字段包括标题、创建 / 活跃时间、项目目录、来源、状态、线程 ID、文件路径和稳定会话标识。默认交接只复制元信息，不复制完整聊天内容。

## 跨平台路径

macOS：

- Claude 默认数据：`~/Library/Application Support/Claude`
- Codex 默认数据：`~/Library/Application Support/Codex`
- Codex 会话：`~/.codex`

Windows：

- Claude / Codex 默认 UI 数据：自动选择传统 `%APPDATA%` 或 Store/MSIX 的 `LocalCache\Roaming`
- Codex 会话：`%USERPROFILE%/.codex`
- AgentDesk 独立槽位：`%USERPROFILE%/.agentdesk/profiles`

Windows 独立槽位不能放在 AppData，否则 MSIX 文件系统虚拟化会让官方 App、AgentDesk 和 Explorer 看到不同位置。旧槽位只复制迁移，不自动删除原目录。Store 版启动位置通过每用户 Appx 注册表动态解析，不扫描受 ACL 保护的 `WindowsApps` 根目录。

## 界面原则

- 默认使用约 3:1 的左右结构：左侧是完整庭院和多 Agent Fleet，右侧是独立滚动的信息轨。
- Fleet 始终展示 Agent、身份、工作区和实例四个维度；任何一个都不能用模糊的“当前账号”代替。
- 实例列表和输出区同时可见。切换实例不停止后台任务，停止操作只作用于当前实例。
- 右侧信息轨在最小窗口高度下压缩账号操作，优先保证会话列表可见；内容过长时滚动信息轨，不压扁场景。
- 不使用常驻教学卡。说明文字只出现在状态、字段、首次引导与需要做决定的对话框中。
- 庭院是状态与操作入口，不是静态背景；美术资产的逻辑合同见 [YARD_ART_ASSETS.md](YARD_ART_ASSETS.md)。

## 安全与产品边界

- renderer 不能直接提交可执行文件、参数、环境变量或任意目录。
- 自定义 Agent 可执行文件和任意工作区都必须经原生系统选择器生成一次性授权。
- ACP 工具权限由主进程原生对话框逐次呈现，默认按钮永远是取消。
- Shell 确实执行本机命令；首次开启整个运行面前必须确认。
- 同时最多 12 个主进程运行实例；单次输入 32 KB；单实例累计输出 1 MB，超限立即终止。
- AgentDesk 不保存密码 / token，不读取浏览器 Cookie，不静默安装第三方 Agent。

## 近期验收标准

- 没有客户端账号槽位时仍能发现并运行本机 Agent。
- 同一 Agent 可以在不同工作区同时运行多个实例；不同 Agent 也可并行。
- ACP Agent 具备握手、长驻会话、流式回答 / 思考 / 工具事件、取消和权限选择。
- 自定义 ACP Agent 的路径只能由系统选择器授权，配置有原子写入、备份与更新前快照。
- UI 明确显示所有内置 Agent 的本机发现状态和连接协议。
- Windows 的 `.exe` / `.cmd` / `.bat` CLI、Store/MSIX 客户端和稳定账号路径都有测试覆盖。
- 账号外观、界面偏好和自定义 Agent 在更新后不丢失。
