# ADR：Personal Mesh 单窗口与固定三面板承载

状态：Accepted（2026-08-12 由规划 1.13 修订并完成本机窗口验收）

基准：`PERSONAL_AGENT_MESH_PLAN.md` 1.13

## 背景

设备中心曾使用整窗模态层，Remote Console 曾使用新顶级窗口，后续又收进七行界面的第六行。三种实现都让全局导航、Agent、会话与设备动作之间的关系漂移，并产生额外区域、整行切换或来源不明的状态提示。

所有者最终确认：1040 × 840 主窗口只保留一个 Header、一个 Footer，以及顶部 Agent、左下会话、右下统一详情三个固定面板。所有功能和按钮围绕这五个结构对象组织，不再插入额外信息轨、抽屉、整页工作区或第四个永久面板。

1.13 进一步冻结 58px Header、244px Agent 面板、316px 详情与 38px Footer，并已在真实 1040 × 840 Electron 窗口中通过 15 条本地任务路径；该表现层证据不改变下述远控隔离和物理设备门禁。

## 决策

固定骨架如下：

1. Header：品牌、Device Lens、设备、工具、活动、设置，以及必要的后台远控文字提示；不存在“更多”杂物菜单。
2. 顶部 Agent 面板：庭院/卡片切换、排行、去重 Agent 选择、运行位置和 Agent/Slot 操作。
3. 左下会话面板：Agent 范围、搜索、显示设置与会话表。
4. 右下详情面板：只保留 `session`、`quota`、`remote` 三种当前工作对象状态；会话动作位于 session 详情底部。
5. Footer：全局状态、今日完成数、陪伴分钟和提醒总开关，不承载会话动作。

设备、工具、活动、设置分别使用有界模态弹窗，并由独立 `utilityDialog` 状态描述；开关弹窗不得改变 `detailMode`、workspace、顶部 Agent、左下会话或 Footer。配对、权限、诊断和传输历史留在所属弹窗或受控次级弹窗。额度和远控才改变 `detailMode`，返回会话详情时恢复原 focused/checked 会话、筛选和副本来源。

远控不迁入普通 Main Renderer。Electron Main 只接受主 Renderer 测得的有界矩形，重新验证它位于右下详情面板和 BrowserWindow 内容区后，才设置专用 WebContentsView 的 bounds 与可见性。Remote Surface 继续使用专用 preload、固定 IPC、无 Node、context isolation 和 sandbox；Main Renderer 不取得 SDP、ICE 原文、TURN 凭据、采集 source、媒体轨或输入 DataChannel。

目标端 Host Consent/Indicator 仍是目标设备本机的专用提示与停止界面，不受控制端页面布局影响。

## 生命周期

1. Header 的设备、工具、活动、设置只打开对应弹窗，不改变底层固定区域或详情状态。
2. 设备弹窗中的“查看 / 控制”先完成设备认证与能力检查；成功后关闭设备弹窗。
3. Main 创建或复用隐藏的 Remote Surface，Renderer 把右下详情切到 `remote` 并提交该面板内的占位边界。
4. Remote Surface 建立媒体与固定输入通道；目标端仍需逐次同意。
5. “返回工作台”先释放全部输入、把当前会话降为仅查看、隐藏 Surface，并恢复进入远控前的右下详情；媒体连接可留在后台，Header 显示有来源的文字提示。
6. 只有显式断开、最后一路终止、Mesh 重置、主窗口关闭、Renderer 崩溃或应用退出才结束媒体，并再次确保全部按键释放。

## 约束与验收

- 不创建 `AgentDesk Remote Console` 顶级 BrowserWindow；
- 设备、工具、活动、设置分别使用有界模态弹窗，不挂入右下详情；
- WebContentsView 不能越过右下详情面板，也不能覆盖 Header、顶部 Agent、左下会话或 Footer；
- 普通 Renderer 只能提交 `{ visible, bounds }`，不能提交 URL、命令、路径、SDP 或凭据；
- 多设备仍只有一个输入目标；隐藏 Surface 时不能继续持有输入；
- 三语、明暗主题和 reduced-motion 保持一致；
- 使用临时 userData 的真实 1040 × 840 Electron 验收必须证明恰好三个固定面板，四个全局弹窗不改写底层上下文，额度/远控只切换右下详情；
- 物理双机、真实 NAT/TURN 与 macOS/Windows 权限矩阵仍是发布门禁，本 ADR 不关闭这些门禁。
