/**
 * warrantyIntelligencePipeline.js
 *
 * AI ENGINE ORCHESTRATOR — UNIFIED PROCESSING PIPELINE
 *
 * This is the single entry point for the Smart Warranty Intelligence Engine.
 * It chains all modules in the correct order, manages error propagation
 * gracefully (a failure in fraud detection does NOT block the invoice parse),
 * and returns one unified structured output.
 *
 * Pipeline stages:
 *   [1] OCR         → extractInvoiceText (ocrEngine) / simulated text input
 *   [2] Parse       → parseInvoice (invoiceParser)
 *   [3] Classify    → (already embedded in invoiceParser via productClassifier)
 *   [4] Warranty    → (already embedded in invoiceParser via warrantyDurationParser)
 *   [5] Risk        → computeProductRisk (productRiskEngine)
 *   [6] Advisory    → generateWarrantyAdvisory (warrantyAdvisorEngine)
 *   [7] Fraud       → analyzeInvoiceFraud (fraudDetectionEngine)
 *   [8] Eligibility → evaluateWarrantyClaim (warrantyEligibilityEngine) [optional, requires issue]
 *
 * Usage — full pipeline with a real image file (browser/Node with Tesseract):
 *   import { processInvoiceFile } from './ai-engine/warrantyIntelligencePipeline.js';
 *   const result = await processInvoiceFile(imageFile, { issueDescription: 'keyboard stopped working' });
 *
 * Usage — text-only pipeline (e.g. test harness with simulated OCR output):
 *   import { processInvoiceText } from './ai-engine/warrantyIntelligencePipeline.js';
 *   const result = await processInvoiceText(rawOcrText, { issueDescription: 'keyboard stopped working' });
 */

import { parseInvoice } from '../parsers/invoiceParser.js';
import { computeProductRisk } from './productRiskEngine.js';
import { generateWarrantyAdvisory } from './warrantyAdvisorEngine.js';
import { analyzeInvoiceFraud } from './fraudDetectionEngine.js';
import { evaluateWarrantyClaim } from '../rules-engine/warrantyEligibilityEngine.js';
import { extractInvoiceText } from '../ocr/ocrEngine.js';

/**
 * Wraps a stage function so a failure returns a structured error object
 * rather than throwing and killing the whole pipeline.
 */
async function runStage(stageName, fn) {
  try {
    const result = await fn();
    return { success: true, data: result, stageName };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      stageName,
      data: null,
    };
  }
}

/**
 * Processes raw OCR text (from any source) through the full intelligence pipeline.
 *
 * @param {string} rawOcrText       Raw text output from Tesseract or simulation.
 * @param {object} [options]
 * @param {string} [options.issueDescription]  User-reported issue for eligibility engine.
 * @param {Date}   [options.referenceDate]      For testability: override "today".
 * @param {Set}    [options.seenInvoiceNumbers] For duplicate fraud detection.
 * @param {Map}    [options.invoiceRegistry]    For duplicate audit trail.
 * @returns {Promise<object>} Unified intelligence report.
 */
export async function processInvoiceText(rawOcrText, options = {}) {
  const {
    issueDescription = null,
    referenceDate = new Date(),
    seenInvoiceNumbers = null,
    invoiceRegistry = null,
  } = options;

  const pipelineStarted = Date.now();
  const stages = {};

  // ── STAGE 1: PARSE ────────────────────────────────────────────────────────
  const parseStage = await runStage('invoiceParse', () => parseInvoice(rawOcrText));
  stages.invoiceParse = parseStage;

  if (!parseStage.success || !parseStage.data) {
    return {
      success: false,
      error: `Invoice parsing failed: ${parseStage.error}`,
      stages,
      processingTimeMs: Date.now() - pipelineStarted,
    };
  }

  const parsedInvoice = parseStage.data;

  // ── STAGE 2: RISK SCORING ─────────────────────────────────────────────────
  const riskStage = await runStage('riskScoring', () =>
    computeProductRisk(parsedInvoice, referenceDate)
  );
  stages.riskScoring = riskStage;

  // ── STAGE 3: WARRANTY ADVISORY ────────────────────────────────────────────
  const advisoryStage = await runStage('warrantyAdvisory', () =>
    generateWarrantyAdvisory(parsedInvoice, referenceDate)
  );
  stages.warrantyAdvisory = advisoryStage;

  // ── STAGE 4: FRAUD DETECTION ──────────────────────────────────────────────
  const fraudStage = await runStage('fraudDetection', () =>
    analyzeInvoiceFraud(parsedInvoice, rawOcrText, { seenInvoiceNumbers, invoiceRegistry })
  );
  stages.fraudDetection = fraudStage;

  // ── STAGE 5: ELIGIBILITY (only if issue description provided) ─────────────
  let eligibilityStage = null;
  if (issueDescription && issueDescription.trim().length > 0) {
    eligibilityStage = await runStage('warrantyEligibility', () =>
      evaluateWarrantyClaim(issueDescription, parsedInvoice, referenceDate)
    );
    stages.warrantyEligibility = eligibilityStage;
  }

  // ── ASSEMBLE UNIFIED REPORT ───────────────────────────────────────────────
  const processingTimeMs = Date.now() - pipelineStarted;
  const stageStatuses = Object.fromEntries(
    Object.entries(stages).map(([k, v]) => [k, v.success ? 'OK' : `ERROR: ${v.error}`])
  );

  return {
    success: true,
    processingTimeMs,
    stageStatuses,

    // Core invoice data.
    invoice: {
      productName: parsedInvoice.productName,
      brand: parsedInvoice.brand,
      seller: parsedInvoice.seller,
      invoiceNumber: parsedInvoice.invoiceNumber,
      serialNumber: parsedInvoice.serialNumber,
      purchaseDate: parsedInvoice.purchaseDate,
      warrantyMonths: parsedInvoice.warrantyMonths,
      category: parsedInvoice.category,
      expectedWarrantyMonths: parsedInvoice.expectedWarrantyMonths,
      overallConfidence: parsedInvoice.overallConfidence,
      needsManualReview: parsedInvoice.needsManualReview,
      lowConfidenceFields: parsedInvoice.lowConfidenceFields,
      fieldConfidence: parsedInvoice.fieldConfidence,
    },

    // Risk assessment.
    risk: riskStage.success ? {
      riskScore: riskStage.data.riskScore,
      riskLevel: riskStage.data.riskLevel,
      riskLevelLabel: riskStage.data.riskLevelLabel,
      recommendation: riskStage.data.recommendation,
      components: riskStage.data.components,
    } : { error: riskStage.error },

    // Warranty advisory.
    advisory: advisoryStage.success ? {
      urgencyScore: advisoryStage.data.urgencyScore,
      urgencyLevel: advisoryStage.data.urgencyLevel,
      warrantyTimeline: advisoryStage.data.warrantyTimeline,
      repairCostEstimate: advisoryStage.data.repairCostEstimate,
      extendedWarrantyRecommended: advisoryStage.data.extendedWarrantyRecommended,
      advisoryActions: advisoryStage.data.advisoryActions,
    } : { error: advisoryStage.error },

    // Fraud signals.
    fraud: fraudStage.success ? {
      fraudScore: fraudStage.data.fraudScore,
      warningLevel: fraudStage.data.warningLevel,
      warningLabel: fraudStage.data.warningLabel,
      recommendedAction: fraudStage.data.recommendedAction,
      signals: fraudStage.data.signals,
      summary: fraudStage.data.summary,
    } : { error: fraudStage.error },

    // Claim eligibility (present only if issueDescription was provided).
    eligibility: eligibilityStage
      ? eligibilityStage.success
        ? {
            issueDescription,
            covered: eligibilityStage.data.covered,
            coverageConfidence: eligibilityStage.data.coverageConfidence,
            coverageReason: eligibilityStage.data.coverageReason,
            claimViability: eligibilityStage.data.claimViability,
            warrantyStatus: eligibilityStage.data.warrantyStatus,
            issueClassifications: eligibilityStage.data.issueClassifications,
            exclusionMatches: eligibilityStage.data.exclusionMatches,
            recommendedSteps: eligibilityStage.data.recommendedSteps,
          }
        : { error: eligibilityStage.error }
      : null,

    // Full raw outputs for detailed debugging / logging.
    _raw: {
      parsedInvoice,
      riskReport: riskStage.data,
      advisoryReport: advisoryStage.data,
      fraudReport: fraudStage.data,
      eligibilityReport: eligibilityStage?.data || null,
    },
  };
}

/**
 * Processes an invoice file (image or PDF) through the full pipeline,
 * including the OCR step. Requires Tesseract.js to be installed
 * (`npm install tesseract.js`) and the appropriate WASM files available.
 *
 * For PDF inputs, also requires a `pdfRenderer` function backed by pdfjs-dist.
 *
 * @param {File|Blob|HTMLCanvasElement|HTMLImageElement|string|Buffer} imageFile
 * @param {object} [options] Same as processInvoiceText, plus:
 * @param {function} [options.pdfRenderer] Required if imageFile is a PDF.
 * @param {string}   [options.ocrLang='eng']
 */
export async function processInvoiceFile(imageFile, options = {}) {
  const ocrResult = await extractInvoiceText(imageFile, {
    lang: options.ocrLang || 'eng',
    renderer: options.pdfRenderer,
  });

  return processInvoiceText(ocrResult.rawText, options);
}

export default { processInvoiceText, processInvoiceFile };
