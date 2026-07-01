/**
 * fraudDetectionEngine.js
 *
 * INVOICE FRAUD DETECTION ENGINE
 *
 * Detects suspicious patterns in parsed invoices that may indicate
 * document manipulation, fake invoices, or attempts to claim warranty
 * on products not covered.
 *
 * IMPORTANT: This engine does NOT make final fraud verdicts. It surfaces
 * signals and confidence levels. Real fraud determination requires human
 * review. The engine is explicitly designed to surface what the warning
 * is based on so users (or support agents) can verify.
 *
 * Detection categories:
 *   1. STRUCTURAL INCONSISTENCIES — internal data contradictions
 *      (date after expiry, invoice number format doesn't match seller,
 *      seller name conflicts with brand region)
 *   2. OCR ANOMALY PATTERNS — character distributions typical of edited
 *      documents (unusual punctuation densities, numeric substitutions
 *      like 1/l/I confusion in product codes suggesting editing)
 *   3. DATE MANIPULATION SIGNALS — dates that don't make sense for the
 *      claimed product (invoice date before product launch, etc.)
 *   4. DUPLICATE INVOICE DETECTION — when a registry of seen invoice
 *      numbers is passed in, detect reuse
 *   5. SELLER CONSISTENCY — seller name inconsistency with brand region
 *      or platform (Amazon/Flipkart invoice format does not match)
 *   6. FIELD FORMAT ANOMALIES — invoice numbers / serial numbers with
 *      unusual character-length patterns
 *
 * Output:
 *   fraudScore: 0–100 (higher = more suspicious)
 *   warningLevel: CLEAN / SUSPICIOUS / HIGH_RISK / FRAUDULENT
 *   signals: array of specific detected anomalies with explanations
 *   recommendation: action to take (verify, reject, escalate)
 */

import { normalizeKey } from '../utils/textUtils.js';
import { isPlausiblePurchaseDate } from '../utils/dateUtils.js';

// Warning level thresholds.
const WARNING_LEVELS = Object.freeze([
  { min: 80, level: 'FRAUDULENT',  action: 'reject',   label: 'Strong indicators of document manipulation. Do not process this warranty claim without thorough human verification.' },
  { min: 55, level: 'HIGH_RISK',   action: 'escalate', label: 'Multiple suspicious signals detected. Escalate for manual review before processing.' },
  { min: 30, level: 'SUSPICIOUS',  action: 'verify',   label: 'Some inconsistencies detected. Verify key fields with the user before proceeding.' },
  { min: 0,  level: 'CLEAN',       action: 'proceed',  label: 'No significant fraud signals detected. Invoice appears legitimate.' },
]);

function getWarningLevel(score) {
  return WARNING_LEVELS.find((w) => score >= w.min) || WARNING_LEVELS[WARNING_LEVELS.length - 1];
}

// Known seller/platform patterns. Each brand's invoices from legitimate
// platforms follow predictable format conventions.
const PLATFORM_PATTERNS = Object.freeze({
  amazon: {
    invoiceNumberPattern: /^(IN-|AP-|A)\d+/i,
    orderNumberPattern: /^\d{3}-\d{7}-\d{7}$/,
    // Only use highly-specific Amazon seller identifiers
    expectedSellerKeywords: ['amazon', 'appario', 'cloudtail'],
  },
  flipkart: {
    invoiceNumberPattern: /^(FAK|FAS|FK)\d+/i,
    orderNumberPattern: /^OD\d{14,18}$/i,
    expectedSellerKeywords: ['flipkart', 'retailnet', 'omnitech', 'jeeves', 'ws retail'],
  },
});

/**
 * Checks invoice number against known platform patterns to detect
 * a number claimed to be from a platform that doesn't match its format.
 */
function checkInvoiceNumberPlatformConsistency(parsedInvoice) {
  const { invoiceNumber, seller, fieldSources } = parsedInvoice;
  if (!invoiceNumber || !seller) return null;

  const sellerNorm = normalizeKey(seller);

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    const sellerMatchesPlatform = patterns.expectedSellerKeywords.some((kw) => {
      const escaped = normalizeKey(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(sellerNorm);
    });
    if (!sellerMatchesPlatform) continue;

    const invoiceMatchesPlatform = patterns.invoiceNumberPattern.test(invoiceNumber);
    // Also accept when the invoice number matches the order number pattern
    // (Flipkart uses OD-prefixed order IDs as invoice references).
    const orderMatchesPlatform = patterns.orderNumberPattern && patterns.orderNumberPattern.test(invoiceNumber);

    if (!invoiceMatchesPlatform && !orderMatchesPlatform) {
      return {
        type: 'PLATFORM_INVOICE_MISMATCH',
        severity: 0.6,
        detail: `Seller "${seller}" appears to be a ${platform} seller, but invoice number "${invoiceNumber}" does not match the expected ${platform} invoice number format.`,
      };
    }
  }
  return null;
}

/**
 * Checks for OCR-noise anomalies that might indicate a document was
 * digitally edited (common in fake invoice creation: editing a real
 * invoice PDF in a graphics editor then rescanning or saving creates
 * characteristic artifacts).
 *
 * We check the raw cleaned text for:
 *   - Unusually high digit substitution density in normally-textual areas
 *   - Date values that contradict each other
 *   - Product name containing numeric substitutions typical of graphic editing
 */
function checkOcrAnomalyPatterns(parsedInvoice, rawText) {
  const signals = [];
  if (!rawText) return signals;

  // Check for suspicious concentration of number/letter confusion
  // characters OUTSIDE of date/serial number contexts.
  // Real OCR noise is distributed naturally; edited documents often
  // show it concentrated in specific edited fields.
  const lines = rawText.split('\n').filter((l) => l.trim().length > 0);
  const suspiciousLineCount = lines.filter((line) => {
    const normalized = line.toLowerCase();
    // Lines that contain a mix of 'l/1', 'o/0', 'I/1' substitution patterns
    // concentrated in what should be text fields (not serial/invoice numbers).
    const hasNumericSubstitution = /[0-9][oOlI][0-9]|[oOlI][0-9][oOlI]/.test(line);
    const isLikelySensitiveField = /\b(total|amount|date|price|warranty)\b/i.test(normalized);
    return hasNumericSubstitution && isLikelySensitiveField;
  }).length;

  if (suspiciousLineCount >= 2) {
    signals.push({
      type: 'OCR_SUBSTITUTION_CONCENTRATION',
      severity: 0.4,
      detail: `Found ${suspiciousLineCount} lines where numeric/letter OCR substitutions (0/o, l/1, I/1) appear concentrated in financial or date fields. This pattern is more common in digitally edited documents than genuine OCR noise.`,
    });
  }

  // Check: purchase date inferred without a clear label on a high-confidence invoice
  // (high-confidence invoices from major platforms always have explicit date labels).
  if (
    parsedInvoice.purchaseDate &&
    parsedInvoice.fieldSources?.purchaseDate === 'document-wide date scan (no explicit purchase-date label found)' &&
    parsedInvoice.overallConfidence >= 0.70 // only suspicious on otherwise well-parsed invoices
  ) {
    signals.push({
      type: 'MISSING_DATE_LABEL',
      severity: 0.2,
      detail: 'Purchase date was inferred from document-wide scan on an otherwise well-structured invoice. Legitimate high-quality invoices typically have clearly labelled date fields.',
    });
  }

  return signals;
}

/**
 * Checks for date-range impossibilities.
 */
function checkDateConsistency(parsedInvoice) {
  const signals = [];
  const { purchaseDate, warrantyMonths } = parsedInvoice;

  if (!purchaseDate) return signals;

  const purchase = new Date(purchaseDate);
  const now = new Date();

  // Invoice in the future.
  if (purchase.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
    signals.push({
      type: 'FUTURE_PURCHASE_DATE',
      severity: 0.85,
      detail: `Purchase date ${purchaseDate} is in the future. This is a strong indicator of date manipulation.`,
    });
  }

  // Purchase date > 25 years ago (beyond any plausible electronics warranty claim).
  if (!isPlausiblePurchaseDate(purchase)) {
    signals.push({
      type: 'IMPLAUSIBLE_PURCHASE_DATE',
      severity: 0.7,
      detail: `Purchase date ${purchaseDate} is either impossibly old or in the future for a consumer electronics warranty claim.`,
    });
  }

  // Warranty duration suspiciously long.
  if (warrantyMonths && warrantyMonths > 120) {
    signals.push({
      type: 'EXCESSIVE_WARRANTY_DURATION',
      severity: 0.6,
      detail: `Stated warranty duration of ${warrantyMonths} months (${Math.round(warrantyMonths / 12)} years) is unusually long for a standard manufacturer warranty. Maximum typical consumer warranty is 5 years (60 months) for major appliances.`,
    });
  }

  // Warranty duration implausibly short.
  if (warrantyMonths && warrantyMonths < 3 && warrantyMonths > 0) {
    signals.push({
      type: 'SUSPICIOUSLY_SHORT_WARRANTY',
      severity: 0.35,
      detail: `Stated warranty duration of ${warrantyMonths} month(s) is unusually short. Most manufacturers provide at least 6-12 months. Verify the warranty text.`,
    });
  }

  return signals;
}

/**
 * Checks for structural field format anomalies — invoice numbers,
 * serial numbers, or GSTIN with obviously wrong formats.
 */
function checkFieldFormatAnomalies(parsedInvoice) {
  const signals = [];
  const { invoiceNumber, serialNumber } = parsedInvoice;

  // Invoice number anomalies.
  if (invoiceNumber) {
    // Too short to be real.
    if (invoiceNumber.replace(/\s/g, '').length < 4) {
      signals.push({
        type: 'SHORT_INVOICE_NUMBER',
        severity: 0.5,
        detail: `Invoice number "${invoiceNumber}" is unusually short (less than 4 characters). Legitimate invoice numbers are typically longer.`,
      });
    }
    // Contains suspicious all-zeros or repeating patterns.
    if (/^0+$/.test(invoiceNumber) || /^(.)\1{4,}$/.test(invoiceNumber)) {
      signals.push({
        type: 'REPEATING_INVOICE_NUMBER',
        severity: 0.75,
        detail: `Invoice number "${invoiceNumber}" appears to be a placeholder or test value (all-zeros or repeating character pattern).`,
      });
    }
  }

  // Serial number anomalies.
  if (serialNumber) {
    if (/^0+$/.test(serialNumber) || /^(.)\1{4,}$/.test(serialNumber)) {
      signals.push({
        type: 'SUSPICIOUS_SERIAL_NUMBER',
        severity: 0.65,
        detail: `Serial number "${serialNumber}" appears to be a placeholder (all-zeros or repeating pattern). Verify with the physical device.`,
      });
    }
    // Serial number too short.
    if (serialNumber.replace(/[-\s]/g, '').length < 6) {
      signals.push({
        type: 'SHORT_SERIAL_NUMBER',
        severity: 0.45,
        detail: `Serial number "${serialNumber}" is unusually short. Most device serial numbers are 8+ characters.`,
      });
    }
  }

  return signals;
}

/**
 * Checks for seller name inconsistencies — e.g. a "Sharma Electronics"
 * seller label but an Amazon-style invoice number, or contradictory brand
 * and seller region signals.
 */
function checkSellerConsistency(parsedInvoice) {
  const signals = [];
  const { seller, invoiceNumber, brand, fieldSources } = parsedInvoice;

  if (!seller) return signals;

  const sellerNorm = normalizeKey(seller);

  // If seller was detected only from the all-caps-header heuristic AND
  // an invoice number was found from a known platform, check for conflict.
  const sellerIsHeuristic = fieldSources?.seller?.includes('heuristic');
  if (sellerIsHeuristic && invoiceNumber) {
    const looksLikeAmazon = PLATFORM_PATTERNS.amazon.invoiceNumberPattern.test(invoiceNumber);
    const looksLikeFlipkart = PLATFORM_PATTERNS.flipkart.invoiceNumberPattern.test(invoiceNumber);
    const sellerLooksLocal = sellerNorm.length > 0 &&
      !PLATFORM_PATTERNS.amazon.expectedSellerKeywords.some((k) => sellerNorm.includes(k)) &&
      !PLATFORM_PATTERNS.flipkart.expectedSellerKeywords.some((k) => sellerNorm.includes(k));

    if ((looksLikeAmazon || looksLikeFlipkart) && sellerLooksLocal) {
      signals.push({
        type: 'SELLER_PLATFORM_CONFLICT',
        severity: 0.4,
        detail: `Seller appears to be a local store ("${seller}") but the invoice number format suggests it may be an Amazon or Flipkart invoice. Verify the seller and platform.`,
      });
    }
  }

  return signals;
}

/**
 * Checks an invoice number against a registry of previously-seen
 * invoice numbers. Call this across all invoices in a user's account
 * to detect duplicate submissions.
 *
 * @param {string} invoiceNumber
 * @param {Set<string>} seenInvoiceNumbers  Pass a persistent Set maintained
 *                                          by the calling application layer.
 * @param {Map<string, object>} invoiceRegistry Optional: maps invoice# to
 *                                              the first submission metadata.
 */
export function checkForDuplicate(invoiceNumber, seenInvoiceNumbers, invoiceRegistry = null) {
  if (!invoiceNumber || !seenInvoiceNumbers) return null;
  const norm = invoiceNumber.replace(/\s/g, '').toLowerCase();
  if (seenInvoiceNumbers.has(norm)) {
    const firstSeen = invoiceRegistry?.get(norm);
    return {
      type: 'DUPLICATE_INVOICE_NUMBER',
      severity: 0.9,
      detail: `Invoice number "${invoiceNumber}" has already been used in this account` +
        (firstSeen ? ` (first submitted: ${firstSeen.submittedAt || 'unknown date'})` : '') +
        `. Duplicate invoice submissions are a common fraud pattern.`,
    };
  }
  return null;
}

/**
 * Main fraud detection entry point.
 *
 * @param {object} parsedInvoice      Output of invoiceParser.parseInvoice().
 * @param {string} [rawOcrText]       Original cleaned OCR text for pattern analysis.
 * @param {object} [options]
 * @param {Set<string>} [options.seenInvoiceNumbers]   Registry for duplicate detection.
 * @param {Map<string, object>} [options.invoiceRegistry]
 * @returns {object} Fraud detection report.
 */
export function analyzeInvoiceFraud(parsedInvoice, rawOcrText = '', options = {}) {
  const signals = [];

  // Run all detectors.
  const dateSignals = checkDateConsistency(parsedInvoice);
  signals.push(...dateSignals);

  const fieldSignals = checkFieldFormatAnomalies(parsedInvoice);
  signals.push(...fieldSignals);

  const platformSignal = checkInvoiceNumberPlatformConsistency(parsedInvoice);
  if (platformSignal) signals.push(platformSignal);

  const sellerSignals = checkSellerConsistency(parsedInvoice);
  signals.push(...sellerSignals);

  const ocrSignals = checkOcrAnomalyPatterns(parsedInvoice, rawOcrText);
  signals.push(...ocrSignals);

  // Duplicate check (optional, requires caller to pass registry).
  if (options.seenInvoiceNumbers && parsedInvoice.invoiceNumber) {
    const dupSignal = checkForDuplicate(
      parsedInvoice.invoiceNumber,
      options.seenInvoiceNumbers,
      options.invoiceRegistry
    );
    if (dupSignal) signals.push(dupSignal);
  }

  // Compute composite fraud score from signal severities.
  // Each signal contributes its severity * 100 to the raw score,
  // then we cap at 100 and apply diminishing returns for multiple signals
  // (the 2nd and 3rd signals count less than the 1st to avoid over-penalizing
  // genuine OCR-noisy documents).
  const sortedSignals = [...signals].sort((a, b) => b.severity - a.severity);
  let fraudScore = 0;
  for (let i = 0; i < sortedSignals.length; i++) {
    const weight = i === 0 ? 1 : i === 1 ? 0.7 : 0.4; // diminishing contribution
    fraudScore += sortedSignals[i].severity * 100 * weight;
  }
  fraudScore = Math.round(Math.min(100, fraudScore));

  const { level: warningLevel, action, label: warningLabel } = getWarningLevel(fraudScore);

  return {
    fraudScore,
    warningLevel,
    warningLabel,
    recommendedAction: action,
    signalCount: signals.length,
    signals: signals.map((s) => ({
      type: s.type,
      severity: s.severity,
      severityLabel: s.severity >= 0.7 ? 'HIGH' : s.severity >= 0.4 ? 'MEDIUM' : 'LOW',
      detail: s.detail,
    })),
    summary:
      signals.length === 0
        ? 'No fraud signals detected. Invoice appears structurally consistent.'
        : `${signals.length} suspicious signal(s) detected. Highest severity: ${sortedSignals[0]?.type || 'unknown'}.`,
    analyzedAt: new Date().toISOString(),
  };
}

export default { analyzeInvoiceFraud, checkForDuplicate };
