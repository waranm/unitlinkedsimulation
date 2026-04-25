# Phase 2b: Admin Fee + Lapse Detection (v1 — decisions locked)

**Prerequisite:** Phase 2a และ Phase 2a.5 merged เข้า main แล้ว
- product registry + COI table + UI plumbing (2a)
- term handling: simMonths + premiumPaymentMonths (2a.5)
- `state.lastRun = { seed, pptMonths }` พร้อมใช้

**Reference:** `prompts/phase2-architecture-spec-v3.md` — โดยเฉพาะส่วน "Monthly fee timing"

---

## Goal

แทนที่ `applyFees()` ที่เป็น no-op ด้วย admin fee จริง + เพิ่ม lapse detection — **ครั้งแรกที่ fees กระทบผลลัพธ์ simulation**

หลัง Phase 2b:
- INVESTMENT-ONLY: ผลลัพธ์เหมือนเดิม (admin fee rate = 0)
- UL products: AUM ลดลงเดือนละ 0.0583% ของ AUM ; ถ้า AUM ≤ 0 → scenario lapse

---

## 🔒 Decisions (locked — ไม่ต้อง re-discuss)

### D1: Reorder scenario loop ตาม spec timing ✅

ลำดับใหม่ใน `runScenario` for-loop:

```
for m in 0..months:
  if (lapsed) {
    values[m] = 0    // post-lapse marker; percentile จะ filter ออกอยู่แล้ว
    continue
  }

  # 1. Premium received (if premium month & within PPT)
  if (premiumMonths.has(m)) {
    # (Phase 2c: applyPremiumCharge เกิดตรงนี้ — ลด premium ก่อน buy)
    # Buy units at OFFER price (asymmetric vs bid)
    for each fund: portfolio[f] += (premium × allocation[f]) / offerPrice[f]
  }

  # 2. SNAPSHOT AUM at BID (after premium top-up, before fee/market)
  aumSnapshot = sum(portfolio[f] × nav[f] × bidRatio[f])

  # 3. applyFees() — admin fee (Phase 2c จะเพิ่ม COI)
  { adminFee, lapsed } = applyFees(portfolio, nav, feeParams, m)
  if (lapsed) {
    lapseMonth = m
    values[m] = 0
    continue
  }

  # 4. Rebalance if scheduled
  if (shouldRebalance) rebalance(...)

  # 5. Record value at BID
  values[m] = sum(portfolio[f] × nav[f] × bidRatio[f])

  # 6. Market shock — NAV update for next month's open
  for each fund: nav[f] *= exp(mu + correlated_shock)
```

**สำคัญ:** Buy ใช้ **offer**, valuation/snapshot ใช้ **bid** — invariant Phase 1 ที่ต้องไม่หาย

**Tests impact:** Reorder อาจเปลี่ยนค่า P50/P75 เพราะ market shock ย้ายไปท้าย loop — ถ้า test เดิมเป็น exact-value test และ fail หลัง reorder ต้อง trace ดูว่า tolerance หรือ reorder ที่ผิด

### D2: Pro-rata fee deduction ตาม allocation ของทุกกอง ✅

```js
ratio = totalFee / aumSnapshot
for each fund: portfolio[f] *= (1 - ratio)
```

ครอบคลุม admin fee (Phase 2b) + COI (Phase 2c) — ทั้งคู่หักจาก AUM แบบ pro-rata เดียวกัน

**Premium charge** = **คนละกลไก** — หักจากเบี้ยก่อน buy (Phase 2c) ไม่ใช่จาก AUM

**Future parking lot (ไม่ใช่ Phase 2b):** optional "fee bucket mode" หักจากกอง money market dedicated

### D3: Percentile filter เฉพาะ in-force paths + survival curve report แยก ✅

**Percentile computation:** at each month m, percentile คำนวณจาก scenarios ที่ `lapseMonth > m หรือ null` เท่านั้น

→ "ถ้าลูกค้ายังถือกรมธรรม์ ผลลงทุนเป็นยังไง"

**Survival curve:** report เป็นชุดข้อมูลแยก
- Internal: รายเดือน (length = months)
- Display: aggregate รายปี (length = years)

**Implementation guidance:**
```js
// Track lapseMonth per scenario (null if didn't lapse)
const lapseMonths = []  // length = N

// At each month m, build active subset for percentile:
const activeValues = []
for (let s = 0; s < N; s++) {
  if (lapseMonths[s] === null || lapseMonths[s] > m) {
    activeValues.push(allSeries[s][m])
  }
}
// Then percentile from activeValues only
```

### D4: หลัง lapse → ไม่รับ premium ✅

ใน scenario loop: `if (lapsed) continue` ก่อนถึง premium handling — ไม่มีทางเข้าถึง premium block หลัง lapse

### D5: avgLapseAge + survival curve (ไม่แสดง final lapse rate) ✅

**Calculation:**
```js
lapseAge = userAge + (lapseMonth / 12)   // per scenario ที่ lapse
avgLapseAge = mean(lapseAge ของ scenarios ที่ lapse)
```

**UI display (Phase 2b):**
- ✅ Survival curve รายปี (chart หรือ table)
- ✅ avgLapseAge (1 ตัวเลข)
- ❌ Final lapse rate (ซ้ำกับ curve endpoint — ข้าม)

### D6: applyFees signature — เก็บเดิม + flat feeParams ✅

```js
applyFees(portfolio, navPrices, feeParams, month) → { adminFee, lapsed }

// feeParams = { adminFeeRate: 0.000583, ...future: coiRate, ... }
```

- Function ไม่รู้จัก product structure (loose coupling)
- Caller (`runMonteCarlo`) แปลง `product.adminFee.rate → feeParams.adminFeeRate` ก่อนส่งเข้ามา
- Phase 2c เพิ่ม coiRate ใน feeParams ได้โดยไม่เปลี่ยน signature

**Premium charge ใช้ function แยก** (Phase 2c จะสร้าง):
```js
applyPremiumCharge(premium, feeParams, paymentCount) → netPremium
```

---

## Scope

### 1. สร้าง `js/fees.js` ใหม่

```js
'use strict';

/**
 * Apply monthly AUM-based fees to portfolio (in-place mutation).
 *
 * Phase 2b: admin fee เท่านั้น
 * Phase 2c จะเพิ่ม COI; premium charge อยู่ในไฟล์/function แยก
 *
 * @returns {{ adminFee: number, lapsed: boolean }}
 */
function applyFees(portfolio, navPrices, feeParams, month) {
  // 1. AUM snapshot at bid
  // 2. Compute admin fee = AUM × adminFeeRate
  // 3. Pro-rata deduct from each fund (units × (1 - ratio))
  // 4. Recompute post-fee AUM
  // 5. Return { adminFee, lapsed: postAum <= 0 }
}

window.FeesLib = { applyFees };
```

### 2. แก้ `js/simulation.js`

#### 2.1 Reorder scenario loop ตาม D1

ขั้นตอนตามที่ระบุใน D1 ด้านบน

#### 2.2 รับ feeParams ที่มี admin fee rate

`runMonteCarlo` ส่ง `feeParams = { adminFeeRate: product.adminFee.rate || 0 }` ไปยัง `runScenario`

`runScenario` ส่งต่อ `feeParams` ไปยัง `applyFees()`

**INVESTMENT-ONLY:** `product.adminFee.rate = 0` → admin fee = 0 ทุกเดือน → ผลลัพธ์ไม่กระทบ

#### 2.3 Track lapse + survival ใน runMonteCarlo

`runScenario` คืน `{ values, lapseMonth }` (lapseMonth = null ถ้าไม่ lapse)

`runMonteCarlo` aggregate:
```js
return {
  percentiles,        // computed from in-force paths only at each month
  meanSeries,         // mean ของ in-force paths only
  months,             // total simulation length
  survivalMonthly,    // length = months; survivalMonthly[m] = % active at month m
  survivalYearly,     // length = years; aggregated for display
  avgLapseAge,        // mean of lapseAge over lapsed scenarios; null if no lapse
  userAge             // pass-through for UI display
};
```

### 3. แก้ `js/app.js`

#### 3.1 ส่ง feeParams + userAge ไป runMonteCarlo

```js
const baseConfig = {
  ...,
  feeParams: {
    adminFeeRate: _product.adminFee.rate || 0
    // bidRatio/offerRatio ยังคงดึงจาก fundStats ภายใน simulation.js
  },
  userAge: state.product.age
};
```

#### 3.2 แสดง lapse stats ใน Step 4

ใต้ summary cards:

```html
<div class="lapse-stats" id="lapseStats">
  <h3>📉 ความน่าจะเป็นกรมธรรม์ขาดอายุ (Lapse)</h3>
  <p class="avg-lapse-age">อายุเฉลี่ยเมื่อขาดอายุ: <strong>{{avgLapseAge}}</strong> ปี</p>
  <canvas id="survivalChart"></canvas>   <!-- yearly survival curve -->
  <p class="hint">% ของกรณีจำลองที่ยังถือกรมธรรม์ในแต่ละปี</p>
</div>
```

ถ้า `avgLapseAge === null` (no lapse): ซ่อน section หรือแสดง "✅ ไม่มีกรณีขาดอายุในการจำลองนี้"

#### 3.3 Survival chart

ใช้ Chart.js เดิม — line chart, x-axis = "ปีที่ N", y-axis = "% ในระบบ" (0-100)

### 4. Update `index.html`

```html
<script src="js/products/index.js"></script>
<script src="js/fees.js"></script>           <!-- NEW — โหลดก่อน simulation.js -->
<script src="js/simulation.js"></script>
```

### 5. Update `CLAUDE.md`

#### 5.1 Invariants table — เพิ่ม:
| Admin fee deduction | `adminFeeRate`, `applyFees` returns lapse | ✅ implemented (Phase 2b) |
| Lapse detection | `lapseMonth`, `survivalMonthly` | ✅ implemented (Phase 2b) |
| Snapshot AUM after premium | comment `SNAPSHOT AUM` ใน scenario loop | ✅ implemented (Phase 2b) |
| Buy at OFFER, value at BID | `offerRatio` ใน premium block, `bidRatio` ใน snapshot/value | ✅ preserved |
| Market shock at end of month | comment `Market shock` ที่ปลาย loop | ✅ reordered (Phase 2b) |

#### 5.2 Common Pitfalls — เพิ่ม:
- หลัง lapse: skip premium / fees / rebalance / market shock ทุกอย่าง — `if (lapsed) continue`
- Percentile ต้อง filter active paths per-month (ไม่ใช่ filter ทั้ง scenario)
- `values[m] = 0` หลัง lapse คือ marker ภายใน — ห้ามใช้ในการ display โดยตรง (filter ก่อนเสมอ)

---

## สิ่งที่ห้ามทำ

- ❌ ห้าม implement COI / premium charge — รอ Phase 2c
- ❌ ห้ามแตะ Cholesky / regime switching / GBM math
- ❌ ห้ามลบ Phase 1/2a feature
- ❌ ห้ามเปลี่ยน applyFees signature beyond D6 (locked)
- ❌ ห้าม commit CLAUDE.md update ก่อน implement code เสร็จและ verify
- ❌ ห้าม include ค่า 0 ของ post-lapse ใน percentile/mean calc — ต้อง filter

---

## Pre-check

```bash
git status                          # Clean working tree
git log --oneline -3                # ต้องเห็น phase2a.5 commits

# Snapshot invariant count
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL|premiumPaymentMonths" js/simulation.js
# Phase 2a.5 baseline = 28; Phase 2b ควรเพิ่ม (จาก keyword ใหม่)

# Verify Phase 2a.5 plumbing พร้อมใช้
grep -n "state.lastRun\|premiumPaymentMonths" js/app.js
ls js/products/
```

**Server check ก่อน browser test:** (จาก CLAUDE.md pitfall ใหม่)
```bash
curl -s http://localhost:8080/js/fees.js | head -5     # มี content ไหม
curl -s http://localhost:8080/js/app.js | grep -c "feeParams.adminFeeRate"
```

---

## Verification หลัง edit

```bash
# 1. fees.js exists + exports
ls js/fees.js
grep -n "applyFees\|window.FeesLib" js/fees.js

# 2. Loop reorder verification
grep -n "SNAPSHOT AUM\|lapsed\|Market shock" js/simulation.js
# ต้องเจอ marker ของแต่ละ step

# 3. INVESTMENT-ONLY equivalence test (CRITICAL)
node tools/test-simulation.js
# ต้อง 78/78 pass — admin fee rate = 0 ต้องไม่กระทบผลลัพธ์
# ถ้า test fail ที่เกี่ยวกับ exact value → reorder market shock อาจเปลี่ยน floating point
# (อาจต้องปรับ tolerance หรือ debug)

# 4. New unit tests สำหรับ Phase 2b:
#    - admin fee deterministic (closed-form)
#    - pro-rata invariant (allocation ratio รักษาอยู่)
#    - lapse never reverses
#    - no premium post-lapse
#    - survival curve monotonic decreasing
#    - lapseRate = 0 เมื่อ adminFeeRate = 0

# 5. Browser cases:
#
# Case A: INVESTMENT-ONLY regression (most important)
#   - เลือก INVESTMENT-ONLY, period 10 ปี
#   - รัน 2 ครั้งด้วย seed เดิม (เพิ่ม UI button "rerun with same seed" ถ้ายังไม่มี
#     หรือใช้ console: state.lastRun.seed)
#   - ผลลัพธ์ percentile ต้องเหมือน Phase 2a.5 บิตต่อบิต
#
# Case B: UL-99-99, age 30, monthly premium 5000, allocation 100% ใน fund ปกติ
#   - lapseRate ควรต่ำมาก (<5%) — admin fee เพียง 0.0583%/เดือน
#   - chart P50 น้อยกว่า INVESTMENT-ONLY เล็กน้อย (จาก fee)
#   - survival curve = 100% เกือบตลอด → drop เล็กน้อยปลายอายุ
#
# Case C: UL-10-99, age 30, premium 5000
#   - lapseRate ต่ำเช่นกัน
#   - หลังปี 10 (premium หยุด) AUM โต/ตกตามตลาด ลบ admin fee
#   - survival curve คล้าย Case B
#
# Case D: stress test — UL-99-99, age 30, allocation 100% UJAZZ (volatile),
#         premium 1000 (น้อย), N = 5000
#   - lapseRate อาจสูงขึ้น (>10%)
#   - survival curve ตกชัดเจน
#   - แสดง avgLapseAge เป็นค่าจริง
#
# Case E: avgLapseAge sanity check
#   - lapse ใน Case D ควรเกิดในช่วงอายุ > 30 + 10 ปี (หลังเลิก premium)
#   - avgLapseAge แสดงเป็นจำนวนปี (อาจมีทศนิยม 1 ตำแหน่ง)

# 6. Invariant count (post-Phase 2b)
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL|premiumPaymentMonths|adminFeeRate|lapseMonth|survivalMonthly" js/simulation.js
# ต้องเพิ่มจาก 28 (Phase 2a.5 baseline) — ตัวเลขใหม่จะเป็น baseline ของ Phase 2c
```

---

## Sanity tests สำหรับ Phase 2b

นอกจาก 78 tests เดิม เพิ่ม:

1. **Admin fee deterministic** — รู้ AUM กับ rate → คำนวณ fee ตรง closed-form
2. **Pro-rata invariant** — หลังหัก allocation ratio ของแต่ละกองยังเดิม
3. **Lapse never reverses** — ครั้งหนึ่ง `lapsed = true` แล้ว ตลอดทั้ง scenario ห้าม flip back
4. **No premium post-lapse** — เช็คว่าหลัง lapse, portfolio ไม่เพิ่มจาก premium
5. **lapseMonth bounds** — `0 ≤ lapseMonth < months` หรือ `null` ถ้าไม่ lapse
6. **lapseRate = 0 เมื่อ adminFeeRate = 0** — INVESTMENT-ONLY/UL-with-zero-fee
7. **Survival curve monotonic** — `survival[m+1] ≤ survival[m]` ทุก m
8. **In-force percentile** — verify ว่า percentile ที่ month m คำนวณจาก paths ที่ lapseMonth > m เท่านั้น
9. **Market shock at end of loop** — มี test ที่บังคับ rate = 0, σ = 0 → ผลลัพธ์ deterministic ตามสูตร

---

## รายงานผลลัพธ์

```
✅ Phase 2b เสร็จแล้ว — verified:
- Created js/fees.js with applyFees() — admin fee + lapse return
- Loop reordered per spec timing (premium → snapshot → fees → market shock)
- runScenario returns { values, lapseMonth }
- runMonteCarlo aggregates survivalMonthly, survivalYearly, avgLapseAge
- Percentile uses in-force filter per month
- state.lastRun + pptMonths preserved (Phase 2a.5 unaffected)
- 78 existing tests pass + N new tests for fee/lapse/survival
- Browser cases A-E: ผ่าน
- INVESTMENT-ONLY equivalence: bit-exact match กับ Phase 2a.5 ✓
- Invariant count: M hits (เพิ่มจาก 28 baseline)
- Files changed: simulation.js, app.js, fees.js (new), index.html, CLAUDE.md
```

---

## Success criteria

1. ✅ INVESTMENT-ONLY ผลลัพธ์**เท่ากันบิตต่อบิต**กับ Phase 2a.5 (admin fee = 0 → no effect)
   - ถ้าเปลี่ยน → reorder กระทบ floating point หรือมี bug
2. ✅ UL products: AUM ลดลงตาม admin fee, lapse detection ทำงาน
3. ✅ Survival curve + avgLapseAge แสดงใน UI สำหรับ scenario ที่มี lapse
4. ✅ ไม่มี premium / rebalance / fee / market shock หลัง lapse
5. ✅ Percentile ไม่รวม value=0 ของ post-lapse months

**ถ้าผลลัพธ์ INVESTMENT-ONLY เปลี่ยน = bug** — แปลว่า reorder loop ทำให้เลขเพี้ยน ต้อง trace กลับ

---

## Decisions parked for Phase 2c (อย่าทำใน 2b)

- **Premium charge deduction** (year-based rate, payment-count policy year)
  - สร้าง `applyPremiumCharge(premium, feeParams, paymentCount) → netPremium`
  - ใส่ใน scenario loop ก่อน buy-at-offer
- **COI calculation** (NAR/SA basis, TMO2560 lookup, monthly conversion)
  - เพิ่ม `coiRate` ใน feeParams
  - `applyFees` คำนวณ COI + admin → หัก pro-rata รวมกัน
- **Edge cases:** NAR < 0, age out of TMO2560 range, AV > SA

---

## Decisions parked for Phase 2e (UI polish)

- TPP overlay line on chart
- Fix duplicate "ถัดไป: ตั้งค่า →" button on Step 1
- Gross/Net toggle
- "รันใหม่ด้วยตัวเลขสุ่มชุดเดิม" button (ใช้ state.lastRun.seed)
- What-if analysis (SA reduction)

---

## Notes for Claude in next session

- **อ่าน `prompts/phase2a-v5.md` + `prompts/prompt-phase2b-v1.md` + `prompts/phase2-architecture-spec-v3.md` ก่อนเริ่ม**
- **D1-D6 ตอบเสร็จแล้ว** — ห้าม re-discuss ห้าม override
  - ถ้าเจอ edge case ที่ decision ไม่ครอบคลุม → **ถาม user ก่อน edit**
- **Worktree ใหม่สำหรับ Phase 2b** — ไม่ทำงานใน main worktree
- **Server cache pitfall** (CLAUDE.md): verify `curl localhost:8080/js/fees.js` หลัง add ไฟล์ใหม่ + verify `curl localhost:8080/js/app.js` มี keyword ที่เพิ่ง edit
- **CLAUDE.md เป็น source of truth** — อ่านครั้งแรกของ session
- **Loop reorder = ความเสี่ยงสูง** — ทำเป็น step แรก verify tests ผ่านก่อน ค่อย add admin fee
  - แนะนำ: reorder + admin fee = 0 ก่อน → tests ต้องผ่าน → ค่อยเพิ่ม fee logic จริง
- **Test framework** (`tools/test-simulation.js`) ยังไม่มี test สำหรับ fees/lapse — ต้องเพิ่ม Suite 9-10
- **ไฟล์ docs/thai-mortality-2560-custom.xlsx** ใน main มี COI table จริงจาก insurer (ใน tab อื่น) — Phase 2c จะใช้
