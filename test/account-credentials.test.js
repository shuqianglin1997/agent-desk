const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');
const credentials = require('../src/account-credentials');
const credentialImport = require('../src/credential-import');
const { createCliBroker, runPackagedCli, readSecretFromStdin } = require('../src/automation/packaged-cli');
const { makeTempDir } = require('./helpers/temp');

// A sentinel that must never show up in AgentDesk files, logs or output.
const SENTINEL = 'sk-ant-oat01-SENTINELvalue0123456789abcdef';
const API_SENTINEL = 'sk-SENTINELapikey0123456789abcdef';
const posixOnly = { skip: process.platform === 'win32' ? 'shell stubs stand in for the official clients on POSIX' : false };

function tmp(t) {
  const root = fs.realpathSync.native(makeTempDir('agentdesk-credentials-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function profile(root, appId, name = appId) {
  const profilePath = path.join(root, 'AgentDesk', 'Profiles', name);
  const sessionRoot = path.join(profilePath, 'home');
  fs.mkdirSync(sessionRoot, { recursive: true, mode: 0o700 });
  return { id: `${appId}-1`, appId, profilePath, sessionRoot, isProtected: false, sessionRootMode: 'managed' };
}

// A stand-in for an official client: logs argv and environment, consumes stdin.
function stub(root, name, body) {
  const file = path.join(root, 'bin', name);
  const log = path.join(root, 'stub-log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(log, { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\nprintf '%s\\n' "$@" > "${log}/${name}.argv"\nenv > "${log}/${name}.env"\n${body}\n`, { mode: 0o755 });
  return { launcher: { command: file, prefixArgs: [], extraEnv: {} }, log };
}

function filesContaining(root, needle, skip = () => false) {
  const hits = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (skip(full)) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && fs.readFileSync(full).includes(needle)) hits.push(path.relative(root, full));
    }
  };
  walk(root);
  return hits.sort();
}

const mode = (file) => fs.statSync(file).mode & 0o777;

test('secrets and provider fields are validated before anything is written', () => {
  for (const bad of ['short', `${SENTINEL}\nX=1`, `${SENTINEL}'`, `${SENTINEL}"`, `${SENTINEL}$HOME`, `${SENTINEL} x`, 'é'.repeat(20)]) {
    assert.throws(() => credentials.normalizeSecret(bad), { code: 'secret-invalid' });
  }
  assert.equal(credentials.normalizeSecret(`﻿ ${SENTINEL}\n`), SENTINEL);
  assert.throws(() => credentials.normalizeProvider('codex', { id: 'openai', baseUrl: 'https://x.example', model: 'm' }), { code: 'provider-id-invalid' });
  assert.throws(() => credentials.normalizeProvider('codex', { id: 'corp', baseUrl: 'http://x.example', model: 'm' }), { code: 'provider-url-invalid' });
  assert.throws(() => credentials.normalizeProvider('codex', { id: 'corp', baseUrl: 'https://user:pw@x.example', model: 'm' }), { code: 'provider-url-invalid' });
  assert.deepEqual(credentials.normalizeProvider('codex', { id: 'Corp', baseUrl: 'https://x.example/v1/', model: 'gpt-x' }), { id: 'corp', baseUrl: 'https://x.example/v1', model: 'gpt-x' });
  assert.deepEqual(credentials.normalizeProvider('claude-cli', { baseUrl: 'http://127.0.0.1:8080' }), { baseUrl: 'http://127.0.0.1:8080' });
});

test('TOML edits keep every setting they do not own', () => {
  const original = '# my settings\nmodel = "old"\napproval_policy = "never"\n\n[projects."/tmp/x"]\ntrust_level = "trusted"\n\n[model_providers.corp]\nname = "old"\nbase_url = "https://old"\n\n[mcp_servers.a]\ncommand = "x"\n';
  let lines = credentials.splitLines(original);
  lines = credentials.setTomlTopLevel(lines, 'model', '"new"');
  lines = credentials.setTomlTopLevel(lines, 'model_provider', '"corp"');
  lines = credentials.replaceTomlTable(lines, ['model_providers', 'corp'], ['name = "corp"', 'base_url = "https://new"']);
  const text = `${lines.join('\n')}\n`;
  assert.match(text, /^# my settings\nmodel = "new"\napproval_policy = "never"\nmodel_provider = "corp"\n/);
  assert.match(text, /\[projects\."\/tmp\/x"\]\ntrust_level = "trusted"/);
  assert.match(text, /\[model_providers\.corp\]\nname = "corp"\nbase_url = "https:\/\/new"\n\n\[mcp_servers\.a\]\ncommand = "x"/);
  assert.equal(text.includes('https://old'), false);
  const parsed = credentials.parseTomlSubset(text);
  assert.equal(parsed.model_providers.corp.base_url, 'https://new');
  assert.equal(parsed.projects['/tmp/x'].trust_level, 'trusted');
  assert.throws(() => credentials.setTomlTopLevel(['model = [', '"a",', ']'], 'model', '"x"'), { code: 'config-format-unsupported' });
});

test('Codex: the key goes to `codex login --with-api-key` on stdin, never argv', posixOnly, async (t) => {
  const root = tmp(t);
  const account = profile(root, 'codex');
  fs.writeFileSync(path.join(account.sessionRoot, 'config.toml'), 'model = "gpt-x"\n');
  const { launcher, log } = stub(root, 'codex', `key=$(cat)\nprintf '{"auth_mode":"apikey","OPENAI_API_KEY":"%s"}' "$key" > "$CODEX_HOME/auth.json"`);
  const result = await credentials.applySecret(account, { method: 'key', secret: API_SENTINEL }, {
    env: { PATH: process.env.PATH, CODEX_API_KEY: 'inherited', HOME: root }, findLauncher: (id) => (id === 'codex' ? launcher : null)
  });
  assert.deepEqual(result, { method: 'api-key', via: 'official-stdin', storedInPlaintext: false, plaintextWarning: false });
  assert.equal(fs.readFileSync(path.join(log, 'codex.argv'), 'utf8'), 'login\n--with-api-key\n');
  const env = fs.readFileSync(path.join(log, 'codex.env'), 'utf8');
  assert.match(env, new RegExp(`^CODEX_HOME=${account.sessionRoot}$`, 'm'));
  assert.doesNotMatch(env, /CODEX_API_KEY/);
  assert.equal(env.includes(API_SENTINEL), false);
  const config = fs.readFileSync(path.join(account.sessionRoot, 'config.toml'), 'utf8');
  assert.equal(config, 'model = "gpt-x"\ncli_auth_credentials_store = "file"\n');
  assert.deepEqual(await credentials.credentialStatus(account, {}), { supported: true, signedIn: true, method: 'api-key', verifiedBy: 'files' });
  const missing = credentials.applySecret(account, { method: 'key', secret: API_SENTINEL }, { findLauncher: () => null });
  await assert.rejects(missing, { code: 'official-client-missing' });
  const failing = stub(root, 'codex-fail', 'cat >/dev/null; exit 1');
  await assert.rejects(credentials.applySecret(account, { secret: API_SENTINEL }, { env: {}, findLauncher: () => failing.launcher }),
    (error) => error.code === 'official-command-failed' && !error.message.includes(API_SENTINEL));
});

test('Codex: an API provider account writes config.toml and the key into this home\'s .env', async (t) => {
  const root = tmp(t);
  const account = profile(root, 'codex');
  fs.writeFileSync(path.join(account.sessionRoot, '.env'), 'OTHER=1\n');
  const result = await credentials.applySecret(account, {
    method: 'provider', secret: API_SENTINEL, provider: { id: 'corp', baseUrl: 'https://llm.example/v1', model: 'corp-large' }
  });
  assert.equal(result.plaintextWarning, true);
  const config = credentials.parseTomlSubset(fs.readFileSync(path.join(account.sessionRoot, 'config.toml'), 'utf8'));
  assert.equal(config.model_provider, 'corp');
  assert.equal(config.model, 'corp-large');
  assert.deepEqual(config.model_providers.corp, { name: 'corp', base_url: 'https://llm.example/v1', env_key: 'CORP_API_KEY', wire_api: 'responses' });
  const dotenv = fs.readFileSync(path.join(account.sessionRoot, '.env'), 'utf8');
  assert.equal(dotenv, `OTHER=1\nCORP_API_KEY='${API_SENTINEL}'\n`);
  if (process.platform !== 'win32') assert.equal(mode(path.join(account.sessionRoot, '.env')), 0o600);
  assert.equal((await credentials.credentialStatus(account, {})).method, 'provider');
});

test('Claude CLI: tokens go into this home\'s settings.json env, merged and private', async (t) => {
  const root = tmp(t);
  const account = profile(root, 'claude-cli');
  const settingsFile = path.join(account.sessionRoot, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark', env: { KEEP: '1', ANTHROPIC_API_KEY: 'old-key-value' }, permissions: { allow: ['Bash'] } }));
  const result = await credentials.applySecret(account, { secret: SENTINEL });
  assert.deepEqual(result, { method: 'oauth-token', via: 'settings-file', storedInPlaintext: true, plaintextWarning: true });
  const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.deepEqual(settings, { theme: 'dark', env: { KEEP: '1', CLAUDE_CODE_OAUTH_TOKEN: SENTINEL }, permissions: { allow: ['Bash'] } });
  if (process.platform !== 'win32') assert.equal(mode(settingsFile), 0o600);
  assert.equal((await credentials.credentialStatus(account, {})).method, 'oauth-token');
  await credentials.applySecret(account, { method: 'provider', secret: API_SENTINEL, provider: { baseUrl: 'https://gateway.example', model: 'claude-x' } });
  assert.deepEqual(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).env, {
    KEEP: '1', ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: API_SENTINEL, ANTHROPIC_MODEL: 'claude-x'
  });
  fs.writeFileSync(settingsFile, '{broken');
  await assert.rejects(credentials.applySecret(account, { secret: SENTINEL }), { code: 'config-format-unsupported' });
  assert.equal(fs.readFileSync(settingsFile, 'utf8'), '{broken');
});

test('Claude CLI: `claude auth status` is the official check and runs without inherited Claude variables', posixOnly, async (t) => {
  const root = tmp(t);
  const account = profile(root, 'claude-cli');
  const ok = stub(root, 'claude', 'printf \'{"authMethod":"claude.ai","configDirectory":"x"}\'');
  const status = await credentials.credentialStatus(account, {
    official: true, env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: 'shell-key', CLAUDE_CONFIG_DIR: '/elsewhere' },
    findLauncher: (id) => (id === 'claude' ? ok.launcher : null)
  });
  assert.deepEqual(status, { supported: true, signedIn: true, method: 'subscription', verifiedBy: 'official', officialCheck: 'ok' });
  assert.equal(fs.readFileSync(path.join(ok.log, 'claude.argv'), 'utf8'), 'auth\nstatus\n');
  const env = fs.readFileSync(path.join(ok.log, 'claude.env'), 'utf8');
  assert.match(env, new RegExp(`^CLAUDE_CONFIG_DIR=${account.sessionRoot}$`, 'm'));
  assert.doesNotMatch(env, /ANTHROPIC_API_KEY/);
  const signedOut = stub(root, 'claude-out', 'exit 1');
  const out = await credentials.credentialStatus(account, { official: true, env: {}, findLauncher: () => signedOut.launcher });
  assert.equal(out.signedIn, false);
});

test('Kimi Code: a catalog key reaches only the official command through its documented variable', posixOnly, async (t) => {
  const root = tmp(t);
  const account = profile(root, 'kimi');
  const { launcher, log } = stub(root, 'kimi', `printf '[providers.kimi-for-coding]\\ntype = "kimi"\\napi_key = "%s"\\n' "$KIMI_REGISTRY_API_KEY" > "$KIMI_CODE_HOME/config.toml"`);
  const result = await credentials.applySecret(account, { secret: API_SENTINEL, catalogProviderId: 'kimi-for-coding', model: 'kimi-k2' }, {
    env: { PATH: process.env.PATH, KIMI_REGISTRY_API_KEY: 'inherited' }, findLauncher: (id) => (id === 'kimi' ? launcher : null)
  });
  assert.equal(result.via, 'official-env');
  const argv = fs.readFileSync(path.join(log, 'kimi.argv'), 'utf8');
  assert.equal(argv, 'provider\ncatalog\nadd\nkimi-for-coding\n--default-model\nkimi-k2\n');
  assert.equal(argv.includes(API_SENTINEL), false);
  assert.match(fs.readFileSync(path.join(log, 'kimi.env'), 'utf8'), new RegExp(`^KIMI_REGISTRY_API_KEY=${API_SENTINEL}$`, 'm'));
  assert.equal(mode(path.join(account.sessionRoot, 'config.toml')), 0o600);
  await assert.rejects(credentials.applySecret(account, { secret: API_SENTINEL, catalogProviderId: '../x' }, { findLauncher: () => launcher }), { code: 'provider-id-invalid' });
});

test('Kimi Code: provider accounts and the sign-in success check (revoked token, managed provider)', async (t) => {
  const root = tmp(t);
  const account = profile(root, 'kimi');
  const config = path.join(account.sessionRoot, 'config.toml');
  fs.writeFileSync(config, '[providers."managed:kimi-code"]\ntype = "kimi"\napi_key = ""\noauth = { storage = "file", key = "oauth/kimi-code" }\n');
  fs.mkdirSync(path.join(account.sessionRoot, 'credentials'));
  const token = path.join(account.sessionRoot, 'credentials', 'kimi-code.json');
  fs.writeFileSync(token, JSON.stringify({ access_token: '', refresh_token: '' }));
  assert.deepEqual(await credentials.credentialStatus(account, {}), { supported: true, signedIn: false, method: null, verifiedBy: 'files', note: 'token-revoked' });
  fs.writeFileSync(token, JSON.stringify({ access_token: 'a', refresh_token: 'r' }));
  assert.equal((await credentials.credentialStatus(account, {})).method, 'subscription');
  fs.rmSync(token);
  await credentials.applySecret(account, { method: 'provider', secret: API_SENTINEL, provider: { id: 'corp', baseUrl: 'https://llm.example/v1', model: 'm1' } });
  const parsed = credentials.parseTomlSubset(fs.readFileSync(config, 'utf8'));
  assert.equal(parsed.default_model, 'corp/m1');
  assert.deepEqual(parsed.models['corp/m1'], { provider: 'corp', model: 'm1' });
  assert.equal(parsed.providers.corp.base_url, 'https://llm.example/v1');
  assert.equal(parsed.providers['managed:kimi-code'].type, 'kimi');
  assert.equal((await credentials.credentialStatus(account, {})).method, 'provider');
});

test('DSH: keys go into version 1 refs of .credentials.yaml, 0600, keeping account records', async (t) => {
  const root = tmp(t);
  const account = profile(root, 'dsh-cli');
  const file = path.join(account.sessionRoot, '.credentials.yaml');
  await credentials.applySecret(account, { secret: API_SENTINEL });
  assert.equal(fs.readFileSync(file, 'utf8'), `version: 1\nrefs:\n  DEEPSEEK_API_KEY: '${API_SENTINEL}'\n`);
  if (process.platform !== 'win32') assert.equal(mode(file), 0o600);
  fs.writeFileSync(file, "version: 1\nrefs:\n    OTHER: 'x'\n    DEEPSEEK_API_KEY: 'old'\nrecords:\n  deepseek-account-platform/device:\n    kind: grant\n");
  await credentials.applySecret(account, { method: 'provider', secret: API_SENTINEL, provider: { baseUrl: 'https://deepseek.example' } });
  const text = fs.readFileSync(file, 'utf8');
  assert.equal(text, `version: 1\nrefs:\n    DEEPSEEK_BASE_URL: 'https://deepseek.example'\n    OTHER: 'x'\n    DEEPSEEK_API_KEY: '${API_SENTINEL}'\nrecords:\n  deepseek-account-platform/device:\n    kind: grant\n`);
  assert.deepEqual(await credentials.credentialStatus(account, {}), { supported: true, signedIn: true, method: 'provider', verifiedBy: 'files' });
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o644);
    assert.equal((await credentials.credentialStatus(account, {})).note, 'credentials-permissions-open');
  }
  fs.writeFileSync(file, 'DEEPSEEK_API_KEY: flat\n');
  await assert.rejects(credentials.applySecret(account, { secret: API_SENTINEL }), { code: 'credentials-format-unsupported' });
});

test('desktop-only clients refuse pasted keys', async (t) => {
  const root = tmp(t);
  for (const appId of ['claude', 'cursor', 'kimi-work']) {
    await assert.rejects(credentials.applySecret(profile(root, appId), { secret: API_SENTINEL }), { code: 'credential-method-unsupported' });
    assert.equal((await credentials.credentialStatus(profile(root, appId), {})).supported, false);
  }
});

test('sign-in files for DSH, Kimi Code and Claude CLI are recognised, checked and staged privately', (t) => {
  const root = tmp(t);
  const source = path.join(root, 'source');
  fs.mkdirSync(path.join(source, 'kimi', 'credentials'), { recursive: true });
  const kimiFile = path.join(source, 'kimi', 'credentials', 'kimi-code.json');
  fs.writeFileSync(kimiFile, JSON.stringify({ access_token: SENTINEL, refresh_token: SENTINEL }));
  fs.writeFileSync(path.join(source, 'kimi', 'config.toml'), [
    'default_model = "kimi-code/k2"', '', '[providers."managed:kimi-code"]', 'type = "kimi"', 'api_key = ""',
    'oauth = { storage = "file", key = "oauth/kimi-code" }', '', '[providers.other]', 'type = "openai"', `api_key = "${API_SENTINEL}"`,
    '', '[models."kimi-code/k2"]', 'provider = "managed:kimi-code"', 'model = "k2"', '', '[models.mine]', 'provider = "other"', 'model = "x"'
  ].join('\n'));
  assert.equal(credentialImport.clientForCredentialFile(kimiFile), 'kimi');
  assert.equal(credentialImport.clientForCredentialFile('/x/.credentials.yaml'), 'dsh-cli');
  assert.equal(credentialImport.clientForCredentialFile('/x/auth.json'), 'codex');
  assert.deepEqual(credentialImport.clientForCredentialFile('/x/.credentials.json', 'darwin'), { unsupported: 'claude-cli' });
  assert.equal(credentialImport.clientForCredentialFile('/x/.credentials.json', 'linux'), 'claude-cli');
  assert.equal(credentialImport.clientForCredentialFile('/x/notes.txt'), null);

  const payload = credentialImport.IMPORTERS.kimi.read(kimiFile);
  assert.equal(payload.config.complete, true);
  const config = payload.config.lines.join('\n');
  assert.match(config, /^default_model = "kimi-code\/k2"/);
  assert.match(config, /\[models\."kimi-code\/k2"\]/);
  assert.equal(config.includes('[providers.other]'), false);
  assert.equal(config.includes(API_SENTINEL), false);
  const target = profile(root, 'kimi', 'kimi-import');
  fs.rmSync(target.profilePath, { recursive: true });
  const cleanup = credentialImport.stageNewHome('kimi', target, payload);
  const staged = path.join(target.sessionRoot, 'credentials', 'kimi-code.json');
  assert.deepEqual(fs.readFileSync(staged), fs.readFileSync(kimiFile));
  if (process.platform !== 'win32') {
    assert.equal(mode(staged), 0o600);
    assert.equal(mode(path.join(target.sessionRoot, 'credentials')), 0o700);
  }
  const imported = { ...target, credentialImported: 'kimi' };
  assert.equal(credentialImport.sameImportedFile([imported], 'kimi', payload.bytes), imported);
  assert.throws(() => credentialImport.stageNewHome('kimi', target, payload), /EEXIST/);
  cleanup();
  assert.equal(fs.existsSync(target.profilePath), false);
  assert.ok(fs.existsSync(kimiFile), 'the source is never moved or deleted');

  const dshFile = path.join(source, '.credentials.yaml');
  fs.writeFileSync(dshFile, `version: 1\nrefs:\n  DEEPSEEK_API_KEY: '${API_SENTINEL}'\n`, { mode: 0o644 });
  const dsh = profile(root, 'dsh-cli', 'dsh-import');
  fs.rmSync(dsh.profilePath, { recursive: true });
  credentialImport.stageNewHome('dsh-cli', dsh, credentialImport.IMPORTERS['dsh-cli'].read(dshFile));
  if (process.platform !== 'win32') assert.equal(mode(path.join(dsh.sessionRoot, '.credentials.yaml')), 0o600);
  fs.writeFileSync(dshFile, 'DEEPSEEK_API_KEY: x\n');
  assert.throws(() => credentialImport.IMPORTERS['dsh-cli'].read(dshFile), { code: 'credential-file-format' });
  fs.writeFileSync(path.join(source, 'kimi-code.json'), JSON.stringify({ access_token: '' }));
  assert.throws(() => credentialImport.IMPORTERS.kimi.read(path.join(source, 'kimi-code.json')), { code: 'credential-file-format' });
});

test('stdin is the only way in for a CLI key; terminals and oversized input are refused', async () => {
  await assert.rejects(readSecretFromStdin({ isTTY: true }), { code: 'secret-stdin-required' });
  assert.equal(await readSecretFromStdin(Readable.from([Buffer.from(`${SENTINEL}\n`)])), SENTINEL);
  await assert.rejects(readSecretFromStdin(Readable.from([Buffer.alloc(9000, 0x61)])), { code: 'secret-invalid' });
});

test('sentinel: a key set through the packaged CLI is absent from AgentDesk files and all output', async (t) => {
  const root = tmp(t);
  const userData = path.join(root, 'AgentDesk');
  fs.mkdirSync(userData, { recursive: true });
  const accounts = {
    'claude-1': profile(root, 'claude-cli', 'claude'),
    'dsh-1': profile(root, 'dsh-cli', 'dsh')
  };
  fs.writeFileSync(path.join(userData, 'profiles.json'), JSON.stringify({ version: 2, profiles: Object.entries(accounts).map(([id, item]) => ({ ...item, id })) }));
  const outputs = [];
  const dispatch = async (command, input, extra) => {
    const account = accounts[input.profile];
    const applied = await credentials.applySecret(account, { method: input.method === 'provider' ? 'provider' : 'key', secret: extra.secret, provider: { baseUrl: input['base-url'] } });
    return { profileId: input.profile, ...applied, status: await credentials.credentialStatus(account, {}) };
  };
  const broker = createCliBroker({ userData, whenReady: async () => {}, dispatch });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  for (const [args, secret] of [
    [['profiles', 'set-key', '--profile', 'claude-1'], SENTINEL],
    [['profiles', 'set-key', '--profile', 'dsh-1', '--method', 'provider', '--base-url', 'https://deepseek.example'], API_SENTINEL],
    [['profiles', 'set-key', '--profile', 'dsh-1', '--secret', API_SENTINEL], API_SENTINEL]
  ]) {
    let text = '';
    const code = await runPackagedCli(args, {
      app, userData, broker, version: 'test', discover: () => [], timeoutMs: 2000,
      readSecret: async () => secret, stdout: { write: (value) => { text += value; } }
    });
    outputs.push({ code, text });
  }
  assert.deepEqual(outputs.map((item) => item.code), [0, 0, 2]);
  assert.equal(JSON.parse(outputs[0].text).data.status.method, 'oauth-token');
  assert.equal(JSON.parse(outputs[1].text).data.storedInPlaintext, true);
  for (const { text } of outputs) {
    assert.equal(text.includes(SENTINEL) || text.includes(API_SENTINEL), false);
  }
  // AgentDesk's own data: profile store, request folders, anything else.
  const owned = (file) => !file.startsWith(path.join(userData, 'Profiles'));
  assert.deepEqual(filesContaining(userData, SENTINEL, (file) => !owned(file)), []);
  assert.deepEqual(filesContaining(userData, API_SENTINEL, (file) => !owned(file)), []);
  assert.deepEqual(fs.readdirSync(path.join(userData, 'cli-requests')), []);
  // The secret exists only in each account's own documented file.
  assert.deepEqual(filesContaining(root, SENTINEL), ['AgentDesk/Profiles/claude/home/settings.json']);
  assert.deepEqual(filesContaining(root, API_SENTINEL), ['AgentDesk/Profiles/dsh/home/.credentials.yaml']);
});
