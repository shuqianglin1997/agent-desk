# 3 — Data flow, refresh, accuracy (read-only audit, 2026-11-24)

## 1. Start-up

**Main, before the window shows** (`src/main.js:331-346`): on packaged macOS, a synchronous `spawnSync codesign` with a timeout of up to 3 s (`main.js:166-177`), then `registerIpc`, then `ProfileRuntimeSupervisor.start(loadProfiles())`. That call runs the first tick straight away, then every 2 s (`profile-runtime.js:421-430`, `:29`). Next comes `createWindow` with `show:false`, shown on `ready-to-show` (`main.js:259,279-283`), and finally `resumeActiveJobs`. The window appears as soon as the static HTML paints. Data arrives later.

**Renderer boot** (`renderer.js:592-626`). Every step waits for the one before it:
`getSettings` (which can **write** settings.json, `main.js:3412-3418`) → `apps:list` → `devices:list` (mesh `getOverview`) → `profiles:list` → `loadSessions` → `taskPackages:list` → stage `ready` → `activity:all` + `quota:all`.
Cards and the list stay on the night/boot screen until every step resolves. The costly part is hidden: `getOverview`, and `uninitializedOverview` too, calls `sessionCounts`, which is `scan(profile).length` for **every** profile (`mesh-service.js:1547-1561`, `main.js:2278`). So boot runs a full scan for the counts. Then `loadSessions` scans again. Then `loadProfiles` fires `loadDeviceOverview` (`renderer.js:3234`), which runs a third full scan and, in mesh mode, a fourth through `loadSessions` (`renderer.js:4783-4787`).

## 2. Refresh paths

| Trigger | IPC / reads | Sync? | Cache / invalidation | Round trips | Re-render |
|---|---|---|---|---|---|
| Timer 8 s while `!document.hidden` (`renderer.js:611`) | `activity:all`: `loadProfiles` (profiles.json) + `ps -axww` + a recursive walk and `statSync` of every session file for every profile, plus 1 content read per profile (`activity.js:65-131`, `process.js:162-190`). Cursor/Kimi-work use the `sqlite3` CLI (`cursor-sessions.js:24-34`) | **Sync, main thread** | None, except the Codex identity cache keyed on dev:ino:size:mtime:ctime (`sessions.js:72-85`) | 1 | Targeted card update (`renderer.js:6071-6104`) |
| Timer 5 min (`renderer.js:615`), on show if older than 5 min | `quota:all` → `codex app-server` spawn, 2 at a time, 30 s timeout (`quota-service.js`, `codex-quota.js:16`) | Async | TTL 5 min ok / 1 min stale / 30 s error / 10 min unsupported; invalidated by profile edits (`main.js:1446,1576,1590`) | 1 | Header + inbox |
| Window `focus` / `visibilitychange`, throttled to 2 s (`renderer.js:561-567,625`) | `loadSessions` → local: one `sessions:list` per profile (`local-reads.js:5-9`). Mesh: `remoteInventory:listSessions` → `getUnifiedSessions`, which scans **all** profiles whatever the scope (`mesh-service.js:1281-1302`, `:1487-1496`) | **Sync** scans | **None.** Each Claude CLI file gets 256 KB head + 64 KB tail read (`sessions.js:272-312`). Each Codex file gets a 64 KB tail read; `session_index.jsonl` is read whole (`sessions.js:129,470-473`). Each Claude/Kimi file gets a full `readFileSync` + `JSON.parse` | N local / 1 mesh | **Full** `replaceChildren` rebuild of every row with new listeners (`renderer.js:8639-8715`) |
| Agent/scope click, profile edits (`renderer.js:3228,3433-3443,6234-6246`) | Same as above, often doubled through `loadDeviceOverview` | Sync | None | 2-3 | Full table |
| Search keystroke (`renderer.js:2054-2057`) | none | — | — | 0 | Full table, no debounce |
| Row click (`renderer.js:8706-8708`) | none | — | — | 0 | Full table |
| Push `hub:changed` (`preload.js:344`) | `hubRefresh` → `applySessionFilter` (`renderer.js:9284-9289`) | — | — | 0-1 | Full table |
| Hub ticker 1 s while a run is going (`renderer.js:9562-9575`) | none | — | — | 0 | Targeted cells (good) |
| Main 2 s supervisor (`profile-runtime.js:708-743`) | One `snapshotProcessRecords` (sync `ps`) **per owned active profile**, plus Crashpad scans | Sync `ps` | — | push only on incident | — |
| Peer inventory, 4 min per peer (`peer-manager.js:23,694`) | `buildInventory` = full scan of every profile | Sync | — | — | — |
| Device-journey dialog, 2.5 s (`renderer.js:4351`) | `devices:list` → `getOverview` → full scan + ≥4 `readSnapshot` of every mesh table (`mesh-service.js:117-192`) | Sync | None | 1 | dialog |

## 3. Concurrency

- **`loadSessions` is not single-flight and has no generation check.** It captures scope, agent and lens at the start and assigns `state.sessions` after `await Promise.all` (`renderer.js:3300-3337`) or after `await listMeshSessions` (`:3349-3371`). Example: click agent A (slow, "all" scope still loading), then agent B. Whichever response comes back last wins, so the list can show A's rows under B's title. Focus, `loadProfiles` and `loadDeviceOverview` all add overlapping calls.
- Silent `loadDeviceOverview` skips the `state.mesh.loading` guard (`renderer.js:4758-4765`), so its calls overlap freely.
- `loadQuotas(force)` returns the request already in flight and drops `force` (`renderer.js:3486`). Main's `inFlight` also ignores `force` (`quota-service.js:131-132`), so "refresh now" can return the old value.
- `loadActivity` is single-flight through a boolean (`renderer.js:5947`). That is good.
- Main-side sync handlers queue: 10 concurrent `sessions:list` calls run in series and block all other IPC and mesh traffic.

## 4. Main-thread blocking (10 accounts × 500 sessions)

- `activity:all` every 8 s: about 5,000 `statSync` + walk entries + 10 content reads + one `ps` (≤4 s timeout) + sync `sqlite3` (≤2 s each). Expect roughly 50-300 ms of blocking per tick, and seconds if `ps` or sqlite stall.
- Full-list scan: Claude CLI reads ~320 KB per file, so 500 × 320 KB ≈ 160 MB per profile and **≈1.6 GB of reads for one "all" refresh**. Codex reads ~64-128 KB per file. Even from the page cache, expect 0.5-3 s per profile, which means multi-second freezes on focus, on agent switch, and at boot (×3-4).
- `getOverview` scans every profile only to get counts, on **every** `devices:list`, `agentCatalog:list` and `agentSlots:list` call and after each mutation (`mesh-service.js:1547-1557`). It also reads whole tables, including the never-pruned `catalog_events` (`mesh-store.js:104-106`), and calls `keyVault.load()`, which runs `safeStorage.decryptString` three times per call (`secure-keys.js:69-83`).
- `profiles:list` runs `identityFingerprint`, which does a sync `readFileSync` + `JSON.parse` of `~/.claude.json` (often MBs) for each profile (`identity.js:53-60`).
- Supervisor: n_owned × sync `ps` every 2 s, even when the window is hidden.

## 5. Accuracy (inferred vs known)

- **"Running" can only be detected through `--user-data-dir`** (`process.js:25-63`, `main.js:3667-3675`). CLI clients and macOS default profiles always come back `running:false`, not `null`. `deriveState` treats `false` as "definitely closed", so it never shows working/onduty (`yard/cats.js:55-62`). Active CLI accounts show "play".
- **Two definitions of "busy":** the cat state uses content time within 90 s (`cats.js:29`). The ×N badge uses file **mtime** within 5 min (`activity.js:18,98`, `renderer.js:6317-6322`). A card can say "on duty ×3". Neither is labelled as inferred.
- **The list goes stale while the cards stay live:** activity polls every 8 s, but rows and their `updatedAt`/order refresh only on focus. A window that stays focused shows old times and order for hours.
- **Three session counts:** the device panel uses `scan().length` (`main.js:2278`). Activity uses a walk dedupe that, for Claude CLI, includes sidechain files the list excludes (`apps.js:187-188` vs `sessions.js:295`). The list uses filtered rows. A `WALK_LIMIT` of 12,000 entries truncates silently, depth-first (`activity.js:14,140`; `sessions.js:497`).
- **Identity grouping flickers:** `identityFingerprint` returns `null` when `.claude.json` or `auth.json` is caught mid-rewrite (`identity.js:23-29,80-84`), so grouped cards briefly split apart.
- **Codex first line over 64 KB** (large `session_meta`) gives `first=null` (`sessions.js:528-537`). The identity then falls back to the filename, the title and cwd are lost, and internal-child rollouts may show up as rows.
- **Quota fallback** marks itself `stale` (good), but when there is no timestamp it uses `observedAt: Date.now()` (`codex-quota.js:464`), which makes an old value look fresh.
- **Clocks:** future mtimes are dropped (`activity.js:97-99`). Remote `updatedAt` values from peer clocks are sorted as if comparable (`renderer.js:3334-3337`).

## 6. Errors

- A failed read looks the same as an empty one. `activity` failure sets `state.activity = {}`, so every cat turns idle (`renderer.js:5952-5953`). A per-profile `sessions:list` failure becomes `records: []` with no marker (`renderer.js:3327-3328`). An unknown profile becomes `[]` (`local-reads.js:7`). The sqlite helper returns `null`, documented as "treated as empty" (`cursor-sessions.js:31-32`). `readJson`/`safeStat` return `null` (`sessions.js:520-547`). `sessionsProvider` errors become `[]`, which is **published to peers as an empty inventory** (`mesh-service.js:1494-1496`).
- `readCodexIndex` catches nothing around `readFileSync` (`sessions.js:472-473`). One EACCES/EBUSY empties that whole Codex list.
- `readFirstJsonLine` leaks its fd if `readSync` throws, because there is no `finally` (`sessions.js:528-537`).
- `resolveProfileStore` persists `[]` when the primary file exists but every candidate fails to read (`profile-store-policy.js:15-22`). A transient read error could overwrite profiles.json.
- Timeouts are present on every `execFileSync` found (ps 4 s, sqlite 2 s, plutil 3 s, PowerShell 5 s, codex RPC 30 s).

## 7. Resources and lifetime

- Renderer intervals are gated on `document.hidden`. Main timers (supervisor 2 s, peer resync) are **not** paused when the window is hidden or closed on macOS.
- Each table rebuild allocates 2-3 listeners per row (~15k per keystroke at 5,000 rows): garbage-collection churn, not a leak.
- Unbounded: `catalog_events` / `membership_events` tables are read whole on every snapshot. Bounded: hub runs (200, `hub/store.js:19,154`), Codex identity cache (clears at 12k, which causes a cliff of re-reads), cat frame cache (4k).
- On quit, `codex app-server` children still running are not killed explicitly; they rely on stdin/EOF.

## 8. Done well (keep)

Atomic `json-store` writes (`json-store.js:20-44`). Quota: single-flight per profile, status-specific TTLs, concurrency cap 2, honest `stale`. Activity: deduplicated by source, try/catch per adapter. Bounded head/tail reads. Roster cards updated in place. Cat animation pauses when hidden and forgets removed canvases (`pixel/cats.js:288-323`). Hub ticker touches cells only. Every sync subprocess has a timeout. Ordered quit.

## Top 15 (wrong data → jank → leaks)

1. **CLI/default-profile cats never show "working"**: `running:false` means "not detectable", not "closed" (`process.js:60`, `cats.js:55-62`). Fix: return `null` for profiles with no `--user-data-dir` signal.
2. **`loadSessions` race overwrites newer results** (`renderer.js:3300-3371`). Fix: request generation token; drop stale responses.
3. **Session list goes stale while the window stays focused** (`renderer.js:611-625`). Fix: refresh rows when the activity `latestMtime` for the visible scope changes.
4. **Busy badge (mtime, 5 min) contradicts state (content, 90 s)** (`activity.js:18`, `cats.js:29`). Fix: one shared "active" rule, labelled as estimated.
5. **Scan failure looks empty and goes to peers as an empty inventory** (`mesh-service.js:1494`, `renderer.js:3327`). Fix: carry `{ok:false}` per profile and keep the last good rows.
6. **Session counts differ across panel, activity and list** (sidechains, `WALK_LIMIT`). Fix: count from one cached scan; flag truncation.
7. **A transient read error can rewrite profiles.json as `[]`** (`profile-store-policy.js:15-22`). Fix: persist empty only when the primary file is truly absent.
8. **Identity group flicker** on partial auth-file writes (`identity.js:80-84`). Fix: cache the last good fingerprint per file mtime.
9. **No cache on session scans: ≈1.6 GB of reads per "all" refresh** (`sessions.js:272-345`). Fix: per-file record cache keyed on size/mtime, as `codexRecordIdentity` already does.
10. **`getOverview` does a full scan just for counts, many times** (`mesh-service.js:1547`, `main.js:2278`). Fix: take counts from the cached scan or drop them from the overview.
11. **Boot runs 3-4 full scans in series before ready** (`renderer.js:592-608`, `:3234`, `:4783`). Fix: parallelise, paint profiles first, dedupe scans.
12. **Sync `ps`/sqlite/walk on the main thread every 8 s, plus `ps` per profile every 2 s** (`local-reads.js:22-30`, `profile-runtime.js:729`). Fix: share one async `ps` snapshot and move scanning to a worker or utilityProcess.
13. **Full table rebuild on every keystroke, click and hub event** (`renderer.js:8639`, `:2054`). Fix: debounce search, key-based diff or virtualise rows, delegate listeners.
14. **`force` quota refresh is ignored while a request is in flight** (`renderer.js:3486`, `quota-service.js:131`). Fix: chain one forced request after the current one.
15. **Unpruned `catalog_events` read whole, ≥4× per overview; three keychain decrypts per call** (`mesh-store.js:104`, `secure-keys.js:69`). Fix: compact events and cache the decrypted keys for the session.
