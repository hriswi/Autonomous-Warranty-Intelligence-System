/**
 * DashboardPage.jsx — Overview. Analytics cards, alerts, recent products.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import {
  Shield, AlertTriangle, Clock, TrendingUp, Upload,
  ChevronRight, Package, Zap, ArrowUpRight,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useStore } from '../../store/store.js';
import { formatDistanceToNow, differenceInDays } from 'date-fns';

// ── Helpers ────────────────────────────────────────────────────────────────
function getRiskColor(score) {
  if (!score && score !== 0) return 'rgba(255,255,255,0.2)';
  if (score >= 80) return 'rgba(255,255,255,0.85)';
  if (score >= 65) return 'rgba(255,255,255,0.6)';
  if (score >= 45) return 'rgba(255,255,255,0.4)';
  return 'rgba(255,255,255,0.2)';
}

function getWarrantyStatus(product) {
  if (!product.purchaseDate || !product.warrantyMonths) return { status: 'unknown', days: null };
  const purchase = new Date(product.purchaseDate);
  const expiry = new Date(purchase);
  expiry.setMonth(expiry.getMonth() + product.warrantyMonths);
  const days = differenceInDays(expiry, new Date());
  if (days < 0) return { status: 'expired', days: Math.abs(days), expiry };
  if (days <= 30) return { status: 'expiring', days, expiry };
  return { status: 'active', days, expiry };
}

// ── Stat card ──────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div
      className="data-card flex flex-col justify-between gap-4"
      style={{ minHeight: '120px' }}
    >
      <div className="flex items-start justify-between">
        <Icon size={18} className="text-white/30" strokeWidth={1.5} />
        {accent && (
          <span
            className="text-[10px] font-mono tracking-widest uppercase px-2 py-1 rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.4)' }}
          >
            {accent}
          </span>
        )}
      </div>
      <div>
        <p className="text-3xl font-light text-white mb-1">{value}</p>
        <p className="text-xs text-white/35">{label}</p>
        {sub && <p className="text-xs text-white/20 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ── Product row ────────────────────────────────────────────────────────────
function ProductRow({ product }) {
  const ws = getWarrantyStatus(product);
  const statusColors = {
    active:   'rgba(255,255,255,0.45)',
    expiring: 'rgba(255,255,255,0.75)',
    expired:  'rgba(255,255,255,0.2)',
    unknown:  'rgba(255,255,255,0.15)',
  };

  return (
    <Link
      to={`/dashboard/products/${product.id}`}
      className="flex items-center gap-4 px-4 py-3 rounded-[8px] group transition-all duration-150"
      style={{ background: 'rgba(255,255,255,0)', border: '1px solid transparent' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0.025)';
        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(255,255,255,0)';
        e.currentTarget.style.borderColor = 'transparent';
      }}
    >
      {/* Product icon */}
      <div
        className="w-8 h-8 rounded-[6px] flex items-center justify-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        <Package size={14} className="text-white/40" />
      </div>

      {/* Name + brand */}
      <div className="flex-1 min-w-0">
        <p className="text-white/80 text-sm font-medium truncate">{product.productName || 'Unknown Product'}</p>
        <p className="text-white/30 text-xs truncate">{product.brand || product.category || '—'}</p>
      </div>

      {/* Warranty status */}
      <div className="text-right shrink-0">
        <p className="text-xs" style={{ color: statusColors[ws.status] }}>
          {ws.status === 'expired'  && `Expired ${ws.days}d ago`}
          {ws.status === 'expiring' && `${ws.days}d left`}
          {ws.status === 'active'   && `${ws.days}d left`}
          {ws.status === 'unknown'  && 'Unknown'}
        </p>
        <p className="text-white/20 text-[11px]">{ws.expiry ? ws.expiry.toLocaleDateString() : '—'}</p>
      </div>

      {/* Risk score */}
      {product.riskScore != null && (
        <div
          className="text-xs font-mono w-8 text-right shrink-0"
          style={{ color: getRiskColor(product.riskScore) }}
        >
          {product.riskScore}
        </div>
      )}

      <ChevronRight size={14} className="text-white/15 group-hover:text-white/40 transition-colors shrink-0" />
    </Link>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const { products } = useStore();
  const ref = useRef(null);
  const [now] = useState(new Date());

  useEffect(() => {
    const els = ref.current?.querySelectorAll('.stat-card, .section-card');
    if (!els?.length) return;
    gsap.set(els, { opacity: 0, y: 16 });
    gsap.to(els, { opacity: 1, y: 0, duration: 0.55, ease: 'power2.out', stagger: 0.06 });
  }, []);

  // Computed stats
  const activeProducts  = products.filter((p) => getWarrantyStatus(p).status === 'active');
  const expiringProducts= products.filter((p) => getWarrantyStatus(p).status === 'expiring');
  const expiredProducts = products.filter((p) => getWarrantyStatus(p).status === 'expired');
  const highRisk        = products.filter((p) => (p.riskScore || 0) >= 65);
  const fraudAlerts     = products.filter((p) => p.fraudWarning && p.fraudWarning !== 'CLEAN');

  const recentProducts = [...products]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 6);

  const displayName = user?.displayName?.split(' ')[0] || 'there';

  return (
    <div ref={ref} className="p-6 lg:p-8 max-w-6xl mx-auto page-enter">
      {/* Header */}
      <div className="mb-8">
        <p className="text-white/25 text-xs font-mono tracking-[0.2em] uppercase mb-2">
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="font-equinox text-white" style={{ fontSize: 'clamp(1.6rem, 3vw, 2.4rem)', letterSpacing: '0.04em' }}>
          Hello, {displayName}
        </h1>
      </div>

      {products.length === 0 ? (
        /* Empty state */
        <div
          className="stat-card flex flex-col items-center justify-center text-center py-24 rounded-[12px]"
          style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
        >
          <Upload size={28} className="text-white/20 mb-5" strokeWidth={1} />
          <h3 className="font-equinox text-white/60 text-lg mb-2" style={{ letterSpacing: '0.06em' }}>
            No products yet
          </h3>
          <p className="text-white/30 text-sm mb-8 max-w-xs">
            Upload an invoice and the intelligence engine will extract every warranty detail automatically.
          </p>
          <Link to="/dashboard/upload" className="btn-primary text-sm">
            Upload your first invoice
          </Link>
        </div>
      ) : (
        <>
          {/* Stats grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            <div className="stat-card">
              <StatCard icon={Shield} label="Active warranties" value={activeProducts.length} sub={`${products.length} total tracked`} />
            </div>
            <div className="stat-card">
              <StatCard icon={Clock} label="Expiring in 30 days" value={expiringProducts.length} accent={expiringProducts.length > 0 ? 'Action needed' : undefined} />
            </div>
            <div className="stat-card">
              <StatCard icon={TrendingUp} label="High risk products" value={highRisk.length} sub="Risk score ≥ 65" />
            </div>
            <div className="stat-card">
              <StatCard icon={AlertTriangle} label="Fraud alerts" value={fraudAlerts.length} accent={fraudAlerts.length > 0 ? 'Review' : undefined} />
            </div>
          </div>

          {/* Alerts strip */}
          {(expiringProducts.length > 0 || fraudAlerts.length > 0) && (
            <div className="section-card mb-8 flex flex-col gap-2">
              {expiringProducts.slice(0, 2).map((p) => {
                const ws = getWarrantyStatus(p);
                return (
                  <div
                    key={p.id}
                    className="flex items-center gap-4 px-4 py-3 rounded-[8px]"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                  >
                    <Clock size={14} className="text-white/50 shrink-0" />
                    <p className="text-white/70 text-sm flex-1">
                      <span className="font-medium">{p.productName}</span> warranty expires in{' '}
                      <span className="text-white">{ws.days} days</span>
                    </p>
                    <Link to={`/dashboard/products/${p.id}`} className="text-white/30 hover:text-white/70 transition-colors">
                      <ArrowUpRight size={14} />
                    </Link>
                  </div>
                );
              })}
              {fraudAlerts.slice(0, 1).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-4 px-4 py-3 rounded-[8px]"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <AlertTriangle size={14} className="text-white/40 shrink-0" />
                  <p className="text-white/60 text-sm flex-1">
                    Invoice for <span className="font-medium">{p.productName}</span> flagged — {p.fraudWarning}
                  </p>
                  <Link to="/dashboard/fraud" className="text-white/30 hover:text-white/70 transition-colors">
                    <ArrowUpRight size={14} />
                  </Link>
                </div>
              ))}
            </div>
          )}

          {/* Recent products */}
          <div className="section-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-equinox text-white/70 text-sm tracking-[0.08em]">RECENT PRODUCTS</h2>
              <Link to="/dashboard/products" className="text-white/30 text-xs hover:text-white/60 transition-colors flex items-center gap-1">
                View all <ChevronRight size={12} />
              </Link>
            </div>
            <div className="flex flex-col">
              {recentProducts.map((p) => (
                <ProductRow key={p.id} product={p} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
