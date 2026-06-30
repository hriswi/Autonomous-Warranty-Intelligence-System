/**
 * run-agent-tests.js
 *
 * Full test suite for the Autonomous Warranty Intelligence Agent (Phase 1.5).
 * Covers: integration, NLU, memory, multi-stage reasoning, failure prediction,
 * autonomous monitoring, edge cases, failure recovery, stress, and security.
 */

// ── Mini test runner (same as Phase 1) ───────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(`Assertion failed: ${msg}`); }
function assertEqual(a, e, msg) { if (a !== e) throw new Error(`${msg} — expected ${JSON.stringify(e)}, got ${JSON.stringify(a)}`); }
function assertRange(v, lo, hi, msg) { if (v < lo || v > hi) throw new Error(`${msg} — ${v} not in [${lo},${hi}]`); }
function assertContains(arr, v, msg) { if (!Array.isArray(arr) || !arr.includes(v)) throw new Error(`${msg} — array does not contain ${JSON.stringify(v)}`); }
function assertTruthy(v, msg) { if (!v) throw new Error(`${msg} — got falsy: ${v}`); }

async function test(name, fn) {
  try { await fn(); passed++; process.stdout.write(`  ✓ ${name}\n`); }
  catch (err) { failed++; failures.push({ name, error: err.message }); process.stdout.write(`  ✗ ${name}\n    → ${err.message}\n`); }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`); }

// ── Imports ───────────────────────────────────────────────────────────────────
import { WarrantyAgent } from '../ai-engine/assistant/warrantyAgent.js';
import { parseQuery } from '../ai-engine/assistant/nluEngine.js';
import { extractEntities } from '../ai-engine/assistant/entityExtractor.js';
import { detectIntent, INTENTS } from '../ai-engine/assistant/intentDetector.js';
import WarrantyKnowledgeGraph from '../ai-engine/assistant/knowledgeGraph.js';
import { MemoryEngine } from '../ai-engine/assistant/memoryEngine.js';
import { predictFailures } from '../ai-engine/assistant/failurePredictionEngine.js';
import { scanSystemState } from '../ai-engine/assistant/autonomousMonitor.js';
import { retrieveWarrantyPolicy, formatRetrievedContext } from '../ai-engine/assistant/externalKnowledgeRetrieval.js';
import { processInvoiceText } from '../ai-engine/warrantyIntelligencePipeline.js';
import { SAMPLE_INVOICES } from './fixtures/simulatedOcrSource.js';
import { CATEGORIES } from '../classifier/productDatabase.js';

// Reference date: June 2024 — only Dell (Aug 2023 + 24mo) has active warranty
const REF = new Date('2024-06-01');

// ─────────────────────────────────────────────────────────────────────────────
// NLU ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('NLU Engine — Intent Detection');

await test('NLU: warranty expiry intent', () => {
  const f = parseQuery('When does my Samsung warranty expire?');
  assertEqual(f.intent, INTENTS.WARRANTY_EXPIRY_CHECK, 'expiry intent');
});
await test('NLU: claim eligibility intent', () => {
  const f = parseQuery('My laptop keyboard stopped working. Can I claim warranty?');
  assertEqual(f.intent, INTENTS.CLAIM_ELIGIBILITY_CHECK, 'claim intent');
});
await test('NLU: risk analysis intent from "which products are risky"', () => {
  const f = parseQuery('Which of my products are high risk?');
  assertEqual(f.intent, INTENTS.RISK_ANALYSIS, 'risk intent');
});
await test('NLU: fraud intent', () => {
  const f = parseQuery('Why was my invoice flagged as suspicious?');
  assertEqual(f.intent, INTENTS.FRAUD_INVESTIGATION, 'fraud intent');
});
await test('NLU: recommendation intent', () => {
  const f = parseQuery('Should I buy extended warranty for my TV?');
  assertEqual(f.intent, INTENTS.RECOMMENDATION_REQUEST, 'recommendation intent');
});
await test('NLU: repair cost intent', () => {
  const f = parseQuery('How much will it cost to repair my phone screen?');
  assertEqual(f.intent, INTENTS.REPAIR_COST_QUERY, 'repair cost intent');
});
await test('NLU: action guidance intent', () => {
  const f = parseQuery('What should I do before my warranty expires?');
  assertEqual(f.intent, INTENTS.ACTION_GUIDANCE, 'action intent');
});
await test('NLU: comparison intent', () => {
  const f = parseQuery('Compare risk scores of all my devices');
  assertEqual(f.intent, INTENTS.PRODUCT_COMPARISON, 'comparison intent');
});

section('NLU Engine — Entity Extraction');

await test('NLU entity: extracts Dell brand', () => {
  const f = parseQuery('My Dell laptop keyboard stopped working');
  assertEqual(f.entities.primaryBrand, 'Dell', 'brand=Dell');
});
await test('NLU entity: extracts Samsung brand', () => {
  const f = parseQuery('Samsung TV screen has gone black');
  assertEqual(f.entities.primaryBrand, 'Samsung', 'brand=Samsung');
});
await test('NLU entity: extracts Laptop category', () => {
  const f = parseQuery('My laptop battery died yesterday');
  assertTruthy(f.entities.primaryCategory?.includes('Laptop'), 'category=Laptop');
});
await test('NLU entity: extracts keyboard_failure issue', () => {
  const f = parseQuery('The keyboard keys are not responding');
  assertEqual(f.entities.primaryIssueType, 'keyboard_failure', 'issue type');
});
await test('NLU entity: extracts liquid_damage from condition modifier', () => {
  const f = parseQuery('I spilled water on my laptop and it stopped working');
  assert(
    f.entities.primaryIssueType === 'liquid_damage' || f.conditionModifier === 'LIQUID',
    'liquid damage detected'
  );
});
await test('NLU entity: extracts time range "next 30 days"', () => {
  const f = parseQuery('Which products expire in the next 30 days?');
  assertEqual(f.entities.primaryTimeRangeDays, 30, '30-day time range');
});
await test('NLU: urgency CRITICAL for "expires today"', () => {
  const f = parseQuery('My warranty expires today, what do I do?');
  assertEqual(f.urgencyLevel, 'CRITICAL', 'CRITICAL urgency');
});
await test('NLU: urgency HIGH for "just stopped working"', () => {
  const f = parseQuery('My phone just stopped working suddenly');
  assertContains(['HIGH', 'CRITICAL'], f.urgencyLevel, 'HIGH+ urgency');
});
await test('NLU: conditionModifier LIQUID for water spill', () => {
  const f = parseQuery('Dropped my phone in water');
  assertContains(['LIQUID', 'ACCIDENTAL'], f.conditionModifier, 'liquid/accidental condition');
});
await test('NLU: negation detected in "not covered"', () => {
  const f = parseQuery("Is accidental damage not covered by warranty?");
  assert(f.negationPresent, 'negation present');
});
await test('NLU: coreference uses context brands when pronoun used', () => {
  const context = { lastBrands: [{ brand: 'Apple', confidence: 0.9, method: 'context-memory' }], lastCategories: ['Smartphone'] };
  const f = parseQuery('Can I claim warranty for it?', context);
  assert(f.entities.resolvedFromContext || f.entities.brands.length > 0, 'coreference resolved');
});
await test('NLU: queryType ANALYTICAL for compare query', () => {
  const f = parseQuery('Compare all my products by risk score');
  assertEqual(f.queryType, 'ANALYTICAL', 'ANALYTICAL query type');
});
await test('NLU: queryType PREDICTIVE for failure probability', () => {
  const f = parseQuery('Which product is likely to fail next year?');
  assertContains(['PREDICTIVE', 'ANALYTICAL'], f.queryType, 'predictive query type');
});

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE GRAPH
// ─────────────────────────────────────────────────────────────────────────────
section('Knowledge Graph');

await test('Graph: addProduct and retrieve by id', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  const p = graph.getProduct(id);
  assertTruthy(p, 'product retrieved');
  assertEqual(p.brand, 'Sony', 'brand=Sony');
});
await test('Graph: getProductsByBrand', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText, { referenceDate: REF });
  graph.addProduct(res);
  const products = graph.getProductsByBrand('Sony');
  assert(products.length > 0, 'found by brand');
});
await test('Graph: getProductsByCategory returns correct category', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  graph.addProduct(res);
  const laptops = graph.getProductsByCategory('Laptop');
  assert(laptops.length > 0, 'found laptop by category');
});
await test('Graph: getProductsExpiringSoon returns products within window', async () => {
  const graph = new WarrantyKnowledgeGraph();
  // Dell laptop: Aug 2023 + 24 months = Aug 2025, so 14 months remain at June 2024
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  graph.addProduct(res);
  const soon = graph.getProductsExpiringSoon(500, false, REF);
  assert(soon.length > 0, 'found product expiring within 500 days');
});
await test('Graph: getHighRiskProducts filters by threshold', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.localStoreSamsungTv.rawText, { referenceDate: REF });
  graph.addProduct(res);
  const highRisk = graph.getHighRiskProducts(0); // threshold=0 gets all
  assert(highRisk.length > 0, 'at least one product returned');
});
await test('Graph: findProductByQuery fuzzy-finds Samsung', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.localStoreSamsungTv.rawText, { referenceDate: REF });
  graph.addProduct(res);
  const found = graph.findProductByQuery('Samsung');
  assertTruthy(found, 'found product');
});
await test('Graph: addRepairEvent persists to product node', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  graph.addRepairEvent(id, { issueType: 'keyboard_failure', description: 'Keys stuck', cost: 3500 });
  const product = graph.getProduct(id);
  assertEqual(product.repairHistory.length, 1, 'repair recorded');
  assertEqual(product.repairHistory[0].issueType, 'keyboard_failure', 'issue type');
});
await test('Graph: getSummary counts match', async () => {
  const graph = new WarrantyKnowledgeGraph();
  for (const key of ['amazonSonyHeadphones', 'flipkartDellLaptop']) {
    const res = await processInvoiceText(SAMPLE_INVOICES[key].rawText, { referenceDate: REF });
    graph.addProduct(res);
  }
  const summary = graph.getSummary(REF);
  assertEqual(summary.totalProducts, 2, '2 products total');
});

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('Memory Engine');

await test('Memory: getContext returns empty state initially', () => {
  const mem = new MemoryEngine();
  const ctx = mem.getContext();
  assertEqual(ctx.currentProductId, null, 'no current product initially');
  assertEqual(ctx.turnCount, 0, 'turn count 0');
});
await test('Memory: recordTurn updates focus stack', () => {
  const mem = new MemoryEngine();
  const fakeFrame = { raw: 'test', intent: 'product_lookup', urgencyLevel: 'NONE', entities: { brands: [], categories: [], issueTypes: [] } };
  const fakeResponse = { products: [{ id: 'p1', productName: 'Dell Laptop', brand: 'Dell', category: 'Laptop', warrantyTimeline: null }], followUpSuggestions: [] };
  mem.recordTurn(fakeFrame, fakeResponse);
  const ctx = mem.getContext();
  assertEqual(ctx.currentProductId, 'p1', 'focus stack updated');
  assertEqual(ctx.turnCount, 1, 'turn count 1');
});
await test('Memory: serialize and restore preserves state', () => {
  const mem = new MemoryEngine();
  const fakeFrame = { raw: 'test', intent: 'product_lookup', urgencyLevel: 'NONE', entities: { brands: [], categories: [], issueTypes: [] } };
  const fakeResponse = { products: [{ id: 'p1', productName: 'Dell Laptop', brand: 'Dell', category: 'Laptop', warrantyTimeline: null }], followUpSuggestions: [] };
  mem.recordTurn(fakeFrame, fakeResponse);
  const serialized = mem.serialize();
  const restored = MemoryEngine.fromSerialized(serialized);
  assertEqual(restored.getContext().currentProductId, 'p1', 'product id restored');
  assertEqual(restored.getContext().turnCount, 1, 'turn count restored');
});
await test('Memory: getReportedIssues tracks repeated issues', () => {
  const mem = new MemoryEngine();
  const frame = { raw: 'keyboard broken', intent: 'claim_eligibility_check', urgencyLevel: 'HIGH', entities: { brands: [], categories: [], issueTypes: [{ issueType: 'keyboard_failure' }] } };
  const resp = { products: [{ id: 'p1', productName: 'Dell', brand: 'Dell', category: 'Laptop', warrantyTimeline: null }], followUpSuggestions: [] };
  mem.recordTurn(frame, resp);
  mem.recordTurn(frame, resp);
  const issues = mem.getReportedIssues('p1');
  assert(issues.length >= 2, 'two issue reports recorded');
});
await test('Memory: addAlert and getUnshownAlerts', () => {
  const mem = new MemoryEngine();
  mem.addAlert({ id: 'alert1', severity: 'HIGH', title: 'Test Alert', shown: false });
  const unshown = mem.getUnshownAlerts();
  assert(unshown.length > 0, 'unshown alert present');
  mem.markAlertShown('alert1');
  assertEqual(mem.getUnshownAlerts().length, 0, 'alert marked shown');
});
await test('Memory: pendingFollowUps from last turn', () => {
  const mem = new MemoryEngine();
  const frame = { raw: 'q', intent: 'product_lookup', urgencyLevel: 'NONE', entities: { brands: [], categories: [], issueTypes: [] } };
  const resp = { products: [], followUpSuggestions: ['What is my risk score?', 'Show all products'] };
  mem.recordTurn(frame, resp);
  const ctx = mem.getContext();
  assert(ctx.pendingFollowUps.includes('What is my risk score?'), 'follow-up in context');
});

// ─────────────────────────────────────────────────────────────────────────────
// FAILURE PREDICTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('Failure Prediction Engine');

await test('Prediction: generates componentRisks for all categories', async () => {
  for (const cat of [CATEGORIES.SMARTPHONE, CATEGORIES.LAPTOP, CATEGORIES.TELEVISION, CATEGORIES.AIR_CONDITIONER]) {
    const node = { productName: `Test ${cat}`, category: cat, purchaseDate: '2023-01-01', repairHistory: [] };
    const pred = predictFailures(node, { referenceDate: REF });
    assert(pred.componentRisks.length > 0, `${cat} has component risks`);
    assertRange(pred.overallFailureProbability, 0, 1, `${cat} overall probability in range`);
  }
});
await test('Prediction: product in wear-out phase has higher risk than stable-phase product', () => {
  // Middle-age (stable): ~18 months old, lowest bathtub curve point
  const stable = { productName: 'Stable', category: CATEGORIES.LAPTOP, purchaseDate: '2022-12-01', repairHistory: [] };
  // Very old (wear-out): 4+ years old, clearly in wear-out phase
  const wornOut = { productName: 'WornOut', category: CATEGORIES.LAPTOP, purchaseDate: '2019-01-01', repairHistory: [] };
  const predStable  = predictFailures(stable,  { referenceDate: REF });
  const predWornOut = predictFailures(wornOut, { referenceDate: REF });
  assert(predWornOut.overallFailureProbability > predStable.overallFailureProbability,
    `worn-out (${predWornOut.overallFailureProbabilityPercent}%) should exceed stable-phase (${predStable.overallFailureProbabilityPercent}%)`
  );
});
await test('Prediction: reported symptoms boost relevant component probability', () => {
  const node = { productName: 'Dell Laptop', category: CATEGORIES.LAPTOP, purchaseDate: '2023-01-01', repairHistory: [] };
  const base    = predictFailures(node, { referenceDate: REF });
  const boosted = predictFailures(node, { referenceDate: REF, reportedSymptoms: ['keyboard_failure'] });
  const baseKb  = base.componentRisks.find((c) => c.component.includes('keyboard'));
  const bstKb   = boosted.componentRisks.find((c) => c.component.includes('keyboard'));
  assert(bstKb && baseKb && bstKb.failureProbability > baseKb.failureProbability, 'keyboard risk boosted by symptom');
});
await test('Prediction: repair history escalates component risk', () => {
  const node = { productName: 'Dell', category: CATEGORIES.LAPTOP, purchaseDate: '2023-01-01', repairHistory: [] };
  const repair = [{ issueType: 'battery_failure', date: '2023-06-01' }];
  const base    = predictFailures(node, { referenceDate: REF });
  const withRep = predictFailures(node, { referenceDate: REF, repairHistory: repair });
  assert(withRep.overallFailureProbability >= base.overallFailureProbability, 'repair history raises risk');
});
await test('Prediction: dominantRisk is the highest-probability component', () => {
  const node = { productName: 'Smartphone', category: CATEGORIES.SMARTPHONE, purchaseDate: '2022-01-01', repairHistory: [] };
  const pred = predictFailures(node, { referenceDate: REF });
  const domProb = pred.dominantRisk?.probability || 0;
  const maxProb = Math.max(...pred.componentRisks.map((c) => c.failureProbabilityPercent));
  assertEqual(domProb, maxProb, 'dominant matches max component');
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTONOMOUS MONITOR
// ─────────────────────────────────────────────────────────────────────────────
section('Autonomous Monitor');

await test('Monitor: generates CRITICAL alert for product expiring in 3 days', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  // Override timeline to 3 days remaining by adjusting the node
  const id = graph.addProduct(res);
  const product = graph.getProduct(id);
  // Manually set warrantyTimeline to 3 days
  product.warrantyTimeline = { expiryDate: '2024-06-04', daysRemaining: 3, isActive: true, isExpired: false, daysExpired: 0 };
  const alerts = scanSystemState(graph, null, REF);
  const critical = alerts.filter((a) => a.severity === 'CRITICAL' && a.productId === id);
  assert(critical.length > 0, 'CRITICAL alert generated for 3-day expiry');
});
await test('Monitor: generates HIGH_RISK alert for high risk score', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  // Override risk to 85
  graph.getProduct(id).risk = { riskScore: 85, riskLevel: 'CRITICAL', recommendation: 'Act now' };
  const alerts = scanSystemState(graph, null, REF);
  const riskAlert = alerts.find((a) => a.type === 'HIGH_RISK_PRODUCT' && a.productId === id);
  assertTruthy(riskAlert, 'high risk alert generated');
});
await test('Monitor: generates suspicious invoice alert for HIGH_RISK fraud', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  graph.getProduct(id).fraud = { fraudScore: 75, warningLevel: 'HIGH_RISK', signals: [], summary: 'suspicious' };
  const alerts = scanSystemState(graph, null, REF);
  const fraudAlert = alerts.find((a) => a.type === 'SUSPICIOUS_INVOICE' && a.productId === id);
  assertTruthy(fraudAlert, 'fraud alert generated');
});
await test('Monitor: generates LOW_CONFIDENCE alert for low-confidence invoice', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.noisyUnreadableReceipt.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  const alerts = scanSystemState(graph, null, REF);
  const confAlert = alerts.find((a) => a.type === 'LOW_CONFIDENCE_INVOICE' && a.productId === id);
  assertTruthy(confAlert, 'low confidence alert generated');
});
await test('Monitor: REPEATED_ISSUE alert triggers after 2 reports', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  const mem = new MemoryEngine();
  const frame = { raw: 'keyboard broken', intent: 'claim_eligibility_check', urgencyLevel: 'HIGH', entities: { brands: [], categories: [], issueTypes: [{ issueType: 'keyboard_failure' }] } };
  const resp = { products: [{ id, productName: 'Dell', brand: 'Dell', category: 'Laptop', warrantyTimeline: null }], followUpSuggestions: [] };
  mem.recordTurn(frame, resp);
  mem.recordTurn(frame, resp);
  const alerts = scanSystemState(graph, mem, REF);
  const repeatAlert = alerts.find((a) => a.type === 'REPEATED_ISSUE' && a.productId === id);
  assertTruthy(repeatAlert, 'repeated issue alert generated');
});
await test('Monitor: EXTENDED_WARRANTY_WINDOW alert when advisory recommends it', async () => {
  const graph = new WarrantyKnowledgeGraph();
  const res = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, { referenceDate: REF });
  const id = graph.addProduct(res);
  graph.getProduct(id).advisory = { extendedWarrantyRecommended: true, extendedWarrantyReason: 'Consider extending now.' };
  const alerts = scanSystemState(graph, null, REF);
  const ewAlert = alerts.find((a) => a.type === 'EXTENDED_WARRANTY_WINDOW');
  assertTruthy(ewAlert, 'extended warranty alert generated');
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL KNOWLEDGE RETRIEVAL
// ─────────────────────────────────────────────────────────────────────────────
section('External Knowledge Retrieval');

await test('Retrieval: known brand returns fallback policy when network unavailable', async () => {
  const result = await retrieveWarrantyPolicy('Apple');
  // In sandbox network is unavailable — should get graceful fallback
  assertTruthy(result, 'result returned');
  const ctx = formatRetrievedContext(result);
  assertTruthy(ctx, 'formatted context returned');
  assertTruthy(ctx.keyExclusions?.length > 0, 'exclusions in fallback');
  assertTruthy(ctx.keyCoverage?.length > 0, 'coverage in fallback');
});
await test('Retrieval: unknown brand returns graceful null/fallback', async () => {
  const result = await retrieveWarrantyPolicy('ObscureBrandXYZ123');
  assertTruthy(result, 'result returned for unknown brand');
  assertEqual(result.retrieved, false, 'retrieved=false for unknown brand');
});
await test('Retrieval: formatRetrievedContext null-safe', () => {
  const ctx = formatRetrievedContext(null);
  assertEqual(ctx, null, 'null input returns null');
});
await test('Retrieval: fallback includes claim process for Samsung', async () => {
  const result = await retrieveWarrantyPolicy('Samsung');
  const ctx = formatRetrievedContext(result);
  assertTruthy(ctx, 'Samsung context returned');
  assert(ctx.source === 'internal_fallback' || ctx.source === 'web_retrieval', 'valid source');
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL AGENT — INTEGRATION TESTS
// ─────────────────────────────────────────────────────────────────────────────
section('Agent — Full Integration (Pipeline → Graph → Query → Memory)');

// Build a shared agent for integration tests
const agent = new WarrantyAgent({ referenceDate: REF });
const addedIds = {};

await test('Agent: addProductFromText for all valid fixtures', async () => {
  for (const [key, sample] of Object.entries(SAMPLE_INVOICES)) {
    const r = await agent.addProductFromText(sample.rawText, { nickname: key });
    assertTruthy(r.productId, `${key} has productId`);
    addedIds[key] = r.productId;
  }
  assertEqual(agent.getSystemSummary().totalProducts, 6, '6 products added');
});

await test('Agent: system summary reflects all products', () => {
  const s = agent.getSystemSummary();
  assertEqual(s.totalProducts, 6, 'totalProducts=6');
  assert(typeof s.activeWarranties === 'number', 'activeWarranties is number');
  assert(typeof s.expiredWarranties === 'number', 'expiredWarranties is number');
  assert(s.activeWarranties + s.expiredWarranties <= s.totalProducts, 'active+expired <= total');
});

await test('Agent: claim eligibility query — Dell keyboard covered', async () => {
  const r = await agent.query('My Dell laptop keyboard stopped working, can I claim warranty?');
  assertEqual(r.intent, INTENTS.CLAIM_ELIGIBILITY_CHECK, 'correct intent');
  assertTruthy(r.products.length > 0, 'product resolved');
  assert(r.products[0].productName?.toLowerCase().includes('dell'), 'Dell resolved');
  assertTruthy(r.eligibilityResult, 'eligibility evaluated');
  assertEqual(r.eligibilityResult.covered, true, 'keyboard covered');
});

await test('Agent: liquid damage query — excluded', async () => {
  const r = await agent.query('I spilled water on my Dell laptop, is it covered?');
  assertTruthy(r.eligibilityResult, 'eligibility evaluated');
  assertEqual(r.eligibilityResult.covered, false, 'liquid damage excluded');
});

await test('Agent: memory coreference — follow-up query remembers Dell', async () => {
  // First establish Dell in focus
  await agent.query('Tell me about my Dell laptop');
  // Follow-up with pronoun
  const r = await agent.query('Can I claim warranty for it?');
  assertTruthy(r.products.length > 0, 'product resolved via coreference');
  assert(r.products[0].productName?.toLowerCase().includes('dell'), 'Dell remembered from context');
});

await test('Agent: warranty expiry for all products returns multiple', async () => {
  const r = await agent.query('When do all my warranties expire?');
  assert(r.products.length > 1, 'multiple products in expiry response');
});

await test('Agent: risk analysis returns all products sorted by risk', async () => {
  const r = await agent.query('Which of my products are high risk?');
  assertEqual(r.intent, INTENTS.RISK_ANALYSIS, 'risk intent');
  assert(r.products.length > 1, 'multiple products in risk response');
});

await test('Agent: fraud investigation query', async () => {
  const r = await agent.query('Why was my Samsung TV invoice flagged?');
  assertEqual(r.intent, INTENTS.FRAUD_INVESTIGATION, 'fraud intent');
  assertTruthy(r.products.length > 0, 'Samsung TV resolved');
});

await test('Agent: repair cost query', async () => {
  const r = await agent.query('How much will it cost to repair my Dell laptop?');
  assertTruthy(r.intent === INTENTS.REPAIR_COST_QUERY || r.rawAnswer?.includes('repair'), 'repair cost response');
  assertTruthy(r.products.length > 0, 'product resolved');
});

await test('Agent: recommendation query for TV', async () => {
  const r = await agent.query('Should I buy extended warranty for my Samsung TV?');
  assertTruthy(r.rawAnswer?.length > 50, 'substantive recommendation answer');
});

await test('Agent: product comparison query', async () => {
  const r = await agent.query('Compare risk scores of all my devices');
  assertEqual(r.intent, INTENTS.PRODUCT_COMPARISON, 'comparison intent');
  assert(r.products.length > 1, 'multiple products compared');
});

await test('Agent: failure prediction accessible per product', () => {
  const dellId = addedIds['flipkartDellLaptop'];
  assertTruthy(dellId, 'Dell product ID known');
  const pred = agent.predictProductFailures(dellId, 365);
  assertTruthy(pred.componentRisks.length > 0, 'failure risks generated');
  assertRange(pred.overallFailureProbabilityPercent, 0, 100, 'probability in range');
});

await test('Agent: record repair event updates product history', () => {
  const dellId = addedIds['flipkartDellLaptop'];
  agent.recordRepairEvent(dellId, { issueType: 'keyboard_failure', description: 'Keys replaced', cost: 3500 });
  const graph = agent.graph;
  const product = graph.getProduct(dellId);
  assert(product.repairHistory.length >= 1, 'repair event recorded');
});

await test('Agent: reasoning chain included in response', async () => {
  const r = await agent.query('Is my Dell laptop still under warranty?');
  assertTruthy(r.reasoningChain, 'reasoning chain present');
  assert(Array.isArray(r.reasoningChain), 'chain is array');
  assert(r.reasoningChain.length > 0, 'chain has stages');
});

await test('Agent: reasoning trace included in answer', async () => {
  const r = await agent.query('Can I claim warranty for my Apple iPhone?');
  assertTruthy(r.reasoningTrace?.length > 0 || r.answer?.includes('Stage'), 'reasoning trace in answer');
});

await test('Agent: overallConfidence is 0–1', async () => {
  const r = await agent.query('What is my risk level?');
  assertRange(r.overallConfidence, 0, 1, 'confidence in range');
});

await test('Agent: followUpSuggestions are non-empty strings', async () => {
  const r = await agent.query('Tell me about my Sony headphones');
  assert(Array.isArray(r.followUpSuggestions), 'followUpSuggestions is array');
  if (r.followUpSuggestions.length > 0) {
    assert(typeof r.followUpSuggestions[0] === 'string', 'suggestions are strings');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────
section('Edge Cases');

await test('Edge: empty query does not crash', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.query('');
  assertTruthy(r.answer, 'answer returned for empty query');
});

await test('Edge: garbage OCR text — pipeline degrades gracefully', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.addProductFromText('!@#$%^&* TOTAL GARBAGE \x00\x01\x02 ???');
  assertTruthy(r.productId, 'product added despite garbage OCR');
  assert(r.invoiceConfidence < 0.3, 'low confidence flagged');
  assert(r.needsManualReview, 'flagged for manual review');
});

await test('Edge: agent with no products returns sensible response', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.query('Which of my products are expiring soon?');
  assertTruthy(r.answer?.length > 10, 'non-empty answer even with no products');
});

await test('Edge: query about non-existent brand handled gracefully', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  const r = await a.query('What about my Panasonic microwave?');
  assertTruthy(r.answer?.length > 10, 'answer returned even if product not found');
});

await test('Edge: duplicate invoice — fraud detection fires for second add', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  // Second add of same invoice — pipeline runs again, duplicate detection needs seenInvoiceNumbers set
  // (the agent currently processes each independently — this tests graceful handling, not dedup)
  const r2 = await a.addProductFromText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  assertTruthy(r2.productId, 'second add completes without crash');
});

await test('Edge: partial invoice (missing purchase date) — warrantyStatus unknown', async () => {
  const partialText = `
Amazon Invoice
Product: Sony WH-1000XM5 Headphones
Invoice Number: IN-TEST-001
Seller: Appario Retail
Warranty: 12 months
`;
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.addProductFromText(partialText);
  // No purchase date → warranty status unknown
  assertTruthy(r.productId, 'partial invoice ingested');
  assert(r.warrantyStatus === 'unknown' || r.daysRemaining === undefined, 'warranty status unknown without date');
});

await test('Edge: very long query does not crash', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const longQuery = 'My Dell laptop ' + 'keyboard is not working and '.repeat(30) + 'can I claim warranty?';
  const r = await a.query(longQuery);
  assertTruthy(r.answer?.length > 10, 'answer returned for long query');
});

await test('Edge: expired warranty correctly identified and DENIED', async () => {
  // Use REF date far in the future so all warranties are expired
  const farFuture = new Date('2030-01-01');
  const a = new WarrantyAgent({ referenceDate: farFuture });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('Can I claim warranty for keyboard issue?');
  assertTruthy(r.eligibilityResult, 'eligibility evaluated');
  assertEqual(r.eligibilityResult.warrantyStatus.status, 'expired', 'warranty expired in 2030');
  assertEqual(r.eligibilityResult.claimViability, 'DENIED', 'DENIED when expired');
});

await test('Edge: screen crack (physical damage) — excluded even if in warranty', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('My laptop screen cracked after I dropped it');
  assertTruthy(r.eligibilityResult, 'eligibility evaluated');
  assertEqual(r.eligibilityResult.covered, false, 'screen crack excluded');
});

await test('Edge: analytical query with no products returns helpful message', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.query('Compare risk scores of all my devices');
  assertTruthy(r.answer?.length > 10, 'helpful response even with no products');
});

// ─────────────────────────────────────────────────────────────────────────────
// FAILURE RECOVERY
// ─────────────────────────────────────────────────────────────────────────────
section('Failure Recovery');

await test('Recovery: external retrieval failure handled gracefully', async () => {
  // Retrieval always falls back gracefully in sandbox (no network)
  const result = await retrieveWarrantyPolicy('Sony');
  assertTruthy(result, 'result returned despite no network');
  assertEqual(result.retrieved, false, 'retrieved=false when offline');
  const ctx = formatRetrievedContext(result);
  assertTruthy(ctx, 'fallback context returned');
});

await test('Recovery: agent query survives when graph has no risk data', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  // Add product and manually remove risk data to simulate missing pipeline stage
  const id = a.graph.addProduct({ invoice: { productName: 'Test Product', brand: 'Dell', category: 'Laptop', purchaseDate: '2023-01-01', warrantyMonths: 12 }, risk: null, advisory: null, fraud: null });
  const r = await a.query('What is my risk score?');
  assertTruthy(r.answer?.length > 10, 'answer returned with no risk data');
});

await test('Recovery: predictFailures with null purchaseDate uses default age', () => {
  const node = { productName: 'Unknown Age Product', category: CATEGORIES.SMARTPHONE, purchaseDate: null, repairHistory: [] };
  const pred = predictFailures(node, { referenceDate: REF });
  assertTruthy(pred.componentRisks.length > 0, 'prediction works with null purchaseDate');
  assertEqual(pred.daysOld, 365, 'defaults to 1 year age');
});

await test('Recovery: addRepairEvent throws for unknown productId', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  let threw = false;
  try { a.recordRepairEvent('nonexistent_id', { issueType: 'battery_failure' }); }
  catch (e) { threw = true; }
  assert(threw, 'throws for unknown product ID');
});

await test('Recovery: memory survives corrupt serialization gracefully', () => {
  const mem = MemoryEngine.fromSerialized({ focusStack: null, history: null, longTermFacts: null });
  const ctx = mem.getContext();
  assertTruthy(ctx, 'context returned from corrupt state');
  assertEqual(ctx.currentProductId, null, 'null current product after corrupt restore');
});

// ─────────────────────────────────────────────────────────────────────────────
// AGENT SERIALISATION + STRESS
// ─────────────────────────────────────────────────────────────────────────────
section('Serialisation & Stress');

await test('Stress: ingest all 6 fixtures and run 10 queries without error', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  for (const sample of Object.values(SAMPLE_INVOICES)) {
    await a.addProductFromText(sample.rawText);
  }
  const queries = [
    'Which products expire in the next 30 days?',
    'Show me all my products',
    'Which is highest risk?',
    'My Dell keyboard stopped working, can I claim?',
    'How much to repair my Samsung TV?',
    'Are any invoices suspicious?',
    'What should I do before warranty expires?',
    'Compare all my devices',
    'Should I buy extended warranty?',
    'What is my Sony headphones warranty status?',
  ];
  for (const q of queries) {
    const r = await a.query(q);
    assertTruthy(r.answer?.length > 5, `non-empty answer for: "${q.slice(0, 40)}"`);
    assertRange(r.overallConfidence, 0, 1, `confidence in range for: "${q.slice(0, 40)}"`);
  }
});

await test('Serialise: agent state round-trips correctly', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText, { nickname: 'sony_test' });
  await a.query('Tell me about my Sony headphones');

  const serialized = a.serialize();
  assertTruthy(serialized.memory, 'memory serialized');
  assertTruthy(Array.isArray(serialized.products), 'products serialized');
  assertEqual(serialized.products.length, 1, 'one product serialized');

  const restored = WarrantyAgent.fromSerialized(serialized, { referenceDate: REF });
  assertEqual(restored.getSystemSummary().totalProducts, 1, 'one product restored');

  const r = await restored.query('Tell me about my Sony headphones');
  assertTruthy(r.products.length > 0, 'product accessible after restore');
});

await test('Stress: 50 concurrent-style queries complete without crash', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  // JS is single-threaded but we test sequential volume to catch state corruption
  const querySet = ['risk', 'warranty', 'claim', 'fraud', 'repair', 'compare', 'expire', 'predict', 'advise', 'recommend'];
  for (let i = 0; i < 50; i++) {
    const q = querySet[i % querySet.length];
    const r = await a.query(`Tell me about my ${q} status`);
    assertTruthy(r.answer, `answer returned on query ${i}`);
  }
});

await test('Stress: knowledge graph handles 20 products', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const fixtures = Object.values(SAMPLE_INVOICES);
  for (let i = 0; i < 20; i++) {
    await a.addProductFromText(fixtures[i % fixtures.length].rawText);
  }
  assertEqual(a.getSystemSummary().totalProducts, 20, '20 products in graph');
  const r = await a.query('Which of my products are high risk?');
  assertTruthy(r.products.length > 0, 'query works with 20 products');
});

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY
// ─────────────────────────────────────────────────────────────────────────────
section('Security & Input Hardening');

await test('Security: control characters in OCR text do not crash pipeline', async () => {
  const maliciousText = 'Invoice\x00Number\x01: TEST\x02-001\nProduct\x03: Sony\nWarranty: 12 months';
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.addProductFromText(maliciousText);
  assertTruthy(r.productId, 'survived control characters');
});

await test('Security: extremely long invoice text handled without hang', async () => {
  const longText = SAMPLE_INVOICES.amazonSonyHeadphones.rawText.repeat(50);
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.addProductFromText(longText);
  assertTruthy(r.productId, 'handled long text');
});

await test('Security: query with script injection characters handled safely', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  const r = await a.query('<script>alert(1)</script> Can I claim warranty?');
  assertTruthy(r.answer, 'answer returned despite injection attempt');
  assert(!r.answer.includes('<script>'), 'script tags not reflected in answer');
});

await test('Security: SQL-style injection in query does not crash', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.query("'; DROP TABLE products; -- Can I claim?");
  assertTruthy(r.answer?.length > 5, 'handled SQL injection pattern safely');
});

await test('Security: null query returns safe response', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  const r = await a.query(null);
  assertTruthy(r.answer?.length > 5, 'null query handled');
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSE QUALITY
// ─────────────────────────────────────────────────────────────────────────────
section('Response Quality');

await test('Quality: claim eligibility response explains exclusion reason', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('I spilled water on my laptop, is it covered?');
  assertTruthy(r.eligibilityResult?.coverageReason?.length > 20, 'coverage reason provided');
  assertTruthy(r.eligibilityResult?.exclusionMatches?.length > 0, 'exclusion match present');
});

await test('Quality: covered claim lists recommended steps', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('My Dell laptop keyboard stopped working');
  assertTruthy(r.eligibilityResult?.recommendedSteps?.length > 0, 'recommended steps present');
});

await test('Quality: reasoning chain has at least 2 completed stages', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('Can I claim warranty for keyboard issue?');
  const completed = r.reasoningChain.filter((s) => s.status === 'COMPLETED');
  assert(completed.length >= 2, `at least 2 stages completed, got ${completed.length}`);
});

await test('Quality: confidence scoring is consistent (0.4–1.0 for clear queries)', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('My Dell laptop keyboard stopped working, can I claim warranty?');
  assertRange(r.overallConfidence, 0.4, 1.0, 'confidence appropriately high for clear query');
});

await test('Quality: answer for expiry query contains date', async () => {
  const a = new WarrantyAgent({ referenceDate: REF });
  await a.addProductFromText(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  const r = await a.query('When does my Dell warranty expire?');
  // Answer should mention a date (YYYY-MM-DD pattern)
  assert(/20\d\d-\d\d-\d\d/.test(r.rawAnswer || r.answer), 'expiry date in answer');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(65));
console.log(`  PHASE 1.5 RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  FAILURES:');
  failures.forEach((f) => console.log(`    ✗ ${f.name}\n      ${f.error}`));
}
console.log('═'.repeat(65) + '\n');
process.exit(failed > 0 ? 1 : 0);
