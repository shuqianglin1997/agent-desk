# 帮装了 Catshelf 的人修问题、重新打包

这一页写给 AI 助手：有人装了 Catshelf（猫架，原名 AgentDesk），用的时候遇到问题，请你帮他修好，再在他自己的电脑上打一个新包装上。按下面的顺序做。仓库根目录的 `AGENTS.md` 里，“Only in the owner's own checkout”以外的规矩对你同样适用；那一节只属于项目所有者，你无权向 `shuqianglin1997/catshelf` 推送。整条路都不需要 GitHub 账号。

当前源码的验证范围见[验证记录](VALIDATION.md)，发布规矩见 [RELEASING.md](RELEASING.md)。

## 1. 能打开时：先跑 diagnostics

在他的电脑上运行装好的程序自带的命令行（不会打开窗口）：

```bash
# macOS
/Applications/Catshelf.app/Contents/MacOS/Catshelf --cli diagnostics
# 用过本机安装脚本时，也可以直接
catshelf diagnostics
```

Windows 的 portable `.exe` 是图形程序，用 `--output` 把结果写进一个新文件再读（与 [AI_INTERFACE.md](AI_INTERFACE.md) 的写法相同）：

```powershell
$exe = (Resolve-Path '.\Catshelf-unsigned-portable-x64.exe').Path
$result = Join-Path ([IO.Path]::GetTempPath()) ("catshelf-" + [guid]::NewGuid() + ".json")
Start-Process -FilePath $exe -ArgumentList @('--cli', 'diagnostics', '--output', ('"{0}"' -f $result)) -Wait
Get-Content -Raw $result
```

更早的包没有 `diagnostics`（会返回 `unknown-command`），改用 `capabilities`，它的 `data.build` 是同样的构建信息；日志也是这一版才有的。

`data.build` 说明这份程序是用哪份源码打的：

| 字段 | 含义 |
|---|---|
| `version` | 版本号，例如 `0.10.1-preview.1`；同一个版本号下有很多次提交，不能只凭它找源码 |
| `commit` | 打包时的完整提交号；`null` 表示这份包没有记录（打包时没有 git，例如从 ZIP 打的，或是加入这项记录以前打的包） |
| `dirty` | `true` 表示打包时 `src`、`assets` 或 `package.json` 还有没提交的改动，源码里的这个提交只是它的基础 |
| `repository` | 源码仓库地址 |
| `packaged` | `true` 才是装好的包；`false` 说明你运行的是源码 |

其余字段（见 [AI_INTERFACE.md](AI_INTERFACE.md) 的“排查问题”一节）：`system` 是系统与架构；`paths` 是数据目录和日志的位置；`checks.dataFolder` 不是 `ok` 时先解决数据目录的权限；`checks.desktop.running` 说命令行能不能找到正在运行的 Catshelf；macOS 上 `checks.appLocation` 是 `translocated` 或 `disk-image`，说明他是从“下载”或 DMG 里直接打开的，请他把 Catshelf 拖进“应用程序”再打开；`log.lines` 是日志的最后几行，`uncaught`、`command.failed` 这类行带着错误码和源码位置。

macOS 上，应用菜单里的“关于 Catshelf”（About Catshelf）也写着版本号、提交号的前 7 位（带 `+` 表示有没提交的改动）和仓库地址。

## 2. 打不开时

先问清楚：是一点开就弹出系统的提示，还是窗口出来一下就没了，还是什么都没发生。

**macOS：被系统拦下。** 未签名的测试版第一次打开一定会被拦下，这是系统的正常保护。判断：

- 提示里说无法验证 “Catshelf” 是否包含恶意软件、只有“完成”和“移到废纸篓”；或者“系统设置 → 隐私与安全性”下方写着 Catshelf 已被阻止。
- 可以在终端里只读地确认（不改任何东西）：`spctl --assess --type execute --verbose /Applications/Catshelf.app` 显示 `rejected`，说明它没有经过苹果公证，从网上下载来时就会被拦下。

放行办法只有一个：请他打开“系统设置 → 隐私与安全性”，在下方关于 Catshelf 的提示旁点“仍要打开”，再确认一次。不要教他去掉文件的隔离属性、关闭系统的安全检查或改系统设置里的其他项。提示说“已损坏”时，先核对下载文件的 SHA-256 与 `SHA256SUMS.txt`，不一致就重新下载；一致仍然这样，请他把提示原文发给你。提示说“会损坏你的电脑”、文件名是 v0.9.0 的，那是已被苹果吊销的旧包，不要再装。

**macOS：打开后闪退。** 系统的崩溃报告在 `~/Library/Logs/DiagnosticReports/`，文件名以 `Catshelf` 开头（`.ips`），也可以在“控制台”App 的“崩溃报告”里看；只把开头的异常类型、崩溃的线程和其中的帧给你即可，报告里会有他的用户名和路径，转述时去掉。Catshelf 自己的日志在 `~/Library/Logs/Catshelf/catshelf.log`，启动走到哪一步、有没有 `uncaught` 都在里面：`tail -n 40 ~/Library/Logs/Catshelf/catshelf.log`。

**Windows：被 SmartScreen 拦下。** 蓝色的“Windows 已保护你的电脑”是正常的：点“更多信息”，再点“仍要运行”。如果双击后什么都没发生，看“Windows 安全中心 → 病毒和威胁防护 → 保护历史记录”里有没有它；有的话请他自己决定是否还原，不要教他关掉防护。

**Windows：打开后闪退或没反应。** 打开“事件查看器 → Windows 日志 → 应用程序”，找时间对得上、级别为“错误”、来源是 “Application Error” 或 “Windows Error Reporting”、内容里有 `Catshelf` 的事件。也可以在 PowerShell 里只读地列出最近一小时的：

```powershell
Get-WinEvent -FilterHashtable @{ LogName = 'Application'; Level = 2; StartTime = (Get-Date).AddHours(-1) } |
  Where-Object { $_.Message -match 'Catshelf' } | Format-List TimeCreated, ProviderName, Message
```

Catshelf 自己的日志在 `%APPDATA%\AgentDesk\logs\catshelf.log`：`Get-Content -Tail 40 "$env:APPDATA\AgentDesk\logs\catshelf.log"`。

日志里只有固定的事件名、原因码、构建信息和源码位置，没有密钥、令牌、会话内容、标题或邮箱，主目录已写成 `~`，可以整段转给你。

## 3. 取回同一份源码（不需要账号）

```bash
git clone https://github.com/shuqianglin1997/catshelf.git
cd catshelf
git checkout <data.build.commit>
```

公开仓库的 `git clone` 不需要登录。电脑上没有 git 时，也可以在仓库网页上点 “Code → Download ZIP”，或直接下载某个提交的压缩包 `https://github.com/shuqianglin1997/catshelf/archive/<提交号>.zip`；这样拿到的源码没有 git 记录，打出的包 `commit` 会是 `null`。

- 如果 `git checkout` 报找不到这个提交，说明这份包是用还没推到 GitHub 的源码打的。你拿不到它的确切源码：如实告诉他，再决定是在公开的最新提交上修，还是请他联系项目所有者。
- 如果 `commit` 是 `null`（较早的包没有这项记录），先找 `v<version>` 这个 tag（`git tag -l "v<version>"`）；没有 tag 时，只能用 `package.json` 里是这个版本号的最新提交。这是推测，要告诉他。
- 如果 `dirty` 是 `true`，这份包里有源码里没有的改动，修完后的行为可能和他原来的不完全一样，也要告诉他。

## 4. 准备环境

- **Node.js 22.12 或更新**（`package.json` 的 `engines`），从 nodejs.org 下载安装即可。
- 在仓库里运行 `npm ci`。它会联网从 npm 下载依赖，并由 `electron` 包下载 Electron 本体（默认从 GitHub 的公开下载地址，匿名，不需要任何账号；网络不通时可以设 `ELECTRON_MIRROR` 用镜像）。第一次打包时 electron-builder 还会下载它自己的打包工具（例如 Windows portable 用的 NSIS），同样匿名。
- **macOS** 打包会用 Xcode 命令行工具编译两个小的原生程序（`xcrun swiftc`）；没有就先运行 `xcode-select --install`，不需要 Apple ID。
- **Windows** 打包确实需要 Visual Studio 的 C++ 编译器：打包前会用 MSVC 的 `cl.exe` 编译 `AgentDeskInputHelper.exe`（`scripts/build-native-helpers.js`），没有它会报 `native-helper-msvc-unavailable`。装免费的 “Visual Studio Build Tools”，勾选“使用 C++ 的桌面开发”，不需要微软账号。

## 5. 改之前要知道的

- 先读 `AGENTS.md` 的通用部分和 [STRUCTURE.md](STRUCTURE.md)：目录各管什么、依赖方向、测试怎么写。
- **这些名字一个都不能改**，改了他的账号、设置和设备配对就接不上（详见 [RENAME_PLAN.md](RENAME_PLAN.md) 第 2 节）：
  - 程序包标识 `com.hupo.agentdesk`；
  - 数据目录 `AgentDesk`（macOS `~/Library/Application Support/AgentDesk`，Windows `%APPDATA%\AgentDesk`）；
  - 钥匙串项 `AgentDesk Safe Storage`；
  - `profiles.json`、`settings.json`、`mesh.db`、`mesh-keys.json` 等文件名，`AGENTDESK_*` 环境变量和设备网协议里的标识。
- 不要读、打印或复制他的密码、令牌和登录文件；Catshelf 本来就不保存这些。
- 先写一个能复现问题的测试，看它失败，再改。

## 6. 检查

```bash
npm test
npm run check
```

两项都要通过。`npm run check:docs` 还会核对项目自己的验证记录：任何源码改动之后，它都会报“source changed since validation”，刷新这份记录是项目维护者的事，给他个人打包时可以不管这一条，其他报错要修。

## 7. 在他的电脑上打包、安装

打包前先让他退出 Catshelf，并把数据目录整个复制一份备份。打包全在他自己的电脑上做，不经过 GitHub 的打包服务。

**macOS**

```bash
npm run build:mac:dir
# Apple 芯片的输出在 release/mac-arm64/Catshelf.app，Intel 在 release/mac/Catshelf.app
npm run install:mac:local -- --source release/mac-arm64/Catshelf.app
```

安装脚本会先退出正在运行的 Catshelf，换上新包并重新打开，再在 `~/.local/bin` 写好 `catshelf` 命令。想要一个 DMG 时用 `npm run build:mac:test`，输出 `release/Catshelf-<version>-universal.dmg`（Apple 芯片与 Intel 通用）。`npm run build:mac` 是签名公证的发布包，需要项目的签名凭据，自己打包用不上。

**Windows**

```powershell
npm run build:win
# 输出 release\Catshelf-<version>-portable-x64.exe，替换他原来那个 exe 即可
```

自己打的包只做了本机签名（macOS）或没有签名（Windows），也没有苹果公证，只适合在这台电脑上用。它不是从网上下载的，系统通常不会拦；万一拦下（例如从别处拷过来的），照第 2 节在系统设置里放行或在 SmartScreen 里点“仍要运行”。macOS 上新包第一次读设备网的钥匙时，系统可能询问是否允许访问钥匙串项 `AgentDesk Safe Storage`，请他点“始终允许”。

装好后再运行一次第 1 步的 `diagnostics`，确认 `data.build.commit` 是你这次打包的提交（有没提交的改动时 `dirty` 为 `true`），`checks` 都正常。

## 8. 不要做的

- 不要把这个包发给其他人下载，也不要当成本项目的发布版本：本项目对外只发签名公证的 Preview，以及 GitHub 按打了标签的提交打出的未签名测试版（见 [RELEASING.md](RELEASING.md)）。
- 不要向 `shuqianglin1997/catshelf` 推送。他愿意的话，可以从自己的 fork 提一个 pull request，把修复交回项目。
- 不要为了绕过系统安全提示去改系统设置、去掉文件的隔离属性或关掉 SmartScreen 与杀毒防护；放行只用第 2 节的办法。
