#!/usr/bin/env node
'use strict';

// Which keychain item and data folder does Electron use, and does
// keepLegacyIdentity (src/core/product.js) keep the old ones? docs/RENAME_PLAN.md §3.
// Rerun after every Electron upgrade, before installing.
//
// macOS only. Runs node_modules' Electron on a tiny probe app twice: as is, and
// with keepLegacyIdentity(app, { legacyName: 'ProbeOld', productName: 'ProbeNew' }).
// Nothing reaches the person's keychain: an interposed library answers
// SecItemCopyMatching/Add/Update/Delete with "not found" / success and only
// records the service and account names, the probe stops unless that library
// is loaded, and the run sits in a sandbox that cannot reach the keychain
// services. The data folder lives under a temporary home (CFFIXED_USER_HOME).
// Needs the Command Line Tools' clang; downloads nothing; deletes its folder.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const PRODUCT_JS = path.join(__dirname, '..', 'src', 'core', 'product.js');

const INTERPOSE_C = String.raw`#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#include <stdio.h>
#include <stdlib.h>
#define INTERPOSE(r, e) __attribute__((used)) static struct { const void *a; const void *b; } _i_##e \
  __attribute__((section("__DATA,__interpose"))) = { (const void *)(unsigned long)&r, (const void *)(unsigned long)&e };
static void text(CFDictionaryRef q, CFStringRef key, char *out, size_t n) {
  out[0] = 0;
  CFTypeRef v = q ? CFDictionaryGetValue(q, key) : NULL;
  if (v && CFGetTypeID(v) == CFStringGetTypeID()) CFStringGetCString((CFStringRef)v, out, (CFIndex)n, kCFStringEncodingUTF8);
}
static void note(const char *op, CFDictionaryRef q) {
  const char *file = getenv("KC_PROBE_LOG");
  FILE *f = file ? fopen(file, "a") : NULL;
  if (!f) return;
  char s[512], a[512];
  text(q, kSecAttrService, s, sizeof s);
  text(q, kSecAttrAccount, a, sizeof a);
  fprintf(f, "keychain\t%s\t%s\t%s\n", op, s, a);
  fclose(f);
}
static OSStatus p_copy(CFDictionaryRef q, CFTypeRef *r) { note("find", q); if (r) *r = NULL; return errSecItemNotFound; }
static OSStatus p_add(CFDictionaryRef q, CFTypeRef *r) { note("add", q); if (r) *r = NULL; return errSecSuccess; }
static OSStatus p_update(CFDictionaryRef q, CFDictionaryRef u) { (void)u; note("update", q); return errSecSuccess; }
static OSStatus p_delete(CFDictionaryRef q) { note("delete", q); return errSecSuccess; }
INTERPOSE(p_copy, SecItemCopyMatching)
INTERPOSE(p_add, SecItemAdd)
INTERPOSE(p_update, SecItemUpdate)
INTERPOSE(p_delete, SecItemDelete)
__attribute__((constructor)) static void loaded(void) { setenv("KC_PROBE_INTERPOSED", "1", 1); }
`;

// System tools in /usr/bin drop DYLD_* variables, so a launcher of our own sets
// it after sandbox-exec and then runs Electron.
const LAUNCHER_C = String.raw`#include <stdlib.h>
#include <unistd.h>
int main(int argc, char **argv) {
  const char *lib = getenv("KC_PROBE_DYLIB");
  if (!lib || argc < 2) return 64;
  setenv("DYLD_INSERT_LIBRARIES", lib, 1);
  execv(argv[1], argv + 1);
  return 65;
}
`;

const SANDBOX = `(version 1)
(allow default)
(deny mach-lookup
  (global-name "com.apple.SecurityServer")
  (global-name "com.apple.securityd")
  (global-name "com.apple.securityd.xpc")
  (global-name-regex #"^com\\.apple\\.security\\."))
`;

function probeMain() {
  return `'use strict';
const fs = require('node:fs');
const { app, safeStorage, Menu } = require('electron');
const log = (line) => fs.appendFileSync(process.env.KC_PROBE_LOG, line + '\\n');
if (process.env.KC_PROBE_INTERPOSED !== '1') { log('abort\\tnot-interposed'); process.exit(3); }
try { app.dock?.hide(); } catch (_error) { /* not yet available */ }
if (process.env.KC_PROBE_MODE === 'pinned') {
  require(${JSON.stringify(PRODUCT_JS)}).keepLegacyIdentity(app, { legacyName: 'ProbeOld', productName: 'ProbeNew' });
}
app.whenReady().then(() => {
  log('ready\\t' + app.getName() + '\\t' + app.getPath('userData'));
  const appMenu = Menu.getApplicationMenu()?.items?.[0];
  log('menu\\t' + [appMenu?.label, ...(appMenu?.submenu?.items || []).map((item) => item.label)].filter(Boolean).join('|'));
  try { safeStorage.encryptString('probe'); log('encrypt\\tok'); } catch (error) { log('encrypt\\tfailed ' + error.message); }
  app.quit();
});
`;
}

function removeChromiumSingletonDir(userData) {
  try {
    const dir = path.dirname(fs.readlinkSync(path.join(userData, 'SingletonSocket')));
    if (/^scoped_dir/.test(path.basename(dir))) fs.rmSync(dir, { recursive: true, force: true });
  } catch (_error) {
    // No link: the instance never got that far.
  }
}

function runCase(root, mode, files) {
  const home = path.join(root, `home-${mode}`);
  const log = path.join(root, `log-${mode}.txt`);
  fs.mkdirSync(home);
  fs.writeFileSync(log, '');
  const env = { ...process.env, HOME: home, CFFIXED_USER_HOME: home, KC_PROBE_LOG: log, KC_PROBE_DYLIB: files.dylib, KC_PROBE_MODE: mode };
  delete env.ELECTRON_RUN_AS_NODE;
  const run = spawnSync('/usr/bin/sandbox-exec', ['-f', files.sandbox, files.launcher, require('electron'), '--no-sandbox', '--disable-gpu', files.app], {
    env, encoding: 'utf8', timeout: 60_000
  });
  const lines = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => line.split('\t'));
  const ready = lines.find((line) => line[0] === 'ready');
  if (ready) removeChromiumSingletonDir(ready[2]);
  return {
    mode,
    exit: run.status,
    aborted: lines.some((line) => line[0] === 'abort'),
    appName: ready?.[1] || null,
    userDataFolder: ready ? path.basename(ready[2]) : null,
    userDataInsideProbeHome: ready ? ready[2].startsWith(fs.realpathSync(home)) || ready[2].startsWith(home) : false,
    keychain: [...new Set(lines.filter((line) => line[0] === 'keychain').map((line) => `${line[2]} / ${line[3]}`))],
    encrypted: lines.some((line) => line[0] === 'encrypt' && line[1] === 'ok'),
    menu: lines.find((line) => line[0] === 'menu')?.[1] || ''
  };
}

function judge(results) {
  const [plain, pinned] = results;
  const servicesOf = (result) => [...new Set(result.keychain.map((entry) => entry.split(' / ')[0]))];
  const problems = [];
  for (const result of results) {
    if (result.aborted || result.exit !== 0 || !result.encrypted || !result.keychain.length) problems.push(`${result.mode}: the probe did not run through`);
    if (!result.userDataInsideProbeHome) problems.push(`${result.mode}: the data folder was not inside the probe home`);
  }
  if (servicesOf(plain).join() !== 'ProbeNew Safe Storage' || plain.userDataFolder !== 'ProbeNew') {
    problems.push('as is: Electron no longer names the keychain item and data folder after the app name; review docs/RENAME_PLAN.md §3');
  }
  if (servicesOf(pinned).join() !== 'ProbeOld Safe Storage' || pinned.userDataFolder !== 'ProbeOld' || pinned.appName !== 'ProbeNew') {
    problems.push('pinned: keepLegacyIdentity no longer keeps the old keychain item and data folder; do not install');
  }
  // The default menu's About/Hide/Quit items carry the app name of the moment it is built.
  if (process.platform === 'darwin' && (!pinned.menu.includes('ProbeNew') || pinned.menu.includes('ProbeOld'))) {
    problems.push('pinned: the default menu shows the old name; the name must be restored before Electron builds it');
  }
  return problems;
}

function main() {
  if (process.platform !== 'darwin') throw new Error('macOS only');
  for (const tool of ['/usr/bin/clang', '/usr/bin/sandbox-exec']) if (!fs.existsSync(tool)) throw new Error(`${tool} is missing`);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-keychain-probe-'));
  try {
    const files = {
      dylib: path.join(root, 'interpose.dylib'),
      launcher: path.join(root, 'launcher'),
      sandbox: path.join(root, 'deny-keychain.sb'),
      app: path.join(root, 'app')
    };
    fs.writeFileSync(path.join(root, 'interpose.c'), INTERPOSE_C);
    fs.writeFileSync(path.join(root, 'launcher.c'), LAUNCHER_C);
    fs.writeFileSync(files.sandbox, SANDBOX);
    fs.mkdirSync(files.app);
    fs.writeFileSync(path.join(files.app, 'package.json'), JSON.stringify({ name: 'keychain-name-probe', productName: 'ProbeNew', version: '0.0.0', main: 'main.js' }));
    fs.writeFileSync(path.join(files.app, 'main.js'), probeMain());
    execFileSync('/usr/bin/clang', ['-dynamiclib', '-o', files.dylib, path.join(root, 'interpose.c'), '-framework', 'CoreFoundation', '-framework', 'Security'], { stdio: 'pipe' });
    execFileSync('/usr/bin/clang', ['-o', files.launcher, path.join(root, 'launcher.c')], { stdio: 'pipe' });
    const results = [runCase(root, 'plain', files), runCase(root, 'pinned', files)];
    const problems = judge(results);
    const electron = require('electron/package.json').version;
    process.stdout.write(`${JSON.stringify({ electron, results, problems }, null, 2)}\n`);
    if (problems.length) process.exitCode = 1;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`keychain-name-probe: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { judge };
