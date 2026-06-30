/**
 * functions/index.js
 *
 * Firebase Cloud Functions — API layer.
 * Server-side mirror of all upload validation. Frontend validation is
 * UX convenience only; this is the layer that cannot be bypassed.
 *
 * Free tier: Cloud Functions has a generous free quota (2M invocations/month),
 * so this remains zero-cost for typical usage.
 */
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const busboy = require('busboy');

admin.initializeApp();

// ── Constants — must mirror src/lib/fileValidation.js exactly ──────────────
const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3MB hard limit
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

// Magic byte signatures — same as frontend, verified again server-side
const FILE_SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/jpeg',      bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',       bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/webp',      bytes: [0x52, 0x49, 0x46, 0x46] },
];

function verifySignature(buffer, mime) {
  const sig = FILE_SIGNATURES.find((s) => s.mime === mime);
  if (!sig) return false;
  return sig.bytes.every((b, i) => buffer[i] === b);
}

// ── Simple in-memory rate limiter (per-instance; for production scale use
//    Firestore-backed or Redis-backed limiter, but this is free-tier-friendly
//    and sufficient for moderate traffic). ──────────────────────────────────
const rateLimitMap = new Map(); // uid -> [timestamps]
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function isRateLimited(uid) {
  const now = Date.now();
  const timestamps = (rateLimitMap.get(uid) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (timestamps.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(uid, timestamps);
    return true;
  }
  timestamps.push(now);
  rateLimitMap.set(uid, timestamps);
  return false;
}

// ── Auth verification helper ────────────────────────────────────────────────
async function verifyAuth(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

// ── CORS helper (restrict to known origins in production) ──────────────────
function setCors(res) {
  res.set('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * uploadInvoice — server-side validated invoice upload endpoint.
 * Accepts multipart/form-data with a single file field "invoice".
 *
 * Validation order (fail fast):
 *   1. Auth check (401 if missing/invalid)
 *   2. Rate limit check (429 if exceeded)
 *   3. Content-Length pre-check (413 immediately, before reading body)
 *   4. Streamed size enforcement (abort mid-stream if limit exceeded)
 *   5. MIME type check (415 if disallowed)
 *   6. Magic-byte signature check (422 if content doesn't match declared type)
 */
exports.uploadInvoice = functions.https.onRequest(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // 1. Auth
  const decoded = await verifyAuth(req);
  if (!decoded) { res.status(401).json({ error: 'Unauthorized. Sign in required.' }); return; }

  // 2. Rate limit
  if (isRateLimited(decoded.uid)) {
    res.status(429).json({ error: 'Too many upload requests. Please wait a moment and try again.' });
    return;
  }

  // 3. Content-Length pre-check — reject BEFORE reading the body at all.
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > MAX_FILE_SIZE_BYTES + 8192) { // +8KB allowance for multipart overhead/headers
    res.status(413).json({
      error: `Payload too large. Maximum file size is 3MB.`,
      code: 'PAYLOAD_TOO_LARGE',
    });
    return;
  }

  // 4-6. Stream parse with busboy, enforcing size during streaming
  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: MAX_FILE_SIZE_BYTES, files: 1 },
  });

  let fileBuffer = Buffer.alloc(0);
  let fileMime = null;
  let fileName = null;
  let sizeLimitExceeded = false;
  let responded = false;

  const respond = (status, body) => {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  };

  bb.on('file', (_name, stream, info) => {
    fileMime = info.mimeType;
    fileName = info.filename;

    // MIME check — reject immediately, drain the rest of the stream
    if (!ALLOWED_MIME_TYPES.has(fileMime)) {
      stream.resume(); // drain to avoid hanging connection
      respond(415, {
        error: `File type "${fileMime}" not allowed. Accepted: PDF, JPG, PNG, WEBP.`,
        code: 'INVALID_TYPE',
      });
      return;
    }

    stream.on('limit', () => {
      sizeLimitExceeded = true;
      stream.resume();
      respond(413, {
        error: 'File exceeds the maximum allowed size of 3MB.',
        code: 'PAYLOAD_TOO_LARGE',
      });
    });

    stream.on('data', (chunk) => {
      if (!sizeLimitExceeded) fileBuffer = Buffer.concat([fileBuffer, chunk]);
    });
  });

  bb.on('finish', async () => {
    if (responded || sizeLimitExceeded) return;

    if (!fileBuffer.length) {
      respond(400, { error: 'No file received.', code: 'EMPTY_FILE' });
      return;
    }

    // Signature validation — content must match declared MIME type
    if (!verifySignature(fileBuffer, fileMime)) {
      respond(422, {
        error: 'File content does not match its declared type. The file may be corrupted or disguised.',
        code: 'SIGNATURE_MISMATCH',
      });
      return;
    }

    // Store to Firebase Storage under the authenticated user's path
    try {
      const bucket = admin.storage().bucket();
      const safeFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `users/${decoded.uid}/invoices/${Date.now()}_${safeFileName}`;
      const file = bucket.file(path);

      await file.save(fileBuffer, {
        metadata: { contentType: fileMime },
      });

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 days
      });

      respond(200, { success: true, url, path, sizeBytes: fileBuffer.length });
    } catch (err) {
      respond(500, { error: 'Upload failed. Please try again.', code: 'STORAGE_ERROR' });
    }
  });

  req.pipe(bb);
});

/**
 * healthCheck — simple endpoint to verify the API layer is reachable.
 */
exports.healthCheck = functions.https.onRequest((req, res) => {
  setCors(res);
  res.status(200).json({ status: 'ok', maxFileSizeMB: 3, allowedTypes: [...ALLOWED_MIME_TYPES] });
});
