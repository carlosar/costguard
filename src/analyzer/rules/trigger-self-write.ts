/**
 * FCG019 — Cloud Function trigger writes back to the document that fired it
 *
 * A Firestore/RTDB trigger that writes to its own triggering document re-fires
 * itself. Each run bills a function invocation, a write, and usually a read —
 * and nothing stops it. This is the failure behind the widely-reported $72k
 * overnight bill, and one of only two causes Firebase names explicitly in its
 * "avoid surprise bills" guidance (FCG002 covers the other).
 *
 *   export const touch = onDocumentWritten('users/{id}', async (event) => {
 *     await event.data.after.ref.update({ updatedAt: Date.now() });  // ← loops
 *   });
 *
 * Two deliberate precision limits, both verified against fixtures:
 *
 * 1. Only `written` and `updated` triggers can loop. A write-back inside an
 *    onCreate handler produces an UPDATE event, not another CREATE, so it
 *    terminates; same for onDelete. Flagging those would be a false positive.
 *
 * 2. A handler that references `before` is doing a before/after comparison —
 *    the standard way to exit early when nothing relevant changed. Treated as
 *    guarded and left alone. This errs toward silence: a broken guard still
 *    loops, but a false positive on correct code is the worse failure for a
 *    rule that gates commits.
 */

import { Project, SyntaxKind, SourceFile, Node } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Trigger handlers whose own write re-fires them
const LOOPING_TRIGGERS = new Set([
  'onDocumentWritten', 'onDocumentUpdated',   // v2 Firestore
  'onValueWritten', 'onValueUpdated',         // v2 RTDB
]);

// v1: functions.firestore.document(...).onWrite(...) / .onUpdate(...)
// Tested against whitespace-stripped callee text — these chains are usually
// split across lines, so the segments are not contiguous in the source.
const V1_LOOPING_METHODS = new Set(['onWrite', 'onUpdate']);
const V1_TRIGGER_SOURCE_RE = /\.(firestore\.document|database\.ref(WithOptions)?)\(/;

// Writes that target an existing document path
const WRITE_METHODS = new Set(['set', 'update', 'delete', 'create']);

// A ref reached from the event payload — i.e. the triggering document itself.
// Anchored at the root so `db.collection('logs').doc(id)` never matches.
const EVENT_REF_RE = /^(event|change|snap|snapshot|after)\b[\w.]*\.ref$/;

/** The handler is the last function-valued argument (v1 passes it first, v2 last). */
function handlerArg(args: Node[]): Node | undefined {
  for (let i = args.length - 1; i >= 0; i--) {
    const k = args[i].getKind();
    if (k === SyntaxKind.ArrowFunction || k === SyntaxKind.FunctionExpression) return args[i];
  }
  return undefined;
}

export const triggerSelfWriteRule: Rule = {
  id: 'FCG019',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!/on(DocumentWritten|DocumentUpdated|ValueWritten|ValueUpdated|Write|Update)\s*[(<]/.test(sourceText)) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const calleeText = call.getExpression().getText();
      const methodName = calleeText.split('.').pop() ?? '';

      const isV2 = LOOPING_TRIGGERS.has(methodName);
      const isV1 = V1_LOOPING_METHODS.has(methodName)
        && V1_TRIGGER_SOURCE_RE.test(calleeText.replace(/\s+/g, ''));
      if (!isV2 && !isV1) return;

      const handler = handlerArg(call.getArguments());
      if (!handler) return;

      const bodyText = handler.getText();

      // Guarded: the handler compares before/after and can exit early.
      if (/\bbefore\b/.test(bodyText)) return;

      // Local names bound to the event's own ref, e.g. `const ref = event.data.after.ref`
      const aliases = new Set<string>();
      handler.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(vd => {
        const init = vd.getInitializer()?.getText();
        if (init && EVENT_REF_RE.test(init)) aliases.add(vd.getName());
      });

      for (const inner of handler.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const prop = inner.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
        if (!prop || !WRITE_METHODS.has(prop.getName())) continue;

        const target = prop.getExpression().getText();
        if (!EVENT_REF_RE.test(target) && !aliases.has(target)) continue;

        const pos = inner.getExpression().getStart();
        const { line, column } = sf.getLineAndColumnAtPos(pos);

        diagnostics.push({
          message:
            `[FCG019] This ${methodName} trigger writes back to the document that fired it ` +
            `(${target}.${prop.getName()}()). The write re-fires the same trigger, which writes again — ` +
            `an unbounded server-side loop billing a function invocation and a write every cycle, with no user ` +
            `traffic required. Fix: compare event.data.before and event.data.after and return early when the ` +
            `fields you care about are unchanged, or move the write to a different document.`,
          line: line - 1,
          startChar: column - 1,
          endChar: column - 1 + target.length,
          severity: 'error',
          code: 'FCG019'
        });
        break;   // one diagnostic per trigger, not per write
      }
    });

    return diagnostics;
  }
};
