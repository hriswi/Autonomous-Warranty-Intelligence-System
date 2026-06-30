/**
 * productRiskEngine.js
 *
 * PRODUCT RISK SCORING ENGINE
 *
 * Calculates a composite risk score (0–100) for a warranty-tracked product.
 * Higher score = higher risk of needing a repair or warranty claim.
 *
 * Risk model components (each weighted):
 *   1. CATEGORY RISK          — base failure rate for this product category (30%)
 *   2. PRODUCT AGE CURVE      — bathtub curve: higher risk in first 3 months
 *                               (early defects) and after 80% of warranty used (wear) (25%)
 *   3. WARRANTY COVERAGE WINDOW — how much warranty coverage remains relative
 *                               to product age (20%)
 *   4. RELIABILITY SCORE      — category's historical reliability rating (15%)
 *   5. PURCHASE DATE CONFIDENCE — low-confidence invoice data means we can't
 *                                 accurately assess actual age/coverage (10%)
 *
 * Output:
 *   riskScore: 0–100 (integer)
 *   riskLevel: CRITICAL (80+) / HIGH (65+) / MEDIUM (45+) / LOW (25+) / MINIMAL (<25)
 *   riskFactors: array of scored components with explanation
 *   recommendation: string
 */

import { daysBetween, addMonths } from '../utils/dateUtils.js';
import { getRepairCostData } from '../data/repairCostDatabase.js';

const WEIGHTS = Object.freeze({
  CATEGORY_RISK:       0.30,
  AGE_CURVE:           0.25,
  COVERAGE_WINDOW:     0.20,
  RELIABILITY:         0.15,
  DATA_CONFIDENCE:     0.10,
});

const RISK_LEVELS = Object.freeze([
  { min: 80, level: 'CRITICAL', label: 'Very high probability of needing service or claim soon.' },
  { min: 65, level: 'HIGH',     label: 'Elevated risk. Consider preventive action.' },
  { min: 45, level: 'MEDIUM',   label: 'Moderate risk. Monitor the product and keep documents ready.' },
  { min: 25, level: 'LOW',      label: 'Low risk. Product is in a stable phase.' },
  { min: 0,  level: 'MINIMAL',  label: 'Very low risk. No immediate action needed.' },
]);

function getRiskLevel(score) {
  return RISK_LEVELS.find((r) => score >= r.min) || RISK_LEVELS[RISK_LEVELS.length - 1];
}

/**
 * Computes the "bathtub curve" risk contribution.
 *
 * Consumer electronics show elevated early failure rates (manufacturing
 * defects surface in the first 0-90 days), a low-risk middle period,
 * then rising risk as the product ages toward and beyond its expected
 * service life. The curve is modeled as:
 *   - Days 0–90:   early risk (linear ramp down from 80 → 20)
 *   - Days 91–75% warranty: stable low risk (20–30)
 *   - Days 75%–100% warranty: rising risk (30 → 75)
 *   - Post-warranty: sustained elevated risk (75)
 */
function computeAgeCurveScore(daysUsed, totalWarrantyDays) {
  if (totalWarrantyDays <= 0) return 50; // unknown — medium default

  const pct = daysUsed / totalWarrantyDays;

  if (daysUsed < 0) return 60; // future purchase? flag as medium-high
  if (daysUsed <= 90) {
    // Early period: risk descends from 75 as initial defects clear.
    return Math.round(75 - (daysUsed / 90) * 45);
  }
  if (pct <= 0.75) {
    // Stable middle.
    return Math.round(20 + (pct - 90 / totalWarrantyDays) * 15);
  }
  if (pct <= 1.0) {
    // Rising end-of-warranty risk.
    return Math.round(30 + ((pct - 0.75) / 0.25) * 45);
  }
  // Post-warranty.
  const monthsExpired = Math.floor(Math.max(0, daysUsed - totalWarrantyDays) / 30);
  return Math.min(100, 75 + Math.min(25, monthsExpired * 3));
}

/**
 * Computes coverage window score.
 * If the product has very little warranty left relative to its age,
 * it's risky because any defect must be reported soon.
 * If it has ample coverage remaining, risk from a timing perspective is low.
 */
function computeCoverageWindowScore(daysRemaining, totalWarrantyDays) {
  if (totalWarrantyDays <= 0) return 60;
  if (daysRemaining <= 0) return 85;    // expired
  const pctRemaining = daysRemaining / totalWarrantyDays;
  if (pctRemaining > 0.5) return 10;    // > 50% warranty left: low urgency risk
  if (pctRemaining > 0.25) return 30;   // 25-50% left
  if (pctRemaining > 0.1) return 55;    // 10-25% left
  return 80;                            // < 10% left: very high urgency
}

/**
 * Main risk score computation.
 *
 * @param {object} parsedInvoice  Output of invoiceParser.parseInvoice().
 * @param {Date}   [referenceDate]
 * @returns {object} Risk report.
 */
export function computeProductRisk(parsedInvoice, referenceDate = new Date()) {
  const { category, purchaseDate, warrantyMonths, allWarrantyMentions } = parsedInvoice;
  const riskFactors = [];

  const durationMonths = warrantyMonths
    || (allWarrantyMentions?.length ? allWarrantyMentions[0].months : null);

  const repairData = getRepairCostData(category);

  // ── FACTOR 1: CATEGORY RISK ───────────────────────────────────────────────
  // Map the category's historical failure rate (0–1) to a 0–100 score.
  // Failure rate of 0.15 → 100, 0.05 → 33. Linear scale, clamped.
  const failureRate = repairData.historicalFailureRate || 0.1;
  const categoryRiskScore = Math.min(100, Math.round((failureRate / 0.20) * 100));
  riskFactors.push({
    factor: 'Category Risk',
    score: categoryRiskScore,
    weight: WEIGHTS.CATEGORY_RISK,
    explanation: `${category} has a ${Math.round(failureRate * 100)}% historical in-warranty failure rate.`,
  });

  // ── FACTOR 2: AGE CURVE ───────────────────────────────────────────────────
  let ageCurveScore = 50;
  let daysUsed = null;
  let totalWarrantyDays = null;
  let daysRemaining = null;

  if (purchaseDate && durationMonths) {
    const purchase = new Date(purchaseDate);
    const expiry = addMonths(purchase, durationMonths);
    daysUsed = daysBetween(purchase, referenceDate);
    totalWarrantyDays = daysBetween(purchase, expiry);
    daysRemaining = daysBetween(referenceDate, expiry);
    ageCurveScore = computeAgeCurveScore(daysUsed, totalWarrantyDays);

    riskFactors.push({
      factor: 'Product Age Curve',
      score: ageCurveScore,
      weight: WEIGHTS.AGE_CURVE,
      explanation: `Product is ${daysUsed} days old out of ${totalWarrantyDays}-day warranty period ` +
        `(${Math.round((daysUsed / totalWarrantyDays) * 100)}% warranty elapsed). ` +
        (daysUsed <= 90
          ? 'Early period — initial manufacturing defects still likely to surface.'
          : daysUsed / totalWarrantyDays > 0.75
          ? 'Late warranty phase — elevated risk of end-of-life component issues.'
          : 'Stable phase — lowest point on the reliability bathtub curve.'),
    });
  } else {
    riskFactors.push({
      factor: 'Product Age Curve',
      score: ageCurveScore,
      weight: WEIGHTS.AGE_CURVE,
      explanation: 'Purchase date or warranty duration unknown; using neutral midpoint score.',
    });
  }

  // ── FACTOR 3: COVERAGE WINDOW ─────────────────────────────────────────────
  const coverageWindowScore = daysRemaining !== null
    ? computeCoverageWindowScore(daysRemaining, totalWarrantyDays)
    : 60;

  riskFactors.push({
    factor: 'Coverage Window',
    score: coverageWindowScore,
    weight: WEIGHTS.COVERAGE_WINDOW,
    explanation: daysRemaining !== null
      ? `${daysRemaining > 0 ? daysRemaining + ' days of warranty remaining' : 'Warranty expired ' + Math.abs(daysRemaining) + ' days ago'}. ` +
        (daysRemaining <= 0 ? 'No warranty protection remaining.' : 'Time pressure on claiming any latent defects.')
      : 'Cannot assess coverage window without date and duration data.',
  });

  // ── FACTOR 4: RELIABILITY ─────────────────────────────────────────────────
  // Reliability score is 0–100 where higher = more reliable.
  // Invert it for risk scoring: low reliability = high risk.
  const reliabilityRawScore = repairData.reliabilityScore || 80;
  const reliabilityRiskScore = 100 - reliabilityRawScore;

  riskFactors.push({
    factor: 'Category Reliability',
    score: reliabilityRiskScore,
    weight: WEIGHTS.RELIABILITY,
    explanation: `${category} has a category reliability score of ${reliabilityRawScore}/100. ` +
      (reliabilityRawScore >= 85 ? 'Above-average reliability.' : reliabilityRawScore >= 75 ? 'Average reliability.' : 'Below-average reliability for consumer electronics.'),
  });

  // ── FACTOR 5: DATA CONFIDENCE ─────────────────────────────────────────────
  // Low confidence in the parsed invoice data means we can't accurately
  // assess the actual age/warranty coverage — treat this as a risk signal.
  const overallConf = parsedInvoice.overallConfidence || 0.5;
  // Invert: low confidence → higher risk score component.
  const dataConfidenceScore = Math.round((1 - overallConf) * 100);

  riskFactors.push({
    factor: 'Invoice Data Confidence',
    score: dataConfidenceScore,
    weight: WEIGHTS.DATA_CONFIDENCE,
    explanation: `Invoice parsing confidence: ${Math.round(overallConf * 100)}%. ` +
      (overallConf < 0.55
        ? 'Low confidence in extracted data — manual verification recommended.'
        : overallConf < 0.75
        ? 'Moderate confidence — some fields may need verification.'
        : 'High confidence in extracted data.'),
  });

  // ── COMPOSITE SCORE ───────────────────────────────────────────────────────
  const rawScore = riskFactors.reduce((sum, f) => sum + f.score * f.weight, 0);
  const riskScore = Math.round(Math.min(100, Math.max(0, rawScore)));
  const { level: riskLevel, label: riskLevelLabel } = getRiskLevel(riskScore);

  const recommendation = buildRiskRecommendation(riskLevel, daysRemaining, category, repairData);

  return {
    product: parsedInvoice.productName || 'Unknown Product',
    brand: parsedInvoice.brand,
    category,
    riskScore,
    riskLevel,
    riskLevelLabel,

    components: {
      categoryRisk: { score: categoryRiskScore, weight: `${Math.round(WEIGHTS.CATEGORY_RISK * 100)}%` },
      ageCurve: { score: ageCurveScore, weight: `${Math.round(WEIGHTS.AGE_CURVE * 100)}%` },
      coverageWindow: { score: coverageWindowScore, weight: `${Math.round(WEIGHTS.COVERAGE_WINDOW * 100)}%` },
      reliability: { score: reliabilityRiskScore, weight: `${Math.round(WEIGHTS.RELIABILITY * 100)}%` },
      dataConfidence: { score: dataConfidenceScore, weight: `${Math.round(WEIGHTS.DATA_CONFIDENCE * 100)}%` },
    },

    riskFactors,
    recommendation,

    repairContext: {
      medianRepairCost: repairData.medianRepairCost,
      estimatedReplacementCost: repairData.medianRepairCost * repairData.replacementCostMultiple,
      failureRatePercent: Math.round(failureRate * 100),
    },

    computedAt: new Date().toISOString(),
  };
}

function buildRiskRecommendation(riskLevel, daysRemaining, category, repairData) {
  const expiredSuffix = daysRemaining !== null && daysRemaining <= 0
    ? ' Warranty has expired — repair costs are now your responsibility.'
    : '';

  switch (riskLevel) {
    case 'CRITICAL':
      return `IMMEDIATE ACTION REQUIRED: This product has a very high risk score. ` +
        (daysRemaining > 0
          ? `With only ${daysRemaining} days of warranty remaining and elevated category risk, ` +
            `book an authorized service inspection immediately.`
          : `Warranty has expired. Contact an authorized service center for a paid inspection.`) +
        ` Median repair cost for ${category}: ₹${repairData.medianRepairCost.toLocaleString('en-IN')}.`;

    case 'HIGH':
      return `Schedule a preventive service inspection soon.${expiredSuffix} ` +
        `Keep your invoice and warranty documents accessible.`;

    case 'MEDIUM':
      return `Monitor the product for any signs of malfunction. ` +
        `Consider scheduling an inspection if the warranty expires within 90 days.${expiredSuffix}`;

    case 'LOW':
      return `Product is in a relatively low-risk phase. ` +
        `Maintain your warranty documents and note the expiry date.${expiredSuffix}`;

    default:
      return `Product risk is minimal. No immediate action needed.${expiredSuffix}`;
  }
}

export default { computeProductRisk };
