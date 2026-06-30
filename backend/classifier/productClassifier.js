/**
 * productClassifier.js
 *
 * SMART PRODUCT CLASSIFICATION ENGINE
 *
 * Classifies a free-text product description (e.g. "Sony WH-1000XM5
 * Wireless Industry Leading Noise Cancelling Headphones") into:
 *   - a canonical category (Audio Device, Laptop, Smartphone, ...)
 *   - a detected brand
 *   - the expected/standard warranty length for that category
 *
 * Method: 100% local, rule-based scoring. No ML model, no network call.
 *   1. Check high-confidence MODEL_PATTERNS regexes (e.g. "iPhone 15 Pro")
 *      — these alone can resolve brand+category with high confidence.
 *   2. Score every category using CATEGORY_KEYWORDS keyword hits
 *      (weighted sum), normalized by text length.
 *   3. Detect brand via direct dictionary lookup, then fall back to
 *      fuzzy matching (handles OCR noise like "Sannsung").
 *   4. Cross-validate: if detected brand strongly implies a category
 *      and the keyword-based category is ambiguous/low-confidence,
 *      use the brand's most likely category as a tiebreaker.
 */

import { CATEGORIES, EXPECTED_WARRANTY_MONTHS, BRANDS, CATEGORY_KEYWORDS, MODEL_PATTERNS, findBrandByText } from './productDatabase.js';
import { normalizeKey, bestFuzzyMatch, tokenize } from '../utils/textUtils.js';

/**
 * Scores every category against the input text using weighted keyword
 * hits. Returns an array of { category, score } sorted descending.
 */
function scoreCategoriesByKeywords(text) {
  const normalized = normalizeKey(text);
  const scores = [];

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    let hits = 0;
    for (const { kw, weight } of keywords) {
      // Word-boundary-ish match: keyword surrounded by spaces or string edges.
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
      if (re.test(normalized)) {
        score += weight;
        hits += 1;
      }
    }
    if (score > 0) {
      scores.push({ category, score, hits });
    }
  }

  return scores.sort((a, b) => b.score - a.score);
}

/**
 * Checks high-confidence model regex patterns (MODEL_PATTERNS).
 * Returns the first/strongest match, or null.
 */
function matchModelPatterns(text) {
  const matches = [];
  for (const entry of MODEL_PATTERNS) {
    const m = text.match(entry.pattern);
    if (m) {
      matches.push({ ...entry, matchedText: m[0] });
    }
  }
  if (matches.length === 0) return null;
  // Prefer the longest matched text (more specific match wins,
  // e.g. "iPhone 15 Pro Max" over a hypothetical shorter overlapping pattern).
  matches.sort((a, b) => b.matchedText.length - a.matchedText.length);
  return matches[0];
}

/**
 * Attempts to detect a brand mentioned in the text, first via exact
 * token match against known brand keys/display names, then via fuzzy
 * matching to tolerate OCR noise.
 */
function detectBrand(text) {
  const tokens = tokenize(text);
  const brandEntries = Object.entries(BRANDS);

  // Multi-word brand display names need a different check (e.g. "Blue Star").
  const normalizedFull = normalizeKey(text);
  for (const [key, brand] of brandEntries) {
    const brandNorm = normalizeKey(brand.display);
    if (brandNorm.includes(' ') && normalizedFull.includes(brandNorm)) {
      return { key, ...brand, confidence: 0.98, method: 'exact-phrase' };
    }
  }

  // Exact single-token match (most common case: "Sony", "Dell", "LG").
  for (const token of tokens) {
    const direct = brandEntries.find(
      ([key, brand]) => key === token || normalizeKey(brand.display) === token
    );
    if (direct) {
      return { key: direct[0], ...direct[1], confidence: 0.95, method: 'exact-token' };
    }
  }

  // Fuzzy fallback: try each token against the brand dictionary to catch
  // OCR misspellings ("Sannsung" -> "Samsung", "S0ny" -> "Sony").
  const brandDisplayNames = brandEntries.map(([, b]) => b.display);
  for (const token of tokens) {
    if (token.length < 3) continue; // avoid noisy short-token false matches
    const fuzzy = bestFuzzyMatch(token, brandDisplayNames, 0.60);
    if (fuzzy) {
      const found = brandEntries.find(([, b]) => b.display === fuzzy.match);
      if (found) {
        return { key: found[0], ...found[1], confidence: Math.round(fuzzy.score * 100) / 100, method: 'fuzzy' };
      }
    }
  }

  return null;
}

/**
 * Main classification entry point.
 *
 * @param {string} productText Free-text product name/description, e.g.
 *   "Sony WH-1000XM5 Wireless Industry Leading Noise Cancelling Headphones"
 * @returns {{
 *   category: string,
 *   categoryConfidence: number,
 *   brand: string|null,
 *   brandConfidence: number,
 *   expectedWarrantyMonths: number,
 *   matchedKeywords: string[],
 *   reasoning: string[],
 * }}
 */
export function classifyProduct(productText) {
  const reasoning = [];

  if (!productText || typeof productText !== 'string' || !productText.trim()) {
    return {
      category: CATEGORIES.OTHER_ELECTRONICS,
      categoryConfidence: 0,
      brand: null,
      brandConfidence: 0,
      expectedWarrantyMonths: EXPECTED_WARRANTY_MONTHS[CATEGORIES.OTHER_ELECTRONICS],
      matchedKeywords: [],
      reasoning: ['No product text provided; defaulted to Other Electronics.'],
    };
  }

  // Step 1: high-confidence model pattern match.
  const modelMatch = matchModelPatterns(productText);
  if (modelMatch) {
    reasoning.push(
      `Matched known model pattern "${modelMatch.matchedText}" which strongly implies category=${modelMatch.category}` +
        (modelMatch.brandKey ? ` and brand=${BRANDS[modelMatch.brandKey].display}.` : '.')
    );
  }

  // Step 2: keyword-based category scoring.
  const keywordScores = scoreCategoriesByKeywords(productText);
  if (keywordScores.length > 0) {
    reasoning.push(
      `Keyword scoring top candidates: ${keywordScores
        .slice(0, 3)
        .map((s) => `${s.category} (score ${s.score}, ${s.hits} keyword hit${s.hits === 1 ? '' : 's'})`)
        .join(', ')}.`
    );
  } else {
    reasoning.push('No category keywords matched in the product text.');
  }

  // Step 3: brand detection.
  const brandMatch = detectBrand(productText);
  if (brandMatch) {
    reasoning.push(
      `Detected brand "${brandMatch.display}" via ${brandMatch.method} match (confidence ${brandMatch.confidence}).`
    );
  } else {
    reasoning.push('No known brand detected in product text.');
  }

  // --- Resolve final category ---
  let finalCategory;
  let categoryConfidence;

  if (modelMatch) {
    // Model pattern is the strongest possible signal.
    finalCategory = modelMatch.category;
    categoryConfidence = 0.97;
  } else if (keywordScores.length > 0) {
    const top = keywordScores[0];
    const second = keywordScores[1];

    // If the brand's known categories overlap with the top keyword
    // category, boost confidence (cross-validation).
    let boosted = top.score;
    if (brandMatch && brandMatch.categories.includes(top.category)) {
      boosted += 3;
      reasoning.push(
        `Brand "${brandMatch.display}" is known to sell ${top.category}; boosting confidence for that category.`
      );
    }

    finalCategory = top.category;
    // Confidence scales with score magnitude and the margin over the
    // second-best candidate (a clear winner = higher confidence).
    const margin = second ? top.score - second.score : top.score;
    categoryConfidence = Math.min(0.95, 0.5 + Math.min(boosted, 20) / 40 + Math.min(margin, 10) / 50);
  } else if (brandMatch && brandMatch.categories.length > 0) {
    // No keyword signal at all — fall back entirely to brand's most
    // likely category (first entry = most common for that brand).
    finalCategory = brandMatch.categories[0];
    categoryConfidence = 0.4;
    reasoning.push(
      `Falling back to brand's most common category ("${finalCategory}") due to no keyword matches.`
    );
  } else {
    finalCategory = CATEGORIES.OTHER_ELECTRONICS;
    categoryConfidence = 0.15;
    reasoning.push('Could not confidently classify; defaulted to Other Electronics.');
  }

  // --- Resolve final brand ---
  let finalBrand = null;
  let brandConfidence = 0;
  if (brandMatch) {
    finalBrand = brandMatch.display;
    brandConfidence = brandMatch.confidence;
  } else if (modelMatch && modelMatch.brandKey) {
    finalBrand = BRANDS[modelMatch.brandKey].display;
    brandConfidence = 0.9;
  }

  const expectedWarrantyMonths = EXPECTED_WARRANTY_MONTHS[finalCategory] ?? 12;

  const matchedKeywords = keywordScores.length
    ? CATEGORY_KEYWORDS[keywordScores[0].category]
        .filter((entry) => {
          const escaped = entry.kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const re = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
          return re.test(normalizeKey(productText));
        })
        .map((entry) => entry.kw)
    : [];

  return {
    category: finalCategory,
    categoryConfidence: Math.round(categoryConfidence * 100) / 100,
    brand: finalBrand,
    brandConfidence: Math.round(brandConfidence * 100) / 100,
    expectedWarrantyMonths,
    matchedKeywords,
    reasoning,
  };
}

/**
 * Flags whether a stated warranty duration (in months) looks unusual
 * for the given category — e.g. a 3-month warranty on a refrigerator
 * (normally 12+) might indicate a misread invoice or a third-party
 * seller's reduced warranty, worth surfacing to the user.
 */
export function isWarrantyDurationUnusual(category, statedMonths) {
  const expected = EXPECTED_WARRANTY_MONTHS[category];
  if (!expected || !statedMonths) return { unusual: false };

  const ratio = statedMonths / expected;
  if (ratio < 0.5) {
    return {
      unusual: true,
      direction: 'shorter',
      message: `${statedMonths} months is notably shorter than the typical ${expected}-month warranty for ${category}.`,
    };
  }
  if (ratio > 3) {
    return {
      unusual: true,
      direction: 'longer',
      message: `${statedMonths} months is notably longer than the typical ${expected}-month warranty for ${category} — double-check this is correct (could include an extended warranty add-on).`,
    };
  }
  return { unusual: false };
}

export default { classifyProduct, isWarrantyDurationUnusual };
