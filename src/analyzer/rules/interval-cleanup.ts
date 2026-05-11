/**
 * FCG006 — setInterval without clearInterval in useEffect
 *
 * Detects setInterval() calls inside a useEffect callback that has no return
 * statement.  Without cleanup, every component mount starts a new interval that
 * never stops — after N mounts there are N concurrent intervals all firing,
 * each potentially triggering Firestore reads or API calls.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

export const intervalCleanupRule: Rule = {
  id: 'FCG006',

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
      if (!bodyText.includes('setInterval')) return;

      const block =
        callback.getFirstChildByKind(SyntaxKind.Block) ??
        (callback.getKind() === SyntaxKind.Block ? callback : null);

      if (!block) return;

      const hasCleanupReturn = block
        .getChildrenOfKind(SyntaxKind.ReturnStatement).length > 0;

      if (hasCleanupReturn) return;

      const intervalCall = callback
        .getDescendantsOfKind(SyntaxKind.CallExpression)
        .find(c => c.getExpression().getText() === 'setInterval');

      const target = intervalCall?.getExpression() ?? call.getExpression();
      const pos = target.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = target.getText();

      diagnostics.push({
        message: `[FCG006] setInterval() called without cleanup. Store the ID and add: return () => clearInterval(id); — otherwise each component mount adds another interval that runs forever, multiplying any polling costs.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + name.length,
        severity: 'error',
        code: 'FCG006'
      });
    });

    return diagnostics;
  }
};
