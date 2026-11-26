/* Recruit (add account) dialog controller: one folder, four sections.
 * It only calls fixed manager methods and reports back through injected
 * callbacks; it never sees a real path except the display path Main returns,
 * and a pasted key is read from its field once and the field is cleared. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createRecruitDialog = factory;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { document, manager, tr, getApps, isMeshReady, createWithMesh, afterAccountChange, platform } = deps;
  // The renderer's one way to show a modal dialog (src/renderer/views/dialogs.js).
  const openDialog = deps.openDialog || ((dialog) => dialog.showModal());
  const $ = (selector) => document.querySelector(selector);
  const els = {
    dialog: $('#recruitDialog'),
    tabs: [...document.querySelectorAll('#recruitDialog .recruit-tabs > button')],
    panels: [...document.querySelectorAll('#recruitDialog .recruit-content > section')],
    name: $('#recruitName'),
    client: $('#recruitClient'),
    methods: $('#recruitMethods'),
    secretFields: $('#recruitSecretFields'),
    newNote: $('#recruitNewNote'),
    scanStatus: $('#recruitScanStatus'),
    scanHome: $('#recruitScanHomeBtn'),
    pickFolder: $('#recruitPickFolderBtn'),
    cancelScan: $('#recruitCancelScanBtn'),
    groups: $('#recruitGroups'),
    drop: $('#recruitDropZone'),
    dropResult: $('#recruitDropResult'),
    moveWarning: $('#recruitMoveWarning'),
    accepts: $('#recruitAccepts'),
    steps: $('#recruitSteps'),
    status: $('#recruitStatus'),
    primary: $('#recruitPrimaryBtn'),
    secondary: $('#recruitSecondaryBtn'),
    close: $('#recruitCloseBtn')
  };
  const SECTIONS = ['new', 'existing', 'drop', 'ai'];
  const state = {
    section: 'new',
    clientId: null,
    method: 'browser',
    busy: false,
    status: '',
    statusTone: 'neutral',
    homes: [],
    hints: [],
    checked: new Set(),
    scan: 'idle',
    deep: false,
    truncated: false,
    dropPending: null,
    watch: null
  };
  if (!els.dialog) return { open() {}, render() {}, state };

  function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    node.append(...children.filter(Boolean));
    return node;
  }
  const icon = (name) => el('i', { className: 'pxi', 'data-i': name, 'aria-hidden': 'true' });

  function apps() {
    return (getApps() || []).filter((app) => app && app.id);
  }
  function app(appId) {
    return apps().find((item) => item.id === appId) || null;
  }
  function signIn(appId) {
    return app(appId)?.signIn || { browser: true, key: false, provider: false, providerFields: [], providerOptionalFields: [] };
  }
  function translated(key, fallbackKey, params) {
    const value = tr(key, params);
    return value === key ? tr(fallbackKey, params) : value;
  }
  function reasonText(code) {
    return translated(`recruit.error.${code || 'generic'}`, 'recruit.error.generic');
  }
  function methodText(method) {
    return translated(`recruit.signedIn.${method || 'unknown'}`, 'recruit.signedIn.unknown');
  }

  function setStatus(text, tone = 'neutral') {
    state.status = text || '';
    state.statusTone = tone;
    renderFooter();
  }

  function stopWatch() {
    if (state.watch) clearInterval(state.watch.timer);
    state.watch = null;
  }

  // ---------- 新来一只 ----------
  // A client with one account per computer (defaultOnly) has no new folder to
  // make: "new" registers the one signed in on this computer.
  function availableClients() {
    return apps().map((item) => {
      const methods = item.signIn || {};
      const usable = methods.browser || methods.key || methods.provider || item.defaultOnly === true;
      return { ...item, usable: Boolean(usable) };
    });
  }

  // Whether the chosen way of signing in takes a pasted key or account.
  function needsSecret() {
    return state.method === 'key' || state.method === 'provider';
  }

  function renderClientSelect() {
    const clients = availableClients();
    if (!state.clientId || !clients.some((item) => item.id === state.clientId && item.usable)) {
      state.clientId = (clients.find((item) => item.recruitDefault && item.usable) || clients.find((item) => item.usable))?.id || null;
    }
    els.client.replaceChildren(...clients.map((item) => el('option', {
      value: item.id,
      disabled: !item.usable,
      text: item.defaultOnly ? tr('recruit.new.defaultOnly', { client: item.label }) : item.label
    })));
    if (state.clientId) els.client.value = state.clientId;
  }

  function methodsFor(appId) {
    const methods = signIn(appId);
    const list = [];
    if (app(appId)?.defaultOnly) {
      list.push({ value: 'default', title: tr('recruit.method.default'), hint: tr('recruit.method.default.hint', { client: app(appId).label }) });
    }
    if (methods.browser) {
      list.push({ value: 'browser', title: tr('recruit.method.browser'), hint: translated(`recruit.method.browser.${appId}`, 'recruit.method.browser.hint') });
    }
    if (methods.key) {
      list.push({ value: 'key', title: translated(`recruit.method.key.${appId}`, 'recruit.method.key'), hint: translated(`recruit.method.key.${appId}.hint`, 'recruit.method.key.hint') });
    }
    if (methods.provider) list.push({ value: 'provider', title: tr('recruit.method.provider'), hint: tr('recruit.method.provider.hint') });
    return list;
  }

  function renderMethods() {
    const methods = methodsFor(state.clientId);
    if (!methods.some((method) => method.value === state.method)) state.method = methods[0]?.value || 'browser';
    const legend = el('legend', { text: tr('recruit.new.how') });
    els.methods.replaceChildren(legend, ...methods.map((method) => el('label', { className: 'recruit-choice' },
      el('input', {
        type: 'radio', name: 'recruitSignIn', value: method.value, checked: state.method === method.value,
        onchange: () => { state.method = method.value; setStatus(''); renderNew(); }
      }),
      el('span', {}, el('b', { text: method.title }), el('small', { text: method.hint }))
    )));
  }

  function field(labelKey, input) {
    return el('label', {}, el('span', { text: tr(labelKey) }), input);
  }

  function renderSecretFields() {
    const methods = signIn(state.clientId);
    const kept = Object.fromEntries([...els.secretFields.querySelectorAll('input')]
      .filter((input) => input.id !== 'recruitSecret').map((input) => [input.id, input.value]));
    const fields = [];
    if (needsSecret()) {
      fields.push(field('recruit.field.secret', el('input', {
        id: 'recruitSecret', type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: '4096', oninput: updatePrimary
      })));
    }
    if (state.method === 'key' && methods.keyNeedsCatalogProvider) {
      fields.push(field('recruit.field.catalog', el('input', { id: 'recruitCatalog', type: 'text', className: 'recruit-mono', value: methods.keyCatalogDefault || '', spellcheck: 'false', maxlength: '64', oninput: updatePrimary })));
      if (methods.keyAsksDefaultModel) fields.push(field('recruit.field.defaultModel', el('input', { id: 'recruitCatalogModel', type: 'text', className: 'recruit-mono', spellcheck: 'false', maxlength: '128' })));
    }
    if (state.method === 'provider') {
      const optional = new Set(methods.providerOptionalFields || []);
      for (const name of [...(methods.providerFields || []), ...optional]) {
        const id = `recruitProvider-${name}`;
        const labelKey = name === 'id' ? 'recruit.field.providerId' : name === 'baseUrl' ? 'recruit.field.baseUrl'
          : (optional.has(name) ? 'recruit.field.modelOptional' : 'recruit.field.model');
        fields.push(field(labelKey, el('input', {
          id, type: name === 'baseUrl' ? 'url' : 'text', className: 'recruit-mono', spellcheck: 'false',
          placeholder: name === 'baseUrl' ? 'https://' : null, maxlength: name === 'baseUrl' ? '512' : '128', oninput: updatePrimary
        })));
      }
    }
    els.secretFields.replaceChildren(...fields);
    els.secretFields.hidden = !fields.length;
    els.secretFields.classList.toggle('single', fields.length === 1);
    for (const input of els.secretFields.querySelectorAll('input')) if (kept[input.id]) input.value = kept[input.id];
  }

  function renderNewNote() {
    const small = els.newNote.querySelector('small');
    let text = '';
    // The client's adapter says which note fits (src/clients/<id>/index.js credentials).
    const methods = signIn(state.clientId);
    const notes = methods.notes || {};
    if (needsSecret() && notes[state.method]) text = tr(notes[state.method]);
    else if (needsSecret()) {
      const token = methods.keyIsToken && state.method === 'key';
      text = tr('recruit.note.plaintext', { what: tr(token ? 'recruit.note.token' : 'recruit.note.key'), file: methods.plaintextFile || '' });
    }
    els.newNote.hidden = !text;
    small.textContent = text;
  }

  function renderNew() {
    renderClientSelect();
    renderMethods();
    renderSecretFields();
    renderNewNote();
    renderFooter();
  }

  function inputValue(id) {
    return document.getElementById(id)?.value.trim() || '';
  }

  async function createNew() {
    const client = app(state.clientId);
    if (!client) return;
    const name = els.name.value.trim();
    stopWatch();
    if (state.method === 'default') {
      await registerDefault(client, name);
      return;
    }
    if (state.method === 'browser' && isMeshReady() && client.canProvision) {
      setBusy(true);
      try {
        const message = await createWithMesh({ displayName: name || client.label, appId: client.id });
        setStatus(message || '', 'neutral');
        els.name.value = '';
      } finally {
        setBusy(false);
      }
      return;
    }
    const request = { appId: client.id, name, signIn: state.method };
    if (needsSecret()) {
      const secretInput = document.getElementById('recruitSecret');
      request.secret = secretInput?.value || '';
      // The key goes once to Main; the field never keeps it.
      if (secretInput) secretInput.value = '';
      request.provider = { id: inputValue('recruitProvider-id'), baseUrl: inputValue('recruitProvider-baseUrl'), model: inputValue('recruitProvider-model') };
      request.catalogProviderId = inputValue('recruitCatalog');
      request.model = state.method === 'key' ? inputValue('recruitCatalogModel') : inputValue('recruitProvider-model');
    }
    setBusy(true);
    setStatus(tr('recruit.working'));
    let result;
    try {
      result = await manager.recruitCreateAccount(request);
    } catch (_error) {
      result = { ok: false, reasonCode: 'generic' };
    } finally {
      request.secret = '';
      setBusy(false);
    }
    if (!result?.ok) {
      setStatus(reasonText(result?.reasonCode), 'error');
      updatePrimary();
      return;
    }
    els.name.value = '';
    await afterAccountChange(result.profileId);
    if (state.method === 'browser') {
      const launched = await manager.launchProfile(result.profileId).catch(() => ({ ok: false }));
      if (!launched?.ok) {
        setStatus(tr('recruit.new.createdNotOpened', { client: client.label }), 'error');
        return;
      }
      setStatus(tr('recruit.new.done', { client: client.label }));
      watchSignIn(result.profileId, client.label);
    } else {
      const status = result.status || {};
      setStatus(status.signedIn
        ? tr('recruit.new.doneKey', { method: methodText(status.method) })
        : tr('recruit.new.doneKeyUnverified'));
    }
    updatePrimary();
  }

  // The one account signed in on this computer: Main finds the client's
  // official location and registers it in place. Nothing is created, opened
  // or signed in here; the card's "Open" opens the official window.
  async function registerDefault(client, name) {
    setBusy(true);
    setStatus(tr('recruit.working'));
    let result;
    try {
      result = await manager.recruitCreateAccount({ appId: client.id, name, signIn: 'default' });
    } catch (_error) {
      result = { ok: false, reasonCode: 'generic' };
    } finally {
      setBusy(false);
    }
    if (!result?.ok) {
      setStatus(reasonText(result?.reasonCode), 'error');
      updatePrimary();
      return;
    }
    els.name.value = '';
    await afterAccountChange(result.profileId);
    if (result.onDesk === false) {
      setStatus(tr(result.deskReasonCode === 'mesh-keys-unavailable' ? 'recruit.existing.notPlacedKeys' : 'recruit.existing.notPlaced', { n: 1, missing: 1 }), 'error');
    } else {
      setStatus(tr(result.existing ? 'recruit.new.defaultExisting' : 'recruit.new.defaultDone', { client: client.label }));
    }
    updatePrimary();
  }

  // After opening the official window, check the client's own sign-in files
  // every few seconds while the dialog stays open. Nothing is launched here.
  function watchSignIn(profileId, label) {
    stopWatch();
    let rounds = 0;
    const timer = setInterval(async () => {
      rounds += 1;
      if (!els.dialog.open || rounds > 45) { stopWatch(); return; }
      const status = await manager.getProfileCredentialStatus?.(profileId).catch(() => null);
      if (status?.ok && status.signedIn === true) {
        stopWatch();
        setStatus(tr('recruit.new.signedIn', { client: label, method: methodText(status.method) }));
        void afterAccountChange(profileId);
      }
    }, 4000);
    state.watch = { timer, profileId };
  }

  // ---------- 把已有的领回来 ----------
  function mergeHomes(locations) {
    for (const location of locations || []) {
      const index = state.homes.findIndex((home) => home.appId === location.appId && home.displayPath === location.displayPath);
      if (index >= 0) {
        if (state.checked.delete(state.homes[index].selectionId)) state.checked.add(location.selectionId);
        state.homes[index] = location;
      } else state.homes.push(location);
    }
  }

  async function discover(kind) {
    if (state.scan === 'defaults' || state.scan === 'home') return;
    state.scan = kind === 'home' ? 'home' : (kind === 'folder' ? 'folder' : 'defaults');
    renderExisting();
    let result;
    try {
      result = kind === 'folder' ? await manager.recruitDiscoverFolder() : await manager.recruitDiscover({ deep: kind === 'home' });
    } catch (_error) {
      result = { ok: false, reasonCode: 'discovery-failed' };
    }
    if (result?.canceled) {
      state.scan = 'done';
      renderExisting();
      return;
    }
    if (!result?.ok) {
      state.scan = result?.reasonCode === 'discovery-canceled' ? 'stopped' : 'failed';
      renderExisting();
      return;
    }
    if (kind === 'home') state.deep = true;
    state.truncated = state.truncated || result.truncated === true;
    mergeHomes(result.locations);
    for (const hint of result.hints || []) {
      if (!state.hints.some((item) => item.kind === hint.kind && item.displayPath === hint.displayPath)) state.hints.push(hint);
    }
    state.scan = kind === 'folder' && !result.folderRecognized ? 'folder-empty' : 'done';
    renderExisting();
  }

  async function stopScan() {
    await manager.recruitCancelDiscover?.().catch(() => null);
  }

  // Long paths keep their meaningful end: "…/accounts/codex-side".
  function pathText(home) {
    const value = home.shortPath || home.displayPath || '';
    return value.length > 64 ? `…${value.slice(-63)}` : value;
  }

  function identityText(home) {
    const plan = home.identity?.plan ? home.identity.plan.charAt(0).toUpperCase() + home.identity.plan.slice(1) : '';
    if (home.identity?.email) return plan ? `${home.identity.email} · ${plan}` : home.identity.email;
    if (home.identity?.method === 'api-key') return tr('recruit.existing.apiKeyIdentity');
    return tr('recruit.existing.unknownIdentity');
  }

  function renderExisting() {
    const scanning = state.scan === 'defaults' || state.scan === 'home' || state.scan === 'folder';
    const count = state.homes.length;
    els.scanStatus.textContent = state.scan === 'defaults' ? tr('recruit.existing.defaults')
      : state.scan === 'home' ? tr('recruit.existing.scanning')
        : state.scan === 'folder' ? tr('recruit.existing.scanningFolder')
          : state.scan === 'stopped' ? tr('recruit.existing.stopped', { n: count })
            : state.scan === 'failed' ? tr('recruit.error.discovery-failed')
              : state.scan === 'folder-empty' ? tr('recruit.existing.folderEmpty')
                : (state.deep ? tr('recruit.existing.foundDeep', { n: count }) : tr('recruit.existing.found', { n: count }));
    els.cancelScan.hidden = state.scan !== 'home';
    els.scanHome.hidden = state.scan === 'home';
    els.scanHome.disabled = scanning || state.busy;
    els.pickFolder.disabled = scanning || state.busy;
    const groups = [];
    for (const client of apps()) {
      const homes = state.homes.filter((home) => home.appId === client.id);
      if (!homes.length) continue;
      groups.push(el('section', { className: 'recruit-group' },
        el('h4', {}, el('span', { text: client.label }), el('em', { text: String(homes.length) })),
        ...homes.map((home) => {
          const sessions = !Number.isInteger(home.sessionCount) ? tr('recruit.existing.sessionsUnknown')
            : tr(home.sessionCount === 1 ? 'recruit.existing.sessionsOne' : 'recruit.existing.sessions', { n: home.sessionCount });
          // Registered and owned by an account on the desk: nothing to do.
          // Registered but owned by no account (with a device mesh): it can
          // be picked again to put it back on the desk.
          const onDesk = Boolean(home.registeredProfileId) && home.onDesk !== false;
          const offDesk = Boolean(home.registeredProfileId) && home.onDesk === false;
          return el('label', { className: `recruit-home${onDesk ? ' is-registered' : ''}${offDesk ? ' is-off-desk' : ''}` },
            el('input', {
              type: 'checkbox', checked: state.checked.has(home.selectionId), disabled: onDesk || state.busy,
              onchange: (event) => {
                if (event.target.checked) state.checked.add(home.selectionId);
                else state.checked.delete(home.selectionId);
                renderFooter();
              }
            }),
            el('span', {},
              el('b', { text: identityText(home) }),
              el('small', { text: `${sessions} · ${translated(`recruit.existing.source.${home.source}`, 'recruit.existing.source.default')}` }),
              el('code', { text: pathText(home), title: home.displayPath })),
            onDesk ? el('em', { text: tr('recruit.existing.registered') })
              : (offDesk ? el('em', { text: tr('catalog.unassigned.state') }) : null)
          );
        })
      ));
    }
    for (const hint of state.hints) {
      if (hint.kind === 'legacy-home') groups.push(el('p', { className: 'recruit-note quiet' }, icon('bang'), el('small', { text: tr('recruit.existing.legacyKimi') })));
    }
    if (state.truncated) groups.push(el('p', { className: 'recruit-note quiet' }, icon('bang'), el('small', { text: tr('recruit.existing.truncated') })));
    els.groups.replaceChildren(...groups);
    renderFooter();
  }

  async function registerChecked() {
    const ids = [...state.checked];
    if (!ids.length) return;
    setBusy(true);
    let result;
    try {
      result = await manager.recruitRegister(ids);
    } catch (_error) {
      result = { ok: false, results: [] };
    } finally {
      setBusy(false);
    }
    state.checked.clear();
    for (const item of result?.results || []) {
      const home = state.homes.find((entry) => entry.selectionId === item.selectionId);
      if (home && item.ok) {
        home.registeredProfileId = item.profileId;
        home.onDesk = item.onDesk !== false;
      }
    }
    const added = result?.added || 0;
    const failed = result?.failed || 0;
    const registered = added + (result?.existing || 0);
    const missing = (result?.results || []).filter((item) => item.ok && item.onDesk === false).length;
    renderExisting();
    setStatus(failed ? tr('recruit.existing.partial', { n: registered, failed })
      : missing ? tr(result?.deskReasonCode === 'mesh-keys-unavailable' ? 'recruit.existing.notPlacedKeys' : 'recruit.existing.notPlaced', { n: registered, missing })
        : tr('recruit.existing.registered.done', { n: registered }), failed || missing ? 'error' : 'neutral');
    const first = (result?.results || []).find((item) => item.ok && !item.existing) || (result?.results || []).find((item) => item.ok);
    if (first) await afterAccountChange(first.profileId);
  }

  // ---------- 拖进来 ----------
  function renderAccepts() {
    els.accepts.replaceChildren(...apps().map((client) => {
      const folderKey = client.defaultOnly ? 'recruit.drop.noDefaultOnly'
        : (client.discoveryKind === 'desktop' ? 'recruit.drop.dataInPlace' : 'recruit.drop.inPlace');
      const fileKey = `recruit.drop.file.${client.id}`;
      const fileText = tr(fileKey);
      const accepted = fileText !== fileKey;
      return el('tr', {},
        el('th', { text: client.label }),
        el('td', { className: client.defaultOnly ? 'no' : '', text: tr(folderKey) }),
        el('td', { className: accepted ? '' : 'no', text: accepted ? fileText : tr('recruit.drop.no') }));
    }));
  }

  function showDropResult(text, bad = false) {
    els.dropResult.hidden = !text;
    els.dropResult.classList.toggle('bad', bad);
    els.dropResult.querySelector('.pxi').dataset.i = bad ? 'x' : 'check';
    els.dropResult.querySelector('small').textContent = text || '';
  }

  function showMoveWarning(show) {
    els.moveWarning.hidden = !show;
    els.moveWarning.querySelector('small').textContent = show ? tr('recruit.drop.move') : '';
  }

  async function handleInspected(result) {
    state.dropPending = null;
    showMoveWarning(false);
    if (result?.canceled) { renderFooter(); return; }
    if (!result?.ok) {
      showDropResult(reasonText(result?.reasonCode), true);
      renderFooter();
      return;
    }
    const label = app(result.appId)?.label || result.appId;
    if (result.action === 'existing') {
      showDropResult(tr('recruit.drop.existing', { client: label }));
      await afterAccountChange(result.profileId);
    } else if (result.action === 'register') {
      await importItem(result);
    } else {
      state.dropPending = result;
      showDropResult(tr('recruit.drop.waiting', { client: label, file: result.fileName }));
      showMoveWarning(true);
    }
    renderFooter();
  }

  async function importItem(item) {
    setBusy(true);
    let result;
    try {
      result = await manager.importRecruitItem(item.selectionId);
    } catch (_error) {
      result = { ok: false, reasonCode: 'generic' };
    } finally {
      setBusy(false);
    }
    state.dropPending = null;
    showMoveWarning(false);
    if (!result?.ok) {
      showDropResult(reasonText(result?.reasonCode), true);
      return;
    }
    const label = app(result.appId)?.label || result.appId;
    showDropResult(result.copied
      ? tr('recruit.drop.copied', { client: label })
      : (result.existing ? tr('recruit.drop.existing', { client: label }) : tr('recruit.drop.recognized', { client: label })));
    await afterAccountChange(result.profileId);
  }

  async function inspectFile(file) {
    setBusy(true);
    try {
      return await manager.inspectRecruitItem(file);
    } catch (_error) {
      return { ok: false, reasonCode: 'generic' };
    } finally {
      setBusy(false);
    }
  }

  async function pickItem() {
    setBusy(true);
    let result;
    try {
      result = await manager.pickRecruitItem();
    } catch (_error) {
      result = { ok: false, reasonCode: 'generic' };
    } finally {
      setBusy(false);
    }
    await handleInspected(result);
  }

  // ---------- 交给 AI ----------
  function commands() {
    const windows = platform === 'win32';
    const cli = windows ? '& $catshelf --cli' : '"$catshelf" --cli';
    const id = tr('recruit.ai.id');
    return [
      ['recruit.ai.step0', windows ? `$catshelf = "${tr('recruit.ai.windowsPath')}"` : 'catshelf=/Applications/Catshelf.app/Contents/MacOS/Catshelf'],
      ['recruit.ai.step1', `${cli} capabilities`],
      ['recruit.ai.step2', `${cli} profiles discover --scan home`],
      ['recruit.ai.step3', windows
        ? `${cli} profiles register --app codex --session-root "$HOME\\.codex"`
        : `${cli} profiles register --app codex --session-root "$HOME/.codex"`],
      ['recruit.ai.step4', `${cli} profiles create --app claude-cli --name ${tr('recruit.ai.work')}`],
      ['recruit.ai.step5', windows ? `Get-Clipboard | ${cli} profiles set-key --profile ${id}` : `pbpaste | ${cli} profiles set-key --profile ${id}`],
      ['recruit.ai.step6', `${cli} profiles status --profile ${id} --check official`]
    ];
  }

  async function copyText(text) {
    try {
      await manager.writeClipboard(text);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function renderAi() {
    els.steps.replaceChildren(
      ...commands().map(([key, command]) => {
        const label = el('span', { text: tr('recruit.ai.copy') });
        const button = el('button', { type: 'button' }, icon('copy'), label);
        button.addEventListener('click', async () => {
          if (await copyText(command)) {
            label.textContent = tr('recruit.ai.copied');
            setTimeout(() => { label.textContent = tr('recruit.ai.copy'); }, 1200);
          }
        });
        return el('li', {}, el('div', {}, el('b', { text: tr(key) }), el('pre', {}, el('code', { text: command }))), button);
      }),
      el('li', { className: 'human' }, el('div', {}, el('small', { text: tr('recruit.ai.human') })))
    );
  }

  // ---------- 页脚：每段一个主按钮 ----------
  function setBusy(busy) {
    state.busy = busy;
    renderFooter();
  }

  function renderFooter() {
    els.secondary.hidden = true;
    if (state.section === 'new') {
      els.primary.textContent = tr(state.method === 'default' ? 'recruit.new.registerDefault'
        : (state.method === 'browser' ? 'recruit.new.create' : 'recruit.new.createWithKey'));
    } else if (state.section === 'existing') {
      els.primary.textContent = state.checked.size ? tr('recruit.existing.registerN', { n: state.checked.size }) : tr('recruit.existing.register');
    } else if (state.section === 'drop') {
      if (state.dropPending) {
        els.primary.textContent = tr('recruit.drop.copy');
        els.secondary.hidden = false;
        els.secondary.textContent = tr('recruit.drop.cancel');
      } else els.primary.textContent = tr('recruit.drop.pick');
    } else els.primary.textContent = tr('recruit.ai.copyAll');
    els.status.textContent = state.status;
    els.status.dataset.tone = state.statusTone;
    els.secondary.disabled = state.busy;
    updatePrimary();
  }

  function updatePrimary() {
    let disabled = state.busy;
    if (state.section === 'existing') disabled ||= !state.checked.size;
    if (state.section === 'new') {
      if (!state.clientId) disabled = true;
      if (needsSecret()) {
        disabled ||= !inputValue('recruitSecret');
        const url = document.getElementById('recruitProvider-baseUrl');
        if (url) disabled ||= !url.value.trim();
        const providerId = document.getElementById('recruitProvider-id');
        if (providerId) disabled ||= !providerId.value.trim();
        const model = document.getElementById('recruitProvider-model');
        if (model && !signIn(state.clientId).providerOptionalFields?.includes('model')) disabled ||= !model.value.trim();
        const catalog = document.getElementById('recruitCatalog');
        if (catalog) disabled ||= !catalog.value.trim();
      }
    }
    els.primary.disabled = disabled;
  }

  function selectSection(section) {
    state.section = SECTIONS.includes(section) ? section : 'new';
    state.status = '';
    for (const tab of els.tabs) {
      const selected = tab.dataset.section === state.section;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of els.panels) panel.hidden = panel.dataset.section !== state.section;
    if (state.section === 'existing' && state.scan === 'idle') void discover('defaults');
    renderFooter();
  }

  function render() {
    renderNew();
    renderExisting();
    renderAccepts();
    renderAi();
    if (state.dropPending) showMoveWarning(true);
    renderFooter();
  }

  function open(section = 'new') {
    if (els.dialog.open) { selectSection(section); return; }
    stopWatch();
    state.status = '';
    state.dropPending = null;
    state.checked.clear();
    state.homes = [];
    state.hints = [];
    state.scan = 'idle';
    state.deep = false;
    state.truncated = false;
    showDropResult('');
    showMoveWarning(false);
    render();
    selectSection(section);
    openDialog(els.dialog);
    const focusTarget = state.section === 'new' ? els.name : els.tabs.find((tab) => tab.dataset.section === state.section);
    focusTarget?.focus();
  }

  // ---------- wiring ----------
  els.client.addEventListener('change', () => { state.clientId = els.client.value; setStatus(''); renderNew(); });
  for (const tab of els.tabs) tab.addEventListener('click', () => selectSection(tab.dataset.section));
  els.tabs[0]?.parentElement?.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = els.tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true');
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? els.tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : els.tabs.length - 1)) % els.tabs.length;
    selectSection(els.tabs[next].dataset.section);
    els.tabs[next].focus();
  });
  els.scanHome.addEventListener('click', () => void discover('home'));
  els.pickFolder.addEventListener('click', () => void discover('folder'));
  els.cancelScan.addEventListener('click', () => void stopScan());
  els.primary.addEventListener('click', () => {
    if (state.busy) return;
    if (state.section === 'new') void createNew();
    else if (state.section === 'existing') void registerChecked();
    else if (state.section === 'drop') {
      if (state.dropPending) void importItem(state.dropPending).then(renderFooter);
      else void pickItem();
    } else {
      void copyText(commands().map(([, command]) => command).join('\n')).then((ok) => setStatus(ok ? tr('recruit.ai.copiedAll') : reasonText('generic'), ok ? 'neutral' : 'error'));
    }
  });
  els.secondary.addEventListener('click', () => {
    state.dropPending = null;
    showMoveWarning(false);
    showDropResult(tr('recruit.drop.canceled'));
    renderFooter();
  });
  els.close.addEventListener('click', () => els.dialog.close());
  els.dialog.addEventListener('close', () => {
    stopWatch();
    if (state.scan === 'home' || state.scan === 'defaults') void stopScan();
  });
  els.drop.addEventListener('click', () => { if (!state.busy) void pickItem(); });
  els.dialog.addEventListener('dragover', (event) => {
    if (state.section !== 'drop' || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy';
    els.drop.dataset.dragging = String(!state.busy);
  });
  els.dialog.addEventListener('dragleave', (event) => {
    if (!els.dialog.contains(event.relatedTarget)) delete els.drop.dataset.dragging;
  });
  els.dialog.addEventListener('drop', (event) => {
    if (state.section !== 'drop') return;
    event.preventDefault();
    delete els.drop.dataset.dragging;
    if (!event.isTrusted || state.busy) return;
    const files = event.dataTransfer?.files;
    if (files?.length !== 1) {
      showDropResult(tr('recruit.drop.single'), true);
      return;
    }
    void inspectFile(files[0]).then(handleInspected);
  });

  return { open, render, state, selectSection };
});
