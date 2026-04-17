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
 * Resample a daily (or sub-monthly) row array to monthly end-of-month values.
 * Groups rows by YYYY-MM and keeps the last row of each month.
 * If data is already monthly (≤ 1 row per month on average), returns as-is.
 * @param {Array} rows  [{ date: Date, nav, offer, bid }]
 * @returns {Array}     monthly rows
 */
function resampleMonthly(rows) {
  if (rows.length < 2) return rows;

  // Detect if data is sub-monthly: average gap < 20 days → resample needed
  const spanDays = (rows[rows.length - 1].date - rows[0].date) / 86400000;
  const avgGapDays = spanDays / (rows.length - 1);
  if (avgGapDays >= 20) return rows; // already monthly or sparser

  // Group by YYYY-MM, keep last row of each month
  const byMonth = new Map();
  for (const row of rows) {
    const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, row); // later rows overwrite earlier → end-of-month wins
  }
  return Array.from(byMonth.values());
}

/**
 * Calculate per-fund stats from historical data.
 * Input rows may be daily or monthly; stats are always returned as monthly.
 * @param {Object} navData  { fundName: [{ date, nav, offer, bid }, ...] }
 *                          offer/bid are optional; fallback = nav
 * @returns {Object}  { fundName: { mean, std, offerRatio, bidRatio } }
 *   mean/std   = monthly log-return stats
 *   offerRatio = historical avg(offer/nav)  — used when buying
 *   bidRatio   = historical avg(bid/nav)    — used when selling/valuing
 */
function calcFundStats(navData) {
  const stats = {};
  for (const [fund, rawRows] of Object.entries(navData)) {
    if (rawRows.length < 2) {
      stats[fund] = { mean: 0, std: 0.01, offerRatio: 1, bidRatio: 1 };
      continue;
    }

    // Resample to monthly so that each simulation step (1 month) uses
    // correctly-scaled return stats. Without this, daily data produces
    // ~21× understated mean returns.
    const rows = resampleMonthly(rawRows);

    // Monthly log-returns from NAV
    const returns = [];
    for (let i = 1; i < rows.length; i++) {
      const r = Math.log(rows[i].nav / rows[i - 1].nav);
      if (isFinite(r)) returns.push(r);
    }

    // Offer/BID ratios — use all original rows for a better average
    let sumOfferRatio = 0, sumBidRatio = 0, ratioCount = 0;
    for (const row of rawRows) {
      if (row.nav > 0) {
        sumOfferRatio += (row.offer ?? row.nav) / row.nav;
        sumBidRatio   += (row.bid   ?? row.nav) / row.nav;
        ratioCount++;
      }
    }

    const n = returns.length;
    const mean = n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0;
    const variance = n > 1
      ? returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)
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

// ─── Aligned monthly returns ──────────────────────────────────────────────────

/**
 * For every fund in navData, build a YYYY-MM → NAV map (end-of-month value),
 * then keep only the months present in ALL funds.
 * Returns the log-return matrix needed for the covariance calculation.
 *
 * @param {Object} navData  { fundName: [{ date: Date, nav }] }
 * @returns {{
 *   fundOrder: string[],   fund names — row order of the return matrix
 *   returns:  number[][],  [fundIdx][periodIdx] aligned monthly log-returns
 * }}
 */
function getAlignedMonthlyReturns(navData) {
  const fundOrder = Object.keys(navData);

  // Build YYYY-MM → NAV map per fund (last row of each month wins)
  const monthMaps = fundOrder.map(f => {
    const m = new Map();
    for (const row of navData[f]) {
      const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
      m.set(key, row.nav);
    }
    return m;
  });

  // Intersection of months present across all funds
  let common = new Set(monthMaps[0].keys());
  for (let i = 1; i < monthMaps.length; i++) {
    for (const k of common) { if (!monthMaps[i].has(k)) common.delete(k); }
  }
  const sorted = Array.from(common).sort();

  // Log-return matrix: only include a period if both end-months are in the intersection
  const returns = fundOrder.map((_, fi) => {
    const out = [];
    for (let t = 1; t < sorted.length; t++) {
      const prev = monthMaps[fi].get(sorted[t - 1]);
      const curr = monthMaps[fi].get(sorted[t]);
      const r = Math.log(curr / prev);
      out.push(isFinite(r) ? r : 0);
    }
    return out;
  });

  return { fundOrder, returns };
}

// ─── Covariance matrix ────────────────────────────────────────────────────────

/**
 * Sample covariance matrix (divides by T−1) from aligned return series.
 * @param {number[][]} returns  [fundIdx][periodIdx]
 * @returns {number[][]}        n×n symmetric covariance matrix
 */
function computeCovMatrix(returns) {
  const n = returns.length;
  const T = returns[0].length;
  const means = returns.map(r => r.reduce((a, b) => a + b, 0) / T);

  const cov = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
      }
      cov[i][j] = cov[j][i] = sum / (T - 1);
    }
  }
  return cov;
}

// ─── Cholesky decomposition ───────────────────────────────────────────────────

/**
 * Cholesky decomposition: finds lower-triangular L such that L × Lᵀ = A.
 * A tiny ridge (1e-10) is added to each diagonal element before the sqrt
 * to guard against floating-point near-singularity.
 *
 * @param {number[][]} A  n×n symmetric positive-definite matrix
 * @returns {number[][]}  lower-triangular L  (upper triangle is zero)
 */
function cholesky(A) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  const RIDGE = 1e-10;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];

      if (i === j) {
        const d = A[i][i] - sum + RIDGE;
        L[i][j] = d > 0 ? Math.sqrt(d) : RIDGE;
      } else {
        L[i][j] = L[j][j] > RIDGE ? (A[i][j] - sum) / L[j][j] : 0;
      }
    }
  }
  return L;
}

// ─── Combined simulation parameters ──────────────────────────────────────────

/**
 * Compute all parameters needed by runScenario in one pass:
 *   - per-fund stats (mean, std, offerRatio, bidRatio)
 *   - Cholesky factor of the inter-fund covariance matrix
 *
 * The Cholesky factor L satisfies  L × Lᵀ = Σ  where Σ[i][i] = std_i²
 * and Σ[i][j] = historical sample covariance of monthly log-returns.
 * Multiplying L by a vector of independent N(0,1) shocks yields a vector
 * of correlated N(0, std²) shocks — one per fund — ready to use directly
 * in the log-normal NAV update without a separate std scaling.
 *
 * Single-fund case: L = [[std]] — identical to the old independent path.
 *
 * @param {Object} navData  { fundName: [{ date: Date, nav, offer, bid }] }
 * @returns {{ fundStats, fundOrder, choleskyL }}
 */
function calcSimParams(navData) {
  const fundStats = calcFundStats(navData);
  const funds = Object.keys(navData);

  // Single fund — degenerate 1×1 Cholesky
  if (funds.length === 1) {
    return { fundStats, fundOrder: funds, choleskyL: [[fundStats[funds[0]].std]] };
  }

  const { fundOrder, returns } = getAlignedMonthlyReturns(navData);
  const T = returns[0].length;

  // Need at least 2 aligned periods to estimate covariance
  if (T < 2) {
    const L = funds.map((f, i) => funds.map((_, j) => i === j ? fundStats[f].std : 0));
    return { fundStats, fundOrder: funds, choleskyL: L };
  }

  const covMatrix = computeCovMatrix(returns);
  const L = cholesky(covMatrix);
  return { fundStats, fundOrder, choleskyL: L };
}

/** Box-Muller transform → standard normal sample */
function randNormal() {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── IRR calculator ───────────────────────────────────────────────────────────

/**
 * Calculate annualised IRR (%) for a regular-premium DCA strategy.
 *
 * Finds the monthly compounding rate r such that the future value of all
 * premium payments — each compounded from its payment date to the end of
 * the simulation — equals the observed final portfolio value.
 *
 * This correctly accounts for the timing of DCA cash flows, unlike a
 * simple CAGR formula that treats all premiums as invested at t=0.
 *
 * @param {number} premium    premium amount per payment
 * @param {number} step       months between payments (1=monthly, 3=quarterly …)
 * @param {number} months     total simulation months
 * @param {number} finalValue portfolio value at end of simulation
 * @returns {number|null}     annualised IRR in percent, or null if indeterminate
 */
function calcIRR(premium, step, months, finalValue) {
  if (finalValue <= 0 || premium <= 0 || months <= 0) return null;

  // FV of all premiums valued at month `months`, at monthly rate r
  function fv(r) {
    let sum = 0;
    for (let m = 0; m < months; m += step) {
      sum += premium * Math.pow(1 + r, months - m);
    }
    return sum;
  }

  // fv() is monotonically increasing in r — binary search is valid
  const lo0 = -0.9, hi0 = 0.3; // covers ~-100% to ~3000% annualised
  if (finalValue <= fv(lo0)) return (Math.pow(1 + lo0, 12) - 1) * 100;
  if (finalValue >= fv(hi0)) return (Math.pow(1 + hi0, 12) - 1) * 100;

  let lo = lo0, hi = hi0;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (fv(mid) < finalValue) lo = mid; else hi = mid;
  }
  return (Math.pow(1 + (lo + hi) / 2, 12) - 1) * 100;
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
 *   - fundOrder      string[]  — fund names in the same row order as choleskyL
 *   - choleskyL      number[][] — lower-triangular Cholesky of the cov matrix
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
    fundStats, fundOrder, choleskyL,
    allocation, months,
    premiumMonths, premium,
    rebalanceMode, initialNav, feeParams = {}
  } = params;

  const funds = fundOrder;
  const nFunds = funds.length;

  const portfolio = {};
  const nav = {};
  for (const f of funds) {
    portfolio[f] = 0;
    nav[f] = initialNav[f];
  }

  const values = new Array(months);

  for (let m = 0; m < months; m++) {
    // 1. Simulate NAV movement — correlated shocks via Cholesky decomposition.
    //
    //    Draw z ~ N(0, I),  then compute  w = L · z  where L is the lower-
    //    triangular Cholesky factor of the covariance matrix Σ.
    //    By construction:  Cov(w) = L · Lᵀ = Σ,  so w[i] ~ N(0, std_i²)
    //    with the historical inter-fund correlations embedded.
    //    The NAV update then uses  mean_i + w[i]  (no separate std scaling).
    const z = Array.from({ length: nFunds }, randNormal);
    for (let i = 0; i < nFunds; i++) {
      let shock = 0;
      for (let k = 0; k <= i; k++) shock += choleskyL[i][k] * z[k];
      nav[funds[i]] = nav[funds[i]] * Math.exp(fundStats[funds[i]].mean + shock);
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

  const { fundStats, fundOrder, choleskyL } = calcSimParams(navData);
  const funds = fundOrder;

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
      fundStats, fundOrder, choleskyL,
      allocation: allocFrac, months,
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

  // Mean series — average portfolio value at each month across all N scenarios.
  // Computed in one streaming pass so we never need to revisit allSeries.
  const meanSeries = new Array(months).fill(0);
  for (const s of allSeries) {
    for (let m = 0; m < months; m++) meanSeries[m] += s[m];
  }
  for (let m = 0; m < months; m++) meanSeries[m] /= N;

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

  return { percentiles, months, meanSeries };
}
