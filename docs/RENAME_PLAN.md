# 改名：AgentDesk → Catshelf／猫架

所有者 2026-11-24 定名（“定 Catshelf ／ 猫架”），并定了时机：先改名，再一起装（“改完名再装”）。原则是看得见的全改，看不见的内部标识不动：所有者看到和用到的地方都是新名字，他的数据、钥匙串、设备配对和已有的调用方式不受影响。设备网计划第 33 节 1.38 记录了这条决定。

## 1. 改什么

- 应用显示名与程序包：`Catshelf.app`、`Catshelf.exe`；窗口标题、菜单、关于面板、通知、对话框；安装包与发布产物 `Catshelf-<版本>-universal.dmg`、`Catshelf-<版本>-portable-x64.exe`。
- 三种语言的词表：中文写“猫架”，英文和日文写 “Catshelf”，整句重读，读不通的改写。
- 页面里的预置文字、README、当前状态文档和 `AGENTS.md`。历史记录、ADR、验证记录里的旧名保留，那是历史。
- 命令行的说明文字与名字（见第 4 节）。

## 2. 不动什么，为什么

| 不动的 | 值 | 为什么 |
|---|---|---|
| 程序包标识 | `com.hupo.agentdesk` | 系统权限、钥匙串授权、通知设置、LaunchServices 都按它认应用 |
| 数据目录 | `~/Library/Application Support/AgentDesk`，Windows `%APPDATA%\AgentDesk` | 账号、设置、设备网数据库和钥匙文件都在里面 |
| 钥匙串项 | `AgentDesk Safe Storage`（账户 `AgentDesk Key`，旧版为 `AgentDesk`） | 设备网的 `mesh-keys.json` 用它加密；名字一变就解不开，已配对的设备要重配 |
| 设备网协议、信令、存盘里的标识与文件名 | `mesh.db`、`mesh-keys.json`、消息类型、默认设备名等 | 别的设备上的旧版本要认得 |
| 环境变量 | `AGENTDESK_*` | 调度中枢的调用方、测试与发布脚本在用 |
| 存盘与格式的名字 | `profiles.json` 等、`.agentdesk-task`、`agentdesk:lamp` 事件、`AgentDeskInspect`、`AgentDeskInputHelper`、localStorage 键 | 旧文件、旧任务包和验收脚本要继续读得懂 |
| npm 包名 | `agent-desk` | 只在 `package.json` 的 `name` 里，不出现在界面和安装包文件名上 |

仓库已在 2026-11-25 由所有者改名为 `shuqianglin1997/catshelf`，旧地址 `shuqianglin1997/agent-desk` 自动跳转。地址只写在 `package.json` 的 `repository`、`homepage` 与 `bugs`，自动更新和安装包里记录的源码地址都从 `repository` 读。

自动更新认发布产物时 `catshelf` 与 `agentdesk` 两种文件名都认。现在没有公开发布，所以不存在只认旧文件名的已发布版本。

## 3. 数据目录和钥匙串怎么保住

Electron 默认用应用名决定数据目录（`appData/<应用名>`），也用应用名决定钥匙串项（`<应用名> Safe Storage`）；应用名来自 `package.json` 的 `productName`，不是 Info.plist 的 `CFBundleName`。

`src/main.js` 的第一句调用 `src/core/product.js` 的 `keepLegacyIdentity(app)`：

1. 先把应用名设成 `AgentDesk`；
2. 没有显式 `--user-data-dir` 时，把数据目录固定为 `appData/AgentDesk`（目录不存在就先建）；
3. 在 `will-finish-launching` 时把应用名改回 `Catshelf`，菜单、对话框和关于面板从这里起都是新名字。这个监听器排在最前面：Electron 自己在同一事件里按当时的应用名建默认菜单（“关于 / 隐藏 / 退出 <名字>”），排在它后面菜单就会是旧名。

依据（2026-11-24，Electron 43.3.0，macOS 26.6）：`scripts/keychain-name-probe.js` 用 `node_modules` 里的 Electron 跑一个探针应用。它把 Electron 引用的 `SecItemCopyMatching`/`SecItemAdd`/`SecItemUpdate`/`SecItemDelete` 换成只记录名字、回答“没有”的替身，并在禁止连接钥匙串服务的沙箱里运行，所以碰不到真实钥匙串。结果：

- 不处理时，产品名 `ProbeNew` 用钥匙串项 `ProbeNew Safe Storage`，数据目录是 `appData/ProbeNew`；
- 先设旧名 `ProbeOld`、在 `will-finish-launching` 或 `ready` 再改回新名时，钥匙串项仍是 `ProbeOld Safe Storage`，数据目录是 `appData/ProbeOld`，此后应用名是 `ProbeNew`。钥匙串的名字在启动早期就定下，之后改名不影响。
- 改回新名的监听器如果排在 Electron 自己的后面，默认菜单是“About / Hide / Quit ProbeOld”；排在最前面时是 “ProbeNew”，钥匙串项不变。探针也核对这一项。

`test/product-identity.test.js` 看住这个函数的行为，`test/release-security.test.js` 看住它是 `src/main.js` 的第一句。Electron 升级后，先跑一次 `node scripts/keychain-name-probe.js` 再装。

Windows 上的 `safeStorage` 把密钥存在数据目录的 `Local State` 里，数据目录固定住就保住了；这一点没在 Windows 上实测。

## 4. 命令行的兼容

现在命令行只有一种暴露方式：应用里的可执行文件加 `--cli`（`/Applications/AgentDesk.app/Contents/MacOS/AgentDesk --cli …`）。文档和招募弹窗里的 `agentdesk` 只是 shell 变量名，PATH 上没有任何入口；调度中枢的调用方也是这样调用的，子进程只多带 `AGENTDESK_HUB_DEPTH`、`AGENTDESK_HUB_RUN`。

- 新的可执行文件是 `Catshelf.app/Contents/MacOS/Catshelf`（Windows 是 `Catshelf.exe` 或带版本的 portable）。`--cli`、命令、参数、输出字段和退出码都不变。
- 本机安装脚本在 `~/.local/bin` 写两个命令：`catshelf` 和别名 `agentdesk`，都转给 `/Applications/Catshelf.app` 的 `--cli`；开头多写的 `--cli` 会被忽略，所以 `catshelf capabilities` 和 `agentdesk --cli capabilities` 都能用。不是这个脚本写的同名文件不覆盖。
- 旧的绝对路径 `/Applications/AgentDesk.app/Contents/MacOS/AgentDesk` 会随旧应用一起消失（所有者要求电脑上只留一个版本）。把这个路径记在自己说明里的调用方，要改成 `catshelf`（或继续用 `agentdesk`）。

## 5. 安装

`scripts/install-local-macos.js` 装 `/Applications/Catshelf.app`：先退出旧的 AgentDesk 和已有的 Catshelf，装好、确认新版本从 `/Applications/Catshelf.app` 启动后，再确认没有进程映射着 `/Applications/AgentDesk.app`、它的程序包标识是 `com.hupo.agentdesk`，然后删掉它，最后写第 4 节的两个命令。

## 6. 没有验证的

- Windows：数据目录、`safeStorage`、portable 自更新的文件名都没在 Windows 上实测。
- 真实钥匙串：只在探针里看过名字，没有用装好的新版本打开设备网解一次钥匙。装好后第一次打开“设备”时，系统可能像每次重装开发版一样问一次是否允许访问 `AgentDesk Safe Storage`。
- 商标没人查过。
