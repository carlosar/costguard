/**
 * FCG021 — Unbounded Realtime Database read
 *
 * RTDB bills by bytes downloaded, not by document. A listener without a limit
 * ships the whole subtree on the first callback and again on every change, and
 * a listener at the root ships the entire database. Firebase names both in its
 * optimization guidance: "Don't listen at the database root" and "add queries
 * to limit the data that your listen operations return".
 *
 *   onValue(ref(db, '/'), cb);          // the whole database
 *   onValue(ref(db, 'messages'), cb);   // the whole list, forever
 *
 * Unlike Firestore, RTDB paths carry no syntactic hint of whether they address
 * one node or a list, so this rule uses the last path segment: a dynamic final
 * segment (`users/${uid}`) addresses a single node and is left alone, while a
 * static one (`messages`, `rooms/${id}/messages`) is treated as a list. A path
 * that is not a literal at all is skipped entirely — a false negative is far
 * cheaper here than flagging every single-node read in a codebase.
 */

import { Project, SyntaxKind, SourceFile, Node } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const MODULAR_READS = new Set([
  'onValue', 'onChildAdded', 'onChildChanged', 'onChildRemoved', 'onChildMoved', 'get',
]);
const RTDB_EVENTS = new Set(['value', 'child_added', 'child_changed', 'child_removed', 'child_moved']);
const COMPAT_READS = new Set(['on', 'once']);

// Constraints that actually bound how much data comes back
const BOUNDED_RE = /\b(limitToFirst|limitToLast|equalTo)\s*\(/;

interface PathInfo { isRoot: boolean; flag: boolean; }

/** Decide whether a path literal addresses the root, a list, or a single node. */
function classifyPath(node: Node | undefined): PathInfo {
  if (!node) return { isRoot: true, flag: true };          // ref(db) with no path

  const kind = node.getKind();
  const text = node.getText();

  if (kind === SyntaxKind.StringLiteral || kind === SyntaxKind.NoSubstitutionTemplateLiteral) {
    const raw = text.slice(1, -1).trim();
    if (raw === '' || raw === '/') return { isRoot: true, flag: true };
    return { isRoot: false, flag: true };
  }

  if (kind === SyntaxKind.TemplateExpression) {
    // Dynamic final segment => a specific node, e.g. `users/${uid}`
    const raw = text.slice(1, -1);
    return { isRoot: false, flag: !raw.trimEnd().endsWith('}') };
  }

  // Concatenation, a variable, anything non-literal: not enough information.
  return { isRoot: false, flag: false };
}

/** Find the ref() call inside a query/ref expression and return its path argument. */
function refPathNode(arg: Node): { found: boolean; path: Node | undefined } {
  const calls = [
    ...(arg.getKind() === SyntaxKind.CallExpression ? [arg] : []),
    ...arg.getDescendantsOfKind(SyntaxKind.CallExpression),
  ];
  for (const c of calls) {
    const call = c.asKind(SyntaxKind.CallExpression);
    if (!call) continue;
    const name = call.getExpression().getText();
    if (name === 'ref') {                       // modular: ref(db, path)
      return { found: true, path: call.getArguments()[1] };
    }
    if (name.endsWith('.ref')) {                // compat: db.ref(path)
      return { found: true, path: call.getArguments()[0] };
    }
  }
  return { found: false, path: undefined };
}

export const rtdbUnboundedReadRule: Rule = {
  id: 'FCG021',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!/\bref\s*\(|\.ref\s*\(/.test(sourceText)) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      const methodName = exprText.split('.').pop() ?? '';
      const args = call.getArguments();
      if (!args.length && !MODULAR_READS.has(exprText)) return;

      let subject: Node | undefined;

      if (MODULAR_READS.has(exprText)) {
        subject = args[0];
      } else if (COMPAT_READS.has(methodName) && exprText.includes('.')) {
        // db.ref('x').on('value', cb) — the event name proves this is RTDB
        const eventArg = args[0];
        const evt = eventArg?.getKind() === SyntaxKind.StringLiteral
          ? eventArg.getText().slice(1, -1)
          : '';
        if (!RTDB_EVENTS.has(evt)) return;
        subject = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression)?.getExpression();
      } else {
        return;
      }

      if (!subject) return;

      const { found, path } = refPathNode(subject);
      if (!found) return;                                   // not an RTDB ref at all

      const subjectText = subject.getText();
      if (BOUNDED_RE.test(subjectText)) return;             // limited query

      const { isRoot, flag } = classifyPath(path);
      if (!flag) return;

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message: isRoot
          ? `[FCG021] This Realtime Database listener is attached to the database root, so every callback downloads your ENTIRE database — and RTDB bills by bytes transferred. Fix: attach the listener to the deepest path you actually need, and bound it with limitToFirst()/limitToLast().`
          : `[FCG021] Unbounded Realtime Database read — no limitToFirst()/limitToLast()/equalTo() on this path. The whole subtree is downloaded on the first callback and again whenever any descendant changes, and RTDB bills by bytes transferred. Fix: wrap the ref in query(..., limitToLast(N)) (or .limitToLast(N) on the compat API).`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + exprText.length,
        severity: isRoot ? 'error' : 'warning',
        code: 'FCG021'
      });
    });

    return diagnostics;
  }
};
