/* AgentDesk locale · English (keys mirror zh.js). */
(function (root) {
  const L = root.AgentDeskLocales || (root.AgentDeskLocales = {});
  L.en = {
    meta: { label: 'English' },

    // Top bar
    'app.tagline': 'AGENT WORKSPACE',
    'topbar.context.yard': 'Cat Yard · local accounts & sessions',
    'topbar.context.classic': 'Classic · local accounts & sessions',
    'topbar.leaderboard': 'Board',
    'topbar.update': 'Update',
    'topbar.toClassic': 'Classic',
    'topbar.toYard': 'Yard',
    'topbar.connect': 'Connect',
    'topbar.leaderboard.title': "Today's workload leaderboard across accounts",
    'topbar.update.title': 'Check for updates on GitHub',
    'topbar.view.title': 'Switch Cat Yard / Classic view',
    'topbar.connect.title': 'Connect / manage agent types (discover system agents + add custom)',
    'topbar.help.title': 'How to use',
    'topbar.theme.title': 'Toggle dark / light',
    'topbar.lang.title': 'Switch language (中 / EN / 日)',

    // Cat-yard atmosphere
    'yard.atmos.time': 'Time',
    'yard.atmos.weather': 'Weather',
    'yard.time.auto': 'Follow',
    'yard.time.day': 'Day',
    'yard.time.dusk': 'Dusk',
    'yard.time.night': 'Night',
    'yard.weather.title': 'Weather',
    'yard.weather.auto': 'Auto',
    'yard.weather.clear': 'Clear',
    'yard.weather.cloudy': 'Cloudy',
    'yard.weather.rain': 'Rain',
    'yard.weather.snow': 'Snow',

    // Today ledger / reminder
    'ledger.title': 'Today',
    'ledger.done': '{n} wrapped up',
    'ledger.min': '{n} min alongside',
    'reminder.on': '🔔 Reminders on',
    'reminder.off': '🔔 Reminders off',
    'reminder.title': 'Break reminders (stretch / wrap-up nudge)',

    // Account console
    'account.none': 'No account selected',
    'account.form': 'Form',
    'account.form.title': 'This account has several client forms; switching applies Open / Edit / Remove / Diagnostics / Path / Quota to the chosen form',
    'account.open': 'Open account',
    'account.add': 'Add',
    'account.path': 'Path',
    'account.diagnostics': 'Diagnostics',
    'account.refresh': 'Refresh',
    'account.manage': 'Manage',
    'account.edit': 'Edit',
    'account.remove': 'Remove',
    'account.folder': 'Locate',
    'quota.self': 'This',
    'quota.all': 'All',
    'quota.self.title': "This account's quota · click to expand",
    'quota.all.title': 'All-account quota · click for overview',
    'quota.kicker': 'Quota Beta',
    'quota.waiting': 'Waiting',
    'quota.refresh': '↻ Refresh quota',
    'quota.refresh.title': 'Refresh quota from the official service',

    // Attention / quota map
    'attention.kicker': 'ATTENTION',
    'attention.title': 'Needs attention',
    'quotaMap.kicker': 'QUOTA MAP',
    'quotaMap.title': 'All quotas',

    // Session table
    'session.title': 'Sessions',
    'session.count': '{n}',
    'session.search': 'Search title, project or ID',
    'session.col.title': 'Title',
    'session.col.active': 'Active',
    'session.col.project': 'Project',
    'session.col.source': 'Source',
    'session.empty.filtered': 'No matching sessions — try another keyword.',
    'session.empty.none': 'No sessions for this account yet. Click "Open account" to sign in to the official app; once you have used it, sessions show up here automatically. If nothing loads, try "Diagnostics".',

    // Session detail
    'detail.title': 'Session detail',
    'detail.field.title': 'Title',
    'detail.field.thread': 'Thread ID',
    'detail.field.created': 'Created',
    'detail.field.active': 'Active',
    'detail.field.source': 'Source',
    'detail.field.project': 'Project',
    'detail.field.file': 'File',
    'detail.field.address': 'Session ID',
    'detail.copyHandoff': 'Copy handoff',
    'detail.copyAddress': 'Copy ID',
    'detail.copyProject': 'Copy project',
    'detail.reveal': 'Reveal location',
    'detail.exportMd': 'Export Markdown',
    'detail.export.can': 'Export this conversation as a Markdown file',
    'detail.export.cannot': 'This client does not support Markdown export yet',

    // Handoff text (copied to clipboard)
    'handoff.template': `Help me pick up this session:

App: {app}
Account slot: {slot}
Title: {title}
Created: {created}
Last active: {active}
Source: {source}
Status: {status}
Project: {project}
Session ID: {address}
Session file: {file}
Thread ID: {thread}

Based on this, work out what this session is doing and continue it.`,

    // Status bar
    'status.ready': 'Ready',
    'status.today': 'Today · {done} wrapped · {min} min',
    'status.attention': '{n} need attention',
    'common.unrecorded': 'Not recorded',

    // Dynamic (renderer / scene at runtime via tr)
    'state.confused': 'Lost',
    'state.working': 'Working',
    'state.onduty': 'On duty',
    'state.arriving': 'Arriving',
    'state.play': 'Playing',
    'state.rest': 'Loafing',
    'state.nap': 'Napping',
    'state.hibernate': 'Hibernating',
    'energy.fresh': 'Fresh',
    'energy.steady': 'Steady',
    'energy.tired': 'Tired',
    'energy.exhausted': 'Low',
    'energy.unknown': 'Unknown',
    'ctx.yard': 'Cat Yard',
    'ctx.classic': 'Classic',
    'ctx.noAccount': 'No account selected',
    'acct.slotDefault': 'Default slot',
    'acct.slotIndependent': 'Isolated slot',
    'acct.lastOpen': 'Opened {t}',
    'acct.badgeParallel': '⌨ {n} parallel',
    'acct.badgeForms': '⛓ {n} forms',
    'acct.tip': 'Account {p} · Sessions {s}',
    'acct.note': 'Note: {note}',
    'detail.unselected': 'None',
    'card.busy': '{n} sessions running',
    'card.forms': '{n} forms of one account',
    'card.group': 'Group · {g}'
  };
})(typeof self !== 'undefined' ? self : this);
