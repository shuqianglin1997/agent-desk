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

const REPOSITORY = repositoryOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')));

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
  keepLegacyIdentity
};
