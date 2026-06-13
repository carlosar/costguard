import { describe, it, expect } from 'vitest';
import { clientSideFilterRule } from '../../src/analyzer/rules/client-side-filter';

const FILE = 'test.ts';

describe('FCG014 — client-side filtering of unfiltered getDocs result', () => {
  it('fires when getDocs result is filtered client-side', () => {
    const src = `
      async function getPending() {
        const snap = await getDocs(collection(db, 'orders'));
        const pending = snap.docs.filter(d => d.data().status === 'pending');
        return pending;
      }
    `;
    const diags = clientSideFilterRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG014');
  });

  it('fires when getDocs result is found client-side with .find()', () => {
    const src = `
      async function getFirst() {
        const snap = await getDocs(collection(db, 'users'));
        const admin = snap.docs.find(d => d.data().role === 'admin');
        return admin;
      }
    `;
    const diags = clientSideFilterRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG014');
  });

  it('does not fire when a where() clause is applied before getDocs', () => {
    const src = `
      async function getPending() {
        const q = query(collection(db, 'orders'), where('status', '==', 'pending'));
        const snap = await getDocs(q);
        return snap.docs;
      }
    `;
    const diags = clientSideFilterRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG014')).toHaveLength(0);
  });

  it('does not fire when there is no client-side filter at all', () => {
    const src = `
      async function getAll() {
        const snap = await getDocs(collection(db, 'orders'));
        return snap.docs.map(d => d.data());
      }
    `;
    const diags = clientSideFilterRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG014')).toHaveLength(0);
  });
});
