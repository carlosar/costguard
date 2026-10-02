/**
 * FCG023 — Firestore pagination with offset()
 *
 * Firestore charges for every document an offset skips over, not just the ones
 * returned. `offset(1000).limit(20)` bills 1020 reads to show 20 rows, and the
 * cost grows with the page number — page 50 of a list costs 50x page 1.
 *
 * Firebase's own best-practices guide is blunt about it: "Do not use offsets...
 * your application is billed for the read operations required to retrieve [the
 * skipped documents]." Cursors (startAfter/startAt) bill only what you read and
 * cost nothing extra.
 *
 *   db.collection('orders').orderBy('createdAt').offset(n * 20).limit(20);
 *   db.collection('orders').orderBy('createdAt').startAfter(last).limit(20);  // fix
 *
 * `offset()` is a perfectly normal, cheap operation in SQL query builders such
 * as Knex, so the rule fires only when the chain also contains a Firestore
 * collection accessor.
 */

import { Project, SyntaxKind, SourceFile } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Proof the chain is Firestore and not a SQL builder or a DOM helper
const FIRESTORE_CHAIN_RE = /\b(collection|collectionGroup)\s*\(/;

export const offsetPaginationRule: Rule = {
  id: 'FCG023',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!/\.offset\s*\(/.test(sourceText)) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      const prop = call.getExpression().asKind(SyntaxKind.PropertyAccessExpression);
      if (!prop || prop.getName() !== 'offset') return;

      // Only the part of the chain to the left of .offset() — so an unrelated
      // collection() elsewhere in the file cannot drag this in.
      if (!FIRESTORE_CHAIN_RE.test(prop.getExpression().getText())) return;

      const arg = call.getArguments()[0]?.getText() ?? 'N';
      const pos = prop.getNameNode().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      diagnostics.push({
        message:
          `[FCG023] offset(${arg}) makes Firestore read and bill every document it skips, not just the ones ` +
          `returned — so this page costs ${arg} extra reads, and the cost grows with every page. ` +
          `Fix: paginate with a cursor instead — keep the last document of the previous page and use ` +
          `startAfter(lastDoc).limit(N), which bills only the documents you actually receive.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + 'offset'.length,
        severity: 'warning',
        code: 'FCG023'
      });
    });

    return diagnostics;
  }
};
