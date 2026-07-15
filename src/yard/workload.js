/*
 * AgentDesk — 账号工作量评分（实时排行榜）。
 *
 * 口径（今日）：会话场次 + 实时状态，都是能从现有扫描/探测拿到、跨工具可比的信号。
 *   分 = round(10·√今日活跃会话 + 6·√今日新建会话) + 正在干活 ×15（实时加成）
 * 用平方根阻尼：不同工具把一次任务拆成的会话文件数差异很大（Codex 一个任务可能落
 * 几十个 rollout 文件，Claude 一次对话才一两个），线性计数会让粒度细的工具刷爆榜；
 * 平方根让「刷得再多边际递减」，跨工具没那么悬殊。不用 token/代码行数——跨工具不可比。
 *
 * 纯函数，UMD，可单测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YardWorkload = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W_ACTIVE = 10;
  const W_NEW = 6;
  const W_WORKING = 15;

  // input: { activeToday, createdToday, working }
  function accountScore(input) {
    const active = Math.max(0, Number(input && input.activeToday) || 0);
    const created = Math.max(0, Number(input && input.createdToday) || 0);
    const working = (input && input.working) === true;
    // 平方根阻尼跨工具的会话粒度差异
    return Math.round(W_ACTIVE * Math.sqrt(active) + W_NEW * Math.sqrt(created)) + (working ? W_WORKING : 0);
  }

  // 给每个账号算分并从高到低排；同分按今日活跃、再按名称稳定排序
  function rankAccounts(accounts) {
    return (accounts || [])
      .map((a) => ({ ...a, score: accountScore(a) }))
      .sort((a, b) =>
        b.score - a.score ||
        (b.activeToday || 0) - (a.activeToday || 0) ||
        String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
      );
  }

  return { accountScore, rankAccounts, W_ACTIVE, W_NEW, W_WORKING };
});
