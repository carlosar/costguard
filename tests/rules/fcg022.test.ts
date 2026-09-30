import { describe, it, expect } from 'vitest';
import { rtdbListenerCleanupRule } from '../../src/analyzer/rules/rtdb-listener-cleanup';

const FILE = 'Feed.tsx';
const run = (src: string) => rtdbListenerCleanupRule.analyze(src, FILE);

describe('FCG022 — Realtime Database listener without cleanup', () => {
  it('fires on onValue in an effect with no return', () => {
    const diags = run(`
      function Feed() {
        useEffect(() => {
          onValue(query(ref(db, 'messages'), limitToLast(20)), s => setMsgs(s.val()));
        }, []);
      }
    `);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG022');
  });

  it('fires on the compat .on("value") API', () => {
    expect(run(`
      function Presence() {
        useEffect(() => {
          db.ref('status').limitToLast(10).on('value', s => setStatus(s.val()));
        }, []);
      }
    `)).toHaveLength(1);
  });

  it('fires on onChildAdded', () => {
    expect(run(`
      function Live() {
        useEffect(() => {
          onChildAdded(query(ref(db, 'events'), limitToLast(1)), s => append(s.val()));
        }, []);
      }
    `)).toHaveLength(1);
  });

  it('fires inside useLayoutEffect too', () => {
    expect(run(`
      function Feed() {
        useLayoutEffect(() => {
          onValue(query(ref(db, 'messages'), limitToLast(5)), cb);
        }, []);
      }
    `)).toHaveLength(1);
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire when the unsubscribe is returned', () => {
    expect(run(`
      function Feed() {
        useEffect(() => {
          const unsub = onValue(query(ref(db, 'messages'), limitToLast(20)), cb);
          return () => unsub();
        }, []);
      }
    `)).toHaveLength(0);
  });

  it('does not fire when the listener is detached with off()', () => {
    expect(run(`
      function Presence() {
        useEffect(() => {
          const r = db.ref('status').limitToLast(10);
          const cb = s => setStatus(s.val());
          r.on('value', cb);
          return () => r.off('value', cb);
        }, []);
      }
    `)).toHaveLength(0);
  });

  it('does not fire outside a React effect', () => {
    // Module-level listeners live for the page lifetime by design; there is no
    // mount/unmount cycle to leak across.
    expect(run(`onValue(query(ref(db, 'config'), limitToLast(1)), cb);`)).toHaveLength(0);
  });

  it('leaves Firestore onSnapshot to FCG004', () => {
    expect(run(`
      function Orders() {
        useEffect(() => {
          onSnapshot(query(collection(db, 'orders'), limit(10)), cb);
        }, []);
      }
    `)).toHaveLength(0);
  });

  it('does not fire on an unrelated emitter .on() in an effect', () => {
    expect(run(`
      function Widget() {
        useEffect(() => {
          emitter.on('change', handler);
        }, []);
      }
    `)).toHaveLength(0);
  });
});
