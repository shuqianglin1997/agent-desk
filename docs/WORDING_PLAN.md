# 界面用词改动清单（待所有者确认）

> 状态：**草案，没有改任何看得见的文字。** 来自架构整理第 8 阶段（`docs/ARCHITECTURE_PLAN.md` 第 9 节第 4 条）。规则由规划会话定，五个词等所有者确认；确认后才按这份清单改三种语言的词表和 `index.html` 的预置文字。
>
> 基于提交 `4fc4fff` 的 `src/i18n/{zh,en,ja}.js`（三份词表各 1717 条，key 完全一致）。2026-11-24 按规划会话的规则逐句修订。

## 1. 五个词（等所有者确认）

| 指的是什么 | 现在的叫法 | 改成 |
|---|---|---|
| 全局对象：一只猫，代码里的 `agent` | 中：Agent、员工、账号；英：Agent、employee、account；日：Agent、従業員、アカウント | **账号** / **account** / **アカウント** |
| 本机的运行位置，代码里的 `profile`、slot | 中：运行位置、槽位、账号槽位、Profile；英：runtime location、slot、account slot、Profile、Run at；日：実行場所、スロット、アカウントスロット、アカウント枠、Profile | **位置** / **location** / **場所**（三种语言一起改，不留 Profile） |
| 某个平台上的一次登录，代码里的 `binding` | 中：登录账号、账号绑定、平台账号；英：sign-in account、account binding、login binding；日：ログインアカウント、アカウント紐付け | **登录** / **sign-in** / **ログイン** |
| 全局目录 | 中：Agent 目录、Agent 库；英：Agent catalog、Agent directory、Agent library；日：Agent カタログ、Agent ディレクトリ | **账号库** / **account catalog** / **アカウントカタログ**（不再叫“目录”） |
| 位置在磁盘上的文件夹 | 中：账号目录、账号数据目录；英：account dir、account folder、account data directory；日：アカウントディレクトリ、アカウントフォルダー | **数据目录** / **data folder** / **データフォルダー**（与账号名片计划一致） |

不改的：`AgentDesk`、`Personal Agent Mesh` 这类名字；“资料 / Profile / プロフィール”指猫的档案页时；画面里的“猫”（卡片、招募、送走等说法）；“设备”“工作环境”；代码里的标识符和存盘字段。泛指 AI 工具、或调度中枢里“你自己的 Agent”的句子，调用方总是你的某个账号，按意思整句重写，没有逐词替换。中文与中文之间不加空格，中文与英文、数字之间照现有习惯空一格。

## 2. 代表性的 10 条

| key | 中文改前 | 中文改后 | 英文改后 | 日文改后 |
|---|---|---|---|---|
| `presenter.title` | Agent | 账号 | Accounts | アカウント |
| `devices.slot.label` | 运行位置 | 位置 | Location | 場所 |
| `diag.row.profileDir` | 账号目录 | 数据目录 | Data folder | データフォルダー |
| `onboarding.agent.title` | 创建第一个 Agent | 创建第一个账号 | Create your first account | 最初のアカウントを作成 |
| `catalog.assignment.existingAgent` | 已有 Agent 的另一个账号 | 已有账号的另一个登录 | Another sign-in for an existing account | 既存アカウントの別ログイン |
| `catalog.remove.intro` | 当前 Agent：{name}。请明确选择只移除一个位置、一个登录账号，还是整个 Agent。 | 当前账号：{name}。请明确选择只移除一个位置、一个登录，还是整个账号。 | Current account: {name}. Explicitly choose whether to remove one location, one sign-in, or the whole account. | 現在のアカウント: {name}。1 つの場所、1 つのログイン、またはアカウント全体のどれを削除するか明示的に選んでください。 |
| `catalog.merge.prompt` | 把“{source}”的 {bindings} 个登录账号和 {slots} 个运行位置合并到“{target}”？目标 Agent 的全局元数据将保留。 | 把“{source}”的 {bindings} 个登录和 {slots} 个位置合并到“{target}”？目标账号的全局元数据将保留。 | Merge {bindings} sign-ins and {slots} locations from “{source}” into “{target}”? The target account’s global metadata will be kept. | 「{source}」の {bindings} 件のログインと {slots} 件の場所を「{target}」に統合しますか？統合先アカウントのグローバルメタデータは保持されます。 |
| `status.removedSlot` | 已移除账号槽位。 | 已移除位置。 | Location removed. | 場所を削除しました。 |
| `welcome.lead` | 把长期工作的 Agent 放进一份目录，再选择它此刻在哪个设备和客户端工作。登录始终发生在官方客户端。 | 把长期工作的账号放进账号库，再选择它此刻在哪个设备和客户端工作。登录始终发生在官方客户端。 | Keep long-lived accounts in the account catalog, then choose the device and client where each one works now. Sign-in always stays in the official client. | 長く働くアカウントをアカウントカタログに置き、今どのデバイスとクライアントで働くかを選びます。ログインは常に公式クライアント内で行います。 |
| `hub.tip.run.body` | 你的 Agent 通过 AgentDesk 让这个账号在后台跑的一段对话。这里只显示标题和状态。 | 你的另一个账号通过 AgentDesk 让它在后台跑的一段对话。这里只显示标题和状态。 | A conversation another of your accounts had it run in the background, through AgentDesk. Only the title and state are shown here. | あなたの別のアカウントが AgentDesk を通じて、このアカウントにバックグラウンドで実行させた会話です。ここにはタイトルと状態だけを表示します。 |

合计：需要改的 key 212 条（中文 207、英文 209、日文 209），其中 112 条是按意思逐句改写的，其余按第 1 节的规则替换后逐条读过。

## 3. 需要所有者拍板的

1. **第 1 节的五个词。**
2. **招募里的“接口账号 / 订阅账号 / ChatGPT 账号”**（`recruit.method.provider`、`recruit.signedIn.*`）。按规则它们说的是平台上的登录，应写“接口登录 / 订阅登录 / ChatGPT 登录”；但这几个说法是招募计划里定下的。清单里暂按原样未改。
3. **会话为空时的提示**（`session.empty.none`）。中文原来说“这只猫还没有会话”，英文、日文说 Agent；清单按“账号”统一了三种语言。如果想保留“猫”，三种语言都改成猫。
4. **首次使用页的小标题**（`onboarding.existing.kicker`）。原来三种语言都写英文大写的 AGENT LIBRARY；清单按规则各用本语言（账号库 / ACCOUNT CATALOG / アカウントカタログ），也可以三种都写 ACCOUNT CATALOG。
5. **删除时的安全说明里的“第三方账号”**（`catalog.remove.safety`：“不会注销第三方账号”）。它说的是你在服务商那里的账号本身，不是 AgentDesk 里的对象，清单暂不改；也可以写成“不会注销你在服务商那里的账号”。
6. **全局对象没有名字时的默认名“Agent”**（`src/mesh/domain/agent-catalog.js`，存进账号库、各设备共用、不随语言变）。可以改成“账号”（只影响以后新建的），也可以不动。

## 4. 按界面区域的全部改动

每条给出 key、在代码里出现的位置（`index.html` 指页面里的预置文字，与中文词表相同，会一起改），三种语言的改前与改后；不需要改的语言写“（不变）”。逐句改写的条目带“说明”。

### 猫的档案

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `dossier.accounts.localNote` | `index.html` | | |
| | 中 | 合并与拆分登录账号需要先有本机 Agent 目录；招募第一只猫时会自动建立。 | 合并与拆分登录需要先有本机账号库；招募第一只猫时会自动建立。 |
| | 英 | Merging and splitting sign-in accounts needs the local Agent directory, which is created when you recruit your first cat. | Merging and splitting sign-ins needs the local account catalog, which is created when you recruit your first cat. |
| | 日 | ログインアカウントの統合と分割には、このコンピューターの Agent ディレクトリが必要です。最初の猫を迎えると自動で作成されます。 | ログインの統合と分割には、このコンピューターのアカウントカタログが必要です。最初の猫を迎えると自動で作成されます。 |
| `acct.slotDefault` | `renderer/views/roster.js` | | |
| | 中 | 默认槽位 | 默认位置 |
| | 英 | Default slot | Default location |
| | 日 | 既定の枠 | 既定の場所 |
| `acct.slotIndependent` | `renderer/views/roster.js` | | |
| | 中 | 独立槽位 | 独立位置 |
| | 英 | Isolated slot | Isolated location |
| | 日 | 独立した枠 | 独立した場所 |
| `acct.tip` | `renderer/views/roster.js` | | |
| | 中 | 账号 {p} · 会话 {s} | 数据目录 {p} · 会话 {s} |
| | 英 | Account {p} · Sessions {s} | Data folder {p} · Sessions {s} |
| | 日 | アカウント {p} · セッション {s} | データフォルダー {p} · セッション {s} |
| | 说明 | {p} 是位置的数据目录路径 | |

### 名册

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `roster.all.title` | `index.html` | | |
| | 中 | 看全部 Agent 的会话 | 看全部账号的会话 |
| | 英 | Show sessions from every Agent | Show sessions from every account |
| | 日 | すべての Agent のセッションを表示 | すべてのアカウントのセッションを表示 |

### 顶栏

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `topbar.devices.title` | `index.html` | | |
| | 中 | 查看本机设备身份、全局 Agent 目录和设备状态 | 查看本机设备身份、账号库和设备状态 |
| | 英 | View this device identity, the global Agent catalog, and device status | View this device identity, account catalog, and device status |
| | 日 | このデバイスの識別情報、グローバル Agent カタログ、状態を表示 | このデバイスの識別情報、アカウントカタログ、状態を表示 |

### Agent 标题行

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `presenter.title` | `index.html` | | |
| | 中 | Agent | 账号 |
| | 英 | Agents | Accounts |
| | 日 | Agent | アカウント |
| `presenter.positions` | `renderer/views/roster.js` | | |
| | 中 | {positions} 个位置 · {online} 在线 | （不变） |
| | 英 | {positions} locations · {online} online | （不变） |
| | 日 | 実行場所 {positions} 件 · オンライン {online} | 場所 {positions} 件 · オンライン {online} |

### 设备页

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `devices.lead.compact` | `index.html` | | |
| | 中 | 选择设备查看连接、权限、运行位置与会话概况。 | 选择设备查看连接、权限、位置与会话概况。 |
| | 英 | Choose a device to inspect connections, permissions, runtime locations, and sessions. | Choose a device to inspect connections, permissions, locations, and sessions. |
| | 日 | デバイスを選択して、接続、権限、実行場所、セッションを確認します。 | デバイスを選択して、接続、権限、場所、セッションを確認します。 |
| `devices.status.loading` | `renderer/views/devices.js` | | |
| | 中 | 正在读取本机设备与 Agent 目录… | 正在读取本机设备与账号库… |
| | 英 | Reading this device and the Agent catalog… | Reading this device and account catalog… |
| | 日 | このデバイスと Agent カタログを読み込み中… | このデバイスとアカウントカタログを読み込み中… |
| `devices.status.initializing` | `renderer/views/devices.js` | | |
| | 中 | 正在生成设备密钥并迁移本机 Agent 目录… | 正在生成设备密钥并迁移账号库… |
| | 英 | Generating device keys and migrating the local Agent catalog… | Generating device keys and migrating account catalog… |
| | 日 | デバイス鍵を生成し、ローカル Agent カタログを移行中… | デバイス鍵を生成し、アカウントカタログを移行中… |
| `devices.status.readyMesh` | `renderer/views/devices.js` | | |
| | 中 | 本机设备身份有效；设备与 Agent 目录已从独立 Mesh 存储读取。 | 本机设备身份有效；设备与账号库已从独立 Mesh 存储读取。 |
| | 英 | This device identity is valid; devices and Agents were read from the independent Mesh store. | This device identity is valid; devices and the account catalog were read from the independent Mesh store. |
| | 日 | デバイス ID は有効です。デバイスと Agent は独立した Mesh ストアから読み込まれました。 | デバイス ID は有効です。デバイスとアカウントカタログは独立した Mesh ストアから読み込まれました。 |
| `devices.status.resetDone` | `renderer/views/devices.js` | | |
| | 中 | 已回到纯本机 AgentDesk；账号槽位和会话没有删除。 | 已回到纯本机 AgentDesk；位置和会话没有删除。 |
| | 英 | AgentDesk is local-only again; account slots and sessions were preserved. | AgentDesk is local-only again; locations and sessions were preserved. |
| | 日 | ローカル専用の AgentDesk に戻りました。アカウントスロットとセッションは保持されています。 | ローカル専用の AgentDesk に戻りました。場所とセッションは保持されています。 |
| `devices.empty.body` | `index.html` | | |
| | 中 | 会为本机建立独立设备身份，并把当前账号身份组迁移成全局 Agent；不会移动账号目录、会话或登录信息。 | 会为本机建立独立设备身份，并把现有的身份组迁移成账号；不会移动数据目录、会话或登录信息。 |
| | 英 | AgentDesk creates an independent device identity and migrates current identity groups into global Agents. It does not move account folders, sessions, or sign-in data. | AgentDesk creates an independent device identity and migrates current identity groups into accounts. It does not move data folders, sessions, or sign-in data. |
| | 日 | 独立したデバイス ID を作成し、現在の ID グループをグローバル Agent に移行します。アカウントフォルダ、セッション、ログイン情報は移動しません。 | 独立したデバイス ID を作成し、現在の ID グループをアカウントに移行します。データフォルダー、セッション、ログイン情報は移動しません。 |
| `devices.connection.connected` | `renderer/views/devices.js` | | |
| | 中 | 已连接“{name}”，Agent 与会话库存正在同步。 | 已连接“{name}”，账号与会话库存正在同步。 |
| | 英 | Connected to “{name}”; Agent and session inventory is syncing. | Connected to “{name}”; account and session inventory is syncing. |
| | 日 | 「{name}」に接続しました。Agent とセッションのインベントリを同期中です。 | 「{name}」に接続しました。アカウントとセッションのインベントリを同期中です。 |
| `devices.reset.confirm` | `renderer/views/devices.js` | | |
| | 中 | 确定让本机离开并重置 Personal Agent Mesh？只会删除 Mesh 设备身份、目录缓存和密钥；现有账号槽位、登录与会话都保留。 | 确定让本机离开并重置 Personal Agent Mesh？只会删除 Mesh 设备身份、账号库缓存和密钥；现有位置、登录与会话都保留。 |
| | 英 | Make this computer leave and reset Personal Agent Mesh? Only the Mesh identity, catalog cache, and keys are removed; existing account slots, sign-ins, and sessions remain. | Make this computer leave and reset Personal Agent Mesh? Only the Mesh identity, account catalog cache, and keys are removed; existing locations, sign-ins, and sessions remain. |
| | 日 | このコンピューターを Personal Agent Mesh から離脱させてリセットしますか？Mesh ID、カタログキャッシュ、鍵のみ削除され、既存のアカウントスロット、ログイン、セッションは残ります。 | このコンピューターを Personal Agent Mesh から離脱させてリセットしますか？Mesh ID、アカウントカタログのキャッシュ、鍵のみ削除され、既存の場所、ログイン、セッションは残ります。 |
| `devices.stat.agents` | `renderer/views/devices.js` | | |
| | 中 | Agent | 账号 |
| | 英 | Agents | Accounts |
| | 日 | Agent | アカウント |
| `devices.stat.slots` | `renderer/views/devices.js` | | |
| | 中 | 运行位置 | 位置 |
| | 英 | Locations | （不变） |
| | 日 | 実行場所 | 場所 |
| `devices.meta.deviceAgentSlotCount` | `renderer/views/devices.js` | | |
| | 中 | {agents} 个 Agent · {slots} 个位置 | {agents} 个账号 · {slots} 个位置 |
| | 英 | {agents} Agents · {slots} locations | {agents} accounts · {slots} locations |
| | 日 | Agent {agents} 件 · 実行場所 {slots} 件 | アカウント {agents} 件 · 場所 {slots} 件 |
| `devices.list.agentCount` | `renderer/views/devices.js` | | |
| | 中 | {n} Agent | {n} 个账号 |
| | 英 | {n} Agents | {n} accounts |
| | 日 | Agent {n} | アカウント {n} |
| `devices.permission.inventory` | `index.html` | | |
| | 中 | 查看 Agent 与会话索引 | 查看账号与会话索引 |
| | 英 | View Agent and session inventory | View account and session inventory |
| | 日 | Agent とセッション索引を表示 | アカウントとセッション索引を表示 |
| `devices.permission.catalog` | `index.html` | | |
| | 中 | 管理全局 Agent 目录 | 管理账号库 |
| | 英 | Manage the global Agent catalog | Manage account catalog |
| | 日 | グローバル Agent カタログを管理 | アカウントカタログを管理 |
| `devices.agents.empty` | `renderer/views/devices.js` | | |
| | 中 | 当前没有 Agent。账号槽位可以删到零，不会自动补回默认平台账号。 | 当前没有账号。位置可以删到零，不会自动补回各平台的默认账号。 |
| | 英 | There are no Agents. Account slots may be deleted down to zero; default provider accounts are not recreated. | There are no accounts. Locations may be deleted down to zero; no default account is recreated for any platform. |
| | 日 | Agent はありません。アカウントスロットは 0 件まで削除でき、既定のプロバイダーアカウントは再作成されません。 | アカウントはありません。場所は 0 件まで削除でき、プラットフォームごとの既定アカウントは再作成されません。 |
| | 说明 | 原文“默认平台账号”指按平台预建的默认对象（全局对象），不是登录，所以写“各平台的默认账号” | |
| `devices.agents.devicePositions` | `renderer/views/devices.js` | | |
| | 中 | {slots} 个运行位置 | {slots} 个位置 |
| | 英 | {slots} runtime locations | {slots} locations |
| | 日 | 実行場所 {slots} 件 | 場所 {slots} 件 |
| `devices.agents.emptyOnDevice` | `renderer/views/devices.js` | | |
| | 中 | 这台设备当前没有 Agent 运行位置。 | 这台设备上当前没有任何账号的位置。 |
| | 英 | This device has no Agent runtime locations. | This device has no locations of any account. |
| | 日 | このデバイスには Agent の実行場所がありません。 | このデバイスにはどのアカウントの場所もありません。 |
| `devices.agents.noBinding` | `renderer/views/devices.js` | | |
| | 中 | 尚无账号绑定 | 尚无登录 |
| | 英 | No account binding yet | No sign-in yet |
| | 日 | アカウント紐付けなし | ログインなし |
| `devices.slot.label` | `renderer/views/roster.js` | | |
| | 中 | 运行位置 | 位置 |
| | 英 | Run at | Location |
| | 日 | 実行場所 | 場所 |
| `devices.slot.title` | `renderer/views/roster.js` | | |
| | 中 | 选择明确的设备和客户端运行位置；打开、诊断、路径、重扫等操作只作用于这里选中的位置 | 选择明确的设备和位置；打开、诊断、路径、重扫等操作只作用于这里选中的位置 |
| | 英 | Choose an exact device and client runtime location; Open, Diagnostics, Path, and Rescan act only on this selection | Choose an exact device and location; Open, Diagnostics, Path, and Rescan act only on this selection |
| | 日 | デバイスとクライアントの実行場所を明示的に選択します。開く、診断、パス、再スキャンはこの選択先だけに作用します | デバイスと場所を明示的に選択します。開く、診断、パス、再スキャンはこの選択先だけに作用します |
| `devices.slot.choose` | `renderer/views/agent-manage.js`、`renderer/views/roster.js` | | |
| | 中 | 选择运行位置… | 选择位置… |
| | 英 | Choose runtime location… | Choose location… |
| | 日 | 実行場所を選択… | 場所を選択… |
| `devices.slot.remoteMeta` | `renderer/views/roster.js` | | |
| | 中 | {device} · {status} · 远端运行位置 | {device} · {status} · 远端位置 |
| | 英 | {device} · {status} · remote runtime location | {device} · {status} · remote location |
| | 日 | {device} · {status} · リモート実行場所 | {device} · {status} · リモートの場所 |

### 目录与归属

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `catalog.unassigned.title` | `renderer/views/devices.js` | | |
| | 中 | 待归属运行位置 | 待归属位置 |
| | 英 | Unassigned runtime locations | Unassigned locations |
| | 日 | 未割り当ての実行場所 | 未割り当ての場所 |
| `catalog.add.choiceTitle` | `index.html`、`renderer/views/catalog-dialogs.js` | | |
| | 中 | 这个本机位置属于谁？ | （不变） |
| | 英 | Who owns this local location? | （不变） |
| | 日 | このローカル場所はどの Agent のものですか？ | このローカルの場所はどのアカウントのものですか？ |
| `catalog.assignment.newAgent` | `index.html` | | |
| | 中 | 新的 Agent | 新的账号 |
| | 英 | New Agent | New account |
| | 日 | 新しい Agent | 新しいアカウント |
| `catalog.assignment.existingAgent` | `index.html` | | |
| | 中 | 已有 Agent 的另一个账号 | 已有账号的另一个登录 |
| | 英 | Another account for an Agent | Another sign-in for an existing account |
| | 日 | 既存 Agent の別アカウント | 既存アカウントの別ログイン |
| `catalog.assignment.hintNew` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 同时创建一个全局 Agent、一个平台登录和这个本机运行位置。 | 同时创建一个账号、一个登录和这个本机位置。 |
| | 英 | Create a global Agent, a platform login, and this local runtime location together. | Create an account, a sign-in, and this local location together. |
| | 日 | グローバル Agent、プラットフォームのログイン、このローカル実行場所を同時に作成します。 | アカウント、ログイン、このローカルの場所を同時に作成します。 |
| `catalog.assignment.hintExistingAgent` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 为已有 Agent 增加一个新的平台登录，再把这个位置关联到它。 | 为已有账号增加一个新的登录，再把这个位置关联到它。 |
| | 英 | Add a new platform login to an existing Agent, then associate this location with it. | Add a new sign-in to an existing account, then associate this location with it. |
| | 日 | 既存 Agent に新しいプラットフォームログインを追加し、この場所を関連付けます。 | 既存アカウントに新しいログインを追加し、この場所を関連付けます。 |
| `catalog.assignment.hintExistingBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 这是某个已有登录在本机的新客户端位置；只增加位置，不新建 Agent。 | 这是某个已有登录在本机的新客户端位置；只增加位置，不新建账号。 |
| | 英 | This is another client location for an existing login; only a location is added, not another Agent. | This is another client location for an existing sign-in; only a location is added, not another account. |
| | 日 | 既存ログインの別クライアント場所です。Agent を増やさず、場所だけを追加します。 | 既存ログインの別クライアントの場所です。アカウントを増やさず、場所だけを追加します。 |
| `catalog.assignment.noAgent` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 目录中还没有可选的 Agent。 | 账号库中还没有可选的账号。 |
| | 英 | There are no existing Agents to select. | There are no existing accounts to select. |
| | 日 | 選択できる既存 Agent がありません。 | 選択できる既存アカウントがありません。 |
| `catalog.assignment.noCompatibleBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 当前应用没有同平台的已有登录；请改用“新的 Agent”或“已有 Agent 的另一个账号”。 | 当前应用没有同平台的已有登录；请改用“新的账号”或“已有账号的另一个登录”。 |
| | 英 | This app has no existing login for the same provider. Choose “New Agent” or “Another account for an Agent”. | This app has no existing sign-in for the same provider. Choose “New account” or “Another sign-in for an existing account”. |
| | 日 | このアプリと同じプロバイダーの既存ログインがありません。「新しい Agent」または「既存 Agent の別アカウント」を選んでください。 | このアプリと同じプロバイダーの既存ログインがありません。「新しいアカウント」または「既存アカウントの別ログイン」を選んでください。 |
| `catalog.field.agent` | `index.html` | | |
| | 中 | Agent | 账号 |
| | 英 | Agent | Account |
| | 日 | Agent | アカウント |
| `catalog.field.binding` | `index.html` | | |
| | 中 | 登录账号 | 登录 |
| | 英 | Login account | Sign-in |
| | 日 | ログインアカウント | ログイン |
| `catalog.edit.title` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 编辑全局 Agent | 编辑账号 |
| | 英 | Edit global Agent | Edit account |
| | 日 | グローバル Agent を編集 | アカウントを編集 |
| `catalog.edit.hint` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 此处修改全局 Agent——名称、分组、备注和猫咪外观会在所有设备上共用；当前运行位置的路径请从“路径”单独编辑。 | 此处修改账号——名称、分组、备注和猫咪外观会在所有设备上共用；当前位置的路径请从“路径”单独编辑。 |
| | 英 | This edits the global Agent. Its name, group, note, and cat appearance are shared across devices. Use Path separately for the current runtime location. | This edits the account. Its name, group, note, and cat appearance are shared across devices. Use Path separately for the current location. |
| | 日 | ここではグローバル Agent を編集します。名前、グループ、メモ、猫の外観は全デバイスで共有されます。現在の実行場所のパスは「パス」で別に編集してください。 | ここではアカウントを編集します。名前、グループ、メモ、猫の外観は全デバイスで共有されます。現在の場所のパスは「パス」で別に編集してください。 |
| `catalog.remove.slot` | `index.html` | | |
| | 中 | 移除此运行位置 | 移除此位置 |
| | 英 | Remove this runtime location | Remove this location |
| | 日 | この実行場所を削除 | この場所を削除 |
| `catalog.remove.binding` | `index.html` | | |
| | 中 | 移除此登录账号 | 移除此登录 |
| | 英 | Remove this login account | Remove this sign-in |
| | 日 | このログインアカウントを削除 | このログインを削除 |
| `catalog.remove.agent` | `index.html` | | |
| | 中 | 删除整个 Agent | 删除整个账号 |
| | 英 | Delete the entire Agent | Delete the entire account |
| | 日 | Agent 全体を削除 | アカウント全体を削除 |
| `catalog.remove.agentHint` | `index.html` | | |
| | 中 | 删除 Agent、它的账号绑定和所有位置关系。 | 删除账号、它的登录和所有位置关系。 |
| | 英 | Delete the Agent, its account bindings, and every runtime-location relationship. | Delete the account, its sign-ins, and every location relationship. |
| | 日 | Agent、アカウント紐付け、すべての実行場所の関係を削除します。 | アカウント、ログイン、すべての場所の関係を削除します。 |
| `catalog.remove.localRegistration` | `index.html` | | |
| | 中 | 同时从本机 AgentDesk 删除这个槽位登记（不删除官方客户端数据） | 同时从本机 AgentDesk 删除这个位置登记（不删除官方客户端数据） |
| | 英 | Also remove this slot registration from local AgentDesk (official client data is not deleted) | Also remove this location registration from local AgentDesk (official client data is not deleted) |
| | 日 | このスロット登録もローカル AgentDesk から削除する（公式クライアントデータは削除しない） | この場所登録もローカル AgentDesk から削除する（公式クライアントデータは削除しない） |
| `catalog.remove.intro` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 当前 Agent：{name}。请明确选择只移除一个位置、一个登录账号，还是整个 Agent。 | 当前账号：{name}。请明确选择只移除一个位置、一个登录，还是整个账号。 |
| | 英 | Current Agent: {name}. Explicitly choose whether to remove one location, one login account, or the whole Agent. | Current account: {name}. Explicitly choose whether to remove one location, one sign-in, or the whole account. |
| | 日 | 現在の Agent: {name}。1 つの場所、1 つのログインアカウント、または Agent 全体のどれを削除するか明示的に選んでください。 | 現在のアカウント: {name}。1 つの場所、1 つのログイン、またはアカウント全体のどれを削除するか明示的に選んでください。 |
| `catalog.remove.impactSlot` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将移除“{device} / {app}”这 1 个运行位置的目录关系。 | 将从账号库移除“{device} / {app}”这 1 个位置的关系。 |
| | 英 | The catalog relationship for the single “{device} / {app}” runtime location will be removed. | The account catalog relationship for the single “{device} / {app}” location will be removed. |
| | 日 | 「{device} / {app}」の 1 つの実行場所のカタログ関係を削除します。 | 「{device} / {app}」の 1 つの場所について、アカウントカタログ上の関係を削除します。 |
| `catalog.remove.impactBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将移除“{binding}”，影响 {devices} 台设备、{slots} 个运行位置和 {sessions} 条会话索引。 | 将移除“{binding}”，影响 {devices} 台设备、{slots} 个位置和 {sessions} 条会话索引。 |
| | 英 | “{binding}” will be removed, affecting {devices} devices, {slots} runtime locations, and {sessions} indexed sessions. | “{binding}” will be removed, affecting {devices} devices, {slots} locations, and {sessions} indexed sessions. |
| | 日 | 「{binding}」を削除し、{devices} 台のデバイス、{slots} 件の実行場所、{sessions} 件のセッション索引に影響します。 | 「{binding}」を削除し、{devices} 台のデバイス、{slots} 件の場所、{sessions} 件のセッション索引に影響します。 |
| `catalog.remove.impactAgent` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将删除“{name}”，影响 {bindings} 个登录账号、{devices} 台设备、{slots} 个运行位置和 {sessions} 条会话索引。 | 将删除“{name}”，影响 {bindings} 个登录、{devices} 台设备、{slots} 个位置和 {sessions} 条会话索引。 |
| | 英 | “{name}” will be deleted, affecting {bindings} login accounts, {devices} devices, {slots} runtime locations, and {sessions} indexed sessions. | “{name}” will be deleted, affecting {bindings} sign-ins, {devices} devices, {slots} locations, and {sessions} indexed sessions. |
| | 日 | 「{name}」を削除し、{bindings} 件のログイン、{devices} 台のデバイス、{slots} 件の実行場所、{sessions} 件のセッション索引に影響します。 | 「{name}」を削除し、{bindings} 件のログイン、{devices} 台のデバイス、{slots} 件の場所、{sessions} 件のセッション索引に影響します。 |
| `catalog.remove.disappear` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 这是最后一个有效关系；完成后该 Agent 将从 AgentDesk 消失。 | 这是最后一个有效关系；完成后该账号将从 AgentDesk 消失。 |
| | 英 | This is the final effective relationship. The Agent will disappear from AgentDesk afterward. | This is the final effective relationship. The account will disappear from AgentDesk afterward. |
| | 日 | これが最後の有効な関係です。完了後、この Agent は AgentDesk から消えます。 | これが最後の有効な関係です。完了後、このアカウントは AgentDesk から消えます。 |
| `catalog.relations.title` | `index.html` | | |
| | 中 | Agent 关系 | 账号关系 |
| | 英 | Agent relationships | Account relationships |
| | 日 | Agent の関係 | アカウントの関係 |
| `catalog.relations.summary` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | “{name}”当前有 {bindings} 个登录账号、{slots} 个运行位置。合并和拆分只修改 AgentDesk 目录关系。 | “{name}”当前有 {bindings} 个登录、{slots} 个位置。合并和拆分只修改账号库里的关系。 |
| | 英 | “{name}” currently has {bindings} login accounts and {slots} runtime locations. Merge and split only change AgentDesk catalog relationships. | “{name}” currently has {bindings} sign-ins and {slots} locations. Merge and split only change relationships in the account catalog. |
| | 日 | 「{name}」には現在 {bindings} 件のログインアカウントと {slots} 件の実行場所があります。統合と分割は AgentDesk のカタログ関係のみを変更します。 | 「{name}」には現在 {bindings} 件のログインと {slots} 件の場所があります。統合と分割はアカウントカタログ内の関係だけを変更します。 |
| `catalog.merge.title` | `index.html` | | |
| | 中 | 合并 Agent | 合并账号 |
| | 英 | Merge Agents | Merge accounts |
| | 日 | Agent を統合 | アカウントを統合 |
| `catalog.merge.hint` | `index.html` | | |
| | 中 | 当前 Agent 作为来源；目标 Agent 的名称和猫咪外观保留。只改变 AgentDesk 目录关系。 | 当前账号作为来源；目标账号的名称和猫咪外观保留。只改变账号库里的关系。 |
| | 英 | The current Agent is the source. The target Agent keeps its name and cat appearance. Only AgentDesk catalog relationships change. | The current account is the source. The target account keeps its name and cat appearance. Only relationships in the account catalog change. |
| | 日 | 現在の Agent が統合元です。統合先 Agent の名前と猫の外観は保持されます。AgentDesk のカタログ関係だけが変わります。 | 現在のアカウントが統合元です。統合先アカウントの名前と猫の外観は保持されます。アカウントカタログ内の関係だけが変わります。 |
| `catalog.merge.noTarget` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 没有其他可合并的 Agent。 | 没有其他可合并的账号。 |
| | 英 | There is no other Agent to merge into. | There is no other account to merge into. |
| | 日 | 統合できる他の Agent がありません。 | 統合できる他のアカウントがありません。 |
| `catalog.merge.prompt` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 把“{source}”的 {bindings} 个登录账号和 {slots} 个运行位置合并到“{target}”？目标 Agent 的全局元数据将保留。 | 把“{source}”的 {bindings} 个登录和 {slots} 个位置合并到“{target}”？目标账号的全局元数据将保留。 |
| | 英 | Merge {bindings} login accounts and {slots} runtime locations from “{source}” into “{target}”? The target Agent’s global metadata will be kept. | Merge {bindings} sign-ins and {slots} locations from “{source}” into “{target}”? The target account’s global metadata will be kept. |
| | 日 | 「{source}」の {bindings} 件のログインと {slots} 件の実行場所を「{target}」に統合しますか？統合先 Agent のグローバルメタデータは保持されます。 | 「{source}」の {bindings} 件のログインと {slots} 件の場所を「{target}」に統合しますか？統合先アカウントのグローバルメタデータは保持されます。 |
| `catalog.split.title` | `index.html` | | |
| | 中 | 拆分登录账号 | 拆分登录 |
| | 英 | Split login account | Split sign-in |
| | 日 | ログインアカウントを分割 | ログインを分割 |
| `catalog.split.hint` | `index.html` | | |
| | 中 | 把选定的平台登录和它的全部运行位置移到一个新 Agent。 | 把选定的登录和它的全部位置移到一个新账号。 |
| | 英 | Move the selected platform login and all its runtime locations into a new Agent. | Move the selected sign-in and all its locations into a new account. |
| | 日 | 選択したプラットフォームログインとすべての実行場所を新しい Agent に移します。 | 選択したログインとすべての場所を新しいアカウントに移します。 |
| `catalog.split.newName` | `index.html` | | |
| | 中 | 新 Agent 名称 | 新账号名称 |
| | 英 | New Agent name | New account name |
| | 日 | 新しい Agent 名 | 新しいアカウント名 |
| `catalog.split.noBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 当前 Agent 没有可拆分的登录账号。 | 当前账号没有可拆分的登录。 |
| | 英 | The current Agent has no login account that can be split. | The current account has no sign-in that can be split. |
| | 日 | 現在の Agent に分割できるログインアカウントがありません。 | 現在のアカウントに分割できるログインがありません。 |
| `catalog.split.prompt` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 把“{binding}”及它的 {slots} 个运行位置拆分为新 Agent“{name}”？ | 把“{binding}”及它的 {slots} 个位置拆分为新账号“{name}”？ |
| | 英 | Split “{binding}” and its {slots} runtime locations into the new Agent “{name}”? | Split “{binding}” and its {slots} locations into the new account “{name}”? |
| | 日 | 「{binding}」とその {slots} 件の実行場所を新しい Agent「{name}」に分割しますか？ | 「{binding}」とその {slots} 件の場所を新しいアカウント「{name}」に分割しますか？ |
| `catalog.assign.title` | `index.html` | | |
| | 中 | 归属待处理运行位置 | 归属待处理位置 |
| | 英 | Assign runtime location | Assign location |
| | 日 | 実行場所を割り当て | 場所を割り当て |
| `catalog.assign.summary` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将“{device} / {app} / {label}”重新归属到全局 Agent 目录。当前状态：{state}。 | 将“{device} / {app} / {label}”重新归属到账号库。当前状态：{state}。 |
| | 英 | Reassign “{device} / {app} / {label}” to the global Agent catalog. Current state: {state}. | Reassign “{device} / {app} / {label}” in the account catalog. Current state: {state}. |
| | 日 | 「{device} / {app} / {label}」をグローバル Agent カタログに再割り当てします。現在の状態: {state}。 | 「{device} / {app} / {label}」をアカウントカタログで再割り当てします。現在の状態: {state}。 |
| `catalog.status.created` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已创建运行位置并完成明确归属。 | 已创建位置并完成明确归属。 |
| | 英 | The runtime location was created with an explicit assignment. | The location was created with an explicit assignment. |
| | 日 | 明示的な割り当てで実行場所を作成しました。 | 明示的な割り当てで場所を作成しました。 |
| `catalog.status.saved` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已保存全局 Agent 元数据。 | 已保存账号资料。 |
| | 英 | Global Agent metadata was saved. | Account details were saved. |
| | 日 | グローバル Agent のメタデータを保存しました。 | アカウントの情報を保存しました。 |
| `catalog.status.merged` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | Agent 已合并。 | 账号已合并。 |
| | 英 | The Agents were merged. | The accounts were merged. |
| | 日 | Agent を統合しました。 | アカウントを統合しました。 |
| `catalog.status.split` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 登录账号已拆分到新 Agent。 | 登录已拆分到新账号。 |
| | 英 | The login account was split into a new Agent. | The sign-in was split into a new account. |
| | 日 | ログインアカウントを新しい Agent に分割しました。 | ログインを新しいアカウントに分割しました。 |
| `catalog.status.assigned` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 运行位置已归属。 | 位置已归属。 |
| | 英 | The runtime location was assigned. | The location was assigned. |
| | 日 | 実行場所を割り当てました。 | 場所を割り当てました。 |
| `catalog.error.generic` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | Agent 目录操作失败：{code} | 账号库操作失败：{code} |
| | 英 | Agent catalog operation failed: {code} | Account catalog operation failed: {code} |
| | 日 | Agent カタログ操作に失敗しました: {code} | アカウントカタログ操作に失敗しました: {code} |

### 交接任务

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `taskPackage.import.lead` | `index.html` | | |
| | 中 | 先验证文件和密钥，再选择本机 Agent 与运行位置。只有明确支持的适配器才会写入原生客户端会话。 | 先验证文件和密钥，再选择本机账号与位置。只有明确支持的适配器才会写入原生客户端会话。 |
| | 英 | Verify the file and code first, then choose a local Agent and runtime location. Native client history is written only by an explicitly supported adapter. | Verify the file and code first, then choose a local account and location. Native client history is written only by an explicitly supported adapter. |
| | 日 | 先にファイルとコードを検証し、次にこのコンピューターの Agent と実行場所を選びます。明示的に対応するアダプターだけがネイティブ会話を書き込みます。 | 先にファイルとコードを検証し、次にこのコンピューターのアカウントと場所を選びます。明示的に対応するアダプターだけがネイティブ会話を書き込みます。 |
| `taskPackage.import.target` | `index.html` | | |
| | 中 | 接收这项工作的本机 Agent 与运行位置 | 接收这项工作的本机账号与位置 |
| | 英 | Local Agent and runtime location receiving this work | Local account and location receiving this work |
| | 日 | この作業を受け取る Agent と実行場所 | この作業を受け取るアカウントと場所 |
| `taskPackage.import.openAfter` | `index.html` | | |
| | 中 | 导入后打开目标 Agent | 导入后打开目标账号 |
| | 英 | Open the target Agent after import | Open the target account after import |
| | 日 | 取り込み後に対象 Agent を開く | 取り込み後に対象アカウントを開く |
| `taskPackage.import.status.verified` | `renderer/views/task-packages.js` | | |
| | 中 | 任务包验证通过。请选择接收工作的 Agent 与运行位置。 | 任务包验证通过。请选择接收工作的账号与位置。 |
| | 英 | Package verified. Choose the Agent and runtime location that will receive the work. | Package verified. Choose the account and location that will receive the work. |
| | 日 | パッケージを検証しました。作業を受け取る Agent と実行場所を選んでください。 | パッケージを検証しました。作業を受け取るアカウントと場所を選んでください。 |
| `taskPackage.import.status.noTarget` | `renderer/views/task-packages.js` | | |
| | 中 | 任务包验证通过，但本机没有兼容的 Agent 运行位置。 | 任务包验证通过，但本机没有兼容的账号位置。 |
| | 英 | Package verified, but this computer has no compatible Agent runtime location. | Package verified, but this computer has no compatible account location. |
| | 日 | パッケージを検証しましたが、互換性のある Agent の実行場所がありません。 | パッケージを検証しましたが、互換性のあるアカウントの場所がありません。 |
| `taskPackage.incoming.inspect` | `renderer/views/task-packages.js` | | |
| | 中 | 验证内容并选择接收 Agent | 验证内容并选择接收账号 |
| | 英 | Verify content and choose receiving Agent | Verify content and choose receiving account |
| | 日 | 内容を検証して受取先 Agent を選ぶ | 内容を検証して受取先アカウントを選ぶ |
| `taskPackage.error.conflict` | `renderer/views/task-packages.js` | | |
| | 中 | 目标运行位置已经有同一会话 ID，但内容不同；为避免覆盖，导入已停止。 | 目标位置已经有同一会话 ID，但内容不同；为避免覆盖，导入已停止。 |
| | 英 | The target runtime already contains the same conversation ID with different content. Import stopped to avoid overwriting it. | The target location already contains the same conversation ID with different content. Import stopped to avoid overwriting it. |
| | 日 | 対象の実行場所には同じ会話 ID で異なる内容があります。上書きを避けるため取り込みを停止しました。 | 対象の場所には同じ会話 ID で異なる内容があります。上書きを避けるため取り込みを停止しました。 |
| `taskPackage.error.target` | `renderer/views/task-packages.js` | | |
| | 中 | 所选 Agent 运行位置不支持这个任务包的原生会话格式。 | 所选账号的位置不支持这个任务包的原生会话格式。 |
| | 英 | The selected Agent runtime does not support this package’s native conversation format. | The selected account’s location does not support this package’s native conversation format. |
| | 日 | 選択した Agent の実行場所は、このパッケージのネイティブ会話形式に対応していません。 | 選択したアカウントの場所は、このパッケージのネイティブ会話形式に対応していません。 |

### 猫的档案与管理

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `account.addAgent` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 新增 Agent | 新增账号 |
| | 英 | Add Agent | Add account |
| | 日 | Agent を追加 | アカウントを追加 |
| `account.addAgentHint` | `renderer/views/roster.js` | | |
| | 中 | 先新增一名全局员工；第一次打开时再自动准备当前工作环境。 | 先新增一个账号；第一次打开时再自动准备当前工作环境。 |
| | 英 | Add a global employee first; the current work environment is prepared on first open. | Add an account first; the current work environment is prepared on first open. |
| | 日 | まずグローバル従業員を追加し、現在の作業環境は初回起動時に準備します。 | まずアカウントを追加し、現在の作業環境は初回起動時に準備します。 |
| `account.createFirstAgent` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 创建第一个 Agent | 创建第一个账号 |
| | 英 | Create first Agent | Create first account |
| | 日 | 最初の Agent を作成 | 最初のアカウントを作成 |
| `account.createFirstAgentHint` | `renderer/views/roster.js` | | |
| | 中 | 从名称和受支持客户端开始；手动槽位与路径留在高级管理。 | 从名称和受支持客户端开始；手动位置与路径留在高级管理。 |
| | 英 | Start with a name and supported client; manual slots and paths remain in advanced management. | Start with a name and supported client; manual locations and paths remain in advanced management. |
| | 日 | 名前と対応クライアントから始めます。手動スロットとパスは詳細管理に残ります。 | 名前と対応クライアントから始めます。手動の場所とパスは詳細管理に残ります。 |
| `account.addRuntimeAdvanced` | `index.html` | | |
| | 中 | 导入运行位置 | 导入位置 |
| | 英 | Import runtime | Import location |
| | 日 | 実行場所を取り込む | 場所を取り込む |
| `account.addRuntimeAdvancedHint` | `index.html` | | |
| | 中 | 仅用于登记已有登录或修复位置关系 | （不变） |
| | 英 | Only for registering an existing login or repairing a runtime relationship | Only for registering an existing sign-in or repairing a location relationship |
| | 日 | 既存ログインの登録または実行場所の関係修復にのみ使用 | 既存ログインの登録または場所の関係修復にのみ使用 |
| `account.manageHint` | `index.html`、`renderer/views/agent-manage.js` | | |
| | 中 | 这只猫的一切都在这一页，按“它是谁、它在哪、它用哪个账号、能不能被别的 Agent 调用、要不要送走”分段。 | 这只猫的一切都在这一页，按“它是谁、它在哪、它用哪个登录、能不能被你的其他账号调用、要不要送走”分段。 |
| | 英 | Everything about this cat is on this page: who it is, where it lives, which account it uses, whether other Agents may call it, and whether to send it away. | Everything about this cat is on this page: who it is, where it lives, which sign-in it uses, whether your other accounts may call it, and whether to send it away. |
| | 日 | この猫のすべてがこのページにあります。「誰か・どこにいるか・どのアカウントか・他の Agent から呼べるか・送り出すか」に分かれています。 | この猫のすべてがこのページにあります。「誰か・どこにいるか・どのログインを使うか・あなたの他のアカウントから呼べるか・送り出すか」に分かれています。 |
| `account.relationsHint` | `index.html` | | |
| | 中 | 合并 Agent 或拆分登录账号 | 合并账号或拆分登录 |
| | 英 | Merge Agents or split a login binding | Merge accounts or split a sign-in |
| | 日 | Agent の統合またはログイン紐付けの分割 | アカウントの統合またはログインの分割 |
| `account.removeHint` | `index.html` | | |
| | 中 | 先预览运行位置、登录账号或整个 Agent 的影响 | 先预览对位置、登录或整个账号的影响 |
| | 英 | Preview the impact on a runtime, login, or the entire Agent | Preview the impact on a location, a sign-in, or the entire account |
| | 日 | 実行場所、ログイン、Agent 全体への影響を先に確認 | 場所、ログイン、アカウント全体への影響を先に確認 |
| `account.pathHint` | `index.html` | | |
| | 中 | 账号数据目录与会话根目录 | 数据目录与会话根目录 |
| | 英 | Account data and session root directories | Data folder and session root |
| | 日 | アカウントデータとセッションのルートディレクトリ | データフォルダーとセッションルート |
| `account.stopRuntimeHint` | `index.html` | | |
| | 中 | 只关闭由 AgentDesk 启动的当前 Profile 进程 | 只关闭由 AgentDesk 启动的当前位置的进程 |
| | 英 | Close only the current Profile processes launched by AgentDesk | Close only the processes of the current location launched by AgentDesk |
| | 日 | AgentDesk が起動した現在の Profile プロセスだけを終了 | AgentDesk が起動した現在の場所のプロセスだけを終了 |
| `account.folderHint` | `index.html` | | |
| | 中 | 在本机文件管理器中显示账号目录 | 在本机文件管理器中显示数据目录 |
| | 英 | Reveal the account directory in the local file manager | Reveal the data folder in the local file manager |
| | 日 | ローカルのファイルマネージャーでアカウントフォルダーを表示 | ローカルのファイルマネージャーでデータフォルダーを表示 |
| `account.relations` | `index.html` | | |
| | 中 | Agent 关系 | 账号关系 |
| | 英 | Agent relationships | Account relationships |
| | 日 | Agent の関係 | アカウントの関係 |
| `account.editAgent` | `index.html`、`renderer/views/roster.js` | | |
| | 中 | 编辑 Agent | 编辑账号 |
| | 英 | Edit Agent | Edit account |
| | 日 | Agent を編集 | アカウントを編集 |
| `account.addRemoteDisabled` | `renderer/views/roster.js` | | |
| | 中 | 不能从这台电脑新增远端设备的本地运行位置；请切回全部设备或本机。 | 不能从这台电脑新增远端设备的本地位置；请切回全部设备或本机。 |
| | 英 | A local runtime location cannot be created on a remote device from this computer. Switch to All devices or this device. | A local location cannot be created on a remote device from this computer. Switch to All devices or this device. |
| | 日 | このコンピューターからリモートデバイスのローカル実行場所は作成できません。「すべてのデバイス」またはこのデバイスに切り替えてください。 | このコンピューターからリモートデバイスのローカルの場所は作成できません。「すべてのデバイス」またはこのデバイスに切り替えてください。 |
| `account.noneAgent` | `renderer/views/agent-manage.js`、`renderer/views/context.js` | | |
| | 中 | 未选择 Agent | 未选择账号 |
| | 英 | No Agent selected | No account selected |
| | 日 | Agent 未選択 | アカウント未選択 |

### 首次准备

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `deployment.action.chooseClient` | `renderer/views/roster.js` | | |
| | 中 | 先在运行位置中选择客户端。 | 先在位置中选择客户端。 |
| | 英 | Choose a client in the runtime selector first. | Choose a client in the location selector first. |
| | 日 | 先に実行場所でクライアントを選択してください。 | 先に場所でクライアントを選択してください。 |

### 会话区

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `session.empty.none` | `renderer/views/sessions.js` | | |
| | 中 | 这只猫还没有会话。点卡片上的「打开」登录官方客户端，用过之后会话会自动出现在这里；读不到时到「档案」里做诊断。 | 这个账号还没有会话。点卡片上的「打开」登录官方客户端，用过之后会话会自动出现在这里；读不到时到「档案」里做诊断。 |
| | 英 | This Agent has no sessions yet. Click “Open” on its card to sign in to the official app; once you have used it, sessions show up here automatically. If nothing loads, run diagnostics from its “Dossier”. | This account has no sessions yet. Click “Open” on its card to sign in to the official app; once you have used it, sessions show up here automatically. If nothing loads, run diagnostics from its “Dossier”. |
| | 日 | この Agent にはまだセッションがありません。カードの「開く」で公式アプリにログインし、利用するとここに自動で表示されます。読み込めない場合は「カルテ」から診断を。 | このアカウントにはまだセッションがありません。カードの「開く」で公式アプリにログインし、利用するとここに自動で表示されます。読み込めない場合は「カルテ」から診断を。 |
| | 说明 | 中文原来说“这只猫”；这里说的是会话归属，按“账号”写 | |

### 页脚的状态句

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `status.nameFirst` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 先给账号槽位起一个名字。 | 先给位置起一个名字。 |
| | 英 | Give the account slot a name first. | Give the location a name first. |
| | 日 | まずアカウント枠に名前を付けてください。 | まず場所に名前を付けてください。 |
| `status.removedSlot` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已移除账号槽位。 | 已移除位置。 |
| | 英 | Account slot removed. | Location removed. |
| | 日 | アカウント枠を削除しました。 | 場所を削除しました。 |
| `status.crashpadFused` | `renderer/views/updates.js` | | |
| | 中 | 检测到重复崩溃，已熔断并关闭对应 Profile。 | 检测到重复崩溃，已熔断并关闭对应位置。 |
| | 英 | Repeated crashes detected; the affected Profile was fused and stopped. | Repeated crashes detected; the affected location was fused and stopped. |
| | 日 | 繰り返しクラッシュを検出し、対象 Profile を停止しました。 | 繰り返しクラッシュを検出し、対象の場所を停止しました。 |
| `status.provisioning.chooseClient` | `renderer/views/context.js` | | |
| | 中 | 先选择这名员工要使用的客户端。 | 先选择这个账号要使用的客户端。 |
| | 英 | Choose the client this employee should use first. | Choose the client this account should use first. |
| | 日 | この従業員が使うクライアントを先に選択してください。 | このアカウントが使うクライアントを先に選択してください。 |
| `status.pathEmpty` | `renderer/views/agent-manage.js` | | |
| | 中 | 账号目录和会话根目录都不能为空。 | 数据目录和会话根目录都不能为空。 |
| | 英 | Account dir and session root cannot be empty. | Data folder and session root cannot be empty. |
| | 日 | アカウントディレクトリとセッションルートは空にできません。 | データフォルダーとセッションルートは空にできません。 |
| `status.openAcctDirOk` | `renderer/views/agent-manage.js` | | |
| | 中 | 已打开账号目录。 | 已打开数据目录。 |
| | 英 | Opened the account directory. | Opened the data folder. |
| | 日 | アカウントディレクトリを開きました。 | データフォルダーを開きました。 |
| `status.openAcctDirFail` | `pixel/sfx.js`、`renderer/views/agent-manage.js` | | |
| | 中 | 无法打开账号目录。 | 无法打开数据目录。 |
| | 英 | Could not open the account directory. | Could not open the data folder. |
| | 日 | アカウントディレクトリを開けません。 | データフォルダーを開けません。 |
| `status.agentNameFirst` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 先给这名员工起一个名字。 | 先给这个账号起一个名字。 |
| | 英 | Name this employee first. | Name this account first. |
| | 日 | 先にこの従業員へ名前を付けてください。 | 先にこのアカウントへ名前を付けてください。 |
| `status.migrating` | `renderer/views/diagnostics.js` | | |
| | 中 | 正在迁移账号数据，请先不要打开官方 App。 | 正在迁移数据目录，请先不要打开官方 App。 |
| | 英 | Migrating account data — please do not open the official app yet. | Migrating the data folder — please do not open the official app yet. |
| | 日 | アカウントデータを移行中 —— まだ公式アプリを開かないでください。 | データフォルダーを移行中 —— まだ公式アプリを開かないでください。 |

### 开灯关灯

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `lamp.wait.devices` | `pixel/boot.js` | | |
| | 中 | 正在读取设备和 Agent 目录… | 正在读取设备和账号库… |
| | 英 | Reading devices and the Agent directory… | Reading devices and the account catalog… |
| | 日 | デバイスと Agent 一覧を読み込んでいます… | デバイスとアカウントカタログを読み込んでいます… |

### 弹窗

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `dialog.field.agentName` | `index.html` | | |
| | 中 | 员工名称 | 账号名称 |
| | 英 | Employee name | Account name |
| | 日 | 従業員名 | アカウント名 |
| `dialog.field.identity` | `index.html` | | |
| | 中 | 同账号标识 | 同一登录标识 |
| | 英 | Same-account key | Same sign-in key |
| | 日 | 同一アカウント識別 | 同一ログイン識別 |
| | 说明 | 这个字段把同一个登录的几个位置连在一起（见 dialog.hint.identity） | |
| `dialog.field.profileDir` | `index.html` | | |
| | 中 | 账号数据目录 | 数据目录 |
| | 英 | Account data directory | Data folder |
| | 日 | アカウントデータディレクトリ | データフォルダー |
| `dialog.addAgent.title` | `index.html` | | |
| | 中 | 新增 Agent | 新增账号 |
| | 英 | Add Agent | Add account |
| | 日 | Agent を追加 | アカウントを追加 |
| `dialog.addAgent.lead` | `index.html` | | |
| | 中 | 在本机为这个 Agent 新建独立账号环境，登录在官方客户端完成。已有公司接口环境可从“管理 Agent → 导入运行位置”登记。 | 在本机为这个账号新建一个独立的位置，登录在官方客户端完成。已有公司接口环境可从“管理账号 → 导入位置”登记。 |
| | 英 | Create a separate account environment on this device and sign in with the official client. Register an existing company API environment under Manage Agent → Import runtime location. | Create a separate location for this account on this device and sign in with the official client. Register an existing company API environment under Manage account → Import location. |
| | 日 | このデバイスに独立したアカウント環境を作成し、公式クライアントでログインします。既存の社内 API 環境は「Agent 管理 → 実行場所をインポート」から登録できます。 | このデバイスにこのアカウント用の独立した場所を作成し、公式クライアントでログインします。既存の社内 API 環境は「アカウントを管理 → 場所を取り込む」から登録できます。 |
| | 说明 | 句中引用的菜单名按改后的叫法写；现在的界面里这条路径是否还叫“管理”需要实改时再对一次 | |
| `dialog.ph.agentNote` | `index.html` | | |
| | 中 | 可选，记录这名员工负责什么 | 可选，记录这个账号负责什么 |
| | 英 | Optional: note what this employee is responsible for | Optional: note what this account is responsible for |
| | 日 | 任意：この従業員の担当を記録 | 任意：このアカウントの担当を記録 |
| `dialog.addProfile.title` | `index.html`、`renderer/views/catalog-dialogs.js` | | |
| | 中 | 新增账号槽位 | 新增位置 |
| | 英 | Add account slot | Add location |
| | 日 | アカウント枠を追加 | 場所を追加 |
| `dialog.addProfile.slotTitle` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 新增本机运行位置 | 新增本机位置 |
| | 英 | Add local runtime location | Add local location |
| | 日 | ローカル実行場所を追加 | ローカルの場所を追加 |
| `dialog.editProfile.title` | `index.html`、`renderer/views/catalog-dialogs.js` | | |
| | 中 | 编辑账号槽位 | 编辑位置 |
| | 英 | Edit account slot | Edit location |
| | 日 | アカウント枠を編集 | 場所を編集 |
| `dialog.ph.profileNote` | `index.html` | | |
| | 中 | 可选，给这个账号加点说明 | 可选，给这个位置加点说明 |
| | 英 | Optional note for this account | Optional note for this location |
| | 日 | 任意、このアカウントの説明 | 任意、この場所の説明 |
| | 说明 | 新增位置的弹窗 | |
| `dialog.ph.editNote` | `index.html` | | |
| | 中 | 给这个账号加点备注…… | 给这个位置加点备注…… |
| | 英 | Add a note for this account… | Add a note for this location… |
| | 日 | このアカウントにメモを追加…… | この場所にメモを追加…… |
| | 说明 | 编辑位置的弹窗（editDialog） | |
| `dialog.hint.identity` | `index.html` | | |
| | 中 | 同一个登录身份的多个客户端槽位填同一个词（如 Kimi Code 与 Kimi Work 同填「Kimi」），列表会用 ⛓ 标出关联。 | 同一个登录的多个位置填同一个词（如 Kimi Code 与 Kimi Work 同填「Kimi」），列表会用 ⛓ 标出关联。 |
| | 英 | Give the same word to several client slots of one login (e.g. put "Kimi" on both Kimi Code and Kimi Work); the list marks the link with ⛓. | Give the same word to several locations of one sign-in (e.g. put "Kimi" on both Kimi Code and Kimi Work); the list marks the link with ⛓. |
| | 日 | 同一ログインの複数クライアント枠に同じ語を入れます（例：Kimi Code と Kimi Work に「Kimi」）。一覧では ⛓ で関連を示します。 | 同一ログインの複数の場所に同じ語を入れます（例：Kimi Code と Kimi Work に「Kimi」）。一覧では ⛓ で関連を示します。 |

### 招募

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `recruit.method.key.gemini-cli.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 写进这个账号目录的 .gemini/.env，并把登录方式设为 API 密钥。 | 写进这个账号的数据目录里的 .gemini/.env，并把登录方式设为 API 密钥。 |
| | 英 | It goes into .gemini/.env in this account’s folder, and the sign-in method is set to API key. | It goes into .gemini/.env in this account’s data folder, and the sign-in method is set to API key. |
| | 日 | このアカウントのフォルダーの .gemini/.env に書き込み、サインイン方法を API キーにします。 | このアカウントのデータフォルダーの .gemini/.env に書き込み、サインイン方法を API キーにします。 |
| `recruit.note.opencode` | `clients/opencode/index.js` | | |
| | 中 | 密钥由 OpenCode 存进这个账号自己目录里的 opencode.db（明文，只有你的用户能读）。AgentDesk 不保存它。 | 密钥由 OpenCode 存进这个账号的数据目录里的 opencode.db（明文，只有你的用户能读）。AgentDesk 不保存它。 |
| | 英 | OpenCode stores the key in opencode.db in this account’s own folder (plain text, readable only by your user). AgentDesk does not keep it. | OpenCode stores the key in opencode.db in this account’s data folder (plain text, readable only by your user). AgentDesk does not keep it. |
| | 日 | キーは OpenCode がこのアカウントのフォルダーの opencode.db に保存します（平文、あなたのユーザーだけが読めます）。AgentDesk は保存しません。 | キーは OpenCode がこのアカウントのデータフォルダーの opencode.db に保存します（平文、あなたのユーザーだけが読めます）。AgentDesk は保存しません。 |
| `recruit.method.key.codex.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 交给 codex login 从标准输入读取，由 Codex 存在这个账号自己的目录里。 | 交给 codex login 从标准输入读取，由 Codex 存在这个账号的数据目录里。 |
| | 英 | Passed to codex login on standard input. Codex stores it in this account’s own folder. | Passed to codex login on standard input. Codex stores it in this account’s data folder. |
| | 日 | codex login の標準入力に渡し、Codex がこのアカウントのフォルダーに保存します。 | codex login の標準入力に渡し、Codex がこのアカウントのデータフォルダーに保存します。 |
| `recruit.method.key.claude-cli.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | claude setup-token 生成的令牌或 API 密钥，写进这个账号目录的 settings.json。 | claude setup-token 生成的令牌或 API 密钥，写进这个账号的数据目录里的 settings.json。 |
| | 英 | A token from claude setup-token, or an API key. It goes into settings.json in this account’s folder. | A token from claude setup-token, or an API key. It goes into settings.json in this account’s data folder. |
| | 日 | claude setup-token のトークン、または API キー。このアカウントのフォルダーの settings.json に書き込みます。 | claude setup-token のトークン、または API キー。このアカウントのデータフォルダーの settings.json に書き込みます。 |
| `recruit.method.key.dsh-cli.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 写进这个账号目录的 .credentials.yaml，DSH 从那里读。 | 写进这个账号的数据目录里的 .credentials.yaml，DSH 从那里读。 |
| | 英 | It goes into .credentials.yaml in this account’s folder, where DSH reads it. | It goes into .credentials.yaml in this account’s data folder, where DSH reads it. |
| | 日 | このアカウントのフォルダーの .credentials.yaml に書き込み、DSH がそこから読みます。 | このアカウントのデータフォルダーの .credentials.yaml に書き込み、DSH がそこから読みます。 |
| `recruit.existing.found` | `renderer/recruit.js` | | |
| | 中 | 在常用位置找到 {n} 个账号。 | 在常用的文件夹里找到 {n} 个账号。 |
| | 英 | Found {n} accounts in the usual places. | Found {n} accounts in the usual folders. |
| | 日 | いつもの場所で {n} 件のアカウントが見つかりました。 | いつものフォルダーで {n} 件のアカウントが見つかりました。 |
| | 说明 | “位置/場所”成了专用词，这里泛指的地方改说“文件夹” | |
| `recruit.error.config-format-unsupported` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 这个账号目录里的配置文件格式认不出，为了不弄坏它，什么都没改。 | 这个账号的数据目录里的配置文件格式认不出，为了不弄坏它，什么都没改。 |
| | 英 | The configuration file in this account’s folder has a format AgentDesk does not recognise, so nothing was changed. | The configuration file in this account’s data folder has a format AgentDesk does not recognise, so nothing was changed. |
| | 日 | このアカウントのフォルダーにある設定ファイルの形式を認識できないため、何も変更していません。 | このアカウントのデータフォルダーにある設定ファイルの形式を認識できないため、何も変更していません。 |
| `recruit.error.config-unreadable` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 读不了这个账号目录里的配置文件。 | 读不了这个账号的数据目录里的配置文件。 |
| | 英 | The configuration file in this account’s folder could not be read. | The configuration file in this account’s data folder could not be read. |
| | 日 | このアカウントのフォルダーにある設定ファイルを読めませんでした。 | このアカウントのデータフォルダーにある設定ファイルを読めませんでした。 |
| `recruit.error.config-too-large` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 这个账号目录里的配置文件太大，没有改动。 | 这个账号的数据目录里的配置文件太大，没有改动。 |
| | 英 | The configuration file in this account’s folder is too large; nothing was changed. | The configuration file in this account’s data folder is too large; nothing was changed. |
| | 日 | このアカウントのフォルダーにある設定ファイルが大きすぎるため、変更していません。 | このアカウントのデータフォルダーにある設定ファイルが大きすぎるため、変更していません。 |
| `recruit.error.config-write-failed` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 写不进这个账号的目录。 | 写不进这个账号的数据目录。 |
| | 英 | AgentDesk could not write to this account’s folder. | AgentDesk could not write to this account’s data folder. |
| | 日 | このアカウントのフォルダーに書き込めませんでした。 | このアカウントのデータフォルダーに書き込めませんでした。 |
| `recruit.error.home-invalid` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 这个账号的目录不可用。 | 这个账号的数据目录不可用。 |
| | 英 | This account’s folder is not available. | This account’s data folder is not available. |
| | 日 | このアカウントのフォルダーは使えません。 | このアカウントのデータフォルダーは使えません。 |

### 收件箱

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `attention.catalog.title` | `renderer/views/inbox.js` | | |
| | 中 | 运行位置待归属：{name} | 位置待归属：{name} |
| | 英 | Runtime location needs assignment: {name} | Location needs assignment: {name} |
| | 日 | 実行場所の割り当てが必要: {name} | 場所の割り当てが必要: {name} |
| `attention.catalog.detail` | `renderer/views/inbox.js` | | |
| | 中 | {device} · {state}；需要明确选择已有登录、已有 Agent 的新账号或新 Agent。 | {device} · {state}；需要明确选择：已有登录的新位置、已有账号的另一个登录，或新的账号。 |
| | 英 | {device} · {state}; explicitly choose an existing login, another account for an Agent, or a new Agent. | {device} · {state}; explicitly choose a new location for an existing sign-in, another sign-in for an existing account, or a new account. |
| | 日 | {device} · {state}。既存ログイン、既存 Agent の別アカウント、または新しい Agent を明示的に選んでください。 | {device} · {state}。既存ログインの新しい場所、既存アカウントの別ログイン、新しいアカウントのいずれかを明示的に選んでください。 |

### 首次使用

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `welcome.lead` | `index.html`、`renderer/views/first-use.js` | | |
| | 中 | 把长期工作的 Agent 放进一份目录，再选择它此刻在哪个设备和客户端工作。登录始终发生在官方客户端。 | 把长期工作的账号放进账号库，再选择它此刻在哪个设备和客户端工作。登录始终发生在官方客户端。 |
| | 英 | Keep long-lived Agents in one catalog, then choose the device and client where each one works now. Sign-in always stays in the official client. | Keep long-lived accounts in the account catalog, then choose the device and client where each one works now. Sign-in always stays in the official client. |
| | 日 | 長く働く Agent を一つのカタログに置き、今どのデバイスとクライアントで働くかを選びます。ログインは常に公式クライアント内で行います。 | 長く働くアカウントをアカウントカタログに置き、今どのデバイスとクライアントで働くかを選びます。ログインは常に公式クライアント内で行います。 |
| `welcome.step1` | `index.html` | | |
| | 中 | <b>Agent</b> 是长期工作对象，可以在不同设备和客户端上拥有运行位置。 | <b>账号</b>是长期工作对象，可以在不同设备和客户端上拥有位置。 |
| | 英 | An <b>Agent</b> is a long-lived work identity that can have runtime locations on different devices and clients. | An <b>account</b> is a long-lived work identity that can have locations on different devices and clients. |
| | 日 | <b>Agent</b> は長期的な作業対象で、異なるデバイスやクライアントに実行場所を持てます。 | <b>アカウント</b>は長期的な作業対象で、異なるデバイスやクライアントに場所を持てます。 |
| `welcome.tip` | `index.html` | | |
| | 中 | 日常只需管理 Agent 和运行位置。手动账号槽位、路径与诊断保留在<b>高级管理</b>中。 | 日常只需管理账号和位置。手动位置、路径与诊断保留在<b>高级管理</b>中。 |
| | 英 | Daily work only needs Agents and runtime locations. Manual account slots, paths and diagnostics remain in <b>advanced management</b>. | Daily work only needs accounts and locations. Manual locations, paths and diagnostics remain in <b>advanced management</b>. |
| | 日 | 日常は Agent と実行場所だけを管理します。手動アカウントスロット、パス、診断は<b>詳細管理</b>に残ります。 | 日常はアカウントと場所だけを管理します。手動の場所、パス、診断は<b>詳細管理</b>に残ります。 |
| `onboarding.lead` | `renderer/views/first-use.js` | | |
| | 中 | 先建立一名长期 Agent，再为它准备本机客户端。整个过程不接管官方登录。 | 先建立一个长期工作的账号，再为它准备本机客户端。整个过程不接管官方登录。 |
| | 英 | Create one long-lived Agent, then prepare its local client. AgentDesk never takes over the official sign-in flow. | Create one long-lived account, then prepare its local client. AgentDesk never takes over the official sign-in flow. |
| | 日 | 長く働く Agent を一人作成し、そのローカルクライアントを準備します。公式ログインを AgentDesk が代行することはありません。 | 長く働くアカウントを一つ作成し、そのローカルクライアントを準備します。公式ログインを AgentDesk が代行することはありません。 |
| `onboarding.progress.migration` | `index.html` | | |
| | 中 | 确认现有账号 | 确认现有位置 |
| | 英 | Review accounts | Review locations |
| | 日 | 既存アカウント確認 | 既存の場所を確認 |
| `onboarding.progress.agent` | `index.html` | | |
| | 中 | 创建 Agent | 创建账号 |
| | 英 | Create Agent | Create account |
| | 日 | Agent 作成 | アカウント作成 |
| `onboarding.migration.lead` | `index.html` | | |
| | 中 | 选择要放进初始 Agent 库的现有账号。只建立目录关系，不移动账号目录、会话或登录信息。 | 选择要放进初始账号库的现有位置。只在账号库里建立关系，不移动数据目录、会话或登录信息。 |
| | 英 | Choose which existing accounts should enter the initial Agent catalog. This only creates catalog relationships; account folders, sessions and sign-in data stay in place. | Choose which existing locations should enter the initial account catalog. This only creates relationships in the catalog; data folders, sessions and sign-in data stay in place. |
| | 日 | 初期 Agent カタログに入れる既存アカウントを選びます。カタログの関係だけを作成し、アカウントフォルダ、セッション、ログイン情報は移動しません。 | 初期アカウントカタログに入れる既存の場所を選びます。カタログ内の関係だけを作成し、データフォルダー、セッション、ログイン情報は移動しません。 |
| | 说明 | 原文“现有账号”列的是本机已登记的位置（Profile），按新叫法是“位置” | |
| `onboarding.migration.legend` | `index.html` | | |
| | 中 | 本机发现的账号 | 本机发现的位置 |
| | 英 | Accounts found on this computer | Locations found on this computer |
| | 日 | このコンピュータで見つかったアカウント | このコンピューターで見つかった場所 |
| `onboarding.migration.safety` | `index.html` | | |
| | 中 | 没有选中的账号继续留在原处，之后仍可从高级管理导入。 | 没有选中的位置继续留在原处，之后仍可从高级管理导入。 |
| | 英 | Unselected accounts stay where they are and can be imported later from advanced management. | Unselected locations stay where they are and can be imported later from advanced management. |
| | 日 | 選ばなかったアカウントは元の場所に残り、後から詳細管理で取り込めます。 | 選ばなかった場所は元のまま残り、後から詳細管理で取り込めます。 |
| `onboarding.migration.selected` | `renderer/views/first-use.js` | | |
| | 中 | 已确认 {n} 个现有账号；创建时会按所选范围无损建立目录关系。 | 已确认 {n} 个现有位置；创建时会按所选范围无损地在账号库里建立关系。 |
| | 英 | {n} existing accounts confirmed. Creation will establish only the selected catalog relationships without moving data. | {n} existing locations confirmed. Creation will establish only the selected relationships in the account catalog, without moving data. |
| | 日 | 既存アカウント {n} 件を確認しました。作成時は選択範囲のカタログ関係だけをデータ移動なしで作ります。 | 既存の場所 {n} 件を確認しました。作成時は選択範囲の関係だけをアカウントカタログにデータ移動なしで作ります。 |
| `onboarding.agent.title` | `index.html` | | |
| | 中 | 创建第一个 Agent | 创建第一个账号 |
| | 英 | Create your first Agent | Create your first account |
| | 日 | 最初の Agent を作成 | 最初のアカウントを作成 |
| `onboarding.agent.lead` | `index.html` | | |
| | 中 | 先确定它是谁、使用哪个受支持客户端。AgentDesk 随后为本机准备运行位置。 | 先确定它是谁、使用哪个受支持客户端。AgentDesk 随后为本机准备位置。 |
| | 英 | Define who it is and which supported client it uses. AgentDesk then prepares a local runtime location. | Define who it is and which supported client it uses. AgentDesk then prepares a local location. |
| | 日 | 誰なのか、どの対応クライアントを使うかを先に決めます。その後 AgentDesk がローカル実行場所を準備します。 | 誰なのか、どの対応クライアントを使うかを先に決めます。その後 AgentDesk がローカルの場所を準備します。 |
| `onboarding.agent.name` | `index.html` | | |
| | 中 | Agent 名称 | 账号名称 |
| | 英 | Agent name | Account name |
| | 日 | Agent 名 | アカウント名 |
| `onboarding.agent.localOnly` | `index.html` | | |
| | 中 | 确认后只建立本机 Agent 目录和设备身份；不会开放端口、发布在线租约、连接其他设备或授予远端权限。 | 确认后只建立本机账号库和设备身份；不会开放端口、发布在线租约、连接其他设备或授予远端权限。 |
| | 英 | Confirmation creates only the local Agent catalog and device identity. It opens no port, publishes no online lease, connects to no other device, and grants no remote permission. | Confirmation creates only the local account catalog and device identity. It opens no port, publishes no online lease, connects to no other device, and grants no remote permission. |
| | 日 | 確認後に作るのはローカルの Agent カタログとデバイス ID だけです。ポートを開かず、オンラインリースを公開せず、他のデバイスへ接続せず、リモート権限も付与しません。 | 確認後に作るのはローカルのアカウントカタログとデバイス ID だけです。ポートを開かず、オンラインリースを公開せず、他のデバイスへ接続せず、リモート権限も付与しません。 |
| `onboarding.prepare.title` | `index.html` | | |
| | 中 | 准备本机运行位置 | 准备本机位置 |
| | 英 | Prepare the local runtime | Prepare the local location |
| | 日 | ローカル実行場所を準備 | ローカルの場所を準備 |
| `onboarding.prepare.state.preparing` | `renderer/views/first-use.js` | | |
| | 中 | 正在准备本机运行位置 | 正在准备本机位置 |
| | 英 | Preparing the local runtime | Preparing the local location |
| | 日 | ローカル実行場所を準備中 | ローカルの場所を準備中 |
| `onboarding.prepare.state.ready` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 本机运行位置已就绪 | 本机位置已就绪 |
| | 英 | The local runtime is ready | The local location is ready |
| | 日 | ローカル実行場所の準備完了 | ローカルの場所の準備完了 |
| `onboarding.prepare.detail.verifying` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 身份确认通过后才会原子提交运行位置。 | 身份确认通过后才会原子提交位置。 |
| | 英 | The runtime location is committed atomically only after identity verification. | The location is committed atomically only after identity verification. |
| | 日 | ID 確認後にだけ実行場所をアトミックに確定します。 | ID 確認後にだけ場所をアトミックに確定します。 |
| `onboarding.prepare.detail.ready` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 以后可直接从顶部 Agent 面板打开。 | 以后可直接从顶部账号面板打开。 |
| | 英 | You can open it from the top Agent panel from now on. | You can open it from the top account panel from now on. |
| | 日 | 今後は上部の Agent パネルから直接開けます。 | 今後は上部のアカウントパネルから直接開けます。 |
| `onboarding.prepare.detail.unsupported` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 可以稍后从高级管理手动登记运行位置。 | 可以稍后从高级管理手动登记位置。 |
| | 英 | You can register a runtime manually later from advanced management. | You can register a location manually later from advanced management. |
| | 日 | 後から詳細管理で実行場所を手動登録できます。 | 後から詳細管理で場所を手動登録できます。 |
| `onboarding.existing.kicker` | `index.html` | | |
| | 中 | AGENT LIBRARY | 账号库 |
| | 英 | AGENT LIBRARY | ACCOUNT CATALOG |
| | 日 | AGENT LIBRARY | アカウントカタログ |
| | 说明 | 原来三种语言都写英文大写的 AGENT LIBRARY；按规则各用本语言，也可以三种都写 ACCOUNT CATALOG | |
| `onboarding.existing.title` | `index.html` | | |
| | 中 | 你的 Agent 库已经就绪 | 你的账号库已经就绪 |
| | 英 | Your Agent catalog is ready | Your account catalog is ready |
| | 日 | Agent カタログは準備済みです | アカウントカタログは準備済みです |
| `onboarding.existing.lead` | `index.html` | | |
| | 中 | 这次更新把 Agent 作为长期工作对象；设备是工作环境，客户端槽位只是它在某处的运行位置。 | 这次更新把账号作为长期工作对象；设备是工作环境，客户端所在的位置只是它在某处工作的一个地方。 |
| | 英 | This update treats an Agent as a long-lived work identity. A device is a work environment; a client slot is only one runtime location. | This update treats an account as a long-lived work identity. A device is a work environment; a client location is only one place where it works. |
| | 日 | この更新では Agent を長期的な作業対象として扱います。デバイスは作業環境、クライアントスロットはその一つの実行場所です。 | この更新ではアカウントを長期的な作業対象として扱います。デバイスは作業環境、クライアントの場所はそれが働く場所の一つです。 |
| `onboarding.complete.lead` | `index.html` | | |
| | 中 | 主工作台仍按 Agent、会话和详情组织。第一次打开未准备的 Agent 时，可从同一位置继续安装或登录。 | 主工作台仍按账号、会话和详情组织。第一次打开未准备的账号时，可从同一位置继续安装或登录。 |
| | 英 | The main workspace still revolves around Agents, sessions and details. The first time you open an unprepared Agent, continue installation or sign-in from the same place. | The main workspace still revolves around accounts, sessions and details. The first time you open an unprepared account, continue installation or sign-in from the same place. |
| | 日 | メイン作業台はこれまでどおり Agent、セッション、詳細で構成されます。未準備の Agent を初めて開くときは、同じ場所からインストールやログインを続けられます。 | メイン作業台はこれまでどおりアカウント、セッション、詳細で構成されます。未準備のアカウントを初めて開くときは、同じ場所からインストールやログインを続けられます。 |
| `onboarding.advanced` | `index.html` | | |
| | 中 | 高级：手动导入运行位置 | 高级：手动导入位置 |
| | 英 | Advanced: import a runtime manually | Advanced: import a location manually |
| | 日 | 詳細：実行場所を手動で取り込む | 詳細：場所を手動で取り込む |
| `onboarding.error.nameRequired` | `renderer/views/first-use.js` | | |
| | 中 | 先填写 Agent 名称。 | 先填写账号名称。 |
| | 英 | Enter an Agent name first. | Enter an account name first. |
| | 日 | 先に Agent 名を入力してください。 | 先にアカウント名を入力してください。 |

### 添加设备

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `deviceJourney.fact.catalog` | 代码里按前缀拼出（动态 key） | | |
| | 中 | Agent 目录 | 账号库 |
| | 英 | Agent catalog | Account catalog |
| | 日 | Agent カタログ | アカウントカタログ |
| `deviceJourney.fact.catalog.complete` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 全局 Agent 目录已验证落库 | 账号库已验证落库 |
| | 英 | The global Agent catalog was verified and stored | Account catalog was verified and stored |
| | 日 | グローバル Agent カタログを検証して保存済み | アカウントカタログを検証して保存済み |
| `deviceJourney.fact.inventory.complete` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 首份 Slot 与会话库存已落库 | 首份位置与会话库存已落库 |
| | 英 | The first Slot and session inventory is stored | The first location and session inventory is stored |
| | 日 | 最初の Slot とセッションのインベントリを保存済み | 最初の場所とセッションのインベントリを保存済み |
| `deviceJourney.phase.catalog` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 连接已建立；正在确认全局 Agent 目录已经落库。 | 连接已建立；正在确认账号库已经落库。 |
| | 英 | Connected; confirming that the global Agent catalog has landed. | Connected; confirming that the account catalog is stored. |
| | 日 | 接続済みです。グローバル Agent カタログの保存を確認しています。 | 接続済みです。アカウントカタログの保存を確認しています。 |
| `deviceJourney.complete.lead` | `renderer/views/device-journey.js` | | |
| | 中 | {name} 已成为一个可选择的工作环境；Agent 库不会因此复制。 | {name} 已成为一个可选择的工作环境；账号库不会因此复制。 |
| | 英 | {name} is now a selectable work environment. The Agent library was not duplicated. | {name} is now a selectable work environment. The account catalog was not duplicated. |
| | 日 | {name} を作業環境として選べます。Agent ライブラリは複製されません。 | {name} を作業環境として選べます。アカウントカタログは複製されません。 |

### 读屏文字

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `aria.roster` | `index.html` | | |
| | 中 | Agent 卡片 | 账号卡片 |
| | 英 | Agent cards | Account cards |
| | 日 | Agent カード | アカウントカード |

### 诊断

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `diag.profileDirExists` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录存在 | 数据目录存在 |
| | 英 | Account dir exists | Data folder exists |
| | 日 | アカウントディレクトリあり | データフォルダーあり |
| `diag.profileDirMissing` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录未创建 | 数据目录未创建 |
| | 英 | Account dir not created | Data folder not created |
| | 日 | アカウントディレクトリ未作成 | データフォルダー未作成 |
| `diag.row.profileDir` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录 | 数据目录 |
| | 英 | Account dir | Data folder |
| | 日 | アカウントディレクトリ | データフォルダー |
| `diag.winProtocol` | `renderer/views/diagnostics.js` | | |
| | 中 | Windows 协议（仅自动默认账号） | Windows 协议（仅自动默认位置） |
| | 英 | Windows protocol (auto default account only) | Windows protocol (auto-default location only) |
| | 日 | Windows プロトコル（自動既定アカウントのみ） | Windows プロトコル（自動既定の場所のみ） |
| `diag.txt.profileDir` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录：{v} | 数据目录：{v} |
| | 英 | Account dir: {v} | Data folder: {v} |
| | 日 | アカウントディレクトリ：{v} | データフォルダー：{v} |

### 选择器

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `picker.profileDir` | `renderer/views/agent-manage.js` | | |
| | 中 | 选择账号数据目录 | 选择数据目录 |
| | 英 | Choose account data directory | Choose data folder |
| | 日 | アカウントデータディレクトリを選択 | データフォルダーを選択 |

### 调度中枢

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `hub.from.unknown` | `renderer/hub.js`、`renderer/views/hub.js` | | |
| | 中 | 未注明的 Agent | 未注明的账号 |
| | 英 | an unnamed Agent | an unnamed account |
| | 日 | 名前のない Agent | 名前のないアカウント |
| `hub.say.startedOutside` | `renderer/views/hub.js` | | |
| | 中 | 台面外的 {label} 叫了 {to}。 | （不变） |
| | 英 | An Agent off the desk, {label}, called {to}. | {label}, from outside the desk, called {to}. |
| | 日 | 机の外の {label} が {to} を呼びました。 | （不变） |
| | 说明 | 叫人的一方不在台面上，自报的名字只当标签，所以不写成“账号” | |
| `hub.tip.copy.body` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 复制这段对话的位置。贴给另一个 Agent，它就能自己读到。对话本身不动。 | 复制这段对话的位置。贴给另一个账号，它就能自己读到。对话本身不动。 |
| | 英 | Copies where this conversation lives. Paste it to another Agent and it can read it by itself. The conversation stays where it is. | Copies where this conversation lives. Paste it to another account and it can read it by itself. The conversation stays where it is. |
| | 日 | この会話の場所をコピーします。別の Agent に貼れば、その Agent が自分で読めます。会話そのものは動きません。 | この会話の場所をコピーします。別のアカウントに貼れば、そのアカウントが自分で読めます。会話そのものは動きません。 |
| `hub.tip.run.body` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 你的 Agent 通过 AgentDesk 让这个账号在后台跑的一段对话。这里只显示标题和状态。 | 你的另一个账号通过 AgentDesk 让它在后台跑的一段对话。这里只显示标题和状态。 |
| | 英 | A conversation your Agent had this account run in the background, through AgentDesk. Only the title and state are shown here. | A conversation another of your accounts had it run in the background, through AgentDesk. Only the title and state are shown here. |
| | 日 | あなたの Agent が AgentDesk を通じて、このアカウントにバックグラウンドで実行させた会話です。ここにはタイトルと状態だけを表示します。 | あなたの別のアカウントが AgentDesk を通じて、このアカウントにバックグラウンドで実行させた会話です。ここにはタイトルと状態だけを表示します。 |
| `hub.tip.run.facts` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 谁发起：你对自己的 Agent 说的话 · AgentDesk 只中转，不自己派活 | 谁发起：你对自己的某个账号说的话 · AgentDesk 只中转，不自己派活 |
| | 英 | Started by: what you said to your own Agent · AgentDesk only relays, it never hands out work | Started by: what you said to one of your accounts · AgentDesk only relays, it never hands out work |
| | 日 | 始めたのは：あなたが自分の Agent に言ったこと · AgentDesk は中継するだけで、自分から仕事を振りません | 始めたのは：あなたが自分のアカウントの一つに言ったこと · AgentDesk は中継するだけで、自分から仕事を振りません |
| `hub.tip.allow.body` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 打开后，你的其他 Agent 可以通过 AgentDesk 让它在后台干活。AgentDesk 自己不会调用它。 | 打开后，你的其他账号可以通过 AgentDesk 让它在后台干活。AgentDesk 自己不会调用它。 |
| | 英 | When on, your other Agents can have it work in the background through AgentDesk. AgentDesk never calls it by itself. | When on, your other accounts can have it work in the background through AgentDesk. AgentDesk never calls it by itself. |
| | 日 | オンにすると、あなたの他の Agent が AgentDesk を通じてこの猫にバックグラウンドで作業させられます。AgentDesk が自分から呼ぶことはありません。 | オンにすると、あなたの他のアカウントが AgentDesk を通じてこの猫にバックグラウンドで作業させられます。AgentDesk が自分から呼ぶことはありません。 |
| `hub.dossier.allow` | `index.html` | | |
| | 中 | 允许别的 Agent 调用它 | 允许别的账号调用它 |
| | 英 | Other Agents may call it | Other accounts may call it |
| | 日 | 他の Agent からの呼び出しを許可 | 他のアカウントからの呼び出しを許可 |
| `hub.dossier.allow.hint` | `index.html` | | |
| | 中 | 打开后，你的其他 Agent 可以通过 AgentDesk 让它在后台干活。AgentDesk 自己不会调用它。 | 打开后，你的其他账号可以通过 AgentDesk 让它在后台干活。AgentDesk 自己不会调用它。 |
| | 英 | When on, your other Agents can have it work in the background through AgentDesk. AgentDesk never calls it by itself. | When on, your other accounts can have it work in the background through AgentDesk. AgentDesk never calls it by itself. |
| | 日 | オンにすると、あなたの他の Agent が AgentDesk を通じてこの猫にバックグラウンドで作業させられます。AgentDesk が自分から呼ぶことはありません。 | オンにすると、あなたの他のアカウントが AgentDesk を通じてこの猫にバックグラウンドで作業させられます。AgentDesk が自分から呼ぶことはありません。 |
| `hub.system.lead` | `index.html` | | |
| | 中 | AgentDesk 只中转你自己的 Agent 发起的调用，不自己派活。 | AgentDesk 只中转你自己的某个账号发起的调用，不自己派活。 |
| | 英 | AgentDesk only relays calls your own Agents make. It never hands out work by itself. | AgentDesk only relays calls one of your own accounts makes. It never hands out work by itself. |
| | 日 | AgentDesk はあなた自身の Agent が始めた呼び出しを中継するだけで、自分から仕事を振りません。 | AgentDesk はあなた自身のアカウントが始めた呼び出しを中継するだけで、自分から仕事を振りません。 |
| `hub.system.folders` | `index.html` | | |
| | 中 | 允许干活的文件夹 | （不变） |
| | 英 | Folders Agents may work in | Folders accounts may work in |
| | 日 | 作業してよいフォルダー | （不变） |
| `hub.system.foldersHint` | `index.html` | | |
| | 中 | 被调用的 Agent 只能在这些文件夹里干活。一个都没有时，谁也不能被调用。 | 被调用的账号只能在这些文件夹里干活。一个都没有时，谁也不能被调用。 |
| | 英 | A called Agent can only work inside these folders. With none, nobody can be called. | A called account can only work inside these folders. With none, nobody can be called. |
| | 日 | 呼び出された Agent は、これらのフォルダーの中でしか作業できません。一つもなければ、誰も呼び出せません。 | 呼び出されたアカウントは、これらのフォルダーの中でしか作業できません。一つもなければ、誰も呼び出せません。 |

### 主进程（系统对话框、通知、菜单）

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `main.picker.hubFolder` | `commands/hub.js` | | |
| | 中 | 选择允许 Agent 在里面干活的文件夹 | 选择允许账号在里面干活的文件夹 |
| | 英 | Choose a folder Agents may work in | Choose a folder accounts may work in |
| | 日 | Agent が作業してよいフォルダーを選択 | アカウントが作業してよいフォルダーを選択 |
| `main.err.slotNotFound` | `commands/profiles.js`、`main/accounts.js` | | |
| | 中 | 找不到账号槽位 | 找不到位置 |
| | 英 | Account slot not found | Location not found |
| | 日 | アカウント枠が見つかりません | 場所が見つかりません |
| `main.err.slotNotFoundDot` | `main/profile-launch.js`、`main/session-files.js` | | |
| | 中 | 找不到账号槽位。 | 找不到位置。 |
| | 英 | Account slot not found. | Location not found. |
| | 日 | アカウント枠が見つかりません。 | 場所が見つかりません。 |
| `main.err.cannotPrepDir` | `main/profile-launch.js` | | |
| | 中 | 无法准备账号目录：{msg} | 无法准备数据目录：{msg} |
| | 英 | Cannot prepare the account directory: {msg} | Cannot prepare the data folder: {msg} |
| | 日 | アカウントディレクトリを準備できません：{msg} | データフォルダーを準備できません：{msg} |
| `main.tools.profileMismatch` | `main/profile-launch.js`、`main/tools.js` | | |
| | 中 | 当前选择的 Profile 不属于这个 CLI 工具，请选择对应的 CLI Profile。 | 当前选择的位置不属于这个 CLI 工具，请选择对应的 CLI 位置。 |
| | 英 | The selected profile does not belong to this CLI tool. Choose the matching CLI profile. | The selected location does not belong to this CLI tool. Choose the matching CLI location. |
| | 日 | 選択したプロファイルはこの CLI ツールに属していません。対応する CLI プロファイルを選択してください。 | 選択した場所はこの CLI ツールに属していません。対応する CLI の場所を選択してください。 |
| `main.launch.cliRuns` | `main/profile-launch.js` | | |
| | 中 | {label} 会在独立终端里打开；这个槽位使用自己的配置根，不继承本机默认账号或代理。 | {label} 会在独立终端里打开；这个位置使用自己的配置根，不继承本机的官方默认登录或代理。 |
| | 英 | {label} opens in an isolated terminal. This slot uses its own config root and does not inherit the official default account or proxy. | {label} opens in an isolated terminal. This location uses its own config root and does not inherit the official default sign-in or proxy. |
| | 日 | {label} は独立したターミナルで開きます。この枠は独自の設定ルートを使い、公式の既定アカウントやプロキシは引き継ぎません。 | {label} は独立したターミナルで開きます。この場所は独自の設定ルートを使い、公式の既定ログインやプロキシは引き継ぎません。 |
| `main.agentPrepare.title` | `main/mesh-wiring.js` | | |
| | 中 | 首次准备 Agent | 首次准备账号 |
| | 英 | Prepare Agent for the first time | Prepare account for the first time |
| | 日 | Agent の初回準備 | アカウントの初回準備 |
| `main.launch.winProtocolWarn` | `main/profile-launch.js` | | |
| | 中 | 已通过系统协议打开默认账号。协议启动不支持独立账号参数。 | 已通过系统协议打开默认位置。协议启动不支持给单独的位置传参数。 |
| | 英 | Opened the default account via the system protocol. Protocol launch does not support per-account arguments. | Opened the default location via the system protocol. Protocol launch does not support per-location arguments. |
| | 日 | システムプロトコルで既定アカウントを開きました。プロトコル起動はアカウント個別の引数に対応しません。 | システムプロトコルで既定の場所を開きました。プロトコル起動は場所ごとの引数に対応しません。 |
| `main.launch.crashpadFused` | `main/profile-launch.js` | | |
| | 中 | 这个 Profile 因重复崩溃已被熔断。请先在「管理 Agent → 清理崩溃报告」中安全清理，再重新打开。 | 这个位置因重复崩溃已被熔断。请先在「管理账号 → 清理崩溃报告」中安全清理，再重新打开。 |
| | 英 | This Profile was fused after repeated crashes. Safely clean its reports under Manage Agent → Clean crash reports before reopening it. | This location was fused after repeated crashes. Safely clean its reports under Manage account → Clean crash reports before reopening it. |
| | 日 | 繰り返しクラッシュのため、この Profile は停止されています。「Agent を管理 → クラッシュレポートを削除」で安全に削除してから再度開いてください。 | 繰り返しクラッシュのため、この場所は停止されています。「アカウントを管理 → クラッシュレポートを削除」で安全に削除してから再度開いてください。 |
| `main.launch.runtimeCheckFailed` | `main/profile-launch.js` | | |
| | 中 | 无法安全检查 Profile 后台进程（{code}），已取消启动。 | 无法安全检查这个位置的后台进程（{code}），已取消启动。 |
| | 英 | The Profile background process could not be checked safely ({code}); launch was cancelled. | The location’s background processes could not be checked safely ({code}); launch was cancelled. |
| | 日 | Profile のバックグラウンドプロセスを安全に確認できないため（{code}）、起動を中止しました。 | この場所のバックグラウンドプロセスを安全に確認できないため（{code}）、起動を中止しました。 |
| `main.launch.alreadyRunning` | `main/profile-launch.js` | | |
| | 中 | 同一 Profile 已在运行，没有重复启动。 | 同一位置已在运行，没有重复启动。 |
| | 英 | The same Profile is already running; it was not launched again. | The same location is already running; it was not launched again. |
| | 日 | 同じ Profile は既に実行中のため、重複起動しませんでした。 | 同じ場所は既に実行中のため、重複起動しませんでした。 |
| `main.launch.activated` | `main/profile-launch.js` | | |
| | 中 | 同一 Profile 已在运行，已唤醒并显示它的窗口。 | 同一位置已在运行，已唤醒并显示它的窗口。 |
| | 英 | The same Profile is already running; its window was brought forward. | The same location is already running; its window was brought forward. |
| | 日 | 同じ Profile は既に実行中です。ウインドウを前面に表示しました。 | 同じ場所は既に実行中です。ウインドウを前面に表示しました。 |
| `main.launch.activationFailed` | `main/profile-launch.js` | | |
| | 中 | Profile 仍在运行，但无法安全唤醒窗口（{code}）。 | 这个位置仍在运行，但无法安全唤醒窗口（{code}）。 |
| | 英 | The Profile is still running, but its window could not be safely activated ({code}). | The location is still running, but its window could not be safely activated ({code}). |
| | 日 | Profile は実行中ですが、ウインドウを安全に前面表示できませんでした（{code}）。 | この場所は実行中ですが、ウインドウを安全に前面表示できませんでした（{code}）。 |
| `main.launch.profileIsolationUnsupported` | `main/profile-launch.js` | | |
| | 中 | {label} 当前官方客户端没有经过验证的独立 Profile 数据目录。AgentDesk 已取消启动，避免不同账号共用同一份数据。 | {label} 当前官方客户端没有经过验证的、每个位置独立的数据目录。AgentDesk 已取消启动，避免不同位置共用同一份数据。 |
| | 英 | {label} does not currently expose a verified isolated Profile data directory. AgentDesk cancelled the launch to prevent accounts from sharing data. | {label} does not currently offer a verified separate data folder for each location. AgentDesk cancelled the launch to prevent locations from sharing data. |
| | 日 | {label} の公式クライアントでは、独立した Profile データディレクトリがまだ検証されていません。アカウント間でデータを共有しないよう、AgentDesk は起動を中止しました。 | {label} の公式クライアントでは、場所ごとに独立したデータフォルダーがまだ検証されていません。場所同士でデータを共有しないよう、AgentDesk は起動を中止しました。 |
| `main.warn.profileDirMissing` | `main/profile-launch.js` | | |
| | 中 | 账号数据目录还不存在，打开账号时会自动创建。 | 数据目录还不存在，打开账号时会自动创建。 |
| | 英 | The account data directory does not exist yet; it is created when you open the account. | The data folder does not exist yet; it is created when you open the account. |
| | 日 | アカウントデータディレクトリはまだ存在しません。アカウントを開くと自動作成されます。 | データフォルダーはまだ存在しません。アカウントを開くと自動作成されます。 |
| `main.warn.profileDirPerm` | `main/profile-launch.js` | | |
| | 中 | 账号数据目录权限不足。 | 数据目录权限不足。 |
| | 英 | Insufficient permissions on the account data directory. | Insufficient permissions on the data folder. |
| | 日 | アカウントデータディレクトリの権限が不足しています。 | データフォルダーの権限が不足しています。 |
| `main.warn.sessionRootMissing` | `main/profile-launch.js` | | |
| | 中 | 会话根目录不存在，当前槽位暂时不会读到会话。 | 会话根目录不存在，当前位置暂时不会读到会话。 |
| | 英 | The session root does not exist; this slot will not read sessions for now. | The session root does not exist; this location will not read sessions for now. |
| | 日 | セッションルートが存在しません。この枠は当面セッションを読み込みません。 | セッションルートが存在しません。この場所は当面セッションを読み込みません。 |
| `main.warn.appDataProfile` | `main/profile-launch.js` | | |
| | 中 | 这个账号槽位位于 AppData。Store/MSIX 会把它重定向到包私有目录，Explorer 和 AgentDesk 可能看到不同位置；建议执行路径迁移。 | 这个位置的数据目录在 AppData 里。Store/MSIX 会把它重定向到包私有目录，Explorer 和 AgentDesk 可能看到不同的路径；建议执行路径迁移。 |
| | 英 | This account slot lives in AppData. Store/MSIX redirects it to a package-private directory, so Explorer and AgentDesk may see different locations; a path migration is recommended. | This location’s data folder is in AppData. Store/MSIX redirects it to a package-private directory, so Explorer and AgentDesk may see different paths; a path migration is recommended. |
| | 日 | このアカウント枠は AppData にあります。Store/MSIX はこれをパッケージ専用ディレクトリにリダイレクトするため、Explorer と AgentDesk で場所が異なる可能性があります。パス移行を推奨します。 | この場所のデータフォルダーは AppData にあります。Store/MSIX はこれをパッケージ専用ディレクトリにリダイレクトするため、Explorer と AgentDesk で見えるパスが異なる可能性があります。パス移行を推奨します。 |
| `main.warn.appDataSessionRoot` | `main/profile-launch.js` | | |
| | 中 | 会话根目录仍位于 AppData 且不在账号目录内，MSIX 也可能重定向它；建议改到用户主目录或其他稳定目录。 | 会话根目录仍位于 AppData 且不在数据目录内，MSIX 也可能重定向它；建议改到用户主目录或其他稳定目录。 |
| | 英 | The session root still lives in AppData and outside the account directory; MSIX may redirect it too — move it to your home directory or another stable directory. | The session root still lives in AppData and outside the data folder; MSIX may redirect it too — move it to your home directory or another stable directory. |
| | 日 | セッションルートがまだ AppData 内でアカウントディレクトリ外にあります。MSIX がリダイレクトする可能性があるため、ホームディレクトリなど安定した場所に変更してください。 | セッションルートがまだ AppData 内でデータフォルダー外にあります。MSIX がリダイレクトする可能性があるため、ホームディレクトリなど安定した場所に変更してください。 |
| `main.warn.nonAscii` | `main/profile-launch.js` | | |
| | 中 | 账号路径含非 ASCII 字符；部分 Claude Windows 版本创建用户数据目录时存在兼容问题，若启动异常请改用纯英文路径。 | 数据目录的路径含非 ASCII 字符；部分 Claude Windows 版本创建用户数据目录时存在兼容问题，若启动异常请改用纯英文路径。 |
| | 英 | The account path contains non-ASCII characters; some Claude Windows builds have compatibility issues creating the user data directory — use a plain-English path if launch misbehaves. | The data folder path contains non-ASCII characters; some Claude Windows builds have compatibility issues creating the user data directory — use a plain-English path if launch misbehaves. |
| | 日 | アカウントパスに非 ASCII 文字が含まれます。一部の Claude Windows 版はユーザーデータディレクトリ作成時に互換性問題があるため、起動が不安定な場合は英数字のみのパスに変更してください。 | データフォルダーのパスに非 ASCII 文字が含まれます。一部の Claude Windows 版はユーザーデータディレクトリ作成時に互換性問題があるため、起動が不安定な場合は英数字のみのパスに変更してください。 |
| `main.warn.crashpadFused` | `main/profile-launch.js` | | |
| | 中 | Crashpad 在短时间内重复生成同类转储，AgentDesk 已熔断这个 Profile。 | Crashpad 在短时间内重复生成同类转储，AgentDesk 已熔断这个位置。 |
| | 英 | Crashpad repeatedly created matching dumps in a short period; AgentDesk fused this Profile. | Crashpad repeatedly created matching dumps in a short period; AgentDesk fused this location. |
| | 日 | Crashpad が短時間に同種の dump を繰り返し作成したため、AgentDesk がこの Profile を停止しました。 | Crashpad が短時間に同種の dump を繰り返し作成したため、AgentDesk がこの場所を停止しました。 |
| `main.warn.profileIsolationUnsupported` | `main/profile-launch.js` | | |
| | 中 | {label} 当前只支持官方默认数据目录，不能安全创建多个隔离 Profile。 | {label} 当前只支持官方默认数据目录，不能安全创建多个相互隔离的位置。 |
| | 英 | {label} currently supports only its official default data directory, so multiple isolated Profiles cannot be created safely. | {label} currently supports only its official default data folder, so multiple separate locations cannot be created safely. |
| | 日 | {label} は現在、公式の既定データディレクトリだけに対応しており、複数の隔離 Profile を安全に作成できません。 | {label} は現在、公式の既定データフォルダーだけに対応しており、互いに隔離された複数の場所を安全に作成できません。 |
| `main.warn.crashpadUnsafe` | `main/profile-launch.js` | | |
| | 中 | Crashpad 路径包含符号链接或越出 Profile，AgentDesk 已停止自动处理。 | Crashpad 路径包含符号链接或越出这个位置的目录，AgentDesk 已停止自动处理。 |
| | 英 | The Crashpad path contains a symlink or leaves the Profile boundary, so automatic handling was stopped. | The Crashpad path contains a symlink or leaves the location’s folder, so automatic handling was stopped. |
| | 日 | Crashpad のパスにシンボリックリンクがあるか Profile 外へ出るため、自動処理を停止しました。 | Crashpad のパスにシンボリックリンクがあるか場所のフォルダー外へ出るため、自動処理を停止しました。 |
| `main.mig.autoDefault` | `main/profile-launch.js` | | |
| | 中 | 自动默认槽位会跟随系统目录，不需要迁移。 | 自动默认位置会跟随系统目录，不需要迁移。 |
| | 英 | The auto-default slot follows the system directory and needs no migration. | The auto-default location follows the system directory and needs no migration. |
| | 日 | 自動既定枠はシステムディレクトリに追従するため、移行は不要です。 | 自動既定の場所はシステムディレクトリに追従するため、移行は不要です。 |
| `main.mig.alreadySafe` | `main/profile-launch.js` | | |
| | 中 | 当前账号目录已经是 Windows 安全位置。 | 当前数据目录已经在 Windows 的安全路径下。 |
| | 英 | The account directory is already in a safe Windows location. | The data folder is already on a safe Windows path. |
| | 日 | アカウントディレクトリはすでに安全な Windows の場所にあります。 | データフォルダーはすでに Windows の安全なパスにあります。 |
| `main.mig.slotRemovedDuring` | `main/profile-launch.js` | | |
| | 中 | 迁移完成前账号槽位已被移除；复制的数据仍保留在目标目录。 | 迁移完成前位置已被移除；复制的数据仍保留在目标目录。 |
| | 英 | The account slot was removed before migration completed; the copied data still remains in the target directory. | The location was removed before migration completed; the copied data still remains in the target directory. |
| | 日 | 移行完了前にアカウント枠が削除されました。コピーしたデータはターゲットディレクトリに残っています。 | 移行完了前に場所が削除されました。コピーしたデータはターゲットディレクトリに残っています。 |
| `main.mig.pathChangedDuring` | `main/profile-launch.js` | | |
| | 中 | 迁移期间账号路径被修改，已保留复制的数据但没有覆盖新的路径设置。 | 迁移期间数据目录的路径被修改，已保留复制的数据但没有覆盖新的路径设置。 |
| | 英 | The account path was changed during migration; the copied data was kept but the new path setting was not overwritten. | The data folder path was changed during migration; the copied data was kept but the new path setting was not overwritten. |
| | 日 | 移行中にアカウントパスが変更されました。コピーしたデータは保持しましたが、新しいパス設定は上書きしていません。 | 移行中にデータフォルダーのパスが変更されました。コピーしたデータは保持しましたが、新しいパス設定は上書きしていません。 |
| `main.mig.copiedBackup` | `main/profile-launch.js` | | |
| | 中 | 账号数据已复制到 Windows 安全目录；旧目录保留为备份。 | 数据目录已复制到 Windows 安全目录；旧目录保留为备份。 |
| | 英 | Account data copied to the safe Windows directory; the old directory is kept as a backup. | The data folder was copied to the safe Windows directory; the old directory is kept as a backup. |
| | 日 | アカウントデータを安全な Windows ディレクトリにコピーしました。旧ディレクトリはバックアップとして残します。 | データフォルダーを安全な Windows ディレクトリにコピーしました。旧ディレクトリはバックアップとして残します。 |

### 右键菜单

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `ctx.noAgent` | `renderer/views/context.js` | | |
| | 中 | 尚未选择 Agent | 尚未选择账号 |
| | 英 | No Agent selected | No account selected |
| | 日 | Agent 未選択 | アカウント未選択 |

### 卡片

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `card.quotaConflictHint` | `renderer/views/roster.js` | | |
| | 中 | 同一登录账号的多个新鲜额度来源不一致，请刷新后在额度详情中核对。 | 同一登录的多个新鲜额度来源不一致，请刷新后在额度详情中核对。 |
| | 英 | Fresh quota sources for this login disagree. Refresh, then review the quota details. | Fresh quota sources for this sign-in disagree. Refresh, then review the quota details. |
| | 日 | 同じログインの新しいクォータ情報が一致しません。更新後、詳細で確認してください。 | （不变） |

## 5. 词表之外的文字（规划会话已定）

| 位置 | 现在 | 定为 |
|---|---|---|
| `src/main/accounts.js` 新建位置的默认名 | `<客户端名> 账号`（例如“Codex 账号”） | **不改**。没有另给名字时，它也是这只猫（卡片）的名字：`agent-catalog.js` 用位置的名字给新账号命名 |
| `src/clients/codex/quota.js` 额度原因 | “Codex 账号尚未登录或尚未返回额度”“当前账号没有返回可展示的订阅额度” | 按平台登录改：“Codex 尚未登录或尚未返回额度”“当前登录没有返回可展示的订阅额度”；随第 6 节第 3 条一起进词表 |
| `src/clients/claude/index.js`、`src/clients/cursor/index.js` 额度不支持的原因 | “……为保护账号……”“Cursor 个人账号暂无公开额度 API……” | 按平台登录改：“……为保护登录……”“Cursor 个人登录暂无公开额度 API……”；随第 6 节第 3 条一起进词表 |
| `src/yard/cats.js` 的 `STATE_META` | “刚打开账号，App 还没起来”等 | **不动**。它被导出但没有任何代码读取，不显示 |

## 6. 看得见的其他改动（规划会话已定做法）

1. **额度提示 11.5px → 12px。** 旧样式的 `.quota-message` 用 `!important` 写了 11.5px，它在层叠的第一层，压过皮肤统一字号的 `!important`（见 `test/style-structure.test.js` 的清单）。改成 12px，统一到规定。**这是看得见的改动，跟用词一起交所有者看。**
2. **各弹窗没人读的安全边距：删掉。** `workspace.css` 给设备页、收件箱、交接任务和子弹窗设的 `--dialog-safe-margin`（42 / 64 / 48 / 64px）没有规则读取，弹窗一律用皮肤的 `calc(100dvh - 48px)`。窗口固定 1040 × 840，这条路径基本走不到，所以删掉这几行，不让它们生效；计算样式比对里只有这几个变量消失，其余 0 处不同。单独一批做，不等所有者。
3. **额度原因只有中文：修。** 第 5 节的额度原因写死在客户端适配器里，英文和日文界面也显示中文，这是显示错误。给它们配三种语言的词表 key，单独一批修并配测试，不等所有者。
4. **从没生效过的旧字体写法：删掉。** 旧样式给配对码输入框写了等宽 11px、行高 1.4，给几处按钮写了 11–12px 的字号，一直被 reset 层给表单控件的 `font: inherit` 和皮肤的统一字号压过。删掉，计算样式应 0 处不同。单独一批做，不等所有者。
