'use strict';

// The product's names, and the internal ones it keeps from before the rename
// (docs/RENAME_PLAN.md). The person sees Catshelf / 猫架 everywhere; the data
// folder and the macOS keychain item keep the old name, so accounts, settings
// and the device network's keys stay where they are.

const fs = require('node:fs');
const path = require('node:path');

const PRODUCT_NAME = 'Catshelf';
const PRODUCT_NAME_ZH = '猫架';
// Electron names the data folder (appData/<app name>) and the keychain item
// ("<app name> Safe Storage") after the app name. Both keep this one.
const LEGACY_NAME = 'AgentDesk';
// System permissions, keychain access and LaunchServices know the app by it.
const BUNDLE_ID = 'com.hupo.agentdesk';
// The commands the local macOS installer writes to ~/.local/bin; both run the
// app's --cli. `agentdesk` is the old name, kept as an alias.
const CLI_COMMANDS = Object.freeze(['catshelf', 'agentdesk']);

/**
 * The GitHub repository named by package.json's `repository`, the one place
 * to change when the repository is renamed.
 * @param {any} manifest
 * @returns {{ owner: string, name: string }}
 */
function repositoryOf(manifest) {
  const url = String(manifest?.repository?.url || manifest?.repository || '');
  const match = url.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/i);
  if (!match) throw new Error('package.json repository is not a GitHub repository URL');
  return Object.freeze({ owner: match[1], name: match[2] });
}

// The app's root: the repository in a source checkout, app.asar in a package.
const APP_ROOT = path.join(__dirname, '..', '..');
const REPOSITORY = repositoryOf(JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')));

/**
 * Which source this copy was built from (docs/FIX_AND_REBUILD.md). A package
 * carries build-info.json, written by scripts/build-info.js just before
 * electron-builder packs it; it is read only when the root is an .asar, so a
 * stale file in a source checkout is never reported. Unknown stays null.
 * @param {string} [root]
 * @returns {{ version: string, packaged: boolean, commit: string | null, dirty: boolean | null, repository: string }}
 */
function buildInfo(root = APP_ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const { owner, name } = repositoryOf(manifest);
  const packaged = /\.asar$/i.test(path.resolve(root));
  let commit = null;
  let dirty = null;
  if (packaged) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(root, 'build-info.json'), 'utf8'));
      if (typeof record?.commit === 'string' && /^[0-9a-f]{40}$/.test(record.commit)) {
        commit = record.commit;
        dirty = typeof record.dirty === 'boolean' ? record.dirty : null;
      }
    } catch (_error) { /* no record: the commit is unknown */ }
  }
  return { version: String(manifest.version || ''), packaged, commit, dirty, repository: `https://github.com/${owner}/${name}` };
}

/**
 * The macOS About panel: version, short commit ("+" when the package had
 * uncommitted changes, "source" when running from a checkout) and where the
 * source is.
 * @param {ReturnType<typeof buildInfo>} info
 */
function aboutPanelOptions(info) {
  const short = info.commit ? `${info.commit.slice(0, 7)}${info.dirty ? '+' : ''}` : (info.packaged ? 'unknown' : 'source');
  const commitLine = info.commit ? `\ncommit ${info.commit}${info.dirty ? ' + uncommitted changes' : ''}` : '';
  return { applicationVersion: info.version, version: short, credits: `${info.repository}${commitLine}` };
}

/**
 * Call first thing in Main, before anything reads the app name or the data
 * folder. The app name is the old one while Electron fixes the keychain item
 * during start-up, and the new one from `will-finish-launching` on (menus,
 * dialogs, the about panel). The listener goes first because Electron builds
 * its default menu (About/Hide/Quit <name>) in its own listener for the same
 * event. An explicit --user-data-dir (tests, portable setups) is left alone;
 * otherwise the data folder is appData/AgentDesk. Measured on Electron 43.3.0
 * with scripts/keychain-name-probe.js; rerun it after an Electron upgrade.
 * @param {{
 *   setName(name: string): void,
 *   getPath(name: string): string,
 *   setPath(name: string, value: string): void,
 *   prependOnceListener(event: string, listener: () => void): unknown,
 *   commandLine: { hasSwitch(name: string): boolean }
 * }} app
 * @param {{ legacyName?: string, productName?: string, mkdir?: (dir: string) => void }} [options]
 * @returns {{ userData: string | null }}
 */
function keepLegacyIdentity(app, options = {}) {
  const legacyName = options.legacyName || LEGACY_NAME;
  const productName = options.productName || PRODUCT_NAME;
  const mkdir = options.mkdir || ((dir) => { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); });
  app.setName(legacyName);
  let userData = null;
  if (!app.commandLine.hasSwitch('user-data-dir')) {
    userData = path.join(app.getPath('appData'), legacyName);
    // setPath refuses a folder that does not exist yet (a first start).
    mkdir(userData);
    app.setPath('userData', userData);
  }
  app.prependOnceListener('will-finish-launching', () => app.setName(productName));
  return { userData };
}

module.exports = {
  PRODUCT_NAME,
  PRODUCT_NAME_ZH,
  LEGACY_NAME,
  BUNDLE_ID,
  CLI_COMMANDS,
  REPOSITORY,
  repositoryOf,
  buildInfo,
  aboutPanelOptions,
  keepLegacyIdentity
};
