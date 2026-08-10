# ADR: Personal Mesh 认证对等通道

状态：Accepted for MVP implementation
日期：2026-08-10

## 决策

每条设备连接由独立、隐藏、启用 Chromium sandbox 的 Renderer 持有 `RTCPeerConnection`。Electron Main 持有设备私钥、成员证书、权限策略、消息序列和库存落库，Renderer 只收发已经签名的有界信封。

设备通过临时局域网 HTTP 端点交换签名 SDP。端点不会在应用启动时开放：创建邀请时最多开放十分钟，加入设备时最多开放两分钟，用户也可以明确选择“接收连接 30 分钟”。超时、关闭入口或退出应用都会停止监听；已建立的 WebRTC 通道不依赖该 HTTP 端点继续存在。

## 认证顺序

1. 发起端创建随机 `connectionId` 与 challenge，签名发送 SDP offer。
2. 接收端验证成员公钥、目标设备、能力、过期时间和单调 sequence。
3. 接收端返回签名 SDP answer、自己的 challenge，以及对发起端 challenge 的 DeviceProof。
4. 发起端验证 answer 与 DeviceProof；DataChannel 打开后再发送对接收端 challenge 的 DeviceProof。
5. 接收端验证成功后先发送 `connection.ready`，双方才进入 authenticated 状态并开始双向库存分块同步。
6. 后续每条语义消息继续验证连接、来源、目标、能力、sequence、TTL 和签名。

WebRTC/DTLS 的传输加密不替代上述 Mesh 设备身份认证。

## 安全边界

- `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；
- preload 只有 bootstrap、signal、state、message 四个固定 IPC，以及 Main 到 peer 的固定事件；
- IPC 同时绑定一次性 token 与精确 `webContents.id`；
- SDP 最大 256 KiB，Renderer 单消息最大 512 KiB，库存总量最大 16 MiB；
- 库存按 192 KiB 分块、逐块确认、SHA-256 总校验并施加背压；
- 设备私钥、Mesh 关联密钥、账号凭据与 Cookie 不进入 peer Renderer；
- 公钥材料按 opaque text 保存，不能进行普通 UI 字符串的空白折叠；
- 端点只接受 JSON、限速、限制请求大小并拒绝非 HTTP(S) 或带路径的端点地址。

## 已验证证据

在 Electron 43.3.0 / macOS arm64 上，用两个隔离 `mesh.db`、两套设备密钥和两个隐藏沙箱 Renderer 完成了真实 RTCPeerConnection 验证：

- 双方成员证书与 challenge proof 均验证成功；
- `control.reliable` 为 ordered DataChannel；
- 候选类型为 host，传输为 UDP，candidate pair 为 succeeded；
- 双方都完成 inventory sync；
- 同一稳定 provider 会话在两端均显示为一个 ConversationIdentity，并保留两个精确 SessionReplica。

自动化领域与协议测试同时覆盖库存乱序重组、元数据混入、内容篡改、局域网信令、签名重放、公钥存储回归与离线 tombstone。

## 尚未由本 ADR 证明

- 两台物理电脑、不同 NAT、CGNAT 和公网切换；
- TURN 回退与短期凭据服务；
- macOS ↔ Windows 真机媒体和输入权限；
- 后台服务或无人值守。

这些仍属于后续真机和服务门禁，不能用本机双端验证替代。
