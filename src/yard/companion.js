/*
 * AgentDesk — 陪伴账本（庭院视图）。
 *
 * 纯函数：吃「此刻在干活的账号集合」，吐出今日账本 + 该播报的事件。
 * 不碰 DOM、不碰计时器（renderer 负责持久化、UI、节流）。可单测。
 *
 * 设计意图：把「猫替你上班，也替你休息」落成有形状的一天 ——
 *   收工次数、累计陪伴时长、以及连续久坐时的伸懒腰提醒。
 *   全部只到状态栏级别，绝不弹窗、可整体关闭。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YardCompanion = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const MINUTE = 60e3;
  const GRACE = 10 * MINUTE;             // 连续 10 分钟没写入才算真收工（跳过短暂写入间隙）
  const STRETCH_AFTER = 90 * MINUTE;     // 连续干活 90 分钟触发伸懒腰
  const STRETCH_COOLDOWN = 90 * MINUTE;  // 提醒最多每 90 分钟一次

  function dayKey(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function emptyLedger(now) {
    return { date: dayKey(now), completed: 0, workedMs: 0, active: {}, lastStretchAt: 0 };
  }

  // 推进账本一步。input: { now, workingIds, remindersOn }。返回 { ledger, events }。
  function tick(prev, input) {
    const now = input.now;
    const working = new Set(input.workingIds || []);
    const remindersOn = input.remindersOn !== false;

    let base = prev && prev.date ? prev : emptyLedger(now);
    if (base.date !== dayKey(now)) base = emptyLedger(now); // 跨天清零

    // 防御性兜底：localStorage 里的账本字段可能缺失/被改坏，全部归一化后再算
    const prevActive = base.active && typeof base.active === 'object' ? base.active : {};
    const active = {};
    for (const id of Object.keys(prevActive)) {
      const entry = prevActive[id];
      if (entry && Number.isFinite(entry.start) && Number.isFinite(entry.last)) {
        active[id] = { start: entry.start, last: entry.last };
      }
    }
    let completed = Number.isFinite(base.completed) ? base.completed : 0;
    let workedMs = Number.isFinite(base.workedMs) ? base.workedMs : 0;
    let lastStretchAt = Number.isFinite(base.lastStretchAt) ? base.lastStretchAt : 0;
    const events = [];

    // 1. 在干活的会话：新建，或累加自上次以来的时长
    for (const id of working) {
      if (!active[id]) {
        active[id] = { start: now, last: now };
      } else {
        const delta = now - active[id].last;
        if (delta > GRACE) {
          // 中断超过宽限期（切走很久 / 休眠）：这段不计入，且视为新一段连续工作，
          // 重置起点，伸懒腰时长才不会用陈旧的墙钟虚报。
          active[id].start = now;
        } else if (delta > 0) {
          workedMs += delta;
        }
        active[id].last = now;
      }
    }

    // 2. 不在干活、且超过宽限期的会话 → 收工 +1
    for (const id of Object.keys(active)) {
      if (working.has(id)) continue;
      if (now - active[id].last >= GRACE) {
        completed += 1;
        const minutes = Math.max(1, Math.round((active[id].last - active[id].start) / MINUTE));
        events.push({ type: 'clockoff', minutes });
        delete active[id];
      }
    }

    // 3. 伸懒腰：有会话连续干活超过阈值，且冷却已过
    if (remindersOn) {
      let longest = 0;
      for (const id of working) {
        if (active[id]) longest = Math.max(longest, now - active[id].start);
      }
      if (longest >= STRETCH_AFTER && now - lastStretchAt >= STRETCH_COOLDOWN) {
        lastStretchAt = now;
        events.push({ type: 'stretch', minutes: Math.round(longest / MINUTE) });
      }
    }

    return { ledger: { date: base.date, completed, workedMs, active, lastStretchAt }, events };
  }

  return { tick, emptyLedger, dayKey, GRACE, STRETCH_AFTER, STRETCH_COOLDOWN };
});
