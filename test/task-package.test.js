const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  MAX_ENTRY_BYTES,
  MAX_PACKAGE_BYTES,
  writeEncryptedTaskPackage,
  decryptTaskPackage,
  extractTaskPackageEntry,
  normalizeTaskPackageManifest
} = require('../src/task-package/format');
const { TaskPackageService, captureGitProject } = require('../src/task-package/service');
const { scanCodex } = require('../src/sessions');

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJsonl(filePath, events) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, { mode: 0o600 });
}

function meta(payload, timestamp = '2026-08-14T01:00:00.000Z') {
  return { timestamp, type: 'session_meta', payload };
}

function transcriptManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    packageId: 'package-format',
    createdAt: '2026-08-14T01:00:00.000Z',
    source: { agentName: 'Build Agent', appId: 'codex' },
    checkpoint: { objective: 'continue the work' },
    session: {
      mode: 'transcript',
      adapterId: 'test-transcript',
      adapterVersion: 1,
      sessionId: 'session-a',
      originalTitle: 'Task A',
      suggestedTitle: 'Task A · from Build Agent',
      contentEntryId: 'content',
      childEntryIds: []
    },
    project: null,
    lineage: {},
    ...overrides
  };
}

test('任务包容器逐项校验、错误密钥拒绝且解密内容不出现在包文件中', async (t) => {
  const root = tempRoot('agentdesk-task-format-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagePath = path.join(root, 'handoff.agentdesk-task');
  const plainPath = path.join(root, 'plain.inner');
  const outputPath = path.join(root, 'output.txt');
  const secret = Buffer.from('native session secret content');
  const manifest = transcriptManifest();
  await writeEncryptedTaskPackage({
    destinationPath: packagePath,
    unlockCode: 'ABCDE-FGHIJ-KLMNO-PQRST',
    manifest,
    entries: [{
      entryId: 'content',
      kind: 'conversation-transcript',
      name: 'conversation/conversation.md',
      buffer: secret,
      metadata: {}
    }]
  });
  assert.equal(fs.readFileSync(packagePath).includes(secret), false);
  await assert.rejects(() => decryptTaskPackage({
    packagePath,
    unlockCode: 'ZZZZZ-YYYYY-XXXXX-WWWWW',
    plainPath
  }), /unlock/);
  const archive = await decryptTaskPackage({
    packagePath,
    unlockCode: 'ABCDE-FGHIJ-KLMNO-PQRST',
    plainPath
  });
  assert.equal(archive.manifest.packageId, 'package-format');
  await extractTaskPackageEntry({ plainPath, entry: archive.entries[0], destinationPath: outputPath });
  assert.equal(fs.readFileSync(outputPath, 'utf8'), secret.toString('utf8'));
});

test('导入草稿在解密进行中停止或过期后等待句柄关闭并清除明文', async (t) => {
  const root = tempRoot('agentdesk-task-draft-lifecycle-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagePath = path.join(root, 'incoming.agentdesk-task');
  fs.writeFileSync(packagePath, 'encrypted-placeholder', { mode: 0o600 });

  async function exerciseCancellation(kind) {
    const stagingRoot = path.join(root, kind);
    let releaseDecrypt;
    let reportPlainPath;
    let decryptActive = false;
    let removalAttempts = 0;
    const plainReady = new Promise((resolve) => { reportPlainPath = resolve; });
    const service = new TaskPackageService({
      profileProvider: () => [],
      historyFile: path.join(root, `${kind}-history.json`),
      stagingRoot,
      importDraftTtlMs: kind === 'ttl' ? 10 : 60_000,
      randomUUID: () => `${kind}-draft`,
      decryptTaskPackage: async ({ plainPath }) => {
        decryptActive = true;
        fs.writeFileSync(plainPath, 'temporary decrypted content', { mode: 0o600 });
        reportPlainPath(plainPath);
        await new Promise((resolve) => { releaseDecrypt = resolve; });
        decryptActive = false;
        return { manifest: transcriptManifest(), entries: [], plainPath };
      },
      removeDraftRoot: (draftRoot) => {
        removalAttempts += 1;
        if (decryptActive) {
          const error = new Error('simulated-windows-open-handle');
          error.code = 'EBUSY';
          throw error;
        }
        fs.rmSync(draftRoot, { recursive: true, force: true });
      }
    });
    const draft = service.createImportDraft(packagePath);
    const draftRoot = path.join(stagingRoot, `import-${draft.token}`);
    const inspection = service.inspectImport({ token: draft.token, unlockCode: 'ABCDE-FGHIJ-KLMNO-PQRST' });
    const plainPath = await plainReady;
    assert.equal(fs.existsSync(plainPath), true);

    if (kind === 'stop') service.stop();
    else await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(service.importDrafts.has(draft.token), false);
    assert.equal(removalAttempts, 1);

    releaseDecrypt();
    await assert.rejects(inspection, /task-package-import-cancelled/);
    assert.equal(removalAttempts >= 2, true);
    assert.equal(fs.existsSync(plainPath), false);
    assert.equal(fs.existsSync(draftRoot), false);
    assert.equal(service.importDraftTimers.has(draft.token), false);
    service.stop();
  }

  await exerciseCancellation('stop');
  await exerciseCancellation('ttl');
});

test('私有 staging 拒绝符号链接与根替换，并把根和草稿权限收紧为 0700', {
  skip: process.platform === 'win32'
}, (t) => {
  const root = tempRoot('agentdesk-task-staging-policy-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const external = path.join(root, 'external');
  const linkedRoot = path.join(root, 'linked-staging');
  fs.mkdirSync(external, { mode: 0o700 });
  fs.symlinkSync(external, linkedRoot, 'dir');
  assert.throws(() => new TaskPackageService({
    historyFile: path.join(root, 'linked-history.json'),
    stagingRoot: linkedRoot
  }), /task-package-staging-root-invalid/);

  const stagingRoot = path.join(root, 'staging');
  fs.mkdirSync(stagingRoot, { mode: 0o777 });
  fs.chmodSync(stagingRoot, 0o777);
  const packagePath = path.join(root, 'placeholder.agentdesk-task');
  fs.writeFileSync(packagePath, 'encrypted-placeholder', { mode: 0o600 });
  const service = new TaskPackageService({
    historyFile: path.join(root, 'history.json'),
    stagingRoot,
    randomUUID: () => 'mode-draft'
  });
  assert.equal(fs.statSync(stagingRoot).mode & 0o077, 0);
  const draft = service.createImportDraft(packagePath);
  const draftRoot = path.join(stagingRoot, `import-${draft.token}`);
  assert.equal(fs.statSync(draftRoot).mode & 0o077, 0);
  service.cancelImport(draft.token);

  fs.rmdirSync(stagingRoot);
  fs.symlinkSync(external, stagingRoot, 'dir');
  assert.throws(() => service.createImportDraft(packagePath), /task-package-staging-root-invalid/);
  assert.deepEqual(fs.readdirSync(external), []);
  service.stop();
});

test('任务包清单拒绝总量越界、重复逻辑路径和伪装成会话的附件', () => {
  const hash = '0'.repeat(64);
  assert.equal(MAX_PACKAGE_BYTES, MAX_ENTRY_BYTES * 2);
  assert.throws(() => normalizeTaskPackageManifest(transcriptManifest({
    checkpoint: { objective: '  ' },
    entries: [{ index: 0, entryId: 'content', kind: 'conversation-transcript', name: 'conversation/conversation.md', size: 1, sha256: hash }]
  })), /checkpoint\.objective is required/);
  assert.throws(() => normalizeTaskPackageManifest(transcriptManifest({
    entries: [
      { index: 0, entryId: 'content', kind: 'conversation-transcript', name: 'conversation/conversation.md', size: MAX_ENTRY_BYTES, sha256: hash },
      { index: 1, entryId: 'a', kind: 'attachment', name: 'attachments/a.bin', size: MAX_ENTRY_BYTES, sha256: hash },
      { index: 2, entryId: 'b', kind: 'attachment', name: 'attachments/b.bin', size: 1, sha256: hash }
    ]
  })), /task-package-total-size/);

  assert.throws(() => normalizeTaskPackageManifest(transcriptManifest({
    entries: [
      { index: 0, entryId: 'content', kind: 'conversation-transcript', name: 'conversation/conversation.md', size: 1, sha256: hash },
      { index: 1, entryId: 'a', kind: 'attachment', name: 'conversation/conversation.md', size: 1, sha256: hash }
    ]
  })), /task-package-entry-name-duplicate/);

  assert.throws(() => normalizeTaskPackageManifest(transcriptManifest({
    entries: [
      { index: 0, entryId: 'content', kind: 'conversation-transcript', name: 'Conversation/Conversation.md', size: 1, sha256: hash },
      { index: 1, entryId: 'a', kind: 'attachment', name: 'conversation/conversation.md', size: 1, sha256: hash }
    ]
  })), /task-package-entry-name-duplicate/);

  assert.throws(() => normalizeTaskPackageManifest({
    ...transcriptManifest(),
    entries: [{ index: 0, entryId: 'content', kind: 'attachment', name: 'attachments/fake.md', size: 1, sha256: hash }]
  }), /task-package-session-entry-kind/);

  assert.throws(() => normalizeTaskPackageManifest(transcriptManifest({
    entries: [
      { index: 0, entryId: 'content', kind: 'conversation-transcript', name: 'conversation/conversation.md', size: 1, sha256: hash },
      { index: 1, entryId: 'hidden-root', kind: 'native-session-root', name: 'native/codex/hidden.jsonl', size: 1, sha256: hash }
    ]
  })), /task-package-native-entry-unreferenced/);

  assert.throws(() => normalizeTaskPackageManifest(transcriptManifest({
    entries: [
      { index: 0, entryId: 'content', kind: 'conversation-transcript', name: 'conversation/conversation.md', size: 1, sha256: hash },
      { index: 1, entryId: 'hidden-patch', kind: 'git-working-tree', name: 'project/hidden.patch', size: 1, sha256: hash }
    ]
  })), /task-package-project-entry-unreferenced/);
});

test('项目检查点记录 Git 基线与已跟踪差异，不暗中打包未跟踪文件内容', (t) => {
  const root = tempRoot('agentdesk-task-git-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = path.join(root, 'project');
  const staging = path.join(root, 'staging');
  fs.mkdirSync(repository, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  const git = (args) => execFileSync('git', ['-C', repository, ...args], { stdio: 'pipe' }).toString('utf8').trim();
  git(['init', '-b', 'main']);
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'baseline\n');
  git(['add', 'tracked.txt']);
  git(['-c', 'user.name=AgentDesk Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'baseline']);
  git(['remote', 'add', 'origin', 'git@example.invalid:team/project.git']);
  fs.writeFileSync(path.join(repository, 'tracked.txt'), 'changed tracked content\n');
  fs.writeFileSync(path.join(repository, 'untracked-secret.txt'), 'must not enter the patch\n');

  const captured = captureGitProject(repository, staging);
  assert.equal(captured.manifest.branch, 'main');
  assert.equal(captured.manifest.remote, 'git@example.invalid:team/project.git');
  assert.match(captured.manifest.head, /^[a-f0-9]{40}$/);
  assert.equal(captured.manifest.dirty, true);
  assert.equal(captured.manifest.statusSummary.some((line) => line.includes('untracked-secret.txt')), true);
  assert.match(captured.entry.buffer.toString('utf8'), /changed tracked content/);
  assert.doesNotMatch(captured.entry.buffer.toString('utf8'), /must not enter the patch/);
});

test('Codex 原生任务包携带根会话和内部记录，导入后历史可读并自动标注来源 Agent', async (t) => {
  const root = tempRoot('agentdesk-task-codex-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, 'source-codex');
  const targetRoot = path.join(root, 'target-codex');
  const sourceFile = path.join(sourceRoot, 'sessions', '2026', '08', '14', 'rollout-root.jsonl');
  const childFile = path.join(sourceRoot, 'sessions', '2026', '08', '14', 'rollout-child.jsonl');
  writeJsonl(sourceFile, [
    meta({ id: 'physical-root', session_id: 'conversation-a', cwd: path.join(root, 'project') }),
    { timestamp: '2026-08-14T01:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'continue this exact history' } }
  ]);
  writeJsonl(childFile, [
    meta({
      id: 'physical-child',
      session_id: 'conversation-a',
      parent_thread_id: 'conversation-a',
      thread_source: 'subagent',
      source: { subagent: { other: 'guardian' } }
    })
  ]);
  writeJsonl(path.join(sourceRoot, 'session_index.jsonl'), [
    { id: 'conversation-a', thread_name: 'Investigate migration', updated_at: '2026-08-14T01:02:00.000Z' }
  ]);
  fs.mkdirSync(targetRoot, { recursive: true });
  const sourceProfile = {
    id: 'source-profile', name: 'Engineering Agent', appId: 'codex',
    profilePath: sourceRoot, sessionRoot: sourceRoot
  };
  const targetProfile = {
    id: 'target-profile', name: 'Review Agent', appId: 'codex',
    profilePath: targetRoot, sessionRoot: targetRoot
  };
  const failedOpenRoot = path.join(root, 'failed-open-codex');
  fs.mkdirSync(failedOpenRoot, { recursive: true });
  const failedOpenProfile = {
    id: 'failed-open-profile', name: 'Fallback Agent', appId: 'codex',
    profilePath: failedOpenRoot, sessionRoot: failedOpenRoot
  };
  const profiles = [sourceProfile, targetProfile, failedOpenProfile];
  const packagePath = path.join(root, 'handoff.agentdesk-task');
  const attachmentPath = path.join(root, 'handoff-reference.txt');
  fs.writeFileSync(attachmentPath, 'frozen attachment content\n');
  const historyFile = path.join(root, 'task-history.json');
  let launched = null;
  let launchSucceeds = true;
  const service = new TaskPackageService({
    profileProvider: () => profiles,
    meshOverviewProvider: () => ({
      initialized: true,
      localDeviceId: 'device-a',
      devices: [{ deviceId: 'device-a', name: 'Source Mac' }],
      agents: [{ agentId: 'agent-a', displayName: 'Engineering Agent' }],
      slots: [{ deviceId: 'device-a', profileId: 'source-profile', agentId: 'agent-a' }]
    }),
    historyFile,
    stagingRoot: path.join(root, 'staging'),
    randomUUID: (() => {
      const ids = ['package-a', 'draft-a'];
      return () => ids.shift() || `id-${Date.now()}`;
    })(),
    randomBytes: () => Buffer.alloc(20, 7),
    now: () => '2026-08-14T02:00:00.000Z',
    launchProfile: async (profile) => { launched = profile.id; return { ok: launchSucceeds }; }
  });

  const preview = service.previewExport({ profileId: sourceProfile.id, sessionId: 'conversation-a' });
  assert.equal(preview.mode, 'native');
  assert.equal(preview.nativeRecordCount, 2);
  const exported = await service.exportPackage({
    profileId: sourceProfile.id,
    sessionId: 'conversation-a',
    destinationPath: packagePath,
    includeProject: false,
    attachmentPaths: [attachmentPath],
    senderLabel: 'Alice',
    checkpoint: {
      objective: 'Complete the migration adapter',
      completed: ['Captured the source history'],
      next: ['Verify target resume'],
      acceptance: ['The target client lists the full thread']
    }
  });
  assert.equal(exported.packageId, 'package-a');
  assert.match(exported.unlockCode, /-/);
  fs.writeFileSync(attachmentPath, 'source changed after export\n');

  const draft = service.createImportDraft(packagePath);
  const inspected = await service.inspectImport({ token: draft.token, unlockCode: exported.unlockCode });
  assert.equal(inspected.manifest.session.mode, 'native');
  assert.equal(inspected.manifest.session.childEntryIds.length, 1);
  assert.deepEqual(inspected.compatibleProfiles.map((profile) => profile.profileId), ['target-profile', 'failed-open-profile']);
  const imported = await service.commitImport({
    token: draft.token,
    targetProfileId: targetProfile.id,
    artifactDirectory: path.join(root, 'received'),
    openAfterImport: true
  });
  assert.equal(imported.nativeImport.sessionId, 'conversation-a');
  assert.equal(launched, 'target-profile');
  const targetSessions = scanCodex(targetProfile);
  assert.equal(targetSessions.length, 1);
  assert.equal(targetSessions[0].id, 'conversation-a');
  assert.equal(targetSessions[0].internalBranchCount, 1);
  assert.match(targetSessions[0].title, /Alice \/ Engineering Agent/);
  assert.match(fs.readFileSync(path.join(imported.artifactDirectory, '交接说明.md'), 'utf8'), /Complete the migration adapter/);
  assert.equal(
    fs.readFileSync(path.join(imported.artifactDirectory, '附件', 'handoff-reference.txt'), 'utf8'),
    'frozen attachment content\n'
  );
  const history = service.listHistory();
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((item) => item.direction).sort(), ['exported', 'imported']);

  const titleIndexPath = path.join(targetRoot, 'session_index.jsonl');
  const titleIndexBeforeRepeat = fs.readFileSync(titleIndexPath, 'utf8');
  const repeatDraft = service.createImportDraft(packagePath);
  await service.inspectImport({ token: repeatDraft.token, unlockCode: exported.unlockCode });
  const repeated = await service.commitImport({
    token: repeatDraft.token,
    targetProfileId: targetProfile.id,
    artifactDirectory: path.join(root, 'received-repeat'),
    openAfterImport: false
  });
  assert.equal(repeated.nativeImport.idempotent, true);
  assert.equal(fs.readFileSync(titleIndexPath, 'utf8'), titleIndexBeforeRepeat);

  launchSucceeds = false;
  const failedOpenDraft = service.createImportDraft(packagePath);
  await service.inspectImport({ token: failedOpenDraft.token, unlockCode: exported.unlockCode });
  const importedWithoutLaunch = await service.commitImport({
    token: failedOpenDraft.token,
    targetProfileId: failedOpenProfile.id,
    artifactDirectory: path.join(root, 'received-without-launch'),
    openAfterImport: true
  });
  assert.equal(importedWithoutLaunch.openFailed, true);
  assert.equal(importedWithoutLaunch.opened, false);
  assert.equal(fs.existsSync(importedWithoutLaunch.artifactDirectory), true);
  assert.equal(scanCodex(failedOpenProfile)[0].id, 'conversation-a');
});

test('直送导入以独立 consumed ledger 阻断重放，并分别记录真实来源与目标客户端', async (t) => {
  const root = tempRoot('agentdesk-task-consumed-ledger-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const packagePath = path.join(root, 'direct.agentdesk-task');
  const historyFile = path.join(root, 'task-package-history.json');
  const consumedFile = path.join(root, 'task-package-consumed.json');
  const stagingRoot = path.join(root, 'staging');
  const targetRoot = path.join(root, 'target-codex');
  fs.mkdirSync(targetRoot, { recursive: true });
  const targetProfile = {
    id: 'target-profile',
    name: 'Target Codex Agent',
    appId: 'codex',
    profilePath: targetRoot,
    sessionRoot: targetRoot
  };
  const unlockCode = 'ABCDE-FGHIJ-KLMNO-PQRST';
  const manifest = transcriptManifest({
    packageId: 'package-direct-ledger',
    source: {
      senderLabel: 'Source Operator',
      deviceId: 'source-device',
      deviceName: 'Untrusted manifest device name',
      agentId: 'source-agent',
      agentName: 'Source Kimi Agent',
      profileId: 'source-profile',
      appId: 'kimi'
    }
  });
  await writeEncryptedTaskPackage({
    destinationPath: packagePath,
    unlockCode,
    manifest,
    entries: [{
      entryId: 'content',
      kind: 'conversation-transcript',
      name: 'conversation/conversation.md',
      buffer: Buffer.from('# source transcript\n', 'utf8'),
      metadata: {}
    }]
  });
  const packageHash = crypto.createHash('sha256').update(fs.readFileSync(packagePath)).digest('hex');
  const delivery = {
    meshId: 'mesh-a',
    transferId: 'transfer-direct-ledger',
    packageId: 'package-direct-ledger',
    packageHash,
    sourceDeviceId: 'source-device',
    targetDeviceId: 'target-device'
  };
  const service = new TaskPackageService({
    profileProvider: () => [targetProfile],
    meshOverviewProvider: () => ({
      initialized: true,
      localDeviceId: 'target-device',
      devices: [{ deviceId: 'target-device', name: 'Target Mac' }],
      agents: [{ agentId: 'target-agent', displayName: 'Target Codex Agent' }],
      slots: [{ deviceId: 'target-device', profileId: 'target-profile', agentId: 'target-agent' }]
    }),
    historyFile,
    consumedFile,
    stagingRoot,
    randomUUID: () => 'direct-ledger-draft',
    now: () => '2026-08-14T03:00:00.000Z'
  });
  const draft = service.createImportDraft(packagePath);
  await service.inspectImport({ token: draft.token, unlockCode });
  service.attachImportDelivery(draft.token, {
    deliveryMode: 'mesh-direct',
    ...delivery,
    sourceDeviceName: 'Authenticated Source Mac',
    targetDeviceName: 'Target Mac'
  });
  const committed = await service.commitImport({
    token: draft.token,
    targetProfileId: targetProfile.id,
    artifactDirectory: path.join(root, 'received'),
    openAfterImport: false
  });
  assert.equal(committed.consumedRecorded, true);
  assert.equal(service.hasConsumedTransfer(delivery), true);
  assert.equal(service.hasConsumedTransferId(delivery.transferId), true);

  const importedHistory = service.listHistory().find((entry) => entry.direction === 'imported');
  assert.equal(importedHistory.appId, 'kimi');
  assert.equal(importedHistory.targetAppId, 'codex');
  assert.equal(importedHistory.sourceDeviceName, 'Authenticated Source Mac');
  assert.equal(importedHistory.sourceDeviceId, 'source-device');
  assert.equal(importedHistory.targetDeviceId, 'target-device');

  fs.writeFileSync(historyFile, JSON.stringify({ schemaVersion: 1, entries: [] }), { mode: 0o600 });
  assert.deepEqual(service.listHistory(), []);
  assert.equal(service.hasConsumedTransfer(delivery), true);
  service.stop();

  const restarted = new TaskPackageService({
    profileProvider: () => [targetProfile],
    historyFile,
    consumedFile,
    stagingRoot: path.join(root, 'restarted-staging')
  });
  assert.equal(restarted.hasConsumedTransfer(delivery), true);
  assert.equal(restarted.hasConsumedTransferId(delivery.transferId), true);
  assert.throws(() => restarted.recordConsumedTransfer({
    ...delivery,
    packageHash: 'f'.repeat(64),
    state: 'consumed',
    createdAt: '2026-08-14T03:00:00.000Z',
    consumedAt: '2026-08-14T03:00:00.000Z'
  }), /task-package-consumed-conflict/);
  restarted.stop();
});
