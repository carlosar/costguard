/**
 * FCG007 — addEventListener without removeEventListener in useEffect cleanup
 *
 * Every addEventListener call inside a useEffect that has no cleanup return
 * leaks the listener on unmount. Each remount adds another copy. Over time
 * (navigation, auth changes, HMR) the same handler fires multiple times per
 * event and the component can never be garbage-collected.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

export const eventListenerCleanupRule: Rule = {
  id: 'FCG007',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!sourceText.includes('addEventListener')) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const exprText = call.getExpression().getText();
      if (exprText !== 'useEffect' && exprText !== 'useLayoutEffect') return;

      const args = call.getArguments();
      if (!args.length) return;

      const callback = args[0];
      const bodyText = callback.getText();
      if (!bodyText.includes('addEventListener')) return;

      const block =
        callback.getFirstChildByKind(SyntaxKind.Block) ??
        (callback.getKind() === SyntaxKind.Block ? callback : null);
      if (!block) return;

      const hasCleanupReturn = block
        .getChildrenOfKind(SyntaxKind.ReturnStatement).length > 0;
      if (hasCleanupReturn) return;

      // Point the squiggle at the addEventListener call
      const addCall = callback
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find(c => c.getExpression().getText().endsWith('addEventListener'));

      const target = addCall?.getExpression() ?? call.getExpression();
      const pos = target.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = target.getText();

      diagnostics.push({
        message: `[FCG007] addEventListener() registered without cleanup. Each remount adds a duplicate listener that never unsubscribes — handlers fire multiple times and the component leaks memory. Fix: return () => element.removeEventListener(event, handler); from the useEffect.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + name.length,
        severity: 'error',
        code: 'FCG007'
      });
    });

    return diagnostics;
  }
};
