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
      const { accountResult, createAccountWithSecret, createLocalAccount } = deps;
      return accountResult(async () => {
      const signIn = ['key', 'provider'].includes(input?.signIn) ? input.signIn : 'browser';
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
