/*
 * AgentDesk — 官方 App 运行探测。
 *
 * 每个账号槽位启动官方 Claude / Codex 时都带 `--user-data-dir=<profilePath>`。
 * 通过匹配正在运行进程的命令行，判断「这个账号的官方 App 此刻是否开着」——
 * 这比会话文件 mtime 更接近真实运行状态。
 *
 * 纯匹配函数 isRunningIn 可单测；snapshotProcesses 采集系统进程命令行，
 * 失败返回 null（表示探测不可用，上层退回 mtime 启发）。
 */

const { execSync } = require('node:child_process');

/*
 * psText 里是否有进程以 `--user-data-dir=<profilePath>` 运行。
 *
 * 难点：profilePath 可能含空格（如「Application Support/Claude Profiles/lyh」），
 * 且短路径是长路径的前缀（…/Claude 是 …/Claude Profiles/lyh 的前缀）。
 * 因此必须确认匹配点后面是「参数分隔」（空白接 '-'，或行尾），而不是更长的路径。
 *
 * 注：这条规则把「路径后紧跟一个位置参数（如 deep-link URL）」也当成不匹配，
 * 属理论边界；但官方 App 是多进程 Electron，renderer/gpu 等 helper 进程的命令行
 * 都带规范的 `--user-data-dir=X --flag…` 形式，总能命中，故实际不受影响。
 */
function isRunningIn(psText, profilePath) {
  if (!psText || !profilePath) return false;
  const needle = '--user-data-dir=' + profilePath;
  let idx = psText.indexOf(needle);
  while (idx !== -1) {
    const after = psText.charAt(idx + needle.length);
    if (after === '' || after === '\n' || after === '\r') return true;
    if (after === ' ' || after === '\t') {
      const rest = psText.slice(idx + needle.length).replace(/^[ \t]+/, '');
      if (rest === '' || rest.charAt(0) === '-' || rest.charAt(0) === '\n' || rest.charAt(0) === '\r') return true;
    }
    idx = psText.indexOf(needle, idx + needle.length);
  }
  return false;
}

// 采集进程命令行快照。失败（无权限 / 超时 / 平台不支持）返回 null。
function snapshotProcesses() {
  try {
    if (process.platform === 'win32') {
      // Windows：wmic 输出各进程 CommandLine，同样含 --user-data-dir=
      return execSync('wmic process get commandline', {
        encoding: 'utf8', timeout: 4000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
      });
    }
    // macOS / Linux：-ww 防止命令行被截断
    return execSync('ps -axww -o args=', {
      encoding: 'utf8', timeout: 4000, maxBuffer: 16 * 1024 * 1024
    });
  } catch (_error) {
    return null;
  }
}

module.exports = { isRunningIn, snapshotProcesses };
