#!/usr/bin/env node

/*
 * Packaged first-use smoke test.
 *
 * This runner intentionally accepts only a packaged AgentDesk artifact. It
 * launches the artifact with a disposable Chromium userData directory, drives
 * its packaged Renderer over a loopback-only DevTools endpoint, and exercises
 * the production preload/Main first-Agent initialization contract.
 *
 * The normal UI create button continues into the official-client provisioning
 * boundary. A release smoke test must not open an installer, login window, or
 * third-party client, so this runner stops at the same bounded
 * `onboarding:initializeFirstAgent` IPC. It then restarts the packaged app and
 * completes the real versioned review/finish UI. No Mesh invitation, signaling,
 * transfer, remote view, remote input, account launch, or clipboard action is
 * used.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { loadElectronBuilderDependency } = require('./verify-electron-package-integrity');

const APP_ROOT = path.resolve(__dirname, '..');
const PACKAGE = require(path.join(APP_ROOT, 'package.json'));
const ONBOARDING = require(path.join(APP_ROOT, 'src', 'onboarding-state.js'));
const PRODUCT_NAME = 'AgentDesk';
const DEFAULT_TIMEOUT_MS = 45_000;
const MAIN_WINDOW_CONTRACT = Object.freeze({ width: 1040, height: 840 });
const MAX_OBSERVED_WINDOW_FRAME_CSS_PX = 96;
const MAX_AVAILABLE_EDGE_INSET_CSS_PX = 8;
const NETWORK_ENV_KEYS = Object.freeze([
  'AGENTDESK_ALLOW_INSECURE_SIGNALING',
  'AGENTDESK_SIGNALING_URLS',
  'AGENTDESK_STUN_URLS',
  'AGENTDESK_TURN_URLS',
  'AGENTDESK_TURN_USERNAME',
  'AGENTDESK_TURN_CREDENTIAL',
  'AGENTDESK_E2E_SIGNALING'
]);

class DevToolsClient {
  constructor(url, timeoutMs = DEFAULT_TIMEOUT_MS, sessionId = null) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.sessionId = sessionId;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    assert.equal(typeof WebSocket, 'function', 'Node 22+ WebSocket support is required');
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error('DevTools WebSocket connection timed out')), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('DevTools WebSocket connection failed'));
      }, { once: true });
      socket.addEventListener('message', (event) => this.handleMessage(event.data));
      socket.addEventListener('close', () => {
        this.rejectPending(new Error('DevTools WebSocket closed'));
        this.socket = null;
      });
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (_error) {
      return;
    }
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'DevTools command failed'));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.method && (!this.sessionId || message.sessionId === this.sessionId)) {
      this.events.push(message);
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  call(method, params = {}) {
    assert.ok(this.socket, 'DevTools client is not connected');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      const request = { id, method, params };
      if (this.sessionId) request.sessionId = this.sessionId;
      this.socket.send(JSON.stringify(request));
    });
  }

  async evaluate(expression) {
    const response = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (response.exceptionDetails) {
      const description = response.exceptionDetails.exception?.description
        || response.exceptionDetails.text
        || 'Renderer evaluation failed';
      throw new Error(description);
    }
    return response.result?.value;
  }

  close() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }
}

function usage() {
  return [
    'Usage:',
    '  node scripts/packaged-first-use-smoke.js --artifact <path> [options]',
    '',
    'Accepted artifacts:',
    '  macOS:   AgentDesk.app or a directory containing AgentDesk.app',
    '  Windows: win-unpacked directory, its AgentDesk.exe, or the portable .exe',
    '',
    'Options:',
    `  --expected-version <version>             default: ${PACKAGE.version}`,
    `  --expected-onboarding-version <number>   default: ${ONBOARDING.CURRENT_VERSION}`,
    '  --artifacts <directory>                  write screenshots and report.json',
    '  --timeout-ms <milliseconds>              5000..120000',
    '  --macos-ci-mock-keychain                 ad-hoc macOS CI only; never a release candidate',
    '  --keep-temp                              preserve disposable userData',
    '  --help'
  ].join('\n');
}

function parseArguments(argv, env = process.env) {
  const options = {
    artifact: env.AGENTDESK_PACKAGED_ARTIFACT || null,
    expectedVersion: PACKAGE.version,
    expectedOnboardingVersion: ONBOARDING.CURRENT_VERSION,
    artifacts: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    macosCiMockKeychain: false,
    keepTemp: false,
    help: false
  };
  const valueOptions = new Map([
    ['--artifact', 'artifact'],
    ['--expected-version', 'expectedVersion'],
    ['--expected-onboarding-version', 'expectedOnboardingVersion'],
    ['--artifacts', 'artifacts'],
    ['--timeout-ms', 'timeoutMs']
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    if (argument === '--keep-temp') {
      options.keepTemp = true;
      continue;
    }
    if (argument === '--macos-ci-mock-keychain') {
      options.macosCiMockKeychain = true;
      continue;
    }
    const key = valueOptions.get(argument);
    if (!key) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    options[key] = value;
    index += 1;
  }
  options.expectedOnboardingVersion = Number(options.expectedOnboardingVersion);
  options.timeoutMs = Number(options.timeoutMs);
  if (!Number.isSafeInteger(options.expectedOnboardingVersion) || options.expectedOnboardingVersion < 1) {
    throw new Error('--expected-onboarding-version must be a positive integer');
  }
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 5_000 || options.timeoutMs > 120_000) {
    throw new Error('--timeout-ms must be an integer from 5000 to 120000');
  }
  if (!options.help && !options.artifact) throw new Error('--artifact is required');
  if (options.artifact) options.artifact = path.resolve(options.artifact);
  if (options.artifacts) options.artifacts = path.resolve(options.artifacts);
  return options;
}

function requireFile(filePath, label) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (_error) {
    throw new Error(`${label} is missing: ${filePath}`);
  }
  if (!stat.isFile()) throw new Error(`${label} is not a file: ${filePath}`);
  return filePath;
}

function requireDirectory(directoryPath, label) {
  let stat;
  try {
    stat = fs.statSync(directoryPath);
  } catch (_error) {
    throw new Error(`${label} is missing: ${directoryPath}`);
  }
  if (!stat.isDirectory()) throw new Error(`${label} is not a directory: ${directoryPath}`);
  return directoryPath;
}

function resolveMacBundle(inputPath) {
  const stat = fs.statSync(inputPath);
  let bundlePath = null;
  if (stat.isDirectory() && inputPath.toLowerCase().endsWith('.app')) {
    bundlePath = inputPath;
  } else if (stat.isDirectory()) {
    const bundles = fs.readdirSync(inputPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.toLowerCase() === 'agentdesk.app')
      .map((entry) => path.join(inputPath, entry.name));
    if (bundles.length !== 1) {
      throw new Error(`Expected exactly one AgentDesk.app in ${inputPath}; found ${bundles.length}`);
    }
    [bundlePath] = bundles;
  } else if (stat.isFile()) {
    const macosDirectory = path.dirname(inputPath);
    const contentsDirectory = path.dirname(macosDirectory);
    const possibleBundle = path.dirname(contentsDirectory);
    if (
      path.basename(macosDirectory) === 'MacOS'
      && path.basename(contentsDirectory) === 'Contents'
      && path.basename(possibleBundle).toLowerCase() === 'agentdesk.app'
    ) {
      bundlePath = possibleBundle;
    }
  }
  if (!bundlePath || path.basename(bundlePath).toLowerCase() !== 'agentdesk.app') {
    throw new Error('macOS artifact must be AgentDesk.app, not a source Electron runtime');
  }
  const executablePath = path.join(bundlePath, 'Contents', 'MacOS', PRODUCT_NAME);
  const asarPath = path.join(bundlePath, 'Contents', 'Resources', 'app.asar');
  requireFile(executablePath, 'packaged macOS executable');
  requireFile(asarPath, 'packaged app.asar');
  requireFile(path.join(bundlePath, 'Contents', 'Info.plist'), 'packaged Info.plist');
  fs.accessSync(executablePath, fs.constants.X_OK);
  return {
    kind: 'mac-app',
    artifactPath: fs.realpathSync(bundlePath),
    executablePath: fs.realpathSync(executablePath),
    asarPath: fs.realpathSync(asarPath),
    allowLauncherExit: false
  };
}

function resolveWindowsArtifact(inputPath) {
  const stat = fs.statSync(inputPath);
  if (stat.isDirectory()) {
    const executablePath = path.join(inputPath, `${PRODUCT_NAME}.exe`);
    const asarPath = path.join(inputPath, 'resources', 'app.asar');
    requireFile(executablePath, 'win-unpacked executable');
    requireFile(asarPath, 'win-unpacked app.asar');
    return {
      kind: 'windows-unpacked',
      artifactPath: fs.realpathSync(inputPath),
      executablePath: fs.realpathSync(executablePath),
      asarPath: fs.realpathSync(asarPath),
      allowLauncherExit: false
    };
  }
  requireFile(inputPath, 'Windows executable artifact');
  if (path.extname(inputPath).toLowerCase() !== '.exe') {
    throw new Error('Windows artifact must be a .exe or win-unpacked directory');
  }
  const adjacentAsar = path.join(path.dirname(inputPath), 'resources', 'app.asar');
  if (path.basename(inputPath).toLowerCase() === 'agentdesk.exe' && fs.existsSync(adjacentAsar)) {
    requireFile(adjacentAsar, 'win-unpacked app.asar');
    return {
      kind: 'windows-unpacked',
      artifactPath: fs.realpathSync(path.dirname(inputPath)),
      executablePath: fs.realpathSync(inputPath),
      asarPath: fs.realpathSync(adjacentAsar),
      allowLauncherExit: false
    };
  }
  if (!/^AgentDesk-.+-portable-(x64|arm64)\.exe$/i.test(path.basename(inputPath))) {
    throw new Error('Windows executable is neither win-unpacked AgentDesk.exe nor a versioned AgentDesk portable artifact');
  }
  return {
    kind: 'windows-portable',
    artifactPath: fs.realpathSync(inputPath),
    executablePath: fs.realpathSync(inputPath),
    asarPath: null,
    // electron-builder's portable launcher forwards argv and waits for the
    // inner application. An early launcher exit therefore means the exact
    // artifact under test can no longer be supervised and must fail closed.
    allowLauncherExit: false
  };
}

function resolvePackagedArtifact(inputPath, platform = process.platform) {
  if (!['darwin', 'win32'].includes(platform)) {
    throw new Error(`Packaged smoke is supported only on macOS and Windows, not ${platform}`);
  }
  const absolute = path.resolve(String(inputPath || ''));
  if (!absolute || !fs.existsSync(absolute)) throw new Error(`Artifact does not exist: ${absolute}`);
  if (/[\\/]node_modules[\\/]electron(?:[\\/]|$)/i.test(absolute)) {
    throw new Error('Source Electron runtime is forbidden; provide a packaged AgentDesk artifact');
  }
  return platform === 'darwin' ? resolveMacBundle(absolute) : resolveWindowsArtifact(absolute);
}

function readPackagedMainSource(artifact, asarApi = null) {
  assert.ok(artifact?.asarPath, 'packaged main-window contract requires an unpacked app.asar');
  const api = asarApi || loadElectronBuilderDependency('@electron/asar');
  assert.equal(typeof api?.extractFile, 'function', 'packaged main-window contract requires ASAR extraction support');
  let source;
  try {
    source = api.extractFile(artifact.asarPath, 'src/main.js');
  } catch (error) {
    throw new Error(`Unable to read packaged src/main.js from app.asar: ${error?.message || error}`);
  }
  const buffer = Buffer.isBuffer(source) ? source : Buffer.from(source || '');
  assert.ok(buffer.length > 0, 'packaged src/main.js is empty');
  return buffer.toString('utf8');
}

function assertPackagedFixedWindowContract(artifact, asarApi = null) {
  const source = readPackagedMainSource(artifact, asarApi);
  const match = source.match(
    /function\s+createWindow\s*\(\s*\)\s*\{[\s\S]*?mainWindow\s*=\s*new\s+BrowserWindow\s*\(\s*\{([\s\S]*?)\n\s*\}\s*\)\s*;\s*\n\s*installMainWindowSecurity\s*\(/
  );
  assert.ok(match, 'packaged src/main.js is missing the main BrowserWindow construction');
  const optionsSource = match[1];
  for (const [name, expected] of Object.entries({
    width: MAIN_WINDOW_CONTRACT.width,
    height: MAIN_WINDOW_CONTRACT.height,
    resizable: false,
    maximizable: false,
    fullscreenable: false
  })) {
    const property = new RegExp(`^\\s*${name}\\s*:\\s*(${typeof expected === 'boolean' ? 'true|false' : '\\d+'})\\s*,?\\s*$`, 'gm');
    const values = [...optionsSource.matchAll(property)].map((item) => (
      typeof expected === 'boolean' ? item[1] === 'true' : Number(item[1])
    ));
    assert.deepEqual(values, [expected], `packaged main BrowserWindow must declare exactly one ${name}: ${expected}`);
  }
  return true;
}

function assertPackagedWindowGeometry(snapshot) {
  const dimensions = [
    {
      name: 'width',
      actual: snapshot.outerWidth,
      inner: snapshot.innerWidth,
      contract: MAIN_WINDOW_CONTRACT.width,
      position: snapshot.windowX,
      available: snapshot.screenAvailWidth,
      availableOrigin: snapshot.screenAvailLeft,
      full: snapshot.screenWidth
    },
    {
      name: 'height',
      actual: snapshot.outerHeight,
      inner: snapshot.innerHeight,
      contract: MAIN_WINDOW_CONTRACT.height,
      position: snapshot.windowY,
      available: snapshot.screenAvailHeight,
      availableOrigin: snapshot.screenAvailTop,
      full: snapshot.screenHeight
    }
  ];
  let displayClamped = false;
  for (const dimension of dimensions) {
    for (const [label, value] of Object.entries({
      actual: dimension.actual,
      inner: dimension.inner,
      available: dimension.available,
      full: dimension.full
    })) {
      assert.ok(Number.isFinite(value) && value > 0, `packaged window ${dimension.name} ${label} metric is invalid`);
    }
    assert.ok(
      dimension.inner <= dimension.actual,
      `packaged window inner ${dimension.name} cannot exceed its outer ${dimension.name}`
    );
    const frame = dimension.actual - dimension.inner;
    assert.ok(
      frame <= MAX_OBSERVED_WINDOW_FRAME_CSS_PX,
      `packaged window ${dimension.name} frame ${frame} exceeds ${MAX_OBSERVED_WINDOW_FRAME_CSS_PX} CSS px`
    );
    const accepted = new Set([dimension.contract]);
    for (const displaySize of [dimension.available, dimension.full]) {
      accepted.add(Math.min(dimension.contract, displaySize));
      accepted.add(Math.min(dimension.contract, displaySize + frame));
    }

    // GitHub macOS runners have trimmed exactly three CSS pixels from either
    // edge of the available span. An independent eight-pixel total budget also
    // covers a 3 + 3 split plus two pixels of CSS rounding, while remaining far
    // below observed window chrome (28px on macOS and 65px on Windows). Never
    // let the frame measurement enlarge this edge budget.
    let exactAvailableEdgeClamp = false;
    let edgeInsets = null;
    if (
      !accepted.has(dimension.actual)
      && Number.isFinite(dimension.position)
      && Number.isFinite(dimension.availableOrigin)
    ) {
      const leading = dimension.position - dimension.availableOrigin;
      const trailing = (
        dimension.availableOrigin + dimension.available
        - (dimension.position + dimension.actual)
      );
      const total = leading + trailing;
      edgeInsets = { leading, trailing, total };
      exactAvailableEdgeClamp = (
        leading >= 0
        && trailing >= 0
        && total <= MAX_AVAILABLE_EDGE_INSET_CSS_PX
        && dimension.actual + leading + trailing === dimension.available
      );
    }
    assert.ok(
      accepted.has(dimension.actual) || exactAvailableEdgeClamp,
      `packaged BrowserWindow ${dimension.name} ${dimension.actual} is neither the ${dimension.contract} contract nor an exact display clamp (${[...accepted].join(', ')}; position ${dimension.position}; available origin ${dimension.availableOrigin}; edge insets ${JSON.stringify(edgeInsets)})`
    );
    if (dimension.actual !== dimension.contract) displayClamped = true;
  }
  return {
    contract: MAIN_WINDOW_CONTRACT,
    displayClamped
  };
}

function assertAdHocMacSignatureSlice(details, architecture) {
  const lines = String(details || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const signatures = lines.filter((line) => line.startsWith('Signature='));
  assert.deepEqual(
    signatures,
    ['Signature=adhoc'],
    `macOS CI mock Keychain requires exactly one ad-hoc signature for ${architecture}`
  );
  assert.equal(
    lines.some((line) => line.startsWith('Authority=')),
    false,
    `macOS CI mock Keychain is forbidden for a certificate-signed ${architecture} slice`
  );
  assert.deepEqual(
    lines.filter((line) => line.startsWith('TeamIdentifier=')),
    ['TeamIdentifier=not set'],
    `macOS CI mock Keychain requires no signing team identity for ${architecture}`
  );
}

function assertAdHocMacSignatureDetails(report) {
  assert.ok(report && typeof report === 'object', 'macOS signature report is required');
  const architectures = Array.isArray(report.architectures) ? report.architectures.map(String) : [];
  const slices = Array.isArray(report.slices) ? report.slices : [];
  assert.ok(architectures.length > 0, 'macOS signature report contains no architectures');
  assert.equal(new Set(architectures).size, architectures.length, 'macOS signature report repeats an architecture');
  assert.equal(slices.length, architectures.length, 'macOS signature report must classify every architecture');
  const slicesByArchitecture = new Map();
  for (const slice of slices) {
    const architecture = String(slice?.architecture || '');
    assert.ok(architectures.includes(architecture), `macOS signature report contains unexpected ${architecture || 'empty'} slice`);
    assert.equal(slicesByArchitecture.has(architecture), false, `macOS signature report repeats ${architecture}`);
    slicesByArchitecture.set(architecture, slice);
  }
  for (const architecture of architectures) {
    const slice = slicesByArchitecture.get(architecture);
    assert.ok(slice, `macOS signature report is missing ${architecture}`);
    assertAdHocMacSignatureSlice(slice.details, architecture);
  }
  return true;
}

function runMacSignatureCommand(command, args, label, commandRunner) {
  let result;
  try {
    result = commandRunner(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
  } catch (error) {
    throw new Error(`${label}: ${error?.message || error}`);
  }
  if (!result || typeof result !== 'object') throw new Error(`${label}: command returned no result`);
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(label);
  return result;
}

function readMacSignatureDetails(bundlePath, commandRunner = spawnSync) {
  runMacSignatureCommand('/usr/bin/codesign', [
    '--verify',
    '--deep',
    '--strict',
    '--all-architectures',
    bundlePath
  ], 'macOS CI mock Keychain requires a valid signature on every AgentDesk.app architecture', commandRunner);
  const executablePath = path.join(bundlePath, 'Contents', 'MacOS', PRODUCT_NAME);
  const architectureResult = runMacSignatureCommand(
    '/usr/bin/lipo',
    ['-archs', executablePath],
    'Unable to enumerate macOS package architectures',
    commandRunner
  );
  const architectures = String(architectureResult.stdout || '').trim().split(/\s+/).filter(Boolean);
  assert.ok(architectures.length > 0, 'macOS package contains no reported architectures');
  assert.equal(new Set(architectures).size, architectures.length, 'macOS package repeats a reported architecture');
  for (const architecture of architectures) {
    assert.match(architecture, /^[A-Za-z0-9_]+$/, `Unsupported macOS architecture name: ${architecture}`);
  }
  const slices = architectures.map((architecture) => {
    const result = runMacSignatureCommand('/usr/bin/codesign', [
      '--display',
      '--verbose=4',
      '--architecture',
      architecture,
      bundlePath
    ], `Unable to inspect the ${architecture} macOS package signature`, commandRunner);
    return {
      architecture,
      details: `${result.stdout || ''}\n${result.stderr || ''}`
    };
  });
  return { architectures, slices };
}

function resolveSmokeKeychainMode(options, artifact, runtime = {}) {
  if (options?.macosCiMockKeychain !== true) return 'system';
  const platform = runtime.platform || process.platform;
  if (platform !== 'darwin') {
    throw new Error('--macos-ci-mock-keychain is supported only on macOS');
  }
  if (artifact?.kind !== 'mac-app' || !String(artifact?.artifactPath || '').toLowerCase().endsWith('.app')) {
    throw new Error('--macos-ci-mock-keychain requires a packaged AgentDesk.app');
  }
  const signatureDetails = runtime.readMacSignatureDetails
    ? runtime.readMacSignatureDetails(artifact.artifactPath)
    : readMacSignatureDetails(artifact.artifactPath, runtime.runCommand || spawnSync);
  assertAdHocMacSignatureDetails(signatureDetails);
  return 'mock';
}

function packagedRendererPath(url) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(url || ''));
  } catch (_error) {
    decoded = String(url || '');
  }
  return decoded.replace(/\\/g, '/');
}

function assertPackagedRendererUrl(url) {
  const value = packagedRendererPath(url);
  assert.match(value, /^file:/i, `Renderer must load a packaged file URL, got ${value}`);
  assert.match(value, /\/app\.asar\/src\/index\.html(?:[?#].*)?$/i, `Renderer is not running from app.asar: ${value}`);
  return value;
}

function runtimeVersionFromUserAgent(userAgent) {
  const match = String(userAgent || '').match(/(?:AgentDesk|agent-desk)\/([^\s]+)/i);
  return match ? match[1] : null;
}

function scrubMeshNetworkEnvironment(environment = process.env) {
  const clean = { ...environment };
  const blockedKeys = new Set([
    ...NETWORK_ENV_KEYS,
    'ELECTRON_RUN_AS_NODE'
  ].map((key) => key.toUpperCase()));
  // Windows environment names are case-insensitive even though a JavaScript
  // object can contain differently-cased aliases. Remove every alias so a
  // caller cannot accidentally preserve a Mesh route or Electron override.
  for (const key of Object.keys(clean)) {
    if (blockedKeys.has(key.toUpperCase())) delete clean[key];
  }
  return clean;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readProfiles(userData) {
  const stored = readJson(path.join(userData, 'profiles.json'));
  return Array.isArray(stored) ? stored : (stored.profiles || []);
}

function readSettings(userData) {
  const stored = readJson(path.join(userData, 'settings.json'));
  return stored.settings || stored;
}

function onboardingProgress(userData) {
  const value = readSettings(userData).onboarding || {};
  return {
    completedVersion: Number(value.completedVersion) || 0,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null
  };
}

function assertLocalOnlySettings(userData) {
  const settings = readSettings(userData);
  assert.equal(settings.meshNetworkEnrollmentEnabled, false, 'first Agent must persist Mesh network enrollment=false');
  assert.deepEqual(settings.meshSignalingUrls || [], [], 'first Agent must not configure signaling');
  assert.deepEqual(settings.meshStunUrls || [], [], 'first Agent must not configure STUN');
}

function assertLocalOnlyOverview(overview, label = 'overview') {
  assert.equal(overview?.initialized, true, `${label} must be initialized`);
  assert.equal((overview?.connections || []).length, 0, `${label} must not contain Mesh connections`);
  assert.equal(overview?.reachability?.active === true, false, `${label} must not open a pairing/listening endpoint`);
  assert.equal(overview?.reachability?.userEnabled === true, false, `${label} must not enable LAN reachability`);
  assert.equal(overview?.reachability?.networkEnrollmentEnabled === true, false, `${label} must not enroll in Mesh networking`);
  assert.equal(Number(overview?.reachability?.endpointCount) || 0, 0, `${label} must expose zero pairing endpoints`);
  const localDeviceId = String(overview?.localDeviceId || '');
  const remoteDevices = (overview?.devices || []).filter((device) => (
    !device?.isLocal && String(device?.deviceId || '') !== localDeviceId
  ));
  assert.deepEqual(remoteDevices, [], `${label} must contain no remote devices`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function fetchTimeout(ms = 5_000) {
  return typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(ms) : undefined;
}

async function fetchJson(url, timeoutMs = 5_000) {
  const response = await fetch(url, { signal: fetchTimeout(timeoutMs) });
  if (!response.ok) throw new Error(`DevTools endpoint returned HTTP ${response.status}`);
  return response.json();
}

function browserWebSocketFromOutput(output, port) {
  const matches = [...String(Array.isArray(output) ? output.join('') : output || '')
    .matchAll(/DevTools listening on (ws:\/\/[^\s]+)/g)];
  const candidate = matches.at(-1)?.[1] || null;
  return validatedBrowserWebSocketUrl(candidate, port);
}

function validatedBrowserWebSocketUrl(candidate, port) {
  if (!candidate) return null;
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (_error) {
    return null;
  }
  if (
    parsed.protocol !== 'ws:'
    || parsed.hostname !== '127.0.0.1'
    || Number(parsed.port) !== Number(port)
    || !/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(parsed.pathname)
  ) {
    return null;
  }
  return parsed.href;
}

function assertBrowserLaunchIdentity(commandLine, identity) {
  assert.ok(identity && typeof identity === 'object', 'spawned launcher identity is required');
  assert.match(identity.launchToken || '', /^[a-f0-9]{64}$/, 'spawned launcher token is invalid');
  const argumentsList = Array.isArray(commandLine) ? commandLine.map(String) : [];
  assert.ok(argumentsList.length > 0, 'DevTools Browser command line is unavailable');
  const required = [
    `--agentdesk-packaged-smoke-token=${identity.launchToken}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${identity.port}`,
    `--user-data-dir=${identity.userData}`
  ];
  for (const argument of required) {
    assert.equal(
      argumentsList.filter((value) => value === argument).length,
      1,
      `DevTools Browser is not the exact spawned smoke process: missing or duplicate ${argument.split('=')[0]}`
    );
  }
  assert.ok(['system', 'mock'].includes(identity.keychainMode), 'spawned launcher Keychain mode is invalid');
  const mockKeychainArguments = argumentsList.filter((value) => (
    value === '--use-mock-keychain' || value.startsWith('--use-mock-keychain=')
  ));
  assert.deepEqual(
    mockKeychainArguments,
    identity.keychainMode === 'mock' ? ['--use-mock-keychain'] : [],
    `DevTools Browser Keychain mode does not match the spawned ${identity.keychainMode} smoke process`
  );
  return true;
}

async function waitForTarget(port, childState, artifact, launchIdentity, timeoutMs, output) {
  const deadline = Date.now() + timeoutMs;
  let lastTargets = [];
  let lastFetchError = null;
  let browserClient = null;
  let browserWebSocketUrl = null;
  let browserIdentityVerified = false;
  while (Date.now() < deadline) {
    if (childState.exited && !artifact.allowLauncherExit) {
      throw new Error(`Packaged executable exited before DevTools became ready (${childState.code})`);
    }
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      lastTargets = targets.map((item) => ({
        type: String(item?.type || ''),
        title: String(item?.title || ''),
        url: packagedRendererPath(item?.url || '')
      })).slice(0, 8);
      lastFetchError = null;
      const target = targets.find((item) => (
        item.type === 'page' && /\/app\.asar\/src\/index\.html/i.test(packagedRendererPath(item.url))
      ));
      if (target?.webSocketDebuggerUrl) {
        try {
          const listed = (await fetchJson(`http://127.0.0.1:${port}/json/version`)).webSocketDebuggerUrl || null;
          const listedBrowserWebSocketUrl = validatedBrowserWebSocketUrl(listed, port);
          if (listedBrowserWebSocketUrl && listedBrowserWebSocketUrl !== browserWebSocketUrl) {
            browserClient?.close();
            browserClient = null;
            browserIdentityVerified = false;
            browserWebSocketUrl = listedBrowserWebSocketUrl;
          }
        } catch (error) {
          lastFetchError = `browser endpoint discovery: ${String(error?.message || error)}`;
        }
      }
    } catch (error) {
      // The packaged app has not opened the loopback debugging endpoint yet.
      lastFetchError = String(error?.message || error);
    }
    const outputWebSocketUrl = browserWebSocketFromOutput(output, port);
    if (outputWebSocketUrl && outputWebSocketUrl !== browserWebSocketUrl) {
      browserClient?.close();
      browserClient = null;
      browserIdentityVerified = false;
      browserWebSocketUrl = outputWebSocketUrl;
    }
    if (browserWebSocketUrl && !browserClient) {
      try {
        browserClient = new DevToolsClient(browserWebSocketUrl, Math.min(timeoutMs, 10_000));
        await browserClient.connect();
      } catch (error) {
        browserClient?.close();
        browserClient = null;
        lastFetchError = `browser websocket: ${String(error?.message || error)}`;
      }
    }
    if (browserClient) {
      try {
        if (!browserIdentityVerified) {
          const commandLine = await browserClient.call('Browser.getBrowserCommandLine');
          assertBrowserLaunchIdentity(commandLine.arguments, launchIdentity);
          browserIdentityVerified = true;
        }
        const response = await browserClient.call('Target.getTargets');
        const targetInfos = Array.isArray(response.targetInfos) ? response.targetInfos : [];
        lastTargets = targetInfos.map((item) => ({
          type: String(item?.type || ''),
          title: String(item?.title || ''),
          url: packagedRendererPath(item?.url || '')
        })).slice(0, 8);
        const targetInfo = targetInfos.find((item) => (
          item.type === 'page' && /\/app\.asar\/src\/index\.html/i.test(packagedRendererPath(item.url))
        ));
        if (targetInfo?.targetId) {
          const attached = await browserClient.call('Target.attachToTarget', {
            targetId: targetInfo.targetId,
            flatten: true
          });
          assert.ok(attached.sessionId, 'DevTools target attachment did not return a session');
          browserClient.sessionId = attached.sessionId;
          return {
            browserWebSocketUrl,
            client: browserClient,
            target: {
              id: targetInfo.targetId,
              title: targetInfo.title,
              type: targetInfo.type,
              url: targetInfo.url
            }
          };
        }
      } catch (error) {
        browserClient.close();
        browserClient = null;
        browserIdentityVerified = false;
        lastFetchError = `browser target discovery: ${String(error?.message || error)}`;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browserClient?.close();
  const exitNote = childState.exited ? `; launcher exited ${childState.code}` : '';
  const discoveryNote = lastTargets.length
    ? `; observed targets=${JSON.stringify(lastTargets)}`
    : `; last discovery error=${lastFetchError || 'none'}`;
  throw new Error(`Timed out waiting for a packaged app.asar Renderer${exitNote}${discoveryNote}`);
}

async function waitFor(client, expression, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for packaged app storage: ${filePath}`);
}

async function waitForProgress(userData, version, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const progress = onboardingProgress(userData);
      if (progress.completedVersion === version) return progress;
    } catch (_error) {
      // Atomic settings write may be between rename and visibility.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for onboarding completion version ${version}`);
}

async function capture(client, directory, name) {
  if (!directory) return null;
  fs.mkdirSync(directory, { recursive: true });
  const screenshot = await client.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  const target = path.join(directory, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(screenshot.data, 'base64'));
  return target;
}

async function launchPackagedApp(artifact, userData, output, timeoutMs, keychainMode) {
  fs.mkdirSync(userData, { recursive: true });
  assert.ok(['system', 'mock'].includes(keychainMode), 'packaged smoke Keychain mode is invalid');
  const port = await freePort();
  const launchToken = crypto.randomBytes(32).toString('hex');
  const childState = { exited: false, code: null, signal: null, error: null };
  const child = spawn(artifact.executablePath, [
    '--enable-automation',
    `--agentdesk-packaged-smoke-token=${launchToken}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--disable-background-networking',
    '--no-first-run',
    ...(keychainMode === 'mock' ? ['--use-mock-keychain'] : []),
    `--user-data-dir=${userData}`
  ], {
    cwd: artifact.kind === 'mac-app'
      ? path.dirname(artifact.artifactPath)
      : path.dirname(artifact.executablePath),
    env: scrubMeshNetworkEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  child.stdout.on('data', (chunk) => output.push(String(chunk)));
  child.stderr.on('data', (chunk) => output.push(String(chunk)));
  child.once('exit', (code, signal) => {
    childState.exited = true;
    childState.code = code;
    childState.signal = signal;
  });
  child.once('error', (error) => {
    childState.exited = true;
    childState.error = error;
  });
  const launcherIdentity = Object.freeze({
    child,
    launchToken,
    pid: child.pid,
    port,
    userData,
    keychainMode
  });
  const instance = {
    artifact,
    browserWebSocketUrl: null,
    child,
    childState,
    launcherIdentity,
    client: null,
    port,
    target: null
  };
  try {
    const discovered = await waitForTarget(port, childState, artifact, launcherIdentity, timeoutMs, output);
    const client = discovered.client || new DevToolsClient(discovered.target.webSocketDebuggerUrl, timeoutMs);
    if (!discovered.client) await client.connect();
    instance.browserWebSocketUrl = discovered.browserWebSocketUrl;
    instance.client = client;
    instance.target = discovered.target;
    assert.equal(await client.evaluate('1 + 1'), 2, 'packaged Renderer DevTools handshake failed');
    return instance;
  } catch (error) {
    instance.browserWebSocketUrl ||= browserWebSocketFromOutput(output, port);
    try {
      await stopPackagedApp(instance);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Packaged application launch and cleanup both failed'
      );
    }
    throw error;
  }
}

async function isLoopbackPortOpen(port, timeoutMs = 750) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    // A loopback connect timeout is not proof that the listener disappeared.
    // Fail closed and let the outer shutdown deadline retry or report it.
    socket.once('timeout', () => finish(true));
  });
}

async function waitForPortClosed(port, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isLoopbackPortOpen(port)) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return !await isLoopbackPortOpen(port);
}

async function waitForChildExit(instance, timeoutMs = 4_000) {
  if (instance.childState.exited) return true;
  return new Promise((resolve) => {
    let timer = null;
    const finish = (exited) => {
      if (timer) clearTimeout(timer);
      instance.child.off('exit', onExit);
      instance.child.off('error', onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(true);
    instance.child.once('exit', onExit);
    instance.child.once('error', onError);
    if (instance.childState.exited) {
      finish(true);
      return;
    }
    timer = setTimeout(() => finish(false), timeoutMs);
  });
}

async function observeShutdown(instance, timeoutMs = 6_000) {
  const [processExited, portClosed] = await Promise.all([
    waitForChildExit(instance, timeoutMs),
    waitForPortClosed(instance.port, timeoutMs)
  ]);
  return { processExited, portClosed };
}

function shutdownComplete(state) {
  return state?.processExited === true && state?.portClosed === true;
}

function shutdownFailureReasons(instance, state) {
  const reasons = [];
  if (state?.processExited !== true) {
    reasons.push(`launcher process ${instance?.child?.pid || 'unknown'} is still running`);
  }
  if (state?.portClosed !== true) {
    reasons.push(`DevTools endpoint 127.0.0.1:${instance?.port || 'unknown'} is still listening`);
  }
  return reasons;
}

function terminateSpawnedLauncher(instance, signal) {
  const child = instance?.child;
  const identity = instance?.launcherIdentity;
  if (
    !child
    || !identity
    || identity.child !== child
    || identity.pid !== child.pid
  ) {
    return { delivered: false, reason: 'launcher-identity-mismatch' };
  }
  if (
    instance.childState?.exited === true
    || child.exitCode != null
    || child.signalCode != null
  ) {
    return { delivered: false, reason: 'launcher-already-exited' };
  }
  if (typeof child.kill !== 'function') {
    return { delivered: false, reason: 'launcher-handle-unavailable' };
  }
  // ChildProcess.kill uses the libuv handle returned by this exact spawn. It
  // does not resolve a fresh process from child.pid, so a recycled Windows PID
  // can never redirect this cleanup to an unrelated process. Browser.close is
  // responsible for the known Chromium descendant; the closed loopback CDP
  // endpoint remains the independent proof that it actually disappeared.
  if (!child.kill(signal)) {
    return { delivered: false, reason: 'launcher-handle-not-live' };
  }
  return { delivered: true, pid: child.pid, signal };
}

async function requestBrowserClose(instance) {
  if (!instance.browserWebSocketUrl) return false;
  const browser = new DevToolsClient(instance.browserWebSocketUrl, 5_000);
  await browser.connect();
  try {
    try {
      await browser.call('Browser.close');
    } catch (_error) {
      // A successful Browser.close normally drops the socket before the CDP
      // response arrives. Actual process and port termination are checked next.
    }
  } finally {
    browser.close();
  }
  return true;
}

async function stopPackagedApp(instance, overrides = {}) {
  if (!instance) return null;
  const runtime = {
    platform: process.platform,
    observeShutdown,
    requestBrowserClose,
    terminateSpawnedLauncher,
    ...overrides
  };
  const stopErrors = [];
  try {
    await runtime.requestBrowserClose(instance);
  } catch (error) {
    stopErrors.push(error);
  }
  try {
    instance.client?.close();
  } catch (error) {
    stopErrors.push(error);
  }
  let state = await runtime.observeShutdown(instance, 6_000);
  if (shutdownComplete(state)) return state;

  if (runtime.platform === 'win32') {
    if (!state.processExited) {
      try {
        await runtime.terminateSpawnedLauncher(instance, 'SIGKILL');
      } catch (error) {
        stopErrors.push(error);
      }
      state = await runtime.observeShutdown(instance, 6_000);
    }
  } else {
    if (!state.processExited) {
      try {
        const termination = await runtime.terminateSpawnedLauncher(instance, 'SIGTERM');
        if (!termination.delivered && termination.reason !== 'launcher-already-exited') {
          stopErrors.push(new Error(`SIGTERM was not delivered to the spawned launcher (${termination.reason})`));
        }
      } catch (error) {
        stopErrors.push(error);
      }
      state = await runtime.observeShutdown(instance, 4_000);
    }
    if (!shutdownComplete(state) && !state.processExited) {
      try {
        const termination = await runtime.terminateSpawnedLauncher(instance, 'SIGKILL');
        if (!termination.delivered && termination.reason !== 'launcher-already-exited') {
          stopErrors.push(new Error(`SIGKILL was not delivered to the spawned launcher (${termination.reason})`));
        }
      } catch (error) {
        stopErrors.push(error);
      }
      state = await runtime.observeShutdown(instance, 4_000);
    }
  }

  if (shutdownComplete(state)) return state;
  const failure = new Error(`Packaged application shutdown was not confirmed: ${shutdownFailureReasons(instance, state).join('; ')}`);
  if (stopErrors.length === 1) [failure.cause] = stopErrors;
  if (stopErrors.length > 1) failure.cause = new AggregateError(stopErrors, 'Packaged application shutdown attempts failed');
  throw failure;
}

async function assertPackagedMainWindow(instance, expectedVersion) {
  await instance.client.call('Runtime.enable');
  await instance.client.call('Page.enable');
  await instance.client.call('Log.enable');
  await waitFor(
    instance.client,
    `document.readyState === 'complete'
      && typeof state !== 'undefined'
      && typeof window.manager?.initializeFirstAgent === 'function'`,
    'packaged AgentDesk main window',
    instance.client.timeoutMs
  );
  const snapshot = await instance.client.evaluate(`({
    url: location.href,
    title: document.title,
    userAgent: navigator.userAgent,
    outerWidth,
    outerHeight,
    innerWidth,
    innerHeight,
    windowX: screenX,
    windowY: screenY,
    screenWidth: screen.width,
    screenHeight: screen.height,
    screenLeft: Number.isFinite(screen.left) ? screen.left : null,
    screenTop: Number.isFinite(screen.top) ? screen.top : null,
    screenAvailWidth: screen.availWidth,
    screenAvailHeight: screen.availHeight,
    screenAvailLeft: Number.isFinite(screen.availLeft) ? screen.availLeft : null,
    screenAvailTop: Number.isFinite(screen.availTop) ? screen.availTop : null,
    headerCount: document.querySelectorAll('.app-shell > .app-topbar').length,
    boardPanelCount: document.querySelectorAll('#mainGrid > .workspace-panel').length,
    footerCount: document.querySelectorAll('.app-shell > #statusBar').length,
    processType: typeof process,
    requireType: typeof require,
    managerType: typeof window.manager,
    initializeType: typeof window.manager?.initializeFirstAgent
  })`);
  assertPackagedRendererUrl(snapshot.url);
  assert.equal(snapshot.title, PRODUCT_NAME);
  assert.equal(runtimeVersionFromUserAgent(snapshot.userAgent), expectedVersion, 'packaged runtime version must match the release candidate');
  snapshot.geometry = assertPackagedWindowGeometry(snapshot);
  assert.equal(snapshot.headerCount, 1, 'packaged window must have one Header');
  assert.equal(snapshot.boardPanelCount, 3, 'packaged window must have exactly three workspace panels');
  assert.equal(snapshot.footerCount, 1, 'packaged window must have one Footer');
  assert.equal(snapshot.processType, 'undefined', 'packaged Renderer must not expose Node process');
  assert.equal(snapshot.requireType, 'undefined', 'packaged Renderer must not expose require');
  assert.equal(snapshot.managerType, 'object');
  assert.equal(snapshot.initializeType, 'function');
  return snapshot;
}

async function initializeFirstAgent(instance, userData, options) {
  const { client } = instance;
  await waitFor(
    client,
    `document.querySelector('#welcomeDialog')?.open
      && state.firstUse.model?.phase === 'agent'
      && state.firstUse.model?.version === ${JSON.stringify(options.expectedOnboardingVersion)}
      && state.profiles.length === 0
      && state.mesh.overview?.initialized !== true`,
    'fresh versioned first-use Agent step',
    options.timeoutMs
  );
  await waitForFile(path.join(userData, 'profiles.json'), options.timeoutMs);
  await waitForFile(path.join(userData, 'settings.json'), options.timeoutMs);
  assert.deepEqual(readProfiles(userData), [], 'fresh packaged userData must start with zero Profiles');
  assert.deepEqual(onboardingProgress(userData), { completedVersion: 0, completedAt: null });

  const form = await client.evaluate(`(() => {
    const name = document.querySelector('#onboardingAgentName');
    name.value = 'Packaged Smoke Agent';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const select = document.querySelector('#onboardingAgentClient');
    const option = [...select.options].find((item) => item.value.startsWith('codex\\u001f'))
      || [...select.options].find((item) => !item.disabled && item.value);
    if (!option) throw new Error('packaged-first-use-client-missing');
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const [requestedAppId, requestedClientForm = 'desktop'] = option.value.split('\\u001f');
    return {
      displayName: name.value,
      requestedAppId,
      requestedClientForm,
      primaryDisabled: document.querySelector('#onboardingPrimaryBtn').disabled,
      safetyText: document.querySelector('#onboardingAgent .onboarding-safety-note')?.textContent.trim() || ''
    };
  })()`);
  await waitFor(client, `!document.querySelector('#onboardingPrimaryBtn').disabled`, 'valid packaged first-Agent form', options.timeoutMs);
  assert.equal(form.displayName, 'Packaged Smoke Agent');
  assert.ok(form.requestedAppId);
  assert.equal(form.requestedClientForm, 'desktop');
  assert.ok(form.safetyText.length > 0, 'packaged onboarding must explain the local-only boundary');

  // Deliberately invoke only the production local initialization contract.
  // Clicking the UI button would immediately continue into official-client
  // installation/login, which is outside a no-business-network release smoke.
  const result = await client.evaluate(`(async () => {
    const value = ${JSON.stringify({
      displayName: 'Packaged Smoke Agent',
      requestedAppId: form.requestedAppId,
      requestedClientForm: form.requestedClientForm,
      migrationProfileIds: []
    })};
    const response = await window.manager.initializeFirstAgent(value);
    return {
      ok: response?.ok === true,
      reasonCode: response?.reasonCode || null,
      agentId: response?.agent?.agentId || null,
      agentName: response?.agent?.displayName || null,
      deviceId: response?.deviceId || null,
      overview: response?.overview || null
    };
  })()`);
  assert.equal(result.ok, true, result.reasonCode || 'packaged first-Agent initialization failed');
  assert.ok(result.agentId);
  assert.ok(result.deviceId);
  assert.equal(result.agentName, 'Packaged Smoke Agent');
  assert.deepEqual((result.overview?.agents || []).map((agent) => agent.displayName), ['Packaged Smoke Agent']);
  assert.equal((result.overview?.devices || []).length, 1, 'first Agent must create exactly one local device identity');
  assertLocalOnlyOverview(result.overview, 'first initialization');
  assert.deepEqual(onboardingProgress(userData), { completedVersion: 0, completedAt: null }, 'initialization alone must not complete onboarding');
  assertLocalOnlySettings(userData);
  assert.deepEqual(readProfiles(userData), [], 'local initialization must not synthesize Claude/Codex/Kimi Profiles');
  assert.ok(fs.statSync(path.join(userData, 'mesh.db')).size > 0, 'first Agent must create a non-empty Mesh store');
  return {
    agentId: result.agentId,
    deviceId: result.deviceId,
    requestedAppId: form.requestedAppId
  };
}

async function recoverAndComplete(instance, userData, first, options) {
  const { client } = instance;
  await waitFor(
    client,
    `document.querySelector('#welcomeDialog')?.open
      && state.firstUse.model?.phase === 'existing'
      && state.firstUse.model?.version === ${JSON.stringify(options.expectedOnboardingVersion)}
      && state.mesh.overview?.initialized === true`,
    'packaged first-use restart recovery',
    options.timeoutMs
  );
  const recovered = await client.evaluate(`({
    agentIds: state.firstUse.model.agents.map((agent) => agent.agentId),
    agentNames: state.firstUse.model.agents.map((agent) => agent.displayName),
    deviceId: state.mesh.overview.localDeviceId,
    profiles: state.profiles.length,
    overview: state.mesh.overview,
    primaryAction: document.querySelector('#onboardingPrimaryBtn').dataset.action
  })`);
  assert.deepEqual(recovered.agentIds, [first.agentId]);
  assert.deepEqual(recovered.agentNames, ['Packaged Smoke Agent']);
  assert.equal(recovered.deviceId, first.deviceId);
  assert.equal(recovered.profiles, 0);
  assert.equal(recovered.primaryAction, 'review');
  assertLocalOnlyOverview(recovered.overview, 'recovered first use');
  assertLocalOnlySettings(userData);

  await client.evaluate(`document.querySelector('#onboardingPrimaryBtn').click()`);
  await waitFor(
    client,
    `state.firstUse.model?.phase === 'complete'
      && state.firstUse.model?.completeShown === true
      && !document.querySelector('#onboardingPrimaryBtn').disabled`,
    'rendered packaged onboarding completion',
    options.timeoutMs
  );
  assert.deepEqual(onboardingProgress(userData), { completedVersion: 0, completedAt: null }, 'completion must not persist before the finish action');
  await client.evaluate(`document.querySelector('#onboardingPrimaryBtn').click()`);
  await waitFor(
    client,
    `!document.querySelector('#welcomeDialog').open
      && state.onboardingProgress.completedVersion === ${JSON.stringify(options.expectedOnboardingVersion)}`,
    'packaged onboarding finish action',
    options.timeoutMs
  );
  const progress = await waitForProgress(userData, options.expectedOnboardingVersion, options.timeoutMs);
  assert.ok(progress.completedAt, 'versioned onboarding completion must persist a timestamp');
  assertLocalOnlySettings(userData);
  assert.deepEqual(readProfiles(userData), []);
  return progress;
}

async function verifyCompletedRestart(instance, userData, first, options) {
  const { client } = instance;
  await waitFor(
    client,
    `document.readyState === 'complete'
      && typeof state !== 'undefined'
      && state.onboardingProgress.completedVersion === ${JSON.stringify(options.expectedOnboardingVersion)}
      && state.mesh.overview?.initialized === true
      && !document.querySelector('#welcomeDialog').open`,
    'completed packaged first-use restart',
    options.timeoutMs
  );
  const finalState = await client.evaluate(`({
    agentIds: (state.mesh.overview.agents || []).map((agent) => agent.agentId),
    agentNames: (state.mesh.overview.agents || []).map((agent) => agent.displayName),
    deviceId: state.mesh.overview.localDeviceId,
    profiles: state.profiles.length,
    overview: state.mesh.overview,
    completedVersion: state.onboardingProgress.completedVersion,
    dialogOpen: document.querySelector('#welcomeDialog').open
  })`);
  assert.deepEqual(finalState.agentIds, [first.agentId], 'restart must not duplicate the first Agent');
  assert.deepEqual(finalState.agentNames, ['Packaged Smoke Agent']);
  assert.equal(finalState.deviceId, first.deviceId, 'restart must preserve the local device identity');
  assert.equal(finalState.profiles, 0);
  assert.equal(finalState.completedVersion, options.expectedOnboardingVersion);
  assert.equal(finalState.dialogOpen, false);
  assertLocalOnlyOverview(finalState.overview, 'completed restart');
  assertLocalOnlySettings(userData);
  assert.deepEqual(readProfiles(userData), []);
  return finalState;
}

function seriousOutput(output) {
  return output.join('').split(/\r?\n/).filter((line) => (
    /\[renderer-gone\]|Uncaught (TypeError|ReferenceError|Error)|FATAL:/i.test(line)
  ));
}

function assertNoRuntimeExceptions(instance, label) {
  const exceptions = instance.client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
  assert.deepEqual(exceptions, [], `${label} must not emit uncaught Renderer exceptions`);
}

async function runSmoke(options) {
  const artifact = resolvePackagedArtifact(options.artifact);
  const keychainMode = resolveSmokeKeychainMode(options, artifact);
  // Unpacked artifacts expose their actual packaged source, so prove the
  // requested fixed size before allowing an OS display clamp at runtime. A
  // standalone Windows portable has no directly addressable app.asar here;
  // release verification separately checks its signed inner win-unpacked app.
  if (artifact.asarPath) assertPackagedFixedWindowContract(artifact);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-packaged-smoke-'));
  const userData = path.join(tempRoot, 'user-data');
  const output = [];
  const report = {
    schemaVersion: 1,
    artifact: {
      kind: artifact.kind,
      path: artifact.artifactPath,
      executable: artifact.executablePath
    },
    expectedVersion: options.expectedVersion,
    expectedOnboardingVersion: options.expectedOnboardingVersion,
    keychainMode,
    userData,
    phases: []
  };
  let instance = null;
  let primaryFailure = null;
  try {
    process.stdout.write(`Packaged artifact: ${artifact.kind} · ${artifact.artifactPath} · keychain=${keychainMode}\n`);
    instance = await launchPackagedApp(artifact, userData, output, options.timeoutMs, keychainMode);
    const firstWindow = await assertPackagedMainWindow(instance, options.expectedVersion);
    const first = await initializeFirstAgent(instance, userData, options);
    assertNoRuntimeExceptions(instance, 'packaged local initialization');
    report.phases.push({
      name: 'local-initialization',
      url: firstWindow.url,
      windowGeometry: {
        outerWidth: firstWindow.outerWidth,
        outerHeight: firstWindow.outerHeight,
        innerWidth: firstWindow.innerWidth,
        innerHeight: firstWindow.innerHeight,
        windowX: firstWindow.windowX,
        windowY: firstWindow.windowY,
        screenWidth: firstWindow.screenWidth,
        screenHeight: firstWindow.screenHeight,
        screenLeft: firstWindow.screenLeft,
        screenTop: firstWindow.screenTop,
        screenAvailWidth: firstWindow.screenAvailWidth,
        screenAvailHeight: firstWindow.screenAvailHeight,
        screenAvailLeft: firstWindow.screenAvailLeft,
        screenAvailTop: firstWindow.screenAvailTop,
        displayClamped: firstWindow.geometry.displayClamped
      },
      ...first
    });
    process.stdout.write('✓ packaged executable created one local Agent/device with Mesh networking disabled\n');
    await stopPackagedApp(instance);
    instance = null;

    instance = await launchPackagedApp(artifact, userData, output, options.timeoutMs, keychainMode);
    await assertPackagedMainWindow(instance, options.expectedVersion);
    const progress = await recoverAndComplete(instance, userData, first, options);
    assertNoRuntimeExceptions(instance, 'packaged restart recovery');
    await capture(instance.client, options.artifacts, '01-packaged-first-use-recovered');
    report.phases.push({ name: 'recovered-and-completed', progress });
    process.stdout.write('✓ packaged restart recovered the same Agent and persisted completion only after review\n');
    await stopPackagedApp(instance);
    instance = null;

    instance = await launchPackagedApp(artifact, userData, output, options.timeoutMs, keychainMode);
    await assertPackagedMainWindow(instance, options.expectedVersion);
    const finalState = await verifyCompletedRestart(instance, userData, first, options);
    await capture(instance.client, options.artifacts, '02-packaged-completed-restart');
    report.phases.push({
      name: 'completed-restart',
      agentId: first.agentId,
      deviceId: first.deviceId,
      completedVersion: finalState.completedVersion
    });
    assertNoRuntimeExceptions(instance, 'completed packaged restart');
    assert.deepEqual(seriousOutput(output), [], `packaged executable emitted serious errors:\n${seriousOutput(output).join('\n')}`);
    process.stdout.write('✓ completed packaged restart kept one Agent, zero Profiles, and zero Mesh connections\n');
  } catch (error) {
    const tail = output.join('').trim().split(/\r?\n/).slice(-40).join('\n');
    if (tail) process.stderr.write(`\nPackaged executable output (tail):\n${tail}\n`);
    report.ok = false;
    report.failedAt = new Date().toISOString();
    report.error = {
      name: error?.name || 'Error',
      message: error?.message || String(error)
    };
    if (tail) report.outputTail = tail;
    if (options.artifacts) {
      fs.mkdirSync(options.artifacts, { recursive: true });
      try {
        if (instance?.client) {
          await capture(instance.client, options.artifacts, '00-packaged-smoke-failure');
        }
      } catch (captureError) {
        report.captureError = captureError?.message || String(captureError);
      }
      fs.writeFileSync(
        path.join(options.artifacts, 'failure-report.json'),
        `${JSON.stringify(report, null, 2)}\n`
      );
    }
    primaryFailure = error;
  }

  let cleanupFailure = null;
  try {
    await stopPackagedApp(instance);
  } catch (error) {
    cleanupFailure = error;
  }
  try {
    if (options.keepTemp) {
      process.stdout.write(`Disposable userData kept at: ${userData}\n`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  } catch (error) {
    cleanupFailure = cleanupFailure
      ? new AggregateError([cleanupFailure, error], 'Packaged smoke cleanup failed')
      : error;
  }
  if (primaryFailure && cleanupFailure) {
    throw new AggregateError([primaryFailure, cleanupFailure], 'Packaged smoke and cleanup both failed');
  }
  if (primaryFailure) throw primaryFailure;
  if (cleanupFailure) throw cleanupFailure;

  // A release candidate passes only after its exact launcher/process and CDP
  // listener have both been proven closed and disposable state was cleaned.
  report.ok = true;
  report.completedAt = new Date().toISOString();
  if (options.artifacts) {
    fs.mkdirSync(options.artifacts, { recursive: true });
    fs.writeFileSync(path.join(options.artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`\nPackaged first-use smoke passed for AgentDesk ${options.expectedVersion}.\n`);
  return report;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  await runSmoke(options);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`\nPackaged first-use smoke failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  NETWORK_ENV_KEYS,
  assertAdHocMacSignatureDetails,
  assertBrowserLaunchIdentity,
  assertLocalOnlyOverview,
  assertPackagedFixedWindowContract,
  assertPackagedRendererUrl,
  assertPackagedWindowGeometry,
  browserWebSocketFromOutput,
  parseArguments,
  packagedRendererPath,
  readMacSignatureDetails,
  readPackagedMainSource,
  resolvePackagedArtifact,
  resolveSmokeKeychainMode,
  runtimeVersionFromUserAgent,
  shutdownComplete,
  shutdownFailureReasons,
  stopPackagedApp,
  scrubMeshNetworkEnvironment,
  terminateSpawnedLauncher,
  usage,
};
