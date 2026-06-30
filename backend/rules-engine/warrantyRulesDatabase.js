/**
 * warrantyRulesDatabase.js
 *
 * WARRANTY RULES KNOWLEDGE BASE
 *
 * Structured, extensible database of:
 *   1. COVERAGE_RULES  — what issues ARE covered by standard manufacturer warranty
 *   2. EXCLUSION_RULES — what is universally or category-specifically excluded
 *   3. ISSUE_KEYWORDS  — NLP mapping from natural-language issue descriptions
 *                        to structured issue types the decision engine can reason about
 *   4. COVERAGE_CONFIDENCE — baseline confidence that a given issue type is covered
 *                            for each category (some are universal, some are iffy)
 *   5. CLAIM_PROCEDURES — recommended action steps per category/scenario
 *
 * Design: each rule carries a `scope` ('universal' | category key), a weight
 * (how confidently this rule applies), and a human-readable explanation
 * surfaced directly to the user in the claim report. This makes the engine
 * fully transparent ("We believe this is excluded because...") rather than
 * emitting opaque scores.
 *
 * Extensibility: new categories, rules, and keyword mappings can be added
 * without touching any other file. The eligibility engine imports only the
 * exported structures and applies them algorithmically.
 */

// ─── ISSUE TYPE TAXONOMY ─────────────────────────────────────────────────────
// Canonical issue types used throughout the rules engine. Free-text user input
// gets mapped to one or more of these via ISSUE_KEYWORDS below.

export const ISSUE_TYPES = Object.freeze({
  // Hardware failures
  HARDWARE_FAILURE:       'hardware_failure',        // general "stopped working"
  DISPLAY_FAILURE:        'display_failure',          // screen dead/flickering/black
  BATTERY_FAILURE:        'battery_failure',          // won't charge, drains fast
  KEYBOARD_FAILURE:       'keyboard_failure',         // keys not working
  SPEAKER_FAILURE:        'speaker_failure',          // no sound / distorted audio
  CAMERA_FAILURE:         'camera_failure',           // camera not working
  PORT_FAILURE:           'port_failure',             // USB/charging port issues
  BUTTON_FAILURE:         'button_failure',           // physical buttons unresponsive
  MOTOR_FAILURE:          'motor_failure',            // motor/compressor in appliances
  COMPRESSOR_FAILURE:     'compressor_failure',       // AC/fridge compressor
  OVERHEATING:            'overheating',              // abnormal heat
  NO_POWER:               'no_power',                 // won't turn on at all

  // Damage types
  PHYSICAL_DAMAGE:        'physical_damage',          // cracks, dents, broken body
  LIQUID_DAMAGE:          'liquid_damage',            // water / spill damage
  SCREEN_CRACK:           'screen_crack',             // cracked display glass
  BURN_DAMAGE:            'burn_damage',              // fire/burn marks
  ACCIDENTAL_DAMAGE:      'accidental_damage',        // dropped, hit, etc.

  // Misuse / policy violations
  UNAUTHORIZED_REPAIR:    'unauthorized_repair',      // tampered by non-authorized tech
  ROOTING_JAILBREAK:      'rooting_jailbreak',        // software tampering
  COMMERCIAL_USE:         'commercial_use',           // used in commercial setting on consumer warranty
  CONSUMABLE_WEAR:        'consumable_wear',          // normal wear items: belts, filters, bulbs
  COSMETIC_DAMAGE:        'cosmetic_damage',          // scratches, dents with no functional impact
  NORMAL_WEAR:            'normal_wear',              // general aging/degradation over time

  // Software/connectivity
  SOFTWARE_ISSUE:         'software_issue',           // OS crash, app problems
  CONNECTIVITY_ISSUE:     'connectivity_issue',       // WiFi/Bluetooth problems

  // Unknown
  UNKNOWN:                'unknown',
});

// ─── ISSUE KEYWORD MAPPINGS ───────────────────────────────────────────────────
// Maps tokenized phrases from user's natural-language input to issue types.
// Each entry: { keywords: string[], issueType, confidence }
// keywords are matched case-insensitively as substrings / token sets.

export const ISSUE_KEYWORD_RULES = [
  // Hardware failures
  { keywords: ['keyboard', 'keys', 'key not working', 'key stopped', 'keypad'], issueType: ISSUE_TYPES.KEYBOARD_FAILURE, confidence: 0.92 },
  { keywords: ['screen', 'display', 'blank', 'black screen', 'no display', 'screen not working', 'monitor', 'lcd', 'oled'], issueType: ISSUE_TYPES.DISPLAY_FAILURE, confidence: 0.9 },
  { keywords: ['screen cracked', 'cracked screen', 'broken screen', 'shattered', 'glass broke', 'display cracked'], issueType: ISSUE_TYPES.SCREEN_CRACK, confidence: 0.95 },
  { keywords: ['battery', 'not charging', 'won\'t charge', 'drains fast', 'battery dead', 'won\'t hold charge', 'discharge'], issueType: ISSUE_TYPES.BATTERY_FAILURE, confidence: 0.88 },
  { keywords: ['speaker', 'audio', 'sound', 'no sound', 'distorted', 'buzzing sound', 'no audio'], issueType: ISSUE_TYPES.SPEAKER_FAILURE, confidence: 0.85 },
  { keywords: ['camera', 'front camera', 'back camera', 'webcam', 'camera not working', 'camera failed'], issueType: ISSUE_TYPES.CAMERA_FAILURE, confidence: 0.9 },
  { keywords: ['usb', 'charging port', 'port', 'socket', 'connector', 'hdmi port', 'headphone jack'], issueType: ISSUE_TYPES.PORT_FAILURE, confidence: 0.85 },
  { keywords: ['button', 'power button', 'volume button', 'home button', 'stuck button'], issueType: ISSUE_TYPES.BUTTON_FAILURE, confidence: 0.85 },
  { keywords: ['compressor', 'not cooling', 'cooling stopped', 'no cooling', 'ac not cooling', 'fridge not cooling'], issueType: ISSUE_TYPES.COMPRESSOR_FAILURE, confidence: 0.9 },
  { keywords: ['motor', 'drum not spinning', 'agitator', 'motor noise', 'washing not spinning'], issueType: ISSUE_TYPES.MOTOR_FAILURE, confidence: 0.87 },
  { keywords: ['overheating', 'overheat', 'too hot', 'burning hot', 'heating up'], issueType: ISSUE_TYPES.OVERHEATING, confidence: 0.85 },
  { keywords: ['won\'t turn on', 'not turning on', 'dead', 'no power', 'doesn\'t start', 'won\'t start', 'wont turn on'], issueType: ISSUE_TYPES.NO_POWER, confidence: 0.88 },

  // Damage
  { keywords: ['water damage', 'liquid damage', 'water spilled', 'dropped in water', 'wet', 'water entered', 'spilled water', 'rain damage'], issueType: ISSUE_TYPES.LIQUID_DAMAGE, confidence: 0.95 },
  { keywords: ['dropped', 'fell', 'fall damage', 'hit', 'impact', 'cracked body', 'dented', 'accidental'], issueType: ISSUE_TYPES.ACCIDENTAL_DAMAGE, confidence: 0.88 },
  { keywords: ['cracked back', 'broken', 'physical damage', 'body cracked', 'bent', 'crushed'], issueType: ISSUE_TYPES.PHYSICAL_DAMAGE, confidence: 0.9 },
  { keywords: ['scratched', 'scratch', 'cosmetic', 'dent', 'paint chip'], issueType: ISSUE_TYPES.COSMETIC_DAMAGE, confidence: 0.85 },
  { keywords: ['burnt', 'burn mark', 'fire', 'smell of burn', 'smoke'], issueType: ISSUE_TYPES.BURN_DAMAGE, confidence: 0.9 },

  // Policy violations
  { keywords: ['repaired elsewhere', 'local repair', 'third party repair', 'opened by', 'tampered'], issueType: ISSUE_TYPES.UNAUTHORIZED_REPAIR, confidence: 0.92 },
  { keywords: ['rooted', 'jailbreak', 'custom rom', 'unlocked bootloader', 'modified software'], issueType: ISSUE_TYPES.ROOTING_JAILBREAK, confidence: 0.93 },
  { keywords: ['commercial use', 'office use', 'business use', 'rental'], issueType: ISSUE_TYPES.COMMERCIAL_USE, confidence: 0.8 },
  { keywords: ['wear and tear', 'normal wear', 'aged', 'old', 'faded', 'worn out'], issueType: ISSUE_TYPES.NORMAL_WEAR, confidence: 0.75 },
  { keywords: ['filter', 'belt', 'brush', 'lamp', 'ink', 'toner', 'bulb', 'seal', 'gasket'], issueType: ISSUE_TYPES.CONSUMABLE_WEAR, confidence: 0.88 },

  // Software
  { keywords: ['software', 'os', 'operating system', 'crash', 'app crash', 'freezing', 'hung', 'hangs', 'slow'], issueType: ISSUE_TYPES.SOFTWARE_ISSUE, confidence: 0.8 },
  { keywords: ['wifi', 'bluetooth', 'network', 'connectivity', 'not connecting', 'signal'], issueType: ISSUE_TYPES.CONNECTIVITY_ISSUE, confidence: 0.78 },

  // Fallback
  { keywords: ['stopped working', 'not working', 'malfunction', 'defect', 'faulty', 'broken', 'failed'], issueType: ISSUE_TYPES.HARDWARE_FAILURE, confidence: 0.65 },
];

// ─── COVERAGE RULES ───────────────────────────────────────────────────────────
// Maps issue types to coverage decisions per product category.
// scope: 'universal' applies to ALL categories unless overridden by a category rule.
// overrides: per-category exceptions to the universal rule.

export const COVERAGE_RULES = [
  // --- COVERED (universal defaults) ---
  {
    issueType: ISSUE_TYPES.HARDWARE_FAILURE,
    covered: true,
    confidence: 0.8,
    scope: 'universal',
    reason: 'General hardware failures are typically covered under standard manufacturer warranty when not caused by external factors.',
  },
  {
    issueType: ISSUE_TYPES.DISPLAY_FAILURE,
    covered: true,
    confidence: 0.85,
    scope: 'universal',
    reason: 'Display failures (not caused by physical impact) are covered under manufacturer warranty for most product categories.',
    overrides: {
      Television: { covered: true, confidence: 0.9, reason: 'Panel failure is explicitly covered under standard TV manufacturer warranty.' },
    },
  },
  {
    issueType: ISSUE_TYPES.KEYBOARD_FAILURE,
    covered: true,
    confidence: 0.88,
    scope: 'universal',
    reason: 'Keyboard/input device failures from manufacturing defects are covered under standard warranty.',
  },
  {
    issueType: ISSUE_TYPES.SPEAKER_FAILURE,
    covered: true,
    confidence: 0.82,
    scope: 'universal',
    reason: 'Speaker failures due to manufacturing defects are generally covered.',
  },
  {
    issueType: ISSUE_TYPES.CAMERA_FAILURE,
    covered: true,
    confidence: 0.85,
    scope: 'universal',
    reason: 'Camera hardware failures are covered under manufacturer warranty.',
  },
  {
    issueType: ISSUE_TYPES.PORT_FAILURE,
    covered: true,
    confidence: 0.78,
    scope: 'universal',
    reason: 'Port/connector failures from manufacturing defects are typically covered.',
  },
  {
    issueType: ISSUE_TYPES.BUTTON_FAILURE,
    covered: true,
    confidence: 0.8,
    scope: 'universal',
    reason: 'Button failures from manufacturing defects are generally covered.',
  },
  {
    issueType: ISSUE_TYPES.NO_POWER,
    covered: true,
    confidence: 0.82,
    scope: 'universal',
    reason: 'Failure to power on (not caused by external damage) is covered under standard warranty.',
  },
  {
    issueType: ISSUE_TYPES.OVERHEATING,
    covered: true,
    confidence: 0.72,
    scope: 'universal',
    reason: 'Abnormal overheating from manufacturing defects is generally covered, though the service center will need to confirm the root cause.',
  },
  {
    issueType: ISSUE_TYPES.COMPRESSOR_FAILURE,
    covered: true,
    confidence: 0.9,
    scope: 'universal',
    reason: 'Compressor failures are covered — most ACs and refrigerators offer extended compressor warranty (often 5–10 years) beyond the standard product warranty.',
    overrides: {
      'Air Conditioner': { covered: true, confidence: 0.95, reason: 'Compressor failures in ACs are covered, often under an extended 5-10 year compressor-specific warranty even after the standard 1-year product warranty expires.' },
      Refrigerator: { covered: true, confidence: 0.92, reason: 'Compressor failures in refrigerators are covered, with many brands offering 10-year compressor warranty.' },
    },
  },
  {
    issueType: ISSUE_TYPES.MOTOR_FAILURE,
    covered: true,
    confidence: 0.85,
    scope: 'universal',
    reason: 'Motor failures are typically covered under standard and extended warranty for washing machines and other appliances.',
    overrides: {
      'Washing Machine': { covered: true, confidence: 0.9, reason: 'Motor failures in washing machines are covered, with many brands offering 5-10 year motor warranty.' },
    },
  },
  {
    issueType: ISSUE_TYPES.CONNECTIVITY_ISSUE,
    covered: true,
    confidence: 0.7,
    scope: 'universal',
    reason: 'WiFi/Bluetooth hardware failures are generally covered, though software-related connectivity issues may not be.',
  },
  {
    issueType: ISSUE_TYPES.BATTERY_FAILURE,
    covered: true,
    confidence: 0.6,
    scope: 'universal',
    reason: 'Battery failures are partially covered — manufacturers cover dead batteries in the first few months but often exclude gradual degradation beyond a threshold (typically <80% capacity after 6-12 months) as "normal wear".',
    overrides: {
      Smartphone: { covered: true, confidence: 0.55, reason: 'Smartphone batteries are covered for manufacturing defects but manufacturers typically exclude "normal degradation" (capacity loss below ~80%) as expected wear after extended use.' },
      Laptop: { covered: true, confidence: 0.5, reason: 'Laptop batteries have similar conditions — covered for defects but not general wear-induced capacity reduction.' },
    },
  },

  // --- NOT COVERED (universal exclusions) ---
  {
    issueType: ISSUE_TYPES.LIQUID_DAMAGE,
    covered: false,
    confidence: 0.97,
    scope: 'universal',
    reason: 'Liquid/water damage is universally excluded from standard manufacturer warranty across all product categories.',
  },
  {
    issueType: ISSUE_TYPES.SCREEN_CRACK,
    covered: false,
    confidence: 0.95,
    scope: 'universal',
    reason: 'Cracked/shattered screens from physical impact are excluded — this is physical accidental damage, not a manufacturing defect.',
  },
  {
    issueType: ISSUE_TYPES.ACCIDENTAL_DAMAGE,
    covered: false,
    confidence: 0.93,
    scope: 'universal',
    reason: 'Accidental damage (dropping, impact) is excluded from standard manufacturer warranty. Consider purchasing accidental damage protection (ADP) if available.',
  },
  {
    issueType: ISSUE_TYPES.PHYSICAL_DAMAGE,
    covered: false,
    confidence: 0.9,
    scope: 'universal',
    reason: 'Physical/mechanical damage from external causes is excluded from standard warranty.',
  },
  {
    issueType: ISSUE_TYPES.BURN_DAMAGE,
    covered: false,
    confidence: 0.92,
    scope: 'universal',
    reason: 'Damage from fire, excessive heat, or power surges is excluded from standard warranty.',
  },
  {
    issueType: ISSUE_TYPES.UNAUTHORIZED_REPAIR,
    covered: false,
    confidence: 0.95,
    scope: 'universal',
    reason: 'Prior unauthorized/third-party repair voids the manufacturer warranty. The warranty is only valid if the product has not been serviced by non-authorized personnel.',
  },
  {
    issueType: ISSUE_TYPES.ROOTING_JAILBREAK,
    covered: false,
    confidence: 0.93,
    scope: 'universal',
    reason: 'Rooting, jailbreaking, or installing unauthorized firmware voids the software warranty and can void the hardware warranty depending on the manufacturer.',
  },
  {
    issueType: ISSUE_TYPES.COMMERCIAL_USE,
    covered: false,
    confidence: 0.85,
    scope: 'universal',
    reason: 'Consumer warranties do not cover products used in commercial/business/rental settings — commercial use requires a commercial warranty.',
  },
  {
    issueType: ISSUE_TYPES.COSMETIC_DAMAGE,
    covered: false,
    confidence: 0.88,
    scope: 'universal',
    reason: 'Purely cosmetic damage (scratches, dents, fading) with no functional impact is excluded from warranty.',
  },
  {
    issueType: ISSUE_TYPES.CONSUMABLE_WEAR,
    covered: false,
    confidence: 0.9,
    scope: 'universal',
    reason: 'Consumable parts (filters, belts, bulbs, ink cartridges, etc.) that have a defined service life are not covered under standard product warranty — they are expected to be replaced periodically.',
  },
  {
    issueType: ISSUE_TYPES.NORMAL_WEAR,
    covered: false,
    confidence: 0.78,
    scope: 'universal',
    reason: 'General wear and tear from normal use over time is not a manufacturing defect and is excluded from warranty.',
  },
  {
    issueType: ISSUE_TYPES.SOFTWARE_ISSUE,
    covered: false,
    confidence: 0.65,
    scope: 'universal',
    reason: 'Pure software issues (app crashes, OS problems) are generally not covered under hardware warranty — manufacturers typically provide software support separately and may require a factory reset.',
    overrides: {
      Smartphone: { covered: false, confidence: 0.6, reason: 'Software issues on smartphones are rarely covered under hardware warranty — the manufacturer may assist with a factory reset but won\'t replace the device for software faults.' },
      Laptop: { covered: false, confidence: 0.65, reason: 'OS and software problems on laptops are not hardware warranty claims. The manufacturer may re-image the OS but this is a support service, not a warranty repair.' },
    },
  },
];

// ─── CLAIM PROCEDURES ─────────────────────────────────────────────────────────
// Recommended action steps, lookup by category and coverage decision.

export const CLAIM_PROCEDURES = Object.freeze({
  covered_standard: [
    'Locate your original purchase invoice and warranty card.',
    'Visit the nearest authorized service center for the brand. Do not use a local/unauthorized repair shop as it may void remaining warranty.',
    'Carry the product with all original accessories if possible.',
    'Describe the issue clearly and ask for a job sheet / service request number.',
    'The service center will diagnose and repair/replace the unit at no charge if the issue is covered.',
    'If repair is refused, ask for the reason in writing and escalate to the brand\'s consumer helpline.',
  ],
  covered_extended_component: [
    'Verify whether your specific component (e.g. compressor, motor) is under extended warranty — check your warranty card for the extended term.',
    'Contact the brand\'s authorized service center or helpline with your invoice and model number.',
    'Extended component warranties typically have their own claim process separate from the standard product warranty.',
    'Carry all original documentation including the extended warranty certificate if issued separately.',
  ],
  excluded_liquid_damage: [
    'Standard warranty does not cover liquid damage.',
    'Contact the service center for a paid repair estimate.',
    'Check if you purchased any accidental damage protection (ADP) plan — this may cover liquid damage.',
    'For future reference, consider purchasing an extended warranty or ADP plan that explicitly covers accidental/liquid damage.',
  ],
  excluded_physical_damage: [
    'Physical/accidental damage is excluded from standard warranty.',
    'Get a paid repair estimate from an authorized service center — using authorized service protects you from further warranty issues.',
    'If you have any accidental damage protection plan, file a claim under that instead.',
  ],
  excluded_unauthorized_repair: [
    'Prior unauthorized repair has voided the standard warranty.',
    'You may still get a paid repair from an authorized service center.',
    'In future, always use the manufacturer\'s authorized service network to preserve warranty validity.',
  ],
  excluded_general: [
    'This issue is not covered under standard manufacturer warranty.',
    'Contact an authorized service center for a paid diagnostic and repair estimate.',
    'Ask the service center to inspect whether there is any related manufacturing defect that IS covered — sometimes a covered defect causes a non-obvious secondary symptom.',
  ],
  expired_warranty: [
    'The product warranty has expired.',
    'Contact an authorized service center for a paid repair.',
    'Ask about any remaining extended warranty on specific components (e.g. compressor, motor) which may still be active.',
    'Compare the repair cost to replacement cost before deciding — a detailed repair estimate from the service center will help.',
  ],
  unknown_issue: [
    'Please describe the issue in more detail to get a more accurate coverage assessment.',
    'As a general step, visit an authorized service center for a professional diagnostic.',
    'Carry your original purchase invoice when visiting the service center.',
  ],
});

// ─── BRAND-SPECIFIC SERVICE CENTER CONTACT GUIDANCE ──────────────────────────
// Surface these in the claim recommendation so users know where to go.

export const BRAND_SERVICE_INFO = Object.freeze({
  Apple:    { helpline: 'Apple Support: support.apple.com or 1800-425-1692 (India)', bookOnline: true },
  Samsung:  { helpline: 'Samsung Care: 1800-5-726-7864 (India)', bookOnline: true },
  Sony:     { helpline: 'Sony Support: 1800-103-7799 (India)', bookOnline: false },
  Dell:     { helpline: 'Dell Support: 1800-425-4051 (India)', bookOnline: true },
  HP:       { helpline: 'HP Support: 1800-108-4747 (India)', bookOnline: true },
  Lenovo:   { helpline: 'Lenovo Support: 1800-419-7555 (India)', bookOnline: true },
  LG:       { helpline: 'LG Support: 1800-315-9999 (India)', bookOnline: true },
  Whirlpool:{ helpline: 'Whirlpool Support: 1800-208-1800 (India)', bookOnline: false },
  Voltas:   { helpline: 'Voltas Support: 1800-209-1800 (India)', bookOnline: false },
  Bose:     { helpline: 'Bose Support: bose.com/support', bookOnline: true },
});

export default {
  ISSUE_TYPES,
  ISSUE_KEYWORD_RULES,
  COVERAGE_RULES,
  CLAIM_PROCEDURES,
  BRAND_SERVICE_INFO,
};
