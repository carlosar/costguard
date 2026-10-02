import { describe, it, expect } from 'vitest';
import { minInstancesIdleRule } from '../../src/analyzer/rules/min-instances-idle';

const FILE = 'functions.ts';
const run = (src: string) => minInstancesIdleRule.analyze(src, FILE);

describe('FCG024 — minInstances bills idle instances', () => {
  it('fires on a v2 onRequest option', () => {
    const diags = run(`export const api = onRequest({ minInstances: 5 }, handler);`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG024');
    expect(diags[0].severity).toBe('warning');
  });

  it('fires on onCall', () => {
    expect(run(`export const ask = onCall({ minInstances: 2 }, handler);`)).toHaveLength(1);
  });

  it('fires on the v1 runWith form', () => {
    const src = `
      export const legacy = functions
        .runWith({ minInstances: 3, memory: '1GB' })
        .https.onRequest(handler);
    `;
    expect(run(src)).toHaveLength(1);
  });

  it('fires on trigger options', () => {
    const src = `export const sync = onDocumentWritten({ document: 'users/{id}', minInstances: 2 }, handler);`;
    expect(run(src)).toHaveLength(1);
  });

  it('calls out setGlobalOptions as applying to every function', () => {
    const diags = run(`setGlobalOptions({ minInstances: 1 });`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('EVERY function');
  });

  it('mentions the memory allocation when one is set', () => {
    const diags = run(`export const api = onRequest({ minInstances: 5, memory: '2GiB' }, handler);`);
    expect(diags[0].message).toContain('2GiB');
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire on minInstances: 0, which is the free default', () => {
    expect(run(`export const api = onRequest({ minInstances: 0 }, handler);`)).toHaveLength(0);
  });

  it('does not fire when minInstances is absent', () => {
    expect(run(`export const api = onRequest({ memory: '1GiB', maxInstances: 10 }, handler);`)).toHaveLength(0);
  });

  it('does not fire on a non-Firebase config object', () => {
    // A connection pool is not a Cloud Function.
    expect(run(`const pool = createPool({ minInstances: 2, maxInstances: 10, host: 'db' });`)).toHaveLength(0);
  });

  it('does not fire when the value is a variable', () => {
    // Not statically known — silence beats guessing.
    expect(run(`export const api = onRequest({ minInstances: WARM_COUNT }, handler);`)).toHaveLength(0);
  });

  it('does not fire on files without minInstances', () => {
    expect(run(`export const api = onRequest(handler);`)).toHaveLength(0);
  });
});
