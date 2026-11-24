'use strict';

// AgentDesk — sending session pointers and chosen files to another device, and
// mapping a received project to a local folder. Files and folders come only from
// Main's system pickers. Bodies moved from main.js registerIpc unchanged.

const COMMANDS = [
  {
    id: 'transfers.createSessionPointer',
    channel: 'transfers:createSessionPointer',
    preload: ['createSessionPointerTransfer'],
    async exec(deps, input = {}) {
      const { boundedText, getTransferService } = deps;
      try {
        const selections = (Array.isArray(input.selections) ? input.selections : []).slice(0, 50).map((item) => ({
          conversationId: boundedText(item?.conversationId, 128),
          replicaId: boundedText(item?.replicaId, 128)
        }));
        const transfer = await getTransferService().createSessionPointerTransfer({
          targetDeviceId: boundedText(input.targetDeviceId, 128),
          selections
        });
        return { ok: true, transfer };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'transfer-create-failed', 160) };
      }
    }
  },
  {
    id: 'transfers.chooseFiles',
    channel: 'transfers:chooseFiles',
    preload: ['chooseFileTransfer'],
    async exec(deps, input = {}) {
      const { boundedText, dialog, getTransferService, mainWindow, t } = deps;
      try {
        const targetDeviceId = boundedText(input.targetDeviceId, 128);
        const result = await dialog.showOpenDialog(mainWindow, {
          title: t('main.picker.transferFiles'),
          properties: ['openFile', 'multiSelections']
        });
        if (result.canceled || !result.filePaths.length) return { ok: true, cancelled: true };
        const transfer = await getTransferService().createFileTransfer({
          targetDeviceId,
          filePaths: result.filePaths.slice(0, 32)
        });
        return { ok: true, transfer, transfers: getTransferService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'file-transfer-create-failed', 160) };
      }
    }
  },
  {
    id: 'transfers.acceptFile',
    channel: 'transfers:acceptFile',
    preload: ['acceptFileTransfer'],
    async exec(deps, input = {}) {
      const { boundedText, dialog, getTransferService, mainWindow, t } = deps;
      try {
        const transferId = boundedText(input.transferId, 128);
        const result = await dialog.showOpenDialog(mainWindow, {
          title: t('main.picker.transferDestination'),
          properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
        const transfer = await getTransferService().acceptFileTransfer(transferId, result.filePaths[0]);
        return { ok: true, transfer, transfers: getTransferService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'file-transfer-accept-failed', 160) };
      }
    }
  },
  {
    id: 'transfers.openReceivedFile',
    channel: 'transfers:openReceivedFile',
    preload: ['openReceivedFile'],
    exec(deps, input = {}) {
      const { boundedText, getTransferService, shell } = deps;
      try {
        const filePath = getTransferService().openReceivedFileLocation(boundedText(input.transferId, 128));
        shell.showItemInFolder(filePath);
        return { ok: true };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'file-received-location-failed', 160) };
      }
    }
  },
  {
    id: 'transfers.list',
    channel: 'transfers:list',
    preload: ['listTransfers'],
    exec(deps) {
      const { boundedText, getTransferService } = deps;
      try { return { ok: true, transfers: getTransferService().list() }; } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'transfer-list-failed', 160) };
      }
    }
  },
  {
    id: 'transfers.cancel',
    channel: 'transfers:cancel',
    preload: ['cancelTransfer'],
    exec(deps, input = {}) {
      const { boundedText, getTransferService } = deps;
      try {
        return { ok: true, transfer: getTransferService().cancel(boundedText(input.transferId, 128)) };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'transfer-cancel-failed', 160) };
      }
    }
  },
  {
    id: 'transfers.retry',
    channel: 'transfers:retry',
    preload: ['retryTransfer'],
    async exec(deps, input = {}) {
      const { boundedText, getTransferService } = deps;
      try {
        return { ok: true, transfer: await getTransferService().retry(boundedText(input.transferId, 128)) };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'transfer-retry-failed', 160) };
      }
    }
  },
  {
    id: 'projects.chooseBinding',
    channel: 'projects:chooseBinding',
    preload: ['chooseProjectBinding'],
    async exec(deps, input = {}) {
      const { boundedText, dialog, getTransferService, mainWindow, t } = deps;
      try {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: t('main.picker.projectRoot'),
          properties: ['openDirectory', 'createDirectory']
        });
        if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
        const binding = getTransferService().saveProjectBinding({
          projectId: boundedText(input.projectId, 128),
          sourceDeviceId: boundedText(input.sourceDeviceId, 128),
          localRoot: result.filePaths[0]
        });
        return { ok: true, binding, transfers: getTransferService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'project-binding-failed', 160) };
      }
    }
  }
];

module.exports = { COMMANDS };
