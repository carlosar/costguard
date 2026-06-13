import { describe, it, expect } from 'vitest';
import { unboundedReadRule } from '../../src/analyzer/rules/unbounded-read';

const FILE = 'test.ts';

describe('FCG002 — unbounded Firestore collection read', () => {
  it('fires on collection().get() without .limit()', () => {
    const src = `
      async function loadAll() {
        const snap = await collection(db, 'orders').get();
      }
    `;
    const diags = unboundedReadRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG002');
  });

  it('fires on collection().get() (compat SDK) without limit', () => {
    const src = `
      async function loadAll() {
        const snap = await db.collection('users').get();
      }
    `;
    const diags = unboundedReadRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG002');
  });

  it('fires on onSnapshot(collection()) without limit', () => {
    const src = `
      function subscribe() {
        onSnapshot(collection(db, 'messages'), (snap) => {});
      }
    `;
    const diags = unboundedReadRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG002');
  });

  it('does not fire when .limit() is present in the chain', () => {
    const src = `
      async function loadSome() {
        const snap = await getDocs(query(collection(db, 'orders'), limit(25)));
      }
    `;
    const diags = unboundedReadRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG002')).toHaveLength(0);
  });

  it('does not fire on .count().get() (aggregate query)', () => {
    const src = `
      async function countDocs() {
        const snap = await collection(db, 'orders').count().get();
      }
    `;
    const diags = unboundedReadRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG002')).toHaveLength(0);
  });

  it('does not fire on a single doc read', () => {
    const src = `
      async function loadOne() {
        const snap = await doc(db, 'orders', id).get();
      }
    `;
    const diags = unboundedReadRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG002')).toHaveLength(0);
  });
});
