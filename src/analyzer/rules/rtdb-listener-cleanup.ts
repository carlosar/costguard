/**
 * FCG022 — Realtime Database listener without cleanup
 *
 * The RTDB counterpart to FCG004. A listener opened inside useEffect with no
 * cleanup return survives unmount, so every mount stacks another subscription
 * on the same path. RTDB bills by bytes downloaded, so N stale listeners means
 * N copies of every subsequent change, forever.
 *
 *   useEffect(() => {
 *     onValue(query(ref(db, 'messages'), limitToLast(20)), cb);   // never detached
 *   }, []);
 *
 * FCG004 only knows about Firestore's onSnapshot, so before this rule the
 * entire RTDB surface leaked silently. Kept as its own code rather than folded
 * into FCG004 so the two can be suppressed independently.
 */

import { Project, SyntaxKind, SourceFile } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const MODULAR_SUBSCRIBES = ['onValue', 'onChildAdded', 'onChildChanged', 'onChildRemoved', 'onChildMoved'];
// `.on('value', ...)` — the event name is what proves this is RTDB and not an
// EventEmitter, a socket, or any other object with an `on` method.
const COMPAT_SUBSCRIBE_RE = /\.on\s*\(\s*['"](value|child_added|child_changed|child_removed|child_moved)['"]/;

export const rtdbListenerCleanupRule: Rule = {
  id: 'FCG022',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!sourceText.includes('useEffect') && !sourceText.includes('useLayoutEffect')) return [];

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
      if (exprText !== 'useEffect' && exprText !== 'useLayoutEffect') return;

      const args = call.getArguments();
      if (!args.length) return;

      const callback = args[0];
      const bodyText = callback.getText();

      const modular = MODULAR_SUBSCRIBES.find(fn => new RegExp(`\\b${fn}\\s*\\(`).test(bodyText));
      const isCompat = COMPAT_SUBSCRIBE_RE.test(bodyText);
      if (!modular && !isCompat) return;

      const block =
        callback.getFirstChildByKind(SyntaxKind.Block) ??
        (callback.getKind() === SyntaxKind.Block ? callback : null);
      if (!block) return;

      // Same definition of "has cleanup" as FCG004: a top-level return.
      if (block.getChildrenOfKind(SyntaxKind.ReturnStatement).length > 0) return;

      const subscribeCall = callback
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find(c => {
          const t = c.getExpression().getText();
          return MODULAR_SUBSCRIBES.includes(t) || /\.on$/.test(t);
        });

      const target = subscribeCall?.getExpression() ?? call.getExpression();
      const pos = target.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = modular ?? `${target.getText()}('value', ...)`;

      diagnostics.push({
        message:
          `[FCG022] Realtime Database listener registered without cleanup (${name}). It stays attached after the ` +
          `component unmounts, so every remount adds another listener on the same path and each one re-downloads ` +
          `every change — RTDB bills by bytes transferred. Fix: return the unsubscribe function from the effect ` +
          `(\`const unsub = onValue(...); return () => unsub();\`) or detach it with \`return () => ref.off('value', cb);\`.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + target.getText().length,
        severity: 'error',
        code: 'FCG022'
      });
    });

    return diagnostics;
  }
};
