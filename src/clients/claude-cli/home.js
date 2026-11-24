'use strict';

// A new managed Claude Code home: the folder and its projects/ folder, nothing
// copied from ~/.claude (no account, proxy or credential files).

function seedClaudeCliHome(sessionRoot, fsImpl, pathImpl) {
  fsImpl.mkdirSync(sessionRoot, { recursive: true });
  fsImpl.mkdirSync(pathImpl.join(sessionRoot, 'projects'), { recursive: true });
  return {
    seeded: true,
    appId: 'claude-cli',
    path: sessionRoot,
    files: []
  };
}

module.exports = { seedClaudeCliHome };
