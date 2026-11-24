# AgentDesk 内部结构

当前源码验证、历史物理证据及未关闭门禁统一见[验证记录](VALIDATION.md)；本页不另行维护测试数字。

## 1. 当前职责

AgentDesk 是本地优先的账号、会话历史与工具维护器。它负责：

- 保存和启动受支持客户端的账号槽位；
- 对 AgentDesk 自己启动的官方桌面 Profile 建立精确进程归属、重复启动阻断、正常退出收口与 Crashpad 磁盘保护；
- 只读扫描本地会话元数据；
- 定位或导出单个会话；
- 从一条明确本机会话生成或导入经过验证的 TaskPackage；
- 聚合活动状态与 Codex 额度；
- 诊断路径和安装；
- 发现、打开并在用户确认后维护固定目录中的桌面 App / CLI；
- 调度中枢：把人通过自己 Agent 发起的一次后台对话中转给一个允许被调用的账号，监管这个子进程并记下标题和状态。

Personal Agent Mesh 的有人值守代码链路已经接入运行时：版本化首次使用与首个 Agent 的本机无网络初始化、双方身份确认的设备任务向导、设备证书和配对、长期全局 Agent/Blueprint/Deployment/ProvisioningJob、独立签名目录、来源设备库存、SessionPointer、文件与同 Mesh TaskPackage 传输、远程查看/输入、多设备控制台，以及 LAN/签名信令/STUN/TURN。旧端协议 feature 降级、目录权限不对称、inventory 目录隔离、远端准备撤权竞态和 TaskPackage 直送安全边界已有回归；独立 UI 上下文、目录对象管理和真实 1040 × 840 Electron 任务路径也已本机验收。物理双 Mac 另有局域网认证通道与 562,009 字节大库存/刷新证据，但完整设备向导、TaskPackage 直送数据面、真实公网 NAT、coturn 强制中继、断网/睡眠恢复和 macOS/Windows 四向权限矩阵仍未通过，因此当前是“纵向代码 + 本机自动化 + 一项窄双 Mac 证据”，不是公开稳定验收态。

它不包含聊天 transport、任务队列、自动多会话交接编排、规划资料索引或任意命令注册。调度中枢只中转调用方明确发起的一次后台运行：Main 不自己发起、排队、重试、定时、挑选账号，也不把一段对话的结果交给另一个账号。官方桌面客户端的进程监管只服务 AgentDesk 自己启动的 Profile 生命周期和磁盘安全，不启动、续接或编排对话。TaskPackage 是用户显式创建的一次不可变工作快照，不改变这条边界。

## 2. 进程边界

`src/automation/cli.js` 是独立 Node 入口，`service.js` 共用命令定义、客户端注册表、CLI discovery、扫描器和会话定位格式。它不加载 Electron Main、Mesh/Keychain 或桌面 store 恢复逻辑；只读取显式 userData 中的 v2 Profile 快照，不写回。Cursor/Kimi Work 可使用既有固定 sqlite3 只读查询。接口/扩展方法见 [AI_INTERFACE.md](AI_INTERFACE.md)。桌面 IPC 不因此成为公共 API，写入仍只在现有 Main 事务和授权流程中进行。

成品 `--cli` 在应用启动分支中运行。查询复用同一服务，默认使用 Electron 的 userData。登记、认证导入与打开走客户端专用命令，由持有 Electron 单实例锁的 Main 串行处理。已有桌面实例时通过单实例事件传递请求编号，由该 Main 读取、校验和处理本机请求。以 CLI 方式启动的实例不创建窗口。Windows portable 的 `--output` 使用新文件返回 JSON 和进程退出码。

调度中枢的 `agents list`、`run`、`runs …` 也走这条单实例通道。提示词由 CLI 进程从标准输入读入，和密钥一样只在单实例消息的内存里交给 Main，不写进 `cli-requests`；调用层数从调用方自己的环境变量 `AGENTDESK_HUB_DEPTH` 读出，一并带过去。以 CLI 方式启动、自己拿到实例锁的进程（桌面没开）不监管子进程：`agents list`、`run`、`runs stop` 返回 `desktop-not-running`，`runs list/status/output` 只读已结束的记录。

本地 PR 融合新增 `profile-home.js`（只创建独立目录，不播种凭据）、`terminal-launcher.js`（按完整目标环境生成固定工具启动脚本）和 `roster-interactions.js`（排序/取消/滚轮）。Main 从工具注册表与本机 Profile 解析动作，不接收 Renderer 命令。Windows 环境清理匹配大小写别名，Node shebang 启动保留解释器、参数和 PATH；临时终端脚本不使用二次展开的 CALL。名册顺序由 settings 归一化持久化。

```text
Renderer
  └─ window.manager（preload 白名单）
       └─ Electron IPC
            └─ Main process
                 ├─ profile/settings JSON store
                 ├─ app/session scanners
                 ├─ diagnostics and quota
                 ├─ ProfileRuntimeSupervisor / bounded Crashpad retention
                 ├─ Agent hub relay: HubRunner children / agent-hub.json ledger
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
  account-discovery.js    招募：按注册表特征找已有账号目录（默认/环境变量、有界主目录扫描、指定文件夹），身份只出邮箱或套餐
  account-credentials.js  招募：把粘贴的密钥交给账号自己的客户端（标准输入、单一文档变量或该目录文档写明的文件），按各家成功判据报告登录状态
  credential-import.js    招募：DSH、Kimi Code、Claude CLI 登录文件的检查与复制进新独立目录
  main/profile-registration.js  已有目录的登记规划与一次保存的批量登记（幂等）
  main/ipc/recruit.js     招募 IPC：发现结果只发一次性选择编号，登记前在 Main 重新核对
  main/recruit-items.js   拖进来或选中的文件夹、登录文件：先判定会做什么（原地登记/复制/已在台面上），执行前再核对一次
  renderer/recruit.js     招募弹窗四段的界面控制，只调固定 manager 方法
  hub/adapters.js         调度中枢：每个可被调用客户端的固定无界面运行参数、只读/可写写法、结束判断、回答与会话记录来源（带官方出处）
  hub/roster.js           允许被调用的名册、名字到确切 Profile 的解析（重名返回候选）、工作目录必须在允许的文件夹里、层数
  hub/store.js            agent-hub.json：允许的文件夹、上限和后台对话记录（不存提示词和回答）
  hub/runner.js           Main 监管的子进程：标准输入送提示词、解析输出、停止与退出收口
  main/agent-hub.js       中转服务：校验顺序、一账号一段、全局上限、层数、电量、拒绝理由码、发起方是哪只猫（上一段中转的对话，或发起进程所在的账号目录）
  renderer/hub.js         后台对话在账本里的一行（每一列的写法）、状态灯、搁板上的点线、三个动作与“允许被调用”的说明纸条；只造 DOM
  pixel/desk.js           桌面上飞的信封、落地的一圈小方块：12 步先快后慢、最多三处、可打断、后台和减少动态效果时不演
  ui-context.js           独立 UI 上下文与无副作用状态迁移
  index.html
  styles.css              低优先级 legacy 兼容样式
  workspace.css           1.14 固定工作台与全局弹窗 Shell 的 canonical 分层样式
  pixel.css               像素皮肤：不分层，统一覆盖颜色、边框、图标与动效关键帧
  cats.css                像素猫：卡片画布 80×80 的位置（底边贴搁板）、页脚的猫、编辑器的三项选择
  pixel/
    icons.js              8×8 位图图标，启动时生成本地 CSS 蒙版变量（可在 Node 中 require）
    fx.js                 动效引擎：粒子画布、冒字、逐帧动作；不认识业务对象
    cats.js               像素猫的放映机：一个钟逐帧放每只看得见的猫，一次性动作播完回到状态（放映核心可在 Node 中 require）
    chip.js               声音芯片：两个方波、波形、噪声四声道，22 张 60 行/秒的寄存器表渲染成 PCM（可在 Node 中 require）
    sfx.js                音效播放器：事件表、三档与音量、前台规则、一次一个、节流、首次手势才建 AudioContext
    boot.js               开灯与关灯：启动、加载中的空位、来去的猫、关灯的编排；在 <head> 里先执行（逐帧的路与间隔可在 Node 中 require）
    ui.js                 把动效和声音接到界面：猫的动作、设备视角下拉、选中括号、页脚对白、声音钩子与声音设置

  task-package/
    format.js             流式加密容器、清单归一、逐项校验与受控解包
    service.js            可信来源解析、Git 检查点、附件、导入草稿和本地历史

  main/
    profile-store-policy.js 缺失 Profile 存储保持真实空目录
    window-lamp.js        关灯/关窗通知窗口并等它回话，按硬上限继续；记下这扇窗是不是第一次出现
    ipc/
      first-agent-onboarding.js 首个 Agent 的本机离线事务
      network-enrollment.js     设备联网 enrollment 门禁
      pairing-approvals.js      加入预览、双方身份确认与批准 token
      path-selections.js        Main 系统选择器能力票据
      security-policy.js        主窗口 sender/frame/document 与导航策略
      task-package-transfer.js  直送 IPC 的稳定 ID/枚举 schema

  apps.js                 客户端目录：按固定顺序收集各适配器，并提供与具体客户端无关的启动计划、默认路径和给界面的精简元数据
  clients/<id>/           每个客户端一个适配器目录（claude、claude-cli、dsh-cli、codex、kimi、kimi-work、opencode、gemini-cli、qwen-code、cursor），集中它的名称、可执行文件、数据目录、扫描区域、发现特征与密钥交接方式；clients/shared.js 放几个适配器共用、不点名任何客户端的小工具，clients/scan.js 放各家扫描器共用的有界遍历、读文件头尾、日期与标题；各家会话扫描在自己目录的 sessions.js（十家都在：OpenCode 只读打开 opencode.db、DSH 按帧解 zstd、Cursor 与 Kimi Work 经 clients/sqlite.js 用系统 sqlite3 只读查询），命令行几家共用的有界读取在 clients/cli-scan.js；Codex 独有的模块也在它的目录里：quota.js（本机官方 RPC 额度与会话日志里的缓存额度）、account-import.js、runtime-home.js、history-retention.js、task-package.js（任务包里根会话与内部子记录的一致捕获与事务导入）；导出正文在各家目录的 transcript.js，共用的成段、日期与文件名在 clients/transcript.js；导出附件由适配器的 attachments 声明（哪个记录文件、哪一行是消息、Codex 另有生成的图片），记录里内嵌附件的解码在 clients/media.js；clients/claude-cli/records.js 读 Claude 命令行的记录、clients/kimi/wire.js 读 Kimi 的 wire 记录（Kimi Work 同一格式）；活动探测通过适配器的 replyState（谁最后说话、这一轮回完没有）、isInternalRecordFile（子代理文件）、activityPreference 与 isArchivedRecordFile 取各家差异；每种记录格式只有一个读取者，例如 clients/codex/rollout.js 读 Codex 的 rollout（session_meta 分类出用户根会话与内部子分支、用户与助手消息、额度、首行可超过 64KB），扫描、导出与附件、调度中枢的最终回答、缓存额度和任务包都用它；clients/gemini-cli/parts.js 读 Gemini 的 parts 文字（Qwen Code 沿用同一格式），clients/gemini-cli/records.js 与 clients/qwen-code/records.js 读两家的会话记录，标题、导出和调度回答共用
  agent-workspace.js      全局员工库在工作环境上的就绪投影
  mesh/domain/
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
    ice-urls.js           STUN/TURN 地址列表的纯规整（设置与网络层共用）
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
  session-table.js        过滤与排序纯函数；markKeyOf 给出标签、看过与在跑共用的会话键
  session-marks.js        会话标签、“看过”时间与首次启用起点（userData/session-marks.json，Main 唯一写入者），新回复的判断 freshReplyAt
  renderer/session-marks.js  列表上的记号、筛选条、排序分组、标签选择器与就地改名
  session-location.js     路径 + 坐标的最小剪贴板格式

  cli-discovery.js        只读 CLI 启动器发现
  tool-maintenance.js     固定工具目录、版本/安装源识别、安全更新计划

  identity.js             登录指纹
  identity-groups.js      同一身份的跨客户端归组
  activity.js             活动聚合
  quota.js                额度展示纯函数
  quota-service.js        并发、缓存和失败降级

  core/                   最底层的纯函数与基础件，不用 electron、不引用上层（分层检查会失败）：结果与事实类型 result.js、路径判断 paths.js、读 JSON 与原子写入（同步与异步各一）和带版本的小存储 json-file.js、profiles.json 的唯一读取 profile-file.js、“在跑 / 活跃 / 额度新鲜”时间窗 time-windows.js
  json-store.js           原子 JSON 写入与备份
  settings.js             设置归一化与迁移
  updater.js              AgentDesk Release 解析与校验
  windows.js              Windows 路径和安装发现

  yard/                   猫的素材、状态与能量（庭院场景与旧位置设置都已退休）
    cat-art.js            所有者批准的像素猫：8 个姿势、19 个动作、24 种毛色、12 种配饰（与图鉴原件只差多留的头顶空间和客户端毛色的校正）
    cats.js               活动状态、外观的兼容存储与新猫默认、活动与能量到动作的规则
    sprites.js            旧的三张猫素材，只为还在用它的调用方（应用图标脚本、开灯时的影子）保留
  i18n/                   中文、英文、日文词表

native/
  macos/AgentDeskInputHelper.swift
  windows/AgentDeskInputHelper.cpp

services/signaling/       可自托管最小信令与 TURN REST 凭据服务

scripts/
  ui-acceptance.js        临时 userData 下的真实 1040 × 840 Electron 任务验收；`--hidden` 经 hidden-electron-entry 不显示窗口运行同一套路径
  hidden-electron-entry.js 不显示、不聚焦窗口的 Electron 入口：模拟钥匙串，启动客户端、对话框、显示文件、剪贴板与联网都由记录用的替身回答
  hidden-check.js         用上面的入口跑一遍真实界面：17 个读接口返回值的形状对照基准，并数启动时的完整扫描次数
  arch-metrics.js         架构整理第 8 节的各项指标（无依赖的估算，列出每个数字的来源）
  check-layers.js         五层依赖表与越层报告（core 层越层、core 里用 electron、未登记的文件会失败，其余只报告）
  arch-fixtures.js        只在系统临时目录里造 10 个账号 × 500 条会话的合成数据
  arch-bench.js           在临时主目录里计时主进程的同步工作，结果写入 docs/validation/architecture-baseline.json
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

猫外观 `{ breed, collar, accessory, coat?, wear? }`：`breed` 永远是旧版八种之一、`accessory` 永远是旧版五种之一（`hat` 就是草帽），新毛色写在 `coat`、新配饰写在 `wear`，二者只在 `breed`/`accessory` 等于它们在 `LEGACY_BREED`/`LEGACY_ACCESSORY` 里的旧版近似时才生效；`normalizeCat()` 把直接写进 `breed`/`accessory` 的新 id 拆回这个形状，丢掉对不上的 `coat`/`wear`。`storeCat()` 把编辑器的三项换回存储形状，`resolveCat()` 反过来。因为本机账号的保存是合并写，编辑器保存时显式带上 `coat: null`、`wear: null`，归一化后不留。没有存过外观的账号仍由 `defaultCatFor(id)` 决定（清单与算法不变，测试逐个比对旧版）；只有 `buildStoredProfile()` 新建的账号和首次准备新建的运行位置用 `defaultCatForClient(appId, id)` 穿客户端的毛色。目录事件里的 `catAppearance` 仍是有界的浅层记录（最多 24 个字段、每个字符串 160 字），字段与消息形状不变。

Profile 的启动隔离由 `apps.js` 声明，不从显示名推断。每个桌面客户端必须提供官方启动器身份与 `profileIsolation`：支持受管多开的客户端每次生成该 Profile 唯一的 `--user-data-dir`，并叠加 CODEX_HOME、KIMI_CODE_HOME 等客户端专用环境；同一可执行文件可被不同 Profile 复用。Main 只按精确 Profile 路径做重复进程检查。已知不接受独立目录的客户端使用 `official-default-only`，非默认受管槽位在产生副作用前失败关闭。

`profile-runtime.json` 只保存本机 Profile 的受管状态：稳定 `profileId`、Profile 路径、启动 PID/时间、是否仍归 AgentDesk 所有、熔断时间与脱敏事件计数。它不保存 dump 内容、sidecar 内容、会话标题、账号凭据或客户端数据库。Main 每次仍由稳定 `profileId` 重新查 `profiles.json`；Renderer 不能提交路径或 PID。

每个受管 Profile 的 `Crashpad/pending` 默认限制为 100 个直属文件或 200 MiB，每 2 秒复核；一分钟内 5 个同尺寸 dump 触发持久熔断。普通停止与正常退出只允许终止当前记录为 AgentDesk 所有的进程。事故熔断或容量无法安全收敛时，可以按 profiles.json 中稳定 profileId 重新查得的精确 `user-data-dir` 终止旧版本、强制退出或重启后遗留的匹配进程，但无所有权例外只允许路径落在 AgentDesk 自己的受管 Profiles 根；官方默认目录和任意 custom 目录不进入后台扫描、删除或停机。该边界不能扩展成按应用名或路径前缀清理。终止成功后清除 `owned` 与 `launchPid`。清理只接受普通 `.dmp` 与 `_sidecar.json`，拒绝符号链接、目录逃逸和非普通文件，不触碰 `codex-home`、sessions、archives、配置、SQLite 或 `saved-diagnostic-*`。用户显式选择保留后台时停止监管并在设置中显示风险。强制结束 AgentDesk 不等于系统级持续守护保证；下一次管理器启动后恢复受管根限额与事故熔断。

### 调度中枢

每个 Profile 可以带 `hub: { callable, writable }`，默认都关，只能在桌面窗口里由 `hub:setAccess` 改；不支持后台运行的客户端拒绝打开。`agent-hub.json`（0600，Main 单写）保存允许的文件夹（Main 的系统选择器产生，最多 24 个）、同时运行上限（1–4，默认 2）和最近 200 条后台对话记录：编号、标题、调用方标签、层数、目标 Profile 与当时的猫名、只读/可写、工作目录、状态、理由码、时间，以及客户端自己的会话编号和会话记录位置。提示词和回答从不写入；回答只在这次桌面运行期间留在内存里，之后从会话记录读回。加载这个文件的进程持有实例锁，所以还写着 `starting`/`running` 的记录一定已经没人监管，加载时改成 `failed` / `interrupted`。

每次状态变化（启动中、运行中、找到会话、结束）由 Main 用 `hub:changed` 推给 Renderer（公开字段，不含工作目录），Renderer 只在启动时读一次 `hub:state`，此后不轮询；用时一格是 Renderer 自己的钟。发起方是哪只猫只取两种 AgentDesk 观察到的事实：调用来自它中转的上一段对话（`parent-run`），或发起的进程环境里的账号目录变量（`CODEX_HOME`、`CLAUDE_CONFIG_DIR`、`KIMI_CODE_HOME`、`DSH_HOME`、`GEMINI_CLI_HOME`、`QWEN_HOME`）恰好对上一个已登记账号（`account-home`，只比较 realpath，不打开、不保存那个路径）；`--from` 只作标签。Gemini CLI 与 Qwen Code 由 AgentDesk 生成会话编号（`--session-id`），记录一开始就能指向它们自己的会话。

`hub:state` 另带 `accounts`（每个本机 Profile 的编号、调用方用的名字——与 CLI 名册同源的 `hubCatNames()`——和两个开关，不含路径或登录信息）、`clients`（每种客户端能否被调用、不能时的理由码、能时实际运行的命令行名称）、允许的文件夹（名字与显示用路径）和上限。档案的“调用”一段由 `renderHubCalling()` 按展开的那个本机位置渲染，远端位置不显示；开关改动经 `hub:setAccess` 只送 `profileId` 与两个布尔值，先按点的样子显示，Main 返回后以它为准，失败退回。系统页“后台对话”一块由 `renderHubSystem()` 渲染，添加文件夹只调无参数的 `hub:addFolder`（Main 打开系统选择框），移除与上限按编号和数值。说明纸条由 `AgentHubUi.installTips()` 装在整页上：带 `data-hub-tip` 的入口在悬停（命中测试，不可用的按钮也算）或键盘聚焦（`:focus-visible`）时显示，纸条进顶层、`pointer-events: none`，开着时暂时收起入口的 `title`；入口不可用时，Renderer 写在 `data-hub-reason` 里的原因作为最后一行；Esc 在捕获阶段只收起纸条。

子进程用适配器写死的参数启动，环境是该账号自己的 `launchEnv`（清掉 `CODEX_API_KEY`、`KIMI_REGISTRY_API_KEY` 和上一层的 `AGENTDESK_HUB_*`）再加 `AGENTDESK_HUB_DEPTH`、`AGENTDESK_HUB_RUN`；工作目录用 realpath 核对必须落在允许的文件夹里；非 Windows 上子进程自成进程组，停止时整组先 SIGTERM、3 秒后 SIGKILL。stderr 只排空不保存。`before-quit` 在关客户端之前先停下所有后台对话（不看“保留客户端”设置）；移除账号会停下它的后台对话。

### Settings

`settings.json` 保存主题、语言、声音档位（`soundLevel`：all / key / off，默认 key）与音量（`soundVolume`：0–100，默认 55）、会话范围/列视图、会话排序（`sessionOrder`：recent / fresh / tag，默认 recent；标签与新回复筛选不保存）、Device Lens / Agent / Slot 选择记忆、版本化 `onboarding.completedVersion/completedAt`、`meshNetworkEnrollmentEnabled`、HTTPS 信令地址和 STUN 地址。首次 Agent 事务显式把联网 enrollment 保持为 false；只有添加设备或网络动作才开启。TURN 长期 secret、短期 credential、设备私钥和 Mesh 关联密钥不进入设置。写入使用临时文件替换并保留备份。设置版本 5 把已退休功能的字段（庭院视图 `view`、提醒 `remindersOn`、庭院时间与天气 `atmosTime`/`atmosWeather`、完成账本 `ledger`、猫位置 `yardPositions`）原样收进 `retired`，不再规整、不再读取；`retired` 里已有的值优先，所以旧版本回写的默认值不会覆盖它，旧版本读新文件也不会出错。

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

Claude 命令行与 Codex 的记录另有 `lastRole`（user / assistant / null）、`lastReplyAt`（最后一条助手消息的时间）与 `replyDone`（true / false / null），从扫描器已经在读的文件末尾 64KB 取：Claude 命令行看 assistant 事件的 `stop_reason`（`end_turn` 等为回完，`tool_use` 为还在干，只装 `tool_result` 的 user 事件是工具输出），Codex 看 `event_msg` 的 `task_complete`（推理、工具调用与输出、`turn_aborted` 都不算回完）。其他客户端不给这三项。

### 会话记号

- `src/session-marks.js` 的 `SessionMarksStore` 只存在 `userData/session-marks.json`：`baselineAt`（首次启用的起点，早于它的回复不标）、五个名字、每条会话 `{ tag, seen, at }`。上限 5000 条，超出先清最久没动过的“看过”，人亲手打的标签最后才清。原子替换写入，不写任何客户端的文件，不进 Mesh。
- 会话键是 `SessionTable.markKeyOf`：本机扫到的会话用“运行位置::会话地址”（与不开设备网时的 `keyOf` 相同），只在别的设备上的会话用 `mesh::逻辑会话`。这样开没开设备网、密钥延后时退回本机扫描，键都不变，主进程也能算出同一个键。
- 新回复在主进程判断：`activity:all` 带上 `freshContext()`，`probeActivities` 对首次启用之后动过或正在写的文件读末尾（按文件版本缓存），给每个运行位置返回 `freshReplies` 与 `freshKeys`（键与回复时间）。同一份数据根被几个运行位置共用时只扫一次，键按各自的运行位置给出。
- 在跑：`writingNow` 是非归档的逻辑会话里，最近 90 秒（`YardCats.WORKING_WINDOW`）有新内容、且不知道已经回完的条数；追加型 `.jsonl` 看文件长度变化而不是 mtime。`writingKeys` 最多 32 个。数据库型客户端没有给出时为 null，合并时不当 0。
- 四个 IPC：`sessionMarks:get`、`sessionMarks:setTag`（会话键数组与 0–5，0 去掉）、`sessionMarks:markSeen`（会话键与回复时间，看过时间只往后走）、`sessionMarks:rename`（1–5 与最长 12 个字的名字）。Main 逐项校验长度、字符与数量，失败只返回固定原因码。
- 列表筛选在 `applySessionFilter` 里与搜索同一处生效，只决定 `filteredSessions`，不碰 `focusedConversationId` 与 `checkedConversationIds`；被筛掉的勾选项沿用搜索的“已选会话被隐藏”提示。

Mesh 会话聚合返回结构化失败时，Renderer 不再把当前会话设为空数组。全部/本机 Lens 改用相同的本地扫描器，但只扫描当前 catalog 关系中真实存在于本机 `profiles.json` 的 Profile；远端伪 Profile 不进入本地 IPC。该结果标记为 local fallback，SessionPointer、文件传输与 TaskPackage 直送不取用其临时位置信息；本地只读操作继续可用。

已打包 macOS 开发版还有一条精确限定的启动路径：Main 使用固定 `/usr/bin/codesign` 检查自身主可执行文件，只有 `Signature=adhoc`、无 `Authority`、`TeamIdentifier=not set` 同时成立才延后系统密钥访问。启动期 `devices:list` 请求 `MeshService.getOverview({deferKeyAccess:true})`，读取已验证的持久目录/设备快照并返回 `keyState=deferred`，不加载 KeyVault、不启动 signaling、不恢复 ProvisioningJob。Renderer 看到密钥未可用就直接走本地只读会话，不再发出一次会阻塞的 Mesh 会话 IPC。只有 Header 的“设备”这一显式用户动作会传 `requestSecureAccess=true`；解锁成功后才恢复准备任务和按 enrollment 开启联网。检测失败、Developer ID 包、Windows 与开发态均保持原路径，没有通用密钥降级开关。

ProvisioningService 把状态观察和外部界面副作用分开。`resumeActiveJobs()`、密钥解锁后的恢复与定时 `schedule()` 都以 `interactive:false` 推进：允许重新检查客户端、准备受管目录、读取安全身份指纹并提交 ready，但禁止调用 `openInstall()` 或 `launch()`。没有身份时只持久化 `waiting-login`；已有身份时只完成 Profile/Slot/Deployment，不记录打开。Renderer 的明确继续/打开请求使用 `interactive:true`，若此时同一 Job 正有后台 in-flight 检查，则等待该检查结束后重放显式推进，不能复用后台结果吞掉用户动作。

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

`src/workspace.css` 是 1.14 主窗口与全局弹窗的唯一 canonical 表现层，按 `reset / tokens / shell / components / features / themes` 组织；旧 `styles.css` 被放入低优先级 `legacy` 层，不能再通过文件尾覆盖改变三面板几何或弹窗滚动归属。最高主题层保留语义 `[hidden]` 规则，避免后写的 `display:grid` 把已隐藏视图重新显示。

- Renderer 内容区按 58px Header、38px Footer、20px 横向 padding、10px 纵向 padding、10px gap 和 222px Agent 面板布局，隔离远控使用 316px 右侧区域。Compact 表 `min-width: 0` 且没有水平滚动。
- Agent 仅以卡片呈现；运行位置始终可见，唯一位置显示为文字，多位置使用选择器。旧场景设置只保留作为兼容数据。名册最前面的“全部”卡片与点猫共同驱动同一个 `agentScope`（`pickRosterAll` / `pickRosterAgent`），不再有独立的范围开关；没有选中 Agent 时范围落在 `all`。卡片动作的落点由 `cardActionProfile(group)` 统一给出，显示与执行用同一个结果；`openAgent(agentId)` 不改变当前 Agent，所以“打开”不带动会话列表。
- Agent 与运行位置管理使用原生对象 Dialog；设备、工具、活动（界面称“收件箱”）、设置分别使用四个全局 Dialog。顶栏只留收件箱和“系统”两个直接入口：设备管理按钮在设备视角下拉里；工具与设置合成一个 `#systemDialog`（`utilityDialog` 取值 `system`），左栏 `#systemTools`、右栏 `#systemSettings`；活动弹窗即收件箱，分 `#inboxAttention`、`#inboxIncoming`、`#inboxRecords` 三段，传输记录是其中一段而不是子弹窗。原生 `#deviceLensSelect` 保留为状态与辅助技术的来源，可见控件是 `#deviceLensMenu`。
- 四个全局 Dialog 使用 `utility-dialog-shell`：Shell 自身 `overflow: hidden`，Header/Command Bar/Footer 固定，只有 `utility-dialog-content` 纵向滚动；设备中心外层 Content 不滚动，只允许设备列表与设备 Agent 列表两个命名窗格独立滚动。
- `openChildDialog()` 为帮助、传输记录、网络、权限、诊断等次级流程记录触发控件和所属 disclosure；关闭或 Esc 只移除最上层，恢复父弹窗原滚动、菜单展开和焦点。触发控件所在的菜单已经收起、又没有展开记录时，`utilityDialogFocusTarget()` 把焦点退回菜单开关。猫的档案（`#agentManageDialog`）一页五段（资料、位置、账号、调用、送走），`renderAgentManageLocations()` 逐个列出运行位置并把共用的那排动作挪到展开的位置下面；编辑、关系、移除、路径、诊断都叠在档案上面打开。`state.actionAgentId` 记录档案或额度浮层打开期间被操作的猫，`actionAgentId()`、`currentProfileId()`、`selectedProfile()` 跟随它，而会话列表仍只看 `currentAgentId()`，所以在别的猫身上做事不带动列表；运行位置的记忆统一用 `UiContext.setAgentSlot()`。弹窗高度是 `fit-content`，只用窗口高度封顶。只有明确导航工作台的动作才关闭根层。
- 皮肤是“台灯下的书桌”：`pixel.css` 顶部是正常与夜间两张颜色表（纸、桌面、木、描边、朱红、蜂蜜黄等），把既有组件 token 映射过去；文件最后一段按场景覆盖前面的规则——木质的顶栏与页脚、搁板与挂在下面的名牌（卡片的 `::before` 画名牌、`::after` 画挂绳）、账本式的会话表、朱印主按钮、档案夹弹窗、硬边灯光。窗框用四条 2px 边加一圈高光和暗边，悬停用 `--dither-hl` 的抖动网点。看的字是点阵字，只用 12px 和 24px；读的字（弹窗里的句子、提示、空状态、输入框）在文件最后的“读的字”一节通过 `--type-*` 变量换成系统正文字体 13px。图标来自 `pixel/icons.js` 的位图，经 `data:` 蒙版跟随文字颜色。按钮、数字和小标签用随应用提供的 Fusion Pixel 12px（`assets/fonts/`，SIL OFL 1.1，日文界面换日文版），只从本地加载，统一 12px 并关闭抗锯齿；内容安全策略不变。动效只改位移与透明度、可被下一次操作打断，`prefers-reduced-motion` 下全部停用；不计分。

### 声音

- `pixel/chip.js` 是所有者在试听台上批准的原样：四个声道、22 张寄存器表、每秒 60 行、16 档音量，音高先量化成 11 位频率寄存器；输出级有约 30Hz 隔直和约 10kHz 滚降。纯函数，同一张表两次渲染逐样本相同。`test/sfx.test.js` 校验寄存器取值、峰值、直流、收尾和 16 位 PCM 指纹；重调必须先经所有者试听再改指纹。
- `pixel/sfx.js` 只决定什么时候响。`EVENTS` 把应用事件映射到声音名（就是试听台“哪里响、响什么”那张表），`KEY` 是“只要要紧的”这一档会响的声音，`ATTENTION` 是窗口不在前台也会响的声音，`CHROME` 是不打断结果声的界面小声。AudioContext 只在 `unlock()`（真实的 pointerdown 或 keydown）里创建，静音档不创建；之前的请求只记进 `history()`，不排队补放。一次只保留一个 BufferSource，新的先停旧的；盖印一次最多三下、间隔 130 毫秒；逐字隔一个字、间隔不少于 90 毫秒；同名声音 120 毫秒内只响一次；半分钟没有声音就 `suspend()`。总增益 = 音量 / 100 × 1.6，与试听台相同。没有 `AudioContext` 或创建失败时全部变成记录 `unavailable` 的空操作。
- `pixel/ui.js` 把界面上发生的事翻译成事件名：名册点击（选中、点猫、再点一下）、拖动排序的 `roster-dragging` 类、会话复选框和其他控件的 `change`、`dialog` 的 `open` 属性、`details`/浮层的 `toggle`、`data-theme`、页脚逐字、`launchStart/launchEnd/copied` 三个现成钩子、收件箱数字、卡片额度的 `data-level`、`onTransfersChanged` 里第一次出现的入站传输。结果声（导出完成、导入成功、送出、失败）来自状态行：先看现成的 `data-state` / `data-tone` 是否变成 `error`，再把页脚和传输状态句子按 `STATUS_EVENTS` 里列出的词表 key 整句匹配；同一次操作最多换来一个结果声，两分钟后过期。renderer 只在 `applyUserSettings` 里调用一次 `PixelUi.setSound(value)`；系统页档位、音量与页脚静音由 `ui.js` 直接经 `manager.updateSettings` 保存。
- 主窗口收不到“有设备开始查看或控制这台电脑”的通知（宿主提示在 `src/remote/host.*` 的独立沙箱窗口里，`remoteControl:changed` 只带出站会话），所以 `remote.watch` 还没有钩子。
- 会话行的 focused 与 checked 视觉落在真实 table cell 上，不向 `<tr>` 注入会被 Chromium 当作匿名单元格的伪元素。

### 开灯与关灯

- `pixel/boot.js` 放在 `index.html` 的 `<head>` 里，先于第一帧执行：给 `<html>` 设 `data-boot="cover"` 与 `data-lamp="0"`，整扇窗是 `--lamp-night`（与 `BrowserWindow` 的 `backgroundColor: '#140e11'` 相同）。renderer 写入 `data-theme` 后开灯；`window:showing` 说明这是本进程第一扇窗还是 macOS 关窗后重开的（后者只开灯，不演其余）；`prefers-reduced-motion` 时直接到最后的样子。3 秒还拿不到颜色也照常亮出来。
- 时间表（毫秒，从开灯算起）：灯 60/140/220 三档（`data-lamp` 1→3）；搁板 160 起一条 8 帧的前沿从左向右伸出，每截搁板按自己的位置裁剪；名牌 300 起每张晚 `stagger()`（40–60ms，整组不超过半秒）落下，名牌的纸是卡片 `::before`、挂绳是 `::after`，用带 `pseudoElement` 的逐帧动画在搁板下沿裁剪；猫在名册数据到了以后、最早 420 起从搁板后面跳上来并压扁一帧；账本 700 起 6 帧摊开，会话行在数据到了且账本摊开后最多演 12 行；全部落定后页脚用 `PixelFx.type` 说第一句话，`data-boot` 变为 `done`。所有帧值来自 `path()`：落在 2px 格子上、先快后慢、相邻步子严格变小（距离太短时末尾停一帧），每一帧用 `steps(1, end)` 保持。动画的 `startTime` 对齐文档时间轴，所以占位卡被换成真卡片时名牌接着落。
- 加载中：名册数据没到时按上一次的猫数（`localStorage` 的 `agentdesk-lamp-seats`，最多 8）从 `#accountCardTemplate` 复制占位卡，`data-agent-id` 为 `lamp-seat-N`，`inert`，猫是用 `YardSprites` 画的抖动影子；renderer 第一次渲染名册时会把它们当作不在列表里的卡片移除。会话没到时在 `#sessionRows` 放 11 行 `lamp-blank-row` 点线空行，`renderSessions` 的 `replaceChildren()` 会清掉。renderer 的 `setStartupStage()` 在每个阶段派发 `agentdesk:startup`（`detail.stage`，读设备目录前另有 `detail.step = 'devices'`），两秒后页脚的 `.lamp-wait` 按阶段说在等什么。数据都到了才算启动完成；`ready` 之后 1.2 秒仍缺的部分直接到最后的样子，15 秒是总上限。
- 打开之后：名册的 `MutationObserver` 比较前后的卡片；一次最多两张增减时才演。新来的卡片在中间时用 `margin-right` 7 帧从 -194px 回到 2px 让后面的卡片挪开，在末尾时搁板那一截长出来，随后名牌落下、猫跳上来。送走的卡片被暂时放回原处（`lamp-leaving`、`inert`），猫轻跳后落下、名牌提上去，再用 `margin-right` 收拢让后面的卡片挪过来，它自己的那截搁板一直垫在下面，最后移除；renderer 在这期间重画名册会直接把它拿走。`pixel/ui.js` 只在 `PixelLamp.userCaused()`（1.5 秒内有真实的点按或按键）时让新会话行带 `fx-in` 写进来；有 `PixelLamp` 时新猫不再由 ui.js 升起。弹窗的档案夹样子在 `pixel.css`（`lamp-folder` 三档 144ms；关上用 `display`/`overlay` 的 `allow-discrete` 过渡两档 80ms）。
- 关灯：`before-quit` 第一段在 `stopAll()` 之前调用 `windowLamp.closingClients()`，只把 `ProfileRuntimeSupervisor.ownedActiveProfileIds()` 及其名字发给窗口（灯降到 2、没有客户端的猫先睡、页脚写着在关哪几个），`stopAll({ onStopped })` 每关好一个发一次 `closed`；关不掉的两条路都调用 `windowLamp.relight()`（灯回到 3、猫醒来）再发原有的 `profiles:quitBlocked`。收口成功后的最后一段由 `holdQuit()` 拦下一次退出，发 `{ step: 'quit', token }`，页面让剩下的猫依次睡下、账本 4 帧合上、灯 2→1→0，然后 `window:lampDone` 回话；Main 最多等 700ms（关窗 400ms），窗口看不见、最小化、正在加载或已崩溃时不演。macOS 关窗（不退出）先发 `close` 短短关灯再关；其他系统关窗改为直接走退出流程，窗口在关客户端期间不消失。猫睡下用 `PixelUi.pose(canvas, 'sleep')`，亮灯时 `pose(canvas, null)`。
- 每一步在 `document` 上派发 `agentdesk:lamp`（`detail.step` 是 `boot-start`、`lamp`（`level`）、`shelf`、`tag`、`cat`、`ledger-open`、`rows`、`waiting`、`ready`、`skip`、`cat-join`、`cat-leave`、`folder-open`、`folder-close`、`closing`、`client-closed`、`sleep`、`ledger-close`、`lamp-off`、`relight`、`window-close`），声音之类的呈现层挂在这里，不必读 boot.js 的内部。任何真实的 `pointerdown`/`keydown` 都让正在演的启动、来去或关灯直接到最后的样子；关灯被打断时立即回话。

## 5. 客户端与会话扫描

`apps.js` 是唯一客户端目录。每个条目声明：

- 产品显示名、平台官方包/可执行文件身份、Profile 隔离模式与默认数据目录；
- 默认会话根目录和诊断位置；
- scan 函数、活动探针；
- 是否允许启动与是否支持 Markdown 导出。

当前来源为 Claude Desktop、Claude CLI、Codex、Cursor、Kimi Code、Kimi Work。新增来源时，在目录中增加条目和独立扫描器；不要把客户端分支散落到 renderer。会话适配器必须先把物理载体归一为用户逻辑会话，不能让文件数量直接决定表格行数。

macOS 标准候选由注册表给出并在存在已知 bundle id 时重新读取 `Info.plist` 核对；Codex 当前优先定位 `ChatGPT.app/Contents/MacOS/ChatGPT` 与 `com.openai.codex`，旧 `Codex.app` 只作为同 bundle identity 的兼容候选。用户经系统选择器明确登记的 executablePath 继续作为手动能力处理。安装检查、工具扫描、诊断和实际启动共用这一个解析结果，不能各自维护另一张应用名表。

`sessions:list` 接收 profile 形状，但 main 会先规范化，再调用目录中的扫描器。会话定位和导出只接受 profile/session 标识，并从当前扫描结果重新找到可信文件。

### Codex 历史的显式保留策略

`clients/codex/history-retention.js` 是 `ProfileRuntimeSupervisor` 的默认关闭、按 canonical `sessionRoot` 明确启用的历史维护器。`agentdesk-history-retention.json` 为 `{"version":1,"enabled":true,"maxToolBytes":8192,"previewChars":512,"compressArchived":true}`；保留已有自定义值，禁用或删除策略即停止此根维护。既有监管循环启动后和每小时检查一次，另在受管客户端退出时收尾；同一时刻只启动一个周期 worker，同 Profile 重开等待在途维护，不新增 daemon、不终止客户端。已启用的默认/custom 根同样可参加周期维护，未启用的根不写状态文件。

手动 `node src/clients/codex/history-retention.js --root <绝对根>` 只预览，`--apply` 才写；`--apply --enable-policy` 只在成功后创建缺失策略，不覆盖已有值。客户端打开时，`--open-archived` 只处理至少一小时前更新的已归档完整轮次；周期维护另使用 `--open-idle`，纳入超过一天无更新、无未知/未完成轮次、原始 rollout 仍在此根且无进程持有它的未归档会话。状态更新复核与 item JSON 的 CAS 在每批十六项提交前执行。自动 worker 有 40 秒工作预算和 60 秒进程上限，超时事务由 SQLite 回滚、后续周期重试；根级 PID 锁防止双重维护，死亡 worker 锁可恢复。唯一 `agentdesk-history-retention-status.json` 原子覆盖本次起止、结果和实际 worker SHA-256，不积累运行日志。

维护只改已结束轮次（completed / interrupted / failed）中成功项的 paginated `thread_items.item_json`：生成图片先逐字节验证私有 PNG，缺失时保全到同根 `generated_images/history-media/<sha256>.png`，同哈希共享文件，再清空冗余 Base64；成功工具超长文本保留首尾和裁剪标记，嵌套序列化的 MCP 结果逐层处理文本并保留媒体/资源。用户与助手原始 JSON 哈希不变；失败、未完成、补丁、图片、资源和未知结构化数据保留，realtime items、轮次、索引与继承关系不改。完整性检查后 VACUUM 回收空闲页，自动仅在客户端关闭、空闲达 64 MiB 且预算允许时执行；在线先让空闲页复用，避免 VACUUM 把整库写入被读事务钉住的 WAL。归档原文只对无进程持有且闲置一小时的 `.jsonl` 使用 macOS 透明压缩，逐文件 SHA-256 不变并实际节省空间才原子替换；手动可加 `--compress-archives`，周期压缩最多 20 秒并服从总预算。暂存及时移除，旧的本模块私有暂存有界收口。当前其他原生 `.zst` 消费者未全部适配，继续保持 `local_thread_store_compression=false`，不通过改格式隐藏记录。原生提供等价维护 API 后退役本适配器；未知 schema/进程检查失败一律延期。

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
recruit:discover / recruit:discoverFolder / recruit:cancelDiscover / recruit:register
recruit:createAccount / recruit:inspectItem / recruit:pickItem / recruit:importItem
credentials:apply / credentials:status
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
window:lampDone / window:showing            （Main → Renderer 的单向通知是 window:lamp）
hub:state / hub:setAccess / hub:addFolder / hub:removeFolder / hub:setMaxConcurrent / hub:stopRun   （Main → Renderer 的单向通知是 hub:changed）
sessionMarks:get / sessionMarks:setTag / sessionMarks:markSeen / sessionMarks:rename
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

## 9. Agent 卡片

卡片显示同一 Agent 的运行位置、活动和可信额度。卡片额度按钮与名册的额度总览共用原生浮层，按当前入口显示本号周期和刷新，或显示跨账号快照。额度浮层独立于会话网格。猫由 `src/yard/cat-art.js` 的批准素材逐帧画出：`pixel/cats.js` 的 `createPlayer()` 为每块画布记下外观、循环状态与正在播的一次性动作，按动作自己的帧率算出当前帧，帧号变了才重画；浏览器层只用一个按“下一次换帧”定时的计时器，`IntersectionObserver` 判断画布是否看得见，`visibilitychange` 时停，`prefers-reduced-motion` 时只画第一帧。卡片把活动状态和能量格的 `data-level`（只在 `data-trusted="true"` 时）交给 `PixelUi.setCat()`，由 `YardCats.actionFor()` 选动作；同时在跑的条数（本机 `writingNow` 与调度中枢正在跑的段数取大）经 `YardCats.busyAction()` 变成干活、忙或抓狂，条数也作为 `papers` 交给放映机画纸摞，抓狂帧的 `nudge` 由放映机在画的时候以半格为单位加上；名牌状态那一行写“N 条在跑”，新回复的条数接在同一行后面，信封按钮在猫的左上方；`PixelUi.catAct()` / `catRelease()` / `pose()` 是开灯与关灯和其他界面用的一次性动作入口。旧庭院场景及其设置入口已退出窗口。账号、会话、头像配置及旧版回退所需的偏好继续由各自的既有文件管理。

## 10. 测试与构建

```bash
npm run check
npm run check:docs
npm test
npm run accept:ui
npm run build:mac:dir
```

本机回归结果统一见[验证记录](VALIDATION.md)。隔离双端真实 Electron E2E 在局域网直连与本机 signaling 两种路径均复跑完成认证、签名目录事件/库存、显式刷新、SessionPointer、184,333 字节文件与合成屏幕；该 runner 尚未发送 TaskPackage，因此它既不是直送数据面证据，也不是物理双机或真实 NAT/TURN 证据。

物理证据单独存在：两台 Mac 在同一局域网通过 host/UDP 建立认证 DataChannel，562,009 字节库存中的 9 个 Slot 与 638 条 SessionReplica 完整落库，显式刷新与 4 分钟全快照把 revision 从 7 推进到 8 和 9，连接连续 5 分钟无错误或断开。该记录不覆盖远控媒体/输入权限、断网/睡眠恢复、公网 NAT/coturn 或 Windows。

`npm run accept:ui` 使用临时 userData 启动真实 Electron 窗口，不读取或改写所有者配置，也不触发剪贴板、外部应用或远端网络。窗口任务路径包括：新增全新首 Agent 的真实本机事务与无网络断言、首次使用重启恢复且不生成默认 Profile、设备任务向导固定 Shell/分层状态，以及 TaskPackage 直送资格和接收阶段投影；原有 58/222/316/38 固定几何、Compact 无横滚、会话选择、卡片名册、三语/明暗主题、父子弹窗、小视口、目录对象、传输草稿和 Remote Surface 契约继续覆盖。脚本已按 2026-11-23／24 的界面重新梳理更新：卡片结构、名册“全部”、会话工具栏“送出”、猫的档案四段、系统页、收件箱的记录段、从空台面开始的首次使用，以及弹窗跟着内容长高后固定区的量法。它会打开真实窗口；需要不打扰使用时，可以用一个把窗口的显示与聚焦改成空操作并启用 mock Keychain 的入口来运行同一份脚本，结果以 [验证记录](VALIDATION.md) 为准。直送窗口验收只证明 UI 资格、状态与明文码不可见，不代表真实 WebRTC 数据面已经传过 TaskPackage。

成品验证分成两层。`verify-electron-package-integrity.js` 不启动应用，直接证明 `app.asar` 存在、`default_app.asar` 不存在，流式复算每个常规文件的整文件与 4 MiB 分块 SHA-256，拒绝缺失元数据、链接、范围空洞/重叠和尾部载荷；`RunAsNode` 仅作为固定 CLI launcher 的兼容 fuse 保留，`NODE_OPTIONS`/inspect 关闭、embedded integrity/only-load-from-ASAR 开启，archive header 再绑定 macOS `Info.plist` 或 Windows PE 的唯一 `INTEGRITY/ELECTRONASAR`。历史 macOS unpacked 成品的 118/118 结果只对应当时产物，不代表当前源码。`packaged-first-use-smoke.js` 才会对同一确切 `AgentDesk.app`、`win-unpacked` 或带版本 portable 使用临时 userData 连续启动三次，核对固定窗口、首次初始化/恢复、零默认 Profile、零 Mesh 网络，以及原始启动句柄和回环调试端点清理；随机 launch token 与 Browser command line 防止同机其他页面冒充本次产物。当时本机确切 `release/mac-arm64/AgentDesk.app` 已使用真实语义开关 `--macos-ci-mock-keychain` 通过这三次启动：runner 先证明 bundle 是无 `TeamIdentifier` 的 ad-hoc 签名，再在每次 Browser command line 中核对唯一原生 `--use-mock-keychain`，报告为 `keychainMode=mock`。这只证明该字节在 mock Keychain 下的打包与首次使用事务；新的 GitHub macOS `main` CI 运行仍待结果，且该模式不验证 `safeStorage` 的 macOS 系统 Keychain/OS 密钥保护。Developer ID、签名公证、Draft/公开重下载和物理干净机继续使用系统 Keychain，并仍是开放门禁。

发布事务再高一层：`github-release-gate.js` 与 Preview-only workflow 把 `stableAllowed=false`、精确 DMG + portable + `SHA256SUMS.txt`、Draft 双原生端重下载、发布后无 token 匿名公开重下载、摘要/清单/字节一致、失败回 Draft 与 candidate-burned 固化为门禁；诊断只保留为 Actions artifact，不进入 Release。发布安全测试只证明门禁逻辑，尚未用真实签名凭据、受保护 `preview-release` 环境和真实 Tag 执行，因此当前没有公开 Preview。

测试除了扫描器和纯函数，还包含以下边界契约：

- preload/main 不出现会话执行 IPC；
- 已退休的执行与自动交接编排模块不存在；focused/checked 会话只形成临时动作集合，并只调用最小定位格式。TaskPackage 只从一条聚焦本机会话显式建立不可变快照；
- 工具发现不携带协议或会话参数；
- package 不包含会话协议 SDK；
- Electron 成品必须只从 `app.asar` 加载且匹配五项 fuse；`RunAsNode` 的调用面不得超出现有 `cli-discovery.js` 与 `clients/codex/quota.js` 两个固定 launcher（外加用户启用的 `clients/codex/history-retention.js` 维护进程）；
- 成品首次使用 smoke 必须使用同一确切产物完成三次启动，产物类型、版本、UI、首次使用状态、零 Mesh 网络、进程与回环调试端点都有白名单；
- Preview 发布只接受受保护的 Preview Tag、精确三资产、Draft/公开状态与摘要/实际下载字节一致；公开后失败必须回 Draft 并烧毁候选版本；
- 工作台只渲染 Agent 卡片和会话列表。会话操作集中在会话工具栏：复制会话信息（唯一填充主按钮）、打开目录、导出，以及包含“发送到设备”和“交接任务”的“送出”菜单。
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

## 本批职责收敛

- `renderer/tool-center.js` 拥有工具库存、进度及渲染；主 Renderer 注入窄 manager 和当前 Profile 查询，不复制工作台状态。
- `main/ipc/local-reads.js` 通过 Main 的 trusted registrar 注册会话、活动和额度读取，保留来源验证与本机 Profile 重查。
- `activity.js` 每轮按适配器与 realpath 去重扫描；Codex 使用 `sessions.codexRecordIdentity` 的有界、按文件版本缓存的首行身份。`fileCount` 保留物理诊断含义，`sessionCount` 和活动计数按用户根去重，内部分支不贡献活动，最新归档根不计此刻活跃。
- `identity-groups.mergeActivity` 按设备与不可逆 sourceKey 去重活动计数。sourceKey 是来源目录标识，不用于账号身份合并；无来源证据的记录保持独立。
- 额度卡片、总览和当前账号详情共用可信源、新鲜度与同绑定冲突判断；公司 API 没有订阅额度时显示未知。
- `workspace.css` 独占上下文菜单样式；剩余 legacy 组件未经过全状态迁移，不整文件删除。旧账本/提醒设置仅保留读取迁移，活动轮询不再写账本。
