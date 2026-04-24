/**
 * Tests for cov-builder.js
 * Validates correctness against hand-computed expectations and key invariants.
 */

'use strict';

const {
  buildConsistentCov, buildCovWarningMessage,
  pairwiseReturns, pearsonCorrelation, pairShrinkageDelta,
  nearestPSDCorrelation, jacobiEig,
  buildWeeklyNavMap, buildMonthlyNavMap, isoWeekKey
} = require('./cov-builder.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✓ ${msg}`); passed++; }
  else     { console.log(`  ✗ ${msg}`); failed++; }
}
function approx(a, b, tol = 1e-6) { return Math.abs(a - b) < tol; }

// ─── Helpers to generate synthetic NAV data ──────────────────────────────────

function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function randNormal(rng) {
  let u, v;
  do { u = rng(); } while (u === 0);
  do { v = rng(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Generate two correlated daily NAV series with specified correlation.
 * Returns [fundA rows, fundB rows] with daily dates starting at startDate.
 */
function makeCorrelatedDaily(nDays, rho, sigmaA, sigmaB, startDate, seed) {
  const rng = mulberry32(seed);
  const navA = [100], navB = [100];
  for (let i = 1; i < nDays; i++) {
    const z1 = randNormal(rng);
    const z2 = randNormal(rng);
    const ra = sigmaA * z1;
    const rb = sigmaB * (rho * z1 + Math.sqrt(1 - rho * rho) * z2);
    navA.push(navA[i - 1] * Math.exp(ra));
    navB.push(navB[i - 1] * Math.exp(rb));
  }
  const rowsA = [], rowsB = [];
  for (let i = 0; i < nDays; i++) {
    const d = new Date(startDate.getTime() + i * 86400000);
    rowsA.push({ date: d, nav: navA[i] });
    rowsB.push({ date: d, nav: navB[i] });
  }
  return [rowsA, rowsB];
}

// ─── Test 1: Pearson correlation on known input ──────────────────────────────
console.log('\n[Test 1] Pearson correlation basics');
{
  const a = [1, 2, 3, 4, 5];
  const b = [2, 4, 6, 8, 10];
  assert(approx(pearsonCorrelation(a, b), 1), 'perfect positive correlation = 1');

  const c = [1, 2, 3, 4, 5];
  const d = [5, 4, 3, 2, 1];
  assert(approx(pearsonCorrelation(c, d), -1), 'perfect negative correlation = -1');

  const e = [1, 2, 3, 4, 5];
  const f = [1, 1, 1, 1, 1];
  assert(pearsonCorrelation(e, f) === 0, 'constant series returns 0 (zero variance guard)');

  // Hand-computed: means 2, 7/3; deviations give sum(dev_g·dev_h)=2,
  // Var(g)=2, Var(h)=14/3 → ρ = 2 / √(28/3) ≈ 0.6547
  const g = [1, 2, 3];
  const h = [2, 1, 4];
  const rho_gh = pearsonCorrelation(g, h);
  assert(approx(rho_gh, 2 / Math.sqrt(28/3), 1e-10), `hand-computed rho ≈ 0.6547 (got ${rho_gh.toFixed(6)})`);
}

// ─── Test 2: Per-pair shrinkage intensity ────────────────────────────────────
console.log('\n[Test 2] Per-pair shrinkage intensity');
{
  // N=2, T=10 → delta = (2+1)/(10-1) = 1/3
  const d1 = pairShrinkageDelta(2, 10);
  assert(approx(d1, 1/3), `δ = (N+1)/(T-1) = 1/3 for N=2,T=10 (got ${d1.toFixed(6)})`);

  // Large T → delta → 0
  const d2 = pairShrinkageDelta(2, 1000);
  assert(d2 < 0.01, `large T → small δ (δ=${d2.toFixed(6)})`);

  // T == N → delta ≥ 1 (clamped)
  const d3 = pairShrinkageDelta(2, 2);
  assert(d3 === 1, `T ≤ N+1 forces full shrinkage (δ=${d3})`);

  // T = 1 → guarded, returns 1
  const d4 = pairShrinkageDelta(2, 1);
  assert(d4 === 1, `T=1 guard (δ=${d4})`);

  // Monotonic: more funds (larger N) → more shrinkage at same T
  const dSmallN = pairShrinkageDelta(3, 50);
  const dLargeN = pairShrinkageDelta(10, 50);
  assert(dLargeN > dSmallN, `δ monotonic in N at fixed T (N=3: ${dSmallN.toFixed(3)}, N=10: ${dLargeN.toFixed(3)})`);
}

// ─── Test 3: Jacobi eigendecomposition ───────────────────────────────────────
console.log('\n[Test 3] Jacobi eigendecomposition');
{
  // Diagonal matrix — eigenvalues are the diagonal
  const D = [[3, 0, 0], [0, 1, 0], [0, 0, 2]];
  const { V, D: eig } = jacobiEig(D);
  const sorted = [...eig].sort((a, b) => a - b);
  assert(approx(sorted[0], 1) && approx(sorted[1], 2) && approx(sorted[2], 3),
    `diagonal eigenvalues recovered: ${sorted.map(v => v.toFixed(3))}`);

  // V orthogonal: V · Vᵀ = I
  const VT_V = [[0,0,0],[0,0,0],[0,0,0]];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      for (let k = 0; k < 3; k++)
        VT_V[i][j] += V[k][i] * V[k][j];
  let orthOK = true;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const expected = (i === j) ? 1 : 0;
      if (!approx(VT_V[i][j], expected, 1e-8)) orthOK = false;
    }
  }
  assert(orthOK, 'V is orthogonal (VᵀV = I)');
}

// ─── Test 4: PSD repair on a non-PSD matrix ──────────────────────────────────
console.log('\n[Test 4] PSD repair');
{
  // Classic non-PSD correlation matrix from pairwise estimation
  // eigenvalues of [[1, .9, -.9],[.9, 1, .9],[-.9, .9, 1]] include a negative
  const C = [[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]];
  const repaired = nearestPSDCorrelation(C);

  // Verify: diagonal should be ~1
  assert(approx(repaired[0][0], 1, 1e-6) && approx(repaired[1][1], 1, 1e-6) && approx(repaired[2][2], 1, 1e-6),
    'repaired matrix has unit diagonal');

  // Verify: all eigenvalues ≥ 0 (within tolerance)
  const { D: eig } = jacobiEig(repaired);
  const minEig = Math.min(...eig);
  assert(minEig >= -1e-6, `repaired matrix is PSD (min eig = ${minEig.toFixed(8)})`);

  // Verify: off-diagonals in [-1, 1]
  let bounded = true;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (repaired[i][j] < -1 - 1e-6 || repaired[i][j] > 1 + 1e-6) bounded = false;
  assert(bounded, 'repaired off-diagonals ∈ [-1, 1]');

  // Already-PSD matrix should pass through unchanged
  const psd = [[1, 0.3, 0.1], [0.3, 1, 0.2], [0.1, 0.2, 1]];
  const pass = nearestPSDCorrelation(psd);
  let unchanged = true;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      if (!approx(pass[i][j], psd[i][j], 1e-10)) unchanged = false;
  assert(unchanged, 'already-PSD matrix returned unchanged');
}

// ─── Test 5: ISO week keys ───────────────────────────────────────────────────
console.log('\n[Test 5] ISO week keying');
{
  // 2024-01-01 is a Monday → ISO week 1 of 2024
  assert(isoWeekKey(new Date(2024, 0, 1)) === '2024-W01', '2024-01-01 → 2024-W01');
  // 2024-01-08 → ISO week 2
  assert(isoWeekKey(new Date(2024, 0, 8)) === '2024-W02', '2024-01-08 → 2024-W02');
  // 2023-01-01 was a Sunday → belongs to 2022-W52
  assert(isoWeekKey(new Date(2023, 0, 1)) === '2022-W52', '2023-01-01 → 2022-W52 (year rollover)');
}

// ─── Test 6: Pairwise returns on non-overlapping then overlapping data ───────
console.log('\n[Test 6] Pairwise returns respects overlap');
{
  // Fund A: Jan 2020 - Dec 2023 (daily); Fund B: Jan 2023 - Dec 2023 (daily)
  const [rowsA_full, _unused] = makeCorrelatedDaily(365 * 4, 0.5, 0.01, 0.01, new Date(2020, 0, 1), 42);
  const [_unused2, rowsB_short] = makeCorrelatedDaily(365, 0.5, 0.01, 0.01, new Date(2023, 0, 1), 99);

  const mapA = buildMonthlyNavMap(rowsA_full);
  const mapB = buildMonthlyNavMap(rowsB_short);
  const { T } = pairwiseReturns(mapA, mapB);

  // Overlap is ~12 months → ~11 monthly returns
  assert(T >= 10 && T <= 12, `overlap ≈ 11 monthly returns (got ${T})`);
}

// ─── Test 7: End-to-end — recover known correlation from synthetic data ──────
console.log('\n[Test 7] End-to-end — recover true correlation (long history)');
{
  // Generate 3 years of daily data with true correlation 0.6
  const TRUE_RHO = 0.6;
  const SIGMA = 0.015; // ~1.5% daily → ~24% annual vol
  const [rowsA, rowsB] = makeCorrelatedDaily(3 * 252, TRUE_RHO, SIGMA, SIGMA, new Date(2022, 0, 1), 123);

  const navData = { A: rowsA, B: rowsB };
  const fundOrder = ['A', 'B'];
  // Hand-compute std from monthly returns (matching the original fundStats approach)
  const monthlyMapA = buildMonthlyNavMap(rowsA);
  const monthlyMapB = buildMonthlyNavMap(rowsB);
  const keysA = [...monthlyMapA.keys()].sort();
  const keysB = [...monthlyMapB.keys()].sort();
  const retsA = [], retsB = [];
  for (let i = 1; i < keysA.length; i++) retsA.push(Math.log(monthlyMapA.get(keysA[i]) / monthlyMapA.get(keysA[i - 1])));
  for (let i = 1; i < keysB.length; i++) retsB.push(Math.log(monthlyMapB.get(keysB[i]) / monthlyMapB.get(keysB[i - 1])));
  const std = xs => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(v);
  };
  const fundStats = {
    A: { mean: 0, std: std(retsA) },
    B: { mean: 0, std: std(retsB) }
  };

  const { cov, correlation, diagnostics } = buildConsistentCov(navData, fundOrder, fundStats);

  console.log('    diagnostics:', JSON.stringify(diagnostics));
  console.log('    recovered ρ:', correlation[0][1].toFixed(4));
  console.log('    true ρ:     ', TRUE_RHO);

  assert(Math.abs(correlation[0][1] - TRUE_RHO) < 0.1,
    `recovered correlation close to true (|${correlation[0][1].toFixed(3)} - ${TRUE_RHO}| < 0.1)`);

  // Cov diagonal should equal σ²
  assert(approx(cov[0][0], fundStats.A.std ** 2, 1e-10),
    `cov diagonal = σ² for A (${cov[0][0].toFixed(8)} vs ${(fundStats.A.std**2).toFixed(8)})`);
  assert(approx(cov[1][1], fundStats.B.std ** 2, 1e-10),
    `cov diagonal = σ² for B`);

  // Covariance off-diagonal = ρ · σA · σB
  const expectedCov = correlation[0][1] * fundStats.A.std * fundStats.B.std;
  assert(approx(cov[0][1], expectedCov, 1e-10), 'cov[0][1] = ρ · σA · σB');
}

// ─── Test 8: The real scenario — short-history fund alongside long-history ───
console.log('\n[Test 8] Short-history fund (ULTIMATE-GA scenario)');
{
  // Fund A and B: 3 years of daily data (long history), generated with ρ=0.7
  // Fund C: ~1 year of daily data starting in the last year of A/B, ρ(A,C)=0.3
  const TRUE_RHO_AB = 0.7;
  const TRUE_RHO_AC = 0.3;
  const SIGMA = 0.015;

  const nLong = 3 * 252;  // ~756 trading days over 3 years
  const startLong = new Date(2022, 0, 1);
  const [rowsA, rowsB] = makeCorrelatedDaily(nLong, TRUE_RHO_AB, SIGMA, SIGMA, startLong, 42);

  // Fund C starts 2 years in (leaving 1 year of overlap with A/B, ~252 days
  // ≈ 52 weekly returns — well above MIN_OBS_WEEKLY=26).
  // Generate C's returns correlated with A's returns over that window.
  const cStartIdx = 2 * 252;
  const rng = mulberry32(777);
  const rowsC = [{ date: rowsA[cStartIdx].date, nav: 100 }];
  for (let i = cStartIdx + 1; i < nLong; i++) {
    const rA = Math.log(rowsA[i].nav / rowsA[i - 1].nav);
    const z = randNormal(rng);
    // rC = ρ·(rA/σA)·σC + √(1-ρ²)·σC·z  — correlated Gaussian construction
    const rC = TRUE_RHO_AC * (rA / SIGMA) * SIGMA + Math.sqrt(1 - TRUE_RHO_AC ** 2) * SIGMA * z;
    const prevNav = rowsC[rowsC.length - 1].nav;
    rowsC.push({ date: rowsA[i].date, nav: prevNav * Math.exp(rC) });
  }

  console.log(`    Fund A: ${rowsA.length} days, ${rowsA[0].date.toISOString().slice(0,10)} → ${rowsA[rowsA.length-1].date.toISOString().slice(0,10)}`);
  console.log(`    Fund B: ${rowsB.length} days, ${rowsB[0].date.toISOString().slice(0,10)} → ${rowsB[rowsB.length-1].date.toISOString().slice(0,10)}`);
  console.log(`    Fund C: ${rowsC.length} days, ${rowsC[0].date.toISOString().slice(0,10)} → ${rowsC[rowsC.length-1].date.toISOString().slice(0,10)}`);

  const navData = { A: rowsA, B: rowsB, C: rowsC };
  const fundOrder = ['A', 'B', 'C'];
  const fundStats = {
    A: { mean: 0, std: 0.05 },
    B: { mean: 0, std: 0.05 },
    C: { mean: 0, std: 0.05 }
  };

  const { cov, correlation, diagnostics } = buildConsistentCov(navData, fundOrder, fundStats);
  console.log('    diagnostics:', JSON.stringify(diagnostics));
  console.log('    correlation matrix:');
  console.log(`      ρ(A,B)=${correlation[0][1].toFixed(3)}  (true ${TRUE_RHO_AB})`);
  console.log(`      ρ(A,C)=${correlation[0][2].toFixed(3)}  (true ${TRUE_RHO_AC})`);
  console.log(`      ρ(B,C)=${correlation[1][2].toFixed(3)}  (induced via A)`);

  // A,B have full history → recovered ρ close to true (± shrinkage bias)
  assert(Math.abs(correlation[0][1] - TRUE_RHO_AB) < 0.15,
    `ρ(A,B) well-recovered (|${correlation[0][1].toFixed(3)} - 0.7| < 0.15)`);

  // A,C have 1-year overlap — ~52 weekly returns → above MIN_OBS, so computed.
  // Shrinkage pulls it toward 0 but direction and magnitude should be sensible.
  assert(correlation[0][2] > 0 && correlation[0][2] < TRUE_RHO_AC + 0.2,
    `ρ(A,C) positive and bounded (${correlation[0][2].toFixed(3)})`);

  // Zero pairs should be none — all overlaps exceed MIN_OBS_WEEKLY
  assert(diagnostics.zeroedPairs === 0, `no zeroed pairs (all overlaps ≥ MIN_OBS)`);

  // Verify the final covariance matrix is PSD (Cholesky succeeds)
  function cholesky(A) {
    const n = A.length;
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;
        for (let k = 0; k < j; k++) sum += L[i][k] * L[j][k];
        if (i === j) {
          const d = A[i][i] - sum;
          if (d <= 0) return null;
          L[i][j] = Math.sqrt(d);
        } else {
          L[i][j] = (A[i][j] - sum) / L[j][j];
        }
      }
    }
    return L;
  }
  assert(cholesky(cov) !== null, 'final covariance matrix is PSD (Cholesky succeeds)');
}

// ─── Test 9: MIN_OBS guard — zero out too-short pairs ────────────────────────
console.log('\n[Test 9] MIN_OBS guard zeroes out too-short pairs');
{
  // Fund D has only 3 months of data → below both MIN_OBS thresholds
  const [rowsA, _] = makeCorrelatedDaily(800, 0.5, 0.01, 0.01, new Date(2022, 11, 1), 7);
  const rng = mulberry32(8);
  const rowsD = [];
  let nav = 100;
  for (let i = 0; i < 60; i++) {  // 60 days ≈ 3 months
    const d = new Date(2026, 0, 1 + i);
    nav = nav * Math.exp(0.01 * randNormal(rng));
    rowsD.push({ date: d, nav });
  }
  // But rowsA ends at Feb 2025 — they don't even overlap. Adjust rowsD to overlap.
  const rowsD2 = [];
  nav = 100;
  const startD = rowsA[rowsA.length - 70].date;
  for (let i = 0; i < 60; i++) {
    const d = new Date(startD.getTime() + i * 86400000);
    nav = nav * Math.exp(0.01 * randNormal(rng));
    rowsD2.push({ date: d, nav });
  }

  const navData = { A: rowsA, D: rowsD2 };
  const fundStats = { A: { std: 0.05 }, D: { std: 0.05 } };
  const result = buildConsistentCov(navData, ['A', 'D'], fundStats);
  console.log('    diagnostics:', JSON.stringify(result.diagnostics));
  // With only ~60 daily = ~12 weekly = ~3 monthly overlap, weekly is < 26 so
  // falls back to monthly, and monthly is < 6, so pair is zeroed.
  assert(result.diagnostics.zeroedPairs === 1, `short-overlap pair zeroed (zeroedPairs=${result.diagnostics.zeroedPairs})`);
}

// ─── Test 10: Dynamic warning message ────────────────────────────────────────
console.log('\n[Test 10] Dynamic warning message');
{
  // Case A: long-history-only → no warning
  const diagA = {
    historyMonths: { A: 40, B: 38 },
    shortHistoryFunds: [],
    maxShrinkageDelta: 0.15,
    zeroedPairs: 0
  };
  assert(buildCovWarningMessage(diagA, 2) === null, 'no warning for long-history basket');

  // Case B: one short-history fund → names it with its month count
  const diagB = {
    historyMonths: { A: 40, 'ES-ULTIMATE GA1': 13.5 },
    shortHistoryFunds: [{ fund: 'ES-ULTIMATE GA1', months: 13.5 }],
    maxShrinkageDelta: 0.48,
    zeroedPairs: 0
  };
  const msgB = buildCovWarningMessage(diagB, 5);
  console.log('    Case B:', msgB);
  assert(msgB !== null, 'warning generated for short-history fund');
  assert(msgB.includes('ES-ULTIMATE GA1'), 'warning names the specific fund');
  assert(msgB.includes('13.5'), 'warning includes actual month count (not a placeholder)');

  // Case C: two short-history funds + heavy shrinkage → both named, context included
  const diagC = {
    historyMonths: { A: 40, B: 40, 'GA1': 13.5, 'GA2': 13.5 },
    shortHistoryFunds: [{ fund: 'GA1', months: 13.5 }, { fund: 'GA2', months: 13.5 }],
    maxShrinkageDelta: 0.89,
    zeroedPairs: 0
  };
  const msgC = buildCovWarningMessage(diagC, 10);
  console.log('    Case C:', msgC);
  assert(msgC.includes('GA1') && msgC.includes('GA2'), 'names all short-history funds');
  assert(msgC.includes('10-fund'), 'mentions basket size for context');

  // Case D: zeroed pairs → warning mentions them
  const diagD = {
    historyMonths: { A: 40, B: 2 },
    shortHistoryFunds: [{ fund: 'B', months: 2 }],
    maxShrinkageDelta: 0,
    zeroedPairs: 1
  };
  const msgD = buildCovWarningMessage(diagD, 2);
  console.log('    Case D:', msgD);
  assert(msgD.includes('correlation was set to 0'), 'mentions zeroed pairs');
}
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
