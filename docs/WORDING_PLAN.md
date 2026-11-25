# 界面用词改动清单（待所有者确认）

> 状态：**草案，没有改任何看得见的文字。** 来自架构整理第 8 阶段（`docs/ARCHITECTURE_PLAN.md` 第 9 节第 4 条：“全局对象只说‘账号’，本机登录位置只说‘位置’”）。所有者看过、规划会话转达同意以后，才按这份清单改三种语言的词表与 `index.html` 的预置文字。
>
> 生成：2026-11-24，基于提交 `6ec6bf2` 的 `src/i18n/{zh,en,ja}.js`（三份词表各 1717 条，key 完全一致）。

## 1. 要定的词

| 指的是什么 | 现在的叫法 | 建议统一成 | 说明 |
|---|---|---|---|
| 全局对象：一只猫，代码里的 `agent`（AgentIdentity） | 中：Agent、员工、账号；英：Agent、employee、account；日：Agent、従業員、アカウント | 中 **账号**；英 **account**；日 **アカウント** | 第 9 节第 4 条的建议 |
| 本机的一个运行位置，代码里的 `profile`（AgentSlot） | 中：运行位置、位置、槽位、账号槽位、Profile；英：runtime location、location、slot、account slot、Run at；日：実行場所、場所、スロット、アカウントスロット | 中 **位置**；英 **location**；日 **場所** | 同上 |
| 某个平台上的一次登录，代码里的 `binding`（AccountBinding） | 中：登录账号、账号绑定、平台账号；英：sign-in account、account binding、login binding；日：ログインアカウント、アカウント紐付け | 中 **登录**；英 **sign-in**；日 **ログイン** | “账号”给了全局对象以后，这个概念需要另一个词；这是本清单另加的建议，需要所有者一起定 |

不改的：`AgentDesk`、`Personal Agent Mesh` 这类名字；画面里的“猫”（卡片、招募、送走等说法）；“设备”“工作环境”；代码里的标识符（`agent`、`profile`、`binding`）和存盘字段。

## 2. 怎么读

- 第 3 节是规则拿不准、需要先定的 44 条，请先看。第 4 节按界面区域列出其余全部改动。
- 每条给出 key、在代码里出现的位置（`index.html` 指它在页面里的预置文字，与中文词表相同，会一起改），以及三种语言的改前与建议的改后；某种语言不需要改的写“（不变）”。
- “改后”是按第 1 节的规则替换出来的建议句子，个别地方读起来可能不顺，确认时可以直接改写。
- 合计：需要改的 key 170 条（中文 163、英文 146、日文 142），另有 19 条规则没有改动但需要看一眼。

## 3. 需要先定的

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `dossier.profile` | `index.html` | | |
| | 中 | 资料 | （不变） |
| | 英 | Profile | （不变） |
| | 日 | プロフィール | （不变） |
| `devices.empty.body` | `index.html` | | |
| | 中 | 会为本机建立独立设备身份，并把当前账号身份组迁移成全局 Agent；不会移动账号目录、会话或登录信息。 | 会为本机建立独立设备身份，并把当前账号身份组迁移成账号；不会移动账号目录、会话或登录信息。 |
| | 英 | AgentDesk creates an independent device identity and migrates current identity groups into global Agents. It does not move account folders, sessions, or sign-in data. | AgentDesk creates an independent device identity and migrates current identity groups into accounts. It does not move account folders, sessions, or sign-in data. |
| | 日 | 独立したデバイス ID を作成し、現在の ID グループをグローバル Agent に移行します。アカウントフォルダ、セッション、ログイン情報は移動しません。 | 独立したデバイス ID を作成し、現在の ID グループをアカウントに移行します。アカウントフォルダ、セッション、ログイン情報は移動しません。 |
| `devices.agents.empty` | `renderer/views/devices.js` | | |
| | 中 | 当前没有 Agent。账号槽位可以删到零，不会自动补回默认平台账号。 | 当前没有账号。位置可以删到零，不会自动补回默认平台账号。 |
| | 英 | There are no Agents. Account slots may be deleted down to zero; default provider accounts are not recreated. | There are no accounts. Locations may be deleted down to zero; default provider accounts are not recreated. |
| | 日 | Agent はありません。アカウントスロットは 0 件まで削除でき、既定のプロバイダーアカウントは再作成されません。 | アカウントはありません。場所は 0 件まで削除でき、既定のプロバイダーアカウントは再作成されません。 |
| `account.manageHint` | `index.html`、`renderer/views/agent-manage.js` | | |
| | 中 | 这只猫的一切都在这一页，按“它是谁、它在哪、它用哪个账号、能不能被别的 Agent 调用、要不要送走”分段。 | 这只猫的一切都在这一页，按“它是谁、它在哪、它用哪个账号、能不能被别的账号调用、要不要送走”分段。 |
| | 英 | Everything about this cat is on this page: who it is, where it lives, which account it uses, whether other Agents may call it, and whether to send it away. | Everything about this cat is on this page: who it is, where it lives, which account it uses, whether other accounts may call it, and whether to send it away. |
| | 日 | この猫のすべてがこのページにあります。「誰か・どこにいるか・どのアカウントか・他の Agent から呼べるか・送り出すか」に分かれています。 | この猫のすべてがこのページにあります。「誰か・どこにいるか・どのアカウントか・他のアカウントから呼べるか・送り出すか」に分かれています。 |
| `account.stopRuntimeHint` | `index.html` | | |
| | 中 | 只关闭由 AgentDesk 启动的当前 Profile 进程 | 只关闭由 AgentDesk 启动的当前位置进程 |
| | 英 | Close only the current Profile processes launched by AgentDesk | （不变） |
| | 日 | AgentDesk が起動した現在の Profile プロセスだけを終了 | （不变） |
| `account.folderHint` | `index.html` | | |
| | 中 | 在本机文件管理器中显示账号目录 | （不变） |
| | 英 | Reveal the account directory in the local file manager | （不变） |
| | 日 | ローカルのファイルマネージャーでアカウントフォルダーを表示 | （不变） |
| `status.savedProfileCat` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已保存账号资料和猫咪外观。 | （不变） |
| | 英 | Saved account profile and cat look. | （不变） |
| | 日 | アカウント情報とねこの見た目を保存しました。 | （不变） |
| `status.crashpadFused` | `renderer/views/updates.js` | | |
| | 中 | 检测到重复崩溃，已熔断并关闭对应 Profile。 | 检测到重复崩溃，已熔断并关闭对应位置。 |
| | 英 | Repeated crashes detected; the affected Profile was fused and stopped. | （不变） |
| | 日 | 繰り返しクラッシュを検出し、対象 Profile を停止しました。 | （不变） |
| `status.pathEmpty` | `renderer/views/agent-manage.js` | | |
| | 中 | 账号目录和会话根目录都不能为空。 | （不变） |
| | 英 | Account dir and session root cannot be empty. | （不变） |
| | 日 | アカウントディレクトリとセッションルートは空にできません。 | （不变） |
| `status.openAcctDirOk` | `renderer/views/agent-manage.js` | | |
| | 中 | 已打开账号目录。 | （不变） |
| | 英 | Opened the account directory. | （不变） |
| | 日 | アカウントディレクトリを開きました。 | （不变） |
| `status.openAcctDirFail` | `pixel/sfx.js`、`renderer/views/agent-manage.js` | | |
| | 中 | 无法打开账号目录。 | （不变） |
| | 英 | Could not open the account directory. | （不变） |
| | 日 | アカウントディレクトリを開けません。 | （不变） |
| `recruit.method.key.gemini-cli.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 写进这个账号目录的 .gemini/.env，并把登录方式设为 API 密钥。 | （不变） |
| | 英 | It goes into .gemini/.env in this account’s folder, and the sign-in method is set to API key. | （不变） |
| | 日 | このアカウントのフォルダーの .gemini/.env に書き込み、サインイン方法を API キーにします。 | （不变） |
| `recruit.method.key.claude-cli.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | claude setup-token 生成的令牌或 API 密钥，写进这个账号目录的 settings.json。 | （不变） |
| | 英 | A token from claude setup-token, or an API key. It goes into settings.json in this account’s folder. | （不变） |
| | 日 | claude setup-token のトークン、または API キー。このアカウントのフォルダーの settings.json に書き込みます。 | （不变） |
| `recruit.method.key.dsh-cli.hint` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 写进这个账号目录的 .credentials.yaml，DSH 从那里读。 | （不变） |
| | 英 | It goes into .credentials.yaml in this account’s folder, where DSH reads it. | （不变） |
| | 日 | このアカウントのフォルダーの .credentials.yaml に書き込み、DSH がそこから読みます。 | （不变） |
| `recruit.error.config-format-unsupported` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 这个账号目录里的配置文件格式认不出，为了不弄坏它，什么都没改。 | （不变） |
| | 英 | The configuration file in this account’s folder has a format AgentDesk does not recognise, so nothing was changed. | （不变） |
| | 日 | このアカウントのフォルダーにある設定ファイルの形式を認識できないため、何も変更していません。 | （不变） |
| `recruit.error.config-unreadable` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 读不了这个账号目录里的配置文件。 | （不变） |
| | 英 | The configuration file in this account’s folder could not be read. | （不变） |
| | 日 | このアカウントのフォルダーにある設定ファイルを読めませんでした。 | （不变） |
| `recruit.error.config-too-large` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 这个账号目录里的配置文件太大，没有改动。 | （不变） |
| | 英 | The configuration file in this account’s folder is too large; nothing was changed. | （不变） |
| | 日 | このアカウントのフォルダーにある設定ファイルが大きすぎるため、変更していません。 | （不变） |
| `catalog.assignment.hintExistingBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 这是某个已有登录在本机的新客户端位置；只增加位置，不新建 Agent。 | 这是某个已有登录在本机的新客户端位置；只增加位置，不新建账号。 |
| | 英 | This is another client location for an existing login; only a location is added, not another Agent. | This is another client location for an existing login; only a location is added, not another account. |
| | 日 | 既存ログインの別クライアント場所です。Agent を増やさず、場所だけを追加します。 | 既存ログインの別クライアント場所です。アカウントを増やさず、場所だけを追加します。 |
| `catalog.merge.noTarget` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 没有其他可合并的 Agent。 | 没有其他可合并的账号。 |
| | 英 | There is no other Agent to merge into. | There is no other account to merge into. |
| | 日 | 統合できる他の Agent がありません。 | 統合できる他のアカウントがありません。 |
| `onboarding.migration.lead` | `index.html` | | |
| | 中 | 选择要放进初始 Agent 库的现有账号。只建立目录关系，不移动账号目录、会话或登录信息。 | 选择要放进初始账号库的现有账号。只建立目录关系，不移动账号目录、会话或登录信息。 |
| | 英 | Choose which existing accounts should enter the initial Agent catalog. This only creates catalog relationships; account folders, sessions and sign-in data stay in place. | Choose which existing accounts should enter the initial Account catalog. This only creates catalog relationships; account folders, sessions and sign-in data stay in place. |
| | 日 | 初期 Agent カタログに入れる既存アカウントを選びます。カタログの関係だけを作成し、アカウントフォルダ、セッション、ログイン情報は移動しません。 | 初期アカウントカタログに入れる既存アカウントを選びます。カタログの関係だけを作成し、アカウントフォルダ、セッション、ログイン情報は移動しません。 |
| `onboarding.existing.title` | `index.html` | | |
| | 中 | 你的 Agent 库已经就绪 | 你的账号库已经就绪 |
| | 英 | Your Agent catalog is ready | Your Account catalog is ready |
| | 日 | Agent カタログは準備済みです | アカウントカタログは準備済みです |
| `diag.profileDirExists` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录存在 | （不变） |
| | 英 | Account dir exists | （不变） |
| | 日 | アカウントディレクトリあり | （不变） |
| `diag.profileDirMissing` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录未创建 | （不变） |
| | 英 | Account dir not created | （不变） |
| | 日 | アカウントディレクトリ未作成 | （不变） |
| `diag.row.profileDir` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录 | （不变） |
| | 英 | Account dir | （不变） |
| | 日 | アカウントディレクトリ | （不变） |
| `diag.txt.profileDir` | `renderer/views/diagnostics.js` | | |
| | 中 | 账号目录：{v} | （不变） |
| | 英 | Account dir: {v} | （不变） |
| | 日 | アカウントディレクトリ：{v} | （不变） |
| `hub.tip.copy.body` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 复制这段对话的位置。贴给另一个 Agent，它就能自己读到。对话本身不动。 | 复制这段对话的位置。贴给另一个账号，它就能自己读到。对话本身不动。 |
| | 英 | Copies where this conversation lives. Paste it to another Agent and it can read it by itself. The conversation stays where it is. | Copies where this conversation lives. Paste it to another account and it can read it by itself. The conversation stays where it is. |
| | 日 | この会話の場所をコピーします。別の Agent に貼れば、その Agent が自分で読めます。会話そのものは動きません。 | この会話の場所をコピーします。別のアカウントに貼れば、そのアカウントが自分で読めます。会話そのものは動きません。 |
| `hub.tip.run.body` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 你的 Agent 通过 AgentDesk 让这个账号在后台跑的一段对话。这里只显示标题和状态。 | 你的账号通过 AgentDesk 让这个账号在后台跑的一段对话。这里只显示标题和状态。 |
| | 英 | A conversation your Agent had this account run in the background, through AgentDesk. Only the title and state are shown here. | A conversation your account had this account run in the background, through AgentDesk. Only the title and state are shown here. |
| | 日 | あなたの Agent が AgentDesk を通じて、このアカウントにバックグラウンドで実行させた会話です。ここにはタイトルと状態だけを表示します。 | あなたのアカウントが AgentDesk を通じて、このアカウントにバックグラウンドで実行させた会話です。ここにはタイトルと状態だけを表示します。 |
| `hub.tip.run.facts` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 谁发起：你对自己的 Agent 说的话 · AgentDesk 只中转，不自己派活 | 谁发起：你对自己的账号说的话 · AgentDesk 只中转，不自己派活 |
| | 英 | Started by: what you said to your own Agent · AgentDesk only relays, it never hands out work | Started by: what you said to your own account · AgentDesk only relays, it never hands out work |
| | 日 | 始めたのは：あなたが自分の Agent に言ったこと · AgentDesk は中継するだけで、自分から仕事を振りません | 始めたのは：あなたが自分のアカウントに言ったこと · AgentDesk は中継するだけで、自分から仕事を振りません |
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
| | 中 | AgentDesk 只中转你自己的 Agent 发起的调用，不自己派活。 | AgentDesk 只中转你自己的账号发起的调用，不自己派活。 |
| | 英 | AgentDesk only relays calls your own Agents make. It never hands out work by itself. | AgentDesk only relays calls your own accounts make. It never hands out work by itself. |
| | 日 | AgentDesk はあなた自身の Agent が始めた呼び出しを中継するだけで、自分から仕事を振りません。 | AgentDesk はあなた自身のアカウントが始めた呼び出しを中継するだけで、自分から仕事を振りません。 |
| `main.err.cannotPrepDir` | `main/profile-launch.js` | | |
| | 中 | 无法准备账号目录：{msg} | （不变） |
| | 英 | Cannot prepare the account directory: {msg} | （不变） |
| | 日 | アカウントディレクトリを準備できません：{msg} | （不变） |
| `main.tools.profileMismatch` | `main/profile-launch.js`、`main/tools.js` | | |
| | 中 | 当前选择的 Profile 不属于这个 CLI 工具，请选择对应的 CLI Profile。 | 当前选择的位置不属于这个 CLI 工具，请选择对应的 CLI位置。 |
| | 英 | The selected profile does not belong to this CLI tool. Choose the matching CLI profile. | （不变） |
| | 日 | 選択したプロファイルはこの CLI ツールに属していません。対応する CLI プロファイルを選択してください。 | 選択した場所はこの CLI ツールに属していません。対応する CLI 場所を選択してください。 |
| `main.launch.crashpadFused` | `main/profile-launch.js` | | |
| | 中 | 这个 Profile 因重复崩溃已被熔断。请先在「管理 Agent → 清理崩溃报告」中安全清理，再重新打开。 | 这个位置因重复崩溃已被熔断。请先在「管理 账号 → 清理崩溃报告」中安全清理，再重新打开。 |
| | 英 | This Profile was fused after repeated crashes. Safely clean its reports under Manage Agent → Clean crash reports before reopening it. | This Profile was fused after repeated crashes. Safely clean its reports under Manage account → Clean crash reports before reopening it. |
| | 日 | 繰り返しクラッシュのため、この Profile は停止されています。「Agent を管理 → クラッシュレポートを削除」で安全に削除してから再度開いてください。 | 繰り返しクラッシュのため、この Profile は停止されています。「アカウントを管理 → クラッシュレポートを削除」で安全に削除してから再度開いてください。 |
| `main.launch.runtimeCheckFailed` | `main/profile-launch.js` | | |
| | 中 | 无法安全检查 Profile 后台进程（{code}），已取消启动。 | 无法安全检查位置后台进程（{code}），已取消启动。 |
| | 英 | The Profile background process could not be checked safely ({code}); launch was cancelled. | （不变） |
| | 日 | Profile のバックグラウンドプロセスを安全に確認できないため（{code}）、起動を中止しました。 | （不变） |
| `main.launch.alreadyRunning` | `main/profile-launch.js` | | |
| | 中 | 同一 Profile 已在运行，没有重复启动。 | 同一位置已在运行，没有重复启动。 |
| | 英 | The same Profile is already running; it was not launched again. | （不变） |
| | 日 | 同じ Profile は既に実行中のため、重複起動しませんでした。 | （不变） |
| `main.launch.activated` | `main/profile-launch.js` | | |
| | 中 | 同一 Profile 已在运行，已唤醒并显示它的窗口。 | 同一位置已在运行，已唤醒并显示它的窗口。 |
| | 英 | The same Profile is already running; its window was brought forward. | （不变） |
| | 日 | 同じ Profile は既に実行中です。ウインドウを前面に表示しました。 | （不变） |
| `main.launch.activationFailed` | `main/profile-launch.js` | | |
| | 中 | Profile 仍在运行，但无法安全唤醒窗口（{code}）。 | 位置仍在运行，但无法安全唤醒窗口（{code}）。 |
| | 英 | The Profile is still running, but its window could not be safely activated ({code}). | （不变） |
| | 日 | Profile は実行中ですが、ウインドウを安全に前面表示できませんでした（{code}）。 | （不变） |
| `main.launch.profileIsolationUnsupported` | `main/profile-launch.js` | | |
| | 中 | {label} 当前官方客户端没有经过验证的独立 Profile 数据目录。AgentDesk 已取消启动，避免不同账号共用同一份数据。 | {label} 当前官方客户端没有经过验证的独立位置数据目录。AgentDesk 已取消启动，避免不同账号共用同一份数据。 |
| | 英 | {label} does not currently expose a verified isolated Profile data directory. AgentDesk cancelled the launch to prevent accounts from sharing data. | （不变） |
| | 日 | {label} の公式クライアントでは、独立した Profile データディレクトリがまだ検証されていません。アカウント間でデータを共有しないよう、AgentDesk は起動を中止しました。 | （不变） |
| `main.warn.appDataSessionRoot` | `main/profile-launch.js` | | |
| | 中 | 会话根目录仍位于 AppData 且不在账号目录内，MSIX 也可能重定向它；建议改到用户主目录或其他稳定目录。 | （不变） |
| | 英 | The session root still lives in AppData and outside the account directory; MSIX may redirect it too — move it to your home directory or another stable directory. | （不变） |
| | 日 | セッションルートがまだ AppData 内でアカウントディレクトリ外にあります。MSIX がリダイレクトする可能性があるため、ホームディレクトリなど安定した場所に変更してください。 | （不变） |
| `main.warn.crashpadFused` | `main/profile-launch.js` | | |
| | 中 | Crashpad 在短时间内重复生成同类转储，AgentDesk 已熔断这个 Profile。 | Crashpad 在短时间内重复生成同类转储，AgentDesk 已熔断这个位置。 |
| | 英 | Crashpad repeatedly created matching dumps in a short period; AgentDesk fused this Profile. | （不变） |
| | 日 | Crashpad が短時間に同種の dump を繰り返し作成したため、AgentDesk がこの Profile を停止しました。 | （不变） |
| `main.warn.crashpadUnsafe` | `main/profile-launch.js` | | |
| | 中 | Crashpad 路径包含符号链接或越出 Profile，AgentDesk 已停止自动处理。 | Crashpad 路径包含符号链接或越出位置，AgentDesk 已停止自动处理。 |
| | 英 | The Crashpad path contains a symlink or leaves the Profile boundary, so automatic handling was stopped. | （不变） |
| | 日 | Crashpad のパスにシンボリックリンクがあるか Profile 外へ出るため、自動処理を停止しました。 | （不变） |
| `main.mig.alreadySafe` | `main/profile-launch.js` | | |
| | 中 | 当前账号目录已经是 Windows 安全位置。 | （不变） |
| | 英 | The account directory is already in a safe Windows location. | （不变） |
| | 日 | アカウントディレクトリはすでに安全な Windows の場所にあります。 | （不变） |

每条的疑点：

- `dossier.profile`：“profile” here may be the cat’s dossier, not a location
- `devices.empty.body`：“账号”这里可能指平台登录或旧的身份组
- `devices.agents.empty`：“账号”这里可能指平台登录或旧的身份组
- `account.manageHint`：“Agent”这里可能泛指 AI 工具，而不是全局对象；“Agent” here may mean AI tools in general；「Agent」が AI ツール一般を指す可能性
- `account.stopRuntimeHint`：“profile” here may be the cat’s dossier, not a location
- `account.folderHint`：“账号”这里可能指平台登录或旧的身份组
- `status.savedProfileCat`：“profile” here may be the cat’s dossier, not a location
- `status.crashpadFused`：“profile” here may be the cat’s dossier, not a location
- `status.pathEmpty`：“账号”这里可能指平台登录或旧的身份组
- `status.openAcctDirOk`：“账号”这里可能指平台登录或旧的身份组
- `status.openAcctDirFail`：“账号”这里可能指平台登录或旧的身份组
- `recruit.method.key.gemini-cli.hint`：“账号”这里可能指平台登录或旧的身份组
- `recruit.method.key.claude-cli.hint`：“账号”这里可能指平台登录或旧的身份组
- `recruit.method.key.dsh-cli.hint`：“账号”这里可能指平台登录或旧的身份组
- `recruit.error.config-format-unsupported`：“账号”这里可能指平台登录或旧的身份组
- `recruit.error.config-unreadable`：“账号”这里可能指平台登录或旧的身份组
- `recruit.error.config-too-large`：“账号”这里可能指平台登录或旧的身份组
- `catalog.assignment.hintExistingBinding`：“Agent” here may mean AI tools in general
- `catalog.merge.noTarget`：“Agent” here may mean AI tools in general；「Agent」が AI ツール一般を指す可能性
- `onboarding.migration.lead`：“账号”这里可能指平台登录或旧的身份组
- `onboarding.existing.title`：“Agent”这里可能泛指 AI 工具，而不是全局对象；“Agent” here may mean AI tools in general
- `diag.profileDirExists`：“账号”这里可能指平台登录或旧的身份组
- `diag.profileDirMissing`：“账号”这里可能指平台登录或旧的身份组
- `diag.row.profileDir`：“账号”这里可能指平台登录或旧的身份组
- `diag.txt.profileDir`：“账号”这里可能指平台登录或旧的身份组
- `hub.tip.copy.body`：“Agent” here may mean AI tools in general
- `hub.tip.run.body`：“Agent”这里可能泛指 AI 工具，而不是全局对象；“Agent” here may mean AI tools in general
- `hub.tip.run.facts`：“Agent”这里可能泛指 AI 工具，而不是全局对象
- `hub.tip.allow.body`：“Agent”这里可能泛指 AI 工具，而不是全局对象；“Agent” here may mean AI tools in general；「Agent」が AI ツール一般を指す可能性
- `hub.dossier.allow`：“Agent”这里可能泛指 AI 工具，而不是全局对象；“Agent” here may mean AI tools in general；「Agent」が AI ツール一般を指す可能性
- `hub.dossier.allow.hint`：“Agent”这里可能泛指 AI 工具，而不是全局对象；“Agent” here may mean AI tools in general；「Agent」が AI ツール一般を指す可能性
- `hub.system.lead`：“Agent”这里可能泛指 AI 工具，而不是全局对象
- `main.err.cannotPrepDir`：“账号”这里可能指平台登录或旧的身份组
- `main.tools.profileMismatch`：“profile” here may be the cat’s dossier, not a location；「プロファイル」が場所でない可能性
- `main.launch.crashpadFused`：“profile” here may be the cat’s dossier, not a location
- `main.launch.runtimeCheckFailed`：“profile” here may be the cat’s dossier, not a location
- `main.launch.alreadyRunning`：“profile” here may be the cat’s dossier, not a location
- `main.launch.activated`：“profile” here may be the cat’s dossier, not a location
- `main.launch.activationFailed`：“profile” here may be the cat’s dossier, not a location
- `main.launch.profileIsolationUnsupported`：“profile” here may be the cat’s dossier, not a location
- `main.warn.appDataSessionRoot`：“账号”这里可能指平台登录或旧的身份组
- `main.warn.crashpadFused`：“profile” here may be the cat’s dossier, not a location
- `main.warn.crashpadUnsafe`：“profile” here may be the cat’s dossier, not a location
- `main.mig.alreadySafe`：“账号”这里可能指平台登录或旧的身份组

## 4. 按界面区域的全部改动

### 猫的档案

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `dossier.accounts.localNote` | `index.html` | | |
| | 中 | 合并与拆分登录账号需要先有本机 Agent 目录；招募第一只猫时会自动建立。 | 合并与拆分登录需要先有本机 账号目录；招募第一只猫时会自动建立。 |
| | 英 | Merging and splitting sign-in accounts needs the local Agent directory, which is created when you recruit your first cat. | Merging and splitting sign-ins needs the local account directory, which is created when you recruit your first cat. |
| | 日 | ログインアカウントの統合と分割には、このコンピューターの Agent ディレクトリが必要です。最初の猫を迎えると自動で作成されます。 | ログインの統合と分割には、このコンピューターのアカウントディレクトリが必要です。最初の猫を迎えると自動で作成されます。 |
| `acct.slotDefault` | `renderer/views/roster.js` | | |
| | 中 | 默认槽位 | 默认位置 |
| | 英 | Default slot | Default location |
| | 日 | 既定の枠 | （不变） |
| `acct.slotIndependent` | `renderer/views/roster.js` | | |
| | 中 | 独立槽位 | 独立位置 |
| | 英 | Isolated slot | Isolated location |
| | 日 | 独立した枠 | （不变） |

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
| | 中 | 查看本机设备身份、全局 Agent 目录和设备状态 | 查看本机设备身份、账号目录和设备状态 |
| | 英 | View this device identity, the global Agent catalog, and device status | View this device identity, the account catalog, and device status |
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
| | 中 | 正在读取本机设备与 Agent 目录… | 正在读取本机设备与 账号目录… |
| | 英 | Reading this device and the Agent catalog… | Reading this device and the Account catalog… |
| | 日 | このデバイスと Agent カタログを読み込み中… | このデバイスとアカウントカタログを読み込み中… |
| `devices.status.initializing` | `renderer/views/devices.js` | | |
| | 中 | 正在生成设备密钥并迁移本机 Agent 目录… | 正在生成设备密钥并迁移本机 账号目录… |
| | 英 | Generating device keys and migrating the local Agent catalog… | Generating device keys and migrating the local Account catalog… |
| | 日 | デバイス鍵を生成し、ローカル Agent カタログを移行中… | デバイス鍵を生成し、ローカルアカウントカタログを移行中… |
| `devices.status.readyMesh` | `renderer/views/devices.js` | | |
| | 中 | 本机设备身份有效；设备与 Agent 目录已从独立 Mesh 存储读取。 | 本机设备身份有效；设备与 账号目录已从独立 Mesh 存储读取。 |
| | 英 | This device identity is valid; devices and Agents were read from the independent Mesh store. | This device identity is valid; devices and accounts were read from the independent Mesh store. |
| | 日 | デバイス ID は有効です。デバイスと Agent は独立した Mesh ストアから読み込まれました。 | デバイス ID は有効です。デバイスとアカウントは独立した Mesh ストアから読み込まれました。 |
| `devices.status.resetDone` | `renderer/views/devices.js` | | |
| | 中 | 已回到纯本机 AgentDesk；账号槽位和会话没有删除。 | 已回到纯本机 AgentDesk；位置和会话没有删除。 |
| | 英 | AgentDesk is local-only again; account slots and sessions were preserved. | AgentDesk is local-only again; locations and sessions were preserved. |
| | 日 | ローカル専用の AgentDesk に戻りました。アカウントスロットとセッションは保持されています。 | ローカル専用の AgentDesk に戻りました。場所とセッションは保持されています。 |
| `devices.connection.connected` | `renderer/views/devices.js` | | |
| | 中 | 已连接“{name}”，Agent 与会话库存正在同步。 | 已连接“{name}”，账号与会话库存正在同步。 |
| | 英 | Connected to “{name}”; Agent and session inventory is syncing. | Connected to “{name}”; account and session inventory is syncing. |
| | 日 | 「{name}」に接続しました。Agent とセッションのインベントリを同期中です。 | 「{name}」に接続しました。アカウントとセッションのインベントリを同期中です。 |
| `devices.reset.confirm` | `renderer/views/devices.js` | | |
| | 中 | 确定让本机离开并重置 Personal Agent Mesh？只会删除 Mesh 设备身份、目录缓存和密钥；现有账号槽位、登录与会话都保留。 | 确定让本机离开并重置 Personal Agent Mesh？只会删除 Mesh 设备身份、目录缓存和密钥；现有位置、登录与会话都保留。 |
| | 英 | Make this computer leave and reset Personal Agent Mesh? Only the Mesh identity, catalog cache, and keys are removed; existing account slots, sign-ins, and sessions remain. | Make this computer leave and reset Personal Agent Mesh? Only the Mesh identity, catalog cache, and keys are removed; existing locations, sign-ins, and sessions remain. |
| | 日 | このコンピューターを Personal Agent Mesh から離脱させてリセットしますか？Mesh ID、カタログキャッシュ、鍵のみ削除され、既存のアカウントスロット、ログイン、セッションは残ります。 | このコンピューターを Personal Agent Mesh から離脱させてリセットしますか？Mesh ID、カタログキャッシュ、鍵のみ削除され、既存の場所、ログイン、セッションは残ります。 |
| `devices.stat.agents` | `renderer/views/devices.js` | | |
| | 中 | Agent | 账号 |
| | 英 | Agents | Accounts |
| | 日 | Agent | アカウント |
| `devices.stat.slots` | `renderer/views/devices.js` | | |
| | 中 | 运行位置 | 位置 |
| | 英 | Locations | （不变） |
| | 日 | 実行場所 | 場所 |
| `devices.meta.deviceAgentSlotCount` | `renderer/views/devices.js` | | |
| | 中 | {agents} 个 Agent · {slots} 个位置 | {agents} 个 账号 · {slots} 个位置 |
| | 英 | {agents} Agents · {slots} locations | {agents} accounts · {locations} locations |
| | 日 | Agent {agents} 件 · 実行場所 {slots} 件 | アカウント{agents} 件 · 場所 {slots} 件 |
| `devices.list.agentCount` | `renderer/views/devices.js` | | |
| | 中 | {n} Agent | {n}账号 |
| | 英 | {n} Agents | {n} accounts |
| | 日 | Agent {n} | アカウント{n} |
| `devices.permission.inventory` | `index.html` | | |
| | 中 | 查看 Agent 与会话索引 | 查看账号与会话索引 |
| | 英 | View Agent and session inventory | View account and session inventory |
| | 日 | Agent とセッション索引を表示 | アカウントとセッション索引を表示 |
| `devices.permission.catalog` | `index.html` | | |
| | 中 | 管理全局 Agent 目录 | 管理账号目录 |
| | 英 | Manage the global Agent catalog | Manage the account catalog |
| | 日 | グローバル Agent カタログを管理 | アカウントカタログを管理 |
| `devices.agents.devicePositions` | `renderer/views/devices.js` | | |
| | 中 | {slots} 个运行位置 | {slots} 个位置 |
| | 英 | {slots} runtime locations | {locations} locations |
| | 日 | 実行場所 {slots} 件 | 場所 {slots} 件 |
| `devices.agents.emptyOnDevice` | `renderer/views/devices.js` | | |
| | 中 | 这台设备当前没有 Agent 运行位置。 | 这台设备当前没有账号位置。 |
| | 英 | This device has no Agent runtime locations. | This device has no account locations. |
| | 日 | このデバイスには Agent の実行場所がありません。 | このデバイスにはアカウントの場所がありません。 |
| `devices.agents.noBinding` | `renderer/views/devices.js` | | |
| | 中 | 尚无账号绑定 | 尚无登录 |
| | 英 | No account binding yet | No sign-in yet |
| | 日 | アカウント紐付けなし | ログインなし |
| `devices.slot.label` | `renderer/views/roster.js` | | |
| | 中 | 运行位置 | 位置 |
| | 英 | Run at | Location |
| | 日 | 実行場所 | 場所 |
| `devices.slot.title` | `renderer/views/roster.js` | | |
| | 中 | 选择明确的设备和客户端运行位置；打开、诊断、路径、重扫等操作只作用于这里选中的位置 | 选择明确的设备和客户端位置；打开、诊断、路径、重扫等操作只作用于这里选中的位置 |
| | 英 | Choose an exact device and client runtime location; Open, Diagnostics, Path, and Rescan act only on this selection | Choose an exact device and location; Open, Diagnostics, Path, and Rescan act only on this selection |
| | 日 | デバイスとクライアントの実行場所を明示的に選択します。開く、診断、パス、再スキャンはこの選択先だけに作用します | デバイスと場所を明示的に選択します。開く、診断、パス、再スキャンはこの選択先だけに作用します |
| `devices.slot.choose` | `renderer/views/agent-manage.js`、`renderer/views/roster.js` | | |
| | 中 | 选择运行位置… | 选择位置… |
| | 英 | Choose runtime location… | Choose location… |
| | 日 | 実行場所を選択… | 場所を選択… |
| `devices.slot.remoteMeta` | `renderer/views/roster.js` | | |
| | 中 | {device} · {status} · 远端运行位置 | {device} · {status} · 远端位置 |
| | 英 | {device} · {status} · remote runtime location | {device} · {status} · remote location |
| | 日 | {device} · {status} · リモート実行場所 | {device} · {status} · リモート場所 |

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
| | 日 | このローカル場所はどの Agent のものですか？ | このローカル場所はどのアカウントのものですか？ |
| `catalog.assignment.newAgent` | `index.html` | | |
| | 中 | 新的 Agent | 新的账号 |
| | 英 | New Agent | New account |
| | 日 | 新しい Agent | 新しいアカウント |
| `catalog.assignment.existingAgent` | `index.html` | | |
| | 中 | 已有 Agent 的另一个账号 | 已有账号的另一个账号 |
| | 英 | Another account for an Agent | Another account for an account |
| | 日 | 既存 Agent の別アカウント | 既存アカウントの別アカウント |
| `catalog.assignment.hintNew` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 同时创建一个全局 Agent、一个平台登录和这个本机运行位置。 | 同时创建一个账号、一个平台登录和这个本机位置。 |
| | 英 | Create a global Agent, a platform login, and this local runtime location together. | Create an account, a platform login, and this local location together. |
| | 日 | グローバル Agent、プラットフォームのログイン、このローカル実行場所を同時に作成します。 | アカウント、プラットフォームのログイン、このローカル場所を同時に作成します。 |
| `catalog.assignment.hintExistingAgent` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 为已有 Agent 增加一个新的平台登录，再把这个位置关联到它。 | 为已有账号增加一个新的平台登录，再把这个位置关联到它。 |
| | 英 | Add a new platform login to an existing Agent, then associate this location with it. | Add a new platform login to an existing account, then associate this location with it. |
| | 日 | 既存 Agent に新しいプラットフォームログインを追加し、この場所を関連付けます。 | 既存アカウントに新しいプラットフォームログインを追加し、この場所を関連付けます。 |
| `catalog.assignment.noAgent` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 目录中还没有可选的 Agent。 | 目录中还没有可选的账号。 |
| | 英 | There are no existing Agents to select. | There are no existing accounts to select. |
| | 日 | 選択できる既存 Agent がありません。 | 選択できる既存アカウントがありません。 |
| `catalog.assignment.noCompatibleBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 当前应用没有同平台的已有登录；请改用“新的 Agent”或“已有 Agent 的另一个账号”。 | 当前应用没有同平台的已有登录；请改用“新的账号”或“已有账号的另一个账号”。 |
| | 英 | This app has no existing login for the same provider. Choose “New Agent” or “Another account for an Agent”. | This app has no existing login for the same provider. Choose “New account” or “Another account for an account”. |
| | 日 | このアプリと同じプロバイダーの既存ログインがありません。「新しい Agent」または「既存 Agent の別アカウント」を選んでください。 | このアプリと同じプロバイダーの既存ログインがありません。「新しいアカウント」または「既存アカウントの別アカウント」を選んでください。 |
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
| | 英 | Delete the Agent, its account bindings, and every runtime-location relationship. | Delete the account, its sign-ins, and every runtime-location relationship. |
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
| | 中 | 将移除“{device} / {app}”这 1 个运行位置的目录关系。 | 将移除“{device} / {app}”这 1 个位置的目录关系。 |
| | 英 | The catalog relationship for the single “{device} / {app}” runtime location will be removed. | The catalog relationship for the single “{device} / {app}” location will be removed. |
| | 日 | 「{device} / {app}」の 1 つの実行場所のカタログ関係を削除します。 | 「{device} / {app}」の 1 つの場所のカタログ関係を削除します。 |
| `catalog.remove.impactBinding` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将移除“{binding}”，影响 {devices} 台设备、{slots} 个运行位置和 {sessions} 条会话索引。 | 将移除“{binding}”，影响 {devices} 台设备、{slots} 个位置和 {sessions} 条会话索引。 |
| | 英 | “{binding}” will be removed, affecting {devices} devices, {slots} runtime locations, and {sessions} indexed sessions. | “{binding}” will be removed, affecting {devices} devices, {locations} locations, and {sessions} indexed sessions. |
| | 日 | 「{binding}」を削除し、{devices} 台のデバイス、{slots} 件の実行場所、{sessions} 件のセッション索引に影響します。 | 「{binding}」を削除し、{devices} 台のデバイス、{slots} 件の場所、{sessions} 件のセッション索引に影響します。 |
| `catalog.remove.impactAgent` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将删除“{name}”，影响 {bindings} 个登录账号、{devices} 台设备、{slots} 个运行位置和 {sessions} 条会话索引。 | 将删除“{name}”，影响 {bindings} 个登录、{devices} 台设备、{slots} 个位置和 {sessions} 条会话索引。 |
| | 英 | “{name}” will be deleted, affecting {bindings} login accounts, {devices} devices, {slots} runtime locations, and {sessions} indexed sessions. | “{name}” will be deleted, affecting {bindings} sign-ins, {devices} devices, {locations} locations, and {sessions} indexed sessions. |
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
| | 中 | “{name}”当前有 {bindings} 个登录账号、{slots} 个运行位置。合并和拆分只修改 AgentDesk 目录关系。 | “{name}”当前有 {bindings} 个登录、{slots} 个位置。合并和拆分只修改 AgentDesk 目录关系。 |
| | 英 | “{name}” currently has {bindings} login accounts and {slots} runtime locations. Merge and split only change AgentDesk catalog relationships. | “{name}” currently has {bindings} sign-ins and {locations} locations. Merge and split only change AgentDesk catalog relationships. |
| | 日 | 「{name}」には現在 {bindings} 件のログインアカウントと {slots} 件の実行場所があります。統合と分割は AgentDesk のカタログ関係のみを変更します。 | 「{name}」には現在 {bindings} 件のログインと {slots} 件の場所があります。統合と分割は AgentDesk のカタログ関係のみを変更します。 |
| `catalog.merge.title` | `index.html` | | |
| | 中 | 合并 Agent | 合并账号 |
| | 英 | Merge Agents | Merge accounts |
| | 日 | Agent を統合 | アカウントを統合 |
| `catalog.merge.hint` | `index.html` | | |
| | 中 | 当前 Agent 作为来源；目标 Agent 的名称和猫咪外观保留。只改变 AgentDesk 目录关系。 | 当前账号作为来源；目标账号的名称和猫咪外观保留。只改变 AgentDesk 目录关系。 |
| | 英 | The current Agent is the source. The target Agent keeps its name and cat appearance. Only AgentDesk catalog relationships change. | The current account is the source. The target account keeps its name and cat appearance. Only AgentDesk catalog relationships change. |
| | 日 | 現在の Agent が統合元です。統合先 Agent の名前と猫の外観は保持されます。AgentDesk のカタログ関係だけが変わります。 | 現在のアカウントが統合元です。統合先アカウントの名前と猫の外観は保持されます。AgentDesk のカタログ関係だけが変わります。 |
| `catalog.merge.prompt` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 把“{source}”的 {bindings} 个登录账号和 {slots} 个运行位置合并到“{target}”？目标 Agent 的全局元数据将保留。 | 把“{source}”的 {bindings} 个登录和 {slots} 个位置合并到“{target}”？目标账号的全局元数据将保留。 |
| | 英 | Merge {bindings} login accounts and {slots} runtime locations from “{source}” into “{target}”? The target Agent’s global metadata will be kept. | Merge {bindings} sign-ins and {locations} locations from “{source}” into “{target}”? The target account’s global metadata will be kept. |
| | 日 | 「{source}」の {bindings} 件のログインと {slots} 件の実行場所を「{target}」に統合しますか？統合先 Agent のグローバルメタデータは保持されます。 | 「{source}」の {bindings} 件のログインと {slots} 件の場所を「{target}」に統合しますか？統合先アカウントのグローバルメタデータは保持されます。 |
| `catalog.split.title` | `index.html` | | |
| | 中 | 拆分登录账号 | 拆分登录 |
| | 英 | Split login account | Split sign-in |
| | 日 | ログインアカウントを分割 | ログインを分割 |
| `catalog.split.hint` | `index.html` | | |
| | 中 | 把选定的平台登录和它的全部运行位置移到一个新 Agent。 | 把选定的平台登录和它的全部位置移到一个新账号。 |
| | 英 | Move the selected platform login and all its runtime locations into a new Agent. | Move the selected platform login and all its locations into a new account. |
| | 日 | 選択したプラットフォームログインとすべての実行場所を新しい Agent に移します。 | 選択したプラットフォームログインとすべての場所を新しいアカウントに移します。 |
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
| | 英 | Split “{binding}” and its {slots} runtime locations into the new Agent “{name}”? | Split “{binding}” and its {locations} locations into the new account “{name}”? |
| | 日 | 「{binding}」とその {slots} 件の実行場所を新しい Agent「{name}」に分割しますか？ | 「{binding}」とその {slots} 件の場所を新しいアカウント「{name}」に分割しますか？ |
| `catalog.assign.title` | `index.html` | | |
| | 中 | 归属待处理运行位置 | 归属待处理位置 |
| | 英 | Assign runtime location | Assign location |
| | 日 | 実行場所を割り当て | 場所を割り当て |
| `catalog.assign.summary` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 将“{device} / {app} / {label}”重新归属到全局 Agent 目录。当前状态：{state}。 | 将“{device} / {app} / {label}”重新归属到账号目录。当前状态：{state}。 |
| | 英 | Reassign “{device} / {app} / {label}” to the global Agent catalog. Current state: {state}. | Reassign “{device} / {app} / {label}” to the account catalog. Current state: {state}. |
| | 日 | 「{device} / {app} / {label}」をグローバル Agent カタログに再割り当てします。現在の状態: {state}。 | 「{device} / {app} / {label}」をアカウントカタログに再割り当てします。現在の状態: {state}。 |
| `catalog.status.created` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已创建运行位置并完成明确归属。 | 已创建位置并完成明确归属。 |
| | 英 | The runtime location was created with an explicit assignment. | The location was created with an explicit assignment. |
| | 日 | 明示的な割り当てで実行場所を作成しました。 | 明示的な割り当てで場所を作成しました。 |
| `catalog.status.saved` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已保存全局 Agent 元数据。 | 已保存账号 元数据。 |
| | 英 | Global Agent metadata was saved. | Account metadata was saved. |
| | 日 | グローバル Agent のメタデータを保存しました。 | アカウントのメタデータを保存しました。 |
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
| | 中 | Agent 目录操作失败：{code} | 账号目录操作失败：{code} |
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
| | 英 | The target runtime already contains the same conversation ID with different content. Import stopped to avoid overwriting it. | （不变） |
| | 日 | 対象の実行場所には同じ会話 ID で異なる内容があります。上書きを避けるため取り込みを停止しました。 | 対象の場所には同じ会話 ID で異なる内容があります。上書きを避けるため取り込みを停止しました。 |
| `taskPackage.error.target` | `renderer/views/task-packages.js` | | |
| | 中 | 所选 Agent 运行位置不支持这个任务包的原生会话格式。 | 所选账号位置不支持这个任务包的原生会话格式。 |
| | 英 | The selected Agent runtime does not support this package’s native conversation format. | The selected account runtime does not support this package’s native conversation format. |
| | 日 | 選択した Agent の実行場所は、このパッケージのネイティブ会話形式に対応していません。 | 選択したアカウントの場所は、このパッケージのネイティブ会話形式に対応していません。 |

### 猫的档案与管理

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `account.addAgent` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 新增 Agent | 新增账号 |
| | 英 | Add Agent | Add account |
| | 日 | Agent を追加 | アカウントを追加 |
| `account.addAgentHint` | `renderer/views/roster.js` | | |
| | 中 | 先新增一名全局员工；第一次打开时再自动准备当前工作环境。 | 先新增一个全局账号；第一次打开时再自动准备当前工作环境。 |
| | 英 | Add a global employee first; the current work environment is prepared on first open. | Add a global account first; the current work environment is prepared on first open. |
| | 日 | まずグローバル従業員を追加し、現在の作業環境は初回起動時に準備します。 | まずアカウントを追加し、現在の作業環境は初回起動時に準備します。 |
| `account.createFirstAgent` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 创建第一个 Agent | 创建第一个账号 |
| | 英 | Create first Agent | Create first account |
| | 日 | 最初の Agent を作成 | 最初のアカウントを作成 |
| `account.createFirstAgentHint` | `renderer/views/roster.js` | | |
| | 中 | 从名称和受支持客户端开始；手动槽位与路径留在高级管理。 | 从名称和受支持客户端开始；手动位置与路径留在高级管理。 |
| | 英 | Start with a name and supported client; manual slots and paths remain in advanced management. | Start with a name and supported client; manual locations and paths remain in advanced management. |
| | 日 | 名前と対応クライアントから始めます。手動スロットとパスは詳細管理に残ります。 | 名前と対応クライアントから始めます。手動場所とパスは詳細管理に残ります。 |
| `account.addRuntimeAdvanced` | `index.html` | | |
| | 中 | 导入运行位置 | 导入位置 |
| | 英 | Import runtime | （不变） |
| | 日 | 実行場所を取り込む | 場所を取り込む |
| `account.addRuntimeAdvancedHint` | `index.html` | | |
| | 中 | 仅用于登记已有登录或修复位置关系 | （不变） |
| | 英 | Only for registering an existing login or repairing a runtime relationship | （不变） |
| | 日 | 既存ログインの登録または実行場所の関係修復にのみ使用 | 既存ログインの登録または場所の関係修復にのみ使用 |
| `account.relationsHint` | `index.html` | | |
| | 中 | 合并 Agent 或拆分登录账号 | 合并账号或拆分登录 |
| | 英 | Merge Agents or split a login binding | Merge accounts or split a sign-in |
| | 日 | Agent の統合またはログイン紐付けの分割 | アカウントの統合またはログインの分割 |
| `account.removeHint` | `index.html` | | |
| | 中 | 先预览运行位置、登录账号或整个 Agent 的影响 | 先预览位置、登录或整个账号的影响 |
| | 英 | Preview the impact on a runtime, login, or the entire Agent | Preview the impact on a runtime, login, or the entire account |
| | 日 | 実行場所、ログイン、Agent 全体への影響を先に確認 | 場所、ログイン、アカウント全体への影響を先に確認 |
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
| | 日 | このコンピューターからリモートデバイスのローカル実行場所は作成できません。「すべてのデバイス」またはこのデバイスに切り替えてください。 | このコンピューターからリモートデバイスのローカル場所は作成できません。「すべてのデバイス」またはこのデバイスに切り替えてください。 |
| `account.noneAgent` | `renderer/views/agent-manage.js`、`renderer/views/context.js` | | |
| | 中 | 未选择 Agent | 未选择账号 |
| | 英 | No Agent selected | No account selected |
| | 日 | Agent 未選択 | アカウント未選択 |

### 首次准备

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `deployment.action.chooseClient` | `renderer/views/roster.js` | | |
| | 中 | 先在运行位置中选择客户端。 | 先在位置中选择客户端。 |
| | 英 | Choose a client in the runtime selector first. | （不变） |
| | 日 | 先に実行場所でクライアントを選択してください。 | 先に場所でクライアントを選択してください。 |

### 会话区

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `session.empty.none` | `renderer/views/sessions.js` | | |
| | 中 | 这只猫还没有会话。点卡片上的「打开」登录官方客户端，用过之后会话会自动出现在这里；读不到时到「档案」里做诊断。 | （不变） |
| | 英 | This Agent has no sessions yet. Click “Open” on its card to sign in to the official app; once you have used it, sessions show up here automatically. If nothing loads, run diagnostics from its “Dossier”. | This account has no sessions yet. Click “Open” on its card to sign in to the official app; once you have used it, sessions show up here automatically. If nothing loads, run diagnostics from its “Dossier”. |
| | 日 | この Agent にはまだセッションがありません。カードの「開く」で公式アプリにログインし、利用するとここに自動で表示されます。読み込めない場合は「カルテ」から診断を。 | このアカウントにはまだセッションがありません。カードの「開く」で公式アプリにログインし、利用するとここに自動で表示されます。読み込めない場合は「カルテ」から診断を。 |

### 页脚的状态句

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `status.nameFirst` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 先给账号槽位起一个名字。 | 先给位置起一个名字。 |
| | 英 | Give the account slot a name first. | Give the location a name first. |
| | 日 | まずアカウント枠に名前を付けてください。 | （不变） |
| `status.removedSlot` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 已移除账号槽位。 | 已移除位置。 |
| | 英 | Account slot removed. | Location removed. |
| | 日 | アカウント枠を削除しました。 | （不变） |
| `status.provisioning.chooseClient` | `renderer/views/context.js` | | |
| | 中 | 先选择这名员工要使用的客户端。 | 先选择这个账号要使用的客户端。 |
| | 英 | Choose the client this employee should use first. | Choose the client this account should use first. |
| | 日 | この従業員が使うクライアントを先に選択してください。 | このアカウントが使うクライアントを先に選択してください。 |
| `status.agentNameFirst` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 先给这名员工起一个名字。 | 先给这个账号起一个名字。 |
| | 英 | Name this employee first. | Name this account first. |
| | 日 | 先にこの従業員へ名前を付けてください。 | 先にこのアカウントへ名前を付けてください。 |

### 开灯关灯

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `lamp.wait.devices` | `pixel/boot.js` | | |
| | 中 | 正在读取设备和 Agent 目录… | 正在读取设备和 账号目录… |
| | 英 | Reading devices and the Agent directory… | Reading devices and the account directory… |
| | 日 | デバイスと Agent 一覧を読み込んでいます… | デバイスとアカウント一覧を読み込んでいます… |

### 弹窗

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `dialog.field.agentName` | `index.html` | | |
| | 中 | 员工名称 | 账号名称 |
| | 英 | Employee name | Account name |
| | 日 | 従業員名 | アカウント名 |
| `dialog.addAgent.title` | `index.html` | | |
| | 中 | 新增 Agent | 新增账号 |
| | 英 | Add Agent | Add account |
| | 日 | Agent を追加 | アカウントを追加 |
| `dialog.addAgent.lead` | `index.html` | | |
| | 中 | 在本机为这个 Agent 新建独立账号环境，登录在官方客户端完成。已有公司接口环境可从“管理 Agent → 导入运行位置”登记。 | 在本机为这个账号新建独立账号环境，登录在官方客户端完成。已有公司接口环境可从“管理 账号 → 导入位置”登记。 |
| | 英 | Create a separate account environment on this device and sign in with the official client. Register an existing company API environment under Manage Agent → Import runtime location. | Create a separate account environment on this device and sign in with the official client. Register an existing company API environment under Manage account → Import location. |
| | 日 | このデバイスに独立したアカウント環境を作成し、公式クライアントでログインします。既存の社内 API 環境は「Agent 管理 → 実行場所をインポート」から登録できます。 | このデバイスに独立したアカウント環境を作成し、公式クライアントでログインします。既存の社内 API 環境は「アカウント管理 → 場所をインポート」から登録できます。 |
| `dialog.ph.agentNote` | `index.html` | | |
| | 中 | 可选，记录这名员工负责什么 | 可选，记录这个账号负责什么 |
| | 英 | Optional: note what this employee is responsible for | Optional: note what this account is responsible for |
| | 日 | 任意：この従業員の担当を記録 | 任意：このアカウントの担当を記録 |
| `dialog.addProfile.title` | `index.html`、`renderer/views/catalog-dialogs.js` | | |
| | 中 | 新增账号槽位 | 新增位置 |
| | 英 | Add account slot | Add location |
| | 日 | アカウント枠を追加 | （不变） |
| `dialog.addProfile.slotTitle` | `renderer/views/catalog-dialogs.js` | | |
| | 中 | 新增本机运行位置 | 新增本机位置 |
| | 英 | Add local runtime location | Add local location |
| | 日 | ローカル実行場所を追加 | ローカル場所を追加 |
| `dialog.editProfile.title` | `index.html`、`renderer/views/catalog-dialogs.js` | | |
| | 中 | 编辑账号槽位 | 编辑位置 |
| | 英 | Edit account slot | Edit location |
| | 日 | アカウント枠を編集 | （不变） |
| `dialog.hint.identity` | `index.html` | | |
| | 中 | 同一个登录身份的多个客户端槽位填同一个词（如 Kimi Code 与 Kimi Work 同填「Kimi」），列表会用 ⛓ 标出关联。 | 同一个登录身份的多个位置填同一个词（如 Kimi Code 与 Kimi Work 同填「Kimi」），列表会用 ⛓ 标出关联。 |
| | 英 | Give the same word to several client slots of one login (e.g. put "Kimi" on both Kimi Code and Kimi Work); the list marks the link with ⛓. | Give the same word to several client locations of one login (e.g. put "Kimi" on both Kimi Code and Kimi Work); the list marks the link with ⛓. |
| | 日 | 同一ログインの複数クライアント枠に同じ語を入れます（例：Kimi Code と Kimi Work に「Kimi」）。一覧では ⛓ で関連を示します。 | （不变） |

### 收件箱

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `attention.catalog.title` | `renderer/views/inbox.js` | | |
| | 中 | 运行位置待归属：{name} | 位置待归属：{name} |
| | 英 | Runtime location needs assignment: {name} | Location needs assignment: {name} |
| | 日 | 実行場所の割り当てが必要: {name} | 場所の割り当てが必要: {name} |
| `attention.catalog.detail` | `renderer/views/inbox.js` | | |
| | 中 | {device} · {state}；需要明确选择已有登录、已有 Agent 的新账号或新 Agent。 | {device} · {state}；需要明确选择已有登录、已有账号的新账号或新账号。 |
| | 英 | {device} · {state}; explicitly choose an existing login, another account for an Agent, or a new Agent. | {device} · {state}; explicitly choose an existing login, another account for an account, or a new account. |
| | 日 | {device} · {state}。既存ログイン、既存 Agent の別アカウント、または新しい Agent を明示的に選んでください。 | {device} · {state}。既存ログイン、既存アカウントの別アカウント、または新しいアカウントを明示的に選んでください。 |

### 首次使用

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `welcome.lead` | `index.html`、`renderer/views/first-use.js` | | |
| | 中 | 把长期工作的 Agent 放进一份目录，再选择它此刻在哪个设备和客户端工作。登录始终发生在官方客户端。 | 把长期工作的账号放进一份目录，再选择它此刻在哪个设备和客户端工作。登录始终发生在官方客户端。 |
| | 英 | Keep long-lived Agents in one catalog, then choose the device and client where each one works now. Sign-in always stays in the official client. | Keep long-lived accounts in one catalog, then choose the device and client where each one works now. Sign-in always stays in the official client. |
| | 日 | 長く働く Agent を一つのカタログに置き、今どのデバイスとクライアントで働くかを選びます。ログインは常に公式クライアント内で行います。 | 長く働くアカウントを一つのカタログに置き、今どのデバイスとクライアントで働くかを選びます。ログインは常に公式クライアント内で行います。 |
| `welcome.step1` | `index.html` | | |
| | 中 | <b>Agent</b> 是长期工作对象，可以在不同设备和客户端上拥有运行位置。 | <b>账号</b> 是长期工作对象，可以在不同设备和客户端上拥有位置。 |
| | 英 | An <b>Agent</b> is a long-lived work identity that can have runtime locations on different devices and clients. | An <b>account</b> is a long-lived work identity that can have locations on different devices and clients. |
| | 日 | <b>Agent</b> は長期的な作業対象で、異なるデバイスやクライアントに実行場所を持てます。 | <b>アカウント</b> は長期的な作業対象で、異なるデバイスやクライアントに場所を持てます。 |
| `welcome.tip` | `index.html` | | |
| | 中 | 日常只需管理 Agent 和运行位置。手动账号槽位、路径与诊断保留在<b>高级管理</b>中。 | 日常只需管理账号和位置。手动位置、路径与诊断保留在<b>高级管理</b>中。 |
| | 英 | Daily work only needs Agents and runtime locations. Manual account slots, paths and diagnostics remain in <b>advanced management</b>. | Daily work only needs accounts and locations. Manual locations, paths and diagnostics remain in <b>advanced management</b>. |
| | 日 | 日常は Agent と実行場所だけを管理します。手動アカウントスロット、パス、診断は<b>詳細管理</b>に残ります。 | 日常はアカウントと場所だけを管理します。手動場所、パス、診断は<b>詳細管理</b>に残ります。 |
| `onboarding.lead` | `renderer/views/first-use.js` | | |
| | 中 | 先建立一名长期 Agent，再为它准备本机客户端。整个过程不接管官方登录。 | 先建立一名长期账号，再为它准备本机客户端。整个过程不接管官方登录。 |
| | 英 | Create one long-lived Agent, then prepare its local client. AgentDesk never takes over the official sign-in flow. | Create one long-lived account, then prepare its local client. AgentDesk never takes over the official sign-in flow. |
| | 日 | 長く働く Agent を一人作成し、そのローカルクライアントを準備します。公式ログインを AgentDesk が代行することはありません。 | 長く働くアカウントを一人作成し、そのローカルクライアントを準備します。公式ログインを AgentDesk が代行することはありません。 |
| `onboarding.progress.agent` | `index.html` | | |
| | 中 | 创建 Agent | 创建账号 |
| | 英 | Create Agent | Create account |
| | 日 | Agent 作成 | アカウント作成 |
| `onboarding.agent.title` | `index.html` | | |
| | 中 | 创建第一个 Agent | 创建第一个账号 |
| | 英 | Create your first Agent | Create your first account |
| | 日 | 最初の Agent を作成 | 最初のアカウントを作成 |
| `onboarding.agent.lead` | `index.html` | | |
| | 中 | 先确定它是谁、使用哪个受支持客户端。AgentDesk 随后为本机准备运行位置。 | 先确定它是谁、使用哪个受支持客户端。AgentDesk 随后为本机准备位置。 |
| | 英 | Define who it is and which supported client it uses. AgentDesk then prepares a local runtime location. | Define who it is and which supported client it uses. AgentDesk then prepares a local location. |
| | 日 | 誰なのか、どの対応クライアントを使うかを先に決めます。その後 AgentDesk がローカル実行場所を準備します。 | 誰なのか、どの対応クライアントを使うかを先に決めます。その後 AgentDesk がローカル場所を準備します。 |
| `onboarding.agent.name` | `index.html` | | |
| | 中 | Agent 名称 | 账号名称 |
| | 英 | Agent name | Account name |
| | 日 | Agent 名 | アカウント名 |
| `onboarding.agent.localOnly` | `index.html` | | |
| | 中 | 确认后只建立本机 Agent 目录和设备身份；不会开放端口、发布在线租约、连接其他设备或授予远端权限。 | 确认后只建立本机 账号目录和设备身份；不会开放端口、发布在线租约、连接其他设备或授予远端权限。 |
| | 英 | Confirmation creates only the local Agent catalog and device identity. It opens no port, publishes no online lease, connects to no other device, and grants no remote permission. | Confirmation creates only the local Account catalog and device identity. It opens no port, publishes no online lease, connects to no other device, and grants no remote permission. |
| | 日 | 確認後に作るのはローカルの Agent カタログとデバイス ID だけです。ポートを開かず、オンラインリースを公開せず、他のデバイスへ接続せず、リモート権限も付与しません。 | 確認後に作るのはローカルのアカウントカタログとデバイス ID だけです。ポートを開かず、オンラインリースを公開せず、他のデバイスへ接続せず、リモート権限も付与しません。 |
| `onboarding.prepare.title` | `index.html` | | |
| | 中 | 准备本机运行位置 | 准备本机位置 |
| | 英 | Prepare the local runtime | （不变） |
| | 日 | ローカル実行場所を準備 | ローカル場所を準備 |
| `onboarding.prepare.state.preparing` | `renderer/views/first-use.js` | | |
| | 中 | 正在准备本机运行位置 | 正在准备本机位置 |
| | 英 | Preparing the local runtime | （不变） |
| | 日 | ローカル実行場所を準備中 | ローカル場所を準備中 |
| `onboarding.prepare.state.ready` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 本机运行位置已就绪 | 本机位置已就绪 |
| | 英 | The local runtime is ready | （不变） |
| | 日 | ローカル実行場所の準備完了 | ローカル場所の準備完了 |
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
| | 英 | You can register a runtime manually later from advanced management. | （不变） |
| | 日 | 後から詳細管理で実行場所を手動登録できます。 | 後から詳細管理で場所を手動登録できます。 |
| `onboarding.existing.lead` | `index.html` | | |
| | 中 | 这次更新把 Agent 作为长期工作对象；设备是工作环境，客户端槽位只是它在某处的运行位置。 | 这次更新把账号作为长期工作对象；设备是工作环境，位置只是它在某处的位置。 |
| | 英 | This update treats an Agent as a long-lived work identity. A device is a work environment; a client slot is only one runtime location. | This update treats an account as a long-lived work identity. A device is a work environment; a client location is only one location. |
| | 日 | この更新では Agent を長期的な作業対象として扱います。デバイスは作業環境、クライアントスロットはその一つの実行場所です。 | この更新ではアカウントを長期的な作業対象として扱います。デバイスは作業環境、クライアント場所はその一つの場所です。 |
| `onboarding.complete.lead` | `index.html` | | |
| | 中 | 主工作台仍按 Agent、会话和详情组织。第一次打开未准备的 Agent 时，可从同一位置继续安装或登录。 | 主工作台仍按账号、会话和详情组织。第一次打开未准备的账号时，可从同一位置继续安装或登录。 |
| | 英 | The main workspace still revolves around Agents, sessions and details. The first time you open an unprepared Agent, continue installation or sign-in from the same place. | The main workspace still revolves around accounts, sessions and details. The first time you open an unprepared account, continue installation or sign-in from the same place. |
| | 日 | メイン作業台はこれまでどおり Agent、セッション、詳細で構成されます。未準備の Agent を初めて開くときは、同じ場所からインストールやログインを続けられます。 | メイン作業台はこれまでどおりアカウント、セッション、詳細で構成されます。未準備のアカウントを初めて開くときは、同じ場所からインストールやログインを続けられます。 |
| `onboarding.advanced` | `index.html` | | |
| | 中 | 高级：手动导入运行位置 | 高级：手动导入位置 |
| | 英 | Advanced: import a runtime manually | （不变） |
| | 日 | 詳細：実行場所を手動で取り込む | 詳細：場所を手動で取り込む |
| `onboarding.error.nameRequired` | `renderer/views/first-use.js` | | |
| | 中 | 先填写 Agent 名称。 | 先填写账号名称。 |
| | 英 | Enter an Agent name first. | Enter an account name first. |
| | 日 | 先に Agent 名を入力してください。 | 先にアカウント名を入力してください。 |

### 添加设备

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `deviceJourney.fact.catalog` | 代码里按前缀拼出（动态 key） | | |
| | 中 | Agent 目录 | 账号目录 |
| | 英 | Agent catalog | Account catalog |
| | 日 | Agent カタログ | アカウントカタログ |
| `deviceJourney.fact.catalog.complete` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 全局 Agent 目录已验证落库 | 账号目录已验证落库 |
| | 英 | The global Agent catalog was verified and stored | The account catalog was verified and stored |
| | 日 | グローバル Agent カタログを検証して保存済み | アカウントカタログを検証して保存済み |
| `deviceJourney.fact.inventory.complete` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 首份 Slot 与会话库存已落库 | （不变） |
| | 英 | The first Slot and session inventory is stored | The first Location and session inventory is stored |
| | 日 | 最初の Slot とセッションのインベントリを保存済み | （不变） |
| `deviceJourney.phase.catalog` | 代码里按前缀拼出（动态 key） | | |
| | 中 | 连接已建立；正在确认全局 Agent 目录已经落库。 | 连接已建立；正在确认账号目录已经落库。 |
| | 英 | Connected; confirming that the global Agent catalog has landed. | Connected; confirming that the account catalog has landed. |
| | 日 | 接続済みです。グローバル Agent カタログの保存を確認しています。 | 接続済みです。アカウントカタログの保存を確認しています。 |
| `deviceJourney.complete.lead` | `renderer/views/device-journey.js` | | |
| | 中 | {name} 已成为一个可选择的工作环境；Agent 库不会因此复制。 | {name} 已成为一个可选择的工作环境；账号库不会因此复制。 |
| | 英 | {name} is now a selectable work environment. The Agent library was not duplicated. | {name} is now a selectable work environment. The account library was not duplicated. |
| | 日 | {name} を作業環境として選べます。Agent ライブラリは複製されません。 | {name} を作業環境として選べます。アカウントライブラリは複製されません。 |

### 读屏文字

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `aria.roster` | `index.html` | | |
| | 中 | Agent 卡片 | 账号卡片 |
| | 英 | Agent cards | Account cards |
| | 日 | Agent カード | アカウントカード |

### 调度中枢

| key | 出现在 / 语言 | 改前 | 改后（建议） |
|---|---|---|---|
| `hub.from.unknown` | `renderer/hub.js`、`renderer/views/hub.js` | | |
| | 中 | 未注明的 Agent | 未注明的账号 |
| | 英 | an unnamed Agent | an unnamed account |
| | 日 | 名前のない Agent | 名前のないアカウント |
| `hub.say.startedOutside` | `renderer/views/hub.js` | | |
| | 中 | 台面外的 {label} 叫了 {to}。 | （不变） |
| | 英 | An Agent off the desk, {label}, called {to}. | An account off the desk, {label}, called {to}. |
| | 日 | 机の外の {label} が {to} を呼びました。 | （不变） |
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
| | 日 | アカウント枠が見つかりません | （不变） |
| `main.err.slotNotFoundDot` | `main/profile-launch.js`、`main/session-files.js` | | |
| | 中 | 找不到账号槽位。 | 找不到位置。 |
| | 英 | Account slot not found. | Location not found. |
| | 日 | アカウント枠が見つかりません。 | （不变） |
| `main.launch.cliRuns` | `main/profile-launch.js` | | |
| | 中 | {label} 会在独立终端里打开；这个槽位使用自己的配置根，不继承本机默认账号或代理。 | {label} 会在独立终端里打开；这个位置使用自己的配置根，不继承本机默认账号或代理。 |
| | 英 | {label} opens in an isolated terminal. This slot uses its own config root and does not inherit the official default account or proxy. | {label} opens in an isolated terminal. This location uses its own config root and does not inherit the official default account or proxy. |
| | 日 | {label} は独立したターミナルで開きます。この枠は独自の設定ルートを使い、公式の既定アカウントやプロキシは引き継ぎません。 | （不变） |
| `main.agentPrepare.title` | `main/mesh-wiring.js` | | |
| | 中 | 首次准备 Agent | 首次准备账号 |
| | 英 | Prepare Agent for the first time | Prepare account for the first time |
| | 日 | Agent の初回準備 | アカウントの初回準備 |
| `main.warn.sessionRootMissing` | `main/profile-launch.js` | | |
| | 中 | 会话根目录不存在，当前槽位暂时不会读到会话。 | 会话根目录不存在，当前位置暂时不会读到会话。 |
| | 英 | The session root does not exist; this slot will not read sessions for now. | The session root does not exist; this location will not read sessions for now. |
| | 日 | セッションルートが存在しません。この枠は当面セッションを読み込みません。 | （不变） |
| `main.warn.appDataProfile` | `main/profile-launch.js` | | |
| | 中 | 这个账号槽位位于 AppData。Store/MSIX 会把它重定向到包私有目录，Explorer 和 AgentDesk 可能看到不同位置；建议执行路径迁移。 | 这个位置位于 AppData。Store/MSIX 会把它重定向到包私有目录，Explorer 和 AgentDesk 可能看到不同位置；建议执行路径迁移。 |
| | 英 | This account slot lives in AppData. Store/MSIX redirects it to a package-private directory, so Explorer and AgentDesk may see different locations; a path migration is recommended. | This location lives in AppData. Store/MSIX redirects it to a package-private directory, so Explorer and AgentDesk may see different locations; a path migration is recommended. |
| | 日 | このアカウント枠は AppData にあります。Store/MSIX はこれをパッケージ専用ディレクトリにリダイレクトするため、Explorer と AgentDesk で場所が異なる可能性があります。パス移行を推奨します。 | （不变） |
| `main.warn.profileIsolationUnsupported` | `main/profile-launch.js` | | |
| | 中 | {label} 当前只支持官方默认数据目录，不能安全创建多个隔离 Profile。 | {label} 当前只支持官方默认数据目录，不能安全创建多个隔离位置。 |
| | 英 | {label} currently supports only its official default data directory, so multiple isolated Profiles cannot be created safely. | （不变） |
| | 日 | {label} は現在、公式の既定データディレクトリだけに対応しており、複数の隔離 Profile を安全に作成できません。 | （不变） |
| `main.mig.autoDefault` | `main/profile-launch.js` | | |
| | 中 | 自动默认槽位会跟随系统目录，不需要迁移。 | 自动默认位置会跟随系统目录，不需要迁移。 |
| | 英 | The auto-default slot follows the system directory and needs no migration. | The auto-default location follows the system directory and needs no migration. |
| | 日 | 自動既定枠はシステムディレクトリに追従するため、移行は不要です。 | （不变） |
| `main.mig.slotRemovedDuring` | `main/profile-launch.js` | | |
| | 中 | 迁移完成前账号槽位已被移除；复制的数据仍保留在目标目录。 | 迁移完成前位置已被移除；复制的数据仍保留在目标目录。 |
| | 英 | The account slot was removed before migration completed; the copied data still remains in the target directory. | The location was removed before migration completed; the copied data still remains in the target directory. |
| | 日 | 移行完了前にアカウント枠が削除されました。コピーしたデータはターゲットディレクトリに残っています。 | （不变） |

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
| | 英 | Fresh quota sources for this login disagree. Refresh, then review the quota details. | （不变） |
| | 日 | 同じログインの新しいクォータ情報が一致しません。更新後、詳細で確認してください。 | （不变） |

## 5. 词表之外的文字

这些文字写死在代码里，不走词表，改用词时要一起处理：

| 位置 | 现在 | 建议 |
|---|---|---|
| `src/main/accounts.js` 新建位置的默认名称 | `<客户端名> 账号`（例如“Codex 账号”） | `<客户端名> 位置`；只影响以后新建的，已存的名称不动。需要所有者定 |
| `src/clients/codex/quota.js` 额度原因 | “Codex 账号尚未登录或尚未返回额度”“当前账号没有返回可展示的订阅额度” | “Codex 尚未登录或尚未返回额度”“这个登录没有返回可展示的订阅额度”；另见第 6 节第 3 条 |
| `src/clients/claude/index.js`、`src/clients/cursor/index.js` 额度不支持的原因 | “……为保护账号……”“Cursor 个人账号暂无公开额度 API……” | 这里的“账号”指平台上的账号，建议保留原意改成“登录”，需要所有者定 |
| `src/yard/cats.js` 猫的状态说明 | “刚打开账号，App 还没起来”等 | 没有找到显示这些说明的地方，可能只是代码里的注释性文字；如果显示，按第 1 节改 |

## 6. 看得见的其他改动

整理中发现、但因为会改变外观而没有动的：

1. **额度提示的字号是 11.5px，规定是 12px。** 旧样式的 `.quota-message` 用 `!important` 写了 11.5px，它在层叠的第一层，压过皮肤统一字号的 `!important`（见 `test/style-structure.test.js` 的清单）。改成 12px 会让额度提示那一行的字变大半个像素；做法是删掉它的 `font-size`。
2. **各弹窗原定的安全边距没有生效。** `workspace.css` 给设备页设了 42px、收件箱 64px、交接任务 48px、子弹窗 64px 的 `--dialog-safe-margin`，但现在没有规则读它：弹窗的最大高度一律是皮肤写死的 `calc(100dvh - 48px)`。窗口高度装不下弹窗时（小视口），设备页会比原设计少 6px、收件箱和子弹窗多 16px。可以让它们生效（看得见的改动），也可以删掉这几行没人读的变量（看不见，但计算样式里的变量值会变）。
3. **额度原因的文字只有中文。** 第 5 节的额度原因写死在客户端适配器里，英文和日文界面也显示中文。修法是给它们各配一个词表 key，三种语言一起译。
4. **几处从没生效过的旧字体写法。** 旧样式给配对码输入框写了等宽 11px、行高 1.4，给几处按钮写了 11–12px 的字号，它们一直被 reset 层给表单控件的 `font: inherit` 和皮肤的统一字号压过，界面上从没出现过。删掉不改变外观；让它们生效会改变外观。建议删掉（不算看得见的改动，列在这里是为了完整）。
