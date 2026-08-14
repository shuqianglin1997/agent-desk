const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const packageJson = require('../package.json');
const packageLock = require('../package-lock.json');

function major(version) {
  return Number(String(version).replace(/^[^0-9]*/, '').split('.')[0]);
}

function assertOrdered(contents, markers, label) {
  let previous = -1;
  for (const marker of markers) {
    const next = contents.indexOf(marker, previous + 1);
    assert.ok(next > previous, `${label}: expected ${marker} after the preceding release gate`);
    previous = next;
  }
}

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith('.js') ? [absolutePath] : [];
  });
}

test('macOS 正式构建强制签名、公证和 Hardened Runtime', () => {
  const macCi = fs.readFileSync(path.join(root, '.github', 'workflows', 'macos-ci.yml'), 'utf8');
  const workflowDirectory = path.join(root, '.github', 'workflows');
  const workflowContents = fs.readdirSync(workflowDirectory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .map((name) => ({
      name,
      contents: fs.readFileSync(path.join(workflowDirectory, name), 'utf8')
    }));
  const semanticMockKeychainUsers = workflowContents
    .filter(({ contents }) => contents.includes('--macos-ci-mock-keychain'))
    .map(({ name }) => name)
    .sort();
  const nativeMockKeychainUsers = workflowContents
    .filter(({ contents }) => contents.includes('--use-mock-keychain'))
    .map(({ name }) => name)
    .sort();

  assert.equal(packageJson.build.mac.forceCodeSigning, true);
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.equal(packageJson.build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(packageJson.build.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');
  assert.equal(packageJson.build.asar, true);
  assert.equal(packageJson.build.electronFuses.runAsNode, true);
  assert.equal(packageJson.build.electronFuses.enableNodeOptionsEnvironmentVariable, false);
  assert.equal(packageJson.build.electronFuses.enableNodeCliInspectArguments, false);
  assert.equal(packageJson.build.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
  assert.equal(packageJson.build.electronFuses.onlyLoadAppFromAsar, true);

  assert.match(packageJson.scripts['build:mac:dir'], /identity=-/);
  assert.match(packageJson.scripts['build:mac:dir'], /notarize=false/);
  assert.doesNotMatch(packageJson.scripts['build:mac:dir'], /electronDist/);
  assert.match(packageJson.scripts['build:mac:ci'], /identity=-/);
  assert.match(packageJson.scripts['build:mac:ci'], /notarize=false/);
  assert.match(packageJson.scripts['build:mac:ci'], /--universal/);
  assert.doesNotMatch(packageJson.scripts['build:mac:ci'], /electronDist/);
  assert.doesNotMatch(packageJson.scripts['build:dir'], /electronDist/);
  assert.equal(packageJson.scripts['accept:packaged'], 'node scripts/packaged-first-use-smoke.js');
  assert.equal(
    packageJson.scripts['verify:electron-package'],
    'node scripts/verify-electron-package-integrity.js'
  );
  assert.match(packageJson.scripts.check, /node --check scripts\/packaged-first-use-smoke\.js/);
  assert.match(packageJson.scripts.check, /node --check scripts\/verify-electron-package-integrity\.js/);
  assert.match(packageJson.scripts.check, /node --check scripts\/github-release-gate\.js/);
  assert.match(macCi, /npm run build:mac:ci/);
  assert.doesNotMatch(macCi, /npm run build:mac:dir/);
  assertOrdered(macCi, [
    '- name: Build unpacked macOS app',
    '- name: Resolve unique unpacked macOS app',
    '- name: Verify universal macOS package shape',
    '- name: Verify Electron fuses and ASAR integrity in unpacked macOS app',
    '- name: Smoke packaged first use in unpacked macOS app'
  ], 'macOS CI packaged smoke order');
  assert.match(macCi, /find release -type d -name 'AgentDesk\.app' -prune/);
  assert.match(macCi, /Expected exactly one unpacked AgentDesk\.app/);
  assert.match(macCi, /lipo -archs "\$PACKAGED_APP\/Contents\/MacOS\/AgentDesk"/);
  assert.match(macCi, /Contents\/Resources\/native\/AgentDeskInputHelper/);
  assert.match(macCi, /arm64/);
  assert.match(macCi, /x86_64/);
  assert.match(macCi, /npm run verify:electron-package -- --artifact "\$PACKAGED_APP"/);
  assert.match(
    macCi,
    /npm run accept:packaged -- --artifact "\$PACKAGED_APP" --artifacts "\$SMOKE_ARTIFACTS" --macos-ci-mock-keychain/
  );
  assert.deepEqual(semanticMockKeychainUsers, ['macos-ci.yml']);
  assert.deepEqual(nativeMockKeychainUsers, []);
  assert.match(
    macCi,
    /- name: Upload macOS smoke diagnostics\s+if: failure\(\)\s+uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );

  for (const relativePath of [
    packageJson.build.mac.entitlements,
    packageJson.build.mac.entitlementsInherit
  ]) {
    const contents = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(contents, /com\.apple\.security\.cs\.allow-jit/);
    assert.doesNotMatch(contents, /com\.apple\.security\.cs\.allow-unsigned-executable-memory/);
    assert.doesNotMatch(contents, /com\.apple\.security\.cs\.disable-library-validation/);
    assert.doesNotMatch(contents, /com\.apple\.security\.get-task-allow/);
  }
});

test('RunAsNode 兼容面只限现有 Main 固定 CLI launcher', () => {
  const sources = listJavaScriptFiles(path.join(root, 'src')).map((filePath) => ({
    filePath,
    relativePath: path.relative(root, filePath).split(path.sep).join('/'),
    contents: fs.readFileSync(filePath, 'utf8')
  }));
  const runAsNodeSources = sources
    .filter((source) => source.contents.includes('ELECTRON_RUN_AS_NODE'))
    .map((source) => source.relativePath)
    .sort();

  // RunAsNode remains enabled only for these existing, fixed known-CLI
  // launchers. Replacing them with a controlled external Node runtime is a
  // separate migration; new production call sites must not expand this fuse.
  assert.deepEqual(runAsNodeSources, [
    'src/cli-discovery.js',
    'src/codex-quota.js'
  ]);
  for (const relativePath of runAsNodeSources) {
    const contents = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(contents, /command: options\.nodeExecutable \|\| process\.execPath/);
    assert.match(contents, /extraEnv: \{ ELECTRON_RUN_AS_NODE: '1' \}/);
  }

  const productionSource = sources.map((source) => source.contents).join('\n');
  assert.doesNotMatch(productionSource, /\bNODE_OPTIONS\b/);
  assert.doesNotMatch(productionSource, /--inspect(?:-brk)?\b/);
});

test('发布工作流缺少凭据时失败，并验证两端最终产物及内层程序', async () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const macVerifier = fs.readFileSync(path.join(root, 'scripts', 'verify-macos-release.sh'), 'utf8');
  const windowsVerifier = fs.readFileSync(path.join(root, 'scripts', 'verify-windows-release.ps1'), 'utf8');
  const windowsPortablePackageVerifier = fs.readFileSync(
    path.join(root, 'scripts', 'verify-windows-portable-package.ps1'),
    'utf8'
  );
  const windowsTestAnnotations = require('../scripts/windows-test-annotations');
  const windowsCi = fs.readFileSync(path.join(root, '.github', 'workflows', 'windows-ci.yml'), 'utf8');
  const macJob = workflow.slice(
    workflow.indexOf('  build-macos:'),
    workflow.indexOf('  build-windows:')
  );
  const windowsJob = workflow.slice(
    workflow.indexOf('  build-windows:'),
    workflow.indexOf('  assemble-release-assets:')
  );

  assert.doesNotMatch(workflow, /--macos-ci-mock-keychain/);
  assert.doesNotMatch(workflow, /--use-mock-keychain/);

  for (const secret of [
    'MAC_CSC_LINK',
    'MAC_CSC_KEY_PASSWORD',
    'APPLE_API_KEY_BASE64'
  ]) {
    assert.ok(workflow.includes(`secrets.${secret}`), `${secret} is not wired into release CI`);
  }
  assert.doesNotMatch(workflow, /secrets\.APPLE_TEAM_ID/);
  assert.match(workflow, /APPLE_TEAM_ID: \$\{\{ vars\.APPLE_TEAM_ID \}\}/);
  assert.match(macJob, /APPLE_TEAM_ID: \$\{\{ needs\.release-policy\.outputs\.apple_team_id \}\}/);
  assert.match(workflow, /Require signing and notarization credentials/);
  assert.match(workflow, /npm run verify:mac-release/);
  assertOrdered(macJob, [
    '- name: Verify signed and notarized DMG',
    '- name: Resolve exact verified macOS DMG',
    '- name: Smoke exact final DMG from a read-only mount',
    '- name: Upload macOS artifact'
  ], 'macOS release final-artifact order');
  assert.match(macJob, /find release -maxdepth 1 -type f -name 'AgentDesk-\*-universal\.dmg'/);
  assert.match(macJob, /hdiutil attach -readonly -nobrowse -mountpoint/);
  assert.match(macJob, /find "\$mount_point" -maxdepth 2 -type d -name 'AgentDesk\.app' -prune/);
  assert.match(macJob, /npm run accept:packaged -- --artifact "\$\{app_paths\[0\]\}"/);
  assert.match(macJob, /hdiutil detach "\$mount_point"/);
  assert.match(macJob, /The verified macOS DMG changed during packaged smoke/);
  assert.match(macJob, /path: \$\{\{ steps\.mac_release\.outputs\.dmg_path \}\}/);
  assert.match(
    macJob,
    /- name: Upload macOS smoke diagnostics\s+if: failure\(\)\s+uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );

  assert.match(macVerifier, /codesign --verify --deep --strict/);
  assertOrdered(macVerifier, [
    'Verifying Electron fuses and packaged ASAR integrity',
    'verify-electron-package-integrity.js',
    'Verifying Developer ID signature'
  ], 'macOS native verifier package-integrity order');
  assert.match(macVerifier, /xcrun stapler validate/);
  assert.match(macVerifier, /spctl --assess --type execute/);
  assert.match(macVerifier, /syspolicy_check distribution/);
  assert.match(macVerifier, /APPLE_TEAM_ID/);
  assert.match(macVerifier, /lipo -archs/);
  assert.match(macVerifier, /Contents\/Resources\/native\/AgentDeskInputHelper/);
  assert.match(macVerifier, /Expected a universal input helper/);
  assert.match(macVerifier, /Verifying bundled input helper signature/);
  assert.match(macVerifier, /helper_team_identifier/);

  for (const secret of ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) {
    assert.ok(workflow.includes(`secrets.${secret}`), `${secret} is not wired into release CI`);
  }
  assert.doesNotMatch(workflow, /secrets\.WIN_SIGNER_THUMBPRINT/);
  assert.match(workflow, /WIN_SIGNER_THUMBPRINT: \$\{\{ vars\.WIN_SIGNER_THUMBPRINT \}\}/);
  assert.match(windowsJob, /WIN_SIGNER_THUMBPRINT: \$\{\{ needs\.release-policy\.outputs\.win_signer_thumbprint \}\}/);
  assert.deepEqual(packageJson.build.win.signExts, ['.exe']);
  assert.deepEqual(packageJson.build.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.equal(
    packageJson.build.win.signtoolOptions.rfc3161TimeStampServer,
    'http://timestamp.digicert.com'
  );
  assert.doesNotMatch(packageJson.scripts['build:win'], /forceCodeSigning/);
  assert.match(packageJson.scripts['build:win:release'], /win\.forceCodeSigning=true/);
  assert.match(packageJson.scripts['verify:win-release'], /verify-windows-release\.ps1/);
  assert.match(
    packageJson.scripts['verify:win-portable-package'],
    /verify-windows-portable-package\.ps1/
  );
  assert.match(workflow, /Require Authenticode PKCS#12 credentials/);
  assert.match(workflow, /npm run build:win:release/);
  assert.match(workflow, /npm run verify:win-release/);
  assert.match(workflow, /dist-windows-signed/);
  assertOrdered(windowsJob, [
    '- name: Resolve signed Windows win-unpacked package',
    '- name: Verify Electron fuses and ASAR layout in signed win-unpacked',
    '- name: Verify trusted and timestamped Windows artifact',
    '- name: Bind Windows artifact to protected publisher identity',
    '- name: Resolve exact verified Windows portable and record SHA-256',
    '- name: Smoke exact final Windows portable',
    '- name: Verify Windows portable SHA-256 unchanged after smoke',
    '- name: Upload Windows artifact'
  ], 'Windows release final-artifact order');
  assert.match(windowsJob, /Expected exactly one signed win-unpacked directory/);
  assert.match(windowsJob, /npm run verify:electron-package -- --artifact "\$env:PACKAGED_ARTIFACT"/);
  assert.match(windowsJob, /Get-FileHash -LiteralPath \$portable\.FullName -Algorithm SHA256/);
  assert.match(windowsJob, /PORTABLE_PATH: \$\{\{ steps\.windows_release\.outputs\.portable_path \}\}/);
  assert.match(windowsJob, /npm run accept:packaged -- --artifact "\$env:PORTABLE_PATH"/);
  assert.match(windowsJob, /The verified Windows portable executable changed during packaged smoke/);
  assert.match(windowsJob, /path: \$\{\{ steps\.windows_release\.outputs\.portable_path \}\}/);
  assert.match(
    windowsJob,
    /- name: Upload Windows smoke diagnostics\s+if: failure\(\)\s+uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );

  assert.match(windowsVerifier, /Get-AuthenticodeSignature/);
  assert.match(windowsVerifier, /SignatureStatus\]::Valid/);
  assert.match(windowsVerifier, /1\.3\.6\.1\.5\.5\.7\.3\.3/);
  assert.match(windowsVerifier, /1\.3\.6\.1\.5\.5\.7\.3\.8/);
  assert.match(windowsVerifier, /TimeStamperCertificate/);
  assert.match(windowsVerifier, /Expand-WithSevenZip/);
  assert.match(windowsVerifier, /Expected exactly one AgentDesk\.exe/);
  assert.match(windowsVerifier, /resources\\native\\AgentDeskInputHelper\.exe/);
  assert.match(windowsVerifier, /ExpectedSignerThumbprint\/WIN_SIGNER_THUMBPRINT is required/);
  assert.match(windowsVerifier, /signer certificate does not match the required publisher identity/);
  assertOrdered(windowsVerifier, [
    'ExpectedSignerThumbprint/WIN_SIGNER_THUMBPRINT is required',
    '$outerSignerThumbprint = Assert-TrustedTimestampedSignature',
    '$sevenZip = Resolve-SevenZip',
    'Expand-WithSevenZip -SevenZip $sevenZip'
  ], 'Windows publisher identity must be verified before any 7-Zip extraction');
  assert.match(windowsVerifier, /verify-electron-package-integrity\.js/);
  assertOrdered(windowsVerifier, [
    'Expected exactly one AgentDesk.exe inside the final portable artifact',
    "verify-electron-package-integrity.js",
    "resources\\native\\AgentDeskInputHelper.exe",
    "Assert-TrustedTimestampedSignature"
  ], 'Windows native verifier package-integrity order');

  assert.match(windowsCi, /unsigned Windows compatibility artifact \(not for distribution\)/);
  assert.match(windowsCi, /CSC_IDENTITY_AUTO_DISCOVERY: "false"/);
  assert.equal(
    packageJson.scripts['test:ci:windows'],
    'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/windows-test-annotations.js --test-reporter-destination=stderr'
  );
  assert.match(packageJson.scripts.check, /node --check scripts\/windows-test-annotations\.js/);
  assert.match(windowsCi, /- name: Test\s+run: npm run test:ci:windows/);
  assert.doesNotMatch(windowsCi, /run: npm test/);
  assert.match(windowsCi, /npm run build:win/);
  assertOrdered(windowsCi, [
    '- name: Build unsigned Windows compatibility artifact (not for distribution)',
    '- name: Resolve unique Windows compatibility artifacts',
    '- name: Verify Electron fuses and ASAR layout in win-unpacked',
    '- name: Smoke packaged first use in win-unpacked',
    '- name: Verify Electron fuses and ASAR layout inside Windows portable',
    '- name: Smoke packaged first use in Windows portable'
  ], 'Windows CI packaged smoke order');
  assert.match(windowsCi, /Expected exactly one win-unpacked directory/);
  assert.match(windowsCi, /Expected exactly one Windows portable executable/);
  assert.match(windowsCi, /steps\.packaged_artifacts\.outputs\.unpacked/);
  assert.match(windowsCi, /npm run verify:electron-package -- --artifact "\$env:PACKAGED_ARTIFACT"/);
  assert.match(windowsCi, /steps\.packaged_artifacts\.outputs\.portable/);
  assert.match(windowsCi, /npm run verify:win-portable-package -- -PortablePath "\$env:PACKAGED_ARTIFACT"/);
  assert.match(
    windowsCi,
    /- name: Upload Windows smoke diagnostics\s+if: failure\(\)\s+uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
  );
  assert.equal(
    (windowsCi.match(/uses: actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/g) || []).length,
    1
  );
  assert.match(windowsCi, /Parse Windows release verifiers/);
  assert.match(windowsCi, /scripts\/verify-windows-portable-package\.ps1/);
  assert.match(windowsCi, /scripts\/verify-windows-release\.ps1/);
  assert.match(windowsCi, /scripts\/verify-windows-publisher\.ps1/);
  assert.doesNotMatch(windowsCi, /build:win:release|verify:win-release|dist-windows/);

  assert.match(windowsPortablePackageVerifier, /Parameter\(Mandatory = \$true\).*PortablePath/s);
  assert.match(windowsPortablePackageVerifier, /AgentDesk-\$\(\$packageJson\.version\)-portable-x64\.exe/);
  assert.match(windowsPortablePackageVerifier, /Resolve-SevenZip/);
  assert.match(windowsPortablePackageVerifier, /Expand-WithSevenZip/);
  assert.match(windowsPortablePackageVerifier, /\| Out-Host/);
  assert.match(windowsPortablePackageVerifier, /Expected exactly one AgentDesk\.exe inside the Windows portable artifact/);
  assert.match(windowsPortablePackageVerifier, /verify-electron-package-integrity\.js/);
  assert.match(windowsPortablePackageVerifier, /resources\\native\\AgentDeskInputHelper\.exe/);
  assert.match(windowsPortablePackageVerifier, /Directory\]::Delete\(\$temporaryRoot, \$true\)/);
  assert.doesNotMatch(windowsPortablePackageVerifier, /Get-AuthenticodeSignature|ExpectedSignerThumbprint/);

  async function* diagnosticEvents() {
    yield {
      type: 'test:fail',
      data: {
        file: 'c:/repo/test/windows-cleanup.test.js',
        name: 'rejects C:\\Users\\Alice Smith\\Company, Secret; private\\private.txt token=do-not-publish',
        nesting: 1,
        testNumber: 2,
        line: 84,
        column: 3,
        details: {
          error: {
            failureType: 'testCodeFailure',
            stack: 'private stack must not be reported'
          }
        }
      }
    };
    yield {
      type: 'test:fail',
      data: {
        file: 'C:\\repo\\test\\windows-cleanup.test.js',
        name: 'Windows cleanup suite',
        nesting: 0,
        testNumber: 1,
        line: 80,
        column: 1,
        details: { error: { failureType: 'subtestsFailed' } }
      }
    };
  }
  const annotations = [];
  for await (const chunk of windowsTestAnnotations(diagnosticEvents())) annotations.push(chunk);
  const annotationOutput = annotations.join('');
  assert.match(
    annotationOutput,
    /::error title=Windows Node test failed::windows-cleanup\.test\.js › rejects <path>/
  );
  assert.equal((annotationOutput.match(/::error/g) || []).length, 1);
  assert.equal(
    windowsTestAnnotations.sanitizeFailureName('/Users/Alice Smith/Client, Secret/data.json remains private'),
    '<path>'
  );
  assert.equal(
    windowsTestAnnotations.sanitizeFailureName(
      'credentials access_token=do-not-publish AWS_SESSION_TOKEN=short-secret Authorization: Bearer private-bearer'
    ),
    'credentials access_token=<redacted> AWS_SESSION_TOKEN=<redacted> Authorization=<redacted>'
  );
  assert.equal(
    windowsTestAnnotations.sanitizeFailureName('request used Bearer private-bearer'),
    'request used Bearer <redacted>'
  );
  assert.doesNotMatch(
    annotationOutput,
    /Alice|Company Secret|Client Secret|do-not-publish|short-secret|private-bearer|private stack/
  );

  async function* node22FailureEvents() {
    yield {
      type: 'test:fail',
      data: {
        file: 'c:/repo/test/left.test.js',
        name: 'same leaf',
        nesting: 1,
        testNumber: 2,
        line: 11,
        column: 3,
        details: { error: { failureType: 'testCodeFailure' } }
      }
    };
    yield {
      type: 'test:fail',
      data: {
        file: 'C:\\repo\\test\\right.test.js',
        name: 'same leaf',
        nesting: 1,
        testNumber: 2,
        line: 11,
        column: 3,
        details: { error: { failureType: 'testCodeFailure' } }
      }
    };
    yield {
      type: 'test:fail',
      data: {
        file: 'C:\\repo\\test\\left.test.js',
        name: 'same leaf',
        nesting: 1,
        testNumber: 2,
        line: 11,
        column: 3,
        details: { error: { failureType: 'testCodeFailure' } }
      }
    };
  }
  const interleavedAnnotations = [];
  for await (const chunk of windowsTestAnnotations(node22FailureEvents())) {
    interleavedAnnotations.push(chunk);
  }
  const interleavedOutput = interleavedAnnotations.join('');
  assert.match(interleavedOutput, /::error title=Windows Node test failed::left\.test\.js › same leaf/);
  assert.match(interleavedOutput, /::error title=Windows Node test failed::right\.test\.js › same leaf/);
  assert.equal((interleavedOutput.match(/left\.test\.js › same leaf/g) || []).length, 2);
  assert.equal((interleavedOutput.match(/::error/g) || []).length, 3);

  async function* ambiguousFileEvents() {
    yield {
      type: 'test:fail',
      data: {
        file: 'relative.test.js',
        name: 'standalone child',
        nesting: 1,
        testNumber: 2,
        line: 4,
        column: 1,
        details: { error: { failureType: 'testCodeFailure' } }
      }
    };
  }
  const ambiguousAnnotations = [];
  for await (const chunk of windowsTestAnnotations(ambiguousFileEvents())) {
    ambiguousAnnotations.push(chunk);
  }
  const ambiguousOutput = ambiguousAnnotations.join('');
  assert.match(ambiguousOutput, /::error title=Windows Node test failed::standalone child/);
  assert.doesNotMatch(ambiguousOutput, /untrusted parent/);
});

test('主分支 macOS 和 Windows CI 只运行固定 SHA action 且 checkout 不留凭据', () => {
  for (const workflowName of ['macos-ci.yml', 'windows-ci.yml']) {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', workflowName), 'utf8');
    const actionReferences = [...workflow.matchAll(/uses: (actions\/[A-Za-z0-9_.-]+)@([^\s]+)/g)];
    assert.ok(actionReferences.length > 0, `${workflowName} has no first-party action references`);
    for (const [, action, reference] of actionReferences) {
      assert.match(reference, /^[a-f0-9]{40}$/, `${workflowName} ${action} is not pinned to a commit SHA`);
    }
    assert.equal(
      (workflow.match(/uses: actions\/checkout@[a-f0-9]{40}/g) || []).length,
      (workflow.match(/persist-credentials: false/g) || []).length,
      `${workflowName} must disable persisted credentials on every checkout`
    );
    assert.doesNotMatch(workflow, /uses: [^\s]+@v\d/);
  }
});

test('桌面包只携带固定名称的原生输入 helper', () => {
  const resources = packageJson.build.extraResources;
  assert.deepEqual(resources, [{
    from: 'native/bin',
    to: 'native',
    filter: ['AgentDeskInputHelper', 'AgentDeskInputHelper.exe']
  }]);
  assert.equal(packageJson.build.beforePack, 'scripts/build-native-helpers.js');
});

test('GitHub Release 采用 draft 预验、匿名复验和失败回草稿事务', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const publicGate = fs.readFileSync(path.join(root, 'scripts', 'github-release-gate.js'), 'utf8');
  const releaseRollback = fs.readFileSync(
    path.join(root, 'scripts', 'redraft-github-release.sh'),
    'utf8'
  );
  const windowsPublisher = fs.readFileSync(
    path.join(root, 'scripts', 'verify-windows-publisher.ps1'),
    'utf8'
  );

  assert.match(workflow, /^permissions:\s+contents: read/m);
  assert.equal((workflow.match(/^\s{6}contents: write$/gm) || []).length, 6);
  assert.match(workflow, /STABLE_ALLOWED: "false"/);
  assert.match(workflow, /Manual release runs must be dispatched from the same protected Preview tag supplied in inputs\.tag/);
  assert.match(workflow, /DISPATCH_REF" != "refs\/tags\/\$TARGET_TAG"/);
  assert.match(workflow, /Automatic releases require a protected tag\/ruleset/);
  assert.match(workflow, /git merge-base --is-ancestor HEAD refs\/remotes\/origin\/main/);
  assert.match(workflow, /target release tag commit must be contained in origin\/main/);
  assert.match(workflow, /APPLE_TEAM_ID: \$\{\{ vars\.APPLE_TEAM_ID \}\}/);
  assert.match(workflow, /WIN_SIGNER_THUMBPRINT: \$\{\{ vars\.WIN_SIGNER_THUMBPRINT \}\}/);
  assert.equal((workflow.match(/\$\{\{ vars\.APPLE_TEAM_ID \}\}/g) || []).length, 1);
  assert.equal((workflow.match(/\$\{\{ vars\.WIN_SIGNER_THUMBPRINT \}\}/g) || []).length, 1);
  assert.doesNotMatch(workflow, /secrets\.(?:APPLE_TEAM_ID|WIN_SIGNER_THUMBPRINT)/);
  assert.match(workflow, /\^\[A-Z0-9\]\{10\}\$/);
  assert.match(workflow, /\^\[A-Fa-f0-9\]\{40\}\$/);
  assert.match(workflow, /printf 'commit_sha=%s\\n' "\$\(git rev-parse HEAD\)"/);
  assert.match(workflow, /apple_team_id: \$\{\{ steps\.policy\.outputs\.apple_team_id \}\}/);
  assert.match(workflow, /win_signer_thumbprint: \$\{\{ steps\.policy\.outputs\.win_signer_thumbprint \}\}/);
  assert.match(workflow, /printf 'apple_team_id=%s\\n' "\$APPLE_TEAM_ID"/);
  assert.match(workflow, /printf 'win_signer_thumbprint=%s\\n'/);
  assert.match(
    workflow,
    /Automatic releases require a protected tag\/ruleset\.'[\s\S]*?\n          fi\n\n          if ! git show-ref --verify --quiet refs\/remotes\/origin\/main/
  );
  assertOrdered(workflow.slice(
    workflow.indexOf('  release-policy:'),
    workflow.indexOf('  build-macos:')
  ), [
    'if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]',
    "echo '::error::Automatic releases require a protected tag/ruleset.'",
    'if ! git show-ref --verify --quiet refs/remotes/origin/main',
    'git merge-base --is-ancestor HEAD refs/remotes/origin/main'
  ], 'release target ancestry is enforced after either trigger policy branch');
  assert.match(workflow, /environment: preview-release/);
  assert.equal(
    (workflow.match(/uses: actions\/checkout@[a-f0-9]{40}/g) || []).length,
    (workflow.match(/persist-credentials: false/g) || []).length
  );
  const downstreamWorkflow = workflow.slice(workflow.indexOf('  build-macos:'));
  assert.equal(
    (downstreamWorkflow.match(/uses: actions\/checkout@[a-f0-9]{40}/g) || []).length,
    (downstreamWorkflow.match(/ref: \$\{\{ needs\.release-policy\.outputs\.commit_sha \}\}/g) || []).length,
    'every downstream checkout must use the immutable commit resolved by release-policy'
  );
  assert.doesNotMatch(downstreamWorkflow, /ref: \$\{\{ needs\.release-policy\.outputs\.tag \}\}/);
  assert.match(workflow, /Revalidate protected Preview tag identity before Draft creation/);
  assert.match(workflow, /Revalidate protected Preview tag identity before publication/);
  assert.match(workflow, /Revalidate protected Preview tag identity in public metadata gate/);
  assert.match(workflow, /Revalidate protected Preview tag identity before final seal/);
  assert.equal((workflow.match(/refs\/tags\/\$RELEASE_TAG/g) || []).length, 4);
  assert.doesNotMatch(workflow, /uses: [^\s]+@v\d/);
  assert.doesNotMatch(workflow, /softprops\/action-gh-release|Download all build artifacts/);
  assert.doesNotMatch(workflow, /artifacts\/\*|release-assets\/\*/);
  assert.doesNotMatch(
    workflow,
    /^\s{6}(?:DOWNLOAD_DIR|DIAGNOSTICS_DIR):\s+\$\{\{ runner\.temp \}\}/gm,
    'runner.temp is unavailable in job-level env; release paths must be workspace-relative'
  );
  for (const workspaceRelativePath of [
    'DOWNLOAD_DIR: agentdesk-draft-macos-release-assets',
    'DIAGNOSTICS_DIR: agentdesk-release-diagnostics/draft-macos',
    'DOWNLOAD_DIR: agentdesk-draft-windows-release-assets',
    'DIAGNOSTICS_DIR: agentdesk-release-diagnostics\\draft-windows',
    'DIAGNOSTICS_DIR: agentdesk-release-diagnostics/public-metadata',
    'DOWNLOAD_DIR: agentdesk-public-macos-release-assets',
    'DIAGNOSTICS_DIR: agentdesk-release-diagnostics/public-macos',
    'DOWNLOAD_DIR: agentdesk-public-windows-release-assets',
    'DIAGNOSTICS_DIR: agentdesk-release-diagnostics\\public-windows',
    'DIAGNOSTICS_DIR: agentdesk-release-diagnostics/public-seal'
  ]) {
    assert.ok(workflow.includes(workspaceRelativePath), `missing workspace-relative release path: ${workspaceRelativePath}`);
  }

  assertOrdered(workflow, [
    '  assemble-release-assets:',
    '  create-draft:',
    '  verify-draft-macos:',
    '  verify-draft-windows:',
    '  publish-release:',
    '  verify-public-metadata:',
    '  verify-public-macos:',
    '  verify-public-windows:',
    '  redraft-on-public-metadata-failure:',
    '  redraft-on-public-macos-failure:',
    '  redraft-on-public-windows-failure:',
    '  seal-public-release:',
    '  redraft-on-release-failure:'
  ], 'release transaction job order');

  assert.match(workflow, /name: dist-macos-15\s+path: release-input\/macos/);
  assert.match(workflow, /name: dist-windows-signed\s+path: release-input\/windows/);
  assert.match(workflow, /Expected exactly two named build artifacts/);
  assert.match(workflow, /Release asset directory must contain exactly three files/);
  assert.match(workflow, /AgentDesk-%s-universal\.dmg/);
  assert.match(workflow, /AgentDesk-%s-portable-x64\.exe/);
  assert.match(workflow, /release-assets\/SHA256SUMS\.txt/);
  assert.match(workflow, /gh release create "\$RELEASE_TAG"[\s\S]*--draft[\s\S]*--prerelease/);
  assert.match(workflow, /Candidates are immutable and cannot be overwritten or reused/);
  assert.match(workflow, /asset_identity=.*\.assets\[\].*\.id.*\.size.*\.state/);
  assert.match(workflow, /A draft asset id, byte size, or upload state changed after native preverification/);
  assert.equal((workflow.match(/--release-id /g) || []).length, 6);
  assert.equal((workflow.match(/--asset-identity /g) || []).length, 6);
  assert.match(workflow, /release_id: \$\{\{ steps\.create\.outputs\.release_id \}\}/);
  assert.match(workflow, /asset_identity: \$\{\{ steps\.create\.outputs\.asset_identity \}\}/);

  const publishJob = workflow.slice(
    workflow.indexOf('  publish-release:'),
    workflow.indexOf('  verify-public-metadata:')
  );
  assertOrdered(publishJob, [
    '- verify-draft-macos',
    '- verify-draft-windows',
    'Draft state or exact asset allowlist changed after native preverification',
    '-F draft=false -F prerelease=true'
  ], 'publish requires both draft re-download gates');
  assert.match(publishJob, /timeout-minutes: 10/);
  assert.match(publishJob, /release_id: \$\{\{ steps\.publish\.outputs\.release_id \}\}/);
  assert.match(publishJob, /asset_identity: \$\{\{ steps\.publish\.outputs\.asset_identity \}\}/);

  const publicMetadataJob = workflow.slice(
    workflow.indexOf('  verify-public-metadata:'),
    workflow.indexOf('  verify-public-macos:')
  );
  const publicMacosJob = workflow.slice(
    workflow.indexOf('  verify-public-macos:'),
    workflow.indexOf('  verify-public-windows:')
  );
  const publicWindowsJob = workflow.slice(
    workflow.indexOf('  verify-public-windows:'),
    workflow.indexOf('  redraft-on-public-metadata-failure:')
  );
  const metadataRollbackJob = workflow.slice(
    workflow.indexOf('  redraft-on-public-metadata-failure:'),
    workflow.indexOf('  redraft-on-public-macos-failure:')
  );
  const macosRollbackJob = workflow.slice(
    workflow.indexOf('  redraft-on-public-macos-failure:'),
    workflow.indexOf('  redraft-on-public-windows-failure:')
  );
  const windowsRollbackJob = workflow.slice(
    workflow.indexOf('  redraft-on-public-windows-failure:'),
    workflow.indexOf('  seal-public-release:')
  );
  const sealJob = workflow.slice(
    workflow.indexOf('  seal-public-release:'),
    workflow.indexOf('  redraft-on-release-failure:')
  );
  const rollbackJob = workflow.slice(workflow.indexOf('  redraft-on-release-failure:'));
  for (const [job, timeout] of [
    [publicMetadataJob, 10],
    [publicMacosJob, 45],
    [publicWindowsJob, 45],
    [metadataRollbackJob, 10],
    [macosRollbackJob, 10],
    [windowsRollbackJob, 10],
    [sealJob, 10],
    [rollbackJob, 10]
  ]) {
    assert.match(job, new RegExp(`timeout-minutes: ${timeout}`));
    assert.doesNotMatch(job, /environment: preview-release/);
  }
  assert.match(publicMacosJob, /APPLE_TEAM_ID: \$\{\{ needs\.release-policy\.outputs\.apple_team_id \}\}/);
  assert.match(publicWindowsJob, /WIN_SIGNER_THUMBPRINT: \$\{\{ needs\.release-policy\.outputs\.win_signer_thumbprint \}\}/);
  for (const job of [publicMetadataJob, publicMacosJob, publicWindowsJob, sealJob]) {
    assert.doesNotMatch(job, /secrets\./);
    assert.match(job, /GITHUB_TOKEN: ""[\s\S]*GH_TOKEN: ""[\s\S]*RELEASE_GATE_TOKEN: ""/);
    assert.match(job, /EXPECTED_RELEASE_ID: \$\{\{ needs\.publish-release\.outputs\.release_id \}\}/);
    assert.match(job, /EXPECTED_ASSET_IDENTITY: \$\{\{ needs\.publish-release\.outputs\.asset_identity \}\}/);
    assert.match(job, /--release-id/);
    assert.match(job, /--asset-identity/);
  }
  for (const [watcherJob, failedGate, otherGates] of [
    [metadataRollbackJob, 'verify-public-metadata', ['verify-public-macos', 'verify-public-windows']],
    [macosRollbackJob, 'verify-public-macos', ['verify-public-metadata', 'verify-public-windows']],
    [windowsRollbackJob, 'verify-public-windows', ['verify-public-metadata', 'verify-public-macos']]
  ]) {
    assert.match(watcherJob, /^\s{6}contents: write$/m);
    assert.doesNotMatch(watcherJob, /environment: preview-release/);
    assert.doesNotMatch(watcherJob, /secrets\./);
    assert.match(watcherJob, /needs\.publish-release\.result == 'success'/);
    assert.match(watcherJob, new RegExp(`needs\\.${failedGate}\\.result != 'success'`));
    assert.match(watcherJob, new RegExp(`^\\s+- ${failedGate}$`, 'm'));
    for (const otherGate of otherGates) {
      assert.doesNotMatch(watcherJob, new RegExp(`^\\s+- ${otherGate}$`, 'm'));
    }
    assert.match(watcherJob, /EXPECTED_ASSET_IDENTITY: \$\{\{ needs\.create-draft\.outputs\.asset_identity \}\}/);
    assert.match(watcherJob, /PUBLICLY_EXPOSED: "true"/);
    assert.match(watcherJob, /ref: \$\{\{ needs\.release-policy\.outputs\.commit_sha \}\}/);
    assert.match(watcherJob, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.match(watcherJob, /run: bash scripts\/redraft-github-release\.sh/);
    assert.match(watcherJob, /run: exit 1/);
  }
  assert.match(rollbackJob, /EXPECTED_ASSET_IDENTITY: \$\{\{ needs\.create-draft\.outputs\.asset_identity \}\}/);
  assert.match(rollbackJob, /PUBLICLY_EXPOSED: \$\{\{ needs\.publish-release\.result == 'success' \}\}/);
  assert.match(rollbackJob, /ref: \$\{\{ needs\.release-policy\.outputs\.commit_sha \}\}/);
  assert.match(rollbackJob, /run: bash scripts\/redraft-github-release\.sh/);
  assert.equal((workflow.match(/run: bash scripts\/redraft-github-release\.sh/g) || []).length, 4);

  assert.match(releaseRollback, /releases\/tags\/\$RELEASE_TAG/);
  assert.match(releaseRollback, /same tag moved from release ID \$RELEASE_ID to \$current_release_id/);
  assert.match(releaseRollback, /same-tag release asset identity changed/);
  assert.match(releaseRollback, /current_release_id.*RELEASE_ID/s);
  assert.match(releaseRollback, /candidate_burned=true/);
  assert.match(releaseRollback, /for attempt in 1 2 3/);
  assert.match(releaseRollback, /declare -a rollback_ids/);
  assert.match(releaseRollback, /mark_release_burned/);
  assert.match(releaseRollback, /current_body.*notice/s);
  const missingTagRecovery = releaseRollback.slice(
    releaseRollback.indexOf('if ! before="$(gh api'),
    releaseRollback.indexOf('  current_release_id="$(jq -r .id')
  );
  assertOrdered(missingTagRecovery, [
    'if release_exists "$RELEASE_ID"',
    'redraft_release "$RELEASE_ID"',
    'assert_redrafted_release "$RELEASE_ID"',
    'mark_release_burned "$RELEASE_ID"',
    'known_release_recovered=true',
    'exit 1'
  ], 'missing same-tag lookup must first recover the captured release ID');

  for (const marker of [
    '--mode draft',
    '--mode public',
    '--macos-sha256',
    '--windows-sha256',
    '--manifest-sha256',
    'First-use and two-restart smoke of exact draft DMG',
    'First-use and two-restart smoke of exact draft portable',
    'First-use and two-restart smoke of exact public DMG',
    'First-use and two-restart smoke of exact public portable',
    'Revalidate public DMG signature, notarization, fuses, and ASAR',
    'Revalidate public Authenticode, timestamp, fuses, and ASAR'
  ]) {
    assert.ok(workflow.includes(marker), `missing release transaction marker: ${marker}`);
  }
  assert.match(workflow, /GITHUB_TOKEN: ""[\s\S]{0,80}GH_TOKEN: ""[\s\S]{0,80}RELEASE_GATE_TOKEN: ""/);
  assert.match(workflow, /agentdesk-public-macos-release-assets/);
  assert.match(workflow, /agentdesk-release-diagnostics\/public-macos/);
  assert.match(workflow, /Upload public macOS diagnostics only[\s\S]{0,300}agentdesk-release-diagnostics\/public-macos/);
  assert.match(workflow, /Upload public Windows diagnostics only[\s\S]{0,300}agentdesk-release-diagnostics\\public-windows/);
  assert.match(workflow, /always\(\)[\s\S]*needs\.create-draft\.result == 'success'/);
  assert.match(releaseRollback, /-F draft=true/);
  assert.match(releaseRollback, /-F prerelease=true/);
  assert.match(releaseRollback, /PUBLIC VERIFICATION FAILED — CANDIDATE BURNED/);
  assert.match(releaseRollback, /must never be reused/);
  assert.match(workflow, /GitHub-hosted-runner evidence only/);
  assert.match(workflow, /Browser quarantine, SmartScreen reputation, and clean physical-machine gates remain open/);

  assert.match(publicGate, /const STABLE_ALLOWED = false/);
  assert.match(publicGate, /Release asset allowlist mismatch/);
  assert.match(publicGate, /SHA256SUMS\.txt allowlist mismatch/);
  assert.match(publicGate, /Downloaded SHA256SUMS\.txt differs from its pre-publication digest/);
  assert.match(publicGate, /differs from public SHA256SUMS\.txt/);
  assert.match(publicGate, /Anonymous release verification refuses non-empty/);
  assert.match(publicGate, /https:\/\/github\.com\/\$\{validatedRepository\}\/releases\/download/);
  assert.match(publicGate, /headers = githubHeaders\('', 'application\/octet-stream'\)/);

  assert.doesNotMatch(workflow, /secrets\.WIN_SIGNER_THUMBPRINT/);
  assert.match(workflow, /WIN_SIGNER_THUMBPRINT: \$\{\{ needs\.release-policy\.outputs\.win_signer_thumbprint \}\}/);
  assert.match(workflow, /Bind draft portable to protected publisher identity/);
  assert.match(workflow, /Bind public portable to protected publisher identity/);
  assert.match(windowsPublisher, /accepting an arbitrary trusted publisher is forbidden/);
  assert.match(windowsPublisher, /Get-AuthenticodeSignature/);
  assert.match(windowsPublisher, /does not match the protected WIN_SIGNER_THUMBPRINT identity/);
});

test('Electron 工具链和锁文件满足安全发布基线', () => {
  assert.equal(packageJson.devDependencies['@electron/fuses'], '1.8.0');
  assert.ok(major(packageJson.devDependencies.electron) >= 43);
  assert.ok(major(packageJson.devDependencies['electron-builder']) >= 26);
  assert.equal(packageJson.engines.node, '>=22.12.0');

  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
  assert.equal(
    packageLock.packages[''].devDependencies['@electron/fuses'],
    packageJson.devDependencies['@electron/fuses']
  );
  assert.equal(packageLock.packages['node_modules/@electron/fuses'].version, '1.8.0');
  assert.equal(
    packageLock.packages[''].devDependencies.electron,
    packageJson.devDependencies.electron
  );
  assert.equal(
    packageLock.packages[''].devDependencies['electron-builder'],
    packageJson.devDependencies['electron-builder']
  );
});

test('安装文档不再建议用 xattr 绕过 Gatekeeper', () => {
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /xattr\s+-d/);
  assert.match(readme, /v0\.9\.0[\s\S]{0,180}revoked/i);
});
