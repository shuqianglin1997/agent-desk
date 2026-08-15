# Release guide

AgentDesk release artifacts are built by `.github/workflows/release.yml`. A tag
must never publish an unsigned Windows portable executable or an unsigned or
unnotarized macOS DMG.

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
5. Verify the packaged `AgentDesk.exe` and the fixed
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
3. `RunAsNode` remains enabled only because the existing fixed launchers in
   `src/cli-discovery.js` and `src/codex-quota.js` use it. Adding another caller
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
`AgentDesk.app`, a `win-unpacked` directory, or the exact versioned portable. It
checks the fixed window shell, one first Agent/local device, zero default
Profiles, zero remote devices or Mesh connections, and strict process/debug
loopback cleanup. A random launch token and the Browser command line bind the
DevTools page to that exact launch; cleanup only signals the original spawned
process handle and never resolves a new process from a reusable PID. All three
launches must use the same candidate bytes. On macOS, only userData is
temporary. The ad-hoc `main` compatibility job explicitly passes
`--macos-ci-mock-keychain`; the smoke runner first proves the artifact is an
ad-hoc-signed `AgentDesk.app`: it explicitly verifies every architecture,
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

The outer portable, packaged `AgentDesk.exe`, and
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
npm run verify:electron-package -- --artifact release/mac-arm64/AgentDesk.app
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

## Personal Mesh evidence and release classes

The current `0.10.1-preview.1` evidence is intentionally layered. The full Node
suite contains 526 tests: 525 pass, 1 Windows-only test is skipped, and 0 fail.
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
   - `AgentDesk-<version>-universal.dmg`
   - `AgentDesk-<version>-portable-x64.exe`
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
