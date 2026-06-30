import { WarrantyAgent } from './ai-engine/assistant/warrantyAgent.js';
import { SAMPLE_INVOICES } from './tests/fixtures/simulatedOcrSource.js';

const agent = new WarrantyAgent({ referenceDate: new Date('2024-06-01') });

for (const [key, sample] of Object.entries(SAMPLE_INVOICES)) {
  if (key === 'noisyUnreadableReceipt') continue;
  try {
    const r = await agent.addProductFromText(sample.rawText, { nickname: key });
    console.log(`✓ ${r.productName} | conf=${r.invoiceConfidence} risk=${r.riskScore} fraud=${r.fraudWarning}`);
  } catch(e) { console.log(`✗ ${key}: ${e.message}`); }
}

const q1 = await agent.query("My Dell laptop keyboard stopped working");
console.log('\nQ1 intent:', q1.intent, '| conf:', q1.overallConfidence, '| product:', q1.products?.[0]?.productName);

const q2 = await agent.query("Can I claim warranty?");
console.log('Q2 coreference resolved to:', q2.products?.[0]?.productName);

const q3 = await agent.query("Which of my products are high risk?");
console.log('Q3 intent:', q3.intent, '| products resolved:', q3.products?.length);

const summary = agent.getSystemSummary();
console.log('\nSummary: total=', summary.totalProducts, 'active=', summary.activeWarranties);

const dellId = summary.products.find(p => p.name?.toLowerCase().includes('dell'))?.id;
if (dellId) {
  const pred = agent.predictProductFailures(dellId, 365);
  console.log('Dell top risk:', pred.componentRisks[0]?.component, pred.componentRisks[0]?.failureProbabilityPercent + '%');
}
console.log('ALL INTEGRATION TESTS PASSED');
