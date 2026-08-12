# ADR：Personal Mesh 单窗口工作区承载

状态：Accepted
日期：2026-08-11
基准：`PERSONAL_AGENT_MESH_PLAN.md` 1.7

## 背景

原实现把设备中心做成覆盖主界面的宽模态层，并为 Remote Console 创建新的顶级窗口。功能虽然存在，但用户离开了熟悉的七行主窗口，不容易判断当前 Agent、运行位置、会话与设备动作之间的关系。

所有者确认：日常设备管理和远控都必须留在原 AgentDesk 窗口中，原有横向账号控制条和“会话表 + 详情”工作面不能被重做成另一套产品界面。

## 决策

主窗口保持固定七行。第 6 行有三种互斥工作区状态：

- `sessions`：原会话表和右侧详情；
- `devices`：原“设备”内容以内嵌、非模态方式占用第 6 行；
- `remote`：专用沙箱 WebContentsView 覆盖第 6 行的远控占位区域。

顶栏、Presenter、账号控制条、提醒、额度和状态栏始终留在原位。切回 `sessions` 时恢复原 Agent、设备 Lens、运行位置和会话选择。

远控不迁入普通 Main Renderer。Electron Main 只接受主 Renderer 测得的有界矩形，重新验证它完全位于当前 BrowserWindow 内容区后，才设置 WebContentsView 的 bounds 与可见性。Remote Surface 继续使用专用 preload、固定 IPC、无 Node、context isolation 和 sandbox；Main Renderer 不取得 SDP、ICE 原文、TURN 凭据、采集 source、媒体轨或输入 DataChannel。

目标端 Host Consent/Indicator 仍是目标设备本机的专用提示与停止界面，不受单窗口控制端决策影响。

## 生命周期

1. 设备卡“查看 / 控制”先完成设备认证与能力检查。
2. Main 创建或复用隐藏的 Remote Surface，Renderer 切换第 6 行到 `remote` 并提交占位区域边界。
3. Remote Surface 建立媒体与固定输入通道；目标端仍需逐次同意。
4. 点击“返回工作台”会先释放全部输入、把当前会话降为仅查看并隐藏 Surface；媒体连接可以留在后台，主窗口显示活动查看提示。
5. 用户可从活动提示重新进入 Surface；只有显式断开、最后一路终止、Mesh 重置、主窗口关闭、Renderer 崩溃或应用退出才结束媒体，并再次确保全部按键已释放。

## 约束与验收

- 不创建 `AgentDesk Remote Console` 顶级 BrowserWindow；
- 设备中心不再调用 `showModal()`；
- WebContentsView 不能越过第 6 行或覆盖状态栏和上方五行；
- 普通 Renderer 只能提交 `{ visible, bounds }`，不能提交 URL、命令、路径、SDP 或凭据；
- 第 6 行小高度下远控控制条仍可操作，多设备仍只有一个输入目标；
- 三语文案和明暗主题保持一致；
- 使用临时 userData 的真实 1040 × 840 Electron 验收已经证明设备中心和 Remote Surface 只占第 6 行、返回后会话工作台恢复、后台 viewing 提示存在且断开后清除；
- 物理双机、真实 NAT/TURN 与 macOS/Windows 权限矩阵仍是发布门禁，单窗口改造不关闭这些门禁。
