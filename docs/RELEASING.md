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

## Personal Mesh release gate

The desktop code may be packaged for development before the Personal Mesh is
described as a stable public feature. A public claim for attended remote access
also requires all of the following:

1. Complete the two-physical-device and real NAT/coturn matrix recorded in
   `PERSONAL_AGENT_MESH_PLAN.md`.
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

The macOS verifier explicitly checks that
`Contents/Resources/native/AgentDeskInputHelper` exists, is universal, carries
a valid Developer ID signature, and uses the same Apple team as the app. The
Windows build must compile `AgentDeskInputHelper.exe` with MSVC and include only
the two fixed helper names declared in `extraResources`.

## Publishing

1. Update both `package.json` and `package-lock.json` to the new version.
2. Run the checks and tests.
3. Commit the release changes.
4. Push a matching tag, for example `v0.9.1`.
5. Wait for both native build jobs and the macOS security verification to pass.
6. Confirm the published `SHA256SUMS.txt` matches the downloadable artifacts.

The workflow refuses a tag whose version does not exactly match
`package.json`.

## v0.9.0 incident

The unsigned universal macOS bundle published as `v0.9.0` is rejected by Apple
with `errSecCSRevokedNotarization`. Do not tell users to clear quarantine,
disable SIP, or otherwise bypass Gatekeeper for that binary. Mark the affected
DMG as withdrawn and direct macOS users to the first signed, notarized release
that passes this workflow.
