import express from 'express';
import cors from 'cors';
import multer from 'multer';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { extractTextFromImage, isPdfFile, OcrError } from './ocr/ocrEngine.js';
import { processInvoiceText } from './ai-engine/warrantyIntelligencePipeline.js';
import { computeProductRisk } from './ai-engine/productRiskEngine.js';
import { generateWarrantyAdvisory } from './ai-engine/warrantyAdvisorEngine.js';
import { analyzeInvoiceFraud } from './ai-engine/fraudDetectionEngine.js';
import { WarrantyAgent } from './ai-engine/assistant/warrantyAgent.js';
import { parseInvoice } from './parsers/invoiceParser.js';

const PORT = process.env.PORT || 3000;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
});

function initFirebaseAdmin() {
  if (admin.apps.length > 0) return;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp();
    return;
  }

  console.warn(
    '[backend] Firebase Admin credentials not configured. Auth verification is disabled.'
  );
  admin.initializeApp();
}

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

initFirebaseAdmin();

async function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    req.user = null;
    return next();
  }

  if (!token) {
    res.status(401).json({ error: 'Authorization header required.' });
    return;
  }

  try {
    req.user = await admin.auth().verifyIdToken(token);
    return next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid Firebase auth token.' });
  }
}

function safeJson(value) {
  return value === undefined ? null : value;
}

function userError(res, status, code, message) {
  return res.status(status).json({ success: false, error: message, code });
}

function createAgent(state) {
  if (state && state.memory) {
    return WarrantyAgent.fromSerialized(state);
  }
  return new WarrantyAgent();
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', backend: 'warranty-intelligence', port: PORT, allowedOrigin: ALLOWED_ORIGIN });
});

app.post('/api/ocr/upload', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return userError(res, 400, 'NO_FILE', 'No file was uploaded. Use the `file` field.');
  }

  if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
    return userError(res, 415, 'INVALID_TYPE', `File type "${file.mimetype}" is not allowed.`);
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return userError(res, 413, 'FILE_TOO_LARGE', 'File exceeds the maximum allowed size of 3MB.');
  }

  if (isPdfFile({ type: file.mimetype, name: file.originalname })) {
    return userError(res, 422, 'PDF_UNSUPPORTED', 'PDF OCR is not supported by the current backend deployment. Upload an image file instead.');
  }

  try {
    const ocrResult = await extractTextFromImage(file.buffer, { lang: 'eng' });
    return res.json({ success: true, file: { name: file.originalname, mimeType: file.mimetype, size: file.size }, ocr: ocrResult });
  } catch (err) {
    if (err instanceof OcrError) {
      return userError(res, 422, err.code, err.message);
    }
    return userError(res, 500, 'OCR_FAILED', 'OCR processing failed.');
  }
});

app.post('/api/pipeline', async (req, res) => {
  const { rawText, issueDescription, referenceDate } = req.body;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return userError(res, 400, 'NO_TEXT', 'rawText is required and must be a non-empty string.');
  }

  try {
    const result = await processInvoiceText(rawText, {
      issueDescription: typeof issueDescription === 'string' ? issueDescription : undefined,
      referenceDate: referenceDate ? new Date(referenceDate) : undefined,
    });
    return res.json({ success: true, result });
  } catch (err) {
    return userError(res, 500, 'PIPELINE_ERROR', err?.message || 'Pipeline failed to process the invoice.');
  }
});

app.post('/api/parse', async (req, res) => {
  const { rawText } = req.body;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return userError(res, 400, 'NO_TEXT', 'rawText is required and must be a non-empty string.');
  }

  try {
    const parsed = parseInvoice(rawText);
    return res.json({ success: true, parsedInvoice: parsed });
  } catch (err) {
    return userError(res, 500, 'PARSE_ERROR', err?.message || 'Invoice parsing failed.');
  }
});

app.post('/api/analyze/risk', async (req, res) => {
  const { parsedInvoice, referenceDate } = req.body;
  if (!parsedInvoice || typeof parsedInvoice !== 'object') {
    return userError(res, 400, 'NO_PARSED_INVOICE', 'parsedInvoice object is required.');
  }

  try {
    const risk = computeProductRisk(parsedInvoice, referenceDate ? new Date(referenceDate) : new Date());
    return res.json({ success: true, risk });
  } catch (err) {
    return userError(res, 500, 'RISK_ERROR', err?.message || 'Risk scoring failed.');
  }
});

app.post('/api/analyze/advisory', async (req, res) => {
  const { parsedInvoice, referenceDate } = req.body;
  if (!parsedInvoice || typeof parsedInvoice !== 'object') {
    return userError(res, 400, 'NO_PARSED_INVOICE', 'parsedInvoice object is required.');
  }

  try {
    const advisory = generateWarrantyAdvisory(parsedInvoice, referenceDate ? new Date(referenceDate) : new Date());
    return res.json({ success: true, advisory });
  } catch (err) {
    return userError(res, 500, 'ADVISORY_ERROR', err?.message || 'Warranty advisory generation failed.');
  }
});

app.post('/api/analyze/fraud', async (req, res) => {
  const { parsedInvoice, rawText, referenceDate, seenInvoiceNumbers } = req.body;
  if (!parsedInvoice || typeof parsedInvoice !== 'object') {
    return userError(res, 400, 'NO_PARSED_INVOICE', 'parsedInvoice object is required.');
  }

  try {
    const registry = Array.isArray(seenInvoiceNumbers) ? new Set(seenInvoiceNumbers) : undefined;
    const fraud = analyzeInvoiceFraud(parsedInvoice, typeof rawText === 'string' ? rawText : '', {
      seenInvoiceNumbers: registry,
    });
    return res.json({ success: true, fraud });
  } catch (err) {
    return userError(res, 500, 'FRAUD_ERROR', err?.message || 'Fraud detection failed.');
  }
});

app.post('/api/agent/addProduct', async (req, res) => {
  const { rawText, metadata, agentState } = req.body;
  if (typeof rawText !== 'string' || !rawText.trim()) {
    return userError(res, 400, 'NO_TEXT', 'rawText is required and must be a non-empty string.');
  }

  try {
    const agent = createAgent(agentState);
    const result = await agent.addProductFromText(rawText, metadata || {});
    return res.json({ success: true, result, agentState: agent.serialize() });
  } catch (err) {
    return userError(res, 500, 'AGENT_ERROR', err?.message || 'Agent product ingestion failed.');
  }
});

app.post('/api/agent/query', async (req, res) => {
  const { query, agentState } = req.body;
  if (typeof query !== 'string' || !query.trim()) {
    return userError(res, 400, 'NO_QUERY', 'query is required and must be a non-empty string.');
  }

  try {
    const agent = createAgent(agentState);
    const response = await agent.query(query);
    return res.json({ success: true, response, agentState: agent.serialize() });
  } catch (err) {
    return userError(res, 500, 'AGENT_QUERY_ERROR', err?.message || 'Agent query failed.');
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found.' });
});

app.listen(PORT, () => {
  console.log(`Warranty intelligence backend listening on port ${PORT}`);
});
