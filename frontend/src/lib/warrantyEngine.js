/**
 * warrantyEngine.js
 *
 * Thin adapter re-exporting the backend Smart Warranty Intelligence Engine
 * for frontend consumption. Keeps import paths in UI components stable
 * even if the engine's internal structure changes.
 */
export { parseInvoice } from '../../../backend/parsers/invoiceParser.js';
export { processInvoiceText, processInvoiceFile } from '../../../backend/ai-engine/warrantyIntelligencePipeline.js';
export { classifyProduct } from '../../../backend/classifier/productClassifier.js';
export { evaluateWarrantyClaim } from '../../../backend/rules-engine/warrantyEligibilityEngine.js';
export { computeProductRisk } from '../../../backend/ai-engine/productRiskEngine.js';
export { generateWarrantyAdvisory } from '../../../backend/ai-engine/warrantyAdvisorEngine.js';
export { analyzeInvoiceFraud } from '../../../backend/ai-engine/fraudDetectionEngine.js';
export { WarrantyAgent } from '../../../backend/ai-engine/assistant/warrantyAgent.js';
