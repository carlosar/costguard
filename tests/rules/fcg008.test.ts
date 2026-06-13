import { describe, it, expect } from 'vitest';
import { fetchInLoopRule } from '../../src/analyzer/rules/fetch-in-loop';

const FILE = 'test.ts';

describe('FCG008 — fetch/axios inside a loop', () => {
  it('fires on fetch inside a for-of loop (awaited)', () => {
    const src = `
      async function loadAll(urls: string[]) {
        for (const url of urls) {
          const res = await fetch(url);
          results.push(await res.json());
        }
      }
    `;
    const diags = fetchInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG008');
  });

  it('fires on axios.get inside forEach (awaited)', () => {
    const src = `
      async function processItems(items: string[]) {
        items.forEach(async (item) => {
          const result = await axios.get('/api/' + item);
          process(result.data);
        });
      }
    `;
    const diags = fetchInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG008');
  });

  it('does not fire when inside Promise.all fan-out', () => {
    const src = `
      async function loadAll(urls: string[]) {
        const results = await Promise.all(urls.map(url => fetch(url)));
      }
    `;
    const diags = fetchInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG008')).toHaveLength(0);
  });

  it('does not fire when fetch is outside a loop', () => {
    const src = `
      async function loadOne(url: string) {
        const res = await fetch(url);
        return res.json();
      }
    `;
    const diags = fetchInLoopRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG008')).toHaveLength(0);
  });

  it('fires on axios.post inside a while loop (awaited)', () => {
    const src = `
      async function drain(queue: Item[]) {
        while (queue.length) {
          const item = queue.shift()!;
          await axios.post('/api/process', item);
        }
      }
    `;
    const diags = fetchInLoopRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG008');
  });
});
