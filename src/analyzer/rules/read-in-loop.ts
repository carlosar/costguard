/**
 * FCG005 — Firestore read inside a loop
 *
 * Detects getDoc() / getDocs() called inside a for/while loop or inside a
 * .forEach/.map/.filter callback.  Each iteration fires a separate network
 * round-trip and counts as a separate billed read.  For N items this is N reads
 * instead of one — the classic N+1 problem.
 *
 * Fix: use getDocs() with an `in` query for up to 30 IDs, or collect IDs first
 * then call Promise.all(ids.map(id => getDoc(...))).
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const FIRESTORE_READS = new Set(['getDoc', 'getDocs', 'getCountFromServer', 'getAggregateFromServer']);

const LOOP_KINDS = new Set([
  SyntaxKind.ForStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

const ARRAY_LOOP_METHODS = new Set([
  'forEach', 'map', 'filter', 'reduce', 'flatMap', 'some', 'every', 'find', 'findIndex',
]);

export const readInLoopRule: Rule = {
  id: 'FCG005',

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
      if (!FIRESTORE_READS.has(methodName)) return;

      const ancestors = call.getAncestors();

      // Direct loop ancestor (for, while, for-of, for-in, do-while)
      const inDirectLoop = ancestors.some(a => LOOP_KINDS.has(a.getKind() as SyntaxKind));

      // Inside a .forEach / .map / etc. callback
      const inArrayLoop = ancestors.some(ancestor => {
        if (ancestor.getKind() !== SyntaxKind.CallExpression) return false;
        const callee = (ancestor as typeof call).getExpression();
        if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
        const prop = callee.asKind(SyntaxKind.PropertyAccessExpression);
        return ARRAY_LOOP_METHODS.has(prop?.getName() ?? '');
      });

      if (!inDirectLoop && !inArrayLoop) return;

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message: `[FCG005] ${methodName}() inside a loop causes N separate Firestore reads — one per iteration. Use an 'in' query (up to 30 IDs) or collect all IDs first and fetch in parallel with Promise.all() to reduce to a single billed operation.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + exprText.length,
        severity: 'error',
        code: 'FCG005'
      });
    });

    return diagnostics;
  }
};
