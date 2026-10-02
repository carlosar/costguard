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

  it('fires on arithmetic written straight into the update (pattern B)', () => {
    // This is the form this rule's own doc comment and the README use as the
    // example. It used to be impossible to report: the gate demanded an
    // in-place operator (+= / ++ / --) that this shape never contains.
    const src = `
      async function bumpCount(ref) {
        const data = (await getDoc(ref)).data();
        await updateDoc(ref, { count: data.count + 1 });
      }
    `;
    const diags = fieldValueAtomicRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG015');
  });

  it('fires on += 1 followed by writing the mutated value back', () => {
    const src = `
      async function bumpCount(ref) {
        const data = (await getDoc(ref)).data();
        data.count += 1;
        await updateDoc(ref, { count: data.count });
      }
    `;
    expect(fieldValueAtomicRule.analyze(src, FILE).length).toBeGreaterThanOrEqual(1);
  });

  it('fires on ++ followed by writing the mutated value back', () => {
    const src = `
      async function bumpCount(ref) {
        const data = (await getDoc(ref)).data();
        data.count++;
        await updateDoc(ref, { count: data.count });
      }
    `;
    expect(fieldValueAtomicRule.analyze(src, FILE).length).toBeGreaterThanOrEqual(1);
  });

  it('does not tie an unrelated loop counter to the write', () => {
    // Regression: matching the mutated name by substring meant a counter called
    // `i` was "found" inside words like `items` and `name`.
    const src = `
      async function save(ref, items) {
        const data = (await getDoc(ref)).data();
        let i = 0;
        for (const it of items) { i++; }
        await updateDoc(ref, { name: data.name, total: items.length });
      }
    `;
    expect(fieldValueAtomicRule.analyze(src, FILE).filter(d => d.code === 'FCG015')).toHaveLength(0);
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
