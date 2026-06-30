import { parseInvoice } from '../parsers/invoiceParser.js';
import { SAMPLE_INVOICES } from './fixtures/simulatedOcrSource.js';

for (const [key, sample] of Object.entries(SAMPLE_INVOICES)) {
  console.log('\n=================================================');
  console.log('SAMPLE:', sample.label);
  console.log('=================================================');
  const result = parseInvoice(sample.rawText);
  console.log(JSON.stringify(result, null, 2));
}
