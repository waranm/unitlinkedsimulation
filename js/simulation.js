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

// Requires cov-builder.js to be loaded before this file.

// ─── Stats helpers ───────────────────────────────────────────────────────────

/**
 * Forward-fill (LOCF) calendar-day gaps in a daily NAV series.
 * Handles fund holidays and non-overlapping trading calendars: any date
 * with no recorded price receives the last known price before it.
 * Only runs on daily data (avgGap < 20 days); monthly series are returned
 * unchanged to avoid inflating row counts.
 * @param {Array} rows  sorted [{ date: Date, nav, offer, bid }]
 * @returns {Array}     same rows with date-gaps filled
 */
function forwardFillDaily(rows) {
  if (rows.length < 2) return rows;

  const spanDays = (rows[rows.length - 1].date - rows[0].date) / 86400000;
  const avgGap = spanDays / (rows.length - 1);
  if (avgGap >= 20) return rows; // monthly data — skip

  const result = [];
  for (let i = 0; i < rows.length - 1; i++) {
    result.push(rows[i]);
    const gapDays = Math.round((rows[i + 1].date - rows[i].date) / 86400000);
    for (let d = 1; d < gapDays; d++) {
      const fillDate = new Date(rows[i].date.getTime() + d * 86400000);
      result.push({ ...rows[i], date: fillDate });
    }
  }
  result.push(rows[rows.length - 1]);
  return result;
}

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

// ─── Long-run μ calibration (Bayesian shrinkage) ─────────────────────────────
//
// Problem: a short historical window (e.g. 3-year gold bull run → 22.9%/y)
// fed directly into GBM over 69 years produces astronomical P50 values.
// GBM has no mean-reversion; it blindly extrapolates the sample mean forever.
//
// Solution: shrink historical μ̂ toward a long-run prior using Bayesian
// James–Stein-style shrinkage.  σ and correlations are NOT touched —
// they carry genuine signal about volatility and co-movement.

/**
 * Long-run annualized expected returns (real-world prior μ∞).
 * Override at runtime via window.LONG_RUN_MU_OVERRIDE = { equity: 0.08, ... }
 */
const LONG_RUN_MU_DEFAULTS = {
  equity:       0.07,  // 7%/year  — long-run global equity
  bond:         0.03,  // 3%/year  — investment grade
  gold:         0.04,  // 4%/year  — long-run gold (nominal)
  mixed:        0.05,  // 5%/year  — balanced / multi-asset
  reit:         0.06,  // 6%/year  — real estate
  commodity:    0.03,  // 3%/year
  money_market: 0.02,  // 2%/year
};

/**
 * Return long-run monthly log-return prior for an asset class.
 * Applies window.LONG_RUN_MU_OVERRIDE if set (useful for what-if analysis).
 * @param {string} assetClass
 * @returns {number}  monthly log-return prior
 */
function getLongRunMu(assetClass) {
  const overrides = (typeof window !== 'undefined' && window.LONG_RUN_MU_OVERRIDE) || {};
  const merged = { ...LONG_RUN_MU_DEFAULTS, ...overrides };
  const annualRate = merged[assetClass] ?? merged.mixed;
  return Math.log(1 + annualRate) / 12;
}

/**
 * Look up asset class for a fund — delegates to FundLib if available,
 * falls back to 'mixed' in test environments where fundLibrary.js isn't loaded.
 * @param {string} fund
 * @returns {string}
 */
function getAssetClassForFund(fund) {
  if (typeof window !== 'undefined' && window.FundLib?.getAssetClassForFund) {
    return window.FundLib.getAssetClassForFund(fund);
  }
  return 'mixed'; // safe fallback for Node.js test environment
}

/**
 * Bayesian shrinkage of the monthly log-return mean toward a long-run prior.
 *
 * Shrinkage weight α = n / (n + PRIOR_STRENGTH):
 *   n=36  (3y data)  → α≈0.55  — prior dominates; historical data unreliable
 *   n=120 (10y data) → α≈0.80  — mostly historical
 *   n=240 (20y data) → α≈0.89  — data confident; prior barely matters
 *
 * @param {number} historicalMonthlyMu   raw mean of monthly log-returns
 * @param {number} nObs                  number of monthly return observations
 * @param {string} assetClass            one of LONG_RUN_MU_DEFAULTS keys
 * @returns {{ mu: number, alpha: number, priorMonthly: number }}
 *   mu           — shrunk monthly mean (use in GBM)
 *   alpha        — data weight (0=pure prior, 1=pure historical)
 *   priorMonthly — prior monthly log-return (for diagnostics)
 */
function shrinkMean(historicalMonthlyMu, nObs, assetClass) {
  const PRIOR_STRENGTH = 120; // months of "virtual prior observations"
  const priorMonthly = getLongRunMu(assetClass);
  const alpha = nObs / (nObs + PRIOR_STRENGTH);
  const mu = (1 - alpha) * priorMonthly + alpha * historicalMonthlyMu;
  return { mu, alpha, priorMonthly };
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

    // Forward-fill holiday gaps first, then resample to monthly.
    // Without forwardFillDaily, a fund closed on the last trading day(s) of
    // a month could lose that month's end-of-month row after resampling.
    const rows = resampleMonthly(forwardFillDaily(rawRows));

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
    const rawMean = n > 0 ? returns.reduce((a, b) => a + b, 0) / n : 0;
    const variance = n > 1
      ? returns.reduce((a, b) => a + (b - rawMean) ** 2, 0) / (n - 1)
      : 0;

    // ── Bayesian shrinkage on μ (long-run anchoring) ─────────────────────
    // Short historical windows (e.g. 3y gold bull run → 22.9%/y) would be
    // extrapolated directly by GBM over multi-decade horizons.  Shrink
    // toward a real-world long-run prior instead.  σ is left unchanged.
    const assetClass = getAssetClassForFund(fund);
    const { mu: mean, alpha: shrinkAlpha, priorMonthly: priorMonthlyMu } =
      shrinkMean(rawMean, n, assetClass);

    stats[fund] = {
      mean,           // shrunk μ — used by GBM
      rawMean,        // historical sample mean — kept for diagnostics
      shrinkAlpha,    // data weight α ∈ (0,1)
      priorMonthlyMu, // prior monthly log-return
      assetClass,
      nObs: n,
      std:        Math.sqrt(variance) || 0.01,
      offerRatio: ratioCount > 0 ? sumOfferRatio / ratioCount : 1,
      bidRatio:   ratioCount > 0 ? sumBidRatio   / ratioCount : 1,
    };
  }
  return stats;
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

// ─── Regime switching helpers ─────────────────────────────────────────────────

/**
 * Compute the stationary distribution of a Markov transition matrix
 * via power iteration (1000 steps — converges for any ergodic chain).
 * The stationary distribution π satisfies π = π · P.
 * Used to initialise the regime state at the start of each scenario.
 * @param {number[][]} P  n×n row-stochastic transition matrix
 * @returns {number[]}    stationary probability vector of length n
 */
function computeStationaryDist(P) {
  const n = P.length;
  let v = new Array(n).fill(1 / n);
  for (let iter = 0; iter < 1000; iter++) {
    const next = new Array(n).fill(0);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        next[j] += v[i] * P[i][j];
    v = next;
  }
  return v;
}

/**
 * Sample an index from a probability array using the provided PRNG.
 * @param {number[]}         probs  probabilities (must sum to 1)
 * @param {function():number} rng
 * @returns {number}  sampled index
 */
function sampleFromCDF(probs, rng) {
  const r = rng();
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i];
    if (r < cum) return i;
  }
  return probs.length - 1; // guard for floating-point rounding
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
  const fundOrder = Object.keys(navData);

  if (fundOrder.length === 1) {
    return { fundStats, fundOrder, choleskyL: [[fundStats[fundOrder[0]].std]], covDiagnostics: null };
  }

  const { cov, diagnostics } = buildConsistentCov(navData, fundOrder, fundStats);
  const choleskyL = cholesky(cov);
  return { fundStats, fundOrder, choleskyL, covDiagnostics: diagnostics };
}

/**
 * Mulberry32 — fast 32-bit seeded PRNG.
 * Returns a function that produces a uniform float in [0, 1) from an integer seed.
 * Each call advances the internal state, so one mulberry32(seed) instance is a
 * self-contained reproducible random stream.
 * @param {number} seed  32-bit integer seed
 * @returns {function(): number}
 */
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform → standard normal sample.
 * @param {function(): number} rng  uniform [0,1) random source
 */
function randNormal(rng) {
  let u, v;
  do { u = rng(); } while (u === 0);
  do { v = rng(); } while (v === 0);
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
function calcIRR(premium, step, months, finalValue, pptMonths = null) {
  if (finalValue <= 0 || premium <= 0 || months <= 0) return null;

  // For limited-pay products, premium is paid only for the first pptMonths.
  // Cash outflow timing affects IRR — capping is essential.
  const premiumLimit = (pptMonths != null) ? Math.min(months, pptMonths) : months;

  // FV of all premiums valued at month `months`, at monthly rate r
  function fv(r) {
    let sum = 0;
    for (let m = 0; m < premiumLimit; m += step) {
      sum += premium * Math.pow(1 + r, months - m - 1);
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

// ─── Fee hook ────────────────────────────────────────────────────────────────
// applyFees() is defined in js/fees.js (loaded before this file in both
// browser and the test VM context).  See fees.js for signature & semantics.

// ─── Rebalance helper ─────────────────────────────────────────────────────────
// Spread cost applies only to the DELTA (amount actually traded), not the
// whole portfolio.  Overweight funds sell the excess at BID; underweight
// funds buy the deficit at Offer.  A fund already at its target weight
// is untouched — so a single-fund portfolio incurs zero spread cost.

function rebalance(portfolio, navPrices, fundStats, allocation) {
  // Current value of each fund at BID
  const bidValues = {};
  let total = 0;
  for (const [fund, units] of Object.entries(portfolio)) {
    const bid = navPrices[fund] * (fundStats[fund]?.bidRatio ?? 1);
    bidValues[fund] = units * bid;
    total += bidValues[fund];
  }
  if (total === 0) return;

  // Trade only the delta per fund
  for (const [fund, pct] of Object.entries(allocation)) {
    const targetValue  = total * pct;
    const currentValue = bidValues[fund] ?? 0;
    const delta = targetValue - currentValue; // + = buy, - = sell
    if (Math.abs(delta) < 1e-9) continue;    // already at target — no trade

    if (delta < 0) {
      // Selling excess — reduce units at BID price
      const bidPrice = navPrices[fund] * (fundStats[fund]?.bidRatio ?? 1);
      portfolio[fund] += delta / bidPrice;
    } else {
      // Buying deficit — add units at Offer price
      const offerPrice = navPrices[fund] * (fundStats[fund]?.offerRatio ?? 1);
      portfolio[fund] += delta / offerPrice;
    }
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
 *   - initialNav        { fundName: startingNAV }
 *   - feeParams         fee config (passed through to applyFees)
 *   - rng               seeded PRNG function from mulberry32(); defaults to Math.random
 *   - regimeSwitching   boolean — enable Markov regime switching (default false)
 *   - regimes           [{ name, muScale, sigmaScale }] — regime definitions
 *   - transitionMatrix  number[][] — row-stochastic n×n Markov transition matrix
 *   - stationaryDist    number[]  — stationary distribution (pre-computed)
 * @returns {{ values: number[], lapseMonth: number|null, totalAdminFee: number }}
 *   values        — portfolio value (at BID) at end of each month;
 *                   values[m] = 0 for m ≥ lapseMonth (post-lapse marker — filter
 *                   in percentile/mean aggregation, do NOT display directly).
 *   lapseMonth    — month index at which policy lapsed (AUM ≤ 0 after fees);
 *                   null if the policy never lapsed.
 *   totalAdminFee — sum of admin fees deducted across all months (THB);
 *                   includes the lapse-month fee that triggered lapse.
 */
function runScenario(params) {
  const {
    fundStats, fundOrder, choleskyL,
    allocation, months,
    premiumMonths, premium,
    rebalanceMode, initialNav, feeParams = {},
    rng = Math.random,
    regimeSwitching = false,
    regimes = [],
    transitionMatrix = [],
    stationaryDist = []
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
  let lapseMonth = null;
  let totalAdminFee = 0;

  // Initialise regime state from stationary distribution (regime switching only)
  let regimeIdx = regimeSwitching ? sampleFromCDF(stationaryDist, rng) : 0;

  for (let m = 0; m < months; m++) {
    // Post-lapse: skip premium, fees, rebalance, market shock.
    // values[m] = 0 is an internal marker — percentile/mean aggregation MUST
    // filter in-force paths only, never display these zeros to the user.
    if (lapseMonth !== null) {
      values[m] = 0;
      continue;
    }

    // ── Phase 2b loop order (D1) ────────────────────────────────────────────
    //   1. Premium contribution (buy at Offer)
    //   2. SNAPSHOT AUM at BID  (passed into applyFees)
    //   3. applyFees() — admin fee + lapse check
    //   4. Rebalance
    //   5. Record value at BID
    //   6. Market shock — NAV update for next month's open

    // 1. Add premium contribution — buy units at Offer price
    if (premiumMonths.has(m)) {
      for (const f of funds) {
        const offerPrice = nav[f] * (fundStats[f]?.offerRatio ?? 1);
        portfolio[f] += (premium * (allocation[f] || 0)) / offerPrice;
      }
    }

    // 2. SNAPSHOT AUM at BID — pre-compute bid prices for fees & valuation
    const bidPrices = {};
    for (const f of funds) bidPrices[f] = nav[f] * (fundStats[f]?.bidRatio ?? 1);

    // 3. Apply fees (admin fee in Phase 2b; COI added in Phase 2c)
    const { adminFee, lapsed } = applyFees(portfolio, bidPrices, feeParams, m);
    totalAdminFee += adminFee;
    if (lapsed) {
      lapseMonth = m;
      values[m] = 0;
      continue;
    }

    // 4. Rebalance if scheduled
    const shouldRebalance =
      rebalanceMode === 'monthly' ||
      (rebalanceMode === 'quarterly' && (m + 1) % 3 === 0) ||
      (rebalanceMode === 'annual'    && (m + 1) % 12 === 0);
    if (shouldRebalance) {
      rebalance(portfolio, nav, fundStats, allocation);
    }

    // 5. Record total portfolio value at BID prices (reuse bidPrices snapshot
    //    is intentionally NOT done — rebalance may have shifted units, so
    //    re-multiply against the same bidPrices for consistency this month)
    let total = 0;
    for (const f of funds) total += portfolio[f] * bidPrices[f];
    values[m] = total;

    // 6. Market shock — correlated NAV movement via Cholesky decomposition.
    //
    //    Draw z ~ N(0, I), then compute  w = L · z  where L is the lower-
    //    triangular Cholesky factor of the covariance matrix Σ.
    //    By construction:  Cov(w) = L · Lᵀ = Σ,  so w[i] ~ N(0, std_i²)
    //    with the historical inter-fund correlations embedded.
    //
    //    Regime switching — per-fund scale resolution (priority order):
    //      1. regime.fundScales[fundName]   — explicit per-fund override
    //      2. regime.defaultScale            — fallback for unlisted funds
    //      3. flat regime.muScale/sigmaScale — legacy single-scalar format
    //      4. {muScale:1, sigmaScale:1}      — no-op (regime switching off)
    //
    //    Two drift modes (per fund):
    //      muOverride  — absolute monthly log-return (ignores historical μ̂)
    //                    use for assets whose crisis role is independent of
    //                    historical performance: gold, bonds, alternatives
    //      muScale     — multiplies historical μ̂ (proportional scaling)
    //                    use for equity where regime amplifies/reverses trend
    const z = Array.from({ length: nFunds }, () => randNormal(rng));
    for (let i = 0; i < nFunds; i++) {
      let shock = 0;
      for (let k = 0; k <= i; k++) shock += choleskyL[i][k] * z[k];

      let mu = fundStats[funds[i]].mean; // default: historical mean
      let sigmaScale = 1;

      if (regimeSwitching) {
        const regime = regimes[regimeIdx];
        const s = regime.fundScales?.[funds[i]] ?? regime.defaultScale ?? regime;
        sigmaScale = s.sigmaScale ?? 1;
        if ('muOverride' in s) {
          mu = s.muOverride;              // absolute: ignore historical μ̂
        } else {
          mu = fundStats[funds[i]].mean * (s.muScale ?? 1); // scale historical μ̂
        }
      }

      nav[funds[i]] = nav[funds[i]] * Math.exp(mu + shock * sigmaScale);
    }

    // Transition to next regime using the Markov transition matrix
    if (regimeSwitching) regimeIdx = sampleFromCDF(transitionMatrix[regimeIdx], rng);
  }

  return { values, lapseMonth, totalAdminFee };
}

// ─── Premium month set builder ────────────────────────────────────────────────

/**
 * Build the set of 0-based month indices when a premium payment falls.
 * @param {'monthly'|'quarterly'|'semi-annual'|'annual'} mode
 * @param {number} totalMonths
 */
function buildPremiumMonths(mode, totalMonths, pptMonths = null) {
  const limit = (pptMonths !== null) ? Math.min(totalMonths, pptMonths) : totalMonths;
  const set = new Set();
  const intervals = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 };
  const step = intervals[mode] || 1;
  for (let m = 0; m < limit; m += step) set.add(m);
  return set;
}

// ─── Regime μ normalization ───────────────────────────────────────────────────

/**
 * Normalize regime muScales so E[muScale] = 1 under the stationary distribution,
 * per fund.  This ensures regime switching changes the PATH and DISPERSION of
 * returns but does NOT shift the long-run mean — μ stays anchored at the
 * shrunk fundStats value.
 *
 * Funds using muOverride (absolute drift, e.g. gold in crisis) are skipped —
 * their drift is intentional and should not be normalised.
 *
 * @param {Array}    regimes           regime config objects
 * @param {number[][]} transitionMatrix row-stochastic Markov matrix
 * @param {string[]} fundOrder
 * @returns {Array}  new regimes array with normalised fundScales (caller's array untouched)
 */
function normalizeRegimeMuScales(regimes, transitionMatrix, fundOrder) {
  if (!regimes.length || !transitionMatrix.length) return regimes;
  const stationary = computeStationaryDist(transitionMatrix);

  // Deep-clone so we never mutate the caller's config
  const normalized = regimes.map(r => ({
    ...r,
    fundScales:   r.fundScales   ? { ...r.fundScales }   : undefined,
    defaultScale: r.defaultScale ? { ...r.defaultScale } : undefined,
  }));

  for (const fund of fundOrder) {
    let weightedSum = 0;
    let hasOverride = false;
    const scales = [];

    for (let i = 0; i < normalized.length; i++) {
      const r = normalized[i];
      const s = r.fundScales?.[fund] ?? r.defaultScale ?? r;
      if ('muOverride' in s) { hasOverride = true; break; }
      const sc = s.muScale ?? 1;
      scales.push(sc);
      weightedSum += stationary[i] * sc;
    }

    // Skip funds with absolute muOverride — those are intentional
    if (hasOverride || weightedSum <= 1e-9) continue;

    // Rescale each regime's effective muScale for this fund
    for (let i = 0; i < normalized.length; i++) {
      const r = normalized[i];
      const perFund = r.fundScales?.[fund];

      if (perFund && 'muScale' in perFund) {
        // Explicit per-fund scale exists — normalise in place
        perFund.muScale = perFund.muScale / weightedSum;
      } else if (!perFund && r.defaultScale && !('muOverride' in r.defaultScale)) {
        // No per-fund override; create one derived from defaultScale
        if (!r.fundScales) r.fundScales = {};
        r.fundScales[fund] = {
          muScale:    (r.defaultScale.muScale ?? 1) / weightedSum,
          sigmaScale: r.defaultScale.sigmaScale ?? 1,
        };
      }
      // If neither fundScales nor defaultScale applies, muScale is implicitly 1 for
      // every regime → weightedSum = 1 → nothing to normalise; loop is a no-op.
    }
  }
  return normalized;
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
 *   - feeParams      { adminFeeRate, ... }  passed through to applyFees()
 *   - userAge        starting age — used to convert lapseMonth → lapseAge
 * @param {Function} onProgress  (pct: 0-100) => void
 * @returns {Promise<{
 *     percentiles, meanSeries, months,
 *     survivalMonthly, survivalYearly,
 *     avgLapseAge, userAge, covDiagnostics
 *   }>}
 *   percentiles[p][m]  = p-th percentile across IN-FORCE paths only at month m
 *   meanSeries[m]      = mean across IN-FORCE paths only at month m
 *   survivalMonthly[m] = fraction (0-1) still in force at end of month m
 *   survivalYearly[y]  = fraction (0-1) still in force at end of year y (1-based);
 *                        survivalYearly[0] is always 1 (start of policy)
 *   avgLapseAge        = mean of (userAge + lapseMonth/12) across lapsed
 *                        scenarios; null if no scenario lapsed
 *   p50AdminFee        = totalAdminFee of the in-force scenario whose final
 *                        value sits at the P50 rank — pairs correctly with
 *                        the displayed P50 portfolio (NOT the population mean)
 */
async function runMonteCarlo(config, onProgress) {
  const {
    navData, allocation, premium, paymentMode,
    months, rebalanceMode, N, feeParams = {},
    seed = Date.now(),
    premiumPaymentMonths = null,
    userAge = null,
    regimeSwitching = false,
    regimes = [],
    transitionMatrix = []
  } = config;

  // Pre-compute stationary distribution once — shared across all scenarios
  const stationaryDist = regimeSwitching ? computeStationaryDist(transitionMatrix) : [];

  const { fundStats, fundOrder, choleskyL, covDiagnostics } = calcSimParams(navData);
  const funds = fundOrder;

  // ── Regime μ normalization (default ON) ─────────────────────────────────
  // Forces E[muScale] = 1 under stationary dist per fund so regime switching
  // changes path dispersion but does NOT shift the long-run shrunk mean.
  const normalizeRegimes = config.normalizeRegimes !== false;
  const effectiveRegimes = (regimeSwitching && normalizeRegimes)
    ? normalizeRegimeMuScales(regimes, transitionMatrix, fundOrder)
    : regimes;

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

  const premiumMonths = buildPremiumMonths(paymentMode, months, premiumPaymentMonths);
  const allSeries  = [];
  const lapseMonths = [];
  const adminFees   = [];

  const BATCH = 100;
  for (let i = 0; i < N; i++) {
    // Each scenario gets its own deterministic PRNG seeded by (mainSeed + index).
    // Same seed → identical results; different index → independent streams.
    const rng = mulberry32(seed + i);
    const { values, lapseMonth, totalAdminFee } = runScenario({
      fundStats, fundOrder, choleskyL,
      allocation: allocFrac, months,
      premium, premiumMonths,
      rebalanceMode, initialNav, feeParams, rng,
      regimeSwitching, regimes: effectiveRegimes, transitionMatrix, stationaryDist
    });
    allSeries.push(values);
    lapseMonths.push(lapseMonth);
    adminFees.push(totalAdminFee);

    if (i % BATCH === BATCH - 1) {
      onProgress && onProgress(Math.round((i + 1) / N * 100));
      await new Promise(r => setTimeout(r, 0));
    }
  }
  onProgress && onProgress(100);

  // ── In-force aggregation (D3) ────────────────────────────────────────────
  // At month m, a scenario is "in-force" iff lapseMonth === null OR
  // lapseMonth > m.  Percentile and meanSeries use ONLY in-force paths so
  // post-lapse zeros do not drag the curves down.
  const isActiveAt = (s, m) => lapseMonths[s] === null || lapseMonths[s] > m;

  const meanSeries = new Array(months).fill(0);
  const pctBands = [25, 50, 75, 98];
  const percentiles = {};
  for (const p of pctBands) percentiles[p] = new Array(months);
  const survivalMonthly = new Array(months);

  for (let m = 0; m < months; m++) {
    const active = [];
    for (let s = 0; s < N; s++) {
      if (isActiveAt(s, m)) active.push(allSeries[s][m]);
    }
    survivalMonthly[m] = active.length / N;

    if (active.length === 0) {
      // All scenarios have lapsed by month m — leave NaN-equivalent zeros
      for (const p of pctBands) percentiles[p][m] = 0;
      meanSeries[m] = 0;
      continue;
    }

    let sum = 0;
    for (const v of active) sum += v;
    meanSeries[m] = sum / active.length;

    active.sort((a, b) => a - b);
    for (const p of pctBands) {
      const idx = Math.floor((p / 100) * (active.length - 1));
      percentiles[p][m] = active[idx];
    }
  }

  // Yearly survival aggregate (D5) — survivalYearly[0] = 1 (policy start),
  // survivalYearly[y] = survival at end of year y (= survivalMonthly[12y - 1])
  const years = Math.floor(months / 12);
  const survivalYearly = new Array(years + 1);
  survivalYearly[0] = 1;
  for (let y = 1; y <= years; y++) {
    survivalYearly[y] = survivalMonthly[12 * y - 1];
  }

  // Average lapse age across lapsed scenarios
  let lapseAgeSum = 0, lapseCount = 0;
  for (let s = 0; s < N; s++) {
    if (lapseMonths[s] !== null) {
      const age = (userAge ?? 0) + lapseMonths[s] / 12;
      lapseAgeSum += age;
      lapseCount++;
    }
  }
  const avgLapseAge = lapseCount > 0 ? lapseAgeSum / lapseCount : null;

  // Admin fee paid by the P50-portfolio scenario (in-force at end of horizon).
  //
  //   Why correlated, not mean:
  //   The outcome card displays P50 portfolio = positional median across in-
  //   force scenarios at the final month.  Showing arithmetic mean of fees
  //   pairs a percentile-statistic with a population-statistic — different
  //   scenarios → misleading.  Instead, identify the scenario that produced
  //   the displayed P50 final value and report its actual totalAdminFee.
  //
  //   Scope: in-force only at the final month (matches percentiles[50] basis).
  //   If all paths lapsed, fee = 0 (no in-force scenario to report).
  const finalMonth = months - 1;
  const activeAtEnd = [];
  for (let s = 0; s < N; s++) {
    if (lapseMonths[s] === null || lapseMonths[s] > finalMonth) {
      activeAtEnd.push({ idx: s, final: allSeries[s][finalMonth] });
    }
  }
  let p50AdminFee = 0;
  if (activeAtEnd.length > 0) {
    activeAtEnd.sort((a, b) => a.final - b.final);
    const p50Pick = activeAtEnd[Math.floor(activeAtEnd.length / 2)];
    p50AdminFee = adminFees[p50Pick.idx];
  }

  // ── Calibration diagnostics (per-fund shrinkage summary) ────────────────
  const calibrationDiagnostics = fundOrder.map(f => {
    const s = fundStats[f];
    return {
      fund:              f,
      assetClass:        s.assetClass  ?? 'mixed',
      nObs:              s.nObs        ?? null,
      historicalAnnual:  (Math.exp((s.rawMean   ?? s.mean) * 12) - 1) * 100,
      priorAnnual:       (Math.exp(s.priorMonthlyMu * 12) - 1) * 100,
      shrunkAnnual:      (Math.exp(s.mean * 12) - 1) * 100,
      shrinkAlpha:       s.shrinkAlpha ?? 1,
    };
  });

  return {
    percentiles, months, meanSeries, covDiagnostics,
    survivalMonthly, survivalYearly, avgLapseAge, userAge,
    p50AdminFee,
    calibrationDiagnostics,
    regimesNormalized: regimeSwitching && normalizeRegimes,
  };
}
