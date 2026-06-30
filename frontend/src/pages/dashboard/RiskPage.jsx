/**
 * RiskPage.jsx — Risk analysis, failure prediction, product comparison.
 */
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrendingUp, Package, ChevronRight, AlertTriangle } from 'lucide-react';
import { useStore } from '../../store/store.js';

const RISK_LEVEL = (s) => s >= 80 ? 'CRITICAL' : s >= 65 ? 'HIGH' : s >= 45 ? 'MEDIUM' : s >= 25 ? 'LOW' : 'MINIMAL';
const RISK_COLOR = (s) => s >= 80 ? 'rgba(255,255,255,0.9)' : s >= 65 ? 'rgba(255,255,255,0.65)' : s >= 45 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.22)';

function RiskBar({ score }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${score || 0}%`, height: '100%', background: RISK_COLOR(score), borderRadius: '2px', transition: 'width 800ms ease' }} />
      </div>
      <span className="text-xs font-mono w-8 text-right shrink-0" style={{ color: RISK_COLOR(score) }}>{score ?? '—'}</span>
    </div>
  );
}

function RiskCard({ product }) {
  const score = product.riskScore;
  return (
    <Link
      to={`/dashboard/products/${product.id}`}
      className="data-card group flex flex-col gap-4 transition-all duration-200"
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Package size={14} className="text-white/30" strokeWidth={1.5} />
          <div>
            <p className="text-white/75 text-sm font-medium line-clamp-1">{product.productName || '—'}</p>
            <p className="text-white/25 text-xs">{product.category || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono tracking-[0.12em]" style={{ color: RISK_COLOR(score) }}>
            {score != null ? RISK_LEVEL(score) : '—'}
          </span>
          <ChevronRight size={13} className="text-white/15 group-hover:text-white/40 transition-colors" />
        </div>
      </div>
      <RiskBar score={score} />
      {product.riskRecommendation && (
        <p className="text-white/25 text-xs leading-relaxed line-clamp-2">{product.riskRecommendation}</p>
      )}
    </Link>
  );
}

function DistributionBar({ products }) {
  const counts = {
    CRITICAL: products.filter((p) => (p.riskScore || 0) >= 80).length,
    HIGH:     products.filter((p) => (p.riskScore || 0) >= 65 && (p.riskScore || 0) < 80).length,
    MEDIUM:   products.filter((p) => (p.riskScore || 0) >= 45 && (p.riskScore || 0) < 65).length,
    LOW:      products.filter((p) => (p.riskScore || 0) >= 25 && (p.riskScore || 0) < 45).length,
    MINIMAL:  products.filter((p) => (p.riskScore || 0) < 25).length,
  };
  const total = products.length || 1;
  const colors = {
    CRITICAL: 'rgba(255,255,255,0.85)',
    HIGH:     'rgba(255,255,255,0.6)',
    MEDIUM:   'rgba(255,255,255,0.38)',
    LOW:      'rgba(255,255,255,0.2)',
    MINIMAL:  'rgba(255,255,255,0.1)',
  };
  return (
    <div className="flex flex-col gap-3">
      {Object.entries(counts).map(([level, count]) => (
        <div key={level} className="flex items-center gap-4">
          <span className="text-white/30 text-xs font-mono w-16">{level}</span>
          <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div style={{ width: `${(count / total) * 100}%`, height: '1px', background: colors[level], transition: 'width 600ms ease' }} />
          </div>
          <span className="text-white/30 text-xs w-4 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}

export default function RiskPage() {
  const { products } = useStore();

  const sorted = useMemo(() =>
    [...products].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)),
    [products]
  );

  const withRisk = sorted.filter((p) => p.riskScore != null);
  const highRisk = sorted.filter((p) => (p.riskScore || 0) >= 65);
  const avgRisk  = withRisk.length
    ? Math.round(withRisk.reduce((s, p) => s + p.riskScore, 0) / withRisk.length)
    : null;

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-equinox text-white mb-1" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>Risk analysis</h1>
        <p className="text-white/35 text-sm">Failure probability and risk scoring across your product portfolio.</p>
      </div>

      {products.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <TrendingUp size={28} className="text-white/15 mb-4" strokeWidth={1} />
          <p className="text-white/30 text-sm">No products to analyse. Upload invoices to generate risk scores.</p>
          <Link to="/dashboard/upload" className="btn-ghost text-xs mt-6">Add product</Link>
        </div>
      ) : (
        <>
          {/* Summary row */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
            {[
              { label: 'Products analysed', value: withRisk.length },
              { label: 'High / critical risk', value: highRisk.length, accent: highRisk.length > 0 },
              { label: 'Average risk score', value: avgRisk ?? '—' },
              { label: 'Needs attention', value: sorted.filter((p) => (p.riskScore || 0) >= 45).length },
            ].map(({ label, value, accent }) => (
              <div key={label} className="data-card">
                <p className="text-3xl font-light text-white mb-1" style={{ color: accent ? 'rgba(255,255,255,0.9)' : undefined }}>{value}</p>
                <p className="text-white/30 text-xs">{label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Product risk list */}
            <div className="lg:col-span-2 flex flex-col gap-3">
              <p className="font-equinox text-white/40 text-xs tracking-[0.12em]">ALL PRODUCTS — BY RISK</p>
              {sorted.map((p) => <RiskCard key={p.id} product={p} />)}
            </div>

            {/* Sidebar */}
            <div className="flex flex-col gap-4">
              <div className="data-card">
                <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em] mb-5">RISK DISTRIBUTION</p>
                <DistributionBar products={products} />
              </div>

              {highRisk.length > 0 && (
                <div
                  className="rounded-[12px] p-5"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={13} className="text-white/50" />
                    <p className="text-white/50 text-xs font-medium">{highRisk.length} high-risk device{highRisk.length !== 1 ? 's' : ''}</p>
                  </div>
                  <p className="text-white/30 text-xs leading-relaxed">
                    Consider scheduling preventive service inspections before warranty expires. Visit an authorised service centre with your invoice.
                  </p>
                </div>
              )}

              <Link to="/dashboard/agent" className="btn-ghost text-xs py-3 flex items-center justify-center gap-2">
                Ask agent about risk →
              </Link>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
