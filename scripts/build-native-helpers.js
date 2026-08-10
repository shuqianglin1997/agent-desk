const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'native', 'bin');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    windowsHide: true
  });
  if (result.status !== 0) {
    const detail = options.capture ? `${result.stdout || ''}${result.stderr || ''}`.trim() : '';
    throw new Error(`native-helper-build-failed:${path.basename(command)}${detail ? `\n${detail}` : ''}`);
  }
  return result.stdout || '';
}

function buildMac() {
  const source = path.join(root, 'native', 'macos', 'AgentDeskInputHelper.swift');
  const output = path.join(outputDirectory, 'AgentDeskInputHelper');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-input-helper-'));
  const sdk = execFileSync('xcrun', ['--sdk', 'macosx', '--show-sdk-path'], { encoding: 'utf8' }).trim();
  const binaries = [];
  try {
    for (const arch of ['arm64', 'x86_64']) {
      const target = path.join(temporary, `AgentDeskInputHelper-${arch}`);
      run('xcrun', [
        'swiftc', source,
        '-O',
        '-sdk', sdk,
        '-target', `${arch}-apple-macosx12.0`,
        '-framework', 'ApplicationServices',
        '-o', target
      ]);
      binaries.push(target);
    }
    run('xcrun', ['lipo', '-create', ...binaries, '-output', output]);
    fs.chmodSync(output, 0o755);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return output;
}

function buildWindows() {
  const source = path.join(root, 'native', 'windows', 'AgentDeskInputHelper.cpp');
  const output = path.join(outputDirectory, 'AgentDeskInputHelper.exe');
  const direct = spawnSync('where.exe', ['cl.exe'], { encoding: 'utf8', windowsHide: true });
  if (direct.status === 0) {
    run('cl.exe', ['/nologo', '/O2', '/std:c++17', '/EHsc', source, `/Fe:${output}`, 'user32.lib']);
    return output;
  }
  const vswhere = path.join(
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe'
  );
  if (!fs.existsSync(vswhere)) throw new Error('native-helper-msvc-unavailable');
  const install = execFileSync(vswhere, [
    '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-property', 'installationPath'
  ], { encoding: 'utf8' }).trim();
  if (!install) throw new Error('native-helper-msvc-unavailable');
  const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!fs.existsSync(vcvars)) throw new Error('native-helper-vcvars-unavailable');
  const fixedCommand = `call "${vcvars}" >nul && cl.exe /nologo /O2 /std:c++17 /EHsc "${source}" /Fe:"${output}" user32.lib`;
  run('cmd.exe', ['/d', '/s', '/c', fixedCommand]);
  return output;
}

function build() {
  fs.mkdirSync(outputDirectory, { recursive: true });
  if (process.platform === 'darwin') return buildMac();
  if (process.platform === 'win32') return buildWindows();
  throw new Error(`native-helper-platform-unsupported:${process.platform}`);
}

module.exports = async function beforePack() {
  const output = build();
  process.stdout.write(`AgentDesk input helper built: ${output}\n`);
};

if (require.main === module) {
  Promise.resolve(module.exports()).catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}
