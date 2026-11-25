'use strict';

/*
 * When things happen (seconds). 120 beats a minute: every shot starts on a
 * two-second bar, and what happens inside a shot starts on a beat (0.5 s) or a
 * half or quarter of one.
 */

const FPS = 60, END = 60;
// Where each shot begins; captions follow FILM[lang].captions in the same order.
const SHOTS = [0, 2, 4, 6, 9.5, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 46, 48, 50, 58];

const T = {
  LAMP: [4, 4.15, 4.3],                              // the lamp's three steps
  RECRUIT: { click: 6.5, type: 7, create: 8.5, signed: 9, close: 9.25 },
  LAND: [9.5, 10, 10.25, 10.5, 10.75, 11],           // each cat's feet touch the shelf
  SAME: [11.25, 12],                                 // "one platform, three accounts"
  OPEN: [12.25, 12.75, 13.25],                       // clicks on "Open"; the client is up a quarter second later
  // 14–16: work in the client, the cat follows.
  SYNC: { focus: 14, type: 14.05, send: 14.5, three: 15, five: 15.5, calm: 16, idle: 17 },
  // 16–18: one runs out, one falls asleep.
  LOW: { yellow: 16.25, red: 16.5, nap: 17 },
  // 18–24: one ledger.
  LEDGER: { papers: 18, pick: 19.25, fresh: 20, menu: 20.5, tag: 20.75, filter: 21.25, clear: 22, search: 22.25 },
  // 24–26: this one is out.
  DRAIN: { start: 24, steps: [24.2, 24.4, 24.6, 24.8], tired: 24.5, flat: 25 },
  // 26–28: copy where the chat lives.
  COPY: { check: 26.25, press: 26.5 },
  // 28–36: paste to another cat; it reads on; one line; it calls three.
  PASTE: { open: 28.25, up: 28.5, paste: 29, sent: 29.5, read: 30.25, go: 30.75 },
  ASK: { type: 32.2, sent: 33.5, reply: 34 },
  CALL: { lead: 34.5, out: [34.5, 34.75, 35], back: [38, 38.5, 39], cheer: 39.5 },
  // 40–42: another computer.
  SEND: { menu: 40.25, item: 40.5, press: 41, land: 41.5 },
  // 42–46: four ways to add a cat, one a second.
  WAYS: { open: 42, type: 42.2, create: 42.6, tab: [42, 43, 44, 45], ticks: [43.25, 43.5], register: 43.75, drag: 44.1, drop: 44.5, command: 45.1, lands: [42.9, 43.9, 44, 44.9, 45.9] },
  // 46–48: coats and accessories; a click every half beat.
  LOOKS: { open: 46, clicks: [46, 46.25, 46.5, 46.75, 47, 47.25, 47.5, 47.75] },
  LOCK: { shut: 48 },
  // 50–60: lights out, the end card.
  // The last cat opens one eye on the bar at 58 s and shuts it again on the music's last note at 59 s.
  NIGHT: { settle: 50, dim: [51, 51.25, 51.5], lines: [52, 53.5, 55, 56.5], eye: 58, shut: 59 }
};
T.UP = T.OPEN.map((t) => t + 0.25);

module.exports = { FPS, END, SHOTS, T, F: (frames) => frames / FPS };
