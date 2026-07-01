/**
 * nluEngine.js
 *
 * ADVANCED NATURAL LANGUAGE UNDERSTANDING ENGINE
 *
 * Goes beyond keyword matching to build a semantic parse of the user's
 * query. Extracts a structured understanding frame that drives the
 * multi-stage reasoning pipeline.
 *
 * Extracted frame:
 *   intent            — primary intent (from intentDetector)
 *   entities          — structured entities (from entityExtractor)
 *   urgencyLevel      — CRITICAL / HIGH / MEDIUM / LOW / NONE (inferred from language)
 *   timeContext       — PAST / PRESENT / FUTURE / UNKNOWN
 *   queryType         — FACTUAL / DIAGNOSTIC / PREDICTIVE / ANALYTICAL / PROCEDURAL
 *   sentimentSignals  — signals of user frustration, confusion, urgency
 *   conditionModifier — ACCIDENTAL / PHYSICAL / LIQUID / WEAR / DEFECT / UNKNOWN
 *   temporalRef       — e.g. "yesterday", "last year", "in 5 days"
 *   negationPresent   — true if query contains negation ("not covered", "won't work")
 *   compoundQuery     — true if query has multiple distinct sub-questions
 *   languageComplexity— SIMPLE / MODERATE / COMPLEX (affects answer verbosity)
 *
 * The NLU frame is the single input to the reasoning pipeline — the
 * reasoning engine never touches raw text, only this structured frame.
 */

import { detectIntent, INTENTS } from './intentDetector.js';
import { extractEntities } from './entityExtractor.js';
import { normalizeKey } from '../../utils/textUtils.js';

// ── URGENCY SIGNAL PATTERNS ───────────────────────────────────────────────────
const URGENCY_PATTERNS = [
  { level: 'CRITICAL', patterns: ['urgent', 'immediately', 'right now', 'asap', 'emergency', 'critical', 'expiring today', 'expires today', 'last day', 'only have', 'dying', 'dead', 'completely broken', 'stopped working completely'] },
  { level: 'HIGH',     patterns: ['soon', 'quickly', 'need to know', 'worried', 'concerned', 'few days', 'this week', 'before it expires', 'just broke', 'just died', 'suddenly', 'just stopped'] },
  { level: 'MEDIUM',   patterns: ['should i', 'wondering', 'thinking about', 'plan to', 'might', 'could', 'yesterday', 'last week', 'recently', 'starting to'] },
  { level: 'LOW',      patterns: ['eventually', 'someday', 'curious', 'just wondering', 'not urgent', 'when i get a chance'] },
];

// ── TIME CONTEXT PATTERNS ─────────────────────────────────────────────────────
const TIME_CONTEXT_PATTERNS = {
  PAST:    ['yesterday', 'last week', 'last month', 'last year', 'ago', 'previously', 'used to', 'already', 'had been', 'bought', 'purchased', 'got'],
  FUTURE:  ['will', 'going to', 'planning to', 'soon', 'in the future', 'when it', 'if it', 'before it', 'expire', 'expiry', 'extension'],
  PRESENT: ['now', 'currently', 'today', 'right now', 'is not', 'stopped', 'broken', 'failing', 'having issues', 'not working'],
};

// ── QUERY TYPE PATTERNS ───────────────────────────────────────────────────────
const QUERY_TYPE_PATTERNS = {
  FACTUAL:    ['when', 'what', 'how long', 'how much', 'what is', 'show me', 'tell me', 'which date', 'invoice number', 'serial number'],
  DIAGNOSTIC: ['why', 'why is', 'what caused', 'is it because', 'suspicious', 'flagged', 'explain'],
  PREDICTIVE: ['will it', 'probability', 'likely', 'predict', 'chance', 'might fail', 'risk of', 'expected to'],
  ANALYTICAL: ['compare', 'best', 'worst', 'highest', 'lowest', 'all products', 'rank', 'most', 'least', 'which product'],
  PROCEDURAL: ['how do i', 'how can i', 'steps to', 'what should i do', 'how to', 'process for', 'claim process'],
};

// ── CONDITION MODIFIER PATTERNS ───────────────────────────────────────────────
const CONDITION_MODIFIERS = {
  ACCIDENTAL:  ['dropped', 'fell', 'accident', 'accidentally', 'hit', 'impact', 'cracked body', 'knocked'],
  PHYSICAL:    ['cracked', 'broken', 'shattered', 'bent', 'dented', 'crushed', 'physical'],
  LIQUID:      ['water', 'spilled', 'wet', 'liquid', 'rain', 'moisture', 'drink', 'flooded'],
  WEAR:        ['old', 'aged', 'worn', 'degraded', 'fading', 'slow', 'degrading', 'over time', 'health dropped'],
  DEFECT:      ['defect', 'defective', 'manufacturing', 'factory', 'out of the box', 'brand new', 'never dropped', 'no damage'],
};

// ── SENTIMENT / FRUSTRATION SIGNALS ──────────────────────────────────────────
const SENTIMENT_PATTERNS = {
  frustrated:  ['frustrated', 'annoyed', 'ridiculous', 'useless', 'waste', 'terrible', 'awful', 'bad', 'horrible', 'hate'],
  confused:    ["don't understand", "not sure", "confused", "unclear", "what does", "what do you mean", "don't know"],
  anxious:     ['worried', 'concerned', 'nervous', 'scared', 'afraid', 'panic', 'stress'],
  urgent_tone: ['please', 'help', 'need', 'asap', 'quickly', 'hurry'],
};

// ── NEGATION DETECTION ────────────────────────────────────────────────────────
const NEGATION_PATTERNS = /\b(not|no|never|won't|wont|can't|cant|doesn't|doesnt|didn't|didnt|isn't|isnt|aren't|arent|wasn't|wasnt|wouldn't|wouldnt|shouldn't|shouldnt|couldn't|couldnt)\b/i;

/**
 * Builds a full semantic NLU frame from a raw query string and
 * optional conversation context.
 *
 * @param {string} query
 * @param {object} [context] Conversation context for coreference resolution.
 * @returns {object} Full NLU frame.
 */
export function parseQuery(query, context = {}) {
  if (!query || !query.trim()) {
    return buildEmptyFrame(query);
  }

  const raw = query.trim();
  const norm = normalizeKey(raw);

  // ── CORE DETECTION ─────────────────────────────────────────────────────
  const intentResult = detectIntent(raw);
  const entities = extractEntities(raw, context);

  // ── URGENCY ────────────────────────────────────────────────────────────
  let urgencyLevel = 'NONE';
  let urgencyEvidence = [];
  for (const { level, patterns } of URGENCY_PATTERNS) {
    const matched = patterns.filter((p) => norm.includes(normalizeKey(p)));
    if (matched.length > 0) {
      urgencyLevel = level;
      urgencyEvidence = matched;
      break; // Patterns are ordered CRITICAL→LOW, first match wins
    }
  }

  // Override urgency from entities: explicit short time ranges = urgency
  if (entities.primaryTimeRangeDays !== null) {
    if (entities.primaryTimeRangeDays <= 7 && urgencyLevel === 'NONE') urgencyLevel = 'CRITICAL';
    else if (entities.primaryTimeRangeDays <= 30 && urgencyLevel === 'NONE') urgencyLevel = 'HIGH';
  }

  // ── TIME CONTEXT ───────────────────────────────────────────────────────
  const timeScores = { PAST: 0, PRESENT: 0, FUTURE: 0 };
  for (const [ctx, patterns] of Object.entries(TIME_CONTEXT_PATTERNS)) {
    for (const p of patterns) {
      if (norm.includes(normalizeKey(p))) timeScores[ctx]++;
    }
  }
  const timeContext = Object.entries(timeScores).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(timeScores).sort((a, b) => b[1] - a[1])[0][0]
    : 'UNKNOWN';

  // ── QUERY TYPE ─────────────────────────────────────────────────────────
  const typeScores = {};
  for (const [type, patterns] of Object.entries(QUERY_TYPE_PATTERNS)) {
    typeScores[type] = patterns.filter((p) => norm.includes(normalizeKey(p))).length;
  }
  const queryType = Object.entries(typeScores).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(typeScores).sort((a, b) => b[1] - a[1])[0][0]
    : 'FACTUAL';

  // ── CONDITION MODIFIER ─────────────────────────────────────────────────
  let conditionModifier = 'UNKNOWN';
  for (const [mod, patterns] of Object.entries(CONDITION_MODIFIERS)) {
    if (patterns.some((p) => norm.includes(normalizeKey(p)))) {
      conditionModifier = mod;
      break;
    }
  }

  // ── SENTIMENT ──────────────────────────────────────────────────────────
  const sentimentSignals = {};
  for (const [signal, patterns] of Object.entries(SENTIMENT_PATTERNS)) {
    const matched = patterns.filter((p) => norm.includes(normalizeKey(p)));
    if (matched.length > 0) sentimentSignals[signal] = matched;
  }

  // ── NEGATION ───────────────────────────────────────────────────────────
  const negationPresent = NEGATION_PATTERNS.test(raw);

  // ── COMPOUND QUERY ─────────────────────────────────────────────────────
  // A compound query has multiple clauses joined by AND/OR/also/and/plus
  const compoundQuery = /\b(and also|and then|also|additionally|plus|furthermore|as well as)\b/i.test(raw)
    || (raw.split('?').filter((s) => s.trim()).length > 1);

  // ── LANGUAGE COMPLEXITY ────────────────────────────────────────────────
  const wordCount = raw.split(/\s+/).length;
  const languageComplexity = wordCount <= 8 ? 'SIMPLE' : wordCount <= 20 ? 'MODERATE' : 'COMPLEX';

  // ── IMPLICIT ISSUE FROM CONDITION ─────────────────────────────────────
  // If entities has no issueType but condition modifier implies one, inject it
  if (entities.issueTypes.length === 0 && conditionModifier !== 'UNKNOWN') {
    const conditionIssueMap = {
      LIQUID:    'liquid_damage',
      PHYSICAL:  'physical_damage',
      ACCIDENTAL:'accidental_damage',
      WEAR:      'normal_wear',
    };
    const impliedIssue = conditionIssueMap[conditionModifier];
    if (impliedIssue) {
      entities.issueTypes.push({ issueType: impliedIssue, confidence: 0.7, matchedKeywords: [conditionModifier.toLowerCase()], implicit: true });
      entities.primaryIssueType = impliedIssue;
    }
  }

  return {
    raw,
    intent: intentResult.primaryIntent,
    intentConfidence: intentResult.primaryConfidence,
    allIntents: intentResult.allIntents,
    isAmbiguousIntent: intentResult.isAmbiguous,
    entities,
    urgencyLevel,
    urgencyEvidence,
    timeContext,
    queryType,
    conditionModifier,
    sentimentSignals,
    negationPresent,
    compoundQuery,
    languageComplexity,
    parsedAt: new Date().toISOString(),
  };
}

function buildEmptyFrame(raw) {
  return {
    raw: raw || '',
    intent: INTENTS.GENERAL_WARRANTY_INFO,
    intentConfidence: 0.1,
    allIntents: [],
    isAmbiguousIntent: true,
    entities: { brands: [], categories: [], issueTypes: [], timeRefs: [], productRefs: [], quantifiers: [], resolvedFromContext: false, primaryBrand: null, primaryCategory: null, primaryIssueType: null, primaryTimeRangeDays: null },
    urgencyLevel: 'NONE',
    urgencyEvidence: [],
    timeContext: 'UNKNOWN',
    queryType: 'FACTUAL',
    conditionModifier: 'UNKNOWN',
    sentimentSignals: {},
    negationPresent: false,
    compoundQuery: false,
    languageComplexity: 'SIMPLE',
    parsedAt: new Date().toISOString(),
  };
}

export default { parseQuery };
