# 添加账号（招募）实施规划

> 状态：所有者已于 2026-11-24 批准方向并要求开发。本文是这项工作的实施细化；`docs/PERSONAL_AGENT_MESH_PLAN.md` 仍是单一基准，两者冲突时以基准为准，并把差异写回基准的变更记录。
>
> 调研依据：2026-11-24 对各家官方文档与官方代码仓库的核对。只在论坛或问题单里见到的说法在下文标为“未证实”。没有用真实账号实际登录验证过任何一种。

## 1. 所有者批准的决定

1. 添加账号有四种做法，入口合成一个“招募”，按做法分而不是按客户端分：新来一只、把已有的领回来、拖进来、交给 AI。
2. **允许粘贴接口密钥和令牌。** 这改写了基准第 3 节第 35 条和 10.10 节里“不新增 API 密钥编辑器、不接管密钥配置”的写法。
3. 订阅账号优先。按量计费或第三方的接口账号短期不重要，但入口要留好，之后能从同一处接入。
4. AgentDesk 是开源工具，要覆盖主流客户端：现有七种之外，加 OpenCode、Gemini CLI、Qwen Code、Copilot CLI。
5. 没有疑问的部分直接开发；拿不准的列在第 8 节，和所有者讨论后再做。

## 2. 不变的边界

- AgentDesk 自己不保存任何密钥、令牌或密码：不进 `profiles.json`、`settings.json`、`mesh.db`、日志、诊断、命令行输出和 Renderer 状态。粘贴的密钥只做一件事——交给那个账号自己的官方客户端（它的登录命令的标准输入，或它自己目录里文档写明的配置文件），然后从内存清掉。
- 密钥不走命令行参数，不走环境变量继承给无关进程，不写进任何错误信息。
- Renderer 不提交任意路径。扫描到的目录、拖进来的文件都沿用现有做法：Main 发放一次性的选择编号（`pathSelectionRegistry`），或由 preload 提供落盘路径后由 Main 重新校验。
- 不跨设备同步任何登录；不改官方客户端的默认目录，除非用户明确选的就是它。
- 后台不拉起客户端、不打开登录页；只有用户点了才打开。
- 固定窗口骨架、复制契约、“台灯下的书桌”皮肤和“读的字与看的字”规则不变。

## 3. 四种做法

### 3.1 新来一只

选客户端、起名字，应用建好独立目录并打开官方登录。沿用现有的首次准备。改进一处：登录是否成功改用第 4 节各家的“成功判据”确认，而不是只靠观察目录。

### 3.2 把已有的领回来

扫描后列出找到的账号，按客户端分组，显示能认出的身份（邮箱或标签）、会话数和路径，已登记的标为“已在台面上”。建了设备网时，台面只摆账号库里的账号：已登记却没有账号认领的位置（它的账号被移走了，或登记时设备网的钥匙还没解开）标为“已登记，不在台面上”，仍可勾选；登记时沿用原来的登记，按设备网的归属规则放回台面——同一个登录已经在别的账号名下就并进那个登录，否则成为一个新账号，被移走的账号不会复活。设备页“待归属位置”用同一个说法。多选后一次登记。只登记目录，不复制任何登录。

扫描分三层，前两层不需要额外的系统授权：

1. 各家的默认位置和当前环境变量指向的目录。
2. 在用户主目录里按特征文件有限度地查：最多四层，跳过 `Library`、`node_modules`、`.git`、`.Trash`、云盘同步目录和 `Desktop`/`Documents`/`Downloads`（这三个在 macOS 上会触发授权弹窗）；有文件数和时间上限，可取消。
3. 用户自己指一个文件夹（系统选择器），在里面按同样的特征查。

### 3.3 拖进来

一个投放区，按拖进来的东西判断是什么：

- 一个目录：按特征认出是哪家的，原地登记。
- Codex 的 `auth.json`：沿用现有做法。
- DSH 的 `.credentials.yaml`、Kimi Code 的 `credentials/kimi-code.json`、OpenCode 的导出文件：复制进新建的独立目录。
- 认不出或不支持的：说明原因，不做任何事。

旁边写清每种客户端接受什么、不接受什么。凡是复制登录文件的，都要先提示：“这份登录只能在一处用，原来那处之后可能掉线。”

### 3.4 交给 AI

界面里给出可以直接复制的命令，并说明哪一步需要人在浏览器里点。成品命令行补齐：

- `profiles discover` 支持全部客户端，输出与界面扫描同源。
- `profiles create --app <id> --name <名字>`：新建一个独立环境，返回编号和目录。
- `profiles import-auth` 支持第 4 节里“能拖进来”的每一种文件。
- `profiles set-key --profile <编号>`：从标准输入读密钥，交给官方客户端；绝不回显。
- `profiles status --profile <编号>`：按成功判据报告是否已登录、用什么方式，不输出任何秘密。

以上写命令都在桌面实例锁下执行，沿用 `docs/AI_INTERFACE.md` 的输出与错误约定。

## 4. 各客户端的做法

| 客户端 | 分开的办法 | 特征（用于发现） | 成功判据 | 能拖进来的 | 粘贴密钥或令牌 | 接口账号 |
|---|---|---|---|---|---|---|
| Codex | `CODEX_HOME`；桌面版另需 `--user-data-dir`（未证实） | `auth.json`，或 `config.toml` 加 `sessions/` | `auth.json` 里有刷新令牌或接口密钥 | `auth.json`、整个目录 | `codex login --with-api-key`，密钥走标准输入 | `config.toml` 的 `model_provider` 与 `[model_providers.x]`，密钥放 `$CODEX_HOME/.env` |
| Claude CLI | `CLAUDE_CONFIG_DIR`，路径必须逐字节一致 | `projects/` 或 `settings.json`；默认目录另有 `~/.claude.json` | `claude auth status` 退出码为 0 | macOS 没有；Windows、Linux 的 `.credentials.json`（提示会互相挤掉） | `claude setup-token` 的令牌或接口密钥，写进该目录 `settings.json` 的 `env` | 同一处写 `ANTHROPIC_BASE_URL` 与 `ANTHROPIC_AUTH_TOKEN` |
| Claude 桌面版 | `--user-data-dir`（未证实，标“实验性”） | 默认数据目录 | 无可靠办法 | 无 | 不支持 | 不支持 |
| Cursor | `--user-data-dir` | `User/globalStorage/state.vscdb` | 无可靠办法；可尽力读缓存邮箱 | 无（只能原地登记目录） | 不支持 | 不支持 |
| Kimi Code | `KIMI_CODE_HOME` | `credentials/` 或 `config.toml` 加 `sessions/`；旧目录 `~/.kimi` 只提示不迁移 | `credentials/kimi-code.json` 的访问令牌非空，且配置里有对应的 provider 段 | 整个目录；登录文件加配置段 | `kimi provider catalog add <id> --api-key` | 配置文件的 `[providers.x]` |
| Kimi Work | 无 | 默认位置 | 无 | 无 | 不支持 | 不支持 |
| DSH | `DSH_HOME` | `.credentials.yaml` 或 `profiles/` | `.credentials.yaml` 里有 `refs.DEEPSEEK_API_KEY` 或账号记录 | `.credentials.yaml`（权限必须 0600）、整个目录 | 写进 `.credentials.yaml` 的 `refs` | 同上 |
| OpenCode | `XDG_DATA_HOME` 或 `OPENCODE_DB`，加 `--standalone` | 新版 `opencode.db`，旧版 `auth.json` | `opencode auth list` 非空 | `opencode auth export` 的文件；旧版 `auth.json` | `opencode auth login <provider> --method key` | 同左 |
| Gemini CLI | `GEMINI_CLI_HOME` | `.gemini/oauth_creds.json` 或 `.gemini/settings.json` | 有刷新令牌，或 `.gemini/.env` 里有密钥 | 整个目录；`oauth_creds.json`（未证实） | 写进 `.gemini/.env` 的 `GEMINI_API_KEY` | Vertex 相关变量，先不做 |
| Qwen Code | `QWEN_HOME` | `subscription_credentials.json`、`oauth_creds.json` 或 `settings.json` | 有登录文件，或设置里有 provider | 整个目录 | 设置文件的 `modelProviders` 加 `.env` | 同左 |
| Copilot CLI | 登录在系统钥匙串里，全机共用，换目录隔不开 | `~/.copilot` | 无可靠办法 | 无 | 见第 8 节 | 不做 |
| Antigravity | 隔不开：登录在系统钥匙串里，全机共用；只登记官方默认位置 | 数据目录 `Local State` 加 `app_storage.json`，且 `~/.gemini/antigravity` 存在 | 无可靠办法（不读钥匙串） | 无 | 不支持 | 不支持 |

几条必须照做的细节：

- Codex：每个目录固定 `cli_auth_credentials_store = "file"`；两次浏览器登录不能并行，批量添加要排队；不调用 `codex logout`（它会吊销别处的副本）。身份从 `auth.json` 的身份令牌里解出邮箱和套餐，只在 Main 里解，不出 Main。
- Claude CLI：启动前清掉继承来的 `ANTHROPIC_*`、`CLAUDE_CODE_OAUTH_TOKEN`、`CLAUDE_CODE_USE_*`、`CLAUDE_SECURESTORAGE_CONFIG_DIR`，否则会盖过这个目录自己的登录。写 `settings.json` 时合并保留原有内容，权限 0600，并提示令牌是明文存放在该目录里。
- Kimi：访问令牌为空表示已吊销，不能只看文件在不在。
- 复制登录文件等于搬家：Codex、Claude、Kimi、Qwen 的刷新令牌都是一次性的。

## 5. 界面

- 招募菜单的“新增 Agent”“导入 Codex”合并为一个“招募”，打开同一个弹窗，四段：新来一只、把已有的领回来、拖进来、交给 AI。首次使用弹窗里的“导入 Codex”“高级：手动导入运行位置”改为进入同一个弹窗的对应段。
- 粘贴密钥和接口账号放在“新来一只”里，选了客户端之后作为登录方式之一出现：“在官方窗口登录 / 粘贴密钥或令牌 / 接口账号（地址、密钥、模型）”。客户端不支持的方式不显示。
- 遵守现有皮肤：标题、按钮、标签用点阵字，说明和输入框用正文字体；弹窗跟着内容长高；每段只有一个填色主按钮。三种语言同时补齐。
- 动手前先出一版可操作的网页原型给所有者看；所有者说“开始做”后，应用里要和原型一致。

## 6. 分批

每一批都要：相关 Node 测试、`npm run check`、`npm run check:docs`，并用不显示窗口的方式核对界面；不安装、不拉起客户端、不提交、不推送，除非所有者明确要求。

1. **发现与批量登记（现有七种）。** 把 `src/codex-account-import.js` 的发现推广成每个客户端一份特征描述（放进 `src/apps.js` 的登记表）；三层扫描；多选批量登记；命令行 `profiles discover` 全客户端。完成标准：用夹具目录能发现七种、重复登记幂等、已登记的不重复出现、扫描可取消且不越界。
2. **统一的招募弹窗与投放区。** 四段界面；目录和文件的识别；DSH、Kimi 的文件导入；复制前的提示。完成标准：每种可拖的东西有一条通过的测试，不支持的有明确原因。
3. **粘贴密钥、令牌与接口账号。** Codex、Claude CLI、Kimi Code、DSH 四种；成功判据；命令行 `create`、`set-key`、`status`。完成标准：密钥不出现在任何持久化文件、日志和输出里（测试用哨兵值全盘搜索来证明）；官方命令用桩程序替身测试。
4. **新客户端。** 按 OpenCode、Gemini CLI、Qwen Code 的顺序，一次加一种。每种除了账号，还要有会话扫描适配（会话在哪里、稳定编号是什么）和启动方式，这部分需要先读各家的官方资料再定。Copilot CLI 等第 8 节讨论后再定。

## 7. 需要所有者用真实账号核对的

- 每种客户端各走一遍“新来一只”，确认登录后应用能认出来。
- Codex：拖入 `auth.json` 后原处是否掉线，与提示是否相符。
- Claude CLI：粘贴 `setup-token` 的令牌后能否正常对话。
- 桌面版多开（Codex、Claude、Cursor）在当前版本上是否仍然各自保持登录。

## 8. 拿不准、要先讨论的

1. **Copilot CLI。** 它的登录在系统钥匙串里全机共用，要分开只能每次启动时带上各自的令牌，这要求 AgentDesk 自己保存令牌，和“不保存任何密钥”冲突。备选：只支持默认的那一个账号；或者把令牌放进系统钥匙串里 AgentDesk 自己的条目。
2. **Antigravity。** 已定（所有者 2026-11-26：“你现在开发呀，你现在把这事情解决好”）：加，只支持这台电脑上登录的那一个账号。它的登录在系统钥匙串里、全机共用，分不出第二个；把令牌存下来轮流换进去的切换工具违反 AGENTS.md，不做。做法见第 9 节“Antigravity”一条。
3. **Cursor 的命令行（`agent`）。** 分开配置目录后登录是否跟着分开没有官方答复，是否值得加。
4. **Claude 的令牌明文写进 `settings.json`。** 已定（所有者 2026-11-24：“反正 AI 能操作也就行”）：保留这种写法。令牌写进该账号目录的 `settings.json`（权限只有本人可读），界面事先说明是明文；人和 AI 都可以通过招募弹窗或 `profiles set-key` 用它。
5. **旧的 Kimi 目录 `~/.kimi`。** 官方不迁移登录。应用是只提示，还是提供一键重新登录。

## 9. 实施记录

2026-11-24 第一批与第三批后台已实现，验证见 `docs/VALIDATION.md`。和第 4 节表格不同的地方（都按官方源码核对过）：

- Kimi Code：`kimi provider catalog add <目录里的服务商>` 只从 `--api-key` 或 `KIMI_REGISTRY_API_KEY` 取密钥，不读标准输入；AgentDesk 只用这个变量交给这一个子进程。工作区清单是 `projects.json`（`workspaces.json` 是旧名）。登录文件可能叫 `kimi-code-env-<16位>.json`（改过 OAuth 主机时）；没有 `kimi logout` 命令。
- DSH：没有任何设置密钥的命令，写 `.credentials.yaml`（`version: 1`，`refs` 与 `records`）是文档写明的做法；权限不是 0600 时 DSH 拒绝读取。`settings.yaml` 已是旧格式。会话在 `sessions/--<目录>--/<编号>/session.vN.jsonl[.zstd]`，已加扫描（见下面“会话”一条）。
- Codex：`codex login --with-api-key` 确认从标准输入读；`codex login status` 已登录退出码为 0；`$CODEX_HOME/.env` 会被加载，`CODEX_` 开头的键被忽略；自定义 provider 的 `wire_api` 现在只接受 `responses`；两个浏览器登录会互相取消（同一个 1455 端口）。
- Claude CLI：`claude auth status` 默认输出 JSON，已登录退出码为 0，`authMethod` 区分订阅、令牌、密钥和第三方；用户级 `settings.json` 的 `env` 可以放 `CLAUDE_CODE_OAUTH_TOKEN`。未证实：`setup-token` 令牌一定以 `sk-ant-oat01-` 开头（AgentDesk 用这个前缀区分令牌和密钥）。
第二批（统一招募弹窗与投放区）已按所有者确认的原型接进应用：Agent 标题行的“招募”直接打开它，首次使用里的“导入 Codex”“高级：手动导入运行位置”分别进入“拖进来”“把已有的领回来”。拖进来的东西先由 Main 检查、给出将要做的事；要复制登录文件时先显示“只能在一处用”的提示，确认后才写；检查之后位置变了就不做。

第四批已加 OpenCode、Gemini CLI、Qwen Code（会话扫描、启动、发现、登录状态、密钥或接口账号）。和第 4 节表格不同、按官方源码（OpenCode 2.4.1、gemini-cli main、qwen-code main）改的地方：

- OpenCode：`auth login --method key` 必须在终端里交互输入，不读标准输入；改用 `opencode auth import` 从标准输入读一份导出格式的数组（`--standalone`）。分开账号要 `XDG_DATA_HOME`（数据库 `opencode.db`），受管账号另给 `OPENCODE_CONFIG_DIR` 与 `XDG_STATE_HOME`；每次启动都带 `--standalone`，否则多个账号会共用固定端口 49374 上的后台服务。登录现在存在 `opencode.db` 的 `credential` 表里（明文 JSON）；`auth list` 没有登录时也返回 0，所以成功判据看它输出的列表非空，或数据库里有启用的凭据。旧版 `auth.json` 靠内容和 Codex 的同名文件区分，复制后新版启动时会导入；`auth export` 导出的文件（任意 `.json` 文件名，靠内容识别）先建好新的独立目录，再在里面运行官方的 `opencode --standalone auth import <文件>`，失败就撤回新目录。
- Gemini CLI：`GEMINI_CLI_HOME` 替换的是主目录，状态在 `$GEMINI_CLI_HOME/.gemini/`。在它界面里输入的接口密钥默认进系统钥匙串、全机共用；AgentDesk 管理的账号启动时设 `GEMINI_FORCE_FILE_STORAGE=true` 留在自己目录里，粘贴的密钥写进该账号 `.gemini/.env` 并设 `security.auth.selectedType = "gemini-api-key"`。身份取 `google_accounts.json` 的 `active` 邮箱。`oauth_creds.json` 可以拖进来，但没有用真实账号验证；Vertex 相关没做。
- Qwen Code：`QWEN_HOME` 就是状态目录本身（下面没有 `.qwen`）。`qwen auth` 命令已移除，免费的 Qwen OAuth 已于 2026-04-15 停止，所以“粘贴密钥”不提供，只提供接口账号：写该账号 `.env` 的 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 并设 `selectedType = "openai"`。即使改了 `QWEN_HOME`，Qwen 仍会用 `~/.qwen/.env` 和 `~/.env` 补齐没设的变量，这一点 AgentDesk 隔离不了。只接受拖入整个目录。
- 会话：OpenCode 读 `opencode.db`（`session_v2`，兼容 v1 的 `session` 表和更早的 `storage/session/*.json`），子会话（有 `parent_id`）不出现；Gemini 读 `.gemini/tmp/<项目>/chats/session-*.jsonl` 和旧的整文件 `.json`，`kind: "subagent"` 不出现；Qwen 读 `projects/<目录>/chats/*.jsonl` 与 `chats/archive/`，带 `parent_session` 的子会话和 `isSidechain` 记录不出现。三家都能导出正文（Markdown，只留用户和助手的文字，工具调用只留名字，思考过程不导出）。DSH 读 `sessions/--<目录>--/<编号>/` 下最新一代日志（`session.vN.jsonl`，或多个独立 zstd 帧组成的 `.zstd`；Node 自带的解压只解第一帧，所以按帧头切开逐帧解，写了一半的最后一帧跳过），标题取最新的 `session/title` 事件，带 `parentSession` 或 `delegationDepth` 的子会话不出现；DSH 的正文格式没有公开说明，暂不导出正文。

Antigravity（2026-11-26，Google 的 Agent 桌面应用 2.x；结构按所有者 Mac 上的 2.34.0 只读核对，表是空的）：

- 只支持这台电脑上登录的那一个账号：适配器用现有的 `official-default-only`（与 Kimi Work 相同），受管的第二个位置在新建、登记和启动三处都被拒绝（`client-default-only`、`profile-isolation-unsupported`）。“把已有的领回来”在默认位置找到它；“新来一只”里它只有一种做法“用这台电脑上登录的那一个”，在 Main 里按同一套发现找到官方位置后原地登记，不建目录、不打开窗口、不碰登录，已登记的就说已在台面上，没装就给固定原因 `client-default-missing`。这条路径对所有只有一个账号的客户端通用，Kimi Work 在“新来一只”里也随之可选。三种语言在客户端下拉、这种做法的说明和“拖进来”的表里都写明“只能用这台电脑上登录的那一个账号”。
- 位置：数据目录是官方默认的 `~/Library/Application Support/Antigravity`（Windows 按现有规则找 `%APPDATA%\Antigravity` 等），会话根总是 `~/.gemini/antigravity`（Windows 为 `%USERPROFILE%\.gemini\antigravity`），不跟着数据目录走。两处都在才算找到。macOS 打开时认 `com.google.antigravity`，而且不带 `open -n`，已经开着就带到前面（只有一个位置的客户端都这样，Kimi Work 同）。Windows 按 `%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe` 等现有候选找，没在 Windows 上核对过。
- 会话：用 `src/clients/sqlite.js` 只读查 `conversation_summaries.db` 的 `conversation_summaries`，先查表结构，只取认得的列；标题取 `title`，没有就取 `preview` 的第一行；项目取 `workspace_uris` 里第一个本机文件夹；时间取 `last_modified_time` 与 `last_user_input_time` 较晚的一个（Go 的零时间不算）；没有创建时间，所以不写。`parent_conversation_id` 不为空、`nesting_depth` 大于 0、或在 `conversation_parents` 里的子对话不进账本。`killed` 是被停掉的运行，对话照常列出、不算在跑；`status` 里带 archived 的标为已归档。库不存在是没有会话；库读不出、表不存在或缺列，返回固定原因 `session-store-unreadable`，不崩溃、不当成空。
- 在跑：`not_fully_idle` 为真、没有 `killed`、不是子对话的，按“在跑”计入卡片的条数，并带上会话地址，列表上的“在跑”与卡片一致（`src/activity-files.js` 新认 `sessionCounts` 返回的 `writingAddresses`）。
- 复制会话信息：路径是工作区文件夹；坐标是这条对话自己的位置加编号——有 `brain/<编号>/`（Agent 写的 Markdown 产物）就用它，否则 `conversations/<编号>.pb`，再没有就用 `conversation_summaries.db`。正文 `.pb` 是没有公开格式的 protobuf，猫架不读。
- 不支持、如实标出：额度（没有官方接口，不拿登录令牌去查）；后台调用（只能开窗口，它的命令行 `agy` 还没接入，原因码 `desktop-only-no-cli`）；Markdown 导出与任务包正文（正文是 protobuf）；粘贴密钥、接口账号、拖入登录文件。成品命令行 `apps` 的每个客户端新增 `quota` 与 `backgroundRuns` 两项，照实写支持与否和原因。
- 和 Gemini CLI 互不误认：`~/.gemini` 也是 Gemini CLI 的家。Antigravity 只从默认位置找，不参与主目录扫描；Gemini CLI 的特征新增 `excludedBy`（`conversation_summaries.db`、`antigravity_state.pbtxt`），即使 Antigravity 以后在自己目录里放 `settings.json` 也不会被认成 Gemini CLI。两个方向都有测试（`test/antigravity.test.js`）。
- 设备网：`providerNamespace` 定为 `antigravity`，`clientForm` 为 `desktop`，依据写在 `docs/PERSONAL_AGENT_MESH_PLAN.md` 第 33 节 1.41。
- 以后可以考虑：命令行版 `agy`（数据在 `~/.gemini/antigravity-cli/`，同样一机一个登录；所有者机器上没装）；“工具”里的桌面应用清单。
- 没有验证的：真实对话（所有者机器上的表还是空的，值的格式按防御写法读）；`brain/` 里到底有什么；Windows；`not_fully_idle` 在 Antigravity 意外退出后会不会留成真。

## 10. 来源

- Codex：learn.chatgpt.com/docs/auth.md、/docs/auth/ci-cd-auth.md、/docs/config-file/config-reference.md、/docs/app-server.md；github.com/openai/codex
- Claude：code.claude.com/docs/en/authentication、/cli-reference、/env-vars、/desktop
- Cursor：cursor.com/docs/cli/reference/authentication、/configuration；forum.cursor.com 上官方人员的答复
- Kimi：moonshotai.github.io/kimi-code；github.com/MoonshotAI/kimi-code
- DSH：github.com/deepseek-ai/deepseek-harness
- OpenCode：opencode.ai/docs；github.com/anomalyco/opencode
- Gemini CLI：geminicli.com/docs；github.com/google-gemini/gemini-cli
- Qwen Code：qwenlm.github.io/qwen-code-docs；github.com/QwenLM/qwen-code
- Copilot CLI：docs.github.com/en/copilot/how-tos/copilot-cli
- Antigravity：所有者 Mac 上 `/Applications/Antigravity.app` 2.34.0 的包结构与 `conversation_summaries.db` 的表结构（只读，不读内容）；discuss.ai.google.dev 上关于对话存成 `conversations/<编号>.pb`、Windows 安装位置的用户帖子（未证实）
