/*
 * AgentDesk — 官方 App 运行探测。
 *
 * 每个账号槽位启动官方 Claude / Codex / Cursor 时都带 `--user-data-dir=<profilePath>`。
 * 通过匹配正在运行进程的命令行，判断「这个账号的官方 App 此刻是否开着」（isRunningIn），
 * 并汇总它名下所有进程的 CPU 占用（cpuFor）——App 在生成/推理时进程会烧 CPU，空闲时
 * 趋近 0，这个信号跨 App 一致，比会话文件 mtime 更能反映「此刻是否真在干活」。
 *
 * 纯匹配函数可单测；snapshotProcesses 采集系统进程（含 %cpu 列），
 * 失败返回 null（表示探测不可用，上层退回 mtime 启发）。
 */

const { execSync } = require('node:child_process');

/*
 * haystack 里是否出现「归属于 profilePath 的」 `--user-data-dir=<profilePath>`。
 * haystack 既可以是整段 ps 文本（判 isRunningIn），也可以是单独一行（判 cpuFor 归属）。
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
  const needle = '--user-data-dir=' + profilePath;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    const after = haystack.charAt(idx + needle.length);
    if (after === '' || after === '\n' || after === '\r') return true;
    if (after === ' ' || after === '\t') {
      const rest = haystack.slice(idx + needle.length).replace(/^[ \t]+/, '');
      if (rest === '' || rest.charAt(0) === '-' || rest.charAt(0) === '\n' || rest.charAt(0) === '\r') return true;
    }
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return false;
}

// psText 里是否有进程以 `--user-data-dir=<profilePath>` 运行。
function isRunningIn(psText, profilePath) {
  if (!psText || !profilePath) return false;
  return matchesDataDir(psText, profilePath);
}

/*
 * 汇总归属于 profilePath 的全部进程的 %cpu（主进程 + 各 helper）。
 * 依赖 snapshotProcesses 的每行格式「<%cpu> <args…>」（见下）。
 * 返回：数字（可 >100，多核累加）；探测无 CPU 列时（Windows wmic）返回 null，
 * 交由上层退回 mtime 启发。App 没在跑则匹配不到、返回 0。
 */
function cpuFor(psText, profilePath) {
  if (!psText || !profilePath) return null;
  if (process.platform === 'win32') return null; // wmic 命令行快照不含 CPU 列
  let total = 0;
  for (const line of psText.split('\n')) {
    const m = line.match(/^\s*([\d.]+)\s+(.*)$/);
    if (!m) continue;
    if (matchesDataDir(m[2], profilePath)) total += parseFloat(m[1]) || 0;
  }
  return total;
}

// 采集进程快照。失败（无权限 / 超时 / 平台不支持）返回 null。
function snapshotProcesses() {
  try {
    if (process.platform === 'win32') {
      // Windows：wmic 输出各进程 CommandLine，同样含 --user-data-dir=（无 CPU 列）
      return execSync('wmic process get commandline', {
        encoding: 'utf8', timeout: 4000, maxBuffer: 8 * 1024 * 1024, windowsHide: true
      });
    }
    // macOS / Linux：每行「<%cpu> <完整命令行>」；-ww 防止命令行被截断。
    // %cpu 前缀不影响 isRunningIn（子串搜索），但让 cpuFor 能按行累加占用。
    return execSync('ps -axww -o %cpu=,args=', {
      encoding: 'utf8', timeout: 4000, maxBuffer: 16 * 1024 * 1024
    });
  } catch (_error) {
    return null;
  }
}

module.exports = { isRunningIn, cpuFor, snapshotProcesses };
