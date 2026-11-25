'use strict';

/*
 * The README loop: eight seconds of the Catshelf window that end where they
 * began.
 *
 * The window is drawn by app.js as in the film, at 826×690 — a real window
 * resized to fit the width GitHub gives a README (reference/capture.js checked
 * the app at that width: the same toolbar steps, the same column rule) — and
 * at twice its size, so it is sharp on a dense screen and an exact half on an
 * ordinary one. No camera, no cursor: five accounts on the shelf, each in a
 * different state, and the ledger under them.
 *
 *   one types (1 running) · one sweats behind a stack of paper (3 running) ·
 *   one is asleep · one is on duty · one is out of energy, flat
 *   (the sleeper sits third: there its z's rise into the empty part of the row above, in both languages,
 *   and not over "Quota overview" or "Recruit")
 *   4.5 s  the first one's chat is answered: "New reply", its cat gets mail
 *   6.0 s  one of the busy one's three is answered too
 *   7.0 s, 8.0 s  the person carries each on in its client; it runs again
 *
 * Every state is one the app shows, and a chat that is being written is never
 * marked as a new reply (src/session-marks.js), so the last step is real too.
 * Each cat's action repeats a whole number of times in the eight seconds, or
 * meets a frame identical to its first, so the loop has no seam.
 */

const { Pen, DAY, loop, within } = require('./draw.js');
const app = require('./app.js');
const over = require('./overlay.js');
const { ui, FILM, CAST, SESSIONS, SHORT } = require('./strings.js');

const SIZE = { w: 826, h: 690 }, WIDTH = SIZE.w * 2, HEIGHT = SIZE.h * 2, FPS = 50, SECONDS = 8;
const PLACE = { cx: SIZE.w / 2, y: 640 };              // the caption plate sits on the footer, clear of every row
const AT = { first: 4.5, second: 6, again: [7, 8] };   // replies arrive; the chats run again

// The five on the shelf (indexes into CAST), their energy, and the chats in the ledger: [session, owner, when, tag].
const SHELF = [0, 2, 5, 3, 4], ENERGY = [82, 46, 88, 71, 4];
const ROWS = [['skeleton', 0, 0], ['leak', 1, 0, 0], ['scripts', 1, 0], ['orders', 1, 1], ['cache', 3, 3, 3], ['report', 4, 5], ['export', 2, 6]];
const sinceFrames = (t, start) => Math.floor((t - start) * 60 + 1e-6);
const pop = (t, start) => { const frame = sinceFrames(t, start); return frame >= 0 && frame < 7 ? 4 : frame >= 7 && frame < 14 ? 2 : 0; };

function stateAt(t, lang) {
  const words = FILM[lang];
  const firstFresh = within(t, AT.first, AT.again[0]), secondFresh = within(t, AT.second, AT.again[1]);
  const running = [firstFresh ? 0 : 1, secondFresh ? 2 : 3, 0, 0, 0];
  const accounts = SHELF.map((castIndex, k) => {
    const who = CAST[castIndex], pct = ENERGY[k], level = pct < 10 ? 'exhausted' : pct < 30 ? 'tired' : pct < 60 ? 'steady' : 'fresh';
    let label = ui(lang, 'state.onduty'), dot = 'onduty', spec = loop('onduty', t), papers = 0;
    if (running[k] > 0) {
      const action = running[k] >= 2 ? 'busy' : 'working';
      label = ui(lang, 'card.running', { n: running[k] }); dot = action; papers = running[k] >= 2 ? running[k] : 0;
      // The busy loop is a sweat drop and then six rounds of typing: starting it sixteen frames in, its last frame here meets a frame like its first.
      spec = action === 'busy' ? loop('busy', t + 16 / 9) : loop('working', t);
    } else if (k === 0) spec = loop('onduty', t - AT.first);
    if (k === 2) { label = ui(lang, 'state.nap'); dot = ''; spec = loop('nap', t + 0.5); }
    if (k === 4) { label = ui(lang, 'state.play'); dot = 'play'; spec = loop('spent', t); }
    return {
      name: words.names[who.name], client: who.client, plateDy: 0,
      cat: { look: who.look, collar: who.collar, spec, accessory: 'none', papers },
      state: { label, dot }, quota: { pips: Math.max(1, Math.round(pct / 20)), level, text: pct + '%' },
      mail: k === 0 && firstFresh ? 1 : 0
    };
  });
  const rows = ROWS.map(([id, owner, when, tag], n) => {
    const session = SESSIONS.find((entry) => entry.id === id), who = CAST[SHELF[owner]];
    const fresh = (n === 0 && firstFresh) || (n === 3 && secondFresh);
    return {
      id, title: session[lang], owner: words.names[who.name] + ' · ' + who.client, project: session.project, when: words.when[when], source: who.client, tag,
      running: n < 4 && !fresh, fresh, pop: fresh ? pop(t, n === 0 ? AT.first : AT.second) : 0
    };
  });
  const fresh = (firstFresh ? 1 : 0) + (secondFresh ? 1 : 0);
  return {
    lang, t, size: SIZE, lamp: 3, head: { count: accounts.length, quota: true },
    roster: { accounts, scope: 'all', allDy: 0, allMeta: ui(lang, 'roster.allMeta', { agents: accounts.length, n: rows.length }) },
    ledger: {
      title: ui(lang, 'session.titleAll'), total: rows.length, count: rows.length, fresh, freshPop: Math.max(pop(t, AT.first), pop(t, AT.second)),
      rows, twoLine: true, scope: 'all', filter: null, query: '', checked: 0
    },
    footer: { text: ui(lang, 'status.ready') }
  };
}

function captionAt(t, lang) {
  let hit = null;
  SHORT[lang].loop.forEach((entry) => { if (t >= entry[0] - 1e-9) hit = entry; });
  return { raw: hit[1], age: t - hit[0] };
}

function render(ctx, time, lang) {
  const t = ((time % SECONDS) + SECONDS) % SECONDS;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.imageSmoothingEnabled = false;
  app.drawWindow(new Pen(ctx, 2, DAY), stateAt(t, lang));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const caption = captionAt(t, lang);
  over.plate(ctx, over.plateBox(ctx, caption.raw, caption.age, PLACE));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Where each caption sits once it has landed (frame pixels).
function captionBoxes(ctx, lang) {
  return SHORT[lang].loop.map(([at, raw]) => { const box = over.plateBox(ctx, raw, 1, PLACE); return { at, x: (box.x - 2) * 2, y: (box.y - 2) * 2, w: (box.w + 8) * 2, h: 96, text: box.parts.join('') }; });
}

module.exports = { render, stateAt, captionBoxes, SIZE, WIDTH, HEIGHT, FPS, SECONDS, AT };
