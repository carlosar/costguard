import { describe, it, expect } from 'vitest';
import { eventListenerCleanupRule } from '../../src/analyzer/rules/event-listener-cleanup';

const FILE = 'test.tsx';

describe('FCG007 — addEventListener without removeEventListener cleanup', () => {
  it('fires when addEventListener has no cleanup return', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          window.addEventListener('resize', handleResize);
        }, []);
      }
    `;
    const diags = eventListenerCleanupRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG007');
  });

  it('does not fire when removeEventListener is returned as cleanup', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          window.addEventListener('resize', handleResize);
          return () => window.removeEventListener('resize', handleResize);
        }, []);
      }
    `;
    const diags = eventListenerCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG007')).toHaveLength(0);
  });

  it('does not fire when addEventListener is outside useEffect', () => {
    const src = `
      function init() {
        document.addEventListener('click', handleClick);
      }
    `;
    const diags = eventListenerCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG007')).toHaveLength(0);
  });

  it('does not fire when there is no addEventListener at all', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          fetchData();
        }, []);
      }
    `;
    const diags = eventListenerCleanupRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG007')).toHaveLength(0);
  });
});
