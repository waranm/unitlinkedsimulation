/**
 * test-simulation.js — Sanity tests for the Monte Carlo simulation engine.
 *
 * Run with:  node tools/test-simulation.js
 * Exit code 0 = all pass,  1 = at least one failure.
 *
 * Tests are self-contained and deterministic: they construct controlled
 * inputs with known analytical solutions and assert simulation output
 * matches.  No external test framework is required.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

// ─── Load simulation.js into an isolated VM context ──────────────────────────
// simulation.js defines globals (no exports), so we use vm.runInContext to
// pull all its functions into a plain object we can destructure.

const feesCode = fs.readFileSync(
  path.join(__dirname, '../js/fees.js'), 'utf8'
);
const simCode = fs.readFileSync(
  path.join(__dirname, '../js/simulation.js'), 'utf8'
);

const simCtx = vm.createContext({
  Math, Array, Object, Set, Map, Number, String, Boolean,
  isFinite, isNaN, parseInt, parseFloat,
  Promise, setTimeout, clearTimeout,
  console,
});
vm.runInContext(feesCode, simCtx);   // fees.js declares global applyFees
vm.runInContext(simCode, simCtx);    // simulation.js calls applyFees

const {
  runScenario, runMonteCarlo,
  calcIRR, cholesky, computeCovMatrix,
  buildPremiumMonths,
} = simCtx;

// ─── Assertion helpers ────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];

function pass(name) {
  console.log(`  PASS  ${name}`);
  passed++;
}

function fail(name, detail) {
  const msg = `  FAIL  ${name}: ${detail}`;
  console.error(msg);
  failures.push(msg);
  failed++;
}

/** Assert condition is truthy; fail with detail otherwise. */
function check(name, condition, detail = 'condition was false') {
  condition ? pass(name) : fail(name, detail);
}

/** Assert |actual − expected| ≤ tol. */
function near(name, actual, expected, tol = 1e-9) {
  const diff = Math.abs(actual - expected);
  diff <= tol
    ? pass(name)
    : fail(name, `got ${actual}, expected ${expected}, diff ${diff.toExponential(3)} > tol ${tol}`);
}

// ─── Seeded PRNG helpers (used by Suites 6 & 7) ──────────────────────────────
// mulberry32 — fast, portable, 32-bit seeded uniform generator.
// Deterministic: same seed → same sequence every run.
function makePRNG(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform using a provided uniform generator
function normalFrom(rng) {
  let u, v;
  do { u = rng(); } while (u === 0);
  do { v = rng(); } while (v === 0);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Assert every element of array equals values[0] exactly. */
function allEqual(name, values) {
  const ref = values[0];
  const idx = values.findIndex(v => v !== ref);
  idx === -1
    ? pass(name)
    : fail(name, `element [${idx}] = ${values[idx]} !== ref ${ref}`);
}

// ─── Shared scenario builder ──────────────────────────────────────────────────

/**
 * Run N identical scenarios with given fundStats / choleskyL overrides.
 * Returns the array of per-scenario result series.
 */
function runN(N, { fundStats, fundOrder, choleskyL, mean = 0, months = 12,
                   premium = 5000, paymentMode = 'monthly',
                   offerRatio = 1, bidRatio = 1, initialNAV = 10 }) {
  const premiumMonths = buildPremiumMonths(paymentMode, months);
  const allocation    = Object.fromEntries(fundOrder.map(f => [f, 1 / fundOrder.length]));
  const initialNav    = Object.fromEntries(fundOrder.map(f => [f, initialNAV]));

  return Array.from({ length: N }, () =>
    runScenario({
      fundStats, fundOrder, choleskyL,
      allocation, months, premium, premiumMonths,
      rebalanceMode: 'none', initialNav, feeParams: {},
    }).values
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1 — Zero return, zero volatility
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 1: zero return, zero volatility (single fund)');
{
  const FUND    = 'A';
  const premium = 5000;
  const months  = 12;

  //  mean = 0, std = 0  →  choleskyL = [[0]]
  //  offerRatio = bidRatio = 1  →  no spread
  //  NAV stays constant at initialNAV throughout
  //
  //  Analytical result:
  //    Each month buys premium/NAV units.
  //    Final portfolio = total_units × NAV = premium × months = 60 000
  const fundStats = { [FUND]: { mean: 0, std: 0, offerRatio: 1, bidRatio: 1 } };
  const choleskyL = [[0]];

  const N = 200;
  const series = runN(N, {
    fundStats, fundOrder: [FUND], choleskyL, months, premium,
  });

  const finals = series.map(s => s[months - 1]);

  // All 200 scenarios must be exactly identical (shock = 0 × z = 0 always)
  allEqual('all scenarios identical when std=0', finals);

  // Final value equals total premiums paid (no growth, no spread)
  const expectedFinal = premium * months;  // 60 000
  near('final = total premiums (zero return)', finals[0], expectedFinal, 1e-9);

  // Every intermediate month value must also equal premiums-paid-so-far
  for (let t = 0; t < months; t++) {
    const expectedT = premium * (t + 1);
    near(`month ${t + 1} value = ${expectedT}`, series[0][t], expectedT, 1e-9);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2 — Zero volatility, positive return (deterministic compounding)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 2: zero volatility, positive return (single fund)');
{
  const FUND     = 'A';
  const mean     = 0.01;   // 1 % log-return per month
  const premium  = 5000;
  const months   = 12;
  const initNAV  = 10;

  //  std = 0  →  choleskyL = [[0]]  →  every scenario deterministic
  //
  //  Analytical derivation:
  //    NAV at end of month k  = initNAV × exp((k+1) × m)
  //    Units bought at month k = premium / NAV_k
  //    Final value (end of month T−1):
  //      = Σ_{k=0}^{T-1} [ premium / (initNAV × exp((k+1)m)) ] × initNAV × exp(Tm)
  //      = premium × Σ_{j=0}^{T-1} exp(j×m)          [j = T−k−1]
  //      = premium × (exp(T×m) − 1) / (exp(m) − 1)   [geometric series]
  const expectedFinal =
    premium * (Math.exp(months * mean) - 1) / (Math.exp(mean) - 1);

  const fundStats = { [FUND]: { mean, std: 0, offerRatio: 1, bidRatio: 1 } };
  const choleskyL = [[0]];

  const N = 100;
  const series = runN(N, {
    fundStats, fundOrder: [FUND], choleskyL, months, premium, initialNAV: initNAV,
  });

  const finals = series.map(s => s[months - 1]);

  allEqual('all scenarios identical when std=0 (positive mean)', finals);
  near('final matches closed-form formula', finals[0], expectedFinal, 1e-9);

  // Verify every intermediate month against the same closed-form
  for (let t = 0; t < months; t++) {
    const expectedT = premium * (Math.exp((t + 1) * mean) - 1) / (Math.exp(mean) - 1);
    near(`month ${t + 1} matches formula`, series[0][t], expectedT, 1e-9);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3 — Zero volatility, two-fund portfolio (correlated shocks collapse)
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 3: zero volatility, two-fund portfolio');
{
  const funds   = ['A', 'B'];
  const premium = 5000;
  const months  = 12;

  //  Both funds: mean=0, std=0  →  choleskyL = 2×2 zero matrix
  //  50/50 allocation, no spread
  //  Expected: same as single-fund zero-return → final = total premiums
  const fundStats = {
    A: { mean: 0, std: 0, offerRatio: 1, bidRatio: 1 },
    B: { mean: 0, std: 0, offerRatio: 1, bidRatio: 1 },
  };
  const choleskyL = [[0, 0], [0, 0]];

  const N = 100;
  const series = runN(N, {
    fundStats, fundOrder: funds, choleskyL, months, premium,
  });

  const finals = series.map(s => s[months - 1]);
  const expectedFinal = premium * months;  // 60 000

  allEqual('two-fund: all scenarios identical when std=0', finals);
  near('two-fund: final = total premiums', finals[0], expectedFinal, 1e-9);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — Cholesky decomposition correctness
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 4: Cholesky L × Lᵀ = Cov');
{
  // 3×3 covariance matrix with known structure:
  //   std = [0.04, 0.05, 0.02],  correlations = [[1, 0.6, 0.3],[0.6,1,0.1],[0.3,0.1,1]]
  const stds  = [0.04, 0.05, 0.02];
  const corrs = [[1.00, 0.60, 0.30],
                 [0.60, 1.00, 0.10],
                 [0.30, 0.10, 1.00]];
  const n = 3;
  const cov = corrs.map((row, i) =>
    row.map((r, j) => r * stds[i] * stds[j])
  );

  const L = cholesky(cov);

  // Compute L × Lᵀ and compare to original cov (max absolute error)
  let maxErr = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let llt = 0;
      for (let k = 0; k < n; k++) llt += L[i][k] * L[j][k];
      maxErr = Math.max(maxErr, Math.abs(llt - cov[i][j]));
    }
  }
  // cholesky() adds RIDGE=1e-10 to each diagonal before the sqrt for numerical
  // stability, so L×Lᵀ ≈ Cov + RIDGE×I  →  max reconstruction error ≈ 1e-10.
  near('L × Lᵀ reconstructs cov (max err)', maxErr, 0, 2e-10);

  // L must be lower-triangular (upper entries exactly zero)
  check('L is lower-triangular',
    L[0][1] === 0 && L[0][2] === 0 && L[1][2] === 0,
    `upper entries: L[0][1]=${L[0][1]}, L[0][2]=${L[0][2]}, L[1][2]=${L[1][2]}`);

  // Diagonal entries must be positive
  check('L diagonal entries positive',
    L[0][0] > 0 && L[1][1] > 0 && L[2][2] > 0,
    `diag: [${L[0][0].toFixed(6)}, ${L[1][1].toFixed(6)}, ${L[2][2].toFixed(6)}]`);

  // Known 2×2 analytical result:
  //   Cov = [[s₁², r·s₁·s₂], [r·s₁·s₂, s₂²]]
  //   L   = [[s₁, 0], [r·s₂, s₂·√(1−r²)]]
  const s1 = 0.04, s2 = 0.05, r = 0.60;
  const cov2 = [[s1*s1, r*s1*s2], [r*s1*s2, s2*s2]];
  const L2 = cholesky(cov2);
  // RIDGE shifts L[i][i] by ≈ RIDGE/(2·L[i][i]) ≈ 1e-10/(2·0.04) = 1.25e-9;
  // use 2e-9 tolerance to cover all diagonal elements in this matrix.
  near('2×2: L[0][0] = s₁',            L2[0][0], s1,                      2e-9);
  near('2×2: L[1][0] = r·s₂',          L2[1][0], r * s2,                  2e-9);
  near('2×2: L[1][1] = s₂·√(1−r²)',    L2[1][1], s2 * Math.sqrt(1 - r*r), 2e-9);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5 — calcIRR correctness
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 5: calcIRR');
{
  // ── 5a. Single-payment, 1 growth period ──────────────────────────────────
  // step=2 ≥ months=2 → only m=0 fires; exponent = months-m-1 = 1
  // FV = premium × (1+r)^1  →  r = finalValue/premium − 1
  // final=5500, premium=5000  →  r=0.1/mo, annual=(1.1)^12−1
  const irr5a = calcIRR(5000, 2, 2, 5500);
  near('1-period growth: r=10%/mo → ann IRR', irr5a, (Math.pow(1.1, 12) - 1) * 100, 1e-6);

  // ── 5b. Single-payment zero return ───────────────────────────────────────
  // FV = premium × (1+0)^1 = premium → r=0 → annual IRR = 0%
  const irr5b = calcIRR(5000, 2, 2, 5000);
  near('1-period growth: zero return → 0%', irr5b, 0, 1e-6);

  // ── 5c. 12-period at exactly r=1%/month (self-consistent with FV formula) ─
  // Construct FV using the corrected exponent (months − m − 1) so round-trip
  // is exact: premium at m=0 experiences 11 shocks before the final snapshot.
  const r_mo = 0.01;
  const T    = 12;
  let fvExact = 0;
  for (let k = 0; k < T; k++) fvExact += 5000 * Math.pow(1 + r_mo, T - k - 1);
  const irr5c = calcIRR(5000, 1, T, fvExact);
  near('12-period: round-trip r=1%/mo', irr5c, (Math.pow(1 + r_mo, 12) - 1) * 100, 1e-6);

  // ── 5d. Negative return → negative IRR ───────────────────────────────────
  // final < total_premiums  →  money lost  →  IRR < 0
  const irr5d = calcIRR(5000, 1, 12, 40000);  // paid 60 000, got back 40 000
  check('negative return → IRR < 0', irr5d < 0,
    `got IRR = ${irr5d?.toFixed(4)}`);

  // ── 5e. Quarterly payment mode ────────────────────────────────────────────
  // calcIRR works in months throughout; exponent = months − payment_month − 1.
  //   4 payments at months 0, 3, 6, 9  →  exponents 11, 8, 5, 2
  const r_mo_q = 0.005;   // 0.5 % per month  (explicit, not per-quarter)
  const step_q = 3, T_q = 12;
  let fvQ = 0;
  for (let k = 0; k < T_q; k += step_q) fvQ += 5000 * Math.pow(1 + r_mo_q, T_q - k - 1);
  const ann_q = (Math.pow(1 + r_mo_q, 12) - 1) * 100;   // ≈ 6.168 %
  const irr5e = calcIRR(5000, step_q, T_q, fvQ);
  near('quarterly: round-trip r=0.5%/mo', irr5e, ann_q, 1e-6);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 6 — Empirical correlation from simulated multi-asset returns
//
// Approach:
//   1. Define a known 3-asset covariance matrix (stds + correlations).
//   2. Cholesky-decompose it to get L  (via the function under test).
//   3. Generate N correlated samples  w = L · z,  z ~ N(0, I).
//   4. Compute the empirical correlation matrix from those samples.
//   5. Assert every element is within ±0.05 of the input correlation.
//
// A seeded PRNG (mulberry32) makes the test fully deterministic — same
// result on every run, no matter what Math.random() produces.
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 6: Empirical correlation from simulated multi-asset returns');
{
  // ── Inputs ──────────────────────────────────────────────────────────────────
  const N    = 100_000;   // samples — SE(r) ≈ (1-r²)/√N ≈ 0.003 for r=0 → ±0.05 is ~17 σ
  const stds = [0.04, 0.05, 0.03];
  const targetCorr = [
    [1.00, 0.60, 0.30],
    [0.60, 1.00, 0.20],
    [0.30, 0.20, 1.00],
  ];
  const n = stds.length;

  // Build covariance matrix  Σ[i][j] = corr[i][j] × std[i] × std[j]
  const covInput = targetCorr.map((row, i) =>
    row.map((r, j) => r * stds[i] * stds[j])
  );

  // Cholesky: L × Lᵀ = Σ
  const L = cholesky(covInput);

  // ── Generate N correlated samples  w = L · z ────────────────────────────────
  const rng = makePRNG(0xC0FFEE42);
  const samples = Array.from({ length: N }, () => {
    const z = Array.from({ length: n }, () => normalFrom(rng));
    // w[i] = Σ_{k=0}^{i} L[i][k] · z[k]   (lower-triangular matrix-vector product)
    return Array.from({ length: n }, (_, i) => {
      let s = 0;
      for (let k = 0; k <= i; k++) s += L[i][k] * z[k];
      return s;
    });
  });

  // ── Empirical statistics ─────────────────────────────────────────────────────
  // Means
  const empMeans = Array.from({ length: n }, (_, i) =>
    samples.reduce((s, w) => s + w[i], 0) / N
  );

  // Sample covariance matrix  (divides by N−1)
  const empCov = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      samples.reduce((s, w) =>
        s + (w[i] - empMeans[i]) * (w[j] - empMeans[j]), 0
      ) / (N - 1)
    )
  );

  // Stds and correlation matrix
  const empStds = Array.from({ length: n }, (_, i) => Math.sqrt(empCov[i][i]));
  const empCorr = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) =>
      empCov[i][j] / (empStds[i] * empStds[j])
    )
  );

  // ── Print side-by-side comparison ───────────────────────────────────────────
  const labels = ['A (σ=0.04)', 'B (σ=0.05)', 'C (σ=0.03)'];
  console.log(`\n  N = ${N.toLocaleString()} samples | empirical vs target | tolerance ±0.05\n`);

  // Header
  const pad = (s, w) => String(s).padStart(w);
  console.log('  ' + ''.padEnd(12) +
    labels.map(l => pad(l, 18)).join(''));

  for (let i = 0; i < n; i++) {
    const cells = Array.from({ length: n }, (_, j) => {
      const emp = empCorr[i][j].toFixed(4);
      const tgt = targetCorr[i][j].toFixed(2);
      const err = Math.abs(empCorr[i][j] - targetCorr[i][j]);
      const mark = err > 0.05 ? ' !' : '  ';
      return pad(`${emp}/${tgt}${mark}`, 18);
    });
    console.log('  ' + labels[i].padEnd(12) + cells.join(''));
  }

  // Std row
  const stdCells = stds.map((s, i) => {
    const e = empStds[i].toFixed(5);
    const relErr = Math.abs(empStds[i] - s) / s;
    const mark = relErr > 0.02 ? ' !' : '  ';
    return pad(`${e}${mark}`, 18);
  });
  console.log('\n  ' + 'emp std:'.padEnd(12) + stdCells.join(''));
  console.log('  ' + 'tgt std:'.padEnd(12) + stds.map(s => pad(s.toFixed(5), 18)).join(''));
  console.log('');

  // ── Assertions ───────────────────────────────────────────────────────────────

  // 1. Diagonal must be 1.0 (self-correlation is definitionally 1)
  for (let i = 0; i < n; i++) {
    near(`corr[${i}][${i}] = 1 (self-correlation)`,
      empCorr[i][i], 1, 1e-3);
  }

  // 2. Every off-diagonal element within ±0.05 of target
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const err = Math.abs(empCorr[i][j] - targetCorr[i][j]);
      check(
        `corr[${i}][${j}] within ±0.05  (target ${targetCorr[i][j].toFixed(2)},` +
          `  empirical ${empCorr[i][j].toFixed(4)})`,
        err <= 0.05,
        `|${empCorr[i][j].toFixed(4)} - ${targetCorr[i][j].toFixed(2)}| = ${err.toFixed(4)}`
      );
    }
  }

  // 3. Matrix must be symmetric:  corr[i][j] === corr[j][i]
  //    (true by construction; checks no indexing mistake in empCorr)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      near(`corr[${i}][${j}] = corr[${j}][${i}] (symmetry)`,
        empCorr[i][j], empCorr[j][i], 1e-12);
    }
  }

  // 4. Empirical stds within ±2% of target  (N=100 k makes this tight but safe)
  for (let i = 0; i < n; i++) {
    const relErr = Math.abs(empStds[i] - stds[i]) / stds[i];
    check(
      `std[${i}] within ±2%  (target ${stds[i]},  empirical ${empStds[i].toFixed(5)})`,
      relErr <= 0.02,
      `relErr = ${(relErr * 100).toFixed(3)}%`
    );
  }

  // 5. Single max-error summary (fails if ANY element is out of tolerance)
  let maxErr = 0, worstCell = '';
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const e = Math.abs(empCorr[i][j] - targetCorr[i][j]);
      if (e > maxErr) { maxErr = e; worstCell = `[${i}][${j}]`; }
    }
  }
  check(
    `max |empCorr − targetCorr| ≤ 0.05  ` +
      `(worst: ${worstCell} = ${maxErr.toFixed(4)})`,
    maxErr <= 0.05,
    `max err ${maxErr.toFixed(4)} > 0.05`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 7 — Simulated mean ≈ input mean, simulated std ≈ input std
//
// Part A (end-to-end via runScenario):
//   2-month trick: premiumMonths={0}, offerRatio=bidRatio=1
//   Month 0: buy units at NAV₁ = init×exp(μ+w₀)  →  value[0] = premium (const)
//   Month 1: no premium, NAV₂ = NAV₁×exp(μ+w₁)  →  value[1] = premium×exp(μ+w₁)
//   Therefore log(value[1]/premium) = μ+w₁ ~ N(μ, σ²) exactly
//   Run 100k scenarios; assert empirical mean within ±0.003 and std within ±0.005.
//
// Part B (multi-fund correlated shocks, seeded PRNG):
//   Directly generate samples using makePRNG+Cholesky (same maths runScenario uses).
//   Assert per-fund empirical mean and std match their inputs.
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 7: Simulated mean ≈ input mean, simulated std ≈ input std');
{
  // ── Part A: end-to-end through runScenario ───────────────────────────────────
  console.log('\n  Part A — single-fund end-to-end (runScenario, N=100k)');

  const N_A       = 100_000;
  const premium_A = 5_000;
  const initNAV_A = 10;
  const pmSet     = new Set([0]);   // premium only at month 0

  const cfgsA = [
    { name: 'equity  (μ=0.006, σ=0.040)', mean:  0.006, std: 0.040 },
    { name: 'bond    (μ=0.002, σ=0.010)', mean:  0.002, std: 0.010 },
    { name: 'inverse (μ=-0.003, σ=0.050)', mean: -0.003, std: 0.050 },
  ];

  for (const cfg of cfgsA) {
    const fundStats = { F: { mean: cfg.mean, std: cfg.std, offerRatio: 1, bidRatio: 1 } };
    const choleskyL = [[cfg.std]];   // 1×1 Cholesky: L[0][0] = σ

    // Collect log(value[1] / premium) over N_A scenarios
    let sumLR = 0, sumSq = 0;
    for (let i = 0; i < N_A; i++) {
      const { values: s } = runScenario({
        fundStats, fundOrder: ['F'], choleskyL,
        allocation: { F: 1 }, months: 2,
        premium: premium_A, premiumMonths: pmSet,
        rebalanceMode: 'none',
        initialNav: { F: initNAV_A },
        feeParams: {},
      });
      const lr = Math.log(s[1] / premium_A);
      sumLR += lr;
      sumSq += lr * lr;
    }
    const empMean = sumLR / N_A;
    const empStd  = Math.sqrt((sumSq - sumLR * sumLR / N_A) / (N_A - 1));

    near(`${cfg.name}: mean ≈ input μ  (±0.003)`, empMean, cfg.mean, 0.003);
    near(`${cfg.name}: std  ≈ input σ  (±0.005)`, empStd,  cfg.std,  0.005);
  }

  // ── Part B: multi-fund correlated shocks (seeded PRNG) ──────────────────────
  // Generate N samples of  (μᵢ + wᵢ)  where w = L·z, z ~ N(0,I), using a
  // seeded PRNG so the test is deterministic.  This exercises the same
  // Cholesky-multiplication logic that runScenario runs each month.
  console.log('\n  Part B — multi-fund correlated (seeded PRNG, N=100k)');

  const N_B     = 100_000;
  const means_B = [0.008, 0.002, -0.001];
  const stds_B  = [0.040, 0.015,  0.060];
  const corr_B  = [
    [1.0, 0.5, 0.3],
    [0.5, 1.0, 0.1],
    [0.3, 0.1, 1.0],
  ];
  const cov_B = corr_B.map((row, i) => row.map((c, j) => c * stds_B[i] * stds_B[j]));
  const L_B   = cholesky(cov_B);
  const rng_B = makePRNG(0xBEEFF00D);

  // Accumulate streaming stats (no large array allocation needed)
  const empSum   = [0, 0, 0];
  const empSumSq = [0, 0, 0];
  for (let n = 0; n < N_B; n++) {
    const z = [normalFrom(rng_B), normalFrom(rng_B), normalFrom(rng_B)];
    for (let i = 0; i < 3; i++) {
      let w = 0;
      for (let k = 0; k <= i; k++) w += L_B[i][k] * z[k];
      const v = means_B[i] + w;
      empSum[i]   += v;
      empSumSq[i] += v * v;
    }
  }
  const empMeans_B = empSum.map(s => s / N_B);
  const empStds_B  = empSum.map((s, i) =>
    Math.sqrt((empSumSq[i] - s * s / N_B) / (N_B - 1))
  );

  const fundLabels_B = ['equity (σ=0.040)', 'bond   (σ=0.015)', 'alt    (σ=0.060)'];

  // Print comparison table
  const fw = n => String(n.toFixed(5)).padStart(10);
  console.log('\n  Fund                target μ    emp μ   target σ    emp σ');
  console.log('  ──────────────────────────────────────────────────────────');
  for (let i = 0; i < 3; i++) {
    console.log(
      `  ${fundLabels_B[i].padEnd(18)}` +
      fw(means_B[i]) + fw(empMeans_B[i]) +
      fw(stds_B[i])  + fw(empStds_B[i])
    );
  }
  console.log('');

  for (let i = 0; i < 3; i++) {
    near(`${fundLabels_B[i]}: mean ≈ input μ  (±0.003)`, empMeans_B[i], means_B[i], 0.003);
    near(`${fundLabels_B[i]}: std  ≈ input σ  (±0.005)`, empStds_B[i],  stds_B[i],  0.005);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 8 — μ_GBM=0, σ>0: median portfolio return is negative (volatility drag)
//
// μ here is the GBM arithmetic drift:  dS/S = μ dt + σ dW.
//
//   μ_GBM = 0  →  E[NAV_t / NAV_0] = 1  ("fair game", zero expected return)
//
// By Itô's lemma, zero arithmetic drift maps to log-return mean = −σ²/2:
//
//   fundStats.mean = −σ²/2   (the parameter our simulation engine takes)
//
// Consequences:
//   - Median NAV_t  = NAV_0 · exp(−σ²t/2) < NAV_0   (drifts downward in median)
//   - Arithmetic mean NAV_t = NAV_0   (preserved by construction)
//   - DCA final-value distribution: right-skewed, mean ≈ total paid, median < mean
//   → P50 portfolio value < total premiums paid  →  median return < 0
//
// NB: if we used log-mean = 0 instead (μ_GBM = +σ²/2 > 0), the arithmetic drift
// is positive and P50 ends up *above* total paid — NOT what this test verifies.
//
// Higher σ → larger Itô correction → more negative median return.
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 8: μ_GBM=0, σ>0 → median portfolio return is negative (volatility drag)');
console.log('  fundStats.mean = −σ²/2  (Itô-corrected zero-arithmetic-drift log-mean)');
{
  const premium   = 5_000;
  const months    = 36;
  const N         = 20_000;
  const totalPaid = premium * months;   // 180 000 THB
  const pmMonths  = buildPremiumMonths('monthly', months);

  const sigmas = [0.02, 0.04, 0.06];

  for (const sigma of sigmas) {
    const logMean   = -sigma * sigma / 2;   // Itô: zero arithmetic drift
    const fundStats = { F: { mean: logMean, std: sigma, offerRatio: 1, bidRatio: 1 } };
    const choleskyL = [[sigma]];

    const finals = Array.from({ length: N }, () => {
      const { values: s } = runScenario({
        fundStats, fundOrder: ['F'], choleskyL,
        allocation: { F: 1 }, months,
        premium, premiumMonths: pmMonths,
        rebalanceMode: 'none',
        initialNav: { F: 10 },
        feeParams: {},
      });
      return s[months - 1];
    });

    finals.sort((a, b) => a - b);
    const p50       = finals[Math.floor(N / 2)];
    const medRet    = (p50 / totalPaid - 1) * 100;
    const arithMean = finals.reduce((a, b) => a + b, 0) / N;
    const arithRet  = (arithMean / totalPaid - 1) * 100;

    console.log(
      `  σ=${String(sigma).padEnd(4)}  logMean=${logMean.toFixed(5).padStart(8)}` +
      `  P50=${p50.toFixed(0).padStart(7)}  medRet=${medRet.toFixed(2).padStart(6)}%` +
      `  arithMeanRet=${arithRet.toFixed(2).padStart(6)}%`
    );

    check(
      `σ=${sigma}: P50 < total paid → median return < 0  (logMean=−σ²/2=${logMean.toFixed(5)})`,
      p50 < totalPaid,
      `P50 ${p50.toFixed(2)} ≥ total paid ${totalPaid}; medRet=${medRet.toFixed(3)}%`
    );

    // Arithmetic mean ≈ total paid (zero GBM drift → E[FV] ≈ total paid).
    // Allow ±1.5% for Monte Carlo noise at N=20 000.
    const arithRelErr = Math.abs(arithMean - totalPaid) / totalPaid;
    check(
      `σ=${sigma}: arithmetic mean ≈ total paid (±1.5%)  (arithRet=${arithRet.toFixed(2)}%)`,
      arithRelErr <= 0.015,
      `arithMean=${arithMean.toFixed(0)}, totalPaid=${totalPaid}, relErr=${(arithRelErr*100).toFixed(2)}%`
    );

    check(
      `σ=${sigma}: arithmetic mean > P50 (right-skewed distribution)`,
      arithMean > p50,
      `mean ${arithMean.toFixed(2)} ≤ P50 ${p50.toFixed(2)}`
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 9 — Phase 2b: admin fee deduction, lapse detection, survival curve
// ═══════════════════════════════════════════════════════════════════════════════
console.log('\nSuite 9: Phase 2b admin fee + lapse + survival');

// Pull applyFees out of the VM context (fees.js is loaded into simCtx)
const { applyFees } = simCtx;

// 9.1 — applyFees deterministic admin fee + pro-rata
{
  const portfolio = { A: 100, B: 200, C: 300 };
  const bidPrices = { A: 10, B: 5, C: 2 };
  // AUM = 100*10 + 200*5 + 300*2 = 1000+1000+600 = 2600
  // adminFee at 1% = 26
  const before = { ...portfolio };
  const aumBefore = 2600;
  const ratioBefore = { A: 1000/2600, B: 1000/2600, C: 600/2600 };

  const result = applyFees(portfolio, bidPrices, { adminFeeRate: 0.01 }, 0);

  near('9.1 admin fee = AUM × rate', result.adminFee, 26, 1e-9);
  check('9.1 not lapsed (fee << AUM)', result.lapsed === false, `lapsed=${result.lapsed}`);

  // Pro-rata invariant — each fund's value-share must be unchanged
  const aumAfter = portfolio.A * 10 + portfolio.B * 5 + portfolio.C * 2;
  near('9.1 post-fee AUM = pre × (1 - rate)', aumAfter, 2600 * 0.99, 1e-9);
  for (const f of ['A', 'B', 'C']) {
    const newRatio = (portfolio[f] * bidPrices[f]) / aumAfter;
    near(`9.1 pro-rata: ${f} value-share preserved`, newRatio, ratioBefore[f], 1e-12);
    near(`9.1 pro-rata: ${f} units = before × (1 - rate)`, portfolio[f], before[f] * 0.99, 1e-9);
  }
}

// 9.2 — applyFees with adminFeeRate = 0 → no mutation, no fee, no lapse
{
  const portfolio = { A: 100, B: 200 };
  const bidPrices = { A: 10, B: 5 };
  const result = applyFees(portfolio, bidPrices, { adminFeeRate: 0 }, 5);
  near('9.2 zero rate → adminFee = 0', result.adminFee, 0, 1e-12);
  check('9.2 zero rate → not lapsed', result.lapsed === false, '');
  check('9.2 zero rate → portfolio unchanged', portfolio.A === 100 && portfolio.B === 200, '');
}

// 9.3 — applyFees with empty/zero AUM → lapsed
{
  const portfolio = { A: 0, B: 0 };
  const bidPrices = { A: 10, B: 5 };
  const result = applyFees(portfolio, bidPrices, { adminFeeRate: 0.01 }, 0);
  check('9.3 zero AUM → lapsed = true', result.lapsed === true, '');
}

// 9.4 — applyFees with fee > AUM → lapsed and portfolio zeroed
{
  const portfolio = { A: 1, B: 1 };
  const bidPrices = { A: 1, B: 1 };
  // AUM = 2, rate = 200% → fee = 4 > AUM
  const result = applyFees(portfolio, bidPrices, { adminFeeRate: 2 }, 0);
  check('9.4 fee ≥ AUM → lapsed = true', result.lapsed === true, '');
  check('9.4 fee ≥ AUM → portfolio zeroed', portfolio.A === 0 && portfolio.B === 0, '');
}

// 9.5 — runScenario: lapseRate = 0 when adminFeeRate = 0
{
  const fundStats = { F: { mean: 0, std: 0.04, offerRatio: 1, bidRatio: 1 } };
  const choleskyL = [[0.04]];
  let lapseCount = 0;
  for (let i = 0; i < 200; i++) {
    const { lapseMonth } = runScenario({
      fundStats, fundOrder: ['F'], choleskyL,
      allocation: { F: 1 }, months: 60,
      premium: 5000, premiumMonths: buildPremiumMonths('monthly', 60),
      rebalanceMode: 'none', initialNav: { F: 10 },
      feeParams: { adminFeeRate: 0 },
      rng: makePRNG(0xCAFE + i),
    });
    if (lapseMonth !== null) lapseCount++;
  }
  check('9.5 adminFeeRate=0 → no scenarios lapse', lapseCount === 0, `lapseCount=${lapseCount}`);
}

// 9.6 — runScenario: fee ≥ AUM triggers lapse at exact month
//   With rate=2.0 and AUM=100 after month 0 premium, fee=200 ≥ AUM → lapses
//   immediately at month 0. Tests the lapse mechanism end-to-end.
//   (Realistic Phase 2b admin fee = 0.0583%/mo never lapses; Phase 2c COI
//   adds a fixed-THB component that can drive AUM negative.)
{
  const fundStats = { F: { mean: 0, std: 0, offerRatio: 1, bidRatio: 1 } };
  const { values, lapseMonth } = runScenario({
    fundStats, fundOrder: ['F'], choleskyL: [[0]],
    allocation: { F: 1 }, months: 12,
    premium: 100, premiumMonths: new Set([0]),
    rebalanceMode: 'none', initialNav: { F: 10 },
    feeParams: { adminFeeRate: 2.0 },
  });
  check('9.6 fee ≥ AUM → lapses at month 0', lapseMonth === 0, `lapseMonth=${lapseMonth}`);
  let allZero = true;
  for (let m = 0; m < 12; m++) if (values[m] !== 0) allZero = false;
  check('9.6 post-lapse values are all 0', allZero, '');
}

// 9.7 — runScenario: ongoing premium does NOT reverse lapse
//   Even though premiumMonths fires every month, once lapsed the early
//   `if (lapseMonth !== null) continue` skips premium handling forever.
{
  const fundStats = { F: { mean: 0, std: 0, offerRatio: 1, bidRatio: 1 } };
  const { values, lapseMonth } = runScenario({
    fundStats, fundOrder: ['F'], choleskyL: [[0]],
    allocation: { F: 1 }, months: 24,
    premium: 100, premiumMonths: buildPremiumMonths('monthly', 24),
    rebalanceMode: 'none', initialNav: { F: 10 },
    feeParams: { adminFeeRate: 2.0 },
  });
  check('9.7 lapses despite ongoing premium', lapseMonth !== null, '');
  let allZeroAfter = true;
  for (let m = lapseMonth; m < 24; m++) if (values[m] !== 0) allZeroAfter = false;
  check('9.7 values stay 0 post-lapse despite scheduled premiums', allZeroAfter, '');
}

// 9.9 — totalAdminFee closed-form: lump-sum AUM × rate × months (std=0, no premium drift)
//   With initial portfolio X units at NAV=10 (AUM=10X), no premium, rate=r:
//     month 0: pre-fee AUM = 10X, fee = 10X·r,  post AUM = 10X(1-r)
//     month 1: pre-fee AUM = 10X(1-r), fee = 10X(1-r)·r,  post = 10X(1-r)²
//     ...
//     totalAdminFee = 10X · r · (1 + (1-r) + (1-r)² + ... + (1-r)^(M-1))
//                   = 10X · (1 - (1-r)^M)
{
  const fundStats = { F: { mean: 0, std: 0, offerRatio: 1, bidRatio: 1 } };
  const rate = 0.01;     // 1%/mo
  const months = 24;
  const initialAum = 10000;   // premium 10000 at month 0 → 1000 units at NAV=10

  const { totalAdminFee, lapseMonth } = runScenario({
    fundStats, fundOrder: ['F'], choleskyL: [[0]],
    allocation: { F: 1 }, months,
    premium: initialAum, premiumMonths: new Set([0]),
    rebalanceMode: 'none', initialNav: { F: 10 },
    feeParams: { adminFeeRate: rate },
  });
  const expected = initialAum * (1 - Math.pow(1 - rate, months));
  near('9.9 totalAdminFee = AUM·(1-(1-r)^M) (lump-sum, no growth)',
    totalAdminFee, expected, 1e-6);
  check('9.9 no lapse (rate << 1)', lapseMonth === null, '');
}

// 9.10 — totalAdminFee = 0 when adminFeeRate = 0
{
  const fundStats = { F: { mean: 0, std: 0.04, offerRatio: 1, bidRatio: 1 } };
  const { totalAdminFee } = runScenario({
    fundStats, fundOrder: ['F'], choleskyL: [[0.04]],
    allocation: { F: 1 }, months: 12,
    premium: 1000, premiumMonths: buildPremiumMonths('monthly', 12),
    rebalanceMode: 'none', initialNav: { F: 10 },
    feeParams: { adminFeeRate: 0 },
    rng: makePRNG(0xFEE),
  });
  near('9.10 zero rate → totalAdminFee = 0', totalAdminFee, 0, 1e-12);
}

// 9.8 — runMonteCarlo: survival curve monotonic decreasing (async)
//   Pulled into the async report tail below since runMonteCarlo is a Promise.
async function suite9_8() {
  // Synthetic NAV data so runMonteCarlo can compute fundStats
  const navData = { F: [] };
  let d = new Date(2020, 0, 1);
  for (let i = 0; i < 60; i++) {
    navData.F.push({ date: new Date(d), nav: 10, offer: 10, bid: 10 });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }

  // Pull runMonteCarlo from VM context
  const { runMonteCarlo } = simCtx;

  const result = await runMonteCarlo({
    navData, allocation: { F: 100 }, premium: 100,
    paymentMode: 'monthly', months: 60,
    rebalanceMode: 'none', N: 100,
    feeParams: { adminFeeRate: 0.05 },
    seed: 0x900D,
    userAge: 30,
  });

  check('9.8 survivalMonthly length = months',
    result.survivalMonthly.length === 60, `len=${result.survivalMonthly.length}`);
  let monotonic = true;
  for (let m = 1; m < 60; m++) {
    if (result.survivalMonthly[m] > result.survivalMonthly[m - 1]) { monotonic = false; break; }
  }
  check('9.8 survivalMonthly is non-increasing', monotonic, '');
  check('9.8 survivalYearly[0] = 1', result.survivalYearly[0] === 1, '');
  check('9.8 survivalYearly length = years + 1',
    result.survivalYearly.length === 6, `len=${result.survivalYearly.length}`);
  check('9.8 avgLapseAge ≥ userAge when lapses occur',
    result.avgLapseAge === null || result.avgLapseAge >= 30, `age=${result.avgLapseAge}`);
  check('9.8 p50AdminFee > 0 when adminFeeRate > 0 and P50 in-force',
    result.p50AdminFee > 0, `p50AdminFee=${result.p50AdminFee}`);
}

// ─── Report ───────────────────────────────────────────────────────────────────

suite9_8().then(() => {
console.log('');
if (failed === 0) {
  console.log(`All ${passed} tests passed.`);
  process.exit(0);
} else {
  console.error(`${failed} test(s) FAILED out of ${passed + failed}:`);
  failures.forEach(m => console.error(m));
  process.exit(1);
}
});
