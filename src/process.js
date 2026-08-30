/*
 * AgentDesk — 官方 App 运行探测。
 *
 * 每个账号槽位启动官方 Claude / Codex / Cursor 时都带 `--user-data-dir=<profilePath>`。
 * 通过匹配正在运行进程的命令行，判断「这个账号的官方 App 此刻是否开着」（isRunningIn）。
 * 「干活中 vs 在岗」不看进程，改看会话记录的最后活跃时间（见 activity.js / cats.js）。
 *
 * 纯匹配函数可单测；snapshotProcesses 采集系统进程命令行，
 * 失败返回 null（表示探测不可用，上层退回启发）。
 */

const { execFileSync } = require('node:child_process');

/*
 * psText 里是否出现「归属于 profilePath 的」 `--user-data-dir=<profilePath>`。
 *
 * 难点：profilePath 可能含空格（如「Application Support/Claude Profiles/lyh」），
 * 且短路径是长路径的前缀（…/Claude 是 …/Claude Profiles/lyh 的前缀）。
 * 因此必须确认匹配点后面是「参数分隔」（空白接 '-'，或行尾），而不是更长的路径。
 *
 * 注：这条规则把「路径后紧跟一个位置参数（如 deep-link URL）」也当成不匹配，
 * 属理论边界；但官方 App 是多进程 Electron，renderer/gpu 等 helper 进程的命令行
 * 都带规范的 `--user-data-dir=X --flag…` 形式，总能命中，故实际不受影响。
 */
function matchesDataDir(haystack, profilePath) {
  const windowsPath = /^[a-z]:[\\/]|^\\\\/i.test(profilePath);
  const normalize = (value) => {
    let output = String(value || '').replace(/^\\\\\?\\/, '');
    if (windowsPath) output = output.replace(/\//g, '\\').toLowerCase();
    return output;
  };
  const text = normalize(haystack);
  const target = normalize(profilePath);
  const needles = [
    `--user-data-dir=${target}`,
    `--user-data-dir="${target}`,
    `"--user-data-dir=${target}`,
    `--user-data-dir ${target}`,
    `--user-data-dir "${target}`
  ];

  for (const needle of needles) {
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      let end = idx + needle.length;
      if (text.charAt(end) === '"' || text.charAt(end) === "'") end += 1;
      const after = text.charAt(end);
      if (after === '' || after === '\n' || after === '\r') return true;
      if (after === ' ' || after === '\t') {
        const rest = text.slice(end).replace(/^[ \t]+/, '');
        if (rest === '' || rest.charAt(0) === '-' || rest.charAt(0) === '\n' || rest.charAt(0) === '\r') return true;
      }
      idx = text.indexOf(needle, idx + needle.length);
    }
  }
  return false;
}

// psText 里是否有进程以 `--user-data-dir=<profilePath>` 运行。
function isRunningIn(psText, profilePath) {
  if (!psText || !profilePath) return false;
  return matchesDataDir(psText, profilePath);
}

function normalizeCommandPath(value, windowsPath) {
  let output = String(value || '').replace(/^\\\\\?\\/, '');
  if (windowsPath) output = output.replace(/\//g, '\\').toLowerCase();
  return output;
}

function matchesCrashpadDatabase(command, profilePath) {
  if (!command || !profilePath || !/crashpad/i.test(command)) return false;
  const windowsPath = /^[a-z]:[\\/]|^\\\\/i.test(profilePath);
  const normalizedCommand = normalizeCommandPath(command, windowsPath);
  const normalizedProfile = normalizeCommandPath(profilePath, windowsPath).replace(/[\\/]+$/, '');
  const separator = windowsPath ? '\\' : '/';
  const crashpadRoot = `${normalizedProfile}${separator}${windowsPath ? 'crashpad' : 'Crashpad'}`;
  const needles = [
    `--database=${crashpadRoot}`,
    `--database="${crashpadRoot}`,
    `"--database=${crashpadRoot}`,
    `--database ${crashpadRoot}`,
    `--database "${crashpadRoot}`
  ];
  for (const needle of needles) {
    let index = normalizedCommand.indexOf(needle);
    while (index !== -1) {
      let end = index + needle.length;
      if (normalizedCommand.charAt(end) === '"' || normalizedCommand.charAt(end) === "'") end += 1;
      const after = normalizedCommand.charAt(end);
      if (after === '' || after === '\n' || after === '\r' || after === ' ' || after === '\t') return true;
      index = normalizedCommand.indexOf(needle, index + needle.length);
    }
  }
  return false;
}

function findProfileProcesses(records, profilePath) {
  if (!Array.isArray(records) || !profilePath) return [];
  return records.filter((record) => (
    record && Number.isInteger(record.pid) && record.pid > 0 && (
      matchesDataDir(record.command, profilePath) ||
      matchesCrashpadDatabase(record.command, profilePath)
    )
  ));
}

// Duplicate-launch detection must require a real client process carrying the
// Profile's user-data-dir. Crashpad handlers can outlive a crashed browser;
// they remain part of lifecycle cleanup, but they do not prove that a usable
// client window still exists.
function findProfileClientProcesses(records, profilePath) {
  if (!Array.isArray(records) || !profilePath) return [];
  return records.filter((record) => (
    record && Number.isInteger(record.pid) && record.pid > 0 &&
    matchesDataDir(record.command, profilePath)
  ));
}

// Windows 默认 Store/MSIX 槽位不传 --user-data-dir，无法按账号目录匹配。
// 只匹配没有隔离参数的桌面 App 进程，并排除常见 CLI shim 路径。
function isDefaultWindowsAppRunning(psText, executableNames) {
  if (!psText || !Array.isArray(executableNames) || !executableNames.length) return false;
  const patterns = executableNames.map((name) => new RegExp(
    `(^|[\\\\/"'\\s])${escapeRegExp(String(name).toLowerCase())}(?=$|["'\\s])`
  ));
  const cliFragments = [
    '\\appdata\\roaming\\npm\\',
    '\\microsoft\\winget\\links\\',
    '\\node_modules\\',
    '\\.local\\bin\\'
  ];

  return String(psText).split(/\r?\n/).some((line) => {
    const normalized = line.replace(/\//g, '\\').toLowerCase();
    if (!normalized || normalized.includes('--user-data-dir')) return false;
    if (cliFragments.some((fragment) => normalized.includes(fragment))) return false;
    return patterns.some((pattern) => pattern.test(normalized));
  });
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 采集进程命令行快照。失败（无权限 / 超时 / 平台不支持）返回 null。
function snapshotProcesses() {
  try {
    if (process.platform === 'win32') {
      // WMIC 在新 Windows 11 上已默认移除。优先走 CIM，旧系统再回退 WMIC。
      const options = {
        encoding: 'utf8', timeout: 5000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
      };
      for (const powershell of ['powershell.exe', 'pwsh.exe']) {
        try {
          return execFileSync(powershell, [
            '-NoLogo',
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }'
          ], options);
        } catch (_error) {
          // Try the next collector.
        }
      }
      return execFileSync('wmic.exe', ['process', 'get', 'commandline'], options);
    }
    // macOS / Linux：-ww 防止命令行被截断
    return execFileSync('ps', ['-axww', '-o', 'args='], {
      encoding: 'utf8', timeout: 4000, maxBuffer: 16 * 1024 * 1024
    });
  } catch (_error) {
    return null;
  }
}

// Structured process records are used only for exact Profile lifecycle
// ownership. Collection failure is represented as null so callers fail closed
// instead of killing an unverified PID.
function snapshotProcessRecords() {
  try {
    if (process.platform === 'win32') {
      const options = {
        encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, windowsHide: true
      };
      const script = [
        'Get-CimInstance Win32_Process',
        '| Select-Object ProcessId,ParentProcessId,CommandLine',
        '| ConvertTo-Json -Compress'
      ].join(' ');
      for (const powershell of ['powershell.exe', 'pwsh.exe']) {
        try {
          const text = execFileSync(powershell, [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script
          ], options).trim();
          if (!text) return [];
          const parsed = JSON.parse(text);
          return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
            pid: Number(item.ProcessId),
            ppid: Number(item.ParentProcessId),
            pgid: null,
            command: String(item.CommandLine || '')
          })).filter((item) => Number.isInteger(item.pid) && item.pid > 0);
        } catch (_error) {
          // Try the next PowerShell host.
        }
      }
      return null;
    }

    const text = execFileSync('ps', ['-axww', '-o', 'pid=,ppid=,pgid=,command='], {
      encoding: 'utf8', timeout: 4000, maxBuffer: 24 * 1024 * 1024
    });
    return text.split(/\r?\n/).map((line) => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        pgid: Number(match[3]),
        command: match[4]
      };
    }).filter(Boolean);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  isDefaultWindowsAppRunning,
  isRunningIn,
  snapshotProcesses,
  snapshotProcessRecords,
  findProfileProcesses,
  findProfileClientProcesses,
  matchesCrashpadDatabase
};
