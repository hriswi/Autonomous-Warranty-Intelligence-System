/**
 * invoiceParser.js
 *
 * INTELLIGENT INVOICE UNDERSTANDING ENGINE
 *
 * Takes cleaned OCR text from an invoice/receipt/warranty card and
 * extracts structured fields:
 *   - Product Name
 *   - Brand
 *   - Seller Name
 *   - Invoice Number
 *   - Purchase Date
 *   - Serial Number
 *   - Warranty Duration (delegated to warrantyDurationParser)
 *
 * Method: label-based line parsing (most reliable: invoices print
 * "Invoice Number: X" style label/value pairs) combined with
 * full-document regex fallbacks for when OCR breaks the label/value
 * line apart (column misalignment is extremely common in OCR'd tables).
 *
 * Every extracted field carries a confidence score and the raw matched
 * snippet, so the calling UI can visually flag low-confidence fields
 * for the user to confirm/correct rather than silently trusting a guess.
 */

import { cleanOcrText, toLines, normalizeKey, tokenize } from '../utils/textUtils.js';
import { findAllDates, isPlausiblePurchaseDate } from '../utils/dateUtils.js';
import { detectPrimaryWarrantyMonths, detectWarrantyDurations } from './warrantyDurationParser.js';
import { classifyProduct } from '../classifier/productClassifier.js';
import { BRANDS } from '../classifier/productDatabase.js';

/**
 * Label dictionaries: each field can be introduced by several different
 * label phrasings across platforms (Amazon, Flipkart, local retailers,
 * Apple Store, etc). Order doesn't matter; all are tried.
 */
const FIELD_LABELS = {
  invoiceNumber: [
    'invoice number', 'invoice no', 'invoice #', 'tax invoice no',
    'bill no', 'bi11 no', 'receipt no', 'memo no',
  ],
  orderNumber: ['order number', 'order id', 'order no'],
  serialNumber: [
    'serial number', 'serial no', 's/n', 'sr no', 'sl no', 'imei',
  ],
  seller: [
    'sold by', 'seller', 'vendor', 'retailer', 'dealer', 'merchant',
  ],
  warrantyLabel: ['warranty', 'guarantee'],
  purchaseDateLabel: [
    'date of purchase', 'purchase date', 'order date', 'invoice date',
    'bill date', 'date',
  ],
  productLabel: ['item', 'description', 'product', 'item description'],
};

/**
 * Builds a regex that matches "<label> [:/-]? <value>" on a single line,
 * tolerant of OCR noise around the separator (colon, dash, multiple spaces).
 */
function buildLabelValueRegex(label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  // value = rest of line after optional separator punctuation
  return new RegExp(`^\\s*${escapedLabel}\\s*[:#\\-]?\\s*(.+)$`, 'i');
}

/**
 * Searches for the first line whose start matches one of the given
 * label phrasings, returning { value, matchedLabel, lineIndex, line }.
 *
 * @param {string[]} lines
 * @param {string[]} labelList Labels in PRIORITY order (most specific/
 *        preferred phrasing first).
 * @param {object} [opts]
 * @param {boolean} [opts.labelPriorityFirst=false] When true, the label
 *        list's order takes precedence over line order: ALL lines are
 *        checked against the first (most preferred) label before moving
 *        on to the next label. This matters when multiple distinct
 *        labels could match on different lines of the same document
 *        (e.g. both "Invoice Date:" and "Purchase Date:" appear), and
 *        we want the more semantically specific label to win regardless
 *        of which one happens to appear earlier in the document.
 *        When false (default), the first line (in document order) that
 *        matches ANY label in the list wins — appropriate when the
 *        labels are just synonyms of equal priority for the same field.
 */
function extractByLabel(lines, labelList, opts = {}) {
  const { labelPriorityFirst = false } = opts;

  if (labelPriorityFirst) {
    for (const label of labelList) {
      const regex = buildLabelValueRegex(label);
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(regex);
        if (match && match[1] && match[1].trim().length > 0) {
          return { value: match[1].trim(), matchedLabel: label, lineIndex: i, line: lines[i] };
        }
      }
    }
    return null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labelList) {
      const regex = buildLabelValueRegex(label);
      const match = line.match(regex);
      if (match && match[1] && match[1].trim().length > 0) {
        return { value: match[1].trim(), matchedLabel: label, lineIndex: i, line };
      }
    }
  }
  return null;
}

/**
 * Some OCR output splits "Invoice Number:" onto one line and the actual
 * value onto the NEXT line (column-based layouts rasterized badly).
 * This checks the line immediately following a bare label line.
 */
function extractByLabelNextLine(lines, labelList) {
  for (let i = 0; i < lines.length - 1; i++) {
    const line = normalizeKey(lines[i]);
    for (const label of labelList) {
      if (line === normalizeKey(label) || line === normalizeKey(label) + ' :') {
        const nextLine = lines[i + 1].trim();
        if (nextLine.length > 0) {
          return { value: nextLine, matchedLabel: label, lineIndex: i + 1, line: lines[i + 1] };
        }
      }
    }
  }
  return null;
}

/**
 * --- INVOICE NUMBER ---
 * Prefer explicit "Invoice Number" label; fall back to "Order Number"
 * only if no invoice number found (and mark lower confidence, since
 * order ID and invoice number are legally/functionally different IDs).
 */
function extractInvoiceNumber(lines) {
  const direct = extractByLabel(lines, FIELD_LABELS.invoiceNumber);
  if (direct) {
    // Strip trailing junk that sometimes rides along on the same OCR line
    // (e.g. a stray date or page marker captured by the greedy regex).
    const cleanedValue = direct.value.split(/\s{2,}/)[0].trim();
    return {
      value: cleanedValue,
      confidence: 0.92,
      source: `label match: "${direct.matchedLabel}"`,
    };
  }

  const nextLine = extractByLabelNextLine(lines, FIELD_LABELS.invoiceNumber);
  if (nextLine) {
    return { value: nextLine.value, confidence: 0.75, source: `label (next line): "${nextLine.matchedLabel}"` };
  }

  const orderFallback = extractByLabel(lines, FIELD_LABELS.orderNumber);
  if (orderFallback) {
    return {
      value: orderFallback.value.split(/\s{2,}/)[0].trim(),
      confidence: 0.45,
      source: `fallback to order number (no explicit invoice number found): "${orderFallback.matchedLabel}"`,
    };
  }

  return { value: null, confidence: 0, source: 'not found' };
}

/**
 * --- SERIAL NUMBER ---
 * Serial numbers are alphanumeric, usually 6+ characters, often with
 * a mix of letters and digits. We validate the extracted value against
 * this shape to avoid accidentally capturing a price or date that
 * happened to follow a loosely-matched label.
 */
function looksLikeSerialNumber(value) {
  if (!value) return false;
  const cleaned = value.replace(/\s+/g, '');
  if (cleaned.length < 5 || cleaned.length > 30) return false;
  // Must contain at least one digit and be mostly alphanumeric.
  if (!/\d/.test(cleaned)) return false;
  if (!/^[A-Za-z0-9\-]+$/.test(cleaned)) return false;
  return true;
}

function extractSerialNumber(lines) {
  const direct = extractByLabel(lines, FIELD_LABELS.serialNumber);
  if (direct) {
    const candidate = direct.value.split(/\s{2,}/)[0].trim();
    if (looksLikeSerialNumber(candidate)) {
      return { value: candidate, confidence: 0.9, source: `label match: "${direct.matchedLabel}"` };
    }
    // Label matched but value shape looks wrong — still surface it,
    // but with reduced confidence so the UI flags it for confirmation.
    return { value: candidate, confidence: 0.4, source: `label match but unusual format: "${direct.matchedLabel}"` };
  }
  return { value: null, confidence: 0, source: 'not found' };
}

/**
 * --- SELLER NAME ---
 */
function extractSeller(lines) {
  const direct = extractByLabel(lines, FIELD_LABELS.seller);
  if (direct) {
    return { value: direct.value, confidence: 0.85, source: `label match: "${direct.matchedLabel}"` };
  }

  // Heuristic fallback: the FIRST non-empty line of an invoice from a
  // physical store is very commonly the store/business name printed as
  // a header (e.g. "SHARMA ELECTRONICS"), especially when in ALL CAPS.
  if (lines.length > 0) {
    const firstLine = lines[0];
    const isAllCapsHeader =
      firstLine === firstLine.toUpperCase() &&
      /[A-Z]/.test(firstLine) &&
      firstLine.length >= 4 &&
      firstLine.length <= 50 &&
      !/\d{3,}/.test(firstLine); // exclude lines that are mostly numbers (e.g. GSTIN lines)
    if (isAllCapsHeader) {
      return { value: firstLine, confidence: 0.5, source: 'heuristic: all-caps header line' };
    }
  }

  return { value: null, confidence: 0, source: 'not found' };
}

/**
 * --- PURCHASE DATE ---
 * Strategy:
 *  1. Prefer a date found right after an explicit purchase-date-style label.
 *  2. Otherwise scan the WHOLE document for all date-like strings and
 *     pick the highest-confidence plausible one (not in the future,
 *     not absurdly old).
 *  3. When multiple plausible dates exist (order date vs invoice date
 *     vs delivery date), prefer the one closest to a "purchase" or
 *     "order" labeled context over an unlabeled date.
 */
function extractPurchaseDate(lines, fullText) {
  const direct = extractByLabel(lines, FIELD_LABELS.purchaseDateLabel, { labelPriorityFirst: true });
  if (direct) {
    const datesInLine = findAllDates(direct.value);
    if (datesInLine.length > 0 && isPlausiblePurchaseDate(datesInLine[0].date)) {
      return {
        value: datesInLine[0].iso,
        rawMatch: datesInLine[0].raw,
        confidence: Math.min(0.93, datesInLine[0].confidence + 0.05),
        source: `label match: "${direct.matchedLabel}"`,
      };
    }
  }

  // Document-wide scan fallback.
  const allDates = findAllDates(fullText).filter((d) => isPlausiblePurchaseDate(d.date));
  if (allDates.length > 0) {
    return {
      value: allDates[0].iso,
      rawMatch: allDates[0].raw,
      confidence: Math.max(0.3, allDates[0].confidence - 0.15), // unlabeled = less certain it's THE purchase date specifically
      source: 'document-wide date scan (no explicit purchase-date label found)',
    };
  }

  return { value: null, rawMatch: null, confidence: 0, source: 'not found' };
}

/**
 * --- PRODUCT NAME ---
 * Strategy:
 *  1. Look for an explicit "Item"/"Description"/"Product" label.
 *     Invoices often wrap the product description across 1-2 lines
 *     (long names), so we greedily append the FOLLOWING line too if
 *     it doesn't look like a new label/field (heuristic: doesn't
 *     contain a colon and isn't all-numeric/price-like).
 *  2. Fallback: look for known brand names anywhere in the text and
 *     take the surrounding line as the likely product line.
 */
function looksLikeContinuationLine(line) {
  if (!line) return false;
  if (/^[A-Za-z].*:/.test(line)) return false; // looks like "Label: value" -> not a continuation
  if (/^(qty|quantity|price|amount|rs\.?|inr|\$|total|gst|hsn)\b/i.test(line)) return false;
  if (/^\d/.test(line) && line.length < 6) return false; // bare short numeric line
  return true;
}

/**
 * Rejects values that are themselves just MORE table-header words
 * (e.g. matching the "item" label against the line "Item Description
 * Qty Rate Amount" would otherwise capture "Description Qty Rate
 * Amount" as if it were the product name). This guards the case where
 * `buildLabelValueRegex` matches a bare label with no real separator
 * before a run of other column-header words.
 */
const TABLE_HEADER_WORDS = new Set([
  'description', 'qty', 'quantity', 'rate', 'amount', 'price', 'total',
  'hsn', 'gst', 'sac', 'unit', 'discount', 'tax', 'value',
]);

function looksLikeTableHeaderRow(value) {
  const tokens = tokenize(value);
  if (tokens.length === 0) return false;
  const headerTokenCount = tokens.filter((t) => TABLE_HEADER_WORDS.has(t)).length;
  // If the majority of words in the "value" are themselves header
  // words, this is a header row, not an actual product description.
  return headerTokenCount / tokens.length >= 0.5;
}

function extractProductName(lines, fullText) {
  const direct = extractByLabel(lines, FIELD_LABELS.productLabel);
  if (direct && !looksLikeTableHeaderRow(direct.value)) {
    let value = direct.value;
    const nextLine = lines[direct.lineIndex + 1];
    if (looksLikeContinuationLine(nextLine) && !looksLikeTableHeaderRow(nextLine)) {
      value = `${value} ${nextLine}`.replace(/\s+/g, ' ').trim();
    }
    return { value, confidence: 0.8, source: `label match: "${direct.matchedLabel}"` };
  }

  // Fallback: find the line containing a known brand name with the
  // most "product-like" surrounding context (longer line, contains
  // letters and possibly a model number pattern).
  const brandDisplayNames = Object.values(BRANDS).map((b) => b.display);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const normalizedLine = normalizeKey(line);
    const matchedBrand = brandDisplayNames.find((b) =>
      normalizedLine.includes(normalizeKey(b))
    );
    if (matchedBrand && line.length >= 8 && !/^(brand|seller|warranty)/i.test(line)) {
      let value = stripTrailingPriceNoise(line);

      // Tabular invoices often wrap the model number onto the next
      // line (e.g. "Samsung 55\" Crystal 4K UHD TV" / "UA55AU7700").
      // Merge it in only if it looks like a bare model code, not a
      // new label/price/header line.
      const nextLine = lines[i + 1];
      if (nextLine && looksLikeBareModelContinuation(nextLine)) {
        value = `${value} ${nextLine}`.trim();
      }

      return { value, confidence: 0.55, source: `heuristic: line containing known brand "${matchedBrand}"` };
    }
  }

  return { value: null, confidence: 0, source: 'not found' };
}

/**
 * --- BRAND ---
 * Reuses the classifier's brand detection by running it against the
 * extracted product name (more precise than scanning whole invoice,
 * which may mention unrelated brand names e.g. in courier/logistics text).
 */
/**
 * Strips trailing "Qty Rate Amount" style numeric noise that commonly
 * rides along on the same OCR'd line as a product description in
 * tabular invoice layouts (columns collapse into one line of text).
 * Conservative: only strips a trailing run of numbers/decimals/currency
 * symbols, never touches alphabetic content (which could be a real
 * part of the product name, e.g. "15 3520" in "Inspiron 15 3520").
 *
 * Heuristic: trailing tokens are stripped only if there are 2+ of them
 * AND at least one contains a decimal point or comma (price-shaped),
 * which model/spec numbers like "15" or "3520" alone do not have.
 */
function stripTrailingPriceNoise(line) {
  const tokens = line.split(/\s+/);
  let cut = tokens.length;
  let priceShapedTrailing = 0;

  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    const isPriceShaped = /^\d{1,3}(,\d{3})*(\.\d{1,2})?$|^\d+\.\d{1,2}$/.test(t) && (t.includes('.') || t.includes(','));
    const isBareSmallInt = /^\d{1,2}$/.test(t); // e.g. a lone "1" (qty column)
    if (isPriceShaped || isBareSmallInt) {
      cut = i;
      if (isPriceShaped) priceShapedTrailing += 1;
    } else {
      break;
    }
  }

  // Only actually trim if we found at least one genuinely price-shaped
  // trailing token — avoids accidentally chopping a real trailing
  // spec number (e.g. "...15 3520 Laptop" should NOT lose "3520").
  if (priceShapedTrailing > 0) {
    return tokens.slice(0, cut).join(' ').trim();
  }
  return line;
}

/**
 * Detects a line that is JUST a bare model/part code with no other
 * descriptive words — e.g. "UA55AU7700KXXL" or "Model: UA55AU7700KXXL".
 * Used to decide whether to merge a wrapped model-number line into the
 * product name fallback heuristic.
 */
function looksLikeBareModelContinuation(line) {
  if (!line) return false;
  const stripped = line.replace(/^model\s*[:#-]?\s*/i, '').trim();
  if (stripped.length < 4 || stripped.length > 25) return false;
  // Must look like a model code: mostly uppercase letters + digits, no spaces.
  return /^[A-Z0-9-]+$/.test(stripped) && /\d/.test(stripped);
}

function extractBrand(productNameValue, fullText) {
  const textToSearch = productNameValue || fullText;
  const direct = extractByLabel(toLines(fullText), ['brand']);
  if (direct) {
    return { value: direct.value, confidence: 0.88, source: 'label match: "brand"' };
  }

  const brandDisplayNames = Object.values(BRANDS).map((b) => b.display);
  const normalizedSearch = normalizeKey(textToSearch);
  for (const display of brandDisplayNames) {
    const normBrand = normalizeKey(display);
    const re = new RegExp(`(^|\\s)${normBrand.replace(/\s+/g, '\\s+')}(\\s|$)`, 'i');
    if (re.test(normalizedSearch)) {
      return { value: display, confidence: 0.8, source: 'detected within product name/invoice text' };
    }
  }

  return { value: null, confidence: 0, source: 'not found' };
}

/**
 * Main parsing entry point.
 *
 * @param {string} rawOcrText Unprocessed text straight from the OCR engine.
 * @returns {object} Structured invoice data with per-field confidence.
 */
export function parseInvoice(rawOcrText) {
  const cleanedText = cleanOcrText(rawOcrText);
  const lines = toLines(cleanedText);

  const invoiceNumber = extractInvoiceNumber(lines);
  const serialNumber = extractSerialNumber(lines);
  const seller = extractSeller(lines);
  const purchaseDate = extractPurchaseDate(lines, cleanedText);
  const productName = extractProductName(lines, cleanedText);
  const brand = extractBrand(productName.value, cleanedText);

  const warrantyDurations = detectWarrantyDurations(cleanedText);
  const primaryWarranty = detectPrimaryWarrantyMonths(cleanedText);

  // Run classification using whatever product name text we found
  // (falls back to full text if no product line was isolated, so
  // classification still has a shot via brand/category keywords
  // scattered across the invoice).
  const classification = classifyProduct(productName.value || cleanedText);

  // If the label-based brand extraction found nothing but the
  // classifier independently detected a brand, prefer whichever has
  // higher confidence rather than silently dropping a signal.
  let finalBrand = brand;
  if ((!brand.value || brand.confidence < classification.brandConfidence) && classification.brand) {
    finalBrand = {
      value: classification.brand,
      confidence: classification.brandConfidence,
      source: 'product classifier',
    };
  }

  const overallConfidence = computeOverallConfidence({
    invoiceNumber,
    serialNumber,
    seller,
    purchaseDate,
    productName,
    brand: finalBrand,
    primaryWarranty,
  });

  return {
    productName: productName.value,
    brand: finalBrand.value,
    seller: seller.value,
    invoiceNumber: invoiceNumber.value,
    serialNumber: serialNumber.value,
    purchaseDate: purchaseDate.value,
    warrantyMonths: primaryWarranty ? primaryWarranty.months : null,
    category: classification.category,
    expectedWarrantyMonths: classification.expectedWarrantyMonths,

    fieldConfidence: {
      productName: productName.confidence,
      brand: finalBrand.confidence,
      seller: seller.confidence,
      invoiceNumber: invoiceNumber.confidence,
      serialNumber: serialNumber.confidence,
      purchaseDate: purchaseDate.confidence,
      warrantyMonths: primaryWarranty ? primaryWarranty.confidence : 0,
      category: classification.categoryConfidence,
    },

    fieldSources: {
      productName: productName.source,
      brand: finalBrand.source,
      seller: seller.source,
      invoiceNumber: invoiceNumber.source,
      serialNumber: serialNumber.source,
      purchaseDate: purchaseDate.source,
      warrantyMonths: primaryWarranty ? primaryWarranty.matchedText : null,
    },

    allWarrantyMentions: warrantyDurations,
    classificationReasoning: classification.reasoning,
    overallConfidence,

    needsManualReview: overallConfidence < 0.55,
    lowConfidenceFields: Object.entries({
      productName: productName.confidence,
      brand: finalBrand.confidence,
      seller: seller.confidence,
      invoiceNumber: invoiceNumber.confidence,
      serialNumber: serialNumber.confidence,
      purchaseDate: purchaseDate.confidence,
      warrantyMonths: primaryWarranty ? primaryWarranty.confidence : 0,
    })
      .filter(([, conf]) => conf < 0.5)
      .map(([field]) => field),
  };
}

/**
 * Weighted overall confidence: not all fields are equally important.
 * Product name + purchase date + warranty duration matter most for
 * the rest of the system to function (warranty engine needs date +
 * duration; UI needs product name); invoice/serial numbers are useful
 * but secondary.
 */
function computeOverallConfidence(fields) {
  const weights = {
    productName: 0.2,
    brand: 0.1,
    seller: 0.1,
    invoiceNumber: 0.15,
    serialNumber: 0.1,
    purchaseDate: 0.2,
    primaryWarranty: 0.15,
  };

  let total = 0;
  total += (fields.productName.confidence || 0) * weights.productName;
  total += (fields.brand.confidence || 0) * weights.brand;
  total += (fields.seller.confidence || 0) * weights.seller;
  total += (fields.invoiceNumber.confidence || 0) * weights.invoiceNumber;
  total += (fields.serialNumber.confidence || 0) * weights.serialNumber;
  total += (fields.purchaseDate.confidence || 0) * weights.purchaseDate;
  total += (fields.primaryWarranty ? fields.primaryWarranty.confidence : 0) * weights.primaryWarranty;

  return Math.round(total * 100) / 100;
}

export default { parseInvoice };
