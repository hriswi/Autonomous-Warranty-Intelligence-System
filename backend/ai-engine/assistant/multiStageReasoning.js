/**
 * multiStageReasoning.js
 *
 * MULTI-STAGE REASONING PIPELINE
 *
 * Every query goes through an explicit reasoning chain rather than jumping
 * directly to an answer. The chain is:
 *
 *   Stage 1: PRODUCT RESOLUTION   — identify which product(s) the query concerns
 *   Stage 2: CONTEXT RETRIEVAL    — gather all relevant data from graph + memory + external
 *   Stage 3: WARRANTY STATUS      — determine if warranty is active/expired/unknown
 *   Stage 4: ISSUE CLASSIFICATION — classify the reported problem (if any)
 *   Stage 5: EXCLUSION SCREENING  — check all applicable exclusion rules
 *   Stage 6: COVERAGE ASSESSMENT  — determine coverage given exclusions + rules DB
 *   Stage 7: FRAUD AUDIT          — check invoice integrity
 *   Stage 8: RISK INTEGRATION     — incorporate risk score and failure prediction
 *   Stage 9: CONFIDENCE SCORING   — aggregate confidence from all signals
 *   Stage 10: ANSWER GENERATION   — produce explainable, structured answer
 *
 * Each stage produces a StageResult: { stage, status, output, confidence, notes[] }
 * The full chain is included in the response for transparency (Explainable AI).
 *
 * Not all stages run for every query — the pipeline is intent-driven:
 * a "warranty expiry" query skips stages 4-6 (no issue to assess).
 * A "compare all products" query runs stages 1-3 and 8-10 only.
 */

import { INTENTS } from './intentDetector.js';
import { reason } from './reasoningEngine.js';
import { predictFailures } from './failurePredictionEngine.js';
import { evaluateWarrantyClaim } from '../../rules-engine/warrantyEligibilityEngine.js';
import { retrieveWarrantyPolicy, formatRetrievedContext } from './externalKnowledgeRetrieval.js';
import { daysBetween, addMonths } from '../../utils/dateUtils.js';

// Stage status values
const STAGE_STATUS = Object.freeze({
  COMPLETED:  'COMPLETED',
  SKIPPED:    'SKIPPED',
  FAILED:     'FAILED',
  DEGRADED:   'DEGRADED', // completed with reduced confidence
});

// Which stages run for each intent
const STAGE_MAP = Object.freeze({
  [INTENTS.WARRANTY_EXPIRY_CHECK]:    [1, 2, 3, 9, 10],
  [INTENTS.CLAIM_ELIGIBILITY_CHECK]:  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  [INTENTS.PRODUCT_LOOKUP]:           [1, 2, 9, 10],
  [INTENTS.RISK_ANALYSIS]:            [1, 2, 3, 8, 9, 10],
  [INTENTS.REPAIR_COST_QUERY]:        [1, 2, 8, 9, 10],
  [INTENTS.FRAUD_INVESTIGATION]:      [1, 2, 7, 9, 10],
  [INTENTS.RECOMMENDATION_REQUEST]:   [1, 2, 3, 7, 8, 9, 10],
  [INTENTS.PRODUCT_COMPARISON]:       [1, 2, 3, 8, 9, 10],
  [INTENTS.ACTION_GUIDANCE]:          [1, 2, 3, 7, 8, 9, 10],
  [INTENTS.INVOICE_QUERY]:            [1, 2, 7, 9, 10],
  [INTENTS.GENERAL_WARRANTY_INFO]:    [1, 2, 3, 9, 10],
});

function makeStage(stageNum, name) {
  return { stage: stageNum, name, status: STAGE_STATUS.SKIPPED, output: null, confidence: null, notes: [] };
}

/**
 * Runs the full multi-stage reasoning pipeline for one query turn.
 *
 * @param {object} nluFrame     Output of nluEngine.parseQuery()
 * @param {object} context      Output of memoryEngine.getContext()
 * @param {object} graph        WarrantyKnowledgeGraph instance
 * @param {Date}   referenceDate
 * @returns {Promise<object>}   Full reasoning result with chain + answer
 */
export async function runReasoningChain(nluFrame, context, graph, referenceDate = new Date()) {
  const chain = {
    1: makeStage(1, 'Product Resolution'),
    2: makeStage(2, 'Context Retrieval'),
    3: makeStage(3, 'Warranty Status'),
    4: makeStage(4, 'Issue Classification'),
    5: makeStage(5, 'Exclusion Screening'),
    6: makeStage(6, 'Coverage Assessment'),
    7: makeStage(7, 'Fraud Audit'),
    8: makeStage(8, 'Risk Integration'),
    9: makeStage(9, 'Confidence Scoring'),
    10: makeStage(10, 'Answer Generation'),
  };

  const stagesForIntent = STAGE_MAP[nluFrame.intent] || [1, 2, 9, 10];
  const shouldRun = (n) => stagesForIntent.includes(n);

  let resolvedProducts = [];
  let externalContext = null;
  let warrantyStatuses = [];
  let eligibilityResult = null;
  let confidenceFactors = [];

  // ── STAGE 1: PRODUCT RESOLUTION ─────────────────────────────────────────
  if (shouldRun(1)) {
    const s = chain[1];
    try {
      resolvedProducts = resolveProductsFromNlu(nluFrame, context, graph);
      s.status = STAGE_STATUS.COMPLETED;
      s.output = resolvedProducts.map((p) => ({ id: p.id, name: p.productName, brand: p.brand }));
      s.confidence = resolvedProducts.length > 0 ? 0.92 : 0.2;
      s.notes.push(resolvedProducts.length > 0
        ? `Resolved ${resolvedProducts.length} product(s): ${resolvedProducts.map((p) => p.productName).join(', ')}`
        : 'No products resolved from query entities or context.'
      );
      if (nluFrame.entities.resolvedFromContext) {
        s.notes.push('Product resolved from conversation memory (pronoun coreference).');
        s.confidence *= 0.9; // slight penalty for context-inferred reference
      }
    } catch (err) {
      s.status = STAGE_STATUS.FAILED;
      s.notes.push(`Error: ${err.message}`);
    }
  }

  // ── STAGE 2: CONTEXT RETRIEVAL ───────────────────────────────────────────
  if (shouldRun(2)) {
    const s = chain[2];
    try {
      // Retrieve external knowledge if a brand was identified
      const brand = nluFrame.entities.primaryBrand
        || (resolvedProducts[0]?.brand)
        || null;

      if (brand) {
        const retrieved = await retrieveWarrantyPolicy(brand, resolvedProducts[0]?.productName);
        externalContext = formatRetrievedContext(retrieved);
        s.notes.push(externalContext?.source === 'web_retrieval'
          ? `External warranty policy retrieved for ${brand} from ${externalContext.url}`
          : `Using internal fallback policy for ${brand} (${retrieved?.reason || 'external retrieval skipped'})`
        );
      } else {
        s.notes.push('No brand identified — skipping external knowledge retrieval.');
      }

      s.status = STAGE_STATUS.COMPLETED;
      s.output = { externalContext, graphProducts: resolvedProducts.length };
      s.confidence = 0.88;
    } catch (err) {
      s.status = STAGE_STATUS.DEGRADED;
      s.notes.push(`Context retrieval partially failed: ${err.message}`);
    }
  }

  // ── STAGE 3: WARRANTY STATUS ─────────────────────────────────────────────
  if (shouldRun(3)) {
    const s = chain[3];
    try {
      warrantyStatuses = resolvedProducts.map((p) => {
        const t = p.warrantyTimeline;
        if (!t) return { productId: p.id, status: 'unknown', reason: 'No purchase date or warranty duration in invoice.' };
        return {
          productId: p.id,
          productName: p.productName,
          status: t.isActive ? 'active' : 'expired',
          daysRemaining: t.daysRemaining,
          expiryDate: t.expiryDate,
          warrantyMonths: p.warrantyMonths,
          confidence: p.fieldConfidence?.purchaseDate >= 0.6 ? 0.9 : 0.6,
        };
      });
      s.status = STAGE_STATUS.COMPLETED;
      s.output = warrantyStatuses;
      s.confidence = warrantyStatuses.length > 0 ? Math.max(...warrantyStatuses.map((w) => w.confidence || 0)) : 0;
      s.notes.push(...warrantyStatuses.map((w) =>
        `${w.productName}: warranty ${w.status}${w.status === 'active' ? `, ${w.daysRemaining} days remaining` : w.status === 'expired' ? `, expired ${Math.abs(w.daysRemaining)} days ago` : ''}`
      ));
    } catch (err) {
      s.status = STAGE_STATUS.FAILED;
      s.notes.push(`Error: ${err.message}`);
    }
  }

  // ── STAGE 4: ISSUE CLASSIFICATION ───────────────────────────────────────
  if (shouldRun(4)) {
    const s = chain[4];
    const issues = nluFrame.entities.issueTypes;
    if (issues.length > 0) {
      s.status = STAGE_STATUS.COMPLETED;
      s.output = issues;
      s.confidence = issues[0].confidence;
      s.notes.push(`Primary issue: ${issues[0].issueType} (${Math.round(issues[0].confidence * 100)}% confidence)`);
      if (issues.length > 1) s.notes.push(`Secondary: ${issues.slice(1, 3).map((i) => i.issueType).join(', ')}`);
      if (nluFrame.conditionModifier !== 'UNKNOWN') {
        s.notes.push(`Damage condition: ${nluFrame.conditionModifier} (may trigger exclusion rules)`);
      }
    } else {
      s.status = STAGE_STATUS.DEGRADED;
      s.confidence = 0.3;
      s.notes.push('No specific issue type identified from query. Coverage assessment will be ambiguous.');
    }
  }

  // ── STAGE 5 & 6: EXCLUSION SCREENING + COVERAGE ASSESSMENT ──────────────
  if (shouldRun(5) && shouldRun(6)) {
    const s5 = chain[5];
    const s6 = chain[6];
    try {
      if (resolvedProducts.length > 0 && nluFrame.entities.issueTypes.length > 0) {
        const product = resolvedProducts[0];
        const issueDesc = nluFrame.entities.issueTypes
          .flatMap((i) => i.matchedKeywords)
          .join(' ');

        const fakeInvoice = graphNodeToInvoice(product);
        eligibilityResult = evaluateWarrantyClaim(issueDesc, fakeInvoice, referenceDate);

        s5.status = STAGE_STATUS.COMPLETED;
        s5.output = eligibilityResult.exclusionMatches;
        s5.confidence = eligibilityResult.exclusionMatches.length > 0
          ? eligibilityResult.exclusionMatches[0].confidence : 0.9;
        s5.notes.push(eligibilityResult.exclusionMatches.length > 0
          ? `${eligibilityResult.exclusionMatches.length} exclusion rule(s) triggered: ${eligibilityResult.exclusionMatches.map((e) => e.issueType).join(', ')}`
          : 'No exclusion rules triggered.'
        );

        s6.status = STAGE_STATUS.COMPLETED;
        s6.output = { covered: eligibilityResult.covered, confidence: eligibilityResult.coverageConfidence, reason: eligibilityResult.coverageReason };
        s6.confidence = eligibilityResult.coverageConfidence;
        s6.notes.push(`Coverage decision: ${eligibilityResult.covered === true ? 'COVERED' : eligibilityResult.covered === false ? 'EXCLUDED' : 'AMBIGUOUS'} (${Math.round(eligibilityResult.coverageConfidence * 100)}%)`);

        // Cross-reference with external context if available
        if (externalContext?.keyExclusions?.length > 0) {
          const issueNorm = nluFrame.raw.toLowerCase();
          const matchedExtExclusion = externalContext.keyExclusions.find((excl) => issueNorm.includes(excl.split(' ').slice(0, 2).join(' ').toLowerCase()));
          if (matchedExtExclusion) {
            s6.notes.push(`External source also confirms exclusion: "${matchedExtExclusion}"`);
          }
        }
      } else {
        s5.status = STAGE_STATUS.SKIPPED;
        s6.status = STAGE_STATUS.SKIPPED;
        s5.notes.push('No product or issue resolved — exclusion check skipped.');
        s6.notes.push('Coverage assessment skipped due to insufficient inputs.');
      }
    } catch (err) {
      chain[5].status = STAGE_STATUS.FAILED;
      chain[6].status = STAGE_STATUS.FAILED;
      chain[5].notes.push(`Error: ${err.message}`);
    }
  }

  // ── STAGE 7: FRAUD AUDIT ─────────────────────────────────────────────────
  if (shouldRun(7)) {
    const s = chain[7];
    const fraudSummaries = resolvedProducts.map((p) => ({
      productId: p.id,
      name: p.productName,
      fraudScore: p.fraud?.fraudScore ?? null,
      warningLevel: p.fraud?.warningLevel ?? 'NOT_ASSESSED',
    }));
    s.status = STAGE_STATUS.COMPLETED;
    s.output = fraudSummaries;
    const maxFraud = Math.max(...fraudSummaries.map((f) => f.fraudScore || 0));
    s.confidence = maxFraud < 30 ? 0.95 : maxFraud < 55 ? 0.75 : 0.45;
    s.notes.push(...fraudSummaries.map((f) =>
      `${f.name}: ${f.warningLevel}${f.fraudScore !== null ? ` (score: ${f.fraudScore}/100)` : ''}`
    ));
    if (maxFraud >= 55) {
      s.notes.push('⚠️ Invoice fraud concerns may affect claim outcome — service center may request additional verification.');
    }
  }

  // ── STAGE 8: RISK INTEGRATION ────────────────────────────────────────────
  if (shouldRun(8)) {
    const s = chain[8];
    try {
      const riskSummaries = resolvedProducts.map((p) => {
        const reportedIssues = (context.longTermFacts?.[`reported_issue_${p.id}`]?.issues || []).map((i) => i.issueType);
        const prediction = predictFailures(p, {
          horizonDays: 365,
          reportedSymptoms: reportedIssues,
          repairHistory: p.repairHistory || [],
          referenceDate,
        });
        return {
          productId: p.id,
          name: p.productName,
          riskScore: p.risk?.riskScore ?? null,
          riskLevel: p.risk?.riskLevel ?? null,
          failurePrediction: {
            overallPercent: prediction.overallFailureProbabilityPercent,
            dominantRisk: prediction.dominantRisk,
          },
        };
      });
      s.status = STAGE_STATUS.COMPLETED;
      s.output = riskSummaries;
      s.confidence = 0.85;
      s.notes.push(...riskSummaries.map((r) =>
        `${r.name}: risk score ${r.riskScore ?? 'N/A'} (${r.riskLevel ?? 'N/A'}), ${r.failurePrediction.overallPercent}% failure probability in next year, dominant: ${r.failurePrediction.dominantRisk?.component ?? 'unknown'}`
      ));
    } catch (err) {
      s.status = STAGE_STATUS.DEGRADED;
      s.notes.push(`Risk integration partially failed: ${err.message}`);
    }
  }

  // ── STAGE 9: CONFIDENCE SCORING ──────────────────────────────────────────
  if (shouldRun(9)) {
    const s = chain[9];
    confidenceFactors = [];

    const completedStages = Object.values(chain).filter((st) => st.status === STAGE_STATUS.COMPLETED);
    const avgStageConf = completedStages.length > 0
      ? completedStages.reduce((sum, st) => sum + (st.confidence || 0), 0) / completedStages.length
      : 0.5;

    confidenceFactors.push({ factor: 'stage_average', value: avgStageConf });
    confidenceFactors.push({ factor: 'product_resolved', value: resolvedProducts.length > 0 ? 0.95 : 0.2 });
    confidenceFactors.push({ factor: 'intent_confidence', value: nluFrame.intentConfidence });

    if (eligibilityResult) {
      confidenceFactors.push({ factor: 'eligibility_coverage', value: eligibilityResult.coverageConfidence });
    }

    const overallConfidence = Math.round(
      (confidenceFactors.reduce((sum, f) => sum + f.value, 0) / confidenceFactors.length) * 100
    ) / 100;

    s.status = STAGE_STATUS.COMPLETED;
    s.output = { overallConfidence, factors: confidenceFactors };
    s.confidence = overallConfidence;
    s.notes.push(`Overall reasoning confidence: ${Math.round(overallConfidence * 100)}%`);
    s.notes.push(`Contributing factors: ${confidenceFactors.map((f) => `${f.factor}=${Math.round(f.value * 100)}%`).join(', ')}`);
  }

  // ── STAGE 10: ANSWER GENERATION ──────────────────────────────────────────
  if (shouldRun(10)) {
    const s = chain[10];
    try {
      // Delegate final answer generation to the reasoning engine which handles
      // all intent-specific formatting
      const reasoningResult = reason(nluFrame.intent, nluFrame.entities, {
        ...context,
        eligibilityResult,
        externalContext,
        warrantyStatuses,
        chain, // pass the chain so the formatter can incorporate reasoning steps
      }, graph);

      // Append reasoning trace to answer (Explainable AI)
      const trace = buildReasoningTrace(chain, stagesForIntent);
      const fullAnswer = reasoningResult.answer + '\n\n' + trace;

      s.status = STAGE_STATUS.COMPLETED;
      s.output = { answer: fullAnswer, rawAnswer: reasoningResult.answer };
      s.confidence = 0.95;
      s.notes.push(`Answer generated via intent handler: ${nluFrame.intent}`);

      const overallConf = chain[9]?.output?.overallConfidence ?? 0.7;

      return {
        answer: fullAnswer,
        rawAnswer: reasoningResult.answer,
        reasoningTrace: trace,
        chain: Object.values(chain).map((st) => ({
          stage: st.stage,
          name: st.name,
          status: st.status,
          confidence: st.confidence,
          notes: st.notes,
        })),
        products: reasoningResult.products || resolvedProducts,
        overallConfidence: overallConf,
        followUpSuggestions: reasoningResult.followUpSuggestions || [],
        eligibilityResult,
        externalContext,
      };
    } catch (err) {
      s.status = STAGE_STATUS.FAILED;
      s.notes.push(`Answer generation failed: ${err.message}`);
    }
  }

  // Fallback if stage 10 failed
  return {
    answer: 'I encountered an issue generating a complete answer. Please try rephrasing your question.',
    reasoningTrace: '',
    chain: Object.values(chain).map((st) => ({ stage: st.stage, name: st.name, status: st.status, notes: st.notes })),
    products: resolvedProducts,
    overallConfidence: 0.2,
    followUpSuggestions: [],
  };
}

function buildReasoningTrace(chain, stagesRun) {
  const completed = Object.values(chain).filter((s) => stagesRun.includes(s.stage) && s.status !== STAGE_STATUS.SKIPPED);
  if (completed.length === 0) return '';

  const lines = completed.map((s) => {
    const icon = s.status === STAGE_STATUS.COMPLETED ? '✓' : s.status === STAGE_STATUS.DEGRADED ? '~' : '✗';
    const confStr = s.confidence !== null ? ` (${Math.round(s.confidence * 100)}%)` : '';
    const noteStr = s.notes.length > 0 ? `\n  → ${s.notes.join('\n  → ')}` : '';
    return `${icon} Stage ${s.stage}: ${s.name}${confStr}${noteStr}`;
  });

  return `---\n**Reasoning chain:**\n${lines.join('\n')}`;
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function resolveProductsFromNlu(nluFrame, context, graph) {
  const { entities } = nluFrame;
  const candidates = graph.getAllProducts();
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return candidates;

  // Broad quantifiers always return all products, regardless of memory focus
  const broadQuantifiers = ['all', 'compare', 'which', 'most', 'any'];
  const hasBroadQuantifier = entities.quantifiers.some((q) => broadQuantifiers.includes(q));
  const analyticalIntents = ['risk_analysis', 'product_comparison', 'action_guidance'];
  const isAnalyticalIntent = analyticalIntents.includes(nluFrame.intent);
  if (hasBroadQuantifier || isAnalyticalIntent) return candidates;

  const matches = [];

  if (entities.primaryBrand) {
    matches.push(...graph.getProductsByBrand(entities.primaryBrand));
  }
  if (entities.primaryCategory && matches.length === 0) {
    matches.push(...graph.getProductsByCategory(entities.primaryCategory));
  }
  for (const ref of entities.productRefs) {
    const found = graph.findProductByQuery(ref);
    if (found && !matches.find((m) => m.id === found.id)) matches.push(found);
  }
  if (matches.length === 0 && context.currentProductId) {
    const p = graph.getProduct(context.currentProductId);
    if (p) matches.push(p);
  }
  return matches;
}

function graphNodeToInvoice(node) {
  return {
    productName: node.productName,
    brand: node.brand,
    category: node.category,
    seller: node.seller,
    invoiceNumber: node.invoiceNumber,
    serialNumber: node.serialNumber,
    purchaseDate: node.purchaseDate,
    warrantyMonths: node.warrantyMonths,
    expectedWarrantyMonths: node.expectedWarrantyMonths,
    overallConfidence: node.overallConfidence || 0.5,
    fieldConfidence: node.fieldConfidence || {},
    allWarrantyMentions: node.warrantyMonths ? [{ months: node.warrantyMonths, isPrimary: true, component: null }] : [],
  };
}

export default { runReasoningChain };
