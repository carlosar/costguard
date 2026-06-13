import { describe, it, expect } from 'vitest';
import { intervalCleanupRule } from '../../src/analyzer/rules/interval-cleanup';

const FILE = 'test.tsx';

describe('FCG006 — setInterval without cleanup in useEffect', () => {
  it('fires when setInterval has no cleanup return', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          setInterval(() => {
            fetchLatest();
          }, 5000);
        }, []);
      }
    `;
    const diags = intervalCleanupRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG006');
  });

  it('does not fire when clearInterval cleanup return is present', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          const id = setInterval(() => {
            fetchLatest();
          }, 5000);
          return () => clearInterval(id);
        }, []);
      }
    `;
    const diags = intervalCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG006')).toHaveLength(0);
  });

  it('does not fire when setInterval is outside useEffect', () => {
    const src = `
      function startPolling() {
        const id = setInterval(() => { poll(); }, 1000);
        return id;
      }
    `;
    const diags = intervalCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG006')).toHaveLength(0);
  });
});
