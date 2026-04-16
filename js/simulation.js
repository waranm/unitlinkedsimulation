/**
 * simulation.js — Monte Carlo engine for Unit Linked simulation
 *
 * Designed for extensibility: fee structures (admin fees, premium charges,
 * COI deductions) can be added by implementing the applyFees() hook called
 * each month inside runScenario().
 *
 * Offer/BID pricing:
 *   - Buying units (premium contribution): use Offer price
 *   - Portfolio valuation & rebalancing: use BID price
 *   - Historical return stats are derived from NAV series
 *   - Offer/BID ratios (vs NAV) are averaged from history and applied to
 *     simulated NAV prices each month
 */

'use strict';

// ─── Stats helpers ───────────────────────────────────────────────────────────

/**
 * Calculate per-fund stats from historical data.
 * @param {Object} navData  { fundName: [{ date, nav, offer, bid }, ...] }
 *                          offer/bid are optional; fallback = nav
 * @returns {Object}  { fundName: { mean, std, offerRatio, bidRatio } }
 *   mean/std   = monthly log-return stats (from NAV series)
 *   offerRatio = historical avg(offer/nav)  — used when buying
 *   bidRatio   = historical avg(bid/nav)    — used when selling/valuing
 */
function calcFundStats(navData) {
  const stats = {};
  for (const [fund, rows] of Object.entries(navData)) {
    if (rows.length < 2) {
      stats[fund] = { mean: 0, std: 0.01, offerRatio: 1, bidRatio: 1 };
      continue;
    }

    // Log-returns from NAV
    const returns = [];
    let sumOfferRatio = 0, sumBidRatio = 0, ratioCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = Math.log(rows[i].nav / rows[i - 1].nav);
      if (isFinite(r)) returns.push(r);
    }

    for (const row of rows) {
      if (row.nav > 0) {
        sumOfferRatio += (row.offer ?? row.nav) / row.nav;
        sumBidRatio   += (row.bid   ?? row.nav) / row.nav;
        ratioCount++;
      }
    }

    const n = returns.length;
    const mean = n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0;
    const variance = n > 0
      ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / n
      : 0;

    stats[fund] = {
      mean,
      std:        Math.sqrt(variance) || 0.01,
      offerRatio: ratioCount > 0 ? sumOfferRatio / ratioCount : 1,
      bidRatio:   ratioCount > 0 ? sumBidRatio   / ratioCount : 1,
    };
  }
  return stats;
}

/** Box-Muller transform → standard normal sample */
function randNormal() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Fee hook (v1 = no-op; replace in future version) ────────────────────────

/**
 * Apply monthly fee deductions to the portfolio.
 * @param {Object} portfolio  { fundName: units }
 * @param {Object} bidPrices  { fundName: currentBID }
 * @param {Object} feeParams  fee configuration (unused in v1)
 * @param {number} month      0-based month index
 * @returns {Object}          modified portfolio (same reference)
 *
 * TODO v2: subtract admin fee, COI, premium charge here.
 */
// eslint-disable-next-line no-unused-vars
function applyFees(portfolio, bidPrices, feeParams, month) {
  // v1: no-op
  return portfolio;
}

// ─── Rebalance helper ─────────────────────────────────────────────────────────
// Rebalancing sells at BID and buys at Offer.
// Net effect: total value stays the same; units are redistributed.
// We approximate by computing total at BID and re-buying at Offer.

function rebalance(portfolio, navPrices, fundStats, allocation) {
  // Value at BID prices
  let total = 0;
  for (const [fund, units] of Object.entries(portfolio)) {
    const bid = navPrices[fund] * (fundStats[fund]?.bidRatio ?? 1);
    total += units * bid;
  }
  // Re-allocate: buy at Offer prices
  for (const [fund, pct] of Object.entries(allocation)) {
    const offer = navPrices[fund] * (fundStats[fund]?.offerRatio ?? 1);
    portfolio[fund] = (total * pct) / offer;
  }
}

// ─── Single scenario ──────────────────────────────────────────────────────────

/**
 * Run one Monte Carlo scenario.
 * @param {Object} params
 *   - fundStats      { fundName: { mean, std, offerRatio, bidRatio } }
 *   - allocation     { fundName: fraction }   (fractions sum to 1)
 *   - months         number of months to simulate
 *   - premium        premium per payment period (THB)
 *   - premiumMonths  Set of 0-based month indices when premium is paid
 *   - rebalanceMode  'none' | 'monthly' | 'quarterly' | 'annual'
 *   - initialNav     { fundName: startingNAV }
 *   - feeParams      fee config (passed through to applyFees)
 * @returns {number[]}  portfolio value (at BID) at end of each month
 */
function runScenario(params) {
  const {
    fundStats, allocation, months,
    premiumMonths, premium,
    rebalanceMode, initialNav, feeParams = {}
  } = params;

  const funds = Object.keys(fundStats);

  const portfolio = {};
  const nav = {};
  for (const f of funds) {
    portfolio[f] = 0;
    nav[f] = initialNav[f];
  }

  const values = new Array(months);

  for (let m = 0; m < months; m++) {
    // 1. Simulate NAV movement for this month
    for (const f of funds) {
      const { mean, std } = fundStats[f];
      nav[f] = nav[f] * Math.exp(mean + std * randNormal());
    }

    // 2. Add premium contribution — buy units at Offer price
    if (premiumMonths.has(m)) {
      for (const f of funds) {
        const offerPrice = nav[f] * (fundStats[f]?.offerRatio ?? 1);
        portfolio[f] += (premium * (allocation[f] || 0)) / offerPrice;
      }
    }

    // 3. Apply fees (v1 no-op; hook for future extension)
    applyFees(portfolio, nav, feeParams, m);

    // 4. Rebalance if scheduled
    const shouldRebalance =
      rebalanceMode === 'monthly' ||
      (rebalanceMode === 'quarterly' && (m + 1) % 3 === 0) ||
      (rebalanceMode === 'annual'    && (m + 1) % 12 === 0);
    if (shouldRebalance) {
      rebalance(portfolio, nav, fundStats, allocation);
    }

    // 5. Record total portfolio value at BID prices
    let total = 0;
    for (const f of funds) {
      const bidPrice = nav[f] * (fundStats[f]?.bidRatio ?? 1);
      total += portfolio[f] * bidPrice;
    }
    values[m] = total;
  }

  return values;
}

// ─── Premium month set builder ────────────────────────────────────────────────

/**
 * Build the set of 0-based month indices when a premium payment falls.
 * @param {'monthly'|'quarterly'|'semi-annual'|'annual'} mode
 * @param {number} totalMonths
 */
function buildPremiumMonths(mode, totalMonths) {
  const set = new Set();
  const intervals = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 };
  const step = intervals[mode] || 1;
  for (let m = 0; m < totalMonths; m += step) set.add(m);
  return set;
}

// ─── Main simulation runner ───────────────────────────────────────────────────

/**
 * Run N Monte Carlo scenarios asynchronously (yields to UI between batches).
 *
 * @param {Object} config
 *   - navData        { fundName: [{ date, nav, offer, bid }] }
 *   - allocation     { fundName: pct }   (values 0-100, must sum 100)
 *   - premium        THB per payment
 *   - paymentMode    'monthly' | 'quarterly' | 'semi-annual' | 'annual'
 *   - months         total simulation months
 *   - rebalanceMode  'none' | 'monthly' | 'quarterly' | 'annual'
 *   - N              number of scenarios
 *   - feeParams      {} (reserved)
 * @param {Function} onProgress  (pct: 0-100) => void
 * @returns {Promise<{ percentiles, months }>}
 */
async function runMonteCarlo(config, onProgress) {
  const {
    navData, allocation, premium, paymentMode,
    months, rebalanceMode, N, feeParams = {}
  } = config;

  const fundStats = calcFundStats(navData);
  const funds = Object.keys(navData);

  // Normalise allocation to fractions
  const allocFrac = {};
  const totalPct = funds.reduce((s, f) => s + (allocation[f] || 0), 0);
  for (const f of funds) allocFrac[f] = (allocation[f] || 0) / totalPct;

  // Use latest NAV as starting price
  const initialNav = {};
  for (const f of funds) {
    const rows = navData[f];
    initialNav[f] = rows[rows.length - 1].nav;
  }

  const premiumMonths = buildPremiumMonths(paymentMode, months);
  const allSeries = [];

  const BATCH = 100;
  for (let i = 0; i < N; i++) {
    const series = runScenario({
      fundStats, allocation: allocFrac, months,
      premium, premiumMonths,
      rebalanceMode, initialNav, feeParams
    });
    allSeries.push(series);

    if (i % BATCH === BATCH - 1) {
      onProgress && onProgress(Math.round((i + 1) / N * 100));
      await new Promise(r => setTimeout(r, 0));
    }
  }
  onProgress && onProgress(100);

  // Percentile bands month-by-month
  const pctBands = [25, 50, 75, 98];
  const percentiles = {};
  for (const p of pctBands) percentiles[p] = new Array(months);

  for (let m = 0; m < months; m++) {
    const col = allSeries.map(s => s[m]).sort((a, b) => a - b);
    for (const p of pctBands) {
      const idx = Math.floor((p / 100) * (col.length - 1));
      percentiles[p][m] = col[idx];
    }
  }

  return { percentiles, months };
}
