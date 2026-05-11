#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { analyzeFile } from './analyzer';
import { computeRiskScore } from './analyzer/scorer';
import { RiskScore, RiskLevel } from './analyzer/types';

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS      = new Set(['node_modules', 'out', 'dist', 'build', '.git', '.next', 'coverage']);
const RISK_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

// ── File collection ───────────────────────────────────────────────────────────

function collectFiles(target: string): string[] {
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return SUPPORTED_EXTS.has(path.extname(abs)) ? [abs] : [];
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SUPPORTED_EXTS.has(path.extname(entry.name))) results.push(full);
    }
  };
  walk(abs);
  return results;
}

function getStagedFiles(): string[] {
  try {
    const out = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' });
    const cwd = process.cwd();
    return out.split('\n')
      .map(f => f.trim())
      .filter(f => f && SUPPORTED_EXTS.has(path.extname(f)))
      .map(f => path.resolve(cwd, f))
      .filter(f => fs.existsSync(f));
  } catch {
    return [];
  }
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

function highestRisk(score: RiskScore): RiskLevel {
  const levels: RiskLevel[] = [score.costRisk, score.scalabilityRisk, score.memoryLeakRisk];
  if (levels.includes('HIGH'))   return 'HIGH';
  if (levels.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);

  const targets: string[]  = [];
  let staged        = false;
  let jsonMode      = false;
  let githubMode    = false;
  let maxRisk: RiskLevel = 'HIGH';

  for (const arg of argv) {
    if (arg === '--staged')            staged     = true;
    else if (arg === '--json')         jsonMode   = true;
    else if (arg === '--format=github') githubMode = true;
    else if (arg.startsWith('--max-risk=')) maxRisk = arg.split('=')[1] as RiskLevel;
    else targets.push(...collectFiles(arg));
  }

  const files = staged ? getStagedFiles() : targets;

  if (files.length === 0) {
    if (!jsonMode && !githubMode) console.log('CostGuard: No files to analyze.');
    process.exit(0);
  }

  // ── Analyze ────────────────────────────────────────────────────────────────

  interface FileResult {
    file:     string;
    relFile:  string;
    score:    RiskScore;
    findings: ReturnType<typeof analyzeFile>;
  }

  const cwd     = process.cwd();
  const results: FileResult[] = [];
  let   blocked = false;

  for (const file of files) {
    let source: string;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }

    const findings = analyzeFile(source, file);
    if (findings.length === 0) continue;

    const score   = computeRiskScore(findings);
    const relFile = path.relative(cwd, file).replace(/\\/g, '/');
    results.push({ file, relFile, score, findings });

    if (RISK_ORDER[highestRisk(score)] >= RISK_ORDER[maxRisk]) blocked = true;
  }

  // ── JSON output (for GitHub Actions consumption) ───────────────────────────

  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      blocked,
      results: results.map(r => ({
        file:       r.relFile,
        score:      r.score,
        violations: r.findings.map(f => ({
          line:     f.line + 1,
          code:     f.code,
          severity: f.severity,
          message:  f.message.split('\n')[0],
        })),
      })),
    }, null, 2) + '\n');
    process.exit(blocked ? 1 : 0);
  }

  // ── GitHub Actions annotation output ──────────────────────────────────────

  if (githubMode) {
    for (const { relFile, findings } of results) {
      for (const f of findings) {
        const level = f.severity === 'error' ? 'error' : 'warning';
        console.log(`::${level} file=${relFile},line=${f.line + 1}::${f.code}: ${f.message.split('\n')[0]}`);
      }
    }
    process.exit(blocked ? 1 : 0);
  }

  // ── Human-readable output ─────────────────────────────────────────────────

  if (results.length === 0) {
    console.log('\n  CostGuard: All clear.\n');
    process.exit(0);
  }

  const HR = '─'.repeat(60);
  console.log(`\n  CostGuard\n  ${HR}`);

  for (const { relFile, score, findings } of results) {
    console.log(`\n  ${relFile}`);
    console.log(`  Risk ${score.overall}/100  |  Cost: ${score.costRisk}  |  Scalability: ${score.scalabilityRisk}  |  Memory Leak: ${score.memoryLeakRisk}`);
    for (const f of findings) {
      const icon = f.severity === 'error' ? '✗' : '⚠';
      console.log(`    ${icon}  Line ${f.line + 1}  [${f.code}]  ${f.message.split('\n')[0]}`);
    }
  }

  const totalViolations = results.reduce((n, r) => n + r.findings.length, 0);
  console.log(`\n  ${HR}`);
  console.log(`  ${totalViolations} violation${totalViolations !== 1 ? 's' : ''} in ${results.length} file${results.length !== 1 ? 's' : ''}`);

  if (blocked) {
    console.log(`\n  ✗  Blocked — fix HIGH risk violations before proceeding.\n`);
  } else {
    console.log(`\n  ⚠  Warnings found (not blocking — below --max-risk threshold).\n`);
  }

  process.exit(blocked ? 1 : 0);
}

main();
