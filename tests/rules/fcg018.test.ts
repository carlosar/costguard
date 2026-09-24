import { describe, it, expect } from 'vitest';
import { missingDepsArrayRule } from '../../src/analyzer/rules/missing-deps-array';

const FILE = 'test.tsx';

describe('FCG018 — useEffect with no dependency array + expensive operation', () => {
  it('fires on a no-deps effect that opens an onSnapshot listener', () => {
    const src = `
      function LiveOrders() {
        const [orders, setOrders] = useState([]);
        useEffect(() => {
          return onSnapshot(query(collection(db, 'orders'), limit(20)), s => setOrders(s.docs));
        });
      }
    `;
    const diags = missingDepsArrayRule.analyze(src, FILE);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('FCG018');
  });

  it('fires on a no-deps effect that calls getDocs', () => {
    const src = `
      function Dashboard() {
        const [d, setD] = useState(null);
        useEffect(() => {
          getDocs(query(collection(db, 'stats'), limit(5))).then(setD);
        });
      }
    `;
    const diags = missingDepsArrayRule.analyze(src, FILE);
    expect(diags).toHaveLength(1);
  });

  it('fires inside a custom hook', () => {
    const src = `
      export function useOrders() {
        const [o, setO] = useState([]);
        useEffect(() => {
          getDocs(query(collection(db, 'orders'), limit(20))).then(s => setO(s.docs));
        });
        return o;
      }
    `;
    const diags = missingDepsArrayRule.analyze(src, FILE);
    expect(diags).toHaveLength(1);
  });

  it('fires on fetch in a no-deps effect', () => {
    const src = `
      function Remote() {
        useEffect(() => {
          fetch('/api/expensive').then(r => r.json()).then(setD);
        });
      }
    `;
    const diags = missingDepsArrayRule.analyze(src, FILE);
    expect(diags).toHaveLength(1);
  });

  it('fires on an httpsCallable invocation in a no-deps effect', () => {
    const src = `
      function Billed() {
        const run = httpsCallable(functions, 'generateReport');
        useEffect(() => {
          run({});
        });
      }
    `;
    const diags = missingDepsArrayRule.analyze(src, FILE);
    expect(diags).toHaveLength(1);
  });

  it('does not fire when an empty deps array is present', () => {
    const src = `
      function Once() {
        useEffect(() => {
          getDocs(query(collection(db, 'stats'), limit(5))).then(setD);
        }, []);
      }
    `;
    expect(missingDepsArrayRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire when a populated deps array is present', () => {
    const src = `
      function ById({ id }) {
        useEffect(() => {
          getDoc(doc(db, 'items', id)).then(setD);
        }, [id]);
      }
    `;
    expect(missingDepsArrayRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire when deps are passed as a variable', () => {
    const src = `
      function Dyn({ deps }) {
        useEffect(() => {
          getDocs(query(collection(db, 'x'), limit(5)));
        }, deps);
      }
    `;
    expect(missingDepsArrayRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on a no-deps effect with no expensive operation', () => {
    const src = `
      function Title({ name }) {
        useEffect(() => {
          document.title = name;
        });
      }
    `;
    expect(missingDepsArrayRule.analyze(src, FILE)).toHaveLength(0);
  });

  it('does not fire on files without useEffect', () => {
    const src = `async function load() { return getDocs(collection(db, 'x')); }`;
    expect(missingDepsArrayRule.analyze(src, FILE)).toHaveLength(0);
  });
});
