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

test('macOS 正式构建强制签名、公证和 Hardened Runtime', () => {
  assert.equal(packageJson.build.mac.forceCodeSigning, true);
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.equal(packageJson.build.mac.entitlements, 'build/entitlements.mac.plist');
  assert.equal(packageJson.build.mac.entitlementsInherit, 'build/entitlements.mac.inherit.plist');

  assert.match(packageJson.scripts['build:mac:dir'], /identity=-/);
  assert.match(packageJson.scripts['build:mac:dir'], /notarize=false/);

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

test('发布工作流缺少凭据时失败，并验证最终 DMG 内的应用', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  const verifier = fs.readFileSync(path.join(root, 'scripts', 'verify-macos-release.sh'), 'utf8');

  for (const secret of [
    'MAC_CSC_LINK',
    'MAC_CSC_KEY_PASSWORD',
    'APPLE_API_KEY_BASE64',
    'APPLE_TEAM_ID'
  ]) {
    assert.ok(workflow.includes(`secrets.${secret}`), `${secret} is not wired into release CI`);
  }
  assert.match(workflow, /Require signing and notarization credentials/);
  assert.match(workflow, /npm run verify:mac-release/);

  assert.match(verifier, /codesign --verify --deep --strict/);
  assert.match(verifier, /xcrun stapler validate/);
  assert.match(verifier, /spctl --assess --type execute/);
  assert.match(verifier, /syspolicy_check distribution/);
  assert.match(verifier, /APPLE_TEAM_ID/);
  assert.match(verifier, /lipo -archs/);
  assert.match(verifier, /Contents\/Resources\/native\/AgentDeskInputHelper/);
  assert.match(verifier, /Expected a universal input helper/);
  assert.match(verifier, /Verifying bundled input helper signature/);
  assert.match(verifier, /helper_team_identifier/);
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

test('Electron 工具链和锁文件满足安全发布基线', () => {
  assert.ok(major(packageJson.devDependencies.electron) >= 43);
  assert.ok(major(packageJson.devDependencies['electron-builder']) >= 26);
  assert.equal(packageJson.engines.node, '>=22.12.0');

  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages[''].version, packageJson.version);
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
