/**
 * cov-builder.js — Covariance matrix builder for funds with unequal histories.
 *
 * Solves two problems in the original simulation.js:
 *   1. Inception backfill inflated T with zero returns → deflated variance,
 *      deflated covariance, attenuated correlations.
 *   2. Per-fund std in fundStats was inconsistent with cov matrix diagonals.
 *
 * Strategy — "correlation rebuild":
 *   • σ_i per fund  → from fund i's FULL history (existing calcFundStats)
 *   • ρ_ij per pair → from REAL overlap between funds i and j (weekly returns)
 *   • Σ_ij = ρ_ij · σ_i · σ_j   → internally consistent, unbiased
 *
 * Guards:
 *   • MIN_OBS: if pairwise overlap is too short, set ρ_ij = 0 (avoid noise)
 *   • Ledoit-Wolf-style shrinkage toward identity when overall T is small
 *   • PSD repair via eigenvalue clipping if pairwise matrix is not PSD
 */

'use strict';

const MIN_OBS_WEEKLY  = 26;  // ~6 months of weekly data
const MIN_OBS_MONTHLY = 6;   // 6 months of monthly data

// ─── Return-series builders ──────────────────────────────────────────────────

/**
 * Build YYYY-WW (ISO-week) → last-NAV-of-week map from raw rows.
 * Uses Thursday-of-week as the canonical day (ISO 8601) to avoid
 * weekend-boundary ambiguity.
 */
function buildWeeklyNavMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = isoWeekKey(row.date);
    map.set(key, row.nav); // later rows in the same week overwrite → end-of-week
  }
  return map;
}

function isoWeekKey(date) {
  // ISO 8601 week-numbering: week 1 contains the year's first Thursday.
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;           // Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);   // shift to Thursday of this week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

function buildMonthlyNavMap(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, row.nav);
  }
  return map;
}

/**
 * Given two NAV maps keyed by period (week or month), return the log-return
 * series on ONLY the periods where both funds have a recorded NAV in both
 * this period AND the previous period (so a return can be computed for each).
 *
 * Returns { ra, rb, T } where ra[t] and rb[t] are aligned log-returns.
 */
function pairwiseReturns(mapA, mapB) {
  // Intersection of periods where both have data
  const keys = [];
  for (const k of mapA.keys()) if (mapB.has(k)) keys.push(k);
  keys.sort();

  const ra = [], rb = [];
  for (let t = 1; t < keys.length; t++) {
    // Require consecutive periods for a valid return
    if (!areConsecutivePeriods(keys[t - 1], keys[t])) continue;
    const pa0 = mapA.get(keys[t - 1]);
    const pa1 = mapA.get(keys[t]);
    const pb0 = mapB.get(keys[t - 1]);
    const pb1 = mapB.get(keys[t]);
    const la = Math.log(pa1 / pa0);
    const lb = Math.log(pb1 / pb0);
    if (isFinite(la) && isFinite(lb)) {
      ra.push(la);
      rb.push(lb);
    }
  }
  return { ra, rb, T: ra.length };
}

/**
 * Quick heuristic — two period keys (YYYY-MM or YYYY-Www) are consecutive if
 * the numeric part differs by 1 (or rolls over year). Gaps mean a missing
 * period for at least one fund; we skip those to avoid stale returns.
 */
function areConsecutivePeriods(k1, k2) {
  // Weekly: YYYY-Www
  if (k1.includes('W')) {
    const [y1, w1] = k1.split('-W').map(Number);
    const [y2, w2] = k2.split('-W').map(Number);
    if (y1 === y2) return w2 - w1 === 1;
    if (y2 === y1 + 1) return w1 >= 52 && w2 === 1; // year rollover
    return false;
  }
  // Monthly: YYYY-MM
  const [y1, m1] = k1.split('-').map(Number);
  const [y2, m2] = k2.split('-').map(Number);
  if (y1 === y2) return m2 - m1 === 1;
  if (y2 === y1 + 1) return m1 === 12 && m2 === 1;
  return false;
}

// ─── Pearson correlation from aligned returns ────────────────────────────────

function pearsonCorrelation(ra, rb) {
  const T = ra.length;
  if (T < 2) return 0;
  let sa = 0, sb = 0;
  for (let t = 0; t < T; t++) { sa += ra[t]; sb += rb[t]; }
  const ma = sa / T, mb = sb / T;
  let num = 0, vA = 0, vB = 0;
  for (let t = 0; t < T; t++) {
    const da = ra[t] - ma, db = rb[t] - mb;
    num += da * db;
    vA  += da * da;
    vB  += db * db;
  }
  if (vA === 0 || vB === 0) return 0;
  const rho = num / Math.sqrt(vA * vB);
  // Numerical safety — clamp into [-1, 1]
  return Math.max(-1, Math.min(1, rho));
}

// ─── Shrinkage toward identity ────────────────────────────────────────────────

/**
 * Per-pair shrinkage intensity using the bias-corrected heuristic:
 *
 *   δ = min(1, (N+1)/(T-1))
 *
 * where T is the effective monthly-equivalent sample size for THIS pair.
 * N is the matrix dimension (more funds → weaker per-pair estimates when T
 * is small, motivating stronger shrinkage).
 *
 * Applied per pair so that well-estimated pairs (large T) keep their sample
 * correlation while short-overlap pairs are pulled toward zero independently.
 */
function pairShrinkageDelta(N, Tmonthly) {
  if (Tmonthly <= 1) return 1;
  const d = (N + 1) / (Tmonthly - 1);
  return Math.max(0, Math.min(1, d));
}

function identity(n) {
  const I = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) I[i][i] = 1;
  return I;
}

// ─── PSD repair via Jacobi eigendecomposition ────────────────────────────────

/**
 * Nearest PSD correlation matrix via eigenvalue clipping:
 *   1. Eigendecompose C = V · Λ · Vᵀ (Jacobi rotation — stable for small N)
 *   2. Clip negative eigenvalues to EPS
 *   3. Reconstruct, then rescale to unit diagonal (correlation form)
 *
 * For N ≤ ~200 Jacobi is fast enough and produces a valid PSD matrix without
 * needing an external linear-algebra library. The rescale step ensures the
 * result is a correlation matrix (diag = 1), not just any PSD matrix.
 *
 * Returns the repaired matrix, or the original if already PSD.
 */
function nearestPSDCorrelation(C) {
  const N = C.length;
  const { V, D } = jacobiEig(C);
  const EPS = 1e-8;

  let anyNegative = false;
  for (let i = 0; i < N; i++) {
    if (D[i] < EPS) { D[i] = EPS; anyNegative = true; }
  }
  if (!anyNegative) return C;

  // Reconstruct: M = V · diag(D) · Vᵀ
  const M = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      let s = 0;
      for (let k = 0; k < N; k++) s += V[i][k] * D[k] * V[j][k];
      M[i][j] = s;
    }
  }
  // Rescale to unit diagonal → valid correlation matrix
  const d = new Array(N);
  for (let i = 0; i < N; i++) d[i] = Math.sqrt(M[i][i] > 0 ? M[i][i] : EPS);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      M[i][j] = M[i][j] / (d[i] * d[j]);
    }
  }
  // Enforce exact symmetry and diag=1 (kill numerical drift)
  for (let i = 0; i < N; i++) {
    M[i][i] = 1;
    for (let j = i + 1; j < N; j++) {
      const avg = (M[i][j] + M[j][i]) / 2;
      M[i][j] = M[j][i] = Math.max(-1, Math.min(1, avg));
    }
  }
  return M;
}

/**
 * Jacobi eigenvalue algorithm for a symmetric real matrix.
 * Returns V (orthogonal, columns are eigenvectors) and D (eigenvalues).
 * Iterates until off-diagonal sum is below tolerance or max sweeps reached.
 */
function jacobiEig(A) {
  const n = A.length;
  const M = A.map(row => row.slice());             // work on a copy
  const V = identity(n);
  const MAX_SWEEPS = 100;
  const TOL = 1e-12;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    // Off-diagonal Frobenius norm
    let off = 0;
    for (let p = 0; p < n - 1; p++)
      for (let q = p + 1; q < n; q++)
        off += M[p][q] * M[p][q];
    if (off < TOL) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = M[p][q];
        if (Math.abs(apq) < 1e-14) continue;
        const app = M[p][p], aqq = M[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;

        M[p][p] = app - t * apq;
        M[q][q] = aqq + t * apq;
        M[p][q] = M[q][p] = 0;

        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const arp = M[r][p], arq = M[r][q];
            M[r][p] = M[p][r] = c * arp - s * arq;
            M[r][q] = M[q][r] = s * arp + c * arq;
          }
          const vrp = V[r][p], vrq = V[r][q];
          V[r][p] = c * vrp - s * vrq;
          V[r][q] = s * vrp + c * vrq;
        }
      }
    }
  }

  const D = new Array(n);
  for (let i = 0; i < n; i++) D[i] = M[i][i];
  return { V, D };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Build a consistent covariance matrix for funds with potentially unequal
 * histories.
 *
 * Per-fund σ comes from fundStats (computed from each fund's full history).
 * Pairwise correlations are computed on real overlapping periods only:
 *   - Weekly returns by default (richer data, less Epps bias than daily)
 *   - Monthly fallback if weekly overlap is < MIN_OBS_WEEKLY
 *
 * A pair whose overlap is below the period's MIN_OBS → ρ = 0 (avoid noise).
 * The full matrix is shrunk toward identity using min-overlap as T.
 * PSD is enforced via eigenvalue clipping if needed.
 *
 * @param {Object} navData    { fundName: [{ date, nav, ... }] }
 * @param {string[]} fundOrder  fund names in desired row/column order
 * @param {Object} fundStats  { fundName: { mean, std, ... } }
 * @returns {{
 *   cov: number[][],
 *   correlation: number[][],
 *   diagnostics: {
 *     minPairwiseOverlap: number,
 *     grain: 'weekly'|'monthly',
 *     zeroedPairs: number,
 *     shrinkageDelta: number,
 *     psdRepaired: boolean
 *   }
 * }}
 */
function buildConsistentCov(navData, fundOrder, fundStats) {
  const N = fundOrder.length;

  // Compute each fund's history length in months (for UI warnings)
  const historyMonths = {};
  for (const f of fundOrder) {
    const rows = navData[f];
    if (!rows || rows.length < 2) { historyMonths[f] = 0; continue; }
    const firstDate = rows[0].date;
    const lastDate  = rows[rows.length - 1].date;
    const days = (lastDate - firstDate) / 86400000;
    historyMonths[f] = Math.round(days / 30.44 * 10) / 10;  // 1 decimal
  }

  // Build both weekly and monthly maps once per fund
  const weeklyMaps  = fundOrder.map(f => buildWeeklyNavMap(navData[f]));
  const monthlyMaps = fundOrder.map(f => buildMonthlyNavMap(navData[f]));

  const rho = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) rho[i][i] = 1;

  let minOverlap = Infinity;
  let maxDelta = 0;
  let zeroedPairs = 0;
  // Track grain per pair — if ANY pair falls back to monthly, report that.
  // In typical use every pair uses the same grain; mixed reporting is edge-case.
  let grain = 'weekly';

  for (let i = 0; i < N; i++) {
    for (let j = i + 1; j < N; j++) {
      // Try weekly first
      let { ra, rb, T } = pairwiseReturns(weeklyMaps[i], weeklyMaps[j]);
      let pairGrain = 'weekly';
      let minObs = MIN_OBS_WEEKLY;

      // Fall back to monthly if weekly overlap is too short
      if (T < MIN_OBS_WEEKLY) {
        const monthly = pairwiseReturns(monthlyMaps[i], monthlyMaps[j]);
        ra = monthly.ra; rb = monthly.rb; T = monthly.T;
        pairGrain = 'monthly';
        minObs = MIN_OBS_MONTHLY;
        grain = 'monthly';
      }

      if (T < minObs) {
        // Overlap below guard → correlation is too noisy; zero it out.
        rho[i][j] = rho[j][i] = 0;
        zeroedPairs++;
        continue;
      }

      // Sample correlation for this pair
      const rSample = pearsonCorrelation(ra, rb);

      // Per-pair shrinkage: δ depends on THIS pair's effective sample size,
      // so well-estimated pairs (long overlap) keep their ρ while short-
      // overlap pairs are pulled toward 0 independently.
      const Tmonthly = pairGrain === 'weekly' ? T / 4.33 : T;
      const delta = pairShrinkageDelta(N, Tmonthly);
      const rShrunk = (1 - delta) * rSample; // shrink toward 0

      rho[i][j] = rho[j][i] = rShrunk;

      if (Tmonthly < minOverlap) minOverlap = Tmonthly;
      if (delta > maxDelta) maxDelta = delta;
    }
  }

  if (minOverlap === Infinity) minOverlap = null;

  // PSD repair — per-pair shrinkage preserves PSD along each individual pair's
  // axis but mixing different δ values can still produce a non-PSD matrix.
  const corrRepaired = nearestPSDCorrelation(rho);
  const psdRepaired = corrRepaired !== rho;

  // Rebuild covariance: Σ_ij = ρ_ij · σ_i · σ_j   (σ_i from fundStats)
  const cov = Array.from({ length: N }, () => new Array(N).fill(0));
  for (let i = 0; i < N; i++) {
    const si = fundStats[fundOrder[i]].std;
    for (let j = 0; j < N; j++) {
      const sj = fundStats[fundOrder[j]].std;
      cov[i][j] = corrRepaired[i][j] * si * sj;
    }
  }

  return {
    cov,
    correlation: corrRepaired,
    diagnostics: {
      minPairwiseOverlap: minOverlap === null ? null : Math.floor(minOverlap),
      grain,
      zeroedPairs,
      maxShrinkageDelta: maxDelta,
      psdRepaired,
      historyMonths,
      // Funds with < 24 months are candidates for a UI warning;
      // the caller decides the threshold.
      shortHistoryFunds: Object.entries(historyMonths)
        .filter(([, m]) => m < 24)
        .map(([f, m]) => ({ fund: f, months: m }))
    }
  };
}

// ─── Warning message builder ─────────────────────────────────────────────────

/**
 * Build a user-facing warning message from cov diagnostics.
 *
 * Returns null if no warning is warranted. Otherwise returns a string naming
 * the specific short-history funds and how many months of data they have.
 *
 * Thresholds:
 *   - SHORT_HISTORY_MONTHS = 24  (funds under this are called out)
 *   - HIGH_SHRINKAGE_DELTA = 0.5 (basket-level trigger)
 *
 * Call whenever maxShrinkageDelta > 0.5 OR any fund has < 24 months.
 *
 * @param {Object} diagnostics  from buildConsistentCov
 * @param {number} basketSize   number of funds in the user's selection (for context)
 * @returns {string|null}
 */
function buildCovWarningMessage(diagnostics, basketSize) {
  if (!diagnostics) return null;
  const HIGH_SHRINKAGE_DELTA = 0.5;

  const short = diagnostics.shortHistoryFunds || [];
  const heavyShrinkage = (diagnostics.maxShrinkageDelta || 0) > HIGH_SHRINKAGE_DELTA;
  const zeroed = diagnostics.zeroedPairs || 0;

  if (short.length === 0 && !heavyShrinkage && zeroed === 0) return null;

  const parts = [];

  if (short.length > 0) {
    // Group funds by their month count so same-duration funds are listed together
    // instead of producing a repetitive semicolon chain.
    // e.g. GA1, GA2, GA3 all at 13.5 months → "GA1, GA2, and GA3 each have only 13.5 months"
    const groups = new Map();
    for (const { fund, months } of short) {
      const key = String(months);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(fund);
    }

    const sentences = [];
    for (const [monthsStr, funds] of groups) {
      const verb = funds.length === 1 ? 'has' : 'each have';
      const nameList = funds.length <= 2
        ? funds.join(' and ')
        : funds.slice(0, -1).join(', ') + ', and ' + funds[funds.length - 1];
      sentences.push(`${nameList} ${verb} only ${monthsStr} months of history`);
    }
    parts.push(`⚠️ ${sentences.join('; ')}.`);
  }

  if (heavyShrinkage && basketSize >= 5) {
    parts.push(
      `In a ${basketSize}-fund basket, correlation estimates involving ` +
      `short-history funds are heavily regularised toward zero — simulated ` +
      `scenarios may underestimate diversification benefits or concentration ` +
      `risk involving these funds.`
    );
  } else if (heavyShrinkage) {
    parts.push(
      `Correlation estimates are heavily regularised toward zero due to ` +
      `limited overlapping history.`
    );
  }

  if (zeroed > 0) {
    parts.push(
      `${zeroed} fund pair(s) had insufficient overlapping history and their ` +
      `correlation was set to 0.`
    );
  }

  return parts.join(' ');
}



if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildConsistentCov,
    buildCovWarningMessage,
    // exposed for tests
    pairwiseReturns, pearsonCorrelation, pairShrinkageDelta,
    nearestPSDCorrelation, jacobiEig,
    buildWeeklyNavMap, buildMonthlyNavMap, isoWeekKey,
    MIN_OBS_WEEKLY, MIN_OBS_MONTHLY
  };
}
