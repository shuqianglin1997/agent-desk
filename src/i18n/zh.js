/* AgentDesk 词表 · 简体中文（权威 key 清单，其它语言按此对照）。 */
(function (root) {
  const L = root.AgentDeskLocales || (root.AgentDeskLocales = {});
  L.zh = {
    meta: { label: '中文' },

    // ── 顶栏 ──
    'app.tagline': 'AGENT WORKSPACE',
    'topbar.context.yard': '猫猫庭院 · 本地账号与会话',
    'topbar.context.classic': '经典工作台 · 本地账号与会话',
    'topbar.leaderboard': '排行',
    'topbar.update': '更新',
    'topbar.toClassic': '经典',
    'topbar.toYard': '庭院',
    'topbar.connect': '接入',
    'topbar.leaderboard.title': '各账号今日工作量排行榜',
    'topbar.update.title': '检查 GitHub 更新',
    'topbar.view.title': '切换 猫猫庭院 / 经典视图',
    'topbar.connect.title': '接入 / 管理 Agent 类型（发现系统 Agent + 添加自定义）',
    'topbar.help.title': '使用说明',
    'topbar.theme.title': '切换深色 / 浅色',
    'topbar.lang.title': '切换界面语言（中 / EN / 日）',

    // ── 庭院氛围 ──
    'yard.atmos.time': '时间',
    'yard.atmos.weather': '天气',
    'yard.time.auto': '跟随',
    'yard.time.day': '白天',
    'yard.time.dusk': '黄昏',
    'yard.time.night': '夜晚',
    'yard.weather.title': '天气设置',
    'yard.weather.auto': '自动',
    'yard.weather.clear': '晴',
    'yard.weather.cloudy': '多云',
    'yard.weather.rain': '雨',
    'yard.weather.snow': '雪',

    // ── 今日小账本 / 提醒 ──
    'ledger.title': '今日小账本',
    'ledger.done': '收工 {n} 次',
    'ledger.min': '陪你干活 {n} 分钟',
    'reminder.on': '🔔 提醒 开',
    'reminder.off': '🔔 提醒 关',
    'reminder.title': '休息提醒（伸懒腰 / 收工播报）总开关',

    // ── 账号控制条 ──
    'account.none': '未选择账号',
    'account.form': '形态',
    'account.form.title': '这个账号有多个客户端形态；切换后 打开 / 编辑 / 移除 / 诊断 / 位置 / 额度 都作用于所选形态',
    'account.open': '打开账号',
    'account.add': '新增',
    'account.path': '路径',
    'account.diagnostics': '诊断',
    'account.refresh': '刷新',
    'account.manage': '管理',
    'account.edit': '编辑',
    'account.remove': '移除',
    'account.folder': '位置',
    'quota.self': '本号',
    'quota.all': '全院',
    'quota.self.title': '本号额度 · 点击展开详情',
    'quota.all.title': '全院额度 · 点击展开总览',
    'quota.kicker': '额度 Beta',
    'quota.waiting': '等待查询',
    'quota.refresh': '↻ 刷新额度',
    'quota.refresh.title': '从官方服务刷新额度',

    // ── 需要留意 / 全院额度 ──
    'attention.kicker': 'ATTENTION',
    'attention.title': '需要留意',
    'quotaMap.kicker': 'QUOTA MAP',
    'quotaMap.title': '全院额度',

    // ── 会话表 ──
    'session.title': '会话',
    'session.count': '{n} 个',
    'session.search': '搜索标题、项目或 ID',
    'session.col.title': '标题',
    'session.col.active': '活跃',
    'session.col.project': '项目目录',
    'session.col.source': '来源',
    'session.empty.filtered': '没有匹配的会话，换个关键词试试。',
    'session.empty.none': '这个账号还没有会话。点「打开账号」登录官方 App，用过之后会话会自动出现在这里；读不到时可点「诊断」。',

    // ── 会话详情 ──
    'detail.title': '会话详情',
    'detail.field.title': '标题',
    'detail.field.thread': '线程 ID',
    'detail.field.created': '新建',
    'detail.field.active': '活跃',
    'detail.field.source': '来源',
    'detail.field.project': '项目',
    'detail.field.file': '文件',
    'detail.field.address': '会话标识',
    'detail.copyHandoff': '复制交接信息',
    'detail.copyAddress': '复制标识',
    'detail.copyProject': '复制项目',
    'detail.reveal': '打开所在位置',
    'detail.exportMd': '导出 Markdown',
    'detail.export.can': '把这段对话导出成 Markdown 文件',
    'detail.export.cannot': '这个客户端的会话暂不支持导出 Markdown',

    // ── 交接信息（复制到剪贴板）──
    'handoff.template': `请帮我继续理解这个会话：

应用：{app}
账号槽位：{slot}
标题：{title}
新建时间：{created}
最后活跃：{active}
来源：{source}
状态：{status}
项目目录：{project}
会话标识：{address}
会话文件：{file}
线程 ID：{thread}

请基于这些信息判断这个会话在做什么，并继续处理。`,

    // ── 状态栏 ──
    'status.ready': '就绪',
    'status.today': '今日 · 收工 {done} · 陪伴 {min} 分',
    'status.attention': '{n} 个需留意',
    'common.unrecorded': '未记录',

    // ── 动态文案（renderer / scene 运行时用 tr）──
    'state.confused': '迷路',
    'state.working': '干活中',
    'state.onduty': '在岗',
    'state.arriving': '开工路上',
    'state.play': '玩耍',
    'state.rest': '面包猫',
    'state.nap': '打盹',
    'state.hibernate': '冬眠',
    'energy.fresh': '元气满满',
    'energy.steady': '状态稳定',
    'energy.tired': '有点累',
    'energy.exhausted': '快没电',
    'energy.unknown': '额度未知',
    'ctx.yard': '猫猫庭院',
    'ctx.classic': '经典工作台',
    'ctx.noAccount': '尚未选择账号',
    'acct.slotDefault': '默认槽位',
    'acct.slotIndependent': '独立槽位',
    'acct.lastOpen': '上次打开 {t}',
    'acct.badgeParallel': '⌨ {n} 并行',
    'acct.badgeForms': '⛓ {n} 形态',
    'acct.tip': '账号 {p} · 会话 {s}',
    'acct.note': '备注 {note}',
    'detail.unselected': '未选择',
    'card.busy': '{n} 个会话正在进行',
    'card.forms': '一个账号 {n} 个形态',
    'card.group': '分组 · {g}'
  };
})(typeof self !== 'undefined' ? self : this);
