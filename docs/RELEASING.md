# Release guide

AgentDesk release artifacts are built by `.github/workflows/release.yml`. A tag
must never publish an unsigned or unnotarized macOS DMG.

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

## Required GitHub Actions secrets

Signing always requires:

- `MAC_CSC_LINK` — base64-encoded `.p12` containing a current Developer ID
  Application certificate and private key.
- `MAC_CSC_KEY_PASSWORD` — password used when exporting that `.p12`.
- `APPLE_TEAM_ID` — the 10-character Apple Developer team ID.

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
```

For a production-equivalent macOS build, export the same signing and
notarization variables used by CI, then run:

```bash
npm run build:mac
npm run verify:mac-release
```

The release build intentionally fails when no valid signing identity is
available.

## Personal Mesh evidence and release classes

The current `0.10.1-preview.1` evidence is intentionally layered. The full Node
suite contains 490 tests: 489 pass, 1 Windows-only test is skipped, and 0 fail.
TaskPackage security is 25/25, the related first-use/device-journey/pairing/Main
IPC/TaskPackage UI batch is 47/47, and real Electron UI acceptance is 21/21.
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

There are two release classes:

- **Preview:** allowed before all physical gates close, but only when every
  artifact is signed, the macOS artifact is notarized, checksums are published,
  the version/tag is explicitly prerelease-shaped (for example
  `v0.10.1-preview.1`), and the GitHub Release is marked as a prerelease.
- **Stable:** allowed only after the full physical gate below has passed. The
  current candidate is `0.10.1-preview.1`. The historical `0.10.0` development
  baseline must not be republished retroactively as stable; the approved
  sequence is Preview candidates followed by stable `v0.10.1` after the gates
  close.

The workflow now derives GitHub's prerelease flag from a prerelease-suffixed
tag and package version. The first Preview publish must still verify the
resulting Release classification; that label does not close any product gate.

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
the two fixed helper names declared in `extraResources`.

## Publishing

1. Update both `package.json` and `package-lock.json` to the new version.
2. Run syntax, documentation, Node, UI, and relevant physical checks.
3. Commit the release changes.
4. Choose the release class. Before the physical gates close, use an explicit
   prerelease version such as `0.10.1-preview.1`; after they close, use the
   stable version such as `0.10.1`.
5. Confirm the workflow will set GitHub `prerelease: true` for a Preview and
   `false` only for a gate-approved stable release, then push the matching tag.
6. Wait for both native build jobs and the macOS security verification to pass.
7. Confirm the published `SHA256SUMS.txt` matches the downloadable artifacts
   and the Release page shows the intended Preview/stable class.

The workflow refuses a tag whose version does not exactly match
`package.json`.

## v0.9.0 incident

The unsigned universal macOS bundle published as `v0.9.0` is rejected by Apple
with `errSecCSRevokedNotarization`. Do not tell users to clear quarantine,
disable SIP, or otherwise bypass Gatekeeper for that binary. Mark the affected
DMG as withdrawn and direct macOS users to the first signed, notarized release
that passes this workflow.
