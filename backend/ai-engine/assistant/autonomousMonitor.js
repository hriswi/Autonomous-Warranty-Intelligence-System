/**
 * autonomousMonitor.js
 *
 * AUTONOMOUS SYSTEM MONITORING ENGINE
 *
 * Continuously (on each agent turn, and on-demand) scans the knowledge
 * graph for conditions that warrant proactive alerts, without the user
 * having to ask. The agent presents these unsolicited when the situation
 * is urgent enough.
 *
 * Monitored conditions:
 *   1. WARRANTY EXPIRY PROXIMITY  — products expiring in 1/7/14/30/90 days
 *   2. HIGH RISK PRODUCTS         — products with risk score >= 70
 *   3. SUSPICIOUS INVOICES        — fraud score >= 55
 *   4. REPEATED REPORTED ISSUES   — same issue type reported 2+ times
 *   5. ANOMALOUS REPAIR FREQUENCY — more repairs than expected for category age
 *   6. EXPIRED WITHOUT CLAIM      — warranty expired, no claim recorded
 *   7. EXTENDED WARRANTY WINDOW   — product in the ideal window to buy extension
 *
 * Each alert has:
 *   id, type, severity, title, detail, productId, actionRequired, expiresAt
 *
 * Severity levels: CRITICAL / HIGH / MEDIUM / LOW / INFO
 */

import { daysBetween, addMonths } from '../../utils/dateUtils.js';

const ALERT_TYPES = Object.freeze({
  WARRANTY_EXPIRY_CRITICAL:    'WARRANTY_EXPIRY_CRITICAL',
  WARRANTY_EXPIRY_HIGH:        'WARRANTY_EXPIRY_HIGH',
  WARRANTY_EXPIRY_MEDIUM:      'WARRANTY_EXPIRY_MEDIUM',
  WARRANTY_EXPIRED_NO_CLAIM:   'WARRANTY_EXPIRED_NO_CLAIM',
  HIGH_RISK_PRODUCT:           'HIGH_RISK_PRODUCT',
  SUSPICIOUS_INVOICE:          'SUSPICIOUS_INVOICE',
  REPEATED_ISSUE:              'REPEATED_ISSUE',
  ANOMALOUS_REPAIR_FREQUENCY:  'ANOMALOUS_REPAIR_FREQUENCY',
  EXTENDED_WARRANTY_WINDOW:    'EXTENDED_WARRANTY_WINDOW',
  LOW_CONFIDENCE_INVOICE:      'LOW_CONFIDENCE_INVOICE',
});

function makeAlertId(type, productId) {
  return `${type}__${productId}`;
}

/**
 * Scans the entire knowledge graph and returns all currently-active alerts.
 * This is idempotent — calling it multiple times with the same state
 * returns the same alerts.
 *
 * @param {WarrantyKnowledgeGraph} graph
 * @param {MemoryEngine} memory  For checking prior issue reports.
 * @param {Date} [referenceDate]
 * @returns {object[]} Array of alert objects.
 */
export function scanSystemState(graph, memory, referenceDate = new Date()) {
  const alerts = [];
  const products = graph.getAllProducts();

  for (const product of products) {
    const pid = product.id;
    const name = product.productName || 'Unknown Product';

    // ── WARRANTY EXPIRY ALERTS ────────────────────────────────────────────
    const timeline = product.warrantyTimeline;
    if (timeline) {
      const dr = timeline.daysRemaining;
      if (dr > 0) {
        if (dr <= 1) {
          alerts.push({
            id: makeAlertId(ALERT_TYPES.WARRANTY_EXPIRY_CRITICAL, pid),
            type: ALERT_TYPES.WARRANTY_EXPIRY_CRITICAL,
            severity: 'CRITICAL',
            productId: pid,
            productName: name,
            title: `⚠️ WARRANTY EXPIRES TODAY — ${name}`,
            detail: `The warranty for ${name} expires TODAY (${timeline.expiryDate}). If you have any unreported issues, visit an authorized service center immediately.`,
            actionRequired: true,
            daysRemaining: dr,
          });
        } else if (dr <= 7) {
          alerts.push({
            id: makeAlertId(ALERT_TYPES.WARRANTY_EXPIRY_CRITICAL, pid),
            type: ALERT_TYPES.WARRANTY_EXPIRY_CRITICAL,
            severity: 'CRITICAL',
            productId: pid,
            productName: name,
            title: `🔴 Warranty expires in ${dr} days — ${name}`,
            detail: `${name} warranty expires on ${timeline.expiryDate} (${dr} days). Book an authorized service inspection immediately to report any latent defects before the window closes.`,
            actionRequired: true,
            daysRemaining: dr,
          });
        } else if (dr <= 30) {
          alerts.push({
            id: makeAlertId(ALERT_TYPES.WARRANTY_EXPIRY_HIGH, pid),
            type: ALERT_TYPES.WARRANTY_EXPIRY_HIGH,
            severity: 'HIGH',
            productId: pid,
            productName: name,
            title: `🟠 Warranty expires in ${dr} days — ${name}`,
            detail: `${name} warranty expires on ${timeline.expiryDate}. Consider booking a preventive inspection this week.`,
            actionRequired: true,
            daysRemaining: dr,
          });
        } else if (dr <= 90) {
          alerts.push({
            id: makeAlertId(ALERT_TYPES.WARRANTY_EXPIRY_MEDIUM, pid),
            type: ALERT_TYPES.WARRANTY_EXPIRY_MEDIUM,
            severity: 'MEDIUM',
            productId: pid,
            productName: name,
            title: `🟡 Warranty expires in ${dr} days — ${name}`,
            detail: `${name} warranty expires on ${timeline.expiryDate}. Monitor the product and consider scheduling an inspection within the next month.`,
            actionRequired: false,
            daysRemaining: dr,
          });
        }
      } else if (dr < 0) {
        // Expired — check if the product has repair history (proxy for "was a claim made")
        const hasRepairHistory = (product.repairHistory || []).length > 0;
        if (!hasRepairHistory && Math.abs(dr) <= 180) {
          alerts.push({
            id: makeAlertId(ALERT_TYPES.WARRANTY_EXPIRED_NO_CLAIM, pid),
            type: ALERT_TYPES.WARRANTY_EXPIRED_NO_CLAIM,
            severity: 'INFO',
            productId: pid,
            productName: name,
            title: `ℹ️ Warranty expired ${Math.abs(dr)} days ago — ${name}`,
            detail: `The warranty for ${name} expired on ${timeline.expiryDate}. Any future repairs will be at your own cost. Check for extended component warranties that may still be active.`,
            actionRequired: false,
            daysExpired: Math.abs(dr),
          });
        }
      }
    }

    // ── EXTENDED WARRANTY WINDOW ──────────────────────────────────────────
    if (product.advisory?.extendedWarrantyRecommended) {
      alerts.push({
        id: makeAlertId(ALERT_TYPES.EXTENDED_WARRANTY_WINDOW, pid),
        type: ALERT_TYPES.EXTENDED_WARRANTY_WINDOW,
        severity: 'MEDIUM',
        productId: pid,
        productName: name,
        title: `💡 Good time to buy extended warranty — ${name}`,
        detail: product.advisory.extendedWarrantyReason || `Consider purchasing an extended warranty for ${name} before the standard warranty expires.`,
        actionRequired: false,
      });
    }

    // ── HIGH RISK PRODUCT ─────────────────────────────────────────────────
    if (product.risk?.riskScore >= 70) {
      alerts.push({
        id: makeAlertId(ALERT_TYPES.HIGH_RISK_PRODUCT, pid),
        type: ALERT_TYPES.HIGH_RISK_PRODUCT,
        severity: product.risk.riskScore >= 85 ? 'HIGH' : 'MEDIUM',
        productId: pid,
        productName: name,
        title: `${product.risk.riskScore >= 85 ? '🔴' : '🟠'} High failure risk — ${name} (${product.risk.riskScore}/100)`,
        detail: product.risk.recommendation,
        actionRequired: product.risk.riskScore >= 85,
        riskScore: product.risk.riskScore,
      });
    }

    // ── SUSPICIOUS INVOICE ────────────────────────────────────────────────
    if (product.fraud?.fraudScore >= 55 && product.fraud.warningLevel !== 'CLEAN') {
      alerts.push({
        id: makeAlertId(ALERT_TYPES.SUSPICIOUS_INVOICE, pid),
        type: ALERT_TYPES.SUSPICIOUS_INVOICE,
        severity: product.fraud.warningLevel === 'FRAUDULENT' ? 'CRITICAL' : 'HIGH',
        productId: pid,
        productName: name,
        title: `${product.fraud.warningLevel === 'FRAUDULENT' ? '❌' : '⚠️'} Invoice flagged — ${name} (Fraud score: ${product.fraud.fraudScore}/100)`,
        detail: product.fraud.summary,
        actionRequired: true,
        fraudScore: product.fraud.fraudScore,
        signals: product.fraud.signals,
      });
    }

    // ── LOW CONFIDENCE INVOICE ────────────────────────────────────────────
    if (product.overallConfidence < 0.45) {
      alerts.push({
        id: makeAlertId(ALERT_TYPES.LOW_CONFIDENCE_INVOICE, pid),
        type: ALERT_TYPES.LOW_CONFIDENCE_INVOICE,
        severity: 'MEDIUM',
        productId: pid,
        productName: name,
        title: `⚠️ Invoice data needs verification — ${name}`,
        detail: `The invoice for ${name} has low parsing confidence (${Math.round(product.overallConfidence * 100)}%). Fields that may be inaccurate: ${(product.lowConfidenceFields || []).join(', ') || 'multiple fields'}. Please verify the details manually.`,
        actionRequired: true,
        confidence: product.overallConfidence,
        lowConfidenceFields: product.lowConfidenceFields,
      });
    }

    // ── REPEATED ISSUE DETECTION ──────────────────────────────────────────
    if (memory) {
      const reported = memory.getReportedIssues(pid);
      const issueCounts = {};
      for (const r of reported) {
        issueCounts[r.issueType] = (issueCounts[r.issueType] || 0) + 1;
      }
      for (const [issueType, count] of Object.entries(issueCounts)) {
        if (count >= 2) {
          alerts.push({
            id: makeAlertId(ALERT_TYPES.REPEATED_ISSUE, `${pid}_${issueType}`),
            type: ALERT_TYPES.REPEATED_ISSUE,
            severity: 'HIGH',
            productId: pid,
            productName: name,
            title: `🔁 Recurring issue detected — ${issueType.replace(/_/g, ' ')} on ${name}`,
            detail: `You have reported "${issueType.replace(/_/g, ' ')}" ${count} times for ${name}. Recurring issues may indicate a manufacturing defect — this strengthens a warranty claim if the product is still within warranty.`,
            actionRequired: true,
            issueType,
            reportCount: count,
          });
        }
      }
    }
  }

  // Sort: CRITICAL first, then by severity, then by product name
  const severityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  alerts.sort((a, b) => {
    const sa = severityOrder[a.severity] ?? 5;
    const sb = severityOrder[b.severity] ?? 5;
    if (sa !== sb) return sa - sb;
    return (a.productName || '').localeCompare(b.productName || '');
  });

  return alerts;
}

/**
 * Formats the top N unshown alerts into a proactive message to prepend
 * to the agent's response (or deliver as a standalone notification).
 */
export function formatActiveAlerts(alerts, maxToShow = 3) {
  const urgent = alerts.filter((a) => ['CRITICAL', 'HIGH'].includes(a.severity)).slice(0, maxToShow);
  if (urgent.length === 0) return null;

  const lines = urgent.map((a) => `${a.title}\n  ${a.detail}`);
  return `**⚡ System Alerts (${urgent.length} urgent)**\n\n${lines.join('\n\n')}`;
}

export default { scanSystemState, formatActiveAlerts, ALERT_TYPES };
