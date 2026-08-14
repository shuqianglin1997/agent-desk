'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CURRENT_STATE_DOCS = [
  'README.md',
  'docs/README.md',
  'docs/PRODUCT.md',
  'docs/SCENARIOS.md',
  'docs/INTERNAL.md',
  'docs/FUNCTION_AUDIT.md',
  'docs/ROADMAP.md',
  'docs/WINDOWS.md',
  'docs/RELEASING.md'
];
const EVIDENCE_DOCS = [
  'README.md',
  'docs/README.md',
  'docs/PRODUCT.md',
  'docs/SCENARIOS.md',
  'docs/INTERNAL.md',
  'docs/FUNCTION_AUDIT.md',
  'docs/ROADMAP.md'
];

const errors = [];

function fail(file, message, lineNumber = null) {
  errors.push(`${file}${lineNumber ? `:${lineNumber}` : ''}: ${message}`);
}

function read(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(relativePath, 'required file is missing');
    return '';
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

function requireText(relativePath, text, reason) {
  const body = documents.get(relativePath) || '';
  if (!body.includes(text)) fail(relativePath, reason || `must contain ${JSON.stringify(text)}`);
}

function lineHasNegation(line) {
  return /(?:不|未|尚未|不得|不能|不会|阻止|只属于历史|legacy|待实现|not\s+(?:yet\s+)?(?:implemented|complete|stable)|must\s+not|does\s+not|is\s+not)/i.test(line);
}

function checkCurrentClaims(relativePath, body) {
  const lines = body.split(/\r?\n/);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (/(?:七行(?:骨架|信息轨|界面)|seven[- ]row (?:shell|layout|interface))/i.test(line)
      && !/(?:旧|历史|取消|替换|不得|不能|不再|只属于)/.test(line)) {
      fail(relativePath, 'describes the retired seven-row UI as current', lineNumber);
    }

    if (/(?:三项[^。；;.]{0,40}尚未实现|three items are not implemented yet|版本化首次使用[^。；;.]{0,50}尚未实现|设备任务向导[^。；;.]{0,50}尚未实现|same-Mesh TaskPackage[^。；;.]{0,50}not implemented yet)/i.test(line)) {
      fail(relativePath, 'retains the superseded pre-1.27 implementation status', lineNumber);
    }

    if (/0\.10\.0/i.test(line) && /(?:稳定|stable)/i.test(line) && !lineHasNegation(line)) {
      fail(relativePath, 'claims the 0.10.0 development baseline is stable', lineNumber);
    }

    if (/(?:默认|预置|内置)\s*(?:Cloud|Claude|Kimi)(?:\s*(?:Agent|账号|Profile))?/.test(line)
      && !/(?:legacy|当前.*仍会|不得|不能|不会|不生成|阻止|不按|不保留|不补|删除后|替换|探测|检测|不是)/i.test(line)) {
      fail(relativePath, 'treats a default Cloud/Claude/Kimi Agent as current product policy', lineNumber);
    }

    if (/(?:当前|legacy|全新存储)[^。；;.]{0,80}(?:仍会|仍然会|continues? to|still)[^。；;.]{0,30}(?:创建|生成|create|generate)[^。；;.]{0,50}(?:Claude|Codex|Kimi)/i.test(line)
      && !/(?:不再|不会|no longer|does not)/i.test(line)) {
      fail(relativePath, 'claims the retired default Profile bootstrap is still current', lineNumber);
    }
  });
}

function checkLocalLinks(relativePath, body) {
  const sourceDir = path.dirname(path.join(ROOT, relativePath));
  const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of body.matchAll(markdownLink)) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    if (!target || /^(?:https?:|mailto:|#)/i.test(target)) continue;
    target = target.split('#', 1)[0].split('?', 1)[0];
    try {
      target = decodeURIComponent(target);
    } catch (_error) {
      fail(relativePath, `contains an invalid encoded link target: ${match[1]}`);
      continue;
    }
    const resolved = path.resolve(sourceDir, target);
    if (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== ROOT) {
      fail(relativePath, `link escapes repository: ${match[1]}`);
      continue;
    }
    if (!fs.existsSync(resolved)) fail(relativePath, `broken local link: ${match[1]}`);
  }
}

const documents = new Map(CURRENT_STATE_DOCS.map((relativePath) => [relativePath, read(relativePath)]));

const plan = read('docs/PERSONAL_AGENT_MESH_PLAN.md');
if (!/^> 状态：OWNER APPROVED — IMPLEMENTATION AUTHORIZED$/m.test(plan)) {
  fail('docs/PERSONAL_AGENT_MESH_PLAN.md', 'implementation authority is not OWNER APPROVED');
}
const versionMatch = plan.match(/^> 版本：([^\s]+)$/m);
const authorityVersion = versionMatch?.[1] || null;
if (!authorityVersion) fail('docs/PERSONAL_AGENT_MESH_PLAN.md', 'authority version is missing');

let packageJson = null;
try {
  packageJson = JSON.parse(read('package.json'));
} catch (error) {
  fail('package.json', `cannot parse JSON: ${error.message}`);
}
if (packageJson) {
  if (packageJson.scripts?.['check:docs'] !== 'node scripts/check-docs.js') {
    fail('package.json', 'scripts.check:docs must run node scripts/check-docs.js');
  }
}

for (const relativePath of CURRENT_STATE_DOCS) {
  const body = documents.get(relativePath) || '';
  checkCurrentClaims(relativePath, body);
  checkLocalLinks(relativePath, body);
}

for (const relativePath of EVIDENCE_DOCS) {
  requireText(relativePath, '562,009', 'must preserve the scoped physical two-Mac inventory evidence');
  requireText(relativePath, 'Preview', 'must distinguish Preview from a stable release');
  requireText(relativePath, '490', 'must record the current full Node test total');
  requireText(relativePath, '21/21', 'must record the current real-window task-path result');
  requireText(relativePath, '25/25', 'must record the scoped TaskPackage security result');
  if (!/(?:NAT|coturn)/i.test(documents.get(relativePath) || '')) {
    fail(relativePath, 'must name the still-open real NAT/coturn gate');
  }
  if (!/Windows/i.test(documents.get(relativePath) || '')) {
    fail(relativePath, 'must name the still-open Windows physical/permission gate');
  }
}

if (authorityVersion) {
  requireText('docs/README.md', `${authorityVersion} / OWNER APPROVED — IMPLEMENTATION AUTHORIZED`, 'must point to the current implementation authority');
}
if (packageJson?.version) {
  requireText('docs/README.md', `当前 \`${packageJson.version}\``, 'must name the package version represented by the evidence ledger');
}
requireText('docs/README.md', 'task.package.transfer.v1', 'must record the approved direct TaskPackage feature separately from current code');
requireText('docs/README.md', '版本化首次使用', 'must record the implemented first-use path');
requireText('docs/README.md', '设备任务向导', 'must record the implemented device journey code path');
requireText('docs/README.md', '旧七行信息轨只属于历史记录', 'must preserve the fixed current window skeleton');
requireText('docs/README.md', 'v0.10.1-preview.1', 'must preserve the approved Preview release sequence');
requireText('docs/RELEASING.md', 'prerelease flag', 'must explain how the workflow classifies Preview tags');
requireText('docs/RELEASING.md', 'first Preview', 'must require verification of the first Preview classification');
requireText('docs/WINDOWS.md', '不会被客户端自动更新器当成最新版', 'must disclose Preview updater behavior');

const releaseWorkflow = read('.github/workflows/release.yml');
if (!releaseWorkflow.includes('name: Classify release channel')) {
  fail('.github/workflows/release.yml', 'must classify stable and prerelease tag channels');
}
if (!releaseWorkflow.includes('prerelease: ${{ steps.release_class.outputs.prerelease }}')) {
  fail('.github/workflows/release.yml', 'must pass the derived prerelease flag to GitHub Release');
}

if (errors.length) {
  console.error(`Documentation check failed with ${errors.length} error${errors.length === 1 ? '' : 's'}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed (${CURRENT_STATE_DOCS.length} current-state documents, authority ${authorityVersion}, package ${packageJson?.version || 'unknown'}).`);
}
