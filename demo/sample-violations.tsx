// ============================================================
// COSTGUARD DEMO FILE — Full Rule Coverage (FCG001–FCG017)
// ============================================================
// Open this file in VS Code with CostGuard installed.
// You should see red/yellow squiggles appear within 1 second.
// Each section below is an isolated, self-contained trigger for one rule
// so every diagnostic can be screenshotted independently.
//
// NOTE: this file mixes client SDK calls (firebase/firestore,
// firebase/functions) with Cloud Functions backend SDK calls
// (firebase-functions) purely so every rule has a realistic trigger in one
// place. It is a static-analysis fixture, not code meant to run.
// ============================================================

import { useEffect, useState } from 'react';
import {
  collection, getDocs, getDoc, doc, onSnapshot,
  setDoc, updateDoc
} from 'firebase/firestore';
import { httpsCallable, getFunctions } from 'firebase/functions';
import { onRequest } from 'firebase-functions/v2/https';
import { db } from './firebase';

const functionsClient = getFunctions();

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

// ------------------------------------------------------------
// FCG002 — Unbounded Firestore collection read (no .limit())
// ------------------------------------------------------------
export async function loadAllOrdersUnbounded() {
  const snap = await collection(db, 'orders').get(); // FCG002 — no .limit()
  return snap.docs.map((d: any) => d.data());
}

// ------------------------------------------------------------
// FCG003 — Firestore listener with UI state dependency
// `activeTab` is UI state — switching tabs tears down and recreates this
// listener, re-reading the full collection every time.
// ------------------------------------------------------------
export function ListenerUiDepDemo({ activeTab }: { activeTab: string }) {
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'orders'), snap => {
      setOrders(snap.docs.map(d => d.data()));
    });
    return () => unsubscribe();
  }, [activeTab]); // FCG003

  return (
    <ul>
      {orders.map(o => <li key={o.id}>{o.name}</li>)}
    </ul>
  );
}

// ------------------------------------------------------------
// FCG004 — onSnapshot listener without cleanup
// ------------------------------------------------------------
export function SnapshotCleanupDemo() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    onSnapshot(collection(db, 'items'), snap => { // FCG004 — no unsubscribe returned
      setItems(snap.docs.map(d => d.data()));
    });
  }, []);

  return (
    <ul>
      {items.map(i => <li key={i.id}>{i.name}</li>)}
    </ul>
  );
}

// ------------------------------------------------------------
// FCG005 — Firestore read inside a loop
// ------------------------------------------------------------
export async function loadItemsByIds(ids: string[]) {
  const results: any[] = [];
  for (const id of ids) {
    const snap = await getDoc(doc(db, 'items', id)); // FCG005 — one read per iteration
    results.push(snap.data());
  }
  return results;
}

// ------------------------------------------------------------
// FCG006 — setInterval without clearInterval cleanup
// ------------------------------------------------------------
export function IntervalCleanupDemo() {
  useEffect(() => {
    setInterval(() => { // FCG006 — no clearInterval returned
      console.log('tick');
    }, 5000);
  }, []);

  return null;
}

// ------------------------------------------------------------
// FCG007 — addEventListener without removeEventListener cleanup
// ------------------------------------------------------------
export function EventListenerCleanupDemo() {
  useEffect(() => {
    window.addEventListener('resize', handleResize); // FCG007 — no removeEventListener returned
  }, []);

  function handleResize() {
    console.log(window.innerWidth);
  }

  return null;
}

// ------------------------------------------------------------
// FCG008 — fetch/axios call inside a loop
// ------------------------------------------------------------
export async function loadAllUrls(urls: string[]) {
  const results: any[] = [];
  for (const url of urls) {
    const res = await fetch(url); // FCG008 — one HTTP request per iteration
    results.push(await res.json());
  }
  return results;
}

// ------------------------------------------------------------
// FCG009 — Firestore read in component body (outside useEffect)
// ------------------------------------------------------------
export function ReadInRenderDemo() {
  const snap = getDoc(doc(db, 'config', 'main')); // FCG009 — runs on every render
  return <div>{String(snap)}</div>;
}

// ------------------------------------------------------------
// FCG010 — Compound render-loop: unstable dep + expensive op
// `queryParams` is a new object reference every render — combined with the
// getDoc() call in the same effect, this is an infinite billing loop.
// ------------------------------------------------------------
export function CompoundRenderLoopDemo() {
  const [data, setData] = useState<any>(null);
  const queryParams = { status: 'active' };

  useEffect(() => {
    getDoc(doc(db, 'config', 'main')).then(snap => setData(snap.data())); // FCG010
  }, [queryParams]);

  return <div>{JSON.stringify(data)}</div>;
}

// ------------------------------------------------------------
// FCG011 — Expensive operation inside a high-frequency event handler
// ------------------------------------------------------------
export function HighFreqHandlerDemo() {
  useEffect(() => {
    window.addEventListener('scroll', async () => { // FCG011 — no debounce/throttle
      const snap = await getDoc(doc(db, 'config', 'main'));
      console.log(snap.data());
    });
  }, []);

  return null;
}

// ------------------------------------------------------------
// FCG012 — Unbatched Firestore writes inside a loop
// ------------------------------------------------------------
export async function saveAllItems(items: { id: string; name: string }[]) {
  for (const item of items) {
    await setDoc(doc(db, 'items', item.id), item); // FCG012 — one write per iteration
  }
}

// ------------------------------------------------------------
// FCG013 — Polling Firestore with setInterval (use onSnapshot instead)
// ------------------------------------------------------------
export function startOrderPolling() {
  setInterval(async () => {
    const snap = await getDocs(collection(db, 'orders')); // FCG013 — polling reads
    console.log(snap.docs.map(d => d.data()));
  }, 5000);
}

// ------------------------------------------------------------
// FCG014 — Client-side filtering of an unfiltered collection read
// ------------------------------------------------------------
export async function getPendingOrders() {
  const snap = await getDocs(collection(db, 'orders'));
  const pending = snap.docs.filter(d => d.data().status === 'pending'); // FCG014
  return pending;
}

// ------------------------------------------------------------
// FCG015 — FieldValue atomics not used for array/counter mutations
// ------------------------------------------------------------
export async function addTagToItem(itemId: string, tag: string) {
  const snap = await getDoc(doc(db, 'items', itemId));
  const data = snap.data()!;
  data.tags.push(tag); // FCG015 — read-modify-write pattern, should be atomic
  await updateDoc(doc(db, 'items', itemId), { tags: data.tags });
}

// ------------------------------------------------------------
// FCG016 — Cloud Function defined but not exported
// ------------------------------------------------------------
const onItemCreatedHandler = onRequest((req, res) => { // FCG016 — never exported
  res.send('ok');
});

// ------------------------------------------------------------
// FCG017 — Cloud Function (httpsCallable) invoked inside a loop
// ------------------------------------------------------------
export async function notifyAllUsers(userIds: string[]) {
  const sendNotification = httpsCallable(functionsClient, 'sendNotification');
  for (const uid of userIds) {
    await sendNotification({ userId: uid }); // FCG017 — one Cloud Function call per iteration
  }
}
