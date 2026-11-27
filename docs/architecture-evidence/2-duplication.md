# AgentDesk duplication and generation audit

Read-only. Read against the working tree at f40e3ae. Another session has uncommitted edits in `activity.js`, `sessions.js`, `apps.js`, `identity-groups.js`, `session-table.js`, `yard/cats.js` and a new untracked `session-marks.js`. Line numbers in those files can move, and `session-marks.js` is excluded from the dead-code findings.

Ranked by maintenance risk (highest first).

## 1. "Find a session by ID after a rescan" is written five times, and the copies use different keys
- `main.js:2038` (hub) matches `address || id` and takes the first match. `main.js:5110` (reveal) matches `id` and takes the first. `main/session-actions.js:20-30` (copy/export/directories) matches `id` and gives null on duplicates. `task-package/service.js:468` matches `String(id)` and takes the first. `automation/service.js:262` matches `address || id` and reports `session-ambiguous`.
- **Class:** drifted near-duplicate.
- **Risk:** Codex `id` and `address` (the logical root key) can differ, and the copies handle duplicates differently. So the same selection can reveal, export or package one file in the UI and a different file, or an error, in the CLI or hub. A future fix will land in one copy only.

## 2. Client knowledge is spread across many files, not kept in the `apps.js` registry
- The `apps.js:9` header says nobody writes `appId === 'codex' ? …` any more. Outside `apps.js` there are about 67 such comparisons in 23 files: `session-export.js` 7 (99-136), `renderer.js` 6, `main.js` 6 (1966, 3462, 3627, 3765, 3775), `renderer/recruit.js` 5, `main/recruit-items.js` 5, `mesh/domain/agent-catalog.js` 5, `task-package/service.js` 4, `activity.js` 2, and others.
- Parallel per-client tables keyed by client ID:
  - `yard/cats.js:126` `CLIENT_LOOKS`
  - `hub/adapters.js:366` `ADAPTERS`
  - `hub/roster.js:131` `CALLER_HOME_KEYS`, which repeats the `envVar` values at `apps.js:196/264/333/401/589/636`
  - `identity.js:69` `ACCOUNT_ID_READERS` and `account-discovery.js:429` `IDENTITY_READERS`
  - `credential-import.js:129` `IMPORTERS`, `cli-discovery.js:13` `CLI_DEFINITIONS`, `tool-maintenance.js:16-161`
  - `renderer.js:90` hard-coded `appMeta` fallback for claude and codex
  - `yard/sprites.js:63` `APP_TAG`, with the same tag colours as `apps.js:119/287`
- **Class:** drifted near-duplicate, and the `apps.js:9` comment is now false.
- **Risk:** adding or renaming a client needs about 10 edits with no checklist. Copies that get missed fail quietly (no cat coat, no caller attribution, no identity).

## 3. The provider-namespace normaliser exists twice and already disagrees
- `mesh/domain/agent-catalog.js:4` `providerNamespace()` maps claude/claude-cli to `claude` and kimi/kimi-work to `kimi`. `dsh-cli` stays `dsh-cli`.
- `renderer.js:2205` `catalogProviderForApp()` maps the same pairs but also turns `dsh-cli` into `dsh`.
- **Class:** drifted near-duplicate (a live bug).
- **Risk:** `fillBindingAssignmentSelect` (`renderer.js:2268-2270`) filters bindings by `providerNamespace === provider`. For a DSH slot, Main stores `dsh-cli` and the renderer looks for `dsh`, so the assignment dialog shows "no compatible binding".

## 4. Codex and other JSONL transcripts are parsed in at least five places
- Codex rollout parsing:
  - `transcripts.js:107` (Markdown)
  - `hub/adapters.js:146-166` (`lastAnswerFromRecord`)
  - `session-export.js:112` (inline media)
  - `task-package/codex-adapter.js`
  - `codex-quota.js` (`rateLimitsFromRollout`)
  - `sessions.js` and `activity.js` (first-line identity and last activity)
- `partsText` is copied: `transcripts.js:238` recurses into `.parts`, `hub/adapters.js:85` does not.
- `session-export.js:99-113` keeps its own per-client message-shape switch.
- **Class:** drifted near-duplicate.
- **Risk:** when Codex or Gemini change their record format, the export, hub answer, attachments and quota will break separately. Gemini nested `parts` already show up as an empty hub answer but appear correctly in the transcript.

## 5. An old Codex-import generation sits beside recruiting, and its UI cannot be reached
- `renderer.js:2404` binds `#codexImportBtn`, which does not exist in `index.html`. It is the only renderer element reference missing from the HTML. So `openCodexImportDialog` (`renderer.js:2435-2480`), `#codexImportDialog` (`index.html:290`), 23 `codexImport.*` i18n keys and 4 IPC/preload pairs are unreachable:
  - `profiles:discoverCodexHomes`, `pickCodexHome`, `pickCodexAuth`, `importDroppedCodexAuth` (`main.js:1401-1521`, `preload.js:136/295-321`)
- `profiles:registerCodexHome` is also wired only to that dialog.
- Codex-home detection exists twice: `codex-account-import.js:7` `HOME_MARKERS` (includes `history.jsonl` and `sessions`) and `apps.js:338` `markerSets`, used by `account-discovery.js`.
- Codex registration has its own path: `main.js` `registerCodexHome`, called from the CLI at `main.js:1966` and from `recruit-items.js:42/77`. Every other client uses `profile-registration.js`.
- **Class:** dead code plus an old generation beside the new one.
- **Risk:** the marker drift means the CLI, recruiting and the old path can disagree on what counts as a Codex home. Five open IPC channels widen the attack surface for no feature.

## 6. Activity time windows: three notions of "busy right now"
- `yard/cats.js:29` `WORKING_WINDOW = 90 s`, based on the content timestamp, drives the cat state. Its comment explains that mtime is unreliable, especially for Codex.
- `activity.js:18` (HEAD; line 20 in the working tree) `ACTIVE_NOW_MS = 5 min`, based on file mtime, drives the card's "×N busy" badge (`renderer.js:6317-6322`).
- The in-flight edit adds `writingNow`, which reuses `WORKING_WINDOW`, but `activeNow` stays.
- Quota freshness has the same problem: `yard/energy.js:12` sets 15 min, and fallback copies sit at `renderer.js:6145` and `quota-overview.js:19`.
- **Class:** drifted near-duplicate.
- **Risk:** a card can say "×2 busy" while its cat sits "on duty", and the two windows will be retuned separately.

## 7. Three CSS generations, where the legacy layer's `!important` wins
- 34 tokens are defined in all three sheets with different values. Examples are `--accent` and `--ink-tertiary`: blue oklch at `styles.css:27/37`, hex at `workspace.css:21/29`, and a `--px-*` mapping at `pixel.css:121/132`. Only the pixel values are live.
- 50 class selectors are styled in all three sheets, for example `.account-card`, `.agent-panel`, `.app-footer` and `.quota-chip`.
- Important declarations reverse layer order, so legacy `styles.css:556-559` `.quota-message { font-size: 11.5px !important }` beats `pixel.css:1393`'s `12px !important`. That breaks the documented "only 12px and 24px" rule. The same rule sets `line-height` twice (559-560).
- `.yard-stage` survives at `styles.css:2566/3030`.
- **Class:** old and new generations.
- **Risk:** edits to `workspace.css` tokens do nothing visible. Anyone who adds `!important` to legacy rules silently overrides the skin.

## 8. Path equality and containment are written about 11 times
- `isSubpath` and `pathsEqual` appear in `path-utils.js:76/82` (not exported), `main.js:3654/3660` and `windows.js:479/485`.
- `samePath` appears in `profile-home.js:14`, `identity.js:43` (resolve only) and `account-credentials.js:721` (realpath).
- Containment checks: `profile-runtime.js:41` `pathInside`, `task-package/codex-adapter.js:540` `isWithin`, `hub/roster.js:102` `within`, `automation/service.js:187` `overlaps`.
- **Class:** drifted near-duplicate.
- **Risk:** the copies differ. The loose `!relative.startsWith('..')` (path-utils, main, windows, codex-adapter) wrongly rejects a child named `..foo`. Some copies use realpath and some only resolve, and some fold Windows case while others do not. Security boundaries (hub folders, Crashpad cleanup) depend on whichever copy was used.

## 9. `profiles.json` is read three ways
- `main.js:3353/3438` (`loadProfiles`/`readProfileStore`, with migration and backup recovery).
- `automation/service.js:94` (strict v2: wrong shapes throw).
- `automation/local-locations.js:15` (lenient: no version check, keeps any entry with a `sessionRoot`).
- **Class:** drifted near-duplicate.
- **Risk:** `locations discover` can mark a location "already registered" from a store that `profiles inspect` rejects.

## 10. Login and identity file knowledge is duplicated
- The `~/.claude` → `~/.claude.json` special case appears in `identity.js:56`, `account-discovery.js:443` and `account-credentials.js:589`.
- `auth.json` for Codex is read in `identity.js:65`, `account-discovery.js:431`, `account-credentials.js:457/549`, `codex-account-import.js:5` and `credential-import.js:145`.
- **Class:** true duplicate.
- **Risk:** a client changing its credential location needs five edits. Grouping (identity fingerprint) and recruiting (email) could then disagree about the same account.

## 11. Cat art: two generations, with stale comments
- `yard/sprites.js` holds 3 poses and 8 `BREEDS`. `yard/cat-art.js` holds 24 `LOOKS`, 8 poses and 19 actions. `orange`, `tabby`, `cow` and others are defined twice (`sprites.js:52-61`, `cat-art.js:206+`).
- Sprites now only draws the boot ghost (`pixel/boot.js:264`). `renderer.js:173-174` still writes client colours into `YardSprites.APP_TAG`, which nothing reads, because the ghost is drawn without a tag.
- `yard/cats.js:101` says 28 coats; there are 24. The headers of `yard/cats.js:2`, `sprites.js:2` and `energy.js:2` still say "庭院视图" / "yard cats".
- **Class:** old and new generations, misleading comments.
- **Risk:** palette edits go to the wrong table, and readers look for a yard scene that no longer exists.

## 12. Settings fields for retired features are still normalised and persisted, but never read
- `settings.js:16` keeps `VIEWS = {'yard','classic'}` and `view`. Also kept: `remindersOn`, `atmosTime`/`atmosWeather` (`YARD_TIMES`/`YARD_WEATHER`), `ledger` and `yardPositions` (via `yard/interactions.js`).
- `renderer.js:628-668` still migrates the matching localStorage keys into them.
- No consumer outside `settings.js` was found.
- `yard/interactions.js:10` comments "与 scene.js 的逻辑画布同步" (kept in sync with scene.js's logical canvas); `scene.js` is deleted.
- **Class:** dead / half-dead (kept for downgrade compatibility only, which nothing documents).
- **Risk:** every settings change has to keep carrying six fields whose meaning nobody remembers.

## 13. Exports nobody imports (outside src/mesh; tests ignored)
- Examples: `quota-service.js` (`ttlForSnapshot`, `friendlyCodexFailure`), `account-credentials.js` (`runOfficial`, `setDotenv`, `setYamlRef`), `profile-runtime.js` (`scanCrashpadPendingAsync`, `cleanCrashpadPendingAsync`), `task-package/codex-adapter.js` (`validateCodexJsonl`), `codex-quota.js` (`rateLimitsFromRollout`), `apps.js` (`withoutClaudeCodeEnvironment`).
- **Class:** dead (some may only be used inside their own file).
- **Risk:** low by itself, but it hides which functions are real contracts.

## 14. One object, seven names
- Code uses Profile, slot (`AgentSlot`, `currentSlotKey`), account (`renderAccountCard`), Agent (`openAgent`), cat (`hubCatNames`, `catalogAgentById`), location (`agentManageLocationLabel`) and runtime (`changeAccountCardRuntime`).
- The UI strings mix them inside one namespace. `en.js:558-577` (`account.*`) say "Add Agent", "global employee", "runtime", "Profile", "manual slots", "this cat" and "account".
- INTERNAL §4 calls the Profile an "账号槽位" (account slot). The CLI says "Profile". The hub says "account". The dossier says "location".
- **Class:** misleading names.
- **Risk:** new code and docs pick a word at random, and the Agent (global) vs Profile (local) distinction that AGENTS.md insists on gets blurred.

## 15. INTERNAL.md no longer matches the code
- The §7 IPC list names 5 channels that do not exist: `agentBlueprint:get/update`, `agentDeployments:list`, `remoteInventory:listAgentSlots`, `tools:updateAll`.
- It omits 12 that do exist, including `profiles:stop`, `profiles:runtimeStatus`, `profiles:cleanCrashpad`, `agentCatalog:create`, `sessions:directories`, `agentActions:*Remote` and the 5 Codex-import channels.
- §3 does not list 18 source files, including `session-export.js`, `path-utils.js`, `codex-account-import.js`, `yard/energy.js` and `main/session-actions.js`.
- §4 says the edit, path, relations, removal and diagnostics dialogs stack on the dossier (`openChildDialog` restores focus). The code calls `showModal()` directly at `renderer.js:1895/2638/2745/2890/8837`, so they get no focus or disclosure restore.
- **Class:** misleading documentation.
- **Risk:** the "read INTERNAL first" workflow sends agents to wrong places.

## 16. Small helpers written more than once
- Safe JSON readers, 6 copies: `sessions.js:658`, `cli-client-sessions.js:70`, `transcripts.js:15`, `identity.js:23`, `account-discovery.js:407`, `account-credentials.js:707`.
- Atomic writes: `json-store.js:20` is the main one, plus `account-credentials.js:102` (`writePrivateFile`), `codex-history-retention.js:196/303/489`, `automation/packaged-cli.js:250` (fixed `response.tmp`, no fsync), and `main.js:3227/5090`.
- Version key: `version` (profiles, hub, runtime, settings) versus `schemaVersion` (`task-package/service.js:509/590`).
- ID bounding: `main.js:2912` `boundedText` truncates an over-long ID and then looks it up. `settings.js:73` `boundedId` and `session-actions.js:12` reject it.
- **Class:** drifted near-duplicate.
- **Not found:** `escapeHtml` (one `innerHTML` assignment, DOM is built in code), time-ago or relative-time helpers, named debounce or throttle helpers.

## 17. Renderer state and dialogs: three tiers, two ways to open
- Selection lives in `UiContext` (`state.ui`, 106 uses). `state.actionAgentId` is documented beside it. There are also 24 top-level `let`s (`renderer.js:102-7086`), for example `editingProfile`, `catDraft`, `codexImportBusy` and `quotaHasLoaded`.
- Dialogs: 13 raw `showModal()` calls against 13 `openChildDialog()` calls. Menus are `details.context-menu`, built in HTML (`renderer.js:2010`) and in code (`renderer.js:5081`).
- **Class:** old and new generations.
- **Risk:** state can't be tested or reset in one place, and dialogs inconsistently restore focus (see 15).

## Checked and clean
- Main ↔ preload IPC: all 116 handled channels are exposed, every preload channel has a handler or is a push channel, and every preload method has a renderer caller.
- Renderer element references: all exist in `index.html` except `#codexImportBtn`.
- Retired "rankings": not found anywhere.

## Already well factored (leave alone)
- `json-store.js` is shared by profiles, settings, hub, runtime, task-package history and consumed ledger, and Mesh keys.
- `applyProfileSecret` is the one path for both `credentials:apply` IPC and `profiles set-key` CLI (`main.js:1507`, `2214`).
- `automation/service.js` reuses `apps.scan`, `cli-discovery` and `session-location`, not its own scanners.
- `session-location.js`, `session-table.js` (sort and keys) and `ui-context.js` are pure and tested.
- The hub split into adapters, roster, store and runner, with `main/agent-hub.js` as the one relay.
- The Mesh domain/protocol/storage/main layering, and `main/ipc/*` registrars with sender verification.
- `pixel/cats.js` as the single cat player. All live cat drawing in the renderer goes through `PixelCats`/`PixelUi`.
