import { describe, it, expect } from 'vitest';
import { analyzeFile } from '../src/analyzer';
import { applySuppressions } from '../src/analyzer/suppressions';
import { RuleDiagnostic } from '../src/analyzer/types';

const FILE = 'test.ts';

function diag(line: number, code: string): RuleDiagnostic {
  return { message: '', line, startChar: 0, endChar: 1, severity: 'error', code };
}

describe('applySuppressions (unit)', () => {
  it('disable-next-line suppresses all rules on the following line', () => {
    const src = [
      '// costguard-disable-next-line',
      'bad();',
    ].join('\n');
    expect(applySuppressions(src, [diag(1, 'FCG002')])).toHaveLength(0);
  });

  it('disable-next-line with codes suppresses only those rules', () => {
    const src = [
      '// costguard-disable-next-line FCG002 FCG013',
      'bad();',
    ].join('\n');
    const kept = applySuppressions(src, [diag(1, 'FCG002'), diag(1, 'FCG013'), diag(1, 'FCG005')]);
    expect(kept.map(d => d.code)).toEqual(['FCG005']);
  });

  it('disable-line suppresses on the same line', () => {
    const src = 'bad(); // costguard-disable-line';
    expect(applySuppressions(src, [diag(0, 'FCG002')])).toHaveLength(0);
  });

  it('disable-file suppresses everywhere in the file', () => {
    const src = [
      '// costguard-disable-file',
      'bad();',
      'worse();',
    ].join('\n');
    expect(applySuppressions(src, [diag(1, 'FCG002'), diag(2, 'FCG005')])).toHaveLength(0);
  });

  it('disable-file with a code only suppresses that rule', () => {
    const src = [
      '// costguard-disable-file FCG002',
      'bad();',
    ].join('\n');
    const kept = applySuppressions(src, [diag(1, 'FCG002'), diag(1, 'FCG005')]);
    expect(kept.map(d => d.code)).toEqual(['FCG005']);
  });

  it('does not suppress other lines', () => {
    const src = [
      '// costguard-disable-next-line',
      'bad();',
      'alsoBad();',
    ].join('\n');
    expect(applySuppressions(src, [diag(2, 'FCG002')])).toHaveLength(1);
  });

  it('ignores the directive outside comments (string literal)', () => {
    const src = [
      'const s = "costguard-disable-next-line";',
      'bad();',
    ].join('\n');
    expect(applySuppressions(src, [diag(1, 'FCG002')])).toHaveLength(1);
  });

  it('handles CRLF line endings', () => {
    const src = '// costguard-disable-next-line\r\nbad();\r\n';
    expect(applySuppressions(src, [diag(1, 'FCG002')])).toHaveLength(0);
  });
});

describe('suppressions (integration through analyzeFile)', () => {
  it('suppresses a real FCG002 finding', () => {
    const src = `
      async function loadAll() {
        // costguard-disable-next-line FCG002
        const snap = await getDocs(collection(db, 'invoices'));
      }
    `;
    const diags = analyzeFile(src, FILE);
    expect(diags.filter(d => d.code === 'FCG002')).toHaveLength(0);
  });

  it('unsuppressed sibling code still fires', () => {
    const src = `
      async function loadAll() {
        // costguard-disable-next-line FCG002
        const a = await getDocs(collection(db, 'invoices'));
        const b = await getDocs(collection(db, 'orders'));
      }
    `;
    const diags = analyzeFile(src, FILE);
    expect(diags.filter(d => d.code === 'FCG002')).toHaveLength(1);
  });
});
