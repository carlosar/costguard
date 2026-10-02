import { describe, it, expect } from 'vitest';
import { offsetPaginationRule } from '../../src/analyzer/rules/offset-pagination';

const FILE = 'page.ts';
const run = (src: string) => offsetPaginationRule.analyze(src, FILE);

describe('FCG023 — Firestore pagination with offset()', () => {
  it('fires on an Admin SDK offset chain', () => {
    const diags = run(`db.collection('orders').orderBy('createdAt').offset(1000).limit(20).get();`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG023');
  });

  it('fires on the compat API', () => {
    expect(run(`firebase.firestore().collection('users').offset(500).limit(10).get();`)).toHaveLength(1);
  });

  it('fires on a collectionGroup query', () => {
    expect(run(`db.collectionGroup('reviews').offset(100).limit(10).get();`)).toHaveLength(1);
  });

  it('reports the offset argument in the message', () => {
    expect(run(`db.collection('o').offset(n * 20).limit(20).get();`)[0].message).toContain('n * 20');
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire on cursor pagination', () => {
    expect(run(`db.collection('orders').orderBy('createdAt').startAfter(lastDoc).limit(20).get();`)).toHaveLength(0);
  });

  it('does not fire on a SQL query builder', () => {
    // Offsets are normal and cheap in SQL — only Firestore bills skipped rows.
    expect(run(`await knex('users').where('active', true).offset(100).limit(20);`)).toHaveLength(0);
  });

  it('does not fire on a plain limit query', () => {
    expect(run(`db.collection('orders').orderBy('createdAt').limit(20).get();`)).toHaveLength(0);
  });

  it('does not fire on unrelated offset() calls', () => {
    expect(run(`const slice = pager.offset(10).take(5); const x = element.offset().top;`)).toHaveLength(0);
  });

  it('does not let an unrelated collection() elsewhere in the file drag it in', () => {
    // Only the chain to the left of .offset() is inspected.
    const src = `
      const snap = await getDocs(collection(db, 'users'));
      const rows = await knex('logs').offset(50).limit(10);
    `;
    expect(run(src)).toHaveLength(0);
  });
});
