/**
 * failurePredictionEngine.js
 *
 * PRODUCT FAILURE PREDICTION ENGINE
 *
 * Predicts the probability of specific component failures occurring within
 * a defined future horizon (default: remaining warranty period + 12 months).
 *
 * Model: weighted Bayesian-style scoring using:
 *   1. BASE_FAILURE_RATES — empirical per-component, per-category failure
 *      probabilities over a 3-year product lifetime
 *   2. AGE ACCELERATION  — failure rates increase non-linearly with age
 *      (bathtub curve: high early, low middle, rising late)
 *   3. REPAIR HISTORY    — a product that has already been repaired once
 *      has elevated probability of related or cascading failures
 *   4. CATEGORY PROFILE  — high-reliability vs high-failure-rate categories
 *   5. REPORTED SYMPTOMS — user-reported issues that haven't yet caused
 *      a confirmed failure predict elevated component risk
 *
 * Output per product:
 *   componentRisks: [{ component, failureProbability, riskLevel, basis }]
 *   overallFailureProbability: 0–1
 *   dominantRisk: the component most likely to fail
 *   predictionHorizonDays: how far ahead this prediction covers
 */

import { daysBetween, addMonths } from '../../utils/dateUtils.js';
import { getRepairCostData } from '../../data/repairCostDatabase.js';
import { CATEGORIES } from '../../classifier/productDatabase.js';

// ── BASE FAILURE RATE DATABASE ────────────────────────────────────────────────
// Per-component base failure probability over a 3-year ownership period.
// Source: synthesised from consumer electronics reliability studies and
// common service-center failure frequency data (Indian market).
// Values are probabilities (0–1) over the FULL 3-year window;
// the engine scales to the actual product age.

const BASE_FAILURE_RATES = Object.freeze({
  [CATEGORIES.SMARTPHONE]: {
    battery:      0.42,  // Most common smartphone failure
    display:      0.18,
    camera:       0.08,
    charging_port:0.15,
    speaker:      0.10,
    software:     0.12,
    motherboard:  0.05,
  },
  [CATEGORIES.LAPTOP]: {
    battery:      0.45,
    display:      0.12,
    keyboard:     0.18,
    charging_port:0.10,
    fan_cooling:  0.15,
    hdd_ssd:      0.08,
    motherboard:  0.07,
  },
  [CATEGORIES.TELEVISION]: {
    display_panel:0.08,
    backlight:    0.12,
    power_board:  0.10,
    mainboard:    0.06,
    speaker:      0.07,
    remote:       0.15,
  },
  [CATEGORIES.REFRIGERATOR]: {
    compressor:   0.12,
    thermostat:   0.10,
    fan_motor:    0.15,
    door_seal:    0.20,
    ice_maker:    0.18,
    control_board:0.08,
  },
  [CATEGORIES.AIR_CONDITIONER]: {
    compressor:   0.15,
    fan_motor:    0.18,
    refrigerant:  0.12,
    capacitor:    0.20,
    control_board:0.10,
    filter_sensor:0.08,
  },
  [CATEGORIES.SMARTWATCH]: {
    battery:      0.52,  // Highest battery failure rate — small cells degrade fast
    display:      0.15,
    sensors:      0.12,
    charging_pin: 0.20,
    buttons:      0.10,
  },
  [CATEGORIES.AUDIO_DEVICE]: {
    battery:      0.45,
    driver_speaker:0.15,
    aux_connector:0.20,
    bluetooth:    0.10,
    charging_port:0.18,
    headband:     0.12,
  },
  [CATEGORIES.GAMING_CONSOLE]: {
    optical_drive:0.18,
    fan_cooling:  0.20,
    power_supply: 0.12,
    controller:   0.25,
    storage:      0.10,
    hdmi_port:    0.08,
  },
  [CATEGORIES.WASHING_MACHINE]: {
    motor:        0.15,
    drum_bearing: 0.18,
    door_lock:    0.20,
    pump:         0.15,
    control_board:0.10,
    water_inlet:  0.12,
  },
  [CATEGORIES.TABLET]: {
    battery:      0.40,
    display:      0.15,
    charging_port:0.18,
    speaker:      0.08,
    camera:       0.07,
    motherboard:  0.05,
  },
  [CATEGORIES.OTHER_ELECTRONICS]: {
    power_supply: 0.18,
    main_component:0.12,
    connectivity: 0.15,
    cooling:      0.10,
  },
});

// How issue types reported by users map to component risk escalation
const SYMPTOM_TO_COMPONENT_ESCALATION = {
  battery_failure:    { component: 'battery',       boost: 0.30 },
  display_failure:    { component: 'display',        boost: 0.25 },
  keyboard_failure:   { component: 'keyboard',       boost: 0.35 },
  speaker_failure:    { component: 'driver_speaker', boost: 0.25 },
  camera_failure:     { component: 'camera',         boost: 0.30 },
  port_failure:       { component: 'charging_port',  boost: 0.30 },
  motor_failure:      { component: 'motor',          boost: 0.35 },
  compressor_failure: { component: 'compressor',     boost: 0.35 },
  overheating:        { component: 'fan_cooling',    boost: 0.30 },
  no_power:           { component: 'power_supply',   boost: 0.25 },
  connectivity_issue: { component: 'bluetooth',      boost: 0.20 },
};

// Probability risk levels
function getRiskLabel(prob) {
  if (prob >= 0.6) return 'CRITICAL';
  if (prob >= 0.4) return 'HIGH';
  if (prob >= 0.2) return 'MEDIUM';
  if (prob >= 0.08) return 'LOW';
  return 'MINIMAL';
}

/**
 * Scales a base 3-year failure rate to a specific product age and
 * prediction horizon using the bathtub curve model.
 *
 * The bathtub curve has three phases:
 *   - Infant mortality (0–6 months): elevated failure from manufacturing defects
 *   - Normal life (6–30 months): lowest failure rate
 *   - Wear-out (30+ months): rising failure rate from component degradation
 */
function scaleFailureRate(baseRate3yr, daysOld, horizonDays) {
  const totalDays = 3 * 365;
  const ageFraction = Math.min(1.5, daysOld / totalDays); // allow going past 3yr

  // Bathtub multiplier: higher in early (infant) and late (wear) phases
  let phaseMultiplier;
  if (daysOld < 180) {
    // Infant mortality phase: 1.5x rate (decreasing linearly to 1x at 6 months)
    phaseMultiplier = 1.5 - (daysOld / 180) * 0.5;
  } else if (daysOld < 900) {
    // Normal life phase: 0.6x rate (most reliable period)
    phaseMultiplier = 0.6;
  } else {
    // Wear-out phase: rate increases from 0.6x at 30 months to 2x at 5 years
    const wearProgress = Math.min(1, (daysOld - 900) / (5 * 365 - 900));
    phaseMultiplier = 0.6 + wearProgress * 1.4;
  }

  // Scale the 3-year base rate to the prediction horizon
  const horizonFraction = Math.min(1, horizonDays / totalDays);

  // Final probability for this horizon, given current age phase
  return Math.min(0.99, baseRate3yr * horizonFraction * phaseMultiplier * 1.8);
}

/**
 * Generates failure predictions for a product.
 *
 * @param {object} graphNode  A product node from the WarrantyKnowledgeGraph.
 * @param {object} [options]
 * @param {number} [options.horizonDays=365] How far ahead to predict.
 * @param {string[]} [options.reportedSymptoms] Issue types already reported.
 * @param {object[]} [options.repairHistory] Past repairs from graph node.
 * @param {Date}   [options.referenceDate]
 */
export function predictFailures(graphNode, options = {}) {
  const {
    horizonDays = 365,
    reportedSymptoms = [],
    repairHistory = [],
    referenceDate = new Date(),
  } = options;

  const category = graphNode.category;
  const purchaseDate = graphNode.purchaseDate;

  const daysOld = purchaseDate
    ? Math.max(0, daysBetween(new Date(purchaseDate), referenceDate))
    : 365; // default to 1 year if unknown

  const baseRates = BASE_FAILURE_RATES[category] || BASE_FAILURE_RATES[CATEGORIES.OTHER_ELECTRONICS];

  // Build per-component probabilities
  const componentRisks = [];
  const repairData = getRepairCostData(category);

  for (const [component, baseRate] of Object.entries(baseRates)) {
    let probability = scaleFailureRate(baseRate, daysOld, horizonDays);

    // Boost for reported symptoms matching this component
    for (const symptom of reportedSymptoms) {
      const escalation = SYMPTOM_TO_COMPONENT_ESCALATION[symptom];
      if (escalation) {
        const compNorm = component.replace(/_/g, '').toLowerCase();
        const escNorm = escalation.component.replace(/_/g, '').toLowerCase();
        if (compNorm.includes(escNorm) || escNorm.includes(compNorm)) {
          probability = Math.min(0.97, probability + escalation.boost);
        }
      }
    }

    // Boost for prior repairs on this component (cascading failure effect)
    const relatedRepairs = repairHistory.filter((r) => {
      if (!r.issueType) return false;
      const esc = SYMPTOM_TO_COMPONENT_ESCALATION[r.issueType];
      if (!esc) return false;
      const compNorm = component.replace(/_/g, '').toLowerCase();
      return compNorm.includes(esc.component.replace(/_/g, '').toLowerCase());
    });
    if (relatedRepairs.length > 0) {
      probability = Math.min(0.97, probability + relatedRepairs.length * 0.15);
    }

    // Get repair cost range for this component from repairCostDatabase
    const costKey = component.replace(/_/g, '_');
    const costRange = repairData.repairCostRanges[costKey]
      || repairData.repairCostRanges['hardware_failure']
      || { min: 1000, median: 3000, max: 10000 };

    probability = Math.round(probability * 100) / 100;

    componentRisks.push({
      component: component.replace(/_/g, ' '),
      failureProbability: probability,
      failureProbabilityPercent: Math.round(probability * 100),
      riskLevel: getRiskLabel(probability),
      estimatedRepairCost: costRange,
      basis: buildBasis(probability, daysOld, reportedSymptoms, relatedRepairs, component),
    });
  }

  // Sort by failure probability descending
  componentRisks.sort((a, b) => b.failureProbability - a.failureProbability);

  // Overall failure probability = P(at least one component fails) = 1 - P(none fail)
  const overallFailureProbability = Math.round(
    (1 - componentRisks.reduce((product, c) => product * (1 - c.failureProbability), 1)) * 100
  ) / 100;

  const dominant = componentRisks[0];

  return {
    product: graphNode.productName,
    category,
    daysOld,
    predictionHorizonDays: horizonDays,
    predictionHorizonLabel: horizonDays <= 30 ? 'next 30 days' : horizonDays <= 90 ? 'next 3 months' : `next ${Math.round(horizonDays / 30)} months`,
    overallFailureProbability,
    overallFailureProbabilityPercent: Math.round(overallFailureProbability * 100),
    dominantRisk: dominant ? {
      component: dominant.component,
      probability: dominant.failureProbabilityPercent,
      riskLevel: dominant.riskLevel,
    } : null,
    componentRisks,
    repairHistory: repairHistory.length,
    reportedSymptomsConsidered: reportedSymptoms,
    generatedAt: referenceDate.toISOString(),
  };
}

function buildBasis(probability, daysOld, symptoms, repairs, component) {
  const reasons = [];
  if (daysOld < 180) reasons.push('early product life (infant mortality phase)');
  else if (daysOld > 900) reasons.push('product in wear-out phase');
  if (symptoms.length > 0) reasons.push(`${symptoms.length} related symptom(s) reported`);
  if (repairs.length > 0) reasons.push(`${repairs.length} prior repair(s) on this component`);
  if (reasons.length === 0) reasons.push('baseline category failure rate');
  return reasons.join('; ');
}

export default { predictFailures };
