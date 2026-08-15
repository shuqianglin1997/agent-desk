# AgentDesk 全功能梳理

更新时间：2026-08-15

## 1. 产品主轴

当前开发版 `0.10.1-preview.1` 同时管理本机账号槽位、逻辑会话、本机工具和一个人的可信设备网。Personal Agent Mesh 已贯通有人值守跨设备代码链路，但仍不替用户组织接下来的对话，也不把历史会话变成持续任务。TaskPackage 由用户从一条本机会话显式创建，只固定当时的会话、人工检查点、Git 现场和明确附件，供另一个 Agent、设备或人接手；它不是任务队列、自动编排或双向同步。证据分层记账：本机 Node/安全定向与真实 Electron UI；隔离双 endpoint WebRTC；物理双 Mac 局域网认证通道与大库存/刷新。物理双 Mac 已完成 562,009 字节、9 个 Slot、638 条 SessionReplica、revision 7 → 8 → 9 和连续 5 分钟稳定；隔离 E2E runner 尚未发送 TaskPackage。两者都不覆盖 TaskPackage 物理双机数据面、长连接/断网恢复、真实公网 NAT/coturn 和跨平台权限矩阵。

## 2. 功能地图

| 区域 | 用户入口 | 实际作用 | 当前决定 |
|---|---|---|---|
| Header | Device Lens、设备、工具、活动、设置 | 选择全部设备/某台设备；四个入口各自打开独立弹窗，更新/帮助/语言/主题归设置弹窗 | 已收敛；弹窗不替换右下详情，无“更多”杂物菜单、无来源不明状态点；四个弹窗统一固定 Header/Command/Footer 与单一 Content 滚动区 |
| 固定页面骨架 | 顶部 Agent、左下会话、右下详情、Footer | 庭院/卡片与 Agent/Slot 操作归顶部，会话浏览归左下；右下只承载会话、额度、远控，Footer 只保留全局状态 | 已实现；58px Header、244px Agent、316px 详情、38px Footer，主区恰好三个面板且 Compact 无横滚 |
| Agent 员工库与运行位置 | 打开账号、首次准备、新增运行位置、运行位置选择、管理 Agent | 长期保存 Agent/Blueprint，以 Deployment 表达当前工作环境就绪状态；准备成功后才产生 Profile/Slot，既有动作落到确切 Slot | 已实现；每个工作环境显示完整员工库，零 Binding/Slot 员工不消失；schema v6 保留 nullable suppressed Slot，增加 Blueprint/Deployment/ProvisioningJob、签名事件目录与一致迁移备份 |
| Profile 进程与磁盘保护 | 打开账号、管理 Agent、设置 | 精确识别同一 `user-data-dir`，监管 AgentDesk 所启动的官方客户端；默认退出收口，限制 Crashpad pending 并提供窄范围清理 | 已实现；每 Profile 100 文件/200 MiB，1 分钟 5 个同尺寸 dump 熔断。普通关闭只处理 owned 进程；已确认磁盘事故可按已登记 Profile 的精确路径停止旧版/异常退出遗留进程。只删除直属 `.dmp`/`_sidecar.json`，不读转储、不触碰会话/归档/配置/SQLite/`codex-home`/留存样本；管理器不运行期间的 OS 级持续守护仍不是当前能力 |
| 版本化首次使用 | “创建第一个 Agent”、已有 Profile 迁移预览 | 原子建立本机 Agent 目录与设备身份，不打开网络；随后进入首次准备 | 已实现；缺失 Profile 存储保持真实空数组，已有 Profile 先预览选择性无损迁移；真实 Electron 覆盖全新首 Agent、本机无网络初始化、完成页后记账和重启恢复，候选安装包首启仍待发布验收 |
| 设备任务向导 | 设备中心“添加设备” | 分别呈现身份确认、成员信任、认证连接、目录落库、库存落库和可以使用 | 代码与 UI 路径已实现；加入端验签预览、邀请端签证前确认和各屏障独立投影均有定向回归；“接收连接 30 分钟”只在高级恢复。完整物理双机向导、全应用重启后的双端恢复和公网/跨平台矩阵仍开放 |
| 目录纠错 | 合并 Agent、拆分绑定、移除运行位置/登录账号/Agent | 修改 AgentIdentity、AccountBinding、AgentSlot 目录关系并预览影响 | 已实现；三种删除范围均经过 MeshService → SQLite → 关闭重开的回归，不触碰官方客户端数据 |
| 身份归组 | 运行位置选择、强账号标识、显式归属 | 把同一实际登录的跨设备/跨客户端位置归入一只猫 | 已实现；跨平台或无强标识时不按名称猜测 |
| 会话列表 | 当前 Agent/全部 Agent、显示、搜索、表头排序 | 与 Device Lens 正交地只读浏览各客户端历史 | 保留；不产生任务或运行状态 |
| 会话选择 | 行 focus、显式 checkbox、清空选择 | focus 查看详情；checked 构成批量动作集合，隐藏选择有计数 | 已实现；搜索、排序和 render 不自动改写选择 |
| 会话操作 | 右下会话详情底部动作坞 | 聚焦单条时复制/发送/定位/导出；显式勾选后原位切换为批量摘要/取消/复制/发送 | 收紧；复制只有一种格式，动作不进入 Footer 或列表上方 |
| 整项工作交接 | 聚焦单条的次级“交接任务”；活动弹窗的“导入任务包”与历史 | 人工阶段说明 + 原生会话/只读内容 + Git 基线和已跟踪差异 + 明确附件，生成/导入同一种不可变加密快照 | 便携文件纵向链路已实现；Codex 可原生导入根会话和内部记录，其他可导出来源使用只读内容；来源保留、冲突拒绝、导入失败回滚。更多原生适配器待后续 |
| 同 Mesh TaskPackage 直送 | 活动弹窗的接收确认、交接任务的目标设备选择 | `task.package.transfer.v1` 复用标准密文包与分块续传；`task.package.receive` 独立授权并逐次确认 | 代码纵向与 UI 路径已实现：目标设备公钥独占 envelope、完整密文哈希、逐消息 feature/capability 复核、consumed ledger、TTL/拒绝/撤权/错误清理和同密文便携回退均有安全定向测试；来源设备 ID/名称是认证传输事实，来源 Agent/交接人是包内声明。Electron E2E runner 尚未发送 TaskPackage，物理双机数据面仍开放 |
| 会话身份 | Codex 根 thread、压缩检查点、guardian/subagent rollout | 一条用户逻辑会话对应一行，物理文件与内部执行单独分类 | 第一批已实现；父缺失的内部记录也不提升为用户会话 |
| 状态 | 活动弹窗、额度详情、Footer 全局状态 | 提醒路径异常、显示本地活动和官方可得额度；Footer 显示今日账本与提醒总开关 | 保留；持久告警只进入活动弹窗，额度才使用右下详情，二者都不占页面行或庭院气泡 |
| 猫猫庭院 | 顶部 Agent 面板内的庭院/卡片分段、排行、场景 Popover | 同一账号/会话数据的可视化 | 保留；两种模式共用选择，时间/天气进入 Top Layer，拖放只打开账号、聚焦会话或保存位置 |
| UI 样式系统 | `workspace.css` 分层与 legacy 降级 | 统一几何、组件、主题、隐藏语义和 Presenter 边界 | 已实现；Agent 卡固定 164px，少量卡左对齐不拉伸，5+ 由名册独立横向滚动；有效历史活动时间正常显示，混合远端证据标为本机或未知，额度只展示本机新鲜且来源一致的可信值，冲突明确标出 |
| 路径与诊断 | 路径、诊断、位置 | 配置数据根、检查安装候选/权限、打开本地目录 | 保留；不改写会话源文件 |
| 工具维护 | 顶栏“工具” | 发现、打开并显式维护固定目录内的桌面 App/CLI | 保留；不接受界面传入任意命令 |
| 本地持久化 | profiles.json、settings.json 及备份 | 保存账号、界面设置、猫位置和今日账本 | 保留；原子写入，账号空列表是有效状态 |
| 应用更新 | Header“设置”弹窗中的“更新” | 检查可信 Release，支持的平台校验后替换 | 保留；正式 macOS 包仍需签名和公证 |
| Electron 成品完整性 | 打包脚本与独立 verifier | 强制 `app.asar`、禁止 `default_app.asar`，流式复算每个文件的整文件/分块哈希，核对五项 fuse 及 macOS/Windows header 绑定 | 已实现；当前 macOS unpacked 的 118/118 个常规文件已通过。该证据不等于签名、公证、三次首次使用或可分发 DMG |
| 成品首次使用 smoke | `accept:packaged` | 同一确切 `AgentDesk.app` / `win-unpacked` / portable 在一次性 userData 连续三次启动，验证首次初始化、恢复完成、完成后重启、零默认 Profile/远端连接与清理 | 脚本和 macOS/Windows CI 门禁已实现；本机现有确切 `release/mac-arm64/AgentDesk.app` 已在 ad-hoc 签名预检后，使用真实语义开关 `--macos-ci-mock-keychain` 和逐次 Browser 原生开关绑定通过三次启动。新的 GitHub macOS `main` CI 运行仍待结果；该记录不证明系统 Keychain/OS 密钥保护、Developer ID/公证、Draft/公开重下载或物理干净机 |
| Preview 发布事务 | 受保护 Preview Tag | 精确三资产先建 Draft，两个原生系统重下载复验，再发布并无 token 匿名重下载；失败回 Draft，公开过的候选不可复用 | 代码已实现，发布安全 14/14；`stableAllowed=false`。真实签名凭据、受保护环境和真实 Tag 尚未执行，当前没有公开 Preview |
| Personal Mesh 身份与设备 | 顶栏“设备”、添加设备、权限、撤销 | 建立系统保护身份、一次性加密配对、设备权限与可删到零的成员目录 | 代码已实现；LAN 临时入口、签名成员事件和撤销防复活均有自动化 |
| 全局 Agent 目录与跨设备库存 | 设备 Lens、设备“查看会话”、Agent/会话列表、远端“重扫” | 签名事件目录独立同步长期员工；设备库存只同步来源 Slot/会话，先展示单目标缓存再按需刷新 | 代码已实现；精确协商 `catalog.events.v1` / `catalog.snapshot.v1` / `inventory.device-facts.v1`。目录无固定主机，按来源向量补事件；并发字段自动收敛，关系事务受基线/缺口门禁，删除 tombstone 防旧端复活；0.9.4 走快照兼容，更旧端 inventory-only。现代 inventory 无 Agent/Binding/tombstone；进入明确远端只刷新该 `deviceId`，失败保留缓存；首库存落库前按 canonical Slot 改写会话；库存 4 分钟全快照保持，inventory revision delta 仍待演进 |
| 远端打开与有人准备 | Agent 面板主动作 | ready Deployment 用固定 `profile.launch`；没有 Slot 时用固定 `agent.prepare` 请求目标机有人值守准备 | 代码已实现；请求只含稳定 ID/受限枚举，安装、登录和系统权限留在目标机。确认排队前和允许后重读当前授权并绑定连接代次，撤权/断连/替换后的迟到允许不产生 Job |
| 会话信息发送 | “复制会话信息”旁的“发送到设备” | 发送内部 SessionPointer，目标端映射项目根 | 代码已实现；复制格式仍只有路径和坐标，离线只在发送端密文排队 |
| 文件传输 | 设备卡或发送弹层 | 显式选文件、接收确认、加密分块、校验和续传 | 代码已实现；Renderer 不提交来源或保存路径 |
| 传输草稿与历史 | SessionPointer 弹层、文件弹层、传输中心 | 会话引用与文件分别建草稿，历史只负责状态、重试和取消 | 已实现；不同 kind 关闭/重试不串状态 |
| 远程查看与控制 | 设备详情“查看”、右下详情内隔离 Remote Surface | 目标端逐次同意后查看屏幕、控制键鼠、切换显示器 | 代码已实现；返回释放输入并恢复此前详情，断开才结束媒体 |
| 多设备控制台 | 右下 Remote Surface 单屏/网格 | 最多四路、一个活动画质、唯一输入目标和公开网络统计 | 代码已实现；切换/断线/撤销均释放按键 |
| 公网会合与诊断 | 设备“网络设置”“连接诊断” | HTTPS 信令、STUN、短期 TURN、LAN/直连/中继状态 | 代码已实现；服务端可自托管，不接收业务内容；真实 NAT/coturn 待物理验收 |
| UI 上下文 | Device Lens、Agent、Slot、focus/checked、副本、设备详情、全局弹窗、远控、传输草稿 | 保持每种对象和动作目标独立，并提供原子导航 | 已实现；`utilityDialog` 不写入 workspace/detail，render/filter 无选择副作用 |
| 自动化与真实窗口验收 | `npm test`、`npm run accept:ui`、双端 E2E | Node 领域/安全回归、临时 userData 的 21 条真实窗口路径、局域网与本机 signaling 两种隔离双端链 | Node 526 项中 525 通过、1 项仅 Windows 跳过、0 失败；TaskPackage 安全 25/25、发布安全 14/14、UI 21/21。两种 E2E 均完成既有认证数据面，但 runner 未发送 TaskPackage；这些本机证据不替代物理设备 |
| 物理双 Mac 局域网库存 | 两台实际 Mac、host/UDP DataChannel | 设备证书认证、目录、大库存、显式刷新、4 分钟全快照与短时稳定 | 已验证窄范围：562,009 字节、9 Slot、638 SessionReplica、revision 7 → 8 → 9、5 分钟稳定；远控、断网/睡眠、公网 NAT/TURN 和 Windows 不在该证据中 |

## 3. 会话复制的唯一契约

单选和多选共用一个“复制会话信息”动作。每条记录只输出：

```text
路径: <projectPath；没有时使用 filePath>
坐标: <filePath>#<稳定会话 ID>
```

多选只增加 `1.`、`2.` 的顺序编号。剪贴板内容不得加入：

- 标题、账号、客户端、状态、模型或时间；
- 摘要、背景、进度、下一步、优先级；
- “请继续”“请接手”等提示词；
- 角色话术、交接对话或任何 prompt 模板。

人如何描述目的、让谁继续、下一步做什么，由人复制会话信息后自行表达。

## 4. 明确不做

- 内嵌聊天、终端或 Agent 对话进程执行；官方桌面客户端的监管只用于 AgentDesk 自己启动的 Profile 生命周期和磁盘安全；
- 任务队列、并行/串行编排、优先级计划；
- 多会话合并、自动上下文拼接、自动交接清单或持续交接编排；
- 规划文档、任务材料索引、自动总结；
- 任意命令、自定义协议 Agent、凭据托管；
- 云端 transcript 同步或静默更新第三方工具。
- 团队/组织协作、凭据同步、通用远程 Shell 或任意命令执行。

## 5. 细节审计结论

### 已收敛

- “复制标识”“复制项目”合并为“复制会话信息”。
- 详情里的线程 ID、文件、会话标识三处重复信息合并为“坐标”。
- 恢复轻量多选，但其状态只服务复制/发送定位信息等明确动作，不恢复旧交接功能或任务状态。
- 默认账号、独立账号和最后一个账号使用同一删除规则；schema v6 保留 suppressed Slot 目录外键可空并新增员工运行模型与签名目录事件，三种删除范围关闭重开后不复活，零 Slot/零 Binding Agent 仍长期存在。
- “删除后不补回”和“全新存储真实为空”已经收敛：缺失 `profiles.json` 时权威值为 `[]`，不会预置 Claude、Codex 或 Kimi；既有 Profile 先进入选择性无损迁移预览。首次向导只在完成页实际展示后按版本记账，重启恢复不重复造 Agent、设备或 Slot。
- Codex 使用用户根 `session_id` 作为列表身份；压缩不新增行，guardian/subagent 默认隐藏。
- Device、AgentIdentity、AccountBinding、AgentBlueprint、AgentDeployment、ProvisioningJob、AgentSlot 和远端库存已进入独立 Mesh 存储；v6 升级前的 `VACUUM INTO` 回滚点包含已提交 WAL 并经过版本/完整性/外键校验。同账号跨设备/形态不重复、同机多账号不误合并。签名 catalog 事件与来源设备 inventory 已按精确 feature 分离：普通字段并发自动合并，同字段稳定收敛并留审计，关系事务受 revision/因果缺口门禁，删除后旧 Slot、旧快照和并发旧编辑不能复活同一 ID；0.9.4 快照和更旧 inventory-only 路径安全降级。`inventory.read` 不再能提交目录 tombstone、覆盖 Binding 或裁剪零 Slot 员工。明确远端 Lens/设备“查看会话”已收敛为缓存优先、单目标按需刷新，启动/all 不 fan-out，失败不丢离线快照。首库存落库屏障、4 分钟全快照恢复基线和持久化前 canonical Slot 会话投影已经补齐，强会话按 canonical Binding 折叠，弱会话/replica 稳定，tombstone/suppressed 不留旧会话。
- 已就绪远端打开和有人值守首次准备已接入固定语义；准备确认绑定原连接，并在产生副作用前重新核对当前设备与授权，撤权、撤销、断连或替换后的迟到允许不能启动本机 Job。
- Mesh 可以配对、授权、撤销和显式重置；最后一台远端设备及最后一个 Agent/Slot 均允许删除到零，不会按平台复活默认 Agent。
- 会话副本只在强身份成立时折叠，动作始终落到确切 replica；压缩与 internal-child 不增加用户会话行。
- SessionPointer、文件、屏幕与输入分别授权；“发送到设备”没有发展成第二套复制格式或交接模板。
- TaskPackage 与 SessionPointer 分开：前者是用户人工补齐的一次不可变工作快照，后者只是在同一 Mesh 中发送位置。加密包隐藏业务元数据、逐项校验、只显示一次解锁码；Codex 原生导入不覆盖同 ID 异内容，标题标注来源，来源会话与文件不自动删除。
- 同 Mesh TaskPackage 直送与便携文件复用同一个不可变密文快照和导入验证路径。接收能力、逐次接受、目标设备公钥独占 envelope、密文哈希、重放墓碑、TTL/清理和失败后的同密文便携回退已经进入代码及安全自动化；认证来源只到设备 ID/名称，来源 Agent 名与交接人仍是包内声明。
- 远控媒体独立于普通 Main Renderer，视觉上只替换右下详情；目标端持续可见并可立即停止，多设备模式始终只有一个输入目标。
- 公网信令只转发固定配对和 offer/answer，TURN 凭据短期存在内存，诊断不显示 IP、SDP 或凭据。
- Agent、Device Lens、Slot、Conversation、SessionReplica 与 `utilityDialog` 的 UI 上下文已经拆开；四个全局弹窗和设备详情导航都不会再用旧 Profile 状态静默改写底层工作台或动作目标。
- 设备、工具、活动、设置的 Shell 已统一：关闭始终在顶部且为中性操作，工具/活动/设置不再用底部“完成”；Content 是唯一普通纵向滚动区，设备仅保留两个命名窗格滚动例外。
- 帮助、传输记录、网络、权限与诊断使用父子弹窗栈；Esc 只关闭最上层，返回时恢复父层滚动、菜单和触发焦点。网络设置读取结束后入口恢复 enabled。
- Agent/Binding/Slot 对象管理、焦点/勾选生命周期、多副本显式来源、独立传输草稿、远控返回/断开语义，以及 1–2 个 Agent 固定卡宽和 7+ Agent 横滚/信息带几何已经通过行为测试与真实窗口任务验收。

### 后续仍值得逐项处理

- `isProtected` 是历史字段名，现在只表示系统默认路径形态，应迁移为不含“保护”语义的命名。
- README 截图仍是旧界面；本轮已经生成真实窗口验收截图，正式发布前再选择稳定数据重新截取公开素材。
- “刷新会话”“刷新额度”“检查工具”“检查更新”需要持续保持动词和作用域清晰。
- 诊断文本包含较多本机路径，公开粘贴前应提供隐私提醒或脱敏选项。
- 大目录扫描目前缺少耗时和局部失败摘要，路径问题仍可能只表现为“没有会话”。
- 双 Mac 局域网大库存、显式刷新和当前 4 分钟全快照恢复基线已经有窄真机证据；长连接可达性/断网与睡眠恢复、真实家庭 NAT/CGNAT、coturn UDP/TCP/TLS、远控媒体/输入，以及 macOS/Windows 四向权限、DPI 和 IME 尚未完成验收。当前定向验证环境也未配置或验证长期可达的公网 signaling endpoint。这些开放项是发布门禁，不是用更多本机模拟测试可以替代的功能描述。
- 无人值守仍未获 Phase 9 单独批准；当前不能把 portable 有人值守端写成开机服务、锁屏控制或登录界面控制。
- 同 Mesh TaskPackage 已有代码纵向与 UI 状态投影，但隔离 Electron E2E 尚未发送 TaskPackage；物理双机直送/接受/拒绝/撤权/断线恢复、真实公网 NAT/TURN、Windows 文件句柄与清理矩阵，以及跨 Mesh 身份确认、更多客户端原生导入和客户端精确聚焦仍需后续验收或实现，不能写成完整 P2P 迁移已经交付。
- 当前候选为 `0.10.1-preview.1`；历史 `0.10.0` 不补发为稳定版。发布事务代码和 14/14 不表示 Release 已产生：真实签名/公证、受保护 `preview-release` 环境、真实 Tag、匿名公开重下载、浏览器 quarantine、Windows MOTW/SmartScreen/Defender/UAC 与物理干净机首启仍未完成，因此当前没有公开 Preview。

这些项不应通过新增模板、更多复制类别或新的编排层解决。
