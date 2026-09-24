/**
 * FCG018 — useEffect with no dependency array performing an expensive operation
 *
 * `useEffect(() => { ... })` with the dependency array omitted re-runs after
 * EVERY render. When the body reads Firestore, opens a listener, or calls a
 * billed API, and the result updates state, each run triggers another render,
 * which runs the effect again — a self-sustaining billing loop that needs no
 * user interaction to keep going.
 *
 * This is the pattern behind the widely-reported "I DoS'd my own backend"
 * incident, where a missing `[]` burned a 50k read/day quota in minutes.
 *
 * Deliberately separate from FCG001/FCG003/FCG010: those rules analyze the
 * CONTENTS of a dependency array and intentionally skip effects that have no
 * array at all (see the "does not fire when there is no deps array" test in
 * tests/rules/fcg001.test.ts). An omitted array is a different defect, so it
 * gets its own code that users can suppress independently.
 *
 * Only fires when the effect body does expensive work — a no-deps effect that
 * just sets document.title is a style issue, not a cost issue.
 */

import { Project, SyntaxKind, SourceFile } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Same operation set FCG010 treats as expensive, kept in sync deliberately.
const EXPENSIVE_OP_RE = /\b(getDoc|getDocs|onSnapshot|fetch|axios)\s*[.(]/;

function findCallableNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(decl => {
    const init = decl.getInitializer()?.getText() ?? '';
    if (/^httpsCallable[\s(<]/.test(init)) names.add(decl.getName());
  });
  return names;
}

export const missingDepsArrayRule: Rule = {
  id: 'FCG018',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!sourceText.includes('useEffect')) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const callableNames = findCallableNames(sf);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      if (call.getExpression().getText() !== 'useEffect') return;

      const args = call.getArguments();
      if (args.length === 0) return;
      // A second argument means the deps array is present (even if it is a
      // variable rather than a literal) — that is FCG001/FCG010 territory.
      if (args.length >= 2) return;

      const bodyText = args[0].getText();
      const callableMatch = callableNames.size > 0
        ? [...callableNames].find(name => bodyText.includes(name + '('))
        : undefined;
      if (!EXPENSIVE_OP_RE.test(bodyText) && !callableMatch) return;

      const op = EXPENSIVE_OP_RE.exec(bodyText)?.[1] ?? callableMatch ?? 'an expensive operation';

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message:
          `[FCG018] This useEffect has no dependency array, so it re-runs after every render — ` +
          `and its body calls ${op}(). If the result updates state, that render triggers the effect again: ` +
          `an unbounded read loop that runs as fast as the browser can render. ` +
          `Fix: add a dependency array — use [] to run once on mount, or list the values the effect actually depends on.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + 'useEffect'.length,
        severity: 'error',
        code: 'FCG018'
      });
    });

    return diagnostics;
  }
};
