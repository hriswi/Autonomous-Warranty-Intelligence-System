/**
 * warrantyEngine.js
 *
 * Thin adapter re-exporting the local Smart Warranty Intelligence Engine
 * for frontend consumption. All AI processing runs in the browser.
 */
export { parseInvoice } from './engine/parsers/invoiceParser.js';
export { processInvoiceText, processInvoiceFile } from './engine/ai-engine/warrantyIntelligencePipeline.js';
export { classifyProduct } from './engine/classifier/productClassifier.js';
export { evaluateWarrantyClaim } from './engine/rules-engine/warrantyEligibilityEngine.js';
export { computeProductRisk } from './engine/ai-engine/productRiskEngine.js';
export { generateWarrantyAdvisory } from './engine/ai-engine/warrantyAdvisorEngine.js';
export { analyzeInvoiceFraud } from './engine/ai-engine/fraudDetectionEngine.js';
export { WarrantyAgent } from './engine/ai-engine/assistant/warrantyAgent.js';
export { extractInvoiceText, extractTextFromImage, terminateOcrEngine } from './engine/ocr/ocrEngine.js';
