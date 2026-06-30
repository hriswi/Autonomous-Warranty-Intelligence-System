/**
 * FraudPage.jsx — Invoice fraud alerts and signal details.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle, Package, ChevronRight, ShieldOff } from 'lucide-react';
import { useStore } from '../../store/store.js';

const LEVEL_CONFIG = {
  CLEAN:       { label: 'Clean',       icon: CheckCircle,   color: 'rgba(255,255,255,0.3)' },
  SUSPICIOUS:  { label: 'Suspicious',  icon: AlertTriangle, color: 'rgba(255,255,255,0.6)' },
  HIGH_RISK:   { label: 'High Risk',   icon: AlertTriangle, color: 'rgba(255,255,255,0.8)' },
  FRAUDULENT:  { label: 'Fraudulent',  icon: ShieldOff,     color: 'rgba(255,255,255,0.95)' },
};

function SignalRow({ signal }) {
  const sev = signal.severity >= 0.7 ? 'HIGH' : signal.severity >= 0.4 ? 'MEDIUM' : 'LOW';
  return (
    <div className="flex items-start gap-3 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="w-1 h-1 rounded-full mt-2 shrink-0" style={{
        background: sev === 'HIGH' ? 'rgba(255,255,255,0.7)' : sev === 'MEDIUM' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)',
      }} />
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-white/60 text-xs font-mono tracking-[0.08em]">{signal.type?.replace(/_/g, ' ')}</span>
          <span className="text-[10px] text-white/30">{sev}</span>
        </div>
        <p className="text-white/35 text-xs leading-relaxed">{signal.detail}</p>
      </div>
    </div>
  );
}

function FraudCard({ product }) {
  const level = product.fraudWarning || 'CLEAN';
  const cfg   = LEVEL_CONFIG[level] || LEVEL_CONFIG.SUSPICIOUS;
  const Icon  = cfg.icon;
  const signals = product.fraudSignals || [];

  return (
    <div className="data-card flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Package size={14} className="text-white/30" strokeWidth={1.5} />
          <div>
            <p className="text-white/75 text-sm font-medium">{product.productName || '—'}</p>
            <p className="text-white/25 text-xs">{product.brand || product.category || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color: cfg.color }} />
          <span className="text-xs font-mono tracking-[0.1em]" style={{ color: cfg.color }}>
            {cfg.label.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Fraud score bar */}
      {product.fraudScore != null && (
        <div className="flex items-center gap-3">
          <span className="text-white/25 text-xs w-24">Fraud score</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }}>
            <div style={{
              width: `${product.fraudScore}%`, height: '1px',
              background: cfg.color, transition: 'width 600ms ease',
            }} />
          </div>
          <span className="text-xs font-mono w-8 text-right" style={{ color: cfg.color }}>
            {product.fraudScore}
          </span>
        </div>
      )}

      {/* Signals */}
      {signals.length > 0 && (
        <div>
          <p className="text-white/20 text-[10px] font-mono tracking-[0.15em] uppercase mb-2">Detected signals</p>
          {signals.map((s, i) => <SignalRow key={i} signal={s} />)}
        </div>
      )}

      {/* Link */}
      <Link
        to={`/dashboard/products/${product.id}`}
        className="flex items-center gap-2 text-white/30 text-xs hover:text-white/60 transition-colors mt-1"
      >
        View product details <ChevronRight size={12} />
      </Link>
    </div>
  );
}

export default function FraudPage() {
  const { products } = useStore();

  const flagged = products
    .filter((p) => p.fraudWarning && p.fraudWarning !== 'CLEAN')
    .sort((a, b) => (b.fraudScore || 0) - (a.fraudScore || 0));

  const clean = products.filter((p) => !p.fraudWarning || p.fraudWarning === 'CLEAN');

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-equinox text-white mb-1" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>Fraud alerts</h1>
        <p className="text-white/35 text-sm">Invoice integrity analysis across your product portfolio.</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Flagged invoices',  value: flagged.length, color: flagged.length > 0 ? 'rgba(255,255,255,0.9)' : undefined },
          { label: 'Clean invoices',    value: clean.length },
          { label: 'Total analysed',    value: products.length },
        ].map(({ label, value, color }) => (
          <div key={label} className="data-card">
            <p className="text-2xl font-light mb-1" style={{ color: color || 'rgba(255,255,255,0.8)' }}>{value}</p>
            <p className="text-white/30 text-xs">{label}</p>
          </div>
        ))}
      </div>

      {flagged.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <CheckCircle size={28} className="text-white/20 mb-4" strokeWidth={1} />
          <p className="text-white/40 text-sm mb-1">All invoices are clean</p>
          <p className="text-white/20 text-xs">No fraud signals detected across {products.length} product{products.length !== 1 ? 's' : ''}.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="font-equinox text-[10px] tracking-[0.2em] text-white/35">FLAGGED INVOICES</p>
          {flagged.map((p) => <FraudCard key={p.id} product={p} />)}
        </div>
      )}
    </div>
  );
}
