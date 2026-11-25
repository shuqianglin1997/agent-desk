'use strict';

/*
 * What the Catshelf window shows at time t: which cats are on the shelf and
 * what each is doing, what the ledger lists, which dialog is open.
 *
 * Every state here is one the app can really be in. A card's line follows the
 * app's own rule (src/renderer/views/roster.js): a cat with conversations
 * running says "N running" and works, is busy at 2–3 and frantic at 4 or
 * more; a client that is open and quiet is "on duty"; one used today and
 * closed is "playing"; energy at the lowest step lays the cat flat.
 */

const { CatArt, clamp, mix, glide, loop, once, within } = require('./draw.js');
const app = require('./app.js');
const { ui, FILM, CAST, JOINED, SESSIONS } = require('./strings.js');
const { FPS, T, F } = require('./times.js');

const stepsOver = (t, start, frames, steps) => Math.round(clamp((t - start) * FPS / frames) * steps) / steps;
// A nameplate dropping from behind the shelf: fast, 4px past, back.
function plateDrop(t, start) {
  const frame = Math.floor((t - start) * FPS + 1e-6);
  if (frame < 0) return null;
  return [-112, -112, -52, -52, -18, -18, -4, -4, 4, 4][frame] ?? 0;
}

const EVERYONE = CAST.concat(JOINED);
const LANDS = T.LAND.concat(T.WAYS.lands);
const landedAt = (t) => LANDS.filter((at) => t >= at).length;
// With more than six cats the roster has scrolled so the newest sits at the right end.
function scrollAt(t) {
  let scroll = 0;
  T.WAYS.lands.forEach((land) => { scroll += app.CARD.pitch * stepsOver(t, land - 1 / 3, 6, 3); });
  return Math.round(scroll / 2) * 2;
}

/* ── Conversations running, by account ─────────────── */
const C = T.CALL;
const CALLEES = [0, 5, 2];                              // who the lead calls, in order: implement, research, write tests
const callLanded = (j) => C.out[j] + 0.5, callDone = (j) => C.back[j] + 0.5;

function runningAt(t, k) {
  if (k === 0) {
    const own = t < T.SYNC.send ? 0 : t < T.SYNC.three ? 1 : t < T.SYNC.five ? 3 : t < T.SYNC.calm ? 5 : t < T.LEDGER.fresh ? 2 : 0;
    return own + (within(t, callLanded(0), C.back[0]) ? 1 : 0);
  }
  if (k === 1) return within(t, 23, T.DRAIN.flat) ? 1 : 0;
  if (k === 2) return within(t, callLanded(2), C.back[2]) ? 1 : 0;
  if (k === 3) return within(t, 30, 32) || within(t, T.ASK.sent, C.cheer) ? 1 : 0;
  if (k === 5) return within(t, callLanded(1) + 0.5, C.back[1]) ? 1 : 0;
  return 0;
}

function quotaAt(t, k) {
  const base = [92, 81, 100, 78, 34, 88, 100, 64, 87, 71, 95][k];
  if (k === 1 && t >= T.DRAIN.start) { const s = T.DRAIN.steps; return t < s[0] ? 81 : t < s[1] ? 58 : t < s[2] ? 36 : t < s[3] ? 18 : 4; }
  if (k === 4 && t >= T.LOW.yellow) return t < T.LOW.red ? 18 : 4;
  return base;
}

function accountAt(t, lang, k) {
  const who = EVERYONE[k], words = FILM[lang], land = LANDS[k];
  const name = who.name ? words.names[who.name] : who.label;
  if (t < land - 1 / 3) return { name, client: who.client, plateDy: null, cat: null, state: { label: '', dot: '' }, quota: { pips: 0, level: 'fresh', text: '' } };
  const pct = quotaAt(t, k), level = pct < 10 ? 'exhausted' : pct < 30 ? 'tired' : pct < 60 ? 'steady' : 'fresh';
  const running = runningAt(t, k);
  // Is its client open? Codex accounts from their "Open" click; Claude from its click at 28.25.
  const openAt = k < 3 ? T.OPEN[k] : k === 3 ? T.PASTE.open : Infinity, upAt = openAt + 0.25;
  let action = 'play', label = ui(lang, 'state.play'), dot = 'play', spec = null, pressed = false, hover = null, accessory = 'none', papers = 0;
  if (t >= openAt) {
    if (t < upAt) { action = 'arriving'; label = ui(lang, 'state.arriving'); dot = 'arriving'; pressed = t < openAt + F(5); hover = 'launch'; }
    else { action = 'onduty'; label = ui(lang, 'state.onduty'); dot = 'onduty'; spec = once('cheer', t - upAt); }
  }
  if (k === 5 && within(t, T.LOW.nap, callLanded(1))) { action = 'nap'; label = ui(lang, 'state.nap'); dot = ''; spec = once('settle', t - T.LOW.nap); }
  if (k === 5 && within(t, callLanded(1), callLanded(1) + 1)) spec = once('wake', t - callLanded(1));
  if (running > 0) {
    action = running >= 4 ? 'frantic' : running >= 2 ? 'busy' : 'working';
    label = ui(lang, 'card.running', { n: running }); dot = action; papers = running >= 2 ? running : 0; spec = k === 5 ? spec : null;
  } else if (level === 'exhausted' && action !== 'arriving') action = 'spent';
  else if (level === 'tired' && action !== 'arriving') action = 'tired';
  if (running > 0 && level === 'tired' && k === 1 && t >= T.DRAIN.tired) action = 'tired';
  // The lead wears a bow while two or more of its calls are out; it hops when the call arrives and cheers when all are back.
  if (k === 3) {
    if (within(t, C.out[1], C.back[1] + 0.5)) accessory = 'bow';
    spec = once('hop', t - C.lead) || once('cheer', t - C.cheer) || spec;
  }
  CALLEES.forEach((callee, j) => { if (callee === k) spec = once('hop', t - callDone(j)) || spec; });
  if (t >= T.NIGHT.settle) {
    const order = Math.max(0, k - (landedAt(60) - 6)), at = T.NIGHT.settle + order * 0.15;
    if (t >= at) { spec = once('settle', t - at) || { pose: 'sleep' }; label = ui(lang, 'state.nap'); dot = ''; papers = 0; }
  }
  spec = spec || once('arrive', t - (land - 1 / 3)) || loop(action, t + k * 0.37);
  return {
    name, client: who.client, plateDy: plateDrop(t, land - 0.25), pressed, hover,
    cat: { look: who.look, collar: who.collar, spec, accessory, papers },
    state: { label, dot }, quota: { pips: Math.max(1, Math.round(pct / 20)), level, text: pct + '%' },
    mail: k === 0 && within(t, T.LEDGER.fresh, T.DRAIN.start) ? 2 : 0,
    started: Number.isFinite(upAt) ? t - upAt : -1
  };
}

/* ── The ledger ────────────────────────────────────── */
const PAPER_FLIGHT = 0.5;
// The six conversations that were lying about fly in at 18 s, one after another.
const flownAt = (j) => T.LEDGER.papers + j * 0.05 + PAPER_FLIGHT;

function sessionRow(t, lang, session) {
  const words = FILM[lang], owner = CAST[session.owner];
  const row = {
    id: session.id, owner: session.owner, title: session[lang], ownerLabel: words.names[owner.name] + ' · ' + owner.client,
    project: session.project, when: words.when[session.when], source: owner.client, tag: session.tag
  };
  const appear = { skeleton: T.SYNC.send, refund: T.SYNC.three, login: T.SYNC.three, deps: T.SYNC.five, deploy: T.SYNC.five }[session.id];
  const flown = SESSIONS.filter((s) => s.owner !== 0 || !['skeleton', 'refund', 'login', 'deps', 'deploy'].includes(s.id)).indexOf(session);
  row.since = appear !== undefined ? t - appear : t - flownAt(flown);
  if (session.id === 'skeleton' || session.id === 'login') { row.running = within(t, appear, T.LEDGER.fresh); row.fresh = t >= T.LEDGER.fresh; }
  if (['refund', 'deps', 'deploy'].includes(session.id)) row.running = within(t, appear, T.SYNC.calm);
  if (session.id === 'skeleton' && t >= T.LEDGER.tag) row.tag = 0;
  if (session.id === 'orders') { row.running = within(t, 23, T.DRAIN.flat); if (t >= 23) row.when = words.when[0]; }
  return row;
}

function hubRow(t, lang, j) {
  const words = FILM[lang], target = CAST[CALLEES[j]], done = t >= callDone(j);
  const seconds = Math.max(0, Math.floor(t - C.out[j]));
  return {
    id: 'job' + j, title: words.jobs[j], project: 'shop-api', when: words.when[0], since: t - C.out[j],
    hub: { state: done ? 'completed' : t < callLanded(j) ? 'starting' : 'running', elapsed: `0:${String(seconds).padStart(2, '0')}`, pair: ui(lang, 'hub.pair', { from: words.names[CAST[3].name], to: words.names[target.name] }) }
  };
}

function ledgerAt(t, lang) {
  const words = FILM[lang], L = T.LEDGER;
  // What exists.
  let rows = SESSIONS.map((session) => sessionRow(t, lang, session)).filter((row) => row.since >= 0);
  if (t >= 23) rows.sort((a, b) => (b.id === 'orders') - (a.id === 'orders'));
  if (t >= 30) rows.unshift({ id: 'takeover', owner: 3, title: words.takeover, ownerLabel: words.names[CAST[3].name] + ' · ' + CAST[3].client, project: 'shop-api', when: words.when[0], source: CAST[3].client, running: runningAt(t, 3) > 0, since: t - 30 });
  const total = rows.length + (t >= C.out[0] ? [0, 1, 2].filter((j) => t >= C.out[j]).length : 0);
  // What is listed: one cat's rows between 19.25 and 24, then by tag, then by search.
  const scope = within(t, L.pick, T.DRAIN.start) ? 0 : 'all';
  if (scope !== 'all') rows = rows.filter((row) => row.owner === scope);
  const filter = within(t, L.filter, L.clear) ? 0 : null;
  if (filter !== null) rows = rows.filter((row) => row.tag === filter);
  const letters = [...words.query], per = letters.length > 2 ? 0.05 : 0.25;
  const typed = within(t, L.search, T.DRAIN.start) ? letters.slice(0, Math.min(letters.length, Math.floor((t - L.search) / per + 1e-6) + 1)).join('') : '';
  if (typed) rows = rows.filter((row) => row.title.toLowerCase().includes(typed.toLowerCase()));
  if (typed && rows.length === 1) rows[0].lit = true;
  // Background chats sit on top, newest first.
  if (t >= C.out[0] && scope === 'all') rows = [2, 1, 0].filter((j) => t >= C.out[j]).map((j) => hubRow(t, lang, j)).concat(rows);
  // Rows a person's action brought in are written in from the left over six frames.
  rows.forEach((row) => { const frame = Math.floor(row.since * FPS + 1e-6); row.dx = frame >= 0 && frame < 6 ? [-24, -12, -6, -2, -2, 0][frame] : 0; });
  const picked = t >= T.COPY.check && t < T.WAYS.open;
  rows.forEach((row) => {
    if (row.id === 'orders' && picked) { row.checked = true; const frame = Math.floor((t - T.COPY.check) * FPS + 1e-6); row.stamp = frame < 4 ? 2 : frame < 8 ? 1 : 0; }
    if (row.id === 'skeleton' && within(t, L.menu - 0.2, L.tag + 0.1)) { row.hover = true; row.tagButton = true; }
    if (row.id === 'orders' && within(t, T.COPY.press, T.COPY.press + 0.32)) row.lit = true;
    if (row.fresh) { const frame = Math.floor((t - L.fresh) * FPS + 1e-6); row.pop = frame < 7 ? 4 : frame < 14 ? 2 : 0; }
    if (row.hub && within(t, 36, 36.25)) row.lit = true;
    row.owner = row.ownerLabel;
  });
  const freshCount = t >= L.fresh ? 2 : 0;
  const freshFrame = Math.floor((t - L.fresh) * FPS + 1e-6);
  return {
    title: scope === 'all' ? ui(lang, 'session.titleAll') : ui(lang, 'session.titleAgent', { name: words.names[CAST[scope].name] }), total,
    count: scope === 'all' ? total : rows.length, fresh: freshCount, freshPop: freshFrame >= 0 && freshFrame < 7 ? 4 : freshFrame >= 7 && freshFrame < 14 ? 2 : 0,
    rows, twoLine: scope === 'all', scope, filter, query: typed, searching: within(t, L.search - 0.1, T.DRAIN.start), caret: Math.floor(t * 2) % 2 === 0,
    checked: picked ? 1 : 0, copyPressed: within(t, T.COPY.press, T.COPY.press + F(6)), sendOpen: within(t, T.SEND.menu, T.SEND.item),
    emptyText: rows.length ? '' : ui(lang, total ? 'session.empty.filtered' : 'session.empty.noneAll')
  };
}

/* ── The whole window ──────────────────────────────── */
function windowState(t, lang, plan) {
  const words = FILM[lang], N = T.NIGHT;
  // The lamp: three steps up at 4 s, three steps down at 51 s.
  let lamp = t < T.LAMP[1] ? 1 : t < T.LAMP[2] ? 2 : 3;
  // Going out, the lamp loses its core first; the second step is a dither of night over everything (film.js).
  if (t >= N.dim[0]) lamp = 2;
  const landed = landedAt(t);
  const state = {
    lang, t, lamp, topbarDy: glide(-66, 0, t, T.LAMP[0], 8, 4),
    head: t >= T.LAMP[2] ? { count: landed, quota: landed > 0 } : null,
    footer: { dy: glide(40, 0, t, T.LAMP[0], 8, 4), mascot: t >= T.LAMP[2], global: t >= 4.9, text: null }
  };
  const rosterAt = T.LAND[0] - 1 / 3;
  if (t < rosterAt) {
    const status = ui(lang, 'roster.empty.status');
    state.empty = {
      seat: stepsOver(t, T.LAMP[2], 6, 3), words: t >= 4.6, pressed: within(t, T.RECRUIT.click, T.RECRUIT.click + F(5)),
      cat: t >= 4.4 ? { look: 'orange', collar: '#2f9e8f', accessory: 'none', spec: once('arrive', t - 4.4) || loop('rest', t) } : null
    };
    state.ledger = t >= 4.7 ? { open: stepsOver(t, 4.7, 6, 3), title: ui(lang, 'session.titleAll'), count: 0, fresh: 0, rows: [], emptyText: t >= 4.8 ? ui(lang, 'session.empty.noAgents') : '' } : null;
    if (t >= 4.9) { state.footer.text = status; state.footer.typed = Math.floor((t - 4.9) * 45); }
  } else {
    const accounts = EVERYONE.map((_, k) => accountAt(t, lang, k));
    const scroll = scrollAt(t), reach = (k) => app.cardX(k) + app.CARD.w + 8;
    let shelfEnd = app.ALL.x + app.ALL.w + 8;
    T.LAND.forEach((land, k) => { shelfEnd = Math.max(shelfEnd, Math.round(mix(k ? reach(k - 1) : 18, reach(k), stepsOver(t, land - 1 / 3, 6, 3)) / 2) * 2); });
    const ledger = ledgerAt(t, lang);
    const links = CALLEES.map((to, j) => (within(t, callLanded(j), C.back[j]) ? { from: 3, to } : null)).filter(Boolean);
    state.roster = {
      accounts, scope: ledger.scope, allDy: plateDrop(t, T.LAND[0] - 0.25), photo: t >= T.LAND[0] - 0.25, shelfEnd: Math.min(shelfEnd, app.ROSTER_RIGHT), bracket: t >= T.LAND[0],
      scroll, links, allMeta: ui(lang, 'roster.allMeta', { agents: landed, n: ledger.total })
    };
    if (ledger.scope !== 'all') accounts[ledger.scope].selected = true;
    state.ledger = ledger;
    if (t >= N.settle + 0.8) ledger.open = 1 - stepsOver(t, N.settle + 0.8, 4, 2);
    // The footer says what just happened.
    state.footer.text = t >= T.LAND[0] ? ui(lang, 'status.ready') : ui(lang, 'roster.empty.status');
    const copiedAt = T.COPY.press + 0.48;
    if (within(t, copiedAt, T.PASTE.sent)) { state.footer.text = ui(lang, 'status.sessionInfoCopied'); state.footer.typed = Math.floor((t - copiedAt) * 55); state.footer.tone = 'ok'; }
    if (within(t, copiedAt, copiedAt + 0.5)) state.footer.mascotSpec = once('hop', t - copiedAt);
    const calls = CALLEES.filter((_, j) => within(t, C.out[j], callDone(j))).length;
    if (calls) state.footer.hub = ui(lang, 'hub.footer.running', { n: calls });
    // Things that happen on top of the window, in its own coordinates.
    const fx = [];
    accounts.forEach((account, k) => { if (account.started >= 0 && account.started < 0.9 && k < 4) fx.push((pen) => app.floatLabel(pen, app.cardCentre(k, scroll), 82, ui(lang, 'fx.started'), 'ok', account.started)); });
    if (within(t, T.SAME[0], T.SAME[1])) fx.push((pen) => bracketNote(pen, app.cardX(0) + 4, app.cardX(2) + app.CARD.w - 4, 274, words.same, t - T.SAME[0]));
    if (within(t, T.DRAIN.flat, T.COPY.check - 0.25)) fx.push((pen) => pointNote(pen, app.cardCentre(1), 64, ui(lang, 'energy.exhausted'), t - T.DRAIN.flat));
    const orders = ledger.rows.findIndex((row) => row.id === 'orders');
    if (orders >= 0 && t >= T.COPY.press) {
      const R = app.rowLayout(ledger, orders);
      fx.push((pen) => app.rowSeal(pen, R.end.x, R.end.y, t - T.COPY.press));
      // The slip of paper that flies from the row to the cat in the footer: seven held steps.
      const age = t - T.COPY.press - 0.05, steps = Math.floor(age * FPS / 4);
      if (age >= 0 && steps < 7) fx.push((pen) => { const p = (steps + 1) / 7; pen.frame(Math.round(mix(R.title.x + 30, 40, p) / 2) * 2, Math.round(mix(R.title.y, app.FOOT_Y + 8, p) / 2) * 2, 14, 14, { bevel: false }); });
      fx.push((pen) => app.floatLabel(pen, 40 + 44, app.FOOT_Y + 4, ui(lang, 'fx.copied', { n: 1 }), 'ok', t - copiedAt));
    }
    if (fx.length) state.marks = (pen) => fx.forEach((draw) => draw(pen));
  }
  // The recruit dialog, first time (6.5–9.25).
  const closing = t - T.RECRUIT.close;
  if (t >= T.RECRUIT.click && closing < F(4)) {
    const frame = Math.floor((t - T.RECRUIT.click) * FPS + 1e-6);
    state.dialog = {
      kind: 'recruit', tab: 0, rise: closing >= 0 ? (closing < F(2) ? 2 : 1) : Math.min(3, Math.floor(frame / 3)),
      name: plan.typed(t), caret: Math.floor(t * 2) % 2 === 0, focus: 'name',
      pressed: within(t, T.RECRUIT.create, T.RECRUIT.create + F(6)), busy: within(t, T.RECRUIT.create, T.RECRUIT.create + 0.2),
      status: t >= T.RECRUIT.create + 0.2 ? ui(lang, 'recruit.new.done', { client: 'Codex' }) : ''
    };
  }
  return state;
}

// A film note in the "pointing" colour: a bracket under a group of things, with a tag.
function bracketNote(pen, x0, x1, y0, label, age) {
  const HONEY = '#F6D37C', INK = '#3B272C', d = [-10, -4, 2, 0][Math.min(3, Math.floor(age * FPS / 3))];
  const w = pen.width(label) + 20, cx = (x0 + x1) / 2, y = y0 + d;
  pen.rect(x0, y, x1 - x0, 4, INK); pen.rect(x0, y - 8, 4, 8, INK); pen.rect(x1 - 4, y - 8, 4, 8, INK);
  pen.rect(x0 + 2, y, x1 - x0 - 4, 2, HONEY); pen.rect(x0 + 2, y - 8, 2, 8, HONEY); pen.rect(x1 - 4, y - 8, 2, 8, HONEY);
  pen.rect(cx - w / 2 - 2, y - 10, w + 4, 24, INK); pen.rect(cx - w / 2, y - 8, w, 20, HONEY);
  pen.text(label, cx, y - 4, { colour: INK, align: 'center' });
}

// A film note pointing at one thing: a tag with a small tail.
function pointNote(pen, cx, y0, label, age) {
  const HONEY = '#F6D37C', INK = '#3B272C', d = [-10, -4, 2, 0][Math.min(3, Math.floor(age * FPS / 3))];
  const w = pen.width(label) + 20, y = y0 + d;
  pen.rect(cx - w / 2 - 2, y - 2, w + 4, 24, INK); pen.rect(cx - w / 2, y, w, 20, HONEY);
  pen.rect(cx - 4, y + 22, 8, 4, INK); pen.rect(cx - 2, y + 20, 4, 4, HONEY);
  pen.text(label, cx, y + 4, { colour: INK, align: 'center' });
}

module.exports = { windowState, accountAt, ledgerAt, runningAt, landedAt, scrollAt, EVERYONE, LANDS, CALLEES, callLanded, callDone, flownAt, PAPER_FLIGHT, bracketNote, pointNote };
void CatArt;
