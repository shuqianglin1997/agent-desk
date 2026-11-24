const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { resolveLocalSessions, sessionDirectories } = require('../src/main/session-actions');
const { prepareSessionExport } = require('../src/session-export');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-session-actions-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('session actions resolve a batch against each exact Profile once and group containing directories', (t) => {
  const root = workspace(t);
  const child = path.join(root, 'another project');
  fs.mkdirSync(child);
  const byProfile = {
    first: [{ id: 'a', filePath: path.join(root, 'a.jsonl') }, { id: 'b', filePath: path.join(root, 'b.jsonl') }],
    second: [{ id: 'a', filePath: path.join(child, 'a.jsonl') }]
  };
  for (const session of Object.values(byProfile).flat()) fs.writeFileSync(session.filePath, '');
  const profiles = ['first', 'second'].map((id) => ({ id, appId: 'codex' }));
  const scans = [];
  const client = { scan(profile) { scans.push(profile.id); return byProfile[profile.id]; } };
  const refs = [
    { profileId: 'first', sessionId: 'b', filePath: '/wrong' },
    { profileId: 'second', sessionId: 'a' },
    { profileId: 'first', sessionId: 'a' },
    { profileId: 'first', sessionId: 'b' }
  ];
  const records = resolveLocalSessions({ selections: refs }, profiles, () => client);
  assert.deepEqual(scans, ['first', 'second']);
  assert.deepEqual(records.map(({ session }) => session.filePath), [byProfile.first[1].filePath, byProfile.second[0].filePath, byProfile.first[0].filePath]);
  assert.deepEqual(sessionDirectories(records), [
    { path: fs.realpathSync.native(root), count: 2, ref: { profileId: 'first', sessionId: 'b' } },
    { path: fs.realpathSync.native(child), count: 1, ref: { profileId: 'second', sessionId: 'a' } }
  ]);
  assert.throws(() => resolveLocalSessions({ selections: [{ profileId: 'first', sessionId: 'missing' }] }, profiles, () => client), /session-not-found/);
  fs.unlinkSync(byProfile.second[0].filePath);
  assert.throws(() => sessionDirectories(records), /session-directory-unavailable/);
});

function transcriptRecord(root, id, title, content = []) {
  const filePath = path.join(root, `${id}.jsonl`);
  fs.writeFileSync(filePath, JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content } }) + '\n');
  return {
    profile: { appId: 'codex', sessionRoot: root },
    session: { id, title, filePath },
    client: { exportTranscript: () => ({ markdown: `## 用户\n\n正文 ${id}`, suggestedName: `${title}.md` }) }
  };
}

test('text-only exports stay Markdown for both a focused session and a batch', async (t) => {
  const root = workspace(t);
  const a = transcriptRecord(root, 'one', '会话一');
  const b = transcriptRecord(root, 'two', '会话二');
  const single = await prepareSessionExport([a]);
  assert.equal(single.suggestedName, '会话一.md');
  assert.equal(single.format, 'md');
  assert.match(single.data, /^# 会话一\n/);
  const batch = await prepareSessionExport([b, a]);
  assert.equal(batch.suggestedName, 'sessions.md');
  assert.match(batch.data, /^# 会话二[\s\S]*\n---\n[\s\S]*# 会话一/);
});

function readStoredZip(buffer) {
  const files = new Map();
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  const entryCount = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    assert.equal(buffer.readUInt16LE(cursor + 10), 0);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);
    const local = buffer.readUInt32LE(cursor + 42);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    assert.equal(buffer.toString('utf8', local + 30, local + 30 + nameLength), name);
    const offset = local + 30 + nameLength;
    const data = buffer.subarray(offset, offset + buffer.readUInt32LE(local + 22));
    assert.equal(crc32(data), buffer.readUInt32LE(cursor + 16));
    files.set(name, data);
    cursor += 46 + nameLength;
  }
  assert.equal(cursor, end);
  return files;
}

test('ZIP export includes inline attachments and only the selected Codex thread’s saved images', async (t) => {
  const root = workspace(t);
  const inline = Buffer.from('fixture image');
  const file = Buffer.from('fixture pdf');
  const part = { type: 'input_image', image_url: `data:image/png;base64,${inline.toString('base64')}` };
  const record = transcriptRecord(root, 'thread', '带资料', [part, part, {
    type: 'input_file', filename: '../../文件 (1).pdf', file_data: `data:application/pdf;base64,${file.toString('base64')}`
  }, { type: 'input_image', image_url: 'https://localhost.invalid/external.png' }]);

  const imageDir = path.join(root, 'generated_images');
  fs.mkdirSync(imageDir);
  const saved = path.join(imageDir, 'generated.png');
  const outside = path.join(root, 'private.txt');
  fs.writeFileSync(saved, 'fixture generated image');
  fs.writeFileSync(outside, 'private fixture');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(root, 'thread_history_1.sqlite'));
  db.exec('CREATE TABLE thread_items (thread_id TEXT, turn_id TEXT, item_id TEXT, item_type TEXT, item_json TEXT)');
  const insert = db.prepare('INSERT INTO thread_items VALUES (?, ?, ?, ?, ?)');
  insert.run('thread', 'one', '1', 'imageGeneration', JSON.stringify({ status: 'completed', savedPath: saved }));
  insert.run('thread', 'one', '2', 'imageGeneration', JSON.stringify({ status: 'completed', savedPath: outside }));
  insert.run('different', 'one', '3', 'imageGeneration', JSON.stringify({ status: 'completed', result: Buffer.from('other conversation').toString('base64') }));
  db.close();

  const output = await prepareSessionExport([record], { attachmentsHeading: '会话附件' });
  assert.equal(output.suggestedName, '带资料.zip');
  assert.equal(output.attachmentCount, 3);
  const files = readStoredZip(output.data);
  assert.deepEqual(files.get('attachments/1/1-attachment.png'), inline);
  assert.deepEqual(files.get('attachments/1/2-文件 (1).pdf'), file);
  assert.equal(files.get('attachments/1/3-generated.png').toString(), 'fixture generated image');
  assert.match(files.get('带资料.md').toString(), /会话附件[\s\S]*attachments\/1\/2-%E6%96%87/);
  assert.doesNotMatch(output.data.toString(), /private fixture|other conversation/);
});
