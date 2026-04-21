# Phase 2a: Product Config Foundation (v5)

**Version:** 5 — reflects discovery that seeded PRNG + delta rebalancing already exist in codebase

Changes from v4:
- Note: seeded PRNG already exists (commit 3d3ec00) — no need to build in Phase 2a.5
- Note: delta rebalancing already exists (commit 17da9a1) — properly documented
- Invariants baseline is ~41 hits (not 31 as previously stated — 31 was incorrect count from early Phase 1)
- Phase 2a still does NOT touch simulation.js — invariant count must remain unchanged (whatever it is currently)

Goal: สร้าง product config system + UI plumbing สำหรับ Step 2 โดย **ไม่แตะ simulation.js** และ**ไม่แตะ applyFees() hook** — ผลลัพธ์ simulation ต้องเหมือน Phase 1 ทุกครั้ง

## Reference
อ่าน `docs/phase2-architecture-spec.md` ก่อน — เป็น design doc ของ Phase 2 ทั้งหมด

---

## Scope

### 1. สร้าง products directory + 3 products + COI table

```
js/products/
├── index.js              (exports PRODUCTS map + helpers)
├── investment-only.js    (Phase 1 equivalent — zero fees)
├── ul-99-99.js           (whole life — PPT = coverage = 99)
├── ul-10-99.js           (limited pay — PPT 10 ปี, coverage 99)
└── coi-tables.js         (Thai Mortality 2560 ordinary table + conversion helpers)
```

#### investment-only.js

```js
export default {
  id: "INVESTMENT-ONLY",
  name: "การลงทุนล้วน",
  displayName: "จำลองการลงทุนล้วน (ไม่มีค่าธรรมเนียมประกัน)",
  versionDate: "phase1-legacy",
  sourceDoc: null,
  term: {
    premiumPaymentYears: null,
    coverage: { type: "userChosen", value: null }
  },
  sumAssured: { type: "fixed-multiple", multiplier: 0 },
  premiumCharge: { type: "year-based", rates: { "1+": 0 } },
  adminFee: { type: "none", rate: 0 },
  coi: { basis: "sa", tableId: "none", loadingFactor: 0 },
  loyaltyBonus: { type: "none" }
}
```

#### ul-99-99.js (whole life)

```js
export default {
  id: "UL-99-99",
  name: "99/99 UL",
  displayName: "99/99 UL (Whole Life)",
  versionDate: "2024-placeholder",
  sourceDoc: "placeholder",
  term: {
    premiumPaymentYears: 99,
    coverage: { type: "endAge", value: 99 }
  },
  sumAssured: {
    type: "user-selectable",
    unit: "multiplier-of-annual-premium",
    appliesAt: "current-age",
    ranges: [
      { ageMin: 0,  ageMax: 20, male: { min: 60, max: 200 }, female: { min: 60, max: 250 } },
      { ageMin: 21, ageMax: 30, male: { min: 60, max: 140 }, female: { min: 60, max: 250 } },
      { ageMin: 31, ageMax: 35, male: { min: 55, max: 120 }, female: { min: 55, max: 230 } },
      { ageMin: 36, ageMax: 40, male: { min: 40, max: 100 }, female: { min: 40, max: 190 } },
      { ageMin: 41, ageMax: 45, male: { min: 30, max: 80  }, female: { min: 30, max: 150 } },
      { ageMin: 46, ageMax: 50, male: { min: 25, max: 55  }, female: { min: 25, max: 110 } },
      { ageMin: 51, ageMax: 55, male: { min: 20, max: 35  }, female: { min: 20, max: 55  } },
      { ageMin: 56, ageMax: 60, male: { min: 15, max: 25  }, female: { min: 15, max: 40  } },
      { ageMin: 61, ageMax: 65, male: { min: 8,  max: 15  }, female: { min: 8,  max: 25  } },
      { ageMin: 66, ageMax: 70, male: { min: 8,  max: 9   }, female: { min: 8,  max: 10  } }
    ]
  },
  premiumCharge: {
    type: "year-based",
    // Deducted on EVERY premium payment (not just at year boundary).
    // Policy year = based on payment count, not calendar time:
    //   Monthly (12/yr):   payments 1-12 = yr 1, 13-24 = yr 2, ...
    //   Quarterly (4/yr):  payments 1-4  = yr 1, 5-8   = yr 2, ...
    //   Annual (1/yr):     payment  1    = yr 1, 2     = yr 2, ...
    // Total % charge in policy year N equals annual premium × rate[N],
    // regardless of payment frequency.
    // Years not in rates table default to 0%.
    rates: { 1: 0.55, 2: 0.40, 3: 0.20, 4: 0.10, 5: 0.05 }
  },
  adminFee: {
    type: "percent-of-aum-monthly",
    rate: 0.000583                    // 0.0583% per month (≈0.70% annualized)
  },
  coi: {
    basis: "nar",                     // NAR = max(0, SA - AUM)
    tableId: "thai-mortality-2560-ordinary",
    loadingFactor: 1.0,               // ⚠️ PLACEHOLDER — pending insurer confirmation
    conversionMethod: "constant-force"
  },
  loyaltyBonus: { type: "none" }      // maturity = final AUM (no special bonus logic)
}
```

#### ul-10-99.js (limited pay)

```js
// Same as ul-99-99.js EXCEPT:
//   id: "UL-10-99"
//   name: "10/99 UL"
//   displayName: "10/99 UL (Limited Pay)"
//   term.premiumPaymentYears: 10
// All other fields identical to ul-99-99.js
```

#### coi-tables.js (FULL POPULATION)

```js
// Thai Mortality Table 2560 (TMO17) — Ordinary (สามัญ) — No Margin
// Source: สมาคมนักคณิตศาสตร์ประกันภัยแห่งประเทศไทย (SOAT)
// URL: https://soat.or.th/uploads/mortality_table_2560.pdf
// Values: annual qx per 1,000 (อัตรามรณะต่อปี ต่อจำนวน 1,000 คน)

export const COI_TABLES = {
  "none": {
    source: null,
    male: {},
    female: {}
  },
  "thai-mortality-2560-ordinary": {
    source: "สมาคมนักคณิตศาสตร์ประกันภัยแห่งประเทศไทย (SOAT)",
    sourceUrl: "https://soat.or.th/uploads/mortality_table_2560.pdf",
    unit: "annual_qx_per_1000_no_margin",
    male: {
      0: 1.3208, 1: 0.2705, 2: 0.2613, 3: 0.2521, 4: 0.2430,
      5: 0.2338, 6: 0.2246, 7: 0.2154, 8: 0.2149, 9: 0.1820,
      10: 0.2077, 11: 0.2777, 12: 0.3791, 13: 0.5005, 14: 0.6322,
      15: 0.7657, 16: 0.8942, 17: 1.0124, 18: 1.1165, 19: 1.2040,
      20: 1.2743, 21: 1.3280, 22: 1.3673, 23: 1.3960, 24: 1.4196,
      25: 1.4368, 26: 1.4514, 27: 1.4674, 28: 1.4886, 29: 1.5183,
      30: 1.5586, 31: 1.6107, 32: 1.6747, 33: 1.7501, 34: 1.8358,
      35: 1.9307, 36: 2.0338, 37: 2.1451, 38: 2.2649, 39: 2.3942,
      40: 2.5348, 41: 2.6888, 42: 2.8585, 43: 3.0462, 44: 3.2543,
      45: 3.4846, 46: 3.7386, 47: 4.0174, 48: 4.3215, 49: 4.6514,
      50: 5.0075, 51: 5.3909, 52: 5.8038, 53: 6.2505, 54: 6.7375,
      55: 7.2739, 56: 7.8713, 57: 8.5426, 58: 9.3015, 59: 10.1621,
      60: 11.1381, 61: 12.2434, 62: 13.4927, 63: 14.9020, 64: 16.4902,
      65: 18.2798, 66: 20.2984, 67: 22.5797, 68: 25.1631, 69: 28.0915,
      70: 31.4089, 71: 35.1557, 72: 39.3650, 73: 44.0585, 74: 49.2451,
      75: 54.9201, 76: 61.0680, 77: 67.6655, 78: 74.6857, 79: 82.1014,
      80: 89.8893, 81: 98.0345, 82: 106.5369, 83: 115.4175, 84: 124.7211,
      85: 134.5142, 86: 144.8791, 87: 155.9076, 88: 170.3675, 89: 186.1685,
      90: 203.4350, 91: 222.3030, 92: 242.9208, 93: 265.4509, 94: 287.7722,
      95: 311.5438, 96: 336.7781, 97: 363.4698, 98: 391.5927, 99: 1000.0000
    },
    female: {
      0: 1.0585, 1: 0.2333, 2: 0.2280, 3: 0.2227, 4: 0.2175,
      5: 0.2122, 6: 0.2069, 7: 0.2016, 8: 0.2046, 9: 0.2128,
      10: 0.2232, 11: 0.2356, 12: 0.2496, 13: 0.2651, 14: 0.2815,
      15: 0.2983, 16: 0.3152, 17: 0.3317, 18: 0.3477, 19: 0.3629,
      20: 0.3774, 21: 0.3911, 22: 0.4041, 23: 0.4163, 24: 0.4280,
      25: 0.4392, 26: 0.4502, 27: 0.4612, 28: 0.4728, 29: 0.4854,
      30: 0.4998, 31: 0.5166, 32: 0.5368, 33: 0.5611, 34: 0.5904,
      35: 0.6255, 36: 0.6668, 37: 0.7150, 38: 0.7701, 39: 0.8326,
      40: 0.9024, 41: 0.9798, 42: 1.0648, 43: 1.1574, 44: 1.2576,
      45: 1.3655, 46: 1.4816, 47: 1.6069, 48: 1.7430, 49: 1.8927,
      50: 2.0594, 51: 2.2473, 52: 2.4608, 53: 2.7044, 54: 2.9825,
      55: 3.2988, 56: 3.6568, 57: 4.0603, 58: 4.5136, 59: 5.0228,
      60: 5.5964, 61: 6.2463, 62: 6.9888, 63: 7.8450, 64: 8.8415,
      65: 10.0098, 66: 11.3864, 67: 13.0107, 68: 14.9239, 69: 17.1660,
      70: 19.7730, 71: 22.7740, 72: 26.1888, 73: 30.0267, 74: 34.2878,
      75: 38.9651, 76: 44.0499, 77: 49.5364, 78: 55.4271, 79: 61.7360,
      80: 68.4894, 81: 75.7265, 82: 83.4974, 83: 91.8619, 84: 100.8872,
      85: 110.6464, 86: 121.2165, 87: 132.6760, 88: 146.8471, 89: 162.5318,
      90: 179.8918, 91: 199.1061, 92: 220.3726, 93: 243.9106, 94: 267.8928,
      95: 293.7395, 96: 321.4867, 97: 351.1441, 98: 382.6892, 99: 1000.0000
    }
  }
}

/**
 * Get annual qx (per 1,000) from table
 * Returns null if table/age/gender not found
 */
export function getAnnualQx(tableId, age, gender) {
  const table = COI_TABLES[tableId]
  if (!table) return null
  const genderTable = table[gender]
  if (!genderTable) return null
  const value = genderTable[age]
  return value != null ? value : null
}

/**
 * Convert annual qx to monthly qx using constant force of mortality
 * Formula: monthly_qx = 1 - (1 - annual_qx)^(1/12)
 *
 * @param annualQxPer1000  annual qx × 1000 (as stored in tables)
 * @returns monthly qx × 1000 (same unit convention)
 */
export function annualToMonthlyQx(annualQxPer1000) {
  const annualQx = annualQxPer1000 / 1000
  if (annualQx >= 1) return 1000  // edge case: age 99 terminal
  const monthlyQx = 1 - Math.pow(1 - annualQx, 1/12)
  return monthlyQx * 1000
}

/**
 * Get monthly COI rate (per 1,000 NAR) for a given product
 * Applies loading factor from product config
 *
 * @returns COI rate per 1,000 NAR per month, or null if lookup fails
 */
export function getMonthlyCOIRate(product, age, gender) {
  if (product.coi.tableId === "none") return 0
  const annualQx = getAnnualQx(product.coi.tableId, age, gender)
  if (annualQx == null) return null
  const monthlyQx = annualToMonthlyQx(annualQx)
  return monthlyQx * (product.coi.loadingFactor ?? 1.0)
}
```

#### index.js

```js
import investmentOnly from './investment-only.js'
import ul9999 from './ul-99-99.js'
import ul1099 from './ul-10-99.js'
export { COI_TABLES, getAnnualQx, annualToMonthlyQx, getMonthlyCOIRate } from './coi-tables.js'

export const PRODUCTS = {
  [investmentOnly.id]: investmentOnly,
  [ul9999.id]: ul9999,
  [ul1099.id]: ul1099
}

export function getProduct(id) {
  return PRODUCTS[id] || null
}

export function listProducts() {
  return Object.values(PRODUCTS)
}

export function isInvestmentOnly(product) {
  return product.id === "INVESTMENT-ONLY"
}

// Coverage duration in months (null if user-chosen)
export function getCoverageMonths(product, userAge) {
  if (isInvestmentOnly(product)) return null
  const cov = product.term.coverage
  if (cov.type === "endAge") return (cov.value - userAge) * 12
  if (cov.type === "years") return cov.value * 12
  return null
}

// Premium payment term in months (null if user-chosen)
export function getPremiumPaymentMonths(product, userAge) {
  if (isInvestmentOnly(product)) return null
  const ppt = product.term.premiumPaymentYears
  if (ppt == null) return null
  // For whole life (PPT 99): PPT months = (99 - userAge) × 12
  // For limited pay (PPT 10): PPT months = 10 × 12
  if (product.id === "UL-99-99") return (ppt - userAge) * 12
  return ppt * 12
}

// SA range for validation UI
export function getSAMultiplierRange(product, age, gender) {
  if (product.sumAssured.type !== "user-selectable") return null
  const band = product.sumAssured.ranges.find(
    r => age >= r.ageMin && age <= r.ageMax
  )
  if (!band) return null
  return band[gender]
}

// Validation (for initial purchase AND future What-if in Phase 2e)
export function validateSAMultiplier(product, age, gender, multiplier) {
  if (product.sumAssured.type !== "user-selectable") {
    return { valid: true }
  }

  const range = getSAMultiplierRange(product, age, gender)
  if (!range) {
    return { valid: false, reason: "อายุเกินเงื่อนไขการรับประกัน" }
  }
  if (multiplier == null || multiplier === '' || isNaN(multiplier)) {
    return { valid: false, reason: "กรุณากรอกตัวคูณความคุ้มครอง" }
  }
  const genderLabel = gender === 'male' ? 'ชาย' : 'หญิง'
  if (multiplier < range.min) {
    return { valid: false, reason: `ต่ำกว่าขั้นต่ำ (${range.min}× สำหรับอายุ ${age} ${genderLabel})` }
  }
  if (multiplier > range.max) {
    return { valid: false, reason: `สูงกว่าขั้นสูง (${range.max}× สำหรับอายุ ${age} ${genderLabel})` }
  }
  return { valid: true }
}

// Compute Sum Assured from multiplier and annual premium
export function computeSumAssured(product, annualPremium, userAge, userMultiplier) {
  const sa = product.sumAssured
  if (sa.type === "fixed-multiple") {
    return sa.multiplier * annualPremium
  }
  if (sa.type === "user-selectable") {
    if (userMultiplier == null || userMultiplier === '') return null
    return userMultiplier * annualPremium
  }
  return 0
}
```

---

### 2. แก้ UI ใน Step 2

#### 2.1 เพิ่ม card "ข้อมูลกรมธรรม์" เป็น card แรกของ Step 2

```html
<div class="card" id="policyInfoCard">
  <h3 class="card-title">📄 ข้อมูลกรมธรรม์</h3>

  <div class="row">
    <label>เลือกกรมธรรม์:
      <select id="productSelect">
        <!-- populated from PRODUCTS on load -->
      </select>
    </label>
  </div>

  <!-- Shown only for UL products (hidden for INVESTMENT-ONLY) -->
  <div id="policyholderInputs" style="display:none">
    <div class="row">
      <label>อายุผู้เอาประกัน:
        <input type="number" id="userAge" min="0" max="70" value="30" />
      </label>
      <label>เพศ:
        <label><input type="radio" name="gender" value="male" checked /> ชาย</label>
        <label><input type="radio" name="gender" value="female" /> หญิง</label>
      </label>
    </div>

    <!-- Shown only for user-selectable SA products -->
    <div class="row" id="saInputRow" style="display:none">
      <label>ตัวคูณความคุ้มครอง (Sum Assured):
        <input type="number" id="saMultiplier" placeholder="" min="1" step="1" />
        <span>× เบี้ยรายปี</span>
      </label>

      <p class="hint" id="saHint">
        <!-- "กรอกตัวเลข 60-140 สำหรับอายุ 30 ชาย" -->
      </p>

      <p class="computed" id="saComputed" style="display:none">
        <!-- "Sum Assured = ฿3,600,000" -->
      </p>

      <p class="error" id="saError" style="display:none">
        <!-- Validation errors -->
      </p>
    </div>

    <!-- Info block: PPT + simulation duration + total premium -->
    <div class="info-block" id="productInfo"></div>
  </div>

  <!-- Fee summary (read-only, for transparency) -->
  <details id="feeSummary" style="display:none">
    <summary>รายละเอียดค่าธรรมเนียม</summary>
    <div id="feeDetails"></div>
  </details>
</div>
```

**Fee details rendering (for UL products):**

```js
function renderFeeDetails(product) {
  if (isInvestmentOnly(product)) {
    feeSummaryEl.style.display = 'none'
    return
  }
  feeSummaryEl.style.display = ''

  const rates = product.premiumCharge.rates
  const premChargeDisplay = Object.entries(rates)
    .map(([year, rate]) => `ปี ${year}: ${(rate * 100).toFixed(0)}%`)
    .join(', ')

  feeDetailsEl.innerHTML = `
    <p><strong>Premium Charge:</strong> ${premChargeDisplay} (ปีอื่นไม่มี)</p>
    <p><strong>Admin Fee:</strong> ${(product.adminFee.rate * 100).toFixed(4)}% ต่อเดือน ของ AUM</p>
    <p><strong>COI:</strong> ${product.coi.tableId} (basis: ${product.coi.basis}, loading: ${product.coi.loadingFactor}×)</p>
    <p class="hint">⚠️ COI loading factor = 1.0 (placeholder) — pending insurer confirmation</p>
  `
}
```

#### 2.2 Modify card "ระยะเวลาลงทุน" (existing)

- **เปลี่ยน heading** จาก "ระยะเวลาลงทุน" → **"ระยะเวลา"**
- **If product = INVESTMENT-ONLY:** แสดงตามเดิม (5/10/20 ปี selector ทำงานเหมือน Phase 1)
- **If product = UL:** ซ่อน card นี้ทั้งหมด

#### 2.3 SA Input Behavior (dynamic)

เมื่อ user:
1. **เปลี่ยน product** → update saInputRow visibility, reset state.product.sumAssuredMultiplier เป็น null
2. **เปลี่ยนอายุหรือเพศ** → recompute saHint
3. **กรอก multiplier** → validate realtime
4. **อายุเกิน 70** → saHint shows "อายุเกินเงื่อนไขการรับประกัน", disable saMultiplier input

**Default value:** Empty (intentional — ไม่ให้ tool suggest ค่า)

---

### 3. State additions

```js
state.product = {
  id: "INVESTMENT-ONLY",
  age: 30,
  gender: "male",
  sumAssuredMultiplier: null
}
```

---

### 4. Wire product selection → simulation config

เมื่อ user เปลี่ยน product dropdown:
- Update `state.product.id`
- Re-render UI (show/hide SA input row, duration card, info block, fee details)
- **Reset `state.product.sumAssuredMultiplier = null`** (prevent stale values)
- Re-validate current state

เมื่อ user รัน simulation:
- Pass `state.product` to `runMonteCarlo()` config as `config.product = state.product`
- `runMonteCarlo()` **ไม่ต้องใช้** field นี้ใน Phase 2a (ส่งผ่านเพื่อ Phase 2b)
- ผลลัพธ์ simulation ต้อง**เหมือนเดิม 100%**

---

### 5. Validation before running simulation

```js
function canRunSimulation() {
  const product = getProduct(state.product.id)
  if (product.sumAssured.type === "user-selectable") {
    const validation = validateSAMultiplier(
      product,
      state.product.age,
      state.product.gender,
      state.product.sumAssuredMultiplier
    )
    if (!validation.valid) return false
  }
  return true
}
```

Disable "ถัดไป" button on Step 2 เมื่อ `canRunSimulation() === false`

---

## สิ่งที่ห้ามทำ

- ❌ ห้ามแตะ `js/simulation.js` โดยเด็ดขาด (รอ Phase 2a.5)
- ❌ ห้ามแตะ `applyFees()` (ยังเป็น no-op)
- ❌ ห้ามใช้ product config ทำให้ simulation logic เปลี่ยน
- ❌ ห้ามลบ Phase 1 features
- ❌ ห้าม rewrite function ทั้งก้อน (str_replace เฉพาะจุด)
- ❌ ห้าม commit CLAUDE.md update ใน phase นี้
- ❌ ห้ามใส่ default value ให้ SA multiplier field (ต้องเป็น empty)

---

## Pre-check

```bash
git status
# Clean working tree (หรือเฉพาะ docs/prompts commits)

# Snapshot invariant count BEFORE any changes — this becomes our baseline
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
# Note the number returned. It should be ~41 based on current codebase.
# Whatever the number is, it MUST remain unchanged after Phase 2a edits.

grep -n "runMonteCarlo\|state\." js/app.js | head -30
grep -n "ระยะเวลาลงทุน\|การจัดสรร\|Asset Allocation" index.html
ls js/products/ 2>/dev/null
```

**Important:** The exact hit count is less important than the principle — **it must NOT change**. Phase 2a does not touch `js/simulation.js` at all, so the count should be identical before and after.

**สรุปแผนก่อนเริ่ม:**
1. Step 2 มี card ไหนบ้าง จะ insert "ข้อมูลกรมธรรม์" ตรงไหน
2. state object ปัจจุบันมี field อะไร
3. `runMonteCarlo()` รับ config อะไร จะเพิ่ม config.product ยังไง
4. Validation hook ของ "ถัดไป" button อยู่ที่ไหน

**รออนุมัติก่อนเริ่ม edit**

---

## Verification หลัง edit

```bash
# 1. Products directory
ls js/products/
# ต้องมี: index.js, investment-only.js, ul-99-99.js, ul-10-99.js, coi-tables.js

# 2. COI table populated
grep -c "^      [0-9]*:" js/products/coi-tables.js
# ควรเจอ ~200 hits (100 entries × 2 genders)

# 3. Spot check COI values
grep -E "30: 1.5586|50: 5.0075|99: 1000" js/products/coi-tables.js
# ต้องเจอ 2+ hits (verify key values from TMO2560 present)

# 4. Exports
grep -n "export" js/products/*.js

# 5. state.product wiring
grep -n "state.product" js/app.js

# 6. UI elements
grep -n "productSelect\|userAge\|saMultiplier\|productInfo\|saHint\|saComputed\|saError" index.html

# 7. Invariants simulation.js unchanged
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
# ต้องเท่ากับตัวเลขที่ snapshot ไว้ใน pre-check (ไม่เปลี่ยน)

# 8. simulation.js NOT in diff
git diff --stat js/simulation.js
# ต้องว่างเปล่า

# 9. Tests pass
node tools/test-simulation.js
# ต้อง 78/78 pass

# 10. Console smoke test in browser:
# เปิด dev console แล้วลอง:
#   import { getMonthlyCOIRate, getProduct } from './js/products/index.js'
#   const product = getProduct('UL-99-99')
#   getMonthlyCOIRate(product, 30, 'male')
#   // Expected: ~0.1299 (monthly qx per 1000 for male age 30, loading 1.0)
#   //   annual qx 1.5586/1000 = 0.0015586
#   //   monthly = 1 - (1 - 0.0015586)^(1/12) ≈ 0.0001299
#   //   × 1000 = 0.1299
#   //   × loading 1.0 = 0.1299

# 11. Browser tests — 7 cases:
#
# Case A: Default → INVESTMENT-ONLY
#   - Card "ระยะเวลา" แสดง (5/10/20)
#   - policyholderInputs ซ่อน
#   - feeSummary ซ่อน
#   - รัน simulation → ผลเหมือน Phase 1
#
# Case B: เลือก UL-99-99 + age 30 + male + blank SA
#   - Card "ระยะเวลา" ซ่อน
#   - policyholderInputs แสดง
#   - saHint: "กรอกตัวเลข 60-140 สำหรับอายุ 30 ชาย"
#   - Info: PPT 69 ปี, sim 69 ปี (สำหรับ 99/99 UL: PPT = 99-30 = 69)
#   - feeSummary แสดง รายละเอียด fees + warning เรื่อง loading placeholder
#   - ปุ่ม "ถัดไป" disabled
#
# Case C: Case B + กรอก 100
#   - saComputed: "Sum Assured = ฿..." (คำนวณจาก annual premium)
#   - ปุ่ม "ถัดไป" enabled
#   - รัน simulation → ผลยังเหมือน Phase 1 (applyFees no-op)
#
# Case D: Case C + เปลี่ยนเป็น 200 (เกิน max 140)
#   - saError: "สูงกว่าขั้นสูง (140×..."
#   - saComputed ซ่อน
#   - ปุ่ม disabled
#
# Case E: เลือก UL-10-99 + age 30
#   - Info: PPT 10 ปี (อายุ 30-40), sim 69 ปี (อายุ 30-99)
#   - PPT ≠ sim → 2 บรรทัดแยกกันชัดเจน
#
# Case F: เลือก UL-99-99 + age 75
#   - saHint: "อายุเกินเงื่อนไขการรับประกัน"
#   - saMultiplier disabled
#   - ปุ่ม disabled
#
# Case G: สลับ UL-99-99 (has multiplier) → INVESTMENT-ONLY → UL-99-99
#   - Multiplier กลับมาเป็น empty (ไม่ stale)
#
# Case H: Payment frequency preservation
#   - เลือก UL-99-99 → payment frequency card (เบี้ยรายเดือน/ไตรมาส/ปี) ต้องยังแสดง
#   - user เปลี่ยน frequency ได้ปกติ (เหมือน Phase 1)
#   - Premium payment frequency และ rebalancing frequency ต้องแยกกันชัดเจน
#     (payment frequency = user เลือก; rebalancing = tool แนะนำอัตโนมัติ 4 frequencies)
```

---

## รายงานผลลัพธ์

```
✅ เสร็จแล้ว — verified:
- Products: 4 files created (investment-only, ul-99-99, ul-10-99, coi-tables)
- PRODUCTS registry: 3 products loaded
- COI table: 200 entries populated (TMO2560 ordinary, male+female, ages 0-99)
- Spot checks: age 30 male=1.5586 ✓, age 50 male=5.0075 ✓, age 99 terminal=1000 ✓
- Helpers in coi-tables.js: getAnnualQx, annualToMonthlyQx, getMonthlyCOIRate
- Helpers in index.js: getProduct, listProducts, isInvestmentOnly, getCoverageMonths,
  getPremiumPaymentMonths, getSAMultiplierRange, validateSAMultiplier, computeSumAssured
- state.product wired at app.js L.XX
- UI elements in index.html: L.AA-BB
- Invariants simulation.js: N hits (unchanged — matches pre-check snapshot)
- git diff --stat: js/simulation.js NOT in list
- Test: 78/78 pass
- Console smoke test: getMonthlyCOIRate(UL-99-99, 30, male) returned X.XXXX (expected ~0.1299)
- Browser cases A-H: ผ่านทั้งหมด (หรือรายงานปัญหา)
```

---

## Success criteria

**Phase 2a เสร็จเมื่อ:**
1. เปลี่ยน product → UI update
2. **ผลลัพธ์ simulation เหมือน Phase 1 ทุกครั้ง** (เพราะ applyFees() ยังเป็น no-op)
3. COI table populated ครบ 200 entries พร้อม helpers
4. Helpers ทุกตัวสามารถ call จาก console ได้ถูก

**ถ้าผลลัพธ์ simulation เปลี่ยน = bug** — แปลว่าไปแตะ simulation path โดยไม่ตั้งใจ

---

## Decisions recap

- **Grandfather SA validation:** check ที่จุด action (entry + What-if) ไม่ใช่ตอน hold
- **No default SA multiplier:** user กรอกเอง (intentional UX)
- **Card name "ระยะเวลา"** (ไม่ใช่ "ระยะเวลาจ่ายเบี้ย" หรือ "ระยะเวลาลงทุน")
- **UL products ซ่อน card "ระยะเวลา"** — PPT + sim duration แสดงเป็น info ใน "ข้อมูลกรมธรรม์"
- **COI loading factor = 1.0 (placeholder)** — ต้อง update ตอนได้ค่าจริงจาก insurer
- **COI conversion:** constant force of mortality (1 - (1-qx)^(1/12))
- **COI basis:** NAR = max(0, SA - AUM)
- **Admin fee:** 0.0583% ของ AUM ต่อเดือน (ไม่ใช่ fixed amount)
- **Premium charge:** ปี 1-5 มี rate, ปี 6+ ไม่มี
- **Premium charge deduction:** หักทุกครั้งที่จ่ายเบี้ย (monthly → 12 deductions/yr at yr-1 rate, quarterly → 4, annual → 1); policy year = payment count-based
- **Payment frequency:** UL products ให้ user เลือก monthly/quarterly/annual (preserve Phase 1 UX); แยกเด็ดขาดจาก rebalancing frequency (tool แนะนำอัตโนมัติ)
- **Admin fee + COI:** คำนวณพร้อมกันจาก AUM snapshot เดียวกัน (หลัง premium top-up)

ทำตาม CLAUDE.md: verify ทุก claim ด้วย grep, สรุปแผนรอไฟเขียว, str_replace เฉพาะจุด
