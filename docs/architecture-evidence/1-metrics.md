# AgentDesk architecture metrics (read-only; scripts in this folder)
No acorn/esprima/typescript in node_modules, so scripts use a comment/string-stripping tokenizer plus brace matching (lib.js, fn.js). Function counts and lengths are ESTIMATES (+-5%). Anonymous/expression-bodied arrows are partly missed.

## 1. Size (m1.js)
151 files in src (139 .js), 72,108 lines.
| lines | file |
|---|---|
| 9681 | src/renderer.js |
| 5184 | src/main.js |
| 3220 | src/styles.css |
| 2595 | src/mesh/main/transfer-service.js |
| 2478 | src/workspace.css |
| 2265 | src/pixel.css |
| 1786 | src/mesh/main/mesh-service.js |
| 1751 x3 | src/i18n/{en,ja,zh}.js |
| 1344 | mesh/main/peer-manager.js |
| 1310 | src/index.html |
| 1267 | mesh/main/remote-control-service.js |
| 1033 | pixel/boot.js |
| 967 | task-package/service.js |
| 936 | mesh/storage/mesh-store.js |
| 894 / 855 / 844 / 830 | catalog-events.js / apps.js / account-credentials.js / profile-runtime.js |
| 781 / 763 / 755 / 718 / 679 | agent-action-service / remote/console.js / pixel/ui.js / renderer/recruit.js / domain/agent-catalog.js |

Per folder (files, lines): src root 48/36,239; mesh/main 8/8,463; i18n 5/5,370; pixel 8/3,276; mesh/domain 14/3,123; mesh/protocol 10/2,553; task-package 3/2,163; remote 8/2,131; mesh/storage 3/1,358; renderer 3/1,256; main/ipc 8/949; hub 4/931; automation 4/914; mesh/network 3/855; main 7/800; yard 5/745; mesh/peer 5/600; mesh/platform 1/202; mesh/probe 4/180.
renderer.js + main.js = 14,865 lines = 21% of src, 41% of src root.

## 2. Big functions (fn.js, estimates)
Function counts: renderer.js 591 (379 top-level `function`), main.js 352, transfer-service 138, mesh-service 65, peer-manager 89, remote-control-service 82. (en.js/ja.js are one data IIFE.)
| len | function | where |
|---|---|---|
| 1265 | registerIpc | main.js:426 |
| 896 | bindEvents | renderer.js:1308 |
| 249 | receiveDataEnvelope | peer-manager.js:390 |
| 187 | launchProfile | main.js:3683 |
| 181 | renderTransferList | renderer.js:8368 |
| 144 | updateAccountCard | renderer.js:6268 |
| 139 | publicOverview | mesh-service.js:1586 |
| 134 | receiveTaskPackageOffer | transfer-service.js:693 |
| 127 | renderDiagnostics | renderer.js:8840 |
| 115 | exportCurrentTaskPackage | renderer.js:7461 |
| 108 | getProvisioningService | main.js:2322 |
| 103 | openAgent | renderer.js:6769 |
| 101 | createTaskPackageTransfer | transfer-service.js:303 |
| 89 | join / findExecutable | mesh-service.js:432 / main.js:4014 |
| 87 | diagnoseProfile / connect | main.js:3871 / peer-manager.js:50 |
Next 15 longest in renderer.js are 64-84 lines. Two functions (registerIpc, bindEvents) hold 2,161 lines.

## 3. Main-process module graph (m3.js)
104 main-process modules, 198 relative-require edges (excludes renderer/pixel/yard/i18n/remote UI scripts).
Fan-out top: main.js 62; mesh-service 14; transfer-service 9; peer/e2e-runner 8; apps.js 6; peer-manager 6; automation/local-locations 5; automation/service 5; protocol/catalog-events 5; settings 4; task-package/service 4; packaged-cli 3; main/agent-hub 3; main/recruit-items 3; protocol/pairing 3.
Fan-in top: mesh/domain/identity-link 12; apps.js 8; json-store 6; protocol/signaling-auth 6; automation/service 5; domain/capabilities 5; domain/agent-deployment 5; protocol/handshake 5; hub/roster 4; mesh/main/provisioning-adapters 4; domain/agent-catalog 4; codex-account-import 3; sessions 3; account-discovery 3; account-credentials 3.
Cycles: 0 (Tarjan SCC over relative requires; dynamic/lazy requires not seen).
Required by nobody: main.js (entry), mesh/peer/{peer,e2e-runner,preload}.js and mesh/probe/{probe,runner,preload}.js (loaded via BrowserWindow/html, tests cover them), mesh/domain/remote-stream-budget.js (loaded by remote/console.html:78). I found no true dead file.

## 4. Renderer scripts (m4.js, m4b.js)
Order in src/index.html (line 12, then 1279-1307): pixel/boot.js(1033) · yard/sprites(135) cat-art(264) cats(230) energy(68) · quota-overview(215) identity-groups(147) session-table(89) session-location(58) agent-workspace(263) device-journey(312) onboarding-state(359) ui-context(402) · i18n/i18n(87) zh/en/ja(1751 each) · pixel/icons(110) fx(216) chip(185) sfx(447) desk(148) · renderer/hub(280) tool-center(258) recruit(718) · roster-interactions(197) · pixel/cats(382) pixel/ui(755) · renderer.js(9681). 29 scripts, 5 stylesheet/script groups, no bundler or modules.
All 28 non-renderer scripts are UMD/IIFEs `(function(root){...})(self|this)`; each exposes one global: PixelLamp, YardSprites, CatArt, YardCats, YardEnergy, QuotaOverview, IdentityGroups, SessionTable, SessionLocation, AgentWorkspace, DeviceJourney, OnboardingState, UiContext, I18N + AgentDeskLocales, PixelIcons, PixelFx, Chip, PixelSfx, PixelDesk, AgentHubUi, createToolCenter, createRecruitDialog, RosterInteractions, PixelCats, PixelUi (~26 globals). Nothing leaks undeclared. renderer.js is a plain script: 379 top-level functions + 22 top-level const + 24 top-level let = ~46 module state variables (estimate), plus the `state` object (~28 keys, lines 1-190) and `els` (~356 DOM refs, line 191+; 429 getElementById/querySelector calls).
Top-level `let`s are mutable singletons (timers, busy flags, request promises) e.g. updateBusy, quotaRequest, deviceJourneyPollTimer, rosterController.

## 5. IPC surface (grep)
ipcMain.handle literals: 122 total, 0 `ipcMain.on` for app channels (1 `ipcMain.on` in mesh/main/webrtc-probe.js:63).
| place | count |
|---|---|
| src/main.js | 106 |
| src/main/ipc/local-reads.js | 7 |
| src/main/ipc/recruit.js | 4 |
| src/main/window-lamp.js | 2 |
| mesh/main/peer-manager.js:1144 (router, 4 channels via handle(...)) | 1 literal / ~4 channels |
| mesh/main/remote-control-service.js:1003 (router, ~16 channels) | 1 literal / ~16 channels |
So src/main.js 106 vs src/main/ipc/* 11 (9%); ~20 more channels registered dynamically by the two mesh routers. security-policy.js:91 wraps handle for senders. 7 of 8 files in main/ipc/ are factories, not registrars. 
preload.js: 392 lines, one `contextBridge.exposeInMainWorld('manager', {...})` at line 155 with ~137 entries (about 136 methods + windowPlatform), 120 `ipcRenderer.invoke` and 16 `.on/.send`. Other preloads: remote/console-preload 8 invokes, remote/host-preload 8, mesh/peer/preload 4.

## 6. Timers and loops (grep, then read)
| where | interval | purpose |
|---|---|---|
| renderer.js:611 | 8 s | poll agent activity visible |
| renderer.js:615 | 5 min (const :558) | poll quota when visible |
| renderer.js:4351 | 2.5 s | poll device journey dialog |
| renderer.js:9570 | 1 s | tick hub elapsed cells |
| renderer/recruit.js:280 | ~1-2 s x45 rounds (not read) | poll login after recruit |
| profile-runtime.js:429 | 2 s (pollIntervalMs :29) | monitor profile runtime fuse |
| mesh/main/peer-manager.js:694 | 4 min | resend inventory to peer |
| mesh/platform/input-adapter.js:134 | 1 s | PING heartbeat to helper |
| remote/console.js:117 | 2 s | sample remote media stats |
| remote/host.js:154 | ~33 ms (max(33,1000/fps)) | draw synthetic test frame |
| pixel/fx.js:170 / :189 | 28 ms / (unread) | number roll, typewriter, finite |
Recursive setTimeout: pixel/desk.js:104 (84 ms step, finite) and :128 (67 ms ring, finite), pixel/cats.js:308 (schedule(nextChange), self-paced cat animation, pauses when hidden). 73 `setTimeout(` in total, most one-shot.
rAF loops: roster-interactions.js:101,126 (drag autoscroll tick), pixel/fx.js:68,90 (particles, stops when empty), plus ~15 one-shot rAFs (renderer.js 8, pixel/ui 2, boot 1, hub 1, console 2).
fs.watch/watchFile: none in src. Main process has no setInterval except profile-runtime, peer-manager, input-adapter. `for(;;)/while(true)` read loops: cli-client-sessions.js:397, codex-history-retention.js:226,354, automation/service.js:175.

## 7. Blocking calls (m7.js; main-process files, strict fs+child_process *Sync)
Total 471 calls in 42 files (excl. renderer/pixel/yard/i18n/remote UI scripts). child_process sync: 15 execFileSync + 5 spawnSync (cursor-sessions, process.js, codex-history-retention, main.js, task-package/service).
| calls | file |
|---|---|
| 74 | codex-history-retention.js |
| 42 | task-package/codex-adapter.js |
| 41 | task-package/service.js |
| 35 | mesh/main/transfer-service.js |
| 32 | main.js |
| 19 | account-credentials.js; automation/packaged-cli.js; sessions.js |
| 15 | json-store.js |
| 14 | profile-runtime.js |
| 13 | mesh/storage/mesh-store.js |
| 12 | codex-account-import.js; credential-import.js |
| 11 | codex-runtime-home.js; task-package/format.js |
Top calls: existsSync 64, lstatSync 48, statSync 35, mkdirSync 34, readFileSync 32.

## 8. CSS (m8.js)
| file | rules | !important | layer |
|---|---|---|---|
| styles.css | 497 | 16 | @layer (all rules inside) |
| workspace.css | 430 | 0 | @layer (all) |
| pixel.css | 593 | 19 | none (unlayered, beats layers) |
| cats.css | 27 | 0 | none |
| remote/console.css | 190 | 2 | none |
| remote/host.css | 54 | 3 | none |
| mesh/peer/peer.css | 2 | 0 | none |
Total 1,793 rules, 40 !important (all 19 in unlayered pixel.css).
@layer order: legacy, reset, tokens, shell, components, features, themes (declared in both styles.css and workspace.css; pixel.css/cats.css outside any layer).
Custom properties: 133 names. 98 defined in more than one (file,selector) place; 46 defined in more than one FILE. Examples: --surface-canvas (pixel/styles/workspace, 5 defs), --surface-glass, --surface-raised, --surface-float, --surface-sunken, --ink-primary, --ink-secondary (6 defs), --ink-tertiary (6), --danger (pixel, console, host), --surface-warm (pixel, workspace). --type-size/-smooth/-face/-word are redefined 9-13x inside pixel.css.
Selectors outside @media appearing in more than one of styles/workspace/pixel/cats.css: 184. Examples: `html`, `body`, `:root`, `:root[data-theme="dark"]`, `[hidden]`, `.visually-hidden`, `button`, `select`, `input`, `textarea`, `summary`, `button:hover:not(:disabled)`, `button:active:not(:disabled)`, `.status-mascot`, `.agent-panel .account-card-avatar`. (Whole-tree count incl. remote/peer CSS: 10 when layered rules are excluded; the 184 is the relevant one.)

## 9. Word lists (m9.js)
zh/en/ja each 1,697 keys; en and ja miss 0 and add 0 versus zh.
Keys not literally referenced as a string in src: 276. 273 of those sit under 35 dynamic prefixes (e.g. hub.state., cat.breed., recruit.error., devices.platform., tools.source.), so they are probably used via `prefix + x`. Truly unreferenced candidates (estimate): 3 -- `meta`, `account.addAgent`, `account.createFirstAgent`. 20 raw examples: devices.value.succeeded, devices.platform.darwin, codexImport.error.codex-auth-size, recruit.method.key.claude-cli.hint, recruit.drop.file.codex, tools.manager.npm, onboarding.prepare.detail.unsupported, deviceJourney.fact.inventory, cat.breed.white, cat.acc.hat, cat.note.opencode, hub.state.completed, hub.tip.send.title, state.onduty, plus the 3 above.
Referenced via t()/data-i18n but missing from zh: 1230 distinct keys checked, 0 real misses (the one hit, "key", is a false positive from an icon name map at renderer.js:6222).

## 10. Tests (m10b.js)
101 test files in test/, ~748 tests (estimate: test()/it() at line start).
- 35 files read src/*.js|css|html as TEXT (readFileSync with a literal src path); they hold ~282 tests (38%). 15 are text-only (never require ../src), 20 mix text and calls.
- 62 files only call code and read no src text; 82 files require ../src modules in total.
Heaviest source-text files (tests / src-path refs / regex+includes asserts):
1. release-security.test.js 8 / 6 / 248
2. mesh-ui.test.js 14 / 43 / 156
3. ui.test.js 19 / 51 / 144
4. ui-redesign.test.js 8 / 27 / 120
5. pixel-icons.test.js 9 / 20 / 48
6. hub-settings-ui.test.js 7 / 19 / 47
7. quota-ui.test.js 5 / 4 / 37
8. device-journey-ui.test.js 7 / 3 / 32
9. main-ipc-security.test.js 12 / 3 / 32
10. task-package-ui.test.js 6 / 13 / 32
Also pure-text: onboarding-ui, recruit-ui, profile-runtime-ui, persistence-contract.
