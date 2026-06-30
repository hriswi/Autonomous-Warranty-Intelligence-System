/**
 * reasoningEngine.js
 *
 * REASONING ENGINE
 *
 * Implements the core inference logic for the Warranty Knowledge Assistant.
 * Given an intent, extracted entities, conversation context, and a knowledge
 * graph, this engine:
 *
 *   1. Resolves which product(s) the query is about
 *   2. Retrieves the relevant knowledge graph subgraph
 *   3. Applies a reasoning chain specific to the intent
 *   4. Returns a structured reasoning result with:
 *      - answer: the direct answer to the user's question
 *      - reasoning: the inference steps taken (for transparency)
 *      - products: the product nodes involved
 *      - confidence: answer confidence
 *      - followUpSuggestions: contextual follow-up questions
 *
 * Each intent maps to a dedicated reasoning handler. Handlers are pure
 * functions that receive (intent, entities, context, graph) and return
 * a structured result. No hardcoded answers — all reasoning is derived
 * from graph state at query time.
 */

import { INTENTS } from './intentDetector.js';
import { evaluateWarrantyClaim } from '../../rules-engine/warrantyEligibilityEngine.js';
import { generateWarrantyAdvisory } from '../warrantyAdvisorEngine.js';
import { daysBetween, addMonths } from '../../utils/dateUtils.js';
import { normalizeKey } from '../../utils/textUtils.js';

// ── PRODUCT RESOLUTION ────────────────────────────────────────────────────────

/**
 * Resolves which product(s) the query is about, using entities and
 * conversation context as inputs to the knowledge graph.
 */
function resolveProducts(entities, context, graph) {
  const candidates = graph.getAllProducts();
  if (candidates.length === 0) return [];
  if (candidates.length === 1) return candidates;

  // Check for explicit broad quantifiers FIRST — these override specific resolution
  // including memory context. "When do ALL my warranties expire?" should always
  // return all products regardless of what's in the focus stack.
  const broadQuantifiers = ['all', 'compare', 'which', 'most', 'any'];
  const hasBroadQuantifier = entities.quantifiers.some((q) => broadQuantifiers.includes(q));
  if (hasBroadQuantifier) return candidates;

  const matches = [];

  if (entities.primaryBrand) {
    const byBrand = graph.getProductsByBrand(entities.primaryBrand);
    matches.push(...byBrand);
  }
  if (entities.primaryCategory && matches.length === 0) {
    const byCat = graph.getProductsByCategory(entities.primaryCategory);
    matches.push(...byCat);
  }
  for (const ref of entities.productRefs) {
    const found = graph.findProductByQuery(ref);
    if (found && !matches.find((m) => m.id === found.id)) matches.push(found);
  }
  if (matches.length === 0 && context.currentProductId) {
    const ctxProduct = graph.getProduct(context.currentProductId);
    if (ctxProduct) matches.push(ctxProduct);
  }
  return matches;
}

// ── RESPONSE FORMATTERS ───────────────────────────────────────────────────────

function formatWarrantyStatus(product, referenceDate = new Date()) {
  const t = product.warrantyTimeline;
  if (!t) return `warranty status unknown (insufficient invoice data)`;
  if (t.isExpired) return `warranty **expired** ${t.daysExpired} day(s) ago (${t.expiryDate})`;
  if (t.daysRemaining <= 7) return `warranty expires in **${t.daysRemaining} day(s)** on ${t.expiryDate} ⚠️ CRITICAL`;
  if (t.daysRemaining <= 30) return `warranty expires in **${t.daysRemaining} days** on ${t.expiryDate} ⚠️`;
  return `warranty active — **${t.daysRemaining} days remaining**, expires ${t.expiryDate}`;
}

function formatRisk(product) {
  if (!product.risk) return 'risk not assessed';
  const icons = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢', MINIMAL: '⚪' };
  const icon = icons[product.risk.riskLevel] || '';
  return `${icon} **${product.risk.riskScore}/100** (${product.risk.riskLevel})`;
}

// ── INTENT HANDLERS ───────────────────────────────────────────────────────────

function handleExpiryCheck(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  const reasoning = [];

  if (products.length === 0) {
    return noProductFound(graph, 'warranty expiry');
  }

  if (products.length === 1) {
    const p = products[0];
    reasoning.push(`Looked up warranty timeline for ${p.productName || p.brand || 'the product'}.`);
    if (!p.warrantyTimeline) {
      return {
        answer: `I don't have enough invoice data (purchase date or warranty duration) to determine the warranty expiry for **${p.productName}**. Please check that the invoice was parsed correctly.`,
        reasoning,
        products,
        confidence: 0.3,
        followUpSuggestions: ['What fields are missing from my invoice?'],
      };
    }
    const t = p.warrantyTimeline;
    reasoning.push(`Purchase date: ${p.purchaseDate}. Warranty: ${p.warrantyMonths} months. Expiry: ${t.expiryDate}.`);
    reasoning.push(`Days remaining: ${t.daysRemaining}. Status: ${t.isActive ? 'active' : 'expired'}.`);

    return {
      answer: `**${p.productName}** — ${formatWarrantyStatus(p)}\n\nPurchased: ${p.purchaseDate} | Warranty: ${p.warrantyMonths} months | Seller: ${p.seller || 'unknown'}`,
      reasoning,
      products,
      confidence: 0.9,
      followUpSuggestions: [
        t.daysRemaining <= 90 ? 'What should I do before it expires?' : null,
        t.daysRemaining <= 30 ? 'Should I book a service inspection?' : null,
        'What is the risk score for this product?',
      ].filter(Boolean),
    };
  }

  // Multiple products — give a summary table
  reasoning.push(`Checking warranty status for all ${products.length} matching products.`);
  const lines = products.map((p) => `• **${p.productName}**: ${formatWarrantyStatus(p)}`);
  return {
    answer: `Warranty status for ${products.length} product(s):\n\n${lines.join('\n')}`,
    reasoning,
    products,
    confidence: 0.88,
    followUpSuggestions: ['Which products are expiring in the next 30 days?', 'Which product has the highest risk?'],
  };
}

function handleClaimEligibility(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  const reasoning = [];

  if (products.length === 0) return noProductFound(graph, 'claim eligibility');

  const product = products[0]; // claim queries are usually single-product
  reasoning.push(`Evaluating claim eligibility for ${product.productName}.`);

  // Build a fake parsedInvoice shape from the graph node
  const parsedInvoice = graphNodeToInvoice(product);

  const issueDesc = entities.issueTypes.length > 0
    ? entities.issueTypes.map((i) => i.matchedKeywords.join(' ')).join(', ')
    : null;

  if (!issueDesc) {
    return {
      answer: `To check claim eligibility for **${product.productName}**, I need to know what issue you're experiencing. Could you describe the problem? (e.g. "keyboard stopped working", "screen cracked", "water damage")`,
      reasoning: [...reasoning, 'No issue description detected in the query.'],
      products,
      confidence: 0.4,
      followUpSuggestions: ['My keyboard stopped working', 'The screen cracked', 'It won\'t turn on'],
    };
  }

  reasoning.push(`Detected issue: ${issueDesc}.`);

  const eligibility = evaluateWarrantyClaim(issueDesc, parsedInvoice);
  reasoning.push(...eligibility.reasoning);

  const statusIcon = eligibility.covered ? '✅' : eligibility.covered === false ? '❌' : '⚠️';
  const viabilityLine = {
    HIGH: '**High probability of approval** — proceed with the claim.',
    MEDIUM: '**Moderate probability** — claim may be approved, but bring all documentation.',
    LOW: '**Low probability** — service center will need to verify; outcome uncertain.',
    DENIED: '**Claim likely denied** — this issue falls under an exclusion or the warranty has expired.',
    UNKNOWN: '**Outcome unclear** — visit an authorized service center for a professional assessment.',
  }[eligibility.claimViability] || '';

  const answer = [
    `${statusIcon} **${product.productName}** — Claim Eligibility Assessment`,
    '',
    `**Issue**: ${issueDesc}`,
    `**Warranty status**: ${formatWarrantyStatus(product)}`,
    `**Coverage decision**: ${eligibility.covered ? 'COVERED' : eligibility.covered === false ? 'EXCLUDED' : 'AMBIGUOUS'}`,
    `**Viability**: ${eligibility.claimViability} — ${viabilityLine}`,
    '',
    eligibility.coverageReason,
    '',
    eligibility.exclusionMatches.length > 0
      ? `**Exclusion**: ${eligibility.exclusionMatches[0].reason}`
      : null,
    '',
    '**Recommended steps:**',
    ...eligibility.recommendedSteps.slice(0, 4).map((s) => `${s}`),
  ].filter((l) => l !== null).join('\n');

  return {
    answer,
    reasoning,
    products,
    confidence: eligibility.coverageConfidence,
    followUpSuggestions: [
      'How do I find the nearest service center?',
      product.fraud?.warningLevel !== 'CLEAN' ? 'Why was my invoice flagged?' : null,
      'What documents do I need for the claim?',
    ].filter(Boolean),
  };
}

function handleRiskAnalysis(entities, context, graph) {
  const all = entities.quantifiers.includes('all') || entities.quantifiers.includes('compare');
  const products = all ? graph.getAllProducts() : resolveProducts(entities, context, graph);
  const reasoning = [];

  if (products.length === 0) return noProductFound(graph, 'risk analysis');

  reasoning.push(`Analysing risk for ${products.length} product(s).`);

  if (products.length === 1) {
    const p = products[0];
    if (!p.risk) return { answer: `Risk has not been computed for **${p.productName}**. Run the full pipeline to generate a risk score.`, reasoning, products, confidence: 0.3 };
    reasoning.push(`Risk score: ${p.risk.riskScore}/100 (${p.risk.riskLevel}).`);
    return {
      answer: `**${p.productName}** — Risk Analysis\n\nRisk Score: ${formatRisk(p)}\n\n${p.risk.recommendation}`,
      reasoning,
      products,
      confidence: 0.9,
      followUpSuggestions: ['What action should I take?', 'When does the warranty expire?'],
    };
  }

  // Multi-product: sort by risk score
  const sorted = [...products].filter((p) => p.risk).sort((a, b) => b.risk.riskScore - a.risk.riskScore);
  if (sorted.length === 0) {
    return { answer: 'Risk scores have not been computed for your products yet.', reasoning, products, confidence: 0.3 };
  }

  reasoning.push(`Sorted ${sorted.length} products by risk score descending.`);
  const lines = sorted.map((p) => `• **${p.productName}**: ${formatRisk(p)} — ${p.risk.recommendation.slice(0, 80)}...`);

  return {
    answer: `Product Risk Analysis (${sorted.length} products, highest risk first):\n\n${lines.join('\n')}`,
    reasoning,
    products: sorted,
    confidence: 0.88,
    followUpSuggestions: ['Tell me more about the highest risk product', 'Which products expire soon?'],
  };
}

function handleRepairCostQuery(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  if (products.length === 0) return noProductFound(graph, 'repair cost');

  const product = products[0];
  const reasoning = [`Fetching repair cost data for ${product.productName} (category: ${product.category}).`];

  if (!product.advisory?.repairCostEstimate) {
    return {
      answer: `Repair cost data is not available for **${product.productName}**. Run the full warranty advisory pipeline to generate estimates.`,
      reasoning, products, confidence: 0.3,
    };
  }

  const r = product.advisory.repairCostEstimate;
  reasoning.push(`Median repair: ₹${r.medianRepairCost}. Replacement: ₹${r.estimatedReplacementCost}.`);

  return {
    answer: [
      `**${product.productName}** — Repair Cost Estimate`,
      '',
      `• Median repair cost: **₹${r.medianRepairCost.toLocaleString('en-IN')}**`,
      `• Estimated replacement cost: **₹${r.estimatedReplacementCost.toLocaleString('en-IN')}**`,
      `• Repair-to-replacement ratio: **${r.repairToReplacementRatioPercent}%**`,
      '',
      r.repairToReplacementRatioPercent > 50
        ? '⚠️ Repair cost is more than 50% of replacement cost. Carefully weigh repair vs. replacement if the warranty has expired.'
        : '✅ Repair cost is reasonable relative to replacement. An authorized repair makes sense if outside warranty.',
      '',
      r.currencyNote,
    ].join('\n'),
    reasoning, products, confidence: 0.85,
    followUpSuggestions: ['Is my warranty still active?', 'Should I buy extended warranty?'],
  };
}

function handleFraudInvestigation(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  if (products.length === 0) return noProductFound(graph, 'fraud investigation');

  const product = products[0];
  const reasoning = [`Reviewing fraud analysis for ${product.productName}.`];

  if (!product.fraud) {
    return { answer: `Fraud analysis is not available for **${product.productName}**.`, reasoning, products, confidence: 0.3 };
  }

  const f = product.fraud;
  reasoning.push(`Fraud score: ${f.fraudScore}/100. Warning level: ${f.warningLevel}.`);

  const levelIcon = { CLEAN: '✅', SUSPICIOUS: '⚠️', HIGH_RISK: '🔴', FRAUDULENT: '❌' }[f.warningLevel] || '';
  const signalLines = f.signals.length > 0
    ? f.signals.map((s) => `• **${s.type}** (${s.severityLabel}): ${s.detail}`).join('\n')
    : 'No fraud signals detected.';

  return {
    answer: [
      `${levelIcon} **${product.productName}** — Invoice Fraud Analysis`,
      '',
      `Fraud Score: **${f.fraudScore}/100** | Warning Level: **${f.warningLevel}**`,
      '',
      f.signals.length > 0 ? `**Detected signals:**\n${signalLines}` : '**No fraud signals detected.**',
      '',
      f.warningLevel !== 'CLEAN' ? `**Recommended action**: ${product.fraud.recommendedAction || 'Verify manually before processing.'}` : null,
    ].filter(Boolean).join('\n'),
    reasoning, products, confidence: 0.9,
    followUpSuggestions: ['Can I still claim warranty?', 'How do I verify my invoice?'],
  };
}

function handleRecommendation(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  if (products.length === 0) return noProductFound(graph, 'recommendations');

  const product = products[0];
  const reasoning = [`Generating recommendations for ${product.productName}.`];

  const advisory = product.advisory;
  if (!advisory) {
    return { answer: `Advisory data not available for **${product.productName}**. Run the advisory pipeline first.`, reasoning, products, confidence: 0.3 };
  }

  reasoning.push(`Urgency: ${advisory.urgencyLevel} (${advisory.urgencyScore}/100).`);
  const actions = advisory.advisoryActions || [];
  const actionLines = actions.slice(0, 4).map((a, i) => `${i + 1}. **${a.title}**\n   ${a.detail}`).join('\n\n');

  return {
    answer: [
      `**${product.productName}** — Warranty Recommendations`,
      '',
      `Urgency: **${advisory.urgencyLevel}** (${advisory.urgencyScore}/100) | ${formatWarrantyStatus(product)}`,
      '',
      actionLines,
      advisory.extendedWarrantyRecommended ? '\n💡 **Extended warranty recommended**: ' + product.advisory.extendedWarrantyReason || 'Consider purchasing an extended warranty.' : null,
    ].filter(Boolean).join('\n'),
    reasoning, products, confidence: 0.88,
    followUpSuggestions: ['What is the repair cost?', 'What is my risk score?'],
  };
}

function handleProductLookup(entities, context, graph) {
  const all = entities.quantifiers.includes('all');
  const products = all ? graph.getAllProducts() : resolveProducts(entities, context, graph);

  if (products.length === 0) {
    const summary = graph.getSummary();
    return {
      answer: summary.totalProducts === 0
        ? 'No products have been added yet. Upload an invoice to get started.'
        : `You have **${summary.totalProducts}** product(s) tracked. ${summary.activeWarranties} with active warranties, ${summary.expiredWarranties} expired. Ask me about a specific product or say "show all products".`,
      reasoning: ['No specific product matched; returning overview.'],
      products: [],
      confidence: 0.7,
      followUpSuggestions: ['Show all my products', 'Which products are high risk?', 'Which warranties expire soon?'],
    };
  }

  if (products.length === 1) {
    const p = products[0];
    return {
      answer: [
        `**${p.productName}**`,
        `Brand: ${p.brand || 'unknown'} | Category: ${p.category || 'unknown'} | Seller: ${p.seller || 'unknown'}`,
        `Purchase date: ${p.purchaseDate || 'unknown'} | Invoice: ${p.invoiceNumber || 'unknown'} | Serial: ${p.serialNumber || 'unknown'}`,
        `Warranty: ${formatWarrantyStatus(p)}`,
        p.risk ? `Risk: ${formatRisk(p)}` : null,
        p.fraud && p.fraud.warningLevel !== 'CLEAN' ? `⚠️ Invoice fraud warning: ${p.fraud.warningLevel}` : null,
      ].filter(Boolean).join('\n'),
      reasoning: [`Direct lookup for ${p.productName}.`],
      products,
      confidence: 0.92,
      followUpSuggestions: ['Can I claim warranty?', 'What is the repair cost?', 'Show risk analysis'],
    };
  }

  const lines = products.map((p) => [
    `• **${p.productName}** (${p.brand || 'unknown'})`,
    `  ${formatWarrantyStatus(p)} | Risk: ${formatRisk(p)}`,
  ].join('\n'));

  return {
    answer: `Your **${products.length}** tracked products:\n\n${lines.join('\n')}`,
    reasoning: [`Returning overview of all ${products.length} products.`],
    products, confidence: 0.9,
    followUpSuggestions: ['Which products expire in the next 30 days?', 'Which is highest risk?'],
  };
}

function handleProductComparison(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  if (products.length < 2) {
    const all = graph.getAllProducts();
    if (all.length < 2) return { answer: 'Need at least 2 products to compare. Add more products first.', reasoning: [], products: [], confidence: 0.3 };
    return handleProductComparison({ ...entities, quantifiers: ['all'] }, context, graph);
  }

  const lines = products.map((p) => [
    `**${p.productName}**`,
    `  Warranty: ${formatWarrantyStatus(p)}`,
    `  Risk: ${formatRisk(p)}`,
    p.advisory ? `  Urgency: ${p.advisory.urgencyLevel} (${p.advisory.urgencyScore}/100)` : null,
    p.fraud && p.fraud.warningLevel !== 'CLEAN' ? `  ⚠️ Fraud: ${p.fraud.warningLevel}` : null,
  ].filter(Boolean).join('\n'));

  return {
    answer: `**Product Comparison** (${products.length} products):\n\n${lines.join('\n\n')}`,
    reasoning: [`Comparing ${products.length} products side by side.`],
    products, confidence: 0.88,
    followUpSuggestions: ['Which should I prioritize for service?', 'Which has the most warranty days left?'],
  };
}

function handleActionGuidance(entities, context, graph) {
  const products = resolveProducts(entities, context, graph);
  if (products.length === 0) {
    // General action guidance: look at all expiring/high-risk products
    const urgent = graph.getProductsExpiringSoon(90);
    const highRisk = graph.getHighRiskProducts(65);
    const combined = [...new Set([...urgent, ...highRisk].map((p) => p.id))].map((id) => graph.getProduct(id));
    if (combined.length === 0) return { answer: 'All your products appear to be in a stable state. No immediate action needed.', reasoning: ['No urgent or high-risk products detected.'], products: [], confidence: 0.8 };
    return handleActionGuidance(entities, { ...context }, { ...graph, getAllProducts: () => combined, resolveProducts: () => combined });
  }

  const product = products[0];
  const advisory = product.advisory;
  if (!advisory?.advisoryActions?.length) {
    return { answer: `No specific action guidance available for **${product.productName}**. Ensure the full pipeline has been run.`, reasoning: [], products, confidence: 0.3 };
  }

  const priorityAction = advisory.advisoryActions[0];
  return {
    answer: [
      `**${product.productName}** — Recommended Action`,
      '',
      `**${priorityAction.title}**`,
      priorityAction.detail,
      '',
      advisory.advisoryActions.length > 1
        ? `Additional actions:\n${advisory.advisoryActions.slice(1, 3).map((a) => `• ${a.title}`).join('\n')}`
        : null,
    ].filter(Boolean).join('\n'),
    reasoning: [`Returning top advisory action for ${product.productName}.`],
    products, confidence: 0.88,
    followUpSuggestions: ['What is my risk score?', 'How do I book a service?'],
  };
}

// ── HELPERS ───────────────────────────────────────────────────────────────────

function noProductFound(graph, context) {
  const summary = graph.getSummary();
  return {
    answer: `I couldn't identify which product you're asking about for ${context}. ${
      summary.totalProducts === 0
        ? 'No products have been added yet.'
        : `You have ${summary.totalProducts} product(s) tracked: ${summary.products.map((p) => p.name).join(', ')}. Please specify which one.`
    }`,
    reasoning: ['No product matched the query entities or conversation context.'],
    products: [],
    confidence: 0.2,
    followUpSuggestions: ['Show all my products', 'Tell me about my laptop'],
  };
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
    overallConfidence: node.overallConfidence,
    fieldConfidence: node.fieldConfidence || {},
    allWarrantyMentions: node.warrantyMonths ? [{ months: node.warrantyMonths, isPrimary: true, component: null }] : [],
  };
}

// ── MAIN REASONING DISPATCH ───────────────────────────────────────────────────

const INTENT_HANDLERS = {
  [INTENTS.WARRANTY_EXPIRY_CHECK]:    handleExpiryCheck,
  [INTENTS.CLAIM_ELIGIBILITY_CHECK]:  handleClaimEligibility,
  [INTENTS.PRODUCT_LOOKUP]:           handleProductLookup,
  [INTENTS.RISK_ANALYSIS]:            handleRiskAnalysis,
  [INTENTS.REPAIR_COST_QUERY]:        handleRepairCostQuery,
  [INTENTS.FRAUD_INVESTIGATION]:      handleFraudInvestigation,
  [INTENTS.RECOMMENDATION_REQUEST]:   handleRecommendation,
  [INTENTS.PRODUCT_COMPARISON]:       handleProductComparison,
  [INTENTS.ACTION_GUIDANCE]:          handleActionGuidance,
  [INTENTS.INVOICE_QUERY]:            handleProductLookup, // invoice queries delegate to product lookup
  [INTENTS.GENERAL_WARRANTY_INFO]:    handleProductLookup,
};

export function reason(intent, entities, context, graph) {
  const handler = INTENT_HANDLERS[intent] || handleProductLookup;
  try {
    return handler(entities, context, graph);
  } catch (err) {
    return {
      answer: `I encountered an error while processing your request: ${err.message}. Please try rephrasing your question.`,
      reasoning: [`Error in handler for intent ${intent}: ${err.message}`],
      products: [],
      confidence: 0,
      followUpSuggestions: ['Show all my products'],
    };
  }
}

export default { reason };
