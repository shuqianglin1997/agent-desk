# Personal Agent Mesh 开发交接与剩余任务清单

> 交接日期：2026-08-12
>
> 当前分支：`main`
>
> 规划基线：`docs/PERSONAL_AGENT_MESH_PLAN.md` 1.9，状态 `OWNER APPROVED — IMPLEMENTATION AUTHORIZED`
>
> 本轮开始时远端基线：`b57670ad551b6b61467d7afcc19d24caae6ea882`
>
> 文档范围：当前 UI 交互状态重构的工作现场，以及批准规划中所有仍未关闭的已知开发、验证和发布任务。

## 1. 接手结论

当前代码是一个可继续开发的 **WIP 检查点**，不是可发布完成态。

- 规划 1.9 已单独提交并推送到远端 `main`。
- UI 已开始从旧的 Profile 中心状态迁移到 Agent、Device Lens、AgentSlot、Conversation 和 SessionReplica 独立状态。
- 新增的纯状态机测试 8/8 通过，静态语法检查通过。
- 完整测试当前为：329 项，323 通过，5 失败，1 项仅平台跳过。
- 5 个失败均为旧 UI 静态测试仍断言旧结构；接手者应先更新测试契约并确认实际行为，不能为了让旧正则通过而恢复旧状态模型。
- 这一版尚未完成 1040 × 840 Electron 真窗口的人工视觉与任务路径验收。
- 两台物理电脑、真实公网 NAT/coturn、macOS/Windows 权限与输入矩阵仍未关闭；不能把单机双端点测试称为 P2P 已正式验收。

## 2. 接手前强制门禁

每位接手者在规划、改代码或运行会产生外部副作用的操作前，必须：

1. 从第一行到最后一行完整阅读 `docs/PERSONAL_AGENT_MESH_PLAN.md`，摘要不能替代。
2. 确认文件仍为 `OWNER APPROVED — IMPLEMENTATION AUTHORIZED`；若回到 `DRAFT FOR OWNER REVIEW`，立即停止产品代码实现。
3. 检查当前分支、工作树与远端提交，不覆盖不属于自己的改动。
4. 保持固定 1040 × 840、单列七行主窗口骨架。
5. 保持庭院/经典两种 Presenter 共用同一业务状态。
6. 保持“复制会话信息”为会话区唯一填充主按钮，内容仍只有路径和坐标。
7. 保持 Agent 是展示主轴、Device 是筛选轴、Slot 是副作用动作落点。
8. 不让普通 Main Renderer 接触 SDP、媒体轨、采集 source、TURN 凭据、私钥或通用远程命令。
9. 不运行 `verify_all` 或等价命令，除非所有者在当前对话明确要求。

上下文压缩、中断恢复、换人、切分支、合并或基线变化后，必须重新完整阅读规划。

## 3. 当前 WIP 已经实现的内容

以下内容已经进入本次工作树，但仍需第 5 节的测试和真窗口验收。

### 3.1 独立 UI 上下文

新增 `src/ui-context.js`，将以下状态从旧 `selectedProfileId` 中拆开：

- `workspaceMode`
- `selectedDeviceLensId`
- `agentScope`
- `selectedAgentIdByDeviceLens`
- `selectedSlotKeyByAgentAndLens`
- `focusedConversationId`
- `checkedConversationIds`
- `selectedReplicaKeyByConversation`
- `selectedDeviceDetailId`
- `activeRemoteSessionId`
- `transferDraft`

已实现的纯状态迁移包括：

- Device Lens 只恢复该 Lens 的 Agent 记忆，不自动选择第一项，不改 Agent scope。
- 设备详情“查看全部会话”和“查看这个 Agent 的会话”采用原子导航。
- 会话行聚焦与批量勾选分离；有勾选时批量集合优先，否则使用聚焦项。
- 刷新只清理失效对象，不自动补选 Agent、Slot 或会话。
- 全部设备视角的多副本会话要求显式来源；具体 Device Lens 的唯一副本可直接解析。
- SessionPointer 草稿和文件发送草稿互相独立。
- 远控“返回工作台”保留查看会话，“断开”才清除活动会话。

对应测试在 `test/ui-context.test.js`，当前 8/8 通过。

### 3.2 Renderer 迁移

`src/renderer.js` 已开始使用 `window.UiContext`：

- 启动和刷新不再自动选中第一条会话。
- render/filter 不再承担“修复选择并挑第一项”的副作用。
- Device Lens、Agent、Slot 切换不再无条件清空搜索词和会话选择。
- `selectedProfileId` 仅暂时保留为当前 Slot 的兼容派生缓存；它不应再成为业务真相源。
- 会话点击只改变 focused；checkbox 只改变 checked。
- 复制、发送、打开位置使用解析后的确切 SessionReplica。
- 多副本来源未解决时，检查器展示来源选择器并禁用相关副作用动作。
- 设备中心左侧选择只改变 `selectedDeviceDetailId`，不等于顶栏 Device Lens。
- 设备详情主任务重组为“查看/控制、查看全部会话、发送文件”；连接进入状态/更多菜单。
- 设备内 Agent 条目通过 Device + Agent + scope 的原子入口进入会话。

### 3.3 会话、文件与传输中心分离

`src/index.html` 和 `src/renderer.js` 已拆出：

- `sessionSendDialog`：只创建 SessionPointer。
- `fileSendDialog`：只发送用户从系统选择器选择的文件。
- `transferCenterDialog`：只显示历史、状态、重试和取消。

当前文件选择与接收路径仍由 Main 的系统选择器决定；Renderer 只提交稳定设备 ID 或传输 ID。

### 3.4 远控返回与断开分离

以下文件已接入新的安全返回路径：

- `src/mesh/main/remote-control-service.js`
- `src/main.js`
- `src/preload.js`
- `src/remote/console-preload.js`
- `src/remote/console.js`

`returnToWorkspace()` 当前语义是：

1. 释放所有远端输入与控制权；
2. 隐藏第六行 Remote Surface；
3. 保持 viewing 会话存在；
4. 通知主 Renderer 返回会话工作台；
5. 只有显式 disconnect 才停止媒体会话。

### 3.5 UI 层级与多语言

本次工作树还包含：

- 顶栏低频“传输记录”入口；
- 会话来源选择器与未解决提示；
- 设备连接状态与详情任务重新分层；
- Agent/Slot 文案澄清；
- 中文、英文、日文新增 key 同步；
- Remote Console 紧凑布局调整；
- 默认 Presenter 设置调整为紧凑经典名册。

## 4. 当前改动文件地图

### 状态与测试

- `src/ui-context.js`：新 UI 状态机。
- `test/ui-context.test.js`：状态结果测试，当前通过。
- `test/ui-redesign.test.js`：UI 契约测试草稿，部分断言仍需更新。

### 主窗口

- `src/renderer.js`
- `src/index.html`
- `src/styles.css`
- `src/settings.js`
- `src/i18n/zh.js`
- `src/i18n/en.js`
- `src/i18n/ja.js`

### 远控返回路径

- `src/mesh/main/remote-control-service.js`
- `src/main.js`
- `src/preload.js`
- `src/remote/console-preload.js`
- `src/remote/console.js`
- `src/remote/console.html`
- `src/remote/console.css`

## 5. P0：接手后先完成，恢复绿色基线

### P0-1 更新 5 个过期 UI 测试

当前完整测试的 5 个失败如下。

#### 1. `test/mesh-ui.test.js`

失败用例：`文件传输路径只来自 Main 系统选择器，Renderer 只提交设备和传输 ID`

旧断言错误地要求 `chooseFilesBtn` 与 `confirmSessionSendBtn` 位于同一混合弹窗。应改为验证：

- `fileSendDialog` 包含 `fileSendTarget` 和 `chooseFilesBtn`；
- `sessionSendDialog` 包含 `sessionSendTarget` 和 `confirmSessionSendBtn`；
- 两个弹窗不混入对方的控件；
- Renderer 通过 `UiContext.createFileDraft()` 创建文件草稿；
- 文件路径仍只来自 `transfers:chooseFiles` 的 Main 系统选择器。

#### 2. `test/ui-redesign.test.js`

失败用例：`批准后的 Agent 与会话操作层级：日常动作常驻，管理和显示折叠，选择后才出现复制与发送`

旧断言仍要求清空按钮调用 `setAllVisibleSessionsSelected(false)`。应改为验证：

- 清空动作调用 `clearSessionActionSelection()`；
- 后者使用 `UiContext.clearConversationActions()`；
- focused 与 checked 分离；
- 选择条只由真实动作集合控制显隐。

#### 3. `test/ui-redesign.test.js`

失败用例：`设备中心在第六行采用设备列表加所选详情，只列所选设备上的全局 Agent`

旧断言仍寻找顶层 `selectedDeviceId` 和直接写 `state.selectedAgentId`。应改为验证：

- 设备详情使用 `state.ui.selectedDeviceDetailId`；
- 左侧选择调用 `UiContext.selectDeviceDetail()`；
- “查看全部会话”调用 `UiContext.viewDeviceSessions()`；
- 设备 Agent 条目调用 `UiContext.viewDeviceAgentSessions()`；
- Device Lens、Agent 和 scope 在一次状态迁移中到位。

#### 4. `test/ui.test.js`

失败用例：`会话浏览支持仅用于复制会话信息的轻量多选，主操作突出且不恢复交接编排`

旧断言仍寻找 `selectedSessionKeys: new Set()`。应改为验证：

- `state.ui.checkedConversationIds` 保存显式批量集合；
- `state.ui.focusedConversationId` 保存检查器焦点；
- checkbox 使用 `setSessionChecked()`；
- 行点击使用 `focusSession()`；
- `UiContext.actionConversationIds()` 决定动作集合；
- 复制文本仍通过 `SessionLocation.format()`，格式不变。

#### 5. `test/ui.test.js`

失败用例：`组内非主形态可单独管理：控制条形态切换器把 selectedProfileId 落到具体槽位（两视图共用）`

该测试名称和断言仍是 Profile 中心语义。应重命名并验证：

- 控制条表示明确的 AgentSlot/运行位置；
- Agent 可以存在但当前 Slot 为空；
- 无 Slot 时显示“选择运行位置…”而不是自动选第一项；
- change 事件调用 `selectSlot()`；
- `selectSlot()` 只写 `UiContext.setSlot()`，不重新加载会话或清空搜索；
- `selectedProfileId` 只作为兼容派生缓存，不作为测试主契约。

完成后运行完整测试，不能只用正则绕过行为差异。

### P0-2 把新状态机加入静态检查

`npm run check` 当前没有包含 `src/ui-context.js`。在 `package.json` 的 check 脚本中加入：

```text
node --check src/ui-context.js
```

### P0-3 增加 Renderer 级任务结果测试

纯状态机测试已经覆盖核心迁移，但还需要验证 Renderer 真正按状态机使用。至少补齐：

- 初次加载无自动会话选择。
- Device Lens 无记忆时不选第一 Agent，也不把 scope 改成 all。
- 从设备详情进入“此设备全部会话”后，workspace/Lens/scope/选择集合准确。
- 从设备 Agent 条目进入后，Lens/Agent/scope/Slot 一次到位。
- Agent 和 Slot 切换保留搜索词以及仍有效的 focused/checked 会话。
- 搜索和 render 不写用户选择。
- 多副本来源未解决时，复制、发送、打开位置均不可执行，并共享同一个来源选择修复入口。
- `selectedDeviceDetailId` 与顶栏 Lens 不同的场景不会混称。
- SessionPointer 草稿不会读取文件草稿，文件草稿不会读取会话选择。
- 远控返回释放输入并保留 viewing 指示；disconnect 后指示消失。

### P0-4 完成 1040 × 840 Electron 真窗口验收

尚未完成的人工/自动视觉路径：

- 纯本地模式启动、庭院/经典切换、账号 CRUD、搜索和复制会话信息无回归。
- Mesh 已初始化但没有选 Agent 时的真实空状态。
- 全部设备/单设备 × 当前 Agent/全部 Agent 四种会话范围。
- Device Lens 切换后每 Lens Agent 记忆正确。
- 设备中心左侧选择与顶栏 Lens 相互独立。
- 设备详情三个主任务和更多菜单的主次关系。
- 单会话 focus、显式多选、取消选择和选择条显隐。
- 全部设备视角的多副本来源选择、禁用态和修复入口。
- SessionPointer、文件发送、传输中心三个弹窗互不串状态。
- Remote Surface 返回与断开分别验证；返回后不可在隐藏画面继续输入。
- 中文、英文、日文下无截断、重叠和缺 key。
- 明暗主题、键盘焦点、reduced-motion、状态不只靠颜色。

建议使用临时 Electron userData 做破坏性场景，避免污染所有者现有配置；任何 reset/revoke/delete 前先确认目标是临时数据目录。

### P0-5 修复真窗口验收发现的问题

重点检查：

- 第六行高度和会话表唯一滚动区是否仍成立；
- 新增来源选择器后检查器是否溢出；
- 选择条在无动作集合时是否真正隐藏；
- 弹窗关闭后 `transferDraft` 是否按 kind 正确清除；
- 设备详情为空时 kind/status 是否清理干净；
- 远控返回事件重复到达时是否幂等；
- viewing 会话后台保留时，顶栏活动提示是否准确；
- 离线 replica 复制可用但打开/定位禁用是否符合规划；
- 所有按钮的禁用原因是否有一致文案。

### P0-6 恢复绿色验证

交付前至少执行：

```bash
npm run check
node --test test/ui-context.test.js
npm test
git diff --check
```

期望：

- `npm run check` 退出码 0；
- `test/ui-context.test.js` 8/8 或更多全部通过；
- `npm test` 0 失败，Windows 专属测试在非 Windows 上允许保持明确 skip；
- `git diff --check` 无空白错误。

不要在没有所有者明确要求时运行 `verify_all`。

## 6. P1：UI 交互模型仍未完成的产品开发

### P1-1 完成 Agent、AccountBinding、AgentSlot 三种对象的管理流程

当前只是把 Mesh 模式按钮改名为“新增运行位置 / 编辑此运行位置 / 移除此运行位置”；底层仍主要走现有 `profiles:add`、`profiles:update` 和 Profile 表单。规划 11.11 第 7 条还没有完整实现。

待做：

- 新增入口先让用户选择：新 Agent、已有 Agent 的另一账号绑定、本机新的运行位置。
- Agent 编辑只负责全局名称、猫外观、分组、备注和账号绑定。
- Slot 编辑只负责启动、路径、重扫、诊断和本地说明。
- 移除流程明确区分：移除此运行位置、移除此登录账号、删除整个 Agent。
- 三种删除范围都展示影响预览，均允许删到零，不删除官方客户端数据。
- 无可靠账号 ID 时实现“已有登录的新位置 / 已有 Agent 的另一账号 / 全新 Agent”三选归属。
- 为 Agent merge/split/delete 和目录 tombstone 接入真实语义 IPC；目前主窗口没有规划中完整的 `agentCatalog:*` / `agentSlots:*` 管理 IPC。

### P1-2 继续消除 `selectedProfileId` 的业务依赖

当前 `selectedProfileId` 只应是 `selectedSlotKey` 的兼容缓存，但 Renderer 仍有若干直接读取点，例如额度、诊断上下文、活动跳转和旧 Identity Group 渲染。

待做：

- 为所有副作用动作建立统一 `selectedSlot()`/`resolveActionSlot()`。
- 任何打开、编辑、移除、诊断、路径、额度刷新动作都必须解析到明确 `deviceId + profileId`。
- 全局 Agent 展示、设备筛选和 Slot 动作目标不再通过 Profile ID 互相覆盖。
- 完成迁移后再评估是否能删除兼容字段；不能直接删除导致纯本地回归。

### P1-3 完成会话动作来源的一致性

待做：

- copy/send/open/reveal/export 对同一会话使用同一 `resolveReplica()` 结果。
- 全部设备视角多个候选时绝不按本机、在线或最新时间静默替用户确认。
- 明确选择的 replica 按 conversation 记忆；失效时只清除该记忆。
- 设备 Lens 收敛为唯一副本后可直接执行，切回全部设备不伪造新的显式选择。
- 多选跨设备 SessionPointer 为每条会话保存自己的确切 replica。
- 弱标识会话宁可两行，不按标题、项目和时间模糊折叠。

### P1-4 完成焦点、勾选和过滤生命周期

待做：

- 明确 focus 超出当前过滤结果时是保留详情还是清除，并以规划的“仍有效则保留”为准统一实现。
- checked 项被搜索隐藏时继续保留选择，但界面要能说明隐藏选择数量或提供清除入口。
- scope/Lens 改变后，只清除真正超出新数据范围的项。
- 刷新、排序、搜索、切换精简/详细视图不能改变动作集合。
- 空列表不能自动制造 focus。

### P1-5 完成设备中心的任务状态与异常路径

待做：

- 所选设备详情为空、设备刚被撤销、设备离线和快照过期的完整状态。
- “查看/控制”按权限和在线状态给出准确原因，而不是统一禁用。
- 连接只作为按需建立、重试和诊断状态；避免重新成为与用户目标并列的重复主任务。
- “查看全部会话”和“查看这个 Agent 的会话”保留搜索词并使用原子迁移。
- 设备 Agent 列表只引用全局 AgentIdentity，不创建第二套可编辑对象。
- 远端 Slot 的路径/诊断保持只读，第一版不从控制端改写目标 profiles.json。

### P1-6 完成传输草稿和传输中心体验

待做：

- 弹窗切换、关闭、失败重试后草稿不串 kind、不复用旧会话选择。
- SessionPointer 发送前逐条确认 replica 已解决。
- 文件发送只从设备详情或独立文件入口创建，不读取 focused/checked。
- 传输中心的 waiting、transferring、completed、failed、cancelled、expired 状态文案完整。
- retry/cancel 的可见条件与 Main 真实状态机一致。
- 同一来源/目标设备、离线目标、本地队列、磁盘不足和校验失败给出不同反馈。

### P1-7 完成远控后台查看提示

待做：

- 返回工作台后在顶栏或状态栏明确显示仍有几路 viewing 会话。
- 从提示可重新进入活动 Remote Surface。
- “断开此设备”和“断开全部”作用范围清楚。
- Remote Surface 隐藏前必须完成输入释放；任何错误路径也不能留下不可见控制。
- 多路会话返回时保留当前 viewing 目标，断开一条后正确选择剩余提示或清空。
- 加入服务层静态/行为测试，证明 `remote-console:return` 不调用 `stopSession()`。

### P1-8 完成无障碍、主题与文案校对

待做：

- 所有新增按钮、radio、dialog、details 有可读 label、焦点顺序和键盘操作。
- 多副本选择、远控输入目标、在线/离线状态不能只靠颜色。
- reduced-motion 下不依赖持续动画表达关键状态。
- 三语 key 集合继续保持一致，英文/日文不只做直译，要检查控件宽度。
- 删除残余“账号/Profile”混称；普通界面默认只暴露 Agent 与运行位置，AccountBinding 只在归属/合并/诊断冲突中出现。

### P1-9 更新产品与内部文档

UI 真窗口验收通过后，同步更新并核对：

- `docs/PRODUCT.md`
- `docs/SCENARIOS.md`
- `docs/INTERNAL.md`
- `docs/FUNCTION_AUDIT.md`
- `docs/ROADMAP.md`
- `README.md`

不要在实现尚未验收时把 WIP 写成已交付事实。若所有者批准的交互基线发生变化，先更新规划决策记录，再改代码。

## 7. P2：Personal Mesh 仍未关闭的真机、网络与发布门禁

以下不是要求重写已有纵向链路，而是批准规划里仍然明确未完成的验收和加固。

### P2-1 Phase 1：两台物理电脑认证数据通道

- 两台真实设备完成配对、成员证书校验和认证 DataChannel。
- 验证一端离线、撤销、重放、版本不兼容和认证失败路径。
- 形成可复现记录；单机两个隔离 userData 不能替代该门禁。

### P2-2 Phase 1：真实公网 NAT 与 coturn

- 家庭 NAT、不同网络、CGNAT、IPv4/IPv6。
- UDP 可用、UDP 被禁、TCP/TLS 中继。
- 强制 TURN 回退，确认 UI 显示直连/中继与准确失败原因。
- 验证信令失效后已建立连接继续存在。
- 记录 TURN 带宽、连接时间和失败率。

### P2-3 Phase 2/3：目录和库存长连接

- 两台物理设备持续同步远端库存。
- inventory revision 缺口、分页、16 MiB 上限、大库存和断网恢复。
- 目录事件补齐、并发编辑、merge/split/delete base revision 冲突。
- 离线旧 inventory 不得复活 tombstone Agent。
- 同一强账号标识跨设备只形成一个 Agent；同设备不同账号不误合并。
- 同一强会话标识折叠为一个 ConversationIdentity，并保留确切 replicas。

### P2-4 Phase 3：会话身份与真实数据矩阵

- Codex 根会话、多次 compacted/context_compacted、guardian/subagent/sidechain。
- active/archive 并存与父记录缺失 diagnostic-orphan。
- Claude sidechain 等等价内部记录。
- `cwd` 只形成 ProjectBinding 候选，不制造 ProjectIdentity。
- 大量会话下 Renderer 分页、搜索和排序性能。

### P2-5 Phase 4：跨平台 SessionPointer 与项目映射

- macOS 路径到 Windows 路径、Windows 到 macOS 双向映射。
- Git remote/根指纹建议、多候选、非 Git、文件缺失和版本不一致。
- 在线直连、发送端本地离线队列、源重新上线重试、过期和取消。
- 来源绝对路径绝不能作为目标端可执行路径。
- 服务端离线邮箱仍未授权；若以后需要，先设计目标设备专用公钥信封并单独评审。

### P2-6 Phase 5：文件传输物理与大文件矩阵

- macOS ↔ macOS、macOS ↔ Windows、Windows ↔ macOS、Windows ↔ Windows。
- 大文件、多个文件、慢网、断线续传、取消、重试。
- 磁盘不足、哈希失败、同名文件、安全改名。
- 路径穿越、符号链接、目录、超限和恶意 manifest。
- 完成后暂存清理，取消/迟到消息不能删除已完成用户文件。

### P2-7 Phase 6：真实屏幕采集与权限

- macOS Screen Recording 首次授权、拒绝、撤销和重启要求。
- Windows Graphics Capture/Desktop Duplication 真机路径。
- 多显示器、显示器热插拔、Retina/非 Retina、旋转和缩放。
- 直连与中继下画质、帧率、暂停、恢复和显示器切换。
- 被控端常驻提示、停止、锁屏、睡眠和应用退出。

### P2-8 Phase 7：真实输入控制

- Windows helper 真机编译、签名、打包与启动。
- macOS Accessibility 授权、拒绝和撤销。
- 四向 macOS/Windows 控制矩阵。
- DPI、多显示器坐标、键盘布局、快捷键、IME composition、滚轮和鼠标按钮。
- UIPI/UAC 限制和安全桌面明确失败。
- 切换目标、断线、崩溃、失焦、紧急停止、helper 心跳超时全部释放按键。

### P2-9 Phase 8：四设备控制台与带宽预算

- 四台物理设备同时连接。
- 一路高质量活动流，后台三路 360p/2fps 缩略图。
- 单屏/2×2、快速切换输入目标、上一目标释放控制。
- 高延迟、丢包、乱序、Wi-Fi/有线切换。
- 统计只保留延迟、码率、帧率、丢包和路径，不泄露 IP/端口/SDP。

### P2-10 发布、安装与恢复

- macOS Developer ID、notarization、helper 双架构和 TeamIdentifier。
- Windows portable 与安装版差异、helper 构建和签名。
- 升级、协议降级、数据库迁移失败和 Mesh 禁用回滚。
- 删除 mesh.db 不影响 profiles.json、settings.json、官方会话与项目文件。
- 信令/TURN 容量、限流、短期凭据和服务故障演练。

### P2-11 安全与隐私矩阵

- 协议 fuzz、非法 schema、超大消息、重放和过期。
- 邀请暴力尝试、中间人信令、恶意已配对设备和撤销竞态。
- 文件路径穿越、符号链接逃逸、输入洪泛、剪贴板超限。
- 诊断脱敏，不输出会话标题正文、原始账号 ID、路径隐私、密钥、邀请码或 TURN 凭据。
- 服务端不能解密 Agent 目录、会话引用、文件、屏幕或控制输入。

### P2-12 Phase 9：无人值守

状态仍是 **未授权、未实现**。

在所有者单独批准系统服务、开机启动、锁屏策略、安装版、恢复与更高安全标准前，不得开始实现，也不能借远控修复顺便加入自动同意或后台高权限服务。

## 8. 推荐接手顺序

1. 完整重读规划并核对远端提交。
2. 运行第 9 节命令复现当前 5 个失败。
3. 先更新 5 个过期测试，保持 1.9 状态模型不倒退。
4. 把 `src/ui-context.js` 纳入 check。
5. 补 Renderer 任务结果测试。
6. 用临时 userData 完成 1040 × 840 真窗口路径验收。
7. 修复运行时和布局问题，恢复 `npm test` 全绿。
8. 完成 P1 的 Agent/Binding/Slot 对象管理，而不是继续只换按钮文案。
9. UI 通过后更新产品文档。
10. 再按 Phase 门禁安排两台物理电脑、真实 NAT/coturn 和跨平台权限矩阵。

## 9. 当前可复现验证结果

2026-08-12 在本交接工作树上执行：

```bash
npm run check
```

结果：通过。注意 check 脚本尚未包含 `src/ui-context.js`，该文件另行执行 `node --check` 已通过。

```bash
node --test test/ui-context.test.js
```

结果：8 项通过，0 失败。

```bash
npm test
```

结果：

```text
tests   329
pass    323
fail    5
skipped 1
```

失败名称：

1. 文件传输路径只来自 Main 系统选择器，Renderer 只提交设备和传输 ID
2. 批准后的 Agent 与会话操作层级：日常动作常驻，管理和显示折叠，选择后才出现复制与发送
3. 设备中心在第六行采用设备列表加所选详情，只列所选设备上的全局 Agent
4. 会话浏览支持仅用于复制会话信息的轻量多选，主操作突出且不恢复交接编排
5. 组内非主形态可单独管理：控制条形态切换器把 selectedProfileId 落到具体槽位（两视图共用）

## 10. 不得误报为已完成的事项

- 当前 WIP 不等于 UI 已审美验收或任务路径已验收。
- 8 个纯状态测试通过不等于 Renderer 全部路径正确。
- 单机双隔离端点不等于两台物理电脑 P2P 通过。
- 合成视频轨不等于 macOS/Windows 屏幕权限通过。
- macOS helper 空载验证不等于 Windows helper 或跨平台输入通过。
- 配置了 STUN/TURN 不等于真实 coturn 回退通过。
- 纵向链路存在不等于公开 Beta 门禁关闭。
- 按钮改名不等于 Agent/AccountBinding/AgentSlot 对象管理已经完成。

## 11. 完成交接任务的定义

本交接清单本身只负责保存现场。后续开发至少满足以下条件，才能把当前 UI 重构任务标为完成：

- 1.9 的十一项 UI 上下文状态真正独立，不再被 Profile 互相覆盖；
- 规划 11.11 的十条原子交互契约都有任务结果测试；
- 5 个过期测试已按新契约更新，完整 `npm test` 0 失败；
- 1040 × 840 真窗口完成三语、明暗主题、庭院/经典和关键异常路径验收；
- Agent、账号绑定和运行位置管理的对象范围在 UI 与 IPC 中一致；
- 多副本来源未解决时没有任何静默猜测；
- SessionPointer、文件发送、传输历史互不污染；
- 远控返回后输入已释放，断开与返回不再混为一个动作；
- 七行骨架、单一复制契约、Renderer 安全边界和纯本地模式无回归；
- 文档只陈述已经有证据的完成状态。
