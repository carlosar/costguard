import { describe, it, expect } from 'vitest';
import { compoundRenderLoopRule } from '../../src/analyzer/rules/compound-render-loop';

const FILE = 'test.tsx';

describe('FCG010 — compound render loop (unstable dep + expensive op)', () => {
  it('fires when unstable object dep + getDoc in same useEffect', () => {
    const src = `
      function MyComponent() {
        const query = { status: 'active' };
        useEffect(() => {
          getDoc(doc(db, 'config', 'main')).then(setData);
        }, [query]);
      }
    `;
    const diags = compoundRenderLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG010');
  });

  it('fires when unstable call result dep + fetch in same useEffect', () => {
    const src = `
      function MyComponent() {
        const config = buildConfig();
        useEffect(() => {
          fetch('/api/data').then(r => r.json()).then(setData);
        }, [config]);
      }
    `;
    const diags = compoundRenderLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG010');
  });

  it('fires when unstable dep + onSnapshot in same useEffect', () => {
    const src = `
      function MyComponent() {
        const filter = { type: 'all' };
        useEffect(() => {
          onSnapshot(collection(db, 'items'), setItems);
        }, [filter]);
      }
    `;
    const diags = compoundRenderLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG010');
  });

  it('does not fire when dep is stable (useMemo) even with expensive op', () => {
    const src = `
      function MyComponent() {
        const query = useMemo(() => ({ status: 'active' }), []);
        useEffect(() => {
          getDoc(doc(db, 'config', 'main')).then(setData);
        }, [query]);
      }
    `;
    const diags = compoundRenderLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG010')).toHaveLength(0);
  });

  it('does not fire when there is no expensive op (only unstable dep)', () => {
    const src = `
      function MyComponent() {
        const options = { page: 1 };
        useEffect(() => {
          console.log(options);
        }, [options]);
      }
    `;
    const diags = compoundRenderLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG010')).toHaveLength(0);
  });

  it('does not fire when there is no deps array', () => {
    const src = `
      function MyComponent() {
        const options = { page: 1 };
        useEffect(() => {
          getDoc(doc(db, 'config', 'main')).then(setData);
        });
      }
    `;
    const diags = compoundRenderLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG010')).toHaveLength(0);
  });
});
