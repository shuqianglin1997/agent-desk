'use strict';

/*
 * When each sound plays. Names are the app's own sounds (the tables in
 * src/pixel/chip.js, the events in src/pixel/sfx.js): a click is "tick", a
 * dialog "open"/"close", a client starting "launch", a cat's voice "mew", and
 * each typed character one "text".
 */

const film = require('./film.js');
const { FILM } = require('./strings.js');

function cues(lang) {
  const { LAMP, RECRUIT, LAND, OPEN, UP } = film;
  const name = [...FILM[lang].names.work];
  const typing = name.map((_, i) => RECRUIT.type + i * (name.length > 2 ? 0.125 : 0.25));
  const list = [
    [3.5, 'select'],                              // the idea
    [LAMP[0], 'lampOn'],
    [RECRUIT.click, 'tick'], [RECRUIT.click + 0.05, 'open'],
    ...typing.map((at) => [at, 'text']),
    [RECRUIT.create, 'tick'], [RECRUIT.create + 0.07, 'launch'],
    [RECRUIT.signed, 'check'],
    [RECRUIT.close, 'close'],
    [LAND[0], 'mew', 0],
    ...OPEN.map((at) => [at, 'tick']),
    ...UP.map((at) => [at, 'launch'])
  ];
  return list.sort((a, b) => a[0] - b[0]);
}

module.exports = { cues };
