/**
 * FCG013 — Polling Firestore with setInterval (use onSnapshot instead)
 *
 * Wrapping getDoc()/getDocs() in setInterval() polls Firestore on every tick
 * regardless of whether the data has changed.  Every tick is a billed read.
 *
 * onSnapshot() is the correct alternative: it opens a single persistent
 * connection and only fires your callback when the document actually changes —
 * zero billed reads between updates.
 *
 * Also detects the recursive setTimeout polling pattern:
 * function poll() { getDocs(...).then(() => setTimeout(poll, N)); }
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const FIRESTORE_READ_RE = /\b(getDoc|getDocs)\s*[<(]/;

export const pollingIntervalRule: Rule = {
  id: 'FCG013',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!sourceText.includes('setInterval') && !sourceText.includes('setTimeout')) return [];
    if (!FIRESTORE_READ_RE.test(sourceText)) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      const isInterval = exprText === 'setInterval';
      const isTimeout  = exprText === 'setTimeout';
      if (!isInterval && !isTimeout) return;

      const args = call.getArguments();
      if (!args.length) return;

      // Resolve the callback body text
      let callbackText = args[0].getText();
      if (args[0].getKind() === SyntaxKind.Identifier) {
        const name = callbackText;
        const decl = sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
          .find(v => v.getName() === name);
        callbackText = decl?.getInitializer()?.getText() ?? callbackText;
      }

      if (!FIRESTORE_READ_RE.test(callbackText)) return;

      // For setTimeout, only flag the recursive polling pattern
      // (callback re-schedules itself with another setTimeout)
      if (isTimeout && !callbackText.includes('setTimeout(')) return;

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = exprText;

      diagnostics.push({
        message: `[FCG013] ${name}() is polling Firestore — getDoc/getDocs fires on every tick regardless of whether data changed. Every tick is a billed read. Fix: replace with onSnapshot() which fires only when the document actually changes, eliminating all polling reads between updates.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + name.length,
        severity: 'warning',
        code: 'FCG013'
      });
    });

    return diagnostics;
  }
};
