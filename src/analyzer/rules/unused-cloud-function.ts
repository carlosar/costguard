/**
 * FCG016 — Firebase Cloud Function defined but not exported
 *
 * A Cloud Function assigned to a variable but not exported (no `export`
 * keyword, not assigned to `exports.xxx`) will never be deployed by Firebase.
 * It adds dead weight to the functions bundle, increases cold-start parse
 * time for all other functions, and becomes a billing risk if accidentally
 * exported in a future change without a proper review.
 *
 * Covers both the v1 (compat) and v2 (modular) Firebase Functions SDKs.
 *
 * Dead pattern:
 *   const notDeployed = onRequest((req, res) => { ... });  // ← never exported
 *
 * Correct pattern:
 *   export const myFn = onRequest((req, res) => { ... });  // ← deployed
 *   exports.myFn     = onRequest((req, res) => { ... });  // ← also deployed
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// v2 modular SDK function factories (top-level imports from firebase-functions/v2/*)
const V2_FACTORIES = new Set([
  // HTTPS
  'onRequest', 'onCall',
  // Firestore
  'onDocumentCreated', 'onDocumentUpdated', 'onDocumentDeleted', 'onDocumentWritten',
  // Storage
  'onObjectFinalized', 'onObjectDeleted', 'onObjectArchived', 'onObjectMetadataUpdated',
  // Scheduler
  'onSchedule',
  // Auth
  'beforeUserCreated', 'beforeUserSignedIn', 'onUserCreated', 'onUserDeleted',
  // Pub/Sub
  'onMessagePublished',
  // Database
  'onValueCreated', 'onValueUpdated', 'onValueDeleted', 'onValueWritten',
]);

// v1 compat: functions.https.onRequest, functions.firestore.document(...).onCreate, etc.
// Requires a known Firebase Functions namespace so string literals like 'functions.ts' don't match.
const V1_FACTORY_RE = /^functions\s*\.\s*(https|firestore|storage|pubsub|auth|database|remoteConfig|analytics|tasks)\s*\./;

function isCloudFunctionFactory(initText: string): boolean {
  // v2: top-level factory call
  const topLevel = initText.match(/^(\w+)\s*[<(]/)?.[1];
  if (topLevel && V2_FACTORIES.has(topLevel)) return true;

  // v1 compat: starts with functions.xxx
  if (V1_FACTORY_RE.test(initText)) return true;

  return false;
}

export const unusedCloudFunctionRule: Rule = {
  id: 'FCG016',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    // Only fire on Firebase Functions files
    const pathLower = filePath.replace(/\\/g, '/').toLowerCase();
    const isFunctionsFile =
      pathLower.includes('/functions/') ||
      pathLower.endsWith('functions.ts') ||
      pathLower.endsWith('functions.js');
    const hasFunctionsImport =
      sourceText.includes('firebase-functions') ||
      sourceText.includes('firebase/functions');

    if (!isFunctionsFile && !hasFunctionsImport) return [];

    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    // Collect all names assigned to exports.xxx = ... (v1 compat style)
    const compatExportedNames = new Set<string>();
    sf.getDescendantsOfKind(SyntaxKind.BinaryExpression).forEach(bin => {
      const left = bin.getLeft().getText();
      // exports.myFn = ...
      if (/^exports\s*\.\s*\w+/.test(left)) {
        const name = left.split('.')[1]?.trim();
        if (name) compatExportedNames.add(name);
      }
    });

    sf.getDescendantsOfKind(SyntaxKind.VariableStatement).forEach(stmt => {
      // Check for `export` modifier on the statement
      const isExported = stmt.isExported();

      const decls = stmt.getDeclarationList().getDeclarations();
      for (const decl of decls) {
        const name = decl.getName();
        const init = decl.getInitializer();
        if (!init) continue;

        const initText = init.getText().trim();
        if (!isCloudFunctionFactory(initText)) continue;

        // Exported via `export const` or `exports.name =`
        if (isExported || compatExportedNames.has(name)) continue;

        const pos = decl.getNameNode().getStart();
        const { line, column } = sf.getLineAndColumnAtPos(pos);

        diagnostics.push({
          message: `[FCG016] '${name}' is a Cloud Function that is never exported — Firebase will not deploy it. It adds dead code to your functions bundle, increasing cold-start parse time for every function in this file. Either export it (add 'export') or remove it.`,
          line: line - 1,
          startChar: column - 1,
          endChar: column - 1 + name.length,
          severity: 'warning',
          code: 'FCG016'
        });
      }
    });

    return diagnostics;
  }
};
