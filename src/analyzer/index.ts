import { RuleDiagnostic } from './types';
import { unstableDepsRule } from './rules/unstable-deps';
import { unboundedReadRule } from './rules/unbounded-read';
import { listenerUiDepRule } from './rules/listener-ui-dep';
import { snapshotCleanupRule } from './rules/snapshot-cleanup';
import { readInLoopRule } from './rules/read-in-loop';
import { intervalCleanupRule } from './rules/interval-cleanup';
import { eventListenerCleanupRule } from './rules/event-listener-cleanup';
import { fetchInLoopRule } from './rules/fetch-in-loop';
import { readInRenderRule } from './rules/read-in-render';
import { compoundRenderLoopRule } from './rules/compound-render-loop';
import { highFreqHandlerRule } from './rules/high-freq-handler';
import { writeInLoopRule } from './rules/write-in-loop';
import { pollingIntervalRule } from './rules/polling-interval';
import { clientSideFilterRule } from './rules/client-side-filter';
import { fieldValueAtomicRule } from './rules/fieldvalue-atomic';
import { unusedCloudFunctionRule } from './rules/unused-cloud-function';
import { cloudfunctionInLoopRule } from './rules/cloudfunction-in-loop';

const ALL_RULES = [
  unstableDepsRule,           // FCG001: unstable useEffect deps (object/array/fn/call)
  unboundedReadRule,          // FCG002: collection read without .limit()
  listenerUiDepRule,          // FCG003: onSnapshot dep on UI state (activeTab etc.)
  snapshotCleanupRule,        // FCG004: onSnapshot without cleanup return
  readInLoopRule,             // FCG005: getDoc/getDocs inside loops (N+1 reads)
  intervalCleanupRule,        // FCG006: setInterval without clearInterval
  eventListenerCleanupRule,   // FCG007: addEventListener without removeEventListener
  fetchInLoopRule,            // FCG008: fetch/axios inside a loop (N+1 HTTP requests)
  readInRenderRule,           // FCG009: getDoc/getDocs in component body (re-fetches every render)
  compoundRenderLoopRule,     // FCG010: unstable dep + expensive op in same effect (the $95 pattern)
  highFreqHandlerRule,        // FCG011: expensive op in scroll/mousemove/resize/keydown handler
  writeInLoopRule,            // FCG012: addDoc/setDoc/updateDoc/deleteDoc inside loops (unbatched writes)
  pollingIntervalRule,        // FCG013: setInterval + Firestore read (use onSnapshot instead)
  clientSideFilterRule,       // FCG014: getDocs() result filtered client-side (.filter/.find on .docs)
  fieldValueAtomicRule,       // FCG015: array push/counter += written back (use arrayUnion/increment)
  unusedCloudFunctionRule,    // FCG016: Cloud Function defined but not exported (dead in bundle)
  cloudfunctionInLoopRule,    // FCG017: httpsCallable invoked in a loop (N billed executions)
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
