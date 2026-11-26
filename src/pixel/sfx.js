/*
 * AgentDesk — 音效播放器。
 *
 * 声音本身在 chip.js：照老掌机的声音芯片写的 22 张寄存器表，现场渲染成 PCM，没有音频文件，不联网。
 * 这里只管什么时候让它响：
 *   - 三档：全部 / 只要要紧的 / 静音，默认“只要要紧的”；外加一个音量。
 *   - 第一次真实的点按或按键之后才创建 AudioContext；之前的请求只记下来，不排队补放。
 *   - 同一时刻只有一个声音，新的打断旧的。界面小声（开合、小开关、逐字）不打断正在响的结果声。
 *   - 窗口不在前台时只响“来了东西”“等你处理”“有人在看”。
 *   - 盖印每次复制最多三下；逐字隔一个字一声，两声之间至少 90 毫秒。
 *   - 每只猫的嗓子由它的编号决定。
 *   - 没有音频能力时什么都不做。
 *
 * 应用里的事件先查 EVENTS 表得到声音名，再交给 play()。这张表就是所有者试听过的“哪里响、响什么”。
 * UMD：浏览器里是 window.PixelSfx（已接好 window.Chip），Node 里 require 后用 create() 注入假的音频环境做单测。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelSfx = Object.assign(api.create({ chip: root.Chip, host: root }), api);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LEVELS = Object.freeze(['all', 'key', 'off']);
  const DEFAULT_LEVEL = 'key';
  const DEFAULT_VOLUME = 55;
  // “只要要紧的”这一档也会响的声音。
  const KEY = new Set(['launch', 'ready', 'wait', 'error', 'stamp', 'send', 'arrive', 'watch']);
  // 窗口不在前台时仍然可以响的声音。
  const ATTENTION = new Set(['arrive', 'wait', 'watch']);
  // 界面小声：不打断正在响的结果声。
  const CHROME = new Set(['open', 'close', 'tick', 'text']);

  const STAMP_LIMIT = 3;
  const STAMP_GAP_MS = 130;     // 试听台“勾三条会话，复制”里三下盖印的间隔
  const TEXT_GAP_MS = 90;       // 试听台“页脚说一句话”里两声逐字的间隔
  const REPEAT_GAP_MS = 120;    // 同一个声音两个钩子几乎同时请求时只响一次
  const HELLO_DELAY_MS = 400;   // 开机声等第一次点按后再响；这一下自己要出声就让给它
  const IDLE_SUSPEND_MS = 30000; // 半分钟没有声音就让音频设备歇着，下一声再叫醒
  const LOG_LIMIT = 200;

  // 应用事件 → 声音。tier 只是写明它属于哪一档，实际档位由声音名决定（KEY）。
  const EVENTS = Object.freeze({
    'agent.select': { sound: 'select', when: '点一只猫的卡片，选中它' },
    'agent.all': { sound: 'select', when: '点名册最前面的“全部”' },
    'cat.poke': { sound: 'mew', when: '点猫本身，它跳一下并叫一声', voice: true },
    'cat.recruited': { sound: 'mew', when: '新招募的猫落到搁板上', voice: true },
    'cat.zap': { sound: 'zap', when: '逗猫：叫过之后马上再点它一下' },
    'agent.launch': { sound: 'launch', when: '点卡片上的“打开”，客户端开始启动' },
    'agent.ready': { sound: 'ready', when: '客户端起来了' },
    'export.done': { sound: 'ready', when: '导出完成' },
    'import.done': { sound: 'ready', when: '导入成功' },
    'agent.wait': { sound: 'wait', when: '打开时需要你去安装、登录或确认' },
    'confirm.requested': { sound: 'wait', when: '不是你点出来的确认弹窗自己出现' },
    'inbox.attention': { sound: 'wait', when: '收件箱出现要你处理的事' },
    'action.failed': { sound: 'error', when: '任何一个动作失败' },
    'quota.exhausted': { sound: 'tired', when: '某个账号的额度第一次掉到最低一档' },
    'agent.removed': { sound: 'bye', when: '确认移除后，这只猫离开了名册' },
    'session.check': { sound: 'check', when: '勾选一条会话' },
    'session.uncheck': { sound: 'uncheck', when: '取消勾选会话' },
    'roster.pickup': { sound: 'check', when: '拖动排序时拿起一张卡' },
    'roster.drop': { sound: 'uncheck', when: '拖动排序时放下' },
    'session.copy': { sound: 'stamp', when: '复制会话信息，每一行落一个红印' },
    'session.send': { sound: 'send', when: '发送到设备' },
    'taskPackage.send': { sound: 'send', when: '把任务包直接交给另一台设备' },
    'dialog.open': { sound: 'open', when: '你打开一个弹窗' },
    'dialog.close': { sound: 'close', when: '你关上一个弹窗' },
    'menu.open': { sound: 'tick', when: '展开菜单' },
    'toggle': { sound: 'tick', when: '点一个小开关或换一个下拉选项' },
    'location.change': { sound: 'tick', when: '换运行位置' },
    'lens.change': { sound: 'tick', when: '换设备视角' },
    'order.change': { sound: 'tick', when: '用键盘换排序' },
    'language.change': { sound: 'tick', when: '换语言' },
    'theme.light': { sound: 'lampOn', when: '切到正常主题' },
    'theme.dark': { sound: 'lampOff', when: '切到夜间主题' },
    'footer.type': { sound: 'text', when: '页脚那句话逐字出来' },
    'mesh.arrive': { sound: 'arrive', when: '别的设备送来会话信息、文件或任务包' },
    'session.reply': { sound: 'arrive', when: '有对话回完了（只在窗口不在前台时，半分钟内最多一声）' },
    'hub.start': { sound: 'send', when: '台面上的一只猫叫另一只在后台跑一段对话，信封出发' },
    'hub.arrive': { sound: 'arrive', when: '台面外面的 Agent 叫了台面上的一只，信封从桌子边缘进来' },
    'hub.done': { sound: 'ready', when: '后台对话做完了，结果交回' },
    'remote.watch': { sound: 'watch', when: '有设备开始查看或控制这台电脑' },
    'app.start': { sound: 'hello', when: '应用启动完成，只响一次' }
  });

  // 页脚和弹窗里的状态句子 → 事件。应用的状态行大多不带“成功 / 失败”的标记，只有这句话本身，
  // 所以在这里按词表的 key 一次写全，而不是在每个调用点各加一句。主进程直接给出的原因文字不在表里，不会出声。
  // 同一次操作最多换来一个结果声（由 ui.js 把关），后台反复写同一句话不会反复响。
  const STATUS_EVENTS = Object.freeze({
    'status.exportOk': 'export.done',
    'taskPackage.status.exported': 'export.done',
    'taskPackage.status.received': 'import.done',
    'taskPackage.import.status.nativeDone': 'import.done',
    'taskPackage.import.status.materialsDone': 'import.done',
    'transfers.sent': 'session.send',
    'transfers.queued': 'session.send',
    'transfers.filesOffered': 'session.send',
    'taskPackage.direct.status.waiting': 'taskPackage.send',
    'status.openFail': 'action.failed',
    'status.removeFail': 'action.failed',
    'status.exportFail': 'action.failed',
    'status.checkFail': 'action.failed',
    'status.updateFail': 'action.failed',
    'status.migrateFail': 'action.failed',
    'status.sessionLocFail': 'action.failed',
    'status.openAcctDirFail': 'action.failed',
    'status.crashpadCleanFailed': 'action.failed',
    'status.profileStopFailed': 'action.failed',
    'status.quotaRefreshFail': 'action.failed',
    'status.provisioning.failed': 'action.failed',
    'status.refreshRemoteDenied': 'action.failed',
    'status.refreshRemoteFailedReason': 'action.failed',
    'status.refreshRemoteNoRoute': 'action.failed',
    'status.refreshRemoteTimeout': 'action.failed',
    'status.refreshRemoteVersion': 'action.failed'
  });

  // 把一条带 {占位} 的词条变成整句匹配的正则。没有一点固定文字的词条不参与匹配，免得什么都算。
  function statusPattern(template) {
    const text = String(template || '');
    const parts = text.split(/\{\w+(?:\|[^{}|]*\|[^{}|]*)?\}/);
    if (parts.join('').trim().length < 2) return null;
    const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${parts.map(escape).join('[\\s\\S]*?')}$`);
  }

  // dictionary：当前语言的词表；fallback：中文词表。返回 [{ key, event, pattern }]。
  function statusMatchers(dictionary = {}, fallback = {}) {
    const matchers = [];
    for (const [key, event] of Object.entries(STATUS_EVENTS)) {
      const template = Object.prototype.hasOwnProperty.call(dictionary, key) ? dictionary[key] : fallback[key];
      const pattern = statusPattern(template);
      if (pattern) matchers.push({ key, event, pattern });
    }
    return matchers;
  }

  function statusEventFor(text, matchers) {
    const value = String(text || '').trim();
    if (!value) return null;
    const hit = (matchers || []).find((matcher) => matcher.pattern.test(value));
    return hit ? hit.event : null;
  }

  function normalizeLevel(value) {
    return LEVELS.includes(value) ? value : DEFAULT_LEVEL;
  }

  function normalizeVolume(value) {
    const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return DEFAULT_VOLUME;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  // 猫的嗓子：编号的 FNV-1a 散列。同一只猫每次叫都是同一个声音。
  function seedFor(id) {
    const text = String(id == null ? '' : id);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function tierOf(sound) {
    return KEY.has(sound) ? 'key' : 'all';
  }

  function create(options = {}) {
    const chip = options.chip || null;
    const host = options.host || {};
    const now = options.now || (() => (host.performance && typeof host.performance.now === 'function'
      ? host.performance.now()
      : Date.now()));
    const hasFocus = options.hasFocus || (() => {
      const doc = host.document;
      return doc && typeof doc.hasFocus === 'function' ? doc.hasFocus() : true;
    });
    const audioClass = options.audioClass || (() => host.AudioContext || host.webkitAudioContext || null);
    const later = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const cancel = options.clearTimeout || ((id) => clearTimeout(id));

    let level = DEFAULT_LEVEL;
    let volume = DEFAULT_VOLUME;
    let context = null;
    let master = null;
    let available = null;           // null：还没试过；false：这台机器没有可用的音频
    let current = null;             // { source, name, chrome, endsAt }
    let textChars = 0;
    let lastTextAt = -Infinity;
    let hello = 'idle';             // idle → armed → waiting → done
    let helloTimer = null;
    let idleTimer = null;
    let stampTimers = [];
    const buffers = new Map();
    const lastPlayed = new Map();
    const log = [];
    const listeners = new Set();

    const gain = () => (volume / 100) * 1.6;   // 与试听台相同：滑块 55 时总音量 0.88

    function emit() {
      const snapshot = state();
      for (const listener of listeners) {
        try { listener(snapshot); } catch (_error) { /* 一个监听出错不影响声音 */ }
      }
    }

    function record(name, played, reason, extra) {
      log.push(Object.assign({ name, played, reason, at: now() }, extra || {}));
      if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
      return played;
    }

    function state() {
      return { level, volume, unlocked: Boolean(context), available, playing: current ? current.name : null };
    }

    function configure(value = {}) {
      if (Object.prototype.hasOwnProperty.call(value, 'level')) level = normalizeLevel(value.level);
      if (Object.prototype.hasOwnProperty.call(value, 'volume')) volume = normalizeVolume(value.volume);
      if (master) master.gain.value = gain();
      if (level === 'off') {
        stopAll();
        rest();
      }
      emit();
      return state();
    }

    function stopAll() {
      stampTimers.forEach(cancel);
      stampTimers = [];
      if (current) {
        try { current.source.stop(); } catch (_error) { /* 已经停了 */ }
        current = null;
      }
    }

    function rest() {
      if (context && context.state === 'running' && typeof context.suspend === 'function') {
        try { Promise.resolve(context.suspend()).catch(() => {}); } catch (_error) { /* 暂停失败也不影响界面 */ }
      }
    }

    function wake() {
      if (context && context.state === 'suspended' && typeof context.resume === 'function') {
        try { Promise.resolve(context.resume()).catch(() => {}); } catch (_error) { /* 恢复失败就保持安静 */ }
      }
    }

    function scheduleRest() {
      if (idleTimer !== null) cancel(idleTimer);
      idleTimer = later(() => {
        idleTimer = null;
        if (!current) rest();
      }, IDLE_SUSPEND_MS);
    }

    // 只在真实的点按或按键里调用。第一次调用时才创建 AudioContext；静音档不创建。
    function unlock() {
      if (level === 'off') return Boolean(context);
      if (!context && available !== false) {
        const Ctor = audioClass();
        if (!Ctor) {
          available = false;
        } else {
          try {
            context = new Ctor();
            master = context.createGain();
            master.gain.value = gain();
            master.connect(context.destination);
            available = true;
          } catch (_error) {
            context = null;
            master = null;
            available = false;
          }
        }
        if (context) emit();
      }
      wake();
      if (context) scheduleRest();
      if (context && hello === 'armed') {
        hello = 'waiting';
        helloTimer = later(() => {
          helloTimer = null;
          if (hello !== 'waiting') return;
          hello = 'done';
          play('hello', { via: 'app.start' });
        }, HELLO_DELAY_MS);
      }
      return Boolean(context);
    }

    function bufferFor(name, seed) {
      const variant = name === 'mew' ? (seed >>> 0) % 5 : 0;
      const key = `${name}:${variant}`;
      if (!buffers.has(key)) {
        const data = chip.render(chip.SOUNDS[name](variant), context.sampleRate);
        const made = context.createBuffer(1, data.length, context.sampleRate);
        if (typeof made.copyToChannel === 'function') made.copyToChannel(data, 0);
        else made.getChannelData(0).set(data);
        buffers.set(key, made);
      }
      return buffers.get(key);
    }

    function blocked(name, opts) {
      if (!chip || !chip.SOUNDS || typeof chip.SOUNDS[name] !== 'function') return 'unknown';
      if (level === 'off') return 'level';
      if (level === 'key' && !KEY.has(name) && !opts.preview) return 'level';
      if (!opts.preview && !ATTENTION.has(name) && !hasFocus()) return 'focus';
      if (!context) return available === false ? 'unavailable' : 'locked';
      return null;
    }

    function play(name, opts = {}) {
      const at = now();
      // 开机声在等第一次点按：这一下自己要出声，就不再补开机声。
      if (hello === 'waiting' && name !== 'hello') {
        hello = 'done';
        if (helloTimer !== null) { cancel(helloTimer); helloTimer = null; }
      }
      const extra = opts.via ? { via: opts.via } : undefined;
      let reason = blocked(name, opts);
      if (!reason && name !== 'stamp' && name !== 'text' && at - (lastPlayed.get(name) ?? -Infinity) < REPEAT_GAP_MS) reason = 'repeat';
      if (!reason && CHROME.has(name) && current && !current.chrome && at < current.endsAt) reason = 'yield';
      if (reason) return record(name, false, reason, extra);
      try {
        const buffer = bufferFor(name, Number.isFinite(opts.seed) ? opts.seed : 0);
        wake();
        if (current) {
          try { current.source.stop(); } catch (_error) { /* 已经停了 */ }
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(master);
        const entry = { source, name, chrome: CHROME.has(name), endsAt: at + (buffer.length / buffer.sampleRate) * 1000 };
        source.onended = () => { if (current === entry) current = null; };
        source.start();
        current = entry;
        lastPlayed.set(name, at);
        scheduleRest();
        return record(name, true, 'ok', extra);
      } catch (_error) {
        return record(name, false, 'failed', extra);
      }
    }

    // 盖印：每次复制最多三下，间隔与试听台一致；再复制一次会取消上一轮还没落下的印。
    function stamps(count, via) {
      stampTimers.forEach(cancel);
      stampTimers = [];
      const total = Math.max(0, Math.min(STAMP_LIMIT, Math.floor(Number(count) || 0)));
      for (let index = 0; index < total; index += 1) {
        if (index === 0) play('stamp', { via });
        else stampTimers.push(later(() => play('stamp', { via }), index * STAMP_GAP_MS));
      }
      return total;
    }

    // 逐字：隔一个字一声，两声之间至少 90 毫秒（页脚实际每 18 毫秒出两个字，照字数响会连成一片）。
    function text(chars = 1, via) {
      textChars += Math.max(0, Math.floor(Number(chars) || 0));
      if (textChars < 2) return false;
      if (now() - lastTextAt < TEXT_GAP_MS) return false;
      textChars = 0;
      lastTextAt = now();
      return play('text', { via });
    }

    function textReset() {
      textChars = 0;
    }

    function armHello() {
      if (hello !== 'idle') return false;
      hello = 'armed';
      if (context) unlock();
      return true;
    }

    // 应用事件入口：查表得到声音名再播放。detail.agentId 决定猫的嗓子，detail.count 是盖印的行数。
    function cue(event, detail = {}) {
      const entry = EVENTS[event];
      if (!entry) return record(String(event), false, 'unknown-event');
      if (event === 'app.start') return armHello();
      if (entry.sound === 'stamp') return stamps(detail.count, event) > 0;
      if (entry.sound === 'text') return text(detail.chars, event);
      const opts = { via: event };
      if (entry.voice) opts.seed = seedFor(detail.agentId);
      return play(entry.sound, opts);
    }

    // 系统页里换档、拖音量后的试听：不受“只要要紧的”限制，静音时仍然不响。
    function preview() {
      return play('tick', { preview: true, via: 'preview' });
    }

    function onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    return {
      configure,
      setLevel: (value) => configure({ level: value }),
      setVolume: (value) => configure({ volume: value }),
      unlock,
      play,
      cue,
      stamps,
      text,
      textReset,
      armHello,
      preview,
      state,
      onChange,
      history: () => log.map((entry) => Object.assign({}, entry)),
      clearHistory: () => { log.length = 0; }
    };
  }

  return {
    create,
    EVENTS,
    STATUS_EVENTS,
    statusPattern,
    statusMatchers,
    statusEventFor,
    LEVELS,
    DEFAULT_LEVEL,
    DEFAULT_VOLUME,
    KEY,
    ATTENTION,
    CHROME,
    STAMP_LIMIT,
    STAMP_GAP_MS,
    TEXT_GAP_MS,
    normalizeLevel,
    normalizeVolume,
    seedFor,
    tierOf
  };
});
