# 构建与分发

本分支尚未创建正式 Release。版本来源：macOS 为 `macos/VERSION`，Windows 为 `windows/VERSION`；变更写入根目录 `CHANGELOG.md`。

## macOS

```bash
swift test --package-path macos
./macos/script/package-release.sh
```

生成 `macos/dist.noindex/releases/AgentDeskNative-<版本>-universal.dmg`、同名 ZIP 和 `SHA256SUMS`。打包使用 release 优化，同时构建 arm64 / x86_64 并校验架构与签名。校验文件：`shasum -a 256 -c SHA256SUMS`。

可用 `AGENTDESK_NATIVE_CONFIGURATION`、`AGENTDESK_NATIVE_ARCHS`、`AGENTDESK_NATIVE_SIGNING_IDENTITY` 配置构建。默认 ad-hoc；指定 Developer ID 身份会启用 hardened runtime 与时间戳，但不会自动完成公证。

开发安装使用 `./macos/script/build_and_run.sh --install`，只管理 `~/Applications/AgentDeskNative.app`。不替换现有 Electron 应用，不移动其他应用，不迁移其他产品偏好。

## Windows

```powershell
./windows/script/build.ps1 -Action Test
./windows/script/build.ps1 -Action Package
```

无系统 SDK 时追加 `-Dotnet <dotnet.exe 的路径>`。自包含程序在 `dist.noindex/windows/AgentDeskNative/AgentDeskNative.exe`；便携包在 `dist.noindex/windows/releases/AgentDeskNative-Windows-<版本>-x64.zip`，同目录 `SHA256SUMS`。程序未签名。

不得在仓库中加入证书、密码、token 或本机账号配置。
