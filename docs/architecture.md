# 原生客户端架构

| 目录 | 职责 |
| --- | --- |
| `Sources/AgentDeskNative/App` | 生命周期、菜单栏、popover、账号协调、通知、诊断 |
| `Sources/AgentDeskNative/UI` | 账号、任务、额度、设置、信息与文档接力记录 |
| `Sources/AgentDeskNative/Companion` | 可选静态原生浮球、拖动及点击 |
| `Sources/AgentDeskNativeCore/Accounts` | 本机账号配置与旧客户端配置导入 |
| `Sources/AgentDeskNativeCore/Launcher` | 客户端定位、启动、运行目录与会话路由 |
| `Sources/AgentDeskNativeCore/CodexTasks` / `ClaudeSessions` | 本地元数据与状态读取 |
| `Sources/AgentDeskNativeCore/Quota` | 实时额度、解析、缓存及失败状态 |
| `Sources/AgentDeskNativeCore/Handoff` | Markdown 副本、剪贴板格式及日志 |
| `Tests` | 核心逻辑与应用行为测试 |
| `Resources` / `script` | 中性图标、构建安装及打包 |

面板固定为 340 × 570pt。账号、设置、信息在内部切换，底栏始终存在；采用系统强调色和原生毛玻璃。浮球固定 44pt、无动画、不查询媒体。桌面入口能力和可见性独立持久化，不含角色选择或角色主题。

任务状态每 5 秒读取，额度每 5 分钟同步，可关闭自动同步并手动刷新。额度请求去重并遵守限流退避；后台不弹钥匙串提示。失败保留最后成功的值及原观测时间，显示缓存与原因。Claude 当前 usage 端点不是稳定公开集成 API，可能随服务变化。

偏好域 `com.agentdesk.native`，数据根目录 `Application Support/AgentDeskNative`；只读导入旧客户端 `AgentDesk/profiles.json`，不接管其偏好。交接副本位于 `handoffs/`，权限 0700 / 0600，同名不覆盖；删除记录保留文档。不读取会话正文生成文档、不自动发送消息。

面板内容使用固定列宽，折叠区域整行可点击；长内容通过滚轮或触控板滚动，不因滚动条出现而重新换行。
