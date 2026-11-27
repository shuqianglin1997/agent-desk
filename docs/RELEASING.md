# Release guide

Catshelf release artifacts are built by `.github/workflows/release.yml`. A tag
must never publish an unsigned Windows portable executable or an unsigned or
unnotarized macOS DMG. The one exception is the clearly labelled unsigned test
build from `.github/workflows/test-build.yml` (see [Unsigned test
builds](#unsigned-test-builds)).

The README's download links point at
`https://github.com/shuqianglin1997/catshelf/releases/latest/download/` followed
by `Catshelf-unsigned-universal.dmg`, `Catshelf-unsigned-portable-x64.exe` or
`SHA256SUMS.txt`. GitHub serves that path only from the release marked Latest,
which can never be a prerelease or a draft. So, until a signed release exists,
every unsigned test build is published as the Latest release with exactly those
fixed file names, and the README never needs editing for a new test build. When
the first signed release is published, these links and this rule are decided
again together: the signed Preview is a prerelease by the rules below, so it can
never be Latest as they stand.

As of 2026-08-14 there is no public `v0.10.1-preview.1` Release. The transaction
and its security tests exist in the repository, but real signing credentials,
the protected `preview-release` environment, and a real Preview tag have not
been used to execute it. An older Release must not be presented as this source.

## macOS security invariant

The macOS release job must complete all of these checks before its artifact can
reach the release job:

1. Sign the complete app bundle with a `Developer ID Application` certificate.
2. Enable Hardened Runtime with the Electron JIT entitlements.
3. Submit the app to Apple's notarization service.
4. Staple the notarization ticket to the app.
5. Verify the signature with `codesign`.
6. Verify the ticket with `xcrun stapler`.
7. Pass both `spctl` and `syspolicy_check distribution` from the app inside the
   final DMG.

`build.mac.forceCodeSigning` is enabled. Missing or invalid credentials must
fail the build; silently falling back to an unsigned DMG is not allowed.

## Windows security invariant

The Windows release job uses electron-builder's standard PKCS#12 environment
variables and sets `win.forceCodeSigning=true` for the release build. It must
complete all of these checks before its artifact can reach the release job:

1. Sign with SHA-256 and request an RFC 3161 timestamp.
2. Require Windows to report a trusted `Valid` Authenticode chain.
3. Require Code Signing EKU on the signer and Time Stamping EKU on the timestamp
   authority.
4. Extract the final portable executable without running it.
5. Verify the packaged `Catshelf.exe` and the fixed
   `resources/native/AgentDeskInputHelper.exe` with the same trusted signer and
   their own RFC 3161 timestamps.

The ordinary `windows-ci.yml` job deliberately performs an unsigned packaging
compatibility check. It does not upload that artifact and cannot substitute for
the signed Release job. The verifier above inspects the final artifact produced
inside the release runner before upload; it does not by itself prove that a
public GitHub URL serves the same bytes or that a clean external machine can
launch them.

## Electron package and first-use invariant

Every packaged form is checked independently of source tests:

1. `resources/app.asar` must exist and `default_app.asar` must not exist.
2. The final executable must have exactly the required Electron fuse posture:
   `RunAsNode=true`, `EnableNodeOptionsEnvironmentVariable=false`,
   `EnableNodeCliInspectArguments=false`,
   `EnableEmbeddedAsarIntegrityValidation=true`, and
   `OnlyLoadAppFromAsar=true`.
3. `RunAsNode` is limited to the fixed launchers in `src/cli-discovery.js` and
   `src/clients/codex/quota.js`, plus the opted-in
   `src/clients/codex/history-retention.js` worker. That worker runs its own packaged module with fixed maintenance
   flags and a validated, policy-enabled Codex root. Adding another caller
   is a security-boundary change, not a generic child-process facility.
4. Every regular file in `app.asar` must carry SHA-256 whole-file and 4 MiB
   block hashes. The verifier streams the packed or unpacked bytes, rejects
   missing metadata, unsafe links, gaps, overlaps, trailing payload and any
   digest mismatch.
5. The archive-header hash must also match the executable's trusted package
   record: macOS `ElectronAsarIntegrity` in `Info.plist`, or Windows' unique
   `INTEGRITY/ELECTRONASAR` PE resource.
6. `scripts/verify-electron-package-integrity.js` must pass before any packaged
   first-use test runs.

`scripts/packaged-first-use-smoke.js` then runs one exact artifact three times
with one fresh temporary userData directory: first initialization, restart recovery
and completion, then a completed-state restart. It accepts only an
`Catshelf.app`, a `win-unpacked` directory, or the exact versioned portable. It
checks the fixed window shell, one first Agent/local device, zero default
Profiles, zero remote devices or Mesh connections, and strict process/debug
loopback cleanup. A random launch token and the Browser command line bind the
DevTools page to that exact launch; cleanup only signals the original spawned
process handle and never resolves a new process from a reusable PID. All three
launches must use the same candidate bytes. On macOS, only userData is
temporary. The ad-hoc `main` compatibility job explicitly passes
`--macos-ci-mock-keychain`; the smoke runner first proves the artifact is an
ad-hoc-signed `Catshelf.app`: it explicitly verifies every architecture,
enumerates the main executable's slices, and displays/classifies each slice
separately. Every slice must report exactly one ad-hoc signature, no Authority,
and no TeamIdentifier; mixed signatures fail closed. Only then does it add
Chromium's native mock-Keychain switch to all three launches and verify that
exact switch in the Browser command line. This avoids coupling an ad-hoc
compatibility run to a hosted runner's interactive Keychain ACL. It proves only
the packaged first-use transaction, not macOS Keychain protection. Developer
ID builds, Draft re-downloads and public re-downloads never receive either
mock-Keychain switch and continue to exercise the system Keychain.

The `main` macOS job performs these checks on an ad-hoc universal unpacked app,
using the narrowly gated mock-Keychain mode above, and separately requires
arm64 + x86_64 in the main executable and input helper.
The Windows job verifies the unsigned `win-unpacked`, extracts and verifies the
portable's own inner app/helper, then smokes both outputs. Those
jobs prove packaging compatibility only and upload diagnostics only on failure.
The release transaction repeats the checks on the signed native outputs, on the
downloaded Draft assets, and again on anonymously downloaded public assets.
Current local evidence covers the exact thin-arm64
`release/mac-arm64/AgentDesk.app`: the unpacked verifier passed all 118 regular
ASAR files, five fuses and the `Info.plist` header binding, and the real semantic
mock-Keychain flag passed all three first-use launches after the per-architecture
gate classified its one arm64 slice as ad-hoc. This is not evidence for the
universal CI build, the system Keychain, Developer ID signing, notarization,
Draft/public downloads, or a physical clean machine.

## Required GitHub Actions variables

Configure these as repository or organization Actions variables. They are
public publisher identities, not private credentials:

- `APPLE_TEAM_ID` — exactly 10 uppercase letters or digits identifying the
  Apple Developer team.
- `WIN_SIGNER_THUMBPRINT` — exactly 40 hexadecimal characters containing the
  SHA-1 thumbprint of the required Windows publisher certificate.

`release-policy`, which has no protected environment, reads and validates both
values before any native build or Draft can start. It then propagates those
exact validated values as job outputs to the macOS/Windows build, Draft
re-download, and anonymous public re-download jobs. This prevents an
environment-scoped variable from silently overriding the repository or
organization source in only part of the transaction. Do not duplicate either
identity as an Actions secret or give the public verifiers an environment
solely to read it.

## Required GitHub Actions secrets

macOS signing always requires:

- `MAC_CSC_LINK` — base64-encoded `.p12` containing a current Developer ID
  Application certificate and private key.
- `MAC_CSC_KEY_PASSWORD` — password used when exporting that `.p12`.

Windows signing always requires:

- `WIN_CSC_LINK` — base64-encoded PKCS#12 `.p12`/`.pfx` containing a current,
  publicly trusted Authenticode Code Signing certificate and its private key.
  The Release job passes this secret directly through electron-builder's
  standard Windows certificate variable.
- `WIN_CSC_KEY_PASSWORD` — password used when exporting that PKCS#12 file.

The outer portable, packaged `Catshelf.exe`, and
`AgentDeskInputHelper.exe` must all resolve to the exact
`WIN_SIGNER_THUMBPRINT` Actions variable; accepting any otherwise-valid
certificate is forbidden.

An absent, malformed, expired, untrusted, non-code-signing, or untimestamped
Windows credential fails the Release job. A self-signed development certificate
does not satisfy the public release invariant.

For notarization, configure one of the following credential sets.

### App Store Connect API key (recommended)

- `APPLE_API_KEY_BASE64` — base64-encoded contents of the `.p8` key. The
  workflow decodes it into a permission-restricted temporary file because
  `electron-builder` expects `APPLE_API_KEY` to be a file-system path.
- `APPLE_API_KEY_ID` — key ID.
- `APPLE_API_ISSUER` — issuer ID.

### Apple ID fallback

- `APPLE_ID` — Apple Developer account e-mail.
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password, never the account
  password.

Do not commit certificates, private keys, passwords, or API keys to this
repository.

The private signing and notarization secrets belong in a protected GitHub
environment named `preview-release`, with required reviewers and deployment
rules for the release workflow. The two publisher-identity variables belong at
repository scope or an organization scope that grants this repository access.
`main` and Preview tags must be protected so an ordinary repository write
cannot replace a candidate or bypass the transaction. These variables,
protections, and secrets are deployment prerequisites; they are not currently
claimed as configured merely because the workflow references them.

## Local builds

Node.js 22.12 or newer is required.

Every electron-builder run, local or release, packs `build-info.json` into
`app.asar`: the `beforePack` hook (`scripts/build-native-helpers.js`) writes the
commit and whether `src`, `assets` or `package.json` differed from it
(`scripts/build-info.js`). It holds no time, so both halves of a universal
build are identical. A package reports it in `--cli capabilities` (`build`)
and in the macOS About panel; a source checkout reports `packaged: false`.
[FIX_AND_REBUILD.md](FIX_AND_REBUILD.md) uses it to fetch the exact source.

```bash
npm ci
npm run check
npm run check:docs
npm test
```

For a local unpacked compatibility build that will not be published, use the
explicit ad-hoc signing identity configured by the script:

```bash
npm run build:mac:dir
npm run verify:electron-package -- --artifact release/mac-arm64/Catshelf.app
```

`npm run accept:packaged -- --artifact <exact-artifact>` exercises the three
launch first-use smoke with the system Keychain. A local smoke result is valid
only for the named bytes and disposable userData; it does not authorize
publication. `--macos-ci-mock-keychain` is reserved for the `main` ad-hoc CI job
and fails closed for Windows, unsigned bundles, or certificate-signed macOS
apps.

For a production-equivalent macOS build, export the same signing and
notarization variables used by CI, then run:

```bash
npm run build:mac
npm run verify:mac-release
```

The release build intentionally fails when no valid signing identity is
available.

On Windows, `npm run build:win` is only the unsigned compatibility build. To
exercise the public-release path, set `WIN_CSC_LINK` and
`WIN_CSC_KEY_PASSWORD` to the trusted PKCS#12 credentials, then run:

```powershell
npm run build:win:release
npm run verify:win-release
```

The verifier checks the final portable file and the two executable files inside
it; checking only the outer container is insufficient.

## Unsigned test builds

Owner decisions 2026-11-25 (docs/PERSONAL_AGENT_MESH_PLAN.md 1.39 and 1.40):
until the signed Preview exists, a clearly labelled unsigned test build may be
published on GitHub Releases. It is a separate path from the signed Preview
below and does not satisfy any of its gates.

- Start it by pushing a tag that begins with `test-`, for example
  `test-20261125-b0b8b2b`:

  ```bash
  git tag test-YYYYMMDD-<short commit> <commit>
  git push origin refs/tags/test-YYYYMMDD-<short commit>
  ```

  `.github/workflows/test-build.yml` runs only for such tags; `release.yml`
  runs only for `v*` tags, so neither starts the other.
- The Windows job builds the unsigned portable (`npm run build:win`) and
  checks fuses and ASAR in `win-unpacked` and inside the portable. The macOS
  job builds an ad-hoc signed universal DMG (`npm run build:mac:test`), checks
  both architectures of the app and its native helpers,
  `codesign --verify --deep --strict`, and fuses and ASAR.
- The packaged first-use smoke (`npm run accept:packaged`) is not run for now:
  it is out of date with the app and fails on both platforms before it checks
  anything about the build. The owner chose on 2026-11-25 to publish test
  builds without it until it is repaired; then it goes back into the Windows
  job, and macOS CI runs it on `main`.
- The last job, the only one with `contents: write`, copies the two packages
  to fixed names without the version — `Catshelf-unsigned-universal.dmg` and
  `Catshelf-unsigned-portable-x64.exe` — writes `SHA256SUMS.txt` for them
  and `update-manifest.json` for the app's check for updates (see [In-app
  updates](#in-app-updates)), refuses anything but exactly these four files,
  and creates a release titled
  “未签名测试版 / Unsigned test build `<tag>`” with `--latest` and without
  `--prerelease`, then reads back that the Latest release is this tag. Its
  notes name the version, the commit and the way to open it (macOS: System
  Settings → Privacy & Security → Open Anyway; Windows: More info → Run
  anyway). It never signs and reads no signing secret.
- Owner decision 2026-11-26 (docs/PERSONAL_AGENT_MESH_PLAN.md 1.42): the
  in-app update counts a test build as an update, ordered by commit (see
  [In-app updates](#in-app-updates)). Test builds published before that
  decision skip a `test-` Latest (before 2026-11-25 they reported an invalid
  version), so whoever runs one downloads the next build by hand once; from
  then on the app updates itself.
- The workflow does not pass `--target`, so the release's `target_commitish`
  is the branch name. The tag must be `test-YYYYMMDD-<short commit>`, the
  short commit being the start of the tagged commit: the workflow stops before
  publishing otherwise, and the app refuses a Latest whose name and commit
  disagree.
- Earlier test builds stay on the Releases page with their versioned file
  names (`Catshelf-<version>-unsigned-…`); only the newest one is Latest.
- Not covered: signing, notarization, the Draft native redownload and the
  anonymous public redownload.

## In-app updates

System › Settings › “Update” (`src/renderer/views/updates.js`) checks GitHub's
Latest release of this repository; Main decides and installs
(`src/main/updates.js`), the decision and the Windows replacer are in
`src/updater.js`, the macOS steps in `src/update-mac.js`. Owner decisions
2026-11-26 (docs/PERSONAL_AGENT_MESH_PLAN.md 1.42, 1.43).

**Where Latest is read from (1.43).** Since this decision every test build
carries `update-manifest.json`, written by the release job of
`test-build.yml`. The app downloads it from
`https://github.com/shuqianglin1997/catshelf/releases/latest/download/update-manifest.json`,
an ordinary download (redirects followed one at a time, only to GitHub's
download hosts, at most 256 KB) and not one of GitHub's 60 anonymous API
calls an hour, which everyone behind the same address shares. A release
without that file (404: every test build before it, and the signed `v*`
releases, which `release.yml` publishes with exactly three files) is read
through the API as before. Schema 1:

```json
{
  "schema": 1,
  "repository": "shuqianglin1997/catshelf",
  "tag": "test-20261127-e56c8aa",
  "kind": "test",
  "commit": "<the 40-character commit the tag points to>",
  "version": "0.10.1-preview.1",
  "publishedAt": "2026-11-27T03:40:00Z",
  "assets": [
    { "name": "Catshelf-unsigned-universal.dmg", "size": 219210590, "sha256": "<64 hex>" },
    { "name": "Catshelf-unsigned-portable-x64.exe", "size": 98765432, "sha256": "<64 hex>" }
  ],
  "history": ["<commit>", "<its parent>", "…"]
}
```

`history` is up to 500 commits the release contains, newest first, starting
with its own commit (GitHub's commit list from that commit, read by the
workflow with its own token). `publishedAt` is when the release job wrote the
file, just before it publishes. A file of another `schema` (a newer format)
is left to the API; a schema-1 file that breaks these rules (another
repository, a commit that is not 40 hex characters, a short commit in the tag
that does not start the commit, a history that does not start with the
commit, a file name with a path, a bad size or SHA-256) is refused with
`manifest-invalid`.

**Newer or not.** A `v*` Latest is ordered by version, as before. Test builds
all carry the same package version, so a `test-*` Latest is ordered by
commit. This copy's commit is the one the package records (`build-info.json`,
[FIX_AND_REBUILD.md](FIX_AND_REBUILD.md)).

With a manifest:

1. The release's commit is the manifest's `commit`.
2. The same commit is up to date.
3. This commit in the manifest's `history` means Latest contains it: newer,
   and offered. No API call for either of these, which are the cases of
   everyone running a published build.
4. Otherwise (a local build ahead of Latest, a build from another line of
   commits, one more than 500 commits behind) one comparison is asked of the
   API, as below; `behind` is older and never offered, `diverged` is not
   offered. When the API cannot answer (rate-limited, offline) the state is
   “cannot tell” (`rate-limited`, `comparison-unavailable`), never a guess.

Without a manifest (the API, as since 1.42):

1. The release's commit is the one GitHub resolves the tag to
   (`/commits/refs/tags/<tag>`). `target_commitish`, when it is a commit, and
   the short commit at the end of the tag name must agree with it; the
   release notes are never read for this.
2. The same commit is up to date.
3. Otherwise GitHub's comparison `<this commit>...<release commit>` (second
   page of one commit: status and counts without the file list) decides:
   `ahead` is newer and offered; `behind` is older and never offered (no
   downgrade); `diverged` is not offered; `identical` is up to date.

Either way, a copy without a recorded commit (built from a source download),
or whose commit GitHub does not know (local changes), says it cannot tell
(`current-commit-unknown`, `current-commit-not-on-github`) and offers the
release page.

**When it checks.** The window checks by itself about eight seconds after it
opens and, while it stays open, at most once more a day (an hourly look at
the time since the last automatic check). A newer Latest only shows: a small
dot on 系统 in the top bar, 有新版 on the update line, “Update and restart”
on the button and an item in the inbox. Nothing is downloaded or installed
until the person clicks “Update and restart” and confirms. An automatic check
that fails says so only on the update line; an update that did not finish
last time is also said in the status bar. The button asks again each time.

API calls stay rationed: one check is at most three anonymous calls, a result
is reused for ten minutes (the automatic check) or one minute (the button),
the tag's commit and each comparison are kept for the life of the process,
and after GitHub reports the limit no API call is made until its reset time
(the manifest is still read). `updates check` on the packaged command line
runs the same check read-only ([AI_INTERFACE.md](AI_INTERFACE.md)).

**Files.** macOS takes the universal DMG, Windows x64 the portable exe
(`Catshelf-unsigned-universal.dmg`, `Catshelf-unsigned-portable-x64.exe`; the
versioned names of a `v*` release are recognized too). `SHA256SUMS.txt` and
`update-manifest.json` are never installers. From a manifest the address is
`releases/download/<tag>/<name>` in the same release, and the size and
SHA-256 are the manifest's; from the API they are the asset's, and a file
without GitHub's `sha256:` asset digest is not installed automatically.
Either way the downloaded package is checked against that size and SHA-256
before anything else happens.

**The download folder.** Downloads go to `$TMPDIR/AgentDesk-updates/`
(Windows: `%TEMP%\AgentDesk-updates\`). Before a new download starts,
everything an earlier one left there is removed (an interrupted `*.partial`,
packages already used, old scripts, an empty leftover mount folder); only the
last attempt's result (`mac-update-result.json`, its `.log`, and
`update-error.log` on Windows) stays for the next check to report. A folder
that is not empty, which may still be a mounted image, is left alone.

**macOS, “Update and restart”.** Only `/Applications/Catshelf.app` replaces
itself.

1. Download the DMG over HTTPS from the fixed repository (redirects only to
   GitHub's download hosts) and check its size and SHA-256 against the
   manifest (or, without one, the asset digest).
2. `hdiutil attach -nobrowse -readonly -noautoopen -mountpoint <fresh temp
   folder>`.
3. Check the `Catshelf.app` inside: bundle id `com.hupo.agentdesk`,
   `codesign --verify --deep --strict` (test builds are ad-hoc signed), the
   commit in its `app.asar`'s `build-info.json` equals the release's commit
   (a `v*` release: `CFBundleShortVersionString` equals the release version),
   and its version is not older than this copy's.
4. `ditto --noqtn` it next to the target as `/Applications/.Catshelf.update-<token>.app`
   and check that copy the same way; detach the DMG (a folder that may still be
   a mount point is never removed) and delete the download. Copies left by an
   interrupted update are removed first.
5. Back up `profiles.json` and `settings.json` (as on Windows).
6. Start a small detached `/bin/sh` script (`macUpdaterScript`), then quit
   the way the menu does except that the AI clients Catshelf opened stay
   open; background hub runs end, and the window asks before that.
7. The script waits for Catshelf to exit and for no process to run from the
   bundle (helpers, a `--cli` run, another user), checks the staged copy,
   renames the old bundle to `.Catshelf.rollback-<pid>.app`, renames the new
   one into place, checks it, writes its result, reopens it with `open` and
   removes the old bundle. On any failure it puts the old bundle back and
   reopens that. The next check shows a failed attempt with its reason code
   (`quit-timeout`, `bundle-in-use`, `swap-failed`, `installed-invalid`).

Falls back to the release page, with a fixed reason code and a sentence:
not running from `/Applications` (`not-in-applications`), running under App
Translocation (`app-translocation`), no write permission on `/Applications`
or the bundle (`not-writable`), development mode (`dev-mode`), no file for
this system (`no-asset`) or no digest (`no-digest`). Every refusal of steps
1–4 (`digest-mismatch`, `size-mismatch`, `mount-failed`, `app-missing`,
`bundle-id-mismatch`, `signature-invalid`, `build-info-unreadable`,
`commit-mismatch`, `version-mismatch`, `staging-failed`) leaves
`/Applications` untouched.

Trust: an ad-hoc signature proves the bundle is intact, not who built it. For
test builds the origin rests on the fixed repository over HTTPS, the SHA-256
and the commit check. Since 1.43 the SHA-256 and the commit of a release
with a manifest come from that file, which the workflow writes and uploads
into the same release, read over the same HTTPS from the same repository,
instead of from GitHub's own asset digest and tag resolution. So they are
exactly as trustworthy as the release's files themselves: whoever can
publish a release in this repository can write both the package and its
manifest, just as they could before; a manifest does not add a second,
independent witness. The package's SHA-256 is still checked after the
download, and on macOS the commit recorded inside the app must still equal
the manifest's. When signed releases exist, the check should also require the
same Developer ID team; that is not done yet.

Ad-hoc signatures change with every build, so macOS may ask once more whether
Catshelf may use “AgentDesk Safe Storage” in the keychain (the window tells
the person to click “Always Allow”), and Accessibility or Screen Recording
permissions given for remote control may need to be switched on again.

**Windows.** Unchanged portable flow: download and check the digest, back up
the configuration, a PowerShell script waits for the process to exit,
replaces the portable exe (old one kept as `.old` until the new one starts)
and restarts it; it now also accepts test builds and uses the decision above.
Falls back to the release page when not started from the portable exe
(`not-portable`), in development mode or without write permission.

**Real-machine check (macOS).** `scripts/update-dry-run-macos.js` runs steps
1–4 above with the same code on the real Latest and stops before the swap:
it stages into a scratch folder instead of `/Applications`, starts no script,
quits nothing and removes everything it made. The scratch target is a
parameter of that script only; the app has no such switch.

```bash
node scripts/update-dry-run-macos.js
```

It reads the commit of the installed `/Applications/Catshelf.app` without
running it; to pretend to be another build pass
`--current-commit <40-character commit>`, and `--keep` keeps the scratch
folder. It reads the manifest, downloads one DMG and makes API calls only
for a Latest without a manifest or a commit the manifest cannot place. It
prints whether Latest came from the manifest or the API, the
decision, what the installed app would do (install itself or open the release
page, and why), each step, and ends with “Dry run passed.” or the reason code.

Run on 2026-11-26 on the owner's Mac (Apple silicon), pretending to be the
build of `81bb9b0` against Latest `test-20261126-bebb532`: decision “newer”,
`Catshelf-unsigned-universal.dmg` (219,210,590 bytes) downloaded and matched
GitHub's digest, mounted, the app inside checked (bundle id, signature,
commit `1c8b027…`), staged into the scratch folder and checked again, then
stopped before the swap. `/Applications` was untouched; the scratch folder
was removed and no Catshelf image stayed mounted. About 48 seconds.

The dry run downloads with Node, not with Electron's `net`, so it missed
one fault: the first real “Update and restart” the same day (from a local
build of `69df4d0`) stopped within seconds with `download-interrupted`.
Electron 43 emits `close` on the request as soon as it is sent, before the
redirect and the response, and the download treated that as an
interruption. Fixed in `aba3629`. Builds of `69df4d0` and `908d491`
(Latest `test-20261126-51d795b`) therefore cannot update themselves;
anyone running one downloads the next build by hand once.

The second real attempt (from `aba3629`) downloaded at about 70-110 KB/s
from GitHub, so the 209 MB package needed close to an hour and would have
hit the 30-minute total limit. Since `a87aa70` a download stops only after
two minutes without data (six-hour cap). Builds before it can still update
themselves when GitHub is fast enough to finish within 30 minutes.

First real update, 2026-11-27 on the owner's Mac (Apple silicon): a local
arm64 build of `a87aa70` in `/Applications`, “Update and restart” to Latest
`test-20261127-e56c8aa`. It downloaded the universal DMG, quit, swapped and
reopened: the old copy quit at 03:50:51 UTC and the new one started at
03:51:12. Afterwards `/Applications/Catshelf.app` reports commit `f767beb`,
is universal (x86_64 and arm64), passes `codesign --verify --deep --strict`,
carries no quarantine attribute, the result file says
`{"ok":true,"code":"installed"}`, no staged or rollback bundle and no
download were left, and `profiles.json` and `settings.json` were backed up
as `*.pre-update.bak`. Before it, one check was refused with `rate-limited`:
the network's 60 anonymous API calls an hour had been spent on testing.

Second real update, the same day: from `f767beb` (installed by the first
update) to Latest `test-20261127-f53abdc`, the first release with
`update-manifest.json` (17,519 bytes, 352 commits of history). `f767beb`
predates the manifest, so it decided through the API, after waiting for the
network's anonymous limit to reset once more (other software on the same
network had spent it this time). Quit 04:42:58 UTC, new copy started
04:43:07; `c3bd079`, universal, signature valid, nothing left in
`/Applications` or the update folder. Its own check then read the manifest
(`source: manifest`) and reported itself current without an API call.

**History rewritten on 2026-11-27.** Before the public launch the owner had
personal details removed from the repository's history: every commit now
carries the GitHub no-reply identity, and local folder paths in old files read
`/Users/me/...`. Every commit ID changed; the IDs cited in these documents
were mapped to the new ones, release tag names were kept as they were. All
earlier releases and tags were deleted. A copy built before the rewrite
records a commit GitHub no longer has, so its check says it cannot tell
(`current-commit-not-on-github`) and offers the release page: download the
newest build by hand once, and later builds update themselves again.

Not verified on a real machine yet: whether the keychain prompt appears
after the swap, the Accessibility and Screen Recording permissions after it,
and the Windows replacement of a test build.

## Personal Mesh evidence and release classes

The current `0.10.1-preview.1` evidence is intentionally layered. The full Node
suite contains 527 tests: 526 pass, 1 Windows-only test is skipped, and 0 fail.
TaskPackage security is 25/25, release security is 14/14, and real Electron UI
acceptance is 21/21. The current thin-arm64 macOS unpacked artifact passes the
independent fuse/ASAR verifier and its three-launch mock-Keychain first-use
smoke; the universal CI and system-Keychain boundaries remain open.
Isolated direct-LAN and local-signaling E2E runs both complete authentication,
catalog/inventory, refresh, SessionPointer, a 184,333-byte file, and a synthetic
remote view; that runner does not send a TaskPackage, so it is not a
TaskPackage data-plane E2E.

The physical evidence is narrower. Two real Macs have established
an authenticated host/UDP DataChannel on one LAN and imported a 562,009-byte
inventory containing 9 slots and 638 session replicas. Explicit refresh and the
four-minute full-snapshot recovery baseline advanced revisions 7 → 8 → 9, and
the connection remained stable for five minutes. This closes that inventory
slice only; it does not close the complete two-device onboarding journey,
physical TaskPackage send/accept/reject/revoke/recovery, public NAT/coturn,
disconnect/sleep recovery, remote screen/input permissions, or any Windows
path.

The product model distinguishes two release classes:

- **Preview:** allowed before all physical gates close, but only when every
  artifact is signed, the macOS artifact is notarized, checksums are published,
  the version/tag is explicitly prerelease-shaped (for example
  `v0.10.1-preview.1`), and the GitHub Release is marked as a prerelease.
- **Stable:** allowed only after the full physical gate below has passed and a
  separately reviewed workflow change enables it. The historical `0.10.0`
  development baseline must not be republished retroactively as stable.

The current workflow is deliberately Preview-only: `STABLE_ALLOWED=false` and
the release-policy implementation reports `stableAllowed=false`. A stable tag
or non-Preview package version fails before build. Every created Release is a
Draft prerelease first, and publication preserves `prerelease=true`. Enabling a
stable channel later requires an owner-approved plan and workflow change; it is
not inferred from a tag suffix.

## Personal Mesh stable-release gate

The desktop code may be packaged as a Preview before the Personal Mesh is
described as a stable public feature. A stable claim for attended remote access
requires all of the following:

1. Extend the existing two-Mac LAN inventory evidence through disconnect,
   sleep/wake, long-lived reachability, revocation/reconnect, real NAT/CGNAT,
   and forced coturn paths recorded in `PERSONAL_AGENT_MESH_PLAN.md`.
2. Exercise macOS-to-macOS, macOS-to-Windows, Windows-to-macOS, and
   Windows-to-Windows screen/input paths, including multiple displays, DPI,
   keyboard layout, IME, permission denial, and revocation.
3. Deploy the Signaling Gateway behind HTTPS and verify forced TURN over UDP,
   TCP, and TLS; do not publish a long-lived TURN secret in the desktop app.
4. Confirm that diagnostics and logs contain no IP candidates, SDP, device
   private keys, account identifiers, project paths, or TURN credentials.
5. Keep unattended access disabled. Login-screen, lock-screen, UAC secure
   desktop, system service, and generic remote shell behavior are not part of
   this release.
6. Run a clean packaged first launch through creation of the first Agent and
   restart recovery; prove that the local transaction opens no listener,
   publishes no lease, and creates no remote connection. Existing profiles must
   use the migration preview.
7. On two physical devices, complete both-sided identity confirmation, member
   trust, authenticated connection, catalog storage, and inventory storage;
   also verify accurate resume after offline/restart without pairing again.
8. Run TaskPackage over the real Electron WebRTC data plane and on physical
   devices through accept, reject, permission revocation, device revocation,
   disconnect recovery, import, and same-ciphertext portable fallback. Repeat
   the staging/handle cleanup matrix on Windows. Authenticated transport may
   establish source device ID/name; source Agent name and handoff person remain
   package-declared fields and must not be presented as catalog-authenticated.

The macOS verifier explicitly checks that
`Contents/Resources/native/AgentDeskInputHelper` exists, is universal, carries
a valid Developer ID signature, and uses the same Apple team as the app. The
Windows build must compile `AgentDeskInputHelper.exe` with MSVC and include only
the two fixed helper names declared in `extraResources`. The Windows helper,
packaged app, and outer portable executable must all use the same trusted signer
and carry RFC 3161 timestamps.

## Publishing

The Preview transaction is fail-closed and non-overwriting:

1. Update `package.json` and `package-lock.json`, run syntax, documentation,
   Node, UI, package, release-security, and applicable physical checks, then
   commit the exact candidate.
2. Confirm the protected `preview-release` environment, private macOS/Windows
   credentials, repository/organization Actions variables `APPLE_TEAM_ID` and
   `WIN_SIGNER_THUMBPRINT`, and protected Preview tag policy are configured.
   The current `STABLE_ALLOWED: "false"` must remain in force. `release-policy`
   fails before native jobs if either identity variable is absent or malformed.
3. Push a new protected Preview tag whose version exactly matches
   `package.json`. For `workflow_dispatch`, select that same protected tag as
   the workflow ref and enter the identical tag in `inputs.tag`; dispatching
   from `main` or a different ref is rejected. `release-policy` resolves one
   exact commit contained in `origin/main`, and every downstream checkout uses
   that commit SHA. Draft creation, publication, the public metadata gate, and
   the final seal re-read the protected tag and fail if it no longer resolves
   to the same commit. An existing Release, tag transaction, or previously
   burned candidate is rejected; do not overwrite or reuse it.
4. The native macOS and Windows jobs build, sign, verify, and smoke their exact
   outputs. A separate read-only assembly job accepts exactly these three
   Release assets and no others:
   - `Catshelf-<version>-universal.dmg`
   - `Catshelf-<version>-portable-x64.exe`
   - `SHA256SUMS.txt`
5. `create-draft` creates a Preview Draft containing only those assets.
   Diagnostics remain private Actions artifacts and must never be uploaded to
   the Release.
6. `verify-draft-macos` and `verify-draft-windows` use authenticated GitHub API
   access to re-download the Draft DMG/portable plus checksum manifest on their
   native systems. They recheck pre-publication digest, manifest, downloaded
   bytes, signatures, notarization/timestamps, publisher binding, fuses/ASAR,
   and the three-launch packaged first-use smoke.
7. Only after both Draft verifiers pass may `publish-release` change the Draft
   to a public prerelease. Asset identity, size, and upload state are re-read
   immediately before publication.
8. `verify-public-metadata`, `verify-public-macos`, and
   `verify-public-windows` then run without a GitHub token. They read public
   metadata and anonymously download the exact public assets, repeat byte,
   signature, fuse/ASAR, publisher, and first-use checks, and prove that the
   pre-publication hashes, `SHA256SUMS.txt`, and downloaded bytes agree.
9. `seal-public-release` performs a final anonymous metadata read-back and
   records the hosted-runner seal. Only then is the GitHub transaction complete.
10. Each public verifier has its own fail-only rollback watcher. A failed or
    cancelled metadata, macOS, or Windows public gate immediately invokes the
    shared idempotent rollback without waiting for either 45-minute native job.
    The watcher has no protected environment; it only receives
    `contents: write` for the rollback step. `redraft-on-release-failure`
    remains the final transaction-wide fallback after all dependencies settle.
    Both paths preserve the captured release/asset identity checks, return every
    observed same-tag/original release to Draft, and mark any publicly exposed
    or identity-drifted candidate as candidate-burned. Its Tag/version must
    never be reused.

Only `create-draft`, `publish-release`, the three fail-only public rollback
watchers, and `redraft-on-release-failure` receive `contents: write`; build,
assembly, Draft verification, anonymous public verification, and sealing jobs
are read-only. The anonymous verifier jobs have no token, secret, protected
environment, or write permission. A green native build cannot publish by
itself.

## Hosted-runner and physical-download boundary

The completed hosted-runner transaction proves that GitHub served the expected
public URL, asset names, metadata, bytes, checksums, signatures, fuse/ASAR
layout, and automated first-use behavior on native runners. It does not prove
what a real user receives after browser or messaging-app download.

Before telling other people to install a candidate, use physical clean machines
to cover macOS quarantine/Gatekeeper/install/first-use/restarts and Windows
Mark-of-the-Web, SmartScreen, Defender, UAC, Authenticode UI, portable launch,
first-use, and restarts. Record the actual public URLs and hashes. Until that
gate passes, “other people can download, install, and use it” remains open even
after the hosted-runner seal.

No public Preview currently satisfies this sequence. Do not create a manual
public Release to work around missing signing credentials, environment
protection, a failed Draft verifier, or a failed physical download test.

## v0.9.0 incident

The unsigned universal macOS bundle published as `v0.9.0` is rejected by Apple
with `errSecCSRevokedNotarization`. Do not tell users to clear quarantine,
disable SIP, or otherwise bypass Gatekeeper for that binary. Mark the affected
DMG as withdrawn and direct macOS users to the first signed, notarized release
that passes this workflow.
