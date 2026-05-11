/**
 * FCG003 — Firestore listener with UI state dependency
 *
 * Detects onSnapshot() calls inside a useEffect whose dep array includes UI
 * state variables (activeTab, selectedX, showModal, etc.).  Every time the
 * user switches a tab or toggles a modal, ALL listeners in that effect are
 * torn down and recreated — each recreation reads the full document set.
 *
 * This was the root cause of 98M dunning_log reads in SoarOne: the listener
 * effect had [user, activeWorkspaceOwnerId, activeTab] as deps, so every tab
 * switch re-subscribed 13+ collections simultaneously.
 */

import { Project, SyntaxKind } from 'ts-morph';
import { Rule, RuleDiagnostic } from '../types';

// Patterns that suggest a variable is UI/navigation state rather than auth/data state
const UI_STATE_PATTERNS = [
  /^active[A-Z]/,      // activeTab, activeModal
  /Tab$/i,             // currentTab, selectedTab
  /^selected[A-Z]/,   // selectedId, selectedUser
  /^show[A-Z]/,        // showModal, showDrawer
  /^is[A-Z]/,          // isOpen, isLoading (common false dep)
  /^open[A-Z]/,        // openPanel
  /Filter$/,           // statusFilter, typeFilter
  /^current[A-Z]/,    // currentPage, currentView
  /Page$/,             // currentPage
  /Modal$/,            // confirmModal
];

// Variables that carry auth/workspace/entity identity — re-subscribing when
// these change is intentional (different workspace = different data).
// activeWorkspaceOwnerId, currentUserId, selectedOrgId, etc.
const IDENTITY_PATTERNS = [
  /WorkspaceId$/i,
  /OwnerId$/i,
  /UserId$/i,
  /OrgId$/i,
  /ProjectId$/i,
  /TeamId$/i,
  /AccountId$/i,
  /TenantId$/i,
];

function looksLikeUiState(name: string): boolean {
  if (IDENTITY_PATTERNS.some(p => p.test(name))) return false;
  return UI_STATE_PATTERNS.some(p => p.test(name));
}

export const listenerUiDepRule: Rule = {
  id: 'FCG003',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    const project = new Project({
      useInMemoryFileSystem: true,
      skipFileDependencyResolution: true,
      compilerOptions: { allowJs: true, jsx: 4 }
    });
    const sf = project.createSourceFile(filePath.replace(/\\/g, '/'), sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    sf.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
      if (call.getExpression().getText() !== 'useEffect') return;

      const args = call.getArguments();
      if (args.length < 2) return;

      const callback = args[0];
      const depsArg = args[1];
      if (depsArg.getKind() !== SyntaxKind.ArrayLiteralExpression) return;

      // Does this effect body contain an onSnapshot call?
      const bodyText = callback.getText();
      if (!bodyText.includes('onSnapshot')) return;

      // Check each dep identifier for UI-state patterns
      depsArg.getDescendantsOfKind(SyntaxKind.Identifier).forEach(depId => {
        const name = depId.getText();
        if (!looksLikeUiState(name)) return;

        const pos = depId.getStart();
        const { line, column } = sf.getLineAndColumnAtPos(pos);

        diagnostics.push({
          message: `[FCG003] '${name}' looks like UI state in a useEffect that contains onSnapshot(). Every time '${name}' changes, all Firestore listeners in this effect are torn down and recreated — reading the full collection each time. Move this listener to a separate effect that only depends on user/workspace identity, not UI state.`,
          line: line - 1,
          startChar: column - 1,
          endChar: column - 1 + name.length,
          severity: 'warning',
          code: 'FCG003'
        });
      });
    });

    return diagnostics;
  }
};
