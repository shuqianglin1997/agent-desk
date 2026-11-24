const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const art = require('../src/yard/cat-art');
const cats = require('../src/yard/cats');
const player = require('../src/pixel/cats');

// 所有者批准的图鉴原件（逐字节相同的一份），和旧版本的 yard/cats.js（模拟只认八种毛色的旧设备）
function loadSource(file) {
  const module = { exports: {} };
  vm.runInThisContext(`(function (module, exports, self) {\n${read(file)}\n})`, { filename: file })(module, module.exports, undefined);
  return module.exports;
}
const approved = loadSource('test/fixtures/cats2-approved.source');
const legacy = loadSource('test/fixtures/cats-v1.source');

const ACTION_NAMES = Object.keys(art.ACTIONS);
// 批准的图鉴里有的动作逐格钉住；之后加的“忙”“抓狂”（docs/SESSION_MARKS_PLAN.md 第 3.2 节）用到新的小块，另外单独钉。
const APPROVED_ACTIONS = Object.keys(approved.ACTIONS);
const NEW_ACTIONS = ACTION_NAMES.filter((name) => !APPROVED_ACTIONS.includes(name));
const LOOK_NAMES = Object.keys(art.LOOKS);
const ACCESSORY_NAMES = Object.keys(art.ACCESSORIES);

function recorder() {
  const fills = [];
  return {
    fills,
    ctx: {
      set fillStyle(value) { this._fill = value; },
      get fillStyle() { return this._fill; },
      fillRect(x, y, w, h) { fills.push({ x, y, w, h, colour: this._fill }); }
    }
  };
}

test('批准的原件仍是那一份：图鉴文件的摘要没有变', () => {
  const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'test/fixtures/cats2-approved.source'))).digest('hex');
  assert.equal(digest, '0ad19f0039f7f25386ec2a25e0401a15baa351d2641f7edb83667c555262afbc');
  assert.deepEqual(art.check(), []);
  assert.equal(art.W, 20);
  assert.equal(art.H, 18);
});

test('每个动作的每一帧都是 20×18（多留两行时是 20×20），只用认得的字符', () => {
  for (const name of ACTION_NAMES) {
    art.ACTIONS[name].frames.forEach((spec, index) => {
      for (const accessory of ACCESSORY_NAMES) {
        for (const headroom of [0, 2]) {
          const grid = art.frame(spec, { accessory }, { headroom });
          assert.equal(grid.length, 18 + headroom, `${name}#${index} ${accessory} headroom ${headroom}`);
          for (const row of grid) {
            assert.equal(row.length, 20, `${name}#${index} ${accessory}`);
            for (const ch of row) {
              if (ch === '.') continue;
              assert.ok(art.colour(ch, art.LOOKS.orange), `${name}#${index} ${accessory}: unknown character ${ch}`);
            }
          }
        }
      }
    });
  }
});

test('每种毛色、每件配饰在每个姿势和每一帧上都画得出来，每一格都有颜色', () => {
  const hex = /^#[0-9a-f]{6}$/i;
  for (const lookName of LOOK_NAMES) {
    const look = art.LOOKS[lookName];
    for (const accessory of ACCESSORY_NAMES) {
      for (const pose of Object.keys(art.POSES)) {
        const grid = art.frame({ pose, tail: art.POSES[pose].tail ? 1 : undefined }, { accessory }, { headroom: 2 });
        const { fills, ctx } = recorder();
        art.draw(ctx, grid, look, { scale: 4 });
        const cells = grid.join('').replace(/\./g, '').length;
        assert.equal(fills.length, cells, `${lookName}/${accessory}/${pose}`);
        assert.ok(fills.every((fill) => hex.test(fill.colour)), `${lookName}/${accessory}/${pose}`);
      }
      for (const name of ACTION_NAMES) {
        for (const spec of art.ACTIONS[name].frames) {
          const grid = art.frame(spec, { accessory }, { headroom: 2 });
          const { fills, ctx } = recorder();
          art.draw(ctx, grid, look, { scale: 1, collar: '#123456' });
          assert.equal(fills.length, grid.join('').replace(/\./g, '').length, `${lookName}/${accessory}/${name}`);
        }
      }
    }
  }
});

test('同一个头：坐、蹲、起跳、揣手、走路的头几行逐格相同；睡和摊饼的耳朵也一样', () => {
  const head = (pose) => art.POSES[pose].rows.slice(art.POSES[pose].head, art.POSES[pose].head + 9);
  const reference = head('sit');
  for (const pose of ['crouch', 'leap', 'loaf', 'walkA', 'walkB']) assert.deepEqual(head(pose), reference, pose);
  assert.deepEqual(art.POSES.sleep.rows.slice(art.POSES.sleep.head, art.POSES.sleep.head + 4), reference.slice(0, 4));
  assert.deepEqual(art.POSES.flat.rows.slice(art.POSES.flat.head, art.POSES.flat.head + 2), reference.slice(0, 2));
});

test('不多留行时，每一帧和批准的原件逐格相同；多留两行只补回被切掉的帽子', () => {
  assert.deepEqual(NEW_ACTIONS, ['busy', 'frantic'], 'only the two session-marks actions were added');
  for (const name of APPROVED_ACTIONS) {
    art.ACTIONS[name].frames.forEach((spec, index) => {
      for (const accessory of ACCESSORY_NAMES) {
        const original = approved.frame(spec, { accessory });
        assert.deepEqual(art.frame(spec, { accessory }), original, `${name}#${index} ${accessory}`);
        const roomy = art.frame(spec, { accessory }, { headroom: 2 }).slice(2);
        const hat = new Set((approved.ACCESSORIES[accessory].rows || []).join('').replace(/ /g, ''));
        roomy.forEach((row, y) => [...row].forEach((ch, x) => {
          if (ch === original[y][x]) return;
          assert.equal(original[y][x], '.', `${name}#${index} ${accessory} (${x},${y}) changed a drawn cell`);
          assert.ok(hat.has(ch), `${name}#${index} ${accessory} (${x},${y}) added ${ch}`);
        }));
      }
    });
  }
});

test('两行就够：跳到最高、赶来时草帽、贝雷帽、斗笠一格都不被切掉', () => {
  let restored = 0;
  for (const name of ACTION_NAMES) {
    for (const spec of art.ACTIONS[name].frames) {
      for (const accessory of ['straw', 'beret', 'bamboo', 'phones', 'flower']) {
        const wide = art.frame(spec, { accessory }, { headroom: 10 });
        assert.deepEqual(wide.slice(0, 8).join(''), '.'.repeat(160), `${name} ${accessory} needs more than 2 rows`);
        assert.deepEqual(wide.slice(8), art.frame(spec, { accessory }, { headroom: 2 }));
        if (APPROVED_ACTIONS.includes(name) && art.frame(spec, { accessory }, { headroom: 2 }).slice(2).join('') !== approved.frame(spec, { accessory }).join('')) restored += 1;
      }
    }
  }
  assert.ok(restored > 0, 'the approved 20×18 grid really did clip hats in some frames');
});

test('家猫和有来历的毛色与批准的原件相同；跟着客户端的只留品牌规定允许的几种，色值是核对过的官方值', () => {
  for (const [name, look] of Object.entries(approved.LOOKS)) {
    if (look.group === '跟着客户端') continue;
    assert.deepEqual(art.LOOKS[name], look, name);
  }
  const client = LOOK_NAMES.filter((name) => art.LOOKS[name].group === '跟着客户端');
  assert.deepEqual(client, ['codex', 'cursor', 'qwen', 'copilot', 'opencode']);
  for (const dropped of ['claude', 'deepseek', 'kimi', 'gemini']) assert.equal(art.LOOKS[dropped], undefined, dropped);
  assert.equal(art.LOOKS.codex.collar, '#181818');
  assert.equal(art.LOOKS.codex.o, '#0d0d0d');
  assert.equal(art.LOOKS.cursor.f, '#26251e');
  assert.equal(art.LOOKS.cursor.collar, '#f54e00');
  assert.equal(art.LOOKS.qwen.f, '#082dff');
  assert.equal(art.LOOKS.copilot.collar, '#0fbf3e');
  assert.equal(art.LOOKS.opencode.o, '#1f1f1f');
  assert.equal(LOOK_NAMES.length, 24);
  assert.equal(ACCESSORY_NAMES.length, 12);
  // 文档里记了每一种的来源
  const product = read('docs/PRODUCT.md');
  for (const name of client) assert.match(product, new RegExp(`\\| ${art.LOOKS[name].label} \\|`), name);
});

test('旧的八种毛色和五种配饰原样认得；hat 就是草帽', () => {
  for (const breed of cats.BREED_KEYS) {
    assert.equal(cats.resolveCat({ breed, collar: '#2f9e8f', accessory: 'none' }, 'x').look, breed);
  }
  for (const accessory of ['none', 'scarf', 'glasses', 'bow']) {
    assert.equal(cats.resolveCat({ breed: 'cow', collar: '#2f9e8f', accessory }, 'x').accessory, accessory);
  }
  assert.equal(cats.resolveCat({ breed: 'cow', collar: '#2f9e8f', accessory: 'hat' }, 'x').accessory, 'straw');
  assert.deepEqual(cats.ACCESSORIES, ['none', 'scarf', 'glasses', 'bow', 'hat']);
  assert.deepEqual(cats.BREED_KEYS, ['orange', 'calico', 'cow', 'black', 'white', 'tabby', 'blue', 'siamese']);
});

test('已有的猫外观不变：确定性默认与旧版逐个相同', () => {
  for (let index = 0; index < 200; index += 1) {
    const seed = `profile-${index}-${index * 7919}`;
    assert.deepEqual(cats.defaultCatFor(seed), legacy.defaultCatFor(seed), seed);
    assert.deepEqual(cats.normalizeCat(null, seed), legacy.normalizeCat(null, seed), seed);
  }
  const stored = { breed: 'calico', collar: '#3d6aa8', accessory: 'hat', note: 'future field' };
  assert.deepEqual(cats.normalizeCat(stored, 'a'), legacy.normalizeCat(stored, 'a'));
});

test('存下来的形状旧设备认得：breed、accessory 永远是旧值，新的放在 coat、wear；三项来回不丢', () => {
  for (const look of cats.LOOK_KEYS) {
    for (const accessory of cats.ACCESSORY_KEYS) {
      const stored = cats.storeCat({ look, accessory, collar: '#8a6bb8' });
      assert.ok(cats.BREED_KEYS.includes(stored.breed), `${look} breed`);
      assert.ok(cats.ACCESSORIES.includes(stored.accessory), `${accessory} accessory`);
      assert.deepEqual(cats.resolveCat(stored, 'x'), { look, accessory, collar: '#8a6bb8' });
      // 旧设备的归一化：认得 breed/accessory/collar，保留 coat/wear；再回到新版仍是同一只
      const throughOld = legacy.normalizeCat(stored, 'x');
      assert.equal(throughOld.breed, stored.breed);
      assert.equal(throughOld.accessory, stored.accessory);
      assert.deepEqual(cats.resolveCat(throughOld, 'x'), { look, accessory, collar: '#8a6bb8' });
    }
  }
  assert.deepEqual(cats.storeCat({ look: 'qinghua', accessory: 'bamboo', collar: '#2f5fc4' }), {
    breed: 'white', coat: 'qinghua', accessory: 'hat', wear: 'bamboo', collar: '#2f5fc4'
  });
  assert.deepEqual(cats.storeCat({ look: 'cow', accessory: 'straw', collar: '#2f9e8f' }), { breed: 'cow', accessory: 'hat', collar: '#2f9e8f' });
});

test('旧设备上有人换了毛色或配饰，新版就听它的；新 id 直接写进 breed 也能读', () => {
  const stored = cats.storeCat({ look: 'qinghua', accessory: 'beret', collar: '#2f5fc4' });
  const editedOnOld = { ...legacy.normalizeCat(stored, 'x'), breed: 'cow', accessory: 'scarf' };
  assert.deepEqual(cats.resolveCat(editedOnOld, 'x'), { look: 'cow', accessory: 'scarf', collar: '#2f5fc4' });
  const normalized = cats.normalizeCat(editedOnOld, 'x');
  assert.equal(normalized.coat, undefined);
  assert.equal(normalized.wear, undefined);
  assert.deepEqual(cats.normalizeCat({ breed: 'tiger', accessory: 'tie', collar: '#d0483a' }, 'x'), {
    breed: 'orange', coat: 'tiger', accessory: 'scarf', wear: 'tie', collar: '#d0483a'
  });
  // 本机账号的保存是合并写：编辑器把不再需要的 coat / wear 显式清成 null，归一化后不留
  assert.deepEqual(cats.normalizeCat({ breed: 'white', coat: null, accessory: 'hat', wear: null, collar: '#123456' }, 'x'), {
    breed: 'white', accessory: 'hat', collar: '#123456'
  });
  // 拿掉的客户端毛色（从没发布过）也只会回到 breed
  assert.equal(cats.resolveCat({ breed: 'orange', coat: 'claude', collar: '#123456', accessory: 'none' }, 'x').look, 'orange');
});

test('Mesh 目录事件：新外观原样通过签名事件与快照的字段校验，形状没有变', () => {
  const { normalizeAgent } = require('../src/mesh/protocol/catalog');
  const { catalogEventPayload, CATALOG_EVENT_SCHEMA_VERSION, OBJECT_FIELDS } = require('../src/mesh/protocol/catalog-events');
  assert.deepEqual([...OBJECT_FIELDS.agent], ['agentId', 'displayName', 'catAppearance', 'group', 'note', 'lifecycleState', 'createdAt', 'updatedAt']);
  const catAppearance = cats.storeCat({ look: 'panda', accessory: 'phones', collar: '#6ba84f' });
  const agent = {
    agentId: 'agent-1', displayName: 'Peter', catAppearance, group: '', note: '', lifecycleState: 'active',
    createdAt: '2026-11-24T00:00:00.000Z', updatedAt: '2026-11-24T00:00:00.000Z'
  };
  assert.deepEqual(normalizeAgent(agent).catAppearance, catAppearance);
  const payload = catalogEventPayload({
    schemaVersion: CATALOG_EVENT_SCHEMA_VERSION,
    eventId: 'event-1',
    meshId: 'mesh-1',
    sourceDeviceId: 'device-1',
    sourceSequence: 1,
    lamport: 1,
    causalParents: [],
    baseRevision: 0,
    eventType: 'agent.update',
    transactionKind: 'ordinary',
    operations: [{ objectType: 'agent', objectId: 'agent-1', action: 'upsert', changedFields: ['catAppearance'], value: agent }],
    createdAt: '2026-11-24T00:00:00.000Z',
    signerCertificateDigest: 'digest'
  });
  assert.deepEqual(payload.operations[0].value.catAppearance, catAppearance);
  // 旧设备收到这条事件后看到的是最接近的旧猫，而不是随便一只
  const old = legacy.normalizeCat(payload.operations[0].value.catAppearance, 'agent-1');
  assert.equal(old.breed, 'cow');
  assert.equal(old.accessory, 'none');
  assert.equal(old.collar, '#6ba84f');
});

test('新招募的猫默认穿它客户端的毛色；没有对应毛色的客户端仍用确定性默认', () => {
  const apps = require('../src/apps');
  const coats = Object.fromEntries(apps.appIds().filter((appId) => apps.getApp(appId).catCoat).map((appId) => [appId, apps.getApp(appId).catCoat]));
  assert.deepEqual(coats, { codex: 'codex', 'qwen-code': 'qwen', opencode: 'opencode', cursor: 'cursor' });
  for (const [appId, look] of Object.entries(coats)) {
    assert.equal(cats.lookGroup(look), 'client');
    const cat = cats.defaultCatForLook(look, 'seed');
    assert.equal(cats.resolveCat(cat, 'seed').look, look);
    assert.equal(cat.collar, art.LOOKS[look].collar, appId);
  }
  for (const appId of ['claude', 'claude-cli', 'kimi', 'kimi-work', 'dsh-cli', 'gemini-cli']) {
    assert.deepEqual(cats.defaultCatForLook(apps.getApp(appId).catCoat, 'seed'), cats.defaultCatFor('seed'), appId);
  }
  const main = require('./helpers/main-handler-source').mainHandlerSource();
  assert.match(main, /isProtected: isDefault,[\s\S]{0,120}cat: (?:main\.)?defaultCatForClient\(appId, id\)/);
});

test('演哪个动作：迷糊、干活、赶来先演；其次额度红格摊成饼、黄格累了；最后是平静的作息', () => {
  const table = [
    ['confused', 'exhausted', 'confused'],
    ['working', 'exhausted', 'working'],
    ['arriving', 'tired', 'arriving'],
    ['onduty', 'exhausted', 'spent'],
    ['play', 'tired', 'tired'],
    ['rest', 'tired', 'tired'],
    ['nap', 'exhausted', 'spent'],
    ['hibernate', 'fresh', 'hibernate'],
    ['play', 'steady', 'play'],
    ['rest', 'unknown', 'rest'],
    ['nap', null, 'nap'],
    [null, null, 'onduty'],
    [null, 'tired', 'tired'],
    ['onduty', undefined, 'onduty']
  ];
  for (const [activity, energy, expected] of table) assert.equal(cats.actionFor(activity, energy), expected, `${activity}/${energy}`);
  for (const name of cats.STATE_ACTIONS) assert.equal(art.ACTIONS[name].loop, true, name);
  for (const name of cats.ONE_SHOT_ACTIONS) assert.ok(art.ACTIONS[name] && !art.ACTIONS[name].loop, name);
  assert.equal(cats.STATE_ACTIONS.length + cats.ONE_SHOT_ACTIONS.length, ACTION_NAMES.length);
});

function harness(options = {}) {
  let now = 0;
  const timers = [];
  const painted = [];
  const visible = new Set();
  const instance = player.createPlayer({
    now: () => now,
    reduced: () => Boolean(options.reduced),
    visible: (target) => !options.hidden || visible.has(target),
    paint: (target, grid) => painted.push({ target, rows: grid.length }),
    later: (fn, ms) => timers.push({ at: now + ms, fn })
  });
  const advance = (ms) => {
    now += ms;
    for (const timer of timers.splice(0)) {
      if (timer.at <= now) timer.fn(); else timers.push(timer);
    }
    return instance.tick();
  };
  return { instance, painted, advance, visible, at: () => now };
}

test('放映：每只猫按它动作的帧率走，帧号变了才重画', () => {
  const { instance, painted, advance } = harness();
  const cat = {};
  instance.set(cat, { look: 'orange', accessory: 'none', action: 'working', seed: 'a' });
  const first = painted.length;
  assert.equal(first, 1);
  const fps = art.ACTIONS.working.fps;
  const startIndex = instance.stateOf(cat).index;
  assert.equal(advance(1), 0, 'no repaint inside the same frame');
  advance(1000 / fps);
  assert.equal(instance.stateOf(cat).index, (startIndex + 1) % art.ACTIONS.working.frames.length);
  assert.equal(painted.length, first + 1);
  // 轮询刷新传来同样的东西不重画、不打断
  instance.set(cat, { look: 'orange', accessory: 'none', action: 'working', seed: 'a' });
  assert.equal(painted.length, first + 1);
  assert.ok(instance.nextChange() <= 1000 / fps);
});

test('放映：一次性的动作播完回到当前状态；中途状态变了，播完回到新状态', async () => {
  const { instance, advance } = harness();
  const cat = {};
  instance.set(cat, { cat: { breed: 'cow', collar: '#2f9e8f', accessory: 'none' }, seed: 'b', state: 'play' });
  const done = instance.play(cat, 'hop');
  assert.equal(instance.stateOf(cat).action, 'hop');
  instance.set(cat, { cat: { breed: 'cow', collar: '#2f9e8f', accessory: 'none' }, seed: 'b', state: 'working' });
  assert.equal(instance.stateOf(cat).action, 'hop', 'state changes do not cut a one-shot');
  advance(player.durationOf('hop') + 1);
  assert.equal(await done, true);
  assert.equal(instance.stateOf(cat).action, 'working');
  // 新动作打断旧动作：旧的 Promise 以 false 结束
  const first = instance.play(cat, 'pet');
  const second = instance.play(cat, 'zap');
  assert.equal(await first, false);
  advance(player.durationOf('zap') + 1);
  assert.equal(await second, true);
  assert.equal(await instance.play({}, 'hop'), false, 'an unknown canvas resolves false');
  assert.equal(await instance.play(cat, 'onduty'), false, 'loops are not one-shots');
});

test('放映：hold 停在最后一帧直到放开；关灯睡下、开灯醒来就是这么用的', async () => {
  const { instance, advance } = harness();
  const cat = {};
  instance.set(cat, { look: 'tabby', state: 'onduty', seed: 'c' });
  const asleep = instance.play(cat, 'settle', { hold: true });
  advance(player.durationOf('settle') + 50);
  assert.equal(await asleep, true);
  advance(5000);
  const held = instance.stateOf(cat);
  assert.equal(held.action, 'settle');
  assert.equal(held.index, art.ACTIONS.settle.frames.length - 1);
  assert.equal(instance.nextChange(), Infinity, 'a held cat does not keep the clock running');
  assert.equal(instance.release(cat), true);
  assert.equal(instance.stateOf(cat).action, 'onduty');
});

test('放映：自己的状态从醒着到睡着先睡下，从睡着到醒着先醒来', () => {
  const { instance } = harness();
  const cat = {};
  instance.set(cat, { look: 'white', state: 'play', seed: 'd' });
  instance.set(cat, { look: 'white', state: 'nap', seed: 'd' });
  assert.equal(instance.stateOf(cat).shot, 'settle');
  const other = {};
  instance.set(other, { look: 'white', state: 'hibernate', seed: 'e' });
  assert.equal(instance.stateOf(other).shot, null, 'the first state is shown directly');
  instance.set(other, { look: 'white', state: 'working', seed: 'e' });
  assert.equal(instance.stateOf(other).shot, 'wake');
});

test('放映：减少动态效果时只画当前状态的第一帧，钟不走，一次性的动作直接结束', async () => {
  const { instance, painted, advance } = harness({ reduced: true });
  const cat = {};
  instance.set(cat, { look: 'orange', action: 'working', seed: 'f' });
  assert.equal(instance.stateOf(cat).index, 0);
  advance(5000);
  assert.equal(instance.stateOf(cat).index, 0);
  assert.equal(painted.length, 1);
  assert.equal(instance.nextChange(), Infinity);
  assert.equal(await instance.play(cat, 'cheer'), true);
  assert.equal(instance.stateOf(cat).action, 'working');
  instance.play(cat, 'settle', { hold: true });
  assert.equal(instance.stateOf(cat).index, art.ACTIONS.settle.frames.length - 1, 'a held pose still shows');
});

test('放映：看不见的猫不往前走', () => {
  const { instance, painted, advance, visible } = harness({ hidden: true });
  const shown = {};
  const hidden = {};
  instance.set(shown, { look: 'orange', action: 'working', seed: 'g' });
  instance.set(hidden, { look: 'orange', action: 'working', seed: 'h' });
  visible.add(shown);
  painted.length = 0;
  advance(1000);
  assert.ok(painted.length >= 1);
  assert.ok(painted.every((item) => item.target === shown));
});

test('接线：脚本顺序、画布尺寸、旧的拉伸旋转都已拿掉', () => {
  const html = read('src/index.html');
  const order = ['./yard/cat-art.js', './yard/cats.js', './pixel/cats.js', './pixel/ui.js', './renderer.js'];
  const positions = order.map((file) => html.indexOf(`src="${file}"`));
  assert.ok(positions.every((value) => value > 0), positions.join(','));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
  assert.ok(html.indexOf('./cats.css') > html.indexOf('./pixel.css'));
  assert.equal((html.match(/class="account-card-avatar" width="80" height="80"/g) || []).length, 2);
  assert.match(html, /id="statusMascot" class="status-mascot" width="20" height="18"/);
  assert.match(html, /id="editCatCanvas" width="120" height="120"/);
  const css = read('src/pixel.css');
  for (const name of ['fx-breathe', 'fx-hop', 'fx-run', 'fx-rise-up', 'fx-sink']) assert.doesNotMatch(css, new RegExp(name), name);
  assert.doesNotMatch(css, /\.account-card-cat\.fx-/);
  const ui = read('src/pixel/ui.js');
  assert.doesNotMatch(ui, /Fx\.act\(|drawSpec\(|setInterval\(tick/);
  assert.match(ui, /root\.PixelUi = \{[\s\S]*catAct, catRelease, mascot/);
  const renderer = read('src/renderer.js');
  assert.match(renderer, /energy: quotaTrack\.dataset\.trusted === 'true' \? quotaTrack\.dataset\.level : null/);
  assert.doesNotMatch(renderer, /YardSprites\.drawCat|S\.drawCat/);
});

test('编辑器只有三项：毛色分三组、项圈、一件配饰，三种语言都有名字', () => {
  const html = read('src/index.html');
  for (const id of ['editBreedSwatches', 'editCollarSwatches', 'editAccSwatches']) assert.match(html, new RegExp(`id="${id}" role="radiogroup"`));
  for (const lang of ['zh', 'en', 'ja']) {
    const text = read(`src/i18n/${lang}.js`);
    for (const look of cats.LOOK_KEYS) assert.match(text, new RegExp(`'cat\\.breed\\.${look}':`), `${lang} ${look}`);
    for (const accessory of cats.ACCESSORY_KEYS) assert.match(text, new RegExp(`'cat\\.acc\\.${accessory}':`), `${lang} ${accessory}`);
    for (const group of cats.LOOK_GROUPS) assert.match(text, new RegExp(`'cat\\.group\\.${group}':`), `${lang} ${group}`);
    for (const collar of cats.COLLAR_CHOICES) assert.ok(text.includes(`'cat.collar.${collar}':`), `${lang} ${collar}`);
    assert.ok(text.includes("'cat.collar.own':"), lang);
  }
});

test('忙与抓狂：干活的加深，排在干活那一档；1 条干活、2–3 条忙、4 条以上抓狂', () => {
  assert.equal(cats.BUSY_AT, 2);
  assert.equal(cats.FRANTIC_AT, 4);
  for (const [count, expected] of [[null, null], [undefined, null], [0, null], [1, 'working'], [2, 'busy'], [3, 'busy'], [4, 'frantic'], [9, 'frantic']]) {
    assert.equal(cats.busyAction(count), expected, String(count));
  }
  assert.equal(cats.actionFor('busy', 'exhausted'), 'busy', 'busy is urgent like working');
  assert.equal(cats.actionFor('frantic', 'tired'), 'frantic');
  for (const name of ['busy', 'frantic']) {
    assert.equal(art.ACTIONS[name].loop, true, name);
    for (const spec of art.ACTIONS[name].frames) assert.equal(spec.pose, 'sit', `${name} is drawn on the approved sitting cat`);
  }
});

test('忙：干活加快，左边一摞纸（一条一张，最多 3 张），大约三秒一滴汗', () => {
  const busy = art.ACTIONS.busy;
  assert.ok(busy.fps > art.ACTIONS.working.fps);
  assert.equal(busy.frames.length / busy.fps > 2.9 && busy.frames.length / busy.fps < 3.4, true);
  assert.equal(busy.frames.filter((spec) => spec.props.some(([name]) => name === 'sweat')).length, 3);
  assert.ok(busy.frames.every((spec) => spec.props.some(([name]) => name === 'laptop')));
  const sheets = (grid) => grid.filter((row) => /^.?WWW/.test(row) && row.indexOf('WWW') <= 1).length;
  for (const papers of [0, 2, 3, 5]) {
    assert.equal(sheets(art.frame(busy.frames[0], { accessory: 'none' }, { headroom: 2, papers })), Math.min(papers, 3), `papers ${papers}`);
  }
  assert.deepEqual(art.frame(busy.frames[0], { accessory: 'none' }), art.frame(busy.frames[0], { accessory: 'none' }, { papers: 0 }), 'no paper unless asked');
});

test('抓狂：爪子轮流砸键盘，眼睛瞪圆，在 2px 格子上抖，纸摞高而歪，先两个叹号后一团汽', () => {
  const frantic = art.ACTIONS.frantic;
  assert.equal(frantic.frames.length, 12);
  frantic.frames.forEach((spec, index) => {
    assert.equal(spec.eyes, 'wide');
    const paws = spec.props.filter(([name]) => name === 'paw').map(([, x, y]) => [x, y]);
    assert.deepEqual(paws, index % 2 === 0 ? [[6, 12], [12, 10]] : [[6, 10], [12, 12]], `paws ${index}`);
    assert.ok(spec.nudge.every((step) => Number.isInteger(step) && Math.abs(step) <= 1), 'shake by at most half a cell (2px on a card)');
    const head = spec.props.filter(([name]) => ['bang', 'puff', 'steam'].includes(name)).map(([name]) => name);
    assert.deepEqual([...new Set(head)], index < 6 ? ['bang'] : [index < 8 ? 'puff' : 'steam']);
  });
  const tall = art.frame(frantic.frames[1], { accessory: 'none' }, { headroom: 2, papers: 12 });
  assert.equal(tall.filter((row) => row.includes('WWW')).length >= 7, true, 'up to seven sheets');
  assert.ok(tall.slice(0, 12).some((row) => row.startsWith('.WWW') || row.startsWith('..WWW')), 'the top of the stack leans');
  for (const accessory of ACCESSORY_NAMES) {
    for (const spec of frantic.frames) {
      const wide = art.frame(spec, { accessory }, { headroom: 10, papers: 7 });
      assert.equal(wide.slice(0, 8).join(''), '.'.repeat(160), `two rows of headroom are enough (${accessory})`);
    }
  }
});

test('放映：纸摞的张数跟着在跑的条数；抖动交给画的那一步，格子本身不变', () => {
  const calls = [];
  const instance = player.createPlayer({
    now: () => 0,
    paint: (target, grid, look, scale, headroom, nudge) => calls.push({ grid, nudge }),
    later: () => {}
  });
  instance.set('cat', { look: 'orange', state: 'frantic', papers: 5 });
  assert.equal(instance.stateOf('cat').action, 'frantic');
  assert.equal(instance.stateOf('cat').papers, 5);
  assert.deepEqual(calls.at(-1).nudge, art.ACTIONS.frantic.frames[instance.stateOf('cat').index].nudge);
  assert.equal(calls.at(-1).grid.filter((row) => row.includes('WWW')).length >= 5, true);
  instance.set('cat', { look: 'orange', state: 'frantic', papers: 6 });
  assert.equal(calls.length, 2, 'one more sheet repaints');
  instance.set('cat', { look: 'orange', state: 'onduty', papers: 6 });
  assert.equal(calls.at(-1).grid.some((row) => row.startsWith('WWW')), false, 'no paper when it is not busy');
  assert.equal(calls.at(-1).nudge, null);
});
