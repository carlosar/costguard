/**
 * FCG015 — FieldValue atomics not used for array/counter mutations
 *
 * Reading a document, mutating an array or numeric field, then writing the
 * whole document back is a read-modify-write pattern that:
 *   - Costs 1 read + 1 write instead of 0 reads + 1 write
 *   - Loses concurrent updates (last-write-wins race condition)
 *
 * Firestore provides atomic server-side operations that eliminate the read:
 *   arrayUnion(item)   — adds to array without reading it first
 *   arrayRemove(item)  — removes from array without reading it first
 *   increment(n)       — increments a counter without reading it first
 *
 * Anti-pattern A (array):
 *   const data = (await getDoc(ref)).data();
 *   data.tags.push(newTag);
 *   await updateDoc(ref, { tags: data.tags });   ← use arrayUnion(newTag)
 *
 * Anti-pattern B (counter):
 *   const data = (await getDoc(ref)).data();
 *   await updateDoc(ref, { count: data.count + 1 });  ← use increment(1)
 */

import { Project, SourceFile, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const WRITE_CALLS = new Set(['setDoc', 'updateDoc', 'addDoc']);

// Already using atomic operations — skip
const ALREADY_ATOMIC_RE = /\b(arrayUnion|arrayRemove|increment|serverTimestamp|deleteField)\s*\(/;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-identifier match. A plain substring test is unsafe here: a mutated
 * counter named `i` "appears" inside words like `items` or `name`, which would
 * tie an unrelated write to it and report a loop counter as a Firestore field.
 */
function mentions(haystack: string, name: string): boolean {
  return new RegExp(`\\b${escapeRe(name)}\\b`).test(haystack);
}

export const fieldValueAtomicRule: Rule = {
  id: 'FCG015',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    // Fast exit: needs both a doc read and a mutation pattern
    const hasRead = sourceText.includes('getDoc') || sourceText.includes('.data()');
    const hasArrayMutation = sourceText.includes('.push(') || sourceText.includes('.concat(') || sourceText.includes('.splice(');
    // Counter work takes two shapes: an in-place operator (count += 1, count++)
    // or arithmetic written straight into the update ({ count: data.count + 1 }).
    // Only the first was recognised here, which made the second — the form this
    // rule's own docs use as the example — impossible to report.
    const hasCounterMutation = /\+\+|--|\+=|-=|[\w.]+\s*[+-]\s*1\b/.test(sourceText);
    if (!hasRead || (!hasArrayMutation && !hasCounterMutation)) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText   = call.getExpression().getText();
      const methodName = exprText.split('.').pop() ?? '';

      // Only inspect write calls
      const isModularWrite = WRITE_CALLS.has(methodName);
      // Check only exprText (receiver + method, no args) to avoid false positives
      // on Map.prototype.set(), plain-object helpers, etc. that share the method name.
      const isCompatWrite  = (methodName === 'set' || methodName === 'update') && (
        /\bcollection\s*\(/.test(exprText) ||       // db.collection(…)…set
        /\bdoc\s*\(/.test(exprText)                 // db.collection(…).doc(…).set
        // Note: /Ref\.(set|update)$/ removed — too broad; flags Map/cache variables named *Ref
      );

      if (!isModularWrite && !isCompatWrite) return;

      // Get the enclosing function body for scope-level heuristic
      const enclosingFn =
        call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        call.getFirstAncestorByKind(SyntaxKind.ArrowFunction)       ||
        call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
      if (!enclosingFn) return;

      const scopeText = enclosingFn.getText();

      // Skip if already using atomic operations
      if (ALREADY_ATOMIC_RE.test(scopeText)) return;

      // Skip if inside a writeBatch context
      if (scopeText.includes('writeBatch')) return;

      // Must have a Firestore read in the same scope
      if (!scopeText.includes('getDoc') && !scopeText.includes('.data()')) return;

      // Pattern A — array mutation
      if (
        (scopeText.includes('.push(') || scopeText.includes('.concat(') || scopeText.includes('.splice(')) &&
        scopeText.includes('.data()')
      ) {
        const argText = call.getArguments().map(a => a.getText()).join(', ');
        if (ALREADY_ATOMIC_RE.test(argText)) return;
        // Require write args to reference the same variable that was mutated — prevents
        // false positives where push() is on a local/helper array unrelated to the write
        const mutatedVars = [...scopeText.matchAll(/\b(\w+)\.(?:push|concat|splice)\s*\(/g)].map(m => m[1]);
        if (!mutatedVars.some(v => mentions(argText, v))) return;

        const pos = call.getExpression().getStart();
        const { line, column } = sf.getLineAndColumnAtPos(pos);

        diagnostics.push({
          message: `[FCG015] Array field mutated with .push()/.concat() then written back with ${methodName}() — this read-modify-write pattern costs 1 read + 1 write and has race conditions under concurrent updates. Fix: use updateDoc(ref, { field: arrayUnion(newItem) }) — atomic, no read needed, race-safe.`,
          line: line - 1,
          startChar: column - 1,
          endChar: column - 1 + exprText.length,
          severity: 'warning',
          code: 'FCG015'
        });
        return; // one diagnostic per write call is enough
      }

      // Pattern B — counter mutation
      if (scopeText.includes('.data()')) {
        const argText = call.getArguments().map(a => a.getText()).join(', ');
        if (ALREADY_ATOMIC_RE.test(argText)) return;

        // Either the arithmetic is in the write itself ({ count: data.count + 1 }),
        // or a counter was mutated in place and that same value is written back
        // (data.count += 1 … { count: data.count }). Tying the write args to the
        // mutated variable keeps an unrelated local counter from triggering this.
        const mutatedCounters = [...scopeText.matchAll(/\b([\w.]+)\s*(?:\+\+|--|\+=|-=)/g)].map(m => m[1]);
        const argHasArithmetic = /[\w.]+\s*[+-]\s*1\b|[\w.]+(?:\+\+|--)/.test(argText);
        const argRefsMutatedCounter = mutatedCounters.some(v => mentions(argText, v));
        if (!argHasArithmetic && !argRefsMutatedCounter) return;

        const pos = call.getExpression().getStart();
        const { line, column } = sf.getLineAndColumnAtPos(pos);

        diagnostics.push({
          message: `[FCG015] Numeric field incremented then written back with ${methodName}() — this read-modify-write pattern costs 1 read + 1 write and loses concurrent increments. Fix: use updateDoc(ref, { field: increment(1) }) — atomic, no read needed, correct under concurrent updates.`,
          line: line - 1,
          startChar: column - 1,
          endChar: column - 1 + exprText.length,
          severity: 'warning',
          code: 'FCG015'
        });
      }
    });

    return diagnostics;
  }
};
