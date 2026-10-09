# 构建与分发

根目录 `VERSION` 是应用版本来源，本分支尚未正式发布。

```bash
swift test
./script/package-release.sh
```

生成 `dist.noindex/releases/AgentDeskNative-<版本>-universal.zip`、DMG 和 `SHA256SUMS`。打包使用 release 优化，检查 arm64 / x86_64 与签名。校验文件：`shasum -a 256 -c SHA256SUMS`。

可用 `AGENTDESK_NATIVE_CONFIGURATION`、`AGENTDESK_NATIVE_ARCHS`、`AGENTDESK_NATIVE_SIGNING_IDENTITY` 配置构建。默认 ad-hoc；指定 Developer ID 身份会启用 hardened runtime 与时间戳，但并不自动完成公证。不得加入证书、密码、token 或本机账号配置。

安装只管理 `~/Applications/AgentDeskNative.app`，Bundle ID 为 `com.agentdesk.native`。不替换现有 Electron 应用，不移动其他应用，不迁移其他产品偏好。
