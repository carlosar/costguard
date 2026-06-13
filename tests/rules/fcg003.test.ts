import { describe, it, expect } from 'vitest';
import { listenerUiDepRule } from '../../src/analyzer/rules/listener-ui-dep';

const FILE = 'test.tsx';

describe('FCG003 — Firestore listener with UI state dependency', () => {
  it('fires on activeTab in onSnapshot effect deps', () => {
    const src = `
      function Dashboard() {
        useEffect(() => {
          onSnapshot(collection(db, 'orders'), () => {});
        }, [activeTab]);
      }
    `;
    const diags = listenerUiDepRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG003');
  });

  it('fires on showModal in onSnapshot effect deps', () => {
    const src = `
      function Panel() {
        useEffect(() => {
          onSnapshot(doc(db, 'config'), () => {});
        }, [showModal]);
      }
    `;
    const diags = listenerUiDepRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG003');
  });

  it('fires on selectedId in onSnapshot effect deps', () => {
    const src = `
      function ItemList() {
        useEffect(() => {
          onSnapshot(collection(db, 'items'), () => {});
        }, [selectedId]);
      }
    `;
    const diags = listenerUiDepRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG003');
  });

  it('does not fire when dep is a workspace identity (workspaceId)', () => {
    const src = `
      function Dashboard() {
        useEffect(() => {
          onSnapshot(collection(db, 'orders'), () => {});
        }, [workspaceId]);
      }
    `;
    const diags = listenerUiDepRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG003')).toHaveLength(0);
  });

  it('does not fire when dep is userId', () => {
    const src = `
      function Dashboard() {
        useEffect(() => {
          onSnapshot(collection(db, 'orders'), () => {});
        }, [userId]);
      }
    `;
    const diags = listenerUiDepRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG003')).toHaveLength(0);
  });

  it('does not fire when effect has no onSnapshot', () => {
    const src = `
      function Dashboard() {
        useEffect(() => {
          fetchData();
        }, [activeTab]);
      }
    `;
    const diags = listenerUiDepRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG003')).toHaveLength(0);
  });
});
