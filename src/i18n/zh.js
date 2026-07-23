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

    // ── 状态栏 ──
    'status.ready': '就绪',
    'status.today': '今日 · 收工 {done} · 陪伴 {min} 分',
    'status.attention': '{n} 个需留意'
  };
})(typeof self !== 'undefined' ? self : this);
