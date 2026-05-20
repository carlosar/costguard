/**
 * FCG010 — Compound render-loop: unstable dep + expensive operation in same useEffect
 *
 * When a useEffect has both an unstable dependency (new reference every render)
 * AND an expensive operation in its body (Firestore read, fetch, axios), the
 * two problems amplify each other into an infinite billing loop:
 *
 *   unstable dep → effect re-runs every render
 *   re-run → fires Firestore/HTTP read
 *   read result → triggers state update
 *   state update → re-render → unstable dep is new again → repeat
 *
 * This is the exact pattern behind the $95 Firebase bill: getFirebaseConfig()
 * in the dep array caused adminGetStats() to read dunning_log on every render,
 * producing 98M reads before it was caught.
 *
 * FCG001 and FCG002 still fire individually. This rule fires in addition to
 * surface the compound risk explicitly at the useEffect level.
 */

import { Project, SyntaxKind, Node, SourceFile } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const STABLE_WRAPPERS = new Set(['useMemo', 'useCallback', 'useRef', 'useState', 'useReducer']);

function findCallableNames(sf: SourceFile): Set<string> {
  const names = new Set<string>();
  sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(decl => {
    const init = decl.getInitializer()?.getText() ?? '';
    if (/^httpsCallable[\s(<]/.test(init)) names.add(decl.getName());
  });
  return names;
}

// Operations whose presence in an effect body makes unstable deps dangerous
const EXPENSIVE_OP_RE = /\b(getDoc|getDocs|onSnapshot|fetch|axios)\s*[.(]/;

function unstableDepName(depsArg: Node, varDecls: Map<string, Node>): string | null {
  for (const depId of depsArg.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = depId.getText();
    const init = varDecls.get(name);
    if (!init) continue;

    const kind = init.getKind();
    if (
      kind === SyntaxKind.ObjectLiteralExpression ||
      kind === SyntaxKind.ArrayLiteralExpression ||
      kind === SyntaxKind.ArrowFunction ||
      kind === SyntaxKind.FunctionExpression
    ) return name;

    if (kind === SyntaxKind.CallExpression) {
      const callText = init.getText();
      if (!STABLE_WRAPPERS.has(callText.split('(')[0])) return name;
    }
  }
  return null;
}

export const compoundRenderLoopRule: Rule = {
  id: 'FCG010',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!sourceText.includes('useEffect')) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const callableNames = findCallableNames(sf);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      if (call.getExpression().getText() !== 'useEffect') return;

      const args = call.getArguments();
      if (args.length < 2) return;

      const callback = args[0];
      const depsArg  = args[1];
      if (depsArg.getKind() !== SyntaxKind.ArrayLiteralExpression) return;

      // Does the effect body contain an expensive operation or Cloud Function call?
      const bodyText = callback.getText();
      const callableMatch = callableNames.size > 0
        ? [...callableNames].find(name => bodyText.includes(name + '('))
        : undefined;
      if (!EXPENSIVE_OP_RE.test(bodyText) && !callableMatch) return;

      // Does the effect have an unstable dep?
      const enclosingFn =
        call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        call.getFirstAncestorByKind(SyntaxKind.ArrowFunction)       ||
        call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
      if (!enclosingFn) return;

      const varDecls = new Map<string, Node>();
      enclosingFn.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(vd => {
        varDecls.set(vd.getName(), vd.getInitializer() ?? vd);
      });

      const badDep = unstableDepName(depsArg, varDecls);
      if (!badDep) return;

      // Identify the expensive operation for the message
      const opMatch = EXPENSIVE_OP_RE.exec(bodyText);
      const op = opMatch?.[1] ?? callableMatch ?? 'an expensive operation';

      const pos = call.getExpression().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message:
          `[FCG010] COMPOUND RISK — '${badDep}' is a new reference every render (unstable dep) ` +
          `AND this effect calls ${op}(). Every render re-runs the effect, fires ${op}(), ` +
          `which may update state, triggering another render — an infinite billing loop. ` +
          `Fix the unstable dep first: wrap '${badDep}' in useMemo/useCallback, or move it outside the component.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + 'useEffect'.length,
        severity: 'error',
        code: 'FCG010'
      });
    });

    return diagnostics;
  }
};
