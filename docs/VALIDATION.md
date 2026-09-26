# AgentDesk 验证记录

本页是测试结果与开放门禁的唯一当前入口。产品/场景/路线不再复制总数；检查器核对日期、环境、完整 Git 基线和源码 SHA-256，避免源码更新后继续引用旧结果。

## 当前工作树

机器可核对结果见 [current.json](validation/current.json)。该记录区分 `baseCommit` 与未提交修改后的 `sourceSha256`；摘要覆盖 src、test、scripts 与 package/lock。运行 `node scripts/validation-source.js` 可复核。本文没有声称这些未提交修改已经发布。

当前原始结果：[Node 回归](validation/node-results.txt)；未完成的 [Electron 窗口验证记录](validation/ui-results.txt) 单独列出，不标为 PASS。2026-09-14 同源活动的历史合成测量见 [结果](validation/activity-benchmark.json)；在仓库根运行 `node docs/validation/activity-benchmark.cjs` 可重测。它不是本次重新测量的性能结果。

2026-09-26 本地融合以现有精简工作树为底，吸收 PR #2 与 PR #3 的名册排序/滚轮/滚动保持，不引入 VHS 皮肤或已退休功能。新增修复覆盖 DSH web 参数、CLI 就绪能力、大小写环境清理、Node 启动器、工具中心匹配账号、Windows 批处理展开及遗留登记按钮所在弹窗。

最终后台 Node 共 573 项：572 通过、1 项 Windows 专用跳过、0 失败；完整语法检查通过。macOS arm64 本地应用包通过 ad-hoc 签名校验、五项 Electron fuse、125 个 ASAR 文件/块完整性及内嵌头校验；包内 120 个源码文件逐字节匹配当前 src。Git 基线、源码摘要、PR commit 和包摘要见 current.json。

本地交付：`release/local-integration-20260926/mac-arm64/AgentDesk.app`，版本 `0.10.1-preview.1` 的日期标识本地构建；没有安装覆盖、启动成品或推送。融合前源码备份保留在 `/tmp/agentdesk-integration.lMPQWq/before-integration.tgz`。

先前窗口测试曾通过名册交互与排序重启断言，但在遗留登记按钮可见性处发现融合错误；已修正并通过 Node 结构回归。所有者要求不中断电脑使用后，停止全部测试窗口，不再执行最终整套窗口复验或成品三次首启。首次使用恢复曾有一次超时，随后尝试通过；不能据此宣称最终 GUI 稳定验收已关闭。真实 Claude/DSH 登录、Windows 原生终端与物理设备没有验证。

## 历史证据（不能替代当前工作树）

- `3a4919a14c05e4db1c828cccad3ec9e024023efe`，2026-09-14，本机 macOS：上一轮 Node 共 549 项，548 通过、1 个 Windows 专用项跳过；语法检查、文档检查与 universal native helper 编译通过。这是精简前的基线。
- 2026-08-14，1.28 方案记录：发布安全 14/14、TaskPackage 安全 25/25、Electron UI 21/21，以及当时 arm64 unpacked 的 fuse/ASAR 与 mock-Keychain 三次首用。这里保留当时记录，不把无完整构建摘要的历史材料升级为本次成品证明。
- 2026-08-13，0.9.4，两台物理 Mac 同局域网：认证 host/UDP 通道，562,009 字节库存、9 个 Slot、638 条 SessionReplica，revision 7 → 8 → 9，连续 5 分钟稳定。只关闭该局域网库存/显式与周期刷新基线。
- 历史隔离双 endpoint 的 LAN 与本机 signaling 验证覆盖认证、目录/库存、刷新、SessionPointer、184,333 字节文件和合成屏幕；runner 尚未发送 TaskPackage。

## 仍需真实环境的门禁

- 物理双机 TaskPackage 直送、接受/拒绝、撤权、断线恢复与导入后的官方客户端继续工作。
- 公网 NAT/CGNAT、强制 coturn UDP/TCP/TLS 中继、断网/睡眠与长期连接恢复。
- macOS/Windows 四向屏幕/输入权限、多显示器、DPI、IME 与 Windows 文件句柄清理。
- 签名、公证、真实受保护 Preview Tag、Draft 双原生重下载、公开匿名重下载、浏览器 quarantine、MOTW/SmartScreen/Defender/UAC 与物理干净机首启。

本批没有执行这些物理或发布门禁，没有安装覆盖正在使用的客户端，没有推送。发布策略继续是 Preview-only、`stableAllowed=false`；本地 ad-hoc 包不等于签名公证公开发行版，当前没有与本批源码匹配的公开 Preview。
