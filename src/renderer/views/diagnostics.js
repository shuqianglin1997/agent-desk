// AgentDesk — the location diagnostics dialog (docs/ARCHITECTURE_PLAN.md
// phase 6). Moved from src/renderer.js unchanged.

async function showDiagnostics() {
  const profile = selectedProfile();
  if (!profile) return;
  lastDiagnostics = await window.manager.getDiagnostics(profile);
  renderDiagnostics(lastDiagnostics);
  openDialog(els.diagnosticsDialog);
}

function renderDiagnostics(diagnostics) {
  els.diagnosticsBody.replaceChildren();
  if (!diagnostics) return;

  const runtime = diagnostics.runtime || {};
  const crashpad = runtime.crashpad || {};

  const summary = document.createElement('div');
  summary.className = 'diagnostics-summary';
  summary.append(
    diagnosticBadge(diagnostics.executable.launchable ? 'ok' : 'warn', diagnostics.executable.launchable ? tr('diag.appLaunchable') : tr('diag.appNotFound')),
    diagnosticBadge(diagnostics.profilePath.exists ? 'ok' : 'warn', diagnostics.profilePath.exists ? tr('diag.profileDirExists') : tr('diag.profileDirMissing')),
    diagnosticBadge(diagnostics.sessionRoot.exists && diagnostics.sessionRoot.readable ? 'ok' : 'warn', diagnostics.sessionRoot.exists ? tr('diag.sessionDirReadable') : tr('diag.sessionDirMissing')),
    diagnosticBadge(diagnostics.sessionCount > 0 ? 'ok' : 'warn', tr('diag.sessionCount', { n: diagnostics.sessionCount })),
    diagnosticBadge(runtime.fusedAt ? 'warn' : 'ok', runtime.fusedAt
      ? tr('diag.crashpadFused')
      : tr('diag.crashpadBounded'))
  );
  els.diagnosticsBody.append(summary);

  if (diagnostics.warnings.length) {
    const warningList = document.createElement('ul');
    warningList.className = 'diagnostics-warnings';
    diagnostics.warnings.forEach((warning) => {
      const item = document.createElement('li');
      item.textContent = warning;
      warningList.append(item);
    });
    els.diagnosticsBody.append(warningList);
  }

  if (diagnostics.migration?.needed) {
    const repair = document.createElement('div');
    repair.className = 'diagnostics-repair';
    const text = document.createElement('span');
    text.textContent = tr('diag.migrateSuggest', { path: diagnostics.migration.recommendedPath });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'primary';
    button.textContent = tr('diag.migrateBtn');
    button.addEventListener('click', async () => {
      const profile = selectedProfile();
      if (!profile) return;
      if (!window.confirm(tr('status.migrateConfirm', { name: profile.name }))) {
        return;
      }
      button.disabled = true;
      button.textContent = tr('diag.migrating');
      setStatus(tr('status.migrating'));
      const result = await window.manager.migrateWindowsProfilePath(profile.id);
      if (!result.ok) {
        button.disabled = false;
        button.textContent = tr('diag.migrateBtn');
        setStatus(result.reason || tr('status.migrateFail'));
        return;
      }
      await loadProfiles(profile.id);
      lastDiagnostics = await window.manager.getDiagnostics(selectedProfile());
      renderDiagnostics(lastDiagnostics);
      setStatus(result.message || tr('status.migrateDone'));
    });
    repair.append(text, button);
    els.diagnosticsBody.append(repair);
  }

  const table = document.createElement('table');
  table.className = 'diagnostics-table';
  const tbody = document.createElement('tbody');
  [
    [tr('diag.row.platform'), [diagnostics.platform, diagnostics.arch, diagnostics.osRelease].filter(Boolean).join(' · ')],
    [tr('diag.row.officialApp'), diagnostics.executable.path || tr('diag.notFound')],
    [tr('diag.row.launchMethod'), diagnostics.executable.source || (diagnostics.executable.protocolUsable ? tr('diag.winProtocol') : tr('diag.notFound'))],
    [tr('diag.row.manualPath'), diagnostics.executable.configuredPath
      ? `${diagnostics.executable.configuredPath}${diagnostics.executable.explicitMissing ? tr('diag.invalid') : ''}`
      : tr('diag.notSet')],
    [tr('diag.row.profileDir'), diagnostics.profilePath.path],
    [tr('diag.row.sessionRoot'), diagnostics.sessionRoot.path],
    [tr('diag.row.systemDefault'), `${diagnostics.defaultProfile.source} · ${diagnostics.defaultProfile.path}`],
    [tr('diag.row.configFile'), diagnostics.storeFile],
    [tr('diag.row.runtimeOwnership'), runtime.owned
      ? tr('diag.runtimeOwned')
      : tr('diag.runtimeUnowned')],
    [tr('diag.row.runtimeProcesses'), runtime.processCount === null || runtime.processCount === undefined
      ? tr('diag.notSet')
      : String(runtime.processCount)],
    [tr('diag.row.crashpadUsage'), crashpad.fileCount === null || crashpad.fileCount === undefined
      ? tr('diag.crashpadUnavailable')
      : tr('diag.crashpadUsage', {
          files: crashpad.fileCount,
          size: formatBytes(crashpad.totalBytes || 0),
          maxFiles: crashpad.limits?.maxFiles || 100,
          maxSize: formatBytes(crashpad.limits?.maxBytes || 0)
        })],
    [tr('diag.row.crashpadFuse'), runtime.fusedAt
      ? `${tr('diag.crashpadFused')} · ${runtime.fusedAt}`
      : tr('diag.crashpadReady')]
  ].forEach(([label, value]) => appendDiagnosticRow(tbody, label, value));
  const executableCandidates = diagnostics.executable.candidateDetails || [];
  if (executableCandidates.length) {
    appendDiagnosticRow(
      tbody,
      tr('diag.row.launchCandidates'),
      executableCandidates.map((item) => `${item.exists ? '✓' : '×'} ${item.source} · ${item.path}`).join('\n')
    );
  }
  if (diagnostics.executable.discoveryChannels?.length) {
    appendDiagnosticRow(
      tbody,
      tr('diag.row.discoveryChannels'),
      diagnostics.executable.discoveryChannels
        .map((item) => tr('diag.channelCandidates', { source: item.source, n: item.count }))
        .join('\n')
    );
  }
  if (diagnostics.defaultProfile?.candidates?.length) {
    appendDiagnosticRow(
      tbody,
      tr('diag.row.dataDirCandidates'),
      diagnostics.defaultProfile.candidates.map((item) => `${item.score >= 0 ? '✓' : '×'} ${item.source} · ${item.path}`).join('\n')
    );
  }
  diagnostics.sessionAreas.forEach((area) => {
    appendDiagnosticRow(tbody, area.label, `${area.exists ? tr('diag.exists') : tr('diag.notExists')} · ${area.path}`);
  });
  table.append(tbody);
  els.diagnosticsBody.append(table);
}

function diagnosticBadge(kind, text) {
  const badge = document.createElement('span');
  badge.className = `diagnostic-badge ${kind}`;
  badge.textContent = text;
  return badge;
}

function appendDiagnosticRow(tbody, label, value) {
  const row = document.createElement('tr');
  const key = document.createElement('th');
  const val = document.createElement('td');
  key.textContent = label;
  val.textContent = value || '-';
  row.append(key, val);
  tbody.append(row);
}

function formatDiagnosticsText(diagnostics) {
  const lines = [
    tr('diag.txt.title'),
    '',
    tr('diag.txt.platform', { v: diagnostics.platform }),
    tr('diag.txt.system', { arch: diagnostics.arch || '-', os: diagnostics.osRelease || '-' }),
    tr('diag.txt.app', { v: diagnostics.appName }),
    tr('diag.txt.officialApp', { v: diagnostics.executable.path || tr('diag.notFound') }),
    tr('diag.txt.launchMethod', { v: diagnostics.executable.source || (diagnostics.executable.protocolUsable ? tr('diag.winProtocol') : tr('diag.notFound')) }),
    tr('diag.txt.manualPath', { v: `${diagnostics.executable.configuredPath || tr('diag.notSet')}${diagnostics.executable.explicitMissing ? tr('diag.invalid') : ''}` }),
    tr('diag.txt.profileDir', { v: diagnostics.profilePath.path }),
    tr('diag.txt.sessionRoot', { v: diagnostics.sessionRoot.path }),
    tr('diag.txt.sessionCount', { v: diagnostics.sessionCount }),
    tr('diag.txt.configFile', { v: diagnostics.storeFile }),
    tr('diag.txt.runtimeOwnership', { v: diagnostics.runtime?.owned ? tr('diag.runtimeOwned') : tr('diag.runtimeUnowned') }),
    tr('diag.txt.crashpadUsage', {
      v: diagnostics.runtime?.crashpad?.fileCount === null || diagnostics.runtime?.crashpad?.fileCount === undefined
        ? tr('diag.crashpadUnavailable')
        : tr('diag.crashpadUsage', {
            files: diagnostics.runtime.crashpad.fileCount,
            size: formatBytes(diagnostics.runtime.crashpad.totalBytes || 0),
            maxFiles: diagnostics.runtime.crashpad.limits?.maxFiles || 100,
            maxSize: formatBytes(diagnostics.runtime.crashpad.limits?.maxBytes || 0)
          })
    })
  ];

  if (diagnostics.warnings.length) {
    lines.push('', tr('diag.txt.warnings'), ...diagnostics.warnings.map((warning) => `- ${warning}`));
  }

  lines.push('', tr('diag.txt.scanAreas'));
  diagnostics.sessionAreas.forEach((area) => {
    lines.push(`- ${area.label}: ${area.exists ? tr('diag.exists') : tr('diag.notExists')} · ${area.path}`);
  });

  lines.push('', tr('diag.txt.launchCandidates'));
  (diagnostics.executable.candidateDetails || []).forEach((item) => {
    lines.push(`- ${item.exists ? tr('diag.available') : tr('diag.unavailable')} · ${item.source} · ${item.path}`);
  });

  if (diagnostics.executable.discoveryChannels?.length) {
    lines.push('', tr('diag.txt.discoveryChannels'));
    diagnostics.executable.discoveryChannels.forEach((item) => {
      lines.push('- ' + tr('diag.txt.channelLine', { source: item.source, n: item.count }));
    });
  }

  lines.push('', tr('diag.txt.dataDirCandidates'));
  (diagnostics.defaultProfile?.candidates || []).forEach((item) => {
    lines.push(`- ${item.score >= 0 ? tr('diag.exists') : tr('diag.notExists')} · ${item.source} · ${item.path}`);
  });

  if (diagnostics.migration?.needed) {
    lines.push('', tr('diag.txt.migrateSuggest', { path: diagnostics.migration.recommendedPath }));
  }

  return lines.join('\n');
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { showDiagnostics, renderDiagnostics, diagnosticBadge, appendDiagnosticRow, formatDiagnosticsText };
Object.assign(window, { showDiagnostics, renderDiagnostics, diagnosticBadge, appendDiagnosticRow, formatDiagnosticsText });
