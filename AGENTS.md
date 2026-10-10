<!-- delivery-first:start -->
## 用户统一工作标准：以可用功能交付为目标

- 先抓住用户实际要用的结果，持续推进到可操作、可查看的完整功能。模块完成、测试数量、提交数量、文档和脚本都不能替代用户实际拿到成品。
- 默认直接完成已授权工作。普通实现选择、可解决的缺数据或依赖问题由 agent 自行处理，不把局部修复变成一轮轮等待用户继续指挥的交付。
- 不扩展无关功能，不为假想风险增加框架、审批或防御层，不把自设的证据、格式、来源或流程门槛变成无限阻塞。遇到门槛阻碍目标时，调整实现、来源或如实降级表达；不得编造事实、隐藏失败或假称完成。
- 测试与审阅服务于用户功能及实际风险，优先验证真实端到端路径和关键失败场景。适当检查通过后继续交付，不为增加测试数量、追求穷尽证明或反复微调而停留。
- 调研、计划、原型和演示应服从本次请求范围；用户只要求这些时，交付相应成果，不擅自实施或发布。用户要求开发时，不用计划、fixture、预选样本或局部 mock 冒充完整实现。
- 多 agent/线程共享同一产品目标与完成标准。独立任务可并行；改动开始重叠时，明确唯一集成负责人，收敛分支与实现，避免重复开发和互相等待。交接必须保留最新用户决策及真实未完成项。
- 只有需要用户作实质产品决定、缺少不可替代的信息、超出授权范围的外部操作，或存在无法自行解决的阻塞时才提问。仍须遵守实际权限与必要安全约束，不能以追求交付为由擅自部署、发送、破坏数据或泄露秘密。
- 汇报围绕“现在能用什么、距离用户目标还差什么、下一步如何完成”。清楚区分本地验证、真实服务运行、部署和用户验收；不以小修小补或测试通过代替完成声明。
<!-- delivery-first:end -->

AgentDesk Native is a standalone native client in the agent-desk repository, with a macOS menu-bar app (`macos/`, Swift) and a Windows tray app (`windows/`, .NET/WPF). It manages local Codex and Claude accounts, shows tasks and quotas, supports document handoff, and includes only an optional static native desktop orb. Keep this variant independent of the existing Electron app: bundle ID `com.agentdesk.native`, `Application Support/AgentDeskNative` on macOS, `%LOCALAPPDATA%\AgentDeskNative` on Windows. Do not add character assets, animation, media monitoring, or product-specific preference migrations. Sync rules are in `docs/upstream-branches.md`.

## 仓库结构

平台代码位于 `macos/`、`windows/`；共用资产、文案、样本与设计约定位于 `shared/`。修改用户可见行为时更新 `shared/parity.md`。不要把公司账号配置、凭据或真实会话正文写入仓库。

## macOS 构建与验收

运行 `swift test --package-path macos`、`macos/script/build_and_run.sh --build`；打包入口 `macos/script/package-release.sh`。Windows 机器上的路径检查不能替代 Mac 验收。

## Windows 构建与验收

使用 .NET 10：`windows/script/build.ps1 -Action Test`、`-Action Publish`、`-Action Package`。无系统 SDK 时传 `-Dotnet <dotnet.exe 的路径>`。`--demo --theme light|dark --page accounts|settings|info|add --screenshot <dir>` 输出独立演示截图；不读取真实客户端。运行正常产品用 `dist.noindex/windows/AgentDeskNative/AgentDeskNative.exe`。验证时不得关闭个人客户端或修改登录配置。
