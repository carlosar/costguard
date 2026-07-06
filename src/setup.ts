import * as vscode from 'vscode';
import * as fs   from 'fs';
import * as path from 'path';
import * as os   from 'os';
import { findGitRoot, resolveHooksDir, detectIndent, addFirebasePredeploy, FIREBASE_PREDEPLOY_CMD } from './setup-helpers';

export { findGitRoot } from './setup-helpers';

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeatureItem extends vscode.QuickPickItem {
  id: string;
}

// ── Feature installers ────────────────────────────────────────────────────────

function installPreCommitHook(gitRoot: string): void {
  // Respect core.hooksPath (e.g. husky sets this to .husky/)
  const { dir: hooksDir, custom } = resolveHooksDir(gitRoot);
  if (custom && !fs.existsSync(hooksDir)) {
    vscode.window.showWarningMessage(
      `CostGuard: core.hooksPath is "${custom}" but that directory doesn't exist. Pre-commit hook skipped.`,
    );
    return;
  }

  const hookFile = path.join(hooksDir, 'pre-commit');

  if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

  const script = [
    '#!/bin/sh',
    '# CostGuard pre-commit hook — remove this block to disable',
    'npx --yes costguard --staged --max-risk=HIGH',
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

function installDeployGate(workspaceRoot: string): void {
  // Layer 1: npm predeploy script — gates `npm run deploy`
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgFile)) {
    const raw = fs.readFileSync(pkgFile, 'utf8');
    const pkg = JSON.parse(raw);

    if (!pkg.scripts?.predeploy?.includes('costguard')) {
      // Use the project's own costguard devDependency (via npx) rather than the
      // locally-installed extension's path — predeploy ships in package.json and
      // must work on any machine/CI runner, not just the one that ran the wizard.
      pkg.scripts          = pkg.scripts ?? {};
      pkg.scripts.predeploy = FIREBASE_PREDEPLOY_CMD;

      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, detectIndent(raw)) + '\n');
    }
  }

  // Layer 2: firebase.json predeploy hooks — Firebase runs these on every
  // `firebase deploy`, so the gate holds even when npm scripts are bypassed.
  const fbFile = path.join(workspaceRoot, 'firebase.json');
  if (fs.existsSync(fbFile)) {
    const updated = addFirebasePredeploy(fs.readFileSync(fbFile, 'utf8'));
    if (updated !== null) fs.writeFileSync(fbFile, updated);
  }
}

// ── Wizard ────────────────────────────────────────────────────────────────────

export async function runSetupWizard(
  context: vscode.ExtensionContext,
  isFirstRun: boolean,
  track: (name: string, props?: Record<string, string>) => void = () => {},
): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  if (!workspaceRoot) {
    vscode.window.showWarningMessage(
      'CostGuard: Open a project folder first, then run "CostGuard: Setup" from the command palette.',
    );
    return;
  }

  const features: FeatureItem[] = [
    {
      id:          'precommit',
      label:       '$(git-commit)  Pre-commit Hook',
      description: 'Block commits with HIGH risk violations',
      detail:      'Writes a gate to your git hooks directory (respects core.hooksPath / husky) — fires on every git commit',
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
      description: 'Block firebase deploy and npm run deploy on MEDIUM+ risk',
      detail:      'Adds predeploy hooks to firebase.json (gates firebase deploy) and a predeploy script to package.json (gates npm run deploy)',
      picked:      false,
    },
  ];

  track('setup.wizard.opened', { trigger: isFirstRun ? 'banner' : 'command' });

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
    track('setup.wizard.dismissed');
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
        installPreCommitHook(gitRoot);
        done.push('pre-commit hook');
      } catch (e: unknown) {
        skipped.push(`pre-commit hook (${(e as Error).message})`);
      }
    } else {
      skipped.push('pre-commit hook (no .git found)');
    }
  }

  if (ids.has('precommit') || ids.has('github') || ids.has('deploy')) {
    try {
      // The pre-commit hook and predeploy scripts all invoke `npx costguard`;
      // a local devDependency keeps that fast and offline-safe.
      addCostguardDevDep(workspaceRoot);
    } catch {
      // non-fatal — gates still work if costguard is installed another way
    }
  }

  if (ids.has('github')) {
    try {
      installGitHubActions(workspaceRoot, context.extensionPath);
      done.push('GitHub Actions workflow');
    } catch (e: unknown) {
      skipped.push(`GitHub Actions (${(e as Error).message})`);
    }
  }

  if (ids.has('deploy')) {
    try {
      installDeployGate(workspaceRoot);
      done.push('deploy gate');
    } catch (e: unknown) {
      skipped.push(`deploy gate (${(e as Error).message})`);
    }
  }

  context.globalState.update('costguard.setupComplete', true);
  context.globalState.update('costguard.setupDismissed', false);
  track('setup.completed', { layers: [...ids].join(',') });

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
