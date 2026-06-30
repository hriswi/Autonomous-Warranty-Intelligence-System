/**
 * knowledgeGraph.js
 *
 * KNOWLEDGE GRAPH ENGINE
 *
 * Builds and maintains a queryable in-memory graph of all system knowledge:
 * products, invoices, warranty status, risk scores, fraud results, and
 * repair history. This is the single source of truth for the reasoning
 * engine — it abstracts away whether data came from parsed invoices,
 * pre-computed risk reports, or user-added metadata.
 *
 * Graph structure:
 *   Nodes: Product, Invoice, WarrantyStatus, RiskReport, FraudReport,
 *          RepairEvent, Brand, Category
 *   Edges: hasInvoice, hasWarranty, hasRisk, hasFraud, hasRepair,
 *          belongsToCategory, madeby
 *
 * Query interface (all synchronous, in-memory):
 *   graph.getProduct(id)
 *   graph.getProductsByBrand(brand)
 *   graph.getProductsByCategory(category)
 *   graph.getProductsExpiringSoon(days)
 *   graph.getHighRiskProducts(threshold)
 *   graph.getSuspiciousProducts()
 *   graph.getAllProducts()
 *   graph.findProductByQuery(brandOrName)
 *
 * The graph is populated by calling graph.addProduct(pipelineResult).
 * In the full Warranty Vault app, the app layer calls addProduct for each
 * invoice the user has uploaded. In the test harness, we pre-populate with
 * the 6 sample fixtures.
 */

import { daysBetween, addMonths } from '../../utils/dateUtils.js';
import { normalizeKey, bestFuzzyMatch } from '../../utils/textUtils.js';

export class WarrantyKnowledgeGraph {
  constructor() {
    // Primary node store: productId → full product node
    this._products = new Map();
    // Secondary indices for fast lookup
    this._byBrand = new Map();         // brand (normalized) → Set<productId>
    this._byCategory = new Map();      // category → Set<productId>
    this._invoiceIndex = new Map();    // invoiceNumber (normalized) → productId
    this._counter = 0;
  }

  // ── NODE ADDITION ──────────────────────────────────────────────────────────

  /**
   * Adds a product to the knowledge graph from a pipeline result object
   * (output of warrantyIntelligencePipeline.processInvoiceText).
   *
   * Can also accept a raw parsedInvoice object directly (for pre-processing use).
   *
   * @param {object} pipelineResult
   * @param {object} [metadata] Optional user-supplied metadata (nickname, tags, etc.)
   * @returns {string} productId
   */
  addProduct(pipelineResult, metadata = {}) {
    const id = metadata.id || `product_${++this._counter}`;

    // Support both full pipeline result and raw parsedInvoice shapes
    const invoice = pipelineResult.invoice || pipelineResult;
    const risk = pipelineResult.risk || null;
    const advisory = pipelineResult.advisory || null;
    const fraud = pipelineResult.fraud || null;

    const node = {
      id,
      // Core fields
      productName: invoice.productName || metadata.productName || 'Unknown Product',
      brand: invoice.brand || null,
      category: invoice.category || null,
      seller: invoice.seller || null,
      invoiceNumber: invoice.invoiceNumber || null,
      serialNumber: invoice.serialNumber || null,
      purchaseDate: invoice.purchaseDate || null,
      warrantyMonths: invoice.warrantyMonths || null,
      expectedWarrantyMonths: invoice.expectedWarrantyMonths || null,

      // Confidence and review flags
      overallConfidence: invoice.overallConfidence || 0,
      needsManualReview: invoice.needsManualReview || false,
      lowConfidenceFields: invoice.lowConfidenceFields || [],
      fieldConfidence: invoice.fieldConfidence || {},

      // Computed warranty timeline (computed at graph-build time)
      warrantyTimeline: this._computeWarrantyTimeline(invoice),

      // Intelligence reports (may be null if not yet computed)
      risk: risk ? {
        riskScore: risk.riskScore,
        riskLevel: risk.riskLevel,
        recommendation: risk.recommendation,
        components: risk.components,
      } : null,

      advisory: advisory ? {
        urgencyScore: advisory.urgencyScore,
        urgencyLevel: advisory.urgencyLevel,
        repairCostEstimate: advisory.repairCostEstimate,
        advisoryActions: advisory.advisoryActions,
        extendedWarrantyRecommended: advisory.extendedWarrantyRecommended,
      } : null,

      fraud: fraud ? {
        fraudScore: fraud.fraudScore,
        warningLevel: fraud.warningLevel,
        signals: fraud.signals || [],
        summary: fraud.summary,
      } : null,

      // Repair history (populated via addRepairEvent)
      repairHistory: [],

      // User metadata
      nickname: metadata.nickname || null,
      tags: metadata.tags || [],
      addedAt: new Date().toISOString(),
    };

    this._products.set(id, node);

    // Update secondary indices
    if (node.brand) {
      const brandKey = normalizeKey(node.brand);
      if (!this._byBrand.has(brandKey)) this._byBrand.set(brandKey, new Set());
      this._byBrand.get(brandKey).add(id);
    }
    if (node.category) {
      if (!this._byCategory.has(node.category)) this._byCategory.set(node.category, new Set());
      this._byCategory.get(node.category).add(id);
    }
    if (node.invoiceNumber) {
      this._invoiceIndex.set(normalizeKey(node.invoiceNumber), id);
    }

    return id;
  }

  _computeWarrantyTimeline(invoice, referenceDate = new Date()) {
    const { purchaseDate, warrantyMonths } = invoice;
    if (!purchaseDate || !warrantyMonths) return null;

    const purchase = new Date(purchaseDate);
    const expiry = addMonths(purchase, warrantyMonths);
    const daysRemaining = daysBetween(referenceDate, expiry);
    const totalDays = daysBetween(purchase, expiry);
    const daysUsed = daysBetween(purchase, referenceDate);

    return {
      expiryDate: expiry.toISOString().split('T')[0],
      daysRemaining,
      daysUsed: Math.max(0, daysUsed),
      totalDays,
      percentUsed: totalDays > 0 ? Math.round(Math.min(100, (daysUsed / totalDays) * 100)) : 100,
      isActive: daysRemaining > 0,
      isExpired: daysRemaining <= 0,
      daysExpired: daysRemaining < 0 ? Math.abs(daysRemaining) : 0,
    };
  }

  /**
   * Adds a repair event to an existing product node.
   */
  addRepairEvent(productId, repairEvent) {
    const node = this._products.get(productId);
    if (!node) throw new Error(`Product ${productId} not found in knowledge graph`);
    node.repairHistory.push({
      date: repairEvent.date || new Date().toISOString().split('T')[0],
      issueType: repairEvent.issueType,
      description: repairEvent.description,
      cost: repairEvent.cost || null,
      serviceCenter: repairEvent.serviceCenter || null,
      claimStatus: repairEvent.claimStatus || 'unknown', // 'approved'|'rejected'|'pending'|'paid'
      ...repairEvent,
    });
  }

  // ── QUERY INTERFACE ────────────────────────────────────────────────────────

  getProduct(id) {
    return this._products.get(id) || null;
  }

  getAllProducts() {
    return [...this._products.values()];
  }

  getProductsByBrand(brand) {
    const key = normalizeKey(brand);
    const ids = this._byBrand.get(key) || new Set();
    return [...ids].map((id) => this._products.get(id)).filter(Boolean);
  }

  getProductsByCategory(category) {
    const ids = this._byCategory.get(category) || new Set();
    return [...ids].map((id) => this._products.get(id)).filter(Boolean);
  }

  /**
   * Returns products whose warranty expires within `days` days.
   * Pass `includeExpired=true` to also include already-expired products.
   */
  getProductsExpiringSoon(days, includeExpired = false, referenceDate = new Date()) {
    return this.getAllProducts().filter((p) => {
      if (!p.warrantyTimeline) return false;
      // Recompute with fresh reference date
      const timeline = this._computeWarrantyTimeline(p, referenceDate);
      if (!timeline) return false;
      if (includeExpired && timeline.isExpired) return true;
      return timeline.isActive && timeline.daysRemaining <= days;
    }).map((p) => ({
      ...p,
      warrantyTimeline: this._computeWarrantyTimeline(p, referenceDate),
    })).sort((a, b) => (a.warrantyTimeline?.daysRemaining || 0) - (b.warrantyTimeline?.daysRemaining || 0));
  }

  getHighRiskProducts(threshold = 65) {
    return this.getAllProducts()
      .filter((p) => p.risk && p.risk.riskScore >= threshold)
      .sort((a, b) => (b.risk?.riskScore || 0) - (a.risk?.riskScore || 0));
  }

  getSuspiciousProducts() {
    return this.getAllProducts()
      .filter((p) => p.fraud && p.fraud.warningLevel !== 'CLEAN')
      .sort((a, b) => (b.fraud?.fraudScore || 0) - (a.fraud?.fraudScore || 0));
  }

  /**
   * Fuzzy-searches for a product by brand, product name, or category
   * matching the user's query fragment. Used for coreference resolution.
   */
  findProductByQuery(queryFragment) {
    if (!queryFragment) return null;
    const norm = normalizeKey(queryFragment);
    const all = this.getAllProducts();

    // Exact/substring match on productName or brand first
    const exact = all.find((p) =>
      (p.productName && normalizeKey(p.productName).includes(norm)) ||
      (p.brand && normalizeKey(p.brand).includes(norm)) ||
      (p.nickname && normalizeKey(p.nickname).includes(norm))
    );
    if (exact) return exact;

    // Fuzzy match on brand
    const brandNames = all.map((p) => p.brand).filter(Boolean);
    if (brandNames.length > 0) {
      const fuzzyBrand = bestFuzzyMatch(queryFragment, brandNames, 0.6);
      if (fuzzyBrand) {
        return all.find((p) => p.brand === fuzzyBrand.match) || null;
      }
    }

    return null;
  }

  /**
   * Returns a summary snapshot of the entire knowledge graph state.
   * Used by the reasoning engine to answer overview queries.
   */
  getSummary(referenceDate = new Date()) {
    const all = this.getAllProducts();
    const active = all.filter((p) => p.warrantyTimeline?.isActive);
    const expired = all.filter((p) => p.warrantyTimeline?.isExpired);
    const expiringSoon30 = this.getProductsExpiringSoon(30, false, referenceDate);
    const highRisk = this.getHighRiskProducts(65);
    const suspicious = this.getSuspiciousProducts();

    return {
      totalProducts: all.length,
      activeWarranties: active.length,
      expiredWarranties: expired.length,
      expiringSoon30Days: expiringSoon30.length,
      highRiskCount: highRisk.length,
      suspiciousCount: suspicious.length,
      products: all.map((p) => ({
        id: p.id,
        name: p.productName,
        brand: p.brand,
        category: p.category,
        warrantyStatus: p.warrantyTimeline?.isActive ? 'active' : p.warrantyTimeline?.isExpired ? 'expired' : 'unknown',
        daysRemaining: p.warrantyTimeline?.daysRemaining,
        riskScore: p.risk?.riskScore,
        riskLevel: p.risk?.riskLevel,
        fraudWarning: p.fraud?.warningLevel,
      })),
    };
  }
}

export default WarrantyKnowledgeGraph;
