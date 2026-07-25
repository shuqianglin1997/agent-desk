/*
 * AgentDesk — session handoff artifact index.
 *
 * The renderer only sends profile/session ids. The main process re-scans the
 * stored profile, then this module reads the trusted session record and finds:
 *   1. plans explicitly referenced by the session transcript;
 *   2. the latest in-session plan snapshot (Claude ExitPlanMode / Codex update_plan);
 *   3. planning documents in the project or client plan directory whose mtime
 *      overlaps the session (reported as opt-in candidates).
 *
 * Only allow-listed text planning documents are read. Symlinks, binary files,
 * broad home-directory scans and arbitrary renderer-provided paths are rejected.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const MAX_TRANSCRIPT_BYTES = 96 * 1024 * 1024;
const MAX_JSON_TRANSCRIPT_BYTES = 24 * 1024 * 1024;
const MAX_ARTIFACT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_CONTENT_BYTES = 64 * 1024;
const MAX_SESSION_CONTENT_BYTES = 192 * 1024;
const MAX_ARTIFACTS = 12;
const MAX_SCAN_ENTRIES = 4_000;
const MAX_DISCOVERED_CANDIDATES = 160;
const SESSION_START_GRACE_MS = 15 * 60 * 1000;
const SESSION_END_GRACE_MS = 60 * 60 * 1000;
const FALLBACK_WINDOW_MS = 12 * 60 * 60 * 1000;

const TEXT_EXTENSIONS = new Set(['.md', '.mdx', '.txt', '.rst', '.adoc']);
const PLAN_DIRECTORY_NAMES = new Set(['plan', 'plans', 'planning', 'roadmap', 'roadmaps']);
const PROJECT_PLAN_DIRS = [
  ['plans'],
  ['planning'],
  ['roadmaps'],
  ['.claude', 'plans'],
  ['.codex', 'plans'],
  ['.agents', 'plans'],
  ['docs', 'plans'],
  ['docs', 'planning'],
  ['docs', 'roadmaps']
];
const PROJECT_INDEX_DIRS = [['docs']];
const PLAN_NAME_PATTERN = /(^|[-_.])(plan|planning|roadmap|todo|todos|task|tasks|handoff|implementation)([-_.]|$)/i;

async function indexSessionArtifacts(profile, session) {
  const scannedAt = new Date().toISOString();
  if (!profile || !session) return emptyResult(scannedAt);

  const allowedRoots = allowedArtifactRoots(profile, session);
  const transcript = await inspectSessionTranscript(profile, session);
  const descriptors = new Map();

  for (const plan of transcript.virtualPlans) {
    const explicitPath = normalizeReferencedPath(plan.filePath, session.projectPath);
    if (explicitPath && pathAllowed(explicitPath, allowedRoots) && isPlanningPath(explicitPath, true)) {
      mergeDescriptor(descriptors, {
        key: pathKey(explicitPath),
        filePath: explicitPath,
        fallbackContent: plan.content,
        title: path.basename(explicitPath),
        kind: planningKind(explicitPath),
        source: 'client-plan',
        confidence: 'exact',
        reason: 'session-plan',
        selectedByDefault: true,
        eventTimestamp: plan.timestamp
      });
    } else if (plan.content) {
      mergeDescriptor(descriptors, {
        key: `virtual:${plan.id}`,
        filePath: null,
        fallbackContent: plan.content,
        title: plan.title,
        kind: 'plan',
        source: 'session-plan',
        confidence: 'exact',
        reason: 'session-plan',
        selectedByDefault: true,
        eventTimestamp: plan.timestamp
      });
    }
  }

  for (const referencedPath of transcript.referencedPaths) {
    const resolved = normalizeReferencedPath(referencedPath, session.projectPath);
    if (!resolved || !pathAllowed(resolved, allowedRoots) || !isPlanningPath(resolved, true)) continue;
    mergeDescriptor(descriptors, {
      key: pathKey(resolved),
      filePath: resolved,
      fallbackContent: null,
      title: path.basename(resolved),
      kind: planningKind(resolved),
      source: clientPlanPath(resolved, profile) ? 'client-plan' : 'project-file',
      confidence: 'exact',
      reason: 'transcript-reference',
      selectedByDefault: true,
      eventTimestamp: null
    });
  }

  const temporalCandidates = discoverTemporalCandidates(profile, session, allowedRoots);
  for (const candidate of temporalCandidates) {
    mergeDescriptor(descriptors, {
      key: pathKey(candidate.filePath),
      filePath: candidate.filePath,
      fallbackContent: null,
      title: path.basename(candidate.filePath),
      kind: planningKind(candidate.filePath),
      source: candidate.source,
      confidence: 'related',
      reason: 'activity-window',
      selectedByDefault: false,
      eventTimestamp: null
    });
  }

  const ordered = [...descriptors.values()]
    .sort(compareDescriptors)
    .slice(0, MAX_ARTIFACTS);
  const items = [];
  let remainingBytes = MAX_SESSION_CONTENT_BYTES;

  for (const descriptor of ordered) {
    const artifact = materializeArtifact(descriptor, allowedRoots, remainingBytes);
    if (!artifact) continue;
    items.push(artifact);
    remainingBytes = Math.max(0, remainingBytes - Buffer.byteLength(artifact.content || '', 'utf8'));
  }

  return {
    scannedAt,
    items,
    total: items.length,
    defaultSelected: items.filter((item) => item.selectedByDefault).length,
    truncated: descriptors.size > ordered.length || transcript.truncated,
    limits: {
      maxArtifacts: MAX_ARTIFACTS,
      maxFileBytes: MAX_ARTIFACT_FILE_BYTES,
      maxContentBytes: MAX_ARTIFACT_CONTENT_BYTES,
      maxSessionContentBytes: MAX_SESSION_CONTENT_BYTES
    }
  };
}

function emptyResult(scannedAt = new Date().toISOString()) {
  return {
    scannedAt,
    items: [],
    total: 0,
    defaultSelected: 0,
    truncated: false,
    limits: {
      maxArtifacts: MAX_ARTIFACTS,
      maxFileBytes: MAX_ARTIFACT_FILE_BYTES,
      maxContentBytes: MAX_ARTIFACT_CONTENT_BYTES,
      maxSessionContentBytes: MAX_SESSION_CONTENT_BYTES
    }
  };
}

async function inspectSessionTranscript(profile, session) {
  const result = {
    virtualPlans: [],
    referencedPaths: new Set(),
    truncated: false
  };
  const transcriptPath = trustedTranscriptPath(profile, session);
  if (!transcriptPath) return result;

  const stat = safeLstat(transcriptPath);
  if (!stat?.isFile() || stat.isSymbolicLink()) return result;
  if (path.extname(transcriptPath).toLowerCase() === '.jsonl') {
    await inspectJsonLines(transcriptPath, result);
    return {
      ...result,
      referencedPaths: [...result.referencedPaths]
    };
  }
  if (path.extname(transcriptPath).toLowerCase() !== '.json' || stat.size > MAX_JSON_TRANSCRIPT_BYTES) {
    return result;
  }

  try {
    inspectEvent(JSON.parse(fs.readFileSync(transcriptPath, 'utf8')), result, 0);
  } catch (_error) {
    // A partially-written desktop session should not make handoff copying fail.
  }
  return {
    ...result,
    referencedPaths: [...result.referencedPaths]
  };
}

async function inspectJsonLines(filePath, result) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let consumed = 0;

  try {
    for await (const line of lines) {
      consumed += Buffer.byteLength(line, 'utf8') + 1;
      if (consumed > MAX_TRANSCRIPT_BYTES) {
        result.truncated = true;
        break;
      }
      if (!line.trim()) continue;
      try {
        inspectEvent(JSON.parse(line), result, 0);
      } catch (_error) {
        // Ignore incomplete lines from a session that is still being written.
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

function inspectEvent(event, result, depth) {
  if (!event || typeof event !== 'object' || depth > 12) return;

  const messageContent = event.message?.content;
  if (Array.isArray(messageContent)) {
    for (const part of messageContent) {
      if (!part || part.type !== 'tool_use') continue;
      if (String(part.name || '').toLowerCase() === 'exitplanmode') {
        const plan = part.input?.plan;
        const filePath = part.input?.planFilePath || part.input?.plan_file_path || null;
        if (typeof plan === 'string' && plan.trim()) {
          upsertVirtualPlan(result.virtualPlans, {
            id: filePath ? hashId(`claude:${filePath}`) : 'claude-session-plan',
            title: filePath ? path.basename(filePath) : 'Claude session plan',
            filePath,
            content: capText(plan),
            timestamp: event.timestamp || null
          });
        }
      }
      collectReferencedPlanningPaths(part.input, result.referencedPaths);
    }
  }

  const payload = event.payload && typeof event.payload === 'object' ? event.payload : null;
  const functionCall = payload?.type === 'function_call' || payload?.type === 'custom_tool_call'
    ? payload
    : (event.type === 'function_call' ? event : null);
  const functionName = String(functionCall?.name || functionCall?.tool_name || '').toLowerCase();
  if (functionCall && (functionName === 'update_plan' || functionName.endsWith('.update_plan'))) {
    const args = parseArguments(functionCall.arguments ?? functionCall.input);
    const content = formatCodexPlan(args);
    if (content) {
      upsertVirtualPlan(result.virtualPlans, {
        id: 'codex-session-plan',
        title: 'Codex session plan',
        filePath: null,
        content,
        timestamp: event.timestamp || null
      });
    }
  }

  collectReferencedPlanningPaths(event, result.referencedPaths);
}

function collectReferencedPlanningPaths(value, output, depth = 0) {
  if (!value || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectReferencedPlanningPaths(item, output, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') {
      const normalized = item.trim().replace(/^['"]|['"]$/g, '');
      const explicitPlanKey = /^(planFilePath|plan_file_path)$/i.test(key);
      if (
        normalized.length <= 2_048 &&
        (explicitPlanKey || looksLikeStandalonePath(normalized)) &&
        isPlanningPath(normalized, explicitPlanKey)
      ) {
        output.add(normalized);
      }
    } else if (item && typeof item === 'object') {
      collectReferencedPlanningPaths(item, output, depth + 1);
    }
  }
}

function looksLikeStandalonePath(value) {
  if (!value || /[\r\n]/.test(value)) return false;
  return path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('~/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    /[\\/]/.test(value);
}

function parseArguments(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function formatCodexPlan(input) {
  if (!input || !Array.isArray(input.plan) || !input.plan.length) return '';
  const lines = ['# Session execution plan'];
  if (typeof input.explanation === 'string' && input.explanation.trim()) {
    lines.push('', input.explanation.trim());
  }
  lines.push('');
  let stepCount = 0;
  for (const item of input.plan) {
    if (!item || typeof item.step !== 'string' || !item.step.trim()) continue;
    const marker = item.status === 'completed' ? 'x' : item.status === 'in_progress' ? '>' : ' ';
    lines.push(`- [${marker}] ${item.step.trim()}`);
    stepCount += 1;
  }
  return stepCount ? capText(lines.join('\n')) : '';
}

function upsertVirtualPlan(plans, next) {
  const index = plans.findIndex((item) => item.id === next.id);
  if (index >= 0) plans[index] = next;
  else plans.push(next);
}

function discoverTemporalCandidates(profile, session, allowedRoots) {
  const output = [];
  const seen = new Set();
  const projectRoot = trustedDirectory(session.projectPath);
  const roots = [];

  if (projectRoot) {
    roots.push({ dir: projectRoot, maxDepth: 0, source: 'project-file', inPlanDirectory: false });
    for (const parts of PROJECT_PLAN_DIRS) {
      roots.push({
        dir: path.join(projectRoot, ...parts),
        maxDepth: 2,
        source: 'project-file',
        inPlanDirectory: true
      });
    }
    for (const parts of PROJECT_INDEX_DIRS) {
      roots.push({
        dir: path.join(projectRoot, ...parts),
        maxDepth: 0,
        source: 'project-file',
        inPlanDirectory: false
      });
    }
    for (const configured of configuredPlanDirectories(profile, projectRoot)) {
      roots.push({
        dir: configured,
        maxDepth: 2,
        source: 'project-file',
        inPlanDirectory: true
      });
    }
  }

  if (profile.appId === 'claude-cli' && profile.sessionRoot) {
    roots.push({
      dir: path.join(profile.sessionRoot, 'plans'),
      maxDepth: 0,
      source: 'client-plan',
      inPlanDirectory: true
    });
  }

  let scanned = 0;
  for (const root of roots) {
    if (output.length >= MAX_DISCOVERED_CANDIDATES || scanned >= MAX_SCAN_ENTRIES) break;
    const rootPath = trustedDirectory(root.dir);
    if (!rootPath || !pathAllowed(rootPath, allowedRoots)) continue;
    const pending = [{ dir: rootPath, depth: 0 }];

    while (pending.length && output.length < MAX_DISCOVERED_CANDIDATES && scanned < MAX_SCAN_ENTRIES) {
      const current = pending.pop();
      let entries;
      try {
        entries = fs.readdirSync(current.dir, { withFileTypes: true });
      } catch (_error) {
        continue;
      }
      for (const entry of entries) {
        scanned += 1;
        const itemPath = path.join(current.dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && current.depth < root.maxDepth) {
          pending.push({ dir: itemPath, depth: current.depth + 1 });
          continue;
        }
        if (!entry.isFile() || !isPlanningPath(itemPath, root.inPlanDirectory)) continue;
        const real = trustedFile(itemPath, allowedRoots);
        if (!real || seen.has(real) || !withinSessionWindow(real, session)) continue;
        seen.add(real);
        output.push({ filePath: real, source: root.source });
      }
    }
  }
  return output;
}

function configuredPlanDirectories(profile, projectRoot) {
  if (profile.appId !== 'claude-cli') return [];
  const settingsFiles = [
    path.join(profile.sessionRoot || '', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.json'),
    path.join(projectRoot, '.claude', 'settings.local.json')
  ];
  const output = [];
  for (const filePath of settingsFiles) {
    let json;
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > 512 * 1024) continue;
      json = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_error) {
      continue;
    }
    const configured = typeof json?.plansDirectory === 'string' ? json.plansDirectory.trim() : '';
    if (!configured) continue;
    const resolved = path.isAbsolute(configured)
      ? path.resolve(configured)
      : path.resolve(projectRoot, configured);
    if (isSubpath(resolved, projectRoot)) output.push(resolved);
  }
  return output;
}

function withinSessionWindow(filePath, session) {
  const stat = safeLstat(filePath);
  if (!stat?.isFile()) return false;
  const created = Date.parse(session.createdAt || '');
  const updated = Date.parse(session.updatedAt || '');
  const start = Number.isFinite(created)
    ? created - SESSION_START_GRACE_MS
    : (Number.isFinite(updated) ? updated - FALLBACK_WINDOW_MS : Number.NEGATIVE_INFINITY);
  const end = Number.isFinite(updated)
    ? updated + SESSION_END_GRACE_MS
    : (Number.isFinite(created) ? created + FALLBACK_WINDOW_MS : Number.POSITIVE_INFINITY);
  return stat.mtimeMs >= start && stat.mtimeMs <= end;
}

function materializeArtifact(descriptor, allowedRoots, remainingBytes) {
  let content = '';
  let filePath = null;
  let size = 0;
  let updatedAt = descriptor.eventTimestamp || null;
  let truncated = false;

  if (descriptor.filePath) {
    const real = trustedFile(descriptor.filePath, allowedRoots);
    const stat = real ? safeLstat(real) : null;
    if (real && stat?.isFile() && stat.size <= MAX_ARTIFACT_FILE_BYTES) {
      const read = readTextPrefix(real, Math.min(MAX_ARTIFACT_CONTENT_BYTES, remainingBytes));
      if (read) {
        filePath = real;
        content = read.content;
        size = stat.size;
        updatedAt = stat.mtime.toISOString();
        truncated = read.truncated;
      }
    }
  }

  if (!content && descriptor.fallbackContent) {
    const read = capTextByBytes(descriptor.fallbackContent, Math.min(MAX_ARTIFACT_CONTENT_BYTES, remainingBytes));
    content = read.content;
    size = Buffer.byteLength(String(descriptor.fallbackContent), 'utf8');
    truncated = read.truncated;
  }
  if (!content) return null;

  const title = descriptor.title || (filePath ? path.basename(filePath) : 'Session plan');
  return {
    id: hashId(`${descriptor.key}:${content}`),
    title,
    kind: descriptor.kind,
    source: descriptor.source,
    confidence: descriptor.confidence,
    reason: descriptor.reason,
    selectedByDefault: descriptor.selectedByDefault,
    path: filePath,
    relativePath: displayArtifactPath(filePath, allowedRoots),
    size,
    updatedAt,
    content,
    truncated
  };
}

function readTextPrefix(filePath, maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return null;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const length = Math.min(stat.size, maxBytes);
    const buffer = Buffer.alloc(length);
    const bytes = length ? fs.readSync(fd, buffer, 0, length, 0) : 0;
    const slice = buffer.subarray(0, bytes);
    if (slice.includes(0)) return null;
    return {
      content: slice.toString('utf8').replace(/\uFFFD+$/g, '').trim(),
      truncated: stat.size > bytes
    };
  } catch (_error) {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_error) { /* already closed */ }
    }
  }
}

function capText(value) {
  return capTextByBytes(value, MAX_ARTIFACT_CONTENT_BYTES).content;
}

function capTextByBytes(value, maxBytes) {
  const source = String(value || '').trim();
  const buffer = Buffer.from(source, 'utf8');
  if (buffer.length <= maxBytes) return { content: source, truncated: false };
  return {
    content: buffer.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/g, '').trimEnd(),
    truncated: true
  };
}

function allowedArtifactRoots(profile, session) {
  const roots = [];
  const projectRoot = trustedDirectory(session.projectPath);
  const sessionRoot = trustedDirectory(profile.sessionRoot);
  if (projectRoot) roots.push({ path: projectRoot, label: 'project' });
  if (sessionRoot) roots.push({ path: sessionRoot, label: 'session-root' });
  return roots;
}

function trustedTranscriptPath(profile, session) {
  if (!session.filePath || !profile.sessionRoot) return null;
  const root = trustedDirectory(profile.sessionRoot);
  if (!root) return null;
  return trustedFile(session.filePath, [{ path: root, label: 'session-root' }]);
}

function trustedDirectory(value) {
  if (!value || typeof value !== 'string') return null;
  const resolved = expandHomePath(value);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const real = fs.realpathSync(resolved);
    const parsed = path.parse(real);
    if (real === parsed.root || pathsEqual(real, os.homedir())) return null;
    return real;
  } catch (_error) {
    return null;
  }
}

function trustedFile(value, allowedRoots) {
  if (!value || typeof value !== 'string') return null;
  const resolved = expandHomePath(value);
  if (!pathAllowed(resolved, allowedRoots)) return null;
  try {
    const stat = fs.lstatSync(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const real = fs.realpathSync(resolved);
    return pathAllowed(real, allowedRoots) ? real : null;
  } catch (_error) {
    return null;
  }
}

function pathAllowed(value, roots) {
  if (!value || !Array.isArray(roots)) return false;
  const resolved = canonicalPath(value);
  return roots.some((root) => isSubpath(resolved, canonicalPath(root.path)));
}

function normalizeReferencedPath(value, projectPath) {
  if (!value || typeof value !== 'string') return null;
  const clean = value.trim().replace(/^['"]|['"]$/g, '');
  if (!clean || /[\r\n]/.test(clean)) return null;
  if (clean === '~' || clean.startsWith('~/')) return expandHomePath(clean);
  if (path.isAbsolute(clean) || /^[A-Za-z]:[\\/]/.test(clean)) return path.resolve(clean);
  const projectRoot = trustedDirectory(projectPath);
  return projectRoot ? path.resolve(projectRoot, clean) : null;
}

function isPlanningPath(filePath, inPlanDirectory = false) {
  if (!filePath || typeof filePath !== 'string') return false;
  const extension = path.extname(filePath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return false;
  const basename = path.basename(filePath, extension);
  if (PLAN_NAME_PATTERN.test(basename)) return true;
  const parts = path.normalize(filePath).split(path.sep).map((part) => part.toLowerCase());
  return inPlanDirectory || parts.some((part) => PLAN_DIRECTORY_NAMES.has(part));
}

function planningKind(filePath) {
  const name = path.basename(filePath || '').toLowerCase();
  if (/handoff/.test(name)) return 'handoff';
  if (/roadmap/.test(name)) return 'roadmap';
  if (/(^|[-_.])(todo|todos|task|tasks)([-_.]|$)/.test(name)) return 'tasks';
  return 'plan';
}

function clientPlanPath(filePath, profile) {
  if (!filePath || !profile?.sessionRoot) return false;
  return isSubpath(filePath, path.join(expandHomePath(profile.sessionRoot), 'plans'));
}

function displayArtifactPath(filePath, roots) {
  if (!filePath) return null;
  const project = roots.find((root) => root.label === 'project' && isSubpath(filePath, root.path));
  if (project) {
    const relative = path.relative(project.path, filePath);
    return relative || path.basename(filePath);
  }
  const sessionRoot = roots.find((root) => root.label === 'session-root' && isSubpath(filePath, root.path));
  if (sessionRoot) {
    const relative = path.relative(sessionRoot.path, filePath);
    return relative || path.basename(filePath);
  }
  return path.basename(filePath);
}

function mergeDescriptor(map, next) {
  const current = map.get(next.key);
  if (!current) {
    map.set(next.key, next);
    return;
  }
  const nextExact = next.confidence === 'exact';
  const currentExact = current.confidence === 'exact';
  const reasonRank = { 'session-plan': 3, 'transcript-reference': 2, 'activity-window': 1 };
  const preferredReason = (reasonRank[next.reason] || 0) > (reasonRank[current.reason] || 0)
    ? next.reason
    : current.reason;
  map.set(next.key, {
    ...current,
    ...next,
    fallbackContent: next.fallbackContent || current.fallbackContent,
    confidence: nextExact || currentExact ? 'exact' : 'related',
    selectedByDefault: Boolean(next.selectedByDefault || current.selectedByDefault),
    reason: preferredReason
  });
}

function compareDescriptors(left, right) {
  const confidence = Number(right.confidence === 'exact') - Number(left.confidence === 'exact');
  if (confidence) return confidence;
  const selected = Number(right.selectedByDefault) - Number(left.selectedByDefault);
  if (selected) return selected;
  return String(right.eventTimestamp || '').localeCompare(String(left.eventTimestamp || '')) ||
    String(left.title || '').localeCompare(String(right.title || ''));
}

function pathKey(filePath) {
  const resolved = canonicalPath(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isSubpath(itemPath, parentPath) {
  if (!itemPath || !parentPath) return false;
  const item = path.resolve(itemPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, item);
  if (process.platform === 'win32') {
    return relative === '' || (!relative.startsWith('..') && !path.win32.isAbsolute(relative));
  }
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathsEqual(left, right) {
  if (!left || !right) return false;
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function expandHomePath(value) {
  const input = String(value || '').trim();
  if (input === '~') return os.homedir();
  if (input.startsWith('~/') || input.startsWith('~\\')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

// macOS exposes /var as a symlink to /private/var. Canonicalize the nearest
// existing ancestor as well as existing files so containment checks do not
// reject valid paths merely because one spelling crosses that system symlink.
function canonicalPath(value) {
  const resolved = expandHomePath(value);
  let current = resolved;
  const suffix = [];
  while (current && !fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current));
    current = parent;
  }
  try {
    return path.join(fs.realpathSync(current), ...suffix);
  } catch (_error) {
    return resolved;
  }
}

function safeLstat(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (_error) {
    return null;
  }
}

function hashId(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20);
}

module.exports = {
  indexSessionArtifacts,
  formatCodexPlan,
  isPlanningPath,
  withinSessionWindow,
  MAX_ARTIFACTS,
  MAX_ARTIFACT_CONTENT_BYTES,
  MAX_SESSION_CONTENT_BYTES
};
