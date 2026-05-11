import { RuleDiagnostic } from './types';
import { unstableDepsRule } from './rules/unstable-deps';
import { unboundedReadRule } from './rules/unbounded-read';
import { listenerUiDepRule } from './rules/listener-ui-dep';
import { snapshotCleanupRule } from './rules/snapshot-cleanup';
import { readInLoopRule } from './rules/read-in-loop';
import { intervalCleanupRule } from './rules/interval-cleanup';

const ALL_RULES = [
  unstableDepsRule,      // FCG001: unstable useEffect deps (object/array/fn/call)
  unboundedReadRule,     // FCG002: collection read without .limit()
  listenerUiDepRule,     // FCG003: onSnapshot dep on UI state (activeTab etc.)
  snapshotCleanupRule,   // FCG004: onSnapshot without cleanup return
  readInLoopRule,        // FCG005: getDoc/getDocs inside loops (N+1 reads)
  intervalCleanupRule,   // FCG006: setInterval without clearInterval
];

export function analyzeFile(sourceText: string, filePath: string): RuleDiagnostic[] {
  const results: RuleDiagnostic[] = [];
  for (const rule of ALL_RULES) {
    try {
      results.push(...rule.analyze(sourceText, filePath));
    } catch {
      // Never let a rule crash crash the extension
    }
  }
  return results;
}
