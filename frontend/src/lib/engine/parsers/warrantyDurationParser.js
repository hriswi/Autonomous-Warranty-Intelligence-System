/**
 * warrantyDurationParser.js
 *
 * WARRANTY DURATION DETECTION ENGINE
 *
 * Detects the warranty period stated in invoice/warranty-card text.
 * Real invoices phrase this many different ways:
 *   "Limited Warranty Coverage 24 Months"
 *   "1 Year Manufacturer Warranty"
 *   "Warranty: 12 months from date of purchase"
 *   "Standard Warranty: 1 Year on Panel and Parts"
 *   "warranted... for a period of ONE YEAR"
 *   "2 yrs warranty"
 *
 * Strategy: a prioritized list of regex patterns, each producing a
 * duration-in-months value plus a confidence score and the matched
 * snippet (for transparency/debugging and so the UI can show the
 * user exactly which sentence the number came from).
 *
 * Also detects MULTIPLE warranty terms on one invoice (e.g. "1 year
 * warranty on product, 10 years on compressor") since appliances like
 * ACs/fridges commonly have split coverage — the engine returns all
 * detected terms and lets the caller decide which is "primary".
 */

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, eighteen: 18,
  twenty: 20, twentyfour: 24, thirty: 30,
};

function wordToNumber(word) {
  const key = word.toLowerCase().replace(/[\s-]/g, '');
  return WORD_NUMBERS[key] ?? null;
}

/**
 * Each pattern's capture groups feed into a `toMonths` function so we
 * can support both numeric ("24 Months") and word-based ("ONE YEAR")
 * phrasing without duplicating pattern logic.
 */
const DURATION_PATTERNS = [
  // "1.5 years" / "1.5yr" — MUST come before numeric_years to avoid
  // the integer part of "1.5" being matched as "1 year" by the next pattern.
  {
    name: 'decimal_years',
    regex: /\b(\d{1,2}\.\d)\s*(?:years?|yrs?\.?)\b/gi,
    toMonths: (m) => Math.round(parseFloat(m[1]) * 12),
    baseConfidence: 0.9,
  },
  // "24 months", "24 month", "24mo"
  {
    name: 'numeric_months',
    regex: /\b(\d{1,3})\s*(?:months?|mos?\.?)\b/gi,
    toMonths: (m) => parseInt(m[1], 10),
    baseConfidence: 0.9,
  },
  // "2 years", "2 yr", "2yrs" — negative lookbehind prevents matching
  // the digit after a decimal point (e.g. the "5" in "1.5 years").
  {
    name: 'numeric_years',
    regex: /(?<!\.\d*)(?<!\d\.)\b(\d{1,2})\s*(?:years?|yrs?\.?)\b/gi,
    toMonths: (m) => parseInt(m[1], 10) * 12,
    baseConfidence: 0.9,
  },
  // "ONE YEAR", "two years", "TWELVE MONTHS" (word numbers)
  {
    name: 'word_years',
    regex: /\b(one|two|three|four|five|six|seven|eight|nine|ten)\s+years?\b/gi,
    toMonths: (m) => wordToNumber(m[1]) * 12,
    baseConfidence: 0.85,
  },
  {
    name: 'word_months',
    regex: /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|eighteen|twenty|thirty)\s+months?\b/gi,
    toMonths: (m) => wordToNumber(m[1]),
    baseConfidence: 0.85,
  },
];

/**
 * Context keywords that, when found near a duration match, indicate
 * it IS describing a warranty period (as opposed to e.g. a loan term,
 * EMI tenure, or delivery estimate which can also contain "X months").
 */
const POSITIVE_CONTEXT_KEYWORDS = [
  'warranty', 'warranted', 'guarantee', 'guaranteed', 'coverage',
  'covered', 'service period', 'replacement period',
];

/**
 * Context keywords that suggest the matched duration is NOT about
 * warranty (reduces confidence / can disqualify a match entirely).
 */
const NEGATIVE_CONTEXT_KEYWORDS = [
  'emi', 'installment', 'instalment', 'loan tenure', 'delivery',
  'shipping', 'subscription', 'return policy', 'exchange period',
  'cashback', 'no cost emi',
];

// Wider window for detecting warranty-intent keywords: legal warranty
// clauses are often long single sentences ("This product is warranted
// against defects... for a period of ONE YEAR from..."), so the keyword
// establishing context can sit much further from the actual number than
// a tight window would catch.
const CONTEXT_WINDOW_CHARS = 60;
const INTENT_CONTEXT_WINDOW_CHARS = 120;

/**
 * Special-component coverage detection (compressor/panel/motor are
 * common appliance parts with EXTENDED coverage beyond the standard
 * product warranty — important to surface separately since it changes
 * what an "out of warranty" claim actually means for that part).
 *
 * IMPORTANT DISAMBIGUATION: phrases like "1 year on panel and parts" or
 * "covers parts and labour" are describing STANDARD whole-product
 * coverage (a generic legal phrase), NOT an isolated extended warranty
 * on that one component. A genuine component-specific extended term
 * looks more like "10 years on compressor only" or "additional 5 year
 * compressor warranty". We only flag `component` when the surrounding
 * text does NOT also contain one of these generic "and parts"/"and
 * labour" coverage phrases, which indicate the whole product is covered,
 * not just the named part.
 */
const COMPONENT_KEYWORDS = [
  { kw: 'compressor', component: 'Compressor' },
  { kw: 'motor', component: 'Motor' },
  { kw: 'panel', component: 'Display Panel' },
  { kw: 'display', component: 'Display Panel' },
  { kw: 'battery', component: 'Battery' },
];

const GENERIC_FULL_COVERAGE_PHRASES = [
  'and parts', 'and labour', 'and labor', 'parts and service',
  'parts & labour', 'parts & labor', 'parts and service',
];

function getContextWindow(text, index, length, radius = CONTEXT_WINDOW_CHARS) {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return text.slice(start, end).toLowerCase();
}

function scoreContext(context) {
  let score = 0;
  let matchedPositive = [];
  let matchedNegative = [];

  for (const kw of POSITIVE_CONTEXT_KEYWORDS) {
    if (context.includes(kw)) {
      score += 1;
      matchedPositive.push(kw);
    }
  }
  for (const kw of NEGATIVE_CONTEXT_KEYWORDS) {
    if (context.includes(kw)) {
      score -= 2;
      matchedNegative.push(kw);
    }
  }

  return { score, matchedPositive, matchedNegative };
}

function detectComponent(text, matchIndex, matchLength) {
  const before = text.slice(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
  const after = text.slice(matchIndex + matchLength, Math.min(text.length, matchIndex + matchLength + 50)).toLowerCase();
  const vicinity = before + ' ' + after;

  // Generic full-coverage phrasing suppresses component detection.
  const isGenericFullCoverage = GENERIC_FULL_COVERAGE_PHRASES.some((phrase) =>
    vicinity.includes(phrase)
  );
  if (isGenericFullCoverage) return null;

  for (const { kw, component } of COMPONENT_KEYWORDS) {
    if (!vicinity.includes(kw)) continue;

    // Guard: if the component keyword appears AFTER this match AND is itself
    // followed by another duration pattern (e.g. "1 year. Compressor warranty 5 years"),
    // the component keyword introduces the NEXT duration, not this one.
    // Detect this by checking if the after-context contains "[component kw]...N year/month".
    const afterIdx = after.indexOf(kw);
    if (afterIdx !== -1) {
      const afterKw = after.slice(afterIdx + kw.length);
      // If more duration digits follow the component keyword in the after-context,
      // this component keyword is the subject of a subsequent duration, not this one.
      if (/\d+\s*(?:years?|months?|yrs?)/.test(afterKw)) continue;
    }

    return component;
  }
  return null;
}

/**
 * Scans full invoice text for all warranty-duration mentions.
 *
 * @param {string} text Cleaned invoice text.
 * @returns {Array<{
 *   months: number,
 *   matchedText: string,
 *   confidence: number,
 *   component: string|null, // e.g. "Compressor" for split-coverage appliances
 *   isPrimary: boolean,
 * }>} sorted with the most likely PRIMARY (whole-product) warranty first.
 */
export function detectWarrantyDurations(text) {
  if (!text || typeof text !== 'string') return [];

  const results = [];

  for (const patternDef of DURATION_PATTERNS) {
    const matches = text.matchAll(patternDef.regex);
    for (const match of matches) {
      const months = patternDef.toMonths(match);
      if (!months || months <= 0 || months > 240) continue; // sanity bound: ignore >20yr "warranties" (likely false positive)

      const intentContext = getContextWindow(text, match.index, match[0].length, INTENT_CONTEXT_WINDOW_CHARS);
      const { score: contextScore, matchedPositive, matchedNegative } = scoreContext(intentContext);

      // Discard matches with strong negative context and no positive
      // context at all (e.g. "12 months EMI" with no "warranty" nearby).
      if (contextScore < 0 && matchedPositive.length === 0) continue;

      // Without ANY positive warranty-related keyword nearby, treat as
      // low-confidence speculative match rather than discarding outright
      // (some invoices state duration right after "Coverage:" without
      // repeating the word "warranty" again in the same sentence).
      const hasPositiveContext = matchedPositive.length > 0;
      let confidence = patternDef.baseConfidence;
      if (hasPositiveContext) {
        confidence = Math.min(0.98, confidence + 0.05 * matchedPositive.length);
      } else {
        confidence -= 0.35;
      }
      confidence += contextScore * 0.02;
      confidence = Math.max(0.05, Math.min(0.98, confidence));

      const component = detectComponent(text, match.index, match[0].length);

      results.push({
        months,
        matchedText: match[0],
        contextSnippet: intentContext.trim(),
        confidence: Math.round(confidence * 100) / 100,
        component,
        index: match.index,
      });
    }
  }

  // De-duplicate near-identical matches (same months value, overlapping index)
  // that multiple patterns might both catch (e.g. "24 months" matched by both
  // a generic and a more specific pattern).
  const deduped = [];
  for (const r of results) {
    const isDuplicate = deduped.some(
      (d) => Math.abs(d.index - r.index) < 5 && d.months === r.months
    );
    if (!isDuplicate) deduped.push(r);
  }

  // Sort: component-specific coverage (compressor etc.) goes AFTER
  // whole-product coverage in priority, since "primary" warranty is
  // what most users care about for general claims. Among whole-product
  // matches, highest confidence first.
  deduped.sort((a, b) => {
    if (!a.component && b.component) return -1;
    if (a.component && !b.component) return 1;
    return b.confidence - a.confidence;
  });

  return deduped.map((r, i) => ({ ...r, isPrimary: i === 0 && !r.component }));
}

/**
 * Convenience wrapper: returns just the single best-guess primary
 * warranty duration in months, or null if nothing was confidently detected.
 */
export function detectPrimaryWarrantyMonths(text, minConfidence = 0.4) {
  const all = detectWarrantyDurations(text);
  const primaryCandidates = all.filter((r) => !r.component && r.confidence >= minConfidence);
  if (primaryCandidates.length === 0) return null;
  return primaryCandidates[0];
}

export default { detectWarrantyDurations, detectPrimaryWarrantyMonths };
