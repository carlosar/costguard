/**
 * FCG017 — Cloud Function (httpsCallable) invoked inside a loop
 *
 * Each call to a function created with httpsCallable() bills one Cloud
 * Function execution, plus any Firestore reads the function performs.
 * Calling it inside a for/while loop or .forEach/.map fires one separate
 * billed execution per iteration — N items costs N executions instead of 1.
 *
 * Detected forms:
 *   const fn = httpsCallable(functions, 'name');
 *   for (const item of items) { await fn(item); }   ← variable call in loop
 *
 *   for (const item of items) {
 *     await httpsCallable(functions, 'name')(item);  ← inline call in loop
 *   }
 *
 * Fix: redesign the Cloud Function to accept an array payload and process all
 * items in one call, or fan out with Promise.all() if parallel execution is
 * acceptable and the function is idempotent.
 */

import { Project, SyntaxKind, SourceFile, CallExpression } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

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

const FANOUT_CALLS = ['Promise.all', 'Promise.allSettled', 'Promise.race', 'Promise.any'];

function findCallableNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(decl => {
    const init = decl.getInitializer()?.getText() ?? '';
    if (/^httpsCallable[\s(<]/.test(init)) names.add(decl.getName());
  });
  return names;
}

function isCallableInvocation(call: CallExpression, callableNames: Set<string>): boolean {
  const callee = call.getExpression();
  // Inline: httpsCallable(functions, 'name')(payload)
  if (callee.getKind() === SyntaxKind.CallExpression)
    return /^httpsCallable[\s(<]/.test(callee.getText());
  // Variable: const fn = httpsCallable(...); fn(payload)
  if (callee.getKind() === SyntaxKind.Identifier)
    return callableNames.has(callee.getText());
  return false;
}

export const cloudfunctionInLoopRule: Rule = {
  id: 'FCG017',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!sourceText.includes('httpsCallable')) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const callableNames = findCallableNames(sf);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      if (!isCallableInvocation(call, callableNames)) return;

      const ancestors = call.getAncestors();

      // Skip if already inside a Promise fanout — parallel execution, not serial billing
      const inPromiseFanout = ancestors.some(a => {
        if (a.getKind() !== SyntaxKind.CallExpression) return false;
        return FANOUT_CALLS.includes((a as CallExpression).getExpression().getText());
      });
      if (inPromiseFanout) return;

      const inDirectLoop = ancestors.some(a => LOOP_KINDS.has(a.getKind() as SyntaxKind));

      const inArrayLoop = ancestors.some(ancestor => {
        if (ancestor.getKind() !== SyntaxKind.CallExpression) return false;
        const callee = (ancestor as CallExpression).getExpression();
        if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
        const prop = callee.asKind(SyntaxKind.PropertyAccessExpression);
        return ARRAY_LOOP_METHODS.has(prop?.getName() ?? '');
      });

      if (!inDirectLoop && !inArrayLoop) return;

      // Collect-then-fanout: call not awaited inside loop, promise stored for later fanout
      let isDirectlyAwaited = false;
      for (const a of ancestors) {
        if (a.getKind() === SyntaxKind.AwaitExpression) { isDirectlyAwaited = true; break; }
        if (
          LOOP_KINDS.has(a.getKind() as SyntaxKind)          ||
          a.getKind() === SyntaxKind.ArrowFunction            ||
          a.getKind() === SyntaxKind.FunctionDeclaration      ||
          a.getKind() === SyntaxKind.FunctionExpression
        ) break;
      }
      if (!isDirectlyAwaited) {
        const enclosingFn =
          call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
          call.getFirstAncestorByKind(SyntaxKind.ArrowFunction)       ||
          call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
        const scopeText = enclosingFn?.getText() ?? '';
        if (FANOUT_CALLS.some(f => scopeText.includes(f + '('))) return;
      }

      const callee = call.getExpression();
      const calleeText = callee.getKind() === SyntaxKind.Identifier
        ? callee.getText()
        : 'httpsCallable(...)';

      const pos = callee.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message:
          `[FCG017] ${calleeText}() calls a Cloud Function inside a loop — each iteration is a ` +
          `separate billed execution. For N items this costs N executions instead of 1. ` +
          `Fix: redesign the Cloud Function to accept an array payload and process all items in ` +
          `one call, or fan out with Promise.all() if parallel execution is acceptable.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + calleeText.length,
        severity: 'error',
        code: 'FCG017'
      });
    });

    return diagnostics;
  }
};
