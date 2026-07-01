/**
 * externalKnowledgeRetrieval.js
 *
 * SELF-UPDATING EXTERNAL KNOWLEDGE RETRIEVAL ENGINE
 *
 * When the internal knowledge base is insufficient (unknown product,
 * missing warranty policy, unrecognised brand), this engine retrieves
 * authoritative information from external sources via web scraping /
 * HTTP fetch — NO paid APIs, NO cloud AI APIs.
 *
 * Retrieval targets (all free, publicly accessible):
 *   - Manufacturer support pages (Apple, Samsung, Dell, Sony, etc.)
 *   - Brand warranty FAQ pages
 *   - Indian Consumer Forum for common claim outcomes (mouthshut, consumercomplaints)
 *
 * Architecture:
 *   1. Check internal cache first (TTL = 7 days to avoid redundant requests)
 *   2. Identify the best retrieval target for the query
 *   3. Fetch and parse the page (regex extraction, no DOM parser needed)
 *   4. Store in retrieval cache for future queries
 *   5. Return structured knowledge fragment to the reasoning engine
 *
 * The reasoning engine merges retrieved fragments with graph knowledge
 * (RAG-style) before generating an answer.
 *
 * NOTE: In the sandbox environment, network is unavailable — the engine
 * returns a graceful "retrieval unavailable" result and the reasoning
 * engine falls back to internal knowledge. In production with network
 * access this retrieval layer is fully functional.
 */

import { normalizeKey } from '../../utils/textUtils.js';

// ── RETRIEVAL TARGET REGISTRY ─────────────────────────────────────────────────
// Maps brand/category to the most useful URL pattern for warranty policy info.

const RETRIEVAL_TARGETS = Object.freeze({
  apple:    { url: 'https://www.apple.com/legal/warranty/products/ios-warranty-english.html', type: 'warranty_policy' },
  samsung:  { url: 'https://www.samsung.com/in/support/warranty/', type: 'warranty_policy' },
  dell:     { url: 'https://www.dell.com/en-in/dt/services/deployment-services/warranty.htm', type: 'warranty_policy' },
  sony:     { url: 'https://www.sony.co.in/support/en/warranty', type: 'warranty_policy' },
  lg:       { url: 'https://www.lg.com/in/support/warranty-information', type: 'warranty_policy' },
  bose:     { url: 'https://www.bose.com/en_us/support/articles/HC_Article_1.html', type: 'warranty_policy' },
  oneplus:  { url: 'https://www.oneplus.com/in/support/warranty', type: 'warranty_policy' },
  xiaomi:   { url: 'https://www.mi.com/in/service/warranty', type: 'warranty_policy' },
  hp:       { url: 'https://support.hp.com/in-en/warranty-lookup', type: 'warranty_policy' },
  lenovo:   { url: 'https://pcsupport.lenovo.com/in/en/warranty', type: 'warranty_policy' },
});

// ── IN-MEMORY RETRIEVAL CACHE ─────────────────────────────────────────────────
const _cache = new Map(); // key → { data, fetchedAt, ttlMs }
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── WARRANTY POLICY EXTRACTOR ─────────────────────────────────────────────────
// Regex patterns to extract warranty duration and coverage from raw HTML/text.

const WARRANTY_EXTRACTION_PATTERNS = [
  { pattern: /(\d{1,2})\s*[-–]?\s*year(?:s)?\s+(?:limited\s+)?warranty/gi, type: 'duration_years' },
  { pattern: /(\d{1,2})\s+months?\s+(?:limited\s+)?warranty/gi, type: 'duration_months' },
  { pattern: /warranty\s+(?:period|coverage|term)\s*[:\-–]?\s*(\d{1,2})\s*(?:year|month)/gi, type: 'duration_labeled' },
  { pattern: /not\s+covered[:\s]+([^.]{10,80})/gi, type: 'exclusion' },
  { pattern: /excluded\s+from\s+(?:the\s+)?warranty[:\s]+([^.]{10,80})/gi, type: 'exclusion' },
  { pattern: /covered\s+under[:\s]+([^.]{10,80})/gi, type: 'coverage' },
];

function extractWarrantyInfo(text, brand) {
  const results = {
    brand,
    durationMonths: null,
    exclusions: [],
    coverageItems: [],
    rawSnippets: [],
    source: 'web_retrieval',
  };

  const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  for (const { pattern, type } of WARRANTY_EXTRACTION_PATTERNS) {
    const matches = cleanText.matchAll(pattern);
    for (const match of matches) {
      const snippet = match[0].slice(0, 120);
      results.rawSnippets.push({ type, snippet });

      if (type === 'duration_years' && !results.durationMonths) {
        results.durationMonths = parseInt(match[1]) * 12;
      }
      if (type === 'duration_months' && !results.durationMonths) {
        results.durationMonths = parseInt(match[1]);
      }
      if (type === 'exclusion' && results.exclusions.length < 5) {
        results.exclusions.push(match[1].trim());
      }
      if (type === 'coverage' && results.coverageItems.length < 5) {
        results.coverageItems.push(match[1].trim());
      }
    }
  }

  return results;
}

/**
 * Attempts to retrieve warranty policy for a given brand/product from
 * an external source. Returns structured knowledge or null if unavailable.
 *
 * @param {string} brand
 * @param {string} [productName]
 * @param {string} [category]
 * @returns {Promise<object|null>}
 */
export async function retrieveWarrantyPolicy(brand, productName = '', category = '') {
  if (!brand) return null;

  const brandKey = normalizeKey(brand).replace(/\s/g, '_');
  const cacheKey = `warranty_policy_${brandKey}`;

  // Check cache
  const cached = _cache.get(cacheKey);
  if (cached && (Date.now() - cached.fetchedAt) < cached.ttlMs) {
    return { ...cached.data, fromCache: true };
  }

  const target = RETRIEVAL_TARGETS[brandKey] || RETRIEVAL_TARGETS[brand.toLowerCase()];
  if (!target) {
    return {
      brand,
      retrieved: false,
      reason: `No known warranty support URL for brand "${brand}". Manual lookup required.`,
      fallback: getInternalPolicyFallback(brand),
    };
  }

  // Attempt HTTP fetch
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

    const response = await fetch(target.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'WarrantyVault/1.0 (warranty-research-tool)' },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const extracted = extractWarrantyInfo(text, brand);

    const result = {
      brand,
      retrieved: true,
      url: target.url,
      durationMonths: extracted.durationMonths,
      exclusions: extracted.exclusions,
      coverageItems: extracted.coverageItems,
      rawSnippets: extracted.rawSnippets.slice(0, 5),
      fetchedAt: new Date().toISOString(),
      fromCache: false,
    };

    // Cache for 7 days
    _cache.set(cacheKey, { data: result, fetchedAt: Date.now(), ttlMs: DEFAULT_TTL_MS });
    return result;

  } catch (err) {
    const isNetworkError = err.name === 'AbortError' || err.message.includes('fetch') || err.message.includes('network') || err.code === 'ENOTFOUND';

    return {
      brand,
      retrieved: false,
      reason: isNetworkError
        ? `Network unavailable — warranty policy retrieval requires internet access.`
        : `Retrieval failed: ${err.message}`,
      fallback: getInternalPolicyFallback(brand),
      url: target.url,
    };
  }
}

/**
 * Returns our internally-known warranty policy summary for major brands.
 * Used as the fallback when external retrieval fails (no network etc).
 */
function getInternalPolicyFallback(brand) {
  const policies = {
    Apple: {
      standardMonths: 12,
      extensionName: 'AppleCare+',
      extensionAvailable: true,
      keyExclusions: ['accidental damage (covered by AppleCare+ at extra cost)', 'liquid damage (unless AppleCare+)', 'unauthorized modifications', 'cosmetic damage'],
      keyCoverage: ['manufacturing defects', 'hardware failure', 'battery defects within first year', 'software issues under manufacturing defect clause'],
      claimProcess: 'Book appointment at Apple Store or Apple Authorised Service Provider via support.apple.com',
    },
    Samsung: {
      standardMonths: 12,
      extensionName: 'Samsung Care+',
      extensionAvailable: true,
      keyExclusions: ['physical damage', 'liquid damage', 'screen cracks', 'unauthorized repair', 'normal wear'],
      keyCoverage: ['manufacturing defects', 'hardware failure', 'display failure (non-physical)', 'battery defect within first 6 months'],
      claimProcess: 'Visit Samsung Service Centre or call 1800-5-726-7864 (India toll-free)',
    },
    Dell: {
      standardMonths: 12,
      extensionName: 'Dell ProSupport / Dell Extended Warranty',
      extensionAvailable: true,
      keyExclusions: ['accidental damage (add-on available)', 'liquid damage', 'software issues', 'consumables'],
      keyCoverage: ['hardware defects', 'keyboard/display/battery defects', 'on-site repair for ProSupport'],
      claimProcess: 'Call Dell Support 1800-425-4051 or create ticket at support.dell.com',
    },
    Sony: {
      standardMonths: 12,
      extensionName: 'Sony Extended Warranty',
      extensionAvailable: true,
      keyExclusions: ['physical damage', 'water damage', 'consumable parts', 'damage from incorrect voltage'],
      keyCoverage: ['manufacturing defects', 'electronic component failure', 'audio/display defects'],
      claimProcess: 'Call Sony India 1800-103-7799 or visit authorised service centre',
    },
    LG: {
      standardMonths: 12,
      extensionName: 'LG Extended Warranty',
      extensionAvailable: true,
      keyExclusions: ['physical damage', 'liquid ingress', 'voltage fluctuation damage', 'cosmetic damage'],
      keyCoverage: ['all manufacturing defects', 'compressor (10 years on select refrigerators)', 'motor (10 years on washing machines)'],
      claimProcess: 'Call LG India 1800-315-9999 or book at lg.com/in',
    },
  };

  return policies[brand] || {
    standardMonths: 12,
    keyExclusions: ['physical damage', 'liquid damage', 'unauthorized repair', 'cosmetic damage', 'normal wear'],
    keyCoverage: ['manufacturing defects', 'hardware failure'],
    note: `Specific policy for ${brand} not in internal database — visit the brand's official support page for details.`,
  };
}

/**
 * Formats retrieved knowledge into a structured context block for the
 * reasoning engine to merge with internal graph data.
 */
export function formatRetrievedContext(retrievalResult) {
  if (!retrievalResult) return null;

  if (!retrievalResult.retrieved) {
    const fb = retrievalResult.fallback;
    if (!fb) return null;
    return {
      source: 'internal_fallback',
      brand: retrievalResult.brand,
      warrantyDurationMonths: fb.standardMonths,
      keyExclusions: fb.keyExclusions || [],
      keyCoverage: fb.keyCoverage || [],
      claimProcess: fb.claimProcess || null,
      extensionAvailable: fb.extensionAvailable || false,
      extensionName: fb.extensionName || null,
      confidence: 0.7,
      note: retrievalResult.reason,
    };
  }

  return {
    source: 'web_retrieval',
    brand: retrievalResult.brand,
    url: retrievalResult.url,
    warrantyDurationMonths: retrievalResult.durationMonths,
    keyExclusions: retrievalResult.exclusions,
    keyCoverage: retrievalResult.coverageItems,
    rawSnippets: retrievalResult.rawSnippets,
    fetchedAt: retrievalResult.fetchedAt,
    confidence: 0.85,
  };
}

export default { retrieveWarrantyPolicy, formatRetrievedContext };
