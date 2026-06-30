/**
 * ProductsPage.jsx — Full product list with grid/table toggle, filters, search.
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Grid3X3, List, Search, SlidersHorizontal, Plus,
  Package, ChevronRight, Clock, AlertTriangle, TrendingUp, Shield,
} from 'lucide-react';
import { useStore } from '../../store/store.js';
import { differenceInDays } from 'date-fns';

function getWarrantyStatus(product) {
  if (!product.purchaseDate || !product.warrantyMonths) return { status: 'unknown', days: null, expiry: null };
  const purchase = new Date(product.purchaseDate);
  const expiry = new Date(purchase);
  expiry.setMonth(expiry.getMonth() + product.warrantyMonths);
  const days = differenceInDays(expiry, new Date());
  if (days < 0) return { status: 'expired', days: Math.abs(days), expiry };
  if (days <= 30) return { status: 'expiring', days, expiry };
  return { status: 'active', days, expiry };
}

const STATUS_STYLES = {
  active:   { label: 'Active',   color: 'rgba(255,255,255,0.5)' },
  expiring: { label: 'Expiring', color: 'rgba(255,255,255,0.85)' },
  expired:  { label: 'Expired',  color: 'rgba(255,255,255,0.2)' },
  unknown:  { label: 'Unknown',  color: 'rgba(255,255,255,0.15)' },
};

function ProductCard({ product }) {
  const ws = getWarrantyStatus(product);
  const st = STATUS_STYLES[ws.status];

  return (
    <Link
      to={`/dashboard/products/${product.id}`}
      className="data-card flex flex-col justify-between gap-4 group"
      style={{ minHeight: '160px', transition: 'background 200ms, border-color 200ms' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
    >
      <div className="flex items-start justify-between">
        <div
          className="w-9 h-9 rounded-[8px] flex items-center justify-center"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
        >
          <Package size={16} className="text-white/40" strokeWidth={1.5} />
        </div>
        <span className="text-[10px] font-mono tracking-widest uppercase" style={{ color: st.color }}>
          {st.label}
        </span>
      </div>

      <div className="flex-1">
        <p className="text-white/80 text-sm font-medium leading-tight mb-1 line-clamp-2">
          {product.productName || 'Unnamed Product'}
        </p>
        <p className="text-white/30 text-xs">{product.brand || product.category || '—'}</p>
      </div>

      <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div>
          {ws.expiry && (
            <p className="text-white/25 text-xs">
              {ws.status === 'expired' ? 'Expired' : 'Expires'} {ws.expiry.toLocaleDateString()}
            </p>
          )}
          {product.riskScore != null && (
            <p className="text-white/20 text-[11px] font-mono">Risk {product.riskScore}/100</p>
          )}
        </div>
        <ChevronRight size={13} className="text-white/15 group-hover:text-white/40 transition-colors" />
      </div>
    </Link>
  );
}

function ProductTableRow({ product }) {
  const ws = getWarrantyStatus(product);
  const st = STATUS_STYLES[ws.status];

  return (
    <Link
      to={`/dashboard/products/${product.id}`}
      className="flex items-center gap-4 px-4 py-3 group rounded-[6px] transition-all duration-150"
      style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <Package size={15} className="text-white/25 shrink-0" strokeWidth={1.5} />
      <div className="flex-1 min-w-0">
        <p className="text-white/75 text-sm font-medium truncate">{product.productName || '—'}</p>
        <p className="text-white/30 text-xs">{product.brand || '—'}</p>
      </div>
      <p className="text-white/30 text-xs hidden md:block w-32">{product.category || '—'}</p>
      <p className="text-xs shrink-0 w-24 text-right" style={{ color: st.color }}>
        {ws.status === 'expired' ? `Expired ${ws.days}d ago` : ws.days != null ? `${ws.days}d left` : '—'}
      </p>
      {product.riskScore != null
        ? <p className="text-white/30 text-xs font-mono w-16 text-right hidden lg:block">{product.riskScore}/100</p>
        : <p className="w-16 hidden lg:block" />}
      <ChevronRight size={13} className="text-white/15 group-hover:text-white/40 transition-colors shrink-0" />
    </Link>
  );
}

export default function ProductsPage() {
  const { products, dashboardView, setDashboardView, dashboardSort, setDashboardSort, dashboardFilter, setDashboardFilter } = useStore();

  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = [...products];

    // Search
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p) =>
        (p.productName || '').toLowerCase().includes(q) ||
        (p.brand || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }

    // Filter
    if (dashboardFilter !== 'all') {
      list = list.filter((p) => {
        const ws = getWarrantyStatus(p);
        if (dashboardFilter === 'active')   return ws.status === 'active';
        if (dashboardFilter === 'expired')  return ws.status === 'expired';
        if (dashboardFilter === 'expiring') return ws.status === 'expiring';
        if (dashboardFilter === 'high_risk') return (p.riskScore || 0) >= 65;
        return true;
      });
    }

    // Sort
    list.sort((a, b) => {
      if (dashboardSort === 'expiry') {
        const wa = getWarrantyStatus(a); const wb = getWarrantyStatus(b);
        return (wa.days ?? 9999) - (wb.days ?? 9999);
      }
      if (dashboardSort === 'risk') return (b.riskScore || 0) - (a.riskScore || 0);
      if (dashboardSort === 'name') return (a.productName || '').localeCompare(b.productName || '');
      return 0;
    });

    return list;
  }, [products, search, dashboardFilter, dashboardSort]);

  const FILTERS = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'expiring', label: 'Expiring' },
    { key: 'expired', label: 'Expired' },
    { key: 'high_risk', label: 'High risk' },
  ];

  return (
    <div className="p-6 lg:p-8 max-w-6xl mx-auto page-enter">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-equinox text-white mb-1" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>My products</h1>
          <p className="text-white/35 text-sm">{products.length} product{products.length !== 1 ? 's' : ''} tracked</p>
        </div>
        <Link to="/dashboard/upload" className="btn-primary text-sm">
          <Plus size={15} /> Add product
        </Link>
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/25" />
          <input
            type="text"
            placeholder="Search products, brands…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field pl-11 w-full"
          />
        </div>

        {/* Sort */}
        <select
          value={dashboardSort}
          onChange={(e) => setDashboardSort(e.target.value)}
          className="input-field w-auto pr-8"
        >
          <option value="expiry">Sort: Expiry</option>
          <option value="risk">Sort: Risk</option>
          <option value="name">Sort: Name</option>
        </select>

        {/* View toggle */}
        <div className="flex" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', overflow: 'hidden' }}>
          {[{ v: 'grid', Icon: Grid3X3 }, { v: 'table', Icon: List }].map(({ v, Icon }) => (
            <button
              key={v}
              onClick={() => setDashboardView(v)}
              className="p-2.5 transition-all"
              style={{
                background: dashboardView === v ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: dashboardView === v ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
              }}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDashboardFilter(key)}
            className="text-xs px-3 py-1.5 rounded-full transition-all"
            style={{
              background: dashboardFilter === key ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${dashboardFilter === key ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`,
              color: dashboardFilter === key ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Package size={28} className="text-white/15 mb-4" strokeWidth={1} />
          <p className="text-white/30 text-sm mb-2">{search || dashboardFilter !== 'all' ? 'No products match your filters.' : 'No products yet.'}</p>
          {!search && dashboardFilter === 'all' && (
            <Link to="/dashboard/upload" className="btn-ghost text-xs mt-4">Add your first product</Link>
          )}
        </div>
      )}

      {/* Grid view */}
      {dashboardView === 'grid' && filtered.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      )}

      {/* Table view */}
      {dashboardView === 'table' && filtered.length > 0 && (
        <div className="rounded-[10px] overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
          {/* Table header */}
          <div
            className="flex items-center gap-4 px-4 py-3"
            style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
          >
            <div className="w-4" />
            <p className="flex-1 text-white/30 text-xs uppercase tracking-[0.1em]">Product</p>
            <p className="text-white/30 text-xs uppercase tracking-[0.1em] hidden md:block w-32">Category</p>
            <p className="text-white/30 text-xs uppercase tracking-[0.1em] w-24 text-right">Warranty</p>
            <p className="text-white/30 text-xs uppercase tracking-[0.1em] w-16 text-right hidden lg:block">Risk</p>
            <div className="w-4" />
          </div>
          {filtered.map((p) => <ProductTableRow key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
