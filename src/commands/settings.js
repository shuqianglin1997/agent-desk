'use strict';

// AgentDesk — the client list, settings and app updates. Bodies moved from main.js
// registerIpc unchanged; Main passes the services as deps.

const COMMANDS = [
  {
    id: 'apps.list',
    channel: 'apps:list',
    preload: ['listApps'],
    exec(deps) {
      const { apps, provisioningAdapterDescriptor } = deps;
      return apps.listApps({ uiHints: true }).map((entry) => {
        const descriptor = provisioningAdapterDescriptor(entry.id, 'desktop');
        return {
          ...entry,
          canProvision: Boolean(descriptor?.supportedPlatforms?.includes(process.platform)),
          provisioningClientForm: descriptor?.clientForm || null
        };
      });
    }
  },
  {
    id: 'settings.get',
    channel: 'settings:get',
    preload: ['getSettings'],
    exec(deps, legacySettings = {}) {
      const { loadSettings, syncWindowControlTheme } = deps;
      const preferences = loadSettings(legacySettings);
      syncWindowControlTheme(preferences);
      return preferences;
    }
  },
  {
    id: 'settings.update',
    channel: 'settings:update',
    preload: ['updateSettings'],
    exec(deps, patch = {}) {
      const { syncWindowControlTheme, updateSettings } = deps;
      const preferences = updateSettings(patch);
      if (Object.hasOwn(patch || {}, 'theme')) syncWindowControlTheme(preferences);
      return preferences;
    }
  },
  {
    id: 'updates.check',
    channel: 'updates:check',
    preload: ['checkForUpdates'],
    async exec(deps) {
      const { checkForUpdates } = deps;
      return checkForUpdates({ force: true });
    }
  },
  {
    id: 'updates.install',
    channel: 'updates:install',
    preload: ['installUpdate'],
    // Only the window installs: { stopRuns: true } once the person agreed
    // that running background runs end with the restart.
    input: (raw) => ({ stopRuns: raw?.stopRuns === true }),
    async exec(deps, input, context = {}) {
      const { installLatestUpdate } = deps;
      const event = context.event;
      return installLatestUpdate(event.sender, input);
    }
  }
];

module.exports = { COMMANDS };
