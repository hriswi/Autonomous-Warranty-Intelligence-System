/**
 * store.js — Global Zustand store.
 * Products, UI theme, notifications, and agent state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useStore = create(
  persist(
    (set, get) => ({
      // ── Theme ──────────────────────────────────────────────────────────
      theme: 'dark', // 'dark' | 'light'
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark';
        document.documentElement.classList.toggle('light', next === 'light');
        set({ theme: next });
      },

      // ── Products ───────────────────────────────────────────────────────
      products: [],
      addProduct:    (product) => set((s) => ({ products: [product, ...s.products] })),
      updateProduct: (id, updates) =>
        set((s) => ({ products: s.products.map((p) => (p.id === id ? { ...p, ...updates } : p)) })),
      deleteProduct: (id) =>
        set((s) => ({ products: s.products.filter((p) => p.id !== id) })),
      setProducts:   (products) => set({ products }),

      // ── Notifications ──────────────────────────────────────────────────
      notifications: [],
      addNotification: (notif) =>
        set((s) => ({ notifications: [{ id: Date.now(), ...notif }, ...s.notifications].slice(0, 50) })),
      markRead: (id) =>
        set((s) => ({ notifications: s.notifications.map((n) => n.id === id ? { ...n, read: true } : n) })),
      clearNotifications: () => set({ notifications: [] }),

      // ── Upload state ───────────────────────────────────────────────────
      uploadProgress: null,
      setUploadProgress: (p) => set({ uploadProgress: p }),

      // ── Agent memory (serialised) ──────────────────────────────────────
      agentMemory: null,
      setAgentMemory: (m) => set({ agentMemory: m }),

      // ── Dashboard view ─────────────────────────────────────────────────
      dashboardView: 'grid', // 'grid' | 'table'
      setDashboardView: (v) => set({ dashboardView: v }),
      dashboardSort: 'expiry', // 'expiry' | 'risk' | 'name' | 'date'
      setDashboardSort: (s) => set({ dashboardSort: s }),
      dashboardFilter: 'all', // 'all' | 'active' | 'expired' | 'expiring' | 'high_risk'
      setDashboardFilter: (f) => set({ dashboardFilter: f }),
    }),
    {
      name: 'warranty-vault-store',
      partialize: (s) => ({ theme: s.theme, dashboardView: s.dashboardView, agentMemory: s.agentMemory }),
    }
  )
);
