import { describe, it, expect } from 'vitest';
import { cloudfunctionInLoopRule } from '../../src/analyzer/rules/cloudfunction-in-loop';

const FILE = 'test.ts';

describe('FCG017 — httpsCallable invoked inside a loop', () => {
  it('fires on httpsCallable variable invoked in a for-of loop (awaited)', () => {
    const src = `
      async function processAll(items: Item[]) {
        const processItem = httpsCallable(functions, 'processItem');
        for (const item of items) {
          await processItem({ id: item.id });
        }
      }
    `;
    const diags = cloudfunctionInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG017');
  });

  it('fires on httpsCallable variable invoked in forEach (awaited)', () => {
    const src = `
      async function notifyAll(userIds: string[]) {
        const sendNotif = httpsCallable(functions, 'sendNotification');
        userIds.forEach(async (uid) => {
          await sendNotif({ userId: uid });
        });
      }
    `;
    const diags = cloudfunctionInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG017');
  });

  it('fires on inline httpsCallable invocation in a loop (awaited)', () => {
    const src = `
      async function runAll(items: string[]) {
        for (const item of items) {
          await httpsCallable(functions, 'process')(item);
        }
      }
    `;
    const diags = cloudfunctionInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG017');
  });

  it('does not fire when using Promise.all fan-out', () => {
    const src = `
      async function processAll(items: Item[]) {
        const processItem = httpsCallable(functions, 'processItem');
        await Promise.all(items.map(item => processItem({ id: item.id })));
      }
    `;
    const diags = cloudfunctionInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG017')).toHaveLength(0);
  });

  it('does not fire when httpsCallable is invoked once outside any loop', () => {
    const src = `
      async function processOne(item: Item) {
        const processItem = httpsCallable(functions, 'processItem');
        await processItem({ id: item.id });
      }
    `;
    const diags = cloudfunctionInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG017')).toHaveLength(0);
  });

  it('does not fire when there is no httpsCallable at all', () => {
    const src = `
      async function doWork(items: string[]) {
        for (const item of items) {
          console.log(item);
        }
      }
    `;
    const diags = cloudfunctionInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG017')).toHaveLength(0);
  });
});
