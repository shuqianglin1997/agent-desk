# Personal Agent Mesh 开发交接与剩余任务

> 更新日期：2026-08-12
>
> 当前分支：`main`
>
> 实施基线：`docs/PERSONAL_AGENT_MESH_PLAN.md` 1.12，状态 `OWNER APPROVED — IMPLEMENTATION AUTHORIZED`
>
> 仓库：`shuqianglin1997/agent-desk`

## 1. 当前结论

1.12 批准的主窗口重构已经进入真实产品代码，不再是 HTML 排版提案：

- 主窗口固定为一个 Header、一个 Footer，以及顶部 Agent、左下会话、右下详情三个面板；1040 × 840 尺寸不变。
- Header 直接保留 Device Lens、设备、工具、活动、设置；不存在全局“更多”杂物菜单，也不显示没有来源的状态圆点。
- 顶部 Agent 面板同时承载庭院/卡片、排行、当前 Agent、运行位置、打开、新增、管理和紧凑额度。
- 左下只负责会话范围、搜索、显示设置和列表；右下只承载会话详情及其底部动作坞、额度和隔离 Remote Surface。
- 设备、工具、活动、设置由 Header 分别打开四个有界模态弹窗；开关弹窗不改变底层详情、Device Lens、Agent/Slot、搜索或 focused/checked 会话。配对、权限、诊断和传输历史保留在所属弹窗或受控次级弹窗。
- 会话动作只进入右下会话详情底部动作坞：聚焦单条时集中提供复制、发送、打开和导出；显式勾选后原位切为批量摘要、取消、复制和发送。“复制会话信息”仍是唯一填充主按钮，内容仍严格只有路径和坐标。
- Footer 只承担全局状态、今日完成数、陪伴分钟与提醒总开关；庭院内部不再叠加小账本或提醒条。
- 四个全局弹窗开关、额度详情切换和远控进入/返回时，三个固定面板的几何位置不变，不再插入提醒行、额度行、选择条、抽屉或整页工作区。
- 庭院与卡片继续共用 Agent/Slot/会话业务状态；Agent 是展示主轴，Device 是筛选轴，Slot 和 SessionReplica 是动作落点。
- Remote Surface 仍是专用沙箱 WebContentsView，只把可见边界收进右下详情；普通 Main Renderer 不接触 SDP、媒体轨、采集 source、TURN 凭据或输入通道。

这轮同时修复了一个由新导航顺序暴露的真实问题：纯本地用户先打开“活动”时，传输历史的只读查询会提前创建空 `mesh.db`，设备中心随后把它判为不完整存储并阻止初始化。`TransferService` 的只读 `list/read/projectBindings` 现在在数据库不存在时直接返回空结果，不再产生存储副作用，并有单元测试锁定。

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

四个全局弹窗由独立的 `state.utilityDialog` 表达：`devices`、`tools`、`activity`、`settings` 或 `null`。`openUtilityDialog()` 使用 `showModal()`，关闭时只清理该状态与 Header 的 `aria-expanded`；不得写入 `workspaceMode` 或 `detailMode`。`mountWorkspaceSurfaces()` 不再搬运任何 dialog，只负责 Remote Surface 的边界观察与初始化会话详情。

## 4. 关键实现文件

- `src/index.html`：固定五区结构和全部真实控件。
- `src/styles.css`：1040 × 840 三面板几何、四个有界弹窗、会话详情动作坞、额度/远控详情与全局 Footer。
- `src/yard/yard.css`：只负责顶部 Agent 面板内的庭院视觉，不再参与页面骨架排版。
- `src/renderer.js`：Header 弹窗入口、utilityDialog/detailMode、Remote Surface 返回与选择状态。
- `src/ui-context.js`：Device Lens、Agent、Slot、focused/checked Conversation、Replica、设备详情、远控和传输草稿的独立状态。
- `src/mesh/main/transfer-service.js`：纯本地只读活动不创建 Mesh 数据库。
- `src/i18n/{zh,en,ja}.js`：Header 与详情的三语文案，key 集合一致。
- `scripts/ui-acceptance.js`：真实 1040 × 840 Electron 的 14 条任务路径。
- `test/ui-redesign.test.js`、`test/ui.test.js`、`test/mesh-ui.test.js`、`test/quota-ui.test.js`、`test/mesh-remote-control.test.js`：固定结构与交互契约。
- `test/mesh-transfer.test.js`：纯本地活动查询无存储副作用。

## 5. 已验证结果

当前工作现场已经取得以下证据：

- UI/远控/额度/i18n 相关测试：54/54 通过。
- 传输测试：6/6 通过，包含纯本地活动不创建 `mesh.db` 的新回归。
- `package.json` 的完整 `check` 脚本通过。
- 完整 Node 测试：348 项，347 通过、1 项仅 Windows 跳过、0 失败；配对与信令测试在允许本机 `127.0.0.1` 临时监听的环境中通过。
- 真实 Electron 窗口验收：14/14 任务路径通过。
- 实窗覆盖固定三面板、focus/checked、庭院/卡片、三语、明暗主题、本机新增、四个 Header 入口、设备中心与原子导航、Slot 上下文、Agent/Binding/Slot 管理、多副本来源、SessionPointer/文件/历史分离、远控返回/断开、撤销清理和 reduced-motion。
- `git diff --check` 通过。
- macOS arm64 测试包已构建到 `release/mac-arm64/AgentDesk.app`；包内输入 helper 为 arm64/x86_64 universal，`codesign --verify --deep --strict` 通过。
- 测试包已安装到 `/Applications/AgentDesk.app`，安装后 `app.asar` SHA-256 与构建产物一致，并已成功启动。
- 审阅截图在临时目录 `/private/tmp/agentdesk-ui-110/`；它们不是产品数据，也不应作为运行时依赖。

交付前仍应以当前工作树重新运行：

```bash
npm run check
npm test
npm run accept:ui
git diff --check
```

本文件只记录实际通过的证据。若后续任何一项失败，应先修复再更新完成状态。

## 6. 文档权威关系

- `PERSONAL_AGENT_MESH_PLAN.md` 1.12 是实施权威。
- `AGENTDESK_WORKSPACE_REDESIGN_REVIEW.html` 是页面结构的历史审阅稿；若与 1.12 冲突，以计划和真实产品代码为准。
- `ADR_PERSONAL_MESH_SINGLE_WINDOW_SURFACE.md` 已修订为固定三面板与右下 Remote Surface。
- 旧 owner review、旧会话身份 review、文章插图和规划变更记录中出现的“七行/第六行”只代表当时的历史方案，不能覆盖 1.10。
- PRODUCT、SCENARIOS、INTERNAL、FUNCTION_AUDIT、ROADMAP 和 README 已按 1.12 同步。

## 7. 不得误报为已完成

- 本机 1040 × 840 真窗口通过不等于两台物理电脑 P2P 通过。
- 单机双隔离端点不等于真实家庭 NAT、CGNAT 或 coturn 强制回退通过。
- 合成视频轨不等于 macOS/Windows 屏幕权限通过。
- macOS helper 空载验证不等于 Windows helper 或跨平台输入通过。
- Phase 2–8 的纵向链路和本机 UI 收口不等于公开 Beta 门禁关闭。
- 当前没有无人值守、登录界面、UAC 安全桌面、远程 Shell 或通用命令能力。

## 8. 后续真实任务

页面重构已不是 WIP。后续任务属于物理验证与发布门禁：

1. 两台真实电脑完成配对、库存、SessionPointer、文件、断网恢复、睡眠唤醒和撤销防重连。
2. 覆盖家庭 NAT、对称 NAT、CGNAT、IPv4/IPv6、UDP 禁用和 coturn UDP/TCP/TLS relay。
3. 完成 macOS → macOS、macOS ↔ Windows、Windows → Windows 的屏幕、键鼠、DPI、多显示器和 IME 矩阵。
4. 完成 macOS Developer ID/公证/Gatekeeper 与 Windows helper/portable/UIPI/UAC 发布验证。
5. 无人值守若要进入开发，必须先通过 Phase 9 的独立产品与安全评审。

## 9. 工作树保护

以下未跟踪文章文件属于所有者现有内容，不在本次页面重构范围内，不要删除或覆盖：

- `docs/AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V2.md`
- `docs/AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V3.md`

任何安装、重置、撤销或删除操作都必须先确认目标；破坏性 Mesh 验收继续只使用临时 userData，不触碰所有者真实配置。
