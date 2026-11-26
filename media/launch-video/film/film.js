'use strict';

/*
 * The film: render(ctx, t, lang) draws the frame for time t (seconds).
 *
 * It is a pure function of time and language. 120 beats a minute: a beat is
 * half a second, a bar two seconds, and every shot, camera move, caption and
 * click starts on a beat or a clean fraction of one (times.js).
 *
 * The camera has two places to stand: close on the Catshelf window (the
 * window at twice its size, 960×540 of it in view, tilting up and down), or
 * back at the desktop (the whole window at its own size, top left, with the
 * official clients beside it). It moves between them in three held steps.
 */

const { Pen, DAY, NIGHT, mix, ease, within } = require('./draw.js');
const app = require('./app.js');
const recruit = require('./recruit.js');
const panels = require('./panels.js');
const hook = require('./hook.js');
const desk = require('./desktop.js');
const over = require('./overlay.js');
const story = require('./state.js');
const { ui, FILM, CAST } = require('./strings.js');
const { FPS, END, SHOTS, T, F } = require('./times.js');

const WIDTH = 1920, HEIGHT = 1080;
const DESK_AT = { x: 16, y: 48 };                  // where the Catshelf window sits on the desktop
const WAYS_TILT = 56, LEDGER_TILT = 300, PLATES_TILT = 150, SEND_TILT = 250;

/*
 * A view is one way of composing a frame out of the same drawing.
 *
 * WIDE is the film's 1920×1080. TALL is 1080×1440 for a 3:4 feed: the frame is too narrow for the whole window at
 * twice its size, so it shows 540×720 of it and moves sideways as well as up and down; there is no desktop to pull
 * back to, and the official clients open over the lower part of the window instead of beside it. The window itself
 * is 30px taller there (a real window can be), so that the view from under the shelf ends exactly on its footer.
 */
const inputPoint = (box) => [box.x + 232 + 16 + 200, box.y + box.h - 38];
const WIDE = {
  name: 'wide', width: WIDTH, height: HEIGHT, window: { w: app.W, h: app.H },
  codex: [0, 1, 2].map((k) => ({ x: 1012, y: 56 + k * 280, w: 884, h: 264 })), claude: { x: 1060, y: 372, w: 836, h: 508 },
  behindClaude: [1, 2],                              // whose windows Claude's covers once it is up
  idle: [1380, 760],
  // A dashed line runs from the cat (behind it) to the left edge of its client.
  link: (cam, k, box, claude) => [toFrame(cam, app.cardCentre(k), 112), [box.x - 4, box.y + (claude ? 120 : box.h / 2)]],
  paperFrom: (j) => [260 + ((j * 397) % 1300), 1120 + (j % 3) * 40],
  caption: { cx: 480, y: 446 }
};
const TALL = {
  name: 'tall', width: 1080, height: 1440, window: { w: app.W, h: 870 }, over: true,
  // Three windows stepping down to the right, so each one's top edge is clear under its own nameplate.
  codex: [{ x: 40, y: 612, w: 620, h: 340 }, { x: 250, y: 700, w: 640, h: 340 }, { x: 420, y: 788, w: 620, h: 340 }],
  claude: { x: 20, y: 580, w: 1040, h: 560 },
  behindClaude: [0, 1, 2],
  idle: [540, 1000],
  // The line drops from under the nameplate straight to the top edge of the client.
  link: (cam, k, box) => { const from = toFrame(cam, app.cardCentre(k), 272); return [from, [from[0], box.y - 4]]; },
  paperFrom: (j) => [60 + ((j * 397) % 900), 1480 + (j % 3) * 40],
  caption: { cx: 270, y: 600 }
};
const VIEWS = { wide: WIDE, tall: TALL };

/* ── Camera ────────────────────────────────────────── */
// [time, desktop (0 close, 1 desktop), tilt (window y at the top of the frame, close-ups only)]
function cameraMoves(plan) {
  return [[0, 0, 0], [5, 1, 0], [6, 0, 0], [T.RECRUIT.click, 0, plan.dialogTilt], [T.RECRUIT.close, 0, 0], [12, 1, 0],
    [16, 0, 0], [18, 0, LEDGER_TILT], [19, 0, PLATES_TILT], [24, 0, 0], [26, 0, LEDGER_TILT], [28, 1, 0],
    [36, 0, PLATES_TILT], [38, 1, 0], [40, 0, SEND_TILT], [42, 0, WAYS_TILT], [46, 0, LEDGER_TILT], [48, 0, 0]];
}

function camera(t, plan) {
  const moves = cameraMoves(plan);
  let index = 0;
  moves.forEach((move, i) => { if (t >= move[0] - 1e-9) index = i; });
  const to = moves[index], from = moves[Math.max(0, index - 1)];
  const frame = Math.floor((t - to[0]) * FPS + 1e-6), p = index === 0 ? 1 : frame < 4 ? 0.55 : frame < 8 ? 0.85 : 1;
  // Coming from or going to the desktop the tilt is the close-up's own; between two close-ups it glides.
  const tiltFrom = from[1] ? to[2] : from[2], tiltTo = to[1] ? from[2] : to[2];
  const d = mix(from[1], to[1], p), y = Math.round(mix(tiltFrom, tiltTo, p) / 2) * 2;
  const scale = 2 - d;
  return { d, y, scale, ox: Math.round(mix(0, DESK_AT.x, d) / 2) * 2, oy: Math.round(mix(-2 * y, DESK_AT.y, d) / 2) * 2, moving: p < 1 };
}

function toFrame(cam, x, y) { return [cam.ox + x * cam.scale, cam.oy + y * cam.scale]; }
// The camera standing still: close on the window with (x, y) of it at the frame's top left, or back at the desktop.
const closeAt = (x, y, clients = false) => ({ d: 0, y, scale: 2, ox: -2 * x, oy: -2 * y, moving: false, clients });
const desktopCam = () => ({ d: 1, y: 0, scale: 1, ox: DESK_AT.x, oy: DESK_AT.y, moving: false });

/* ── Things worked out once per language ───────────── */
const plans = new Map();
function planFor(lang, ctx, view = WIDE) {
  const key = `${lang}:${view.name}`;
  if (!plans.has(key)) plans.set(key, app.withSize(view.window, () => planNow(lang, ctx, view)));
  return plans.get(key);
}

function planNow(lang, ctx, view) {
  const pen = new Pen(ctx, 2, DAY), words = FILM[lang];
  const dialog = recruit.layout(pen, lang, 0), empty = app.emptyLayout(pen, lang);
  const ways = [0, 1, 2, 3].map((tab) => recruit.layout(pen, lang, tab));
  const cards = CAST.map((_, k) => app.cardLayout(pen, lang, k));
  const head = app.headLayout(pen, lang, true), edit = panels.editLayout(), send = panels.sendDialogLayout(pen, lang), sendMenu = panels.sendMenuLayout();
  // Tilt so that the dialog's seal button sits just above the caption.
  const plan = { view, size: view.window, dialog, ways, empty, cards, edit, send, sendMenu, dialogTilt: Math.round((dialog.primary.y + dialog.primary.h - 422) / 2) * 2 };
  const centre = (box) => [box.x + box.w / 2, box.y + box.h / 2];
  const name = [...words.names.work];
  plan.typed = (t) => (t < T.RECRUIT.type ? '' : name.slice(0, Math.min(name.length, Math.floor((t - T.RECRUIT.type) / (name.length > 2 ? 0.125 : 0.25) + 1e-6) + 1)).join(''));
  // Ledger layouts at the moments the cursor needs them.
  const at = (time) => story.ledgerAt(time, lang);
  const rowOf = (time, id) => { const ledger = at(time); return app.rowLayout(ledger, ledger.rows.findIndex((row) => row.id === id)); };
  const bar = (time) => app.toolbarLayout(pen, lang, at(time));
  const L = T.LEDGER, loginRow = rowOf(L.menu, 'skeleton'), menu = panels.tagMenuLayout(300, loginRow.top + 18);
  plan.tagMenu = menu;
  const orders = rowOf(T.COPY.check - 0.01, 'orders');
  const looks = ['maneki', 'qinghua', 'panda', 'tiger', 'koi'], wears = ['scarf', 'shades', 'straw'];
  plan.looks = looks; plan.wears = wears;
  const lookClicks = looks.map((id) => centre(edit.looks[id])).concat(wears.map((id) => centre(edit.accessories[id])));
  // The cursor: [time, x, y, 'w' window or 'f' frame coordinates, click, carrying]
  const first = centre(empty.button), create = centre(dialog.primary), field = [dialog.name.x + 70, dialog.name.y + 20];
  const opens = [0, 1, 2, 3].map((k) => centre(cards[k].launch));
  const codexInput = inputPoint(view.codex[0]), claudeInput = inputPoint(view.claude);
  const plate0 = [app.cardCentre(0), 172];
  const keys = [
    [5.4, ...view.idle, 'f'], [5.95, ...view.idle, 'f'], [6.4, ...first, 'w'], [T.RECRUIT.click, ...first, 'w', true],
    [6.95, field[0], field[1] + 22, 'w'], [8.05, field[0], field[1] + 22, 'w'], [8.42, ...create, 'w'], [T.RECRUIT.create, ...create, 'w', true],
    [9.2, ...create, 'w'], [9.7, 330, 330, 'w'], [11.8, 330, 330, 'w'],
    [12.2, ...opens[0], 'w'], [T.OPEN[0], ...opens[0], 'w', true], [12.7, ...opens[1], 'w'], [T.OPEN[1], ...opens[1], 'w', true],
    [13.2, ...opens[2], 'w'], [T.OPEN[2], ...opens[2], 'w', true],
    // 14: into the Codex window, type, send.
    [13.9, ...codexInput, 'f'], [T.SYNC.focus, ...codexInput, 'f', true], [15.9, ...codexInput, 'f'],
    // 16–18: watch the shelf.
    [16.4, 560, 330, 'w'], [17.9, 560, 330, 'w'],
    // 18–24: the ledger.
    [18.9, 420, 250, 'w'], [L.pick - 0.05, ...plate0, 'w'], [L.pick, ...plate0, 'w', true],
    [L.menu - 0.05, 300, loginRow.top + 18, 'w'], [L.menu, 300, loginRow.top + 18, 'w', true],
    [L.tag - 0.03, ...centre(menu.items[0]), 'w'], [L.tag, ...centre(menu.items[0]), 'w', true],
    [L.filter - 0.05, ...centre(bar(L.filter - 0.01).tags[0]), 'w'], [L.filter, ...centre(bar(L.filter - 0.01).tags[0]), 'w', true],
    [L.clear - 0.05, ...centre(bar(L.clear - 0.01).clear), 'w'], [L.clear, ...centre(bar(L.clear - 0.01).clear), 'w', true],
    [L.search - 0.08, ...centre(bar(L.clear + 0.01).search), 'w'], [L.search - 0.07, ...centre(bar(L.clear + 0.01).search), 'w', true],
    [23.9, bar(L.clear + 0.01).search.x + 60, 345, 'w'],
    // 24–28: it runs out; copy where its chat lives.
    [24.4, 560, 330, 'w'], [25.8, 560, 330, 'w'],
    [T.COPY.check - 0.03, ...centre(orders.box), 'w'], [T.COPY.check, ...centre(orders.box), 'w', true],
    [T.COPY.press - 0.03, ...centre(bar(T.COPY.check + 0.01).copy), 'w'], [T.COPY.press, ...centre(bar(T.COPY.check + 0.01).copy), 'w', true],
    [27.9, ...centre(bar(T.COPY.check + 0.01).copy), 'w'],
    // 28–36: open Claude, paste, ask.
    [T.PASTE.open - 0.03, ...opens[3], 'w'], [T.PASTE.open, ...opens[3], 'w', true],
    [T.PASTE.paste - 0.05, ...claudeInput, 'f'], [T.PASTE.paste, ...claudeInput, 'f', true], [35.9, ...claudeInput, 'f'],
    // 36–40: watch.
    [36.4, 620, 560, 'w'], [39.9, 620, 560, 'w']
  ];
  // 40–42: Send → Send to device → Send session info.
  const sendBar = bar(40.1);
  keys.push([T.SEND.menu - 0.03, ...centre(sendBar.send), 'w'], [T.SEND.menu, ...centre(sendBar.send), 'w', true],
    [T.SEND.item - 0.03, ...centre(sendMenu.device), 'w'], [T.SEND.item, ...centre(sendMenu.device), 'w', true],
    [T.SEND.press - 0.03, ...centre(send.send), 'w'], [T.SEND.press, ...centre(send.send), 'w', true], [41.9, ...centre(send.send), 'w']);
  // 42–46: four ways. The recruit button, the name field, two ticks, a folder dragged in, the fourth tab.
  const W = T.WAYS, tabs = ways.map((layout, k) => centre(layout.tabs[k]));
  keys.push([W.open - 0.03, ...centre(head.recruit), 'w'], [W.open, ...centre(head.recruit), 'w', true],
    [W.type, ways[0].name.x + 80, ways[0].name.y + 40, 'w'], [W.tab[1] - 0.05, ...tabs[1], 'w'], [W.tab[1], ...tabs[1], 'w', true],
    [W.ticks[0] - 0.03, ways[1].homes[0].x + 10, ways[1].homes[0].y + 17, 'w'], [W.ticks[0], ways[1].homes[0].x + 10, ways[1].homes[0].y + 17, 'w', true],
    [W.ticks[1] - 0.03, ways[1].homes[1].x + 10, ways[1].homes[1].y + 17, 'w'], [W.ticks[1], ways[1].homes[1].x + 10, ways[1].homes[1].y + 17, 'w', true],
    [W.tab[2] - 0.05, ...tabs[2], 'w'], [W.tab[2], ...tabs[2], 'w', true],
    [W.drag, 900, 400, 'w', false, true], [W.drop, ...centre(ways[2].zone), 'w', false, true], [W.drop + 0.02, ...centre(ways[2].zone), 'w'],
    [W.tab[3] - 0.05, ...tabs[3], 'w'], [W.tab[3], ...tabs[3], 'w', true], [45.9, tabs[3][0] + 40, tabs[3][1] + 60, 'w']);
  // 46–48: a coat or an accessory every half beat.
  T.LOOKS.clicks.forEach((time, i) => keys.push([time - 0.03, ...lookClicks[i], 'w'], [time, ...lookClicks[i], 'w', true]));
  keys.push([47.95, ...lookClicks[7], 'w'], [48.2, 700, 420, 'w'], [END, 700, 420, 'w']);
  plan.cursor = keys;
  return plan;
}

/* ── The Catshelf window with whatever is open over it ── */
function typedOver(text, t, start, duration) {
  const letters = [...text];
  return t < start ? '' : letters.slice(0, Math.min(letters.length, Math.floor((t - start) / duration * letters.length + 1e-6) + 1)).join('');
}

function drawWindowAt(ctx, t, lang, plan, scale) {
  const pen = new Pen(ctx, scale, DAY), state = story.windowState(t, lang, plan), words = FILM[lang];
  app.drawWindow(pen, state);
  if (state.dialog) recruit.draw(pen, lang, state.dialog, plan.dialog);
  // 20.5: the tag menu on a row.
  if (within(t, T.LEDGER.menu, T.LEDGER.tag)) panels.tagMenu(pen, lang, plan.tagMenu, { hover: t >= T.LEDGER.tag - 0.1 ? 0 : 5 });
  // 40.25: the Send menu, then the dialog.
  if (within(t, T.SEND.menu, T.SEND.item)) panels.sendMenu(pen, lang, { hover: t >= T.SEND.item - 0.1 ? 'device' : null });
  if (within(t, T.SEND.item, T.WAYS.open)) {
    const frame = Math.floor((t - T.SEND.item) * FPS + 1e-6);
    panels.sendDialog(pen, lang, plan.send, {
      rise: Math.min(3, Math.floor(frame / 3)), device: words.device, pressed: within(t, T.SEND.press, T.SEND.press + F(6)),
      status: t < T.SEND.press ? ui(lang, 'transfers.ready', { n: 1 }) : t < T.SEND.land ? ui(lang, 'transfers.sending') : ui(lang, 'transfers.sent', { n: 1 }), tone: t >= T.SEND.land ? 'ok' : ''
    });
  }
  // 42–46: the four ways.
  const W = T.WAYS;
  if (within(t, W.open, T.LOOKS.open)) {
    const tab = W.tab.filter((time) => t >= time).length - 1, frame = Math.floor((t - W.open) * FPS + 1e-6);
    recruit.draw(pen, lang, {
      tab, rise: Math.min(3, Math.floor(frame / 3)), focus: tab === 0 ? 'name' : '', caret: Math.floor(t * 2) % 2 === 0,
      name: typedOver(words.names.writing, t, W.type, 0.3), pressed: tab === 0 && within(t, W.create, W.create + F(6)),
      status: tab === 0 && t >= W.create + 0.1 ? ui(lang, 'recruit.new.done', { client: 'Codex' }) : tab === 1 && t >= W.register ? ui(lang, 'recruit.existing.registered.done', { n: 2 }) : tab === 2 && t >= W.drop ? ui(lang, 'recruit.drop.recognized', { client: 'Claude' }) : '',
      homes: [0, 1].map((k) => ({ identity: words.found[k], detail: ui(lang, 'recruit.existing.sessions', { n: words.sessionsFound[k] }) + ' · ' + ui(lang, k ? 'recruit.existing.source.home-scan' : 'recruit.existing.source.default'), path: k ? '/Users/me/work/.claude' : '/Users/me/.claude', checked: t >= W.ticks[k] })),
      primaryOff: tab === 1 && t < W.ticks[0], dragging: tab === 2 && within(t, W.drag + 0.2, W.drop + 0.2)
    }, plan.ways[tab]);
  }
  // 46–48: the appearance of a cat.
  if (within(t, T.LOOKS.open, T.LOCK.shut)) {
    const done = T.LOOKS.clicks.filter((time) => t >= time).length, frame = Math.floor((t - T.LOOKS.open) * FPS + 1e-6);
    const look = done ? plan.looks[Math.min(done, plan.looks.length) - 1] : 'codex';
    const wear = done > plan.looks.length ? plan.wears[done - plan.looks.length - 1] : 'none';
    panels.editDialog(pen, lang, plan.edit, { rise: Math.min(3, Math.floor(frame / 3)), look, collar: null, accessory: wear, changed: done ? t - T.LOOKS.clicks[done - 1] : -1, t });
  }
  return state;
}

/* ── The desktop: clients, links, envelopes ────────── */
function codexWindow(pen, t, lang, k, view) {
  const words = FILM[lang], box = view.codex[k], frame = Math.floor((t - T.UP[k]) * FPS + 1e-6);
  let side = [[words.newChat, false], [words.sideCodex[k], false]], lines = [], input = null, focus = false;
  if (k === 0 && t >= T.SYNC.focus) {
    focus = t < T.SYNC.send;
    const n = t < T.SYNC.send ? 0 : t < T.SYNC.three ? 1 : t < T.SYNC.five ? 3 : 5;
    const running = (i) => (t < T.SYNC.calm ? true : t < T.LEDGER.fresh ? i === 0 || i === 2 : false);
    if (n) side = words.codexMany.slice(0, n).map((label, i) => [label, running(i)]);
    if (within(t, T.SYNC.type, T.SYNC.send)) input = [typedOver(words.codexTyped, t, T.SYNC.type, 0.4)];
    if (t >= T.SYNC.send) lines = words.codexLines;
  }
  desk.client(pen, box, { lang, t, title: 'Codex · ' + words.names[CAST[k].name], badge: words.signed, side, lines, input, focus, rise: Math.min(3, Math.floor(frame / 3)) });
  pen.burst(box.x + box.w / 2, box.y + box.h / 2, t - T.UP[k], desk.HONEY, 240, 12);
}

function claudeWindow(pen, t, lang, view) {
  const words = FILM[lang], CLAUDE_BOX = view.claude, P = T.PASTE, frame = Math.floor((t - P.up) * FPS + 1e-6), C = T.CALL;
  const pasted = [`${ui(lang, 'session.location.path')}: /Users/me/work/shop-api`, `${ui(lang, 'session.location.coordinate')}: …/sessions/2026/06/18/rollout-7f3c.jsonl#7f3c`];
  const lines = [];
  if (t >= P.sent) lines.push(words.you + pasted[0], pasted[1]);
  if (t >= P.read) lines.push(words.claudeRead);
  if (t >= P.go) lines.push(words.claudeGo);
  if (t >= T.ASK.sent) lines.push(words.you + words.ask);
  if (t >= T.ASK.reply) lines.push(words.claudeOk);
  C.back.forEach((back, j) => { if (t >= back + 0.5) lines.push(words.jobs[j] + words.jobDone); });
  let input = null;
  if (within(t, P.paste, P.sent)) input = pasted;
  if (within(t, T.ASK.type, T.ASK.sent)) input = [typedOver(words.ask, t, T.ASK.type, 1.2)];
  desk.client(pen, CLAUDE_BOX, { lang, t, title: 'Claude · ' + words.names[CAST[3].name], badge: words.signed, side: [[words.takeover, story.runningAt(t, 3) > 0], [words.newChat, false]], lines, input, focus: within(t, P.paste, P.sent) || within(t, T.ASK.type - 0.2, T.ASK.sent), rise: Math.min(3, Math.floor(frame / 3)) });
  pen.burst(CLAUDE_BOX.x + CLAUDE_BOX.w / 2, CLAUDE_BOX.y + 200, t - P.up, desk.HONEY, 260, 12);
}

// The dashed lines from each open client to its cat; drawn before the cats are drawn again, so they pass behind them.
function linksAt(ctx, t, lang, cam, view) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang], claudeUp = t >= T.PASTE.up + F(6);
  [0, 1, 2].forEach((k) => {
    if (t < T.UP[k] + F(6)) return;
    if ((claudeUp || (view.over && t >= T.PASTE.up)) && view.behindClaude.includes(k)) return;   // their windows are behind Claude's now
    desk.link(pen, ...view.link(cam, k, view.codex[k], false), k === 0 && within(t, T.SYNC.send, T.SYNC.calm) ? words.sync : '');
  });
  if (claudeUp) desk.link(pen, ...view.link(cam, 3, view.claude, true), within(t, 30, 32) ? words.sync : '');
}

function desktopAt(ctx, t, lang, cam, view) {
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang], CLAUDE_BOX = view.claude;
  // Where the clients sit over the window, Claude's covers the others from the moment it starts to rise.
  [0, 1, 2].forEach((k) => { if (t >= T.UP[k] && !(view.over && t >= T.PASTE.up && view.behindClaude.includes(k))) codexWindow(pen, t, lang, k, view); });
  if (t >= T.PASTE.up) claudeWindow(pen, t, lang, view);
  // What passes through Catshelf: the call arriving, three jobs out, three results back.
  const C = T.CALL, catAt = (k) => toFrame(cam, app.cardCentre(k), 104);
  over.flight(ctx, t, T.ASK.reply, 0.5, [CLAUDE_BOX.x + 60, CLAUDE_BOX.y + 150], catAt(3), words.tasks, 70);
  story.CALLEES.forEach((callee, j) => {
    over.flight(ctx, t, C.out[j], 0.5, catAt(3), catAt(callee), words.jobs[j], 36);
    over.flight(ctx, t, C.back[j], 0.5, catAt(callee), catAt(3), words.result, 36);
  });
}

// The official sign-in window that opens over Catshelf when "Create and sign in" is pressed.
function signInWindow(ctx, t, lang) {
  const R = T.RECRUIT;
  if (t < R.create + F(4) || t >= R.close) return;
  const pen = new Pen(ctx, 1, DAY), words = FILM[lang].signin, box = { x: 1132, y: 72, w: 728, h: 316 };
  const frame = Math.floor((t - R.create - F(4)) * FPS + 1e-6), done = t >= R.signed;
  desk.client(pen, box, {
    lang, t, title: 'Codex · ' + words.title, rise: Math.min(3, Math.floor(frame / 3)),
    panel: (c, x, y, w, h) => {
      const cx = x + w / 2;
      if (!done) {
        desk.sys(c, words.waiting, cx, y + h / 2 - 4, 30, '#1B1F24', { weight: 600, align: 'center' });
        for (let d = 0; d < 3; d += 1) pen.rect(cx - 26 + d * 22, y + h / 2 + 28, 10, 10, Math.floor(t * 6) % 3 === d ? '#1B1F24' : '#C9C9C4');
        return;
      }
      const pop = t - R.signed < F(4) ? 6 : 0;
      pen.rect(cx - 36 - pop, y + 36 - pop, 72 + pop * 2, 72 + pop * 2, '#2F7D3B');
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 10; c.lineCap = 'square'; c.beginPath(); c.moveTo(cx - 18, y + 74); c.lineTo(cx - 4, y + 88); c.lineTo(cx + 20, y + 58); c.stroke();
      desk.sys(c, words.done, cx, y + 160, 34, '#1B1F24', { weight: 700, align: 'center' });
      desk.sys(c, words.keep, cx, y + 206, 24, '#5A616B', { align: 'center' });
    }
  });
  pen.burst(box.x + box.w / 2, box.y + 140, t - R.signed, '#2F7D3B', 220, 12);
}

/* ── Close-up extras in frame pixels ───────────────── */
function closeExtras(ctx, t, lang, cam, plan) {
  const view = plan.view;
  if (!view.over) signInWindow(ctx, t, lang);
  // 18 s: the papers that were lying about fly up from the floor into their rows.
  const pen = new Pen(ctx, 1, DAY), ledger = story.ledgerAt(T.LEDGER.papers + 1, lang);
  ledger.rows.forEach((row, n) => {
    const j = n - 5, start = T.LEDGER.papers + j * 0.05, age = t - start;
    if (j < 0 || age < 0 || age >= story.PAPER_FLIGHT) return;
    const p = ease(age / story.PAPER_FLIGHT, 6), to = toFrame(cam, 108, app.rowTop(ledger, n) + 10), from = view.paperFrom(j);
    const x = Math.round(mix(from[0], to[0], p) / 4) * 4, y = Math.round(mix(from[1], to[1], p) / 4) * 4;
    pen.rect(x - 4, y - 4, 56, 40, '#100A0D'); pen.rect(x, y, 48, 32, '#E9DCC0'); pen.rect(x + 8, y + 8, 28, 4, '#8E7B68'); pen.rect(x + 8, y + 20, 20, 4, '#8E7B68');
  });
  if (view.over) return;                               // the rest is laid out for the wide frame only
  // 41 s: the session info goes to the other computer.
  if (within(t, T.SEND.item, T.WAYS.open)) {
    const target = over.otherComputer(ctx, t, lang), button = plan.send.send;
    over.flight(ctx, t, T.SEND.press, 0.5, toFrame(cam, button.x + button.w / 2, button.y + button.h / 2), target, '', 110);
  }
  // 45 s: the AI at its terminal.
  const W = T.WAYS;
  if (within(t, W.command - 0.1, T.LOOKS.open)) {
    const first = '$ "$catshelf" --cli profiles discover --scan home', second = '$ "$catshelf" --cli profiles register --app codex --session-root "$HOME/.codex"';
    const lines = [{ text: typedOver(first, t, W.command, 0.3) }];
    if (t >= W.command + 0.35) lines.push({ text: typedOver(second, t, W.command + 0.35, 0.4) });
    over.terminal(ctx, t, lang, lines);
  }
  if (within(t, T.LOCK.shut, T.NIGHT.settle)) over.lock(ctx, t, lang);
}

/* ── Cursor position ───────────────────────────────── */
function cursorAt(t, plan, cam) {
  const keys = plan.cursor;
  if (t < keys[0][0] || t >= T.NIGHT.settle) return null;
  let a = keys[0], b = keys[0];
  for (let i = 0; i < keys.length; i += 1) { if (keys[i][0] <= t + 1e-9) { a = keys[i]; b = keys[Math.min(keys.length - 1, i + 1)]; } }
  const at = (key) => (key[3] === 'w' ? toFrame(cam, key[1], key[2]) : [key[1], key[2]]);
  const p = b === a || b[0] === a[0] ? 1 : ease((t - a[0]) / (b[0] - a[0]), 8), pa = at(a), pb = at(b);
  const click = keys.find((key) => key[4] && t >= key[0] - 1e-9 && t < key[0] + 0.16);
  return { x: Math.round(mix(pa[0], pb[0], p) / 2) * 2, y: Math.round(mix(pa[1], pb[1], p) / 2) * 2, click: click ? { at: at(click), age: t - click[0] } : null, carry: Boolean(a[5] && b[5]) };
}

/* ── One picture: the window, what is open over or beside it, the cursor ── */
let layer = null;
function scene(ctx, t, lang, plan, cam, options = {}) {
  const view = plan.view;
  if (cam.d === 0) {
    ctx.setTransform(2, 0, 0, 2, cam.ox, cam.oy);
    drawWindowAt(ctx, t, lang, plan, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (view.over && cam.clients) { linksAt(ctx, t, lang, cam, view); desktopAt(ctx, t, lang, cam, view); }
    closeExtras(ctx, t, lang, cam, plan);
    // Lights out in steps: after the lamp's core goes, night comes over the desk as a dither, never as a fade.
    if (t >= T.NIGHT.dim[1]) new Pen(ctx, 1, NIGHT).dither(0, 0, view.width, view.height, app.NIGHT_DESK, 10, 4);
    else if (t >= T.NIGHT.dim[0]) new Pen(ctx, 1, NIGHT).dither(0, 0, view.width, view.height, app.NIGHT_DESK, 5, 4);
  } else {
    desk.desktop(new Pen(ctx, 1, DAY), lang, { t, hop: 5.25, dock: [{ label: 'Codex', open: t >= T.UP[0] }, { label: 'Claude', open: t >= T.PASTE.up }, { label: 'Kimi Code' }, { label: 'Qwen Code' }, { label: FILM[lang].terminal, dark: true }] });
    const w = app.W * cam.scale, h = app.H * cam.scale;
    ctx.fillStyle = '#1E242D'; ctx.fillRect(cam.ox + 8, cam.oy + 10, w + 2, h + 2);
    ctx.fillStyle = '#0E1116'; ctx.fillRect(cam.ox - 2, cam.oy - 2, w + 4, h + 4);
    if (cam.d === 1) {
      ctx.save(); ctx.beginPath(); ctx.rect(cam.ox, cam.oy, w, h); ctx.clip();
      ctx.setTransform(1, 0, 0, 1, cam.ox, cam.oy);
      const state = drawWindowAt(ctx, t, lang, plan, 1);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      linksAt(ctx, t, lang, cam, view);
      ctx.setTransform(1, 0, 0, 1, cam.ox, cam.oy);
      app.catsAgain(new Pen(ctx, 1, DAY), state);
      ctx.restore(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      desktopAt(ctx, t, lang, cam, view);
    } else {
      // Between the two places: the close-up picture, scaled in whole steps without smoothing.
      if (!layer) { layer = document.createElement('canvas'); layer.width = app.W * 2; layer.height = app.H * 2; }
      const lctx = layer.getContext('2d');
      lctx.setTransform(2, 0, 0, 2, 0, 0);
      drawWindowAt(lctx, t, lang, plan, 2);
      ctx.drawImage(layer, cam.ox, cam.oy, w, h);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (options.cursor !== false) over.cursor(ctx, cursorAt(t, plan, cam));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/*
 * One picture of the film taken out of its running order, for print: what the film shows at shot.t, from where the
 * film's camera stands then or close on the window at shot.tilt, with or without the caption and the cursor.
 */
function still(ctx, lang, shot) {
  const plan = planFor(lang, ctx);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  scene(ctx, shot.t, lang, plan, shot.tilt === undefined ? camera(shot.t, plan) : closeAt(0, shot.tilt), { cursor: shot.cursor !== false });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (shot.caption !== false) over.caption(ctx, shot.t, lang);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/* ── One frame of the film ─────────────────────────── */
function render(ctx, time, lang) {
  const t = Math.max(0, Math.min(END - 1 / FPS, time));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const plan = planFor(lang, ctx);
  if (t < T.LAMP[0]) hook.draw(new Pen(ctx, 1, NIGHT), t, lang);
  else if (t >= T.NIGHT.dim[2]) over.endCard(ctx, t, lang);
  else scene(ctx, t, lang, plan, camera(t, plan));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  over.caption(ctx, t, lang);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Named pictures that are not frames of the film: the cover, the caption boxes, and the Catshelf window alone and
// whole (1920×1680) at a time t, for matching the drawing to the app.
function renderState(ctx, name, lang, still = {}) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  if (name === 'cover') { over.cover(ctx, lang); return null; }
  if (name === 'captions') {
    return SHOTS.map((at) => { const box = over.captionBox(ctx, at + 0.5, lang); return box ? { at, x: box.x * 2, y: box.y * 2, w: box.w * 2, h: 80, text: box.parts.join('') } : { at, text: '' }; });
  }
  const plan = planFor(lang, ctx);
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  drawWindowAt(ctx, still.t || 0, lang, plan, 2);
}

module.exports = { render, renderState, scene, still, FPS, WIDTH, HEIGHT, END, SHOTS, T, camera, cameraMoves, planFor, toFrame, closeAt, desktopCam, VIEWS, LEDGER_TILT, PLATES_TILT };
