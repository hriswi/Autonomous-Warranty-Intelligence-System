/**
 * entityExtractor.js
 *
 * ENTITY EXTRACTION ENGINE
 *
 * Extracts structured entities from a natural-language warranty query.
 * No external NLP libraries — pure rule-based extraction using the
 * existing domain dictionaries (brands, categories, issue keywords).
 *
 * Extracted entities:
 *   - brands: e.g. "Dell", "Samsung", "Apple"
 *   - categories: e.g. "laptop", "TV", "refrigerator"
 *   - issueTypes: e.g. "keyboard_failure", "liquid_damage"
 *   - productRefs: raw product name fragments mentioned in the query
 *   - dateRefs: any date or time-reference expressions
 *   - warrantyKeywords: "expire", "covered", "claim", etc.
 *   - quantifiers: "all", "any", "which", "most", "next 30 days"
 */

import { normalizeKey, bestFuzzyMatch, tokenize } from '../../utils/textUtils.js';
import { BRANDS, CATEGORIES, CATEGORY_KEYWORDS } from '../../classifier/productDatabase.js';
import { ISSUE_KEYWORD_RULES } from '../../rules-engine/warrantyRulesDatabase.js';

const BRAND_DISPLAY_NAMES = Object.values(BRANDS).map((b) => b.display);
const BRAND_NORM_MAP = Object.fromEntries(
  Object.values(BRANDS).map((b) => [normalizeKey(b.display), b.display])
);

// Category alias → canonical category name
const CATEGORY_ALIASES = {
  'phone': CATEGORIES.SMARTPHONE, 'mobile': CATEGORIES.SMARTPHONE, 'iphone': CATEGORIES.SMARTPHONE,
  'cell phone': CATEGORIES.SMARTPHONE, 'handset': CATEGORIES.SMARTPHONE,
  'laptop': CATEGORIES.LAPTOP, 'notebook': CATEGORIES.LAPTOP, 'macbook': CATEGORIES.LAPTOP,
  'computer': CATEGORIES.LAPTOP,
  'tv': CATEGORIES.TELEVISION, 'television': CATEGORIES.TELEVISION, 'screen': CATEGORIES.TELEVISION,
  'telly': CATEGORIES.TELEVISION,
  'fridge': CATEGORIES.REFRIGERATOR, 'refrigerator': CATEGORIES.REFRIGERATOR,
  'ac': CATEGORIES.AIR_CONDITIONER, 'air conditioner': CATEGORIES.AIR_CONDITIONER, 'air con': CATEGORIES.AIR_CONDITIONER,
  'watch': CATEGORIES.SMARTWATCH, 'smartwatch': CATEGORIES.SMARTWATCH,
  'headphone': CATEGORIES.AUDIO_DEVICE, 'headphones': CATEGORIES.AUDIO_DEVICE,
  'earphone': CATEGORIES.AUDIO_DEVICE, 'speaker': CATEGORIES.AUDIO_DEVICE, 'earbuds': CATEGORIES.AUDIO_DEVICE,
  'console': CATEGORIES.GAMING_CONSOLE, 'playstation': CATEGORIES.GAMING_CONSOLE,
  'xbox': CATEGORIES.GAMING_CONSOLE, 'gaming console': CATEGORIES.GAMING_CONSOLE,
  'washing machine': CATEGORIES.WASHING_MACHINE, 'washer': CATEGORIES.WASHING_MACHINE,
  'tablet': CATEGORIES.TABLET, 'ipad': CATEGORIES.TABLET,
  'camera': CATEGORIES.CAMERA,
  'printer': CATEGORIES.PRINTER,
  'monitor': CATEGORIES.MONITOR,
  'keyboard': CATEGORIES.KEYBOARD_MOUSE, 'mouse': CATEGORIES.KEYBOARD_MOUSE,
  'power bank': CATEGORIES.POWER_BANK, 'charger': CATEGORIES.POWER_BANK,
  'vacuum': CATEGORIES.VACUUM_CLEANER, 'vacuum cleaner': CATEGORIES.VACUUM_CLEANER,
  'water purifier': CATEGORIES.WATER_PURIFIER, 'ro': CATEGORIES.WATER_PURIFIER,
};

// Time-range expressions → days
const TIME_RANGE_PATTERNS = [
  { pattern: /next\s+(\d+)\s+days?/i, type: 'days_ahead', extract: (m) => parseInt(m[1]) },
  { pattern: /in\s+the\s+next\s+(\d+)\s+days?/i, type: 'days_ahead', extract: (m) => parseInt(m[1]) },
  { pattern: /expiring\s+(?:in|within)\s+(\d+)\s+days?/i, type: 'days_ahead', extract: (m) => parseInt(m[1]) },
  { pattern: /next\s+(\d+)\s+months?/i, type: 'months_ahead', extract: (m) => parseInt(m[1]) * 30 },
  { pattern: /within\s+(\d+)\s+months?/i, type: 'months_ahead', extract: (m) => parseInt(m[1]) * 30 },
  { pattern: /today|this week/i, type: 'days_ahead', extract: () => 7 },
  { pattern: /this month/i, type: 'months_ahead', extract: () => 30 },
];

/**
 * Extracts all entities from a natural-language query.
 *
 * @param {string} query
 * @param {object} [context] Conversation context (may provide prior-turn entities for coreference).
 * @returns {object} Extracted entities map.
 */
export function extractEntities(query, context = {}) {
  if (!query) return buildEmptyEntities();

  const norm = normalizeKey(query);
  const tokens = tokenize(query);

  // ── BRANDS ──────────────────────────────────────────────────────────────
  const brands = [];

  // Exact multi-word brand match (e.g. "Blue Star")
  for (const [normName, display] of Object.entries(BRAND_NORM_MAP)) {
    if (normName.includes(' ') && norm.includes(normName)) {
      brands.push({ brand: display, confidence: 0.98, method: 'exact-phrase' });
    }
  }

  // Single-token exact + fuzzy match
  for (const token of tokens) {
    const normToken = normalizeKey(token);
    if (BRAND_NORM_MAP[normToken]) {
      brands.push({ brand: BRAND_NORM_MAP[normToken], confidence: 0.95, method: 'exact' });
    } else if (token.length >= 3) {
      const fuzzy = bestFuzzyMatch(token, BRAND_DISPLAY_NAMES, 0.60);
      if (fuzzy && !brands.some((b) => b.brand === fuzzy.match)) {
        brands.push({ brand: fuzzy.match, confidence: fuzzy.score, method: 'fuzzy' });
      }
    }
  }

  // Deduplicate brands
  const uniqueBrands = [];
  const seenBrands = new Set();
  for (const b of brands) {
    if (!seenBrands.has(b.brand)) {
      seenBrands.add(b.brand);
      uniqueBrands.push(b);
    }
  }

  // ── CATEGORIES ──────────────────────────────────────────────────────────
  const categories = [];
  for (const [alias, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (norm.includes(normalizeKey(alias))) {
      if (!categories.includes(canonical)) categories.push(canonical);
    }
  }

  // ── ISSUE TYPES ─────────────────────────────────────────────────────────
  const issueTypes = [];
  for (const rule of ISSUE_KEYWORD_RULES) {
    const matched = rule.keywords.filter((kw) => norm.includes(normalizeKey(kw)));
    if (matched.length > 0) {
      if (!issueTypes.find((i) => i.issueType === rule.issueType)) {
        issueTypes.push({
          issueType: rule.issueType,
          confidence: Math.min(0.97, rule.confidence + (matched.length - 1) * 0.03),
          matchedKeywords: matched,
        });
      }
    }
  }
  issueTypes.sort((a, b) => b.confidence - a.confidence);

  // ── TIME RANGES ─────────────────────────────────────────────────────────
  const timeRefs = [];
  for (const { pattern, type, extract } of TIME_RANGE_PATTERNS) {
    const m = query.match(pattern);
    if (m) timeRefs.push({ type, days: extract(m), raw: m[0] });
  }

  // ── PRODUCT REFERENCES ──────────────────────────────────────────────────
  // Extract possessive constructions: "my Dell laptop", "my Samsung TV", "the iPhone"
  const productRefPatterns = [
    /my\s+([A-Za-z0-9\s]{2,30}?)(?:\s+(?:is|has|the|that|which|warranty|invoice)|\.|,|$)/gi,
    /(?:the|this)\s+([A-Za-z0-9\s]{2,25}?)(?:\s+(?:is|has|warranty|invoice)|\.|,|$)/gi,
  ];

  const productRefs = [];
  for (const pat of productRefPatterns) {
    const matches = query.matchAll(pat);
    for (const m of matches) {
      const ref = m[1].trim();
      if (ref.length >= 3) productRefs.push(ref);
    }
  }

  // ── QUANTIFIERS ─────────────────────────────────────────────────────────
  const quantifiers = [];
  if (/\b(all|every|each)\b/i.test(query)) quantifiers.push('all');
  if (/\b(any|some)\b/i.test(query)) quantifiers.push('any');
  if (/\b(most|highest|top)\b/i.test(query)) quantifiers.push('most');
  if (/\b(which|what)\b/i.test(query)) quantifiers.push('which');
  if (/\b(compare|comparison|vs|versus)\b/i.test(query)) quantifiers.push('compare');

  // ── COREFERENCE RESOLUTION ───────────────────────────────────────────────
  // If query has pronoun reference ("it", "that product", "the device") but
  // no explicit product entities, inherit from conversation context.
  const hasExplicitProduct = uniqueBrands.length > 0 || categories.length > 0 || productRefs.length > 0;
  const hasPronounRef = /\b(it|its|that|the device|the product|this product|this device)\b/i.test(query);

  let resolvedFromContext = false;
  if (!hasExplicitProduct && hasPronounRef && context.lastBrands?.length > 0) {
    uniqueBrands.push(...context.lastBrands.map((b) => ({ ...b, method: 'context-resolved' })));
    resolvedFromContext = true;
  }
  if (!hasExplicitProduct && hasPronounRef && context.lastCategories?.length > 0) {
    categories.push(...context.lastCategories.filter((c) => !categories.includes(c)));
    resolvedFromContext = true;
  }

  return {
    brands: uniqueBrands,
    categories,
    issueTypes,
    timeRefs,
    productRefs,
    quantifiers,
    resolvedFromContext,
    // Convenience: primary extracted values
    primaryBrand: uniqueBrands[0]?.brand || null,
    primaryCategory: categories[0] || null,
    primaryIssueType: issueTypes[0]?.issueType || null,
    primaryTimeRangeDays: timeRefs[0]?.days || null,
  };
}

function buildEmptyEntities() {
  return {
    brands: [], categories: [], issueTypes: [], timeRefs: [],
    productRefs: [], quantifiers: [], resolvedFromContext: false,
    primaryBrand: null, primaryCategory: null,
    primaryIssueType: null, primaryTimeRangeDays: null,
  };
}

export default { extractEntities, CATEGORY_ALIASES };
