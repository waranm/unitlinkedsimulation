/**
 * export.js — CSV and PNG export utilities
 */

'use strict';

/**
 * Export simulation results summary as CSV.
 * @param {Object} percentiles   { 25: [], 50: [], 75: [], 98: [] }
 * @param {number} months
 * @param {Object} params        simulation config for header metadata
 * @param {number[]} selected    which percentiles to include
 */
function exportCSV(percentiles, months, params, selected) {
  const lines = [];

  // Metadata header
  lines.push('Unit Linked Simulation Results');
  lines.push(`Generated,${new Date().toLocaleString('th-TH')}`);
  lines.push(`Premium,${params.premium} THB`);
  lines.push(`Payment Mode,${params.paymentMode}`);
  lines.push(`Simulation Period,${months} months`);
  lines.push(`Rebalancing,${params.rebalanceMode}`);
  lines.push(`Monte Carlo Runs,${params.N}`);
  lines.push('');

  // Column headers
  const pctCols = [98, 75, 50, 25].filter(p => selected.includes(p));
  const header = ['Month', ...pctCols.map(p => `P${p}`)];
  lines.push(header.join(','));

  // Data rows
  for (let m = 0; m < months; m++) {
    const row = [m + 1, ...pctCols.map(p => (percentiles[p][m] || 0).toFixed(2))];
    lines.push(row.join(','));
  }

  downloadText(lines.join('\n'), 'simulation-results.csv', 'text/csv;charset=utf-8;');
}

/**
 * Export final-month summary as CSV (one row per percentile).
 */
function exportSummaryCSV(percentiles, months, params, selected) {
  const lines = [];
  lines.push('Percentile,Final Portfolio Value (THB),Total Premium Paid (THB),Return (THB),Return (%)');

  const totalPremium = calcTotalPremiumPaid(params);

  for (const p of [98, 75, 50, 25]) {
    if (!selected.includes(p)) continue;
    const final = percentiles[p][months - 1] || 0;
    const ret = final - totalPremium;
    const retPct = totalPremium > 0 ? (ret / totalPremium * 100).toFixed(2) : '0.00';
    lines.push([`P${p}`, final.toFixed(2), totalPremium.toFixed(2), ret.toFixed(2), retPct + '%'].join(','));
  }

  downloadText(lines.join('\n'), 'simulation-summary.csv', 'text/csv;charset=utf-8;');
}

function calcTotalPremiumPaid(params) {
  const { premium, paymentMode, months, pptMonths = null } = params;
  const intervals = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 };
  const step = intervals[paymentMode] || 1;
  const limit = (pptMonths != null) ? Math.min(months, pptMonths) : months;
  let count = 0;
  for (let m = 0; m < limit; m += step) count++;
  return premium * count;
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob(['\uFEFF' + text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
