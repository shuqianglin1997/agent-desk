# 验证范围

## 本分支已做的检查

- macOS：`swift test --package-path macos` 全部通过；`macos/script/build_and_run.sh --build` 生成 `AgentDeskNative.app`，Bundle ID 为 `com.agentdesk.native`，不含媒体框架或角色素材。
- Windows：解决方案可编译（0 警告、0 错误）；回归程序依赖 Windows 文件权限 API，由 GitHub Actions 的 Windows 检查运行。
- 源码与资源中没有角色素材、动画、媒体监控或其他产品的偏好迁移。

## 自动检查

- `.github/workflows/macos.yml`：测试并做 release 通用构建。
- `.github/workflows/windows.yml`：运行 Windows 回归程序并发布自包含构建（作为 Actions 产物，不创建 Release）。

## 仍需实机验收

1. macOS 与 Windows 真实客户端的账号创建、启动、调出与移除。
2. 两个个人账号同时登录时的会话归属与额度查询。
3. 完整跨账号文档接力：源对话生成文档 → 继续接力 → 目标新对话粘贴。
4. 浮球开关、显示隐藏、拖动与面板跟随；Windows 键盘操作（Tab / 回车）。
5. Intel Mac 上的通用构建。

逐项状态见 [功能对齐](../shared/parity.md)。
