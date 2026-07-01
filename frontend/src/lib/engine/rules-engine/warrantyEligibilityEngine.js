/**
 * warrantyEligibilityEngine.js
 *
 * WARRANTY CLAIM ELIGIBILITY ENGINE
 *
 * Decision tree engine that evaluates whether a user's stated issue
 * is likely covered under their product's warranty.
 *
 * Input:
 *   - issueDescription: string  (e.g. "My laptop keyboard stopped working")
 *   - parsedInvoice: object     (output from invoiceParser.parseInvoice)
 *   - referenceDate: Date       (optional, defaults to now — for testability)
 *
 * Decision tree flow:
 *   1. WARRANTY STATUS CHECK  — is the product currently within the warranty period?
 *   2. ISSUE CLASSIFICATION   — map free text to structured issue type(s)
 *   3. EXCLUSION SCREENING    — hard-stop on universally excluded issue types
 *   4. COVERAGE LOOKUP        — check category-specific and universal coverage rules
 *   5. CONFIDENCE SCORING     — aggregate confidence from all signals
 *   6. RECOMMENDATION         — generate actionable next steps
 *
 * Outputs a fully structured eligibility report with:
 *   - warrantyStatus: active / expired / unknown
 *   - issueTypes: detected issue classifications with confidence
 *   - covered: boolean | null (null = genuinely ambiguous)
 *   - coverageConfidence: 0–1
 *   - exclusionMatches: which exclusion rules fired, if any
 *   - recommendation: which procedure to follow
 *   - claimViability: HIGH / MEDIUM / LOW / DENIED / UNKNOWN
 *   - reasoning: array of human-readable explanation strings
 */

import { daysBetween, addMonths } from '../utils/dateUtils.js';
import { normalizeKey } from '../utils/textUtils.js';
import {
  ISSUE_TYPES,
  ISSUE_KEYWORD_RULES,
  COVERAGE_RULES,
  CLAIM_PROCEDURES,
  BRAND_SERVICE_INFO,
} from './warrantyRulesDatabase.js';

// ─── ISSUE CLASSIFIER ─────────────────────────────────────────────────────────

/**
 * Maps a free-text issue description to one or more structured issue
 * types using the ISSUE_KEYWORD_RULES dictionary.
 *
 * Returns an array sorted by match confidence, so downstream logic
 * always works with the most likely interpretation first.
 */
function classifyIssue(issueDescription) {
  if (!issueDescription || typeof issueDescription !== 'string') {
    return [{ issueType: ISSUE_TYPES.UNKNOWN, confidence: 0, matchedKeywords: [] }];
  }

  const normalized = normalizeKey(issueDescription);
  const scores = new Map();

  for (const rule of ISSUE_KEYWORD_RULES) {
    const matched = [];
    for (const kw of rule.keywords) {
      if (normalized.includes(normalizeKey(kw))) {
        matched.push(kw);
      }
    }
    if (matched.length > 0) {
      const existing = scores.get(rule.issueType);
      // Multiple keywords from the same rule boost confidence (up to a cap).
      const boostedConf = Math.min(0.98, rule.confidence + (matched.length - 1) * 0.03);
      if (!existing || boostedConf > existing.confidence) {
        scores.set(rule.issueType, {
          issueType: rule.issueType,
          confidence: boostedConf,
          matchedKeywords: matched,
        });
      }
    }
  }

  if (scores.size === 0) {
    return [{ issueType: ISSUE_TYPES.UNKNOWN, confidence: 0.3, matchedKeywords: [] }];
  }

  return [...scores.values()].sort((a, b) => b.confidence - a.confidence);
}

// ─── WARRANTY STATUS CHECK ────────────────────────────────────────────────────

function checkWarrantyStatus(parsedInvoice, referenceDate) {
  const { purchaseDate, warrantyMonths, allWarrantyMentions, category } = parsedInvoice;

  if (!purchaseDate) {
    return {
      status: 'unknown',
      daysRemaining: null,
      expiryDate: null,
      confidence: 0.2,
      reason: 'Purchase date could not be extracted from the invoice. Cannot determine warranty status without a purchase date.',
    };
  }

  const purchase = new Date(purchaseDate);
  const durationMonths = warrantyMonths
    || (allWarrantyMentions && allWarrantyMentions.length > 0 ? allWarrantyMentions[0].months : null);

  if (!durationMonths) {
    return {
      status: 'unknown',
      daysRemaining: null,
      expiryDate: null,
      confidence: 0.3,
      reason: `Warranty duration not found on invoice. Purchase date: ${purchaseDate}. Cannot determine if still within warranty period.`,
    };
  }

  const expiryDate = addMonths(purchase, durationMonths);
  const daysRemaining = daysBetween(referenceDate, expiryDate);

  if (daysRemaining > 0) {
    return {
      status: 'active',
      daysRemaining,
      expiryDate: expiryDate.toISOString().split('T')[0],
      warrantyMonths: durationMonths,
      confidence: parsedInvoice.fieldConfidence?.purchaseDate >= 0.6 ? 0.9 : 0.6,
      reason: `Product is within warranty period. ${daysRemaining} day(s) remaining until ${expiryDate.toISOString().split('T')[0]}.`,
    };
  } else {
    const daysExpired = Math.abs(daysRemaining);
    return {
      status: 'expired',
      daysRemaining: daysRemaining, // negative = expired X days ago
      daysExpired,
      expiryDate: expiryDate.toISOString().split('T')[0],
      warrantyMonths: durationMonths,
      confidence: parsedInvoice.fieldConfidence?.purchaseDate >= 0.6 ? 0.9 : 0.6,
      reason: `Warranty expired ${daysExpired} day(s) ago (${expiryDate.toISOString().split('T')[0]}). Standard warranty claims are no longer applicable, but check for extended component warranties.`,
    };
  }
}

// ─── COVERAGE LOOKUP ──────────────────────────────────────────────────────────

function lookupCoverage(issueType, category) {
  // Find the rule for this issue type.
  const rule = COVERAGE_RULES.find((r) => r.issueType === issueType);
  if (!rule) return null;

  // Check for a category-specific override.
  if (rule.overrides && rule.overrides[category]) {
    return { ...rule.overrides[category], issueType, hasOverride: true };
  }

  return { covered: rule.covered, confidence: rule.confidence, reason: rule.reason, issueType, hasOverride: false };
}

// ─── CLAIM VIABILITY SCORING ──────────────────────────────────────────────────

function computeViability(warrantyStatus, coverage, issueClassifications) {
  if (warrantyStatus.status === 'expired') return 'DENIED';
  if (warrantyStatus.status === 'unknown') return 'UNKNOWN';

  if (!coverage || coverage.covered === false) return 'DENIED';

  const primaryIssue = issueClassifications[0];
  if (primaryIssue.issueType === ISSUE_TYPES.UNKNOWN) return 'UNKNOWN';

  const combinedConf = (coverage.confidence || 0) * 0.6 + (primaryIssue.confidence || 0) * 0.4;

  if (combinedConf >= 0.8) return 'HIGH';
  if (combinedConf >= 0.6) return 'MEDIUM';
  return 'LOW';
}

// ─── RECOMMENDATION SELECTOR ──────────────────────────────────────────────────

function selectProcedure(warrantyStatus, coverage, issueClassifications, brand) {
  if (warrantyStatus.status === 'expired') {
    return { key: 'expired_warranty', steps: CLAIM_PROCEDURES.expired_warranty };
  }

  if (!coverage || coverage.covered === null) {
    return { key: 'unknown_issue', steps: CLAIM_PROCEDURES.unknown_issue };
  }

  if (!coverage.covered) {
    const primaryType = issueClassifications[0]?.issueType;
    if (primaryType === ISSUE_TYPES.LIQUID_DAMAGE) {
      return { key: 'excluded_liquid_damage', steps: CLAIM_PROCEDURES.excluded_liquid_damage };
    }
    if ([ISSUE_TYPES.PHYSICAL_DAMAGE, ISSUE_TYPES.ACCIDENTAL_DAMAGE, ISSUE_TYPES.SCREEN_CRACK].includes(primaryType)) {
      return { key: 'excluded_physical_damage', steps: CLAIM_PROCEDURES.excluded_physical_damage };
    }
    if (primaryType === ISSUE_TYPES.UNAUTHORIZED_REPAIR) {
      return { key: 'excluded_unauthorized_repair', steps: CLAIM_PROCEDURES.excluded_unauthorized_repair };
    }
    return { key: 'excluded_general', steps: CLAIM_PROCEDURES.excluded_general };
  }

  // Covered — add brand-specific helpline if known.
  const brandInfo = brand ? BRAND_SERVICE_INFO[brand] : null;
  const steps = [...CLAIM_PROCEDURES.covered_standard];
  if (brandInfo) {
    steps.push(`Brand helpline: ${brandInfo.helpline}`);
  }

  return { key: 'covered_standard', steps };
}

// ─── MAIN ENGINE ENTRY POINT ──────────────────────────────────────────────────

/**
 * Evaluates warranty claim eligibility for a reported issue.
 *
 * @param {string} issueDescription Natural-language problem description.
 * @param {object} parsedInvoice    Output of invoiceParser.parseInvoice().
 * @param {Date}   [referenceDate]  Defaults to today.
 * @returns {object} Full eligibility report.
 */
export function evaluateWarrantyClaim(issueDescription, parsedInvoice, referenceDate = new Date()) {
  const reasoning = [];

  // Step 1: Warranty status.
  const warrantyStatus = checkWarrantyStatus(parsedInvoice, referenceDate);
  reasoning.push(`[WARRANTY STATUS] ${warrantyStatus.reason}`);

  // Step 2: Classify the issue.
  const issueClassifications = classifyIssue(issueDescription);
  const primaryIssue = issueClassifications[0];

  reasoning.push(
    `[ISSUE CLASSIFICATION] Detected issue type: "${primaryIssue.issueType}" ` +
      `(confidence ${Math.round(primaryIssue.confidence * 100)}%) ` +
      (primaryIssue.matchedKeywords.length
        ? `via keywords: [${primaryIssue.matchedKeywords.join(', ')}]`
        : '(no specific keywords matched)')
  );

  if (issueClassifications.length > 1) {
    reasoning.push(
      `[ISSUE CLASSIFICATION] Secondary interpretations: ${issueClassifications
        .slice(1, 3)
        .map((c) => `"${c.issueType}" (${Math.round(c.confidence * 100)}%)`)
        .join(', ')}`
    );
  }

  // Step 3: Early exit if warranty expired.
  if (warrantyStatus.status === 'expired') {
    const procedure = selectProcedure(warrantyStatus, null, issueClassifications, parsedInvoice.brand);
    reasoning.push('[DECISION] Warranty is expired. Claim cannot proceed under standard warranty.');
    return buildReport({
      issueDescription,
      warrantyStatus,
      issueClassifications,
      covered: false,
      coverageConfidence: 0,
      coverageReason: warrantyStatus.reason,
      exclusionMatches: [],
      claimViability: 'DENIED',
      procedure,
      reasoning,
      parsedInvoice,
    });
  }

  // Step 4: Coverage lookup — check primary issue type against rules.
  const coverage = lookupCoverage(primaryIssue.issueType, parsedInvoice.category);

  let covered = null;
  let coverageConfidence = 0;
  let coverageReason = 'No coverage rule found for this issue type.';
  const exclusionMatches = [];

  if (coverage) {
    covered = coverage.covered;
    coverageConfidence = coverage.confidence;
    coverageReason = coverage.reason;

    if (!coverage.covered) {
      exclusionMatches.push({
        issueType: primaryIssue.issueType,
        reason: coverage.reason,
        confidence: coverage.confidence,
      });
      reasoning.push(`[EXCLUSION] Issue type "${primaryIssue.issueType}" is excluded: ${coverage.reason}`);
    } else {
      reasoning.push(
        `[COVERAGE] Issue type "${primaryIssue.issueType}" appears COVERED` +
          (coverage.hasOverride ? ` (category-specific rule for ${parsedInvoice.category})` : ' (universal rule)') +
          `. ${coverage.reason}`
      );
    }
  } else {
    reasoning.push(`[COVERAGE] No specific coverage rule found for issue type "${primaryIssue.issueType}". Treating as ambiguous.`);
  }

  // Step 5: Check secondary issue types for additional exclusions
  // (sometimes one description implies both a covered primary symptom AND an
  // excluded cause — e.g. "keyboard stopped working after I dropped it").
  for (const secondary of issueClassifications.slice(1)) {
    const secCoverage = lookupCoverage(secondary.issueType, parsedInvoice.category);
    if (secCoverage && !secCoverage.covered && secondary.confidence >= 0.8) {
      exclusionMatches.push({
        issueType: secondary.issueType,
        reason: secCoverage.reason,
        confidence: secondary.confidence,
        isSecondary: true,
      });
      // A high-confidence exclusion secondary signal overrides covered primary.
      if (covered === true && secondary.confidence >= 0.88) {
        covered = false;
        coverageConfidence = secondary.confidence;
        coverageReason = `Even though the primary symptom might be covered, a high-confidence exclusion was detected: ${secCoverage.reason}`;
        reasoning.push(
          `[EXCLUSION OVERRIDE] Secondary issue "${secondary.issueType}" (${Math.round(secondary.confidence * 100)}% confidence) ` +
            `triggers exclusion and overrides the initial coverage assessment. ${secCoverage.reason}`
        );
      }
    }
  }

  // Step 6: Viability + recommendation.
  const claimViability = computeViability(warrantyStatus, { covered, confidence: coverageConfidence }, issueClassifications);
  const procedure = selectProcedure(warrantyStatus, { covered }, issueClassifications, parsedInvoice.brand);

  reasoning.push(`[DECISION] Claim viability: ${claimViability}. Covered: ${covered === null ? 'ambiguous' : covered}.`);

  return buildReport({
    issueDescription,
    warrantyStatus,
    issueClassifications,
    covered,
    coverageConfidence,
    coverageReason,
    exclusionMatches,
    claimViability,
    procedure,
    reasoning,
    parsedInvoice,
  });
}

function buildReport(fields) {
  const {
    issueDescription, warrantyStatus, issueClassifications,
    covered, coverageConfidence, coverageReason,
    exclusionMatches, claimViability, procedure, reasoning, parsedInvoice,
  } = fields;

  return {
    // Input context
    issueDescription,
    product: parsedInvoice.productName || 'Unknown Product',
    brand: parsedInvoice.brand,
    category: parsedInvoice.category,
    purchaseDate: parsedInvoice.purchaseDate,

    // Warranty status
    warrantyStatus: {
      status: warrantyStatus.status,
      daysRemaining: warrantyStatus.daysRemaining,
      expiryDate: warrantyStatus.expiryDate,
      warrantyMonths: warrantyStatus.warrantyMonths,
      confidence: warrantyStatus.confidence,
    },

    // Issue analysis
    issueClassifications: issueClassifications.map((c) => ({
      issueType: c.issueType,
      confidence: Math.round(c.confidence * 100) / 100,
      matchedKeywords: c.matchedKeywords,
    })),

    // Coverage decision
    covered,
    coverageConfidence: Math.round(coverageConfidence * 100) / 100,
    coverageReason,
    exclusionMatches,

    // Viability + action
    claimViability,
    recommendedSteps: procedure.steps,
    procedureKey: procedure.key,

    // Transparency
    reasoning,

    // Metadata
    evaluatedAt: new Date().toISOString(),
  };
}

export default { evaluateWarrantyClaim };
