/**
 * FCG014 — Client-side filtering of an unfiltered collection read
 *
 * Calling getDocs() or .get() on a collection with no .where() clause fetches
 * every document in the collection to the client.  Applying .filter()/.find()
 * afterwards discards most of those documents — but every discarded document
 * still counts as a billed Firestore read.
 *
 * Example anti-pattern:
 *   const snap = await getDocs(collection(db, 'orders'));
 *   const pending = snap.docs.filter(d => d.data().status === 'pending');
 *
 * Fix: move the predicate into a .where() clause so Firestore does the
 * filtering server-side and only the matching documents are transferred:
 *   const q = query(collection(db, 'orders'), where('status', '==', 'pending'));
 *   const snap = await getDocs(q);
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

const CLIENT_FILTER_METHODS = new Set(['filter', 'find', 'some', 'every', 'reduce']);

export const clientSideFilterRule: Rule = {
  id: 'FCG014',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!sourceText.includes('getDocs') && !sourceText.includes('.get(')) return [];
    if (!sourceText.includes('.filter(') && !sourceText.includes('.find(') &&
        !sourceText.includes('.some(')   && !sourceText.includes('.every(') &&
        !sourceText.includes('.reduce(')) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    // Step 1 — collect variable names assigned from unbounded collection reads
    const unboundedVars = new Set<string>();

    sf.getDescendantsOfKind(SyntaxKind.VariableDeclaration).forEach(vd => {
      const init = vd.getInitializer();
      if (!init) return;

      let initText = init.getText();

      // Unwrap await
      if (init.getKind() === SyntaxKind.AwaitExpression) {
        initText = init.getText();
      }

      const hasRead = /\bgetDocs\s*[<(]/.test(initText) || /\bcollection\s*\(/.test(initText) && /\.(get)\s*\(/.test(initText);
      if (!hasRead) return;

      // Skip if the read is already server-filtered
      if (/\.where\s*\(/.test(initText) || /\bwhere\s*\(/.test(initText)) return;
      if (/\bquery\s*\(/.test(initText) && /\bwhere\s*\(/.test(sourceText)) return;

      unboundedVars.add(vd.getName());
    });

    if (unboundedVars.size === 0) return diagnostics;

    // Step 2 — detect .docs.filter/find/some/every/reduce on those variables
    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return;

      const propAccess = expr.asKind(SyntaxKind.PropertyAccessExpression)!;
      const methodName = propAccess.getName();
      if (!CLIENT_FILTER_METHODS.has(methodName)) return;

      // The receiver should be <varName>.docs
      const receiver = propAccess.getExpression();
      const receiverText = receiver.getText();

      // Check if receiver is <unboundedVar>.docs
      const matched = [...unboundedVars].find(varName =>
        receiverText === `${varName}.docs` ||
        receiverText.endsWith(`.docs`) && receiverText.startsWith(varName)
      );
      if (!matched) return;

      const pos = expr.getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);
      const name = `${receiver.getText()}.${methodName}`;

      diagnostics.push({
        message: `[FCG014] .${methodName}() applied to an unfiltered getDocs() result — the entire collection was fetched to the client and most documents are being discarded. Every discarded document still costs a Firestore read. Fix: move the filter condition into a where("field", "op", value) clause on the query so Firestore returns only the documents you need.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + name.length,
        severity: 'warning',
        code: 'FCG014'
      });
    });

    return diagnostics;
  }
};
