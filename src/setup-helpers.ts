import * as fs   from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Pure / vscode-free helpers shared by setup.ts and extension.ts.
// Kept out of setup.ts so they can be unit-tested without the vscode module.

export function findGitRoot(dir: string): string | null {
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  const parent = path.dirname(dir);
  return parent === dir ? null : findGitRoot(parent);
}

/**
 * Resolve the directory git actually reads hooks from.
 * Respects core.hooksPath (husky sets this to .husky/); `custom` is the raw
 * configured value, or null when the default .git/hooks applies.
 */
export function resolveHooksDir(gitRoot: string): { dir: string; custom: string | null } {
  try {
    const custom = execSync('git config core.hooksPath', { cwd: gitRoot, encoding: 'utf8' }).trim();
    if (custom) {
      return { dir: path.isAbsolute(custom) ? custom : path.resolve(gitRoot, custom), custom };
    }
  } catch {
    // core.hooksPath unset (git config exits 1) or git unavailable — use the default
  }
  return { dir: path.join(gitRoot, '.git', 'hooks'), custom: null };
}

/** Preserve the original indentation style of a JSON file. */
export function detectIndent(raw: string): number | string {
  const m = raw.match(/^[\[{]\r?\n([ \t]+)/m);
  if (!m) return 2;
  return m[1].startsWith('\t') ? '\t' : m[1].length;
}

export const FIREBASE_PREDEPLOY_CMD = 'npx costguard src/ --max-risk=MEDIUM';

// Deploy targets whose firebase.json entries support predeploy hooks
const FIREBASE_PREDEPLOY_TARGETS = ['hosting', 'functions', 'firestore', 'storage', 'database'];

/**
 * Add the CostGuard gate to the predeploy hooks of every deploy target present
 * in a firebase.json. Firebase runs these hooks on `firebase deploy` (including
 * --only deploys of that target). Returns the updated JSON text, or null when
 * nothing needed to change (already gated, no targets, or unparseable input).
 */
export function addFirebasePredeploy(raw: string): string | null {
  let config: Record<string, unknown>;
  try { config = JSON.parse(raw); } catch { return null; }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return null;

  let changed = false;

  const addTo = (entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return;
    const target = entry as { predeploy?: unknown };
    const pre  = target.predeploy;
    const list = pre === undefined ? [] : Array.isArray(pre) ? [...pre] : [pre];
    if (list.some(cmd => typeof cmd === 'string' && cmd.includes('costguard'))) return;
    list.push(FIREBASE_PREDEPLOY_CMD);
    target.predeploy = list;
    changed = true;
  };

  for (const name of FIREBASE_PREDEPLOY_TARGETS) {
    const value = config[name];
    if (value === undefined) continue;
    // hosting/functions may be arrays (multi-site / multi-codebase configs)
    if (Array.isArray(value)) value.forEach(addTo);
    else addTo(value);
  }

  return changed ? JSON.stringify(config, null, detectIndent(raw)) + '\n' : null;
}
