# Phase 2c: Premium Charge + COI + Loyalty Bonus + Yearly Tracking (v1 — decisions locked)

**Prerequisite:** Phase 2b merged ใน `worktree-phase2b` branch
- `applyFees(portfolio, bidPrices, feeParams, month) → { adminFee, lapsed }` พร้อมใช้
- D1-D6 loop order, in-force percentile filter, lapse tracking ใช้งานได้
- 107/107 tests passing

**Reference:**
- `prompts/phase2-architecture-spec-v3.md` — โดยเฉพาะ Phase 2c + Phase 2d sections
- `prompts/prompt-phase2b-v1.md` — D1-D6 loop order ที่ Phase 2c ขยาย

---

## Goal

เพิ่ม fee mechanics ที่เหลือ + data layer ที่ Phase 2d sale illustration table ต้องใช้

หลัง Phase 2c:
- Premium charge หักเบี้ยก่อนซื้อ unit (ทำให้ปีต้น ๆ AUM โตช้า ตรงตามเอกสาร insurer)
- COI หักจาก AUM ทุกเดือน rate ตาม TMO2560 + อายุ + เพศ + basis (NAR/SA)
- Loyalty bonus credit เพิ่ม unit ตาม schedule ที่กำหนดใน product config
- Phase 2d ใช้ data layer ที่ runScenario คืนเพื่อ render ตาราง sale illustration ได้ทันที (no engine work in 2d)

INVESTMENT-ONLY: ไม่กระทบ (ทุก fee = 0, no schedule)
UL-99-99 / UL-10-99: ผลลัพธ์ควรใกล้เคียงเอกสาร insurer มากขึ้น (ก่อนหน้านี้ขาด PC + COI)

---

## 🔒 Decisions (locked — ไม่ต้อง re-discuss)

### Group A — Premium Charge

#### A1: หักเฉพาะ RPP (Phase 2c) ✅
RSP / Top Up เป็น Phase 3+

#### A2: Policy year basis = payment count ✅
- Monthly mode: paymentCount 1-12 = ปีที่ 1, 13-24 = ปีที่ 2, ...
- Annual mode: paymentCount 1 = ปีที่ 1, 2 = ปีที่ 2, ...
- Formula: `policyYear = Math.ceil(paymentCount / paymentsPerYear)`

#### A3: Rate schedule อยู่ที่ `product.premiumCharge.rates` ✅
มีอยู่แล้วใน `js/products/ul-99-99.js`:
```js
premiumCharge: {
  type: "year-based",
  rates: { 1: 0.55, 2: 0.40, 3: 0.20, 4: 0.10, 5: 0.05 }
}
```
ปีนอก schedule → rate = 0 (ไม่ extend)

#### A4: Timing — หัก premium charge **ก่อน** buy at offer ✅
```
gross premium  →  applyPremiumCharge  →  netPremium  →  buy units at OFFER
```

#### A5: Runtime tracking (hybrid monthly + yearly) ✅
- `monthlyYear1PremiumCharge[0..11]` (เฉพาะเดือน 0-11 ของปี 1)
- `yearlyPremiumCharge[0..years-1]` (ทุกปี)
- accumulate ใน scenario loop

#### A6: Function signature ✅
```js
function applyPremiumCharge(premium, feeParams, paymentCount) {
  const policyYear = Math.ceil(paymentCount / feeParams.paymentsPerYear);
  const rate = feeParams.premiumChargeRates[policyYear] ?? 0;
  const charge = premium * rate;
  return { netPremium: premium - charge, charge };
}
```

### Group B — COI

#### B1: Basis = `'sa'` หรือ `'nar'` per product ✅
- `'sa'` (current UL-99-99, UL-10-99): COI base = full SA
- `'nar'` (future products): COI base = `max(0, SA - AUM)`
- **ปัจจุบัน product config มี `coi.basis: "nar"` ซึ่งผิด — ต้องแก้เป็น `"sa"`** ตอน Phase 2c

#### B2: TMO2560 source = `js/products/index.js` (มีแล้ว) ✅
- `COI_TABLES["thai-mortality-2560-ordinary"]` มี male + female 0-99
- ไม่ต้อง parse xlsx ใน Phase 2c

#### B3: Geometric monthly conversion ✅
ใช้ `annualToMonthlyQx()` ที่มีอยู่:
```js
monthlyQxPer1000 = (1 - (1 - annualQxPer1000/1000)^(1/12)) × 1000
```

#### B4: Loading factor ใน `product.coi.loadingFactor` ✅
flat number per product (default 1.0)

#### B5: Range 0-99 ครอบคลุม UL ทั้งหมด ✅
อายุ 99 = qx 1000 (terminal) — handle naturally

#### B6: NAR clip = `max(0, SA - AUM)` ✅
ถ้า AUM > SA → NAR = 0 → COI = 0

#### B7: applyFees return เพิ่ม `coi` field ✅
```js
applyFees(portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender)
  → { adminFee, coi, lapsed }
```
**Signature เปลี่ยนจาก Phase 2b** — เพิ่ม sumAssured, currentAge, gender args

#### B8: Integer age, advance on policy anniversary ✅
```js
const policyYearIdx = Math.floor(month / 12);   // 0, 1, 2, ...
const currentAge = userAge + policyYearIdx;     // 30, 31, 32, ...
```
Step jump ทุก 12 เดือน — ตรงกับ insurer convention

### Group C — Loyalty Bonus

#### C1: Type per product ✅
`product.loyaltyBonus.type = 'milestone' | 'none'`

#### C2: Schedule rules schema ✅
```js
product.loyaltyBonus = {
  type: 'milestone',
  basis: 'first-year-premium-analytical',
  rules: [
    { atYear: N, pct: P },                                  // single year
    { fromYear: A, toYear: B, every: K, pct: P },           // range with step
    { fromYear: A, every: K, pct: P },                      // open-ended (cap = coverage end)
  ]
}
```

**UL-99-99 schedule:**
```js
rules: [
  { atYear: 10, pct: 10 },
  { atYear: 20, pct: 20 },
  { atYear: 30, pct: 30 },
]
```

**UL-10-99 schedule:**
```js
rules: [
  { fromYear: 11, toYear: 15, every: 1, pct: 2  },
  { atYear: 16,                          pct: 10 },
  { fromYear: 21, every: 5,              pct: 20 },   // cap at coverage end
]
```

**INVESTMENT-ONLY:**
```js
loyaltyBonus: { type: 'none' }
```

#### C3: First year premium = analytical ✅
```js
firstYearPremiumAnalytical = premium × paymentsPerYear
```
ไม่ขึ้นกับ payment mode — ทำให้ bonus เท่ากันทุก mode (fair)

#### C4: Schedule cap = สิ้น coverage ✅
```js
maxYear = coverageMonths / 12
```
expandLoyaltySchedule(rules, maxYear) → Map<year, pct>

#### C5: Lapse handling ✅
ที่ milestone month: ตรวจ `if (lapseMonth === null)` ก่อน
- ถ้า lapsed ในเดือนก่อน → ไม่ได้ bonus
- ถ้า lapse THIS month (จาก fees หลัง bonus) → **ยังได้ bonus** (ถูก track ใน yearlyLoyaltyBonus) แต่ portfolio = 0
- Tracking shows what was credited, not what survived

#### C6: Bonus credit = buy at offer ✅
```js
for (const f of funds) {
  const offerPrice = nav[f] * fundStats[f].offerRatio;
  portfolio[f] += (bonus * allocation[f]) / offerPrice;
}
```
ใช้ allocation **ปัจจุบัน** ของ user (เหมือน premium buy)

#### C7: Loop order — bonus **ก่อน** applyFees ✅
Bonus เพิ่ม AUM → admin/COI คำนวณบน AUM ใหม่ที่สูงขึ้น
หาก AUM (รวม bonus) ยังไม่พอจ่าย fees → lapse THIS month

#### C8: Trigger condition ✅
```js
const yearJustEnded = (m + 1) / 12;
if ((m + 1) % 12 === 0 && scheduleMap.has(yearJustEnded) && lapseMonth === null) {
  // bonus event
}
```
ที่เดือน `m=11, 23, 35, ...` (สิ้นปี policy)

### Group D — Yearly Fee Tracking

#### D1: Hybrid granularity ✅
- Year 1: 12 monthly entries (`monthlyYear1*[0..11]`)
- Year 2+: 1 yearly entry per year (`yearly*[year]`)
- Same array conceptually — yearly always populated, monthly only for m<12

#### D2: 5 metrics tracked ✅
Per scenario:
- `monthlyYear1AdminFee[12]` + `yearlyAdminFee[Y]`
- `monthlyYear1COI[12]` + `yearlyCOI[Y]`
- `monthlyYear1PremiumCharge[12]` + `yearlyPremiumCharge[Y]`
- `monthlyYear1PremiumPaid[12]` + `yearlyPremiumPaid[Y]`
- `monthlyYear1LoyaltyBonus[12]` + `yearlyLoyaltyBonus[Y]`

`Y = Math.ceil(months / 12)`

#### D3: Phase 2d aggregation = anchor scenario ✅
```js
// In runMonteCarlo, after MC loop:
const finalMonth = months - 1;
const activeAtEnd = [];
for (let s = 0; s < N; s++) {
  if (lapseMonths[s] === null || lapseMonths[s] > finalMonth) {
    activeAtEnd.push({ idx: s, final: allSeries[s][finalMonth] });
  }
}
activeAtEnd.sort((a, b) => a.final - b.final);

const pickAt = (p) => activeAtEnd[Math.floor(p * activeAtEnd.length)].idx;
const anchors = {
  p25: { idx: pickAt(0.25), ...allYearlyArrays[pickAt(0.25)] },
  p50: { idx: pickAt(0.50), ...allYearlyArrays[pickAt(0.50)] },
  p75: { idx: pickAt(0.75), ...allYearlyArrays[pickAt(0.75)] },
};
```

Return `anchorScenarios: { p25, p50, p75 }` from runMonteCarlo

**Memory:** all scenarios' yearly + monthly-year-1 arrays kept in memory until anchor pick. ~100 MB at N=10K (acceptable).

#### D4: Yearly array length ✅
`yearsLen = Math.ceil(months / 12)` — รวมเศษเดือนของปีสุดท้ายใน slot สุดท้าย

### Group E — Architecture

#### E1: 3 functions แยก loose coupling ✅
```js
// js/fees.js
applyPremiumCharge(premium, feeParams, paymentCount) → { netPremium, charge }
applyFees(portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender)
  → { adminFee, coi, lapsed }
applyLoyaltyBonus(portfolio, fundStats, allocation, bonusAmount) → void  // mutates portfolio
```

#### E2: feeParams flat shape ✅
```js
feeParams: {
  // Phase 2b
  adminFeeRate: number,

  // Phase 2c — premium charge
  premiumChargeRates: { [year: number]: number },
  paymentsPerYear: number,

  // Phase 2c — COI
  coiTableId: 'thai-mortality-2560-ordinary' | 'none',
  coiBasis: 'sa' | 'nar',
  coiLoading: number,

  // Phase 2c — loyalty bonus
  loyaltyScheduleMap: Map<year, pct>,        // pre-expanded by expandLoyaltySchedule()
  firstYearPremiumAnalytical: number,        // premium × paymentsPerYear

  // Phase 2c — context
  sumAssured: number,                        // SA at start (constant in Phase 2c; varies in Phase 3)
  userAge: number,
  gender: 'male' | 'female',
}
```

#### E3: Loop order ✅
```
for (let m = 0; m < months; m++) {
  if (lapseMonth !== null) { values[m] = 0; continue; }

  // 1. Premium block (if premium month)
  if (premiumMonths.has(m)) {
    paymentCount++;
    const { netPremium, charge } = applyPremiumCharge(premium, feeParams, paymentCount);
    yearlyPremiumPaid[Math.floor(m/12)]   += premium;
    yearlyPremiumCharge[Math.floor(m/12)] += charge;
    if (m < 12) {
      monthlyYear1PremiumPaid[m]   = premium;
      monthlyYear1PremiumCharge[m] = charge;
    }
    // Buy with NET premium
    for (const f of funds) {
      const offerPrice = nav[f] * fundStats[f].offerRatio;
      portfolio[f] += (netPremium * allocation[f]) / offerPrice;
    }
  }

  // 2. Loyalty bonus (NEW)
  if ((m + 1) % 12 === 0) {
    const yearJustEnded = (m + 1) / 12;
    const pct = feeParams.loyaltyScheduleMap.get(yearJustEnded);
    if (pct != null) {
      const bonus = feeParams.firstYearPremiumAnalytical * pct / 100;
      applyLoyaltyBonus(portfolio, fundStats, allocation, bonus);
      yearlyLoyaltyBonus[yearJustEnded - 1] += bonus;
      // monthlyYear1LoyaltyBonus only fires if year 1 has milestone — rare
    }
  }

  // 3. Snapshot bidPrices
  const bidPrices = {};
  for (const f of funds) bidPrices[f] = nav[f] * fundStats[f].bidRatio;

  // 4. applyFees (admin + COI) → lapse?
  const currentAge = feeParams.userAge + Math.floor(m / 12);
  const { adminFee, coi, lapsed } = applyFees(
    portfolio, bidPrices, feeParams.sumAssured, feeParams, m, currentAge, feeParams.gender
  );
  yearlyAdminFee[Math.floor(m/12)] += adminFee;
  yearlyCOI[Math.floor(m/12)]      += coi;
  if (m < 12) {
    monthlyYear1AdminFee[m] = adminFee;
    monthlyYear1COI[m]      = coi;
  }
  if (lapsed) { lapseMonth = m; values[m] = 0; continue; }

  // 5. Rebalance
  // 6. Record value at BID
  // 7. Market shock
}
```

#### E4: Test plan ✅
**Suite 10:** Premium Charge
- 10.1 closed-form: rate × premium = charge
- 10.2 schedule expiry: year > max(rates) → charge = 0
- 10.3 payment-mode invariance: monthly vs annual same total charge for same first-year-premium analytical
- 10.4 paymentCount math: 13 → ceil(13/12) = year 2

**Suite 11:** COI
- 11.1 SA basis closed-form: COI = (SA / 1000) × monthlyQx × loading
- 11.2 NAR basis closed-form: COI = (max(0, SA-AUM) / 1000) × monthlyQx × loading
- 11.3 NAR with AUM > SA → COI = 0
- 11.4 Age progression: month 0-11 use age N rate, month 12-23 use age N+1 rate
- 11.5 Edge case age 99: qx = 1000 → max COI possible
- 11.6 Geometric conversion: matches `1 - (1-q)^(1/12)`

**Suite 12:** Loyalty Bonus
- 12.1 expandLoyaltySchedule: rules → map correct
- 12.2 milestone trigger: bonus credited at `(m+1)%12 === 0` AND year in map
- 12.3 lapse before milestone → no bonus
- 12.4 lapse THIS month after bonus → bonus tracked, units consumed by fees
- 12.5 schedule expiry: year > maxYear → no bonus
- 12.6 bonus uses analytical first year premium (mode-invariant)

**Suite 13:** Yearly Tracking
- 13.1 sum(yearlyAdminFee) = totalAdminFee (closed scenario)
- 13.2 monthlyYear1[m] for m<12 ↔ yearlyAdminFee[0] = sum(monthlyYear1[0..11])
- 13.3 array length = Math.ceil(months/12)
- 13.4 post-lapse values[m] = 0; yearly arrays = 0 for years after lapse

**Suite 14:** Anchor scenario
- 14.1 anchors picked at correct rank (P25, P50, P75)
- 14.2 anchor's final value = percentiles[50][final] for P50 anchor (within in-force set)
- 14.3 anchor's full trajectory returned correctly
- 14.4 anchor selection skips lapsed scenarios at final month

---

## Scope

### 1. แก้ `js/fees.js`

**Add:**
```js
function applyPremiumCharge(premium, feeParams, paymentCount) { ... }
function applyLoyaltyBonus(portfolio, fundStats, allocation, bonusAmount, navPrices) {
  // Same logic as premium buy block but with bonus instead of net premium
  for (const f of Object.keys(allocation)) {
    const offerPrice = navPrices[f] * (fundStats[f]?.offerRatio ?? 1);
    portfolio[f] += (bonusAmount * (allocation[f] || 0)) / offerPrice;
  }
}
```

**Modify `applyFees` signature:**
```js
function applyFees(portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender) {
  // ... existing AUM snapshot, admin fee logic ...
  const aum = sumPortfolioAtBid();
  if (aum <= 0) return { adminFee: 0, coi: 0, lapsed: true };

  const adminFee = aum * (feeParams.adminFeeRate || 0);

  // NEW: COI
  let coi = 0;
  if (feeParams.coiTableId && feeParams.coiTableId !== 'none' && currentAge != null) {
    const monthlyQxPer1000 = window.ProductLib.getMonthlyCOIRate(
      { coi: { tableId: feeParams.coiTableId, loadingFactor: feeParams.coiLoading ?? 1 } },
      Math.min(currentAge, 99),
      gender
    ) ?? 0;
    const coiBase = (feeParams.coiBasis === 'sa') ? sumAssured : Math.max(0, sumAssured - aum);
    coi = (coiBase / 1000) * monthlyQxPer1000;
  }

  const totalFee = adminFee + coi;
  // ... pro-rata deduct, lapse check ...
  return { adminFee, coi, lapsed };
}
```

**Add helper (top of fees.js or product registry):**
```js
function expandLoyaltySchedule(rules, maxYear) {
  const map = new Map();
  for (const r of rules || []) {
    if (r.atYear != null) {
      if (r.atYear <= maxYear) map.set(r.atYear, r.pct);
    } else if (r.fromYear != null) {
      const to = r.toYear ?? maxYear;
      const step = r.every ?? 1;
      for (let y = r.fromYear; y <= to; y += step) map.set(y, r.pct);
    }
  }
  return map;
}
```

### 2. แก้ `js/simulation.js`

#### 2.1 Loop reorder ตาม E3
ตามลำดับใน Decision E3 ด้านบน

#### 2.2 runScenario return เพิ่ม yearly + monthly arrays
```js
return {
  values, lapseMonth, totalAdminFee,                        // existing Phase 2b
  yearlyAdminFee, yearlyCOI, yearlyPremiumCharge,           // NEW
  yearlyPremiumPaid, yearlyLoyaltyBonus,
  monthlyYear1AdminFee, monthlyYear1COI, monthlyYear1PremiumCharge,
  monthlyYear1PremiumPaid, monthlyYear1LoyaltyBonus,
};
```

#### 2.3 runMonteCarlo
- Aggregate yearly arrays per scenario into `allYearlyData`
- After MC loop, sort by final value, pick 3 anchor indices
- Return `anchorScenarios: { p25, p50, p75 }` with full trajectories

### 3. แก้ `js/products/*.js`

**ul-99-99.js:**
```diff
  coi: {
-   basis: "nar",
+   basis: "sa",
    tableId: "thai-mortality-2560-ordinary",
    loadingFactor: 1.0,
    conversionMethod: "constant-force"
  },
- loyaltyBonus: { type: "none" }
+ loyaltyBonus: {
+   type: 'milestone',
+   basis: 'first-year-premium-analytical',
+   rules: [
+     { atYear: 10, pct: 10 },
+     { atYear: 20, pct: 20 },
+     { atYear: 30, pct: 30 },
+   ]
+ }
```

**ul-10-99.js:** similar fix to coi.basis + add loyaltyBonus rules per C2.2

**investment-only.js:** confirm `loyaltyBonus: { type: 'none' }`

### 4. แก้ `js/app.js`

#### 4.1 ส่ง feeParams ที่ครบ
```js
const _intervals = { monthly: 12, quarterly: 4, 'semi-annual': 2, annual: 1 };
const _ppyear = _intervals[state.paymentMode] ?? 12;
const _firstYearPremium = state.premium * _ppyear;

const _maxYear = Math.ceil(simMonths / 12);
const _scheduleMap = window.FeesLib.expandLoyaltySchedule(
  _product.loyaltyBonus?.rules ?? [], _maxYear
);

const baseConfig = {
  ...,
  feeParams: {
    adminFeeRate: _product?.adminFee?.rate || 0,
    premiumChargeRates: _product?.premiumCharge?.rates ?? {},
    paymentsPerYear: _ppyear,
    coiTableId: _product?.coi?.tableId ?? 'none',
    coiBasis: _product?.coi?.basis ?? 'sa',
    coiLoading: _product?.coi?.loadingFactor ?? 1,
    loyaltyScheduleMap: _scheduleMap,
    firstYearPremiumAnalytical: _firstYearPremium,
    sumAssured: state.product.sumAssured,
    userAge: state.product.age,
    gender: state.product.gender,
  },
  userAge: state.product.age,
};
```

#### 4.2 Phase 2d UI = NOT in 2c — anchor data is exposed but no table rendered yet
ค่า `state.results.anchorScenarios` พร้อมใช้ Phase 2d แต่ Phase 2c ไม่ render UI

#### 4.3 Update fee summary banner ให้แสดงรายละเอียด
ตอนนี้แสดง "ค่าธรรมเนียมบริหาร P50" → ขยาย:
```
💰 ค่าธรรมเนียมรวม (กรณี P50):  ฿XXX,XXX
   • Admin fee: ฿xxx (yy%)
   • COI: ฿xxx (yy%)
   • Premium charge: ฿xxx (yy%)
   • Loyalty bonus credited: +฿xxx (yy%)
```
ใช้ data จาก `anchorScenarios.p50.yearly*` รวมยอด

### 5. Update `index.html`
- ไม่ต้องเพิ่ม script ใหม่ (fees.js มีอยู่แล้ว)
- ไม่ต้องเพิ่ม HTML structure (UI ตารางเป็น Phase 2d)

### 6. Update `CLAUDE.md`

**Invariants table:** เพิ่ม
| Premium charge deduction | `applyPremiumCharge`, `premiumChargeRates`, `netPremium` | ✅ implemented (Phase 2c) |
| COI deduction | `applyFees` returns `coi`, `coiBasis`, `getMonthlyCOIRate` | ✅ implemented (Phase 2c) |
| Loyalty bonus credit | `applyLoyaltyBonus`, `loyaltyScheduleMap`, `expandLoyaltySchedule` | ✅ implemented (Phase 2c) |
| Yearly + monthly Y1 tracking | `yearlyAdminFee`, `monthlyYear1AdminFee`, ... | ✅ implemented (Phase 2c) |
| Anchor scenarios for Phase 2d | `anchorScenarios.p25/p50/p75` | ✅ implemented (Phase 2c) |

**Common Pitfalls:** เพิ่ม
- Loop order: Premium → PC → Buy → Bonus → Snapshot → Fees(admin+COI) → Lapse — ห้ามสลับ Bonus กับ Fees (จะ fee คิดบน AUM ผิด)
- COI basis: `'sa'` for whole-life UL (death benefit = SA + AUM); `'nar'` for limited-term UL (death benefit = max(SA, AUM))
- Loyalty bonus uses `firstYearPremiumAnalytical` not actual paid — invariant ที่ทำให้ payment mode ไม่ส่งผลกับ bonus
- expandLoyaltySchedule cap = `coverageMonths/12` ไม่ใช่ `simMonths/12` หรือ premium years

---

## ห้ามทำ

- ❌ ห้าม implement Phase 2d table UI (data layer ใน Phase 2c, table render ใน Phase 2d)
- ❌ ห้ามแตะ Cholesky / regime / GBM math
- ❌ ห้ามลบ Phase 1/2a/2b feature
- ❌ ห้ามเปลี่ยน applyFees signature นอกเหนือจาก E1 (เพิ่ม args เท่านั้น ห้ามลบ)
- ❌ ห้าม commit CLAUDE.md ก่อน implement code เสร็จและ verify
- ❌ ห้ามรวม monthly arrays สำหรับปีอื่นนอกจากปี 1 (memory budget)
- ❌ ห้าม include post-lapse zeros ใน percentile/mean — Phase 2b in-force filter ยังต้องใช้

---

## Pre-check

```bash
git status                          # Clean working tree
git log --oneline -3                # ต้องเห็น Phase 2b commit (d34a87b feat(phase2b)...)
git branch --show-current           # ต้องเป็น worktree-phase2c (สร้างใหม่)

# Snapshot invariant count baseline (Phase 2b)
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL|premiumPaymentMonths|adminFeeRate|lapseMonth|survivalMonthly" js/simulation.js
# Phase 2b baseline = 47

# Verify Phase 2a COI infrastructure ยังอยู่ครบ
grep -nE "getMonthlyCOIRate|annualToMonthlyQx|getAnnualQx|COI_TABLES" js/products/index.js | head -5

# Verify product configs
grep -nE "premiumCharge|coi|loyaltyBonus" js/products/ul-99-99.js
```

**Server check ก่อน browser test:**
```bash
curl -s http://localhost:8080/js/fees.js | grep -c "applyPremiumCharge"
curl -s http://localhost:8080/js/simulation.js | grep -c "yearlyAdminFee\|anchorScenarios"
```

---

## Verification หลัง edit

```bash
# 1. fees.js — 3 functions present
grep -nE "applyPremiumCharge|applyLoyaltyBonus|expandLoyaltySchedule" js/fees.js

# 2. simulation.js — yearly arrays + anchors
grep -nE "yearlyAdminFee|yearlyCOI|monthlyYear1|anchorScenarios" js/simulation.js

# 3. Product configs corrected
grep -nE "basis: \"sa\"|loyaltyBonus" js/products/ul-99-99.js js/products/ul-10-99.js

# 4. INVESTMENT-ONLY equivalence (Phase 2b regression)
node tools/test-simulation.js
# 107 baseline + ~30 new = ~135 tests must pass

# 5. Browser cases:
#
# Case A: INVESTMENT-ONLY 10y — bit-exact match กับ Phase 2b
#   - feeParams ทุกตัว = 0 หรือ none → ผลลัพธ์เท่าเดิม
#
# Case B: UL-99-99 อายุ 30 monthly 5000 อัลโลค UIDPLUS+KFAFIX-A 50/50
#   - P50 ต่ำกว่า Phase 2b (เพราะมี PC + COI เพิ่ม)
#   - Bonus เห็นได้ที่ปี 10/20/30 (yearlyLoyaltyBonus[9/19/29] > 0)
#   - Fee summary banner แสดง 4 components (admin/COI/PC/bonus)
#
# Case C: UL-10-99 อายุ 30 monthly 5000
#   - PC หักหนักปี 1-5 (rate 55%/40%/20%/10%/5%)
#   - หลังปี 10: ไม่มี premium แต่ COI + admin ยังหัก
#   - Bonus ที่ปี 11-15 (2%), 16 (10%), 21+ ทุก 5 ปี (20%) ออกมาเป็น standalone buy
#   - Survival curve อาจตกที่ปลายอายุ (อายุ 80+ COI สูง)
#
# Case D: UL-99-99 อายุ 50 (อายุที่ COI สูงกว่า)
#   - lapse rate ควรสูงกว่า Case B
#   - avgLapseAge รอบ ๆ 70-80
#
# Case E: เปรียบเทียบกับเอกสาร insurer
#   - ใช้ allocation + age + premium ตรงกับเอกสาร insurer
#   - P50 ของเรา ≈ assumed 2% column ของ insurer
#   - Total fee + bonus ปลายอายุตรงกัน
#   - ถ้าต่างกันเกิน 5% → debug

# 6. Invariant count (post-Phase 2c)
grep -cE "bidRatio|offerRatio|applyFees|adminFeeRate|lapseMonth|premiumChargeRates|coiBasis|loyaltyScheduleMap|yearlyAdminFee|yearlyCOI|anchorScenarios" js/simulation.js
# จะเพิ่มจาก 47 (Phase 2b baseline) — ตัวเลขใหม่จะเป็น baseline ของ Phase 2d
```

---

## Sanity tests สำหรับ Phase 2c

ตาม Suite 10-14 ที่ระบุใน E4

นอกจากนี้:
1. **Mode invariance** — Monthly vs Quarterly vs Annual เบี้ยปีละเท่ากัน → fee ใกล้เคียงกัน, bonus เท่ากัน
2. **Closed-form COI** — fixed AUM, age, sex, basis → COI = (base/1000) × monthlyQx × loading exact
3. **Premium charge mass conservation** — gross premium = netPremium + charge ทุก iteration
4. **Loyalty bonus tracking** — sum(yearlyLoyaltyBonus) = total bonus credited
5. **Anchor consistency** — pick scenario by rank, all returned data is from that one scenario

---

## รายงานผลลัพธ์

```
✅ Phase 2c เสร็จแล้ว — verified:
- applyPremiumCharge, applyLoyaltyBonus, expandLoyaltySchedule added in fees.js
- applyFees signature extended with sumAssured, currentAge, gender
- COI deduction live (NAR/SA basis, TMO2560 lookup, geometric monthly)
- Loyalty bonus schedule expansion + credit (UL-99-99 + UL-10-99 schedules)
- Yearly + Year-1-monthly arrays per scenario (5 metrics × 2 granularities)
- Anchor scenarios (P25/P50/P75) returned from runMonteCarlo for Phase 2d
- Product configs corrected: coi.basis = 'sa' for both UL products
- 107 baseline + ~30 new tests pass
- Browser cases A-E: ผ่าน
- Files changed: simulation.js, app.js, fees.js, products/{ul-99-99,ul-10-99}.js, CLAUDE.md
```

---

## Success criteria

1. ✅ INVESTMENT-ONLY: ผลลัพธ์เหมือน Phase 2b (admin = 0, no PC/COI/bonus → unchanged)
2. ✅ UL-99-99: P50 ต่ำกว่า Phase 2b เพราะ PC + COI; เห็น 3 milestones bonus
3. ✅ UL-10-99: PC หนักปี 1-5; bonus pattern ตรงตาม schedule (years 11-16 + every 5 yrs from 21)
4. ✅ Loop order ถูกต้อง: bonus ก่อน fees (verified ผ่าน Suite 12.4)
5. ✅ Anchor data พร้อมใช้ Phase 2d (no UI yet)
6. ✅ ไม่มี post-lapse contamination ใน percentile/mean (Phase 2b invariant preserved)

---

## Decisions parked for Phase 2d (อย่าทำใน 2c)

- Sale illustration table HTML render (3 tables P25/P50/P75)
- Year-by-year row layout (12 monthly rows for year 1, 1 row per year after)
- Fee breakdown columns
- Death benefit column display
- CSV export per table
- คปภ deterministic mode toggle (-1%/2%/5%)

---

## Decisions parked for Phase 2e (UI polish)

- TPP overlay line on chart
- Fix duplicate "ถัดไป: ตั้งค่า →" button on Step 1
- Gross/Net toggle
- "รันใหม่ด้วยตัวเลขสุ่มชุดเดิม" button (ใช้ state.lastRun.seed)
- What-if analysis (SA reduction)
- RSP / Top Up support (Phase 3)

---

## Notes for Claude in next session

- **อ่าน:** `prompts/phase2-architecture-spec-v3.md` + `prompts/prompt-phase2c-v1.md` (this file) + `prompts/prompt-phase2b-v1.md` ก่อนเริ่ม
- **Decision A1-A6, B1-B8, C1-C8, D1-D4, E1-E4 ตอบเสร็จแล้ว** — ห้าม re-discuss
  - ถ้าเจอ edge case ที่ decision ไม่ครอบคลุม → **ถาม user ก่อน edit**
- **Worktree ใหม่สำหรับ Phase 2c** — สร้างจาก worktree-phase2b (ไม่ใช่ main) เพื่อ inherit Phase 2b code
- **Recommended sequence:**
  1. Update product configs (coi.basis = 'sa', loyaltyBonus rules) — verify load
  2. Add `expandLoyaltySchedule` to fees.js + Suite 12.1 test
  3. Add `applyPremiumCharge` + Suite 10 tests
  4. Add `applyLoyaltyBonus` + Suite 12.2-12.6 tests
  5. Extend `applyFees` for COI + Suite 11 tests
  6. Wire all into runScenario + verify loop order
  7. Add yearly tracking + Suite 13 tests
  8. Add anchor scenario logic in runMonteCarlo + Suite 14 tests
  9. Update app.js feeParams construction + fee summary banner
  10. Browser test cases A-E
  11. Update CLAUDE.md last
- **Bash session cwd pitfall** (CLAUDE.md): always `pwd && git branch --show-current` before destructive commands; use absolute paths for `node` / `python -m http.server --directory ...`
- **Server cache pitfall:** verify `curl localhost:8080/js/fees.js | grep applyPremiumCharge` after edits to confirm browser sees new code
- **Memory note:** runMonteCarlo will hold ~100 MB of per-scenario yearly data at N=10K; ok for browser but watch for OOM at N=50K+
- **Test framework** (`tools/test-simulation.js`) needs ~5 new suites; existing pattern via `vm.runInContext` requires `applyPremiumCharge`, `applyLoyaltyBonus`, `expandLoyaltySchedule` to be globals in fees.js (not module exports)
- **TMO2560 already in `js/products/index.js`** as `COI_TABLES` global — `coi-tables.js` is unused (uses ES module exports that don't load via script tag); ignore that file
- **Currency formatting** (`fmtTHB`) and **payment-step helpers** (`simPaymentStep`, `paymentCount`) live in app.js — reuse from fee summary banner
