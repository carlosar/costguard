import { describe, it, expect } from 'vitest';
import { readInRenderRule } from '../../src/analyzer/rules/read-in-render';

const FILE = 'test.tsx';

describe('FCG009 — Firestore read in component body (outside useEffect)', () => {
  it('fires on getDoc called directly in component body', () => {
    const src = `
      function MyComponent() {
        const snap = getDoc(doc(db, 'config', 'main'));
        return <div />;
      }
    `;
    const diags = readInRenderRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG009');
  });

  it('fires on getDocs called directly in component body', () => {
    const src = `
      const Dashboard = () => {
        const snap = getDocs(collection(db, 'orders'));
        return <div />;
      };
    `;
    const diags = readInRenderRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG009');
  });

  it('does not fire when getDoc is inside useEffect', () => {
    const src = `
      function MyComponent() {
        useEffect(() => {
          getDoc(doc(db, 'config', 'main')).then(setData);
        }, []);
        return <div />;
      }
    `;
    const diags = readInRenderRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG009')).toHaveLength(0);
  });

  it('does not fire when getDoc is inside an onClick handler', () => {
    const src = `
      function MyComponent() {
        const handleClick = async () => {
          const snap = await getDoc(doc(db, 'config', 'main'));
          setData(snap.data());
        };
        return <button onClick={handleClick} />;
      }
    `;
    const diags = readInRenderRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG009')).toHaveLength(0);
  });

  it('does not fire when getDoc is in a standalone helper function', () => {
    const src = `
      async function fetchConfig() {
        const snap = await getDoc(doc(db, 'config', 'main'));
        return snap.data();
      }
    `;
    const diags = readInRenderRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG009')).toHaveLength(0);
  });
});
