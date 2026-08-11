# ADR：Personal Mesh WebRTC 承载位置

- 状态：MVP 决策已接受；两台真机网络门禁未通过
- 日期：2026-08-10
- 关联基准：`PERSONAL_AGENT_MESH_PLAN.md` 0.6 / Phase 1

## 决策

MVP 的 `RTCPeerConnection` 放在独立、不可见或独立可见的沙箱 Renderer 中：

- Electron Main 保留设备身份、能力策略、窗口所有权和 OS 副作用仲裁；
- `MeshService`、密钥封装和 `mesh.db` 留在 Main/纯 Node 层；
- 沙箱 Renderer 只持有 WebRTC Media/DataChannel，不读取私钥、账号凭据、任意文件或命令；
- 技术自检使用一次性隐藏 Renderer；真实查看/控制使用主窗口第 6 行内的专用沙箱 Remote Surface WebContentsView；
- 不把 WebRTC 强塞进 Electron utility process，因为 utility process 没有浏览器 DOM WebRTC API；
- 暂不引入与 Electron ABI 绑定的第三方原生 WebRTC 模块。

## 已验证证据

2026-08-10 在 macOS arm64、Electron 43.3.0 中执行真实隐藏 Renderer 自检：

```json
{
  "ok": true,
  "elapsedMs": 202,
  "channel": "control.reliable",
  "ordered": true,
  "candidateTypes": ["host"],
  "protocols": ["udp"],
  "selectedPairState": "succeeded"
}
```

该自检完成了真实 SDP/ICE 协商、SCTP DataChannel 打开、随机 nonce 请求和回声确认。Probe Renderer 使用：

- `contextIsolation: true`；
- `nodeIntegration: false`；
- `sandbox: true`；
- 严格 CSP；
- 单次固定结果 IPC；
- Main 校验结果来源 `webContents.id` 与一次性 token；
- 公开结果不包含 IP、SDP 或 ICE 原文。

Electron 43.3.0 本地目录包也已成功生成；其 Node 24.18.1 运行时确认提供内置 `node:sqlite`。

## 这个结果没有证明什么

本机 loopback 通过不等于 P2P 已完成。以下仍是 Phase 1 退出前的硬门禁：

- 两台真实电脑的成员证书交换与 transcript 双向认证；
- 同一 LAN 与跨公网连接；
- STUN server-reflexive 候选；
- TURN UDP/TCP/TLS 中继回退；
- Windows ↔ macOS；
- 网络切换、睡眠、锁屏和重连；
- macOS Screen Recording / Accessibility 与 Windows Capture / SendInput 权限；
- 正式签名、公证和 Windows portable 真机验证。

因此 UI 文案必须写“本机连接自检”，不能显示“设备已连通”或“P2P 已完成”。

## 后续实现约束

1. Link Core 只把经过设备证书验证、能力允许的有界消息交给 WebRTC Renderer。
2. Renderer 不取得 Root/设备私钥；握手签名由 Main 完成，Renderer 只传递不透明签名载荷。
3. 库存、控制、输入、传输分别建有界 DataChannel，不共用无界消息队列。
4. 用户返回会话、Remote Surface 被销毁或 Renderer 崩溃时，Main 终止连接并释放输入状态。
5. 两机验证若证明 Renderer 方案在后台、权限或签名上不可接受，必须用真机证据重新开 ADR，不能静默换成原生模块。
