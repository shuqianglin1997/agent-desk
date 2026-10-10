# 架构

AgentDesk Native 的 macOS 端是独立的菜单栏应用，不依赖现有 Electron 客户端进程，只有可选的静态原生浮球。

## 目录

| 目录 | 职责 |
| --- | --- |
| `macos/Sources/AgentDeskNative/App` | AppKit 应用生命周期、popover、账号状态协调、通知、文档接力 |
| `macos/Sources/AgentDeskNative/UI` | SwiftUI 面板、账号和会话、设置、信息、主题与状态颜色 |
| `macos/Sources/AgentDeskNative/Companion` | 静态原生浮球的模型、窗口与拖动 |
| `macos/Sources/AgentDeskNativeCore/Accounts` | 账号配置、分组及默认客户端数据发现 |
| `macos/Sources/AgentDeskNativeCore/Launcher` | 客户端定位、进程归属、启动、运行目录和会话路由 |
| `macos/Sources/AgentDeskNativeCore/CodexTasks` / `ClaudeSessions` | 本地会话元数据与状态 |
| `macos/Sources/AgentDeskNativeCore/Quota` | 额度解析、缓存、实时查询与刷新状态 |
| `macos/Sources/AgentDeskNativeCore/Handoff` | 待接力状态、提示词、Markdown 副本、剪贴板格式与记录 |
| `macos/Tests` | 核心行为与应用状态回归测试 |
| `shared/assets` | 应用图标 |
| `macos/script` | 开发构建、安装、通用架构发行包 |

Swift 约定目录使用大写，文档和脚本目录使用小写。构建产物和本机恢复快照位于被忽略的 `.build/` 与 `dist.noindex/`，不提交。

## 运行路径

AppDelegate 管理菜单栏、桌宠窗口和一个由 SwiftUI 承载的 popover。面板为固定 340 × 570pt，底栏始终存在；账号、信息、设置和新建账号在内部切换并滚动，页面状态保留。关闭行为由应用显式控制，避免首次聚焦或内容变化使 popover 意外关闭。

AgentDeskNativeModel 协调账号、任务、额度与动作，后台队列读取本机状态，主线程发布 UI 更新。任务元数据每 5 秒轮询；Claude 桌面会话按每个账号的 `profilePath/local-agent-mode-sessions` 读取元数据 JSON 和固定位置的 audit 尾部，分别缓存文件长度与修改时间。本机 `~/.claude/projects` 的 Code 历史只显示在使用默认 Claude profile 的卡片，标记 Code；这是本机历史展示约定，不能证明 Code 与桌面账号登录一致，独立 profile 不混入这些记录。额度独立每 5 分钟同步，可在设置关闭，打开面板和手动刷新也可触发。自动请求遵守节流并且不弹钥匙串授权；手动请求允许系统请求授权。并发请求去重，服务限流时退避。

Codex 使用所属账号的 app-server 查询额度，本地 rollout 尾部记录提供回退。Claude 使用所选桌面配置中当前账号的 profile 授权查询 usage 服务，并用客户端历史与 IndexedDB 额度事件回退。账号 UUID、组织与 scope 必须匹配；旧组织历史不阻断唯一有效的新登录。成功替换缓存；失败保留原始观测时间，不能用更旧的缓存覆盖实时快照。Claude 端点不是承诺稳定的公开集成 API，变更、授权过期或限流均明确显示原因。

## 数据与兼容

- 数据根目录：`~/Library/Application Support/AgentDeskNative/`。首次启动从 `~/Library/Application Support/AgentDesk/profiles.json` 导入旧客户端账号槽，不修改旧配置。`accounts.json` 保存账号槽；客户端原目录继续原地引用。
- `session-order.json` 按账号保存会话 ID 顺序（0600），不改客户端记录。只允许在同一账号、同一活动状态分区内拖动；新会话保留来序，活动会话仍显示在上方。
- `handoffs/` 保存本次准备或用户选择的 Markdown 副本和 `log.jsonl`。目录权限 0700、最终副本文档权限 0600；同名不覆盖，复制不修改原文档，记录删除保留文档。剪贴板包含副本绝对路径和完整正文。pending.json 保存一个待接力任务，drafts/<UUID>/handoff.md 是源 agent 应写入的唯一绝对路径。AgentDesk Native 只复制提示词，由用户在源对话发送；用户点击继续后才读取文件并保存不可覆盖的副本。取消保留文档，失败可重试。不调用模型，不提取聊天，不后台等待文件或自动发送消息。
- Claude 登录信息通过 macOS 钥匙串解开对应客户端的加密配置，仅在内存用于 `api.anthropic.com` 额度请求；不保存、打印、不刷新 token，不改变客户端登录，也不跟随请求重定向。
- Bundle ID 与偏好域为 `com.agentdesk.native`，与现有 Electron 客户端独立；不做其他产品的偏好迁移。
- 桌面浮球默认关闭；开启后是静态原生浮球，没有角色素材、动画或媒体监控。面板始终保持系统毛玻璃外观。

## 产品边界

只支持本机 Codex / Claude。多实例深链无法保证定向，因此会话点击优先调出正确账号，具体对话可能仍需手动选择。没有跨账号原会话复制、跨设备同步或通用插件系统。不替换、不删除现有 Electron 客户端及其数据。

面板内容使用固定列宽，折叠区域整行可点击；长内容通过滚轮或触控板滚动，不因滚动条出现而重新换行。
