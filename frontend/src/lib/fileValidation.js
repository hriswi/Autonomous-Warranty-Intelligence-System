/**
 * fileValidation.js
 *
 * CENTRAL FILE SECURITY LAYER
 * All upload points import from here. Single source of truth for the
 * 3MB hard limit, allowed MIME types, and file signature validation.
 *
 * Enforced at:
 *   1. Drag-and-drop zone (instant rejection)
 *   2. Input[type=file] onChange
 *   3. OCR pipeline entry
 *   4. Firebase Storage upload call
 *   5. API layer (server-side mirror)
 */

// ── Constants ────────────────────────────────────────────────────────────────
export const MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024; // 3 MB — hard limit
export const MAX_FILE_SIZE_LABEL = '3MB';

/** Allowed MIME types. Nothing outside this set is accepted. */
export const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Human-readable format list shown in UI */
export const ALLOWED_FORMATS_LABEL = 'PDF, JPG, PNG, WEBP';

/** react-dropzone accept map */
export const DROPZONE_ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/jpeg':      ['.jpg', '.jpeg'],
  'image/png':       ['.png'],
  'image/webp':      ['.webp'],
};

/**
 * Known-dangerous extensions that must be blocked even if MIME
 * header looks benign (double-extension attacks, polyglots, etc.)
 */
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'ps1', 'msi', 'dll', 'so',
  'js',  'ts',  'jsx', 'tsx', 'mjs', 'cjs',
  'html','htm', 'php', 'py',  'rb',  'pl',  'java', 'class',
  'zip', 'rar', '7z',  'tar', 'gz',  'bz2',
  'svg', 'xml', 'json','csv',
  'scr', 'vbs', 'wsf', 'hta', 'cpl', 'inf',
]);

/**
 * Magic-byte signatures for allowed file types.
 * We read the first 8 bytes of the file and verify the actual content
 * matches the declared MIME type — prevents fake-PDF attacks.
 */
const FILE_SIGNATURES = [
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }, // %PDF
  { mime: 'image/jpeg',      bytes: [0xFF, 0xD8, 0xFF],         offset: 0 }, // JPEG SOI
  { mime: 'image/png',       bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 }, // PNG
  { mime: 'image/webp',      bytes: [0x52, 0x49, 0x46, 0x46],   offset: 0 }, // RIFF (WEBP)
];

// ── Validation result type ────────────────────────────────────────────────────
// { valid: boolean, error: string|null, code: string|null }

function fail(code, error) { return { valid: false, error, code }; }
const ok = { valid: true, error: null, code: null };

// ── Core validators ───────────────────────────────────────────────────────────

/** Layer 1 — synchronous checks (size, MIME, extension). No I/O needed. */
export function validateFileSync(file) {
  if (!file) return fail('NO_FILE', 'No file provided.');

  // ── Size check ────────────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return fail(
      'FILE_TOO_LARGE',
      `File exceeds the maximum allowed size of ${MAX_FILE_SIZE_LABEL}. ` +
        `Your file is ${formatBytes(file.size)}. Please compress or resize and try again.`
    );
  }
  if (file.size === 0) {
    return fail('EMPTY_FILE', 'The file is empty. Please upload a valid document.');
  }

  // ── MIME type check ───────────────────────────────────────────────────────
  const mime = (file.type || '').toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(mime)) {
    return fail(
      'INVALID_TYPE',
      `File type "${mime || 'unknown'}" is not allowed. ` +
        `Accepted formats: ${ALLOWED_FORMATS_LABEL}.`
    );
  }

  // ── Extension check — double-extension attack prevention ─────────────────
  const name = (file.name || '').toLowerCase();
  const parts = name.split('.');
  // Check every segment after the first — "invoice.pdf.exe" → blocked
  for (let i = 1; i < parts.length; i++) {
    if (BLOCKED_EXTENSIONS.has(parts[i])) {
      return fail(
        'DANGEROUS_EXTENSION',
        `File "${file.name}" contains a blocked extension ".${parts[i]}". ` +
          `Executables and scripts are not allowed.`
      );
    }
  }

  // ── Path traversal prevention ─────────────────────────────────────────────
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return fail('PATH_TRAVERSAL', 'Invalid filename. The file cannot be uploaded.');
  }

  return ok;
}

/** Layer 2 — async magic-byte signature validation. Reads first 8 bytes. */
export async function validateFileSignature(file) {
  const sync = validateFileSync(file);
  if (!sync.valid) return sync;

  const mime = (file.type || '').toLowerCase();
  const expectedSig = FILE_SIGNATURES.find((s) => s.mime === mime);
  if (!expectedSig) {
    // No known signature for this MIME — already blocked by MIME check above,
    // but be defensive.
    return fail('UNKNOWN_SIGNATURE', 'Cannot verify file authenticity.');
  }

  try {
    // Read just the first 8 bytes — efficient, no need to load the whole file
    const slice = file.slice(0, 8);
    const buffer = await slice.arrayBuffer();
    const bytes  = new Uint8Array(buffer);

    const matches = expectedSig.bytes.every(
      (b, i) => bytes[expectedSig.offset + i] === b
    );

    if (!matches) {
      return fail(
        'SIGNATURE_MISMATCH',
        `The file content does not match its declared type (${mime}). ` +
          `The file may be corrupted or disguised as a different format.`
      );
    }
  } catch {
    // If we can't read the file header, reject it — never trust unverifiable input
    return fail('SIGNATURE_READ_ERROR', 'Unable to verify file integrity. Please try another file.');
  }

  return ok;
}

/** Full validation — sync + async signature. Use this at all upload entry points. */
export async function validateFile(file) {
  const sync = validateFileSync(file);
  if (!sync.valid) return sync;
  return validateFileSignature(file);
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function formatBytes(bytes) {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Returns the percentage of MAX_FILE_SIZE the given file occupies (0-100). */
export function fileSizePercent(bytes) {
  return Math.min(100, Math.round((bytes / MAX_FILE_SIZE_BYTES) * 100));
}

/**
 * Drop-zone validator for react-dropzone's `validator` prop.
 * Returns null (valid) or a FileError object (invalid).
 * This fires BEFORE the onDrop callback — instant UI rejection.
 */
export function dropzoneValidator(file) {
  const result = validateFileSync(file);
  if (result.valid) return null;
  return { code: result.code, message: result.error };
}
