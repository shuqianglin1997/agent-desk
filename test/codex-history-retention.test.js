const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { POLICY, POLICY_FILE, maintainHistory, compactToolItem, runAfterProfileStop, compressArchivedRollouts, LSOF_PROCESS_CHECK } = require('../src/clients/codex/history-retention');
const { ProfileRuntimeSupervisor } = require('../src/profile-runtime');

// Process checks are injected: what else this machine has open (or how slow
// lsof is under a loaded test run) must not decide the result. The real lsof
// check has one opt-in test at the end.
const nobodyHolds = Object.freeze({ holders: () => [], heldAmong: () => new Set(), isIdle: () => true });
function holding(files) {
  const held = new Set(files.map((file) => fs.realpathSync(file)));
  return {
    holders: (list) => (list.some((file) => held.has(file)) ? [2147483646] : []),
    heldAmong: (list) => new Set(list.filter((file) => held.has(file))),
    isIdle: (file) => !held.has(file)
  };
}
// Runs the worker CLI in its own process with an injected check.
function workerCli(args, check) {
  const { spawnSync } = require('node:child_process');
  const source = `const m=require(${JSON.stringify(require.resolve('../src/clients/codex/history-retention'))});
    const check=${check === 'nobody' ? '{holders:()=>[],heldAmong:()=>new Set(),isIdle:()=>true}' : 'undefined'};
    const r=m.runCli(JSON.parse(process.env.AGENTDESK_TEST_ARGS),{processCheck:check});
    if(r.output)process.stdout.write(r.output);if(r.error)process.stderr.write(r.error);process.exitCode=r.code;`;
  return spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', env: { ...process.env, AGENTDESK_TEST_ARGS: JSON.stringify(args) } });
}

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6xKsAAAAASUVORK5CYII=';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdesk-history-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const state=new DatabaseSync(path.join(root,'state_5.sqlite'));
  state.exec('CREATE TABLE threads(id TEXT PRIMARY KEY,archived INTEGER,updated_at INTEGER,history_mode TEXT)');
  state.prepare('INSERT INTO threads VALUES(?,?,?,?)').run('thread',1,1,'paginated');state.close();
  const db=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
  db.exec('CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT); CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,item_type TEXT,item_json TEXT,PRIMARY KEY(thread_id,turn_id,item_id))');
  db.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run('thread','turn','completed');
  const add=(id,obj)=>db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?)').run('thread','turn',id,obj.type,JSON.stringify(obj));
  add('user',{type:'userMessage',id:'user',content:[{type:'text',text:'Keep my exact words: 中文 + punctuation.'}]});
  add('agent',{type:'agentMessage',id:'agent',text:'Final answer and delivery link remain unchanged.'});
  add('image-a',{type:'imageGeneration',id:'image-a',status:'completed',result:png,savedPath:'/missing/original.png'});
  add('image-b',{type:'imageGeneration',id:'image-b',status:'completed',result:png,savedPath:'/missing/second.png'});
  add('command',{type:'commandExecution',id:'command',status:'completed',exitCode:0,command:'old completed search',aggregatedOutput:'first\n'+'line\n'.repeat(20000)+'last'});
  add('failed',{type:'commandExecution',id:'failed',status:'failed',exitCode:1,aggregatedOutput:'important failure '.repeat(10000)});
  add('diff',{type:'fileChange',id:'diff',status:'completed',changes:[{diff:'necessary rollback '.repeat(5000)}]});
  const original=db.prepare('SELECT item_id,item_json FROM thread_items ORDER BY item_id').all();db.close();
  return {root,original};
}

test('explicit cutoff leaves newer conversation items unchanged', {skip:process.platform!=='darwin'}, t=>{
  const {root}=fixture(t);
  const now=Math.floor(Date.now()/1000),cutoff=now-30*86400;
  const state=new DatabaseSync(path.join(root,'state_5.sqlite'));
  state.prepare('INSERT INTO threads VALUES(?,?,?,?)').run('recent',1,now-86400,'paginated');state.close();
  const db=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
  db.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run('recent','turn','completed');
  const original=JSON.stringify({type:'commandExecution',id:'recent-tool',status:'completed',exitCode:0,aggregatedOutput:'new output '.repeat(4000)});
  db.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?)').run('recent','turn','recent-tool','commandExecution',original);db.close();
  const result=maintainHistory(root,{explicit:true,apply:true,updatedBeforeSeconds:cutoff,processCheck:nobodyHolds});
  assert.equal(result.threadsInspected,1);assert.equal(result.updatedBeforeSeconds,cutoff);
  const after=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
  assert.equal(after.prepare('SELECT item_json FROM thread_items WHERE thread_id=?').get('recent').item_json,original);after.close();
  assert.throws(()=>maintainHistory(root,{explicit:true,updatedBeforeSeconds:now}),/history-cutoff-invalid/);
});

test('preview is read-only, then one unique image serves both history items and human text is byte-identical', {skip:process.platform!=='darwin'}, t=>{
  const {root,original}=fixture(t);
  const before=fs.readFileSync(path.join(root,'thread_history_1.sqlite'));
  const preview=maintainHistory(root,{explicit:true,processCheck:nobodyHolds});
  assert.equal(preview.imageItems,2);assert.equal(preview.toolItems,1);
  assert.deepEqual(fs.readFileSync(path.join(root,'thread_history_1.sqlite')),before);
  assert.equal(fs.existsSync(path.join(root,'generated_images')),false);
  const applied=maintainHistory(root,{explicit:true,apply:true,processCheck:nobodyHolds});
  assert.equal(applied.imagesCreated,1);assert.equal(applied.imageItems,2);assert.equal(applied.toolItems,1);
  const db=new DatabaseSync(path.join(root,'thread_history_1.sqlite'),{readOnly:true});
  const rows=db.prepare('SELECT item_id,item_json FROM thread_items ORDER BY item_id').all();db.close();
  for(const id of ['user','agent','failed','diff']) assert.equal(rows.find(r=>r.item_id===id).item_json,original.find(r=>r.item_id===id).item_json);
  const images=rows.filter(r=>r.item_id.startsWith('image')).map(r=>JSON.parse(r.item_json));
  assert.equal(images[0].savedPath,images[1].savedPath);
  assert.equal(images[0].result,'');
  assert.deepEqual(fs.readFileSync(images[0].savedPath),Buffer.from(png,'base64'));
  const again=maintainHistory(root,{explicit:true,apply:true,processCheck:nobodyHolds});
  assert.equal(again.imageItems,0);assert.equal(again.toolItems,0);
});

test('errors, image payloads, resources, structured research and patch evidence remain intact', ()=>{
  for(const content of ['data:image/png;base64,abc'+'x'.repeat(40000),'*** Begin Patch\n'+'x'.repeat(40000),'"image_url":"https://example/image.png"'+'x'.repeat(40000)]){
    const item={type:'mcpToolCall',status:'completed',error:null,result:{content:[{type:'text',text:content},{type:'image',data:'unique'}],structuredContent:{research:'keep me'}}};
    assert.equal(compactToolItem(item,POLICY),false);
    assert.equal(item.result.content[0].text,content);
  }
  const item={type:'mcpToolCall',status:'completed',error:null,result:{content:[{type:'text',text:'x'.repeat(50000)},{type:'image',data:'unique'}],structuredContent:{research:'keep me'}}};
  assert.equal(compactToolItem(item,POLICY),true);
  assert.equal(item.result.content[1].data,'unique');assert.equal(item.result.structuredContent.research,'keep me');
});

test('automatic maintenance requires the exact root policy and leaves unfinished turns intact', {skip:process.platform!=='darwin'}, async t=>{
  const {root}=fixture(t);
  assert.deepEqual(maintainHistory(root),{skipped:'not-enabled'});
  assert.deepEqual(await runAfterProfileStop({appId:'codex',sessionRoot:root}),{skipped:'not-enabled'});
  fs.writeFileSync(path.join(root,POLICY_FILE),JSON.stringify(POLICY));
  const db=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));db.exec("UPDATE thread_turns SET status='inProgress'");db.close();
  const result=maintainHistory(root,{apply:true,processCheck:nobodyHolds});assert.equal(result.imageItems,0);assert.equal(result.toolItems,0);
});

test('symlinked databases are rejected before any maintenance', {skip:process.platform!=='darwin'}, t=>{
  const {root}=fixture(t);const file=path.join(root,'thread_history_1.sqlite');fs.renameSync(file,file+'.original');fs.symlinkSync(file+'.original',file);
  assert.throws(()=>maintainHistory(root,{explicit:true,apply:true,processCheck:nobodyHolds}),/history-db-unsafe/);
});

test('owned natural/explicit exits schedule opt-in maintenance; relaunch waits and unowned stops cannot invoke it', async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdesk-history-lifecycle-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const profile={id:'p',appId:'codex',profilePath:root,sessionRoot:root};
  let calls=0,release;
  const done=new Promise(resolve=>{release=resolve;});
  const runtime=new ProfileRuntimeSupervisor({snapshotProcessRecords:()=>[],maintainHistory:async()=>{calls++;await done;return {ok:true};}});
  runtime.records.set('p',{owned:true,active:true,profilePath:root});
  const stopped=await runtime.stopProfile(profile);
  assert.equal(stopped.ok,true);assert.equal(calls,1);
  let reopened=false;
  const preflight=runtime.preflight(profile).then(()=>{reopened=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(reopened,false);
  release();await preflight;assert.equal(reopened,true);
  await runtime.stopProfile(profile);assert.equal(calls,1);
});


test('filesystem compression keeps original rollout bytes and existing session-list metadata', {skip:process.platform!=='darwin'}, t=>{
  const {root}=fixture(t), area=path.join(root,'archived_sessions');fs.mkdirSync(area);
  const file=path.join(area,'rollout-2026-01-01T00-00-00-12345678-1234-1234-1234-123456789abc.jsonl');
  const meta={timestamp:'2026-01-01T00:00:00Z',type:'session_meta',payload:{id:'12345678-1234-1234-1234-123456789abc',cwd:root}};
  const bytes=JSON.stringify(meta)+'\n'+(JSON.stringify({timestamp:'2026-01-01T00:01:00Z',type:'event_msg',payload:{message:'regenerable verbose successful output'}})+'\n').repeat(2000);
  fs.writeFileSync(file,bytes);fs.utimesSync(file,1,1);
  const {scanCodex}=require('../src/clients/codex/sessions');
  const before=scanCodex({sessionRoot:root}),blocks=fs.statSync(file).blocks;
  const packed=compressArchivedRollouts(root,{budgetMs:5000,processCheck:nobodyHolds});
  assert.equal(packed.compressed,1);assert.ok(fs.statSync(file).blocks<blocks);
  assert.equal(fs.readFileSync(file,'utf8'),bytes);
  assert.deepEqual(scanCodex({sessionRoot:root}),before);
  const again=compressArchivedRollouts(root,{budgetMs:5000,processCheck:nobodyHolds});assert.equal(again.compressed,0);
  assert.deepEqual(fs.readdirSync(area),[path.basename(file)]);
});

test('automatic CLI rechecks opt-in in the worker, including a policy removed before launch', {skip:process.platform!=='darwin'}, t=>{
  const {root}=fixture(t);const {spawnSync}=require('node:child_process');
  const r=spawnSync(process.execPath,[require.resolve('../src/clients/codex/history-retention'),'--root',root,'--apply','--automatic'],{encoding:'utf8'});
  assert.equal(r.status,0);assert.deepEqual(JSON.parse(r.stdout),{skipped:'not-enabled'});
});

test('archive compression uses conversation update time and keeps newer archives untouched', {skip:process.platform!=='darwin'}, t=>{
  const {root}=fixture(t),area=path.join(root,'archived_sessions');fs.mkdirSync(area);
  const state=new DatabaseSync(path.join(root,'state_5.sqlite'));
  state.exec('ALTER TABLE threads ADD COLUMN rollout_path TEXT');
  const now=Math.floor(Date.now()/1000),cutoff=now-30*86400;
  const bytes=(JSON.stringify({type:'event_msg',payload:{message:'preserve every native byte and image reference'}})+'\n').repeat(2000);
  const old=path.join(area,'old.jsonl'),recent=path.join(area,'recent.jsonl');
  for(const file of [old,recent]) {fs.writeFileSync(file,bytes);fs.utimesSync(file,1,1);}
  state.prepare('UPDATE threads SET rollout_path=? WHERE id=?').run(old,'thread');
  state.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run('recent',1,now-86400,'paginated',recent);state.close();
  const recentStat=fs.statSync(recent);
  const result=compressArchivedRollouts(root,{updatedBeforeSeconds:cutoff,budgetMs:5000,processCheck:nobodyHolds});
  assert.equal(result.compressed,1);
  assert.equal(fs.readFileSync(old,'utf8'),bytes);assert.equal(fs.readFileSync(recent,'utf8'),bytes);
  assert.equal(fs.statSync(recent).ino,recentStat.ino);assert.equal(fs.statSync(recent).blocks,recentStat.blocks);
  assert.throws(()=>compressArchivedRollouts(root,{updatedBeforeSeconds:now}),/history-cutoff-invalid/);
});

test('serialized nested MCP output preserves unique media/resources and errors while reducing successful text',()=>{
  const nested={isError:false,content:[{type:'text',text:'old successful output '.repeat(3000)},{type:'image',mimeType:'image/png',data:png},{type:'resource_link',uri:'file:///unique-reference'}]};
  const item={type:'mcpToolCall',status:'completed',result:{content:[{type:'text',text:JSON.stringify(nested)}]}};
  assert.equal(compactToolItem(item,POLICY),true);
  const after=JSON.parse(item.result.content[0].text);
  assert.deepEqual(after.content.slice(1),nested.content.slice(1));
  assert.ok(after.content[0].text.length<2000);
  const failed={type:'commandExecution',status:'completed',exitCode:0,aggregatedOutput:JSON.stringify({...nested,isError:true})};
  assert.equal(compactToolItem(failed,POLICY),false);
});

test('existing supervisor also maintains managed idle archives once per hour, excluding other roots',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdesk-idle-history-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let now=1,calls=[];
  const managed={id:'managed',appId:'codex',profilePath:root,sessionRoot:root};
  const other={...managed,id:'other'};
  const runtime=new ProfileRuntimeSupervisor({now:()=>now,snapshotProcessRecords:()=>[],isManagedProfile:p=>p.id==='managed',maintainHistory:async(p,o)=>{calls.push([p.id,o]);return {ok:true};}});
  runtime.updateProfiles([managed,other]);
  await runtime.tick();await Promise.all([...runtime.historyMaintenance.values()]);
  assert.deepEqual(calls,[['managed',{openArchived:true,openIdle:true}]]);
  await runtime.tick();assert.equal(calls.length,1);
  now+=3600001;await runtime.tick();await Promise.all([...runtime.historyMaintenance.values()]);
  assert.equal(calls.length,2);
});

test('automatic worker publishes a bounded auditable status and recovers a dead worker lock', {skip:process.platform!=='darwin'},t=>{
  const {root}=fixture(t);
  fs.writeFileSync(path.join(root,POLICY_FILE),JSON.stringify(POLICY));
  const lock=path.join(root,'.agentdesk-history-retention.lock');fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:2147483647}));
  const args=['--root',root,'--apply','--automatic'];
  const r=workerCli(args,'nobody');assert.equal(r.status,0,r.stderr);
  const status=JSON.parse(fs.readFileSync(path.join(root,'agentdesk-history-retention-status.json')));
  assert.equal(status.state,'finished');assert.equal(status.result.toolItems,1);
  assert.equal(status.automatic,true);assert.match(status.workerSha256,/^[0-9a-f]{64}$/);
  assert.equal(fs.existsSync(lock),false);
  fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({pid:process.pid}));
  const busy=workerCli(args,'nobody');
  assert.equal(JSON.parse(busy.stdout).skipped,'maintenance-already-running');
});

test('live database handles restrict maintenance to old archived completed turns', {skip:process.platform!=='darwin'},t=>{
  const {root,original}=fixture(t);
  let s=new DatabaseSync(path.join(root,'state_5.sqlite'));s.prepare('INSERT INTO threads VALUES(?,?,?,?)').run('active-thread',0,1,'paginated');s.close();
  let d=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
  d.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run('active-thread','turn','completed');
  d.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?)').run('active-thread','turn','command','commandExecution',original.find(x=>x.item_id==='command').item_json);d.close();
  const clientOpen=holding([path.join(root,'thread_history_1.sqlite')]);
  assert.equal(maintainHistory(root,{explicit:true,apply:true,processCheck:clientOpen}).skipped,'client-still-open');
  const result=maintainHistory(root,{explicit:true,apply:true,openArchived:true,processCheck:clientOpen});
  assert.equal(result.threadsInspected,1);assert.equal(result.toolItems,1);
  assert.equal(result.vacuumed,false);assert.equal(result.vacuumDeferred,true);
  d=new DatabaseSync(path.join(root,'thread_history_1.sqlite'),{readOnly:true});
  assert.equal(d.prepare("SELECT item_json FROM thread_items WHERE thread_id='active-thread' AND item_id='command'").get().item_json,original.find(x=>x.item_id==='command').item_json);d.close();
});

test('unarchived history requires a day idle, completed turns, a recoverable original and no rollout handle', {skip:process.platform!=='darwin'},t=>{
  const {root,original}=fixture(t);
  let s=new DatabaseSync(path.join(root,'state_5.sqlite'));s.exec('ALTER TABLE threads ADD COLUMN rollout_path TEXT');
  let d=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
  for(const id of ['idle','compressed','held','recent','unfinished','missing']){
    const file=path.join(root,id+'.jsonl');if(id==='compressed')fs.writeFileSync(file+'.zst',require('node:zlib').zstdCompressSync(Buffer.from('original recoverable history')));else if(id!=='missing')fs.writeFileSync(file,'original recoverable history');
    s.prepare('INSERT INTO threads VALUES(?,?,?,?,?)').run(id,0,id==='recent'?Math.floor(Date.now()/1000)-7200:1,'paginated',file);
    d.prepare('INSERT INTO thread_turns VALUES(?,?,?)').run(id,'turn',id==='unfinished'?'inProgress':'completed');
    d.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?)').run(id,'turn','command','commandExecution',original.find(x=>x.item_id==='command').item_json);
  }s.close();d.close();
  const clientOpen=holding([path.join(root,'thread_history_1.sqlite'),path.join(root,'held.jsonl')]);
  const result=maintainHistory(root,{explicit:true,apply:true,openIdle:true,processCheck:clientOpen});
  assert.equal(result.idleUnarchivedInspected,2);assert.equal(result.toolItems,3);
  d=new DatabaseSync(path.join(root,'thread_history_1.sqlite'),{readOnly:true});
  for(const id of ['held','recent','unfinished','missing'])assert.equal(d.prepare('SELECT item_json FROM thread_items WHERE thread_id=?').get(id).item_json,original.find(x=>x.item_id==='command').item_json);
  assert.ok(JSON.parse(d.prepare("SELECT item_json FROM thread_items WHERE thread_id='idle'").get().item_json).aggregatedOutput.length<2000);d.close();
});

for(const parentStatus of ['interrupted','failed'])test(`terminal ${parentStatus} turns retain failed items while reducing successful tools and duplicate image bytes`,{skip:process.platform!=='darwin'},t=>{
  const {root,original}=fixture(t);let d=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));d.prepare('UPDATE thread_turns SET status=?').run(parentStatus);d.close();
  const result=maintainHistory(root,{explicit:true,apply:true,processCheck:nobodyHolds});assert.equal(result.imageItems,2);assert.equal(result.toolItems,1);
  d=new DatabaseSync(path.join(root,'thread_history_1.sqlite'),{readOnly:true});
  for(const id of ['user','agent','failed','diff'])assert.equal(d.prepare('SELECT item_json FROM thread_items WHERE item_id=?').get(id).item_json,original.find(r=>r.item_id===id).item_json);d.close();
});

// The real lsof check, opt-in: on a busy machine lsof can exceed its own
// timeout, which is what made this file fail intermittently before the check
// was injected. Run with AGENTDESK_LSOF_INTEGRATION=1.
const lsofIntegration = process.platform !== 'darwin' ? 'macOS only'
  : process.env.AGENTDESK_LSOF_INTEGRATION !== '1' ? 'opt-in: set AGENTDESK_LSOF_INTEGRATION=1' : false;
test('the default process check finds another process holding a file', {skip:lsofIntegration}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agentdesk-history-lsof-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const file=fs.realpathSync(root)+'/held.sqlite';fs.writeFileSync(file,'x');
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['-e',`require('fs').openSync(process.argv[1],'r');console.log('ready');setInterval(()=>{},1000);`,file],{stdio:['ignore','pipe','ignore']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  assert.ok(LSOF_PROCESS_CHECK.holders([file]).includes(child.pid));
  assert.deepEqual([...LSOF_PROCESS_CHECK.heldAmong([file])],[file]);
});
