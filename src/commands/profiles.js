'use strict';

// AgentDesk — the local accounts (profiles): list, add, edit, remove, move a
// Windows path, open, stop, runtime status, Crashpad clean-up and diagnostics.
// Bodies moved from main.js registerIpc unchanged; Main re-resolves every
// profile by id.

const COMMANDS = [
  {
    id: 'profiles.list',
    channel: 'profiles:list',
    preload: ['listProfiles'],
    exec(deps) {
      const { identityFingerprint, loadProfiles } = deps;
      // identityFingerprint 是运行时算的登录身份哈希（同指纹 = 同账号），
      // 不落盘：换号登录后自然更新，也不会把陈旧关联固化进 profiles.json。
      return loadProfiles().map((profile) => ({
        ...profile,
        identityFingerprint: identityFingerprint(profile)
      }));
    }
  },
  {
    id: 'profiles.add',
    channel: 'profiles:add',
    preload: ['addProfile'],
    exec(deps, input) {
      const { boundedText, createStoredProfile } = deps;
      return createStoredProfile({
        appId: boundedText(input?.appId, 80),
        name: boundedText(input?.name, 80),
        group: boundedText(input?.group, 80),
        note: boundedText(input?.note, 1000)
      });
    }
  },
  {
    id: 'profiles.update',
    channel: 'profiles:update',
    preload: ['updateProfile'],
    async exec(deps, input = {}) {
      const { boundedText, getProfileRuntimeSupervisor, loadProfiles, normalizeConfiguredPath, pathSelectionRegistry, pathsEqual, quotaService, updateStoredProfile } = deps;
      if (['profilePath', 'sessionRoot', 'executablePath'].some((key) => (
        Object.prototype.hasOwnProperty.call(input, key)
      ))) throw new Error('profile-path-input-forbidden');
      const profilePathSelectionId = boundedText(input.profilePathSelectionId, 128);
      const sessionRootSelectionId = boundedText(input.sessionRootSelectionId, 128);
      const executableSelectionId = boundedText(input.executableSelectionId, 128);
      const profilePath = profilePathSelectionId
        ? pathSelectionRegistry.resolve(profilePathSelectionId, 'profile-directory')
        : null;
      const sessionRoot = sessionRootSelectionId
        ? pathSelectionRegistry.resolve(sessionRootSelectionId, 'profile-directory')
        : null;
      const executablePath = executableSelectionId
        ? pathSelectionRegistry.resolve(executableSelectionId, 'profile-executable')
        : null;
      const currentProfile = loadProfiles().find((profile) => profile.id === boundedText(input.id, 128));
      if (currentProfile && (profilePath || sessionRoot || executablePath)) {
        const runtime = getProfileRuntimeSupervisor().status(currentProfile);
        if (runtime.owned && runtime.active === true) {
          const stopped = await getProfileRuntimeSupervisor().stopProfile(currentProfile, 'profile-path-change');
          if (!stopped.ok) throw new Error(stopped.reasonCode || 'profile-process-stop-failed');
        }
      }
      const updated = updateStoredProfile(boundedText(input.id, 128), (profile) => {
        const next = { ...profile };
        if (typeof input.name === 'string') next.name = boundedText(input.name, 80) || next.name;
        if (profilePath) {
          const normalizedProfilePath = normalizeConfiguredPath(profilePath);
          if (!pathsEqual(normalizedProfilePath, next.profilePath)) next.profilePathMode = 'custom';
          next.profilePath = normalizedProfilePath;
        }
        if (sessionRoot) {
          const normalizedSessionRoot = normalizeConfiguredPath(sessionRoot);
          if (!pathsEqual(normalizedSessionRoot, next.sessionRoot)) next.sessionRootMode = 'custom';
          next.sessionRoot = normalizedSessionRoot;
        }
        if (executablePath) next.executablePath = normalizeConfiguredPath(executablePath);
        if (input.clearExecutablePath === true) next.executablePath = null;
        if (typeof input.group === 'string') next.group = boundedText(input.group, 80);
        if (typeof input.note === 'string') next.note = String(input.note).slice(0, 1000);
        // 同账号标识：同一登录身份的多个客户端槽位共用一个 key（空 = 不关联）
        if (typeof input.identityKey === 'string') next.identityKey = boundedText(input.identityKey, 160) || null;
        if (input.cat && typeof input.cat === 'object') next.cat = { ...next.cat, ...input.cat };
        return next;
      });
      pathSelectionRegistry.consume([
        profilePathSelectionId,
        sessionRootSelectionId,
        executableSelectionId
      ]);
      quotaService.invalidate(boundedText(input.id, 128));
      return updated;
    }
  },
  {
    id: 'profiles.remove',
    channel: 'profiles:remove',
    preload: ['removeProfile'],
    async exec(deps, id) {
      const { getProfileRuntimeSupervisor, loadProfiles, quotaService, saveProfiles, t } = deps;
      const profiles = loadProfiles();
      const target = profiles.find((profile) => profile.id === id);
      if (!target) return { ok: false, reason: t('main.err.slotNotFound') };
      const runtime = getProfileRuntimeSupervisor().status(target);
      if (runtime.owned && runtime.active === true) {
        const stopped = await getProfileRuntimeSupervisor().stopProfile(target, 'profile-remove');
        if (!stopped.ok) return { ok: false, reason: stopped.reasonCode || 'profile-process-stop-failed' };
      }
      saveProfiles(profiles.filter((profile) => profile.id !== id));
      quotaService.invalidate(id);
      return { ok: true };
    }
  },
  {
    id: 'profiles.migrateWindowsPath',
    channel: 'profiles:migrateWindowsPath',
    preload: ['migrateWindowsProfilePath'],
    async exec(deps, id) {
      const { migrateWindowsProfilePath } = deps;
      return migrateWindowsProfilePath(id);
    }
  },
  {
    id: 'profiles.launch',
    channel: 'profiles:launch',
    preload: ['launchProfile'],
    async exec(deps, id) {
      const { launchStoredProfile } = deps;
      return launchStoredProfile(id);
    }
  },
  {
    id: 'profiles.runtimeStatus',
    channel: 'profiles:runtimeStatus',
    preload: ['getProfileRuntimeStatus'],
    exec(deps, id) {
      const { boundedText, getProfileRuntimeSupervisor, loadProfiles } = deps;
      const profile = loadProfiles().find((item) => item.id === boundedText(id, 128));
      if (!profile) return { ok: false, reasonCode: 'profile-not-found' };
      return { ok: true, runtime: getProfileRuntimeSupervisor().status(profile) };
    }
  },
  {
    id: 'profiles.stop',
    channel: 'profiles:stop',
    preload: ['stopProfile'],
    async exec(deps, id) {
      const { boundedText, getProfileRuntimeSupervisor, loadProfiles } = deps;
      const profile = loadProfiles().find((item) => item.id === boundedText(id, 128));
      if (!profile) return { ok: false, reasonCode: 'profile-not-found' };
      return getProfileRuntimeSupervisor().stopProfile(profile, 'user-request');
    }
  },
  {
    id: 'profiles.cleanCrashpad',
    channel: 'profiles:cleanCrashpad',
    preload: ['cleanProfileCrashpad'],
    async exec(deps, id) {
      const { boundedText, getProfileRuntimeSupervisor, loadProfiles } = deps;
      const profile = loadProfiles().find((item) => item.id === boundedText(id, 128));
      if (!profile) return { ok: false, reasonCode: 'profile-not-found' };
      try {
        return await getProfileRuntimeSupervisor().cleanCrashpad(profile);
      } catch (error) {
        return { ok: false, reasonCode: boundedText(error?.message || 'crashpad-clean-failed', 160) };
      }
    }
  },
  {
    id: 'diagnostics.get',
    channel: 'diagnostics:get',
    preload: ['getDiagnostics'],
    async exec(deps, input = {}) {
      const { boundedText, diagnoseProfile, loadProfiles, refreshForAction } = deps;
      const profile = loadProfiles().find((item) => item.id === boundedText(input.profileId, 128));
      if (!profile) return null;
      await refreshForAction([profile.id]);
      return diagnoseProfile(profile);
    }
  }
];

module.exports = { COMMANDS };
