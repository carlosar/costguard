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

// Maps each useState setter name to the state variable name it updates,
// e.g. `const [users, setUsers] = useState([])` -> setUsers -> users
function findStateSetters(enclosingFn: Node): Map<string, string> {
  const setters = new Map<string, string>();
  enclosingFn.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(vd => {
    const nameNode = vd.getNameNode();
    if (nameNode.getKind() !== SyntaxKind.ArrayBindingPattern) return;

    const init = vd.getInitializer();
    if (!init || init.getKind() !== SyntaxKind.CallExpression) return;
    const callee = init.asKindOrThrow(SyntaxKind.CallExpression).getExpression().getText();
    if (callee !== 'useState' && !callee.endsWith('.useState')) return;

    const elements = nameNode.asKindOrThrow(SyntaxKind.ArrayBindingPattern).getElements();
    if (elements.length < 2) return;
    const [stateEl, setterEl] = elements;
    if (stateEl.getKind() !== SyntaxKind.BindingElement) return;
    if (setterEl.getKind() !== SyntaxKind.BindingElement) return;

    const stateName = stateEl.asKindOrThrow(SyntaxKind.BindingElement).getName();
    const setterName = setterEl.asKindOrThrow(SyntaxKind.BindingElement).getName();
    setters.set(setterName, stateName);
  });
  return setters;
}

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

      // Does the effect call a state setter for a state variable that is also
      // in its own deps array? That's a self-triggering infinite loop:
      // effect runs -> setState -> re-render -> effect sees "new" dep -> runs again.
      const stateSetters = findStateSetters(enclosingFn);
      const callbackBody = args[0].getText();
      depsArg.getDescendantsOfKind(SyntaxKind.Identifier).forEach(depId => {
        const name = depId.getText();
        const selfSettingSetter = [...stateSetters.entries()].find(
          ([, stateName]) => stateName === name
        )?.[0];
        if (!selfSettingSetter) return;
        if (!new RegExp(`\\b${selfSettingSetter}\\s*\\(`).test(callbackBody)) return;

        const pos = depId.getStart();
        const { line, column } = sf.getLineAndColumnAtPos(pos);
        diagnostics.push({
          message: `[FCG001] '${name}' is updated inside this same useEffect (via ${selfSettingSetter}) while also being listed as a dependency — the state update triggers a re-render, which re-runs the effect, which updates the state again: an infinite loop. Fix: remove '${name}' from the dependency array, or restructure the effect so it doesn't depend on state it sets.`,
          line: line - 1,
          startChar: column - 1,
          endChar: column - 1 + name.length,
          severity: 'error',
          code: 'FCG001'
        });
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
