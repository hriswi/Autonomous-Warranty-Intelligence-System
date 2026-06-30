/**
 * useAuth.js — Auth state provider and hook.
 * Wraps Firebase Auth with session persistence, rate limiting on
 * failed attempts, and a clean React context API.
 */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../lib/firebase.js';

const AuthContext = createContext(null);

// Rate limiting: track failed login attempts per session
const RATE_LIMIT_MAX  = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function useRateLimit() {
  const attempts = useRef([]);

  const isBlocked = () => {
    const now = Date.now();
    attempts.current = attempts.current.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    return attempts.current.length >= RATE_LIMIT_MAX;
  };

  const recordAttempt = () => { attempts.current.push(Date.now()); };
  const remainingAttempts = () => Math.max(0, RATE_LIMIT_MAX - attempts.current.length);

  return { isBlocked, recordAttempt, remainingAttempts };
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const rateLimit             = useRateLimit();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Fetch or create user profile in Firestore
        const ref = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          await setDoc(ref, {
            uid: firebaseUser.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName || '',
            photoURL: firebaseUser.photoURL || null,
            createdAt: serverTimestamp(),
            lastLogin: serverTimestamp(),
          });
        } else {
          await setDoc(ref, { lastLogin: serverTimestamp() }, { merge: true });
        }
        setUser({ ...firebaseUser, profile: snap.data() });
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Input sanitisation — strip control characters before sending to Firebase
  const sanitize = (str) => str.replace(/[\x00-\x1F\x7F]/g, '').trim();

  const register = async (email, password, displayName) => {
    setError(null);
    const safeEmail = sanitize(email);
    const safeName  = sanitize(displayName);

    // Basic validation
    if (!safeEmail.includes('@')) throw new Error('Invalid email address.');
    if (password.length < 8)     throw new Error('Password must be at least 8 characters.');
    if (safeName.length < 2)     throw new Error('Display name must be at least 2 characters.');

    const cred = await createUserWithEmailAndPassword(auth, safeEmail, password);
    await updateProfile(cred.user, { displayName: safeName });
    await sendEmailVerification(cred.user);
    return cred;
  };

  const login = async (email, password) => {
    setError(null);
    if (rateLimit.isBlocked()) {
      throw new Error(`Too many failed attempts. Please wait 15 minutes before trying again.`);
    }
    try {
      const cred = await signInWithEmailAndPassword(auth, sanitize(email), password);
      return cred;
    } catch (err) {
      rateLimit.recordAttempt();
      throw err;
    }
  };

  const loginWithGoogle = async () => {
    setError(null);
    return signInWithPopup(auth, googleProvider);
  };

  const logout = () => signOut(auth);

  const resetPassword = async (email) => {
    setError(null);
    await sendPasswordResetEmail(auth, sanitize(email));
  };

  const value = {
    user,
    loading,
    error,
    register,
    login,
    loginWithGoogle,
    logout,
    resetPassword,
    isAuthenticated: !!user,
    remainingLoginAttempts: rateLimit.remainingAttempts,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
