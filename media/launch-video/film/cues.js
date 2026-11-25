'use strict';

/*
 * When each sound plays. Names are the app's own sounds (the tables in
 * src/pixel/chip.js, the events in src/pixel/sfx.js): a click is "tick", a
 * dialog "open"/"close", a client starting "launch", ticking a row "check",
 * the copy seal "stamp", something leaving "send" and arriving "arrive", a
 * cat's voice "mew", and each typed character one "text".
 */

const { FILM } = require('./strings.js');
const { T } = require('./times.js');

const spread = (start, count, every) => Array.from({ length: count }, (_, i) => start + i * every);

function cues(lang) {
  const words = FILM[lang], name = [...words.names.work], query = [...words.query];
  const typing = name.map((_, i) => T.RECRUIT.type + i * (name.length > 2 ? 0.125 : 0.25));
  const C = T.CALL, W = T.WAYS, L = T.LEDGER;
  const list = [
    [3.5, 'select'],                                                   // the idea
    [T.LAMP[0], 'lampOn'],
    [T.RECRUIT.click, 'tick'], [T.RECRUIT.click + 0.05, 'open'],
    ...typing.map((at) => [at, 'text']),
    [T.RECRUIT.create, 'tick'], [T.RECRUIT.create + 0.07, 'launch'], [T.RECRUIT.signed, 'check'], [T.RECRUIT.close, 'close'],
    [T.LAND[0], 'mew', 0],
    ...T.OPEN.map((at) => [at, 'tick']), ...T.UP.map((at) => [at, 'launch']),
    // 14–18: work in the client; one runs low.
    [T.SYNC.focus, 'tick'], ...spread(T.SYNC.type, 4, 0.1).map((at) => [at, 'text']), [T.SYNC.three, 'select'], [T.SYNC.five, 'zap'],
    [16, 'tired'],
    // 18–24: the ledger.
    [L.papers, 'open'], [L.pick, 'select'], [L.fresh, 'arrive'], [L.menu, 'tick'], [L.tag, 'check'], [L.filter, 'tick'], [L.clear, 'tick'],
    ...query.map((_, i) => [L.search + i * (query.length > 2 ? 0.05 : 0.25), 'text']),
    // 24–28: out of quota; copy.
    [T.DRAIN.tired, 'tired'], [T.COPY.check, 'check'], [T.COPY.press, 'stamp'],
    // 28–36: paste, read on, one line, three calls.
    [T.PASTE.open, 'tick'], [T.PASTE.up, 'launch'], [T.PASTE.paste, 'check'], [T.PASTE.read, 'text'], [T.PASTE.go, 'text'],
    ...spread(T.ASK.type, 10, 0.12).map((at) => [at, 'text']), [T.ASK.sent, 'send'], [T.ASK.reply, 'ready'],
    ...C.out.map((at) => [at, 'send']),
    // 38–42: results come back; another computer.
    ...C.back.map((at) => [at + 0.5, 'arrive']), [C.cheer, 'ready'],
    [T.SEND.menu, 'tick'], [T.SEND.item, 'tick'], [T.SEND.item + 0.05, 'open'], [T.SEND.press, 'send'], [T.SEND.land, 'arrive'],
    // 42–48: four ways; coats.
    [W.open, 'tick'], [W.open + 0.05, 'open'], ...spread(W.type, 3, 0.1).map((at) => [at, 'text']),
    [W.tab[1], 'tick'], ...W.ticks.map((at) => [at, 'check']), [W.tab[2], 'tick'], [W.drop, 'check'], [W.tab[3], 'tick'],
    ...spread(W.command, 12, 0.06).map((at) => [at, 'text']),
    ...W.lands.map((at, i) => [at, 'mew', i + 1]),
    ...T.LOOKS.clicks.map((at) => [at, 'tick']),
    [T.LOCK.shut, 'close'],
    // 50–60: lights out.
    [T.NIGHT.dim[0], 'lampOff'], [T.NIGHT.lines[0] + 0.15, 'mew', 2], [T.NIGHT.eye + 0.05, 'mew', 0]
  ];
  return list.sort((a, b) => a[0] - b[0]);
}

module.exports = { cues };
