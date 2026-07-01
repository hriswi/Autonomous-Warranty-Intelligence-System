/**
 * warrantyAdvisorEngine.js
 *
 * SMART WARRANTY ADVISOR ENGINE
 *
 * Proactively advises the user on what to do about their warranty,
 * even without a specific reported issue. Given a parsed invoice and
 * the current date, this engine evaluates:
 *
 *   1. EXPIRY URGENCY — how many days until warranty expires, and
 *      whether the user should take action now (preventive inspection).
 *   2. REPAIR COST vs. REPLACEMENT — if the product fails, how
 *      expensive would repair be vs buying new? Is it worth extended warranty?
 *   3. CATEGORY RISK PROFILE — how failure-prone is this product category
 *      at different ages?
 *   4. EXTENDED WARRANTY VALUE — is the product still in a window where
 *      purchasing an extended warranty makes financial sense?
 *   5. URGENCY SCORE — 0–100 composite score driving the recommendation.
 *
 * Output is a structured advisory report with:
 *   - urgencyScore (0–100, higher = more urgent)
 *   - urgencyLevel (CRITICAL / HIGH / MEDIUM / LOW / NONE)
 *   - repairCostEstimate
 *   - advisoryActions (prioritized list)
 *   - reasoning (transparency array)
 */

import { daysBetween, addMonths } from '../utils/dateUtils.js';
import { getRepairCostData, getRepairCostRange } from '../data/repairCostDatabase.js';

// Urgency thresholds (days until expiry → urgency level).
const URGENCY_THRESHOLDS = Object.freeze({
  CRITICAL: 7,   // ≤ 7 days:  must act now
  HIGH:     30,  // ≤ 30 days: act this week
  MEDIUM:   90,  // ≤ 90 days: plan service inspection
  LOW:      180, // ≤ 180 days: awareness, no action needed yet
});

/**
 * Generates a comprehensive warranty advisory report.
 *
 * @param {object} parsedInvoice  Output of invoiceParser.parseInvoice().
 * @param {Date}   [referenceDate] Defaults to today.
 * @returns {object} Advisory report.
 */
export function generateWarrantyAdvisory(parsedInvoice, referenceDate = new Date()) {
  const reasoning = [];

  const {
    productName,
    brand,
    category,
    purchaseDate,
    warrantyMonths,
    allWarrantyMentions,
  } = parsedInvoice;

  const durationMonths = warrantyMonths
    || (allWarrantyMentions?.length ? allWarrantyMentions[0].months : null);

  // ── 1. WARRANTY TIMELINE ──────────────────────────────────────────────────
  let warrantyTimeline = null;
  if (purchaseDate && durationMonths) {
    const purchase = new Date(purchaseDate);
    const expiryDate = addMonths(purchase, durationMonths);
    const daysRemaining = daysBetween(referenceDate, expiryDate);
    const totalDays = daysBetween(purchase, expiryDate);
    const daysUsed = daysBetween(purchase, referenceDate);
    const percentUsed = totalDays > 0 ? Math.min(100, Math.round((daysUsed / totalDays) * 100)) : 100;

    warrantyTimeline = { purchase, expiryDate, daysRemaining, daysUsed, totalDays, percentUsed, durationMonths };
    reasoning.push(
      `[TIMELINE] Purchase: ${purchaseDate}. Warranty: ${durationMonths} months. ` +
        `Expiry: ${expiryDate.toISOString().split('T')[0]}. ` +
        `${daysRemaining > 0 ? `${daysRemaining} days remaining (${percentUsed}% of warranty used).` : `Expired ${Math.abs(daysRemaining)} days ago.`}`
    );
  } else {
    reasoning.push('[TIMELINE] Insufficient data to compute warranty timeline (missing purchase date or warranty duration).');
  }

  // ── 2. URGENCY SCORING ────────────────────────────────────────────────────
  let urgencyScore = 0;
  let urgencyLevel = 'NONE';

  if (!warrantyTimeline) {
    urgencyScore = 20; // Unknown warranty state has some inherent risk.
    urgencyLevel = 'LOW';
    reasoning.push('[URGENCY] Cannot compute precise urgency due to missing warranty data. Default LOW.');
  } else if (warrantyTimeline.daysRemaining <= 0) {
    urgencyScore = 0;
    urgencyLevel = 'NONE';
    reasoning.push('[URGENCY] Warranty already expired. No urgency for warranty-related actions.');
  } else {
    const dr = warrantyTimeline.daysRemaining;

    if (dr <= URGENCY_THRESHOLDS.CRITICAL) {
      urgencyScore = 90 + Math.round((1 - dr / URGENCY_THRESHOLDS.CRITICAL) * 10);
      urgencyLevel = 'CRITICAL';
    } else if (dr <= URGENCY_THRESHOLDS.HIGH) {
      urgencyScore = 70 + Math.round(((URGENCY_THRESHOLDS.HIGH - dr) / (URGENCY_THRESHOLDS.HIGH - URGENCY_THRESHOLDS.CRITICAL)) * 20);
      urgencyLevel = 'HIGH';
    } else if (dr <= URGENCY_THRESHOLDS.MEDIUM) {
      urgencyScore = 40 + Math.round(((URGENCY_THRESHOLDS.MEDIUM - dr) / (URGENCY_THRESHOLDS.MEDIUM - URGENCY_THRESHOLDS.HIGH)) * 30);
      urgencyLevel = 'MEDIUM';
    } else if (dr <= URGENCY_THRESHOLDS.LOW) {
      urgencyScore = 15 + Math.round(((URGENCY_THRESHOLDS.LOW - dr) / (URGENCY_THRESHOLDS.LOW - URGENCY_THRESHOLDS.MEDIUM)) * 25);
      urgencyLevel = 'LOW';
    } else {
      urgencyScore = 5;
      urgencyLevel = 'NONE';
    }

    // Boost urgency by category failure rate:
    // Products with higher historical failure rates should prompt
    // earlier preventive action, since there's more chance of a real
    // problem lurking in the warranty window.
    const repairData = getRepairCostData(category);
    if (repairData.historicalFailureRate > 0.12) {
      const boost = Math.round(repairData.historicalFailureRate * 20);
      urgencyScore = Math.min(100, urgencyScore + boost);
      reasoning.push(`[URGENCY] Category "${category}" has above-average historical failure rate (${Math.round(repairData.historicalFailureRate * 100)}%); urgency boosted by ${boost} points.`);
    }

    urgencyScore = Math.min(100, Math.max(0, urgencyScore));
    reasoning.push(`[URGENCY] ${urgencyLevel} — Score: ${urgencyScore}/100. ${dr} days remaining.`);
  }

  // ── 3. REPAIR COST ANALYSIS ───────────────────────────────────────────────
  const repairData = getRepairCostData(category);
  const medianRepairCost = repairData.medianRepairCost;
  const reliabilityScore = repairData.reliabilityScore;

  // Estimate replacement cost from the repair-to-replacement multiple.
  // This is a rough upper bound; actual replacement cost varies.
  const estimatedReplacementCost = medianRepairCost * repairData.replacementCostMultiple;
  const repairToReplacementRatio = medianRepairCost / estimatedReplacementCost;

  reasoning.push(
    `[REPAIR COST] Median repair cost for ${category}: ₹${medianRepairCost.toLocaleString('en-IN')}. ` +
      `Estimated replacement cost: ~₹${estimatedReplacementCost.toLocaleString('en-IN')}. ` +
      `Repair-to-replacement ratio: ${Math.round(repairToReplacementRatio * 100)}%.`
  );

  // ── 4. EXTENDED WARRANTY VALUE WINDOW ────────────────────────────────────
  let extendedWarrantyRecommended = false;
  let extendedWarrantyReason = '';

  if (warrantyTimeline && warrantyTimeline.daysRemaining > 0) {
    const dr = warrantyTimeline.daysRemaining;
    // Extended warranty makes most sense when:
    //  - At least 30 days remain (enough time to purchase and register)
    //  - Product is high-value relative to repair cost
    //  - Category has meaningful failure rate
    if (dr >= 30 && repairData.replacementCostMultiple >= 6 && repairData.historicalFailureRate >= 0.08) {
      extendedWarrantyRecommended = true;
      extendedWarrantyReason = `With ${dr} days remaining on standard warranty, now is a good time to consider an extended warranty or AMC (Annual Maintenance Contract). ${category} products have a ${Math.round(repairData.historicalFailureRate * 100)}% in-warranty failure rate, and repairs cost a median ₹${medianRepairCost.toLocaleString('en-IN')}.`;
    }
  }

  // ── 5. ADVISORY ACTIONS ───────────────────────────────────────────────────
  const advisoryActions = buildAdvisoryActions({
    urgencyLevel,
    urgencyScore,
    warrantyTimeline,
    repairData,
    extendedWarrantyRecommended,
    extendedWarrantyReason,
    category,
    brand,
    productName,
    parsedInvoice,
  });

  return {
    product: productName || 'Unknown Product',
    brand: brand || null,
    category: category || 'Unknown',
    purchaseDate: purchaseDate || null,

    warrantyTimeline: warrantyTimeline
      ? {
          expiryDate: warrantyTimeline.expiryDate.toISOString().split('T')[0],
          daysRemaining: warrantyTimeline.daysRemaining,
          daysUsed: warrantyTimeline.daysUsed,
          totalDays: warrantyTimeline.totalDays,
          percentWarrantyUsed: warrantyTimeline.percentUsed,
          durationMonths: warrantyTimeline.durationMonths,
          isActive: warrantyTimeline.daysRemaining > 0,
        }
      : null,

    urgencyScore,
    urgencyLevel,

    repairCostEstimate: {
      medianRepairCost,
      estimatedReplacementCost,
      repairToReplacementRatioPercent: Math.round(repairToReplacementRatio * 100),
      currencyNote: 'All amounts in INR (Indian Rupees). Estimates based on typical service center pricing.',
    },

    categoryInsights: {
      reliabilityScore,
      historicalFailureRate: repairData.historicalFailureRate,
      failureRatePercent: Math.round(repairData.historicalFailureRate * 100),
    },

    extendedWarrantyRecommended,
    extendedWarrantyReason: extendedWarrantyRecommended ? extendedWarrantyReason : null,

    advisoryActions,
    reasoning,

    generatedAt: new Date().toISOString(),
  };
}

function buildAdvisoryActions(ctx) {
  const actions = [];
  const { urgencyLevel, warrantyTimeline, repairData, extendedWarrantyRecommended,
    extendedWarrantyReason, category, brand, parsedInvoice } = ctx;

  const hasActiveWarranty = warrantyTimeline && warrantyTimeline.daysRemaining > 0;
  const dr = warrantyTimeline?.daysRemaining;

  if (urgencyLevel === 'CRITICAL') {
    actions.push({
      priority: 1,
      type: 'URGENT_SERVICE',
      title: `Warranty expires in ${dr} day(s) — Book a preventive service inspection NOW`,
      detail: `Your warranty expires on ${warrantyTimeline.expiryDate.toISOString().split('T')[0]}. ` +
        `Schedule a diagnostic inspection at an authorized service center immediately. Any latent defects ` +
        `must be reported BEFORE expiry to qualify for warranty repair.`,
    });
  } else if (urgencyLevel === 'HIGH') {
    actions.push({
      priority: 1,
      type: 'BOOK_INSPECTION',
      title: `Warranty expires in ${dr} days — Schedule a preventive inspection this week`,
      detail: `Book an authorized service inspection in the next few days to identify any potential issues ` +
        `before the warranty period closes.`,
    });
  } else if (urgencyLevel === 'MEDIUM') {
    actions.push({
      priority: 2,
      type: 'PLAN_INSPECTION',
      title: `Plan a warranty service check — ${dr} days remaining`,
      detail: `You have approximately ${Math.round(dr / 30)} month(s) of warranty left. Consider scheduling ` +
        `a preventive inspection, especially if you notice any unusual behavior.`,
    });
  }

  if (extendedWarrantyRecommended) {
    actions.push({
      priority: hasActiveWarranty ? 2 : 3,
      type: 'EXTENDED_WARRANTY',
      title: 'Consider purchasing an extended warranty / AMC',
      detail: extendedWarrantyReason,
    });
  }

  // If repair cost is more than 50% of replacement cost, flag it.
  if (repairData.medianRepairCost / (repairData.medianRepairCost * repairData.replacementCostMultiple) > 0.4) {
    actions.push({
      priority: 3,
      type: 'REPAIR_VS_REPLACE',
      title: 'Know your repair economics before any out-of-warranty repair',
      detail: `For ${category}, median repair cost (₹${repairData.medianRepairCost.toLocaleString('en-IN')}) is relatively high compared to replacement cost. ` +
        `If the device fails post-warranty, always get a detailed quote from an authorized service center before deciding to repair or replace.`,
    });
  }

  // Always add: keep documents ready.
  actions.push({
    priority: 4,
    type: 'DOCUMENTATION',
    title: 'Keep your invoice and warranty documents accessible',
    detail: `Ensure your purchase invoice and warranty card (${brand ? brand + ' ' : ''}${parsedInvoice.invoiceNumber ? 'Invoice #' + parsedInvoice.invoiceNumber : ''}) ` +
      `are stored safely. You will need them for any warranty claim or service request.`,
  });

  if (!hasActiveWarranty && warrantyTimeline) {
    actions.push({
      priority: 1,
      type: 'WARRANTY_EXPIRED',
      title: 'Warranty has expired — evaluate paid repair options',
      detail: `The standard warranty expired ${Math.abs(warrantyTimeline.daysRemaining)} day(s) ago. ` +
        `Contact an authorized service center for a paid diagnostic. For ${category}, median repair cost is ` +
        `₹${repairData.medianRepairCost.toLocaleString('en-IN')}. Compare repair cost to replacement before deciding.`,
    });
  }

  return actions.sort((a, b) => a.priority - b.priority);
}

export default { generateWarrantyAdvisory };
