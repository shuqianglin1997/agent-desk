# Windows 版说明

## 产物

Windows 版使用 electron-builder 的 portable 目标：

`release/AgentDesk-<version>-portable-x64.exe`

不需要安装。AgentDesk 自己的配置仍保存在稳定的 `%APPDATA%\AgentDesk`，不会跟随 portable exe 的临时解压目录。

## GitHub 一键更新

账号操作栏中常驻的「`↻ 更新`」会查询固定仓库 `shuqianglin1997/agent-desk` 的最新正式 GitHub Release，并按语义版本比较当前版本；猫猫庭院和经典视图都能看到。

Windows portable 版满足以下条件时可以自动更新：

- 当前程序确实由 electron-builder portable `.exe` 启动
- portable `.exe` 仍存在，且所在目录可写
- Release 中有匹配当前 CPU 架构的 portable 资产
- GitHub 为该资产提供 SHA-256 digest

自动更新过程：

1. 主进程从固定 GitHub 仓库下载资产到系统临时目录。
2. 下载重定向只允许 GitHub 官方资产域名。
3. 同时校验 API 声明的文件大小和 SHA-256；任一不符都停止覆盖。
4. 独立 PowerShell 替换器等待 AgentDesk 退出，把原 `.exe` 备份为 `.old`，再放入新版本。
5. 替换失败时恢复旧文件；成功后重新启动同一路径的 portable `.exe`。

macOS、源码开发模式、只读目录、非 portable 启动方式、缺少匹配资产或 digest 时不会尝试覆盖，而是打开对应的 GitHub Release 页面供手动更新。

发布流水线会校验 Git tag 与 `package.json` 版本一致，并生成 `SHA256SUMS.txt`。Release 必须先由维护者审阅并正式发布；草稿和预发布版本不会被客户端当成最新版。

## Windows 上为什么不能只写死一个路径

Claude / Codex 当前同时存在传统 Win32 安装和 Microsoft Store / MSIX 安装。两者有两个关键差异：

1. MSIX 的可执行文件位于带版本号的 `C:\Program Files\WindowsApps\...`，更新后目录会变化。
2. MSIX 会把 App 对 `%APPDATA%` / `%LOCALAPPDATA%` 的访问重定向到包私有目录。官方 App、AgentDesk 和 Explorer 可能看到不同的“同名路径”。

因此 Windows 适配必须同时处理“启动器发现”和“数据目录解析”，不能再假设 `%APPDATA%\Claude` 与 `%LOCALAPPDATA%\Programs\Claude\Claude.exe` 永远成立。

## 默认数据目录

传统 Win32 安装通常使用：

- Claude：`%APPDATA%\Claude`
- Codex UI：`%APPDATA%\Codex`
- Codex 会话：`%USERPROFILE%\.codex`

Store / MSIX 安装的真实数据通常位于：

- Claude：`%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude`
- Codex UI：`%LOCALAPPDATA%\Packages\OpenAI.Codex_*\LocalCache\Roaming\Codex`
- Codex 会话仍是：`%USERPROFILE%\.codex`

默认槽位使用“自动路径”模式。每次读取配置时，AgentDesk 会比较传统目录和 MSIX 目录，优先选择实际存在且包含会话、`Local State` 等有效数据的目录。

## 独立账号目录

新建独立槽位使用：

`%USERPROFILE%\.agentdesk\profiles\<App>\<profile-id>`

这里刻意不放在 AppData：

- 避免 MSIX 文件系统虚拟化
- 避免 Explorer 打开逻辑路径时提示“位置不可用”
- 显示名称不进入磁盘路径，避免中文名称额外触发客户端兼容问题
- 稳定 ID 避免账号重名和改名导致目录碰撞
- portable exe 移动或升级后路径仍稳定

旧版本创建在 `%APPDATA%\AgentDesk\Profiles` 的槽位会在诊断中显示迁移建议。点击“一键迁移 Windows 路径”后：

- 自动寻找逻辑路径对应的 MSIX 实际重定向路径
- 复制登录态、配置和会话数据到新目录
- 跳过 Cache / GPUCache / Crashpad 等可再生缓存
- 更新账号目录及其内部的会话根目录
- 保留旧目录作为备份，不做删除

迁移前必须关闭该槽位对应的官方 App。

## 启动官方 App

Windows 启动器按下面顺序发现：

1. 用户在“路径”中手动指定的 `.exe`
2. `%LOCALAPPDATA%\Microsoft\WindowsApps\<App>.exe` 执行别名
3. `%LOCALAPPDATA%\Programs`、`Program Files` 等传统目录
4. Claude 旧版 Squirrel 的 `%LOCALAPPDATA%\AnthropicClaude\app-*\Claude.exe`
5. Windows `App Paths` 注册表
6. PowerShell `Get-AppxPackage` + 包清单找到的当前 MSIX 包内可执行文件
7. 每用户 AppModel 包仓库注册表中的 `PackageRootFolder`
8. 自动默认槽位最后可回退到 `claude://` / `codex://` 系统协议

Store 包目录名包含版本、架构和发布者 ID，且普通进程通常不能列举 `WindowsApps` 根目录。AgentDesk 不扫描该目录：优先使用 Windows 的 AppX 查询；每用户包仓库注册表作为独立兼容兜底，读取已登记包的完整安装根目录。商店更新后会重新解析，不保存带版本号的旧路径。注册表包键按正式的四段版本号做数值排序，并使用适配器声明的包身份名，因此也支持包名与界面名不同的应用（例如 `OpenAI.Codex`）。

自动发现会排除 npm 和 WinGet Links 中同名的 Claude/Codex CLI shim，避免把命令行工具误当成桌面 App。

处于“自动路径”模式的默认槽位在 Windows 上按官方方式启动，不强制传 `--user-data-dir`；独立槽位或手动修改过路径的默认槽位才传入配置目录。协议启动无法携带隔离参数，所以只允许作为自动默认槽位的最后回退。

运行状态探测也分两类：带自定义/独立目录的槽位继续按 `--user-data-dir` 精确匹配；自动默认槽位识别不带隔离参数的桌面 App 进程，并排除 npm / WinGet 等 CLI shim。

启动操作会监听异步 `spawn` 错误和“启动后立即非零退出”，失败时继续尝试下一个候选，不再仅因为路径存在就误报“已打开”。

## 打开会话文件

“打开所在位置”不会直接使用列表里缓存的绝对路径：

1. 主进程按账号和会话 ID 重新扫描，获取当前文件位置。
2. 调用 Explorer 前先检查文件和父目录是否仍存在。
3. Windows 上打开已验证的父目录，避免 `showItemInFolder` 对失效路径弹出系统错误。
4. 文件被清理、移动或路径过长时，逐级回退到最近可访问的上级目录，并在状态栏说明。

会话的稳定标识使用 session/thread ID，`filePath` 只代表当前扫描到的磁盘位置，不再被当成会话身份。

## 诊断内容

诊断面板会列出：

- Windows 版本与架构
- 当前启动方式及所有启动候选
- App Paths、MSIX 包仓库注册表、`Get-AppxPackage` 各自返回的候选数量
- 手动 `.exe` 是否失效
- 自动识别到的传统 / MSIX 数据目录候选
- 账号目录和会话根目录的存在、权限及长度
- AppData 虚拟化风险与建议迁移目录
- 会话扫描位置和数量
- `profiles.json` 配置位置

`profiles.json` 和 `settings.json` 都使用完整临时文件写入并保留 `.bak`。主文件损坏时优先从备份恢复，避免重启后账号槽位、猫咪颜色、主题或庭院偏好被静默重置。portable 替换前还会生成 `.pre-update.bak` 更新前快照。

## 真机发布检查

CI 会在 `windows-latest` 执行纯 Node 的 Windows 路径、启动候选、MSIX 映射和进程匹配测试，并调用系统 PowerShell 解析发现/更新脚本。正式发布前仍需要 Windows 11 真机完成：

1. Store/MSIX Claude 默认槽位能识别真实 `LocalCache\Roaming\Claude`。
2. 新建 Claude 独立槽位，登录后关闭 AgentDesk，再次打开仍能启动同一账号。
3. Claude 自动更新后，不修改配置也能重新找到新版本。
4. 删除或移动一条会话文件后，“打开所在位置”不出现“位置不可用”。
5. 旧 `%APPDATA%\AgentDesk\Profiles` 槽位能一键迁移并保留登录态。
6. Store/MSIX Codex 默认槽位能启动，`%USERPROFILE%\.codex` 会话可扫描。
7. 包含空格、中文和接近 240 字符的路径能给出正确诊断或安全回退。
8. 安装 Claude/Codex CLI 时，不会把 CLI shim 识别为桌面 App。
9. 从可写目录运行旧 portable 版，点击账号操作栏中的「`↻ 更新`」能下载、校验、替换并重启到新版本。
10. 从只读目录或非 portable 环境检查更新时，只打开 Release 页面，不覆盖本地文件。

## 构建命令

```bash
npm install
npm run check
npm test
npm run build:win
```

生成的 `AgentDesk-<version>-portable-x64.exe` 在 `release/` 目录下。Windows 包应优先在 Windows runner 或 Windows 真机上构建。
