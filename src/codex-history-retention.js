/*
 * Opt-in maintenance of Codex's existing paginated history, after a managed
 * client exits. The native client owns the rollout format and lineage; this
 * module never edits serialized rollout bytes or lineage. Filesystem transparent
 * compression preserves paths, bytes and offsets for both existing readers. It
 * removes redundant inline generated-image bytes and bounds completed previews.
 * Retire this adapter when the native client exposes equivalent maintenance.
 */
const fs = require('node:fs');
const path = require('node:path');
const paths = require('./core/paths');
const { writeFileAtomic } = require('./core/json-file');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn, spawnSync } = require('node:child_process');

const POLICY_FILE = 'agentdesk-history-retention.json';
const POLICY = Object.freeze({ version: 1, enabled: true, maxToolBytes: 8192, previewChars: 512, compressArchived: true });
const STATUS_FILE = 'agentdesk-history-retention-status.json';
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => paths.isInside(file, root, { resolve: false });

function canonicalRoot(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('history-root-invalid');
  const root = fs.realpathSync(input);
  if (root === path.parse(root).root || !fs.statSync(root).isDirectory()) throw new Error('history-root-invalid');
  for (const name of ['state_5.sqlite', 'thread_history_1.sqlite']) {
    const p = path.join(root, name);
    const st = fs.lstatSync(p);
    if (!st.isFile() || st.isSymbolicLink() || fs.realpathSync(p) !== p) throw new Error('history-db-unsafe');
  }
  return root;
}

function readPolicy(root) {
  const file = path.join(root, POLICY_FILE);
  if (!fs.existsSync(file)) return null;
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error('history-policy-unsafe');
  const p = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (p.version !== 1 || p.enabled !== true) return null;
  if (!Number.isInteger(p.maxToolBytes) || p.maxToolBytes < 8192 || p.maxToolBytes > 1048576 ||
      !Number.isInteger(p.previewChars) || p.previewChars < 256 || p.previewChars * 8 >= p.maxToolBytes ||
      (p.compressArchived !== undefined && typeof p.compressArchived !== 'boolean')) {
    throw new Error('history-policy-invalid');
  }
  return p;
}

// Which processes hold the client's files. Production always asks lsof; tests
// inject a fake so results never depend on what else the machine has open.
const LSOF_PROCESS_CHECK = Object.freeze({
  // PIDs holding any of `files`; a failed check is an error, never "nobody".
  holders(files) {
    const r = spawnSync('/usr/sbin/lsof', ['-t', '--', ...files], { encoding: 'utf8', timeout: 10000 });
    if (r.error || ![0, 1].includes(r.status)) throw new Error('history-process-check-failed');
    return [...new Set(r.stdout.trim().split(/\s+/).filter(Boolean).map(Number))];
  },
  // The subset of `files` some process holds, or null when the answer cannot be trusted.
  heldAmong(files) {
    const r=spawnSync('/usr/sbin/lsof',['-F','n','--',...files],{encoding:'utf8',timeout:10000});
    if (r.error || ![0,1].includes(r.status)) return null;
    const names=r.stdout.split('\n').filter(x=>x.startsWith('n')).map(x=>x.slice(1));
    const allowed=new Set(files);
    if (names.some(n=>!allowed.has(n))) return null;
    return new Set(names);
  },
  // True only when lsof positively reports that nobody holds `file`.
  isIdle(file) {
    const r=spawnSync('/usr/sbin/lsof',['-t','--',file],{encoding:'utf8',timeout:2000});
    return !r.error && r.status===1 && !r.stdout.trim();
  }
});

function foreignDatabaseHandles(root, check = LSOF_PROCESS_CHECK) {
  if (process.platform !== 'darwin') throw new Error('history-platform-not-validated');
  const files = ['state_5.sqlite', 'thread_history_1.sqlite'].flatMap((name) =>
    ['', '-wal', '-shm'].map((suffix) => path.join(root, name + suffix)).filter((p) => fs.existsSync(p)));
  return check.holders(files).filter((pid) => pid !== process.pid);
}

function idleUnarchivedThreads(root, state, db, threads, check = LSOF_PROCESS_CHECK) {
  // "Unarchived" is not "in use": old finished chats are often never archived.
  // Require a full day of inactivity, no unfinished turn, an original rollout
  // inside this root, and no process holding that rollout. Unknown states defer.
  const busy = new Set(db.prepare("SELECT DISTINCT thread_id FROM thread_turns WHERE COALESCE(status,'') NOT IN ('completed','interrupted','failed')").all().map(r=>r.thread_id));
  const candidates = [];
  for (const thread of threads) {
    if (thread.archived || thread.updated_at >= Date.now()/1000-86400 || busy.has(thread.id) || !thread.rollout_path) continue;
    try {
      // Native state keeps the canonical .jsonl name even when its existing
      // on-disk original is .jsonl.zst. This does not enable/convert formats.
      let original=thread.rollout_path;
      if (!fs.existsSync(original) && original.endsWith('.jsonl')) original += '.zst';
      const file=fs.realpathSync(original),st=fs.lstatSync(file);
      if (file.endsWith('.zst')) {
        const fd=fs.openSync(file,'r'), magic=Buffer.alloc(4);
        try { if(fs.readSync(fd,magic,0,4,0)!==4 || magic.toString('hex')!=='28b52ffd') continue; }
        finally { fs.closeSync(fd); }
      }
      if (inside(root,file) && st.isFile() && /\.jsonl(?:\.zst)?$/.test(file)) candidates.push({id:thread.id,file});
    } catch { /* Missing originals cannot provide safe historical recovery. */ }
  }
  const idle = new Set();
  for (let i=0;i<candidates.length;i+=64) {
    const batch=candidates.slice(i,i+64);
    const held=check.heldAmong(batch.map(x=>x.file));
    if (!held) continue;
    for(const c of batch) if(!held.has(c.file)) idle.add(c.id);
  }
  return idle;
}

function looksLikeProtectedPayload(text) {
  return /data:(?:image|application)\/|iVBORw0KGgo|\/9j\/|JVBERi0|diff --git|\*\*\* Begin Patch|"(?:image_url|download_url|file_url|artifact|attachment|resource_link)"/i.test(text);
}

function compactText(text, policy) {
  if (typeof text !== 'string' || Buffer.byteLength(text) <= policy.maxToolBytes || looksLikeProtectedPayload(text)) return text;
  const marker = `\n[Archived raw tool output trimmed: ${Buffer.byteLength(text)} original bytes; first and last excerpts retained.]\n`;
  return text.slice(0, policy.previewChars) + marker + text.slice(-policy.previewChars);
}

function compactToolText(text, policy, depth = 0) {
  if (typeof text !== 'string' || Buffer.byteLength(text) <= policy.maxToolBytes) return text;
  // Exec wrappers often serialize another MCP result into one text block. Keep
  // its actual media/resources while bounding only nested successful text.
  if (depth < 8) {
    let nested;
    try { nested = JSON.parse(text); } catch { /* ordinary command output */ }
    if (nested && !Array.isArray(nested) && Array.isArray(nested.content)) {
      if (nested.isError === true || nested.error) return text;
      let changed = false;
      for (const part of nested.content) {
        if (part?.type !== 'text') continue;
        const next = compactToolText(part.text,policy,depth+1);
        if (next !== part.text) { part.text = next; changed = true; }
      }
      return changed ? JSON.stringify(nested) : text;
    }
  }
  return compactText(text,policy);
}

function compactToolItem(item, policy) {
  if (item.status !== 'completed') return false;
  if (item.type === 'commandExecution' && item.exitCode === 0) {
    const next = compactToolText(item.aggregatedOutput, policy);
    if (next === item.aggregatedOutput) return false;
    item.aggregatedOutput = next;
    return true;
  }
  if (item.type !== 'mcpToolCall' || item.error || !item.result || item.result.isError === true) return false;
  let changed = false;
  // Leave images, resources, citations, arbitrary structured data and _meta
  // intact. Only these explicit text/output fields are known tool previews.
  for (const content of item.result.content || []) {
    if (content?.type !== 'text') continue;
    const next = compactToolText(content.text, policy);
    if (next !== content.text) { content.text = next; changed = true; }
  }
  const structured = item.result.structuredContent;
  if (structured && typeof structured === 'object' && !Array.isArray(structured)) {
    for (const key of ['stdout', 'stderr', 'output', 'text']) {
      const next = compactToolText(structured[key], policy);
      if (next !== structured[key]) { structured[key] = next; changed = true; }
    }
  }
  return changed;
}

function privateImageDirectory(root) {
  let current = root;
  for (const part of ['generated_images', 'history-media']) {
    current = path.join(current, part);
    fs.mkdirSync(current, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(current) !== current) throw new Error('history-image-root-unsafe');
  }
  return current;
}

function preserveImage(item, root, apply, cache) {
  if (item.type !== 'imageGeneration' || item.status !== 'completed' || typeof item.result !== 'string' || !item.result) return null;
  // Do not interpret URLs, placeholders or unknown media as base64 PNG bytes.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(item.result) || item.result.length % 4) return null;
  const bytes = Buffer.from(item.result, 'base64');
  if (bytes.toString('base64') !== item.result || !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return null;
  const digest = sha(bytes);
  let file = cache.get(digest);
  const generatedRoot = path.join(root, 'generated_images');
  const aliasRoot = path.join(os.tmpdir(), `agentdesk-codex-${process.getuid?.() ?? 'user'}`);
  const knownPrivatePath = typeof item.savedPath === 'string' && path.isAbsolute(item.savedPath) &&
    (inside(root,item.savedPath) || inside(aliasRoot,item.savedPath));
  if (!file && knownPrivatePath && fs.existsSync(item.savedPath)) {
    const st = fs.lstatSync(item.savedPath);
    const real = fs.realpathSync(item.savedPath);
    const ownedMedia = ['generated_images','visualizations'].some((dir) => inside(path.join(root,dir),real));
    if (st.isFile() && !st.isSymbolicLink() && ownedMedia && st.size === bytes.length && sha(fs.readFileSync(real)) === digest) file = real;
  }
  let created = false;
  if (!file) {
    file = path.join(generatedRoot, 'history-media', `${digest}.png`);
    if (apply) {
      privateImageDirectory(root);
      if (fs.existsSync(file)) {
        const st = fs.lstatSync(file);
        if (!st.isFile() || st.isSymbolicLink() || sha(fs.readFileSync(file)) !== digest) throw new Error('history-image-conflict');
      } else {
        writeFileAtomic(file, bytes, { mode: 0o600 });
        created = true;
      }
    }
  }
  cache.set(digest, file);
  return { file, digest, bytes: bytes.length, created };
}

function humanFingerprint(db, threadIds, originalItems) {
  const h = crypto.createHash('sha256');
  let count = 0;
  const items = new Map();
  const stmt = db.prepare("SELECT turn_id,item_id,item_json FROM thread_items WHERE thread_id=? AND item_type IN ('userMessage','agentMessage') ORDER BY turn_id,item_id");
  for (const id of [...threadIds].sort()) for (const row of stmt.iterate(id)) {
    const key = JSON.stringify([id,row.turn_id,row.item_id]);
    if (originalItems && !originalItems.has(key)) continue; // Concurrent new messages are allowed.
    const digest = sha(row.item_json);
    if (originalItems && originalItems.get(key) !== digest) throw new Error('history-human-message-invariant-failed');
    items.set(key,digest);
    h.update(JSON.stringify([id,row.turn_id,row.item_id,row.item_json])); count++;
  }
  if (originalItems && items.size !== originalItems.size) throw new Error('history-human-message-invariant-failed');
  return { count, sha256: h.digest('hex'), items };
}

function fileDigest(file) {
  const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  const fd = fs.openSync(file,'r');
  try { for (;;) { const n=fs.readSync(fd,buffer,0,buffer.length,null); if(!n) break; hash.update(buffer.subarray(0,n)); } }
  finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function compressArchivedRollouts(input, options = {}) {
  const cutoff = options.updatedBeforeSeconds;
  if (cutoff !== undefined && (!Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > Math.floor(Date.now()/1000)-3600)) {
    throw new Error('history-cutoff-invalid');
  }
  const root = canonicalRoot(input);
  const area = path.join(root,'archived_sessions');
  const result = { compressed:0, allocatedBytesRemoved:0, verifiedLogicalBytes:0, skipped:0 };
  if (process.platform !== 'darwin' || !fs.existsSync(area)) return result;
  const deadline = Date.now() + (options.budgetMs ?? 20000);
  const files=[];
  let state, eligible, recheck;
  if (cutoff !== undefined) {
    const { DatabaseSync } = require('node:sqlite');
    state = new DatabaseSync(path.join(root,'state_5.sqlite'),{readOnly:true});
    try {
      eligible = new Map(state.prepare('SELECT id,rollout_path FROM threads WHERE archived=1 AND updated_at<? AND rollout_path IS NOT NULL').all(cutoff)
        .flatMap(row=>{
          try {
            const file=fs.realpathSync(row.rollout_path);
            return inside(root,file) ? [[file,{id:row.id,original:row.rollout_path}]] : [];
          } catch { return []; }
        }));
      recheck = state.prepare('SELECT archived,updated_at,rollout_path FROM threads WHERE id=?');
    } catch (error) { state.close(); throw error; }
  }
  const inScope = file => {
    if (!eligible) return true;
    const expected=eligible.get(file);
    if (!expected) return false;
    const row=recheck.get(expected.id);
    return row && row.archived===1 && row.updated_at<cutoff && row.rollout_path===expected.original;
  };
  const check = options.processCheck || LSOF_PROCESS_CHECK;
  const idle = (file) => check.isIdle(file);
  function walk(dir) {
    if (fs.lstatSync(dir).isSymbolicLink() || fs.realpathSync(dir)!==dir) return;
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const file=path.join(dir,entry.name);
      if(entry.isDirectory()) walk(file);
      else if(entry.isFile()) {
        const st=fs.statSync(file);
        if(entry.name.startsWith('.agentdesk-retention-') && entry.name.endsWith('.tmp')) {
          if(st.uid===process.getuid() && st.mtimeMs<Date.now()-86400000 && idle(file)) fs.unlinkSync(file);
        } else if(entry.name.endsWith('.jsonl') && st.size>=65536 && st.mtimeMs<Date.now()-3600000 && inScope(file)) files.push({file,st});
      }
    }
  }
  try {
  walk(area);
  // Small files first, so a slow large archive cannot starve later exits.
  files.sort((a,b)=>a.st.size-b.st.size);
  for(const {file,st} of files) {
    if(st.blocks*512 < st.size*0.8) continue; // Already transparently compressed or sparse.
    if(Date.now()+2000>=deadline) { result.deferred=true; break; }
    const sample=Buffer.alloc(Math.min(st.size,65536));
    const fd=fs.openSync(file,'r');try {fs.readSync(fd,sample,0,sample.length,0);} finally {fs.closeSync(fd);}
    // ditto deliberately declines poorly compressible data. Avoid temporary
    // copies of base64 images that do not meet its filesystem compression policy.
    if(zlib.deflateSync(sample).length>sample.length*0.5 || !idle(file)) {result.skipped++;continue;}
    const temp=path.join(path.dirname(file),`.agentdesk-retention-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`);
    try {
      const before=fileDigest(file);
      if (deadline-Date.now()<2000) {result.deferred=true;break;}
      const copied=spawnSync('/usr/bin/ditto',['--hfsCompression',file,temp],{stdio:'ignore',timeout:Math.min(60000,deadline-Date.now())});
      if(copied.error || copied.status!==0 || !fs.existsSync(temp)) {result.skipped++;continue;}
      const packed=fs.lstatSync(temp), now=fs.lstatSync(file);
      if(!packed.isFile() || packed.isSymbolicLink() || packed.size!==st.size || packed.blocks>=st.blocks ||
         now.ino!==st.ino || now.size!==st.size || now.mtimeMs!==st.mtimeMs || fileDigest(temp)!==before || !inScope(file) || !idle(file)) {result.skipped++;continue;}
      // A reader sees the exact original byte stream; no index or byte offset changes.
      fs.renameSync(temp,file);
      result.compressed++;result.allocatedBytesRemoved+=(st.blocks-packed.blocks)*512;result.verifiedLogicalBytes+=st.size;
    } finally {if(fs.existsSync(temp)) fs.unlinkSync(temp);}
  }
  return result;
  } finally { if (state) state.close(); }
}

function maintainHistory(input, options = {}) {
  const requestedCutoff = options.updatedBeforeSeconds;
  const defaultCutoff = Math.floor(Date.now()/1000) - 3600;
  if (requestedCutoff !== undefined && (!Number.isSafeInteger(requestedCutoff) || requestedCutoff < 0 || requestedCutoff > defaultCutoff)) {
    throw new Error('history-cutoff-invalid');
  }
  const root = canonicalRoot(input);
  const policy = readPolicy(root) || (options.explicit === true ? POLICY : null);
  if (!policy) return { skipped: 'not-enabled' };
  const apply = options.apply === true;
  const deadline = Date.now() + (options.budgetMs ?? Infinity);
  const check = options.processCheck || LSOF_PROCESS_CHECK;
  const handles = foreignDatabaseHandles(root, check);
  if (handles.length && !options.openArchived && !options.openIdle) return { skipped: 'client-still-open', foreignHandleCount: handles.length };
  const { DatabaseSync } = require('node:sqlite');
  const state = new DatabaseSync(path.join(root, 'state_5.sqlite'), { readOnly: true });
  const db = new DatabaseSync(path.join(root, 'thread_history_1.sqlite'), { readOnly: !apply });
  const result = { version: 1, applied: apply, imageItems: 0, toolItems: 0, imagesCreated: 0,
    imageBytesPreserved: 0, jsonBytesRemoved: 0, skippedItems: 0, vacuumed: false };
  try {
    db.exec('PRAGMA busy_timeout=2000');
    const columns = new Set(db.prepare('PRAGMA table_info(thread_items)').all().map((x) => x.name));
    for (const key of ['thread_id','turn_id','item_id','item_type','item_json']) if (!columns.has(key)) throw new Error('history-schema-not-supported');
    const cutoff = requestedCutoff ?? defaultCutoff;
    result.updatedBeforeSeconds = cutoff;
    const hasRolloutPath=state.prepare('PRAGMA table_info(threads)').all().some(c=>c.name==='rollout_path');
    const candidates = state.prepare(`SELECT id,archived,updated_at${hasRolloutPath?',rollout_path':''} FROM threads WHERE history_mode='paginated' AND updated_at<?`).all(cutoff);
    const idleIds=handles.length && options.openIdle && hasRolloutPath ? idleUnarchivedThreads(root,state,db,candidates,check) : new Set();
    const eligible=candidates.filter(t=>!handles.length || t.archived===1 || idleIds.has(t.id));
    result.idleUnarchivedInspected=handles.length ? idleIds.size : 0;
    const ids = eligible.map((t) => t.id);
    const before = humanFingerprint(db, ids);
    const recheck = state.prepare('SELECT archived,updated_at FROM threads WHERE id=?');
    // A stopped/failed turn can still contain successful completed tools and
    // delivered images. Terminal turn state and successful item state differ.
    const rows = db.prepare("SELECT i.turn_id,i.item_id,i.item_type,i.item_json FROM thread_items i JOIN thread_turns t ON t.thread_id=i.thread_id AND t.turn_id=i.turn_id WHERE i.thread_id=? AND t.status IN ('completed','interrupted','failed') AND i.item_type IN ('imageGeneration','commandExecution','mcpToolCall') AND (i.item_type='imageGeneration' OR length(CAST(i.item_json AS BLOB))>?) AND (i.turn_id>? OR (i.turn_id=? AND i.item_id>?)) ORDER BY i.turn_id,i.item_id LIMIT 16");
    const update = apply ? db.prepare('UPDATE thread_items SET item_json=? WHERE thread_id=? AND turn_id=? AND item_id=? AND item_json=?') : null;
    const imageCache = new Map();
    // Each write transaction is bounded to sixteen completed turn items. A native
    // writer may continue adding unrelated turns; compare-and-swap prevents
    // replacing an item that changed since inspection.
    for (const thread of eligible) {
      if (Date.now() >= deadline) { result.deferred = true; break; }
      let lastTurn = '', lastItem = '';
      for (;;) {
        if (Date.now() >= deadline) { result.deferred = true; break; }
        const snapshot = rows.all(thread.id,policy.maxToolBytes,lastTurn,lastTurn,lastItem);
        if (!snapshot.length) break;
        lastTurn=snapshot.at(-1).turn_id; lastItem=snapshot.at(-1).item_id;
        const edits=[];
        for (const row of snapshot) {
        const now = recheck.get(thread.id);
        if (!now || now.updated_at !== thread.updated_at || now.archived !== thread.archived) break;
        let item;
        try { item = JSON.parse(row.item_json); } catch { result.skippedItems++; continue; }
        if (item.type !== row.item_type) { result.skippedItems++; continue; }
        let image;
        try { image = preserveImage(item, root, apply, imageCache); } catch { result.skippedItems++; continue; }
        const tool = !image && compactToolItem(item, policy);
        if (!image && !tool) continue;
        if (image) { item.savedPath = image.file; item.result = ''; }
        const next = JSON.stringify(item);
          edits.push({ row,next,image });
        }
        if (apply && edits.length) db.exec('BEGIN IMMEDIATE');
        try {
          const current = recheck.get(thread.id);
          const unchanged = current && current.updated_at === thread.updated_at && current.archived === thread.archived;
          for (const {row,next,image} of edits) {
            if (!unchanged) { result.skippedItems++; continue; }
            if (apply && update.run(next,thread.id,row.turn_id,row.item_id,row.item_json).changes !== 1) { result.skippedItems++; continue; }
            result.jsonBytesRemoved += Buffer.byteLength(row.item_json)-Buffer.byteLength(next);
            if (image) { result.imageItems++; result.imageBytesPreserved+=image.bytes; if(image.created) result.imagesCreated++; }
            else result.toolItems++;
          }
          if (apply && edits.length) db.exec('COMMIT');
        } catch (error) { if (apply && edits.length) db.exec('ROLLBACK'); throw error; }
      }
    }
    const after = humanFingerprint(db, ids, before.items);
    if (before.sha256 !== after.sha256) throw new Error('history-human-message-invariant-failed');
    result.humanMessages = {count:after.count,sha256:after.sha256};
    result.threadsInspected = ids.length;
    if (apply) {
      const quick = db.prepare('PRAGMA quick_check').all();
      if (quick.some((r) => Object.values(r)[0] !== 'ok')) throw new Error('history-db-check-failed');
      const pages = db.prepare('PRAGMA freelist_count').get().freelist_count;
      const pageSize = db.prepare('PRAGMA page_size').get().page_size;
      result.reusableFreeBytes = pages * pageSize;
      // Automatic exits amortize a full-file VACUUM, triggered once 64 MiB of
      // history pages are free; busy or interrupted runs defer reclamation.
      // Explicit maintenance may reclaim any amount.
      if (pages > 0 && handles.length) {
        // A full online VACUUM can copy the entire DB into a WAL pinned by a
        // native reader, temporarily increasing disk use. Reuse freed pages
        // now and reclaim the file only after the actual client has closed.
        result.vacuumDeferred = true;
      } else if (pages > 0 && deadline - Date.now() > 15000 && (options.explicit || pages * pageSize >= 64 * 1024 * 1024)) {
        try { db.exec('VACUUM'); result.vacuumed = true; }
        catch (error) { if (!/busy|locked/i.test(String(error.message))) throw error; result.vacuumDeferred = true; }
      }
      try {
        if (db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').all().some((r) => r.busy)) result.checkpointDeferred = true;
      } catch { result.checkpointDeferred = true; }
    }
    if (apply && (options.compressArchives || (!options.explicit && policy.compressArchived))) {
      result.archives = compressArchivedRollouts(root,{updatedBeforeSeconds:requestedCutoff,processCheck:check,budgetMs: Math.max(0, Math.min(deadline-Date.now(), options.explicit ? 30*60*1000 : 20000))});
    }
    return result;
  } finally { db.close(); state.close(); }
}

function runAfterProfileStop(profile, options = {}) {
  if (profile?.appId !== 'codex' || !profile.sessionRoot || process.platform !== 'darwin') return Promise.resolve({ skipped: 'not-applicable' });
  let root;
  try { root = canonicalRoot(profile.sessionRoot); if (!readPolicy(root)) return Promise.resolve({ skipped: 'not-enabled' }); }
  catch { return Promise.resolve({ skipped: 'history-not-ready' }); }
  return new Promise((resolve) => {
    const args = [__filename, '--root', root, '--apply', '--automatic'];
    if (options.openArchived) args.push('--open-archived');
    if (options.openIdle) args.push('--open-idle');
    const child = spawn(options.execPath || process.execPath, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore','pipe','ignore'], windowsHide: true
    });
    let output = '';
    child.stdout.on('data', (b) => { if(output.length<65536) output += b; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 60000);
    timer.unref?.();
    child.once('error', () => { clearTimeout(timer); resolve({ skipped: 'history-worker-unavailable' }); });
    child.once('close', (code) => {
      clearTimeout(timer);
      try { resolve(code === 0 ? JSON.parse(output) : { skipped: 'history-maintenance-deferred' }); }
      catch { resolve({ skipped: 'history-worker-result-invalid' }); }
    });
  });
}

module.exports = { POLICY_FILE, POLICY, canonicalRoot, readPolicy, compactText, compactToolItem,
  preserveImage, compressArchivedRollouts, maintainHistory, runAfterProfileStop, STATUS_FILE,
  LSOF_PROCESS_CHECK, runCli };

function withMaintenanceLock(root, action) {
  const lock = path.join(root, '.agentdesk-history-retention.lock');
  try { fs.mkdirSync(lock, {mode:0o700}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const st = fs.lstatSync(lock);
    if (!st.isDirectory() || st.isSymbolicLink() || st.uid !== process.getuid()) throw new Error('history-lock-unsafe');
    const ownerFile = path.join(lock,'owner.json');
    try {
      const owner = JSON.parse(fs.readFileSync(ownerFile,'utf8'));
      if (!Number.isInteger(owner.pid) || owner.pid <= 0) return {skipped:'maintenance-lock-invalid'};
      try { process.kill(owner.pid,0); return {skipped:'maintenance-already-running'}; }
      catch (e) { if (e.code !== 'ESRCH') return {skipped:'maintenance-already-running'}; }
      fs.unlinkSync(ownerFile); fs.rmdirSync(lock);
    } catch (e) {
      // A worker may be between mkdir and publishing its owner. Never steal it.
      if (e.code === 'ENOENT') {
        if (Date.now()-st.mtimeMs > 120000 && fs.readdirSync(lock).length === 0) {
          try { fs.rmdirSync(lock); } catch { return {skipped:'maintenance-lock-pending'}; }
          return withMaintenanceLock(root,action);
        }
        return {skipped:'maintenance-lock-pending'};
      }
      throw e;
    }
    return withMaintenanceLock(root,action);
  }
  const ownerFile = path.join(lock,'owner.json');
  try {
    fs.writeFileSync(ownerFile,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});
    return action();
  } finally { fs.unlinkSync(ownerFile); fs.rmdirSync(lock); }
}

function writeStatus(root, status) {
  const file = path.join(root,STATUS_FILE);
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new Error('history-status-unsafe');
  writeFileAtomic(file, JSON.stringify(status)+'\n', { mode: 0o600 });
}

// The worker CLI. Returns { code, output, error } instead of writing, so a test
// can run the same code path with an injected process check.
function runCli(args, { processCheck } = {}) {
  try {
    const root = args[args.indexOf('--root')+1];
    if (args.indexOf('--root') < 0 || args.some((a,i) => a.startsWith('--') && !['--root','--apply','--open-archived','--open-idle','--automatic','--enable-policy','--compress-archives','--before'].includes(a))) throw new Error('history-arguments-invalid');
    const beforeIndex = args.indexOf('--before');
    const updatedBeforeSeconds = beforeIndex < 0 ? undefined : Date.parse(args[beforeIndex+1]) / 1000;
    if (beforeIndex >= 0 && (!Number.isInteger(updatedBeforeSeconds) || args.includes('--automatic'))) throw new Error('history-cutoff-invalid');
    if (args.includes('--enable-policy') && (!args.includes('--apply') || args.includes('--automatic'))) throw new Error('history-policy-requires-explicit-apply');
    const apply = args.includes('--apply');
    const automatic = args.includes('--automatic');
    const startedAt = new Date().toISOString();
    const action = () => {
      const status = {version:1,startedAt,automatic,workerSha256:fileDigest(__filename)};
      if (apply) writeStatus(canonicalRoot(root),{...status,state:'running'});
      try {
        const result = maintainHistory(root,{apply,processCheck,explicit:!automatic,openArchived:args.includes('--open-archived'),openIdle:args.includes('--open-idle'),updatedBeforeSeconds,compressArchives:args.includes('--compress-archives'),budgetMs:automatic ? 40000 : undefined});
        if (apply) writeStatus(canonicalRoot(root),{...status,state:'finished',completedAt:new Date().toISOString(),result});
        return result;
      } catch (error) {
        if (apply) writeStatus(canonicalRoot(root),{...status,state:'deferred',completedAt:new Date().toISOString(),reason:'history-maintenance-failed'});
        throw error;
      }
    };
    // Disabled policies must not create a status file, lock or any other data.
    const result = automatic && !readPolicy(canonicalRoot(root)) ? {skipped:'not-enabled'} :
      apply ? withMaintenanceLock(canonicalRoot(root),action) : action();
    if (args.includes('--enable-policy') && !result.skipped) {
      const policyFile = path.join(canonicalRoot(root),POLICY_FILE);
      if (!fs.existsSync(policyFile)) fs.writeFileSync(policyFile,JSON.stringify(POLICY,null,2)+'\n',{flag:'wx',mode:0o600});
      result.policyEnabled = readPolicy(canonicalRoot(root))?.enabled === true;
    }
    return { code: 0, output: JSON.stringify(result)+'\n' };
  } catch (error) {
    return { code: 1, error: String(error?.message || 'history-maintenance-failed').replace(/[\r\n]/g,' ').slice(0,240)+'\n' };
  }
}

if (require.main === module) {
  const result = runCli(process.argv.slice(2));
  if (result.output) process.stdout.write(result.output);
  if (result.error) process.stderr.write(result.error);
  process.exitCode = result.code;
}
