'use strict';

// AgentDesk — the official tools page: scan, open and update one tool. Bodies
// moved from main.js registerIpc unchanged.

const COMMANDS = [
  {
    id: 'tools.scan',
    channel: 'tools:scan',
    preload: ['scanTools'],
    async exec(deps, options = {}) {
      const { scanMaintenanceTools } = deps;
      return scanMaintenanceTools({ force: options.force === true });
    }
  },
  {
    id: 'tools.open',
    channel: 'tools:open',
    preload: ['openTool'],
    async exec(deps, input = {}) {
      const { openMaintenanceTool } = deps;
      return openMaintenanceTool(String(input.toolId || ''), String(input.profileId || ''));
    }
  },
  {
    id: 'tools.update',
    channel: 'tools:update',
    preload: ['updateTool'],
    async exec(deps, input = {}, context = {}) {
      const { updateMaintenanceTool } = deps;
      const event = context.event;
      return updateMaintenanceTool(String(input.toolId || ''), event.sender);
    }
  }
];

module.exports = { COMMANDS };
