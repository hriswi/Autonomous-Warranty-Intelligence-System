/**
 * intentDetector.js
 *
 * INTENT DETECTION ENGINE
 *
 * Classifies a natural-language query into one or more warranty-domain
 * intent categories using weighted keyword pattern matching.
 *
 * Intents:
 *   warranty_expiry_check   — "when does my warranty expire?"
 *   claim_eligibility_check — "can I claim warranty for X?"
 *   product_lookup          — "tell me about my Samsung TV"
 *   risk_analysis           — "which products are high risk?"
 *   repair_cost_query       — "how much will repair cost?"
 *   fraud_investigation     — "why was my invoice flagged?"
 *   recommendation_request  — "should I buy extended warranty?"
 *   product_comparison      — "compare my products"
 *   action_guidance         — "what should I do now?"
 *   invoice_query           — "show me invoice details"
 *   general_warranty_info   — general warranty questions
 *
 * Returns primary intent + confidence + secondary intents.
 * Used by the reasoning engine to route queries to the right handlers.
 */

import { normalizeKey } from '../../utils/textUtils.js';

export const INTENTS = Object.freeze({
  WARRANTY_EXPIRY_CHECK:    'warranty_expiry_check',
  CLAIM_ELIGIBILITY_CHECK:  'claim_eligibility_check',
  PRODUCT_LOOKUP:           'product_lookup',
  RISK_ANALYSIS:            'risk_analysis',
  REPAIR_COST_QUERY:        'repair_cost_query',
  FRAUD_INVESTIGATION:      'fraud_investigation',
  RECOMMENDATION_REQUEST:   'recommendation_request',
  PRODUCT_COMPARISON:       'product_comparison',
  ACTION_GUIDANCE:          'action_guidance',
  INVOICE_QUERY:            'invoice_query',
  GENERAL_WARRANTY_INFO:    'general_warranty_info',
});

// Each rule: { patterns: string[], intent, weight }
// Patterns are matched as substrings against normalizeKey(query).
const INTENT_RULES = [
  // WARRANTY EXPIRY
  { patterns: ['when does', 'when will', 'expire', 'expiry', 'expiration', 'how long', 'days left', 'days remaining', 'valid until', 'valid till', 'warranty end', 'warranty left'], intent: INTENTS.WARRANTY_EXPIRY_CHECK, weight: 3 },

  // CLAIM ELIGIBILITY
  { patterns: ['can i claim', 'is it covered', 'will warranty cover', 'claim warranty', 'covered under', 'eligible', 'eligibility', 'make a claim', 'submit claim', 'warranty claim', 'under warranty'], intent: INTENTS.CLAIM_ELIGIBILITY_CHECK, weight: 4 },
  { patterns: ['stopped working', 'not working', 'broken', 'issue with', 'problem with', 'my laptop', 'my phone', 'my tv', 'my fridge', 'keyboard stopped', 'screen broke', 'wont turn on', 'won\'t turn on'], intent: INTENTS.CLAIM_ELIGIBILITY_CHECK, weight: 2 },

  // PRODUCT LOOKUP
  { patterns: ['tell me about', 'show me', 'details of', 'what is', 'info about', 'information about', 'my products', 'product details', 'show product'], intent: INTENTS.PRODUCT_LOOKUP, weight: 2 },

  // RISK ANALYSIS
  { patterns: ['risk', 'risky', 'high risk', 'failure', 'likely to fail', 'probability', 'which products', 'most at risk', 'risk score', 'risk level'], intent: INTENTS.RISK_ANALYSIS, weight: 3 },

  // REPAIR COST
  { patterns: ['repair cost', 'how much', 'cost to repair', 'repair price', 'service cost', 'fix cost', 'repair estimate', 'repair charges'], intent: INTENTS.REPAIR_COST_QUERY, weight: 3 },

  // FRAUD / SUSPICIOUS
  { patterns: ['fraud', 'suspicious', 'flagged', 'marked suspicious', 'fake invoice', 'fraud score', 'warning', 'why was', 'why is it flagged', 'invoice problem'], intent: INTENTS.FRAUD_INVESTIGATION, weight: 4 },

  // RECOMMENDATION
  { patterns: ['should i', 'recommend', 'advice', 'advise', 'worth it', 'extended warranty', 'buy extended', 'what do you suggest', 'what should i buy', 'is it worth'], intent: INTENTS.RECOMMENDATION_REQUEST, weight: 3 },

  // COMPARISON — high weight so "compare" clearly beats risk_analysis
  // Also add compound patterns for "compare risk/scores" queries
  { patterns: ['compare', 'comparison', 'versus', ' vs ', 'which is better', 'difference between', 'all products', 'list all', 'show all', 'rank', 'side by side'], intent: INTENTS.PRODUCT_COMPARISON, weight: 5 },
  { patterns: ['compare risk', 'compare all', 'compare my', 'compare devices', 'compare products'], intent: INTENTS.PRODUCT_COMPARISON, weight: 8 },

  // ACTION GUIDANCE — high weight so "what should I do" beats expiry check
  { patterns: ['what should i do', 'what action', 'next step', 'next steps', 'what to do', 'before warranty', 'before expiry', 'take action', 'book service', 'visit service', 'how do i proceed'], intent: INTENTS.ACTION_GUIDANCE, weight: 5 },

  // INVOICE QUERY
  { patterns: ['invoice', 'receipt', 'bill', 'purchase date', 'invoice number', 'invoice details', 'show invoice'], intent: INTENTS.INVOICE_QUERY, weight: 2 },

  // GENERAL WARRANTY INFO
  { patterns: ['warranty', 'guarantee', 'what is covered', 'exclusion', 'not covered', 'manufacturer warranty', 'standard warranty'], intent: INTENTS.GENERAL_WARRANTY_INFO, weight: 1 },
];

/**
 * Detects intent(s) from a natural-language warranty query.
 *
 * @param {string} query
 * @returns {{
 *   primaryIntent: string,
 *   primaryConfidence: number,
 *   allIntents: Array<{ intent, score, matchedPatterns }>,
 *   isAmbiguous: boolean,
 * }}
 */
export function detectIntent(query) {
  if (!query || !query.trim()) {
    return {
      primaryIntent: INTENTS.GENERAL_WARRANTY_INFO,
      primaryConfidence: 0.1,
      allIntents: [],
      isAmbiguous: true,
    };
  }

  const norm = normalizeKey(query);
  const scores = new Map();

  for (const rule of INTENT_RULES) {
    const matched = rule.patterns.filter((p) => norm.includes(normalizeKey(p)));
    if (matched.length === 0) continue;

    const score = matched.length * rule.weight;
    const existing = scores.get(rule.intent);
    if (!existing || score > existing.score) {
      scores.set(rule.intent, { intent: rule.intent, score, matchedPatterns: matched });
    }
  }

  if (scores.size === 0) {
    return {
      primaryIntent: INTENTS.GENERAL_WARRANTY_INFO,
      primaryConfidence: 0.2,
      allIntents: [{ intent: INTENTS.GENERAL_WARRANTY_INFO, score: 1, matchedPatterns: [] }],
      isAmbiguous: true,
    };
  }

  const sorted = [...scores.values()].sort((a, b) => b.score - a.score);
  const maxScore = sorted[0].score;
  const total = sorted.reduce((s, x) => s + x.score, 0);

  const primaryConfidence = Math.min(0.98, maxScore / total + (sorted.length === 1 ? 0.2 : 0));
  const isAmbiguous = sorted.length > 1 && (sorted[1].score / maxScore) > 0.7;

  return {
    primaryIntent: sorted[0].intent,
    primaryConfidence: Math.round(primaryConfidence * 100) / 100,
    allIntents: sorted,
    isAmbiguous,
  };
}

export default { detectIntent, INTENTS };
