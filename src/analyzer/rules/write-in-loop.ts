/**
 * FCG012 — Unbatched Firestore writes inside a loop
 *
 * Calling addDoc(), setDoc(), updateDoc(), or deleteDoc() inside a for/while
 * loop or .forEach/.map callback fires one network round-trip and one billed
 * write operation per iteration.  For N items this costs N writes instead of
 * 1 batch.
 *
 * Fix: collect all operations and execute them atomically with writeBatch()
 * (up to 500 operations per batch commit).
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Modular SDK — specific enough to flag unconditionally
const MODULAR_WRITES = new Set(['addDoc', 'setDoc', 'updateDoc', 'deleteDoc']);

// Compat SDK method names — too generic on their own, require chain guard below
const COMPAT_WRITES = new Set(['add', 'set', 'update', 'delete']);

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

// For compat names, only flag when the RECEIVER looks like a Firestore reference
// chain (contains collection() or doc() calls). We deliberately omit a bare
// *Ref variable-name check because it misidentifies WriteBatch variables named
// batchRef and Map/cache variables named cacheRef.
function isFirestoreCompatWrite(exprText: string, methodName: string): boolean {
  if (!COMPAT_WRITES.has(methodName)) return false;
  const receiver = exprText.slice(0, exprText.lastIndexOf('.'));
  return (
    /\bcollection\s*\(/.test(receiver) ||
    /\bdoc\s*\(/.test(receiver)
  );
}

export const writeInLoopRule: Rule = {
  id: 'FCG012',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (
      !sourceText.includes('Doc') &&
      !sourceText.includes('.add(') &&
      !sourceText.includes('.set(') &&
      !sourceText.includes('.update(') &&
      !sourceText.includes('.delete(')
    ) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText   = call.getExpression().getText();
      const methodName = exprText.split('.').pop() ?? '';

      const isModular = MODULAR_WRITES.has(methodName);
      const isCompat  = isFirestoreCompatWrite(exprText, methodName);
      if (!isModular && !isCompat) return;

      const ancestors = call.getAncestors();

      // Skip if already inside a writeBatch / Admin SDK batch context
      const inBatchContext = ancestors.some(a => {
        const t = a.getText();
        return t.includes('writeBatch') || t.includes('.batch(');
      });
      if (inBatchContext) return;

      // Skip if inside Promise.all([...]) — batching intent
      const inPromiseAll = ancestors.some(a => {
        if (a.getKind() !== SyntaxKind.CallExpression) return false;
        return (a as typeof call).getExpression().getText() === 'Promise.all';
      });
      if (inPromiseAll) return;

      const inDirectLoop = ancestors.some(a => LOOP_KINDS.has(a.getKind() as SyntaxKind));

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
        message: `[FCG012] ${methodName}() inside a loop fires one separate Firestore write per iteration — each is a billed write operation and a separate network round-trip. For N items this costs N writes instead of 1. Fix: collect all operations and execute them atomically with writeBatch() — up to 500 operations per batch.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + exprText.length,
        severity: 'error',
        code: 'FCG012'
      });
    });

    return diagnostics;
  }
};
