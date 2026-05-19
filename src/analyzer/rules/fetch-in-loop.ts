/**
 * FCG008 — fetch / axios call inside a loop
 *
 * Calling fetch() or axios methods (get, post, put, patch, delete, request)
 * inside a for/while loop or array callback (.forEach, .map, etc.) fires one
 * HTTP request per iteration.  For N items this is N sequential round-trips
 * instead of one — the same N+1 problem as FCG005 but for any HTTP endpoint,
 * not just Firestore.
 *
 * The cost: direct billing for third-party APIs (OpenAI, Stripe, maps, etc.)
 * that charge per request, plus unnecessary latency.
 *
 * Fix: collect all inputs first, then use Promise.all() to fan out in a single
 * async batch, or use a bulk/batch endpoint if the service provides one.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const AXIOS_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'request', 'head']);

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

function isFetchOrAxios(exprText: string): boolean {
  if (exprText === 'fetch') return true;
  const parts = exprText.split('.');
  const obj    = parts[0];
  const method = parts[parts.length - 1];
  if ((obj === 'axios' || obj === 'api' || obj === 'http') && AXIOS_METHODS.has(method)) return true;
  return false;
}

export const fetchInLoopRule: Rule = {
  id: 'FCG008',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!sourceText.includes('fetch') && !sourceText.includes('axios')) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      if (!isFetchOrAxios(exprText)) return;

      const ancestors = call.getAncestors();

      const inDirectLoop = ancestors.some(a => LOOP_KINDS.has(a.getKind() as SyntaxKind));

      const inArrayLoop = ancestors.some(ancestor => {
        if (ancestor.getKind() !== SyntaxKind.CallExpression) return false;
        const callee = (ancestor as typeof call).getExpression();
        if (callee.getKind() !== SyntaxKind.PropertyAccessExpression) return false;
        const prop = callee.asKind(SyntaxKind.PropertyAccessExpression);
        return ARRAY_LOOP_METHODS.has(prop?.getName() ?? '');
      });

      if (!inDirectLoop && !inArrayLoop) return;

      // Skip if the loop feeds into a Promise fan-out — calls run in parallel, not serially.
      // Handles both inline: Promise.all(items.map(i => axios.post(...)))
      // and collect-then-fanout: const p = items.map(...); await Promise.allSettled(p)
      const FANOUT_CALLS = ['Promise.all', 'Promise.allSettled', 'Promise.race', 'Promise.any'];

      const inPromiseFanout = ancestors.some(a => {
        if (a.getKind() !== SyntaxKind.CallExpression) return false;
        return FANOUT_CALLS.includes((a as typeof call).getExpression().getText());
      });
      if (inPromiseFanout) return;

      // Collect-then-fanout: call not awaited inside loop — promise is being collected
      // for a later Promise.allSettled/all (do...while push pattern, forEach push, etc.).
      // Walk up ancestors to the loop boundary; if no AwaitExpression is found, the
      // call's promise is being stored rather than sequentially awaited.
      let isDirectlyAwaited = false;
      for (const a of ancestors) {
        if (a.getKind() === SyntaxKind.AwaitExpression) { isDirectlyAwaited = true; break; }
        if (
          LOOP_KINDS.has(a.getKind() as SyntaxKind) ||
          a.getKind() === SyntaxKind.ArrowFunction        ||
          a.getKind() === SyntaxKind.FunctionDeclaration  ||
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

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message: `[FCG008] ${exprText}() called inside a loop — fires one HTTP request per iteration. For N items this bills N API calls instead of one. Fix: collect all inputs first, then fan out with Promise.all() or use a bulk endpoint.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + exprText.length,
        severity: 'error',
        code: 'FCG008'
      });
    });

    return diagnostics;
  }
};
