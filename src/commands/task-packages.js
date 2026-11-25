'use strict';

// AgentDesk — task packages: preview and export, send to a device, receive,
// import and the local history (docs/ADR_AGENTDESK_TASK_PACKAGE.md). Unlock codes
// and decrypted content never reach this window. Bodies moved from main.js
// registerIpc unchanged.

const fs = require('node:fs');
const path = require('node:path');

const COMMANDS = [
  {
    id: 'taskPackages.previewExport',
    channel: 'taskPackages:previewExport',
    preload: ['previewTaskPackageExport'],
    async exec(deps, input = {}) {
      const { boundedText, getTaskPackageService, refreshForAction } = deps;
      try {
        await refreshForAction([boundedText(input.profileId, 128)]);
        return {
          ok: true,
          preview: getTaskPackageService().previewExport({
            profileId: boundedText(input.profileId, 128),
            sessionId: boundedText(input.sessionId, 128)
          })
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-preview-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.export',
    channel: 'taskPackages:export',
    preload: ['exportTaskPackage'],
    async exec(deps, input = {}) {
      const { app, boundedTaskCheckpoint, boundedText, dialog, getTaskPackageService, mainWindow, refreshForAction, t, taskPackageSuggestedName } = deps;
      try {
        const profileId = boundedText(input.profileId, 128);
        const sessionId = boundedText(input.sessionId, 128);
        await refreshForAction([profileId]);
        const preview = getTaskPackageService().previewExport({ profileId, sessionId });
        if (!preview.supported) throw new Error('task-package-source-unsupported');
        const result = await dialog.showSaveDialog(mainWindow, {
          title: t('main.taskPackage.exportTitle'),
          defaultPath: path.join(app.getPath('desktop'), taskPackageSuggestedName(preview.title)),
          filters: [{ name: 'Catshelf Task Package', extensions: ['agentdesk-task'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
        let attachmentPaths = [];
        if (input.includeAttachments === true) {
          const attachmentResult = await dialog.showOpenDialog(mainWindow, {
            title: t('main.taskPackage.attachmentsTitle'),
            properties: ['openFile', 'multiSelections']
          });
          if (attachmentResult.canceled) return { ok: true, cancelled: true };
          attachmentPaths = attachmentResult.filePaths;
        }
        // The save dialog may have stayed open a while: read the session again.
        await refreshForAction([profileId]);
        const exported = await getTaskPackageService().exportPackage({
          profileId,
          sessionId,
          conversationId: boundedText(input.conversationId, 128),
          senderLabel: boundedText(input.senderLabel, 120),
          checkpoint: boundedTaskCheckpoint(input.checkpoint),
          includeProject: input.includeProject !== false,
          attachmentPaths,
          destinationPath: result.filePath
        });
        return { ok: true, exported, history: getTaskPackageService().listHistory() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-export-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.sendToDevice',
    channel: 'taskPackages:sendToDevice',
    preload: ['sendTaskPackageToDevice'],
    async exec(deps, input = {}) {
      const { boundedText, dialog, getTaskPackageService, getTransferService, mainWindow, normalizeTaskPackageSendInput, refreshForAction, t } = deps;
      try {
        const request = normalizeTaskPackageSendInput(input);
        await refreshForAction([request.profileId]);
        const preview = getTaskPackageService().previewExport({
          profileId: request.profileId,
          sessionId: request.sessionId
        });
        if (!preview.supported) throw new Error('task-package-source-unsupported');
        let attachmentPaths = [];
        if (request.includeAttachments) {
          const attachmentResult = await dialog.showOpenDialog(mainWindow, {
            title: t('main.taskPackage.attachmentsTitle'),
            properties: ['openFile', 'multiSelections']
          });
          if (attachmentResult.canceled) return { ok: true, cancelled: true };
          attachmentPaths = attachmentResult.filePaths.slice(0, 32);
        }
        await refreshForAction([request.profileId]);
        const transfer = await getTransferService().createTaskPackageTransfer({
          targetDeviceId: request.targetDeviceId,
          profileId: request.profileId,
          sessionId: request.sessionId,
          conversationId: request.conversationId,
          senderLabel: request.senderLabel,
          checkpoint: request.checkpoint,
          includeProject: request.includeProject,
          attachmentPaths
        });
        return {
          ok: true,
          transfer,
          transfers: getTransferService().list(),
          history: getTaskPackageService().listHistory()
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-direct-send-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.acceptIncoming',
    channel: 'taskPackages:acceptIncoming',
    preload: ['acceptIncomingTaskPackage'],
    async exec(deps, input = {}) {
      const { boundedText, getTransferService, normalizeTaskPackageTransferInput } = deps;
      try {
        const { transferId } = normalizeTaskPackageTransferInput(input);
        const transfer = await getTransferService().acceptTaskPackageTransfer(transferId);
        return { ok: true, transfer, transfers: getTransferService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-direct-accept-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.rejectIncoming',
    channel: 'taskPackages:rejectIncoming',
    preload: ['rejectIncomingTaskPackage'],
    exec(deps, input = {}) {
      const { boundedText, getTransferService, normalizeTaskPackageTransferInput } = deps;
      try {
        const { transferId } = normalizeTaskPackageTransferInput(input);
        const transfer = getTransferService().rejectTaskPackageTransfer(transferId);
        return { ok: true, transfer, transfers: getTransferService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-direct-reject-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.prepareIncoming',
    channel: 'taskPackages:prepareIncoming',
    preload: ['prepareIncomingTaskPackage'],
    async exec(deps, input = {}) {
      const { boundedText, getTransferService, normalizeTaskPackageTransferInput } = deps;
      try {
        const { transferId } = normalizeTaskPackageTransferInput(input);
        const prepared = await getTransferService().prepareTaskPackageImport(transferId);
        return { ok: true, ...prepared, transfers: getTransferService().list() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-direct-prepare-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.savePortableFallback',
    channel: 'taskPackages:savePortableFallback',
    preload: ['saveTaskPackageFallback'],
    async exec(deps, input = {}) {
      const { app, boundedText, dialog, getTaskPackageService, getTransferService, mainWindow, normalizeTaskPackageTransferInput, t, taskPackageSuggestedName } = deps;
      try {
        const { transferId } = normalizeTaskPackageTransferInput(input);
        const transfer = getTransferService().list().find((item) => item.transferId === transferId);
        if (!transfer || transfer.type !== 'task-package' || transfer.direction !== 'outgoing') {
          throw new Error('task-package-transfer-not-found');
        }
        if (!transfer.canSavePortable) throw new Error('task-package-portable-fallback-unavailable');
        const result = await dialog.showSaveDialog(mainWindow, {
          title: t('main.taskPackage.exportTitle'),
          defaultPath: path.join(
            app.getPath('desktop'),
            taskPackageSuggestedName(transfer.taskPackage?.title || 'task-package')
          ),
          filters: [{ name: 'Catshelf Task Package', extensions: ['agentdesk-task'] }]
        });
        if (result.canceled || !result.filePath) return { ok: true, cancelled: true };
        const saved = await getTransferService().saveTaskPackageFallback(transferId, result.filePath);
        return {
          ok: true,
          saved,
          transfers: getTransferService().list(),
          history: getTaskPackageService().listHistory()
        };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-portable-fallback-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.chooseImport',
    channel: 'taskPackages:chooseImport',
    preload: ['chooseTaskPackageImport'],
    async exec(deps) {
      const { boundedText, dialog, getTaskPackageService, mainWindow, t } = deps;
      try {
        const result = await dialog.showOpenDialog(mainWindow, {
          title: t('main.taskPackage.importTitle'),
          properties: ['openFile'],
          filters: [{ name: 'Catshelf Task Package', extensions: ['agentdesk-task'] }]
        });
        if (result.canceled || !result.filePaths[0]) return { ok: true, cancelled: true };
        return { ok: true, draft: getTaskPackageService().createImportDraft(result.filePaths[0]) };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-import-choose-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.inspectImport',
    channel: 'taskPackages:inspectImport',
    preload: ['inspectTaskPackageImport'],
    async exec(deps, input = {}) {
      const { boundedText, getTaskPackageService } = deps;
      try {
        const inspected = await getTaskPackageService().inspectImport({
          token: boundedText(input.token, 128),
          unlockCode: boundedText(input.unlockCode, 100)
        });
        return { ok: true, inspected };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-import-inspect-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.commitImport',
    channel: 'taskPackages:commitImport',
    preload: ['commitTaskPackageImport'],
    async exec(deps, input = {}) {
      const { app, boundedText, dialog, getTaskPackageService, mainWindow, t } = deps;
      try {
        const destination = await dialog.showOpenDialog(mainWindow, {
          title: t('main.taskPackage.materialsTitle'),
          defaultPath: app.getPath('documents'),
          properties: ['openDirectory', 'createDirectory']
        });
        if (destination.canceled || !destination.filePaths[0]) return { ok: true, cancelled: true };
        const imported = await getTaskPackageService().commitImport({
          token: boundedText(input.token, 128),
          targetProfileId: boundedText(input.targetProfileId, 128),
          artifactDirectory: destination.filePaths[0],
          openAfterImport: input.openAfterImport !== false
        });
        return { ok: true, imported, history: getTaskPackageService().listHistory() };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-import-commit-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.cancelImport',
    channel: 'taskPackages:cancelImport',
    preload: ['cancelTaskPackageImport'],
    exec(deps, input = {}) {
      const { boundedText, getTaskPackageService } = deps;
      try {
        getTaskPackageService().cancelImport(boundedText(input.token, 128));
        return { ok: true };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-import-cancel-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.list',
    channel: 'taskPackages:list',
    preload: ['listTaskPackages'],
    exec(deps) {
      const { boundedText, getTaskPackageService } = deps;
      try { return { ok: true, history: getTaskPackageService().listHistory() }; } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-history-failed', 160) };
      }
    }
  },
  {
    id: 'taskPackages.reveal',
    channel: 'taskPackages:reveal',
    preload: ['revealTaskPackage'],
    exec(deps, input = {}) {
      const { boundedText, getTaskPackageService, shell } = deps;
      try {
        const itemPath = getTaskPackageService().historyLocation(
          boundedText(input.packageId, 128),
          boundedText(input.direction, 40)
        );
        if (fs.statSync(itemPath).isDirectory()) shell.openPath(itemPath);
        else shell.showItemInFolder(itemPath);
        return { ok: true };
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'task-package-history-location', 160) };
      }
    }
  }
];

module.exports = { COMMANDS };
