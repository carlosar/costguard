import { describe, it, expect } from 'vitest';
import { pollingIntervalRule } from '../../src/analyzer/rules/polling-interval';

const FILE = 'test.ts';

describe('FCG013 — polling Firestore with setInterval', () => {
  it('fires on setInterval containing getDocs', () => {
    const src = `
      function startPolling() {
        setInterval(async () => {
          const snap = await getDocs(collection(db, 'orders'));
          setData(snap.docs.map(d => d.data()));
        }, 5000);
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG013');
  });

  it('fires on setInterval containing getDoc', () => {
    const src = `
      function startPolling() {
        setInterval(async () => {
          const snap = await getDoc(doc(db, 'config', 'main'));
          setConfig(snap.data());
        }, 3000);
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG013');
  });

  it('fires on recursive setTimeout polling pattern (arrow function variable)', () => {
    // The rule resolves the callback via VariableDeclaration lookup.
    // A function declaration is not found this way, so the recursive function
    // must be assigned to a variable for the rule to resolve it.
    const src = `
      function startPolling() {
        const poll = async () => {
          const snap = await getDocs(collection(db, 'tasks'));
          processResults(snap.docs);
          setTimeout(poll, 2000);
        };
        poll();
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG013');
  });

  it('fires when the poller is a function declaration re-scheduled by name', () => {
    // The rule's own doc-comment example. Function declarations are not
    // VariableDeclarations, so this needed an explicit lookup to resolve.
    const src = `
      function poll() {
        getDocs(collection(db, 'tasks')).then(() => setTimeout(poll, 5000));
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG013');
  });

  it('fires when the callback recurses by calling its enclosing function', () => {
    const src = `
      function poll() {
        setTimeout(async () => {
          await getDocs(collection(db, 'tasks'));
          poll();
        }, 5000);
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG013');
  });

  it('reports a named poller once, not at every call site', () => {
    const src = `
      const poll = async () => {
        await getDocs(collection(db, 'tasks'));
        setTimeout(poll, 2000);
      };
      setTimeout(poll, 2000);
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG013')).toHaveLength(1);
  });

  it('does not fire on a one-shot delayed read', () => {
    const src = `
      setTimeout(async () => {
        await getDocs(collection(db, 'orders'));
      }, 500);
    `;
    expect(pollingIntervalRule.analyze(src, FILE).filter(d => d.code === 'FCG013')).toHaveLength(0);
  });

  it('does not fire on a debounced search that never recurses', () => {
    const src = `
      let t;
      function search(term) {
        clearTimeout(t);
        t = setTimeout(async () => {
          await getDocs(query(collection(db, 'items'), where('n', '==', term)));
        }, 300);
      }
    `;
    expect(pollingIntervalRule.analyze(src, FILE).filter(d => d.code === 'FCG013')).toHaveLength(0);
  });

  it('does not fire when a non-recursive function reference is delayed once', () => {
    const src = `
      function loadOnce() {
        getDocs(collection(db, 'tasks'));
      }
      setTimeout(loadOnce, 500);
    `;
    expect(pollingIntervalRule.analyze(src, FILE).filter(d => d.code === 'FCG013')).toHaveLength(0);
  });

  it('does not fire when setInterval has no Firestore calls', () => {
    const src = `
      function startTimer() {
        setInterval(() => {
          updateClock();
        }, 1000);
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG013')).toHaveLength(0);
  });

  it('does not fire when setTimeout is not recursive', () => {
    const src = `
      async function runOnce() {
        setTimeout(async () => {
          const snap = await getDocs(collection(db, 'tasks'));
          process(snap.docs);
        }, 1000);
      }
    `;
    const diags = pollingIntervalRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG013')).toHaveLength(0);
  });
});
