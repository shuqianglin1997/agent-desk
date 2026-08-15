# AgentDesk 内部结构

## 1. 当前职责

AgentDesk 是本地优先的账号、会话历史与工具维护器。它负责：

- 保存和启动受支持客户端的账号槽位；
- 对 AgentDesk 自己启动的官方桌面 Profile 建立精确进程归属、重复启动阻断、正常退出收口与 Crashpad 磁盘保护；
- 只读扫描本地会话元数据；
- 定位或导出单个会话；
- 从一条明确本机会话生成或导入经过验证的 TaskPackage；
- 聚合活动状态与 Codex 额度；
- 诊断路径和安装；
- 发现、打开并在用户确认后维护固定目录中的桌面 App / CLI。

Personal Agent Mesh 的有人值守代码链路已经接入运行时：版本化首次使用与首个 Agent 的本机无网络初始化、双方身份确认的设备任务向导、设备证书和配对、长期全局 Agent/Blueprint/Deployment/ProvisioningJob、独立签名目录、来源设备库存、SessionPointer、文件与同 Mesh TaskPackage 传输、远程查看/输入、多设备控制台，以及 LAN/签名信令/STUN/TURN。旧端协议 feature 降级、目录权限不对称、inventory 目录隔离、远端准备撤权竞态和 TaskPackage 直送安全边界已有回归；独立 UI 上下文、目录对象管理和真实 1040 × 840 Electron 任务路径也已本机验收。物理双 Mac 另有局域网认证通道与 562,009 字节大库存/刷新证据，但完整设备向导、TaskPackage 直送数据面、真实公网 NAT、coturn 强制中继、断网/睡眠恢复和 macOS/Windows 四向权限矩阵仍未通过，因此当前是“纵向代码 + 本机自动化 + 一项窄双 Mac 证据”，不是公开稳定验收态。

它不包含聊天 transport、Agent 对话生命周期、任务队列、自动多会话交接编排、规划资料索引或任意命令注册。官方桌面客户端的进程监管只服务 AgentDesk 自己启动的 Profile 生命周期和磁盘安全，不启动、续接或编排对话。TaskPackage 是用户显式创建的一次不可变工作快照，不改变这条边界。

## 2. 进程边界

```text
Renderer
  └─ window.manager（preload 白名单）
       └─ Electron IPC
            └─ Main process
                 ├─ profile/settings JSON store
                 ├─ app/session scanners
                 ├─ diagnostics and quota
                 ├─ ProfileRuntimeSupervisor / bounded Crashpad retention
                 ├─ CLI discovery and tool maintenance
                 ├─ MeshService / mesh.db / OS-protected key vault
                 ├─ SignalingClient / PeerManager / TransferService
                 ├─ TaskPackageService / native-session adapters / consumed ledger
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
  onboarding-state.js     版本化首次使用的纯状态与完成门禁
  device-journey.js       身份/信任/连接/目录/库存任务状态投影
  profile-runtime.js      Profile 进程归属、重复启动、退出收口、Crashpad 限额/熔断与窄范围清理
  ui-context.js           独立 UI 上下文与无副作用状态迁移
  index.html
  styles.css              低优先级 legacy 兼容样式
  workspace.css           1.14 固定工作台与全局弹窗 Shell 的 canonical 分层样式

  task-package/
    format.js             流式加密容器、清单归一、逐项校验与受控解包
    codex-adapter.js      Codex 根会话/internal-child 一致捕获与事务导入
    service.js            可信来源解析、Git 检查点、附件、导入草稿和本地历史

  main/
    profile-store-policy.js 缺失 Profile 存储保持真实空目录
    ipc/
      first-agent-onboarding.js 首个 Agent 的本机离线事务
      network-enrollment.js     设备联网 enrollment 门禁
      pairing-approvals.js      加入预览、双方身份确认与批准 token
      path-selections.js        Main 系统选择器能力票据
      security-policy.js        主窗口 sender/frame/document 与导航策略
      task-package-transfer.js  直送 IPC 的稳定 ID/枚举 schema

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
    task-package-transfer.js TaskPackage manifest 与目标设备独占 envelope
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
    transfer-service.js   SessionPointer、文件与同 Mesh TaskPackage 传输
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
  verify-electron-package-integrity.js  流式核验成品 fuse、ASAR 每个文件及 macOS/Windows header 绑定
  packaged-first-use-smoke.js  对同一确切成品执行首次初始化、恢复完成和完成后重启
  github-release-gate.js  校验 Preview 策略、三资产、Draft/公开状态、摘要与实际下载字节
  verify-windows-portable-package.ps1  解开无签名兼容 portable 并核验其真实内层成品
  verify-windows-release.ps1  验证 portable、包内主程序与 input helper 的 Authenticode/时间戳
  verify-windows-publisher.ps1  把三层 Windows 可执行文件绑定到受保护发布者 thumbprint
  check-docs.js           当前状态文档的链接、权威版本、证据与发布口径检查
```

## 4. 数据模型

### Profile

账号槽位保存在 `profiles.json`，主要字段包括：

- `id`、`appId`、`name`；
- `profilePath`、`sessionRoot` 及其 auto/custom 模式；
- 可选 `executablePath`、`identityKey`、`group`、`note`；
- 猫外观与创建/最近打开时间。

归一化保留未知字段，方便未来版本向前兼容。局部更新合并猫外观，不回写过期整表快照。

`profile-runtime.json` 只保存本机 Profile 的受管状态：稳定 `profileId`、Profile 路径、启动 PID/时间、是否仍归 AgentDesk 所有、熔断时间与脱敏事件计数。它不保存 dump 内容、sidecar 内容、会话标题、账号凭据或客户端数据库。Main 每次仍由稳定 `profileId` 重新查 `profiles.json`；Renderer 不能提交路径或 PID。

每个受管 Profile 的 `Crashpad/pending` 默认限制为 100 个直属文件或 200 MiB，每 2 秒复核；一分钟内 5 个同尺寸 dump 触发持久熔断。普通停止与正常退出只允许终止当前记录为 AgentDesk 所有的进程。事故熔断或容量无法安全收敛时，可以按 profiles.json 中稳定 profileId 重新查得的精确 `user-data-dir` 终止旧版本、强制退出或重启后遗留的匹配进程，但无所有权例外只允许路径落在 AgentDesk 自己的受管 Profiles 根；官方默认目录和任意 custom 目录不进入后台扫描、删除或停机。该边界不能扩展成按应用名或路径前缀清理。终止成功后清除 `owned` 与 `launchPid`。清理只接受普通 `.dmp` 与 `_sidecar.json`，拒绝符号链接、目录逃逸和非普通文件，不触碰 `codex-home`、sessions、archives、配置、SQLite 或 `saved-diagnostic-*`。用户显式选择保留后台时停止监管并在设置中显示风险。强制结束 AgentDesk 不等于系统级持续守护保证；下一次管理器启动后恢复受管根限额与事故熔断。

### Settings

`settings.json` 保存主题、语言、视图、会话范围/列视图、Device Lens / Agent / Slot 选择记忆、庭院时间和天气、提醒、今日账本、猫位置、版本化 `onboarding.completedVersion/completedAt`、`meshNetworkEnrollmentEnabled`、HTTPS 信令地址和 STUN 地址。首次 Agent 事务显式把联网 enrollment 保持为 false；只有添加设备或网络动作才开启。TURN 长期 secret、短期 credential、设备私钥和 Mesh 关联密钥不进入设置。写入使用临时文件替换并保留备份。

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

Mesh 会话聚合返回结构化失败时，Renderer 不再把当前会话设为空数组。全部/本机 Lens 改用相同的本地扫描器，但只扫描当前 catalog 关系中真实存在于本机 `profiles.json` 的 Profile；远端伪 Profile 不进入本地 IPC。该结果标记为 local fallback，SessionPointer、文件传输与 TaskPackage 直送不取用其临时位置信息；本地只读操作继续可用。

已打包 macOS 开发版还有一条精确限定的启动路径：Main 使用固定 `/usr/bin/codesign` 检查自身主可执行文件，只有 `Signature=adhoc`、无 `Authority`、`TeamIdentifier=not set` 同时成立才延后系统密钥访问。启动期 `devices:list` 请求 `MeshService.getOverview({deferKeyAccess:true})`，读取已验证的持久目录/设备快照并返回 `keyState=deferred`，不加载 KeyVault、不启动 signaling、不恢复 ProvisioningJob。Renderer 看到密钥未可用就直接走本地只读会话，不再发出一次会阻塞的 Mesh 会话 IPC。只有 Header 的“设备”这一显式用户动作会传 `requestSecureAccess=true`；解锁成功后才恢复准备任务和按 enrollment 开启联网。检测失败、Developer ID 包、Windows 与开发态均保持原路径，没有通用密钥降级开关。

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

### TaskPackage

TaskPackage 是本地独立交付物，不写入 `mesh.db`，也不成为 `ConversationIdentity` 或持续任务状态。Main 以当前 Profile/Session 扫描结果重新解析来源，Renderer 只提交稳定 ID、有限文本字段和布尔选项；保存路径、导入文件、附件与资料目录均来自 Electron 原生选择器。

容器分两层：外层只含格式版本、AES-256-GCM/scrypt 参数、salt 和 IV；完整清单与条目正文都在认证加密区。清单限定 64 项、单项 4 GiB、整包 8 GiB，逻辑路径不能为绝对路径、盘符、空段或 `..`，每项带 SHA-256。解锁码由 20 个无歧义字符组成并分组显示，只返回一次给 Renderer，不写入包、本地历史或日志。

导出内容由四部分组成：人工检查点；一个原生会话或只读 transcript；可选 Git remote/branch/HEAD/status 与 `git diff --binary HEAD`；最多 32 个明确附件。Git status 可以记录未跟踪文件名，但未跟踪正文不会自动进入 patch。重复附件名会被稳定安全改名，符号链接与目录拒绝。

Codex 适配器只信任 Profile `sessionRoot` 下 `sessions` / `archived_sessions` 的真实 JSONL 文件。活跃追加文件先取完整行边界的一致快照；根记录与归属同一 `parent_thread_id` 的 internal-child 全部重新解析身份。导入先在私有 staging 解包和验证，不覆盖目标同名或同会话 ID 的不同内容；新增文件和任务资料作为事务回滚。成功后在 `session_index.jsonl` 追加带来源的标题。提交完成后的历史写入或客户端启动是附加便利，失败不能删除已经导入的内容。

`task-package-history.json` 只保存包 ID、方向、模式、展示字段、大小、本机路径和时间。`task-package-consumed.json` 是与可裁剪展示历史分离的持久防重放账本；已导入 packageId/transferId 不能因历史清理而再次消费。导入 token 在 Main 内存映射真实路径；解密草稿 30 分钟过期，取消、成功、撤权、设备撤销、远端报错和退出都会清理，启动时再清理 24 小时前的私有 staging。直送使用同一个标准密文快照；解锁码只在完整密文和 SHA-256 验证后由目标 Main 短时解封，Renderer、历史和日志均不可见。

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
onboarding:initializeFirstAgent
devices:createInvite / devices:cancelInvite / devices:inspectInvite / devices:join / devices:setReachable
devices:listPairingClaims / devices:decidePairingClaim
devices:connect / devices:disconnect / devices:updatePermissions / devices:revoke
devices:getDiagnostics / devices:getNetworkConfig / devices:updateNetworkConfig
remoteInventory:listAgentSlots / remoteInventory:listSessions / remoteInventory:refresh
transfers:createSessionPointer / transfers:chooseFiles / transfers:acceptFile
transfers:list / transfers:cancel / transfers:retry / transfers:openReceivedFile
projects:chooseBinding
taskPackages:previewExport / taskPackages:export / taskPackages:chooseImport
taskPackages:inspectImport / taskPackages:commitImport / taskPackages:cancelImport
taskPackages:sendToDevice / taskPackages:acceptIncoming / taskPackages:rejectIncoming
taskPackages:prepareIncoming / taskPackages:savePortableFallback
taskPackages:list / taskPackages:reveal
remoteControl:open / remoteControl:list / remoteControl:setSurface
remoteControl:return / remoteControl:disconnect / remoteControl:stopAll
```

目录、设备与传输 IPC 只接受固定动作、稳定 ID、受限枚举和有界元数据。合并、拆分与删除由 Main 重新读取 catalog revision；文件来源、保存目录和项目根都由 Main 的系统选择器产生。TaskPackage 的导入草稿只向 Renderer 暴露随机 token、文件名和大小，目标 Profile 在提交时重新查表，真实路径和解密明文不返回 Renderer。Renderer 不能取得 Root/设备私钥、Mesh 关联键、SDP、ICE 地址、TURN credential、任意路径、网络报文或通用远端命令。

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

`connection.hello/ready` 在设备签名 payload 中把协议 feature 与权限 capability 分开：只协商精确白名单 `catalog.events.v1`、`catalog.snapshot.v1`、`inventory.device-facts.v1` 和 `task.package.transfer.v1`，未知值不持久化；同一握手携带当前 appVersion/protocol/platform/arch/osVersion 与目录来源向量。新端只发送对方缺少的原始签名目录事件，0.9.4 旧端继续接收快照，更旧端没有目录 feature 时走 inventory-only；双方支持目录但单边没有当前 `catalog.manage` 时交换有界 unavailable，首目录屏障结束而 `inventory.read` 不受影响。`task.package.*` 每条消息还要同时复核协商 feature 与当前 `task.package.receive`，握手 feature 本身不授予接收权。

### 库存和传输

- 独立 `catalog.events.v1` 以来源连续向量补齐带原设备签名的 Agent、AccountBinding、Blueprint 与 tombstone 事件；并发普通字段确定性物化，关系事务保留原子边界，删除同 ID 永久防复活。0.9.4 的独立 `catalog.snapshot` 先经 tombstone 合并再转换为本机签名兼容事件；现代 inventory 只发布来源设备自己的 Slot 与 SessionReplica，快照有 16 MiB 上限、分块摘要和 revision；
- 旧端 inventory 目录投影只在接收端当前授予 `catalog.manage` 时用于增补未知对象，不能覆盖既有 Binding、应用 tombstone 或裁剪零 Slot 员工；
- 同一强账号键归到同一 AccountBinding，同一强会话键折叠为一个 ConversationIdentity，弱标识保持设备作用域；
- SessionPointer 由 Main 根据 `conversationId + replicaId + targetDeviceId` 重新查表并加密，离线队列只存发送端；
- 文件经私有暂存固定内容和 SHA-256，以 96 KiB 加密块发送，接收端从 `.part` 实际偏移恢复；
- 项目映射只接受目标端系统选择器返回的本机根目录，来源绝对路径从不直接执行。

TaskPackage 同时支持便携文件和同 Mesh Preview 直送。两条通道发送同一个不可变加密快照；直送由 `TransferService` 复用分块、背压、续传和整包哈希，使用独立 `task.package.receive` capability 与 `task.package.transfer.v1` feature，并要求接收端对每个包明确接受或拒绝。协议不兼容、权限关闭、拒绝或传输失败时，发送端可以把同一密文快照保存为便携文件，不自动降级成普通明文文件。

一次性码使用目标设备 Ed25519 身份转换出的 X25519 公钥进行临时 ECDH，随后以 HKDF-SHA-256 和 AES-256-GCM 生成目标设备独占 envelope；认证数据绑定 Mesh、来源/目标设备、transferId、packageId、包哈希与目标公钥指纹，不依赖全 Mesh 共享 linkKey。目标 Main 只在用户已接受、完整密文与 SHA-256 均验证成功且当前 capability/feature 仍有效时解封；拒绝、过期、撤权、撤销、报错和退出清除 envelope、secret、草稿与 spool。认证传输提供来源设备 ID/名称；`sourceAgentName` 和交接人仍是受包完整性保护的发送方声明，不是经过 catalog 验证的 Agent 身份。

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
npm run check:docs
npm test
npm run accept:ui
npm run build:mac:dir
```

当前完整 Node 套件共 526 项（525 通过、1 项仅 Windows 跳过、0 失败）；其中 TaskPackage 安全定向 25/25，发布安全定向 14/14。隔离双端真实 Electron E2E 在局域网直连与本机 signaling 两种路径均复跑完成认证、签名目录事件/库存、显式刷新、SessionPointer、184,333 字节文件与合成屏幕；该 runner 尚未发送 TaskPackage，因此它既不是直送数据面证据，也不是物理双机或真实 NAT/TURN 证据。

物理证据单独存在：两台 Mac 在同一局域网通过 host/UDP 建立认证 DataChannel，562,009 字节库存中的 9 个 Slot 与 638 条 SessionReplica 完整落库，显式刷新与 4 分钟全快照把 revision 从 7 推进到 8 和 9，连接连续 5 分钟无错误或断开。该记录不覆盖远控媒体/输入权限、断网/睡眠恢复、公网 NAT/coturn 或 Windows。

`npm run accept:ui` 使用临时 userData 启动真实 Electron 窗口，不读取或改写所有者配置，也不触发剪贴板、外部应用或远端网络。当前通过 21/21 条任务路径：新增全新首 Agent 的真实本机事务与无网络断言、首次使用重启恢复且不生成默认 Profile、设备任务向导固定 Shell/分层状态，以及 TaskPackage 直送资格和接收阶段投影；原有 58/244/316/38 固定几何、Compact 无横滚、会话选择、庭院/卡片、三语/明暗主题、父子弹窗、小视口、目录对象、传输草稿和 Remote Surface 契约继续覆盖。直送窗口验收只证明 UI 资格、状态与明文码不可见，不代表真实 WebRTC 数据面已经传过 TaskPackage。

成品验证分成两层。`verify-electron-package-integrity.js` 不启动应用，直接证明 `app.asar` 存在、`default_app.asar` 不存在，流式复算每个常规文件的整文件与 4 MiB 分块 SHA-256，拒绝缺失元数据、链接、范围空洞/重叠和尾部载荷；`RunAsNode` 仅作为固定 CLI launcher 的兼容 fuse 保留，`NODE_OPTIONS`/inspect 关闭、embedded integrity/only-load-from-ASAR 开启，archive header 再绑定 macOS `Info.plist` 或 Windows PE 的唯一 `INTEGRITY/ELECTRONASAR`。当前 macOS unpacked 成品的 118/118 个常规文件已通过这一层。`packaged-first-use-smoke.js` 才会对同一确切 `AgentDesk.app`、`win-unpacked` 或带版本 portable 使用临时 userData 连续启动三次，核对固定窗口、首次初始化/恢复、零默认 Profile、零 Mesh 网络，以及原始启动句柄和回环调试端点清理；随机 launch token 与 Browser command line 防止同机其他页面冒充本次产物。本机现有确切 `release/mac-arm64/AgentDesk.app` 已使用真实语义开关 `--macos-ci-mock-keychain` 通过这三次启动：runner 先证明 bundle 是无 `TeamIdentifier` 的 ad-hoc 签名，再在每次 Browser command line 中核对唯一原生 `--use-mock-keychain`，报告为 `keychainMode=mock`。这只证明该字节在 mock Keychain 下的打包与首次使用事务；新的 GitHub macOS `main` CI 运行仍待结果，且该模式不验证 `safeStorage` 的 macOS 系统 Keychain/OS 密钥保护。Developer ID、签名公证、Draft/公开重下载和物理干净机继续使用系统 Keychain，并仍是开放门禁。

发布事务再高一层：`github-release-gate.js` 与 Preview-only workflow 把 `stableAllowed=false`、精确 DMG + portable + `SHA256SUMS.txt`、Draft 双原生端重下载、发布后无 token 匿名公开重下载、摘要/清单/字节一致、失败回 Draft 与 candidate-burned 固化为门禁；诊断只保留为 Actions artifact，不进入 Release。发布安全 14/14 证明门禁逻辑，尚未用真实签名凭据、受保护 `preview-release` 环境和真实 Tag 执行，因此当前没有公开 Preview。

测试除了扫描器和纯函数，还包含以下边界契约：

- preload/main 不出现会话执行 IPC；
- 已退休的执行与自动交接编排模块不存在；focused/checked 会话只形成临时动作集合，并只调用最小定位格式。TaskPackage 只从一条聚焦本机会话显式建立不可变快照；
- 工具发现不携带协议或会话参数；
- package 不包含会话协议 SDK；
- Electron 成品必须只从 `app.asar` 加载且匹配五项 fuse；`RunAsNode` 的调用面不得超出现有 `cli-discovery.js` 与 `codex-quota.js` 两个固定 launcher；
- 成品首次使用 smoke 必须使用同一确切产物完成三次启动，产物类型、版本、UI、首次使用状态、零 Mesh 网络、进程与回环调试端点都有白名单；
- Preview 发布只接受受保护的 Preview Tag、精确三资产、Draft/公开状态与摘要/实际下载字节一致；公开后失败必须回 Draft 并烧毁候选版本；
- 庭院只暴露三类核心意图。
- Mesh 账号关联键在同 Mesh 内稳定、跨 Mesh 不可关联，成员证书和握手证明可检测篡改与过期；
- 签名目录事件、来源连续向量、字段并发合并、同字段稳定冲突、结构事务门禁、删除 tombstone 与 0.9.4 快照兼容；inventory 不能越权修改全局目录；
- `agent.prepare` 在确认后重新核对当前权限与连接代次，撤权/断连后的迟到允许不产生副作用；
- schema v6 的迁移回滚点包含已提交 WAL，并在发布前校验版本、完整性与外键；目录事件来源序列/Lamport 独立落列且不随 Device 删除级联消失；
- 同账号跨形态只形成一个 Agent，同机多账号不误合并，换号不静默搬历史，最后 Slot 删除后目录可为空；
- Header 直接提供设备、工具、活动和设置，四个入口各开独立模态弹窗且不改变底层工作台或三个固定面板，设备 IPC 保持固定白名单；
- 四个全局弹窗的 Header/关闭/全局命令/Footer 不随内容滚动；工具、活动、设置不保留底部“完成”，父子弹窗关闭后恢复准确焦点和 disclosure 状态；
- 两个隔离数据目录完成加密配对、权限更新、撤销、库存归并、SessionPointer 与文件续传；
- 真实 Electron 沙箱 WebRTC 完成设备认证、库存、会话信息、184,333 字节文件和合成屏幕媒体；
- 信令请求拒绝篡改、过期、重放、无租约发送和任意回复地址，公开诊断不含 IP、SDP 或凭据；
- 嵌入式 Remote Surface/Host 使用专用沙箱 IPC，输入只接受有界固定事件且始终只有一个 owner。
- Agent/AccountBinding/AgentSlot 的新增、归属、合并、拆分和三种删除范围走固定目录 IPC，均可删到零且不触碰官方客户端数据。
- Renderer 任务结果测试和真实窗口验收共同证明 UI 上下文互不覆盖，render/filter 不自动制造选择。
- TaskPackage 回归覆盖错误密钥与密文保密、清单类型/路径/总量边界、Git 只携带已跟踪差异、Codex 根会话/internal-child 原生导入、来源标题、目标冲突、独立 consumed ledger，以及客户端打开失败后仍保留已提交内容；直送额外覆盖目标设备独占 envelope、逐消息 capability/feature、完整哈希后解封、拒绝/过期/撤权/撤销清理和同快照便携回退。UI 契约证明它是单会话次级动作，导入/历史属于活动弹窗，两个事务弹窗固定 Header/Footer 且只有 Content 滚动。

这些自动化不能替代物理设备；已有双 Mac 局域网库存证据也不能替代完整设备向导、TaskPackage 直送、真实 NAT/coturn、断网/睡眠恢复和 macOS/Windows 权限矩阵。托管 runner 的未来匿名下载也不能替代浏览器 quarantine、Windows MOTW/SmartScreen/Defender/UAC 与物理干净机首启。当前没有公开 `v0.10.1-preview.1`；真实签名/公证、受保护环境和真实 Tag 仍未执行，`0.10.0` 不补发为稳定版。

发布要求见 [RELEASING.md](RELEASING.md)。
