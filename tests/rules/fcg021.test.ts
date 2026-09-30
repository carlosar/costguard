import { describe, it, expect } from 'vitest';
import { rtdbUnboundedReadRule } from '../../src/analyzer/rules/rtdb-unbounded-read';

const FILE = 'db.ts';
const run = (src: string) => rtdbUnboundedReadRule.analyze(src, FILE);

describe('FCG021 — unbounded Realtime Database read', () => {
  it('flags a root listener as an error', () => {
    const diags = run(`onValue(ref(db, '/'), snap => render(snap.val()));`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG021');
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toContain('root');
  });

  it('flags a root listener on the compat API', () => {
    const diags = run(`firebase.database().ref('/').on('value', cb);`);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('flags ref(db) with no path at all', () => {
    const diags = run(`onValue(ref(db), cb);`);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
  });

  it('warns on an unbounded list read', () => {
    const diags = run(`onValue(ref(db, 'messages'), cb);`);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
  });

  it('warns on the compat API without a limit', () => {
    expect(run(`db.ref('messages').on('value', cb);`)).toHaveLength(1);
  });

  it('warns when the path interpolates but ends in a static segment', () => {
    // `rooms/${id}/messages` is a list, even though the path is dynamic.
    expect(run('onValue(ref(db, `rooms/${roomId}/messages`), cb);')).toHaveLength(1);
  });

  it('flags an unbounded one-shot get()', () => {
    expect(run(`get(ref(db, 'orders'));`)).toHaveLength(1);
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire on a limitToLast query', () => {
    expect(run(`onValue(query(ref(db, 'messages'), limitToLast(50)), cb);`)).toHaveLength(0);
  });

  it('does not fire on the compat API with a limit', () => {
    expect(run(`db.ref('messages').limitToLast(50).on('value', cb);`)).toHaveLength(0);
  });

  it('does not fire when equalTo narrows the query', () => {
    expect(run(`onValue(query(ref(db, 'scores'), orderByChild('level'), equalTo(5)), cb);`)).toHaveLength(0);
  });

  it('does not fire on a single node addressed by a dynamic final segment', () => {
    expect(run('onValue(ref(db, `users/${uid}`), cb);')).toHaveLength(0);
  });

  it('does not fire on a concatenated path', () => {
    // Not a literal, so there is not enough information — silence beats a
    // false positive on every single-node read in a codebase.
    expect(run(`db.ref('users/' + uid).on('value', cb);`)).toHaveLength(0);
  });

  it('does not touch Firestore onSnapshot', () => {
    expect(run(`onSnapshot(query(collection(db, 'orders'), limit(10)), cb);`)).toHaveLength(0);
  });

  it('does not fire on an unrelated emitter .on() call', () => {
    expect(run(`emitter.on('change', handler);`)).toHaveLength(0);
  });

  it('does not fire on a socket using an RTDB-looking event name', () => {
    // 'value' alone is not enough — a ref() call must also be present.
    expect(run(`socket.on('value', payload => handle(payload));`)).toHaveLength(0);
  });

  it('does not fire on Firebase Storage, which has an identical ref() shape', () => {
    const src = `
      import { getStorage, ref, getDownloadURL, uploadBytes } from 'firebase/storage';
      const r = ref(storage, 'images/photo.png');
      await uploadBytes(r, file);
      const url = await getDownloadURL(ref(storage, 'images/photo.png'));
    `;
    expect(run(src)).toHaveLength(0);
  });

  it('does not fire on React useRef', () => {
    expect(run(`const ref = useRef(null); ref.current?.focus();`)).toHaveLength(0);
  });

  it('does not fire on a Firestore snapshot .ref property', () => {
    expect(run(`await snap.ref.update({ seen: true });`)).toHaveLength(0);
  });
});
