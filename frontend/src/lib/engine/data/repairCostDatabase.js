/**
 * repairCostDatabase.js
 *
 * Local knowledge base of typical repair costs (INR) and historical
 * failure rates by product category. Used by:
 *   - Smart Warranty Advisor Engine (repair vs replace recommendations)
 *   - Product Risk Scoring Engine (failure probability weighting)
 *
 * All values are median estimates based on Indian consumer electronics
 * service center pricing patterns. No external API.
 *
 * Structure per category:
 *   medianRepairCost:   typical total repair cost for the most common fault
 *   repairCostRanges:   per-issue-type min/max/median estimates
 *   historicalFailureRate: probability (0-1) that this category needs a
 *                         repair event within the warranty period
 *   reliabilityScore:  industry reliability rating 0-100 (higher = more reliable,
 *                      fewer premature failures)
 *   replacementCostMultiple: how many "median repairs" does full replacement
 *                            cost? Used for replace-vs-repair recommendation.
 */

import { CATEGORIES } from '../classifier/productDatabase.js';

export const REPAIR_COST_DB = Object.freeze({
  [CATEGORIES.SMARTPHONE]: {
    medianRepairCost: 4500,
    repairCostRanges: {
      display_failure:    { min: 4000,  median: 7000,  max: 18000 },
      screen_crack:       { min: 3500,  median: 6000,  max: 16000 },
      battery_failure:    { min: 1200,  median: 2000,  max: 4000  },
      speaker_failure:    { min: 800,   median: 1500,  max: 3000  },
      camera_failure:     { min: 2000,  median: 3500,  max: 8000  },
      port_failure:       { min: 600,   median: 1200,  max: 2500  },
      no_power:           { min: 1500,  median: 3000,  max: 8000  },
      hardware_failure:   { min: 2000,  median: 4000,  max: 12000 },
      liquid_damage:      { min: 2000,  median: 6000,  max: 15000 },
    },
    historicalFailureRate: 0.12,
    reliabilityScore: 82,
    replacementCostMultiple: 18, // phone costs ~18x median repair
  },

  [CATEGORIES.LAPTOP]: {
    medianRepairCost: 6500,
    repairCostRanges: {
      display_failure:    { min: 5000,  median: 9000,  max: 22000 },
      screen_crack:       { min: 4500,  median: 8000,  max: 20000 },
      keyboard_failure:   { min: 1500,  median: 3500,  max: 7000  },
      battery_failure:    { min: 2500,  median: 4500,  max: 9000  },
      no_power:           { min: 2000,  median: 5000,  max: 15000 },
      hardware_failure:   { min: 3000,  median: 7000,  max: 20000 },
      liquid_damage:      { min: 3000,  median: 8000,  max: 20000 },
      port_failure:       { min: 1000,  median: 2500,  max: 5000  },
    },
    historicalFailureRate: 0.15,
    reliabilityScore: 78,
    replacementCostMultiple: 8,
  },

  [CATEGORIES.TELEVISION]: {
    medianRepairCost: 5500,
    repairCostRanges: {
      display_failure:    { min: 5000,  median: 12000, max: 35000 },
      no_power:           { min: 1500,  median: 3500,  max: 8000  },
      speaker_failure:    { min: 1000,  median: 2500,  max: 5000  },
      hardware_failure:   { min: 2000,  median: 5500,  max: 15000 },
      connectivity_issue: { min: 800,   median: 2000,  max: 5000  },
    },
    historicalFailureRate: 0.08,
    reliabilityScore: 86,
    replacementCostMultiple: 7,
  },

  [CATEGORIES.REFRIGERATOR]: {
    medianRepairCost: 3500,
    repairCostRanges: {
      compressor_failure: { min: 3000,  median: 7000,  max: 15000 },
      motor_failure:      { min: 1500,  median: 3000,  max: 6000  },
      no_power:           { min: 1000,  median: 2500,  max: 5000  },
      hardware_failure:   { min: 1500,  median: 4000,  max: 10000 },
    },
    historicalFailureRate: 0.07,
    reliabilityScore: 88,
    replacementCostMultiple: 10,
  },

  [CATEGORIES.AIR_CONDITIONER]: {
    medianRepairCost: 3000,
    repairCostRanges: {
      compressor_failure: { min: 4000,  median: 9000,  max: 20000 },
      no_power:           { min: 1000,  median: 2500,  max: 5000  },
      hardware_failure:   { min: 1500,  median: 3500,  max: 8000  },
      connectivity_issue: { min: 500,   median: 1500,  max: 3000  },
    },
    historicalFailureRate: 0.1,
    reliabilityScore: 84,
    replacementCostMultiple: 8,
  },

  [CATEGORIES.SMARTWATCH]: {
    medianRepairCost: 3000,
    repairCostRanges: {
      display_failure:    { min: 2500,  median: 5000,  max: 12000 },
      battery_failure:    { min: 1500,  median: 3000,  max: 6000  },
      hardware_failure:   { min: 2000,  median: 4000,  max: 10000 },
    },
    historicalFailureRate: 0.14,
    reliabilityScore: 76,
    replacementCostMultiple: 5,
  },

  [CATEGORIES.AUDIO_DEVICE]: {
    medianRepairCost: 2000,
    repairCostRanges: {
      speaker_failure:    { min: 800,   median: 2000,  max: 6000  },
      no_power:           { min: 500,   median: 1500,  max: 4000  },
      battery_failure:    { min: 800,   median: 1800,  max: 4000  },
      hardware_failure:   { min: 1000,  median: 2500,  max: 7000  },
    },
    historicalFailureRate: 0.1,
    reliabilityScore: 82,
    replacementCostMultiple: 7,
  },

  [CATEGORIES.GAMING_CONSOLE]: {
    medianRepairCost: 5000,
    repairCostRanges: {
      no_power:           { min: 2000,  median: 5000,  max: 12000 },
      hardware_failure:   { min: 3000,  median: 6000,  max: 15000 },
      display_failure:    { min: 2000,  median: 4000,  max: 10000 },
    },
    historicalFailureRate: 0.09,
    reliabilityScore: 85,
    replacementCostMultiple: 9,
  },

  [CATEGORIES.WASHING_MACHINE]: {
    medianRepairCost: 3000,
    repairCostRanges: {
      motor_failure:      { min: 2000,  median: 5000,  max: 12000 },
      no_power:           { min: 1000,  median: 2500,  max: 5000  },
      hardware_failure:   { min: 1500,  median: 3500,  max: 8000  },
    },
    historicalFailureRate: 0.11,
    reliabilityScore: 80,
    replacementCostMultiple: 8,
  },

  [CATEGORIES.TABLET]: {
    medianRepairCost: 4000,
    repairCostRanges: {
      display_failure:    { min: 3000,  median: 7000,  max: 18000 },
      screen_crack:       { min: 2500,  median: 6000,  max: 15000 },
      battery_failure:    { min: 1500,  median: 3000,  max: 6000  },
      hardware_failure:   { min: 2000,  median: 4500,  max: 12000 },
    },
    historicalFailureRate: 0.1,
    reliabilityScore: 83,
    replacementCostMultiple: 9,
  },

  [CATEGORIES.CAMERA]: {
    medianRepairCost: 4500,
    repairCostRanges: {
      hardware_failure:   { min: 2000,  median: 5000,  max: 15000 },
      camera_failure:     { min: 3000,  median: 6000,  max: 18000 },
    },
    historicalFailureRate: 0.07,
    reliabilityScore: 88,
    replacementCostMultiple: 8,
  },

  [CATEGORIES.OTHER_ELECTRONICS]: {
    medianRepairCost: 3000,
    repairCostRanges: {
      hardware_failure:   { min: 1000,  median: 3000,  max: 10000 },
      no_power:           { min: 800,   median: 2000,  max: 6000  },
    },
    historicalFailureRate: 0.1,
    reliabilityScore: 78,
    replacementCostMultiple: 6,
  },
});

/**
 * Returns the repair cost data for a given category,
 * falling back to OTHER_ELECTRONICS if no specific data exists.
 */
export function getRepairCostData(category) {
  return REPAIR_COST_DB[category] || REPAIR_COST_DB[CATEGORIES.OTHER_ELECTRONICS];
}

/**
 * Returns a specific issue-type cost range for a category,
 * falling back to hardware_failure if the specific type isn't in the DB.
 */
export function getRepairCostRange(category, issueType) {
  const data = getRepairCostData(category);
  const normalizedType = issueType?.replace(/_/g, '_');
  return data.repairCostRanges[normalizedType] || data.repairCostRanges['hardware_failure'] || { min: 1000, median: 3000, max: 10000 };
}

export default { REPAIR_COST_DB, getRepairCostData, getRepairCostRange };
