import * as vscode from 'vscode';
import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeatureItem extends vscode.QuickPickItem {
  id: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

/** Convert Windows backslashes so paths work inside Git Bash hook scripts. */
function unixPath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function findGitRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  const parent = path.dirname(dir);
  return parent === dir ? null : findGitRoot(parent);
}

// ── Feature installers ────────────────────────────────────────────────────────

function installPreCommitHook(gitRoot: string, cliPath: string): void {
  const hooksDir = path.join(gitRoot, '.git', 'hooks');
  const hookFile = path.join(hooksDir, 'pre-commit');

  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  const script = [
    '#!/bin/sh',
    '# CostGuard pre-commit hook — remove this block to disable',
    `node "${unixPath(cliPath)}" --staged --max-risk=HIGH`,
    '',
  ].join('\n');

  if (fs.existsSync(hookFile)) {
    const existing = fs.readFileSync(hookFile, 'utf8');
    if (existing.includes('CostGuard pre-commit')) return;    // already installed
    fs.appendFileSync(hookFile, '\n' + script);
  } else {
    fs.writeFileSync(hookFile, script);
    if (os.platform() !== 'win32') fs.chmodSync(hookFile, 0o755);
  }
}

function installGitHubActions(workspaceRoot: string, extensionPath: string): void {
  const workflowsDir = path.join(workspaceRoot, '.github', 'workflows');
  const destFile     = path.join(workflowsDir, 'costguard.yml');

  if (fs.existsSync(destFile)) return;    // never overwrite existing workflow

  if (!fs.existsSync(workflowsDir)) fs.mkdirSync(workflowsDir, { recursive: true });

  const templateFile = path.join(extensionPath, 'templates', 'github-actions.yml');
  fs.copyFileSync(templateFile, destFile);
}

function addCostguardDevDep(workspaceRoot: string): void {
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (!fs.existsSync(pkgFile)) return;

  const raw = fs.readFileSync(pkgFile, 'utf8');
  const pkg = JSON.parse(raw);
  if (pkg.devDependencies?.costguard) return;

  pkg.devDependencies         = pkg.devDependencies ?? {};
  pkg.devDependencies.costguard = 'latest';

  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, detectIndent(raw)) + '\n');
}

function installDeployGate(workspaceRoot: string, cliPath: string): void {
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (!fs.existsSync(pkgFile)) return;

  const raw = fs.readFileSync(pkgFile, 'utf8');
  const pkg = JSON.parse(raw);

  if (pkg.scripts?.predeploy?.includes('costguard')) return;

  pkg.scripts          = pkg.scripts ?? {};
  pkg.scripts.predeploy = `node "${unixPath(cliPath)}" src/ --max-risk=MEDIUM`;

  fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, detectIndent(raw)) + '\n');
}

/** Preserve the original indentation style of a JSON file. */
function detectIndent(raw: string): number | string {
  const m = raw.match(/^[\[{]\r?\n([ \t]+)/m);
  if (!m) return 2;
  return m[1].startsWith('\t') ? '\t' : m[1].length;
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export async function runSetupWizard(
  context: vscode.ExtensionContext,
  isFirstRun: boolean,
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    vscode.window.showWarningMessage(
      'CostGuard: Open a project folder first, then run "CostGuard: Setup" from the command palette.',
    );
    return;
  }

  const cliPath = path.join(context.extensionPath, 'out', 'cli.js');

  const features: FeatureItem[] = [
    {
      id:          'precommit',
      label:       '$(git-commit)  Pre-commit Hook',
      description: 'Block commits with HIGH risk violations',
      detail:      'Writes a gate to .git/hooks/pre-commit — fires automatically on every git commit',
      picked:      true,
    },
    {
      id:          'github',
      label:       '$(github)  GitHub Actions PR Gate',
      description: 'Post a risk card on every PR, block merges on HIGH risk',
      detail:      'Creates .github/workflows/costguard.yml and adds costguard to devDependencies',
      picked:      true,
    },
    {
      id:          'deploy',
      label:       '$(rocket)  Deploy Gate',
      description: 'Block firebase deploy / npm run deploy on MEDIUM+ risk',
      detail:      'Adds a predeploy script to your package.json — runs before every deploy',
      picked:      false,
    },
  ];

  const selected = await vscode.window.showQuickPick(features, {
    canPickMany:   true,
    title:         isFirstRun
      ? 'CostGuard — Choose your protection layers'
      : 'CostGuard — Reconfigure protection layers',
    placeHolder:   'Space to toggle  ·  Enter to confirm  ·  Esc to skip',
    ignoreFocusOut: true,
  });

  // User pressed Esc — record dismissal so we don't auto-pop again immediately
  if (!selected) {
    context.globalState.update('costguard.setupDismissed', true);
    return;
  }

  const ids    = new Set(selected.map(f => f.id));
  const done:    string[] = [];
  const skipped: string[] = [];

  if (ids.has('precommit')) {
    const gitRoot = findGitRoot(workspaceRoot);
    if (gitRoot) {
      try {
        installPreCommitHook(gitRoot, cliPath);
        done.push('pre-commit hook');
      } catch (e: unknown) {
        skipped.push(`pre-commit hook (${(e as Error).message})`);
      }
    } else {
      skipped.push('pre-commit hook (no .git found)');
    }
  }

  if (ids.has('github')) {
    try {
      installGitHubActions(workspaceRoot, context.extensionPath);
      addCostguardDevDep(workspaceRoot);
      done.push('GitHub Actions workflow');
    } catch (e: unknown) {
      skipped.push(`GitHub Actions (${(e as Error).message})`);
    }
  }

  if (ids.has('deploy')) {
    try {
      installDeployGate(workspaceRoot, cliPath);
      done.push('deploy gate');
    } catch (e: unknown) {
      skipped.push(`deploy gate (${(e as Error).message})`);
    }
  }

  context.globalState.update('costguard.setupComplete', true);
  context.globalState.update('costguard.setupDismissed', false);

  // ── Summary notification ───────────────────────────────────────────────────
  if (done.length === 0 && skipped.length === 0) {
    vscode.window.showInformationMessage(
      'CostGuard: Nothing selected. Run "CostGuard: Setup" from the command palette any time.',
    );
    return;
  }

  const parts: string[] = [];
  if (done.length)    parts.push(`Installed: ${done.join(', ')}`);
  if (skipped.length) parts.push(`Skipped: ${skipped.join(', ')}`);

  const action = await vscode.window.showInformationMessage(
    `CostGuard setup complete. ${parts.join('  |  ')}`,
    'Run Again',
  );
  if (action === 'Run Again') runSetupWizard(context, false);
}
