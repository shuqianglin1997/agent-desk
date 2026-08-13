# AgentDesk 演进路线

## 定位

AgentDesk 以“单人 Personal Agent Mesh”为长期主轴：先把本机多账号、逻辑会话和工具维护做准，再扩展为同一个人在多台可信设备上的全局 Agent 目录、会话索引、显式发送和受限控制。整项工作可以通过便携加密 TaskPackage 交给另一个 Agent、设备或人；这项能力传递一次快照，不把 Personal Mesh 扩张为团队平台、聊天壳或任务执行编排器。

Personal Mesh 规划已于 2026-08-10 获批，永久员工库与按需就绪于 2026-08-13 获批，TaskPackage 基线于 2026-08-14 写入 1.25。Phase 2–8 的有人值守代码纵向链路以及 Phase 1 的签名公网会合/STUN/TURN 配置已经实现；Phase 4A 已实现便携加密文件、人工检查点、Git/附件捕获、Codex 原生导入和活动历史。固定 Header/三面板/Footer 页面骨架、四个独立全局弹窗与独立 UI 上下文保持不变。Phase 1 的真实公网/coturn、跨平台权限矩阵，以及 TaskPackage 的同 Mesh 直接发送和更多原生客户端适配器仍未完成，所以公开 Beta 门禁尚未关闭。

## 当前基线

- 多客户端账号槽位、身份归组与官方 App 启动；
- Claude Desktop / CLI、Codex、Cursor、Kimi Code / Work 会话索引；
- 与 Device Lens 正交的当前/全部 Agent 范围、搜索、排序、focus/显式勾选统一定位与支持来源的单会话 Markdown 导出；
- 活动聚合、Codex 额度总览、路径诊断；
- 共用状态的猫猫庭院与卡片名册、单一场景 Popover；
- 桌面 App / CLI 发现、版本检查、打开和显式维护；
- macOS / Windows 打包、更新与发布校验；
- Personal Mesh 初始化、一次性加密配对、设备权限/撤销、全局 Agent 目录、设备 Lens 与可删到零语义；
- schema v6、长期 Agent 生命周期、Blueprint/Deployment/ProvisioningJob、签名目录事件、一致迁移回滚点与本机按需就绪；
- 独立 `catalog.events.v1`、0.9.4 `catalog.snapshot.v1` 兼容与来源设备 `inventory.device-facts.v1`；目录按来源向量补缺口，并发字段确定性收敛，删除 tombstone 防复活，更旧端 inventory-only 降级；
- Agent/账号绑定/运行位置的明确新增、归属、合并、拆分和三种删除范围；
- Device Lens、Agent、Slot、focused/checked 会话、副本来源、设备详情、远控和传输草稿的独立 UI 上下文；
- Ed25519 成员证书/握手、Mesh 范围账号 HMAC、独立 `mesh.db`、OS 密钥保护和签名协议封装；
- 来源单写的跨设备库存、强账号/强会话去重、离线快照与 tombstone；
- 加密 SessionPointer、本机离线队列、目标端项目映射、选定文件分块/校验/续传；
- 便携加密 TaskPackage：人工目标/进展/下一步/风险/验收、原生会话或 transcript、Git 基线/已跟踪差异、明确附件、接收预览和本地历史；
- 右下统一详情面板内的隔离 Remote Surface、目标端逐次同意、屏幕查看、固定键鼠输入协议和最多四路控制台；
- 局域网优先、签名 Signaling Gateway 回退、STUN/短期 TURN 和脱敏连接诊断；
- 已就绪远端固定 `profile.launch`、未就绪远端有人值守 `agent.prepare`，以及确认后撤权/断连的副作用阻断；
- Electron 43.3.0 沙箱 Renderer 内的真实 DataChannel/媒体纵向自检及各阶段 ADR。
- 完整 Node 套件 436 项中 435 通过、1 项仅 Windows 跳过、0 失败；临时 userData 下真实 1040 × 840 Electron 的 18 条本地任务路径验收，包括固定几何、Compact 无横滚、卡片名册、临时层边界和 TaskPackage 固定事务弹窗。

## 近期优先级

### 1. 物理设备与真实网络验收

- 两台真实电脑完成加密配对、断网恢复、睡眠唤醒和撤销防重连；
- macOS → macOS、macOS ↔ Windows、Windows → Windows 验证屏幕、键鼠、多显示器、DPI、布局和 IME；
- 覆盖家庭 NAT、对称 NAT、CGNAT、IPv4/IPv6、UDP 禁用与网络切换；
- 部署测试域名的 HTTPS Signaling 和 coturn，分别强制 UDP、TCP/TLS `relay`；
- 记录失败原因、带宽、延迟和中继比例，校准规划中的容量预算。

### 2. 发布与运行加固

- macOS Developer ID、公证、staple、Gatekeeper 全链验证，并确认通用 input helper 位于最终 DMG 且签名有效；
- Windows CI/真机确认 MSVC helper 编译、portable 打包、checksum、升级回滚和 UIPI/UAC 降级；
- 公网 Signaling Gateway 增加 TLS 入口、容量监控、短期状态存储方案和运维手册；
- 打包后检查已退休模块、凭据和服务端源码没有错误进入桌面运行路径；
- 完成物理验收前不把当前开发版标为公开稳定远控。

### 3. 扫描可靠性

- Codex 按逻辑根 thread 去重，隐藏 guardian/subagent，确保上下文压缩不新增会话行；
- 为大目录增加可观测的扫描耗时和错误摘要；
- 对损坏 JSON/JSONL/SQLite 记录继续做局部降级；
- 为新增客户端建立独立解析器和固定测试夹具；
- 减少重复扫描，确保切换账号时 UI 不阻塞。

### 4. 路径与诊断

- 把“未安装、路径错误、权限不足、没有会话”区分得更清楚；
- 扩充 Windows Store/MSIX 与 macOS 多版本安装识别；
- 让诊断结果可复制，但默认隐藏不必要的个人路径片段。

### 5. 工具维护可信度

- 增加安装源识别测试和版本源失败说明；
- 记录每次显式维护的本地结果摘要；
- 对无稳定机器可读版本源的工具继续只提供官方入口；
- 保持 renderer 只能提交 toolId/profileId。

### 6. 会话浏览体验

- 可配置列与更清晰的空状态；
- 更快的跨账号筛选；
- 改进键盘导航和无障碍标签；
- 导出失败时给出来源级原因。

### 7. TaskPackage 适配器与传输

- 在真实 Codex 安装中复验原生根会话、internal-child、重复导入、归档目录与客户端重新扫描；
- 为每个新增原生客户端适配器分别完成版本白名单、身份复核、不覆盖、回滚和幂等证明；
- 在既有受认证文件通道上增加同 Personal Mesh 直接发送，不改变包内加密、清单和来源保留规则；
- 跨 Mesh 直连先设计双方身份确认、接收权限、限速与滥用边界；当前继续使用便携文件和分开发送的解锁码；
- 增加磁盘不足、超大包、取消、应用崩溃和陈旧 staging 的真实文件系统矩阵。

## Personal Mesh 阶段状态

| 阶段 | 代码状态 | 尚未关闭的门禁 |
|---|---|---|
| Phase 1 技术验证 | WebRTC 承载、设备认证、SQLite、签名信令、STUN/TURN 配置已实现 | 两台真机、真实 NAT、coturn、跨平台权限 |
| Phase 2 设备与全局 Agent | 初始化、配对、权限、撤销、签名事件目录、对象管理和可删到零已实现；字段并发/关系冲突/删除防复活有自动化 | 物理双机 0.9.5 双端编辑、长期运行与冲突体验验收 |
| Phase 2A 永久员工与按需就绪 | schema v6、Blueprint/Deployment/Job、事件增量与旧快照兼容、本机准备、远端打开/有人准备与撤权竞态防护已实现 | 事件 checkpoint 压缩、冲突专用 UI、更多适配器、物理双机准备/登录矩阵 |
| Phase 3 库存与会话身份 | 来源设备事实、版本 feature 兼容、目录权限隔离、revision、强标识折叠、正交 Device Lens/Agent scope 和显式副本来源已实现 | 物理双机大库存、断网与 stale 验收；revision delta/缺口补齐 |
| Phase 4 会话信息 | SessionPointer、本机离线队列、项目映射已实现 | macOS/Windows 不同项目根真机验收 |
| Phase 4A 整项任务交接 | 便携加密文件、人工检查点、Git/附件、Codex 原生导入、接收预览和历史已实现 | 同 Mesh 直接发送、跨 Mesh 身份设计、更多原生适配器与真实大包矩阵 |
| Phase 5 文件 | 选择、确认、加密分块、哈希、续传已实现 | 大文件、磁盘不足和跨网络真机矩阵 |
| Phase 6 仅查看 | 右下详情内隔离 Remote Surface、目标同意、显示器和画质已实现 | 真实桌面权限与多显示器矩阵 |
| Phase 7 输入控制 | 固定键鼠协议、唯一 owner、helper 与紧急停止已实现 | Windows helper、UIPI、DPI、键盘和 IME |
| Phase 8 多设备控制台 | 四路网格、活动画质和聚合统计已实现 | 四台真机与公网带宽矩阵 |
| Phase 9 无人值守 | 未授权、未实现 | 必须单独进行产品和安全评审 |

每一阶段仍按 `PERSONAL_AGENT_MESH_PLAN.md` 的退出条件验收。代码纵向链路完成不等于物理门禁关闭，不能用单机测试声称公开 P2P 已稳定。

## 长期可做

- 通过公开、稳定、只读格式增加新的会话来源；
- 通过官方本机 API 增加新的额度提供方；
- 可选的本地加密配置备份；
- 更完整的庭院美术资产与低动态偏好。

## 拒绝清单

- 内嵌终端、聊天 transport 或 Agent 进程管理；
- worktree/任务队列/多 Agent 流程编排；
- 多会话交接清单或自动上下文拼接；
- 规划文档和项目任务材料索引；
- 任意可执行命令、自定义协议 Agent；
- provider/API key 路由与凭据托管；
- 未经用户明确触发的第三方工具更新；
- 云端 transcript 同步或自动迁移。
- 团队、组织和多人共享设备；
- 通用远程 Shell、任意命令或云端凭据托管。

若未来需求落入拒绝清单，应作为独立产品讨论，不能复用“工具发现”之名重新塞回 AgentDesk。
