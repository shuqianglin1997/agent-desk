'use strict';

// 音效：老掌机声音芯片的 22 张寄存器表（pixel/chip.js）和播放规则（pixel/sfx.js）。
// 这些测试只能证明做法和数值；好不好听只能由所有者在真实应用里听。

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const Chip = require('../src/pixel/chip.js');
const Sfx = require('../src/pixel/sfx.js');
const { normalizeSettings, DEFAULT_SETTINGS } = require('../src/settings.js');
const { rendererSource } = require('./helpers/renderer-source');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const RATES = [44100, 48000];
const variantsOf = (name) => (name === 'mew' ? [0, 1, 2, 3, 4] : [0]);
const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);

// 所有者在试听台上听过并批准的“哪里响、响什么”（page.template.html 的 MAP）：声音名与档位。
const APPROVED_MAP = [
  ['select', 'all'], ['mew', 'all'], ['zap', 'all'], ['launch', 'key'], ['ready', 'key'], ['wait', 'key'],
  ['error', 'key'], ['tired', 'all'], ['bye', 'all'], ['check', 'all'], ['uncheck', 'all'], ['stamp', 'key'],
  ['send', 'key'], ['open', 'all'], ['close', 'all'], ['tick', 'all'], ['lampOn', 'all'], ['lampOff', 'all'],
  ['text', 'all'], ['arrive', 'key'], ['watch', 'key'], ['hello', 'all']
];

/* ── 假的音频环境：记录创建了几个 AudioContext、播了哪些缓冲 ── */
function harness(options = {}) {
  let clock = 1000;
  let serial = 0;
  let timers = [];
  const contexts = [];
  let focused = options.focused !== false;
  class FakeContext {
    constructor() {
      if (options.throws) throw new Error('no audio device');
      this.sampleRate = 48000;
      this.state = 'running';
      this.destination = {};
      this.sources = [];
      this.master = null;
      contexts.push(this);
    }
    createGain() {
      this.master = { gain: { value: 1 }, connect() {} };
      return this.master;
    }
    createBuffer(channels, length, rate) {
      const data = new Float32Array(length);
      return { length, sampleRate: rate, numberOfChannels: channels, data, copyToChannel(source) { data.set(source); }, getChannelData() { return data; } };
    }
    createBufferSource() {
      const source = { buffer: null, started: 0, stopped: 0, onended: null, connect() {}, start() { this.started += 1; }, stop() { this.stopped += 1; } };
      this.sources.push(source);
      return source;
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
    suspend() { this.state = 'suspended'; return Promise.resolve(); }
  }
  const player = Sfx.create({
    chip: Chip,
    now: () => clock,
    hasFocus: () => focused,
    audioClass: () => (options.noAudio ? null : FakeContext),
    setTimeout: (fn, ms) => { serial += 1; timers.push({ id: serial, at: clock + ms, fn }); return serial; },
    clearTimeout: (id) => { timers = timers.filter((timer) => timer.id !== id); }
  });
  const advance = (ms) => {
    const target = clock + ms;
    for (;;) {
      const due = timers.filter((timer) => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers = timers.filter((timer) => timer !== due);
      clock = due.at;
      due.fn();
    }
    clock = target;
  };
  const played = () => player.history().filter((entry) => entry.played).map((entry) => entry.name);
  return { player, contexts, advance, played, setFocus: (value) => { focused = value; }, timers: () => timers };
}

/* ── 寄存器表 ───────────────────────────────────────── */

test('22 张表的每一帧都是合法的芯片寄存器值，而且没有超过半秒的声音', () => {
  assert.equal(Chip.names.length, 22);
  assert.equal(Chip.FPS, 60);
  const integer = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
  for (const name of Chip.names) {
    for (const seed of variantsOf(name)) {
      const table = Chip.SOUNDS[name](seed);
      const label = `${name}(${seed})`;
      assert.ok(Object.keys(table).every((key) => ['p1', 'p2', 'wv', 'nz'].includes(key)), `${label} 只能写四个声道`);
      let rows = 0;
      for (const key of ['p1', 'p2']) {
        for (const row of table[key] || []) {
          if (row === null) continue;
          const [note, duty, volume] = row;
          const register = Math.round(2048 - 131072 / hz(note));
          assert.ok(register >= 0 && register <= 2047, `${label} ${key} 音高超出 11 位频率寄存器`);
          assert.ok(integer(duty, 0, 3), `${label} ${key} 占空比只能是 0–3`);
          assert.ok(integer(volume, 0, 15), `${label} ${key} 音量只能是 0–15`);
        }
      }
      for (const row of table.wv || []) {
        if (row === null) continue;
        const [note, level] = row;
        const register = Math.round(2048 - 65536 / hz(note));
        assert.ok(register >= 0 && register <= 2047, `${label} 波形声道音高超出寄存器`);
        assert.ok(integer(level, 0, 3), `${label} 波形声道只有四档音量`);
      }
      for (const row of table.nz || []) {
        if (row === null) continue;
        const [shift, divisor, width, volume] = row;
        assert.ok(integer(shift, 0, 13), `${label} 噪声移位只能是 0–13`);
        assert.ok(integer(divisor, 0, 7), `${label} 噪声除数只能是 0–7`);
        assert.ok(width === 0 || width === 1, `${label} 噪声宽度只能是 15 位或 7 位`);
        assert.ok(integer(volume, 0, 15), `${label} 噪声音量只能是 0–15`);
      }
      for (const key of ['p1', 'p2', 'wv', 'nz']) rows = Math.max(rows, (table[key] || []).length);
      assert.ok(rows > 0, `${label} 不能是空表`);
      assert.ok((rows + 3) / Chip.FPS <= 0.5, `${label} 加上收尾超过半秒`);
    }
  }
});

test('渲染不爆音、不带直流、尾巴收干净，两次渲染完全一样', () => {
  for (const rate of RATES) {
    for (const name of Chip.names) {
      for (const seed of variantsOf(name)) {
        const label = `${name}(${seed}) @${rate}`;
        const data = Chip.render(Chip.SOUNDS[name](seed), rate);
        assert.ok(data instanceof Float32Array && data.length > 0, `${label} 没有输出`);
        let peak = 0;
        let sum = 0;
        for (const value of data) {
          assert.ok(Number.isFinite(value), `${label} 出现非有限值`);
          peak = Math.max(peak, Math.abs(value));
          sum += value;
        }
        assert.ok(peak < 0.9, `${label} 峰值 ${peak} 太高`);
        // 音量拉满时总增益 1.6，仍不能削顶。
        assert.ok(peak * 1.6 < 1, `${label} 在最大音量下会削顶`);
        assert.ok(Math.abs(sum / data.length) < 1e-4, `${label} 带直流`);
        const frame = Math.round(rate / Chip.FPS);
        let tail = 0;
        for (let index = data.length - frame; index < data.length; index += 1) tail = Math.max(tail, Math.abs(data[index]));
        assert.ok(tail < 1e-3, `${label} 尾巴没有收干净（${tail}）`);
        assert.ok(Math.abs(data[data.length - 1]) < 1e-4, `${label} 最后一个采样不在零附近`);
        assert.deepEqual(Chip.render(Chip.SOUNDS[name](seed), rate), data, `${label} 两次渲染不一致`);
      }
    }
  }
});

test('声音与所有者试听时一致：16 位 PCM 指纹不变（重调音色须先经所有者试听，再更新这里）', () => {
  const hash = crypto.createHash('sha256');
  for (const name of [...Chip.names].sort()) {
    for (const seed of variantsOf(name)) {
      const data = Chip.render(Chip.SOUNDS[name](seed), 48000);
      const pcm = new Int16Array(data.length);
      for (let index = 0; index < data.length; index += 1) pcm[index] = Math.max(-32768, Math.min(32767, Math.round(data[index] * 32767)));
      hash.update(`${name}:${seed}:`);
      hash.update(Buffer.from(pcm.buffer));
    }
  }
  assert.equal(hash.digest('hex'), '3357daf16af322b0422135aa6adf14de7d607761c0ef664663a72e02a53cb2b0');
});

/* ── 事件表 ─────────────────────────────────────────── */

test('事件表里每个事件都指向一个存在的声音，每个声音都有地方响，档位与试听台一致', () => {
  const used = new Set();
  for (const [event, entry] of Object.entries(Sfx.EVENTS)) {
    assert.ok(Chip.names.includes(entry.sound), `${event} 指向不存在的声音 ${entry.sound}`);
    assert.ok(typeof entry.when === 'string' && entry.when.length > 0, `${event} 缺少说明`);
    used.add(entry.sound);
  }
  assert.deepEqual([...used].sort(), [...Chip.names].sort(), '每个声音都应当有对应的应用事件');
  for (const [sound, tier] of APPROVED_MAP) {
    assert.ok(Chip.names.includes(sound), `试听台里的 ${sound} 不在芯片表里`);
    assert.equal(Sfx.tierOf(sound), tier, `${sound} 的档位与试听台不一致`);
  }
  assert.deepEqual([...Sfx.ATTENTION].sort(), ['arrive', 'wait', 'watch']);
  assert.ok([...Sfx.ATTENTION].every((sound) => Sfx.KEY.has(sound)));
});

test('状态句子表：三种语言都有这些词条、每条都能整句匹配回自己的事件，其他状态不出声', () => {
  const window = {};
  for (const lang of ['zh', 'en', 'ja']) {
    new Function('self', read(`src/i18n/${lang}.js`))(window);
  }
  const locales = window.AgentDeskLocales;
  const fill = (template) => String(template).replace(/\{(\w+)(?:\|([^{}|]*)\|([^{}|]*))?\}/g, (_match, key, one, other) => (one !== undefined ? other : (key === 'n' ? '3' : `“示例${key}”`)));
  for (const lang of ['zh', 'en', 'ja']) {
    const dictionary = locales[lang];
    const matchers = Sfx.statusMatchers(dictionary, locales.zh);
    assert.equal(matchers.length, Object.keys(Sfx.STATUS_EVENTS).length, `${lang} 有状态词条没有固定文字，无法匹配`);
    for (const [key, event] of Object.entries(Sfx.STATUS_EVENTS)) {
      assert.ok(Object.prototype.hasOwnProperty.call(dictionary, key), `${lang} 缺少 ${key}`);
      assert.ok(Sfx.EVENTS[event], `${key} 指向不存在的事件 ${event}`);
      assert.equal(Sfx.statusEventFor(fill(dictionary[key]), matchers), event, `${lang} ${key} 没有匹配回 ${event}`);
    }
    for (const quiet of ['status.ready', 'status.opened', 'status.sessionInfoCopied', 'status.refreshRemoteWorking', 'transfers.received', 'taskPackage.incoming.received', 'transfers.filePickerCancelled']) {
      if (!dictionary[quiet]) continue;
      assert.equal(Sfx.statusEventFor(fill(dictionary[quiet]), matchers), null, `${lang} ${quiet} 不应出声`);
    }
  }
  assert.equal(Sfx.statusPattern('{err}'), null, '只有占位的词条不能变成万能匹配');
  assert.equal(Sfx.statusEventFor('', Sfx.statusMatchers(locales.zh, locales.zh)), null);
});

/* ── 播放规则 ───────────────────────────────────────── */

test('第一次真实点按之前不创建 AudioContext，之前的请求只记下来不补放', () => {
  const { player, contexts, advance, played } = harness();
  player.configure({ level: 'all' });
  for (const event of ['agent.select', 'agent.launch', 'mesh.arrive', 'dialog.open']) player.cue(event);
  advance(1000);
  assert.equal(contexts.length, 0);
  assert.deepEqual(played(), []);
  assert.ok(player.history().every((entry) => entry.reason === 'locked'));
  assert.equal(player.unlock(), true);
  assert.equal(player.unlock(), true);
  assert.equal(contexts.length, 1, '只创建一个 AudioContext');
  assert.deepEqual(played(), [], '解锁不补放之前的声音');
  player.cue('agent.select');
  assert.deepEqual(played(), ['select']);
});

test('静音档什么都不响，连 AudioContext 都不创建；试听也不响', () => {
  const { player, contexts, played } = harness();
  player.configure({ level: 'off' });
  assert.equal(player.unlock(), false);
  assert.equal(contexts.length, 0);
  for (const event of Object.keys(Sfx.EVENTS)) player.cue(event, { agentId: 'a', count: 3, chars: 2 });
  player.preview();
  assert.deepEqual(played(), []);
  // 已经有声音时切到静音：正在响的被停掉，之后也不响。
  const live = harness();
  live.player.configure({ level: 'all' });
  live.player.unlock();
  live.player.cue('session.copy', { count: 3 });
  const [first] = live.contexts[0].sources;
  live.player.configure({ level: 'off' });
  assert.equal(first.stopped, 1);
  assert.equal(live.contexts[0].state, 'suspended');
  live.advance(1000);
  assert.deepEqual(live.played(), ['stamp'], '静音后剩下的盖印不再落下');
});

test('三档：全部都响；只要要紧的只响要紧的；默认是只要要紧的', () => {
  assert.equal(harness().player.state().level, 'key');
  assert.equal(Sfx.DEFAULT_LEVEL, 'key');
  const key = harness();
  key.player.unlock();
  for (const [sound] of APPROVED_MAP) {
    key.advance(1000);
    key.player.play(sound);
  }
  assert.deepEqual(key.played().sort(), [...Sfx.KEY].sort());
  assert.ok(key.player.history().filter((entry) => !entry.played).every((entry) => entry.reason === 'level'));
  const all = harness();
  all.player.configure({ level: 'all' });
  all.player.unlock();
  for (const [sound] of APPROVED_MAP) {
    all.advance(1000);
    all.player.play(sound);
  }
  assert.deepEqual(all.played().sort(), APPROVED_MAP.map(([sound]) => sound).sort());
  // 开机声和逐字只在“全部”这一档。
  assert.equal(Sfx.tierOf('hello'), 'all');
  assert.equal(Sfx.tierOf('text'), 'all');
  // 换档后的试听不受“只要要紧的”限制。
  const preview = harness();
  preview.player.unlock();
  assert.equal(preview.player.preview(), true);
});

test('窗口不在前台时只响来了东西、等你处理、有人在看', () => {
  const { player, advance, played, setFocus } = harness();
  player.configure({ level: 'all' });
  player.unlock();
  setFocus(false);
  for (const [sound] of APPROVED_MAP) {
    advance(1000);
    player.play(sound);
  }
  assert.deepEqual(played().sort(), ['arrive', 'wait', 'watch']);
  assert.ok(player.history().filter((entry) => !entry.played).every((entry) => entry.reason === 'focus'));
});

test('同一时刻只有一个声音：新的打断旧的；界面小声不打断正在响的结果声', () => {
  const { player, contexts, advance, played } = harness();
  player.configure({ level: 'all' });
  player.unlock();
  player.play('launch');
  advance(50);
  player.play('error');
  const [launch, error] = contexts[0].sources;
  assert.equal(launch.stopped, 1, '新的声音打断旧的');
  assert.equal(error.stopped, 0);
  advance(50);
  assert.equal(player.play('close'), false, '弹窗合上的小声不打断出错声');
  assert.equal(player.history().at(-1).reason, 'yield');
  advance(400);
  assert.equal(player.play('close'), true, '出错声响完后小声照常');
  assert.equal(error.stopped, 1);
  // 同一个声音被两个钩子几乎同时请求，只响一次。
  advance(1000);
  player.play('ready');
  advance(30);
  assert.equal(player.play('ready'), false);
  assert.equal(player.history().at(-1).reason, 'repeat');
  assert.deepEqual(played(), ['launch', 'error', 'close', 'ready']);
});

test('盖印每次复制最多三下，间隔与试听台一致；再复制一次取消没落下的印', () => {
  const { player, advance, played } = harness();
  player.unlock();
  assert.equal(player.cue('session.copy', { count: 12 }), true);
  assert.deepEqual(played(), ['stamp']);
  advance(Sfx.STAMP_GAP_MS - 1);
  assert.deepEqual(played(), ['stamp']);
  advance(1);
  advance(Sfx.STAMP_GAP_MS);
  advance(2000);
  assert.deepEqual(played(), ['stamp', 'stamp', 'stamp']);
  const one = harness();
  one.player.unlock();
  one.player.cue('session.copy', { count: 1 });
  one.advance(2000);
  assert.deepEqual(one.played(), ['stamp']);
  const again = harness();
  again.player.unlock();
  again.player.cue('session.copy', { count: 3 });
  again.advance(10);
  again.player.cue('session.copy', { count: 1 });
  again.advance(2000);
  assert.deepEqual(again.played(), ['stamp', 'stamp']);
  assert.equal(harness().player.cue('session.copy', { count: 0 }), false);
});

test('逐字隔一个字一声，两声之间至少 90 毫秒', () => {
  const { player, advance, played } = harness();
  player.configure({ level: 'all' });
  player.unlock();
  // 一个字一个字地来：第二个字才响。
  assert.equal(player.text(1), false);
  assert.equal(player.text(1), true);
  // 页脚实际是每 18 毫秒两个字：照字数会是 55 声一秒，这里只响到 90 毫秒一声。
  const before = played().length;
  for (let step = 0; step < 50; step += 1) {
    advance(18);
    player.cue('footer.type', { chars: 2 });
  }
  const blips = played().length - before;
  assert.ok(blips >= 9 && blips <= 11, `900 毫秒里响了 ${blips} 声`);
  const times = player.history().filter((entry) => entry.played && entry.name === 'text').map((entry) => entry.at);
  for (let index = 1; index < times.length; index += 1) assert.ok(times[index] - times[index - 1] >= Sfx.TEXT_GAP_MS);
  // 只要要紧的这一档没有逐字声。
  const quiet = harness();
  quiet.player.unlock();
  quiet.player.text(2);
  assert.deepEqual(quiet.played(), []);
});

test('每只猫的嗓子由编号决定：同一只猫每次一样，不同的猫音高不同', () => {
  assert.equal(Sfx.seedFor('agent-1'), Sfx.seedFor('agent-1'));
  assert.ok(Number.isInteger(Sfx.seedFor('agent-1')) && Sfx.seedFor('agent-1') >= 0);
  const voices = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => Sfx.seedFor(id) % 5));
  assert.ok(voices.size >= 3, '十只猫至少有三种嗓子');
  const { player, contexts, advance } = harness();
  player.configure({ level: 'all' });
  player.unlock();
  const voiceOf = (agentId) => {
    advance(1000);
    player.cue('cat.poke', { agentId });
    return contexts[0].sources.at(-1).buffer.data;
  };
  const first = voiceOf('agent-1');
  assert.deepEqual(voiceOf('agent-1'), first);
  assert.deepEqual(first, Chip.render(Chip.SOUNDS.mew(Sfx.seedFor('agent-1') % 5), 48000));
  const other = ['agent-2', 'agent-3', 'agent-4', 'agent-5', 'agent-6'].find((id) => Sfx.seedFor(id) % 5 !== Sfx.seedFor('agent-1') % 5);
  assert.notDeepEqual(voiceOf(other), first);
});

test('开机声只响一次：第一次点按后稍等再响，这一下自己要出声就让给它', () => {
  const alone = harness();
  alone.player.configure({ level: 'all' });
  assert.equal(alone.player.cue('app.start'), true);
  assert.equal(alone.player.cue('app.start'), false, '只会准备一次');
  alone.advance(5000);
  assert.deepEqual(alone.played(), []);
  alone.player.unlock();
  alone.advance(500);
  assert.deepEqual(alone.played(), ['hello']);
  alone.player.unlock();
  alone.advance(1000);
  assert.deepEqual(alone.played(), ['hello']);
  const busy = harness();
  busy.player.configure({ level: 'all' });
  busy.player.cue('app.start');
  busy.player.unlock();
  busy.player.cue('agent.select');
  busy.advance(1000);
  assert.deepEqual(busy.played(), ['select']);
  // 默认档位（只要要紧的）不响开机声。
  const quiet = harness();
  quiet.player.cue('app.start');
  quiet.player.unlock();
  quiet.advance(1000);
  assert.deepEqual(quiet.played(), []);
});

test('没有音频能力时什么都不做，也不抛错', () => {
  for (const options of [{ noAudio: true }, { throws: true }]) {
    const { player, played } = harness(options);
    player.configure({ level: 'all' });
    assert.equal(player.unlock(), false);
    assert.equal(player.unlock(), false);
    assert.doesNotThrow(() => {
      for (const event of Object.keys(Sfx.EVENTS)) player.cue(event, { agentId: 'x', count: 2, chars: 2 });
    });
    assert.deepEqual(played(), []);
    assert.ok(player.history().every((entry) => entry.reason === 'unavailable'));
    assert.equal(player.state().available, false);
  }
  assert.equal(harness().player.cue('不存在的事件'), false);
});

test('音量：滑块 0–100 对应总增益 0–1.6，与试听台相同；半分钟没有声音就让音频设备歇着', () => {
  assert.equal(Sfx.DEFAULT_VOLUME, 55);
  assert.equal(Sfx.normalizeVolume(140), 100);
  assert.equal(Sfx.normalizeVolume(-3), 0);
  assert.equal(Sfx.normalizeVolume(42.6), 43);
  assert.equal(Sfx.normalizeVolume('70'), 70);
  assert.equal(Sfx.normalizeVolume('x'), 55);
  assert.equal(Sfx.normalizeLevel('loud'), 'key');
  const { player, contexts, advance } = harness();
  player.unlock();
  assert.ok(Math.abs(contexts[0].master.gain.value - 0.88) < 1e-9);
  player.setVolume(100);
  assert.ok(Math.abs(contexts[0].master.gain.value - 1.6) < 1e-9);
  player.setVolume(0);
  assert.equal(contexts[0].master.gain.value, 0);
  player.play('launch');
  advance(1000);
  contexts[0].sources.at(-1).onended();
  advance(31000);
  assert.equal(contexts[0].state, 'suspended');
  advance(1000);
  player.play('ready');
  assert.equal(contexts[0].state, 'running', '下一声把它叫醒');
});

test('设置：档位与音量进入稳定设置并做校验，默认只要要紧的、音量 55', () => {
  assert.equal(DEFAULT_SETTINGS.soundLevel, 'key');
  assert.equal(DEFAULT_SETTINGS.soundVolume, 55);
  assert.equal(normalizeSettings({}).soundLevel, 'key');
  assert.equal(normalizeSettings({}).soundVolume, 55);
  assert.equal(normalizeSettings({ soundLevel: 'all', soundVolume: 30 }).soundLevel, 'all');
  assert.equal(normalizeSettings({ soundLevel: 'off' }).soundLevel, 'off');
  assert.equal(normalizeSettings({ soundLevel: 'loud' }).soundLevel, 'key');
  assert.equal(normalizeSettings({ soundVolume: 30 }).soundVolume, 30);
  assert.equal(normalizeSettings({ soundVolume: 250 }).soundVolume, 100);
  assert.equal(normalizeSettings({ soundVolume: -1 }).soundVolume, 0);
  assert.equal(normalizeSettings({ soundVolume: '80' }).soundVolume, 55);
  assert.equal(normalizeSettings({ soundVolume: Number.NaN }).soundVolume, 55);
});

/* ── 接线 ───────────────────────────────────────────── */

test('界面接线：系统页的档位与音量、页脚一键静音、三种语言、脚本顺序与内容安全策略', () => {
  const html = read('src/index.html');
  const settings = html.slice(html.indexOf('id="systemSettings"'), html.indexOf('</section>', html.indexOf('id="systemSettings"')));
  assert.match(settings, /id="themeToggle"[\s\S]*?id="langToggle"[\s\S]*?class="system-setting-line settings-sound"[\s\S]*?id="soundLevel"[\s\S]*?id="profileQuitBehavior"/);
  assert.match(settings, /<select id="soundLevel">\s*<option value="all"[^>]*>[^<]*<\/option>\s*<option value="key"[^>]*>[^<]*<\/option>\s*<option value="off"[^>]*>[^<]*<\/option>\s*<\/select>/);
  assert.match(settings, /<input id="soundVolume" type="range" min="0" max="100" step="5" value="55">/);
  const footer = html.slice(html.indexOf('<footer id="statusBar"'), html.indexOf('</footer>', html.indexOf('<footer id="statusBar"')));
  assert.match(footer, /id="footerGlobal"[\s\S]*?<button id="soundMuteBtn" class="footer-sound" type="button" aria-pressed="false"[^>]*><i class="pxi" data-i="sound" aria-hidden="true"><\/i><\/button>/);
  const order = ['./pixel/fx.js', './pixel/chip.js', './pixel/sfx.js', './pixel/ui.js', './renderer.js'];
  let cursor = -1;
  for (const file of order) {
    // renderer.js is the window's one module entry; the others are classic scripts.
    const index = html.indexOf(file === './renderer.js' ? '<script type="module" src="./renderer.js"></script>' : `<script src="${file}"></script>`);
    assert.ok(index > cursor, `${file} 的位置不对`);
    cursor = index;
  }
  const keys = ['settings.sound', 'settings.sound.all', 'settings.sound.key', 'settings.sound.off', 'settings.sound.volume', 'settings.sound.hint', 'footer.sound.mute', 'footer.sound.unmute'];
  for (const lang of ['zh', 'en', 'ja']) {
    const locale = read(`src/i18n/${lang}.js`);
    for (const key of keys) assert.match(locale, new RegExp(`'${key.replace(/\./g, '\\.')}': '[^']+'`), `${lang} 缺少 ${key}`);
  }
  // Web Audio 不经过媒体元素也不联网：内容安全策略保持原样。
  const policy = read('src/main/ipc/security-policy.js');
  assert.match(policy, /"media-src 'none'"/);
  assert.match(policy, /"connect-src 'none'"/);
  // 没有任何音频文件。
  const audio = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? audio(path.join(dir, entry.name))
    : /\.(wav|mp3|ogg|m4a|aac|flac|webm)$/i.test(entry.name) ? [entry.name] : []));
  assert.deepEqual(audio(path.join(root, 'src')), []);
  // 稳定设置经由 renderer 读入后交给呈现层。
  assert.match(rendererSource(), /window\.PixelUi\?\.setSound\?\.\(value\);/);
  const css = read('src/pixel.css');
  assert.match(css, /\.system-setting-line\.settings-sound/);
  assert.match(css, /\.footer-sound \{/);
  assert.doesNotMatch(css.slice(css.indexOf('/* ══ 声音')), /border-radius:\s*[1-9]|https?:/);
});

test('除“有人在看”外，每个事件都接到了界面上；声音只经过 sfx.js', () => {
  const ui = read('src/pixel/ui.js');
  const viaStatus = new Set(Object.values(Sfx.STATUS_EVENTS));
  const unwired = Object.keys(Sfx.EVENTS).filter((event) => !ui.includes(`'${event}'`) && !viaStatus.has(event));
  // 被查看、被控制的提示在独立沙箱的远控宿主窗口里，主窗口收不到“有设备开始看这台电脑”的通知。
  assert.deepEqual(unwired, ['remote.watch']);
  assert.doesNotMatch(ui + read('src/pixel/fx.js') + rendererSource(), /new Audio\b|AudioContext/);
  // 悬停、滚动、打字不接声音：ui.js 里不出现针对它们的声音钩子。
  assert.doesNotMatch(ui, /addEventListener\('(?:mouseover|mouseenter|pointerover|pointermove|wheel|scroll|input)',[^\n]*cue\(/);
});
