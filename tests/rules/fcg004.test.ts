import { describe, it, expect } from 'vitest';
import { snapshotCleanupRule } from '../../src/analyzer/rules/snapshot-cleanup';

const FILE = 'test.tsx';

describe('FCG004 — onSnapshot without cleanup return', () => {
  it('fires when onSnapshot has no cleanup return', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          onSnapshot(collection(db, 'orders'), (snap) => {
            setData(snap.docs);
          });
        }, []);
      }
    `;
    const diags = snapshotCleanupRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG004');
  });

  it('fires on chained onSnapshot without cleanup', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          db.collection('orders').onSnapshot((snap) => {
            setData(snap.docs);
          });
        }, []);
      }
    `;
    const diags = snapshotCleanupRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG004');
  });

  it('does not fire when cleanup return is present', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          const unsubscribe = onSnapshot(collection(db, 'orders'), (snap) => {
            setData(snap.docs);
          });
          return () => unsubscribe();
        }, []);
      }
    `;
    const diags = snapshotCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG004')).toHaveLength(0);
  });

  it('does not fire when onSnapshot is outside useEffect', () => {
    const src = `
      function subscribeToOrders() {
        const unsubscribe = onSnapshot(collection(db, 'orders'), (snap) => {});
        return unsubscribe;
      }
    `;
    const diags = snapshotCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG004')).toHaveLength(0);
  });
});
