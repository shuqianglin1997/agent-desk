const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  NETWORK_ENV_KEYS,
  assertAdHocMacSignatureDetails,
  assertBrowserLaunchIdentity,
  assertLocalOnlyOverview,
  assertPackagedFixedWindowContract,
  assertPackagedRendererUrl,
  assertPackagedWindowGeometry,
  browserWebSocketFromOutput,
  parseArguments,
  readMacSignatureDetails,
  resolvePackagedArtifact,
  resolveSmokeKeychainMode,
  runtimeVersionFromUserAgent,
  shutdownComplete,
  shutdownFailureReasons,
  stopPackagedApp,
  scrubMeshNetworkEnvironment,
  terminateSpawnedLauncher
} = require('../scripts/packaged-first-use-smoke');

function fixture(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-packaged-smoke-test-'));
  try {
    return task(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function touch(filePath, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'fixture', { mode });
}

test('CLI requires an explicit artifact and validates bounded numeric options', () => {
  assert.throws(() => parseArguments([], {}), /--artifact is required/);
  assert.throws(() => parseArguments(['--artifact', '/tmp/a', '--timeout-ms', '10'], {}), /5000 to 120000/);
  assert.throws(() => parseArguments(['--artifact', '/tmp/a', '--expected-onboarding-version', '0'], {}), /positive integer/);
  assert.throws(() => parseArguments(['--mystery'], {}), /Unknown argument/);
  const parsed = parseArguments([
    '--artifact', '/tmp/AgentDesk.app',
    '--expected-version', '9.8.7-preview.1',
    '--expected-onboarding-version', '3',
    '--timeout-ms', '6000',
    '--macos-ci-mock-keychain',
    '--keep-temp'
  ], {});
  assert.equal(parsed.artifact, path.resolve('/tmp/AgentDesk.app'));
  assert.equal(parsed.expectedVersion, '9.8.7-preview.1');
  assert.equal(parsed.expectedOnboardingVersion, 3);
  assert.equal(parsed.timeoutMs, 6000);
  assert.equal(parsed.macosCiMockKeychain, true);
  assert.equal(parsed.keepTemp, true);
});

test('macOS resolver accepts only a real AgentDesk.app app.asar executable layout', () => fixture((root) => {
  const bundle = path.join(root, 'mac-arm64', 'AgentDesk.app');
  touch(path.join(bundle, 'Contents', 'MacOS', 'AgentDesk'), 0o700);
  touch(path.join(bundle, 'Contents', 'Resources', 'app.asar'));
  touch(path.join(bundle, 'Contents', 'Info.plist'));
  const fromBundle = resolvePackagedArtifact(bundle, 'darwin');
  assert.equal(fromBundle.kind, 'mac-app');
  assert.equal(fromBundle.artifactPath, fs.realpathSync(bundle));
  const fromParent = resolvePackagedArtifact(path.dirname(bundle), 'darwin');
  assert.equal(fromParent.executablePath, fromBundle.executablePath);

  const sourceElectron = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
  touch(path.join(sourceElectron, 'Contents', 'MacOS', 'Electron'), 0o700);
  assert.throws(() => resolvePackagedArtifact(sourceElectron, 'darwin'), /Source Electron runtime is forbidden/);

  const adHocSliceDetails = (architecture) => [
    `Executable=${fromBundle.executablePath}`,
    `Format=app bundle with Mach-O ${architecture}`,
    'Signature=adhoc',
    'TeamIdentifier=not set'
  ].join('\n');
  const adHocDetails = {
    architectures: ['arm64', 'x86_64'],
    slices: [
      { architecture: 'arm64', details: adHocSliceDetails('arm64') },
      { architecture: 'x86_64', details: adHocSliceDetails('x86_64') }
    ]
  };
  assert.equal(assertAdHocMacSignatureDetails(adHocDetails), true);

  const commandCalls = [];
  const commandResults = [
    { status: 0, stdout: '', stderr: '' },
    { status: 0, stdout: 'arm64 x86_64\n', stderr: '' },
    { status: 0, stdout: '', stderr: adHocSliceDetails('arm64') },
    { status: 0, stdout: '', stderr: adHocSliceDetails('x86_64') }
  ];
  const inspected = readMacSignatureDetails(fromBundle.artifactPath, (command, args, options) => {
    commandCalls.push({ command, args, options });
    return commandResults.shift();
  });
  assert.equal(assertAdHocMacSignatureDetails(inspected), true);
  assert.equal(commandResults.length, 0);
  assert.deepEqual(commandCalls.map(({ command, args }) => [command, args]), [
    ['/usr/bin/codesign', [
      '--verify', '--deep', '--strict', '--all-architectures', fromBundle.artifactPath
    ]],
    ['/usr/bin/lipo', ['-archs', fromBundle.executablePath]],
    ['/usr/bin/codesign', [
      '--display', '--verbose=4', '--architecture', 'arm64', fromBundle.artifactPath
    ]],
    ['/usr/bin/codesign', [
      '--display', '--verbose=4', '--architecture', 'x86_64', fromBundle.artifactPath
    ]]
  ]);
  assert.ok(commandCalls.every(({ options }) => (
    options.encoding === 'utf8' && options.maxBuffer === 1024 * 1024
  )));
  assert.throws(
    () => readMacSignatureDetails(fromBundle.artifactPath, () => ({ status: 1, stdout: '', stderr: '' })),
    /valid signature on every AgentDesk\.app architecture/
  );
  assert.equal(resolveSmokeKeychainMode(
    { macosCiMockKeychain: true },
    fromBundle,
    { platform: 'darwin', readMacSignatureDetails: () => adHocDetails }
  ), 'mock');
  assert.equal(resolveSmokeKeychainMode(
    { macosCiMockKeychain: false },
    { kind: 'windows-portable', artifactPath: 'C:\\AgentDesk-portable.exe' },
    { platform: 'win32', readMacSignatureDetails: () => { throw new Error('must not inspect'); } }
  ), 'system');
  assert.throws(
    () => resolveSmokeKeychainMode(
      { macosCiMockKeychain: true },
      { kind: 'windows-portable', artifactPath: 'C:\\AgentDesk-portable.exe' },
      { platform: 'win32', readMacSignatureDetails: () => adHocDetails }
    ),
    /supported only on macOS/
  );
  assert.throws(
    () => resolveSmokeKeychainMode(
      { macosCiMockKeychain: true },
      fromBundle,
      {
        platform: 'darwin',
        readMacSignatureDetails: () => ({
          architectures: ['arm64', 'x86_64'],
          slices: [
            { architecture: 'arm64', details: adHocSliceDetails('arm64') },
            {
              architecture: 'x86_64',
              details: [
                'Authority=Developer ID Application: Example (ABCDEFGHIJ)',
                'TeamIdentifier=ABCDEFGHIJ'
              ].join('\n')
            }
          ]
        })
      }
    ),
    /exactly one ad-hoc signature for x86_64/
  );
  assert.throws(
    () => resolveSmokeKeychainMode(
      { macosCiMockKeychain: true },
      fromBundle,
      { platform: 'darwin', readMacSignatureDetails: () => ({ architectures: [], slices: [] }) }
    ),
    /contains no architectures/
  );
  assert.throws(
    () => assertAdHocMacSignatureDetails({
      architectures: ['arm64'],
      slices: [{
        architecture: 'arm64',
        details: `${adHocSliceDetails('arm64')}\nSignature=certificate`
      }]
    }),
    /exactly one ad-hoc signature for arm64/
  );
}));

test('Windows resolver distinguishes win-unpacked and the versioned portable artifact', () => fixture((root) => {
  const unpacked = path.join(root, 'win-unpacked');
  touch(path.join(unpacked, 'AgentDesk.exe'));
  touch(path.join(unpacked, 'resources', 'app.asar'));
  const directory = resolvePackagedArtifact(unpacked, 'win32');
  assert.equal(directory.kind, 'windows-unpacked');
  assert.equal(directory.allowLauncherExit, false);
  const executable = resolvePackagedArtifact(path.join(unpacked, 'AgentDesk.exe'), 'win32');
  assert.equal(executable.kind, 'windows-unpacked');

  const portablePath = path.join(root, 'AgentDesk-0.10.1-preview.1-portable-x64.exe');
  touch(portablePath);
  const portable = resolvePackagedArtifact(portablePath, 'win32');
  assert.equal(portable.kind, 'windows-portable');
  assert.equal(portable.allowLauncherExit, false, 'portable launcher must remain supervised until the app exits');

  const arbitrary = path.join(root, 'AgentDesk-random.exe');
  touch(arbitrary);
  assert.throws(() => resolvePackagedArtifact(arbitrary, 'win32'), /neither win-unpacked/);
}));

test('packaged Renderer proof requires app.asar and parses the packaged version token', () => {
  const url = 'file:///private/tmp/AgentDesk.app/Contents/Resources/app.asar/src/index.html';
  assert.equal(assertPackagedRendererUrl(url), url);
  assert.throws(() => assertPackagedRendererUrl('file:///repo/src/index.html'), /not running from app\.asar/);
  assert.equal(
    runtimeVersionFromUserAgent('Mozilla/5.0 Electron/43.3.0 AgentDesk/0.10.1-preview.1'),
    '0.10.1-preview.1'
  );
  assert.equal(runtimeVersionFromUserAgent('Mozilla/5.0 agent-desk/1.2.3'), '1.2.3');
  assert.equal(runtimeVersionFromUserAgent('Mozilla/5.0 Electron/43.3.0'), null);

  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'));
  const asarApi = { extractFile: (_asarPath, archivePath) => {
    assert.equal(archivePath, 'src/main.js');
    return mainSource;
  } };
  assert.equal(assertPackagedFixedWindowContract({ asarPath: '/fixture/app.asar' }, asarApi), true);
  assert.throws(
    () => assertPackagedFixedWindowContract(
      { asarPath: '/fixture/app.asar' },
      { extractFile: () => Buffer.from(String(mainSource).replace('width: 1040', 'width: 1024')) }
    ),
    /exactly one width: 1040/
  );

  const exactGeometry = {
    outerWidth: 1040,
    outerHeight: 840,
    innerWidth: 1040,
    innerHeight: 812,
    windowX: 0,
    windowY: 0,
    screenWidth: 1440,
    screenHeight: 900,
    screenLeft: 0,
    screenTop: 0,
    screenAvailWidth: 1440,
    screenAvailHeight: 875,
    screenAvailLeft: 0,
    screenAvailTop: 0
  };
  assert.deepEqual(assertPackagedWindowGeometry(exactGeometry), {
    contract: { width: 1040, height: 840 },
    displayClamped: false
  });
  assert.deepEqual(assertPackagedWindowGeometry({
    ...exactGeometry,
    screenLeft: null,
    screenTop: null,
    screenAvailLeft: null,
    screenAvailTop: null
  }), {
    contract: { width: 1040, height: 840 },
    displayClamped: false
  });
  assert.deepEqual(assertPackagedWindowGeometry({
    ...exactGeometry,
    innerHeight: 775
  }), {
    contract: { width: 1040, height: 840 },
    displayClamped: false
  });
  assert.throws(
    () => assertPackagedWindowGeometry({
      ...exactGeometry,
      innerHeight: 743
    }),
    /height frame 97 exceeds 96 CSS px/
  );
  const ciGeometry = {
    outerWidth: 1024,
    outerHeight: 796,
    innerWidth: 1024,
    innerHeight: 768,
    windowX: 0,
    windowY: 0,
    screenWidth: 1024,
    screenHeight: 768,
    screenLeft: 0,
    screenTop: 0,
    screenAvailWidth: 1024,
    screenAvailHeight: 768,
    screenAvailLeft: 0,
    screenAvailTop: 0
  };
  assert.deepEqual(assertPackagedWindowGeometry(ciGeometry), {
    contract: { width: 1040, height: 840 },
    displayClamped: true
  });
  assert.deepEqual(assertPackagedWindowGeometry({
    ...ciGeometry,
    outerHeight: 768,
    innerHeight: 740
  }), {
    contract: { width: 1040, height: 840 },
    displayClamped: true
  });
  const insetMacCiGeometry = {
    ...ciGeometry,
    outerHeight: 681,
    innerHeight: 653,
    windowY: 3,
    screenAvailHeight: 684,
    screenLeft: null,
    screenTop: null
  };
  assert.deepEqual(assertPackagedWindowGeometry(insetMacCiGeometry), {
    contract: { width: 1040, height: 840 },
    displayClamped: true
  });
  assert.deepEqual(assertPackagedWindowGeometry({
    ...insetMacCiGeometry,
    windowY: 25,
    screenAvailTop: 25
  }), {
    contract: { width: 1040, height: 840 },
    displayClamped: true
  });
  assert.deepEqual(assertPackagedWindowGeometry({
    ...insetMacCiGeometry,
    windowY: -1055,
    screenAvailTop: -1058
  }), {
    contract: { width: 1040, height: 840 },
    displayClamped: true
  });
  assert.deepEqual(assertPackagedWindowGeometry({
    ...insetMacCiGeometry,
    outerHeight: 678,
    innerHeight: 650,
    windowY: 3
  }), {
    contract: { width: 1040, height: 840 },
    displayClamped: true
  });
  assert.throws(
    () => assertPackagedWindowGeometry({
      ...insetMacCiGeometry,
      outerHeight: 675,
      innerHeight: 647,
      windowY: 4
    }),
    /neither the 840 contract nor an exact display clamp/
  );
  assert.throws(
    () => assertPackagedWindowGeometry({
      ...insetMacCiGeometry,
      screenAvailTop: null
    }),
    /neither the 840 contract nor an exact display clamp/
  );
  assert.throws(
    () => assertPackagedWindowGeometry({
      ...insetMacCiGeometry,
      outerHeight: 500,
      innerHeight: 472,
      windowY: 184
    }),
    /neither the 840 contract nor an exact display clamp/
  );
  assert.throws(
    () => assertPackagedWindowGeometry({
      ...insetMacCiGeometry,
      outerHeight: 500,
      innerHeight: 300,
      windowY: 184
    }),
    /height frame 200 exceeds 96 CSS px/
  );
  assert.throws(
    () => assertPackagedWindowGeometry({ ...ciGeometry, outerWidth: 1000, innerWidth: 1000 }),
    /neither the 1040 contract nor an exact display clamp/
  );
  assert.throws(
    () => assertPackagedWindowGeometry({ ...ciGeometry, screenWidth: 1440, screenAvailWidth: 1440 }),
    /neither the 1040 contract nor an exact display clamp/
  );
});

test('browser discovery accepts only the spawned loopback DevTools endpoint', () => {
  const output = ['noise\n', 'DevTools listening on ws://127.0.0.1:9229/devtools/browser/abc-123\n'];
  assert.equal(
    browserWebSocketFromOutput(output, 9229),
    'ws://127.0.0.1:9229/devtools/browser/abc-123'
  );
  assert.equal(browserWebSocketFromOutput(output, 9230), null);
  assert.equal(
    browserWebSocketFromOutput('DevTools listening on ws://0.0.0.0:9229/devtools/browser/abc-123', 9229),
    null
  );
  assert.equal(
    browserWebSocketFromOutput('DevTools listening on wss://127.0.0.1:9229/devtools/browser/abc-123', 9229),
    null
  );
  const identity = {
    launchToken: 'a'.repeat(64),
    port: 9229,
    userData: 'C:\\Temp\\agentdesk-smoke',
    keychainMode: 'system'
  };
  const commandLine = [
    'C:\\AgentDesk\\AgentDesk.exe',
    '--enable-automation',
    `--agentdesk-packaged-smoke-token=${identity.launchToken}`,
    '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=9229',
    `--user-data-dir=${identity.userData}`
  ];
  assert.equal(assertBrowserLaunchIdentity(commandLine, identity), true);
  assert.equal(
    assertBrowserLaunchIdentity([...commandLine, '--use-mock-keychain'], { ...identity, keychainMode: 'mock' }),
    true
  );
  assert.throws(
    () => assertBrowserLaunchIdentity([...commandLine, '--use-mock-keychain'], identity),
    /Keychain mode does not match/
  );
  assert.throws(
    () => assertBrowserLaunchIdentity(commandLine, { ...identity, keychainMode: 'mock' }),
    /Keychain mode does not match/
  );
  assert.throws(
    () => assertBrowserLaunchIdentity([...commandLine, '--use-mock-keychain=true'], { ...identity, keychainMode: 'mock' }),
    /Keychain mode does not match/
  );
  assert.throws(
    () => assertBrowserLaunchIdentity(commandLine.filter((entry) => !entry.includes('smoke-token')), identity),
    /not the exact spawned smoke process/
  );
  assert.throws(
    () => assertBrowserLaunchIdentity(commandLine, { ...identity, port: 9230 }),
    /not the exact spawned smoke process/
  );
  assert.throws(
    () => assertBrowserLaunchIdentity([...commandLine, commandLine[2]], identity),
    /missing or duplicate/
  );
});

test('launch environment removes every Mesh route and credential override', () => {
  const source = {
    SAFE: 'yes',
    ELECTRON_RUN_AS_NODE: '1',
    Electron_Run_As_Node: '1',
    agentdesk_signaling_urls: 'https://forbidden.example',
    AgentDesk_Turn_Credential: 'forbidden-secret'
  };
  for (const key of NETWORK_ENV_KEYS) source[key] = `secret-${key}`;
  const clean = scrubMeshNetworkEnvironment(source);
  assert.equal(clean.SAFE, 'yes');
  assert.equal(Object.hasOwn(clean, 'ELECTRON_RUN_AS_NODE'), false);
  const remainingKeys = Object.keys(clean).map((key) => key.toUpperCase());
  assert.equal(remainingKeys.includes('ELECTRON_RUN_AS_NODE'), false);
  for (const key of NETWORK_ENV_KEYS) assert.equal(remainingKeys.includes(key.toUpperCase()), false);
});

test('local-only overview rejects remote devices, enrollment, endpoints, and connections', () => {
  const safe = {
    initialized: true,
    localDeviceId: 'local',
    devices: [{ deviceId: 'local', isLocal: true }],
    connections: [],
    reachability: {
      active: false,
      userEnabled: false,
      networkEnrollmentEnabled: false,
      endpointCount: 0
    }
  };
  assert.doesNotThrow(() => assertLocalOnlyOverview(safe));
  assert.throws(() => assertLocalOnlyOverview({ ...safe, connections: [{}] }), /must not contain Mesh connections/);
  assert.throws(() => assertLocalOnlyOverview({
    ...safe,
    devices: [...safe.devices, { deviceId: 'remote', isLocal: false }]
  }), /must contain no remote devices/);
  assert.throws(() => assertLocalOnlyOverview({
    ...safe,
    reachability: { ...safe.reachability, networkEnrollmentEnabled: true }
  }), /must not enroll/);
});

test('shutdown proof requires both launcher exit and loopback endpoint closure', () => {
  const instance = { child: { pid: 4321 }, port: 9444 };
  assert.equal(shutdownComplete({ processExited: true, portClosed: true }), true);
  assert.equal(shutdownComplete({ processExited: true, portClosed: false }), false);
  assert.deepEqual(
    shutdownFailureReasons(instance, { processExited: false, portClosed: false }),
    [
      'launcher process 4321 is still running',
      'DevTools endpoint 127.0.0.1:9444 is still listening'
    ]
  );
});

test('spawned launcher termination is bound to the exact ChildProcess handle identity', () => {
  const signals = [];
  const child = {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    kill: (signal) => {
      signals.push(signal);
      return true;
    }
  };
  const instance = {
    child,
    childState: { exited: false },
    launcherIdentity: { child, pid: 4321 }
  };
  assert.deepEqual(terminateSpawnedLauncher(instance, 'SIGKILL'), {
    delivered: true,
    pid: 4321,
    signal: 'SIGKILL'
  });
  assert.deepEqual(signals, ['SIGKILL']);

  instance.childState.exited = true;
  assert.deepEqual(terminateSpawnedLauncher(instance, 'SIGKILL'), {
    delivered: false,
    reason: 'launcher-already-exited'
  });
  assert.deepEqual(signals, ['SIGKILL']);

  const replacement = { ...child, kill: () => { throw new Error('must not kill a PID-reuse replacement'); } };
  instance.childState.exited = false;
  instance.child = replacement;
  assert.deepEqual(terminateSpawnedLauncher(instance, 'SIGKILL'), {
    delivered: false,
    reason: 'launcher-identity-mismatch'
  });
  assert.deepEqual(signals, ['SIGKILL']);
});

test('Windows shutdown uses only the exact live spawn handle and fails closed for exited or replaced launchers', async () => {
  const events = [];
  const observations = [
    { processExited: false, portClosed: false },
    { processExited: true, portClosed: true }
  ];
  const child = {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    kill: (signal) => {
      events.push(`handle-kill-${signal}`);
      return true;
    }
  };
  const liveInstance = {
    browserWebSocketUrl: 'ws://127.0.0.1:9444/devtools/browser/unit-test',
    child,
    childState: { exited: false },
    launcherIdentity: { child, pid: 4321 },
    client: { close: () => events.push('renderer-client-close') },
    port: 9444
  };
  const result = await stopPackagedApp(liveInstance, {
    platform: 'win32',
    requestBrowserClose: async () => events.push('browser-close'),
    observeShutdown: async () => {
      events.push('observe');
      return observations.shift();
    }
  });
  assert.deepEqual(result, { processExited: true, portClosed: true });
  assert.deepEqual(events, [
    'browser-close',
    'renderer-client-close',
    'observe',
    'handle-kill-SIGKILL',
    'observe'
  ]);

  const exitedEvents = [];
  const exitedChild = {
    pid: 4321,
    exitCode: 0,
    signalCode: null,
    kill: () => {
      exitedEvents.push('unsafe-kill');
      throw new Error('an exited launcher handle must never be killed');
    }
  };
  const exitedInstance = {
    browserWebSocketUrl: 'ws://127.0.0.1:9444/devtools/browser/unit-test',
    child: exitedChild,
    childState: { exited: true, code: 0 },
    launcherIdentity: { child: exitedChild, pid: 4321 },
    client: { close: () => exitedEvents.push('renderer-client-close') },
    port: 9444
  };
  await assert.rejects(
    stopPackagedApp(exitedInstance, {
      platform: 'win32',
      requestBrowserClose: async () => exitedEvents.push('browser-close'),
      observeShutdown: async () => ({ processExited: true, portClosed: false })
    }),
    /DevTools endpoint 127\.0\.0\.1:9444 is still listening/
  );
  assert.deepEqual(exitedEvents, ['browser-close', 'renderer-client-close']);

  const replacementEvents = [];
  const originalChild = { pid: 4321 };
  const replacementChild = {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    kill: () => {
      replacementEvents.push('unsafe-kill');
      throw new Error('same PID is not the same spawned process');
    }
  };
  const replacementInstance = {
    child: replacementChild,
    childState: { exited: false },
    launcherIdentity: { child: originalChild, pid: 4321 },
    client: { close: () => {} },
    port: 9444
  };
  await assert.rejects(
    stopPackagedApp(replacementInstance, {
      platform: 'win32',
      requestBrowserClose: async () => false,
      observeShutdown: async () => ({ processExited: false, portClosed: false })
    }),
    /launcher process 4321 is still running; DevTools endpoint 127\.0\.0\.1:9444 is still listening/
  );
  assert.deepEqual(replacementEvents, []);
});

test('macOS and unpacked shutdown escalate signals and fail when either proof remains open', async () => {
  const signals = [];
  const observations = [
    { processExited: false, portClosed: false },
    { processExited: false, portClosed: false },
    { processExited: true, portClosed: false }
  ];
  const instance = {
    child: null,
    childState: { exited: false },
    client: { close: () => {} },
    port: 9555
  };
  instance.child = {
      pid: 8765,
      exitCode: null,
      signalCode: null,
      kill: (signal) => {
        signals.push(signal);
        return true;
      }
  };
  instance.launcherIdentity = { child: instance.child, pid: 8765 };
  await assert.rejects(
    stopPackagedApp(instance, {
      platform: 'darwin',
      requestBrowserClose: async () => false,
      observeShutdown: async () => observations.shift()
    }),
    /DevTools endpoint 127\.0\.0\.1:9555 is still listening/
  );
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
