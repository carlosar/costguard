import { describe, it, expect } from 'vitest';
import { writeInLoopRule } from '../../src/analyzer/rules/write-in-loop';

const FILE = 'test.ts';

describe('FCG012 — unbatched Firestore writes inside a loop', () => {
  it('fires on setDoc inside a for-of loop (awaited)', () => {
    const src = `
      async function saveAll(items: Item[]) {
        for (const item of items) {
          await setDoc(doc(db, 'items', item.id), item);
        }
      }
    `;
    const diags = writeInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG012');
  });

  it('fires on addDoc inside forEach', () => {
    const src = `
      async function createAll(items: Item[]) {
        items.forEach(async (item) => {
          await addDoc(collection(db, 'items'), item);
        });
      }
    `;
    const diags = writeInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG012');
  });

  it('fires on updateDoc inside a for loop (awaited)', () => {
    const src = `
      async function markDone(ids: string[]) {
        for (let i = 0; i < ids.length; i++) {
          await updateDoc(doc(db, 'tasks', ids[i]), { done: true });
        }
      }
    `;
    const diags = writeInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG012');
  });

  it('does not fire when using writeBatch', () => {
    const src = `
      async function saveAll(items: Item[]) {
        const batch = writeBatch(db);
        items.forEach((item) => {
          batch.set(doc(db, 'items', item.id), item);
        });
        await batch.commit();
      }
    `;
    const diags = writeInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG012')).toHaveLength(0);
  });

  it('does not fire when using Promise.all fan-out', () => {
    const src = `
      async function saveAll(items: Item[]) {
        await Promise.all(items.map(item => setDoc(doc(db, 'items', item.id), item)));
      }
    `;
    const diags = writeInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG012')).toHaveLength(0);
  });

  it('does not fire when write is outside any loop', () => {
    const src = `
      async function saveOne(item: Item) {
        await setDoc(doc(db, 'items', item.id), item);
      }
    `;
    const diags = writeInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG012')).toHaveLength(0);
  });
});
