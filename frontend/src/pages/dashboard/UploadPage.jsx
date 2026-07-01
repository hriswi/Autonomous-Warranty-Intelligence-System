/**
 * UploadPage.jsx
 * 3MB hard limit enforced at: dropzone validator, onChange, pre-OCR, pre-Firebase.
 */
import React, { useState, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, Image as ImageIcon, X, Check,
  AlertCircle, ChevronDown, ShieldCheck, Info,
} from 'lucide-react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useStore } from '../../store/store.js';
import { db, storage } from '../../lib/firebase.js';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  validateFile, validateFileSync, dropzoneValidator,
  MAX_FILE_SIZE_LABEL, ALLOWED_FORMATS_LABEL, DROPZONE_ACCEPT,
  formatBytes, fileSizePercent,
} from '../../lib/fileValidation.js';

const CATEGORIES = [
  'Smartphone','Laptop','Television','Refrigerator','Air Conditioner',
  'Smartwatch','Audio Device','Gaming Console','Washing Machine',
  'Microwave / Oven','Tablet','Camera','Printer','Monitor',
  'Keyboard / Mouse','Power Bank / Charger','Vacuum Cleaner',
  'Water Purifier','Other Electronics',
];

function ConfidenceBar({ value, label }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 70 ? 'rgba(255,255,255,0.7)' : pct >= 45 ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)';
  return (
    <div className="flex items-center gap-3">
      <span className="text-white/30 text-xs w-24 shrink-0">{label}</span>
      <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.07)' }}>
        <div style={{ width: `${pct}%`, height: '1px', background: color, transition: 'width 600ms ease' }} />
      </div>
      <span className="text-[11px] font-mono w-8 text-right shrink-0" style={{ color }}>{pct}%</span>
    </div>
  );
}

function Field({ label, required, confidence, children }) {
  const pct = confidence != null ? Math.round(confidence * 100) : null;
  const isLow = pct != null && pct < 50;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs text-white/40 font-medium uppercase tracking-[0.08em]">
          {label}{required && <span className="text-white/25 ml-1">*</span>}
        </label>
        {pct != null && (
          <span className="text-[10px] font-mono" style={{ color: isLow ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)' }}>
            {isLow ? `⚠ ${pct}% confidence` : `${pct}%`}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── File size indicator shown inside drop zone ─────────────────────────────
function FileSizeBar({ bytes }) {
  const pct = fileSizePercent(bytes);
  const over = pct >= 100;
  return (
    <div className="mt-3 w-full">
      <div className="flex justify-between text-[11px] mb-1.5">
        <span style={{ color: over ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)' }}>
          {formatBytes(bytes)}
        </span>
        <span className="text-white/20">max {MAX_FILE_SIZE_LABEL}</span>
      </div>
      <div style={{ height: '2px', background: 'rgba(255,255,255,0.07)', borderRadius: '1px' }}>
        <div style={{
          width: `${Math.min(100, pct)}%`,
          height: '100%',
          background: over ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.4)',
          borderRadius: '1px',
          transition: 'width 300ms ease',
        }} />
      </div>
    </div>
  );
}

export default function UploadPage() {
  const { user } = useAuth();
  const { addProduct, addNotification } = useStore();
  const navigate = useNavigate();

  const [file,        setFile]        = useState(null);
  const [preview,     setPreview]     = useState(null);
  const [processing,  setProcessing]  = useState(false);
  const [progress,    setProgress]    = useState(0);
  const [stage,       setStage]       = useState('');
  const [extracted,   setExtracted]   = useState(null);
  const [fieldConf,   setFieldConf]   = useState({});
  const [overallConf, setOverallConf] = useState(null);
  const [fraudWarning,setFraudWarning]= useState(null);
  const [pipelineResult, setPipelineResult] = useState(null);
  const [validationError, setValidationError] = useState('');

  const [form, setForm] = useState({
    productName:'', brand:'', category:'', purchaseDate:'',
    warrantyMonths:'', invoiceNumber:'', serialNumber:'',
    seller:'', price:'', notes:'',
  });

  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState('');

  // ── Drop handler with full validation ─────────────────────────────────
  const onDrop = useCallback(async (accepted, rejected) => {
    setValidationError('');

    // react-dropzone already ran dropzoneValidator — handle its rejections
    if (rejected.length > 0) {
      const err = rejected[0].errors[0];
      setValidationError(
        err.code === 'file-too-large'
          ? `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_LABEL}. Your file is ${formatBytes(rejected[0].file.size)}.`
          : err.code === 'file-invalid-type'
          ? `File type not allowed. Accepted formats: ${ALLOWED_FORMATS_LABEL}.`
          : err.message
      );
      return;
    }
    if (!accepted.length) return;

    const f = accepted[0];

    // Layer 2: async signature validation (magic bytes)
    const validation = await validateFile(f);
    if (!validation.valid) {
      setValidationError(validation.error);
      return;
    }

    setFile(f);
    setExtracted(null);
    setFieldConf({});
    setOverallConf(null);
    setFraudWarning(null);
    setPipelineResult(null);

    if (f.type.startsWith('image/')) {
      setPreview(URL.createObjectURL(f));
    } else {
      setPreview(null);
    }

    await runOcrPipeline(f);
  }, []);

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: DROPZONE_ACCEPT,
    maxSize: 3 * 1024 * 1024, // 3MB enforced by dropzone too
    maxFiles: 1,
    multiple: false,
    validator: dropzoneValidator, // instant sync rejection before onDrop
  });

  // ── OCR pipeline — validates size AGAIN before processing ─────────────
  const runOcrPipeline = async (f) => {
    const guard = validateFileSync(f);
    if (!guard.valid) { setValidationError(guard.error); return; }

    setProcessing(true); setProgress(0);
    try {
      setStage('Running OCR…'); setProgress(20);

      const { processInvoiceFile } = await import('../../lib/warrantyEngine.js');
      setStage('Running intelligence pipeline…'); setProgress(55);

      const pipeline = await processInvoiceFile(f, { referenceDate: new Date() });

      if (!pipeline?.success) {
        setStage('Processing failed — fill in details manually.');
        setValidationError(pipeline?.error || 'Could not extract invoice data from this file.');
        setProgress(0);
        return;
      }

      setProgress(100); setStage('Complete');
      setPipelineResult(pipeline);

      const inv = pipeline.invoice || {};
      setExtracted(inv);
      setFieldConf(inv?.fieldConfidence || {});
      setOverallConf(inv?.overallConfidence ?? null);
      setFraudWarning(pipeline?.fraud?.warningLevel ?? null);

      setForm((prev) => ({
        ...prev,
        productName:    inv?.productName    || '',
        brand:          inv?.brand          || '',
        category:       inv?.category       || '',
        purchaseDate:   inv?.purchaseDate   || '',
        warrantyMonths: inv?.warrantyMonths != null ? String(inv.warrantyMonths) : '',
        invoiceNumber:  inv?.invoiceNumber  || '',
        serialNumber:   inv?.serialNumber   || '',
        seller:         inv?.seller         || '',
      }));
    } catch (err) {
      setStage('Processing failed — fill in details manually.');
      setValidationError(
        f.type === 'application/pdf'
          ? 'PDF OCR requires a PDF renderer. Upload a JPG, PNG, or WEBP invoice image instead.'
          : 'OCR processing failed. You can still fill in the details manually.'
      );
      setProgress(0);
    } finally {
      setProcessing(false);
    }
  };

  // ── Save — validates size AGAIN before Firebase upload ────────────────
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.productName) { setError('Product name is required.'); return; }
    setError(''); setSaving(true);

    try {
      let invoiceUrl = null;

      if (file) {
        // Layer 4: pre-Firebase upload validation
        const guard = await validateFile(file);
        if (!guard.valid) { setError(guard.error); setSaving(false); return; }

        const path = `users/${user.uid}/invoices/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        const ref  = storageRef(storage, path);
        await uploadBytes(ref, file);
        invoiceUrl = await getDownloadURL(ref);
      }

      const productData = {
        userId:            user.uid,
        productName:       form.productName.trim(),
        brand:             form.brand.trim(),
        category:          form.category,
        purchaseDate:      form.purchaseDate,
        warrantyMonths:    form.warrantyMonths ? parseInt(form.warrantyMonths) : null,
        invoiceNumber:     form.invoiceNumber.trim(),
        serialNumber:      form.serialNumber.trim(),
        seller:            form.seller.trim(),
        price:             form.price.trim(),
        notes:             form.notes.trim(),
        invoiceUrl,
        overallConfidence: overallConf,
        fieldConfidence:   fieldConf,
        fraudWarning:      pipelineResult?.fraud?.warningLevel ?? fraudWarning,
        fraudScore:        pipelineResult?.fraud?.fraudScore ?? null,
        fraudSignals:      pipelineResult?.fraud?.signals ?? [],
        riskScore:         pipelineResult?.risk?.riskScore ?? null,
        riskRecommendation: pipelineResult?.risk?.recommendation ?? null,
        risk:              pipelineResult?.risk ?? null,
        fraud:             pipelineResult?.fraud ?? null,
        advisory:          pipelineResult?.advisory ?? null,
        createdAt:         serverTimestamp(),
        updatedAt:         serverTimestamp(),
      };

      const docRef = await addDoc(collection(db, 'products'), productData);
      addProduct({ id: docRef.id, ...productData, createdAt: new Date().toISOString() });
      addNotification({ type: 'success', message: `${form.productName} added.` });
      setSaved(true);
      setTimeout(() => navigate(`/dashboard/products/${docRef.id}`), 1200);
    } catch (err) {
      setError('Failed to save. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const setField = (key) => (e) => setForm((p) => ({ ...p, [key]: e.target.value }));

  const clearFile = (e) => {
    e.stopPropagation();
    setFile(null); setPreview(null);
    setExtracted(null); setFieldConf({});
    setOverallConf(null); setPipelineResult(null); setValidationError('');
  };

  return (
    <div className="p-6 lg:p-8 max-w-4xl mx-auto page-enter">
      <div className="mb-8">
        <h1 className="font-equinox text-white mb-2" style={{ fontSize: '1.8rem', letterSpacing: '0.04em' }}>
          Add product
        </h1>
        <p className="text-white/35 text-sm">Upload an invoice and the engine extracts every detail automatically.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Upload zone */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div
            {...getRootProps()}
            className="relative rounded-[12px] cursor-pointer transition-all duration-200 overflow-hidden"
            style={{
              border: validationError ? '1px solid rgba(255,255,255,0.3)' :
                      isDragActive    ? '1px solid rgba(255,255,255,0.25)' :
                                        '1px dashed rgba(255,255,255,0.1)',
              background: validationError ? 'rgba(255,255,255,0.03)' :
                          isDragActive    ? 'rgba(255,255,255,0.04)' :
                                           'rgba(255,255,255,0.02)',
              minHeight: '200px',
            }}
          >
            <input {...getInputProps()} />

            {preview ? (
              <div className="relative">
                <img src={preview} alt="Invoice preview" className="w-full object-cover" style={{ maxHeight: '220px' }} />
                <button
                  type="button"
                  onClick={clearFile}
                  className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center"
                  style={{ background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}
                >
                  <X size={13} className="text-white" />
                </button>
                {file && <FileSizeBar bytes={file.size} />}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <Upload size={26} className="text-white/20 mb-4" strokeWidth={1} />
                <p className="text-white/45 text-sm mb-1.5">
                  {isDragActive ? 'Drop to upload' : 'Drag invoice here'}
                </p>
                <p className="text-white/20 text-xs mb-1">{ALLOWED_FORMATS_LABEL}</p>
                <p className="text-white/15 text-xs">Max {MAX_FILE_SIZE_LABEL}</p>
              </div>
            )}
          </div>

          {/* Validation error */}
          {validationError && (
            <div
              className="flex items-start gap-3 px-4 py-3 rounded-[8px]"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}
            >
              <AlertCircle size={14} className="text-white/60 shrink-0 mt-0.5" />
              <p className="text-white/60 text-xs leading-relaxed">{validationError}</p>
            </div>
          )}

          {/* Security note */}
          <div
            className="flex items-start gap-3 px-4 py-3 rounded-[8px]"
            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <ShieldCheck size={13} className="text-white/25 shrink-0 mt-0.5" />
            <p className="text-white/25 text-[11px] leading-relaxed">
              Files are validated for size, type, and content signature before processing.
              Max {MAX_FILE_SIZE_LABEL} · {ALLOWED_FORMATS_LABEL} only.
            </p>
          </div>

          {/* File info after selection */}
          {file && !preview && (
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-[8px]"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <FileText size={14} className="text-white/40" />
              <span className="text-white/50 text-xs flex-1 truncate">{file.name}</span>
              <span className="text-white/20 text-xs shrink-0">{formatBytes(file.size)}</span>
              <button onClick={clearFile} className="text-white/25 hover:text-white/60 transition-colors ml-1">
                <X size={13} />
              </button>
            </div>
          )}

          {/* Processing */}
          {processing && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 border border-white/20 border-t-white/60 rounded-full animate-spin shrink-0" />
                <p className="text-white/45 text-xs">{stage}</p>
              </div>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* Confidence panel */}
          {extracted && overallConf != null && (
            <div className="rounded-[10px] p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <p className="text-white/35 text-xs font-mono tracking-[0.12em] uppercase mb-4">Extraction confidence</p>
              <div className="flex flex-col gap-3">
                {Object.entries(fieldConf).slice(0, 6).map(([key, val]) => (
                  <ConfidenceBar key={key} label={key.replace(/([A-Z])/g, ' $1').toLowerCase()} value={val} />
                ))}
              </div>
              {fraudWarning && fraudWarning !== 'CLEAN' && (
                <div className="flex items-center gap-2 mt-4 px-3 py-2 rounded-[6px]"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <AlertCircle size={13} className="text-white/50 shrink-0" />
                  <p className="text-white/50 text-xs">Invoice flagged: {fraudWarning}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form */}
        <form onSubmit={handleSave} className="lg:col-span-3 flex flex-col gap-5">
          <Field label="Product name" required confidence={fieldConf.productName}>
            <input type="text" value={form.productName} onChange={setField('productName')} placeholder="e.g. Sony WH-1000XM5 Headphones" className="input-field" />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Brand" confidence={fieldConf.brand}>
              <input type="text" value={form.brand} onChange={setField('brand')} placeholder="e.g. Sony" className="input-field" />
            </Field>
            <Field label="Category" confidence={fieldConf.category}>
              <div className="relative">
                <select value={form.category} onChange={setField('category')} className="input-field appearance-none pr-9">
                  <option value="">Select…</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Purchase date" confidence={fieldConf.purchaseDate}>
              <input type="date" value={form.purchaseDate} onChange={setField('purchaseDate')} className="input-field" />
            </Field>
            <Field label="Warranty (months)" confidence={fieldConf.warrantyMonths}>
              <input type="number" value={form.warrantyMonths} onChange={setField('warrantyMonths')} placeholder="12" min="1" max="240" className="input-field" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Invoice number" confidence={fieldConf.invoiceNumber}>
              <input type="text" value={form.invoiceNumber} onChange={setField('invoiceNumber')} placeholder="INV-001" className="input-field" />
            </Field>
            <Field label="Serial number" confidence={fieldConf.serialNumber}>
              <input type="text" value={form.serialNumber} onChange={setField('serialNumber')} placeholder="SN-XXXXXXXXX" className="input-field" />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Seller" confidence={fieldConf.seller}>
              <input type="text" value={form.seller} onChange={setField('seller')} placeholder="e.g. Amazon" className="input-field" />
            </Field>
            <Field label="Purchase price">
              <input type="text" value={form.price} onChange={setField('price')} placeholder="₹ 0.00" className="input-field" />
            </Field>
          </div>

          <Field label="Notes">
            <textarea value={form.notes} onChange={setField('notes')} placeholder="Any additional notes…" rows={2} className="input-field resize-none" />
          </Field>

          {error && (
            <p className="text-xs px-4 py-3 rounded-[8px]"
              style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}>
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={saving || saved} className="btn-primary flex-1">
              {saved   ? <><Check size={15} /> Saved</>
              : saving  ? <div className="w-4 h-4 border border-black/20 border-t-black/60 rounded-full animate-spin" />
              : 'Save product'}
            </button>
            <button type="button" onClick={() => navigate('/dashboard')} className="btn-ghost px-5">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
