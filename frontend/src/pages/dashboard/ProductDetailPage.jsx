/**
 * ProductDetailPage.jsx
 */
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Package, Shield, AlertTriangle, TrendingUp, Clock,
  Edit2, Trash2, FileText, Calendar, Hash, Tag, Store,
  CheckCircle, XCircle, HelpCircle, ChevronRight, Plus,
  ExternalLink, Download, MessageSquare,
} from 'lucide-react';
import { useStore } from '../../store/store.js';
import { differenceInDays } from 'date-fns';
import { doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase.js';

function getWarrantyStatus(product) {
  if (!product.purchaseDate || !product.warrantyMonths) return { status: 'unknown', days: null, expiry: null, pct: 0 };
  const purchase = new Date(product.purchaseDate);
  const expiry = new Date(purchase);
  expiry.setMonth(expiry.getMonth() + product.warrantyMonths);
  const total = differenceInDays(expiry, purchase);
  const used  = differenceInDays(new Date(), purchase);
  const days  = differenceInDays(expiry, new Date());
  const pct   = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
  if (days < 0) return { status: 'expired',  days: Math.abs(days), expiry, pct: 100 };
  if (days <= 30) return { status: 'expiring', days, expiry, pct };
  return { status: 'active', days, expiry, pct };
}

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <Icon size={14} className="text-white/25 shrink-0" strokeWidth={1.5} />
      <span className="text-white/35 text-xs w-28 shrink-0">{label}</span>
      <span className="text-white/70 text-sm flex-1">{value}</span>
    </div>
  );
}

function RiskGauge({ score }) {
  if (score == null) return null;
  const angle = (score / 100) * 180;
  const r = 36, cx = 44, cy = 44;
  const toXY = (deg) => {
    const rad = (deg - 180) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };
  const start = toXY(0), end = toXY(angle);
  const large = angle > 180 ? 1 : 0;
  const path = `M ${toXY(0).x} ${toXY(0).y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  const trackPath = `M ${toXY(0).x} ${toXY(0).y} A ${r} ${r} 0 1 1 ${toXY(180).x} ${toXY(180).y}`;

  const levelLabel = score >= 80 ? 'CRITICAL' : score >= 65 ? 'HIGH' : score >= 45 ? 'MEDIUM' : score >= 25 ? 'LOW' : 'MINIMAL';
  const levelColor = score >= 80 ? 'rgba(255,255,255,0.85)' : score >= 65 ? 'rgba(255,255,255,0.6)' : score >= 45 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.25)';

  return (
    <div className="flex flex-col items-center">
      <svg width="88" height="52" viewBox="0 0 88 56">
        <path d={trackPath} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="4" strokeLinecap="round" />
        {score > 0 && <path d={path} fill="none" stroke={levelColor} strokeWidth="4" strokeLinecap="round" />}
      </svg>
      <p className="text-2xl font-light text-white -mt-2">{score}</p>
      <p className="text-[10px] font-mono tracking-[0.15em] mt-0.5" style={{ color: levelColor }}>{levelLabel}</p>
    </div>
  );
}

function WarrantyTimeline({ product, ws }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-between text-xs">
        <span className="text-white/30">{product.purchaseDate || '—'}</span>
        <span className="text-white/30">{ws.expiry ? ws.expiry.toISOString().split('T')[0] : '—'}</span>
      </div>
      <div style={{ height: '2px', background: 'rgba(255,255,255,0.06)', borderRadius: '1px' }}>
        <div
          style={{
            height: '100%',
            width: `${ws.pct}%`,
            background: ws.status === 'expired' ? 'rgba(255,255,255,0.2)' :
                        ws.status === 'expiring' ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.45)',
            borderRadius: '1px',
            transition: 'width 800ms ease',
          }}
        />
      </div>
      <div className="flex justify-between text-xs">
        <span className="text-white/20">{ws.pct}% elapsed</span>
        <span style={{
          color: ws.status === 'expired' ? 'rgba(255,255,255,0.25)' :
                 ws.status === 'expiring' ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.45)',
        }}>
          {ws.status === 'expired'  && `Expired ${ws.days} days ago`}
          {ws.status === 'expiring' && `${ws.days} days remaining`}
          {ws.status === 'active'   && `${ws.days} days remaining`}
          {ws.status === 'unknown'  && 'Duration unknown'}
        </span>
      </div>
    </div>
  );
}

function FraudBadge({ level }) {
  if (!level || level === 'CLEAN') {
    return (
      <div className="flex items-center gap-2">
        <CheckCircle size={14} className="text-white/40" />
        <span className="text-white/40 text-xs">Invoice verified — no fraud signals</span>
      </div>
    );
  }
  const icons = { SUSPICIOUS: HelpCircle, HIGH_RISK: AlertTriangle, FRAUDULENT: XCircle };
  const Icon = icons[level] || AlertTriangle;
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-[8px]"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
    >
      <Icon size={14} className="text-white/60 shrink-0" />
      <span className="text-white/60 text-sm">Invoice flagged: <span className="text-white/80 font-medium">{level}</span></span>
      <Link to="/dashboard/fraud" className="ml-auto text-white/30 hover:text-white/60 transition-colors">
        <ChevronRight size={14} />
      </Link>
    </div>
  );
}

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { products, deleteProduct, addNotification } = useStore();
  const [deleting, setDeleting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const product = products.find((p) => p.id === id);

  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  if (!product) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-64">
        <p className="text-white/30 text-sm mb-4">Product not found.</p>
        <Link to="/dashboard/products" className="btn-ghost text-sm">Back to products</Link>
      </div>
    );
  }

  const ws = getWarrantyStatus(product);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'products', product.id));
      deleteProduct(product.id);
      addNotification({ type: 'info', message: `${product.productName} removed.` });
      navigate('/dashboard/products', { replace: true });
    } catch (err) {
      console.error(err);
      setDeleting(false);
      setShowConfirm(false);
    }
  };

  const statusColor = {
    active:   'rgba(255,255,255,0.5)',
    expiring: 'rgba(255,255,255,0.85)',
    expired:  'rgba(255,255,255,0.2)',
    unknown:  'rgba(255,255,255,0.15)',
  }[ws.status];

  return (
    <div className="p-6 lg:p-8 max-w-5xl mx-auto page-enter">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-white/30 text-xs hover:text-white/60 transition-colors mb-8"
      >
        <ArrowLeft size={14} /> Products
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-6 mb-8">
        <div className="flex items-start gap-5">
          <div
            className="w-12 h-12 rounded-[10px] flex items-center justify-center shrink-0"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <Package size={20} className="text-white/40" strokeWidth={1.5} />
          </div>
          <div>
            <h1
              className="font-equinox text-white mb-1"
              style={{ fontSize: 'clamp(1.2rem, 2.5vw, 1.8rem)', letterSpacing: '0.04em', lineHeight: 1.2 }}
            >
              {product.productName || 'Unnamed Product'}
            </h1>
            <div className="flex items-center gap-3 flex-wrap">
              {product.brand && <span className="text-white/40 text-sm">{product.brand}</span>}
              {product.category && (
                <>
                  <span className="text-white/15">·</span>
                  <span className="text-white/30 text-sm">{product.category}</span>
                </>
              )}
              <span className="text-white/15">·</span>
              <span className="text-xs font-mono tracking-[0.1em]" style={{ color: statusColor }}>
                {ws.status.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Link
            to={`/dashboard/products/${id}/edit`}
            className="btn-ghost text-xs py-2 px-4"
          >
            <Edit2 size={13} /> Edit
          </Link>
          <button
            onClick={() => setShowConfirm(true)}
            className="p-2.5 rounded-[8px] text-white/25 hover:text-white/60 transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* Delete confirm */}
      {showConfirm && (
        <div
          className="mb-6 p-5 rounded-[10px] flex items-center justify-between gap-4"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}
        >
          <p className="text-white/60 text-sm">Delete <span className="text-white/80 font-medium">{product.productName}</span>? This cannot be undone.</p>
          <div className="flex gap-2">
            <button onClick={() => setShowConfirm(false)} className="btn-ghost text-xs py-2 px-4">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="btn-primary text-xs py-2 px-4">
              {deleting ? <div className="w-3 h-3 border border-black/20 border-t-black/60 rounded-full animate-spin" /> : 'Delete'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Warranty timeline */}
          <div className="data-card">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em]">WARRANTY STATUS</h2>
              <Shield size={15} className="text-white/20" strokeWidth={1.5} />
            </div>
            <WarrantyTimeline product={product} ws={ws} />
          </div>

          {/* Product info */}
          <div className="data-card">
            <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-2">PRODUCT DETAILS</h2>
            <div>
              <InfoRow icon={Calendar}  label="Purchase date"   value={product.purchaseDate} />
              <InfoRow icon={Shield}    label="Warranty"        value={product.warrantyMonths ? `${product.warrantyMonths} months` : null} />
              <InfoRow icon={Hash}      label="Invoice no."     value={product.invoiceNumber} />
              <InfoRow icon={Hash}      label="Serial no."      value={product.serialNumber} />
              <InfoRow icon={Store}     label="Seller"          value={product.seller} />
              <InfoRow icon={Tag}       label="Category"        value={product.category} />
              {product.price && <InfoRow icon={FileText} label="Price" value={product.price} />}
            </div>
            {product.notes && (
              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                <p className="text-white/25 text-xs mb-2">NOTES</p>
                <p className="text-white/50 text-sm leading-relaxed">{product.notes}</p>
              </div>
            )}
          </div>

          {/* Fraud status */}
          <div className="data-card">
            <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-4">INVOICE INTEGRITY</h2>
            <FraudBadge level={product.fraudWarning} />
            {product.overallConfidence != null && (
              <div className="mt-4 flex items-center gap-3">
                <span className="text-white/25 text-xs">Extraction confidence</span>
                <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{
                    width: `${Math.round(product.overallConfidence * 100)}%`,
                    height: '1px',
                    background: 'rgba(255,255,255,0.4)',
                  }} />
                </div>
                <span className="text-white/30 text-xs font-mono">{Math.round(product.overallConfidence * 100)}%</span>
              </div>
            )}
          </div>

          {/* Repair history */}
          <div className="data-card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em]">REPAIR HISTORY</h2>
              <Link to={`/dashboard/products/${id}/repair`} className="text-white/30 text-xs hover:text-white/60 transition-colors flex items-center gap-1">
                <Plus size={12} /> Add
              </Link>
            </div>
            {(!product.repairHistory || product.repairHistory.length === 0) ? (
              <p className="text-white/20 text-sm">No repairs recorded.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {product.repairHistory.map((r, i) => (
                  <div key={i} className="flex items-start gap-4 py-3" style={{ borderBottom: i < product.repairHistory.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none' }}>
                    <div className="w-1 h-1 rounded-full bg-white/30 mt-2 shrink-0" />
                    <div className="flex-1">
                      <p className="text-white/60 text-sm">{r.description || r.issueType?.replace(/_/g, ' ') || 'Repair'}</p>
                      <p className="text-white/25 text-xs mt-0.5">{r.date} {r.cost ? `· ₹${r.cost}` : ''}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Invoice */}
          {product.invoiceUrl && (
            <div className="data-card">
              <h2 className="font-equinox text-white/70 text-xs tracking-[0.12em] mb-4">INVOICE DOCUMENT</h2>
              <div className="flex gap-3">
                <a href={product.invoiceUrl} target="_blank" rel="noopener noreferrer" className="btn-ghost text-xs py-2 px-4">
                  <ExternalLink size={13} /> View invoice
                </a>
                <a href={product.invoiceUrl} download className="btn-ghost text-xs py-2 px-4">
                  <Download size={13} /> Download
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Right column — stats */}
        <div className="flex flex-col gap-4">
          {/* Risk score */}
          {product.riskScore != null && (
            <div className="data-card flex flex-col items-center py-6">
              <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em] mb-4">RISK SCORE</p>
              <RiskGauge score={product.riskScore} />
              {product.riskRecommendation && (
                <p className="text-white/30 text-xs text-center mt-4 leading-relaxed">{product.riskRecommendation}</p>
              )}
            </div>
          )}

          {/* Quick actions */}
          <div className="data-card">
            <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em] mb-4">QUICK ACTIONS</p>
            <div className="flex flex-col gap-2">
              <Link
                to="/dashboard/agent"
                className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05 transition-all"
              >
                <MessageSquare size={15} className="shrink-0" />
                Ask AI about this product
              </Link>
              <Link
                to="/dashboard/upload"
                className="flex items-center gap-3 px-3 py-2.5 rounded-[8px] text-sm text-white/50 hover:text-white/80 hover:bg-white/05 transition-all"
              >
                <FileText size={15} className="shrink-0" />
                Upload new invoice
              </Link>
            </div>
          </div>

          {/* Warranty card */}
          <div
            className="rounded-[12px] p-5 flex flex-col gap-3"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
          >
            <p className="font-equinox text-white/40 text-[10px] tracking-[0.15em]">WARRANTY EXPIRY</p>
            {ws.expiry ? (
              <>
                <p className="text-white/70 text-sm">{ws.expiry.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
                <p className="text-xs" style={{ color: statusColor }}>
                  {ws.status === 'expired'  && `Expired ${ws.days} days ago`}
                  {ws.status === 'expiring' && `⚠ ${ws.days} days remaining`}
                  {ws.status === 'active'   && `${ws.days} days remaining`}
                </p>
              </>
            ) : (
              <p className="text-white/25 text-sm">—</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
