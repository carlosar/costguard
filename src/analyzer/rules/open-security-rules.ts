/**
 * FCG025 — Security rules grant public access
 *
 * `allow read, write: if true` lets anyone on the internet read and write your
 * database. That is a security problem first, but it is also the single
 * fastest route to a runaway bill: every scraped document is a billed read, and
 * Firestore has no rate limit to stop a stranger enumerating your collections.
 * Firebase's own guidance is that security rules "cannot rate-limit requests",
 * so an open ruleset is an open tab.
 *
 * Also flags Firebase's generated test-mode rules:
 *
 *   allow read, write: if request.time < timestamp.date(2027, 1, 15);
 *
 * Those are wide open until the date passes — people ship them, because the app
 * works perfectly right up until it either gets scraped or abruptly breaks.
 *
 * This rule analyses `.rules` files, which are not JavaScript, so it is matched
 * textually rather than through the AST used by every other rule.
 */

import { Rule, RuleDiagnostic } from '../types';

// allow <ops>: if <condition>;   (condition may span lines)
const ALLOW_RE = /allow\s+([a-z,\s]+?)\s*:\s*if\s+([\s\S]*?);/g;

const FULLY_OPEN_RE = /^\s*true\s*$/;
// Open-until-a-date: request.time on the LEFT, compared against a fixed date.
// `resource.data.startsAt < request.time` is an ordinary comparison, not a gate.
const TEST_MODE_RE  = /request\.time\s*<\s*timestamp\.date\s*\(([^)]*)\)/;

/** Blank out // and /* *​/ comments so commented-out rules do not fire. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length));
}

export const openSecurityRulesRule: Rule = {
  id: 'FCG025',

  analyze(sourceText: string, filePath: string): RuleDiagnostic[] {
    if (!/\.rules$/.test(filePath)) return [];
    if (!sourceText.includes('allow')) return [];

    const src = stripComments(sourceText);
    const diagnostics: RuleDiagnostic[] = [];

    ALLOW_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ALLOW_RE.exec(src)) !== null) {
      const ops       = m[1].replace(/\s+/g, ' ').trim();
      const condition = m[2].trim();

      const fullyOpen = FULLY_OPEN_RE.test(condition);
      const testMode  = TEST_MODE_RE.exec(condition);
      if (!fullyOpen && !testMode) continue;

      const before = src.slice(0, m.index);
      const line   = before.split('\n').length - 1;
      const column = m.index - (before.lastIndexOf('\n') + 1);

      diagnostics.push({
        message: fullyOpen
          ? `[FCG025] \`allow ${ops}: if true\` grants ${ops} to anyone on the internet, with no sign-in required. ` +
            `Security rules cannot rate-limit, so a stranger can enumerate your collections and every document they pull is a ` +
            `billed read — this is how a quiet project wakes up to a four-figure invoice. ` +
            `Fix: require authentication (\`if request.auth != null\`) and narrow the match path to the documents a user may touch.`
          : `[FCG025] \`allow ${ops}\` is open to anyone until ${testMode![1].trim()} — these are Firebase's generated test-mode ` +
            `rules. Until that date every operation is public and every read is billed; after it, all access is denied and your ` +
            `app breaks instead. Fix: replace the date gate with real conditions, e.g. \`if request.auth != null\` plus ownership checks.`,
        line,
        startChar: column,
        endChar: column + 5,          // the `allow` keyword
        severity: 'error',
        code: 'FCG025'
      });
    }

    return diagnostics;
  }
};
