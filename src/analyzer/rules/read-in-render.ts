/**
 * FCG009 — Firestore read in component body (outside useEffect)
 *
 * getDoc() / getDocs() called directly in a React component or hook body —
 * not inside useEffect, useCallback, useMemo, or an event handler — re-fires
 * on every render.  A component that re-renders 10 times per second (e.g.
 * during an animation or while the user types) runs 10 Firestore reads per
 * second with no caching, which compounds instantly.
 *
 * Fix: move the call inside useEffect (or a custom hook) so it only runs
 * when the relevant dependency changes, not on every render.
 */

import { Project, SyntaxKind, Node, SourceFile, CallExpression } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const FIRESTORE_READS = new Set(['getDoc', 'getDocs']);

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
  if (callee.getKind() === SyntaxKind.CallExpression)
    return /^httpsCallable[\s(<]/.test(callee.getText());
  if (callee.getKind() === SyntaxKind.Identifier)
    return callableNames.has(callee.getText());
  return false;
}

// Returns true only when the call sits directly in a React component's render
// body — i.e., the nearest enclosing function IS the component or hook itself.
// Any intermediate function (arrow fn, named fn, useEffect callback, onClick
// handler, helper like logAudit, etc.) means the call is NOT in render scope.
function isDirectlyInComponentRender(call: Node): boolean {
  for (const ancestor of call.getAncestors()) {
    const kind = ancestor.getKind();
    if (kind === SyntaxKind.FunctionDeclaration) {
      const name = (ancestor as any).getName?.() ?? '';
      return /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);
    }
    if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
      const parent = ancestor.getParent();
      if (parent?.getKind() === SyntaxKind.VariableDeclaration) {
        const name = (parent as any).getName?.() ?? '';
        if (/^[A-Z]/.test(name) || /^use[A-Z]/.test(name)) return true;
      }
      return false; // any other fn between call and component → not in render
    }
  }
  return false;
}

export const readInRenderRule: Rule = {
  id: 'FCG009',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (
      !sourceText.includes('getDoc') &&
      !sourceText.includes('getDocs') &&
      !sourceText.includes('httpsCallable')
    ) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const callableNames = findCallableNames(sf);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      const methodName = exprText.split('.').pop() ?? '';

      const isFirestoreRead = FIRESTORE_READS.has(methodName);
      const isCallable = isCallableInvocation(call as CallExpression, callableNames);
      if (!isFirestoreRead && !isCallable) return;

      if (!isDirectlyInComponentRender(call)) return;

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      const message = isCallable
        ? `[FCG009] Cloud Function invoked during component render — fires on every render cycle, ` +
          `billing one Cloud Function execution per render. Fix: move this call inside useEffect() ` +
          `or a user-triggered event handler.`
        : `[FCG009] ${methodName}() called in component body outside useEffect — re-fetches from ` +
          `Firestore on every render with no caching. Fix: move this call inside useEffect (or a ` +
          `custom hook) with the correct dependency array so it only runs when needed.`;

      diagnostics.push({
        message,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + exprText.length,
        severity: 'error',
        code: 'FCG009'
      });
    });

    return diagnostics;
  }
};
