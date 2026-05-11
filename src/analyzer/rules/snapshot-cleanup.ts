/**
 * FCG004 — onSnapshot listener without cleanup
 *
 * Detects onSnapshot() calls inside a useEffect callback that has no return
 * statement. Without a cleanup return, the listener stays alive after the
 * component unmounts: every mount adds a new subscription, Firestore keeps
 * sending reads, and the bill compounds with every navigation.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

export const snapshotCleanupRule: Rule = {
  id: 'FCG004',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
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
      if (!bodyText.includes('onSnapshot')) return;

      // Get the direct block body of the callback
      const block =
        callback.getFirstChildByKind(SyntaxKind.Block) ??
        (callback.getKind() === SyntaxKind.Block ? callback : null);

      if (!block) return;

      // A cleanup return exists if the top-level statements include a ReturnStatement
      const hasCleanupReturn = block
        .getChildrenOfKind(SyntaxKind.ReturnStatement).length > 0;

      if (hasCleanupReturn) return;

      // Find the onSnapshot call to point the squiggle at it
      const snapshotCall = callback
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find(c => c.getExpression().getText().endsWith('onSnapshot'));

      const target = snapshotCall?.getExpression() ?? call.getExpression();
      const pos = target.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = target.getText();

      diagnostics.push({
        message: `[FCG004] onSnapshot() registered without cleanup. Every mount adds a new listener that never unsubscribes — reads accumulate silently. Add: return () => unsubscribe(); as the last line of the useEffect callback.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + name.length,
        severity: 'error',
        code: 'FCG004'
      });
    });

    return diagnostics;
  }
};
