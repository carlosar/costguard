/**
 * FCG024 — minInstances keeps Cloud Functions billing while idle
 *
 * minInstances holds N instances warm so requests skip the cold start. Those
 * instances are billed for CPU and memory the entire time they sit idle — it is
 * a flat monthly charge that accrues at 3am with zero traffic, and it scales
 * with both the instance count and the memory allocation. Developers routinely
 * meet it as an unexplained "Idle Min-Instance CPU Allocation Time" line on the
 * bill.
 *
 * This is a legitimate setting, not a bug, so it is a warning: the point is to
 * make the standing cost visible at the moment it is introduced, usually by
 * copy-paste, rather than on the invoice.
 *
 * setGlobalOptions({ minInstances }) is called out separately because it
 * applies to EVERY function in the codebase — the charge is multiplied by the
 * number of deployed functions, which is rarely what people expect.
 *
 * Only fires on a literal greater than zero. `minInstances: 0` is the default
 * and costs nothing, and a variable value cannot be evaluated statically, so
 * both are left alone.
 */

import { Project, SyntaxKind, SourceFile, Node } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Calls whose options object configures a deployed function
const FUNCTION_DEFINERS = new Set([
  'onRequest', 'onCall', 'runWith', 'setGlobalOptions', 'onSchedule', 'onInit',
  'onDocumentWritten', 'onDocumentUpdated', 'onDocumentCreated', 'onDocumentDeleted',
  'onValueWritten', 'onValueUpdated', 'onValueCreated', 'onValueDeleted',
  'onMessagePublished', 'onObjectFinalized', 'onObjectDeleted', 'onTaskDispatched',
]);

/** Nearest enclosing call whose callee names a function-defining API. */
function definerName(node: Node): string | undefined {
  for (const ancestor of node.getAncestors()) {
    const call = ancestor.asKind(SyntaxKind.CallExpression);
    if (!call) continue;
    const name = call.getExpression().getText().split('.').pop() ?? '';
    if (FUNCTION_DEFINERS.has(name)) return name;
  }
  return undefined;
}

export const minInstancesIdleRule: Rule = {
  id: 'FCG024',

  analyze(sourceText: string, filePath: string, sharedSf?: SourceFile): RuleDiagnostic[] {
    if (!sourceText.includes('minInstances')) return [];

    let sf: SourceFile;
    if (sharedSf) {
      sf = sharedSf;
    } else {
      const project = new Project({ useInMemoryFileSystem: true, skipFileDependencyResolution: true, compilerOptions: { allowJs: true, jsx: 4 } });
      sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    }
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.PropertyAssignment).forEach(prop => {
      if (prop.getName() !== 'minInstances') return;

      const initializer = prop.getInitializer();
      if (!initializer || initializer.getKind() !== SyntaxKind.NumericLiteral) return;  // variable: unknowable
      const count = Number(initializer.getText());
      if (!Number.isFinite(count) || count <= 0) return;                                 // 0 is the free default

      const definer = definerName(prop);
      if (!definer) return;                                                              // not a Cloud Function config

      const isGlobal = definer === 'setGlobalOptions';
      const memory = prop.getParent()?.asKind(SyntaxKind.ObjectLiteralExpression)
        ?.getProperty('memory')?.getText().split(':').pop()?.trim().replace(/['"]/g, '');

      const pos = prop.getNameNode().getStart();
      const { line, column } = sf.getLineAndColumnAtPos(pos);

      const scope = isGlobal
        ? `setGlobalOptions applies this to EVERY function in this codebase, so the charge is multiplied by the number of functions you deploy`
        : `this function keeps ${count} instance${count !== 1 ? 's' : ''} warm around the clock`;

      diagnostics.push({
        message:
          `[FCG024] minInstances: ${count} bills CPU and memory for idle instances — ${scope}. ` +
          `It accrues with zero traffic${memory ? `, and at ${memory} per instance the rate is higher than the default` : ''}. ` +
          `Fix: drop to 0 unless cold starts are genuinely hurting users, and check the cost estimate the Firebase CLI ` +
          `prints at deploy time before keeping it.`,
        line: line - 1,
        startChar: column - 1,
        endChar: column - 1 + 'minInstances'.length,
        severity: 'warning',
        code: 'FCG024'
      });
    });

    return diagnostics;
  }
};
