# 上游分支关系

仓库：`shuqianglin1997/agent-desk`。

- `codex/native-macos`：独立原生 macOS 实现，Swift / AppKit / SwiftUI，只有可选静态原生浮球。本分支以完整源代码快照作为独立基线，未合入现有 Electron 默认分支。
- `codex/fork-snapshot-20261009`：原样保留 `0mn1si2i5/agent-desk` 的 main，提交 `4b54975fab3117672d98dc1f1673898a3fc7a85a`。保留该 fork 的现有代码和历史，不与原生实现混合。

原生分支的安装名称、偏好域、应用数据根目录与旧客户端独立。旧客户端的 profile 配置只用于导入账号；没有退役、删除或替换旧客户端。默认分支与 develop 不在此次变更范围。
