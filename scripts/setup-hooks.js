#!/usr/bin/env node
/**
 * Installs the CostGuard pre-commit hook into the nearest .git/hooks directory.
 * Run once: node firebase-cost-guard/scripts/setup-hooks.js
 */
const fs   = require('fs');
const path = require('path');

// Walk up from cwd to find .git
function findGitRoot(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return dir;
  const parent = path.dirname(dir);
  if (parent === dir) throw new Error('Could not find .git directory.');
  return findGitRoot(parent);
}

const gitRoot    = findGitRoot(process.cwd());
const hooksDir   = path.join(gitRoot, '.git', 'hooks');
const hookPath   = path.join(hooksDir, 'pre-commit');

// Resolve the CLI path relative to this script's location
const cliPath = path.relative(
  gitRoot,
  path.resolve(__dirname, '..', 'out', 'cli.js')
).replace(/\\/g, '/');

const hookScript = `#!/bin/sh
# CostGuard pre-commit hook — auto-installed by setup-hooks.js
node ${cliPath} --staged --max-risk=HIGH
`;

if (fs.existsSync(hookPath)) {
  const existing = fs.readFileSync(hookPath, 'utf8');
  if (existing.includes('CostGuard')) {
    console.log('CostGuard pre-commit hook already installed.');
    process.exit(0);
  }
  // Append to existing hook
  fs.appendFileSync(hookPath, '\n' + hookScript);
  console.log('CostGuard appended to existing pre-commit hook.');
} else {
  fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
  console.log(`CostGuard pre-commit hook installed at ${hookPath}`);
}
