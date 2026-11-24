// AgentDesk — the session table: its columns, head, rows and cells, the
// compact/detailed view, the filter, and focusing or checking a session
// (docs/ARCHITECTURE_PLAN.md phase 6). Moved from src/renderer.js unchanged.

function setSessionView(view) {
  const next = view === 'detail' ? 'detail' : 'compact';
  if (els.sessionDisplayMenu) els.sessionDisplayMenu.open = false;
  if (next === state.sessionView) {
    renderSessionControls();
    return;
  }
  state.sessionView = next;
  persistSettings({ sessionView: next });
  renderSessionControls();
  renderSessions();
}

function renderSessionControls() {
  const all = state.ui.agentScope === 'all';
  const detail = state.sessionView === 'detail';
  els.sessionCompactBtn?.setAttribute('aria-pressed', String(!detail));
  els.sessionDetailBtn?.setAttribute('aria-pressed', String(detail));
  if (els.sessionDisplayLabel) {
    els.sessionDisplayLabel.textContent = tr(detail ? 'session.view.detail' : 'session.view.compact');
  }
  if (els.sessionTable) {
    els.sessionTable.dataset.scope = state.ui.agentScope;
    els.sessionTable.dataset.mode = state.sessionView;
  }
  if (els.sessionTitle) {
    const agent = all ? null : identityGroups().find((item) => item.key === currentAgentId());
    const lens = currentDeviceLensId() === 'all' ? '' : ` · ${selectedDeviceLensLabel()}`;
    els.sessionTitle.textContent = (agent ? tr('session.titleAgent', { name: agent.primary.name }) : tr('session.titleAll')) + lens;
    els.sessionTitle.title = els.sessionTitle.textContent;
    els.sessionTitle.removeAttribute('data-i18n');
  }
  if (els.rosterAllCard) {
    els.rosterAllCard.classList.toggle('selected', all);
    els.rosterAllCard.setAttribute('aria-pressed', String(all));
  }
}

function applySessionFilter() {
  const query = state.query;
  const searched = query
    ? withHubRuns(state.sessions).filter((session) => {
        return [
          session.title,
          session.id,
          session.address,
          session.projectPath,
          session.filePath,
          session.source,
          session.status,
          session.model,
          session._accountName,
          session._profileName,
          session._appLabel,
          session._deviceName,
          session._hubRun?.title,
          session._hubRun?.from,
          session._hubRun?.target?.name
        ].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
      })
    : [...withHubRuns(state.sessions)];
  // 标签与“新回复”筛选和搜索框同一处生效：只决定哪些行显示，不碰正在看的和已勾选的。
  const filtered = sessionMarks.filter(searched);
  const sorted = window.SessionTable
    ? window.SessionTable.sort(filtered, state.sessionSort, dateLocale())
    : filtered;
  state.filteredSessions = sessionMarks.order(sorted);
  sessionMarks.renderFilters(withHubRuns(state.sessions), { query: Boolean(query) });

  renderSessionControls();
  renderSessions();
}

const COMPACT_SESSION_COLUMNS = [
  { key: 'title', label: 'session.col.title', className: 'col-title', cellClass: 'title-cell' },
  { key: 'project', label: 'session.col.project', className: 'col-project', cellClass: 'path-cell' },
  { key: 'updatedAt', label: 'session.col.active', className: 'col-date' },
  { key: 'source', label: 'session.col.source', className: 'col-source' }
];

const DETAIL_SESSION_COLUMNS = [
  { key: 'title', label: 'session.col.title', className: 'col-title', cellClass: 'title-cell' },
  { key: 'account', label: 'session.col.account', className: 'col-account' },
  { key: 'app', label: 'session.col.app', className: 'col-app' },
  { key: 'createdAt', label: 'session.col.created', className: 'col-date' },
  { key: 'updatedAt', label: 'session.col.active', className: 'col-date' },
  { key: 'project', label: 'session.col.project', className: 'col-project', cellClass: 'mono path-cell' },
  { key: 'source', label: 'session.col.source', className: 'col-source' },
  { key: 'status', label: 'session.col.status', className: 'col-status' },
  { key: 'model', label: 'session.col.model', className: 'col-model' },
  { key: 'id', label: 'session.col.id', className: 'col-id', cellClass: 'mono' }
];

const MESH_LOCATION_COLUMN = {
  key: 'location',
  label: 'session.col.location',
  className: 'col-location'
};

function sessionColumns() {
  const base = state.sessionView === 'detail' ? DETAIL_SESSION_COLUMNS : COMPACT_SESSION_COLUMNS;
  return state.mesh.overview?.initialized && currentDeviceLensId() === 'all'
    ? [...base, MESH_LOCATION_COLUMN]
    : base;
}

function setAllVisibleSessionsSelected(selected) {
  const next = new Set(state.ui.checkedConversationIds);
  for (const session of state.filteredSessions) {
    const key = sessionKey(session);
    if (selected) next.add(key);
    else next.delete(key);
  }
  state.ui = window.UiContext.setCheckedConversations(state.ui, next);
  renderSessions();
}

function clearSessionActionSelection() {
  state.ui = window.UiContext.clearConversationActions(state.ui);
  renderSessions();
}

function setSessionChecked(session, checked) {
  const key = sessionKey(session);
  state.ui = window.UiContext.checkConversation(state.ui, key, checked);
  renderSessions();
}

function focusSession(session) {
  state.ui = window.UiContext.focusConversation(state.ui, session ? sessionKey(session) : null);
  if (session) setWorkspaceMode('sessions');
}

function renderSessionHead() {
  if (!els.sessionHead) return;
  const activeControl = document.activeElement;
  const restoreSelectAll = activeControl?.id === 'sessionSelectAll';
  const restoreSort = els.sessionHead.contains(activeControl) ? activeControl.dataset.sortKey : null;
  let sortControl = null;
  const row = document.createElement('tr');
  const selectHeading = document.createElement('th');
  selectHeading.scope = 'col';
  selectHeading.className = 'col-select';
  const selectAll = document.createElement('input');
  selectAll.id = 'sessionSelectAll';
  selectAll.className = 'session-select-box';
  selectAll.type = 'checkbox';
  selectAll.setAttribute('aria-label', tr('session.selectAll'));
  const selectedCount = state.filteredSessions.filter((session) => (
    state.ui.checkedConversationIds.has(sessionKey(session))
  )).length;
  selectAll.checked = state.filteredSessions.length > 0 && selectedCount === state.filteredSessions.length;
  selectAll.indeterminate = selectedCount > 0 && selectedCount < state.filteredSessions.length;
  selectAll.disabled = state.filteredSessions.length === 0;
  selectAll.addEventListener('change', () => setAllVisibleSessionsSelected(selectAll.checked));
  selectHeading.append(selectAll);
  row.append(selectHeading);
  for (const column of sessionColumns()) {
    const heading = document.createElement('th');
    heading.scope = 'col';
    heading.className = column.className || '';
    const active = state.sessionSort.key === column.key;
    if (active) {
      heading.setAttribute('aria-sort', state.sessionSort.direction === 'asc' ? 'ascending' : 'descending');
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sort-button';
    button.dataset.sortKey = column.key;
    if (restoreSort === column.key) sortControl = button;
    const label = tr(column.label);
    button.title = tr('session.sort.hint', { label });
    const text = document.createElement('span');
    text.textContent = label;
    const indicator = document.createElement('span');
    indicator.className = 'sort-indicator';
    indicator.setAttribute('aria-hidden', 'true');
    indicator.textContent = active ? (state.sessionSort.direction === 'asc' ? '↑' : '↓') : '';
    button.append(text, indicator);
    button.addEventListener('click', () => {
      const direction = state.sessionSort.key === column.key
        ? (state.sessionSort.direction === 'asc' ? 'desc' : 'asc')
        : (window.SessionTable?.defaultDirection(column.key) || 'asc');
      state.sessionSort = { key: column.key, direction };
      applySessionFilter();
    });
    heading.append(button);
    row.append(heading);
  }

  els.sessionHead.replaceChildren(row);
  (restoreSelectAll ? selectAll : sortControl)?.focus({ preventScroll: true });
}

function renderSessions() {
  const activeControl = document.activeElement;
  const restoreKey = activeControl?.closest('tr[data-session-key]')?.dataset.sessionKey;
  const restoreSelector = activeControl?.classList.contains('session-select-box') ? '.session-select-box' : '.title-cell-main';
  let rowControl = null;
  renderSessionControls();
  renderSessionActionToolbar();
  fitSessionToolbar();
  renderSessionHead();
  const accountCount = sessionAccountCount(state.filteredSessions);
  els.sessionCount.title = state.ui.agentScope === 'all'
    ? tr('session.countAll', { n: state.filteredSessions.length, accounts: accountCount })
    : tr('session.count', { n: state.filteredSessions.length });
  const filtering = Boolean(state.query) || sessionMarks.filterActive();
  const wasFiltering = els.sessionCount.dataset.filtered === 'true';
  els.sessionCount.dataset.filtered = String(filtering);
  if (filtering || wasFiltering) clearInterval(els.sessionCount._fxRoll);
  // 条数一直留出“N / N”的宽度：点筛选时它从“10”变成“2 / 10”，不能把旁边的筛选条挤动。
  els.sessionCount.style.minWidth = `${String(withHubRuns(state.sessions).length).length * 2 + 3}ch`;
  if (filtering) {
    const total = withHubRuns(state.sessions).length;
    els.sessionCount.textContent = `${state.filteredSessions.length} / ${total}`;
    els.sessionCount.title = tr('marks.shown', { shown: state.filteredSessions.length, total });
  } else if (window.PixelFx && !wasFiltering) window.PixelFx.roll(els.sessionCount, state.filteredSessions.length);
  else els.sessionCount.textContent = String(state.filteredSessions.length);
  if (els.rosterAllMeta && state.ui.agentScope === 'all') {
    els.rosterAllMeta.textContent = tr('roster.allMeta', { agents: identityGroups().length, n: state.sessions.length });
  }

  if (!state.filteredSessions.length) {
    const row = document.createElement('tr');
    row.className = 'empty-row';
    const cell = document.createElement('td');
    cell.colSpan = sessionColumns().length + 1;
    cell.textContent = state.sessions.length
      ? tr('session.empty.filtered')
      : tr(!orderedAgentGroups().length
        ? 'session.empty.noAgents'
        : state.ui.agentScope === 'all' ? 'session.empty.noneAll' : 'session.empty.none');
    row.append(cell);
    sessionRowCache = new Map();
    els.sessionRows.replaceChildren(row);
    announceSessionRows();
    return;
  }

  // Rows whose drawing would not change are kept; the others are drawn anew.
  const columns = sessionColumns();
  const view = sessionRowsView(columns);
  const previous = sessionRowCache;
  const next = new Map();
  const wanted = [];
  for (const session of state.filteredSessions) {
    if (session._hubRun) {
      const row = renderHubRow(session);
      if (sessionKey(session) === restoreKey) rowControl = row.querySelector(restoreSelector);
      wanted.push(row);
      continue;
    }
    const key = sessionKey(session);
    const signature = sessionRowSignature(session, view, columns);
    const kept = next.has(key) ? null : previous.get(key);
    let row;
    if (kept && kept.signature === signature) {
      row = kept.row;
      // A kept row is moved into place, not written in again.
      row.classList.remove('fx-in');
    } else {
      row = buildSessionRow(session, key, columns);
    }
    row._session = session;
    if (!next.has(key)) next.set(key, { row, signature });
    if (key === restoreKey) rowControl = row.querySelector(restoreSelector);
    wanted.push(row);
  }
  sessionRowCache = next;
  placeSessionRows(wanted);
  announceSessionRows();
  rowControl?.focus({ preventScroll: true });
}

// Rows already drawn, by session key (the ConversationIdentity row key, Mesh
// plan 11.5): the element and the signature of what it shows. An update draws
// only the rows whose signature changed (docs/ARCHITECTURE_PLAN.md 5.7).
let sessionRowCache = new Map();

// What every row's drawing depends on beyond its own session: the columns,
// the scope and view, the language, the date locale, and today's date
// (compactDate shows only the time for today's sessions, no year this year).
function sessionRowsView(columns) {
  return JSON.stringify([
    columns.map((column) => [column.key, column.className || '', column.cellClass || '']),
    state.ui.agentScope,
    state.sessionView,
    window.I18N ? window.I18N.getLang() : 'zh',
    dateLocale(),
    new Date().toDateString()
  ]);
}

// What one session row shows: the view, its key, whether it is checked or
// focused, every field its cells read, and its title marks.
function sessionRowSignature(session, view, columns) {
  const key = sessionKey(session);
  const replicas = Array.isArray(session.replicas) ? session.replicas : [];
  return JSON.stringify([
    view,
    key,
    state.ui.checkedConversationIds.has(key),
    key === state.ui.focusedConversationId,
    columns.map((column) => session[column.key] ?? null),
    session.title ?? null,
    session.id ?? null,
    session.address ?? null,
    session._accountName ?? null,
    session._profileName ?? null,
    session._appLabel ?? null,
    session.appId ?? null,
    session.createdAt ?? null,
    session.updatedAt ?? null,
    session.projectPath ?? null,
    session._deviceName ?? null,
    replicas.length,
    replicas.map((replica) => replica.deviceName || replica.deviceId),
    sessionMarks.titleSignature(session)
  ]);
}

// Puts the wanted rows in order, moving or removing only what differs.
function placeSessionRows(wanted) {
  const body = els.sessionRows;
  const keep = new Set(wanted);
  for (const child of [...body.children]) if (!keep.has(child)) child.remove();
  wanted.forEach((row, index) => {
    if (body.children[index] !== row) body.insertBefore(row, body.children[index] || null);
  });
}

// The rows were drawn: the focus band, the copy stamp and the write-in
// (src/pixel/ui.js) follow every drawing, also one that changed no element.
function announceSessionRows() {
  els.sessionRows.dispatchEvent(new CustomEvent('agentdesk:session-rows'));
}

// One session row; its handlers act on the session it shows now (row._session).
function buildSessionRow(session, key, columns) {
  const row = document.createElement('tr');
  row._session = session;
  row.dataset.sessionKey = key;
  const checked = state.ui.checkedConversationIds.has(key);
  row.classList.toggle('selected', checked);
  row.classList.toggle('session-active', key === state.ui.focusedConversationId);
  row.setAttribute('aria-selected', String(checked || key === state.ui.focusedConversationId));

  const selectCell = document.createElement('td');
  selectCell.className = 'select-cell';
  const checkbox = document.createElement('input');
  checkbox.className = 'session-select-box';
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.setAttribute('aria-label', tr('session.selectOne', { title: session.title || session.id || '' }));
  checkbox.addEventListener('click', (event) => event.stopPropagation());
  checkbox.addEventListener('change', () => setSessionChecked(row._session, checkbox.checked));
  selectCell.append(checkbox);
  row.append(selectCell);

  for (const column of columns) {
    row.append(renderSessionCell(session, column));
  }

  row.addEventListener('click', (event) => {
    const session = row._session;
    const tagButton = event.target.closest('.session-tag-btn');
    if (tagButton) {
      sessionMarks.openPicker(markTargets(session), tagButton);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      setSessionChecked(session, !state.ui.checkedConversationIds.has(key));
    } else {
      focusSession(session);
      renderSessions();
      // 点开这一行就算在这里看过了；从 AgentDesk 打开客户端不算。
      void sessionMarks.markSeen([session]);
    }
  });
  row.addEventListener('contextmenu', (event) => {
    const targets = markTargets(row._session);
    if (!targets.length) return;
    event.preventDefault();
    sessionMarks.openPicker(targets, { x: event.clientX, y: event.clientY });
  });
  return row;
}

// 会话工具栏只有一行（面板标题 38–48px）。放不下时一级一级收起次要的字，直到不溢出为止；放得下就全部显示。
function fitSessionToolbar() {
  const main = document.querySelector('.session-toolbar-main');
  if (!main) return;
  for (const level of ['0', '1', '2']) {
    main.dataset.fit = level;
    if (main.scrollWidth <= main.clientWidth + 1) return;
  }
}

function renderSessionCell(session, column) {
  const cell = document.createElement('td');
  cell.className = [column.className, column.cellClass].filter(Boolean).join(' ');
  let value = '';
  let fullValue = '';
  switch (column.key) {
    case 'title': {
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'title-cell-main';
      title.textContent = session.title || '-';
      cell.append(title);
      sessionMarks.decorateTitle(cell, session, title);
      if (state.ui.agentScope === 'all' && state.sessionView === 'compact') {
        const account = document.createElement('span');
        account.className = 'cell-subline';
        account.textContent = tr('session.itemMeta', {
          account: session._accountName || session._profileName || '-',
          app: session._appLabel || session.appId || '-'
        });
        cell.append(account);
      }
      cell.title = session.title || '';
      return cell;
    }
    case 'account':
      value = session._accountName || session._profileName || '-';
      break;
    case 'app':
      value = session._appLabel || session.appId || '-';
      break;
    case 'createdAt':
      value = compactDate(session.createdAt);
      fullValue = fullDate(session.createdAt);
      break;
    case 'updatedAt':
      value = compactDate(session.updatedAt);
      fullValue = fullDate(session.updatedAt);
      break;
    case 'project':
      fullValue = session.projectPath || '';
      value = fullValue ? (
        state.sessionView === 'compact'
          ? fullValue.split(/[\\/]/).filter(Boolean).at(-1) || fullValue
          : shortPath(fullValue)
      ) : '-';
      break;
    case 'id':
      value = session.address || session.id || '-';
      break;
    case 'location': {
      const replicas = Array.isArray(session.replicas) ? session.replicas : [];
      value = replicas.length > 1
        ? tr('session.locationCount', { n: replicas.length })
        : (session._deviceName || '-');
      fullValue = replicas.map((replica) => replica.deviceName || replica.deviceId).join(' · ');
      break;
    }
    default:
      value = session[column.key] || '-';
  }
  cell.textContent = value;
  cell.title = fullValue || String(value === '-' ? '' : value);
  return cell;
}

function sessionAccountCount(sessions) {
  return new Set((sessions || []).map((session) => (
    session._accountKey || session._profileId || ''
  )).filter(Boolean)).size;
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { setSessionView, renderSessionControls, applySessionFilter, sessionColumns, setAllVisibleSessionsSelected, clearSessionActionSelection, setSessionChecked, focusSession, renderSessionHead, renderSessions, fitSessionToolbar, renderSessionCell, sessionAccountCount };
Object.assign(window, { setSessionView, renderSessionControls, applySessionFilter, sessionColumns, setAllVisibleSessionsSelected, clearSessionActionSelection, setSessionChecked, focusSession, renderSessionHead, renderSessions, fitSessionToolbar, renderSessionCell, sessionAccountCount });
