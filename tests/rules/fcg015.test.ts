import { describe, it, expect } from 'vitest';
import { fieldValueAtomicRule } from '../../src/analyzer/rules/fieldvalue-atomic';

const FILE = 'test.ts';

describe('FCG015 — FieldValue atomics not used for array/counter mutations', () => {
  it('fires on array .push() then updateDoc (pattern A)', () => {
    const src = `
      async function addTag(docId: string, tag: string) {
        const snap = await getDoc(doc(db, 'items', docId));
        const data = snap.data()!;
        data.tags.push(tag);
        await updateDoc(doc(db, 'items', docId), { tags: data.tags });
      }
    `;
    const diags = fieldValueAtomicRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG015');
  });

  it('fires on counter += 1 mutation then updateDoc (pattern B)', () => {
    // Rule requires both an explicit mutation operator (+= 1 / ++ / --) in scope
    // AND a numeric increment expression (count + 1 / count++) in the write args.
    const src = `
      async function bumpCount(docId: string) {
        const snap = await getDoc(doc(db, 'counters', docId));
        const data = snap.data()!;
        data.count += 1;
        await updateDoc(doc(db, 'counters', docId), { count: data.count + 1 });
      }
    `;
    const diags = fieldValueAtomicRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG015');
  });

  it('does not fire when arrayUnion is used', () => {
    const src = `
      async function addTag(docId: string, tag: string) {
        await updateDoc(doc(db, 'items', docId), { tags: arrayUnion(tag) });
      }
    `;
    const diags = fieldValueAtomicRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG015')).toHaveLength(0);
  });

  it('does not fire when increment() is used', () => {
    const src = `
      async function bumpCount(docId: string) {
        await updateDoc(doc(db, 'counters', docId), { count: increment(1) });
      }
    `;
    const diags = fieldValueAtomicRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG015')).toHaveLength(0);
  });

  it('does not fire when there is no preceding getDoc', () => {
    const src = `
      async function setTags(docId: string, tags: string[]) {
        await updateDoc(doc(db, 'items', docId), { tags });
      }
    `;
    const diags = fieldValueAtomicRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG015')).toHaveLength(0);
  });
});
