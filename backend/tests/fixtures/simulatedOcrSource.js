/**
 * simulatedOcrSource.js
 *
 * TEST-ONLY harness, not part of the production pipeline.
 *
 * The real `extractTextFromImage` in ocrEngine.js requires an actual
 * image/PDF and a running Tesseract worker (WASM + downloaded language
 * data), which needs network access or pre-fetched assets and isn't
 * available in this sandbox. To make the rest of the engine (cleaning,
 * parsing, classification, warranty detection, eligibility, advisor)
 * fully testable right now, this module provides realistic *noisy* OCR
 * output strings — the kind of text Tesseract actually emits from real
 * invoice photos, including the typical character-level noise patterns
 * (l/1/I confusion, missing spaces, broken table columns).
 *
 * In production, this module is never imported. `ocrEngine.js` is the
 * real OCR entry point. Every fixture below is a synthetic stand-in
 * for what `extractTextFromImage(...).rawText` would return.
 */

export const SAMPLE_INVOICES = {
  amazonSonyHeadphones: {
    label: 'Amazon - Sony WH-1000XM5 Headphones',
    rawText: `
amazon.in
Tax lnvoice/Bill of Supply/Cash Memo
(Original for Recipient)

Sold By : Appario Retail Private Ltd
Order Number: 408-1234567-8901234
Order Date: 03.11.2024
Invoice Number : IN-4567890123
Invoice Date : 04.11.2024

Description: Sony WH-1000XM5 Wireless Industry Leading
Noise Cancelling Headphones with Auto NC Optimizer
Brand: Sony
Serial No: SNY5X9928817A
Qty: 1
Unit Price: Rs.29,990.00
Total: Rs.29,990.00

Warranty: 1 Year Manufacturer Warranty from the date
of purchase. Limited Warranty Coverage 12 Months.

Thank you for shopping with us.
`,
  },

  flipkartDellLaptop: {
    label: 'Flipkart - Dell Inspiron 15 Laptop',
    rawText: `
Flipkart.com
TAX INVOICE

Order ID: OD11234567890123
lnvoice No: FAS1234567
lnvoice Date: 15-08-2023

Seller: RetailNet Online Pvt Ltd
GSTIN: 27AABCU9603R1ZM

Item: Dell lnspiron 15 3520 Laptop (Intel Core i5,
8GB RAM, 512GB SSD, Win 11)
Brand : Dell
S/N : DL3520887766XK
HSN: 8471

Qty  1
Gross Amount  Rs. 54,990.00
Taxable Value  Rs. 54,990.00

Manufacturer Warranty Coverage: 24 Months onsite warranty
from date of delivery.

This is a computer generated invoice.
`,
  },

  appleStoreIphone: {
    label: 'Apple Store - iPhone 15 Pro',
    rawText: `
Apple India Private Limited
Tax Invoice

Invoice Number: AAPL-IN-998877
Invoice Date: 22 January 2024
Purchase Date: January 22, 2024

Product: iPhone 15 Pro 256GB Natural Titanium
Serial Number: F2LXJ9KQPL
IMEI: 356938035643809

Amount Payable: INR 1,34,900.00

Apple Limited Warranty
This Apple product is warranted against defects in
materials and workmanship for a period of ONE YEAR
from the date of original retail purchase.

For service, visit an Apple Authorised Service Provider.
`,
  },

  localStoreSamsungTv: {
    label: 'Local Electronics Store - Samsung TV (low quality scan)',
    rawText: `
SHARMA ELECTRONICS
GST NO 09AAACS1234F1Z5

CASH/CREDlT MEMO

Bi11 No: SE-2256
Date : 12/o6/2022

Customer: Rajesh Kumar

Item Description          Qty   Rate      Amount
Samsung 55" Crystal 4K UHD  1   45000.00  45000.00
TV UA55AU7700
Model: UA55AU7700KXXL
Sr No: 0A55X3CK900456

Extended Warranty Available
Standard Warranty: 1 Year on Panel and Parts

Total: Rs 45,000/-

Goods once sold will not be taken back.
`,
  },

  noisyUnreadableReceipt: {
    label: 'Heavily degraded thermal receipt (mostly unreadable)',
    rawText: `
*** RETA1L ST0RE ***
T h a n k  Y o u
.....................
lt3m  Qty  Pr1c3
???    1   ####
Tot4l: ----
N0 warranty 1nf0 v1s1b1e
`,
  },

  boseHeadphonesAmbiguousDate: {
    label: 'Bose Headphones - ambiguous numeric date (US-style)',
    rawText: `
Bose Store Receipt
Invoice #: BOSE-77123

Item: Bose QuietComfort Ultra Headphones
Brand: Bose

Purchase Date: 03/10/2024

Price: $429.00

Warranty Period: 24 months limited warranty.
`,
  },
};

/**
 * Returns a fixture by key, throwing a clear error for typos rather
 * than silently returning undefined (which would produce confusing
 * downstream failures in tests).
 */
export function getSampleInvoice(key) {
  const sample = SAMPLE_INVOICES[key];
  if (!sample) {
    throw new Error(
      `Unknown sample invoice key "${key}". Available keys: ${Object.keys(SAMPLE_INVOICES).join(', ')}`
    );
  }
  return sample;
}

export default { SAMPLE_INVOICES, getSampleInvoice };
