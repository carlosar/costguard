import * as fs   from 'fs';
import * as path from 'path';
import { analyzeFile } from './analyzer';
import { computeRiskScore } from './analyzer/scorer';
import { RiskScore, RuleDiagnostic } from './analyzer/types';

// ── File collection ───────────────────────────────────────────────────────────

const SUPPORTED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const SKIP_DIRS      = new Set(['node_modules', 'out', 'dist', 'build', '.git', '.next', 'coverage', 'costguard']);

function collectFiles(dir: string): string[] {
  const results: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SUPPORTED_EXTS.has(path.extname(entry.name))) results.push(full);
    }
  };
  walk(dir);
  return results;
}

function timestamp(): string {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
    String(d.getSeconds()).padStart(2, '0'),
  ].join('-');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface FileResult {
  relPath:  string;
  findings: RuleDiagnostic[];
  score:    RiskScore;
}

// ── Report ────────────────────────────────────────────────────────────────────

export function generateReport(workspaceRoot: string): string {
  const srcDir  = path.join(workspaceRoot, 'src');
  const scanDir = fs.existsSync(srcDir) ? srcDir : workspaceRoot;

  const results: FileResult[] = [];

  for (const file of collectFiles(scanDir)) {
    let source: string;
    try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }

    const findings = analyzeFile(source, file);
    if (findings.length === 0) continue;

    results.push({
      relPath:  path.relative(workspaceRoot, file).replace(/\\/g, '/'),
      findings,
      score:    computeRiskScore(findings),
    });
  }

  const totalViolations = results.reduce((n, r) => n + r.findings.length, 0);
  const md: string[]    = [];

  // ── Header ─────────────────────────────────────────────────────────────────

  md.push('# CostGuard Report');
  md.push(`**Generated:** ${new Date().toLocaleString()}`);
  md.push('');

  if (results.length === 0) {
    md.push('**All clear — no Firebase cost violations found.**');
    return write(workspaceRoot, md);
  }

  md.push(`**${totalViolations} violation${totalViolations !== 1 ? 's' : ''} across ${results.length} file${results.length !== 1 ? 's' : ''}**`);
  md.push('');

  // ── Summary table ──────────────────────────────────────────────────────────

  md.push('## Summary');
  md.push('');
  md.push('| File | Score | Cost | Scalability | Memory Leak | Violations |');
  md.push('|---|---|---|---|---|---|');

  for (const { relPath, score, findings } of results) {
    md.push(`| \`${relPath}\` | ${score.overall}/100 | ${score.costRisk} | ${score.scalabilityRisk} | ${score.memoryLeakRisk} | ${findings.length} |`);
  }

  md.push('');
  md.push('---');
  md.push('');

  // ── AI prompt ──────────────────────────────────────────────────────────────

  md.push('## Violations');
  md.push('');
  md.push('> Copy everything below this line and paste it into an AI prompt to fix all violations.');
  md.push('');
  md.push('Fix the following Firebase cost violations in my codebase. For each violation go to the file and line number listed and apply the fix.');
  md.push('');

  // ── Per-file tables ────────────────────────────────────────────────────────

  for (const { relPath, findings, score } of results) {
    md.push('---');
    md.push('');
    md.push(`### \`${relPath}\``);
    md.push(`Risk Score: **${score.overall}/100** | Cost: **${score.costRisk}** | Scalability: **${score.scalabilityRisk}** | Memory Leak: **${score.memoryLeakRisk}**`);
    md.push('');
    md.push('| Line | Rule | Severity | Violation | Fix |');
    md.push('|---|---|---|---|---|');

    for (const f of findings) {
      const parts   = f.message.split('Fix:');
      const issue   = parts[0].replace(/\[FCG\d+\]\s*/, '').trim();
      const fix     = parts[1]?.trim() ?? '—';
      const sev     = f.severity === 'error' ? 'ERROR' : 'WARNING';

      md.push(`| ${f.line + 1} | \`${f.code}\` | ${sev} | ${issue} | ${fix} |`);
    }

    md.push('');
  }

  return write(workspaceRoot, md);
}

function write(workspaceRoot: string, md: string[]): string {
  const dir = path.join(workspaceRoot, 'costguard');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `costguard-report-${timestamp()}.md`);
  fs.writeFileSync(filePath, md.join('\n'));
  return filePath;
}
