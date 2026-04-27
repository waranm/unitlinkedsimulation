# Phase 2c.1: Premium Charge + COI (v1 — decisions locked)

**Phase 2c is split into 2 sub-phases for context budget safety.**
This is **Phase 2c.1** — the heavier "fee math" half. Phase 2c.2 (loyalty bonus + anchor scenarios) follows after.

**Prerequisite:** Phase 2b merged in `worktree-phase2b` branch (commit `d34a87b`)
- `applyFees(portfolio, bidPrices, feeParams, month) → { adminFee, lapsed }` working
- 107/107 tests passing

**Reference:**
- `prompts/prompt-phase2c-v1.md` — full Phase 2c decision doc (all 25 decisions locked there)
- `prompts/phase2-architecture-spec-v3.md` — Phase 2c+2d roadmap
- `prompts/prompt-phase2b-v1.md` — Phase 2b D1-D6 loop order

---

## Goal

Implement the **two largest fee components** of Phase 2c:
1. **Premium Charge** — deducts from premium BEFORE buying units
2. **COI** — Cost of Insurance, monthly TMO2560 deduction from AUM

Plus partial yearly tracking infrastructure (4 of 5 metrics; loyalty added in 2c.2).

After Phase 2c.1:
- INVESTMENT-ONLY: unchanged (rates = 0/none)
- UL-99-99 / UL-10-99: P50 lower than Phase 2b due to PC + COI; matches insurer illustration much closer
- Yearly arrays exist in runMonteCarlo output (consumed by Phase 2c.2 + Phase 2d)

After Phase 2c.2 (next):
- Loyalty bonus credits at scheduled milestones
- Anchor scenarios (P25/P50/P75 by final value) returned for Phase 2d table

---

## 🔒 Decisions for Phase 2c.1 (locked — copied from `prompt-phase2c-v1.md`)

### Group A — Premium Charge (full scope of A goes here)

#### A1: หักเฉพาะ RPP (Phase 2c) ✅
RSP / Top Up เป็น Phase 3+

#### A2: Policy year basis = payment count ✅
- Monthly mode: paymentCount 1-12 = ปีที่ 1, 13-24 = ปีที่ 2, ...
- Annual mode: paymentCount 1 = ปีที่ 1, 2 = ปีที่ 2, ...
- `policyYear = Math.ceil(paymentCount / paymentsPerYear)`

#### A3: Rate schedule = `product.premiumCharge.rates` ✅
มีอยู่แล้วใน UL-99-99 / UL-10-99 product config:
```js
premiumCharge: { type: "year-based", rates: { 1: 0.55, 2: 0.40, 3: 0.20, 4: 0.10, 5: 0.05 } }
```
ปีนอก schedule → rate = 0

#### A4: Timing = ก่อน buy at offer ✅
```
gross premium → applyPremiumCharge → netPremium → buy units at OFFER
```

#### A5: Hybrid tracking ✅
- `monthlyYear1PremiumCharge[0..11]` (year 1 only)
- `yearlyPremiumCharge[0..years-1]` (every year)

#### A6: Function signature ✅
```js
function applyPremiumCharge(premium, feeParams, paymentCount) {
  const policyYear = Math.ceil(paymentCount / feeParams.paymentsPerYear);
  const rate = feeParams.premiumChargeRates[policyYear] ?? 0;
  const charge = premium * rate;
  return { netPremium: premium - charge, charge };
}
```

### Group B — COI (full scope of B goes here)

#### B1: basis `'sa'` หรือ `'nar'` ✅
- `'sa'` (UL-99-99, UL-10-99): COI base = SA  (death benefit = SA + AUM)
- `'nar'` (future products): COI base = `max(0, SA - AUM)`  (death benefit = max(SA, AUM))

**❗ Current product configs have `coi.basis: "nar"` — this is WRONG.** Phase 2c.1 must change to `"sa"` for both UL products.

#### B2: TMO2560 source ใน `js/products/index.js` ✅
- `COI_TABLES["thai-mortality-2560-ordinary"]` (male + female, ages 0-99)
- Helpers: `getMonthlyCOIRate(product, age, gender)`, `annualToMonthlyQx`, `getAnnualQx`
- Exposed via `window.ProductLib`
- DO NOT parse `docs/thai-mortality-2560-custom.xlsx` in this sub-phase

#### B3: Geometric monthly conversion ✅
Use existing `annualToMonthlyQx()`. Formula: `monthlyQx = 1 - (1 - annualQx)^(1/12)`

#### B4: Loading factor = `product.coi.loadingFactor` ✅ (default 1.0)

#### B5: Age range 0-99 covered; age 99 = qx 1000 (terminal) ✅

#### B6: NAR clip = `max(0, SA - AUM)` ✅
ถ้า AUM > SA → NAR = 0 → COI = 0 (NAR mode only)

#### B7: applyFees signature เปลี่ยน ✅
```js
applyFees(portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender)
  → { adminFee, coi, lapsed }
```
Phase 2c.1 ขยาย signature — เพิ่ม `sumAssured`, `currentAge`, `gender` args; return เพิ่ม `coi` field

#### B8: Integer age, advance on policy anniversary ✅
```js
const policyYearIdx = Math.floor(month / 12);
const currentAge = userAge + policyYearIdx;     // step every 12 months
```

### Group D (partial — 4 of 5 metrics for 2c.1; loyalty added in 2c.2)

#### D1: Hybrid granularity ✅
Year 1: monthly[0..11]; Year 2+: yearly only

#### D2 (partial for 2c.1): 4 metrics tracked ✅
- `monthlyYear1AdminFee[12]` + `yearlyAdminFee[Y]`
- `monthlyYear1COI[12]` + `yearlyCOI[Y]`
- `monthlyYear1PremiumCharge[12]` + `yearlyPremiumCharge[Y]`
- `monthlyYear1PremiumPaid[12]` + `yearlyPremiumPaid[Y]`

(5th metric `loyaltyBonus` deferred to 2c.2)

#### D4: Yearly array length ✅
`yearsLen = Math.ceil(months / 12)`

### Group E (partial)

#### E1 (partial): 2 functions added/extended ✅
```js
applyPremiumCharge(premium, feeParams, paymentCount) → { netPremium, charge }    // NEW
applyFees(portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender)  // EXTENDED
  → { adminFee, coi, lapsed }
```
(`applyLoyaltyBonus` + `expandLoyaltySchedule` are 2c.2)

#### E2 (partial): feeParams shape ✅
```js
feeParams: {
  // Phase 2b
  adminFeeRate: number,

  // Phase 2c.1 — premium charge
  premiumChargeRates: { [year]: number },
  paymentsPerYear: number,

  // Phase 2c.1 — COI
  coiTableId: 'thai-mortality-2560-ordinary' | 'none',
  coiBasis: 'sa' | 'nar',
  coiLoading: number,

  // Phase 2c.1 — context
  sumAssured: number,
  userAge: number,
  gender: 'male' | 'female',
}
```
(loyalty fields added in 2c.2)

#### E3 (partial loop order — without bonus step):
```
1. Premium → Premium Charge → buy at offer (netPremium)
2. Snapshot bidPrices
3. applyFees (admin + COI) → lapse?
4. Rebalance
5. Record value
6. Market shock
```
(2c.2 inserts bonus step between premium and snapshot)

---

## Scope (Phase 2c.1 only)

### 1. แก้ `js/fees.js`

**Add at top (global function):**
```js
function applyPremiumCharge(premium, feeParams, paymentCount) {
  const policyYear = Math.ceil(paymentCount / (feeParams.paymentsPerYear || 12));
  const rate = (feeParams.premiumChargeRates || {})[policyYear] ?? 0;
  const charge = premium * rate;
  return { netPremium: premium - charge, charge };
}
```

**Modify `applyFees` (signature change + COI):**
```js
function applyFees(portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender) {
  const funds = Object.keys(portfolio);

  // 1. AUM snapshot at bid
  let aum = 0;
  for (const f of funds) aum += portfolio[f] * (bidPrices[f] || 0);
  if (aum <= 0) return { adminFee: 0, coi: 0, lapsed: true };

  // 2. Admin fee (Phase 2b unchanged)
  const adminFee = aum * (feeParams.adminFeeRate || 0);

  // 3. COI (NEW Phase 2c.1)
  let coi = 0;
  const tableId = feeParams.coiTableId;
  if (tableId && tableId !== 'none' && currentAge != null && gender) {
    const safeAge = Math.min(Math.max(currentAge, 0), 99);
    const monthlyQxPer1000 = (typeof window !== 'undefined' && window.ProductLib)
      ? window.ProductLib.getMonthlyCOIRate(
          { coi: { tableId, loadingFactor: feeParams.coiLoading ?? 1 } },
          safeAge, gender
        )
      // VM context (test runner): use globals declared in products/index.js
      : (typeof getMonthlyCOIRate === 'function'
          ? getMonthlyCOIRate(
              { coi: { tableId, loadingFactor: feeParams.coiLoading ?? 1 } },
              safeAge, gender
            )
          : null);

    if (monthlyQxPer1000 != null) {
      const coiBase = (feeParams.coiBasis === 'sa')
        ? (sumAssured || 0)
        : Math.max(0, (sumAssured || 0) - aum);
      coi = (coiBase / 1000) * monthlyQxPer1000;
    }
  }

  // 4. Total fee
  const totalFee = adminFee + coi;
  if (totalFee <= 0) return { adminFee, coi, lapsed: false };
  if (totalFee >= aum) {
    for (const f of funds) portfolio[f] = 0;
    return { adminFee, coi, lapsed: true };
  }

  // 5. Pro-rata deduct
  const ratio = totalFee / aum;
  for (const f of funds) portfolio[f] *= (1 - ratio);

  // 6. Recompute post-fee AUM for lapse decision
  let postAum = 0;
  for (const f of funds) postAum += portfolio[f] * (bidPrices[f] || 0);

  return { adminFee, coi, lapsed: postAum <= 0 };
}
```

**⚠️ Tests note:** the test runner loads fees.js into a VM context that does not have `window`. Make sure the COI lookup falls back to the in-context `getMonthlyCOIRate` global (or pass it via feeParams.lookupFn — see implementation note in "Tests" section).

### 2. แก้ `js/products/ul-99-99.js`

```diff
  coi: {
-   basis: "nar",
+   basis: "sa",
    tableId: "thai-mortality-2560-ordinary",
    loadingFactor: 1.0,
    conversionMethod: "constant-force"
  },
```

### 3. แก้ `js/products/ul-10-99.js`

```diff
  coi: {
-   basis: "nar",
+   basis: "sa",
    tableId: "thai-mortality-2560-ordinary",
    loadingFactor: 1.0,
    conversionMethod: "constant-force"
  },
```

### 4. แก้ `js/simulation.js`

#### 4.1 Loop changes ใน runScenario
```js
// Add tracking arrays + paymentCount before for-loop
const yearsLen = Math.ceil(months / 12);
let paymentCount = 0;
let lapseMonth = null;
let totalAdminFee = 0;
let totalCOI = 0;

const yearlyAdminFee      = new Array(yearsLen).fill(0);
const yearlyCOI           = new Array(yearsLen).fill(0);
const yearlyPremiumCharge = new Array(yearsLen).fill(0);
const yearlyPremiumPaid   = new Array(yearsLen).fill(0);
const monthlyYear1AdminFee      = new Array(12).fill(0);
const monthlyYear1COI           = new Array(12).fill(0);
const monthlyYear1PremiumCharge = new Array(12).fill(0);
const monthlyYear1PremiumPaid   = new Array(12).fill(0);

for (let m = 0; m < months; m++) {
  if (lapseMonth !== null) { values[m] = 0; continue; }
  const yearIdx = Math.floor(m / 12);

  // 1. Premium block (PC NEW)
  if (premiumMonths.has(m)) {
    paymentCount++;
    const { netPremium, charge } = applyPremiumCharge(premium, feeParams, paymentCount);

    yearlyPremiumPaid[yearIdx]   += premium;
    yearlyPremiumCharge[yearIdx] += charge;
    if (m < 12) {
      monthlyYear1PremiumPaid[m]   = premium;
      monthlyYear1PremiumCharge[m] = charge;
    }

    for (const f of funds) {
      const offerPrice = nav[f] * (fundStats[f]?.offerRatio ?? 1);
      portfolio[f] += (netPremium * (allocation[f] || 0)) / offerPrice;
    }
  }

  // 2. Snapshot bidPrices
  const bidPrices = {};
  for (const f of funds) bidPrices[f] = nav[f] * (fundStats[f]?.bidRatio ?? 1);

  // 3. applyFees (admin + COI NEW)
  const currentAge = (feeParams.userAge ?? 0) + Math.floor(m / 12);
  const { adminFee, coi, lapsed } = applyFees(
    portfolio, bidPrices,
    feeParams.sumAssured ?? 0,
    feeParams, m,
    currentAge,
    feeParams.gender ?? 'male'
  );
  totalAdminFee += adminFee;
  totalCOI += coi;
  yearlyAdminFee[yearIdx] += adminFee;
  yearlyCOI[yearIdx]      += coi;
  if (m < 12) {
    monthlyYear1AdminFee[m] = adminFee;
    monthlyYear1COI[m]      = coi;
  }
  if (lapsed) { lapseMonth = m; values[m] = 0; continue; }

  // 4. Rebalance (unchanged)
  // 5. Record value at BID (unchanged)
  // 6. Market shock (unchanged)
}

return {
  values, lapseMonth, totalAdminFee, totalCOI,
  yearlyAdminFee, yearlyCOI, yearlyPremiumCharge, yearlyPremiumPaid,
  monthlyYear1AdminFee, monthlyYear1COI, monthlyYear1PremiumCharge, monthlyYear1PremiumPaid,
};
```

#### 4.2 runMonteCarlo aggregation
- Collect new yearly + monthly Y1 arrays per scenario
- Aggregate `p50AdminFee` (Phase 2b) + new `p50COI`, `p50PremiumCharge` (using same anchor index = P50 by final value, in-force at end)
- Phase 2c.2 will add full `anchorScenarios.{p25,p50,p75}` — for 2c.1 just expose the P50 anchor's totals

```js
// After picking p50 anchor index (existing Phase 2b logic):
const p50Idx = ...;  // existing
const p50AdminFee = adminFees[p50Idx];
const p50COI = scenarioCOIs[p50Idx];
const p50PremiumCharge = scenarioPCs[p50Idx];

return {
  // ... existing ...
  p50AdminFee, p50COI, p50PremiumCharge,
};
```

### 5. แก้ `js/app.js`

#### 5.1 Construct feeParams ครบสำหรับ Phase 2c.1
```js
const _intervals = { monthly: 12, quarterly: 4, 'semi-annual': 2, annual: 1 };
const _ppyear = _intervals[state.paymentMode] ?? 12;

const baseConfig = {
  ...,
  feeParams: {
    adminFeeRate: _product?.adminFee?.rate || 0,
    premiumChargeRates: _product?.premiumCharge?.rates ?? {},
    paymentsPerYear: _ppyear,
    coiTableId: _product?.coi?.tableId ?? 'none',
    coiBasis: _product?.coi?.basis ?? 'sa',
    coiLoading: _product?.coi?.loadingFactor ?? 1,
    sumAssured: state.product.sumAssured,
    userAge: state.product.age,
    gender: state.product.gender,
  },
  userAge: state.product.age,
};
```

#### 5.2 Update fee summary banner (3 components)
```js
function renderFeeSummary() {
  const r = state.results;
  const totalFee = (r.p50AdminFee || 0) + (r.p50COI || 0) + (r.p50PremiumCharge || 0);
  if (totalFee <= 0) return '';

  const totalPaid = state.premium * paymentCount();
  const pct = totalPaid > 0 ? (totalFee / totalPaid * 100) : 0;

  return `
    <div class="planning-banner" style="background:#fef3c7;border-color:#f59e0b;margin-top:.5rem">
      <span class="planning-banner-icon">💰</span>
      <span>ค่าธรรมเนียมรวม (กรณี P50): <strong>${fmtTHB(totalFee)}</strong>
        (≈ ${pct.toFixed(1)}% ของเบี้ยที่ชำระทั้งหมด)
        <br><small>
          • Admin: ${fmtTHB(r.p50AdminFee || 0)}
          • COI: ${fmtTHB(r.p50COI || 0)}
          • Premium charge: ${fmtTHB(r.p50PremiumCharge || 0)}
        </small></span>
    </div>
  `;
}
```

### 6. Update `tools/test-simulation.js`

**Suite 10 — Premium Charge (4-6 tests):**
- 10.1 closed-form: rate × premium = charge for each policy year
- 10.2 schedule expiry: year 6+ → charge = 0 (rates only 1-5)
- 10.3 paymentCount → policyYear math: `ceil(13/12) = 2`
- 10.4 paymentMode invariance: monthly + quarterly + annual same totalPC for same first-year-premium analytical

**Suite 11 — COI (6-8 tests):**
- 11.1 SA basis closed-form: COI = (SA / 1000) × monthlyQx × loading
- 11.2 NAR basis with AUM < SA: COI = ((SA-AUM) / 1000) × monthlyQx
- 11.3 NAR basis with AUM ≥ SA: COI = 0
- 11.4 Age progression: m=11 vs m=12 → different COI rate (age N → N+1)
- 11.5 Edge case age 99: monthlyQx ≈ 1.0 → fee wipe-out → lapse
- 11.6 Geometric conversion sanity: `annualToMonthlyQx(60) ≈ 5.0` (annualQx 6%/yr ≈ monthlyQx 0.5%/mo)
- 11.7 coiTableId='none' → COI = 0
- 11.8 INVESTMENT-ONLY scenario through runScenario → totalCOI = 0

**Suite 13 (partial) — Yearly tracking 4 metrics:**
- 13.1 sum(yearlyAdminFee) = totalAdminFee
- 13.2 monthlyYear1AdminFee[0..11] sums to yearlyAdminFee[0]
- 13.3 yearly arrays length = Math.ceil(months/12)
- 13.4 post-lapse: yearly arrays = 0 for years after lapseMonth

**Implementation note for VM context tests:**
COI lookup needs `getMonthlyCOIRate` global. Test runner already loads `js/products/index.js` indirectly through... wait, it doesn't. We need to also load `js/products/index.js` into the VM context BEFORE fees.js + simulation.js. Update test-simulation.js loader:
```js
const productsCode = fs.readFileSync(path.join(__dirname, '../js/products/index.js'), 'utf8');
// Strip the `import` lines if any, since they fail in VM. The file uses globals + window assignment.
// Run productsCode in the VM context BEFORE feesCode.
vm.runInContext(productsCode, simCtx);
vm.runInContext(feesCode, simCtx);
vm.runInContext(simCode, simCtx);
```
Also expose `window` shim or skip the `window.ProductLib = ...` line. Easiest: add `var window = {};` to VM context globals.

### 7. Update `CLAUDE.md`

**Invariants table:** add (don't fully wait for 2c.2):
| Premium charge | `applyPremiumCharge`, `premiumChargeRates`, `netPremium` | ✅ implemented (Phase 2c.1) |
| COI | `applyFees` returns `coi`, `coiBasis`, `getMonthlyCOIRate` | ✅ implemented (Phase 2c.1) |
| Yearly fee tracking | `yearlyAdminFee`, `yearlyCOI`, `yearlyPremiumCharge`, `yearlyPremiumPaid` | ✅ implemented (Phase 2c.1) |

**Pitfalls:** add
- COI basis: `'sa'` for whole-life UL, `'nar'` for limited-term UL — current product configs use `'sa'`
- Premium charge applies to RPP only (RSP / Top Up = Phase 3+)
- COI uses integer age that steps on policy anniversary (not actual birthday)
- Test runner needs `js/products/index.js` loaded into VM BEFORE fees.js + simulation.js

---

## ห้ามทำใน Phase 2c.1

- ❌ ห้าม implement loyalty bonus (Phase 2c.2)
- ❌ ห้าม implement anchor scenarios for P25/P75 (Phase 2c.2 — only P50 used here)
- ❌ ห้าม render Phase 2d sale illustration table (Phase 2d)
- ❌ ห้ามแตะ Cholesky / regime / GBM math
- ❌ ห้ามลบ Phase 2b feature (lapse, survival curve, in-force percentile filter)
- ❌ ห้าม commit CLAUDE.md ก่อน implement code เสร็จ + verify
- ❌ ห้าม include monthly arrays สำหรับปีอื่นนอกจากปี 1 (memory budget)

---

## Pre-check

```bash
cd /c/Users/.../phase2c-1   # หรือ worktree ใหม่ที่สร้างจาก worktree-phase2b
pwd && git branch --show-current
git log --oneline -3        # ต้องเห็น d34a87b feat(phase2b)...
git status                  # clean

# Phase 2b invariant baseline
grep -cE "bidRatio|offerRatio|applyFees|adminFeeRate|lapseMonth|survivalMonthly|SNAPSHOT AUM|Market shock" js/simulation.js
# baseline = 47

# Phase 2a COI infra ยังอยู่
grep -nE "getMonthlyCOIRate|annualToMonthlyQx|getAnnualQx|COI_TABLES" js/products/index.js | head -5

# Tests baseline ผ่าน
node tools/test-simulation.js   # 107/107 should pass
```

---

## Verification หลัง edit

```bash
# 1. fees.js — applyPremiumCharge + COI in applyFees
grep -nE "applyPremiumCharge|coi |coiBasis" js/fees.js | head -10

# 2. Product configs corrected
grep -nE "basis: \"sa\"|basis: 'sa'" js/products/ul-99-99.js js/products/ul-10-99.js

# 3. simulation.js — yearly tracking + new args to applyFees
grep -nE "yearlyAdminFee|yearlyCOI|yearlyPremiumCharge|currentAge|monthlyYear1" js/simulation.js | head -10

# 4. Tests
node tools/test-simulation.js
# Expected: 107 baseline + ~16 new = 123+ tests pass

# 5. Browser cases:
#
# Case A: INVESTMENT-ONLY 10y — bit-exact match กับ Phase 2b
#   feeParams.adminFeeRate=0, premiumChargeRates={}, coiTableId='none'
#   → ผลลัพธ์เหมือน Phase 2b เป๊ะ (อาจมีการเพี้ยน floating-point เล็กน้อยถ้ามี new code path)
#
# Case B: UL-99-99 อายุ 30 monthly 5000 อัลโลค UIDPLUS+KFAFIX-A 50/50
#   → P50 ต่ำกว่า Phase 2b มาก (PC ปี 1-5 หนัก, COI ทุกเดือน)
#   → Fee summary banner แสดง 3 components: admin / COI / PC
#   → Premium charge total ≈ 78,000 (sum ของ 5 ปีแรก)
#   → COI ค่อย ๆ เพิ่มตามอายุ (อายุ 30 ≈ 0.13/1000/mo, อายุ 80 ≈ 7.5/1000/mo)
#
# Case C: UL-10-99 อายุ 30 monthly 5000
#   → PC ปี 1-5 หนัก (เหมือน B); หลังปี 5 = 0
#   → หลังปี 10: ไม่มี premium → AUM โดน admin + COI ลบทุกเดือน → ลด → อาจ lapse ปลายอายุ
#   → ถ้า lapse ปลายอายุ → survivalCurve drop, avgLapseAge แสดง

# 6. Invariant count post-2c.1
grep -cE "bidRatio|offerRatio|applyFees|adminFeeRate|lapseMonth|premiumChargeRates|coiBasis|yearlyAdminFee|yearlyCOI|currentAge" js/simulation.js
# baseline 47 → expect 60+ after Phase 2c.1
```

---

## รายงานผลลัพธ์

```
✅ Phase 2c.1 เสร็จแล้ว — verified:
- applyPremiumCharge added in fees.js
- applyFees signature extended (sumAssured, currentAge, gender) + COI logic
- Loop wires PC + COI in correct order (PC before buy, COI in fees block)
- 4 yearly + 4 monthly-Y1 arrays returned per scenario
- Product configs corrected: coi.basis = 'sa' (UL-99-99 + UL-10-99)
- 107 baseline + ~16 new tests pass
- Browser cases A-C ผ่าน
- p50 fee breakdown shows 3 components in banner
- Files changed: simulation.js, app.js, fees.js, products/{ul-99-99,ul-10-99}.js, test-simulation.js, CLAUDE.md
```

---

## Success criteria

1. ✅ INVESTMENT-ONLY: ผลลัพธ์เหมือน Phase 2b (no fee components active)
2. ✅ UL-99-99 P50 ลดลงจาก Phase 2b ตามคาด (เพราะมี PC + COI)
3. ✅ UL-10-99: PC จบที่ปี 5; COI หักทุกเดือนถึงสิ้น coverage
4. ✅ Banner แสดง 3 components แยกได้ (admin, COI, PC)
5. ✅ Yearly arrays sum = total per scenario (Suite 13)
6. ✅ Phase 2b invariants preserved (no lapse regression in INV-ONLY)

---

## Notes for Claude in next session (Phase 2c.1 implementer)

- **Worktree:** สร้างใหม่จาก `worktree-phase2b` — ไม่ใช่จาก main
  ```bash
  git worktree add .claude/worktrees/phase2c-1 -b worktree-phase2c-1 worktree-phase2b
  ```
- **Bash session cwd pitfall** (CLAUDE.md): always `pwd && git branch --show-current` before `node`/`python`/`git status`; use absolute paths
- **Server cache pitfall:** verify `curl localhost:8080/js/fees.js | grep applyPremiumCharge` after edits
- **Recommended sequence:**
  1. Pre-check (git, tests baseline, invariants)
  2. Update product configs (UL-99-99, UL-10-99 → basis='sa')
  3. Add `applyPremiumCharge` to fees.js
  4. Update test-simulation.js loader to include products/index.js
  5. Add Suite 10 (premium charge tests) — verify
  6. Extend `applyFees` for COI (signature + logic)
  7. Add Suite 11 (COI tests) — verify
  8. Wire premium charge + COI into runScenario loop + yearly tracking
  9. Add Suite 13 partial (4-metric tracking) — verify
  10. Update runMonteCarlo to expose p50COI + p50PremiumCharge
  11. Update app.js feeParams construction + 3-component banner
  12. Browser test cases A, B, C
  13. Update CLAUDE.md (invariants + pitfalls)
  14. Local commit (no push, no merge)
- **Decisions A1-A6, B1-B8, D (partial), E (partial) ตอบเสร็จแล้ว** — ห้าม re-discuss; edge case → ถาม user
- **Memory budget:** Phase 2c.1 yearly arrays = N × 4 metrics × ~70 entries ≈ 280 floats per scenario. At N=10K = 2.2 MB. Trivial.
- **Phase 2c.2 will add:** `applyLoyaltyBonus`, `expandLoyaltySchedule`, 5th metric, anchor scenarios. Don't implement those here.
