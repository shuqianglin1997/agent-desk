# AgentDesk Native

面向 macOS 的原生菜单栏客户端，管理本机 Codex / Claude 账号、任务与额度，并通过 Markdown 文档接力。

此分支是独立的 Swift / AppKit / SwiftUI 实现，不是现有 Electron 客户端的增量修改。需要 macOS 14+，构建支持 Apple Silicon / Intel。没有角色素材、品牌配色、动画或媒体监控。

## 使用

- 点击菜单栏图标打开面板，点击外部或 Esc 关闭。
- 添加或导入本机 Codex / Claude 账号，查看任务、最近会话及实时额度；支持手动刷新、可关闭的每 5 分钟自动同步与缓存回退。
- 点会话调出所属账号。客户端多实例定位有限制，具体对话可能需要手动选择。
- 右键已停下的会话，选择接力账号与已准备好的 Markdown 文档；应用保存副本、复制完整正文与绝对路径，调出目标账号。最后由用户在目标新聊天中粘贴发送，不自动复制原对话。
- 设置和须知在同尺寸面板内切换；接力记录支持展开、定位文档与删除记录。
- 可选桌面浮球默认关闭。在设置开启后，爪印控制显示与隐藏；单击打开面板，双击调出忙碌账号，拖动换位置，右键打开菜单。面板始终保持 macOS 原生外观。

## 构建与运行

需要 Xcode 的 Swift / clang 工具链，不需要 Node.js 或 API key。

```bash
swift test
./script/build_and_run.sh --build
./script/build_and_run.sh --install
./script/package-release.sh
```

应用：`dist.noindex/AgentDeskNative.app`；安装到 `~/Applications/AgentDeskNative.app`。设置 `AGENTDESK_NATIVE_CONFIGURATION=release` 可使用优化构建；`AGENTDESK_NATIVE_ARCHS='arm64 x86_64'` 可构建通用二进制。默认 ad-hoc 签名，没有 Apple 公证；此分支未创建正式 Release。

## 数据边界

Bundle ID：`com.agentdesk.native`。配置、账号槽与交接副本位于 `~/Library/Application Support/AgentDeskNative/`，不覆盖现有客户端的设置与安装。

首次读取现有 `~/Library/Application Support/AgentDesk/profiles.json` 以导入 Codex / Claude 槽位，客户端目录原地引用；不修改旧配置或移动旧客户端数据。平时只读任务元数据；接力仅读取用户选择的 Markdown 文档。Claude 额度请求使用对应账号授权，仅在内存中用于服务查询，不记录 token 或改变登录状态。

[架构](docs/architecture.md) · [验证范围](docs/acceptance.md) · [构建分发](docs/releasing.md) · [上游分支关系](docs/upstream-branches.md)
