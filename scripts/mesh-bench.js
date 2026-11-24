#!/usr/bin/env node
'use strict';

// Times the Mesh-mode session list (MeshService.getUnifiedSessions) on
// synthetic data in a temp folder: two Mesh services paired in-process (no
// network, no keychain: a stand-in key protector), one Codex profile each.
//
//   node scripts/mesh-bench.js [remoteSessions] [localSessions]   (default 5000 500)
//
// Reports, in milliseconds on the calling thread:
//   cold       the first list of a fresh service (nothing remembered yet)
//   changed    the list after one local session row changed
//   unchanged  the list again with nothing changed
//   landing    applyRemoteInventory for a changed remote inventory (it
//              canonicalizes, stores, and returns the new list)
// docs/ARCHITECTURE_PLAN.md section 8 and 9.1 record the numbers.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EncryptedKeyVault } = require('../src/mesh/storage/secure-keys');
const { MeshService } = require('../src/mesh/main/mesh-service');

const NOW = '2026-08-13T09:00:00.000Z';
const protector = () => ({
  isAvailable: () => true,
  encryptString: (value) => Buffer.from(`p:${Buffer.from(value).toString('base64')}`),
  decryptString: (buffer) => Buffer.from(buffer.toString().slice(2), 'base64').toString()
});
const sessions = (prefix, count) => Array.from({ length: count }, (_, i) => ({
  id: `${prefix}-${i}`,
  address: `${prefix}-${i}`,
  adapterConversationKey: `${prefix}-${i}`,
  appId: 'codex',
  title: `Session ${i} of ${prefix}`,
  createdAt: NOW,
  updatedAt: NOW,
  projectPath: `/project/${i % 20}`,
  filePath: `/${prefix}/s${i}.jsonl`,
  source: 'Codex',
  status: '可用'
}));
const profile = (id) => ({ id, appId: 'codex', name: 'Work', identityFingerprint: `acct-${id}`, profilePathMode: 'managed', sessionRootMode: 'managed' });
const timed = (fn) => { const start = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - start) / 1e6; };
const median = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summary = (values) => ({ medianMs: +median(values).toFixed(1), maxMs: +Math.max(...values).toFixed(1) });

async function main() {
  const [remoteCount = 5000, localCount = 500] = process.argv.slice(2).map(Number);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-mesh-bench-'));
  try {
    fs.mkdirSync(path.join(dir, 'h'));
    fs.mkdirSync(path.join(dir, 'j'));
    const hostSessions = sessions('host', localCount);
    const joinSessions = sessions('join', remoteCount);
    const common = { appVersion: '1', platform: 'darwin', arch: 'arm64', osVersion: 't', now: () => NOW };
    const hostOptions = {
      ...common,
      databasePath: path.join(dir, 'h', 'mesh.db'),
      keyVault: new EncryptedKeyVault(path.join(dir, 'h', 'k.json'), protector()),
      profilesProvider: () => [profile('h1')],
      sessionsProvider: () => hostSessions,
      hostname: 'H'
    };
    const host = new MeshService(hostOptions);
    const joiner = new MeshService({
      ...common,
      databasePath: path.join(dir, 'j', 'mesh.db'),
      keyVault: new EncryptedKeyVault(path.join(dir, 'j', 'k.json'), protector()),
      profilesProvider: () => [profile('j1')],
      sessionsProvider: () => joinSessions,
      hostname: 'J',
      pairingTransport: async (_invite, request) => host.claimInvite({ request })
    });
    host.initialize();
    await joiner.join({ code: host.createInvite().code });
    const joinerId = joiner.getOverview().localDeviceId;
    const land = () => host.applyRemoteInventory({
      deviceId: joinerId,
      inventory: joiner.createInventorySnapshot(),
      allowLegacyCatalogProjection: true
    });
    land();

    const cold = [];
    for (let i = 0; i < 5; i++) {
      const fresh = new MeshService(hostOptions);
      cold.push(timed(() => fresh.getUnifiedSessions()));
    }
    const changed = [];
    for (let i = 0; i < 7; i++) {
      hostSessions[i] = { ...hostSessions[i], title: `changed ${i}` };
      changed.push(timed(() => host.getUnifiedSessions()));
    }
    const unchanged = [];
    for (let i = 0; i < 7; i++) unchanged.push(timed(() => host.getUnifiedSessions()));
    const landing = [];
    for (let i = 0; i < 5; i++) {
      joinSessions[i] = { ...joinSessions[i], title: `remote ${i}` };
      landing.push(timed(land));
    }
    process.stdout.write(`${JSON.stringify({
      remoteSessions: remoteCount,
      localSessions: localCount,
      rows: host.getUnifiedSessions().length,
      cold: summary(cold),
      changed: summary(changed),
      unchanged: summary(unchanged),
      landing: summary(landing)
    })}\n`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
