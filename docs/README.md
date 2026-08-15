# AgentDesk 文档导航

这里是仓库文档的入口，也是“当前做到哪一步”的统一说明。涉及 Personal Agent Mesh 的实现决策，以 [`PERSONAL_AGENT_MESH_PLAN.md`](PERSONAL_AGENT_MESH_PLAN.md) 为唯一实施权威；当前权威版本为 **1.29 / OWNER APPROVED — IMPLEMENTATION AUTHORIZED**。

## 先分清七种状态

AgentDesk 的文档必须把下面七种状态分开，不能都写成“已完成”：

| 状态 | 当前事实 | 能说明什么 | 不能说明什么 |
|---|---|---|---|
| 已进入代码 | 有人值守 Mesh 的版本化首次使用、双方身份确认的设备任务向导、目录/库存、SessionPointer、文件、便携与同 Mesh TaskPackage 已有纵向实现；直送使用独立 `task.package.transfer.v1`。AgentDesk 的 Profile 所有权退出收口、受管根 Crashpad 有界保护及事故级遗留进程熔断也已接通 | Renderer、Preload、Main、领域与服务主流程存在 | 不等于真实网络、操作系统权限、真实客户端崩溃注入和长期运行已经验收 |
| 本机自动化已验 | Node 526 项中 525 通过、1 项仅 Windows 跳过、0 失败；TaskPackage 安全 25/25、发布安全 14/14、真实 Electron UI 21/21 | 领域规则、IPC/协议、成品/发布门禁纯代码与真实窗口路径可重复验证 | 自动化通过不等于签名产物、GitHub Release 或物理安装已产生 |
| 当前 macOS unpacked 已验 | 本机现有确切 `release/mac-arm64/AgentDesk.app` 已通过 fuse/ASAR verifier，并以真实语义开关 `--macos-ci-mock-keychain` 通过同一字节的三次首次使用 smoke | 118/118 个常规文件、五项 fuse 与 macOS ASAR header 一致；ad-hoc/无 Team 预检和逐次 Browser 原生开关绑定后，初始化、恢复完成与完成后重启在 mock Keychain 下通过 | 新的 GitHub macOS `main` CI 运行仍待结果；ad-hoc 包不可分发，这也不证明系统 Keychain/OS 密钥保护、Developer ID/公证、Draft/公开重下载、Gatekeeper 或物理干净机 |
| 发布事务已进入代码 | Preview-only 策略、三资产白名单、Draft 双原生端重下载、发布后匿名公开重下载、失败回 Draft 与 candidate-burned 语义已实现；发布安全 14/14 | 发布状态机和失败关闭规则有可重复的纯代码证据 | 尚未使用真实签名凭据、受保护环境和真实 Tag 执行，当前没有公开 Preview |
| 隔离双 endpoint 已验 | 局域网直连与本机 signaling 两次 E2E 均完成认证、目录/库存、刷新、SessionPointer、184,333 字节文件和合成远控画面 | 既有 Mesh 数据面在两种本机会合路径继续贯通 | E2E runner 尚未发送 TaskPackage，不能据此声称直送数据面已验 |
| 物理双 Mac 已验 | 2026-08-13 在同一局域网以 host/UDP 建立认证 DataChannel；562,009 字节库存中的 9 个 Slot、638 条 SessionReplica 完整落库，revision 7 → 8 → 9，连接连续 5 分钟无错误或断开 | 关闭“双 Mac 局域网大库存、显式刷新、当前 4 分钟全快照恢复基线”这一项 | 不代表公网 NAT、强制 TURN、断网/睡眠恢复、远控权限或 Windows 已通过 |
| 发布与产品门禁仍开放 | 当前没有可下载的 `v0.10.1-preview.1`；真实签名/公证、受保护 `preview-release` 环境、真实 Tag、浏览器 quarantine、Windows MOTW/SmartScreen/Defender/UAC、物理干净机首次使用，以及 TaskPackage/公网/权限矩阵仍待完成 | 当前缺口有明确边界 | 不能声称“他人已经可以下载安装”，也不能称为稳定 Personal Mesh |

发布口径已经冻结：当前 `0.10.1-preview.1` 只是源码候选。首个公开 Preview 必须经过真实签名/公证、精确 DMG + portable + `SHA256SUMS.txt` 三资产 Draft、两个原生系统重下载、发布后无 token 匿名重下载与物理干净机检查；当前尚无该公开 Release。稳定开关保持关闭，产品门禁真正关闭后才可另行批准稳定 `v0.10.1`；不会把 `0.10.0` 开发基线补发为稳定版本。

## 按目的阅读

| 想知道什么 | 文档 | 角色 |
|---|---|---|
| 产品现在是什么 | [`PRODUCT.md`](PRODUCT.md) | 当前产品事实与边界 |
| 用户现在能怎么用 | [`SCENARIOS.md`](SCENARIOS.md) | 当前用户场景及每条路径的证据边界 |
| 每项功能做到哪一步 | [`FUNCTION_AUDIT.md`](FUNCTION_AUDIT.md) | 功能、证据层级和剩余缺口 |
| 代码如何组织 | [`INTERNAL.md`](INTERNAL.md) | 运行时、数据、IPC、协议与测试结构 |
| 下一步按什么顺序做 | [`ROADMAP.md`](ROADMAP.md) | 已批准实施批次与阶段门禁 |
| Mesh 的完整决策 | [`PERSONAL_AGENT_MESH_PLAN.md`](PERSONAL_AGENT_MESH_PLAN.md) | 唯一实施权威；涉及设备/P2P/传输时必须全文重读 |
| Windows 能力与限制 | [`WINDOWS.md`](WINDOWS.md) | Windows 路径、打包与真机矩阵 |
| 如何发布 | [`RELEASING.md`](RELEASING.md) | 签名、公证、Preview 与稳定版门禁 |
| 为什么采用当前技术边界 | `ADR_*.md` | 已作出的局部架构决策与证据 |
| 多账号、多设备管理方法 | [`AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V4.md`](AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V4.md) | 面向使用者的完整说明文章 |
| 多 Agent 工程方法 | [`MULTI_AGENT_ENGINEERING_WORKFLOW_GUIDE_V2.md`](MULTI_AGENT_ENGINEERING_WORKFLOW_GUIDE_V2.md) | 独立的工程认知文章，不代表产品实现状态 |

HTML 审阅稿记录当时的设计审阅过程；历史方案和旧图中的界面结构不能覆盖 1.29 权威与当前产品事实。开发接力摘要只能帮助定位，不替代全文重读权威规划。

## 文档写作约束

- “已实现”只表示代码纵向链路存在，后面必须紧邻证据层级或未关闭门禁。
- “已验证”必须说明是在纯函数/Node、本机真实 Electron、隔离双 endpoint、物理双 Mac，还是跨平台真机上验证。
- “成品已验证”必须继续区分 unpacked fuse/ASAR、三次首次使用 smoke、签名/公证、托管 runner 重下载与物理干净机；任一层不能替代下一层。
- GitHub-hosted runner 的 Draft/公开下载证据只证明 Release URL、字节、摘要、签名与自动化首次使用；浏览器 quarantine、Windows MOTW/SmartScreen/Defender/UAC 和实际用户安装仍是物理门禁。
- 不把“双 Mac 局域网库存已验”扩写成“物理双机全部通过”，也不再笼统写成“物理双机完全未验证”。
- 主窗口当前只有一个 Header、一个 Footer 和顶部 Agent / 左下会话 / 右下详情三个固定面板；设备、工具、活动、设置使用独立弹窗。旧七行信息轨只属于历史记录。
- Agent 目录和 Profile 列表都允许真实为空。缺失 `profiles.json` 现在会原子落为 `[]`，不再生成默认 Claude/Codex/Kimi Profile；已有 Profile 只进入无损迁移预览，删除后也不会自动补回。
- “复制会话信息”仍只有路径和坐标。TaskPackage 是另一项显式交付能力，不增加复制模板。
- 同 Mesh TaskPackage 直送已经接通产品代码与本机证据，但真实 Electron UI 只验证资格和阶段投影；Electron E2E runner、物理双机和跨平台矩阵尚未发送该数据面。文档必须把这些层分别写明。
- TaskPackage 直送认证来源设备的 ID 和名称；`sourceAgentName` 与交接人标签是包内声明，不得写成目录认证身份。

修改当前状态文档后运行：

```bash
npm run check:docs
```

检查会验证导航链接、权威版本、526 项 Node / 21 条实窗 / 14 条发布安全证据、发布事务关键阶段与发布口径，并阻止稳定版、旧七行 UI、默认 Cloud/Kimi，以及把代码、窗口投影、托管 runner 或物理验收混写为“全部完成”等越阶段说法重新进入当前事实文档。
