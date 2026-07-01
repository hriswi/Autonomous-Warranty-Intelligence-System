/**
 * warrantyAgent.js
 *
 * AUTONOMOUS WARRANTY INTELLIGENCE AGENT
 *
 * Central orchestrator for the entire Phase 1.5 intelligence layer.
 * This is the single public API for the agent — all UI code (React,
 * CLI, or API endpoint) only talks to this module.
 *
 * Capabilities:
 *   - Process natural language queries about warranty and products
 *   - Multi-stage reasoning with full explanation trace
 *   - Persistent memory across conversation turns
 *   - Proactive autonomous monitoring (alerts without user prompting)
 *   - Failure prediction for tracked products
 *   - Analytical queries (compare, rank, filter)
 *   - RAG-style external knowledge retrieval
 *   - Product ingestion from the intelligence pipeline
 *
 * Usage:
 *   import WarrantyAgent from './ai-engine/assistant/warrantyAgent.js';
 *   const agent = new WarrantyAgent();
 *   await agent.addProductFromText(rawOcrText);
 *   const response = await agent.query('Can I claim warranty for my Dell laptop keyboard?');
 */

import WarrantyKnowledgeGraph from './knowledgeGraph.js';
import MemoryEngine from './memoryEngine.js';
import { parseQuery } from './nluEngine.js';
import { runReasoningChain } from './multiStageReasoning.js';
import { scanSystemState, formatActiveAlerts } from './autonomousMonitor.js';
import { predictFailures } from './failurePredictionEngine.js';
import { processInvoiceText } from '../warrantyIntelligencePipeline.js';

export class WarrantyAgent {
  /**
   * @param {object} [options]
   * @param {object} [options.serializedMemory] Restore memory from a previous session.
   * @param {Date}   [options.referenceDate]    Override "today" (for testing).
   */
  constructor(options = {}) {
    this.graph = new WarrantyKnowledgeGraph();
    this.memory = new MemoryEngine(options.serializedMemory || null);
    this.referenceDate = options.referenceDate || null; // null = use real Date()
    this._queryCount = 0;
  }

  _now() {
    return this.referenceDate || new Date();
  }

  // ── PRODUCT MANAGEMENT ──────────────────────────────────────────────────────

  /**
   * Ingests raw OCR text (from an uploaded invoice image/PDF) through
   * the full intelligence pipeline and adds the product to the knowledge graph.
   *
   * @param {string} rawOcrText  Output of the OCR engine.
   * @param {object} [metadata]  Optional user-supplied metadata (nickname, tags).
   * @returns {Promise<{productId, productName, category, brand, invoiceConfidence, alerts}>}
   */
  async addProductFromText(rawOcrText, metadata = {}) {
    const pipelineResult = await processInvoiceText(rawOcrText, {
      referenceDate: this._now(),
    });

    if (!pipelineResult.success) {
      throw new Error(`Pipeline failed: ${pipelineResult.error}`);
    }

    const productId = this.graph.addProduct(pipelineResult, metadata);
    const product = this.graph.getProduct(productId);

    // Run autonomous monitoring scan for the new product
    const alerts = scanSystemState(this.graph, this.memory, this._now())
      .filter((a) => a.productId === productId);

    // Register any urgent alerts with memory
    for (const alert of alerts) {
      this.memory.addAlert(alert);
    }

    return {
      productId,
      productName: product.productName,
      category: product.category,
      brand: product.brand,
      invoiceConfidence: product.overallConfidence,
      needsManualReview: product.needsManualReview,
      lowConfidenceFields: product.lowConfidenceFields,
      warrantyStatus: product.warrantyTimeline?.isActive ? 'active' : product.warrantyTimeline?.isExpired ? 'expired' : 'unknown',
      daysRemaining: product.warrantyTimeline?.daysRemaining,
      riskScore: product.risk?.riskScore,
      fraudWarning: product.fraud?.warningLevel,
      alerts,
    };
  }

  /**
   * Adds a product from a pre-computed pipeline result object.
   * Used for bulk-loading fixtures in tests.
   */
  addProductFromPipelineResult(pipelineResult, metadata = {}) {
    return this.graph.addProduct(pipelineResult, metadata);
  }

  // ── QUERY PROCESSING ────────────────────────────────────────────────────────

  /**
   * Processes a natural-language query and returns a full agent response.
   *
   * @param {string} query  The user's question or statement.
   * @returns {Promise<AgentResponse>}
   */
  async query(query) {
    this._queryCount++;
    const now = this._now();

    // Get current conversation context from memory
    const context = this.memory.getContext();

    // Parse the query through the NLU engine
    const nluFrame = parseQuery(query, context);

    // Run autonomous monitoring scan on each turn
    const allAlerts = scanSystemState(this.graph, this.memory, now);
    const unshownAlerts = allAlerts.filter((a) => !a.shown);
    const criticalAlerts = unshownAlerts.filter((a) => ['CRITICAL', 'HIGH'].includes(a.severity));

    // Register new alerts with memory
    for (const alert of allAlerts) {
      this.memory.addAlert(alert);
    }

    // Run the multi-stage reasoning chain
    const reasoningResult = await runReasoningChain(nluFrame, context, this.graph, now);

    // Build the final response
    let finalAnswer = reasoningResult.answer;

    // Prepend critical proactive alerts if any are unshown
    // (only prepend if the query wasn't ALREADY about those alerts)
    const queryIsAboutAlerts = ['fraud_investigation', 'risk_analysis', 'warranty_expiry_check'].includes(nluFrame.intent);
    if (criticalAlerts.length > 0 && !queryIsAboutAlerts) {
      const alertBanner = formatActiveAlerts(criticalAlerts, 2);
      if (alertBanner) {
        finalAnswer = alertBanner + '\n\n---\n\n' + finalAnswer;
        // Mark shown
        criticalAlerts.forEach((a) => this.memory.markAlertShown(a.id));
      }
    }

    const agentResponse = {
      query,
      answer: finalAnswer,
      rawAnswer: reasoningResult.rawAnswer,
      intent: nluFrame.intent,
      intentConfidence: nluFrame.intentConfidence,
      urgencyLevel: nluFrame.urgencyLevel,
      overallConfidence: reasoningResult.overallConfidence,
      products: reasoningResult.products || [],
      reasoningTrace: reasoningResult.reasoningTrace,
      reasoningChain: reasoningResult.chain,
      followUpSuggestions: reasoningResult.followUpSuggestions || [],
      eligibilityResult: reasoningResult.eligibilityResult || null,
      externalContext: reasoningResult.externalContext || null,
      activeAlerts: allAlerts,
      newCriticalAlerts: criticalAlerts,
      queryNumber: this._queryCount,
      processedAt: now.toISOString(),
    };

    // Record this turn in memory
    this.memory.recordTurn(nluFrame, agentResponse);

    return agentResponse;
  }

  // ── ANALYTICAL QUERY METHODS ────────────────────────────────────────────────

  /**
   * Returns products expiring within `days` days.
   */
  getProductsExpiringSoon(days = 30) {
    return this.graph.getProductsExpiringSoon(days, false, this._now());
  }

  /**
   * Returns products with risk score above `threshold`.
   */
  getHighRiskProducts(threshold = 65) {
    return this.graph.getHighRiskProducts(threshold);
  }

  /**
   * Returns all products with suspicious/flagged invoices.
   */
  getSuspiciousProducts() {
    return this.graph.getSuspiciousProducts();
  }

  /**
   * Generates failure predictions for a specific product.
   */
  predictProductFailures(productId, horizonDays = 365) {
    const product = this.graph.getProduct(productId);
    if (!product) throw new Error(`Product ${productId} not found`);
    const reportedIssues = this.memory.getReportedIssues(productId).map((i) => i.issueType);
    return predictFailures(product, {
      horizonDays,
      reportedSymptoms: reportedIssues,
      repairHistory: product.repairHistory || [],
      referenceDate: this._now(),
    });
  }

  /**
   * Returns a full knowledge graph summary snapshot.
   */
  getSystemSummary() {
    return this.graph.getSummary(this._now());
  }

  /**
   * Returns all currently-active monitoring alerts.
   */
  getActiveAlerts() {
    return scanSystemState(this.graph, this.memory, this._now());
  }

  /**
   * Adds a repair event to a product's history.
   */
  recordRepairEvent(productId, repairEvent) {
    this.graph.addRepairEvent(productId, repairEvent);
  }

  // ── MEMORY MANAGEMENT ───────────────────────────────────────────────────────

  /** Serialises agent state (memory + graph) for persistence. */
  serialize() {
    const products = this.graph.getAllProducts().map((p) => ({
      pipelineResult: { invoice: p, risk: p.risk, advisory: p.advisory, fraud: p.fraud },
      metadata: { id: p.id, nickname: p.nickname, tags: p.tags },
    }));
    return {
      memory: this.memory.serialize(),
      products,
      agentVersion: '1.5.0',
      serializedAt: new Date().toISOString(),
    };
  }

  /** Restores agent state from a serialised snapshot. */
  static fromSerialized(state, options = {}) {
    const agent = new WarrantyAgent({ ...options, serializedMemory: state.memory });
    for (const { pipelineResult, metadata } of (state.products || [])) {
      agent.graph.addProduct(pipelineResult, metadata);
    }
    return agent;
  }
}

export default WarrantyAgent;
