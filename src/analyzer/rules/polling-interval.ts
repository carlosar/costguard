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
 * Also detects recursive setTimeout polling, whether the poller is a variable
 * or a function declaration, and whether it re-schedules itself directly or by
 * re-entering the function that scheduled it:
 *
 *   const poll = async () => { await getDocs(...); setTimeout(poll, N); };
 *   function poll() { getDocs(...).then(() => setTimeout(poll, N)); }
 *   function poll() { setTimeout(async () => { await getDocs(...); poll(); }, N); }
 *
 * A one-shot setTimeout that happens to read Firestore is NOT polling and is
 * deliberately left alone.
 */

import { Project, SourceFile, SyntaxKind, Node } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const FIRESTORE_READ_RE = /\b(getDoc|getDocs)\s*[<(]/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Names of the functions/variables that lexically enclose this node. */
function enclosingNames(node: Node): string[] {
  const names: string[] = [];
  for (const ancestor of node.getAncestors()) {
    const fnDecl = ancestor.asKind(SyntaxKind.FunctionDeclaration);
    if (fnDecl?.getName()) { names.push(fnDecl.getName()!); continue; }
    const fnExpr = ancestor.asKind(SyntaxKind.FunctionExpression);
    if (fnExpr?.getName()) { names.push(fnExpr.getName()!); continue; }
    const varDecl = ancestor.asKind(SyntaxKind.VariableDeclaration);
    if (varDecl) names.push(varDecl.getName());
  }
  return names;
}

export const pollingIntervalRule: Rule = {
  id: 'FCG013',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!sourceText.includes('setInterval') && !sourceText.includes('setTimeout')) return [];
    if (!FIRESTORE_READ_RE.test(sourceText)) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];
    const reportedCallees = new Set<string>();

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      const isInterval = exprText === 'setInterval';
      const isTimeout  = exprText === 'setTimeout';
      if (!isInterval && !isTimeout) return;

      const args = call.getArguments();
      if (!args.length) return;

      // Resolve the callback body text
      let callbackText = args[0].getText();
      let calleeName: string | undefined;
      if (args[0].getKind() === SyntaxKind.Identifier) {
        calleeName = callbackText;
        const varInit = sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration)
          .find(v => v.getName() === calleeName)?.getInitializer()?.getText();
        // A function declaration is not a VariableDeclaration, so without this
        // lookup `function poll() {...}; setTimeout(poll, N)` stays invisible.
        const fnDeclText = sf.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)
          .find(f => f.getName() === calleeName)?.getText();
        callbackText = varInit ?? fnDeclText ?? callbackText;
      }

      if (!FIRESTORE_READ_RE.test(callbackText)) return;

      // For setTimeout, only flag genuine polling: either the callback
      // re-schedules itself, or it re-enters the function that scheduled it.
      // A one-shot delayed read must stay clean.
      if (isTimeout) {
        const reschedules = callbackText.includes('setTimeout(');
        const enclosing   = enclosingNames(call);
        const selfRef =
          (calleeName !== undefined && enclosing.includes(calleeName)) ||
          enclosing.some(n => new RegExp(`\\b${escapeRe(n)}\\s*\\(`).test(callbackText));
        if (!reschedules && !selfRef) return;
      }

      // One diagnostic per named poller — otherwise a self-rescheduling
      // function is reported at its own setTimeout and at every call site.
      if (calleeName) {
        if (reportedCallees.has(calleeName)) return;
        reportedCallees.add(calleeName);
      }

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
