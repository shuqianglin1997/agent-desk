const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  MAIN_DOCUMENT_CSP,
  resolvePackagedDocumentPath,
  isTrustedMainSender,
  createTrustedIpcMain,
  installMainWindowSecurity
} = require('../src/main/ipc/security-policy');
const { PathSelectionRegistry } = require('../src/main/ipc/path-selections');
const {
  derivedNetworkEnrollment,
  shouldDeferSecureMeshStartup
} = require('../src/main/ipc/network-enrollment');
const {
  normalizeFirstAgentInput,
  initializeFirstAgent
} = require('../src/main/ipc/first-agent-onboarding');
const { MeshService } = require('../src/mesh/main/mesh-service');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { readJsonStore, writeJsonStore } = require('../src/json-store');
const { resolveProfileStore } = require('../src/main/profile-store-policy');
const {
  normalizeTaskPackageSendInput,
  normalizeTaskPackageTransferInput
} = require('../src/main/ipc/task-package-transfer');
const {
  normalizeInvitationInspectionInput,
  normalizeConfirmedJoinInput,
  normalizePairingDecisionInput
} = require('../src/main/ipc/pairing-approvals');

const MAIN_URL = 'file:///Applications/AgentDesk/src/index.html';

function fakeProtector() {
  return {
    isAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString('base64')}`),
    decryptString: (buffer) => Buffer.from(
      buffer.toString().replace(/^protected:/, ''),
      'base64'
    ).toString()
  };
}

function meshHarness(profiles) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-first-agent-security-'));
  const databasePath = path.join(directory, 'mesh.db');
  const keyPath = path.join(directory, 'mesh-keys.json');
  const createService = () => new MeshService({
    databasePath,
    keyVault: new EncryptedKeyVault(keyPath, fakeProtector()),
    profilesProvider: () => profiles,
    sessionCountProvider: () => 0,
    appVersion: 'test',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test-os',
    hostname: 'Onboarding-Test.local',
    now: () => '2026-08-14T03:00:00.000Z'
  });
  return { directory, createService };
}

function trustedFixture() {
  const mainFrame = { url: MAIN_URL };
  const webContents = { mainFrame, isDestroyed: () => false };
  const window = { webContents, isDestroyed: () => false };
  const event = { sender: webContents, senderFrame: mainFrame };
  return { mainFrame, webContents, window, event };
}

test('main IPC sender policy rejects another WebContents, a child frame, and another document', () => {
  const fixture = trustedFixture();
  const options = { getWindow: () => fixture.window, allowedUrl: MAIN_URL };
  assert.equal(isTrustedMainSender(fixture.event, options), true);
  assert.equal(isTrustedMainSender({ ...fixture.event, sender: {} }, options), false);
  assert.equal(isTrustedMainSender({ ...fixture.event, senderFrame: { url: MAIN_URL } }, options), false);
  fixture.mainFrame.url = 'https://attacker.invalid/';
  assert.equal(isTrustedMainSender(fixture.event, options), false);

  const portableAlias = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\portable\\resources\\app.asar\\src\\index.html';
  const portableArchive = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\portable\\resources\\app.asar';
  const portableLongArchive = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\portable\\resources\\app.asar';
  const nativeCalls = [];
  assert.equal(resolvePackagedDocumentPath(portableAlias, {
    pathApi: path.win32,
    realpathSync: () => { throw new Error('ASAR path must not use the patched whole-path resolver'); },
    realpathNative: (candidate) => {
      nativeCalls.push(candidate);
      assert.equal(candidate, portableArchive);
      return portableLongArchive;
    }
  }), path.win32.join(portableLongArchive, 'src', 'index.html'));
  assert.deepEqual(nativeCalls, [portableArchive]);

  assert.equal(resolvePackagedDocumentPath('/workspace/src/index.html', {
    pathApi: path.posix,
    realpathSync: (candidate) => `/real${candidate}`,
    realpathNative: () => { throw new Error('development path must not use native ASAR resolution'); }
  }), '/real/workspace/src/index.html');
});

test('trusted IPC registrar checks the sender before invoking every registered handler', async () => {
  const fixture = trustedFixture();
  let registered;
  const ipcMain = { handle: (_channel, handler) => { registered = handler; } };
  const trusted = createTrustedIpcMain({
    ipcMain,
    getWindow: () => fixture.window,
    allowedUrl: MAIN_URL
  });
  trusted.handle('example:read', (_event, value) => `ok:${value}`);
  assert.equal(await registered(fixture.event, 'value'), 'ok:value');
  assert.throws(() => registered({ sender: {}, senderFrame: {} }), /ipc-untrusted-sender/);
});

test('main window policy denies popups, off-document navigation, webviews, and injects CSP', () => {
  const listeners = new Map();
  let openHandler;
  let headersHandler;
  const webContents = {
    setWindowOpenHandler(handler) { openHandler = handler; },
    on(name, handler) { listeners.set(name, handler); },
    session: {
      webRequest: {
        onHeadersReceived(_filter, handler) { headersHandler = handler; }
      }
    }
  };
  installMainWindowSecurity({ webContents }, { allowedUrl: MAIN_URL });
  assert.deepEqual(openHandler({ url: 'https://attacker.invalid' }), { action: 'deny' });
  assert.deepEqual(openHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(openHandler({ url: 'file:///tmp/attacker.html' }), { action: 'deny' });
  let prevented = false;
  listeners.get('will-navigate')({ preventDefault: () => { prevented = true; } }, 'https://attacker.invalid');
  assert.equal(prevented, true);
  prevented = false;
  listeners.get('will-navigate')({ preventDefault: () => { prevented = true; } }, MAIN_URL);
  assert.equal(prevented, false);
  prevented = false;
  listeners.get('will-navigate')({ preventDefault: () => { prevented = true; } }, 'file:///tmp/attacker.html');
  assert.equal(prevented, true);
  listeners.get('will-attach-webview')({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  let response;
  headersHandler({ url: MAIN_URL, responseHeaders: { Existing: ['yes'] } }, (value) => { response = value; });
  assert.deepEqual(response.responseHeaders.Existing, ['yes']);
  assert.deepEqual(response.responseHeaders['Content-Security-Policy'], [MAIN_DOCUMENT_CSP]);
  assert.match(MAIN_DOCUMENT_CSP, /connect-src 'none'/);
  assert.match(MAIN_DOCUMENT_CSP, /object-src 'none'/);
});

test('path selection capabilities are purpose-bound, expiring, and one registry never accepts raw paths', () => {
  let now = 1_000;
  let sequence = 0;
  const registry = new PathSelectionRegistry({
    now: () => now,
    randomUUID: () => `selection-${++sequence}`,
    ttlMs: 30_000
  });
  const directory = registry.issue({ kind: 'profile-directory', path: '/chosen/by/user' });
  assert.equal(registry.resolve(directory.selectionId, 'profile-directory'), '/chosen/by/user');
  assert.throws(() => registry.resolve(directory.selectionId, 'profile-executable'), /purpose-mismatch/);
  assert.throws(() => registry.resolve('/arbitrary/path', 'profile-directory'), /expired/);
  assert.throws(() => registry.resolve('/Applications/Evil.app/Contents/MacOS/Evil', 'profile-executable'), /expired/);
  registry.consume([directory.selectionId]);
  assert.throws(() => registry.resolve(directory.selectionId, 'profile-directory'), /expired/);
  const executable = registry.issue({ kind: 'profile-executable', path: '/chosen/tool' });
  now += 31_000;
  assert.throws(() => registry.resolve(executable.selectionId, 'profile-executable'), /expired/);
});

test('network enrollment defaults preserve existing networked Meshes but explicit false wins', () => {
  const existing = {
    localDeviceId: 'local',
    devices: [{ deviceId: 'local', isLocal: true }, { deviceId: 'remote', isLocal: false }]
  };
  assert.equal(derivedNetworkEnrollment({ overview: existing }), true);
  assert.equal(derivedNetworkEnrollment({ overview: {}, configuredSignalingUrls: ['https://signal.example'] }), true);
  assert.equal(derivedNetworkEnrollment({ storedValue: false, overview: existing }), false);
  assert.equal(derivedNetworkEnrollment({ storedValue: true, overview: {} }), true);
  assert.equal(derivedNetworkEnrollment({ overview: { devices: [] } }), false);
  assert.equal(shouldDeferSecureMeshStartup({
    platform: 'darwin',
    isPackaged: true,
    signatureText: 'Signature=adhoc\nTeamIdentifier=not set\n'
  }), true);
  assert.equal(shouldDeferSecureMeshStartup({
    platform: 'darwin',
    isPackaged: true,
    signatureText: 'Signature=adhoc\nAuthority=Developer ID Application: Example\nTeamIdentifier=TEAM123\n'
  }), false);
  assert.equal(shouldDeferSecureMeshStartup({
    platform: 'win32',
    isPackaged: true,
    signatureText: 'Signature=adhoc\nTeamIdentifier=not set\n'
  }), false);
});

test('a missing Profile store starts empty and remains empty after restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-empty-profiles-'));
  const storeFile = path.join(directory, 'profiles.json');
  const backupFile = `${storeFile}.bak`;
  const load = () => resolveProfileStore({
    candidates: [storeFile, backupFile],
    exists: fs.existsSync,
    read: (filePath) => readJsonStore(filePath, (parsed) => (
      Array.isArray(parsed?.profiles) || Array.isArray(parsed)
    )),
    normalize: (profiles) => profiles.map((profile) => ({ ...profile })),
    persist: (profiles, options) => writeJsonStore(
      storeFile,
      { version: 2, profiles },
      { ...options, backupFile }
    ),
    version: 2
  });
  try {
    writeJsonStore(backupFile, {
      version: 2,
      profiles: [{ id: 'stale-default-profile', appId: 'claude' }]
    });
    assert.deepEqual(load(), []);
    assert.deepEqual(JSON.parse(fs.readFileSync(storeFile, 'utf8')).profiles, []);
    assert.deepEqual(load(), []);

    writeJsonStore(storeFile, {
      version: 2,
      profiles: [{ id: 'real-profile', appId: 'codex' }]
    }, { backupFile });
    assert.deepEqual(load(), [{ id: 'real-profile', appId: 'codex' }]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('first-Agent onboarding accepts only stable IDs/enums and performs no network action', () => {
  assert.throws(() => normalizeFirstAgentInput({
    displayName: 'Peter',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    migrationProfileIds: [],
    profilePath: '/tmp/forbidden'
  }, { isKnownApp: () => true }), /field-forbidden/);

  let networkEnrollment = null;
  const service = {
    overview: { initialized: false, agents: [], slots: [] },
    getOverview() { return this.overview; },
    initialize() {
      this.overview = {
        initialized: true,
        localDeviceId: 'device-1',
        mesh: { catalogRevision: 0 },
        agents: [],
        slots: []
      };
      return this.overview;
    },
    createAgent(input) {
      this.overview = {
        ...this.overview,
        mesh: { catalogRevision: 1 },
        agents: [{ agentId: 'agent-1', displayName: input.displayName }]
      };
      return this.overview;
    },
    reset() { throw new Error('should-not-rollback'); }
  };
  const result = initializeFirstAgent({
    displayName: 'Peter',
    requestedAppId: 'codex',
    requestedClientForm: 'desktop',
    migrationProfileIds: []
  }, {
    isKnownApp: (value) => value === 'codex',
    listProfiles: () => [],
    meshService: service,
    setNetworkEnrollmentEnabled: (enabled) => { networkEnrollment = enabled; }
  });
  assert.equal(result.agent.agentId, 'agent-1');
  assert.equal(result.deviceId, 'device-1');
  assert.equal(networkEnrollment, false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'provisioning'), false);
});

test('selective first-use migration suppresses unselected Profiles and later reconciliation cannot revive them', () => {
  const profiles = [
    {
      id: 'selected-profile',
      appId: 'codex',
      name: 'Selected',
      identityFingerprint: 'account-selected',
      profilePathMode: 'managed',
      sessionRootMode: 'managed'
    },
    {
      id: 'unselected-profile',
      appId: 'codex',
      name: 'Unselected',
      identityFingerprint: 'account-unselected',
      profilePathMode: 'managed',
      sessionRootMode: 'managed'
    }
  ];
  const harness = meshHarness(profiles);
  try {
    const initialized = harness.createService().initialize({
      migrationProfileIds: ['selected-profile']
    });
    assert.equal(initialized.agents.length, 1);
    assert.equal(initialized.accountBindings.length, 1);
    assert.equal(initialized.slots.length, 2);
    const selected = initialized.slots.find((slot) => slot.profileId === 'selected-profile');
    const unselected = initialized.slots.find((slot) => slot.profileId === 'unselected-profile');
    assert.equal(selected.assignmentState, 'linked');
    assert.ok(selected.agentId);
    assert.equal(unselected.assignmentState, 'suppressed');
    assert.equal(unselected.agentId, null);
    assert.equal(unselected.accountBindingId, null);

    const reopened = harness.createService().getOverview();
    const stillSuppressed = reopened.slots.find((slot) => slot.profileId === 'unselected-profile');
    assert.equal(reopened.agents.length, 1);
    assert.equal(reopened.accountBindings.length, 1);
    assert.equal(stillSuppressed.assignmentState, 'suppressed');
    assert.equal(stillSuppressed.agentId, null);
    assert.equal(stillSuppressed.accountBindingId, null);
  } finally {
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }

  const emptyHarness = meshHarness(profiles);
  try {
    const empty = emptyHarness.createService().initialize({ migrationProfileIds: [] });
    assert.equal(empty.agents.length, 0);
    assert.equal(empty.accountBindings.length, 0);
    assert.equal(empty.slots.length, 2);
    assert.equal(empty.slots.every((slot) => (
      slot.assignmentState === 'suppressed'
      && slot.agentId === null
      && slot.accountBindingId === null
    )), true);
  } finally {
    fs.rmSync(emptyHarness.directory, { recursive: true, force: true });
  }
});

test('real first-Agent transaction returns a durable Agent, Blueprint and local device without provisioning or network', () => {
  const harness = meshHarness([]);
  let networkEnrollment = null;
  try {
    const result = initializeFirstAgent({
      displayName: 'Research Agent',
      requestedAppId: 'codex',
      requestedClientForm: 'desktop',
      migrationProfileIds: []
    }, {
      isKnownApp: (value) => value === 'codex',
      listProfiles: () => [],
      meshService: harness.createService(),
      setNetworkEnrollmentEnabled: (enabled) => { networkEnrollment = enabled; }
    });
    assert.ok(result.deviceId);
    assert.equal(result.agent.displayName, 'Research Agent');
    assert.equal(result.overview.blueprints.some((item) => item.agentId === result.agent.agentId), true);
    assert.equal(networkEnrollment, false);
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'provisioning'), false);
    const reopened = harness.createService().getOverview();
    assert.equal(reopened.agents.filter((item) => item.agentId === result.agent.agentId).length, 1);
    assert.equal(reopened.blueprints.some((item) => item.agentId === result.agent.agentId), true);
  } finally {
    fs.rmSync(harness.directory, { recursive: true, force: true });
  }
});

test('direct TaskPackage IPC accepts only stable IDs, checkpoint text, enums and booleans', () => {
  const normalized = normalizeTaskPackageSendInput({
    targetDeviceId: 'device-b',
    profileId: 'profile-a',
    sessionId: 'session-a',
    conversationId: 'conversation-a',
    senderLabel: 'Hupo',
    checkpoint: {
      objective: 'Continue the reviewed implementation',
      completed: 'Security boundary\nPortable package',
      next: ['Direct transfer'],
      blockers: [],
      acceptance: 'Receiver can import'
    },
    includeProject: true,
    includeAttachments: false
  });
  assert.equal(normalized.targetDeviceId, 'device-b');
  assert.deepEqual(normalized.checkpoint.completed, ['Security boundary', 'Portable package']);
  assert.throws(() => normalizeTaskPackageSendInput({
    ...normalized,
    destinationPath: '/tmp/renderer-chosen'
  }), /field-forbidden/);
  assert.throws(() => normalizeTaskPackageSendInput({
    ...normalized,
    checkpoint: { ...normalized.checkpoint, objective: '', command: 'rm' }
  }), /field-forbidden|objective-required/);
  assert.throws(() => normalizeTaskPackageTransferInput({
    transferId: 'transfer-a',
    unlockCode: 'forbidden'
  }), /field-forbidden/);
  assert.deepEqual(normalizeTaskPackageTransferInput({ transferId: 'transfer-a' }), {
    transferId: 'transfer-a'
  });
});

test('pairing IPC requires a prior inspection token and exact approval fields', () => {
  assert.deepEqual(normalizeInvitationInspectionInput({ code: 'AD1.example' }), {
    code: 'AD1.example'
  });
  assert.deepEqual(normalizeConfirmedJoinInput({
    code: 'AD1.example',
    inviteId: 'invite-a',
    confirmationToken: 'inspection-a'
  }), {
    code: 'AD1.example',
    inviteId: 'invite-a',
    confirmationToken: 'inspection-a'
  });
  assert.throws(() => normalizeConfirmedJoinInput({ code: 'AD1.example' }), /inviteId-invalid/);
  assert.throws(() => normalizeConfirmedJoinInput({
    code: 'AD1.example',
    inviteId: 'invite-a',
    confirmationToken: 'inspection-a',
    deviceName: 'forbidden-renderer-field'
  }), /pairing-input-invalid/);
  assert.deepEqual(normalizePairingDecisionInput({ approvalId: 'approval-a', confirmed: false }), {
    approvalId: 'approval-a',
    confirmed: false
  });
  assert.throws(() => normalizePairingDecisionInput({ approvalId: 'approval-a', confirmed: 1 }), /confirmed-invalid/);
});

test('main/preload source closes raw path, full-profile, sender and navigation bypasses', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');
  assert.match(main, /const MAIN_DOCUMENT_PATH = resolvePackagedDocumentPath\(path\.join\(__dirname, 'index\.html'\)\);/);
  assert.match(main, /const MAIN_DOCUMENT_URL = pathToFileURL\(MAIN_DOCUMENT_PATH\)\.href;/);
  assert.match(main, /mainWindow\.loadFile\(MAIN_DOCUMENT_PATH\)/);
  assert.match(main, /const ipcMain = createTrustedIpcMain\(/);
  assert.match(main, /installMainWindowSecurity\(mainWindow/);
  assert.match(main, /profile-path-input-forbidden/);
  assert.match(main, /sessions:list'[\s\S]*?input\.profileId[\s\S]*?loadProfiles\(\)/);
  assert.match(main, /diagnostics:get'[\s\S]*?input\.profileId[\s\S]*?loadProfiles\(\)/);
  assert.doesNotMatch(main, /refreshed\?\.filePath \|\| input\.filePath/);
  assert.match(preload, /listSessions: \(profile\) => ipcRenderer\.invoke\('sessions:list', \{ profileId: profile\?\.id \}\)/);
  assert.match(preload, /getDiagnostics: \(profile\) => ipcRenderer\.invoke\('diagnostics:get', \{ profileId: profile\?\.id \}\)/);
  assert.doesNotMatch(preload, /ipcRenderer\.invoke\('system:(?:showItem|openPath)',\s*(?:path|displayPath)\b/);
  assert.match(main, /devices:list'[\s\S]*?meshNetworkEnrollmentEnabled\(result\.overview\)/);
  assert.match(main, /detectSecureMeshStartupDeferral\(\)/);
  assert.match(main, /getOverview\(\{ deferKeyAccess \}\)/);
  assert.match(main, /if \(!deferSecureMeshStartup\) getProvisioningService\(\)\.resumeActiveJobs\(\)/);
  assert.match(preload, /requestSecureAccess: options\.requestSecureAccess === true/);
  const legacyInitialize = main.match(/ipcMain\.handle\('devices:initialize'[\s\S]*?\n\s*}\);/)?.[0] || '';
  assert.match(legacyInitialize, /setMeshNetworkEnrollmentEnabled\(false\)/);
  assert.doesNotMatch(legacyInitialize, /ensureSignalingOnline/);
  assert.match(main, /onboarding:initializeFirstAgent/);
  assert.match(main, /taskPackages:sendToDevice/);
  assert.match(main, /normalizeTaskPackageSendInput/);
  assert.match(preload, /sendTaskPackageToDevice/);
  assert.match(main, /devices:inspectInvite/);
  assert.match(main, /requestPairingClaimApproval/);
  assert.match(preload, /inspectDeviceInvitation/);
  assert.match(preload, /decidePairingClaim/);
  assert.doesNotMatch(main, /function bootstrapProfiles|hasLocalKimiCodeData|hasLocalKimiWorkData|hasLocalClaudeCliData/);
});
