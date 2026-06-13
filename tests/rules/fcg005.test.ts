import { describe, it, expect } from 'vitest';
import { readInLoopRule } from '../../src/analyzer/rules/read-in-loop';

const FILE = 'test.ts';

describe('FCG005 — Firestore read inside a loop', () => {
  it('fires on getDoc inside a for-of loop', () => {
    const src = `
      async function loadItems(ids: string[]) {
        for (const id of ids) {
          const snap = await getDoc(doc(db, 'items', id));
          results.push(snap.data());
        }
      }
    `;
    const diags = readInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG005');
  });

  it('fires on getDocs inside forEach', () => {
    const src = `
      async function loadAll(categories: string[]) {
        categories.forEach(async (cat) => {
          const snap = await getDocs(query(collection(db, cat)));
          process(snap.docs);
        });
      }
    `;
    const diags = readInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG005');
  });

  it('fires on getDoc inside a while loop', () => {
    const src = `
      async function drain(queue: string[]) {
        while (queue.length) {
          const id = queue.pop()!;
          const snap = await getDoc(doc(db, 'tasks', id));
        }
      }
    `;
    const diags = readInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG005');
  });

  it('does not fire when getDoc is outside any loop', () => {
    const src = `
      async function loadOne(id: string) {
        const snap = await getDoc(doc(db, 'items', id));
        return snap.data();
      }
    `;
    const diags = readInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG005')).toHaveLength(0);
  });

  it('fires on getDoc inside a .map() callback', () => {
    const src = `
      async function loadAll(ids: string[]) {
        const promises = ids.map(id => getDoc(doc(db, 'items', id)));
        return Promise.all(promises);
      }
    `;
    const diags = readInLoopRule.analyze(src, FILE);
    // FCG005 fires on the getDoc inside map (it does not exempt Promise.all fan-out)
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG005');
  });
});
