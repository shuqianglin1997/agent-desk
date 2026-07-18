# Agent Fleet 架构与接入说明

## 目标

Fleet 不是“在账号页面塞一个聊天框”，而是 AgentDesk 的主运行面。客户端账号管理继续提供身份隔离和历史索引，但运行层必须独立存在并能管理所有可接入的终端 Agent。

```text
Agent Adapter ─┐
Identity ──────┼──> Runtime Instance ──> isolated output / status / session
Workspace ─────┘

History Session ──> workspace suggestion + optional handoff task
```

关键约束：

- Adapter ≠ Identity：OpenCode / Gemini 可能不需要 AgentDesk 账号槽位；Codex 可选绑定某个 `CODEX_HOME`。
- Identity ≠ Workspace：工作账号可以处理个人目录，个人身份也能被用户授权到另一个项目；界面必须明确显示组合结果。
- Runtime ≠ History Session：运行实例是当前进程和连接，历史会话是本地索引；前者不能依赖后者才可创建。
- 一个组合可创建多个 Runtime，切换选中项不能停止其他实例。

## 三层适配器

### 1. Direct

Codex 和 Claude Code 先保留直连适配器：

- Codex：`codex exec --json`，后续轮次用 `exec resume`；绑定身份时只在主进程设置对应 `CODEX_HOME`。
- Claude Code：`claude -p --output-format stream-json`，实例内部保存会话 ID 并 `--resume`。
- 两者的可执行文件和固定参数由主进程决定，renderer 只传适配器 ID、身份 ID、工作区授权和文字。

Direct 是兼容层，不是未来扩展每个 Agent 的方式。

### 2. ACP

[Agent Client Protocol](https://agentclientprotocol.com/get-started/architecture) 把编辑器 / 客户端与编码 Agent 分开，适合 AgentDesk 作为统一 Client。当前使用官方 TypeScript SDK，通过 stdio NDJSON 完成：

1. 启动本机 Agent 的 ACP 命令。
2. `initialize` 协商协议和 Agent 信息。
3. 以绝对 `cwd` 创建独立 session。
4. 每个实例保持自己的进程、ACP connection、session 与输出缓冲。
5. `session/prompt` 流式接收回答、思考、工具、计划、标题与 usage 更新。
6. Agent 发出 `session/request_permission` 时，主进程显示原生选择框并回传 Agent 给出的 option ID。
7. 停止实例时先发 cancel，再释放 session / connection 并终止子进程。

内置发现清单来自公开 ACP 生态的常用稳定命令：

| Agent | 命令形态 | AgentDesk 适配器 |
|---|---|---|
| Gemini CLI | `gemini --acp` | ACP |
| OpenCode | `opencode acp` | ACP |
| Cursor Agent | `cursor-agent acp` | ACP |
| GitHub Copilot CLI | `copilot --acp --stdio` | ACP |
| goose | `goose acp` | ACP |
| Kimi CLI | `kimi acp` | ACP |
| Qwen Code | `qwen --acp --experimental-skills` | ACP |

发现同时检查环境变量、`PATH` 和常见用户工具目录；Windows 覆盖 `.exe`、npm `.cmd` / `.bat` 和 WindowsApps 应用别名。内置清单后续应从签名 / 固定版本的 [ACP Registry](https://agentclientprotocol.com/get-started/registry) 元数据生成，不能无限增长成另一张手写路径表。

### 3. Shell / 未来 PTY

Shell 是所有终端工具的兜底层，并允许同时打开多个实例。当前管道实现适合逐行命令、脚本和非全屏 CLI；依赖真实 TTY、光标控制或交互登录的 Agent 需要未来的 PTY / Windows ConPTY 适配器。

PTY 阶段仍复用 Runtime 公共状态，不改变 Fleet UI：

```text
starting -> running (Shell / PTY)
starting -> ready -> running -> ready (Agent turn)
                              -> error / exited / stopped
```

## 自定义 Agent

“接入 Agent”不是让 renderer 输入任意命令：

1. 用户在系统文件选择器中选中本机可执行文件。
2. main 为当前 `webContents.id` 生成不可猜测授权 ID，renderer 只拿到该 ID 与展示路径。
3. 提交时 main 校验授权归属，按行解析最多 32 个参数，不经过 shell 字符串拼接。
4. 配置写入 `userData/agent-adapters.json`，并保留 `.bak` 与 `.pre-update.bak`。
5. 运行时重新检查文件存在，移除定义不影响已经启动的实例。

当前自定义协议只允许 ACP stdio。任意“命令输出长什么样”的自定义解析器会把安全与兼容问题转嫁给用户，不应在没有协议合同的情况下假装支持。

## 多实例生命周期

每个 Runtime 至少保存：

```js
{
  id,
  adapterId,
  adapterLabel,
  mode,          // shell | agent
  protocol,      // shell | direct | acp
  identityName,
  cwd,
  workspaceProfileId,
  title,
  status,
  conversationId,
  agentInfo,
  startedAt
}
```

输出在 renderer 中按 `runtimeId` 隔离；主进程事件也必须携带该 ID。实例切换只改变可见输出，不改变子进程状态。进程退出、连接错误或输出上限会删除主进程活跃记录，但 renderer 保留该次运行卡和已收集输出，便于排查。

## 工作区与身份授权

- 当前历史会话的 `projectPath` 只是默认建议，不是唯一来源。
- 用户可通过原生目录选择器授权任意工作区；renderer 不能传原始 `cwd`。
- Direct Codex / Claude 可选绑定匹配类型的账号槽位；不绑定时使用本机 CLI 默认登录。
- ACP Agent 自己负责认证。AgentDesk 不读取、转存或展示它的 token。
- 自定义 Agent 和任意目录的授权不能复用到另一个 renderer 所有者。

## 资源与错误边界

- 最多同时保留 12 个主进程实例。
- 单次输入上限 32 KB；单实例发送到 UI 的累计输出上限 1 MB。
- ACP 初始化和创建 session 各有 20 秒超时。
- `starting` 状态拒绝输入；`running` 状态拒绝重入；失败的一轮允许在连接仍活着时重试。
- 窗口关闭 / App 退出停止全部实例；移除账号只停止真正绑定该身份的实例，不影响无关 Agent。
- 权限对话框默认取消，并展示 Agent、实例、工作目录、工具标题和截断后的原始参数。

## 后续路线

1. **PTY / ConPTY**：支持需要真实终端的任意 CLI，同时保留当前多实例模型。
2. **Registry 安装助手**：读取固定版本 ACP Registry，展示来源、平台命令和校验信息；安装必须由用户显式触发，不能后台下载。
3. **远程 Transport**：SSH / 容器 / HTTP ACP 作为新的 launcher 层，Runtime 与 UI 不变。
4. **编排层**：允许用户显式建立“规划 Agent → 实现 Agent → 审查 Agent”的有向任务流；每一步仍是独立 Runtime，并有人工确认点。
5. **恢复与审计**：只持久化用户明确保存的工作区模板和运行元数据，不自动恢复未完成命令；权限决定与工具调用形成本地可清理日志。
6. **能力驱动 UI**：根据 ACP initialize/session 返回的模式、模型和配置能力显示控制项，避免为所有 Agent 硬画同一套按钮。

## 测试要求

- 适配器发现：macOS / Linux / Windows 路径，Windows `.cmd` / `.bat` 包装，缺失 CLI 不报错。
- ACP：初始化、session 创建、流更新映射、权限选择、握手超时、取消、进程异常退出。
- 多实例：不同适配器并行、同适配器重复实例、输出不串线、停止一个不影响另一个。
- 安全：renderer 无法提交 executable / argv / env / cwd；授权必须匹配所有者；输入 / 输出 /实例数上限。
- 持久化：自定义 Agent 原子写入、损坏恢复、更新前快照，旧数据迁移不丢账号外观和界面颜色。
