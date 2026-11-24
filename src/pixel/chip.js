/*
 * 芯片发声器：照着老掌机的声音芯片做。
 * 四个声道：两个方波（占空比 12.5% / 25% / 50% / 75%）、一个波形声道（32 格、每格 4 位）、一个噪声声道（移位寄存器）。
 * 每个音效是一张“寄存器表”：每秒 60 行，每行写明这一帧每个声道的音高、占空比和 0–15 的音量——老游戏的音效驱动就是这样工作的。
 * 所以音量是台阶、滑音是一帧一跳、和弦是三个音轮流出现，而不是平滑的曲线。
 * 音高先换算成芯片的 11 位频率寄存器再换回来，高音会带上芯片本来就有的那点不准。
 * 只做一件事：把一张表渲染成一段 PCM。没有混响，没有采样，没有随机数。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chip = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FPS = 60;        // 驱动每秒写 60 次寄存器
  const OVER = 8;        // 过采样后取平均，免得高音的方波折出杂音
  const DUTY = [0.125, 0.25, 0.5, 0.75];
  const WAVE_LEVEL = [0, 1, 0.5, 0.25];   // 波形声道只有四档音量
  // 波形表：32 格的三角，每格 4 位，听起来是带一点锯齿的圆润低音
  const WAVE = Array.from({ length: 32 }, (_, i) => (i < 16 ? i : 31 - i));

  const hz = (note) => 440 * Math.pow(2, (note - 69) / 12);
  // 方波：f = 131072 / (2048 - x)；波形声道低一个八度：f = 65536 / (2048 - x)。x 是 11 位寄存器。
  const quantize = (frequency, base) => {
    const x = Math.max(0, Math.min(2047, Math.round(2048 - base / frequency)));
    return base / (2048 - x);
  };
  // 噪声：时钟 = 524288 / 除数 / 2^(移位+1)，除数 0 当 0.5
  const noiseClock = (shift, divisor) => 524288 / (divisor === 0 ? 0.5 : divisor) / Math.pow(2, shift + 1);

  function render(sound, sampleRate) {
    const rows = Math.max(...['p1', 'p2', 'wv', 'nz'].map((key) => (sound[key] ? sound[key].length : 0)));
    const perFrame = sampleRate / FPS;
    const total = Math.ceil((rows + 3) * perFrame);
    const out = new Float32Array(total);
    const dt = 1 / (sampleRate * OVER);
    let phase1 = 0, phase2 = 0, phaseW = 0, lfsr = 0x7fff, noiseAcc = 0, noiseOut = 1;
    let frame = -1, a = null, b = null, w = null, z = null;
    let fa = 0, da = 0, va = 0, fb = 0, db = 0, vb = 0, fw = 0, vw = 0, fz = 0, vz = 0, narrow = false;

    for (let i = 0; i < total; i += 1) {
      const current = Math.floor(i / perFrame);
      if (current !== frame) {
        frame = current;
        a = sound.p1 && sound.p1[frame] || null;
        b = sound.p2 && sound.p2[frame] || null;
        w = sound.wv && sound.wv[frame] || null;
        z = sound.nz && sound.nz[frame] || null;
        if (a) { fa = quantize(hz(a[0]), 131072); da = DUTY[a[1]]; va = a[2] / 15; }
        if (b) { fb = quantize(hz(b[0]), 131072); db = DUTY[b[1]]; vb = b[2] / 15; }
        if (w) { fw = quantize(hz(w[0]), 65536); vw = WAVE_LEVEL[w[1]]; }
        if (z) { fz = noiseClock(z[0], z[1]); narrow = z[2] === 1; vz = z[3] / 15; }
      }
      let acc = 0;
      for (let k = 0; k < OVER; k += 1) {
        if (a) { phase1 += fa * dt; phase1 -= Math.floor(phase1); acc += phase1 < da ? va : -va; }
        if (b) { phase2 += fb * dt; phase2 -= Math.floor(phase2); acc += phase2 < db ? vb : -vb; }
        if (w) { phaseW += fw * dt; phaseW -= Math.floor(phaseW); acc += ((WAVE[(phaseW * 32) | 0] - 7.5) / 7.5) * vw; }
        if (z) {
          noiseAcc += fz * dt;
          while (noiseAcc >= 1) {
            noiseAcc -= 1;
            const bit = (lfsr ^ (lfsr >> 1)) & 1;
            lfsr = (lfsr >> 1) | (bit << 14);
            if (narrow) lfsr = (lfsr & ~0x40) | (bit << 6);   // 7 位模式：周期短，听起来像金属
            noiseOut = (~lfsr) & 1;
          }
          acc += noiseOut ? vz : -vz;
        }
      }
      out[i] = acc / OVER;
    }

    // 输出级：隔直电容（约 30Hz 高通）和一点高频滚降（约 10kHz 低通），再定总音量
    const high = Math.exp(-2 * Math.PI * 30 / sampleRate);
    const low = 1 - Math.exp(-2 * Math.PI * 10000 / sampleRate);
    let previous = 0, blocked = 0, smooth = 0;
    for (let i = 0; i < total; i += 1) {
      blocked = high * (blocked + out[i] - previous);
      previous = out[i];
      smooth += low * (blocked - smooth);
      out[i] = smooth * 0.25;
    }
    return out;
  }

  /* ── 写表用的几个小工具 ───────────────────────────── */
  const rest = (count) => Array(count).fill(null);
  const hold = (note, duty, volumes) => volumes.map((volume) => [note, duty, volume]);   // 一个音，按帧写音量台阶
  const bass = (note, levels) => levels.map((level) => [note, level]);

  /* ── 音效表 ─────────────────────────────────────── */
  const SOUNDS = {
    // 选中一只猫：两个短音往上跳一个四度
    select: () => ({ p1: [[88, 0, 8], [88, 0, 4], [93, 0, 7], [93, 0, 4], [93, 0, 2], [93, 0, 1]] }),
    // 展开菜单、点一个小开关：一个很短的高音
    tick: () => ({ p1: [[96, 2, 5], [96, 2, 2], [96, 2, 1]] }),
    // 勾上一条会话：低音声道往上“咕”一下；取消是往下
    check: () => ({ wv: [[72, 1], [76, 1], [79, 1], [79, 2], [79, 2], [79, 3]], p1: [[103, 0, 3]] }),
    uncheck: () => ({ wv: [[79, 1], [76, 1], [72, 1], [72, 2], [72, 2], [72, 3]] }),
    // 打开一个档案夹：噪声的音高一格一格往上扫，像纸被抽出来；末尾一个轻轻的落点
    open: () => ({
      nz: [[6, 2, 0, 3], [5, 2, 0, 5], [4, 2, 0, 6], [3, 2, 0, 5], [2, 2, 0, 3], [1, 2, 0, 1]],
      p1: rest(4).concat([[91, 1, 5], [91, 1, 2], [91, 1, 1]])
    }),
    close: () => ({
      nz: [[1, 2, 0, 2], [2, 2, 0, 3], [3, 2, 0, 4], [4, 2, 0, 3], [5, 2, 0, 2], [6, 2, 0, 1]],
      p1: [[84, 1, 4], [84, 1, 2]]
    }),
    // 盖印（复制会话信息）：一记低沉的“咚”——噪声加下坠的低音；然后是两个音的“叮”，第二个声道晚几帧跟一遍当回声
    stamp: () => ({
      nz: [[7, 3, 0, 13], [7, 3, 0, 10], [6, 3, 0, 6], [6, 3, 0, 4], [5, 3, 0, 2], [5, 3, 0, 1]],
      wv: [[45, 1], [41, 1], [38, 1], [36, 2], [36, 3]],
      p1: rest(6).concat([[88, 1, 9], [88, 1, 6]], hold(95, 1, [10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1])),
      p2: rest(10).concat(hold(95, 2, [4, 4, 3, 3, 2, 2, 1, 1, 1]))
    }),
    // 打开一个账号：三个音往上走，低八度的回声晚两帧
    launch: () => ({
      p1: hold(72, 1, [9, 7, 5]).concat(hold(79, 1, [9, 7, 5]), hold(84, 1, [10, 8, 6, 5, 4, 3, 2, 1])),
      p2: rest(2).concat(hold(60, 2, [5, 4, 3]), hold(67, 2, [5, 4, 3]), hold(72, 2, [5, 4, 3, 2, 1]))
    }),
    // 就绪：三个音每帧轮换一次，耳朵听成一个闪烁的和弦，然后落在高八度上
    ready: () => ({
      p1: [9, 9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 4].map((volume, index) => [[84, 88, 91][index % 3], 1, volume])
        .concat(hold(96, 1, [9, 8, 7, 6, 5, 4, 3, 3, 2, 2, 1, 1])),
      wv: bass(48, [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]).concat(bass(60, [2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]))
    }),
    // 等你处理：一个音，停一下，再一个带颤音的高一点的音，像在问
    wait: () => ({
      p1: hold(88, 1, [7, 6, 5, 4]).concat(rest(3), [8, 8, 7, 6, 5, 4, 3, 2].map((volume, index) => [91 + (index % 2 ? 0.25 : -0.25), 1, volume]))
    }),
    // 出错：两声往下滑的低音，底下垫着金属味的短周期噪声
    error: () => ({
      p1: [[50, 2, 10], [49.5, 2, 10], [49, 2, 9], [48.5, 2, 8], [48, 2, 6]].concat(rest(2),
        [[47, 2, 10], [46.5, 2, 10], [46, 2, 9], [45.5, 2, 8], [45, 2, 7], [44.5, 2, 5], [44, 2, 3]]),
      nz: [[4, 4, 1, 5], [4, 4, 1, 5], [4, 4, 1, 4], [4, 4, 1, 3], [4, 4, 1, 2], null, null,
        [4, 5, 1, 5], [4, 5, 1, 5], [4, 5, 1, 4], [4, 5, 1, 3], [4, 5, 1, 2], [4, 5, 1, 1]]
    }),
    // 送出：很窄的方波一路往上滑，尾巴是一小段变尖的噪声
    send: () => ({
      p1: Array.from({ length: 10 }, (_, index) => [72 + 2.2 * index, 0, Math.max(1, 9 - index)]),
      nz: rest(6).concat([[2, 1, 0, 3], [1, 1, 0, 3], [1, 1, 0, 2], [0, 1, 0, 2], [0, 1, 0, 1]])
    }),
    // 收件箱来了东西：“叮——咚”，下面垫一个低五度
    arrive: () => ({
      p1: hold(91, 1, [10, 9, 8, 7, 6, 5, 4, 3]).concat(hold(88, 1, [10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1])),
      p2: rest(1).concat(hold(79, 2, [4, 4, 3, 3, 2, 2, 1]), hold(76, 2, [4, 4, 3, 3, 2, 2, 2, 1, 1, 1]))
    }),
    // 猫叫：音高先扬后落，中途把占空比从 50% 换成 25%，嘴型就从“咪”变成“呜”。seed 让每只猫的嗓子不一样
    mew: (seed) => {
      const base = 81 + (((seed || 0) % 5) - 2) * 1.5;
      const contour = [0, 2, 4, 5, 5.3, 5, 5.3, 5, 4, 3, 1, -1, -2, -3];
      const volumes = [5, 8, 10, 11, 11, 10, 10, 9, 8, 7, 6, 4, 3, 2];
      return { p1: contour.map((offset, index) => [base + offset, index < 5 ? 2 : 1, volumes[index]]) };
    },
    // 电一下：金属噪声和一串往下掉的琶音交错
    zap: () => ({
      nz: [[1, 1, 1, 10], [2, 1, 1, 8], [1, 1, 1, 9], [3, 1, 1, 6], [1, 1, 1, 7], [2, 1, 1, 4], [3, 1, 1, 3], [4, 1, 1, 1]],
      p1: [[96, 0, 7], [91, 0, 7], [88, 0, 6], [84, 0, 6], [79, 0, 5], [76, 0, 4], [72, 0, 3], [67, 0, 2]]
    }),
    // 开灯、关灯：一声开关的“嗒”，后面跟一个往上或往下的低音
    lampOn: () => ({ nz: [[0, 1, 0, 9]], wv: [null, [60, 2], [67, 2], [67, 3]] }),
    lampOff: () => ({ nz: [[0, 1, 0, 9]], wv: [null, [67, 2], [60, 2], [60, 3]] }),
    // 页脚那句话逐字出来时，每个字一声
    text: () => ({ p1: [[81, 1, 4], [81, 1, 1]] }),
    // 额度快见底：两个慢慢往下的低音
    tired: () => ({ wv: bass(55, [1, 1, 1, 1, 1, 2, 2, 2]).concat(rest(2), bass(50, [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3])) }),
    // 送走一只猫：三个音慢慢往下走，不带回声
    bye: () => ({ p1: hold(79, 1, [7, 6, 5, 4]).concat(hold(76, 1, [6, 5, 4, 3]), hold(72, 1, [6, 5, 5, 4, 4, 3, 3, 2, 2, 1])) }),
    // 有设备开始查看或控制这台电脑：三声很正的方波，最后一声高一点。这是安全提示，要和别的都不像
    watch: () => ({
      p1: hold(84, 2, [9, 9, 6]).concat(rest(3), hold(84, 2, [9, 9, 6]), rest(3), hold(91, 2, [10, 10, 8, 6, 4, 2])),
      p2: hold(72, 2, [4, 4, 3]).concat(rest(3), hold(72, 2, [4, 4, 3]), rest(3), hold(79, 2, [5, 5, 4, 3, 2, 1]))
    }),
    // 开机：三个音的小动机，带回声和一条低音
    hello: () => ({
      p1: hold(76, 1, [9, 7, 5, 3]).concat(hold(79, 1, [9, 7, 5, 3]), hold(88, 1, [10, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1])),
      p2: rest(3).concat(hold(76, 2, [4, 3, 2, 1]), hold(79, 2, [4, 3, 2, 1]), hold(88, 2, [4, 4, 3, 3, 2, 2, 1, 1])),
      wv: bass(52, [1, 1, 1, 1, 2, 2, 2, 2]).concat(bass(57, [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3]))
    })
  };

  return { FPS, render, SOUNDS, names: Object.keys(SOUNDS) };
});
