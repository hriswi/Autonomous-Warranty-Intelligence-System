/**
 * textUtils.js
 *
 * Low-level, dependency-free string utilities used throughout the
 * Smart Warranty Intelligence Engine. These are intentionally generic
 * (no domain knowledge of "warranty" or "invoice" here) so they can be
 * unit-tested in isolation and reused by every higher-level module.
 */

/**
 * Normalizes raw OCR output into a predictable, line-oriented string.
 * Tesseract output is noisy: inconsistent whitespace, stray control
 * characters, mixed line endings, and OCR misreads of common symbols
 * (e.g. "l" vs "1", smart quotes, multiple spaces from column gaps).
 *
 * This function performs SAFE, non-destructive normalization only.
 * It must never invent or remove semantic content, only standardize
 * formatting so downstream regexes behave deterministically.
 */
export function cleanOcrText(rawText) {
  if (typeof rawText !== 'string') return '';

  let text = rawText;

  // Normalize line endings (\r\n, \r -> \n)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Replace non-breaking spaces and other unicode whitespace with normal space
  text = text.replace(/[\u00A0\u2007\u202F]/g, ' ');

  // Normalize "smart quotes" / typographic punctuation to ASCII equivalents.
  // OCR engines frequently emit these for stylized invoice fonts.
  text = text
    .replace(/[\u2018\u2019\u02BC]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...');

  // Collapse runs of horizontal whitespace (spaces/tabs) but preserve newlines,
  // since line structure carries real meaning for invoices (label: value per line).
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n');

  // Collapse 3+ consecutive blank lines down to a single blank line.
  text = text.replace(/\n{3,}/g, '\n\n');

  // Strip non-printable / control characters that sometimes leak from OCR engines.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  return text.trim();
}

/**
 * Splits cleaned text into non-empty lines, trimmed.
 */
export function toLines(text) {
  return cleanOcrText(text)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Case/diacritic/punctuation-insensitive comparison key.
 * Used for keyword/dictionary lookups where exact casing or
 * punctuation in OCR output is unreliable.
 */
export function normalizeKey(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Levenshtein edit distance between two strings.
 * Used for fuzzy matching brand/product names against known
 * dictionaries when OCR introduces small character errors
 * (e.g. "Sannsung" instead of "Samsung").
 */
export function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;

  // Use a single rolling array for O(min(al,bl)) memory.
  let prevRow = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prevRow[j] = j;

  for (let i = 1; i <= al; i++) {
    const currRow = new Array(bl + 1);
    currRow[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1, // deletion
        currRow[j - 1] + 1, // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    prevRow = currRow;
  }
  return prevRow[bl];
}

/**
 * Normalized string similarity in [0, 1], 1 = identical.
 * 1 - (editDistance / maxLength)
 */
export function similarity(a, b) {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - dist / maxLen;
}

/**
 * Tokenizes a string into normalized word tokens, filtering out
 * tokens that are pure punctuation or empty.
 */
export function tokenize(str) {
  return normalizeKey(str)
    .split(' ')
    .filter((t) => t.length > 0);
}

/**
 * Token-set overlap score (Jaccard-like) between two strings.
 * More robust than raw edit distance for multi-word product names
 * where word ORDER may differ ("Inspiron Dell 15" vs "Dell Inspiron 15").
 */
export function tokenOverlapScore(a, b) {
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) {
    if (tb.has(t)) intersection += 1;
  }
  const union = new Set([...ta, ...tb]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Finds the best fuzzy match for `query` within a list of candidate
 * strings, returning { match, score } or null if nothing clears
 * the minimum threshold.
 *
 * Combines edit-distance similarity with token overlap so it tolerates
 * both character-level OCR noise and word-order/extra-word differences.
 */
export function bestFuzzyMatch(query, candidates, minScore = 0.55) {
  if (!query || !Array.isArray(candidates) || candidates.length === 0) return null;

  let best = null;
  const queryTokens = tokenize(query);
  const isSingleToken = queryTokens.length <= 1;

  for (const candidate of candidates) {
    const editScore = similarity(query, candidate);
    const overlapScore = tokenOverlapScore(query, candidate);
    // For single-token strings (e.g. brand names), token overlap is 0 whenever
    // the tokens don't exactly match — even with just 1 OCR character difference.
    // In that case, rely more heavily on edit-distance similarity.
    const combined = isSingleToken
      ? editScore * 0.8 + overlapScore * 0.2
      : editScore * 0.45 + overlapScore * 0.55;
    if (!best || combined > best.score) {
      best = { match: candidate, score: combined };
    }
  }

  return best && best.score >= minScore ? best : null;
}

/**
 * Extracts the substring of `text` near a given match index, useful
 * for showing "context windows" around a regex hit (e.g. for debugging
 * or for secondary heuristic passes that look at surrounding words).
 */
export function contextWindow(text, index, radius = 40) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.slice(start, end);
}

export default {
  cleanOcrText,
  toLines,
  normalizeKey,
  levenshtein,
  similarity,
  tokenize,
  tokenOverlapScore,
  bestFuzzyMatch,
  contextWindow,
};
