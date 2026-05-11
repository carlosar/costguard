/**
 * FCG002 — Unbounded Firestore collection read
 *
 * Detects .collection(...).get() and onSnapshot(query(...)) calls that have
 * no .limit() anywhere in the chain.  Without a limit, a single read can
 * return millions of documents and generate massive Firestore bills.
 *
 * Found 11 instances of this pattern across SoarOne's codebase.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Firestore query builders that indicate a collection-level read
const COLLECTION_CALLS = new Set(['collection', 'collectionGroup']);
const READ_TERMINATORS = new Set(['get', 'onSnapshot']);

function chainContainsLimit(callText: string): boolean {
  return /\.limit\s*\(/.test(callText) || /\blimit\s*\(/.test(callText);
}

export const unboundedReadRule: Rule = {
  id: 'FCG002',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      const methodName = exprText.split('.').pop() ?? '';

      if (!READ_TERMINATORS.has(methodName)) return;

      const fullChain = call.getText();

      // Only flag chains that involve a collection read
      const involvesCollection = COLLECTION_CALLS.has(
        fullChain.match(/(\w+)\s*\(/)?.[1] ?? ''
      ) || /\.collection\s*\(/.test(fullChain) || fullChain.includes('collection(');

      if (!involvesCollection) return;
      if (chainContainsLimit(fullChain)) return;

      // Also skip single-document reads (doc() before get())
      if (/\.doc\s*\([^)]+\)\s*\.(get|onSnapshot)/.test(fullChain)) return;

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message: `[FCG002] Unbounded Firestore read — no .limit() on this query. Without a limit, this can read millions of documents and generate large unexpected bills. Add .limit(N) appropriate to your use case.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + exprText.length,
        severity: 'error',
        code: 'FCG002'
      });
    });

    return diagnostics;
  }
};
