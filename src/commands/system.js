'use strict';

// AgentDesk — the system pickers, showing and opening known paths, and the
// clipboard. Paths come only from Main's pickers or from registered profiles.
// Bodies moved from main.js registerIpc unchanged.

const COMMANDS = [
  {
    id: 'system.pickDirectory',
    channel: 'system:pickDirectory',
    preload: ['pickDirectory'],
    async exec(deps, input = {}) {
      const { app, boundedText, dialog, loadProfiles, pathSelectionRegistry, t } = deps;
      if (boundedText(input.purpose, 80) !== 'profile-directory') {
        throw new Error('directory-picker-purpose-invalid');
      }
      const profile = loadProfiles().find((item) => item.id === boundedText(input.profileId, 128));
      const field = ['profilePath', 'sessionRoot'].includes(input.field) ? input.field : 'profilePath';
      const result = await dialog.showOpenDialog({
        title: t('main.picker.dir'),
        defaultPath: profile?.[field] || app.getPath('home'),
        properties: ['openDirectory', 'createDirectory']
      });
      if (result.canceled || !result.filePaths.length) return null;
      return pathSelectionRegistry.issue({
        kind: 'profile-directory',
        path: result.filePaths[0]
      });
    }
  },
  {
    id: 'system.pickFile',
    channel: 'system:pickFile',
    preload: ['pickFile'],
    async exec(deps, input = {}) {
      const { app, boundedText, dialog, loadProfiles, pathSelectionRegistry, t } = deps;
      if (boundedText(input.purpose, 80) !== 'profile-executable') {
        throw new Error('file-picker-purpose-invalid');
      }
      const profile = loadProfiles().find((item) => item.id === boundedText(input.profileId, 128));
      const dialogOptions = {
        title: t('main.picker.file'),
        defaultPath: profile?.executablePath || app.getPath('home'),
        properties: ['openFile']
      };
      if (process.platform === 'win32') {
        dialogOptions.filters = [
          { name: t('main.filter.winApp'), extensions: ['exe'] },
          { name: t('main.filter.allFiles'), extensions: ['*'] }
        ];
      }
      const result = await dialog.showOpenDialog(dialogOptions);
      if (result.canceled || !result.filePaths.length) return null;
      return pathSelectionRegistry.issue({
        kind: 'profile-executable',
        path: result.filePaths[0]
      });
    }
  },
  {
    id: 'system.showItem',
    channel: 'system:showItem',
    preload: ['showItem'],
    async exec(deps, input = {}) {
      const { resolveKnownProfilePath, revealPath } = deps;
      return revealPath(resolveKnownProfilePath(input));
    }
  },
  {
    id: 'system.openPath',
    channel: 'system:openPath',
    preload: ['openPath'],
    async exec(deps, input = {}) {
      const { openPathSafely, resolveKnownProfilePath } = deps;
      return openPathSafely(resolveKnownProfilePath(input));
    }
  },
  {
    id: 'clipboard.writeText',
    channel: 'clipboard:writeText',
    preload: ['writeClipboard'],
    exec(deps, value) {
      const { clipboard } = deps;
      clipboard.writeText(String(value || ''));
      return true;
    }
  }
];

module.exports = { COMMANDS };
