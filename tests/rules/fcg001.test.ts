import { describe, it, expect } from 'vitest';
import { unstableDepsRule } from '../../src/analyzer/rules/unstable-deps';

const FILE = 'test.tsx';

describe('FCG001 — unstable useEffect dependency', () => {
  it('fires on object literal dependency', () => {
    const src = `
      function MyComponent() {
        const config = { key: 'value' };
        useEffect(() => { console.log(config); }, [config]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG001');
  });

  it('fires on array literal dependency', () => {
    const src = `
      function MyComponent() {
        const ids = [1, 2, 3];
        useEffect(() => { fetch(ids); }, [ids]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG001');
  });

  it('fires on arrow function dependency', () => {
    const src = `
      function MyComponent() {
        const handler = () => doSomething();
        useEffect(() => { handler(); }, [handler]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG001');
  });

  it('fires on call expression dependency not wrapped in stable hook', () => {
    const src = `
      function MyComponent() {
        const config = getFirebaseConfig();
        useEffect(() => { doSomething(config); }, [config]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0].code).toBe('FCG001');
  });

  it('does not fire when object is wrapped in useMemo', () => {
    const src = `
      function MyComponent() {
        const config = useMemo(() => ({ key: 'value' }), []);
        useEffect(() => { console.log(config); }, [config]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG001')).toHaveLength(0);
  });

  it('does not fire when function is wrapped in useCallback', () => {
    const src = `
      function MyComponent() {
        const handler = useCallback(() => doSomething(), []);
        useEffect(() => { handler(); }, [handler]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG001')).toHaveLength(0);
  });

  it('does not fire when dependency is a primitive (string from useState)', () => {
    const src = `
      function MyComponent() {
        const [userId, setUserId] = useState('');
        useEffect(() => { fetchUser(userId); }, [userId]);
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG001')).toHaveLength(0);
  });

  it('does not fire when there is no deps array', () => {
    const src = `
      function MyComponent() {
        useEffect(() => { doSomething(); });
      }
    `;
    const diags = unstableDepsRule.analyze(src, FILE);
    expect(diags.filter(d => d.code === 'FCG001')).toHaveLength(0);
  });
});
