# 代码结构：给第一次参与开发的人

这一页讲四件事：每个目录管什么、依赖可以往哪个方向走、加一个客户端或一条命令要改哪些地方、怎么跑测试和隐藏验收。每个文件的细节在 [INTERNAL.md](INTERNAL.md)，整理的来龙去脉在 [ARCHITECTURE_PLAN.md](ARCHITECTURE_PLAN.md)。开始之前先读仓库根目录的 `AGENTS.md`：提交、推送、密钥和不打扰使用者的规矩都在那里。

## 1. 目录各管什么

| 目录 | 管什么 |
|---|---|
| `src/core/` 与几个顶层纯模块 | 纯函数与基础件：路径、结果与事实类型、读写 JSON、设置、时间窗。不用 Electron，不认识上层 |
| `src/clients/<id>/` | 一家客户端的全部知识：名称、可执行文件、数据目录、会话怎么扫、导出、密钥交接、额度、能不能被调度中枢调用。`src/apps.js` 按固定顺序收集它们 |
| `src/session-index.js`、`src/scan-host.js` 等 | 领域服务：会话索引（扫描在工作线程里）、活动、额度、运行监管、调度中枢 `src/hub/`、任务包 `src/task-package/` |
| `src/mesh/` | 设备网：`domain/` 与 `protocol/` 是纯的模型和消息格式，`main/`、`storage/`、`network/` 是服务，`peer/`、`probe/` 是隐藏的沙箱连接页 |
| `src/commands/` | 命令表：窗口和命令行能发起的每个操作一条，按功能一个文件 |
| `src/main/` | 从 `src/main.js` 搬出来的 Main 模块，按职责分到服务、命令或通信层；`src/main/ipc/` 是窗口通道与安全策略 |
| `src/preload.js` | 窗口能调用的方法白名单，每个方法只到一个固定通道 |
| `src/renderer.js`、`src/renderer/`、`src/pixel/`、`src/i18n/` | 界面：启动、按视图拆开的原生模块、像素动效与声音、三种语言的词表 |
| `src/index.html` 与 `src/workspace.css`、`src/pixel.css`、`src/cats.css` | 主窗口的页面和三张样式表（分层的结构样式、不分层的皮肤、猫） |
| `src/remote/` | 远控的控制台与被控端提示，各是独立的沙箱窗口 |
| `src/automation/` | 命令行：源码态只读入口与成品命令行 |
| `native/` | 远端输入的平台 helper（macOS Swift、Windows C++） |
| `services/signaling/` | 可自托管的信令与 TURN 凭据服务 |
| `test/` | Node 测试；`test/helpers/` 是共用的替身与解析工具，`test/fixtures/` 是合成数据 |
| `scripts/` | 检查、生成、计时、隐藏验收与打包验证脚本 |
| `docs/` | 产品、内部结构、计划与验证记录；入口是 [README.md](README.md) |

每个源文件确切属于哪一层，看 INTERNAL.md 第 2 节的表（从 `scripts/check-layers.js` 生成）。

## 2. 依赖往哪个方向走

```text
ui → bridge → commands → services → clients → core
```

- 只能引用同层或更低层。界面只经 preload 白名单到 Main；命令不引用 Electron，Main 把它用到的服务当作参数传进去；客户端适配器不认识服务；`core` 什么上层都不认识。
- 两个启动入口 `src/main.js` 与 `src/automation/cli.js` 可以引用任何一层，它们只负责按顺序把各层接起来。
- 新文件先在 `scripts/check-layers.js` 的表里登记一层，否则 `test/architecture-tools.test.js` 失败。`node scripts/check-layers.js` 打印越层报告；`core` 与 `clients` 越层或用 Electron 会让测试失败，其余各层目前的越层数是 0，请保持。
- 判断放哪一层，看这个文件“知道什么”：只做计算的放 `core`；知道某家客户端细节的放 `clients`；把几个客户端或存盘组合成一件事的放服务；只为某条命令整理输入、调用服务的放命令层。按客户端名字写判断（`appId === 'codex'` 这类）只允许出现在 `src/clients/` 里，`node scripts/arch-metrics.js --summary` 会数出来。

## 3. 加一个客户端

1. 新建 `src/clients/<id>/index.js`，写出必填字段（标识、显示名、官方应用名、登录归属 `providerNamespace` 与形态 `clientForm`、隔离方式、Windows 特征、默认会话根、启动环境、扫描与诊断位置、发现特征），以及用得上的可选字段。字段清单与含义见 INTERNAL.md 第 5 节“新增一个客户端的清单”；`test/client-adapters.test.js` 只认清单里的字段，新能力先写进清单。`providerNamespace` 会进账号关联键并在设备间同步，定下以后不能改。
2. 会话扫描写在同一目录的 `sessions.js`，先把物理文件归成用户看得见的逻辑会话（压缩、子代理之类的内部记录不能变成新行）。可以复用 `src/clients/scan.js` 的有界遍历与读文件头尾；记录格式只写一个读取者，导出、附件、调度中枢的回答都用它。
3. 按需加 `transcript.js`（导出）、`credentials.js`（粘贴密钥交给官方客户端）、`import.js`（拖进来的登录文件）、`identity.js`（账号标识）、`hub.js`（能被调度中枢调用时的固定运行参数）。
4. 在 `src/apps.js` 的 `ADAPTERS` 里登记一行。不要在别处加按客户端名字的分支。
5. 是命令行工具时，在 `src/cli-discovery.js` 与 `src/tool-maintenance.js` 的固定目录里各加一项，适配器用 `cliDiscoveryId`、`maintenanceToolId` 指过去。
6. 新的界面文字加进 `src/i18n/zh.js`、`en.js`、`ja.js` 三张表，key 集合必须一致；用词按 [WORDING_PLAN.md](WORDING_PLAN.md)。
7. 测试：在系统临时目录里造合成的数据目录和会话文件，验证扫描结果、导出和发现特征；不读真实账号目录。把新文件加进 `package.json` 的 `check` 脚本（每个源文件一条 `node --check`）。

## 4. 加一条命令

1. 在 `src/commands/` 对应功能的文件里给 `COMMANDS` 加一项：`id`、`channel`（IPC 通道名）、`preload`（调用它的 preload 方法名）、可选的 `input`（整理输入）与 `poll`（现在能不能做，不能时给固定原因码），以及 `exec(deps, input, context)`。新功能新开一个文件时，在 `src/commands/registry.js` 的 `FEATURE_MODULES` 里登记。
2. 输入只接受稳定 ID、受限枚举和有界文本。路径、命令、参数、网址都不从窗口来：需要文件或目录时由 Main 打开系统选择框，需要执行什么由 Main 按自己的表生成。
3. `exec` 用到的 Main 服务从 `deps` 解构。名字是新的，就在 `src/main.js` 里提供它，再运行 `node scripts/main-context.js --write` 重新生成 `mainContext`（`test/command-table.test.js` 会核对）。
4. 在 `src/preload.js` 加同名方法，只调 `ipcRenderer.invoke` 到这一个固定通道；`test/command-table.test.js` 双向核对 preload 与命令表。
5. 运行 `node scripts/command-docs.js --write`，把 INTERNAL.md 第 7 节的接口清单和第 2 节的分层表重新生成；`npm run check:docs` 会核对它们。
6. 测试按行为写：用 `test/helpers/behaviour.js` 的 `runCommand(channel, deps, input)` 带替身依赖直接跑这条命令，证明多余的字段被丢掉、失败只返回固定原因码；用 `loadPreload()` 证明 preload 方法到的是这条通道。
7. 命令行也要用时，加在 `src/commands/cli-local.js`（在命令行进程里运行）或 `src/commands/cli-desktop.js`（转给正在运行的桌面）。

## 5. 测试与检查

每批改动提交前，三项都要过：

```bash
npm test
npm run check
npm run check:docs
```

- `npm test` 是全部 Node 测试；只跑一个文件用 `node --test test/<名字>.test.js`。`npm run check` 包括类型检查和每个源文件的语法检查；`npm run check:docs` 核对文档的链接、生成的两段、引用的路径和验证记录。
- 先写测试，再改代码。测试只用合成数据，放在系统临时目录里，用完删掉。
- 优先验证行为：命令用替身依赖运行，preload 在替身 Electron 里加载，页面和样式用 `page()`、`styleRules()` 解析后按结构核对。只比对源码文字的测试文件都列在 `test/text-checks.test.js` 里并写明理由；新增一个这样的文件而不写理由，这个测试就失败。
- 验证记录在 [VALIDATION.md](VALIDATION.md)，源码变了以后要重跑相关检查并刷新记录，`check:docs` 才会通过。

## 6. 隐藏验收

这些脚本用临时的数据目录和临时主目录启动真实的 Electron 窗口，窗口不显示、不抢焦点，不启动任何客户端、不联网，打开对话框、显示文件、剪贴板都由记录用的替身回答。脚本只经 `window.AgentDeskInspect` 读写界面。

```bash
node scripts/ui-acceptance.js --hidden
node scripts/hidden-check.js
```

- `ui-acceptance.js --hidden`：在 1040 × 840 窗口里走一遍全部任务路径（不加 `--hidden` 会打开看得见的窗口，只在明确需要时用）。
- `hidden-check.js`：读接口返回值的形状与基准对照，并数启动时的完整扫描次数。
- 改界面或样式时，先在改动前存一份基准，改完再比：

```bash
node scripts/ui-snapshots.js --write <基准目录>
node scripts/ui-snapshots.js --compare <基准目录>
node scripts/ui-styles.js --write <基准目录>
node scripts/ui-styles.js --compare <基准目录>
node scripts/ui-text.js --write <基准文件>
node scripts/ui-text.js --compare <基准文件>
```

  `ui-snapshots.js` 逐像素比较两套主题、三种语言下的各个状态；`ui-styles.js` 比较每个元素的全部计算样式（包括强制悬停、聚焦、按下）；`ui-text.js` 找出溢出或被截断的文字，以及界面上是否还出现已经退役的叫法。基准放在仓库以外的临时目录里。

不要在这些脚本运行期间修改源码，也不要在没有明确要求时打开看得见的窗口、启动客户端或安装应用。
