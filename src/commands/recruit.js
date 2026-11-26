'use strict';

// AgentDesk — recruiting accounts and handing a pasted key to an account's own
// client (docs/ADD_ACCOUNT_PLAN.md). The secret is passed through once and
// never stored, logged or returned. Bodies moved from main.js registerIpc and
// src/main/ipc/recruit.js unchanged.

const os = require('node:os');

const COMMANDS = [
  {
    id: 'recruit.discover',
    channel: 'recruit:discover',
    preload: ['recruitDiscover'],
    exec: ({ recruitHandlers }, input) => recruitHandlers.discover(input)
  },
  {
    id: 'recruit.discoverFolder',
    channel: 'recruit:discoverFolder',
    preload: ['recruitDiscoverFolder'],
    exec: ({ recruitHandlers }) => recruitHandlers.discoverFolder()
  },
  {
    id: 'recruit.cancelDiscover',
    channel: 'recruit:cancelDiscover',
    preload: ['recruitCancelDiscover'],
    exec: ({ recruitHandlers }) => recruitHandlers.cancel()
  },
  {
    id: 'recruit.register',
    channel: 'recruit:register',
    preload: ['recruitRegister'],
    exec({ recruitHandlers, quotaService }, input) {
      const result = recruitHandlers.register(input);
      if (result.added) quotaService.invalidate();
      return result;
    }
  },
  {
    id: 'recruit.createAccount',
    channel: 'recruit:createAccount',
    preload: ['recruitCreateAccount'],
    exec(deps, input = {}) {
      const { accountResult, apps, createAccountWithSecret, createLocalAccount, recruitHandlers } = deps;
      return accountResult(async () => {
      const signIn = ['key', 'provider', 'default'].includes(input?.signIn) ? input.signIn : 'browser';
      // A client with one account per computer: register its official default
      // location instead of making a new folder (docs/ADD_ACCOUNT_PLAN.md §8.2).
      if (signIn === 'default') {
        const appId = String(input?.appId || '').slice(0, 80);
        if (!apps.isKnownApp(appId) || apps.getApp(appId).profileIsolation?.mode !== 'official-default-only') {
          throw Object.assign(new Error('credential-method-unsupported'), { code: 'credential-method-unsupported' });
        }
        const registered = await recruitHandlers.registerDefault({ appId, name: input?.name });
        if (!registered?.ok) throw Object.assign(new Error(registered?.reasonCode || 'location-invalid'), { code: registered?.reasonCode || 'location-invalid' });
        if (!registered.existing) deps.quotaService?.invalidate();
        return { ...registered, created: !registered.existing, signIn };
      }
      if (signIn === 'browser') return { ...createLocalAccount(input), created: true, signIn };
      return { ...(await createAccountWithSecret({ ...input, method: signIn })), signIn };
    }, 'account-create-failed');
    }
  },
  {
    id: 'credentials.apply',
    channel: 'credentials:apply',
    preload: ['applyProfileCredential'],
    exec(deps, input = {}) {
      const { accountResult, applyProfileSecret, boundedText } = deps;
      return accountResult(
      () => applyProfileSecret(boundedText(input?.profileId, 128), input), 'credential-apply-failed'
    );
    }
  },
  {
    id: 'credentials.status',
    channel: 'credentials:status',
    preload: ['getProfileCredentialStatus'],
    exec(deps, input = {}) {
      const { accountResult, boundedText, profileCredentialStatus } = deps;
      return accountResult(
      () => profileCredentialStatus(boundedText(input?.profileId, 128), input?.official === true), 'credential-status-failed'
    );
    }
  },
  {
    id: 'recruit.inspectItem',
    channel: 'recruit:inspectItem',
    preload: ['inspectRecruitItem'],
    exec(deps, itemPath) {
      const { accountResult, inspectRecruitItem } = deps;
      return accountResult(
      () => inspectRecruitItem(itemPath), 'credential-import-failed'
    );
    }
  },
  {
    id: 'recruit.pickItem',
    channel: 'recruit:pickItem',
    preload: ['pickRecruitItem'],
    exec(deps) {
      const { accountResult, dialog, inspectRecruitItem, mainWindow, t } = deps;
      return accountResult(async () => {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: t('main.picker.recruitItem'),
        defaultPath: os.homedir(),
        properties: process.platform === 'darwin' ? ['openFile', 'openDirectory', 'showHiddenFiles'] : ['openFile', 'showHiddenFiles']
      });
      if (result.canceled || !result.filePaths[0]) return null;
      return inspectRecruitItem(result.filePaths[0]);
    }, 'credential-import-failed');
    }
  },
  {
    id: 'recruit.importItem',
    channel: 'recruit:importItem',
    preload: ['importRecruitItem'],
    exec(deps, input = {}) {
      const { accountResult, boundedText, executeRecruitItem, recruitSelectionRegistry } = deps;
      return accountResult(async () => {
      const selectionId = boundedText(input?.selectionId, 128);
      const { path: itemPath, meta } = recruitSelectionRegistry.resolveEntry(selectionId, 'recruit-item');
      recruitSelectionRegistry.consume([selectionId]);
      return executeRecruitItem(itemPath, meta?.action);
    }, 'credential-import-failed');
    }
  }
];

module.exports = { COMMANDS };
