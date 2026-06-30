/**
 * ExpiringPage.jsx — Products expiring within user-selected window.
 */
import React, { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Package, ChevronRight, ArrowUpRight } from 'lucide-react';
import { useStore } from '../../store/store.js';
import { differenceInDays } from 'date-fns';

function getWarrantyStatus(product) {
  if (!product.purchaseDate || !product.warrantyMonths) return null;
  const purchase = new Date(product.purchaseDate);
  const expiry = new Date(purchase);
  expiry.setMonth(expiry.getMonth() + product.warrantyMonths);
  const days = differenceInDays(expiry, new Date());
  return { days, expiry, isExpired: days < 0, isExpiring: days >= 0 && days <= 90 };
}

function UrgencyBadge({ days }) {
  if (days <= 0)  return <span className="badge badge-critical">Expired</span>;
  if (days <= 7)  return <span className="badge badge-critical">{days}d left</span>;
  if (days <= 30) return <span className="badge badge-high">{days}d left</span>;
  return <span className="badge badge-medium">{days}d left</span>;
}

function ExpiryCard({ product, ws }) {
  const urgency = ws.days <= 7 ? 'critical' : ws.days <= 30 ? 'high' : 'medium';
  const borderColor = urgency === 'critical' ? 'rgba(255,255,255,0.18)' : urgency === 'high' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)';

  return (
    <Link
      to={`/dashboard/products/${product.id}`}
      className="group flex items-center gap-5 px-5 py-4 rounded-[10px] transition-all duration-200"
      style={{ background: 'rgba(255,255,255,0.025)', border: `1px solid ${borderColor}` }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-[8px] flex items-center justify-center shrink-0"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Package size={15} className="text-white/35" strokeWidth={1.5} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-white/80 text-sm font-medium truncate">{product.productName || '—'}</p>
        <p className="text-white/30 text-xs">{product.brand || product.category || '—'} · {ws.expiry.toLocaleDateString('en-IN')}</p>
      </div>

      <UrgencyBadge days={ws.days} />

      <ChevronRight size={13} className="text-white/15 group-hover:text-white/50 transition-colors shrink-0" />
    </Link>
  );
}

const WINDOWS = [
  { label: '7 days',  days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year',  days: 365 },
];

export default function ExpiringPage() {
  const { products } = useStore();
  const [window, setWindow] = useState(90);

  const expiring = useMemo(() => {
    return products
      .map((p) => ({ product: p, ws: getWarrantyStatus(p) }))
      .filter(({ ws }) => ws && ws.days >= 0 && ws.days <= window)
      .sort((a, b) => a.ws.days - b.ws.days);
  }, [products, window]);

  const critical = expiring.filter(({ ws }) => ws.days <= 7);
  const high     = expiring.filter(({ ws }) => ws.days > 7 && ws.days <= 30);
  const medium   = expiring.filter(({ ws }) => ws.days > 30);

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto page-enter">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-equinox text-white mb-1" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>Expiring soon</h1>
          <p className="text-white/35 text-sm">{expiring.length} product{expiring.length !== 1 ? 's' : ''} expiring within {window} days.</p>
        </div>
        {/* Window selector */}
        <div className="flex" style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', overflow: 'hidden' }}>
          {WINDOWS.map(({ label, days }) => (
            <button
              key={days}
              onClick={() => setWindow(days)}
              className="px-3 py-2 text-xs transition-all"
              style={{
                background: window === days ? 'rgba(255,255,255,0.08)' : 'transparent',
                color: window === days ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)',
                borderRight: days !== 365 ? '1px solid rgba(255,255,255,0.07)' : 'none',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {expiring.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Clock size={28} className="text-white/15 mb-4" strokeWidth={1} />
          <p className="text-white/30 text-sm">No products expiring within {window} days.</p>
          <p className="text-white/20 text-xs mt-2">Your warranties are in good shape.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {critical.length > 0 && (
            <div>
              <p className="font-equinox text-[10px] tracking-[0.2em] text-white/40 mb-3">CRITICAL — NEXT 7 DAYS</p>
              <div className="flex flex-col gap-2">
                {critical.map(({ product, ws }) => <ExpiryCard key={product.id} product={product} ws={ws} />)}
              </div>
            </div>
          )}
          {high.length > 0 && (
            <div>
              <p className="font-equinox text-[10px] tracking-[0.2em] text-white/30 mb-3">HIGH — NEXT 30 DAYS</p>
              <div className="flex flex-col gap-2">
                {high.map(({ product, ws }) => <ExpiryCard key={product.id} product={product} ws={ws} />)}
              </div>
            </div>
          )}
          {medium.length > 0 && (
            <div>
              <p className="font-equinox text-[10px] tracking-[0.2em] text-white/20 mb-3">UPCOMING</p>
              <div className="flex flex-col gap-2">
                {medium.map(({ product, ws }) => <ExpiryCard key={product.id} product={product} ws={ws} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
