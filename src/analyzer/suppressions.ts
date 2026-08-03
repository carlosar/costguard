import { RuleDiagnostic } from './types';

/**
 * Inline suppression directives, ESLint-style:
 *
 *   // costguard-disable-next-line              → all rules, next line
 *   // costguard-disable-next-line FCG002       → listed rules, next line
 *   someCall(); // costguard-disable-line       → all/listed rules, same line
 *   // costguard-disable-file                   → all/listed rules, whole file
 *
 * A directive only counts when it appears inside a comment (after `//` or
 * within a `/* ... ` block) so the words occurring in a string literal or
 * identifier don't accidentally suppress anything.
 */

const DIRECTIVE = /costguard-disable-(next-line|line|file)((?:[ \t]+FCG\d{3})*)/g;

type CodeFilter = 'all' | Set<string>;

function parseCodes(raw: string): CodeFilter {
  const codes = raw.trim().split(/\s+/).filter(Boolean);
  return codes.length === 0 ? 'all' : new Set(codes);
}

function inComment(line: string, directiveIndex: number): boolean {
  const lineComment  = line.indexOf('//');
  const blockComment = line.indexOf('/*');
  return (lineComment  !== -1 && lineComment  < directiveIndex)
      || (blockComment !== -1 && blockComment < directiveIndex);
}

function matches(filter: CodeFilter | undefined, code: string): boolean {
  if (!filter) return false;
  return filter === 'all' || filter.has(code);
}

function merge(existing: CodeFilter | undefined, next: CodeFilter): CodeFilter {
  if (existing === 'all' || next === 'all') return 'all';
  if (!existing) return next;
  next.forEach(c => existing.add(c));
  return existing;
}

/** Drop diagnostics that are suppressed by inline directives in the source. */
export function applySuppressions(sourceText: string, diagnostics: RuleDiagnostic[]): RuleDiagnostic[] {
  if (diagnostics.length === 0 || !sourceText.includes('costguard-disable')) return diagnostics;

  let fileFilter: CodeFilter | undefined;
  const lineFilters = new Map<number, CodeFilter>();  // 0-based line → filter

  const lines = sourceText.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.includes('costguard-disable')) continue;

    DIRECTIVE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = DIRECTIVE.exec(line)) !== null) {
      if (!inComment(line, m.index)) continue;
      const filter = parseCodes(m[2]);
      if (m[1] === 'file')           fileFilter = merge(fileFilter, filter);
      else if (m[1] === 'next-line') lineFilters.set(i + 1, merge(lineFilters.get(i + 1), filter));
      else                           lineFilters.set(i,     merge(lineFilters.get(i),     filter));
    }
  }

  if (!fileFilter && lineFilters.size === 0) return diagnostics;

  return diagnostics.filter(d =>
    !matches(fileFilter, d.code) && !matches(lineFilters.get(d.line), d.code)
  );
}
