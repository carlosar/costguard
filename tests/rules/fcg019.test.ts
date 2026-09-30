import { describe, it, expect } from 'vitest';
import { triggerSelfWriteRule } from '../../src/analyzer/rules/trigger-self-write';

const FILE = 'functions.ts';

describe('FCG019 — trigger writes back to its own document', () => {
  it('fires on v2 onDocumentWritten updating event.data.after.ref', () => {
    const src = `
      export const touch = onDocumentWritten('users/{userId}', async (event) => {
        await event.data.after.ref.update({ updatedAt: Date.now() });
      });
    `;
    const diags = triggerSelfWriteRule.analyze(src, FILE);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG019');
  });

  it('fires on v2 onDocumentUpdated using set()', () => {
    const src = `
      export const d = onDocumentUpdated('orders/{id}', async (event) => {
        await event.data.after.ref.set({ total: 42 }, { merge: true });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(1);
  });

  it('fires on the v1 chained syntax split across lines', () => {
    // The chain is not contiguous in source, so the callee text must be
    // whitespace-normalized before matching.
    const src = `
      export const onUserWrite = functions.firestore
        .document('users/{userId}')
        .onWrite(async (change, context) => {
          await change.after.ref.update({ lastSeen: Date.now() });
        });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(1);
  });

  it('fires on v1 onUpdate', () => {
    const src = `
      export const stamp = functions.firestore.document('posts/{id}').onUpdate(async (change) => {
        await change.after.ref.update({ wordCount: 10 });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(1);
  });

  it('resolves a ref stored in a local variable', () => {
    const src = `
      export const slugify = onDocumentWritten('articles/{id}', async (event) => {
        const ref = event.data.after.ref;
        await ref.update({ slug: 'x' });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(1);
  });

  it('fires on RTDB onValueWritten', () => {
    const src = `
      export const mirror = onValueWritten('/status/{uid}', async (event) => {
        await event.data.after.ref.set({ seenAt: Date.now() });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(1);
  });

  it('reports once per trigger even with several self-writes', () => {
    const src = `
      export const t = onDocumentWritten('users/{id}', async (event) => {
        await event.data.after.ref.update({ a: 1 });
        await event.data.after.ref.update({ b: 2 });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(1);
  });

  // ── Must stay silent ──────────────────────────────────────────────────────

  it('does not fire when the handler compares before/after', () => {
    const src = `
      export const guarded = onDocumentWritten('users/{id}', async (event) => {
        const before = event.data.before.data();
        const after = event.data.after.data();
        if (before.name === after.name) return null;
        await event.data.after.ref.update({ nameLower: after.name.toLowerCase() });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on onDocumentCreated — a write-back emits update, not create', () => {
    const src = `
      export const init = onDocumentCreated('users/{id}', async (event) => {
        await event.data.ref.update({ createdAt: Date.now() });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on onDocumentDeleted', () => {
    const src = `
      export const archive = onDocumentDeleted('users/{id}', async (event) => {
        await event.data.ref.set({ deleted: true });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire when writing to a different collection', () => {
    const src = `
      export const audit = onDocumentWritten('users/{id}', async (event) => {
        await db.collection('auditLog').add({ user: event.params.id });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire when writing to a sibling doc built from params', () => {
    const src = `
      export const fan = onDocumentWritten('users/{userId}', async (event) => {
        await db.doc(\`users/\${event.params.userId}/stats/summary\`).set({ n: 1 }, { merge: true });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on a read-only handler', () => {
    const src = `
      export const notify = onDocumentWritten('users/{id}', async (event) => {
        const snap = await db.collection('prefs').doc(event.params.id).get();
        await sendEmail(snap.data());
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on a callable that happens to write', () => {
    const src = `
      export const save = onCall(async (request) => {
        await db.collection('users').doc(request.auth.uid).update({ name: request.data.name });
      });
    `;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on files with no triggers at all', () => {
    const src = `async function load() { return getDocs(collection(db, 'x')); }`;
    expect(triggerSelfWriteRule.analyze(src, FILE)).toHaveLength(0);
  });
});
