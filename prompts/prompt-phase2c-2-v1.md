# Phase 2c.2: Loyalty Bonus + Anchor Scenarios (v1 — decisions locked)

**Phase 2c is split into 2 sub-phases for context budget safety.**
This is **Phase 2c.2** — completes Phase 2c after `prompt-phase2c-1-v1.md`. Adds loyalty bonus + anchor scenario data layer for Phase 2d.

**Prerequisite:** Phase 2c.1 merged (commit on `worktree-phase2c-1` branch)
- `applyPremiumCharge` working in fees.js
- `applyFees` extended with COI (signature: `portfolio, bidPrices, sumAssured, feeParams, month, currentAge, gender → { adminFee, coi, lapsed }`)
- 4 yearly arrays + 4 monthly-Y1 arrays returned per scenario
- Product configs `coi.basis = 'sa'`
- ~123 tests passing

**Reference:**
- `prompts/prompt-phase2c-v1.md` — full decision doc
- `prompts/prompt-phase2c-1-v1.md` — Phase 2c.1 implementation
- `prompts/phase2-architecture-spec-v3.md` — roadmap

---

## Goal

Complete Phase 2c with the 2 remaining features:
1. **Loyalty Bonus** — milestone credits to portfolio at scheduled policy years
2. **Anchor Scenarios** — pick P25/P50/P75 scenarios by final value, return full trajectory data for Phase 2d table render

After Phase 2c.2:
- All Phase 2c features done
- Phase 2d data layer ready (table can be rendered without engine work)
- 5 metrics tracked end-to-end (admin, COI, PC, premium paid, **loyalty bonus**)

---

## 🔒 Decisions for Phase 2c.2 (locked — copied from `prompt-phase2c-v1.md`)

### Group C — Loyalty Bonus (full scope)

#### C1: Type per product ✅
`product.loyaltyBonus.type = 'milestone' | 'none'`

#### C2: Schedule rules schema ✅
```js
product.loyaltyBonus = {
  type: 'milestone',
  basis: 'first-year-premium-analytical',
  rules: [
    { atYear: N, pct: P },                              // single year
    { fromYear: A, toYear: B, every: K, pct: P },       // range with step
    { fromYear: A, every: K, pct: P },                  // open-ended (cap = coverage end)
  ]
}
```

**UL-99-99:**
```js
rules: [
  { atYear: 10, pct: 10 },
  { atYear: 20, pct: 20 },
  { atYear: 30, pct: 30 },
]
```

**UL-10-99:**
```js
rules: [
  { fromYear: 11, toYear: 15, every: 1, pct: 2  },
  { atYear: 16,                          pct: 10 },
  { fromYear: 21, every: 5,              pct: 20 },   // cap at coverage end
]
```

**INVESTMENT-ONLY:** `loyaltyBonus: { type: 'none' }` (already correct)

#### C3: First year premium = analytical ✅
```js
firstYearPremiumAnalytical = premium × paymentsPerYear
```

#### C4: Schedule cap = สิ้น coverage ✅
```js
maxYear = coverageMonths / 12
```

#### C5: Lapse handling ✅
ที่ milestone month: ตรวจ `if (lapseMonth === null)` ก่อน
- ถ้า lapsed ในเดือนก่อน → ไม่ได้ bonus
- ถ้า lapse THIS month จาก fees หลัง bonus → **ยังได้ bonus tracked** แต่ portfolio = 0

#### C6: Bonus credit = buy at offer ✅
ใช้ allocation ปัจจุบันของ user

#### C7: Bonus **ก่อน** applyFees ✅
Bonus เพิ่ม AUM → admin/COI คำนวณบน AUM ใหม่

#### C8: Trigger condition ✅
```js
if ((m + 1) % 12 === 0 && lapseMonth === null) {
  const yearJustEnded = (m + 1) / 12;
  const pct = scheduleMap.get(yearJustEnded);
  if (pct != null) { /* fire bonus */ }
}
```

### Group D (complete) — Tracking + Phase 2d aggregation

#### D2 (final): 5th metric ✅
- `monthlyYear1LoyaltyBonus[12]` + `yearlyLoyaltyBonus[Y]`

#### D3: Phase 2d aggregation = anchor scenario ✅
```js
const finalMonth = months - 1;
const activeAtEnd = [];
for (let s = 0; s < N; s++) {
  if (lapseMonths[s] === null || lapseMonths[s] > finalMonth) {
    activeAtEnd.push({ idx: s, final: allSeries[s][finalMonth] });
  }
}
activeAtEnd.sort((a, b) => a.final - b.final);

const pickAt = (p) => activeAtEnd[Math.floor(p * activeAtEnd.length)].idx;
const anchorIdx = { p25: pickAt(0.25), p50: pickAt(0.50), p75: pickAt(0.75) };
```

Each anchor includes:
```js
anchor = {
  idx, finalValue, lapseMonth,
  values: number[],              // monthly portfolio values
  yearlyAdminFee, yearlyCOI, yearlyPremiumCharge, yearlyPremiumPaid, yearlyLoyaltyBonus,
  monthlyYear1AdminFee, monthlyYear1COI, monthlyYear1PremiumCharge,
  monthlyYear1PremiumPaid, monthlyYear1LoyaltyBonus,
}
```

### Group E (complete)

#### E1 (final): 3 functions in fees.js ✅
```js
applyPremiumCharge   // Phase 2c.1
applyFees            // Phase 2c.1
applyLoyaltyBonus(portfolio, fundStats, allocation, bonusAmount, navPrices)  // NEW
expandLoyaltySchedule(rules, maxYear) → Map<year, pct>                       // NEW helper
```

#### E2 (final): feeParams shape with loyalty fields ✅
```js
feeParams: {
  // Phase 2c.1 (existing)
  adminFeeRate, premiumChargeRates, paymentsPerYear,
  coiTableId, coiBasis, coiLoading,
  sumAssured, userAge, gender,

  // Phase 2c.2 (NEW)
  loyaltyScheduleMap: Map<year, pct>,        // pre-expanded
  firstYearPremiumAnalytical: number,
}
```

#### E3 (final): Loop order with bonus inserted ✅
```
1. Premium → Premium Charge → buy at offer (netPremium)
2. Loyalty bonus → buy at offer (bonus, if milestone year-end)   [NEW]
3. Snapshot bidPrices
4. applyFees (admin + COI) → lapse?
5. Rebalance
6. Record value
7. Market shock
```

---

## Scope (Phase 2c.2 only)

### 1. แก้ `js/fees.js`

**Add helper (top of file or after applyPremiumCharge):**
```js
function expandLoyaltySchedule(rules, maxYear) {
  const map = new Map();
  for (const r of rules || []) {
    if (r.atYear != null) {
      if (r.atYear <= maxYear) map.set(r.atYear, r.pct);
    } else if (r.fromYear != null) {
      const to = r.toYear ?? maxYear;
      const step = r.every ?? 1;
      for (let y = r.fromYear; y <= to; y += step) {
        if (y <= maxYear) map.set(y, r.pct);
      }
    }
  }
  return map;
}
```

**Add applyLoyaltyBonus:**
```js
function applyLoyaltyBonus(portfolio, fundStats, allocation, bonusAmount, navPrices) {
  for (const f of Object.keys(allocation)) {
    const offerPrice = (navPrices[f] || 0) * (fundStats[f]?.offerRatio ?? 1);
    if (offerPrice > 0) {
      portfolio[f] += (bonusAmount * (allocation[f] || 0)) / offerPrice;
    }
  }
}
```

### 2. แก้ `js/products/ul-99-99.js`

```diff
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

### 3. แก้ `js/products/ul-10-99.js`

```diff
- loyaltyBonus: { type: "none" }
+ loyaltyBonus: {
+   type: 'milestone',
+   basis: 'first-year-premium-analytical',
+   rules: [
+     { fromYear: 11, toYear: 15, every: 1, pct: 2  },
+     { atYear: 16,                          pct: 10 },
+     { fromYear: 21, every: 5,              pct: 20 },
+   ]
+ }
```

### 4. แก้ `js/simulation.js`

#### 4.1 Insert bonus block + tracking
```js
// Add tracking arrays
const yearlyLoyaltyBonus       = new Array(yearsLen).fill(0);
const monthlyYear1LoyaltyBonus = new Array(12).fill(0);

// In scenario loop, AFTER premium block, BEFORE bidPrices snapshot:

// 2. Loyalty bonus (NEW)
if ((m + 1) % 12 === 0 && lapseMonth === null) {
  const yearJustEnded = (m + 1) / 12;
  const pct = feeParams.loyaltyScheduleMap?.get(yearJustEnded);
  if (pct != null) {
    const bonus = (feeParams.firstYearPremiumAnalytical || 0) * pct / 100;
    if (bonus > 0) {
      applyLoyaltyBonus(portfolio, fundStats, allocation, bonus, nav);
      yearlyLoyaltyBonus[yearJustEnded - 1] += bonus;
      if (m < 12) monthlyYear1LoyaltyBonus[m] = bonus;
    }
  }
}
```

#### 4.2 Return arrays from runScenario
```js
return {
  values, lapseMonth,
  totalAdminFee, totalCOI,                                            // Phase 2c.1
  yearlyAdminFee, yearlyCOI, yearlyPremiumCharge, yearlyPremiumPaid,  // Phase 2c.1
  yearlyLoyaltyBonus,                                                 // NEW
  monthlyYear1AdminFee, monthlyYear1COI, monthlyYear1PremiumCharge,
  monthlyYear1PremiumPaid,                                            // Phase 2c.1
  monthlyYear1LoyaltyBonus,                                           // NEW
};
```

#### 4.3 Anchor scenario logic in runMonteCarlo
```js
// Collect all per-scenario yearly + monthly Y1 arrays during MC loop
const allScenarioData = [];   // each entry = full runScenario return value

for (let i = 0; i < N; i++) {
  const result = runScenario({ ... });
  allScenarioData.push(result);
  // existing: allSeries.push(values), lapseMonths.push(lapseMonth), etc.
}

// After MC loop — pick anchors
const finalMonth = months - 1;
const activeAtEnd = [];
for (let s = 0; s < N; s++) {
  if (lapseMonths[s] === null || lapseMonths[s] > finalMonth) {
    activeAtEnd.push({ idx: s, final: allSeries[s][finalMonth] });
  }
}
activeAtEnd.sort((a, b) => a.final - b.final);

const pickAt = (p) => activeAtEnd.length > 0
  ? activeAtEnd[Math.min(activeAtEnd.length - 1, Math.floor(p * activeAtEnd.length))].idx
  : null;

const buildAnchor = (idx) => {
  if (idx == null) return null;
  const d = allScenarioData[idx];
  return {
    idx,
    finalValue: d.values[finalMonth],
    lapseMonth: d.lapseMonth,
    values: d.values,
    yearlyAdminFee: d.yearlyAdminFee,
    yearlyCOI: d.yearlyCOI,
    yearlyPremiumCharge: d.yearlyPremiumCharge,
    yearlyPremiumPaid: d.yearlyPremiumPaid,
    yearlyLoyaltyBonus: d.yearlyLoyaltyBonus,
    monthlyYear1AdminFee: d.monthlyYear1AdminFee,
    monthlyYear1COI: d.monthlyYear1COI,
    monthlyYear1PremiumCharge: d.monthlyYear1PremiumCharge,
    monthlyYear1PremiumPaid: d.monthlyYear1PremiumPaid,
    monthlyYear1LoyaltyBonus: d.monthlyYear1LoyaltyBonus,
  };
};

const anchorScenarios = {
  p25: buildAnchor(pickAt(0.25)),
  p50: buildAnchor(pickAt(0.50)),
  p75: buildAnchor(pickAt(0.75)),
};

return {
  // ... existing fields ...
  anchorScenarios,
  // existing p50AdminFee, p50COI, p50PremiumCharge can be derived from anchorScenarios.p50
  // OR keep for backward compat with Phase 2c.1 banner
};
```

**Memory note:** at N=10K, allScenarioData ≈ 100 MB. Acceptable but watch for OOM at N=50K+.

### 5. แก้ `js/app.js`

#### 5.1 Compute scheduleMap + add to feeParams
```js
const _intervals = { monthly: 12, quarterly: 4, 'semi-annual': 2, annual: 1 };
const _ppyear = _intervals[state.paymentMode] ?? 12;
const _firstYearPremium = state.premium * _ppyear;
const _maxYear = Math.ceil(simMonths / 12);
const _scheduleMap = (typeof expandLoyaltySchedule === 'function')
  ? expandLoyaltySchedule(_product?.loyaltyBonus?.rules ?? [], _maxYear)
  : new Map();

const baseConfig = {
  ...,
  feeParams: {
    // ... Phase 2c.1 fields ...
    loyaltyScheduleMap: _scheduleMap,
    firstYearPremiumAnalytical: _firstYearPremium,
  },
};
```

**Note:** `expandLoyaltySchedule` is global from fees.js (loaded before app.js via index.html). If app.js doesn't see it, check script order.

#### 5.2 Extend fee summary banner — 4 components
```js
function renderFeeSummary() {
  const r = state.results;
  const a = r?.anchorScenarios?.p50;
  if (!a) return '';

  const totalAdmin = a.yearlyAdminFee.reduce((s, v) => s + v, 0);
  const totalCOI   = a.yearlyCOI.reduce((s, v) => s + v, 0);
  const totalPC    = a.yearlyPremiumCharge.reduce((s, v) => s + v, 0);
  const totalBonus = a.yearlyLoyaltyBonus.reduce((s, v) => s + v, 0);
  const totalFee   = totalAdmin + totalCOI + totalPC;

  if (totalFee + totalBonus <= 0) return '';

  const totalPaid = state.premium * paymentCount();
  const feePct = totalPaid > 0 ? (totalFee / totalPaid * 100) : 0;

  return `
    <div class="planning-banner" style="background:#fef3c7;border-color:#f59e0b;margin-top:.5rem">
      <span class="planning-banner-icon">💰</span>
      <span>ค่าธรรมเนียมรวม (กรณี P50): <strong>${fmtTHB(totalFee)}</strong>
        (≈ ${feePct.toFixed(1)}% ของเบี้ยที่ชำระทั้งหมด)
        <br><small>
          • Admin: ${fmtTHB(totalAdmin)}
          • COI: ${fmtTHB(totalCOI)}
          • Premium charge: ${fmtTHB(totalPC)}
          ${totalBonus > 0 ? `• Loyalty bonus credited: <strong style="color:#16a34a">+${fmtTHB(totalBonus)}</strong>` : ''}
        </small></span>
    </div>
  `;
}
```

### 6. Update `tools/test-simulation.js`

**Suite 12 — Loyalty Bonus (8-10 tests):**
- 12.1 expandLoyaltySchedule: simple rules expand correctly
- 12.2 expandLoyaltySchedule: open-ended `fromYear+every` cap at maxYear
- 12.3 expandLoyaltySchedule: rule beyond maxYear excluded
- 12.4 milestone trigger: bonus credited at `(m+1)%12===0` AND year in map
- 12.5 lapse before milestone → no bonus credited
- 12.6 lapse THIS month from post-bonus fees → bonus tracked, portfolio=0
- 12.7 first-year-premium-analytical: monthly vs annual same bonus amount
- 12.8 schedule cap at coverageMonths/12 — no bonus past coverage end
- 12.9 totalLoyaltyBonus = sum of yearlyLoyaltyBonus
- 12.10 type='none' → no bonuses ever

**Suite 14 — Anchor scenarios (5-7 tests):**
- 14.1 anchors picked at correct rank within in-force-at-end
- 14.2 anchor.finalValue = corresponding scenario's values[months-1]
- 14.3 anchor includes all 5 yearly arrays + 5 monthly Y1 arrays + values[]
- 14.4 anchor selection skips lapsed scenarios
- 14.5 if all scenarios lapsed → all 3 anchors null
- 14.6 anchor P25.finalValue ≤ P50.finalValue ≤ P75.finalValue
- 14.7 anchor P50 yearlyAdminFee sum equals scenario's totalAdminFee

**Suite 13 (complete) — Yearly tracking 5th metric:**
- 13.5 yearlyLoyaltyBonus sum across years = total bonus credited
- 13.6 monthlyYear1LoyaltyBonus[m] populated only for milestones in year 1 (rare)

### 7. Update `CLAUDE.md`

**Invariants:** add
| Loyalty bonus credit | `applyLoyaltyBonus`, `loyaltyScheduleMap`, `expandLoyaltySchedule` | ✅ implemented (Phase 2c.2) |
| Anchor scenarios | `anchorScenarios.p25/p50/p75`, in-force at final month | ✅ implemented (Phase 2c.2) |

**Pitfalls:** add
- Loop order: bonus is between premium-buy and bidPrices-snapshot → bonus increases AUM before fees
- Bonus uses `firstYearPremiumAnalytical` (= premium × paymentsPerYear), not actual paid → mode-invariant
- expandLoyaltySchedule cap = `coverageMonths/12` (not simMonths/12)
- Anchor selection in-force filter: lapsed-at-end scenarios excluded; if too few in-force, anchors fall back to last in-force at given rank

---

## ห้ามทำใน Phase 2c.2

- ❌ ห้าม render Phase 2d sale illustration table — that's Phase 2d
- ❌ ห้ามแตะ Cholesky / regime / GBM math
- ❌ ห้ามลบ Phase 2c.1 features (PC + COI)
- ❌ ห้ามเปลี่ยน applyFees signature — finalised in 2c.1
- ❌ ห้าม include monthly arrays beyond year 1 (memory)
- ❌ ห้าม bonus mid-year (always at year-end m=11,23,...)

---

## Pre-check

```bash
cd /c/Users/.../phase2c-2   # worktree ใหม่จาก worktree-phase2c-1
pwd && git branch --show-current
git log --oneline -3        # ต้องเห็น Phase 2c.1 commit
git status                  # clean

# Phase 2c.1 invariants
grep -nE "applyPremiumCharge|coiBasis|yearlyAdminFee" js/fees.js js/simulation.js | head -10

# Tests baseline
node tools/test-simulation.js   # ~123 tests should pass

# Helpers from products/index.js still loaded in test VM
grep -n "vm.runInContext.*productsCode\|vm.runInContext.*products" tools/test-simulation.js
```

---

## Verification หลัง edit

```bash
# 1. fees.js — bonus + helper
grep -nE "applyLoyaltyBonus|expandLoyaltySchedule" js/fees.js

# 2. Product configs corrected
grep -nE "loyaltyBonus.*milestone|atYear|fromYear" js/products/ul-99-99.js js/products/ul-10-99.js

# 3. simulation.js — bonus block + anchors
grep -nE "applyLoyaltyBonus|loyaltyScheduleMap|anchorScenarios|yearlyLoyaltyBonus" js/simulation.js | head -10

# 4. Tests pass
node tools/test-simulation.js
# Expected: ~123 + ~17 new = 140+ tests pass

# 5. Browser cases:
#
# Case D: UL-99-99 อายุ 30 monthly 5000 อัลโลค UIDPLUS+KFAFIX-A 50/50
#   → P50 ใกล้เคียง Phase 2c.1 (admin+COI+PC เหมือนเดิม)
#   → Bonus เพิ่มที่ปี 10 (60K × 10% = 6K), ปี 20 (12K), ปี 30 (18K)
#   → yearlyLoyaltyBonus[9]=6000, [19]=12000, [29]=18000
#   → Banner แสดง 4 components (admin, COI, PC, bonus)
#   → Bonus total ≈ 36K (60% ของ first year premium)
#
# Case E: UL-10-99 อายุ 30 monthly 5000
#   → Bonus pattern ตรงตาม schedule (years 11-15: 2% each, 16: 10%, 21+ every 5: 20%)
#   → Bonus total = 2%×5 + 10% + 20%×N (N = milestones from year 21 to coverage end)
#   → For age 30 + coverage 99: years 21,26,31,36,41,46,51,56,61,66 = 10 milestones × 20% = 200%
#   → Total bonus rate = 220% × 60K = 132K
#
# Case F: เปรียบเทียบ Sale Illustration
#   → ตอนนี้ Phase 2d ยังไม่ render table แต่ data layer พร้อม
#   → Open browser console: state.results.anchorScenarios.p50 → inspect arrays
#   → Verify yearlyAdminFee + yearlyCOI + yearlyLoyaltyBonus ตรงกับ insurer doc

# 6. Invariant count post-2c.2
grep -cE "bidRatio|offerRatio|applyFees|adminFeeRate|lapseMonth|premiumChargeRates|coiBasis|loyaltyScheduleMap|yearlyAdminFee|yearlyCOI|yearlyLoyaltyBonus|anchorScenarios" js/simulation.js
# Expected: ~70+ (up from 60+ Phase 2c.1)
```

---

## รายงานผลลัพธ์

```
✅ Phase 2c.2 เสร็จแล้ว — Phase 2c COMPLETE
- applyLoyaltyBonus + expandLoyaltySchedule added in fees.js
- Bonus block wired in scenario loop between premium and bidPrices snapshot
- yearlyLoyaltyBonus + monthlyYear1LoyaltyBonus tracked
- Anchor scenarios { p25, p50, p75 } returned from runMonteCarlo (in-force at final month)
- Each anchor includes full trajectory: values[], 5 yearly arrays, 5 monthly Y1 arrays
- Product configs updated: loyalty schedules for UL-99-99 + UL-10-99
- 123 baseline + ~17 new tests pass
- Browser cases D, E pass; data layer ready for Phase 2d table render
- Files changed: simulation.js, app.js, fees.js, products/{ul-99-99,ul-10-99}.js, test-simulation.js, CLAUDE.md
```

---

## Success criteria

1. ✅ INVESTMENT-ONLY: ผลลัพธ์เหมือน Phase 2c.1 (no loyalty bonus, type='none')
2. ✅ UL-99-99: bonus credit ที่ปี 10/20/30 (10%/20%/30% ของ first year premium analytical)
3. ✅ UL-10-99: bonus pattern ตรง schedule (years 11-16 + every 5 from 21)
4. ✅ Loop order: bonus before fees (Suite 12.6 verifies)
5. ✅ anchorScenarios returned with full trajectory data
6. ✅ Banner แสดง 4 components incl. bonus

---

## Decisions parked for Phase 2d

- Sale illustration table HTML render (3 tables P25/P50/P75)
- Year-by-year row layout (12 monthly rows for year 1, 1 row per year after)
- Death benefit column display
- CSV export per table
- คปภ deterministic mode toggle (-1%/2%/5%)

---

## Notes for Claude in next session (Phase 2c.2 implementer)

- **Worktree:** สร้างใหม่จาก `worktree-phase2c-1` — ไม่ใช่ main / 2b
  ```bash
  git worktree add .claude/worktrees/phase2c-2 -b worktree-phase2c-2 worktree-phase2c-1
  ```
- **Bash session cwd pitfall:** `pwd && git branch --show-current` before destructive commands
- **Server cache pitfall:** verify `curl localhost:8080/js/fees.js | grep applyLoyaltyBonus` after edits
- **Recommended sequence:**
  1. Pre-check (Phase 2c.1 invariants intact)
  2. Add `expandLoyaltySchedule` to fees.js + Suite 12.1-12.3 (table tests)
  3. Add `applyLoyaltyBonus` to fees.js
  4. Update product configs (UL-99-99 + UL-10-99) → loyalty rules
  5. Wire bonus block in runScenario loop (between premium and snapshot)
  6. Add 5th metric tracking (yearlyLoyaltyBonus + monthlyYear1)
  7. Add Suite 12.4-12.10 (runtime tests) + Suite 13.5-13.6 (tracking)
  8. Add anchor scenario logic in runMonteCarlo
  9. Add Suite 14 (anchor tests)
  10. Update app.js feeParams (loyaltyScheduleMap + firstYearPremiumAnalytical)
  11. Extend fee summary banner with 4th component (bonus row)
  12. Browser test cases D, E — verify bonus pattern matches schedule
  13. Update CLAUDE.md (invariants + pitfalls)
  14. Local commit (no push, no merge)
- **Decisions C1-C8, D (final), E (final) ตอบเสร็จแล้ว** — edge case → ถาม user
- **Memory budget:** anchor data = N × full trajectory ≈ 100 MB at N=10K. ดี — แต่ระวัง if user runs N=50K+
- **Phase 2d will use:** `state.results.anchorScenarios` to render tables. Don't implement table here.
