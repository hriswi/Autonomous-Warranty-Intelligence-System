/**
 * ocrEngine.js
 *
 * Real OCR pipeline built on Tesseract.js (no paid/cloud OCR APIs).
 *
 * This module owns the boundary between "raw file" and "raw text".
 * It is intentionally dumb about invoices/warranties — its only job
 * is: given an image (or a single page rendered from a PDF), return
 * the most reliable text Tesseract can extract, plus useful metadata
 * (per-word confidence, low-confidence regions) that downstream parsers
 * can use to decide how much to trust a given match.
 *
 * Supported inputs:
 *  - Browser: File / Blob (from <input type="file">), HTMLCanvasElement,
 *    HTMLImageElement, ImageData, or a data URL string.
 *  - Node:   file path string, or a Buffer (e.g. from multer / fs.readFile).
 *
 * PDF handling:
 *  - Tesseract.js does not parse PDFs directly. PDFs must be rasterized
 *    to images (one per page) before OCR. This module exposes a clean
 *    seam (`rasterizePdfPage`) for that step and documents exactly which
 *    library to wire it to, rather than silently no-op'ing or faking it.
 */

import { createWorker } from 'tesseract.js';

/**
 * Default Tesseract recognition options tuned for invoices/receipts:
 * mostly printed text, mixed font sizes, often low-contrast thermal
 * prints or phone-camera photos of paper receipts.
 */
const DEFAULT_TESSERACT_OPTIONS = {
  lang: 'eng',
  // PSM 3 = fully automatic page segmentation (no OSD). Good default for
  // multi-block documents like invoices that mix headers, tables, and
  // free text. Callers can override (e.g. PSM 6 for a single uniform block).
  tessedit_pageseg_mode: '3',
};

/**
 * Internal singleton worker pool. Spinning up a Tesseract worker has
 * real startup cost (loads the WASM core + language traineddata), so
 * for an app that OCRs many invoices in a session we reuse a worker
 * instead of creating/terminating one per call.
 */
let workerPromise = null;

async function getWorker(lang = 'eng') {
  if (!workerPromise) {
    workerPromise = createWorker(lang).then(async (worker) => {
      return worker;
    });
  }
  return workerPromise;
}

/**
 * Releases the underlying Tesseract worker and its WASM memory.
 * Call this when the user navigates away from the upload flow entirely
 * (not between individual uploads), to avoid the cost of re-initializing.
 */
export async function terminateOcrEngine() {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

/**
 * Runs OCR on a single image input and returns structured results.
 *
 * @param {File|Blob|HTMLCanvasElement|HTMLImageElement|ImageData|string|Buffer} image
 * @param {object} options
 * @param {string} [options.lang='eng']
 * @param {string} [options.pageSegMode] Tesseract PSM override.
 * @param {number} [options.minWordConfidence=60] Words below this confidence
 *        (0-100) are flagged as low-confidence rather than discarded, so
 *        the caller/UI can highlight them for manual correction.
 * @returns {Promise<{
 *   rawText: string,
 *   confidence: number,
 *   words: Array<{ text: string, confidence: number, bbox: object }>,
 *   lowConfidenceWords: Array<{ text: string, confidence: number }>,
 *   lines: Array<{ text: string, confidence: number }>,
 *   engine: 'tesseract.js'
 * }>}
 */
export async function extractTextFromImage(image, options = {}) {
  if (!image) {
    throw new OcrError('NO_INPUT', 'No image, file, or buffer was provided to the OCR engine.');
  }

  const lang = options.lang || DEFAULT_TESSERACT_OPTIONS.lang;
  const minWordConfidence = options.minWordConfidence ?? 60;

  let worker;
  try {
    worker = await getWorker(lang);
  } catch (err) {
    throw new OcrError(
      'WORKER_INIT_FAILED',
      `Failed to initialize the Tesseract OCR worker: ${err.message}`
    );
  }

  if (options.pageSegMode) {
    await worker.setParameters({ tessedit_pageseg_mode: options.pageSegMode });
  }

  let result;
  try {
    result = await worker.recognize(image);
  } catch (err) {
    throw new OcrError(
      'RECOGNITION_FAILED',
      `Tesseract failed to process the provided image: ${err.message}`
    );
  }

  const data = result.data || {};
  const rawText = data.text || '';

  // Flatten word-level confidence data across all blocks/paragraphs/lines.
  const words = [];
  const lines = [];

  const blocks = data.blocks || [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        lines.push({
          text: (line.text || '').trim(),
          confidence: line.confidence ?? 0,
        });
        for (const word of line.words || []) {
          words.push({
            text: word.text,
            confidence: word.confidence ?? 0,
            bbox: word.bbox,
          });
        }
      }
    }
  }

  // Fallback: some Tesseract.js builds return data.words directly
  // instead of the nested blocks->paragraphs->lines->words tree.
  if (words.length === 0 && Array.isArray(data.words)) {
    for (const word of data.words) {
      words.push({
        text: word.text,
        confidence: word.confidence ?? 0,
        bbox: word.bbox,
      });
    }
  }

  const lowConfidenceWords = words.filter((w) => w.confidence < minWordConfidence);

  return {
    rawText,
    confidence: typeof data.confidence === 'number' ? data.confidence : averageConfidence(words),
    words,
    lowConfidenceWords,
    lines,
    engine: 'tesseract.js',
  };
}

function averageConfidence(words) {
  if (!words.length) return 0;
  const sum = words.reduce((acc, w) => acc + (w.confidence || 0), 0);
  return Math.round((sum / words.length) * 100) / 100;
}

/**
 * Custom error type so calling code (UI layer) can distinguish
 * "OCR engine broke" from "this just isn't readable text" and show
 * an appropriate message instead of a generic failure.
 */
export class OcrError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'OcrError';
    this.code = code;
  }
}

/**
 * Detects whether a given uploaded file is a PDF based on MIME type
 * and/or filename extension (defensive: some browsers report PDFs
 * inconsistently, especially when forwarded from camera scanner apps).
 */
export function isPdfFile(file) {
  if (!file) return false;
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();
  return mime === 'application/pdf' || name.endsWith('.pdf');
}

/**
 * Rasterizes a single PDF page to a canvas/image that Tesseract can
 * consume. Tesseract.js has no native PDF support, so PDFs MUST go
 * through this step first.
 *
 * Real implementation wiring (intentionally left as a clear seam rather
 * than silently faked): use pdf.js (`pdfjs-dist`, MIT licensed, free)
 * to render the requested page onto an OffscreenCanvas/HTMLCanvasElement
 * at a resolution high enough for OCR (200-300 DPI equivalent), then
 * hand that canvas to `extractTextFromImage`.
 *
 * This function performs input validation and orchestration; the actual
 * pdf.js render call is injected via `renderer` so this module has zero
 * hard dependency on pdfjs-dist (kept out of this package's deps to
 * avoid bundling a large PDF renderer into a module whose core job is OCR).
 *
 * @param {File|Blob|ArrayBuffer} pdfSource
 * @param {number} pageNumber 1-indexed page number.
 * @param {object} options
 * @param {(pdfSource: any, pageNumber: number, scale: number) => Promise<HTMLCanvasElement|OffscreenCanvas>} options.renderer
 *        Required. Caller supplies a pdf.js-backed renderer function.
 * @param {number} [options.scale=2.5] Render scale; higher = better OCR accuracy, slower.
 */
export async function rasterizePdfPage(pdfSource, pageNumber = 1, options = {}) {
  if (!pdfSource) {
    throw new OcrError('NO_INPUT', 'No PDF source provided for rasterization.');
  }
  if (typeof options.renderer !== 'function') {
    throw new OcrError(
      'NO_PDF_RENDERER',
      'rasterizePdfPage requires a `renderer` function backed by pdf.js (pdfjs-dist). ' +
        'Wire this up in the app layer: import * as pdfjsLib from "pdfjs-dist" and pass ' +
        'a function that loads the document and renders the requested page to a canvas.'
    );
  }
  const scale = options.scale || 2.5;
  const canvas = await options.renderer(pdfSource, pageNumber, scale);
  if (!canvas) {
    throw new OcrError('PDF_RENDER_FAILED', `Failed to rasterize PDF page ${pageNumber}.`);
  }
  return canvas;
}

/**
 * High-level convenience function: takes ANY supported invoice source
 * (image file, or PDF + renderer) and returns extracted text, handling
 * the PDF rasterization step transparently if needed.
 *
 * This is the function the upload UI should call.
 */
export async function extractInvoiceText(file, options = {}) {
  if (isPdfFile(file)) {
    const canvas = await rasterizePdfPage(file, options.pageNumber || 1, options);
    return extractTextFromImage(canvas, options);
  }
  return extractTextFromImage(file, options);
}

export default {
  extractTextFromImage,
  extractInvoiceText,
  rasterizePdfPage,
  isPdfFile,
  terminateOcrEngine,
  OcrError,
};
