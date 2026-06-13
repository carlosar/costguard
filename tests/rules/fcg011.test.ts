import { describe, it, expect } from 'vitest';
import { highFreqHandlerRule } from '../../src/analyzer/rules/high-freq-handler';

const FILE = 'test.tsx';

describe('FCG011 — expensive op in high-frequency event handler', () => {
  it('fires on getDoc inside scroll addEventListener (awaited)', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          window.addEventListener('scroll', async () => {
            const snap = await getDoc(doc(db, 'config', 'main'));
            setScrollData(snap.data());
          });
        }, []);
      }
    `;
    const diags = highFreqHandlerRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG011');
  });

  it('fires on fetch inside mousemove addEventListener (awaited)', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          window.addEventListener('mousemove', async (e) => {
            await fetch('/api/track', { method: 'POST', body: JSON.stringify(e) });
          });
        }, []);
      }
    `;
    const diags = highFreqHandlerRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG011');
  });

  it('fires on JSX onScroll prop with fetch handler', () => {
    const src = `
      function MyList() {
        const handleScroll = async (e) => {
          await fetch('/api/log', { method: 'POST' });
        };
        return <div onScroll={handleScroll} />;
      }
    `;
    const diags = highFreqHandlerRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG011');
  });

  it('does not fire when handler is inline-wrapped in debounce', () => {
    // The debounce check runs on the raw argument text passed to addEventListener.
    // An inline debounce(...) call is visible in the argument text; a pre-assigned
    // variable is resolved to its body, so the expensive op inside is still found.
    const src = `
      function MyComponent() {
        useEffect(() => {
          window.addEventListener('scroll', debounce(async () => {
            await getDoc(doc(db, 'config', 'main'));
          }, 300));
        }, []);
      }
    `;
    const diags = highFreqHandlerRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG011')).toHaveLength(0);
  });

  it('does not fire on click handler with getDoc (not high-freq)', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          button.addEventListener('click', async () => {
            const snap = await getDoc(doc(db, 'config', 'main'));
            setData(snap.data());
          });
        }, []);
      }
    `;
    const diags = highFreqHandlerRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG011')).toHaveLength(0);
  });

  it('does not fire when no expensive op is present', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          window.addEventListener('scroll', (e) => {
            console.log(e.scrollY);
          });
        }, []);
      }
    `;
    const diags = highFreqHandlerRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG011')).toHaveLength(0);
  });
});
