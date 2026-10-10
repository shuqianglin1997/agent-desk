# 上游分支关系

仓库：`shuqianglin1997/agent-desk`。

- `new-version`：独立原生实现，包含 macOS（Swift / AppKit / SwiftUI）与 Windows（.NET 10 / WPF）两端，只有可选静态原生浮球。本分支以完整源代码快照作为独立基线，未合入现有 Electron 默认分支。
- `fork-snapshot-20261009`：原样保留 `0mn1si2i5/agent-desk` 的 main，提交 `4b54975fab3117672d98dc1f1673898a3fc7a85a`。保留该 fork 的现有代码和历史，不与原生实现混合。

原生分支的安装名称、偏好域、应用数据根目录与旧客户端独立。旧客户端的 profile 配置只用于导入账号；没有退役、删除或替换旧客户端。默认分支与 develop 不在此次变更范围。

## 同步记录

0.2.0 从维护者的原生实现仓库 `0mn1si2i5/perch` 的 main（提交 `575d35bcf22ec02c314c0f5e36c6c233788b92c8`）同步：

- macOS 以三方合并带入功能改动，保留本分支的命名（`AgentDeskNative` / `com.agentdesk.native`）、去除角色、动画、媒体监控与偏好迁移的取舍。
- Windows 与共享目录整体带入后做同样处理：重命名为 `AgentDeskNative.*`，删除角色主题与素材、媒体感知和姿态预览，图标改为中性堆叠图标，数据目录改为 `%LOCALAPPDATA%\AgentDeskNative` 与 `%USERPROFILE%\.agentdesk-native\profiles`。
- 发布流程不同步；本分支只运行检查。

下次同步以上述提交为基线，比较上游此后的改动，再按相同规则合入。
