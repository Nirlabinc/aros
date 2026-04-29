#!/usr/bin/env node
/**
 * AROS Platform — Automated Benchmark & Scoring
 *
 * Usage:
 *   node scripts/aros-benchmark.mjs          # full colored terminal report
 *   node scripts/aros-benchmark.mjs --json   # JSON-only output
 *   node scripts/aros-benchmark.mjs --fix    # show recommendations for failed checks
 *
 * No external dependencies — uses Node 18+ built-ins only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── paths ────────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SHREAI = path.resolve(ROOT, '..');

// ── config ───────────────────────────────────────────────────────────────────
const PORT = 5457;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;

// ── CLI flags ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const fixMode = args.includes('--fix');

// ── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

// ── helpers ──────────────────────────────────────────────────────────────────
function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function countFiles(dir, ext) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile() && ext.some((x) => e.name.endsWith(x))).length;
  } catch {
    return 0;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function lineCount(filePath) {
  const content = readFile(filePath);
  return content ? content.split('\n').length : 0;
}

async function httpGet(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return { status: res.status, ok: res.ok };
  } catch {
    return { status: 0, ok: false };
  }
}

function check(name, score, max, detail, fix) {
  return {
    name,
    score: Math.max(0, Math.min(max, Math.round(score * 100) / 100)),
    max,
    detail,
    fix,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// 1. CORE ARCHITECTURE (12 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function coreArchitecture() {
  const checks = [];

  // 1a. Package structure (3pts)
  {
    let score = 0;
    const parts = [];
    const pkg = readFile(path.join(ROOT, 'package.json'));
    if (pkg) {
      score++;
      parts.push('package.json');
      const parsed = JSON.parse(pkg);
      const hasTurbo =
        fileExists(path.join(ROOT, 'turbo.json')) ||
        parsed.devDependencies?.turbo ||
        parsed.dependencies?.turbo;
      const hasPnpm = fileExists(path.join(ROOT, 'pnpm-workspace.yaml')) || parsed.workspaces;
      if (hasTurbo || hasPnpm) {
        score++;
        parts.push('workspace config');
      }
      const scripts = parsed.scripts || {};
      if (scripts.build || scripts.dev) {
        score++;
        parts.push('build/dev scripts');
      }
    }
    checks.push(
      check(
        'Package structure',
        score,
        3,
        parts.length > 0 ? parts.join(', ') : 'No package.json found',
        score < 3
          ? 'Ensure package.json has turbo/pnpm workspace config and build/dev scripts'
          : null,
      ),
    );
  }

  // 1b. Core wrapper (3pts)
  {
    let score = 0;
    const parts = [];
    if (dirExists(path.join(ROOT, 'packages', 'core'))) {
      score++;
      parts.push('packages/core/ exists');
      const corePkg = readFile(path.join(ROOT, 'packages', 'core', 'package.json'));
      if (corePkg) {
        score++;
        parts.push('package.json present');
        if (corePkg.includes('@mib007/core') || corePkg.includes('core')) {
          score++;
          parts.push('references core package');
        }
      }
    }
    checks.push(
      check(
        'Core wrapper',
        score,
        3,
        parts.length > 0 ? parts.join(', ') : 'packages/core/ not found',
        score < 3 ? 'Create packages/core/ with package.json referencing @mib007/core' : null,
      ),
    );
  }

  // 1c. POS SDK (3pts)
  {
    let score = 0;
    const parts = [];
    if (dirExists(path.join(ROOT, 'packages', 'pos-sdk'))) {
      score++;
      parts.push('packages/pos-sdk/ exists');
      const posPkg = readFile(path.join(ROOT, 'packages', 'pos-sdk', 'package.json'));
      if (posPkg) {
        score += 2;
        parts.push('package.json present');
      }
    }
    checks.push(
      check(
        'POS SDK',
        score,
        3,
        parts.length > 0 ? parts.join(', ') : 'packages/pos-sdk/ not found',
        score < 3 ? 'Create packages/pos-sdk/ with package.json' : null,
      ),
    );
  }

  // 1d. Server health (3pts)
  {
    let score = 0;
    let detail = 'src/server.ts not found';
    if (fileExists(path.join(ROOT, 'src', 'server.ts'))) {
      score += 2;
      detail = 'src/server.ts exists';
      // Check if server is actually running
      const res = await httpGet(HEALTH_URL);
      if (res.ok) {
        score++;
        detail += ', health endpoint responds';
      } else {
        detail += ', health endpoint not reachable';
      }
    }
    checks.push(
      check(
        'Server health',
        score,
        3,
        detail,
        score < 3 ? 'Ensure src/server.ts exists and server is running on port 5457' : null,
      ),
    );
  }

  return { name: 'Core Architecture', max: 12, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 2. AGENT SYSTEM (12 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function agentSystem() {
  const checks = [];

  // 2a. SOUL.md exists (2pts)
  {
    const soulPath = path.join(ROOT, 'aros-ai', 'SOUL.md');
    const soul = readFile(soulPath);
    const requiredSections = [
      '## Core Identity',
      '## Default Stance',
      '## Stable Values',
      '## Behavioral Boundaries',
      '## Recovery Pattern',
      '## Continuity',
    ];
    const missingSections = requiredSections.filter((section) => !soul.includes(section));
    const score = soul && missingSections.length === 0 ? 2 : soul ? 1 : 0;
    checks.push(
      check(
        'SOUL.md exists',
        score,
        2,
        score === 2
          ? `aros-ai/SOUL.md: compact kernel with ${requiredSections.length} required sections`
          : soul
            ? `SOUL.md missing sections: ${missingSections.join(', ')}`
            : 'aros-ai/SOUL.md not found',
        score < 2
          ? 'Align aros-ai/SOUL.md to the compact kernel sections used by the agent template'
          : null,
      ),
    );
  }

  // 2b. Agent source (2pts)
  {
    const agentPath = path.join(ROOT, 'aros-ai', 'agent.ts');
    const exists = fileExists(agentPath);
    checks.push(
      check(
        'Agent source',
        exists ? 2 : 0,
        2,
        exists ? 'aros-ai/agent.ts exists' : 'aros-ai/agent.ts not found',
        !exists ? 'Create aros-ai/agent.ts with agent implementation' : null,
      ),
    );
  }

  // 2c. Shre control (2pts)
  {
    const shreCtrl = path.join(ROOT, 'aros-ai', 'shre-control');
    const hasDir = dirExists(shreCtrl);
    const fileCount = hasDir ? listDir(shreCtrl).length : 0;
    const score = hasDir && fileCount > 0 ? 2 : hasDir ? 1 : 0;
    checks.push(
      check(
        'Shre control',
        score,
        2,
        hasDir
          ? `aros-ai/shre-control/ has ${fileCount} file(s)`
          : 'aros-ai/shre-control/ not found',
        score < 2 ? 'Create aros-ai/shre-control/ with control files' : null,
      ),
    );
  }

  // 2d. 6 core agents defined (3pts)
  {
    const agents = ['Ellie', 'Ana', 'Sammy', 'Victor', 'Larry', 'Rita'];
    const agentsDocs = readFile(path.join(ROOT, 'docs', 'AGENTS.md'));
    const soulContent = readFile(path.join(ROOT, 'aros-ai', 'SOUL.md'));
    const searchContent = agentsDocs + '\n' + soulContent;

    let found = 0;
    const foundNames = [];
    const missingNames = [];
    for (const agent of agents) {
      if (new RegExp(agent, 'i').test(searchContent)) {
        found++;
        foundNames.push(agent);
      } else {
        missingNames.push(agent);
      }
    }
    const score = found * 0.5;
    checks.push(
      check(
        '6 core agents defined',
        score,
        3,
        `${found}/6 agents found: ${foundNames.join(', ')}${missingNames.length > 0 ? ` — missing: ${missingNames.join(', ')}` : ''}`,
        score < 3 ? `Define missing agents in docs/AGENTS.md: ${missingNames.join(', ')}` : null,
      ),
    );
  }

  // 2e. Trust gate wired (3pts)
  {
    const routerIndex = readFile(path.join(SHREAI, 'shre-router', 'src', 'index.ts'));
    let score = 0;
    let detail = 'shre-router/src/index.ts not readable';
    if (routerIndex) {
      const arosIds = ['aros', 'aros-ai', 'aros-agent', 'aros-platform'];
      const found = arosIds.filter((id) => routerIndex.toLowerCase().includes(id));
      if (found.length > 0) {
        score = 3;
        detail = `AROS agent IDs in TRUSTED_AGENTS: ${found.join(', ')}`;
      } else {
        detail = 'No AROS agent IDs found in TRUSTED_AGENTS';
      }
    }
    checks.push(
      check(
        'Trust gate wired',
        score,
        3,
        detail,
        score < 3 ? 'Add AROS agent IDs to TRUSTED_AGENTS in shre-router/src/index.ts' : null,
      ),
    );
  }

  return { name: 'Agent System', max: 12, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 3. SKILLS ECOSYSTEM (10 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function skillsEcosystem() {
  const checks = [];

  // 3a. Skills directory (2pts)
  {
    const exists = dirExists(path.join(ROOT, 'skills'));
    checks.push(
      check(
        'Skills directory',
        exists ? 2 : 0,
        2,
        exists ? 'skills/ exists' : 'skills/ not found',
        !exists ? 'Create skills/ directory' : null,
      ),
    );
  }

  // 3b. Skills manifest (3pts)
  {
    const manifestPath = path.join(ROOT, 'skills', 'AROS-SKILLS.md');
    const content = readFile(manifestPath);
    if (!content) {
      checks.push(
        check(
          'Skills manifest',
          0,
          3,
          'skills/AROS-SKILLS.md not found',
          'Create skills/AROS-SKILLS.md with skill categories',
        ),
      );
    } else {
      // Count skill categories (### numbered headings preferred, fallback to ## headings)
      const h3Categories = (content.match(/^###\s+\d+\./gm) || []).length;
      const categories = h3Categories > 0 ? h3Categories : (content.match(/^##\s+/gm) || []).length;
      const score = categories >= 8 ? 3 : categories >= 5 ? 2 : categories >= 2 ? 1 : 0;
      checks.push(
        check(
          'Skills manifest',
          score,
          3,
          `${categories} skill categories in AROS-SKILLS.md`,
          score < 3
            ? `Add more skill categories (have ${categories}, need 8 for full score)`
            : null,
        ),
      );
    }
  }

  // 3c. Skill implementations (3pts)
  {
    const skillSrc = path.join(ROOT, 'skills', 'src');
    const fileCount = countFiles(skillSrc, ['.ts', '.mjs']);
    const score = fileCount >= 20 ? 3 : fileCount >= 10 ? 2 : fileCount >= 5 ? 1 : 0;
    checks.push(
      check(
        'Skill implementations',
        score,
        3,
        `${fileCount} .ts/.mjs files in skills/src/`,
        score < 3
          ? `Add more skill implementations (have ${fileCount}, need 20 for full score)`
          : null,
      ),
    );
  }

  // 3d. Skill documentation (2pts)
  {
    const manifestPath = path.join(ROOT, 'skills', 'AROS-SKILLS.md');
    const content = readFile(manifestPath);
    if (!content) {
      checks.push(
        check(
          'Skill documentation',
          0,
          2,
          'No AROS-SKILLS.md to check',
          'Create skills/AROS-SKILLS.md with category descriptions',
        ),
      );
    } else {
      const h3Cats = (content.match(/^###\s+\d+\./gm) || []).length;
      const categories = h3Cats > 0 ? h3Cats : (content.match(/^##\s+/gm) || []).length;
      // Check that each category has at least a paragraph of description
      const splitRe = h3Cats > 0 ? /^###\s+\d+\./m : /^##\s+/m;
      const sections = content.split(splitRe).slice(1);
      const documented = sections.filter((s) => s.trim().split('\n').length >= 3).length;
      const score = categories > 0 && documented >= categories * 0.8 ? 2 : documented > 0 ? 1 : 0;
      checks.push(
        check(
          'Skill documentation',
          score,
          2,
          `${documented}/${categories} skill categories have descriptions`,
          score < 2 ? 'Add descriptions to all skill categories in AROS-SKILLS.md' : null,
        ),
      );
    }
  }

  return { name: 'Skills Ecosystem', max: 10, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 4. DATA CONNECTORS (10 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function dataConnectors() {
  const checks = [];
  const connDir = path.join(ROOT, 'connectors');

  // 4a. Connector directory (2pts)
  {
    const exists = dirExists(connDir);
    checks.push(
      check(
        'Connector directory',
        exists ? 2 : 0,
        2,
        exists ? 'connectors/ exists' : 'connectors/ not found',
        !exists ? 'Create connectors/ directory' : null,
      ),
    );
  }

  // 4b. Azure DB connector (2pts)
  {
    const candidates = ['azure-db.ts', 'azure-db.mjs', 'azure.ts', 'azure/index.ts'];
    const found =
      candidates.find((f) => fileExists(path.join(connDir, f))) ||
      dirExists(path.join(connDir, 'aws-db')); // check alternative naming
    const azureFile = fileExists(path.join(connDir, 'azure-db.ts'));
    checks.push(
      check(
        'Azure DB connector',
        azureFile ? 2 : 0,
        2,
        azureFile ? 'connectors/azure-db.ts found' : 'No Azure DB connector found',
        !azureFile ? 'Create connectors/azure-db.ts' : null,
      ),
    );
  }

  // 4c. RapidRMS connector (2pts)
  {
    const rapidrms =
      fileExists(path.join(connDir, 'rapidrms-api.ts')) ||
      fileExists(path.join(connDir, 'rapidrms.ts')) ||
      dirExists(path.join(connDir, 'rapidrms'));
    checks.push(
      check(
        'RapidRMS connector',
        rapidrms ? 2 : 0,
        2,
        rapidrms ? 'RapidRMS connector found' : 'No RapidRMS connector found',
        !rapidrms ? 'Create connectors/rapidrms-api.ts or connectors/rapidrms/' : null,
      ),
    );
  }

  // 4d. Verifone connector (2pts)
  {
    const verifone =
      fileExists(path.join(connDir, 'verifone.ts')) ||
      fileExists(path.join(connDir, 'verifone-api.ts')) ||
      dirExists(path.join(connDir, 'verifone'));
    checks.push(
      check(
        'Verifone connector',
        verifone ? 2 : 0,
        2,
        verifone ? 'Verifone connector found' : 'No Verifone connector found',
        !verifone ? 'Create connectors/verifone/ or connectors/verifone.ts' : null,
      ),
    );
  }

  // 4e. StorePulse link (2pts)
  {
    const storepulse =
      fileExists(path.join(connDir, 'storepulse-link.ts')) ||
      fileExists(path.join(connDir, 'storepulse.ts')) ||
      fileExists(path.join(connDir, 'storepulse-bridge.ts'));
    checks.push(
      check(
        'StorePulse link',
        storepulse ? 2 : 0,
        2,
        storepulse ? 'StorePulse link found' : 'No StorePulse link/bridge found',
        !storepulse ? 'Create connectors/storepulse-link.ts' : null,
      ),
    );
  }

  return { name: 'Data Connectors', max: 10, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 5. MARKETPLACE & NODES (10 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function marketplaceNodes() {
  const checks = [];
  const mktDir = path.join(ROOT, 'marketplace');

  // 5a. Marketplace directory (2pts)
  {
    const exists = dirExists(mktDir);
    checks.push(
      check(
        'Marketplace directory',
        exists ? 2 : 0,
        2,
        exists ? 'marketplace/ exists' : 'marketplace/ not found',
        !exists ? 'Create marketplace/ directory' : null,
      ),
    );
  }

  // 5b. Registry (3pts)
  {
    const candidates = ['registry.ts', 'registry.mjs', 'index.ts'];
    const found = candidates.find((f) => fileExists(path.join(mktDir, f)));
    let score = 0;
    if (found) {
      const content = readFile(path.join(mktDir, found));
      score = content.length > 500 ? 3 : content.length > 100 ? 2 : 1;
    }
    checks.push(
      check(
        'Registry',
        score,
        3,
        found
          ? `marketplace/${found} found (${score === 3 ? 'comprehensive' : 'basic'})`
          : 'No registry file found',
        score < 3 ? 'Create marketplace/registry.ts with full registry implementation' : null,
      ),
    );
  }

  // 5c. Node types defined (3pts)
  {
    const nodesDir = path.join(mktDir, 'nodes');
    const registryContent =
      readFile(path.join(mktDir, 'registry.ts')) +
      readFile(path.join(mktDir, 'types.ts')) +
      readFile(path.join(mktDir, 'index.ts'));
    // Count node type definitions — look for type/interface/enum patterns or files in nodes/
    const nodeFiles = dirExists(nodesDir) ? listDir(nodesDir).length : 0;
    const typeMatches = (registryContent.match(/type\s*[:=]|nodeType|node_type|NodeType/gi) || [])
      .length;
    const nodeCount = Math.max(nodeFiles, typeMatches);
    const score = nodeCount >= 8 ? 3 : nodeCount >= 5 ? 2 : nodeCount >= 2 ? 1 : 0;
    checks.push(
      check(
        'Node types defined',
        score,
        3,
        `${nodeCount} node types found`,
        score < 3 ? `Define more node types (have ${nodeCount}, need 8 for full score)` : null,
      ),
    );
  }

  // 5d. Plugin dev docs (2pts)
  {
    const pluginDocs = path.join(ROOT, 'docs', 'plugin-development');
    const exists = dirExists(pluginDocs);
    const fileCount = exists ? listDir(pluginDocs).length : 0;
    const score = exists && fileCount > 0 ? 2 : 0;
    checks.push(
      check(
        'Plugin dev docs',
        score,
        2,
        exists
          ? `docs/plugin-development/ has ${fileCount} file(s)`
          : 'docs/plugin-development/ not found',
        score < 2 ? 'Create docs/plugin-development/ with plugin development guides' : null,
      ),
    );
  }

  return { name: 'Marketplace & Nodes', max: 10, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 6. LICENSING & SECURITY (10 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function licensingSecurity() {
  const checks = [];

  // 6a. License system (3pts)
  {
    const licDir = path.join(ROOT, 'licensing');
    const srcLicDir = path.join(ROOT, 'src', 'licensing');
    const checkDir = dirExists(licDir) ? licDir : dirExists(srcLicDir) ? srcLicDir : null;

    if (!checkDir) {
      checks.push(
        check(
          'License system',
          0,
          3,
          'No licensing/ directory found',
          'Create licensing/ or src/licensing/ with boot-guard, validator, keygen',
        ),
      );
    } else {
      const files = listDir(checkDir);
      const allContent = files.map((f) => readFile(path.join(checkDir, f))).join('\n');
      const hasBootGuard =
        files.some((f) => /boot.?guard/i.test(f)) ||
        allContent.includes('bootGuard') ||
        allContent.includes('boot-guard');
      const hasValidator = files.some((f) => /validat/i.test(f)) || allContent.includes('validate');
      const hasKeygen =
        files.some((f) => /keygen/i.test(f)) ||
        allContent.includes('generateKey') ||
        allContent.includes('keygen');
      const score = (hasBootGuard ? 1 : 0) + (hasValidator ? 1 : 0) + (hasKeygen ? 1 : 0);
      const parts = [];
      if (hasBootGuard) parts.push('boot-guard');
      if (hasValidator) parts.push('validator');
      if (hasKeygen) parts.push('keygen');
      checks.push(
        check(
          'License system',
          score,
          3,
          `${parts.join(', ')} found in licensing/`,
          score < 3
            ? `Add missing: ${[!hasBootGuard && 'boot-guard', !hasValidator && 'validator', !hasKeygen && 'keygen'].filter(Boolean).join(', ')}`
            : null,
        ),
      );
    }
  }

  // 6b. ECDSA keys (2pts)
  {
    const licDir = dirExists(path.join(ROOT, 'licensing'))
      ? path.join(ROOT, 'licensing')
      : dirExists(path.join(ROOT, 'src', 'licensing'))
        ? path.join(ROOT, 'src', 'licensing')
        : null;
    let found = false;
    if (licDir) {
      const files = listDir(licDir);
      for (const f of files) {
        const content = readFile(path.join(licDir, f));
        if (/P-256|ECDSA|secp256|ecdsa|EC\s*key|sign.*verify/i.test(content)) {
          found = true;
          break;
        }
      }
    }
    checks.push(
      check(
        'ECDSA keys',
        found ? 2 : 0,
        2,
        found
          ? 'P-256/ECDSA references found in licensing code'
          : 'No ECDSA/P-256 references found',
        !found ? 'Implement ECDSA P-256 key signing in licensing/' : null,
      ),
    );
  }

  // 6c. Encryption (2pts)
  {
    const searchDirs = [
      path.join(ROOT, 'security'),
      path.join(ROOT, 'connectors'),
      path.join(ROOT, 'src'),
      path.join(ROOT, 'licensing'),
    ];
    let found = false;
    for (const dir of searchDirs) {
      if (!dirExists(dir)) continue;
      const files = listDir(dir).filter(
        (f) => f.endsWith('.ts') || f.endsWith('.mjs') || f.endsWith('.js'),
      );
      for (const f of files) {
        const content = readFile(path.join(dir, f));
        if (
          /AES-256-GCM|aes-256-gcm|createCipheriv|createDecipheriv|encrypt.*decrypt/i.test(content)
        ) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    checks.push(
      check(
        'Encryption',
        found ? 2 : 0,
        2,
        found ? 'AES-256-GCM or encryption references found' : 'No encryption references found',
        !found ? 'Add AES-256-GCM encryption in security/ or connectors/' : null,
      ),
    );
  }

  // 6d. Security docs (3pts)
  {
    const secDir = path.join(ROOT, 'security');
    const exists = dirExists(secDir);
    const fileCount = exists ? listDir(secDir).filter((f) => !f.startsWith('.')).length : 0;
    const hasReadme =
      exists &&
      (fileExists(path.join(secDir, 'README.md')) || fileExists(path.join(secDir, 'SECURITY.md')));
    const score = !exists ? 0 : fileCount >= 3 && hasReadme ? 3 : fileCount >= 2 ? 2 : 1;
    checks.push(
      check(
        'Security docs',
        score,
        3,
        exists
          ? `security/ has ${fileCount} file(s)${hasReadme ? ' with docs' : ''}`
          : 'security/ not found',
        score < 3 ? 'Create security/ with architecture docs and README.md' : null,
      ),
    );
  }

  return { name: 'Licensing & Security', max: 10, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 7. BILLING & SIGNUP (8 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function billingSignup() {
  const checks = [];

  // 7a. Billing module (2pts)
  {
    const billingDir = path.join(ROOT, 'src', 'billing');
    const exists = dirExists(billingDir);
    checks.push(
      check(
        'Billing module',
        exists ? 2 : 0,
        2,
        exists ? 'src/billing/ exists' : 'src/billing/ not found',
        !exists ? 'Create src/billing/ with billing implementation' : null,
      ),
    );
  }

  // 7b. Stripe integration (2pts)
  {
    const searchDirs = [path.join(ROOT, 'src', 'billing'), path.join(ROOT, 'src')];
    let found = false;
    for (const dir of searchDirs) {
      if (!dirExists(dir)) continue;
      const files = listDir(dir).filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'));
      for (const f of files) {
        const content = readFile(path.join(dir, f));
        if (/stripe|Stripe|STRIPE_SECRET|payment_intent|checkout\.sessions/i.test(content)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    checks.push(
      check(
        'Stripe integration',
        found ? 2 : 0,
        2,
        found ? 'Stripe references found' : 'No Stripe references found',
        !found ? 'Add Stripe integration in src/billing/' : null,
      ),
    );
  }

  // 7c. Signup flow (2pts)
  {
    const serverTs = readFile(path.join(ROOT, 'src', 'server.ts'));
    const hasSignup = /\/api\/signup|\/signup|signup.*route|signupHandler/i.test(serverTs);
    // Also check routes directory
    let routeSignup = false;
    const routesDir = path.join(ROOT, 'src', 'routes');
    if (dirExists(routesDir)) {
      for (const f of listDir(routesDir)) {
        const content = readFile(path.join(routesDir, f));
        if (/signup|register|onboard/i.test(content)) {
          routeSignup = true;
          break;
        }
      }
    }
    const found = hasSignup || routeSignup;
    checks.push(
      check(
        'Signup flow',
        found ? 2 : 0,
        2,
        found ? 'Signup endpoint found' : 'No /api/signup endpoint found',
        !found ? 'Add /api/signup endpoint in src/server.ts or routes' : null,
      ),
    );
  }

  // 7d. Pricing tiers (2pts)
  {
    const tiers = ['free', 'starter', 'pro', 'enterprise'];
    // Search across likely files
    const searchFiles = [
      path.join(ROOT, 'src', 'billing', 'pricing.ts'),
      path.join(ROOT, 'src', 'billing', 'tiers.ts'),
      path.join(ROOT, 'src', 'billing', 'index.ts'),
      path.join(ROOT, 'marketplace', 'registry.ts'),
      path.join(ROOT, 'marketplace', 'types.ts'),
      path.join(ROOT, 'src', 'server.ts'),
      path.join(ROOT, 'aros.config.json'),
    ];
    let allContent = '';
    for (const f of searchFiles) {
      allContent += readFile(f) + '\n';
    }
    const found = tiers.filter((t) => new RegExp(t, 'i').test(allContent));
    const score = found.length >= 4 ? 2 : found.length >= 2 ? 1 : 0;
    checks.push(
      check(
        'Pricing tiers',
        score,
        2,
        `${found.length}/4 tiers found: ${found.join(', ')}${found.length < 4 ? ` — missing: ${tiers.filter((t) => !found.includes(t)).join(', ')}` : ''}`,
        score < 2 ? 'Define all 4 pricing tiers (free, starter, pro, enterprise)' : null,
      ),
    );
  }

  return { name: 'Billing & Signup', max: 8, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 8. DEPLOYMENT & CONFIGURATION (8 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function deploymentConfig() {
  const checks = [];

  // 8a. Docker config (2pts)
  {
    const dockerCompose =
      fileExists(path.join(ROOT, 'deploy', 'docker-compose.yml')) ||
      fileExists(path.join(ROOT, 'docker-compose.yml'));
    checks.push(
      check(
        'Docker config',
        dockerCompose ? 2 : 0,
        2,
        dockerCompose ? 'docker-compose.yml found' : 'No docker-compose.yml found',
        !dockerCompose ? 'Create deploy/docker-compose.yml' : null,
      ),
    );
  }

  // 8b. K8s manifests (2pts)
  {
    const k8sDir = path.join(ROOT, 'deploy', 'k8s');
    const exists = dirExists(k8sDir);
    const fileCount = exists ? listDir(k8sDir).length : 0;
    const score = exists && fileCount > 0 ? 2 : 0;
    checks.push(
      check(
        'K8s manifests',
        score,
        2,
        exists ? `deploy/k8s/ has ${fileCount} file(s)` : 'deploy/k8s/ not found',
        score < 2 ? 'Create deploy/k8s/ with Kubernetes manifests' : null,
      ),
    );
  }

  // 8c. Whitelabel system (2pts)
  {
    const wlDir = path.join(ROOT, 'whitelabel');
    const exists = dirExists(wlDir);
    const fileCount = exists ? listDir(wlDir).filter((f) => !f.startsWith('.')).length : 0;
    const score = exists && fileCount > 0 ? 2 : 0;
    checks.push(
      check(
        'Whitelabel system',
        score,
        2,
        exists ? `whitelabel/ has ${fileCount} config file(s)` : 'whitelabel/ not found',
        score < 2 ? 'Create whitelabel/ with configuration files' : null,
      ),
    );
  }

  // 8d. AROS config (2pts)
  {
    const configFile = fileExists(path.join(ROOT, 'aros.config.json'));
    checks.push(
      check(
        'AROS config',
        configFile ? 2 : 0,
        2,
        configFile ? 'aros.config.json exists' : 'aros.config.json not found',
        !configFile ? 'Create aros.config.json with platform configuration' : null,
      ),
    );
  }

  return { name: 'Deployment & Configuration', max: 8, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 9. DOCUMENTATION (10 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function documentation() {
  const checks = [];

  // 9a. Platform docs (2pts)
  {
    const platformMd = path.join(ROOT, 'docs', 'PLATFORM.md');
    const lines = lineCount(platformMd);
    const score = lines > 500 ? 2 : lines > 100 ? 1 : 0;
    checks.push(
      check(
        'Platform docs',
        score,
        2,
        lines > 0
          ? `docs/PLATFORM.md: ${lines} lines${lines <= 500 ? ' (need >500)' : ''}`
          : 'docs/PLATFORM.md not found',
        score < 2 ? 'Create comprehensive docs/PLATFORM.md (>500 lines)' : null,
      ),
    );
  }

  // 9b. Industry taxonomy (2pts)
  {
    const exists = fileExists(path.join(ROOT, 'docs', 'INDUSTRIES.md'));
    checks.push(
      check(
        'Industry taxonomy',
        exists ? 2 : 0,
        2,
        exists ? 'docs/INDUSTRIES.md exists' : 'docs/INDUSTRIES.md not found',
        !exists ? 'Create docs/INDUSTRIES.md with industry taxonomy' : null,
      ),
    );
  }

  // 9c. Agent docs (2pts)
  {
    const exists = fileExists(path.join(ROOT, 'docs', 'AGENTS.md'));
    checks.push(
      check(
        'Agent docs',
        exists ? 2 : 0,
        2,
        exists ? 'docs/AGENTS.md exists' : 'docs/AGENTS.md not found',
        !exists ? 'Create docs/AGENTS.md documenting all agents' : null,
      ),
    );
  }

  // 9d. Onboarding docs (2pts)
  {
    const customerOnboard = fileExists(path.join(ROOT, 'docs', 'CUSTOMER-ONBOARDING.md'));
    const devOnboard = fileExists(path.join(ROOT, 'docs', 'DEVELOPER-ONBOARDING.md'));
    const exists = customerOnboard || devOnboard;
    checks.push(
      check(
        'Onboarding docs',
        exists ? 2 : 0,
        2,
        exists
          ? `${customerOnboard ? 'CUSTOMER' : 'DEVELOPER'}-ONBOARDING.md exists`
          : 'No onboarding docs found',
        !exists ? 'Create docs/CUSTOMER-ONBOARDING.md or docs/DEVELOPER-ONBOARDING.md' : null,
      ),
    );
  }

  // 9e. Architecture doc (2pts)
  {
    const exists = fileExists(path.join(ROOT, 'ARCHITECTURE.md'));
    checks.push(
      check(
        'Architecture doc',
        exists ? 2 : 0,
        2,
        exists ? 'ARCHITECTURE.md exists' : 'ARCHITECTURE.md not found',
        !exists ? 'Create ARCHITECTURE.md at project root' : null,
      ),
    );
  }

  return { name: 'Documentation', max: 10, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// 10. INTEGRATION & UPLINK (10 pts)
// ══════════════════════════════════════════════════════════════════════════════
async function integrationUplink() {
  const checks = [];

  // 10a. Uplink architecture (3pts)
  {
    const exists = fileExists(path.join(ROOT, 'AROS-UPLINK-ARCHITECTURE.md'));
    const lines = exists ? lineCount(path.join(ROOT, 'AROS-UPLINK-ARCHITECTURE.md')) : 0;
    const score = lines > 100 ? 3 : lines > 30 ? 2 : exists ? 1 : 0;
    checks.push(
      check(
        'Uplink architecture',
        score,
        3,
        exists
          ? `AROS-UPLINK-ARCHITECTURE.md: ${lines} lines`
          : 'AROS-UPLINK-ARCHITECTURE.md not found',
        score < 3 ? 'Create comprehensive AROS-UPLINK-ARCHITECTURE.md (>100 lines)' : null,
      ),
    );
  }

  // 10b. Developer portal (3pts)
  {
    const portalDir = path.join(SHREAI, 'aros-developer-portal');
    const exists = dirExists(portalDir);
    let score = 0;
    const parts = [];
    if (exists) {
      score++;
      parts.push('portal dir exists');
      if (dirExists(path.join(portalDir, 'portal'))) {
        score++;
        parts.push('portal/ subdir');
      }
      if (dirExists(path.join(portalDir, 'sdks'))) {
        score++;
        parts.push('sdks/ subdir');
      }
    }
    checks.push(
      check(
        'Developer portal',
        score,
        3,
        parts.length > 0 ? parts.join(', ') : 'aros-developer-portal/ not found',
        score < 3 ? 'Create aros-developer-portal/ with portal/ and sdks/ subdirectories' : null,
      ),
    );
  }

  // 10c. SDK packages (2pts)
  {
    const sdksDir = path.join(SHREAI, 'aros-developer-portal', 'sdks');
    const langs = dirExists(sdksDir)
      ? listDir(sdksDir).filter((f) => {
          const p = path.join(sdksDir, f);
          try {
            return fs.statSync(p).isDirectory();
          } catch {
            return false;
          }
        })
      : [];
    const score = langs.length >= 4 ? 2 : langs.length >= 2 ? 1 : 0;
    checks.push(
      check(
        'SDK packages',
        score,
        2,
        langs.length > 0
          ? `${langs.length} SDK language(s): ${langs.join(', ')}`
          : 'No SDKs found in aros-developer-portal/sdks/',
        score < 2 ? `Add more SDK languages (have ${langs.length}, need 4 for full score)` : null,
      ),
    );
  }

  // 10d. Web UI (2pts)
  {
    const webDir = path.join(ROOT, 'apps', 'web');
    const exists = dirExists(webDir);
    const hasPkg = exists && fileExists(path.join(webDir, 'package.json'));
    const score = hasPkg ? 2 : exists ? 1 : 0;
    checks.push(
      check(
        'Web UI',
        score,
        2,
        hasPkg
          ? 'apps/web/ with package.json'
          : exists
            ? 'apps/web/ exists but missing package.json'
            : 'apps/web/ not found',
        score < 2 ? 'Create apps/web/ with package.json' : null,
      ),
    );
  }

  return { name: 'Integration & Uplink', max: 10, checks };
}

// ══════════════════════════════════════════════════════════════════════════════
// REPORTING
// ══════════════════════════════════════════════════════════════════════════════

function gradeFor(score) {
  if (score >= 95) return 'A+';
  if (score >= 90) return 'A';
  if (score >= 85) return 'B+';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function progressBar(score, max, width = 20) {
  const filled = Math.round((score / max) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

function scoreColor(score, max) {
  const pct = score / max;
  if (pct >= 0.9) return C.green;
  if (pct >= 0.7) return C.yellow;
  return C.red;
}

function printReport(categories, total, maxTotal) {
  const grade = gradeFor(total);
  const now = new Date().toISOString().split('T')[0];
  const W = 62;

  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  const line = (content) => `\u2551  ${pad(content, W - 4)}  \u2551`;

  console.log('');
  console.log(`\u2554${'═'.repeat(W)}\u2557`);
  console.log(
    `\u2551${pad('', (W - 40) / 2)}${C.bold}${C.cyan}AROS Platform — Benchmark${C.reset}${pad('', (W - 40) / 2 + 14)}  \u2551`,
  );
  console.log(line(now));
  console.log(`\u2560${'═'.repeat(W)}\u2563`);
  console.log(line(''));

  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const catScore = cat.checks.reduce((s, c) => s + c.score, 0);
    const color = scoreColor(catScore, cat.max);
    const label = `${String(i + 1).padStart(2, ' ')}. ${pad(cat.name, 24)}`;
    const bar = `${color}${progressBar(catScore, cat.max)}${C.reset}`;
    const nums = `${catScore}/${cat.max}`;
    console.log(`\u2551  ${label}${bar}  ${pad(nums, 7)}\u2551`);
  }

  console.log(line(''));
  console.log(line('\u2500'.repeat(46)));

  const totalColor = scoreColor(total, maxTotal);
  const totalBar = `${totalColor}${progressBar(total, maxTotal)}${C.reset}`;
  console.log(
    `\u2551  ${pad('TOTAL SCORE', 28)}${totalBar}  ${pad(`${total}/${maxTotal}`, 7)}\u2551`,
  );

  const gradeColor = total >= 90 ? C.green : total >= 70 ? C.yellow : C.red;
  console.log(line(`GRADE: ${gradeColor}${C.bold}${grade}${C.reset}`));
  console.log(line(''));
  console.log(`\u2560${'═'.repeat(W)}\u2563`);
  console.log(line(`${C.bold}Details:${C.reset}`));

  for (const cat of categories) {
    console.log(line(''));
    console.log(line(`${C.bold}${C.cyan}${cat.name}${C.reset}`));
    for (const ch of cat.checks) {
      const icon =
        ch.score === ch.max
          ? `${C.green}\u2713${C.reset}`
          : ch.score > 0
            ? `${C.yellow}\u25CB${C.reset}`
            : `${C.red}\u2717${C.reset}`;
      console.log(
        line(`  ${icon} ${pad(ch.name, 24)} ${ch.score}/${ch.max}  ${C.dim}${ch.detail}${C.reset}`),
      );
      if (fixMode && ch.fix) {
        console.log(line(`    ${C.yellow}\u21B3 FIX: ${ch.fix}${C.reset}`));
      }
    }
  }

  console.log(line(''));
  console.log(`\u255A${'═'.repeat(W)}\u255D`);
  console.log('');
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════════
async function main() {
  if (!jsonOnly) {
    console.log(`\n${C.dim}Running AROS Platform benchmark...${C.reset}`);
  }

  const categories = [
    await coreArchitecture(),
    await agentSystem(),
    await skillsEcosystem(),
    await dataConnectors(),
    await marketplaceNodes(),
    await licensingSecurity(),
    await billingSignup(),
    await deploymentConfig(),
    await documentation(),
    await integrationUplink(),
  ];

  const total = categories.reduce(
    (s, cat) => s + cat.checks.reduce((cs, ch) => cs + ch.score, 0),
    0,
  );
  const maxTotal = categories.reduce((s, cat) => s + cat.max, 0);
  const grade = gradeFor(total);

  // Build JSON output
  const catKeys = [
    'core_architecture',
    'agent_system',
    'skills_ecosystem',
    'data_connectors',
    'marketplace_nodes',
    'licensing_security',
    'billing_signup',
    'deployment_config',
    'documentation',
    'integration_uplink',
  ];
  const jsonResult = {
    timestamp: new Date().toISOString(),
    total_score: total,
    max_score: maxTotal,
    grade,
    categories: {},
  };
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const catScore = cat.checks.reduce((s, c) => s + c.score, 0);
    jsonResult.categories[catKeys[i]] = {
      score: catScore,
      max: cat.max,
      checks: cat.checks.map((c) => ({
        name: c.name,
        score: c.score,
        max: c.max,
        detail: c.detail,
        ...(c.fix ? { fix: c.fix } : {}),
      })),
    };
  }

  // Save JSON
  const jsonPath = path.join(__dirname, 'aros-benchmark-results.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonResult, null, 2) + '\n');

  if (jsonOnly) {
    console.log(JSON.stringify(jsonResult, null, 2));
  } else {
    printReport(categories, total, maxTotal);
    console.log(`${C.dim}Results saved to scripts/aros-benchmark-results.json${C.reset}\n`);
  }

  process.exit(total >= 60 ? 0 : 1);
}

main().catch((err) => {
  console.error(`${C.red}Benchmark failed: ${err.message}${C.reset}`);
  process.exit(1);
});
