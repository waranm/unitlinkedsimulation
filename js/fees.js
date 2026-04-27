/**
 * fees.js — Monthly AUM-based fee deductions for Unit Linked simulation
 *
 * Phase 2b: admin fee only.
 * Phase 2c will add COI inside this same function (pro-rata sums together);
 * premium charge is a separate concern handled before buy-at-offer.
 *
 * Loaded BEFORE simulation.js so the global `applyFees` is visible to
 * runScenario.  Test runner mirrors this load order via vm.runInContext.
 */

'use strict';

/**
 * Deduct monthly AUM-based fees from the portfolio (in-place mutation).
 *
 * Pro-rata across every fund: each fund loses the same fraction of its
 * units so the allocation ratio is preserved.
 *
 * @param {Object} portfolio  { fundName: units } — mutated in place
 * @param {Object} bidPrices  { fundName: bidPrice }  (= nav × bidRatio)
 * @param {Object} feeParams  { adminFeeRate, ...future fields like coiRate }
 * @param {number} month      0-based month index (reserved for COI age lookup)
 * @returns {{ adminFee: number, lapsed: boolean }}
 *   adminFee — total admin fee deducted in THB this month
 *   lapsed   — true if pre-fee AUM ≤ 0 OR post-fee AUM ≤ 0
 */
// eslint-disable-next-line no-unused-vars
function applyFees(portfolio, bidPrices, feeParams, month) {
  const funds = Object.keys(portfolio);

  // 1. AUM snapshot at bid (after premium top-up, before fee/market shock)
  let aum = 0;
  for (const f of funds) aum += portfolio[f] * (bidPrices[f] || 0);
  if (aum <= 0) return { adminFee: 0, lapsed: true };

  // 2. Compute total fee (admin only in Phase 2b; Phase 2c adds COI)
  const adminFeeRate = feeParams?.adminFeeRate || 0;
  const adminFee = aum * adminFeeRate;
  const totalFee = adminFee;

  if (totalFee <= 0) return { adminFee: 0, lapsed: false };
  if (totalFee >= aum) {
    // Fee wipes out the whole policy — mark lapsed, leave portfolio empty
    for (const f of funds) portfolio[f] = 0;
    return { adminFee: aum, lapsed: true };
  }

  // 3. Pro-rata deduct from each fund (preserves allocation ratio)
  const ratio = totalFee / aum;
  for (const f of funds) portfolio[f] *= (1 - ratio);

  // 4. Recompute post-fee AUM for lapse decision
  let postAum = 0;
  for (const f of funds) postAum += portfolio[f] * (bidPrices[f] || 0);

  return { adminFee, lapsed: postAum <= 0 };
}
