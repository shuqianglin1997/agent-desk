# A. Can an AgentDesk account be exported to another person already logged in?

Read-only research, 2026-11-24. No credential file or keychain item on this machine was opened. "UNVERIFIED" means not confirmed in vendor source or docs.

## Summary table

Verdicts: (a) portable through a mechanism the vendor supports; (b) copying works but is fragile or undocumented; (c) not portable. In the Terms column, ✗ means the provider's terms forbid sharing with another person (Part 4).

| Client (apps.js) | Form | Where the login lives (mac / Win) | Secret | Verdict | Evidence | Terms |
|---|---|---|---|---|---|---|
| Claude desktop `claude` :116 | desktop | `config.json` `oauth:tokenCache`, encrypted by Electron safeStorage. The key is in the Keychain on macOS and in DPAPI on Windows. | OAuth access and refresh tokens | **c** | identity.js:9; the safeStorage detail is UNVERIFIED | ✗ |
| Claude Code `claude-cli` :156 | CLI | macOS: the Keychain, in an entry keyed to `CLAUDE_CONFIG_DIR`. Windows: `.credentials.json` | subscription OAuth (refresh token) | mac **c**, Win **b** | code.claude.com/docs/en/authentication, "Credential management" | ✗ |
| same | CLI | `settings.json` `env.CLAUDE_CODE_OAUTH_TOKEN` (account-credentials.js:561-568) | `setup-token` token, lasts one year, can only make model requests | **a**, but only for one person's own machines | same doc, "Generate a long-lived token" | ✗ between people |
| same | CLI | `settings.json` `env.ANTHROPIC_API_KEY` | Console API key | **a** | same doc, "Authentication precedence" | key is billed to the org; people need their own seats |
| Codex `codex` :286 (desktop and CLI share `CODEX_HOME`) | both | `auth.json` (file store) or the OS keyring, chosen by `cli_auth_credentials_store` | ChatGPT OAuth: id, access and single-use refresh tokens | **b** for file store, **c** for keyring | learn.chatgpt.com/docs/auth; codex-rs/login/src/auth/manager.rs:1870 `refresh_token_reused` | ✗ |
| same | both | `codex login --with-api-key` (account-credentials.js:512-522) | OpenAI API key | **a** | learn.chatgpt.com/docs/auth | org key; people need their own seats |
| Cursor `cursor` :652 | desktop | `User/globalStorage/state.vscdb` (SQLite), plus possibly safeStorage secrets | session access and refresh tokens | **b/c** (UNVERIFIED) | ADD_ACCOUNT_PLAN.md:70 lists "无" (nothing can be dragged in) | own the account only |
| Kimi Code `kimi` :365 | CLI | `credentials/kimi-code.json` plus a `[providers]` section in `config.toml` | OAuth access and refresh tokens | **b** | credential-import.js:182-195; ADD_ACCOUNT_PLAN.md:84 | ✗ |
| same | CLI | `kimi provider catalog add` with an API key in `config.toml` | platform API key | **a** | account-credentials.js:598-616 | Kimi For Coding keys: unapproved uses not allowed |
| Kimi Work `kimi-work` :439 | desktop | Electron userData `kimi-desktop` | UNVERIFIED | **c** (assumed) | ADD_ACCOUNT_PLAN.md:72 lists "无" | ✗ |
| Gemini CLI `gemini-cli` :558 | CLI | the OS keychain (service `gemini-cli-oauth`), or with `GEMINI_FORCE_FILE_STORAGE` the file `gemini-credentials.json`. That file is AES-GCM encrypted with a key from scrypt with `salt = hostname-username` | Google OAuth access and refresh tokens | **c** | gemini-cli packages/core/src/services/fileKeychain.ts:25-26; oauth-credential-storage.ts:16,117 | Google ToS: keep the account secure |
| same | CLI | `.gemini/.env` `GEMINI_API_KEY` (account-credentials.js:466-473) | Gemini API key | **a** | geminicli.com auth docs: "Create a `.gemini/.env` file" | no clause found |
| Qwen Code `qwen-code` :607 | CLI | `oauth_creds.json` or `subscription_credentials.json` | Qwen OAuth (refresh token) | **b** | ADD_ACCOUNT_PLAN.md:76,84; the docs say "OAuth cannot be configured with env vars alone" | Coding Plan: ✗ |
| same | CLI | `.qwen/.env` or `settings.json` `env` / `modelProviders` | provider API key (Model Studio and others) | **a** | qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/ | Coding Plan: ✗ |
| OpenCode `opencode` :502 | CLI | `opencode.db`, legacy `auth.json` (plaintext), `opencode auth export/import` | API keys or OAuth entries for upstream providers | keys **a**; OAuth entries **b** | account-credentials.js:437-451; credential-import.js:130-146 | follows the upstream provider |
| DSH `dsh-cli` :226 | CLI | `.credentials.yaml` `refs.DEEPSEEK_API_KEY`, mode 0600 | API key | **a** | credential-import.js:162-176 | not researched |
| Copilot CLI (not in apps.js; ADD_ACCOUNT_PLAN.md:77,111) | CLI | Keychain or Credential Manager service `copilot-cli`; plaintext `~/.copilot/config.json` as a fallback | `gho_` OAuth token; fine-grained PAT through `COPILOT_GITHUB_TOKEN` | OAuth **c**; PAT **a** for one person only | docs.github.com authenticate-copilot-cli | ✗ |

**Bottom line:** the only things another person can be given as "the same account, already logged in", using a mechanism the vendor supports, are an **API key / provider key** (Claude Console, OpenAI, Gemini, Kimi platform, DeepSeek, Model Studio, and OpenCode key entries). Even then, the providers expect the key to stay inside one organization. Subscription and OAuth logins are at best category (b), and the consumer terms forbid sharing them with another person.

## Part 1: what the repo already has

- **Clients:** src/apps.js defines ten clients at the lines in the table. `claude-cli` drags in `.credentials.json` only on non-macOS systems (apps.js:215).
- **Identity:** src/identity.js reads only an account ID (`lastKnownAccountUuid`, `oauthAccount.accountUuid`, `tokens.account_id`). It publishes only a sha256 prefix (identity.js:31-34, 36-71). Kimi has no ID that can be read (:72).
- **Pasted secrets:** src/account-credentials.js states "AgentDesk never keeps a key, token or password" (:6). Each client has an adapter, and each reports `storedInPlaintext` (for example :451, :473, :522, :568).
- **Drag-in import:** `IMPORTERS` (credential-import.js:129-216) covers opencode, gemini-cli, dsh-cli, kimi and claude-cli (the latter on Linux and Windows only). The header warns: "Copying a sign-in moves it: most refresh tokens are single use" (:6). Codex has its own importer: codex-account-import.js:61-124 checks that `id_token`, `access_token` and `refresh_token` are present (:101) and writes them with `wx`, 0600 (:124).
- **Gap found:** the Gemini importer writes a plaintext `oauth_creds.json`. Current Gemini CLI migrates that file into the keychain, or into the machine-bound encrypted file (oauth-credential-storage.ts:117-152). This matches the "(未证实)" (unverified) mark in ADD_ACCOUNT_PLAN.md:75.
- **TaskPackage container** (src/task-package/format.js):
  - File layout: magic `ADTASK01`, then a length-prefixed outer JSON header, then AES-256-GCM ciphertext, then a 16-byte tag (:6-8, 45-63).
  - Key derivation: scrypt with N=2^15, r=8, p=1 and a 16-byte salt gives a 256-bit key. The IV is 12 bytes (:15-18, 496-503).
  - Unlock code: 20 random bytes, each mapped to a 32-character alphabet without ambiguous characters, giving about 100 bits. It is shown as four groups of five (:19-26). service.js:87 generates it and returns it once in the export result (:186-191). History never stores it (ADR_AGENTDESK_TASK_PACKAGE.md:56).
  - Visible outside the encryption: only `format`, `schemaVersion`, cipher, kdf, salt, iv and the scrypt parameters (an allow-list at :430-440). That prefix is authenticated as AAD (:63, :132). The manifest sits inside the encryption (`ADINNER1`).
  - Import checks: magic, header size, an exact crypto suite and parameters, and the GCM tag (a wrong code or tampering gives `task-package-unlock-failed`). Decryption goes into a private staging folder (0600 `wx`), then each entry's sha256, the entry bounds and trailing data are checked (:172-187). Staging rejects symlinks and checks its boundary (service.js:612-632).
  - Missing for credentials: no expiry or not-after time, no binding to a recipient, and no one-time use. This container can be reused, but it needs a separate format and kind so that a task package can never carry a login.
- **Written rules (exact):**
  - AGENTS.md:8: "AgentDesk never stores, logs, echoes or passes such a value in argv, and errors carry fixed reason codes only."
  - PERSONAL_AGENT_MESH_PLAN.md §3 decision 21 (:107): "密码、Token、Cookie 和官方浏览器登录数据继续不跨设备。若以后要求免登录凭据迁移，必须单独进行产品与安全评审。" (Passwords, tokens, cookies and the official browser's login data still do not cross devices. Any future request to migrate credentials without logging in needs a separate product and security review.)
  - §4 item 3 (:130): "原始账号凭据、官方客户端 Cookie、Token 和密码永远不跨设备同步。" (Raw account credentials, official-client cookies, tokens and passwords are never synced across devices.)
  - ADD_ACCOUNT_PLAN.md:84: "复制登录文件等于搬家：Codex、Claude、Kimi、Qwen 的刷新令牌都是一次性的。" (Copying a login file is moving it: the refresh tokens of Codex, Claude, Kimi and Qwen are all single use.)

This feature crosses to another *person*, which goes further than crossing devices. Decision 21 therefore requires its own product and security review before any code is written.

## Part 2: what happens when the sender and the receiver both keep using it

- **Rotating refresh tokens (Codex, Claude, Kimi, Qwen, likely Cursor):** the first holder to refresh gets a new pair. The other holder's next refresh fails. Codex classifies the failure as `refresh_token_reused` → "Exhausted" (manager.rs:1870) and asks for a new sign-in. The result is that the two people take turns logging each other out. The vendor may also read the reuse as token theft and revoke the whole token family; this is UNVERIFIED for each vendor.
- **Keychain / DPAPI / host-salted file (Claude on macOS, Claude desktop, Gemini, Copilot OAuth):** the secret cannot be decrypted on another machine. Taking it out requires reading the keychain, which the safety rules forbid.
- **API keys:** both people can use the key at the same time. Usage and billing go to the key owner's organization. The owner can revoke it in the console, which cuts off both.
- **`setup-token`:** valid for one year and limited to model requests. The docs do not say whether one token can be revoked on its own (UNVERIFIED).
- **Provisioning without the interactive flow, as documented by vendors:** Claude `CLAUDE_CODE_OAUTH_TOKEN` / `ANTHROPIC_API_KEY` / `apiKeyHelper`; Codex `--with-api-key`, copying `auth.json` to *your own* headless machine, and `--device-auth`; Gemini `GEMINI_API_KEY`; Qwen `OPENAI_API_KEY` / `.env`; Copilot `COPILOT_GITHUB_TOKEN`. Every one of them is framed as being for the same user (CI, headless, own devices). None is framed as handing an account to another person.

## Part 4: terms (quotes are 15 words or fewer)

- **OpenAI** (openai.com/policies/row-terms-of-use/): "You may not share your account credentials or make your account available to anyone else". The Codex docs: "treat `~/.codex/auth.json` like a password".
- **Anthropic** (anthropic.com/legal/consumer-terms): "You also may not make your Account available to anyone else." Also: "You may not share your Account login information, Anthropic API key, or Account credentials". Teams and Console: an admin invites each member (code.claude.com/docs/en/authentication).
- **Google** (policies.google.com/terms): "taking reasonable steps to keep your Google Account secure". Gemini API terms (aistudio.google.com/docs/terms): no sharing clause found.
- **Cursor** (cursor.com/terms-of-service): "You are solely responsible for maintaining the confidentiality of your account and password." No explicit clause against sharing was found.
- **Moonshot / Kimi** (kimi.com/code/docs/en/kimi-code/community-guidelines.html): "Kimi Code subscriptions are for personal interactive use only." Also: "Sharing your account with others through a reverse proxy is a violation." The general Kimi ToS page needs JavaScript to render and could not be fetched. A search snippet says the account must not be shared without authorization; this is UNVERIFIED.
- **Alibaba / Qwen** (alibabacloud.com/help/en/model-studio/coding-plan): "The plan is for your use only and must not be shared." The Qwen ToS (qwen.ai/termsservice) was not fetched, so for Qwen OAuth this is "not found".
- **GitHub** (docs.github.com GitHub Terms of Service): "a single login may not be shared by multiple people."

**API keys and team plans:** an API key belongs to an organization and its members, and the org owner pays. Team and Enterprise plans add seats by invitation. Following the vendors, the legitimate form of this feature is to "invite the other person to your team" or to give them a key from your org with a limit on it. It is not to clone a personal login.

## Part 5: risks and what the receiver must refuse

- **Leak:** the unlock code goes in the same chat as the file, or the file gets forwarded. Plaintext keys then sit 0600 in the receiver's home and fall under the receiver's backups. Mitigations: send the code through a separate channel, which is already the TaskPackage rule; add a short not-after time inside the authenticated header; mark the file single-import with a nonce in the receiver's history.
- **Blast radius:** an OAuth login is the whole account. That covers chat history, connectors, settings and, depending on the vendor, billing and plan changes (UNVERIFIED per vendor). An org API key grants spend up to the org limit. A `setup-token` is limited to model requests. Only the narrowest kinds should be exportable.
- **Revocation:** API keys can be revoked in the vendor console. The sender can log out OAuth with `/logout`, which "removes and revokes the credential" for Claude's keyless Console sign-in. Copied refresh tokens are revoked in practice by the sender signing out or changing their password (UNVERIFIED per vendor). AgentDesk cannot revoke anything itself and should say so.
- **The receiver must refuse:**
  - a wrong `appId` or credential kind for the target client, or a client that is not installed (then show the install prompt and write nothing);
  - a failed GCM tag or AAD, or a modified header;
  - a file past its not-after time;
  - a nonce already imported;
  - a kind not on the allow-list (OAuth / keychain kinds must never be accepted);
  - an existing profile with the same fingerprint (`sameImportedFile`, codex `profileWithSameCodexAuth`);
  - any path, argv or env from the file. The target home and its writes must be decided locally by the existing adapters `applySecret`, `setKey` and `setProvider`.

  The secret must reach the client only through those adapters, never written raw by the import code.

**Recommendation for the owner:** support exporting **API-key / provider-key accounts only**, plus a "how to invite them to your team" hint. Show a clear "not transferable" message for subscription and OAuth logins. Run the review that decision 21 requires first.
