# Personal Agent Mesh 开发交接与剩余任务

> 更新日期：2026-08-14
>
> 当前分支：`main`
>
> 实施基线：`docs/PERSONAL_AGENT_MESH_PLAN.md` 1.27，状态 `OWNER APPROVED — IMPLEMENTATION AUTHORIZED`
>
> 仓库：`shuqianglin1997/agent-desk`
>
> 本轮开发前回滚点：`c42ac57c63a2e5160cd7c1544ba83bfe7797f43f`

## 1. 当前结论

1.14 批准的主窗口层级、排版与全局弹窗 Shell 已经进入真实产品代码；1.24 的签名事件目录、1.25 的便携 TaskPackage 和 1.27 的首用/设备向导/同 Mesh Preview 直送都在这套固定骨架内实现：

- 主窗口固定为一个 Header、一个 Footer，以及顶部 Agent、左下会话、右下详情三个面板；1040 × 840 尺寸不变。
- Renderer 几何冻结为 58px Header、244px Agent 面板、316px 详情、38px Footer，工作区使用 12px/10px padding 与 10px gap；Compact 会话表没有水平滚动。
- Header 直接保留 Device Lens、设备、工具、活动、设置；不存在全局“更多”杂物菜单，也不显示没有来源的状态圆点。
- 顶部 Agent 面板同时承载庭院/卡片当前模式分段、排行、当前 Agent、始终可见的运行位置、打开、新增、管理和紧凑额度。
- 时间/天气进入一个原生 Top Layer 场景 Popover；原七项菜单进入分“全局 Agent / 当前运行位置”的对象 Dialog，不再依赖裁切面板内的绝对定位菜单。
- 左下只负责会话范围、搜索、显示设置和列表；右下只承载会话详情及其底部动作坞、额度和隔离 Remote Surface。
- 设备、工具、活动、设置由 Header 分别打开四个有界模态弹窗；开关弹窗不改变底层详情、Device Lens、Agent/Slot、搜索或 focused/checked 会话。配对、权限、诊断和传输历史保留在所属弹窗或受控次级弹窗。
- 四个全局弹窗统一为固定 Header、中性顶部关闭、可选固定 Command Bar、单一 Content 滚动区与只供真实事务使用的固定 Footer；工具、活动、设置不再用底部橙色“完成”伪装主操作。
- 帮助、传输记录、网络、权限和诊断使用父子弹窗栈；关闭或 Esc 只移除最上层并恢复父层的滚动、菜单和触发焦点。网络设置入口完成读取后会恢复可用状态，不再永久 disabled。
- 会话动作只进入右下会话详情底部动作坞：聚焦单条时集中提供复制、发送、打开、交接任务和 Markdown 导出；显式勾选后原位切为批量摘要、取消、复制和发送。“复制会话信息”仍是唯一填充主按钮，内容仍严格只有路径和坐标。
- “交接任务”从一条本机会话生成便携加密 `.agentdesk-task`：人工目标/进展/下一步/风险/验收、原生会话或只读内容、Git 基线/已跟踪差异和明确附件；来源始终保留。
- “活动”弹窗提供任务包导入和本地历史。接收者完整验证后先看检查点、项目状态和附件数量，再选择本机 Agent/Profile 与资料目录；弹窗继续使用固定 Header、滚动 Content 和固定事务 Footer。
- 全新用户从版本化“创建第一个 Agent”进入，本机目录、设备身份、Agent/Blueprint 与首次准备由一个可恢复事务建立；缺失 Profile 存储保持空数组，不生成 Claude/Codex/Kimi 默认项，且该动作不开放监听或发布租约。
- “添加设备”使用固定 Header/滚动 Content/固定 Footer 的任务向导，分别显示双方身份确认、成员信任、认证连接、目录落库、库存落库和可用状态；30 分钟接收入口只留在高级恢复。
- 同 Mesh TaskPackage 直送要求认证目标、`task.package.transfer.v1`、`task.package.receive` 和逐次接受。密文包完整哈希后才由目标设备独占 envelope 解封；拒绝、撤权、撤销、过期和错误会清理，失败可把同一密文快照保存为便携文件。
- Codex 原生适配器携带根会话与 internal-child，目标端重新验证身份、拒绝同 ID 异内容覆盖、失败回滚、重复导入幂等，并把标题标注为来自交接人/来源 Agent。其他支持来源当前只保存只读会话内容。
- Footer 只承担全局状态、今日完成数、陪伴分钟与提醒总开关；庭院内部不再叠加小账本或提醒条。
- 路径、额度等持久待处理事项只进入 Header 的活动弹窗；庭院只保留 Agent Presenter 和摸猫/拖放后的短暂直接反馈。
- 四个全局弹窗开关、额度详情切换和远控进入/返回时，三个固定面板的几何位置不变，不再插入提醒行、额度行、选择条、抽屉或整页工作区。
- 庭院与卡片继续共用 Agent/Slot/会话业务状态；Agent 是展示主轴，Device 是筛选轴，Slot 和 SessionReplica 是动作落点。
- Remote Surface 仍是专用沙箱 WebContentsView，只把可见边界收进右下详情；普通 Main Renderer 不接触 SDP、媒体轨、采集 source、TURN 凭据或输入通道。

表现层由 `src/workspace.css` 作为 canonical 分层系统承载，旧 `styles.css` 与 `yard/yard.css` 降入 `legacy`；像素皮肤只限于 Canvas、猫与紧凑名牌。语义 `[hidden]` 在最高层兜底，table focused/checked 边界落到真实单元格，避免 Chromium 把 `<tr>` 伪元素当成匿名列。

上一轮还修复了一个由新导航顺序暴露的真实问题：纯本地用户先打开“活动”时，传输历史的只读查询会提前创建空 `mesh.db`，设备中心随后把它判为不完整存储并阻止初始化。`TransferService` 的只读 `list/read/projectBindings` 现在在数据库不存在时直接返回空结果，不再产生存储副作用，并有单元测试锁定。

## 2. 接手前强制门禁

每次接手、上下文压缩、中断恢复、切分支或基线变化后，在任何实施动作前都必须：

1. 从第一行到最后一行完整阅读 `docs/PERSONAL_AGENT_MESH_PLAN.md`，摘要不能替代。
2. 确认状态仍是 `OWNER APPROVED — IMPLEMENTATION AUTHORIZED`；若变回 `DRAFT FOR OWNER REVIEW`，立即停止产品代码实现。
3. 检查当前分支、工作树和远端提交，不覆盖不属于自己的改动。
4. 保持固定 1040 × 840、一个 Header、一个 Footer和恰好三个主面板。
5. 保持庭院/卡片共用同一业务状态；不得恢复七行信息轨、第四个永久面板或全局“更多”菜单。
6. 保持“复制会话信息”为唯一填充主按钮，文本只包含路径和坐标。
7. 保持 Agent / Device / Slot / Conversation / Replica 的独立 UI 上下文和明确动作来源。
8. 不让普通 Main Renderer 接触远控媒体、密钥、凭据、任意路径、命令或网络原文。
9. 普通开发运行相关测试、`npm test`、`npm run check` 和真实任务路径验收；所有者未明确要求时不运行 `verify_all` 或等价命令。

## 3. 当前页面结构与状态映射

真实 DOM 在 `src/index.html`：

```text
.app-shell
  header.app-topbar
  main#mainGrid.workspace-board
    #agentPanel.workspace-panel
    #sessionPane.workspace-panel
    #detailPanel.workspace-panel
  footer#statusBar.app-footer
```

右下详情状态由 `state.detailMode` 决定：

| detailMode | 内容 |
|---|---|
| `session` | 当前 focused Conversation 详情、Replica 来源与唯一底部动作坞 |
| `quota` | 当前 Agent 与全院额度 |
| `remote` | 右下边界内的隔离 Remote Surface |

四个全局弹窗由独立的 `state.utilityDialog` 表达：`devices`、`tools`、`activity`、`settings` 或 `null`。`openUtilityDialog()` 使用 `showModal()`，关闭时只清理该状态与 Header 的 `aria-expanded`；不得写入 `workspaceMode` 或 `detailMode`。`openChildDialog()` 记录触发控件和所属 disclosure，子层关闭后只恢复父层焦点与菜单状态。`mountWorkspaceSurfaces()` 不再搬运任何 dialog，只负责 Remote Surface 的边界观察与初始化会话详情。

## 4. 关键实现文件

- `src/index.html`：固定五区结构和全部真实控件。
- `src/workspace.css`：1.14 canonical CSS 分层、固定几何、统一组件、Presenter 边界、固定区/内容滚动分离的全局弹窗、会话动作坞与全局 Footer。
- `src/styles.css`：低优先级 legacy 兼容样式，不再决定工作台几何。
- `src/yard/yard.css`：低优先级庭院 legacy 皮肤，不参与页面骨架排版。
- `src/renderer.js`：Header 弹窗入口、utilityDialog/detailMode、Remote Surface 返回与选择状态。
- `src/onboarding-state.js`、`src/device-journey.js`：版本化首用和设备任务状态投影。
- `src/main/profile-store-policy.js`、`src/main/ipc/{first-agent-onboarding,pairing-approvals,task-package-transfer}.js`：空 Profile 策略、双方确认与直送稳定 IPC。
- `src/ui-context.js`：Device Lens、Agent、Slot、focused/checked Conversation、Replica、设备详情、远控和传输草稿的独立状态。
- `src/mesh/domain/task-package-transfer.js`、`src/mesh/main/transfer-service.js`：目标设备独占 envelope、SessionPointer/文件/TaskPackage 分块传输及纯本地只读无存储副作用。
- `src/task-package/format.js`：TaskPackage schema v1、流式认证加密、清单/路径/大小/哈希校验。
- `src/task-package/codex-adapter.js`：Codex 一致快照、根/内部记录捕获、原生导入、冲突与回滚。
- `src/task-package/service.js`：人工检查点、Git/附件捕获、导入事务、历史与来源保留。
- `src/i18n/{zh,en,ja}.js`：Header 与详情的三语文案，key 集合一致。
- `scripts/ui-acceptance.js`：真实 Electron 的 21 条任务路径，另含全新首 Agent/重启恢复、设备向导、直送状态投影和 760 × 560 小视口矩阵。
- `test/ui-redesign.test.js`、`test/ui.test.js`、`test/mesh-ui.test.js`、`test/quota-ui.test.js`、`test/mesh-remote-control.test.js`：固定结构与交互契约。
- `test/mesh-transfer.test.js`：纯本地活动查询无存储副作用。
- `test/task-package.test.js`、`test/task-package-transfer.test.js`、`test/mesh-transfer.test.js`、`test/task-package-ui.test.js`：容器、稳定 Git 现场、附件不可变快照、Codex 原生导入、直送安全、接收预览、固定弹窗和窄 IPC。

## 5. 已验证结果

当前工作现场已经取得以下证据：

- 当前完整 Node 套件为 490 项：489 通过、1 项仅 Windows 跳过、0 失败。TaskPackage 安全定向 25/25，首用/设备向导/配对/Main IPC/TaskPackage UI 相关定向 47/47。
- 当前工作树的真实 Electron 窗口验收以 21/21 任务路径通过；覆盖全新首 Agent 的本机无网络事务、首次使用重启恢复、设备向导 Shell/状态层级和 TaskPackage 直送资格/阶段投影。直送窗口证据不代表真实 WebRTC 数据面。
- 实窗覆盖 58/244/316/38 固定几何、Compact 无横滚、focus/checked、庭院/卡片、Top Layer 场景 Popover、Agent 对象 Dialog、三语、明暗主题、本机新增、四个 Header 入口、固定区矩形不随 Content 滚动、父子 Esc/焦点栈、760 × 560 小视口、设备中心与原子导航、Slot 上下文、Agent/Binding/Slot 管理、多副本来源、SessionPointer/文件/历史分离、远控返回/断开、撤销清理和 reduced-motion。
- `git diff --check` 通过。
- `0.10.1-preview.1` macOS arm64 本地测试包已构建到 `release/mac-arm64/AgentDesk.app`；主程序为 arm64，包内输入 helper 为 arm64/x86_64 universal，`codesign --verify --deep --strict` 通过，`app.asar` 已核对包含版本化首次使用、设备任务向导与同 Mesh TaskPackage 直送实现。该目录构建使用 ad-hoc 本地签名并明确关闭公证，只用于本机测试，不是可公开发布的签名、公证 Preview。
- 最新测试包已安装到 `/Applications/AgentDesk.app`，安装后 `app.asar` SHA-256 与构建产物均为 `6c6966ba8fdbb172e24e6164aad139f34cfb7f890a673a991f6adeb7fff05e4c`，已从该路径成功启动并确认运行版本为 `0.10.1-preview.1`。被替换的 `0.10.0` 完整应用保留在 `/Applications/AgentDesk.app.pre-0.10.1-preview.1-20260814-131032`，可直接用于回滚；既有更早备份未删除。
- 本轮审阅截图在临时目录 `/private/tmp/agentdesk-ui-1.14-acceptance/`；它们不是产品数据，也不应作为运行时依赖。

交付前仍应以当前工作树重新运行：

```bash
npm run check
npm test
npm run accept:ui
git diff --check
```

本文件只记录实际通过的证据。若后续任何一项失败，应先修复再更新完成状态。

## 6. 文档权威关系

- `PERSONAL_AGENT_MESH_PLAN.md` 1.27 是实施权威。
- `AGENTDESK_UI_HIERARCHY_LAYOUT_PLAN.html` 是 1.13 主窗口层级、几何与临时层蓝图；全局弹窗内部 Shell 与父子层级以 1.14 计划和真实产品代码为准。
- `AGENTDESK_WORKSPACE_REDESIGN_REVIEW.html` 是 1.12 页面结构的历史审阅稿；若与 1.14 冲突，以计划和真实产品代码为准。
- `ADR_PERSONAL_MESH_SINGLE_WINDOW_SURFACE.md` 已修订为固定三面板与右下 Remote Surface。
- 旧 owner review、旧会话身份 review、文章插图和规划变更记录中出现的“七行/第六行”只代表当时的历史方案，不能覆盖 1.10。
- `ADR_AGENTDESK_TASK_PACKAGE.md` 记录 TaskPackage 格式、事务、Codex 原生适配器、同 Mesh Preview 直送和当前限制；它服从 1.27 产品基线。

## 7. 不得误报为已完成

- 本机 1040 × 840 真窗口通过不等于两台物理电脑 P2P 通过。
- 单机双隔离端点不等于真实家庭 NAT、CGNAT 或 coturn 强制回退通过。
- 合成视频轨不等于 macOS/Windows 屏幕权限通过。
- macOS helper 空载验证不等于 Windows helper 或跨平台输入通过。
- Phase 2–8 的纵向链路和本机 UI 收口不等于公开 Beta 门禁关闭。
- 当前没有无人值守、登录界面、UAC 安全桌面、远程 Shell 或通用命令能力。
- 同 Mesh TaskPackage 的代码与本机 UI 路径已接通，但现有 Electron E2E runner 尚未发送 TaskPackage；物理双机、断线恢复、Windows 文件句柄矩阵、跨 Mesh 身份确认和非 Codex 原生导入尚未完成。

## 8. 后续真实任务

页面重构已不是 WIP。后续任务属于物理验证与发布门禁：

1. 两台真实电脑完成配对、库存、SessionPointer、文件、断网恢复、睡眠唤醒和撤销防重连。
2. 覆盖家庭 NAT、对称 NAT、CGNAT、IPv4/IPv6、UDP 禁用和 coturn UDP/TCP/TLS relay。
3. 完成 macOS → macOS、macOS ↔ Windows、Windows → Windows 的屏幕、键鼠、DPI、多显示器和 IME 矩阵。
4. 完成 macOS Developer ID/公证/Gatekeeper 与 Windows helper/portable/UIPI/UAC 发布验证。
5. 无人值守若要进入开发，必须先通过 Phase 9 的独立产品与安全评审。
6. 在真实 Electron WebRTC 与物理双机上验证 TaskPackage 接受、拒绝、撤权、断线恢复、导入和同快照便携回退；跨 Mesh 直连另行评审。

## 9. 工作树保护

文章版本已经收敛，只保留两份最终正文：

- `docs/AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V4.md`
- `docs/MULTI_AGENT_ENGINEERING_WORKFLOW_GUIDE_V2.md`

旧版本已经删除，不要从历史提交中恢复为并列正文。

任何安装、重置、撤销或删除操作都必须先确认目标；破坏性 Mesh 验收继续只使用临时 userData，不触碰所有者真实配置。
