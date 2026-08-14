# AgentDesk 产品定义

## 一句话

AgentDesk 是一个本地优先的个人 Agent 控制台：它整理 AI 编码客户端的账号槽位、逻辑会话、额度和工具，并可把同一个人的这些 Agent 与会话扩展到多台可信设备。

当前 `0.10.1-preview.1` 开发版已经贯通有人值守 Personal Mesh 的代码链路：版本化首次使用、双方身份确认的设备任务向导、长期存在的全局 Agent 员工库、Blueprint/Deployment/可恢复首次准备、跨设备会话库存、会话信息发送、选定文件传输、便携与同 Mesh TaskPackage、远程查看、键鼠控制、多设备控制台，以及局域网优先、签名信令回退、STUN/TURN 配置和连接诊断。TaskPackage 从一条本机会话固定人工阶段检查点、原生会话或只读内容、Git 基线与已跟踪差异和明确附件，生成可跨 Agent、设备或人与人传递的同一种加密快照；它可以保存为便携文件，也可以在目标设备已认证、协议与权限满足时直接发送。接收方先接受并验证，再选择目标 Agent 与运行位置，来源副本保留。Codex 已支持根会话与内部记录原生导入，其他已有 Markdown 导出能力的客户端先保存只读内容。Agent、AccountBinding、AgentSlot 的新增、归属、合并、拆分和三种删除范围已经进入真实语义 IPC；已就绪远端可固定语义打开，未就绪远端只可在 `agent.prepare` 授权与目标端有人确认后准备。Device Lens、Agent、Slot、会话焦点/勾选、副本来源、全局弹窗、远控会话和传输草稿使用独立 UI 上下文。主窗口已收敛为一个 Header、顶部 Agent、左下会话、右下统一详情三个固定面板和一个 Footer，并冻结 58px Header、244px Agent 面板、316px 详情与 38px Footer；Compact 表格在左面板单屏完整显示。顶部使用“庭院 / 卡片”当前模式分段，卡片固定为 164px、少量时左对齐，卡内下方显示最近活跃与可信额度摘要；运行位置始终可见，场景时间/天气进入 Top Layer Popover，原七项菜单进入“全局 Agent / 当前运行位置”对象 Dialog。设备、工具、活动、设置各自打开独立弹窗，右下只承载会话、额度和隔离远控，会话动作归右下详情底部动作坞，Footer 只显示全局状态、今日账本和提醒总开关。自动化与真实窗口证据以本文末尾当前测试结果为准。物理双 Mac 已完成局域网认证通道和大库存/刷新这一项窄验证；TaskPackage 物理直送、长期可达与断网恢复、真实公网 NAT、coturn 强制中继及 macOS/Windows 四向权限矩阵仍是公开发布前验收，不能把局部证据写成整个物理矩阵完成。

文档分工保持清楚：本文记录当前产品事实，`FUNCTION_AUDIT.md` 记录功能状态和剩余缺口，`AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V4.md` 是面向使用者的多 Agent / 多账号 / 多设备说明，`PERSONAL_AGENT_MESH_PLAN.md` 是获批后的实施权威与阶段门禁。说明文章中的目标态不能替代当前状态和真机验收结论。

## 当前事实与证据层级

| 层级 | 当前结论 |
|---|---|
| 代码 | 版本化首次使用、设备任务向导、便携与同 Mesh TaskPackage 已接通 Renderer、Preload、Main、领域和服务；“代码存在”不等于发布门禁关闭。 |
| 本机自动化 | 全量 Node 490 项中 489 通过、1 项仅 Windows 跳过、0 失败；TaskPackage 安全 25/25，首用/向导/配对/Main IPC/TaskPackage UI 相关定向 47/47，真实 Electron UI 21/21。直送窗口证据只覆盖资格、阶段投影与明文码不进入 Renderer。 |
| 隔离双 endpoint | 局域网直连与本机 signaling E2E 均完成认证、目录/库存、刷新、SessionPointer、184,333 字节文件和合成远控画面；runner 尚未发送 TaskPackage，不能据此声称直送数据面已验。 |
| 物理双 Mac | 同一局域网 host/UDP 认证 DataChannel 已完成 562,009 字节库存、9 个 Slot、638 条 SessionReplica 落库；revision 7 → 8 → 9，连接连续 5 分钟稳定。该证据只关闭大库存、显式刷新与当前 4 分钟全快照恢复基线。 |
| 开放门禁 | TaskPackage 物理双机直送、真实公网 NAT/CGNAT、coturn UDP/TCP/TLS、断网/睡眠恢复、macOS/Windows 四向屏幕/输入/权限/DPI/IME、Windows helper/portable 真机仍未关闭。 |

发布口径：当前源码版本 `0.10.1-preview.1` 是 Preview 候选，不是稳定版，也不把 `0.10.0` 开发基线补发为稳定版。开放门禁关闭前，安装产物必须签名、公证并明确标记为 Preview。

## 核心对象

| 对象 | 含义 | 示例 |
|---|---|---|
| 客户端类型 | 数据格式和启动方式 | Claude、Codex、Cursor、Kimi |
| 账号槽位 | 一份独立本地数据目录 | 工作 Codex、个人 Claude |
| 身份组 | 同一登录在不同客户端形态中的归组 | Codex Desktop + Codex CLI |
| 历史会话 | 本地已有的会话记录 | 某项目的一条 Codex thread |
| 工具记录 | 已知桌面 App / CLI 的安装与版本状态 | Homebrew 安装的 Codex CLI |
| TaskPackage | 用户显式固定的一次工作交接快照 | 会话 + 阶段说明 + Git 检查点 + 明确附件 |

这些对象不能混为一谈。历史会话是可浏览记录，不是待执行任务；工具记录是安装状态，不是聊天连接。

Personal Agent Mesh 稳定区分全局 AgentIdentity、实际登录 AccountBinding、设备 Device、运行位置 AgentSlot、逻辑会话 ConversationIdentity、SessionReplica 和物理会话记录。Agent 是全局管理主轴，设备是筛选轴，具体动作最终落到明确的 `deviceId + profileId` 和会话副本；同一账号出现在多台设备不会因此重复生成 Agent。

## 用户主流程

1. 选择长期存在的 Agent 员工和当前工作环境；没有运行位置时点击“首次准备并打开”，已有 Deployment 时直接打开。
2. AgentDesk 只在受管 staging 中创建白名单配置；安装、登录、验证码和系统权限仍在目标设备与官方 App 内完成，验证成功后才原子提交 Profile/Slot/Deployment。
3. 以“当前 Agent / 全部 Agent”浏览本机或当前 Device Lens 下的会话。
4. 搜索、排序并查看一个会话的元数据。
5. 单击一行只聚焦详情；显式勾选后形成批量动作集合。两者都使用统一的“路径 + 坐标”，并在多副本时先明确来源，再复制、发送、定位或导出。
6. 一整项工作需要换 Agent、换设备或交给另一个人时，从聚焦会话选择“交接任务”，人工补齐阶段检查点并生成加密 TaskPackage；接收方从“活动”验证、选择目标运行位置并导入。
7. 从各自独立弹窗查看设备、工具、活动和设置；从右下详情查看额度。
8. 从工具弹窗检查、打开或显式维护本机应用与 CLI。
9. 按需从顶栏“设备”建立个人设备网，用一次性配对码加入另一台自己的电脑，并按“全部设备/某台设备”查看去重后的 Agent 和会话；进入明确远端设备时先看已落库快照，再只对该目标按需刷新。
10. 在右下会话详情底部动作坞对明确选中的会话使用主操作“复制会话信息”，或用次级动作把内部 SessionPointer 发送到另一台设备；需要时再显式选择文件发送。
11. 在目标端逐次同意后，在右下统一详情面板的隔离远控工作区查看或控制一台到四台设备；其他两个面板和 Header/Footer 保持原位，且始终只有一个当前输入目标。

## 能力范围

### 账号与身份

- profile/session 路径可自动推断或手动设置；
- 受支持的桌面 App 使用所选 profile 启动；
- 同一登录可通过手动 identityKey 或本地指纹归组；
- Windows 支持传统安装与 Store/MSIX 路径；
- 配置使用本地 JSON、原子写入和备份。

### 会话历史

- 支持 Claude Desktop、Claude CLI、Codex、Cursor、Kimi Code、Kimi Work；
- 支持与 Device Lens 正交的当前 Agent/全部 Agent 范围、精简/详细列、搜索和排序；
- 支持只服务定位动作的临时多选；复制与 SessionPointer 发送使用同一确切副本集合，不产生持续任务状态或自动交接编排；
- Codex 按用户根 thread 形成逻辑会话；上下文压缩不增加列表行，guardian/subagent 等内部 rollout 默认隐藏；
- 右侧详情是单会话视角；
- 来源允许时可定位文件或导出 Markdown；
- 扫描与浏览不修改会话源文件。

### 任务交接

- 聚焦一条本机会话后可显式生成 `.agentdesk-task`；它是一次不可变检查点，不是持续任务队列或自动同步关系；
- 检查点中的目标、已完成、下一步、阻塞/风险和验收标准由人填写，系统不从会话自动猜测；
- Codex 包含可验证的根会话与所属内部记录；Claude CLI、Kimi Code、Kimi Work 等已有导出能力的来源先携带只读 Markdown；
- 可选项目现场记录 Git remote、branch、HEAD、工作树状态与已跟踪差异；未跟踪文件正文只有被明确选为附件时才进入包；
- 包使用流式 AES-256-GCM 与一次性高熵解锁码，外层不明文暴露标题、Agent、项目或文件名；解锁码只显示一次，不进入包或历史；
- 接收端先解密和逐项校验，再选择本机 Agent/Profile 与资料目录；同 ID 异内容拒绝覆盖，导入失败回滚；
- 来源会话和文件始终保留。跨人或跨 Mesh 通过用户选择的便携文件通道交换；同 Mesh 目标同时满足认证连接、`task.package.transfer.v1` 和 `task.package.receive` 时，可以发送同一标准密文快照。接收端逐次接受，完整密文哈希通过后才解封并进入共同导入；失败或旧端可保存同一快照为便携文件。
- 直送卡片中的来源设备 ID/名称来自认证传输事实；来源 Agent 名与交接人标签是包内声明，不等同于目录认证身份。

### 额度与活动

- Codex 通过本机官方 app-server 获取额度；
- 结果按账号缓存，失败可降级到 stale/error；
- 无可靠来源的客户端显示 unsupported；
- 活动和额度是两条独立信号，庭院不会用额度伪造工作状态。
- 路径、额度等持久待处理事项只进入 Header 的“活动”弹窗；庭院只保留 Agent、场景和短暂直接反馈，不形成第二个活动面。

### 工具维护

顶栏“工具”打开独立维护弹窗，提供固定目录中的桌面 App、CLI 和系统终端：

- 发现安装状态、本地版本与安装来源；
- 查询受信任的 npm、Homebrew 或 GitHub 最新版本；
- 打开桌面 App、系统终端或已发现的 CLI；
- 对识别到且可写的 npm/Homebrew/uv/自身更新器安装执行显式更新；
- 无法安全自动维护时只打开官方页面。

CLI discovery 是只读能力：只解析启动器，不附加工作参数，不建立连接或会话。

### Personal Mesh（有人值守开发版）

- 全新用户可在“创建第一个 Agent”时一并建立仅限本机的 Agent 目录与设备身份；设备中心保留同一事务的高级入口。两条入口都不自动开放网络、发布在线租约或连接其他设备；
- 全新用户从“创建第一个 Agent”开始，本机目录与设备身份在同一受控事务中建立，网络登记保持关闭；已有 Profile 先进入无损迁移预览。缺失 `profiles.json` 是真实空状态并原子保存为 `[]`，不生成默认 Claude/Codex/Kimi Profile；未展示完成页前不提前记录向导完成版本，应用重启后可继续审阅。
- “添加设备”按身份确认、成员信任、认证连接、目录落库、库存落库和可以使用分步呈现。加入端先检查邀请并确认来源指纹，邀请端先确认申请设备身份，任一侧未确认时都不签发成员证书；“接收连接 30 分钟”只保留为高级恢复。
- 本机生成 Mesh Root 和设备 Ed25519 密钥，私钥经 macOS Keychain / Windows DPAPI 对应的 Electron 系统密钥保护加密；
- 设备、AgentIdentity、AccountBinding、AgentBlueprint、AgentDeployment、ProvisioningJob、AgentSlot、签名目录事件与 tombstone 写入独立 `mesh.db`，不污染 `profiles.json`；当前 schema v6 保留 v4 的 nullable suppressed Slot 语义，并在升级前生成包含已提交 WAL、经版本/完整性/外键校验的 `pre-v6` 回滚点；
- Agent 是长期员工：删除最后一个 Slot、Deployment 或 AccountBinding 都不会删除 Agent；每个工作环境始终投影完整员工库，没有 Slot 时显示首次准备，只有显式“删除 Agent”才产生目录 tombstone；
- 同一强账号标识的多个客户端形态归为一个 Agent，同机不同账号保持独立，跨平台只接受用户已有的显式身份关联；
- Profile 换号时 Slot 标记为 `identity-changed`，不把旧会话静默改归新账号；
- 新增入口明确区分“新 Agent / 新账号绑定 / 本机新运行位置”；合并 Agent、拆分 AccountBinding、移除运行位置、移除登录账号和删除 Agent 均展示对象范围，并由 Main 按 revision 重新校验；
- 删除运行位置、实际登录账号或整个 Agent 后，suppressed Slot 与 tombstone 会持久化到 SQLite；关闭并重开后仍保持删除结果，最后一个 Agent 也可删除到零，不按 Claude、Kimi 或其他平台补默认 Agent；
- 用户可让本机离开并重置 Mesh，重置只清除设备身份、密钥和 Mesh 缓存，不删除账号槽位、官方客户端数据或会话；任意远端设备和最后一个 Agent 都可删除；
- 一次性配对码使用设备签名、邀请 secret proof、X25519、HKDF 和 AES-256-GCM；设备权限、成员事件和撤销均由本地信任链验证；
- 全局 Agent/AccountBinding/Blueprint/tombstone 以无固定主机的签名目录事件为权威：握手交换来源连续向量，只补缺失事件，转发仍保留原始设备签名。双端并发修改不同字段自动合并，同字段稳定收敛并留审计；关系事务在 revision 过期或因果历史不完整时停止，删除永久压过旧库存、旧快照和并发旧编辑，同名重建使用新 ID；
- 握手把危险权限与线协议 feature 分离，只协商精确白名单 `catalog.events.v1` / `catalog.snapshot.v1` / `inventory.device-facts.v1`，并刷新当前 appVersion 等运行元数据。0.9.4 旧端继续走安全快照兼容，更旧端降级为 inventory-only，不接收未知目录消息；目录权限不对称显式跳过目录屏障，不会拖垮 `inventory.read`；
- 设备库存只允许来源设备写自己的 Slot 和会话副本；新连接在首份完整库存事务落库后才报告可用，已认证连接重新连接或显式“重扫”会通过固定 `remoteInventory:refresh` 请求新快照，并在连接存续期间每 4 分钟发布一次有界全量恢复快照；库存收发重读当前 `inventory.read` 权限，撤权立即终止现有连接，显式刷新按连接单飞、节流并限制等待队列；
- 现代 `inventory.device-facts.v1` 快照不携带全局 Agent、AccountBinding 或 tombstone；旧端兼容投影仅在接收端当前具备 `catalog.manage` 时增补本地未知对象，不能覆盖既有关系、提交删除或裁剪零 Slot/零 Binding 员工；
- 进入一个明确远端 Device Lens，或从设备中心查看该设备会话时，先渲染已落库缓存，再只对这一设备按需走固定刷新；应用启动、本机 Lens 和“全部设备”不 fan-out。无认证连接、临时 LAN 或已配置可达 signaling 路由时，刷新失败但保留离线快照，不冒充已同步；
- 远端库存会话在落库前按接收端 canonical Slot 改写 Agent/AccountBinding：强会话使用 canonical Binding 重算 `conversationId`，弱会话继续使用来源设备作用域并保持 `conversationId`/`replicaId` 稳定；tombstone 或 suppressed/unassigned 已排除的 Slot 不会以旧会话残留。同一强账号键归并，同一强会话键折叠，弱标识不按名称、路径或时间猜测；
- “复制会话信息”仍只输出路径与坐标；“发送到设备”传输端到端加密 SessionPointer，离线时只在发送端本机密文队列等待；
- 文件必须由发送端系统选择器选取、接收端明确选择保存目录，采用分块、哈希、背压和断点续传；
- 控制端 Remote Surface 是右下统一详情面板内的独立沙箱 WebContentsView，目标端 Host Consent/Indicator 仍是本机专用沙箱提示窗；`screen.view`、`input.control` 除持久权限外还需要目标端本次同意；
- 多设备控制台最多四路，只有当前设备使用活动画质，后台设备降为低频缩略图，输入切换前释放上一设备全部按键；
- 已就绪远端只接受 `requestId + agentId + profileId` 的固定 `profile.launch`；首次准备只接受 Agent 与受限客户端枚举。目标端确认排队前、用户允许后且产生任何副作用前重新读取当前设备/权限并核对原连接代次，撤权、撤销、断连或连接替换后的迟到允许不能创建 ProvisioningJob；
- 局域网连接只在用户临时开放时监听；公网会合使用签名短租约，公开地址要求 HTTPS，TURN 长期 secret 只留在服务端，桌面只在内存持有短期凭据；
- 设备诊断只显示服务状态、候选类型、传输协议、LAN/直连/中继和权限，不显示 IP、SDP、完整密钥或 TURN 凭据。
- 主 Renderer 的 Device Lens、Agent、Slot、focused/checked 会话、SessionReplica、`utilityDialog`、设备详情、活动远控和两类传输草稿彼此独立；打开或关闭全局弹窗以及 render、搜索、刷新都不会自动选择第一项或静默改写动作目标。
- 卡片名册会显式重置通用按钮的 32px 高度、inline-flex 和不换行规则；卡宽固定为 164px，1–4 个 Agent 左对齐而不均分拉伸，5 个以上由名册自身横向滚动，选中远端卡片会自动露出。卡内下方只复用既有缓存：最近活跃的有效历史时间正常显示，缺失/不可解析/仅远端未同步时显示未知，混合来源只把已知时间标为“本机活跃”；额度只接受本机、成功、新鲜、未过重置点、provider/source 匹配且同一登录来源一致的快照，其他情况显示未知，冲突明确显示“来源不一致”，不伪装为休息或 0。

当前开发版不包含无人值守、远程 Shell、任意命令、服务端业务邮箱或自动任务调度。当前定向验证环境没有配置或验证长期可达的公网 signaling endpoint，隔离 Electron E2E 也尚未发送 TaskPackage；虽然双 Mac 局域网库存链路已有窄真机证据，公开稳定版前仍需完成 TaskPackage 物理双机直送与恢复、长连接/断网恢复、真实公网和跨平台网络/权限矩阵。

## 明确边界

下列能力不属于 AgentDesk：

- 内嵌终端或统一聊天壳；
- 启动、监督、恢复 Agent 对话；
- 把多会话选择扩张为优先级安排、上下文拼接或自动交接编排；
- 任务队列、自动串行/并行工作流；
- 规划文档、任务材料或聊天上下文挖掘；
- 自定义可执行命令或协议接入；
- provider/API key 路由、token 托管；
- 自动 transcript 同步、自动删除来源或把完整 transcript 上传云端；
- 团队、组织、多人设备共享和审批流；
- 通用远程 Shell、任意命令执行和凭据托管。

Personal Mesh 只能同步必要的目录与只读索引、显式发送会话信息或文件，并在单独授权后提供查看/控制；它不能成为绕过本机安全边界的第二条通道。

产品增加新功能时，若它需要持有一个“正在运行的会话”或把一个历史会话变成待执行任务，应视为越界，先重新讨论产品定位。

## 安全原则

- 密码、token、浏览器 Cookie 不进入 AgentDesk。
- Renderer 不持有 Node、文件系统或通用进程能力。
- 主进程对 ID 重新查表，不接受 renderer 提供的任意 executable、argv、环境变量或 URL。
- 会话来源只读；导出写入用户通过原生保存框选择的位置。
- TaskPackage 只在用户显式操作后读取一条可信本机会话；文件和附件路径来自 Main 的原生选择器。导入先验证加密、清单、整包与逐项哈希、适配器与冲突，再写入目标；解锁码不持久化。直送解锁材料只进入目标设备公钥独占并绑定 Mesh、来源/目标、transferId 与包哈希的 envelope，不使用 Mesh link key，也不进入 Renderer、历史或日志。
- 工具更新由用户明确触发，只使用固定目录生成的计划，不调用 sudo。
- AgentDesk 自更新必须校验 Release 元数据和 SHA-256；正式 macOS 包必须签名、公证并通过 Gatekeeper。
- Mesh 私钥不进入 Renderer、日志或普通数据库；设备 IPC 只接受固定 ID 和有界名称，不暴露通用 channel、命令或路径。
- WebRTC 传输加密不能替代设备认证；offer/answer 只能通过双方共同登记且持有有效租约的信令服务交换，消息不能指定任意回复 URL。
- 远程输入只通过固定键鼠事件协议进入原生 helper；断线、失焦、切换目标、撤销和紧急停止都会释放按键。

## 产品完成标准

- 多个账号槽位可以稳定打开且不会被配置并发写坏。
- 所有支持来源的会话能统一浏览，单个坏文件不会阻断整个扫描。
- 同一 Codex 根会话无论发生多少次上下文压缩都只保留一行，内部子 rollout 不冒充用户会话。
- Windows 和 macOS 的真实路径、启动候选与失败原因可诊断。
- 工具中心能准确区分缺失、已安装、可更新和仅能打开官方页。
- UI、IPC、依赖和文档中不再存在会话执行或编排入口。
- 1040 × 840 窗口稳定保持 58px Header、244px 顶部 Agent、左下会话、316px 右下详情与 38px Footer；Compact 无横向滚动，设备/工具/活动/设置各用独立弹窗且不改写底层工作台，场景 Popover 不被面板裁切，会话动作只进入右下详情动作坞，Footer 只保留全局账本/提醒状态。真实 Electron 21/21 覆盖既有三语/双主题和工作台任务，并新增全新首 Agent、重启恢复、设备向导 Shell 与直送资格/接收阶段投影；后两项不冒充物理双机向导或 TaskPackage 数据面 E2E。
- 已配对设备能交换去重库存；明确远端 Lens/设备“查看会话”先展示已落库快照，再仅刷新该目标，失败保留离线快照，启动/all 不 fan-out。首库存落库屏障、4 分钟全快照恢复基线与持久化前 canonical Slot 会话投影可防止旧 Agent/Binding、强会话分行或 tombstone/suppressed 会话残留，并把每个动作路由回确切运行位置和会话副本。revision 增量补齐仍按阶段计划继续演进，当前不把定期全快照描述成增量协议完成，也不把本机定向回归描述成物理双机或公网长期可达验证。
- 零 Slot/零 Binding Agent 可在重启和跨设备目录快照后继续存在；新旧协议互通或目录权限不对称时不会发送未知目录消息，`inventory.read` 也不能越权删除、改绑或复活全局目录。远端首次准备在确认期间撤权、断连或替换连接后不产生本机副作用。
- SessionPointer、文件、屏幕和输入都遵守独立权限、目标端同意、大小上限和失败清理。
- TaskPackage 的错误密钥、篡改、类型伪装、重复路径、容量越界、目标冲突和重复导入都会在写入前停止；直送逐消息复核 feature/capability，拒绝、报错、撤销、TTL 和便携回退都清理受控暂存。Codex 原生导入保留根会话与内部记录并标注包内声明的来源，打开客户端失败不会回滚已保存内容。
- 公网信令不可用时局域网和已建立连接不受影响；诊断能区分 LAN、直连和 TURN 中继。
- 双 Mac 局域网库存证据、真实 NAT/TURN、断网/睡眠恢复以及 macOS/Windows 权限矩阵分别记账；只有所有稳定版门禁通过后，才能把有人值守 Personal Mesh 标记为公开稳定版本。在此之前只能发布签名、公证且明确标记的 Preview。
