// AgentDesk — the roster: one card per Agent on the shelf, the "全部" card,
// the roster's ordering and scrolling, and the selected Agent's header
// (docs/ARCHITECTURE_PLAN.md phase 6). Moved from src/renderer.js unchanged.

function deploymentStateLabel(value) {
  const stateName = String(value || 'absent');
  return tr(`deployment.state.${stateName}`);
}

function renderAccounts() {
  populateGroupDatalist();
  renderAccountRoster();
  renderTopbarContext();
  renderAttentionInbox();
}

let rosterController = null;

let lastRevealedAgent = null;

function orderedAgentGroups() {
  const groups = identityGroups();
  const order = window.RosterInteractions.normalizeOrder(state.agentOrder, groups.map(group => group.key));
  const byId = new Map(groups.map(group => [group.key, group]));
  return order.map(id => byId.get(id));
}

function ensureRosterInteractions() {
  if (rosterController || !window.RosterInteractions) return;
  rosterController = window.RosterInteractions.attach(els.accountRoster, {
    onReorder(ids, detail) {
      state.agentOrder = [...ids, ...state.agentOrder.filter(id => !ids.includes(id))];
      persistSettings({ agentOrder: state.agentOrder });
      document.querySelector('#rosterAnnouncement').textContent = tr('roster.moved', { n: detail.position, total: detail.total });
    },
    onEnd() { renderAccountRoster(); }
  });
}

// 空台面：一只趴着的猫、一句说明和唯一的主按钮。已经在台面上时不重画，免得打断待机动作。
function renderRosterEmptyState() {
  const titleText = tr('roster.empty.title');
  const current = els.accountRoster.querySelector('.account-roster-empty b');
  if (current?.textContent === titleText) return;
  const empty = document.createElement('div');
  empty.className = 'account-roster-empty';
  const seat = document.createElement('span');
  seat.className = 'account-roster-empty-seat';
  seat.setAttribute('aria-hidden', 'true');
  const pit = document.createElement('span');
  pit.className = 'account-card-pit';
  const cat = document.createElement('span');
  cat.className = 'account-card-cat fx-idle';
  const canvas = document.createElement('canvas');
  canvas.className = 'account-card-avatar';
  canvas.width = 80;
  canvas.height = 80;
  cat.append(canvas);
  pit.append(cat);
  const ledge = document.createElement('i');
  ledge.className = 'account-card-ledge';
  seat.append(pit, ledge);
  const body = document.createElement('div');
  const title = document.createElement('b');
  title.textContent = titleText;
  const lead = document.createElement('p');
  lead.textContent = tr('roster.empty.lead');
  const recruit = document.createElement('button');
  recruit.type = 'button';
  recruit.className = 'primary';
  const icon = document.createElement('i');
  icon.className = 'pxi';
  icon.dataset.i = 'plus';
  icon.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.textContent = tr('roster.recruitFirst');
  recruit.append(icon, label);
  recruit.addEventListener('click', () => els.addProfileBtn.click());
  body.append(title, lead, recruit);
  empty.append(seat, body);
  els.accountRoster.replaceChildren(empty);
  window.PixelUi?.setCat(canvas, { look: 'orange', accessory: 'none', collar: '#2f9e8f', action: 'rest', seed: 'empty-desk' });
  // 页脚还停在默认的“就绪”时，换成一句能照着做的话。
  if (els.statusText?.dataset.i18n === 'status.ready') setStatus(tr('roster.empty.status'));
}

function renderAccountRoster() {
  if (!els.accountRoster || rosterController?.isInteracting()) return;
  ensureRosterInteractions();
  const scrollLeft = els.accountRoster.scrollLeft;
  const groups = orderedAgentGroups();
  if (els.presenterCount) els.presenterCount.textContent = `×${groups.length}`;
  renderRosterAllCard(groups.length);
  if (!groups.length) {
    renderRosterEmptyState();
    return;
  }

  const cards = new Map([...els.accountRoster.children].map((card) => [card.dataset.agentId, card]));
  const now = Date.now();
  const orderedCards = groups.map((group) => {
    const card = cards.get(group.key) || createAccountCard(group.key);
    cards.delete(group.key);
    updateAccountCard(card, group, now);
    return card;
  });
  for (const card of cards.values()) card.remove();
  for (const [index, card] of orderedCards.entries()) {
    // Polling updates the labels in place so an open selector and keyboard focus survive.
    const current = els.accountRoster.children[index];
    if (current !== card) els.accountRoster.insertBefore(card, current || null);
  }
  els.accountRoster.scrollLeft = scrollLeft;
  renderHubLinks();
  if (lastRevealedAgent !== currentAgentId()) {
    lastRevealedAgent = currentAgentId();
    revealSelectedAccountCard();
  }
  positionQuotaPopover();
}

function revealSelectedAccountCard() {
  if (!els.accountRoster) return;
  const selected = els.accountRoster.querySelector('.account-card.selected');
  if (!selected) return;
  // Keep the roster itself as the explicit horizontal owner. Chromium's
  // scrollIntoView can choose the presenter's overflow:hidden box in this
  // nested layout and leave a persisted/right-side selection clipped.
  const rosterRect = els.accountRoster.getBoundingClientRect();
  const selectedRect = selected.getBoundingClientRect();
  const style = getComputedStyle(els.accountRoster);
  const inlineInset = Number.parseFloat(style.scrollPaddingInlineStart) || 0;
  const visibleLeft = rosterRect.left + inlineInset;
  const visibleRight = rosterRect.right - inlineInset;
  if (selectedRect.left < visibleLeft) {
    els.accountRoster.scrollLeft = Math.max(0, els.accountRoster.scrollLeft - (visibleLeft - selectedRect.left));
  } else if (selectedRect.right > visibleRight) {
    const maxScrollLeft = Math.max(0, els.accountRoster.scrollWidth - els.accountRoster.clientWidth);
    els.accountRoster.scrollLeft = Math.min(
      maxScrollLeft,
      els.accountRoster.scrollLeft + (selectedRect.right - visibleRight)
    );
  }
}

function accountCardQuotaSource(member) {
  const parts = [
    member?._accountBindingAlias || (!member?._meshAgentId ? member?.name : null),
    member?._meshDeviceName,
    member?.appId ? appLabel(member.appId) : null
  ].filter(Boolean);
  return [...new Set(parts)].join(' / ') || String(member?.id || '-');
}

function trustedLocalAccountCardQuota(group, now) {
  if (!window.QuotaOverview?.selectTrustedAccountQuota) {
    return { status: 'unknown', reason: 'quota-helper-unavailable' };
  }
  return window.QuotaOverview.selectTrustedAccountQuota(group, state.quotas, now, {
    quotaError: state.quotaError,
    maxAgeMs: window.AgentDeskTimeWindows.QUOTA_FRESH_MS
  });
}

function selectedCardControl(selector) {
  return els.accountRoster.querySelector(`.account-card.selected ${selector}`);
}

// 一张卡片上动作的落点：正在看的那只用明确选定的运行位置，
// 其他的用这个设备视角下记住的位置，没有记录时用卡片上显示的首选位置。
function cardActionProfile(group) {
  if (!group) return null;
  return group.key === currentAgentId() ? selectedGroupProfile(group) : preferredGroupSlot(group);
}

function accountCardControl(agentId, selector) {
  const card = [...els.accountRoster.children].find((item) => item.dataset.agentId === agentId);
  return card?.querySelector(selector) || null;
}

function createAccountCard(agentId) {
  const card = els.accountCardTemplate.content.firstElementChild.cloneNode(true);
  card.dataset.agentId = agentId;
  card.addEventListener('click', (event) => {
    if (!event.target.closest('[data-roster-control]')) void pickRosterAgent(agentId);
  });
  card.querySelector('.account-card-launch').addEventListener('click', async () => {
    // 打开不选中这只猫：正在看的列表、范围和其他猫的选择都保持原样。
    window.PixelUi?.launchStart(agentId);
    let result = null;
    try {
      result = await openAgent(agentId);
    } finally {
      const outcome = launchOutcome(result);
      window.PixelUi?.launchEnd(agentId, outcome, tr(outcome === 'ok' ? 'fx.started' : 'fx.waiting'));
    }
  });
  card.querySelector('.account-card-manage').addEventListener('click', () => {
    openAgentDossier(agentId);
  });
  // 信封：看这只猫的会话，并只看有新回复的那些。
  card.querySelector('.account-card-mail').addEventListener('click', async () => {
    sessionMarks.clearFilters();
    sessionMarks.showFresh();
    await pickRosterAgent(agentId);
    applySessionFilter();
  });
  card.querySelector('select').addEventListener('change', (event) => {
    changeAccountCardRuntime(agentId, event.target.value);
  });
  card.querySelector('.account-card-quota-summary').addEventListener('click', (event) => {
    event.preventDefault();
    const anchor = event.currentTarget;
    if (state.quotaAnchor !== anchor) {
      els.quotaPopover.hidePopover();
      setActionAgent(agentId);
    }
    toggleQuotaPopover(anchor);
  });
  return card;
}

function changeAccountCardRuntime(agentId, value) {
  const group = identityGroups().find((item) => item.key === agentId);
  if (!group || !value) return;
  if (value.startsWith('prepare:')) {
    if (group.members.length) return;
    const [, appId, clientForm = 'desktop'] = value.split(':');
    const action = currentAgentActionContext(group, null);
    rememberProvisioningChoice(group, action.deviceId, appId, clientForm);
    renderAccountHeader();
    return;
  }
  const member = group.members.find((item) => item.id === value);
  if (!member) return;
  // 换运行位置只记在这只猫身上，不选中它，正在看的列表不变。
  updateUi(window.UiContext.setAgentSlot(state.ui, group.key, member._meshSlotKey || member.id));
  persistUiSelectionMemory();
  renderAccounts();
  renderAccountHeader();
}

// 打开的结果归成三种：起来了、要用户接着做、没成。
function launchOutcome(result) {
  if (!result || result.ok === false) return 'fail';
  if (result.state && result.state !== 'ready') return 'wait';
  return 'ok';
}

// 选谁看谁：点一只猫只看它的会话；“全部”看所有猫的。底层仍是 agentScope。
async function pickRosterAgent(agentId) {
  if (state.ui.agentScope !== 'current') {
    state.ui = window.UiContext.setAgentScope(state.ui, 'current');
    persistSettings({ sessionScope: 'current' });
    renderSessionControls();
    if (agentId === currentAgentId()) {
      renderAccounts();
      await loadSessions();
      return;
    }
  }
  if (agentId !== currentAgentId()) await selectAgent(agentId);
}

async function pickRosterAll() {
  if (state.ui.agentScope === 'all') return;
  const pending = setSessionScope('all');
  renderAccounts();
  await pending;
}

function renderRosterAllCard(agentCount) {
  if (!els.rosterAllCard) return;
  const all = state.ui.agentScope === 'all';
  els.rosterAllCard.hidden = agentCount === 0;
  els.rosterAllCard.classList.toggle('selected', all);
  els.rosterAllCard.setAttribute('aria-pressed', String(all));
  if (els.rosterAllMeta) {
    els.rosterAllMeta.textContent = all
      ? tr('roster.allMeta', { agents: agentCount, n: state.sessions.length })
      : tr('roster.allAgents', { agents: agentCount });
  }
}

function updateAccountCard(card, group, now) {
  const primary = group.primary;
  const current = group.key === currentAgentId();
  const selected = current && state.ui.agentScope !== 'all';
  const profile = cardActionProfile(group);
  const action = currentAgentActionContext(group, profile);
  const selectAgentButton = card.querySelector('.account-card-select');
  card.classList.toggle('selected', selected);
  card.classList.toggle('current', current);
  selectAgentButton.setAttribute('aria-pressed', String(selected));

  const activityEvidence = window.IdentityGroups?.cardActivityEvidence
    ? window.IdentityGroups.cardActivityEvidence(group.members, state.activity)
    : { merged: state.activity[primary.id] || null, remoteUnknown: primary._remote === true };
  const merged = activityEvidence.merged;
  const derivedActivityState = merged && window.YardCats ? window.YardCats.deriveState(now, primary, merged) : null;
  // A local working signal proves that the Agent is working. A local rest/idle
  // signal cannot describe remote Presence while remote activity is not part
  // of inventory, so mixed groups otherwise remain explicitly unknown.
  let activityState = window.IdentityGroups?.resolveCardActivityState
    ? window.IdentityGroups.resolveCardActivityState(activityEvidence, derivedActivityState)
    : (activityEvidence.remoteUnknown && derivedActivityState !== 'working' ? null : derivedActivityState);
  // 后台对话是 AgentDesk 亲手中转的，在跑就是在干活；刚结束的那一会儿按结局显示。
  const hubCard = hubCardState(group);
  if (hubCard.state) activityState = hubCard.state;
  // 猫有多忙：同时在跑的对话数决定演干活、忙还是抓狂；0 条或不知道时不改上面的判断。迷糊照旧先演。
  const running = cardRunningCount(group, merged);
  const busyAction = window.YardCats?.busyAction ? window.YardCats.busyAction(running) : null;
  if (busyAction && activityState !== 'confused') activityState = busyAction;
  const meshMode = state.mesh.overview?.initialized === true;
  const deploymentState = group.readiness?.state || 'absent';
  const notReady = meshMode && deploymentState !== 'ready';
  // 状态只说一次：这一行说它在干嘛；要用户做的事交给徽章和按钮。
  const stateLabel = busyAction && activityState === busyAction
    ? tr('card.running', { n: running })
    : (activityState
      ? tr('state.' + activityState)
      : (notReady ? deploymentStateLabel(deploymentState) : tr('card.activityUnknown')));

  const activityAt = merged?.contentActiveAt || merged?.latestMtime || null;
  const activityDate = activityAt ? new Date(activityAt) : null;
  const hasActivityTime = Boolean(activityDate && !Number.isNaN(activityDate.getTime()));
  const lastActiveLine = `${tr(activityEvidence.remoteUnknown && merged ? 'card.lastActiveLocal' : 'card.lastActive')} ${
    hasActivityTime ? fullDate(activityAt) : tr('common.unrecorded')}`;
  const slots = group.allMembers || group.members;
  const positionsLine = meshMode
    ? tr('presenter.positions', {
        positions: slots.length,
        online: slots.filter((member) => member._deviceStatus === 'online').length
      })
    : (primary.group ? tr('card.group', { g: primary.group }) : '');
  selectAgentButton.title = [accountCardTooltip(action), lastActiveLine, positionsLine].filter(Boolean).join('\n');

  const name = card.querySelector('.account-card-name');
  name.textContent = primary.name;

  // 新回复：本机运行位置上回完了、还没在这里点开过的条数；没有就什么都不显示。
  const replies = sessionMarks.freshCount(group.members
    .filter((member) => member._remote !== true)
    .map((member) => state.activity[member.id])
    .filter(Boolean));
  const repliesLine = card.querySelector('.account-card-replies');
  repliesLine.hidden = replies === 0;
  repliesLine.textContent = replies ? tr('card.replies', { n: replies }) : '';
  const mail = card.querySelector('.account-card-mail');
  const wasMail = Number(mail.dataset.count) || 0;
  mail.hidden = replies === 0;
  mail.dataset.count = String(replies);
  mail.querySelector('b').textContent = String(replies);
  mail.title = tr('card.mail.title', { n: replies });
  mail.setAttribute('aria-label', `${primary.name} · ${mail.title}`);
  if (replies > wasMail && wasMail >= 0 && card.isConnected && mail.dataset.seen === 'true') {
    mail.classList.remove('fx-pop');
    void mail.offsetWidth;
    mail.classList.add('fx-pop');
  }
  mail.dataset.seen = 'true';

  const st = card.querySelector('.account-card-state');
  st.dataset.activity = activityState || 'unknown';
  st.title = busyAction && activityState === busyAction ? tr('card.running.hint') : '';
  card.querySelector('.account-card-state-label').textContent = stateLabel;
  card.dataset.readiness = meshMode ? deploymentState : 'local';

  const badgeIcon = notReady
    ? (READINESS_BADGE[deploymentState] || 'bang')
    : (activityState === 'confused' ? 'q' : '');
  const badge = card.querySelector('.account-card-badge');
  badge.hidden = !badgeIcon;
  badge.dataset.i = badgeIcon;
  badge.title = notReady ? deploymentStateLabel(deploymentState) : (badgeIcon ? stateLabel : '');

  const quotaSummary = card.querySelector('.account-card-quota-summary');
  let quotaTrack = quotaSummary.querySelector('.account-card-quota');
  let quotaValue = quotaSummary.querySelector('.account-card-fact-value');
  if (!quotaTrack || !quotaValue) {
    quotaTrack = document.createElement('span');
    quotaTrack.className = 'account-card-quota';
    for (let index = 0; index < 5; index += 1) {
      const pip = document.createElement('i');
      pip.style.setProperty('--i', String(index));
      quotaTrack.append(pip);
    }
    quotaValue = document.createElement('strong');
    quotaValue.className = 'account-card-fact-value';
    quotaSummary.replaceChildren(quotaTrack, quotaValue);
  }
  const setPips = (count) => {
    [...quotaTrack.children].forEach((pip, index) => pip.classList.toggle('on', index < count));
  };

  // 只展示本地 Slot 的新鲜实时快照；旧采样、已过重置点和远端缓存都不进入卡片额度。
  const trustedQuota = trustedLocalAccountCardQuota(group, now);
  delete quotaSummary.dataset.source;
  if (trustedQuota.status === 'ok') {
    const { member, snapshot, tightest } = trustedQuota;
    const source = accountCardQuotaSource(member);
    const percent = Math.max(0, Math.min(100, Math.round(tightest.remainingPercent)));
    const fullValue = tr('quota.overview.value', { label: tightest.label, pct: percent });
    const title = tr('card.quotaSource', {
      source,
      value: fullValue,
      time: fullDate(snapshot.observedAt)
    });
    quotaValue.textContent = `${percent}%`;
    quotaValue.title = title;
    quotaSummary.dataset.source = source;
    quotaTrack.dataset.trusted = 'true';
    quotaTrack.dataset.level = window.YardEnergy?.energyForRemaining?.(percent) || 'unknown';
    setPips(percent > 0 ? Math.max(1, Math.round(percent / 20)) : 0);
    quotaTrack.title = title;
  } else {
    const conflict = trustedQuota.status === 'conflict';
    const notApplicable = trustedQuota.status === 'not_applicable';
    quotaValue.textContent = tr(conflict ? 'card.quotaConflict'
      : (notApplicable ? 'quota.status.notApplicable' : 'devices.value.unknown'));
    quotaValue.title = notApplicable ? trustedQuota.snapshot.reason
      : tr(conflict ? 'card.quotaConflictHint' : 'quota.chip.noData');
    quotaTrack.dataset.trusted = 'false';
    quotaTrack.dataset.reason = trustedQuota.reason || 'unknown';
    quotaTrack.dataset.level = 'unknown';
    setPips(0);
    quotaTrack.title = quotaValue.title;
  }
  // 猫：外观来自它存的样子；演哪个动作由活动和这条能量格一起决定（规则在 yard/cats.js 的 actionFor）。
  const look = window.YardCats ? catAppearanceOf(primary.cat, primary.id) : null;
  window.PixelUi?.setCat(card.querySelector('.account-card-avatar'), {
    ...(look || {}),
    ...(hubCard.accessory ? { accessory: hubCard.accessory } : {}),
    seed: group.key,
    state: activityState || null,
    papers: busyAction ? running : 0,
    energy: quotaTrack.dataset.trusted === 'true' ? quotaTrack.dataset.level : null
  });

  quotaSummary.disabled = !profile;
  quotaSummary.title = tr('quota.self.title');
  quotaSummary.setAttribute('aria-label', `${primary.name} · ${tr('card.quota')} · ${quotaValue.textContent}`);

  renderAccountCardRuntime(card.querySelector('.account-card-runtime'), action);
  renderAccountCardLaunch(card.querySelector('.account-card-launch'), action);
  const manage = card.querySelector('.account-card-manage');
  manage.textContent = tr('account.manageShort');
  manage.title = tr('account.manageAgent');
  manage.setAttribute('aria-label', `${primary.name} · ${manage.title}`);
}

function renderAccountCardRuntime(label, action) {
  const { group, profile, requested } = action;
  const select = label.querySelector('select');
  label.querySelector('span').textContent = tr('devices.slot.label');
  select.title = tr('devices.slot.title');
  const single = label.querySelector('.account-card-runtime-single');
  const singleMember = group.members.length === 1 ? group.members[0] : null;
  single.hidden = !singleMember;
  select.hidden = Boolean(singleMember);
  if (singleMember) {
    const device = singleMember._remote ? singleMember._meshDeviceName : tr('devices.device.local');
    single.textContent = `${device || singleMember.name} · ${appLabel(singleMember.appId)}`;
    single.title = `${singleMember._meshDeviceName || singleMember.name} · ${appLabel(singleMember.appId)}`;
  }
  const options = [];
  let value = profile?.id || '';
  if (group.members.length) {
    if (!profile) options.push({ value: '', text: tr('devices.slot.choose'), disabled: true });
    const locations = group.members.map((member) => {
      const device = member._remote ? member._meshDeviceName : tr('devices.device.local');
      return { member, text: `${device || member.name} · ${appLabel(member.appId)}` };
    });
    for (const { member, text } of locations) {
      const ambiguous = locations.some((location) => location.member !== member && location.text === text);
      options.push({
        value: member.id,
        text: ambiguous ? `${text} · ${member.name}` : text,
        disabled: false
      });
    }
  } else {
    const apps = supportedProvisioningApps();
    if (!requested || !apps.length) {
      options.push({ value: '', text: tr(apps.length ? 'deployment.client.choose' : 'deployment.client.noneSupported'), disabled: true });
    }
    for (const app of apps) {
      const optionValue = `prepare:${app.appId}:${app.clientForm}`;
      options.push({ value: optionValue, text: tr('deployment.client.unprepared', { app: app.label }), disabled: false });
      if (app.appId === requested?.appId && app.clientForm === requested?.clientForm) value = optionValue;
    }
  }
  // Retain the open native picker on ordinary activity and quota refreshes.
  if (select.options.length !== options.length || !options.every((item, index) => {
    const option = select.options[index];
    return option.value === item.value && option.textContent === item.text && option.disabled === item.disabled;
  })) {
    select.replaceChildren(...options.map((item) => {
      const option = new Option(item.text, item.value);
      option.disabled = item.disabled;
      return option;
    }));
  }
  if (select.value !== value) select.value = value;
  select.disabled = options.every((item) => item.disabled);
}

function accountCardTooltip(action) {
  const { profile, group, agent } = action;
  if (!profile) {
    const device = action.device?.name || selectedDeviceLensLabel() || '-';
    return [group.primary.name, tr('deployment.environmentStatus', { device, state: deploymentStateLabel(action.readiness?.state) }), agent?.note].filter(Boolean).join('\n');
  }
  const groupLabel = agent?.group || profile.group;
  const meta = profile._remote
    ? tr('devices.slot.remoteMeta', { device: profile._meshDeviceName || '-', status: tr(`devices.status.${profile._deviceStatus || 'offline'}`) })
    : [appLabel(profile.appId), tr(profile.isProtected ? 'acct.slotDefault' : 'acct.slotIndependent'),
      groupLabel, tr('acct.lastOpen', { t: compactDate(profile.lastLaunchedAt) })].filter(Boolean).join(' · ');
  const location = profile._remote
    ? tr('devices.slot.remotePath')
    : tr('acct.tip', { p: shortPath(profile.profilePath), s: shortPath(profile.sessionRoot) });
  return [group.primary.name, meta, location, profile.note ? tr('acct.note', { note: profile.note }) : ''].filter(Boolean).join('\n');
}

function renderAccountHeader() {
  const profile = selectedProfile();
  const remote = profile?._remote === true;
  const meshMode = state.mesh.overview?.initialized === true;
  const selectedAgent = catalogAgentById(actionAgentId());
  const localLens = !meshMode
    || currentDeviceLensId() === 'all'
    || currentDeviceLensId() === state.mesh.overview.localDeviceId;
  const firstUseAction = onboardingNeedsPresentation() && (
    !meshMode || !(state.mesh.overview?.agents || []).length
  );

  const recruitLabel = els.addProfileBtn.querySelector(':scope > span');
  if (recruitLabel) recruitLabel.textContent = tr('roster.recruit');
  const editProfileLabel = els.editProfileBtn.querySelector(':scope > span');
  const removeProfileLabel = els.removeProfileBtn.querySelector(':scope > span');
  if (editProfileLabel) editProfileLabel.textContent = tr(meshMode ? 'account.editAgent' : 'account.edit');
  else els.editProfileBtn.textContent = tr(meshMode ? 'account.editAgent' : 'account.edit');
  if (removeProfileLabel) removeProfileLabel.textContent = tr(meshMode ? 'account.removeCatalog' : 'account.remove');
  else els.removeProfileBtn.textContent = tr(meshMode ? 'account.removeCatalog' : 'account.remove');
  els.addProfileBtn.disabled = false;
  els.addProfileBtn.title = firstUseAction
    ? tr('account.createFirstAgentHint')
    : (meshMode ? tr('account.addAgentHint') : '');
  if (els.addRuntimeLocationBtn) {
    els.addRuntimeLocationBtn.hidden = !meshMode;
    els.addRuntimeLocationBtn.disabled = !selectedAgent || !localLens;
    els.addRuntimeLocationBtn.title = localLens ? '' : tr('account.addRemoteDisabled');
  }
  if (els.manageAgentRelationsBtn) {
    els.manageAgentRelationsBtn.hidden = !meshMode;
    els.manageAgentRelationsBtn.disabled = !selectedAgent;
  }

  els.pathConfigBtn.disabled = !profile || remote;
  els.diagnosticsBtn.disabled = !profile || remote;
  els.profileFolderBtn.disabled = !profile || remote;
  els.refreshBtn.disabled = !profile || (remote && !window.manager.refreshMeshInventory);
  els.editProfileBtn.disabled = meshMode ? !selectedAgent : (!profile || remote);
  els.removeProfileBtn.disabled = meshMode ? !selectedAgent : (!profile || remote);

  renderAccountRoster();
  renderQuotaSummary();
  renderTopbarContext();
  renderAgentManageContext();
}

function renderAccountCardLaunch(button, action) {
  const { profile, meshMode } = action;
  const remote = profile?._remote === true;
  const profileCanLaunch = profile ? state.appMeta[profile.appId]?.canLaunch !== false : false;
  const requestedCanProvision = action.requested?.appId
    ? state.appMeta[action.requested.appId]?.canProvision === true
    : false;
  const unavailable = ['offline', 'retired'].includes(action.readiness?.state);
  const remoteCapability = profile ? 'profile.launch' : 'agent.prepare';
  const remoteSupported = !action.isRemote
    || (action.device?.capabilities || []).includes(remoteCapability);
  const remotePermitted = !action.isRemote
    || (action.device?.permissions || []).includes(remoteCapability);
  const canOpen = meshMode
    ? Boolean(action.agent && !action.busy && !unavailable && remoteSupported && remotePermitted && (
        (profile && profileCanLaunch) || (!profile && requestedCanProvision)
      ))
    : Boolean(profile && profileCanLaunch && !remote);
  button.textContent = meshMode ? provisioningButtonLabel(action) : tr('account.open');
  button.dataset.kind = profile && (!meshMode || action.readiness?.state === 'ready') ? 'open' : 'step';
  button.disabled = !canOpen;
  if (action.isRemote && !remoteSupported) button.title = tr('deployment.action.remoteUnsupported');
  else if (action.isRemote && !remotePermitted) button.title = tr('deployment.action.remotePermission');
  else if (unavailable) button.title = tr('deployment.action.offline');
  else if (!profile && !action.requested?.appId) button.title = tr('deployment.action.chooseClient');
  else if (!profile && !requestedCanProvision) button.title = tr('deployment.action.unsupportedClient');
  else if (profile && !profileCanLaunch) button.title = tr('deployment.action.externalClient');
  else button.title = '';
  button.setAttribute('aria-label', `${action.group.primary.name} · ${button.textContent}`);
}

// Whether a pointer or keyboard gesture is reordering the roster right now
// (read by the acceptance run through window.AgentDeskInspect).
function rosterIsInteracting() {
  return rosterController.isInteracting();
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { deploymentStateLabel, renderAccounts, orderedAgentGroups, ensureRosterInteractions, renderRosterEmptyState, renderAccountRoster, revealSelectedAccountCard, accountCardQuotaSource, trustedLocalAccountCardQuota, selectedCardControl, cardActionProfile, accountCardControl, createAccountCard, changeAccountCardRuntime, launchOutcome, pickRosterAgent, pickRosterAll, renderRosterAllCard, updateAccountCard, renderAccountCardRuntime, accountCardTooltip, renderAccountHeader, renderAccountCardLaunch, rosterIsInteracting };
Object.assign(window, { deploymentStateLabel, renderAccounts, orderedAgentGroups, ensureRosterInteractions, renderRosterEmptyState, renderAccountRoster, revealSelectedAccountCard, accountCardQuotaSource, trustedLocalAccountCardQuota, selectedCardControl, cardActionProfile, accountCardControl, createAccountCard, changeAccountCardRuntime, launchOutcome, pickRosterAgent, pickRosterAll, renderRosterAllCard, updateAccountCard, renderAccountCardRuntime, accountCardTooltip, renderAccountHeader, renderAccountCardLaunch, rosterIsInteracting });
