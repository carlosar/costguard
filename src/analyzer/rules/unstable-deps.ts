/**
 * FCG001 — Unstable useEffect dependency
 *
 * Detects objects, arrays, functions, and call-expression results declared
 * inline in a React component body (not wrapped in useMemo/useCallback) that
 * are placed in a useEffect dep array.  Every render creates a new reference,
 * so the effect re-runs on every render — the root cause of the $95 Firestore
 * bill in SoarOne (getFirebaseConfig() in deps → adminGetStats read loop).
 */

import { Project, SyntaxKind, Node } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const STABLE_WRAPPERS = new Set(['useMemo', 'useCallback', 'useRef', 'useState', 'useReducer']);

export const unstableDepsRule: Rule = {
  id: 'FCG001',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 /* ReactJSX */ }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      if (call.getExpression().getText() !== 'useEffect') return;

      const args = call.getArguments();
      if (args.length < 2) return;

      const depsArg = args[1];
      if (depsArg.getKind() !== SyntaxKind.ArrayLiteralExpression) return;

      // The enclosing React component / hook function
      const enclosingFn =
        call.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) ||
        call.getFirstAncestorByKind(SyntaxKind.ArrowFunction) ||
        call.getFirstAncestorByKind(SyntaxKind.FunctionExpression);
      if (!enclosingFn) return;

      // Collect all top-level variable declarations in that function
      const varDecls = new Map<string, Node>();
      enclosingFn.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(vd => {
        varDecls.set(vd.getName(), vd.getInitializer() ?? vd);
      });

      // Check every identifier in the deps array
      depsArg.getDescendantsOfKind(SyntaxKind.Identifier).forEach(depId => {
        const name = depId.getText();
        const init = varDecls.get(name);
        if (!init) return;

        const kind = init.getKind();
        let isUnstable = false;
        let fix = '';

        if (kind === SyntaxKind.ObjectLiteralExpression) {
          isUnstable = true;
          fix = `Wrap in useMemo(() => ({ ... }), [])`;
        } else if (kind === SyntaxKind.ArrayLiteralExpression) {
          isUnstable = true;
          fix = `Wrap in useMemo(() => [ ... ], [])`;
        } else if (kind === SyntaxKind.ArrowFunction || kind === SyntaxKind.FunctionExpression) {
          isUnstable = true;
          fix = `Wrap in useCallback(() => { ... }, [])`;
        } else if (kind === SyntaxKind.CallExpression) {
          const callText = init.getText();
          // Already stable if wrapped
          if (!STABLE_WRAPPERS.has(callText.split('(')[0])) {
            isUnstable = true;
            fix = `Wrap in useMemo(() => ${callText}, [])`;
          }
        }

        if (isUnstable) {
          const pos = depId.getStart();
          const { line, column } = sf.getLineAndColumnAtPos(pos);
          diagnostics.push({
            message: `[FCG001] '${name}' is a new reference on every render — this useEffect will re-run every render, risking an infinite loop or runaway Firestore reads. Fix: ${fix}`,
            line: line - 1,
            startChar: column - 1,
            endChar: column - 1 + name.length,
            severity: 'error',
            code: 'FCG001'
          });
        }
      });
    });

    return diagnostics;
  }
};
