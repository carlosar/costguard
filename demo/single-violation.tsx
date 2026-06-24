// @ts-nocheck
// ============================================================
// COSTGUARD DEMO FILE — Single Violation (FCG001)
// ============================================================
// Open this file in VS Code with CostGuard installed.
// You should see a single red/yellow squiggle appear within 1 second.
// This is a static-analysis fixture, not code meant to compile/run —
// @ts-nocheck suppresses unrelated "module not found" noise so only the
// CostGuard diagnostic shows during recording.
// ============================================================

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';

// ------------------------------------------------------------
// FCG001 — Unstable useEffect dependency
// `users` is set inside this same effect (via setUsers) while also being
// a dependency — the update re-triggers the effect: an infinite loop.
// ------------------------------------------------------------
export function UnstableDepDemo() {
  const [users, setUsers] = useState<any[]>([]);

  useEffect(() => {
    async function loadData() {
      const snapshot = await getDocs(collection(db, 'users'));
      setUsers(snapshot.docs.map(d => d.data()));
    }
    loadData();
  }, [users]); // FCG001

  return (
    <ul>
      {users.map(u => <li key={u.id}>{u.name}</li>)}
    </ul>
  );
}
