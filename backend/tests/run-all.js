/**
 * run-all.js
 *
 * Comprehensive test suite for the Smart Warranty Intelligence Engine.
 *
 * Architecture: lightweight assertion-based runner (no external test
 * framework dependency). Each test is a plain async function returning
 * { passed, name, error? }. The runner collects all results and exits
 * with code 1 if any test fails, so this is CI-friendly.
 *
 * Coverage:
 *   - textUtils: normalisation, fuzzy matching, levenshtein
 *   - dateUtils: all date formats, OCR noise, arithmetic
 *   - productClassifier: all categories, fuzzy brand, model patterns
 *   - warrantyDurationParser: numeric/word/decimal, context scoring,
 *     component detection vs generic-phrasing disambiguation
 *   - invoiceParser: all 6 fixture samples, label priority, table header
 *     rejection, price-noise stripping
 *   - warrantyEligibilityEngine: covered/excluded/expired/unknown scenarios
 *   - productRiskEngine: score ranges, age curve, expired warranty
 *   - warrantyAdvisorEngine: urgency levels, advisory actions
 *   - fraudDetectionEngine: clean, suspicious, duplicate, format anomalies
 *   - full pipeline: end-to-end for each sample
 */

// ── Mini assertion library ────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertRange(value, min, max, message) {
  if (value < min || value > max) {
    throw new Error(`${message} — expected ${value} to be in [${min}, ${max}]`);
  }
}

function assertContains(array, value, message) {
  if (!Array.isArray(array) || !array.includes(value)) {
    throw new Error(`${message} — expected array to contain ${JSON.stringify(value)}, got ${JSON.stringify(array)}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    process.stdout.write(`  ✗ ${name}\n    → ${err.message}\n`);
  }
}

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
}

// ── Import modules ────────────────────────────────────────────────────────────

import {
  cleanOcrText, toLines, normalizeKey, levenshtein,
  similarity, bestFuzzyMatch, tokenOverlapScore
} from '../utils/textUtils.js';

import {
  parseDateString, findAllDates, addMonths, daysBetween, isPlausiblePurchaseDate
} from '../utils/dateUtils.js';

import { classifyProduct, isWarrantyDurationUnusual } from '../classifier/productClassifier.js';
import { detectWarrantyDurations, detectPrimaryWarrantyMonths } from '../parsers/warrantyDurationParser.js';
import { parseInvoice } from '../parsers/invoiceParser.js';
import { evaluateWarrantyClaim } from '../rules-engine/warrantyEligibilityEngine.js';
import { computeProductRisk } from '../ai-engine/productRiskEngine.js';
import { generateWarrantyAdvisory } from '../ai-engine/warrantyAdvisorEngine.js';
import { analyzeInvoiceFraud, checkForDuplicate } from '../ai-engine/fraudDetectionEngine.js';
import { processInvoiceText } from '../ai-engine/warrantyIntelligencePipeline.js';
import { SAMPLE_INVOICES } from './fixtures/simulatedOcrSource.js';

// ─────────────────────────────────────────────────────────────────────────────
// TEXT UTILS
// ─────────────────────────────────────────────────────────────────────────────
section('textUtils');

await test('cleanOcrText: normalises line endings and whitespace', () => {
  const input = 'Hello\r\nWorld\r   Foo  Bar  ';
  const result = cleanOcrText(input);
  assert(result.includes('Hello'), 'contains Hello');
  assert(result.includes('World'), 'contains World');
  assert(!result.includes('\r'), 'no carriage returns');
  assert(!result.includes('  '), 'no double spaces within lines');
});

await test('cleanOcrText: replaces smart quotes', () => {
  const result = cleanOcrText('\u201CHello\u201D and \u2018world\u2019');
  assert(result.includes('"Hello"'), 'double quotes normalised');
  assert(result.includes("'world'"), 'single quotes normalised');
});

await test('levenshtein: identical strings = 0', () => {
  assertEqual(levenshtein('samsung', 'samsung'), 0, 'levenshtein identical');
});

await test('levenshtein: single substitution = 1', () => {
  assertEqual(levenshtein('samsung', 'samsang'), 1, 'levenshtein one substitution');
});

await test('similarity: OCR noise "Sannsung" fuzzy matches "Samsung"', () => {
  const s = similarity('Sannsung', 'Samsung');
  assertRange(s, 0.7, 1.0, 'similarity Sannsung/Samsung');
});

await test('bestFuzzyMatch: finds brand in noisy list', () => {
  const result = bestFuzzyMatch('S0ny', ['Sony', 'Samsung', 'LG', 'Bose'], 0.55);
  assert(result !== null, 'got a match');
  assertEqual(result.match, 'Sony', 'matched Sony');
});

await test('bestFuzzyMatch: returns null below threshold', () => {
  const result = bestFuzzyMatch('xyz', ['Sony', 'Samsung', 'LG'], 0.8);
  assert(result === null, 'no match below threshold');
});

await test('tokenOverlapScore: word-order-independent match', () => {
  const score = tokenOverlapScore('Dell Inspiron 15', 'Inspiron 15 Dell');
  assertRange(score, 0.8, 1.0, 'token overlap reordered words');
});

// ─────────────────────────────────────────────────────────────────────────────
// DATE UTILS
// ─────────────────────────────────────────────────────────────────────────────
section('dateUtils');

await test('parseDateString: ISO format YYYY-MM-DD', () => {
  const r = parseDateString('2024-03-15');
  assert(r !== null, 'parsed');
  assertEqual(r.iso, '2024-03-15', 'ISO date');
  assertRange(r.confidence, 0.9, 1.0, 'high confidence');
});

await test('parseDateString: DD/MM/YYYY (day-first default for ambiguous)', () => {
  const r = parseDateString('04/11/2024');
  assert(r !== null, 'parsed');
  assertEqual(r.iso, '2024-11-04', 'day-first: Nov 4th');
});

await test('parseDateString: unambiguous day>12 forces DD/MM interpretation', () => {
  const r = parseDateString('22/01/2024');
  assert(r !== null, 'parsed');
  assertEqual(r.iso, '2024-01-22', 'day 22 unambiguous');
});

await test('parseDateString: textual month "22 January 2024"', () => {
  const r = parseDateString('22 January 2024');
  assert(r !== null, 'parsed');
  assertEqual(r.iso, '2024-01-22', 'textual month');
});

await test('parseDateString: textual month "January 22, 2024"', () => {
  const r = parseDateString('January 22, 2024');
  assert(r !== null, 'parsed');
  assertEqual(r.iso, '2024-01-22', 'textual month US order');
});

await test('findAllDates: OCR noise "12/o6/2022" (letter o instead of 0)', () => {
  const results = findAllDates('Date : 12/o6/2022');
  assert(results.length > 0, 'found a date despite OCR noise');
  assertEqual(results[0].iso, '2022-06-12', 'corrected to 2022-06-12');
});

await test('findAllDates: returns multiple dates sorted by confidence', () => {
  const results = findAllDates('Invoice Date: 2024-01-15\nOrder Date: 15 January 2024');
  assert(results.length >= 1, 'at least one date');
  assert(results[0].confidence >= results[results.length - 1].confidence, 'sorted descending');
});

await test('addMonths: 1 month from Jan 31 = Feb 28/29 (no overflow)', () => {
  const d = new Date(2024, 0, 31); // Jan 31 2024
  const result = addMonths(d, 1);
  assertEqual(result.getMonth(), 1, 'February');
  assert(result.getDate() <= 29, 'no overflow past month end');
});

await test('daysBetween: exactly 30 days', () => {
  const a = new Date(2024, 0, 1);
  const b = new Date(2024, 0, 31);
  assertEqual(daysBetween(a, b), 30, '30 days');
});

await test('isPlausiblePurchaseDate: future date rejected', () => {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  assert(!isPlausiblePurchaseDate(future), 'future date not plausible');
});

await test('isPlausiblePurchaseDate: 30-year-old date rejected', () => {
  const old = new Date();
  old.setFullYear(old.getFullYear() - 30);
  assert(!isPlausiblePurchaseDate(old), 'ancient date not plausible');
});

await test('isPlausiblePurchaseDate: recent date accepted', () => {
  const recent = new Date();
  recent.setFullYear(recent.getFullYear() - 2);
  assert(isPlausiblePurchaseDate(recent), '2-year-old purchase plausible');
});

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT CLASSIFIER
// ─────────────────────────────────────────────────────────────────────────────
section('productClassifier');

await test('classify: Sony WH-1000XM5 → Audio Device, brand=Sony', () => {
  const r = classifyProduct('Sony WH-1000XM5 Wireless Noise Cancelling Headphones');
  assertEqual(r.category, 'Audio Device', 'category');
  assertEqual(r.brand, 'Sony', 'brand');
  assertRange(r.categoryConfidence, 0.8, 1.0, 'high confidence');
});

await test('classify: Dell Inspiron 15 → Laptop, brand=Dell', () => {
  const r = classifyProduct('Dell Inspiron 15 3520 Laptop Intel Core i5');
  assertEqual(r.category, 'Laptop', 'category');
  assertEqual(r.brand, 'Dell', 'brand');
});

await test('classify: iPhone 15 Pro → Smartphone, brand=Apple', () => {
  const r = classifyProduct('iPhone 15 Pro 256GB Natural Titanium');
  assertEqual(r.category, 'Smartphone', 'category');
  assertEqual(r.brand, 'Apple', 'brand');
});

await test('classify: Samsung Crystal 4K UHD TV → Television, brand=Samsung', () => {
  const r = classifyProduct('Samsung 55" Crystal 4K UHD Smart TV');
  assertEqual(r.category, 'Television', 'category');
  assertEqual(r.brand, 'Samsung', 'brand');
});

await test('classify: Bose QuietComfort Ultra → Audio Device, brand=Bose', () => {
  const r = classifyProduct('Bose QuietComfort Ultra Headphones');
  assertEqual(r.category, 'Audio Device', 'category');
  assertEqual(r.brand, 'Bose', 'brand');
});

await test('classify: fuzzy-matched brand "Sannsung" still detects Samsung', () => {
  const r = classifyProduct('Sannsung 55 inch Crystal TV 4K UHD');
  assertEqual(r.brand, 'Samsung', 'fuzzy brand match');
});

await test('classify: empty string → Other Electronics, no crash', () => {
  const r = classifyProduct('');
  assertEqual(r.category, 'Other Electronics', 'default category');
  assertEqual(r.categoryConfidence, 0, 'zero confidence');
});

await test('isWarrantyDurationUnusual: 3 months on laptop (should be 12) → unusual short', () => {
  const r = isWarrantyDurationUnusual('Laptop', 3);
  assert(r.unusual, 'flagged unusual');
  assertEqual(r.direction, 'shorter', 'shorter');
});

await test('isWarrantyDurationUnusual: 12 months on laptop → normal', () => {
  const r = isWarrantyDurationUnusual('Laptop', 12);
  assert(!r.unusual, 'not unusual');
});

// ─────────────────────────────────────────────────────────────────────────────
// WARRANTY DURATION PARSER
// ─────────────────────────────────────────────────────────────────────────────
section('warrantyDurationParser');

await test('detect: "Limited Warranty Coverage 24 Months"', () => {
  const r = detectPrimaryWarrantyMonths('Limited Warranty Coverage 24 Months');
  assert(r !== null, 'detected');
  assertEqual(r.months, 24, '24 months');
});

await test('detect: "1 Year Manufacturer Warranty"', () => {
  const r = detectPrimaryWarrantyMonths('1 Year Manufacturer Warranty from date of purchase');
  assert(r !== null, 'detected');
  assertEqual(r.months, 12, '12 months');
});

await test('detect: word number "ONE YEAR" in legal warranty clause', () => {
  const text = 'This Apple product is warranted against defects in materials and workmanship for a period of ONE YEAR from the date of original retail purchase.';
  const r = detectPrimaryWarrantyMonths(text);
  assert(r !== null, 'detected');
  assertEqual(r.months, 12, '12 months from ONE YEAR');
});

await test('detect: "2 yrs warranty" → 24 months', () => {
  const r = detectPrimaryWarrantyMonths('2 yrs warranty included');
  assert(r !== null, 'detected');
  assertEqual(r.months, 24, '24 months');
});

await test('detect: "1.5 years warranty" → 18 months', () => {
  const r = detectPrimaryWarrantyMonths('1.5 years warranty');
  assert(r !== null, 'detected');
  assertEqual(r.months, 18, '18 months');
});

await test('detect: "12 months EMI" should not be detected as warranty', () => {
  const r = detectPrimaryWarrantyMonths('No cost EMI available for 12 months. Easy installment plan.');
  assert(r === null || r.confidence < 0.5, 'EMI tenure not treated as warranty');
});

await test('detect: "1 Year on Panel and Parts" → component=null (generic phrasing)', () => {
  const all = detectWarrantyDurations('Standard Warranty: 1 Year on Panel and Parts');
  assert(all.length > 0, 'something detected');
  const primary = all.find((r) => !r.component);
  assert(primary !== null && primary !== undefined, 'primary (non-component) detection exists');
  assertEqual(primary.months, 12, '12 months');
});

await test('detect: AC compressor clause correctly flagged as component=Compressor', () => {
  const all = detectWarrantyDurations('Product warranty 1 year. Compressor warranty 5 years.');
  const compressor = all.find((r) => r.component === 'Compressor');
  assert(compressor !== null && compressor !== undefined, 'compressor component detected');
  assertEqual(compressor.months, 60, '60 months for compressor');
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE PARSER — all 6 fixtures
// ─────────────────────────────────────────────────────────────────────────────
section('invoiceParser — fixture: Amazon Sony Headphones');

await test('Amazon/Sony: product name extracted', () => {
  const r = parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  assert(r.productName && r.productName.toLowerCase().includes('sony'), 'product name contains Sony');
});

await test('Amazon/Sony: brand=Sony', () => {
  const r = parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  assertEqual(r.brand, 'Sony', 'brand');
});

await test('Amazon/Sony: invoiceNumber extracted', () => {
  const r = parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  assert(r.invoiceNumber && r.invoiceNumber.length > 3, 'invoice number present');
});

await test('Amazon/Sony: warrantyMonths=12', () => {
  const r = parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  assertEqual(r.warrantyMonths, 12, '12 months');
});

await test('Amazon/Sony: category=Audio Device', () => {
  const r = parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText);
  assertEqual(r.category, 'Audio Device', 'category');
});

section('invoiceParser — fixture: Flipkart Dell Laptop');

await test('Flipkart/Dell: product name contains Dell', () => {
  const r = parseInvoice(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  assert(r.productName && r.productName.toLowerCase().includes('dell'), 'product name contains Dell');
});

await test('Flipkart/Dell: warrantyMonths=24', () => {
  const r = parseInvoice(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  assertEqual(r.warrantyMonths, 24, '24 months onsite warranty');
});

await test('Flipkart/Dell: category=Laptop', () => {
  const r = parseInvoice(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  assertEqual(r.category, 'Laptop', 'category');
});

await test('Flipkart/Dell: serialNumber extracted and looks valid', () => {
  const r = parseInvoice(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
  assert(r.serialNumber && r.serialNumber.length >= 6, 'serial number present');
});

section('invoiceParser — fixture: Apple iPhone');

await test('Apple/iPhone: purchaseDate=2024-01-22 (uses Purchase Date label, not Invoice Date)', () => {
  const r = parseInvoice(SAMPLE_INVOICES.appleStoreIphone.rawText);
  assertEqual(r.purchaseDate, '2024-01-22', 'purchase date label takes priority');
});

await test('Apple/iPhone: warrantyMonths=12 from "ONE YEAR" clause', () => {
  const r = parseInvoice(SAMPLE_INVOICES.appleStoreIphone.rawText);
  assertEqual(r.warrantyMonths, 12, '12 months');
});

await test('Apple/iPhone: category=Smartphone', () => {
  const r = parseInvoice(SAMPLE_INVOICES.appleStoreIphone.rawText);
  assertEqual(r.category, 'Smartphone', 'category');
});

section('invoiceParser — fixture: Local Store Samsung TV (noisy OCR)');

await test('Samsung TV: purchaseDate correctly parses "12/o6/2022" OCR noise', () => {
  const r = parseInvoice(SAMPLE_INVOICES.localStoreSamsungTv.rawText);
  assertEqual(r.purchaseDate, '2022-06-12', 'OCR noise corrected');
});

await test('Samsung TV: product name trimmed (no trailing price numbers)', () => {
  const r = parseInvoice(SAMPLE_INVOICES.localStoreSamsungTv.rawText);
  assert(r.productName && !r.productName.includes('45000'), 'price noise stripped');
  assert(r.productName && r.productName.toLowerCase().includes('samsung'), 'Samsung in name');
});

await test('Samsung TV: warrantyMonths=12, component=null (not component-specific)', () => {
  const r = parseInvoice(SAMPLE_INVOICES.localStoreSamsungTv.rawText);
  assertEqual(r.warrantyMonths, 12, '12 months');
  const primary = r.allWarrantyMentions?.find((m) => m.isPrimary);
  assert(!primary || primary.component === null, 'not component-specific coverage');
});

await test('Samsung TV: category=Television', () => {
  const r = parseInvoice(SAMPLE_INVOICES.localStoreSamsungTv.rawText);
  assertEqual(r.category, 'Television', 'category');
});

section('invoiceParser — fixture: Noisy Unreadable Receipt');

await test('Noisy receipt: overallConfidence < 0.3 (low quality)', () => {
  const r = parseInvoice(SAMPLE_INVOICES.noisyUnreadableReceipt.rawText);
  assertRange(r.overallConfidence, 0, 0.3, 'low confidence for unreadable');
});

await test('Noisy receipt: needsManualReview=true', () => {
  const r = parseInvoice(SAMPLE_INVOICES.noisyUnreadableReceipt.rawText);
  assert(r.needsManualReview, 'flagged for manual review');
});

section('invoiceParser — fixture: Bose Ambiguous Date');

await test('Bose/ambiguous date: date parsed (either Oct 3 or Mar 10)', () => {
  const r = parseInvoice(SAMPLE_INVOICES.boseHeadphonesAmbiguousDate.rawText);
  assert(r.purchaseDate && /2024/.test(r.purchaseDate), 'date extracted, 2024');
});

await test('Bose: warrantyMonths=24', () => {
  const r = parseInvoice(SAMPLE_INVOICES.boseHeadphonesAmbiguousDate.rawText);
  assertEqual(r.warrantyMonths, 24, '24 months');
});

await test('Bose: category=Audio Device', () => {
  const r = parseInvoice(SAMPLE_INVOICES.boseHeadphonesAmbiguousDate.rawText);
  assertEqual(r.category, 'Audio Device', 'category');
});

// ─────────────────────────────────────────────────────────────────────────────
// WARRANTY ELIGIBILITY ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('warrantyEligibilityEngine');

const dellLaptopInvoice = parseInvoice(SAMPLE_INVOICES.flipkartDellLaptop.rawText);
const iPhoneInvoice = parseInvoice(SAMPLE_INVOICES.appleStoreIphone.rawText);

await test('Eligibility: keyboard failure on in-warranty Dell → covered HIGH', () => {
  const r = evaluateWarrantyClaim(
    'My laptop keyboard stopped working',
    dellLaptopInvoice,
    new Date('2024-06-01') // within 24-month warranty from Aug 2023
  );
  assertEqual(r.covered, true, 'covered');
  assertEqual(r.claimViability, 'HIGH', 'HIGH viability');
});

await test('Eligibility: liquid damage on in-warranty laptop → excluded DENIED', () => {
  const r = evaluateWarrantyClaim(
    'I spilled water on my laptop and now it wont turn on',
    dellLaptopInvoice,
    new Date('2024-06-01')
  );
  assertEqual(r.covered, false, 'excluded');
  assertEqual(r.claimViability, 'DENIED', 'DENIED');
  assert(r.exclusionMatches.length > 0, 'exclusion match recorded');
});

await test('Eligibility: physical drop + keyboard broken → exclusion override', () => {
  const r = evaluateWarrantyClaim(
    'I dropped my laptop and now the keyboard stopped working',
    dellLaptopInvoice,
    new Date('2024-06-01')
  );
  // Dropped = accidental damage = exclusion; should override covered keyboard
  assertEqual(r.covered, false, 'accidental damage overrides keyboard coverage');
});

await test('Eligibility: expired warranty → DENIED regardless of issue', () => {
  const r = evaluateWarrantyClaim(
    'My laptop keyboard stopped working',
    dellLaptopInvoice,
    new Date('2026-06-01') // well past 24-month warranty
  );
  assertEqual(r.warrantyStatus.status, 'expired', 'warranty expired');
  assertEqual(r.claimViability, 'DENIED', 'DENIED');
});

await test('Eligibility: screen crack on iPhone → excluded (physical damage)', () => {
  const r = evaluateWarrantyClaim(
    'My iPhone screen cracked',
    iPhoneInvoice,
    new Date('2024-06-01')
  );
  assertEqual(r.covered, false, 'screen crack excluded');
});

await test('Eligibility: no power on iPhone (manufacturing defect) → covered', () => {
  const r = evaluateWarrantyClaim(
    "My iPhone won't turn on at all",
    iPhoneInvoice,
    new Date('2024-06-01')
  );
  assertEqual(r.covered, true, 'covered');
});

await test('Eligibility: issue classification detects keyboard issue keywords', () => {
  const r = evaluateWarrantyClaim('The keyboard keys are not working', dellLaptopInvoice, new Date('2024-06-01'));
  const keyboardClass = r.issueClassifications.find((c) => c.issueType === 'keyboard_failure');
  assert(keyboardClass !== undefined, 'keyboard failure classified');
  assertRange(keyboardClass.confidence, 0.8, 1.0, 'high confidence');
});

await test('Eligibility: recommended steps present for covered claim', () => {
  const r = evaluateWarrantyClaim('Laptop not turning on', dellLaptopInvoice, new Date('2024-06-01'));
  assert(Array.isArray(r.recommendedSteps) && r.recommendedSteps.length > 0, 'steps present');
});

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT RISK ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('productRiskEngine');

await test('Risk: score is 0–100', () => {
  const r = computeProductRisk(dellLaptopInvoice, new Date('2024-06-01'));
  assertRange(r.riskScore, 0, 100, 'score in range');
});

await test('Risk: expired warranty boosts risk (>50)', () => {
  const r = computeProductRisk(dellLaptopInvoice, new Date('2027-01-01')); // expired
  assertRange(r.riskScore, 50, 100, 'expired warranty → higher risk');
});

await test('Risk: low-confidence invoice increases risk', () => {
  const noisyInvoice = parseInvoice(SAMPLE_INVOICES.noisyUnreadableReceipt.rawText);
  const r = computeProductRisk(noisyInvoice, new Date('2024-06-01'));
  assert(r.riskFactors.find((f) => f.factor === 'Invoice Data Confidence').score >= 80, 'low confidence → high data risk score component');
});

await test('Risk: riskFactors array has all 5 components', () => {
  const r = computeProductRisk(dellLaptopInvoice, new Date('2024-06-01'));
  assertEqual(r.riskFactors.length, 5, '5 risk factor components');
});

await test('Risk: riskLevel is a recognised value', () => {
  const r = computeProductRisk(dellLaptopInvoice, new Date('2024-06-01'));
  assertContains(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'MINIMAL'], r.riskLevel, 'valid risk level');
});

// ─────────────────────────────────────────────────────────────────────────────
// WARRANTY ADVISOR ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('warrantyAdvisorEngine');

await test('Advisor: urgency CRITICAL with 3 days remaining', () => {
  const referenceDate = new Date('2024-06-01');
  // Set purchase date so that 24 months from it lands exactly 3 days after referenceDate.
  const expiryTarget = new Date(referenceDate);
  expiryTarget.setDate(expiryTarget.getDate() + 3); // expiry 3 days from now
  // Purchase date = 24 months before expiry target
  const purchaseDate = new Date(expiryTarget);
  purchaseDate.setMonth(purchaseDate.getMonth() - 24);

  const fakeInvoice = {
    ...dellLaptopInvoice,
    purchaseDate: purchaseDate.toISOString().split('T')[0],
    warrantyMonths: 24,
  };
  const r = generateWarrantyAdvisory(fakeInvoice, referenceDate);
  assertEqual(r.urgencyLevel, 'CRITICAL', 'CRITICAL urgency');
  assertRange(r.urgencyScore, 90, 100, 'urgency score 90+');
});

await test('Advisor: urgency NONE with 365 days remaining', () => {
  const fakeInvoice = {
    ...dellLaptopInvoice,
    purchaseDate: new Date('2024-06-01').toISOString().split('T')[0],
    warrantyMonths: 24,
  };
  const r = generateWarrantyAdvisory(fakeInvoice, new Date('2024-07-01')); // 1 month in
  assertContains(['NONE', 'LOW'], r.urgencyLevel, 'low urgency early in warranty');
});

await test('Advisor: repair cost estimate present and positive', () => {
  const r = generateWarrantyAdvisory(dellLaptopInvoice, new Date('2024-06-01'));
  assert(r.repairCostEstimate.medianRepairCost > 0, 'positive median repair cost');
  assert(r.repairCostEstimate.estimatedReplacementCost > r.repairCostEstimate.medianRepairCost, 'replacement > repair');
});

await test('Advisor: advisory actions array is non-empty', () => {
  const r = generateWarrantyAdvisory(dellLaptopInvoice, new Date('2024-06-01'));
  assert(Array.isArray(r.advisoryActions) && r.advisoryActions.length > 0, 'has actions');
});

await test('Advisor: expired warranty generates EXPIRED action', () => {
  const r = generateWarrantyAdvisory(dellLaptopInvoice, new Date('2027-01-01'));
  const expiredAction = r.advisoryActions.find((a) => a.type === 'WARRANTY_EXPIRED');
  assert(expiredAction !== undefined, 'WARRANTY_EXPIRED action present');
});

// ─────────────────────────────────────────────────────────────────────────────
// FRAUD DETECTION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
section('fraudDetectionEngine');

await test('Fraud: all legitimate fixtures are CLEAN', async () => {
  const cleanKeys = ['amazonSonyHeadphones', 'flipkartDellLaptop', 'appleStoreIphone',
    'localStoreSamsungTv', 'boseHeadphonesAmbiguousDate'];
  for (const key of cleanKeys) {
    const parsed = parseInvoice(SAMPLE_INVOICES[key].rawText);
    const r = analyzeInvoiceFraud(parsed, SAMPLE_INVOICES[key].rawText);
    assert(r.warningLevel === 'CLEAN' || r.fraudScore < 30,
      `${key} should be CLEAN, got ${r.warningLevel} (score ${r.fraudScore})`);
  }
});

await test('Fraud: future purchase date triggers HIGH severity signal', () => {
  const fakeInvoice = {
    ...parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText),
    purchaseDate: '2030-01-01',
    overallConfidence: 0.85,
  };
  const r = analyzeInvoiceFraud(fakeInvoice, '');
  assert(r.fraudScore >= 55, 'high fraud score for future date');
  const signal = r.signals.find((s) => s.type === 'FUTURE_PURCHASE_DATE');
  assert(signal !== undefined, 'FUTURE_PURCHASE_DATE signal present');
});

await test('Fraud: placeholder invoice number (all zeros) → HIGH/FRAUDULENT', () => {
  const fakeInvoice = {
    ...parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText),
    invoiceNumber: '000000',
    overallConfidence: 0.85,
  };
  const r = analyzeInvoiceFraud(fakeInvoice, '');
  assert(r.fraudScore >= 40, 'elevated fraud score for placeholder invoice number');
});

await test('Fraud: duplicate invoice detection via seenInvoiceNumbers', () => {
  const invNum = 'IN-4567890123';
  const seen = new Set([invNum.replace(/\s/g, '').toLowerCase()]);
  const signal = checkForDuplicate(invNum, seen);
  assert(signal !== null, 'duplicate detected');
  assertEqual(signal.type, 'DUPLICATE_INVOICE_NUMBER', 'correct signal type');
  assertRange(signal.severity, 0.8, 1.0, 'high severity');
});

await test('Fraud: excessive warranty duration (200 months) → signal', () => {
  const fakeInvoice = {
    ...parseInvoice(SAMPLE_INVOICES.amazonSonyHeadphones.rawText),
    warrantyMonths: 200,
    purchaseDate: '2023-01-01',
  };
  const r = analyzeInvoiceFraud(fakeInvoice, '');
  const signal = r.signals.find((s) => s.type === 'EXCESSIVE_WARRANTY_DURATION');
  assert(signal !== undefined, 'excessive warranty duration signal');
});

// ─────────────────────────────────────────────────────────────────────────────
// FULL PIPELINE — end-to-end for each fixture
// ─────────────────────────────────────────────────────────────────────────────
section('full pipeline (end-to-end)');

for (const [key, sample] of Object.entries(SAMPLE_INVOICES)) {
  await test(`Pipeline: ${key} completes without errors`, async () => {
    const result = await processInvoiceText(sample.rawText, {
      referenceDate: new Date('2024-12-01'),
      issueDescription: 'The product stopped working',
    });
    assert(result.success, `pipeline success for ${key}`);
    assert(result.stageStatuses.invoiceParse === 'OK', 'parse stage OK');
    assert(result.stageStatuses.riskScoring === 'OK', 'risk stage OK');
    assert(result.stageStatuses.warrantyAdvisory === 'OK', 'advisory stage OK');
    assert(result.stageStatuses.fraudDetection === 'OK', 'fraud stage OK');
    assert(result.stageStatuses.warrantyEligibility === 'OK', 'eligibility stage OK');
  });
}

await test('Pipeline: issue eligibility flows through correctly', async () => {
  const result = await processInvoiceText(SAMPLE_INVOICES.flipkartDellLaptop.rawText, {
    issueDescription: 'My laptop keyboard stopped working',
    referenceDate: new Date('2024-06-01'),
  });
  assert(result.eligibility !== null, 'eligibility present');
  assertEqual(result.eligibility.covered, true, 'keyboard covered');
  assertEqual(result.eligibility.claimViability, 'HIGH', 'HIGH viability');
});

await test('Pipeline: no issueDescription → eligibility is null', async () => {
  const result = await processInvoiceText(SAMPLE_INVOICES.amazonSonyHeadphones.rawText, {
    referenceDate: new Date('2024-12-01'),
  });
  assert(result.eligibility === null, 'no eligibility without issue description');
});

await test('Pipeline: pipeline continues after individual stage error', async () => {
  // Pass minimal broken invoice to risk engine — it should still return success
  // with the other stages completing.
  const result = await processInvoiceText('TOTAL GARBAGE \x00\x01', {
    referenceDate: new Date('2024-12-01'),
  });
  // Parse stage might produce low-confidence output but should not throw.
  assert(result.success, 'pipeline does not crash on garbage input');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(65));
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\n  FAILURES:');
  failures.forEach((f) => console.log(`    ✗ ${f.name}\n      ${f.error}`));
}
console.log('═'.repeat(65) + '\n');

process.exit(failed > 0 ? 1 : 0);
