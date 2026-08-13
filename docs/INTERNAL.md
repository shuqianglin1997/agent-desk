# AgentDesk 内部结构

## 1. 当前职责

AgentDesk 是本地优先的账号、会话历史与工具维护器。它负责：

- 保存和启动受支持客户端的账号槽位；
- 只读扫描本地会话元数据；
- 定位或导出单个会话；
- 聚合活动状态与 Codex 额度；
- 诊断路径和安装；
- 发现、打开并在用户确认后维护固定目录中的桌面 App / CLI。

Personal Agent Mesh 的有人值守代码链路已经接入运行时：设备证书和配对、长期全局 Agent/Blueprint/Deployment/ProvisioningJob、独立签名目录、来源设备库存、SessionPointer、文件传输、远程查看/输入、多设备控制台，以及 LAN/签名信令/STUN/TURN。旧端协议 feature 降级、目录权限不对称、inventory 目录隔离和远端准备撤权竞态已有回归；独立 UI 上下文、目录对象管理和真实 1040 × 840 Electron 任务路径也已本机验收。两台物理电脑、真实公网 NAT、coturn 强制中继和跨平台权限矩阵仍未通过，因此当前是本机代码完成态而不是公开稳定验收态。

它不包含聊天 transport、Agent 进程生命周期、任务队列、多会话交接、规划资料索引或任意命令注册。

## 2. 进程边界

```text
Renderer
  └─ window.manager（preload 白名单）
       └─ Electron IPC
            └─ Main process
                 ├─ profile/settings JSON store
                 ├─ app/session scanners
                 ├─ diagnostics and quota
                 ├─ CLI discovery and tool maintenance
                 ├─ MeshService / mesh.db / OS-protected key vault
                 ├─ SignalingClient / PeerManager / TransferService
                 ├─ RemoteControlService / OS input adapter
                 └─ native shell/dialog/process APIs

Sandboxed peer renderer
  └─ RTCPeerConnection / fixed DataChannels

Sandboxed embedded Remote Surface + Host renderer
  ├─ WebRTC media and bounded input events
  └─ dedicated fixed IPC to Main

Optional Signaling Gateway
  └─ signed leases / long poll / offer-answer / pairing relay / short TURN credentials
```

- Renderer 没有 Node 能力，不直接接触文件系统或进程。
- BrowserWindow 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
- Preload 只暴露明确的方法，不提供通用 `invoke(channel, payload)`。
- Main 对 profile ID、session ID 和 tool ID 重新查表，不信任 renderer 提供的路径或命令。

## 3. 主要源码

```text
src/
  main.js                 Electron 生命周期、IPC 与可信系统操作
  preload.js              窄 IPC 桥
  renderer.js             UI 状态与交互
  ui-context.js           独立 UI 上下文与无副作用状态迁移
  index.html
  styles.css              低优先级 legacy 兼容样式
  workspace.css           1.14 固定工作台与全局弹窗 Shell 的 canonical 分层样式

  apps.js                 客户端目录、默认路径、扫描器与导出能力
  sessions.js             Claude / Claude CLI / Codex / Kimi 会话扫描
  agent-workspace.js      全局员工库在工作环境上的就绪投影
  mesh/domain/
    session-identity.js   Codex 物理记录、用户根会话与内部子分支分类
    device.js             Device 归一化与本机设备约束
    identity-link.js      规范编码与 Mesh 范围账号 HMAC
    agent-catalog.js      Agent/Binding/Slot 迁移、同步、换号和删到零
    agent-deployment.js   Blueprint/Deployment/ProvisioningJob 归一化与状态机
    inventory.js          来源设备事实、canonical 会话投影与强标识折叠
    session-pointer.js    会话信息内部结构与有效期
    project-mapping.js    目标端确认的项目根映射
    file-transfer.js      文件 manifest、命名和路径边界
    transfer-job.js       传输任务状态机
    remote-input.js       有界键鼠/文本事件与限速
    remote-stream-budget.js 多设备画质预算与公开统计
  mesh/protocol/
    handshake.js          成员证书和一次性设备握手证明
    pairing.js            一次性邀请码、X25519/HKDF 加密配对
    envelope.js           设备签名消息、TTL、sequence 与能力
    features.js           独立于权限的精确协议 feature 白名单与协商
    catalog.js            独立签名目录快照归一化、合并与 tombstone
    inventory.js          库存分块、摘要与重组
    secure-payload.js     SessionPointer/文件 payload 加密
    membership-events.js  成员权限、撤销和 revision
    signaling-auth.js     网关请求签名、TTL、nonce 与 URL 约束
  mesh/network/
    lan-endpoint.js       用户临时开放的 LAN 配对/连接端点
    signaling-client.js   在线租约、长轮询、配对和 offer/answer 回退
    ice-config.js         STUN/TURN 配置、合并与脱敏诊断
  mesh/storage/
    mesh-store.js         独立 SQLite 事务存储
    migrations.js         Mesh schema 迁移
    secure-keys.js        系统密钥保护的私钥封装
  mesh/main/
    mesh-service.js       初始化、配对、成员/目录、库存和公开投影
    peer-manager.js       设备认证、WebRTC 控制通道和库存同步
    provisioning-service.js 本机可恢复首次准备与原子提交
    agent-action-service.js 远端 profile.launch / agent.prepare 固定语义
    transfer-service.js   SessionPointer、本机队列与文件传输
    remote-control-service.js 远程查看、同意、媒体与输入会话
    webrtc-probe.js       隐藏沙箱 Renderer 生命周期与自检结果校验
  mesh/peer/
    index.html/peer.js    隐藏沙箱 RTCPeerConnection 与固定 DataChannel
  mesh/probe/
    index.html/probe.js   WebRTC SDP/ICE/DataChannel 本机真实自检
    preload.js            一次性固定结果通道
  remote/
    console.*             独立多设备控制台
    host.*                目标端逐次同意与常驻停止条
  cursor-sessions.js      Cursor SQLite 会话扫描
  kimi-work-sessions.js   Kimi Work 会话索引
  transcripts.js          支持来源的 Markdown 导出
  session-table.js        过滤与排序纯函数
  session-location.js     路径 + 坐标的最小剪贴板格式

  cli-discovery.js        只读 CLI 启动器发现
  tool-maintenance.js     固定工具目录、版本/安装源识别、安全更新计划

  identity.js             登录指纹
  identity-groups.js      同一身份的跨客户端归组
  activity.js             活动聚合
  quota.js                额度展示纯函数
  codex-quota.js          Codex 本机官方 RPC
  quota-service.js        并发、缓存和失败降级

  json-store.js           原子 JSON 写入与备份
  settings.js             设置归一化与迁移
  updater.js              AgentDesk Release 解析与校验
  windows.js              Windows 路径和安装发现

  yard/                   猫状态、能量、场景、氛围、拖放意图
  i18n/                   中文、英文、日文词表

native/
  macos/AgentDeskInputHelper.swift
  windows/AgentDeskInputHelper.cpp

services/signaling/       可自托管最小信令与 TURN REST 凭据服务

scripts/
  ui-acceptance.js        临时 userData 下的真实 1040 × 840 Electron 任务验收
```

## 4. 数据模型

### Profile

账号槽位保存在 `profiles.json`，主要字段包括：

- `id`、`appId`、`name`；
- `profilePath`、`sessionRoot` 及其 auto/custom 模式；
- 可选 `executablePath`、`identityKey`、`group`、`note`；
- 猫外观与创建/最近打开时间。

归一化保留未知字段，方便未来版本向前兼容。局部更新合并猫外观，不回写过期整表快照。

### Settings

`settings.json` 保存主题、语言、视图、会话范围/列视图、庭院时间和天气、提醒、今日账本、猫位置、HTTPS 信令地址和 STUN 地址。TURN 长期 secret、短期 credential、设备私钥和 Mesh 关联密钥不进入设置。写入使用临时文件替换并保留备份。

### Session

不同扫描器统一输出：

```js
{
  id,
  title,
  app,
  projectPath,
  filePath,
  createdAt,
  updatedAt,
  status,
  model
}
```

Renderer 会附加所属 profile 和账号组信息，但不会修改原始会话文件。

Codex 额外区分：

- `physicalRecordId`：扫描到的 rollout 物理记录；
- `adapterConversationKey`：用户根 thread 的稳定适配器会话键；
- `recordKind`：`conversation-root` 或内部 `internal-child`；
- `internalBranchCount`：已归到根会话下的内部执行数量，仅供诊断；
- `lifecycleConflict`：同一根会话同时在 active/archive 被观察到。

默认列表只接收 `conversation-root`。`id` 与 `address` 使用 `session_id || id` 得到的逻辑根键，active/archive 也按这个键去重。`parent_thread_id`、`thread_source === "subagent"` 或 `source.subagent` 任一成立时，该物理记录视为内部子分支；父记录缺失也不提升成列表行。扫描器仍只读文件首行，不为统计压缩事件遍历整份 JSONL。

### UI Context

`src/ui-context.js` 是 Renderer 的用户选择真相源，分别保存 workspace、Device Lens、每个 Lens 的 Agent 记忆、Agent scope、AgentSlot、focused/checked conversation、SessionReplica、设备详情、活动远控会话和 transfer draft。Renderer 另以 `utilityDialog` 表达设备/工具/活动/设置四个临时模态层；它不写入 workspace/detail，也不改变前述选择。系统不保存 `selectedProfileId` 兼容影子，也不在 render、filter 或 reconcile 中选择第一项。

- 行点击只更新 `focusedConversationId`，复选框只更新 `checkedConversationIds`；有勾选时动作集合使用勾选项，否则使用焦点。
- Device Lens、Agent 和 Slot 各自迁移；Slot 只决定副作用落点，不清空搜索或有效会话选择。
- 多副本在全部设备视角要求明确来源；具体设备 Lens 收敛为唯一副本时才可直接解析。
- SessionPointer 与文件发送使用按 kind 分离的草稿；关闭只清理对应 kind。
- 设备中心进入会话工作台使用原子迁移；设备详情选择不等于顶栏 Device Lens。
- 远控返回释放输入并保留 viewing 会话，disconnect 才终止媒体。

### 固定工作台与 CSS 层级

`src/workspace.css` 是 1.14 主窗口与全局弹窗的唯一 canonical 表现层，按 `reset / tokens / shell / components / features / themes` 组织；旧 `styles.css` 与 `yard/yard.css` 被放入低优先级 `legacy` 层，不能再通过文件尾覆盖改变三面板几何或弹窗滚动归属。最高主题层保留语义 `[hidden]` 规则，避免后写的 `display:grid` 把已隐藏视图重新显示。

- Renderer 内容区按 58px Header、38px Footer、12px 横向 padding、10px 纵向 padding、10px gap、244px Agent 面板和 316px 详情宽度布局；Compact 表 `min-width: 0` 且没有水平滚动。
- “庭院 / 卡片”是共用业务状态的当前模式分段；运行位置始终渲染，即使当前 Agent 只有一个 Slot。
- 场景时间/天气使用原生 Top Layer Popover；Agent 与运行位置管理使用原生对象 Dialog；设备、工具、活动、设置分别使用四个全局 Dialog。
- 四个全局 Dialog 使用 `utility-dialog-shell`：Shell 自身 `overflow: hidden`，Header/Command Bar/Footer 固定，只有 `utility-dialog-content` 纵向滚动；设备中心外层 Content 不滚动，只允许设备列表与设备 Agent 列表两个命名窗格独立滚动。
- `openChildDialog()` 为帮助、传输记录、网络、权限、诊断等次级流程记录触发控件和所属 disclosure；关闭或 Esc 只移除最上层，恢复父弹窗原滚动、菜单展开和焦点。只有明确导航工作台的动作才关闭根层。
- 像素样式只保留在 Canvas、猫、紧凑名牌等 Agent Presenter 内。应用按钮、表格、Footer 和弹窗统一使用组件 token。
- 会话行的 focused 与 checked 视觉落在真实 table cell 上，不向 `<tr>` 注入会被 Chromium 当作匿名单元格的伪元素。

## 5. 客户端与会话扫描

`apps.js` 是唯一客户端目录。每个条目声明：

- 平台启动信息与默认数据目录；
- 默认会话根目录和诊断位置；
- scan 函数、活动探针；
- 是否允许启动与是否支持 Markdown 导出。

当前来源为 Claude Desktop、Claude CLI、Codex、Cursor、Kimi Code、Kimi Work。新增来源时，在目录中增加条目和独立扫描器；不要把客户端分支散落到 renderer。会话适配器必须先把物理载体归一为用户逻辑会话，不能让文件数量直接决定表格行数。

`sessions:list` 接收 profile 形状，但 main 会先规范化，再调用目录中的扫描器。会话定位和导出只接受 profile/session 标识，并从当前扫描结果重新找到可信文件。

## 6. 工具维护

工具维护分成两层：

1. `cli-discovery.js` 根据固定 CLI ID，从显式环境变量、PATH 和常见用户目录解析启动器。结果只有 command、参数前缀、环境补丁、可见路径和来源。
2. `tool-maintenance.js` 持有固定工具目录，识别 npm/Homebrew/uv/自身更新器，构造远端版本请求和更新计划。

安全约束：

- discovery 不提供 Agent 模式参数，不启动进程，不创建会话；
- renderer 只提交 `toolId` 和可选 `profileId`；
- main 重新查目录并生成命令、参数、路径与官方 URL；
- 自动维护只用于识别到且可写的安装来源；
- 批量更新先显示原生确认；
- 不调用 `sudo`，不执行 renderer 文本，不后台下载未知工具。

## 7. IPC 清单

```text
apps:list
settings:get / settings:update
updates:check / updates:install
tools:scan / tools:open / tools:update / tools:updateAll
profiles:list / profiles:add / profiles:update / profiles:remove
profiles:migrateWindowsPath / profiles:launch
agentCatalog:list / agentCatalog:get / agentCatalog:rename
agentCatalog:merge / agentCatalog:split / agentCatalog:delete / agentCatalog:removeBinding
agentBlueprint:get / agentBlueprint:update
agentDeployments:list / agentDeployments:ensureReady / agentDeployments:cancelPreparation / agentDeployments:retryPreparation
agentSlots:list / agentSlots:addLocal / agentSlots:assign / agentSlots:removeLocal
sessions:list / sessions:reveal / sessions:export
activity:all
quota:all
diagnostics:get
system:pickDirectory / system:pickFile / system:showItem / system:openPath
clipboard:writeText
devices:list / devices:initialize / devices:rename / devices:resetMesh / devices:probeTransport
devices:createInvite / devices:cancelInvite / devices:join / devices:setReachable
devices:connect / devices:disconnect / devices:updatePermissions / devices:revoke
devices:getDiagnostics / devices:getNetworkConfig / devices:updateNetworkConfig
remoteInventory:listAgentSlots / remoteInventory:listSessions / remoteInventory:refresh
transfers:createSessionPointer / transfers:chooseFiles / transfers:acceptFile
transfers:list / transfers:cancel / transfers:retry / transfers:openReceivedFile
projects:chooseBinding
remoteControl:open / remoteControl:list / remoteControl:setSurface
remoteControl:return / remoteControl:disconnect / remoteControl:stopAll
```

目录、设备与传输 IPC 只接受固定动作、稳定 ID、受限枚举和有界元数据。合并、拆分与删除由 Main 重新读取 catalog revision；文件来源、保存目录和项目根都由 Main 的系统选择器产生。Renderer 不能取得 Root/设备私钥、Mesh 关联键、SDP、ICE 地址、TURN credential、任意路径、网络报文或通用远端命令。

`devices:probeTransport` 只创建一次隐藏、沙箱化的 WebRTC Renderer，返回耗时、候选类型和协议，不返回 IP、SDP 或 ICE 原文。MVP 的 WebRTC 进程边界见 [ADR_PERSONAL_MESH_WEBRTC_PLACEMENT.md](ADR_PERSONAL_MESH_WEBRTC_PLACEMENT.md)。

任何新增 IPC 都应同时回答：输入是否只包含 ID/受限值、路径由谁解析、是否产生外部副作用、是否需要原生确认。

## 8. Personal Mesh 连接与数据路径

### 配对和成员关系

- LAN 端点默认关闭，只在创建邀请或用户显式开放时短时监听；
- 邀请使用设备签名、32 字节 secret、十分钟 TTL 和单次消费；
- 加入响应使用 X25519 + HKDF-SHA-256 + AES-256-GCM；
- 新设备只取得自己的设备私钥、成员证书链和当前 Mesh 关联密钥，不取得 Root 私钥；
- 权限更新和撤销使用有序签名成员事件，撤销后 Peer、传输和远控立即停止。

### 会合和 WebRTC

连接先尝试远端设备目录里的 LAN endpoint，再回退到双方共同登记的 Signaling Gateway。网关请求使用 Ed25519 签名、短 TTL、nonce、requestId 和重放表；只有持有有效租约的双方可以交换固定 `peer.offer` / `peer.answer`。回复固定走收到 offer 的服务，不能从消息指定任意 URL。

`PeerManager` 在隐藏沙箱 Renderer 中建立 RTCPeerConnection。WebRTC DTLS 之后仍要验证成员证书、签名信封和双方 DeviceProof，认证完成才开放库存、传输或远控消息。ICE 配置合并用户 STUN、部署静态 TURN 与网关短期 TURN；公开状态只保留 `host/srflx/prflx/relay`、UDP/TCP 和 pair state。

`connection.hello/ready` 在设备签名 payload 中把协议 feature 与权限 capability 分开：只协商精确白名单 `catalog.snapshot.v1` 和 `inventory.device-facts.v1`，未知值不持久化。旧端没有目录 feature 时不接收未知 `catalog.snapshot`，继续走 inventory-only；双方支持目录但单边没有当前 `catalog.manage` 时交换有界 unavailable，首目录屏障结束而 `inventory.read` 不受影响。

### 库存和传输

- 独立 `catalog.snapshot` 只携带 Agent、AccountBinding、Blueprint 与 tombstone；现代 inventory 只发布来源设备自己的 Slot 与 SessionReplica，快照有 16 MiB 上限、分块摘要和 revision；
- 旧端 inventory 目录投影只在接收端当前授予 `catalog.manage` 时用于增补未知对象，不能覆盖既有 Binding、应用 tombstone 或裁剪零 Slot 员工；
- 同一强账号键归到同一 AccountBinding，同一强会话键折叠为一个 ConversationIdentity，弱标识保持设备作用域；
- SessionPointer 由 Main 根据 `conversationId + replicaId + targetDeviceId` 重新查表并加密，离线队列只存发送端；
- 文件经私有暂存固定内容和 SHA-256，以 96 KiB 加密块发送，接收端从 `.part` 实际偏移恢复；
- 项目映射只接受目标端系统选择器返回的本机根目录，来源绝对路径从不直接执行。

### 远程查看和输入

远程媒体使用第二条 WebRTC 连接，SDP 只经已认证设备通道交换。目标端 Host Renderer 枚举并采集显示器，控制端使用限定在右下统一详情面板边界内的沙箱 WebContentsView，只拿到安全显示信息和视频轨；普通 Main Renderer 不接触这些数据。查看与控制分别需要持久能力和目标端本次 consent；控制输入再经 Host Renderer 与 Main 双重规范化、速率限制，最后以固定 stdin 行协议交给平台 helper。

断线、失焦、暂停、目标切换、撤销、紧急停止和 helper 心跳超时都会释放按键。多设备控制台最多四路，只给当前目标活动画质，其余为低频缩略图。返回会话工作台会先释放输入、降为仅查看并隐藏 Surface，仍在 viewing 的会话由主 Renderer 顶栏提示；只有 disconnect/stopAll、撤销或终止路径才结束媒体。

## 9. 庭院

庭院是同一份 profile/session/activity/quota 数据的可视化，不是独立业务层。今日账本和提醒总开关由全局 Footer 渲染，庭院 DOM 不再拥有 `yardLedger` 或提醒 HUD；路径、额度等持久 attention 只由 Header 的活动弹窗承载，scene 的 `attentionById` 保持空，只保留用户摸猫或拖放后的短暂直接反馈。会话动作由右下 `sessionActionDock` 承载：focused 单条保留定位/导出与复制/发送，显式 checked 集合隐藏 focused 专用动作，只保留批量摘要/取消/复制/发送。

拖放只保留三类意图：

- `workshop`：确认后打开账号；已打开时聚焦状态；
- `attention`：聚焦当前会话详情；
- `meadow` 或普通地面：保存猫位置。

详见 [YARD.md](YARD.md)。

## 10. 测试与构建

```bash
npm run check
npm test
npm run accept:ui
npm run build:mac:dir
```

当前完整 Node 套件共 418 项（417 通过、1 项仅 Windows 跳过、0 失败）。隔离双端真实 Electron E2E 在局域网直连与本机 signaling 两种路径均完成认证、目录/库存、显式刷新、SessionPointer、184,333 字节文件与合成屏幕；它仍不是物理双机或真实 NAT/TURN 证据。

`npm run accept:ui` 使用临时 userData 启动真实 Electron 窗口，不读取或改写所有者配置，也不触发剪贴板、外部应用或远端网络。当前覆盖 17 条任务路径：58/244/316/38 固定几何与 Compact 无横滚、focus/checked/隐藏选择、庭院/卡片共享状态、Top Layer 场景 Popover、Agent 对象 Dialog、三语/明暗主题、本机新增、四个 Header 入口、固定区矩形与单一滚动所有者、父子 Esc/焦点栈、760 × 560 小视口、设备中心与原子导航、Slot 保留上下文、Agent/Binding/Slot 管理、多副本来源、两类传输草稿、远控后台提示、撤销后详情清理和 reduced-motion。

测试除了扫描器和纯函数，还包含以下边界契约：

- preload/main 不出现会话执行 IPC；
- 已退休的执行与交接模块不存在；focused/checked 会话只形成临时动作集合，并只调用最小定位格式；
- 工具发现不携带协议或会话参数；
- package 不包含会话协议 SDK；
- 庭院只暴露三类核心意图。
- Mesh 账号关联键在同 Mesh 内稳定、跨 Mesh 不可关联，成员证书和握手证明可检测篡改与过期；
- 目录与库存 feature 兼容、权限不对称、旧端降级和 inventory 不能越权修改全局目录；
- `agent.prepare` 在确认后重新核对当前权限与连接代次，撤权/断连后的迟到允许不产生副作用；
- schema v5 的迁移回滚点包含已提交 WAL，并在发布前校验版本、完整性与外键；
- 同账号跨形态只形成一个 Agent，同机多账号不误合并，换号不静默搬历史，最后 Slot 删除后目录可为空；
- Header 直接提供设备、工具、活动和设置，四个入口各开独立模态弹窗且不改变底层工作台或三个固定面板，设备 IPC 保持固定白名单；
- 四个全局弹窗的 Header/关闭/全局命令/Footer 不随内容滚动；工具、活动、设置不保留底部“完成”，父子弹窗关闭后恢复准确焦点和 disclosure 状态；
- 两个隔离数据目录完成加密配对、权限更新、撤销、库存归并、SessionPointer 与文件续传；
- 真实 Electron 沙箱 WebRTC 完成设备认证、库存、会话信息、184,333 字节文件和合成屏幕媒体；
- 信令请求拒绝篡改、过期、重放、无租约发送和任意回复地址，公开诊断不含 IP、SDP 或凭据；
- 嵌入式 Remote Surface/Host 使用专用沙箱 IPC，输入只接受有界固定事件且始终只有一个 owner。
- Agent/AccountBinding/AgentSlot 的新增、归属、合并、拆分和三种删除范围走固定目录 IPC，均可删到零且不触碰官方客户端数据。
- Renderer 任务结果测试和真实窗口验收共同证明 UI 上下文互不覆盖，render/filter 不自动制造选择。

这些自动化不能替代两台物理电脑、真实 NAT/coturn 和 macOS/Windows 权限矩阵；对应门禁见 `PERSONAL_AGENT_MESH_PLAN.md`。

发布要求见 [RELEASING.md](RELEASING.md)。
