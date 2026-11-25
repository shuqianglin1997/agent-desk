'use strict';

/*
 * The film's music: a register table for the app's chip synthesiser
 * (src/pixel/chip.js), taken from the approved sketch of the film.
 *
 * 120 beats a minute: a beat is 30 rows, a bar 120 rows (2 s), 30 bars = 60 s.
 * Four channels: p1 lead, p2 echo and chords, wv bass, nz drums.
 * Bars: 1–2 tense minor · 3 the lamp · 4–12 theme · 13–16 copy (half time; the
 * beat at 25.0 s is silent but for one falling bass note) · 17–20 call (a line,
 * then drums, then chords, then an accent on every beat) · 21–24 theme again ·
 * 25 the lock · 26 lullaby · 27–29 four chords, one for each line of the end
 * card · 30 the last note.
 */

const BEAT = 30, BAR = 120, BARS = 30, N = BARS * BAR + 90;
const ROOT = { C: 36, G: 43, Am: 45, F: 41 };
// 主题：每小节 8 个八分音符；[第几个八分, 占几个八分, 音高]
const HOOK = {
  C: [[0, 2, 76], [2, 2, 79], [4, 2, 84], [6, 1, 83], [7, 1, 81]],
  G: [[0, 3, 79], [3, 1, 76], [4, 4, 74]],
  Am: [[0, 2, 72], [2, 2, 76], [4, 2, 81], [6, 1, 79], [7, 1, 76]],
  F: [[0, 3, 77], [3, 1, 81], [4, 4, 79]]
};
const TRIAD = { C: [72, 76, 79], G: [71, 74, 79], Am: [69, 72, 76], F: [69, 72, 77] };

// The instruments: every helper writes rows into the four channels of one table of `rows` rows (60 a second).
function kit(rows) {
  const T = { p1: Array(rows).fill(null), p2: Array(rows).fill(null), wv: Array(rows).fill(null), nz: Array(rows).fill(null) };
  const N = rows;
  const bar = (b) => (b - 1) * BAR;
  const tone = (ch, at, len, midi, vol, duty, o = {}) => {
    for (let i = 0; i < len && at + i < N; i += 1) {
      const v = Math.max(1, Math.round(vol * (1 - (o.flat ? 0.2 : 0.65) * i / len)));
      const m = midi + (o.arp ? o.arp[i % o.arp.length] : 0) + (o.vib && i > 8 ? (i % 6 < 3 ? 0.22 : -0.22) : 0);
      T[ch][at + i] = [m, duty, v];
    }
  };
  const low = (at, len, midi, level = 1) => { for (let i = 0; i < len && at + i < N; i += 1) T.wv[at + i] = [midi, i < len * 0.7 ? level : Math.min(3, level + 1)]; };
  const hit = (at, rows2) => rows2.forEach((row, i) => { if (at + i < N) T.nz[at + i] = row; });
  const kick = (at) => hit(at, [[7, 3, 0, 12], [7, 3, 0, 9], [6, 3, 0, 5], [6, 3, 0, 2]]);
  const snare = (at) => hit(at, [[3, 2, 0, 11], [3, 2, 0, 8], [4, 2, 0, 6], [4, 2, 0, 4], [5, 2, 0, 2]]);
  const hat = (at) => hit(at, [[0, 1, 0, 4], [0, 1, 0, 2]]);
  const crash = (at) => hit(at, Array.from({ length: 30 }, (_, i) => [1, 1, 0, Math.max(1, 12 - Math.floor(i / 2.6))]));
  const chord = (at, len, name, vol = 6) => tone('p2', at, len, 0, vol, 2, { arp: TRIAD[name] });
  const drums = (at) => { kick(at); kick(at + 60); snare(at + 30); snare(at + 90); [15, 45, 75, 105].forEach((f) => hat(at + f)); };
  const bassline = (at, name) => { for (let k = 0; k < 8; k += 1) low(at + k * 15, 12, ROOT[name] + (k % 2 ? 12 : 0)); };
  const hook = (at, name, up = 0, vol = 10) => HOOK[name].forEach(([k, n, m]) => tone('p1', at + k * 15, n * 15 - 2, m + up, vol, 1));
  const theme = (b, name, o = {}) => { const at = bar(b); if (!o.noDrums) drums(at); if (!o.noBass) bassline(at, name); hook(at, name, o.up || 0); };
  const accent = (at, name) => { crash(at); chord(at, 24, name, 8); };
  const leadIn = (at) => [[60, 79], [75, 81], [90, 83]].forEach(([f, m]) => tone('p1', at + f, f === 90 ? 28 : 13, m, 9, 1));
  // 回声：主旋律晚 12 帧在第二个声道轻轻再来一遍（第二声道空着的地方才写）
  const echo = () => {
    const lead = T.p1.slice();
    for (let f = 0; f + 12 < N; f += 1) if (lead[f] && !T.p2[f + 12]) T.p2[f + 12] = [lead[f][0], 2, Math.max(1, Math.round(lead[f][2] * 0.35))];
  };
  return { T, bar, tone, low, hit, kick, snare, hat, crash, chord, drums, bassline, hook, theme, accent, leadIn, echo };
}

function compose() {
  const { T, bar, tone, low, hit, kick, snare, hat, crash, chord, theme, accent, leadIn, echo } = kit(N);

  // 1–2：紧张。小调，低音每个八分音符顶一下，旋律半音往下滑；第二小节末尾噪声一路往上扫
  for (let k = 0; k < 16; k += 1) { low(k * 15, 10, 45, 1); tone('p1', k * 15, 12, 76 - (k % 8) + (k >= 8 ? 5 : 0), 6, 0); if (k % 2 || k >= 8) hat(k * 15); }
  for (let i = 0; i < 60; i += 1) T.nz[180 + i] = [Math.max(0, 6 - Math.floor(i / 10)), 1, 0, Math.min(11, 3 + Math.floor(i / 7))];

  // 3：开灯。一击：镲、大三和弦快速琶音、低音长音；后半小节三个音往上带进主题
  crash(bar(3)); low(bar(3), 80, 36, 1);
  tone('p1', bar(3), 50, 84, 12, 1, { arp: [0, 4, 7, 12], flat: false }); tone('p2', bar(3), 50, 72, 7, 2, { arp: [0, 4, 7] });
  leadIn(bar(3));

  // 4–12：主题。猫一只只落上搁板、打开、忙起来、一本账、新回复、搜索
  ['C', 'G', 'Am', 'F', 'C', 'G', 'Am', 'F', 'C'].forEach((name, i) => theme(4 + i, name));

  // 13–16：复制。半速：低音和旋律都是两拍一个音，带颤音；鼓只剩每小节一下
  [[13, [45, 41], [76, 72]], [14, [36, 43], [74, 79]], [15, [41, 36], [72, 76]], [16, [43, 43], [74, 71]]].forEach(([b, bass, lead]) => {
    kick(bar(b)); [30, 60, 90].forEach((f) => hat(bar(b) + f));
    bass.forEach((m, k) => low(bar(b) + k * 60, 56, m)); lead.forEach((m, k) => tone('p1', bar(b) + k * 60, 56, m, 9, 2, { vib: true, flat: true }));
  });
  // 第 13 小节第 3 拍（25.0 秒，“快没电”）：全部停一拍，只剩一个往下掉的低音
  for (const ch of ['p1', 'p2', 'wv', 'nz']) for (let f = bar(13) + 60; f < bar(13) + 90; f += 1) T[ch][f] = null;
  low(bar(13) + 60, 14, 38, 1); low(bar(13) + 74, 16, 31, 2);
  kick(bar(14) + 30);                                            // 26.5 秒：盖印那一下

  // 17–20：调用。一层一层加：一条旋律 → 加鼓 → 加和弦 → 每拍一个重音
  theme(17, 'C', { noDrums: true, noBass: true });
  theme(18, 'G');
  theme(19, 'Am'); chord(bar(19), 110, 'Am', 5);
  theme(20, 'F'); [0, 30, 60, 90].forEach((f) => accent(bar(20) + f, 'F'));

  // 21–24：主题再现。第 22–23 小节每秒一个重音，对上四种加猫的办法；第 24 小节每半拍一下，换装
  ['C', 'G', 'Am', 'F'].forEach((name, i) => theme(21 + i, name, { up: i >= 2 ? 12 : 0 }));
  [bar(22), bar(22) + 60, bar(23), bar(23) + 60].forEach((at, i) => accent(at, ['C', 'G', 'Am', 'F'][i]));
  for (let k = 0; k < 8; k += 1) snare(bar(24) + k * 15);

  // 25：小锁。“咔”的一声，然后空着
  hit(bar(25), [[2, 4, 1, 12], [2, 4, 1, 6], [3, 4, 1, 2]]); low(bar(25), 20, 36, 1);

  // 26：关灯。摇篮曲，没有鼓，旋律一拍一个、很轻，往下走
  low(bar(26), 110, ROOT.C, 2); [79, 76, 72, 67].forEach((m, k) => tone('p1', bar(26) + k * 30, 26, m, 5, 1, { flat: true }));

  // 27–29：四个和弦，各落一行字（52、53.5、55、56.5 秒）
  [[bar(27), 'C'], [bar(27) + 90, 'F'], [bar(28) + 60, 'G'], [bar(29) + 30, 'C']].forEach(([at, name]) => {
    low(at, 85, ROOT[name], 2); chord(at, 70, name, 6); tone('p1', at, 85, TRIAD[name][2] + 12, 7, 1, { flat: true, vib: true });
  });

  // 30：最后一只猫睁眼的那一下（58.5 秒）
  tone('p1', bar(30) + 60, 10, 96, 9, 0); tone('p1', bar(30) + 70, 24, 100, 9, 0); low(bar(30) + 60, 40, 48, 2);

  echo();
  return T;
}

/*
 * The 15-second cut: the same registers arranged over seven and a half bars (900 rows).
 *   0–8 s    the theme, C G Am F, a crash on the first beat
 *   8–10 s   out of energy and the copy: one beat of theme, then the beat at 8.5 s silent but for the falling bass;
 *            from 9 s half time (long notes), the kick of the seal at 9.5 s
 *   10–12 s  the theme again (G) as the other cat carries on; three notes up into the end card
 *   12.5 s   four chords a beat apart, C F G C: the name, how to find it, a breath, the cheer; the last one rings
 *            down in three steps and the cut ends on silence
 */
const SHORT_SECONDS = 15;
function composeShort() {
  const { T, bar, tone, low, kick, snare, hat, crash, chord, theme, echo } = kit(SHORT_SECONDS * 60);
  crash(0);
  ['C', 'G', 'Am', 'F'].forEach((name, i) => theme(1 + i, name));
  // Bar 5 (8–10 s).
  const b5 = bar(5);
  kick(b5); hat(b5 + 15); low(b5, 12, ROOT.C); low(b5 + 15, 12, ROOT.C + 12); tone('p1', b5, 28, 76, 10, 1);
  low(b5 + 30, 14, 38, 1); low(b5 + 44, 16, 31, 2);
  kick(b5 + 60); [75, 105].forEach((f) => hat(b5 + f)); kick(b5 + 90);
  low(b5 + 60, 56, 45); tone('p1', b5 + 60, 56, 76, 9, 2, { vib: true, flat: true });
  // Bar 6 (10–12 s), and the half bar that leads in.
  theme(6, 'G');
  const b7 = bar(7);
  [[0, 79], [10, 81], [20, 83]].forEach(([f, m]) => tone('p1', b7 + f, f === 20 ? 9 : 9, m, 9, 1));
  [0, 8, 15, 22].forEach((f) => snare(b7 + f)); low(b7, 28, ROOT.G);
  // The end card: C F G a beat apart, then C struck and left to ring down in three steps, so the cut ends on silence.
  [[b7 + 30, 'C'], [b7 + 60, 'F'], [b7 + 90, 'G']].forEach(([at, name], i) => {
    if (i === 0) crash(at);
    kick(at);
    low(at, 28, ROOT[name], 2); chord(at, 28, name, 6); tone('p1', at, 28, TRIAD[name][2] + 12, 7, 1, { flat: true, vib: true });
  });
  const last = b7 + 120;
  crash(last); kick(last);
  [[0, 20, 1], [20, 14, 0.55], [34, 8, 0.25]].forEach(([f, len, level], i) => {
    low(last + f, len, ROOT.C, i + 1);
    tone('p2', last + f, len, 0, Math.max(1, Math.round(8 * level)), 2, { arp: TRIAD.C, flat: true });
    tone('p1', last + f, len, TRIAD.C[2] + 12, Math.max(1, Math.round(9 * level)), 1, { flat: true, vib: i === 0 });
  });
  echo();
  return T;
}

module.exports = { compose, composeShort, kit, BEAT, BAR, BARS, seconds: BARS * 2, SHORT_SECONDS };
