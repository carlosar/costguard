import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { analyzeFile } from './analyzer';
import { computeRiskScore } from './analyzer/scorer';
import { RiskScore, RiskLevel } from './analyzer/types';
import { runSetupWizard, findGitRoot } from './setup';
import { generateReport } from './reporter';

const SUPPORTED = new Set(['typescript', 'typescriptreact', 'javascript', 'javascriptreact']);
const SUPPORTED_SELECTOR = [
  { language: 'typescript' },
  { language: 'typescriptreact' },
  { language: 'javascript' },
  { language: 'javascriptreact' },
];

let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;
let codeLensProvider: RiskCodeLensProvider;
const riskCache    = new Map<string, RiskScore>();
const debounceMap  = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS  = 500;

// ── CodeLens provider ─────────────────────────────────────────────────────────

class RiskCodeLensProvider implements vscode.CodeLensProvider {
  private _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onChange.event;

  refresh(): void { this._onChange.fire(); }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const score = riskCache.get(document.uri.toString());
    if (!score || score.violationCount === 0) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    const args  = [document.uri.toString()];
    const cmd   = 'costGuard.showRiskDetails';

    return [
      new vscode.CodeLens(range, { title: `$(shield) Risk Score: ${score.overall}/100`, command: cmd, arguments: args }),
      new vscode.CodeLens(range, { title: `Cost: ${levelLabel(score.costRisk)}`,         command: cmd, arguments: args }),
      new vscode.CodeLens(range, { title: `Scalability: ${levelLabel(score.scalabilityRisk)}`, command: cmd, arguments: args }),
      new vscode.CodeLens(range, { title: `Memory Leak: ${levelLabel(score.memoryLeakRisk)}`,  command: cmd, arguments: args }),
    ];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function levelLabel(level: RiskLevel): string {
  if (level === 'HIGH')   return '$(error) HIGH';
  if (level === 'MEDIUM') return '$(warning) MEDIUM';
  return '$(check) LOW';
}

function highestLevel(score: RiskScore): RiskLevel {
  const levels = [score.costRisk, score.scalabilityRisk, score.memoryLeakRisk];
  if (levels.includes('HIGH'))   return 'HIGH';
  if (levels.includes('MEDIUM')) return 'MEDIUM';
  return 'LOW';
}

// ── Core analysis ─────────────────────────────────────────────────────────────

function analyzeDoc(doc: vscode.TextDocument): void {
  if (!SUPPORTED.has(doc.languageId)) return;

  const enabled = vscode.workspace.getConfiguration('costGuard').get<boolean>('enable', true);
  if (!enabled) {
    diagnosticCollection.delete(doc.uri);
    riskCache.delete(doc.uri.toString());
    codeLensProvider.refresh();
    updateStatusBar(vscode.window.activeTextEditor?.document);
    return;
  }

  const findings = analyzeFile(doc.getText(), doc.fileName);
  const score    = computeRiskScore(findings);

  riskCache.set(doc.uri.toString(), score);
  codeLensProvider.refresh();

  diagnosticCollection.set(doc.uri, findings.map(d => {
    const range = new vscode.Range(
      new vscode.Position(d.line, d.startChar),
      new vscode.Position(d.line, d.endChar)
    );
    const diag = new vscode.Diagnostic(
      range,
      d.message,
      d.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
    );
    diag.code   = d.code;
    diag.source = 'CostGuard';
    return diag;
  }));

  if (vscode.window.activeTextEditor?.document.uri.toString() === doc.uri.toString()) {
    updateStatusBar(doc);
  }
}

// ── Status bar ────────────────────────────────────────────────────────────────

function updateStatusBar(doc: vscode.TextDocument | undefined): void {
  if (!doc || !SUPPORTED.has(doc.languageId)) { statusBarItem.hide(); return; }

  const score = riskCache.get(doc.uri.toString());
  if (!score) { statusBarItem.hide(); return; }

  if (score.violationCount === 0) {
    statusBarItem.text              = '$(shield) CostGuard: Safe';
    statusBarItem.tooltip           = 'No Firebase cost risks detected';
    statusBarItem.backgroundColor   = undefined;
  } else {
    const top = highestLevel(score);
    const icon = top === 'HIGH' ? '$(error)' : '$(warning)';
    statusBarItem.text    = `${icon} CostGuard: ${score.overall}/100`;
    statusBarItem.tooltip = new vscode.MarkdownString(
      `**CostGuard Risk Score: ${score.overall}/100**\n\n` +
      `${score.violationCount} violation${score.violationCount !== 1 ? 's' : ''}\n\n` +
      `| Category | Risk |\n|---|---|\n` +
      `| Cost | ${score.costRisk} |\n` +
      `| Scalability | ${score.scalabilityRisk} |\n` +
      `| Memory Leak | ${score.memoryLeakRisk} |`
    );
    statusBarItem.backgroundColor = top === 'HIGH'
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  statusBarItem.show();
}

// ── Protection-layer detection ────────────────────────────────────────────────

function hasAnyProtection(workspaceRoot: string): boolean {
  if (fs.existsSync(path.join(workspaceRoot, '.github', 'workflows', 'costguard.yml'))) return true;
  const gitRoot = findGitRoot(workspaceRoot);
  if (gitRoot) {
    const hookFile = path.join(gitRoot, '.git', 'hooks', 'pre-commit');
    try {
      if (fs.existsSync(hookFile) && fs.readFileSync(hookFile, 'utf8').includes('CostGuard')) return true;
    } catch {}
  }
  const pkgFile = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgFile)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
      if (pkg.scripts?.predeploy?.includes('costguard')) return true;
    } catch {}
  }
  return false;
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('costguard');
  context.subscriptions.push(diagnosticCollection);

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'costGuard.showRiskDetails';
  context.subscriptions.push(statusBarItem);

  codeLensProvider = new RiskCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(SUPPORTED_SELECTOR, codeLensProvider)
  );

  // Setup wizard command
  context.subscriptions.push(
    vscode.commands.registerCommand('costGuard.setup', () => {
      runSetupWizard(context, false);
    })
  );

  // Generate markdown report command
  context.subscriptions.push(
    vscode.commands.registerCommand('costGuard.generateReport', async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showWarningMessage('CostGuard: Open a project folder first.');
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'CostGuard: Scanning and generating report…' },
        async () => {
          const reportPath = generateReport(workspaceRoot);
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(reportPath));
          await vscode.window.showTextDocument(doc);
          vscode.window.showInformationMessage(
            `CostGuard: Report saved to costguard/${require('path').basename(reportPath)}`
          );
        }
      );
    })
  );

  // Detect new installs / upgrades by comparing stored version to current
  const currentVersion = context.extension.packageJSON.version as string;
  const lastVersion    = context.globalState.get<string>('costguard.lastVersion', '');
  const isNewVersion   = lastVersion !== currentVersion;

  // Persist the current version (async write — not read again below)
  if (isNewVersion) {
    context.globalState.update('costguard.lastVersion', currentVersion);
  }

  // Derive wizard flags without relying on the async update above having resolved
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  let setupComplete  = isNewVersion ? false : context.globalState.get<boolean>('costguard.setupComplete',  false);
  let setupDismissed = isNewVersion ? false : context.globalState.get<boolean>('costguard.setupDismissed', false);

  // VS Code persists globalState through same-version reinstalls, so stale
  // setupComplete/setupDismissed flags would silently suppress the wizard.
  // Reset whichever flags are set whenever no protection layer is installed.
  if (workspaceRoot && !hasAnyProtection(workspaceRoot)) {
    if (setupComplete)  { setupComplete  = false; context.globalState.update('costguard.setupComplete',  false); }
    if (setupDismissed) { setupDismissed = false; context.globalState.update('costguard.setupDismissed', false); }
  }

  if (!setupComplete && !setupDismissed) {
    const showBanner = () => {
      vscode.window.showInformationMessage(
        'CostGuard installed — configure your protection layers (pre-commit, GitHub Actions, deploy gate)',
        'Set Up Now',
        'Later',
      ).then(choice => {
        if (choice === 'Set Up Now') runSetupWizard(context, true);
        if (choice === 'Later')      context.globalState.update('costguard.setupDismissed', true);
      });
    };

    if (vscode.workspace.workspaceFolders?.length) {
      setTimeout(showBanner, 1500);
    } else {
      // No workspace at activation — defer until one is open so we can check
      // whether protection files exist before deciding to show the banner.
      const onOpen = vscode.workspace.onDidOpenTextDocument(() => {
        onOpen.dispose();
        const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (wsRoot && hasAnyProtection(wsRoot)) return; // protection in place, skip
        showBanner();
      });
      context.subscriptions.push(onOpen);
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('costGuard.showRiskDetails', (uriStr?: string) => {
      const key   = uriStr ?? vscode.window.activeTextEditor?.document.uri.toString();
      const score = key ? riskCache.get(key) : undefined;
      if (!score || score.violationCount === 0) {
        vscode.window.showInformationMessage('CostGuard: No issues found in this file.');
        return;
      }
      vscode.window.showWarningMessage(
        `CostGuard  |  Risk Score: ${score.overall}/100  |  ` +
        `Cost: ${score.costRisk}  |  ` +
        `Scalability: ${score.scalabilityRisk}  |  ` +
        `Memory Leak: ${score.memoryLeakRisk}  ` +
        `(${score.violationCount} violation${score.violationCount !== 1 ? 's' : ''})`
      );
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(doc  => analyzeDoc(doc)),
    vscode.workspace.onDidSaveTextDocument(doc  => analyzeDoc(doc)),
    vscode.workspace.onDidChangeTextDocument(event => {
      const doc = event.document;
      if (!SUPPORTED.has(doc.languageId)) return;
      const key = doc.uri.toString();
      const existing = debounceMap.get(key);
      if (existing) clearTimeout(existing);
      debounceMap.set(key, setTimeout(() => {
        debounceMap.delete(key);
        analyzeDoc(doc);
      }, DEBOUNCE_MS));
    }),
    vscode.workspace.onDidCloseTextDocument(doc => {
      const key = doc.uri.toString();
      const existing = debounceMap.get(key);
      if (existing) clearTimeout(existing);
      debounceMap.delete(key);
      diagnosticCollection.delete(doc.uri);
      riskCache.delete(key);
      codeLensProvider.refresh();
      updateStatusBar(vscode.window.activeTextEditor?.document);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      updateStatusBar(editor?.document);
    })
  );

  vscode.workspace.textDocuments.forEach(doc => analyzeDoc(doc));
  updateStatusBar(vscode.window.activeTextEditor?.document);
}

export function deactivate(): void {
  diagnosticCollection?.clear();
}
