/**
 * dateUtils.js
 *
 * Date parsing and arithmetic utilities for the warranty engine.
 *
 * Invoices use wildly inconsistent date formats depending on region,
 * platform (Amazon, Flipkart, local retailer), and OCR misreads of
 * separators. This module centralizes ALL date parsing so the rest
 * of the system only ever deals with real JS Date objects or ISO strings.
 */

const MONTH_NAMES = {
  jan: 0, january: 0,
  feb: 1, february: 1,
  mar: 2, march: 2,
  apr: 3, april: 3,
  may: 4,
  jun: 5, june: 5,
  jul: 6, july: 6,
  aug: 7, august: 7,
  sep: 8, sept: 8, september: 8,
  oct: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, december: 11,
};

/**
 * Returns true if a (year, month, day) triple is a real calendar date.
 * Guards against OCR producing "31/02/2024" or similar impossible dates.
 */
function isRealDate(year, monthIndex, day) {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex) ||
    !Number.isInteger(day)
  ) {
    return false;
  }
  if (monthIndex < 0 || monthIndex > 11) return false;
  if (day < 1 || day > 31) return false;

  const d = new Date(year, monthIndex, day);
  return (
    d.getFullYear() === year &&
    d.getMonth() === monthIndex &&
    d.getDate() === day
  );
}

function toFullYear(yy) {
  // Heuristic: 2-digit years 00-49 => 2000-2049, 50-99 => 1950-1999.
  // Reasonable for consumer electronics invoices (no purchases pre-1950).
  if (yy >= 0 && yy <= 49) return 2000 + yy;
  if (yy >= 50 && yy <= 99) return 1900 + yy;
  return yy;
}

/**
 * Attempts to parse a single date-like string into a normalized
 * { date: Date, iso: string, raw: string, confidence: number } object.
 * Returns null if the string cannot be confidently parsed as a date.
 *
 * Supports:
 *  - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 *  - MM/DD/YYYY (disambiguated when day > 12)
 *  - YYYY-MM-DD (ISO)
 *  - "12 March 2024", "March 12, 2024", "12th March 2024"
 *  - 2-digit years
 */
export function parseDateString(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();

  // --- ISO format: YYYY-MM-DD ---
  let m = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    if (isRealDate(year, month, day)) {
      return buildResult(year, month, day, raw, 0.95);
    }
  }

  // --- Numeric with separators: D/M/Y or M/D/Y, 2 or 4 digit year ---
  m = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    let [a, b, y] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
    const year = y < 100 ? toFullYear(y) : y;

    // If first number > 12, it MUST be a day -> DD/MM/YYYY
    if (a > 12 && b <= 12) {
      if (isRealDate(year, b - 1, a)) return buildResult(year, b - 1, a, raw, 0.9);
    }
    // If second number > 12, it MUST be a day -> MM/DD/YYYY
    if (b > 12 && a <= 12) {
      if (isRealDate(year, a - 1, b)) return buildResult(year, a - 1, b, raw, 0.9);
    }
    // Ambiguous (both <= 12): default to DD/MM/YYYY since this engine
    // targets primarily Indian-market invoices (day-first convention),
    // but flag with slightly lower confidence due to ambiguity.
    if (a <= 12 && b <= 12) {
      if (isRealDate(year, b - 1, a)) return buildResult(year, b - 1, a, raw, 0.6);
    }
  }

  // --- Textual month formats: "12 March 2024", "March 12, 2024", "12th March 2024" ---
  const monthPattern = Object.keys(MONTH_NAMES).join('|');

  m = raw.match(
    new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?,?\\s+(\\d{4})$`, 'i')
  );
  if (m) {
    const day = parseInt(m[1], 10);
    const month = MONTH_NAMES[m[2].toLowerCase()];
    const year = parseInt(m[3], 10);
    if (isRealDate(year, month, day)) return buildResult(year, month, day, raw, 0.92);
  }

  m = raw.match(
    new RegExp(`^(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})$`, 'i')
  );
  if (m) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (isRealDate(year, month, day)) return buildResult(year, month, day, raw, 0.92);
  }

  // "Mar 2024" style (month + year only, no day) -> default to 1st of month.
  m = raw.match(new RegExp(`^(${monthPattern})\\.?,?\\s+(\\d{4})$`, 'i'));
  if (m) {
    const month = MONTH_NAMES[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (isRealDate(year, month, 1)) return buildResult(year, month, 1, raw, 0.5);
  }

  return null;
}

function buildResult(year, monthIndex, day, raw, confidence) {
  const date = new Date(year, monthIndex, day);
  return {
    date,
    iso: toISODateOnly(date),
    raw,
    confidence,
  };
}

export function toISODateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Corrects common OCR character-confusion errors WITHIN an already
 * date-shaped substring only (never applied to general text, to avoid
 * corrupting unrelated words). Tesseract frequently misreads:
 *   '0' <-> 'o'/'O'   '1' <-> 'l'/'I'   '5' <-> 'S'   '8' <-> 'B'
 * This is safe here because by the time this runs, a separator-based
 * date pattern has already matched the substring's shape (digits +
 * separators), so any letters present are almost certainly digit
 * misreads rather than intentional text.
 */
function fixOcrDateNoise(candidate) {
  return candidate
    .replace(/[oO]/g, '0')
    .replace(/[lI]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8');
}

/**
 * Scans free-form text for ALL date-like substrings and returns parsed
 * candidates sorted by confidence (descending). Used when we don't yet
 * know which line of an invoice contains the purchase date.
 *
 * Includes a lenient pass that tolerates OCR letter/digit confusion
 * (e.g. "12/o6/2022" where Tesseract misread a zero as the letter "o").
 */
export function findAllDates(text) {
  if (!text) return [];
  const candidates = [];

  const datePatterns = [
    /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g,
    /\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/g,
    /\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4}/gi,
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi,
  ];

  // Lenient pattern: same numeric shape as the strict D/M/Y pattern above,
  // but allows a SINGLE stray letter (o/O/l/I/s/S/b/B) in place of any one
  // digit, to catch common OCR misreads without matching arbitrary text.
  const lenientNumericPattern = /\b[\dlIoOsSbB]{1,2}[-/.][\dlIoOsSbB]{1,2}[-/.][\dlIoOsSbB]{2,4}\b/g;

  for (const pattern of datePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const parsed = parseDateString(match[0]);
      if (parsed) {
        candidates.push({ ...parsed, index: match.index });
      }
    }
  }

  // Second pass: lenient OCR-noise-tolerant numeric dates. Only add a
  // candidate here if it wasn't already found by the strict pass above
  // (avoids double-processing clean dates) AND it actually contains at
  // least one letter (otherwise it's identical to the strict pattern).
  const lenientMatches = text.matchAll(lenientNumericPattern);
  for (const match of lenientMatches) {
    if (!/[a-zA-Z]/.test(match[0])) continue; // no noise to fix, strict pass already covered it
    const fixed = fixOcrDateNoise(match[0]);
    const parsed = parseDateString(fixed);
    if (parsed) {
      // Lower confidence than a clean match since we had to guess-correct characters.
      candidates.push({ ...parsed, raw: match[0], confidence: parsed.confidence * 0.75, index: match.index });
    }
  }

  // De-duplicate by ISO date (keep highest confidence instance).
  const byIso = new Map();
  for (const c of candidates) {
    const existing = byIso.get(c.iso);
    if (!existing || c.confidence > existing.confidence) {
      byIso.set(c.iso, c);
    }
  }

  return [...byIso.values()].sort((a, b) => b.confidence - a.confidence);
}

/**
 * Adds a duration (in months) to a date, returning a new Date.
 * Correctly handles month-end overflow (e.g. Jan 31 + 1 month -> Feb 28/29).
 */
export function addMonths(date, months) {
  const d = new Date(date.getTime());
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, 1);
  const daysInTargetMonth = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(d.getDate(), daysInTargetMonth));
  return result;
}

/**
 * Whole-day difference between two dates (b - a), ignoring time-of-day.
 */
export function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const aMid = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const bMid = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bMid.getTime() - aMid.getTime()) / msPerDay);
}

/**
 * Rejects obviously impossible purchase dates:
 *  - in the future
 *  - more than `maxYearsAgo` years in the past (likely OCR misread of year)
 */
export function isPlausiblePurchaseDate(date, referenceDate = new Date(), maxYearsAgo = 25) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;
  if (date.getTime() > referenceDate.getTime()) return false;
  const earliestPlausible = new Date(referenceDate);
  earliestPlausible.setFullYear(referenceDate.getFullYear() - maxYearsAgo);
  if (date.getTime() < earliestPlausible.getTime()) return false;
  return true;
}

export default {
  parseDateString,
  toISODateOnly,
  findAllDates,
  addMonths,
  daysBetween,
  isPlausiblePurchaseDate,
};
