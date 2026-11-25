# 帮装了 Catshelf 的人修问题、重新打包

这一页写给 AI 助手：有人装了 Catshelf（猫架，原名 AgentDesk），用的时候遇到问题，请你帮他修好，再在他自己的电脑上打一个新包装上。按下面的顺序做。仓库根目录的 `AGENTS.md` 里，“Only in the owner's own checkout”以外的规矩对你同样适用；那一节只属于项目所有者，你无权向 `shuqianglin1997/catshelf` 推送。

当前源码的验证范围见[验证记录](VALIDATION.md)，发布门禁见 [RELEASING.md](RELEASING.md)。

## 1. 先查清他装的是哪份源码

在他的电脑上运行装好的程序自带的命令行（不会打开窗口）：

```bash
# macOS
/Applications/Catshelf.app/Contents/MacOS/Catshelf --cli capabilities
# 用过本机安装脚本时，也可以直接
catshelf capabilities
```

Windows 的 portable `.exe` 是图形程序，用 `--output` 把结果写进一个文件再读（与 [AI_INTERFACE.md](AI_INTERFACE.md) 的写法相同）：

```powershell
$exe = (Resolve-Path '.\Catshelf-<version>-portable-x64.exe').Path
$result = Join-Path ([IO.Path]::GetTempPath()) ("catshelf-" + [guid]::NewGuid() + ".json")
Start-Process -FilePath $exe -ArgumentList @('--cli', 'capabilities', '--output', ('"{0}"' -f $result)) -Wait
Get-Content -Raw $result
```

看输出里 `data.build`：

| 字段 | 含义 |
|---|---|
| `version` | 版本号，例如 `0.10.1-preview.1`；同一个版本号下有很多次提交，不能只凭它找源码 |
| `commit` | 打包时的完整提交号；`null` 表示这份包没有记录（打包时没有 git，或是加入这项记录以前打的包） |
| `dirty` | `true` 表示打包时 `src`、`assets` 或 `package.json` 还有没提交的改动，源码里的这个提交只是它的基础 |
| `repository` | 源码仓库地址 |
| `packaged` | `true` 才是装好的包；`false` 说明你运行的是源码 |

macOS 上，应用菜单里的“关于 Catshelf”（About Catshelf）也写着版本号、提交号的前 7 位（带 `+` 表示有没提交的改动）和仓库地址。

## 2. 取回同一份源码

```bash
git clone https://github.com/shuqianglin1997/catshelf.git
cd catshelf
git checkout <data.build.commit>
```

- 如果 `git checkout` 报找不到这个提交，说明这份包是用还没推到 GitHub 的源码打的。你拿不到它的确切源码：如实告诉他，再决定是在公开的最新提交上修，还是请他联系项目所有者。
- 如果 `commit` 是 `null`（较早的包没有这项记录），先找 `v<version>` 这个 tag（`git tag -l "v<version>"`）；没有 tag 时，只能用 `package.json` 里是这个版本号的最新提交。这是推测，要告诉他。
- 如果 `dirty` 是 `true`，这份包里有源码里没有的改动，修完后的行为可能和他原来的不完全一样，也要告诉他。

## 3. 准备环境

- Node.js 22.12 或更新，然后在仓库里运行 `npm ci`。
- macOS 打包会用 Xcode 命令行工具编译一个小的原生程序（`xcrun swiftc`）；没有就先装 `xcode-select --install`。
- Windows 打包会用 Visual Studio Build Tools 的 C++ 编译器（`cl.exe`）编译原生程序。

## 4. 改之前要知道的

- 先读 `AGENTS.md` 的通用部分和 [STRUCTURE.md](STRUCTURE.md)：目录各管什么、依赖方向、测试怎么写。
- **这些名字一个都不能改**，改了他的账号、设置和设备配对就接不上（详见 [RENAME_PLAN.md](RENAME_PLAN.md) 第 2 节）：
  - 程序包标识 `com.hupo.agentdesk`；
  - 数据目录 `AgentDesk`（macOS `~/Library/Application Support/AgentDesk`，Windows `%APPDATA%\AgentDesk`）；
  - 钥匙串项 `AgentDesk Safe Storage`；
  - `profiles.json`、`settings.json`、`mesh.db`、`mesh-keys.json` 等文件名，`AGENTDESK_*` 环境变量和设备网协议里的标识。
- 不要读、打印或复制他的密码、令牌和登录文件；Catshelf 本来就不保存这些。
- 先写一个能复现问题的测试，看它失败，再改。

## 5. 检查

```bash
npm test
npm run check
```

两项都要通过。`npm run check:docs` 还会核对项目自己的验证记录：任何源码改动之后，它都会报“source changed since validation”，刷新这份记录是项目维护者的事，给他个人打包时可以不管这一条，其他报错要修。

## 6. 在他的电脑上打包、安装

打包前先让他退出 Catshelf，并把数据目录整个复制一份备份。

**macOS**

```bash
npm run build:mac:dir
# Apple 芯片的输出在 release/mac-arm64/Catshelf.app，Intel 在 release/mac/Catshelf.app
npm run install:mac:local -- --source release/mac-arm64/Catshelf.app
```

安装脚本会先退出正在运行的 Catshelf，换上新包并重新打开，再在 `~/.local/bin` 写好 `catshelf` 命令。这样打出的包只做了本机签名，在这台电脑上可以正常使用；新包第一次读设备网的钥匙时，系统可能询问是否允许访问钥匙串项 `AgentDesk Safe Storage`，请他点“始终允许”。

**Windows**

```powershell
npm run build:win
# 输出 release\Catshelf-<version>-portable-x64.exe，替换他原来那个 exe 即可
```

这样打出的 exe 没有代码签名，在打包的这台电脑上可以运行。

装好后再运行一次第 1 步的命令，确认 `data.build.commit` 是你这次打包的提交（有没提交的改动时 `dirty` 为 `true`）。

## 7. 不要做的

- 不要把这个包发给其他人下载，也不要当成本项目的发布版本：本项目对外只发签名公证的 Preview，以及 GitHub 按打了标签的提交打出的未签名测试版（见 [RELEASING.md](RELEASING.md)）。
- 不要向 `shuqianglin1997/catshelf` 推送。他愿意的话，可以从自己的 fork 提一个 pull request，把修复交回项目。
- 不要为了绕过系统安全提示去改系统设置或去掉文件的隔离属性；在他自己电脑上打的包本来就不需要。
