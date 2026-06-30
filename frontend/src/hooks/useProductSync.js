/**
 * useProductSync.js — Subscribes to the user's products in Firestore
 * and keeps the Zustand store in sync in real time.
 */
import { useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { useAuth } from './useAuth.jsx';
import { useStore } from '../store/store.js';

export function useProductSync() {
  const { user } = useAuth();
  const { setProducts } = useStore();

  useEffect(() => {
    if (!user) { setProducts([]); return; }

    const q = query(
      collection(db, 'products'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const products = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.().toISOString() || new Date().toISOString(),
      }));
      setProducts(products);
    }, (err) => {
      console.error('Product sync error:', err);
    });

    return unsub;
  }, [user?.uid]);
}

export default useProductSync;
