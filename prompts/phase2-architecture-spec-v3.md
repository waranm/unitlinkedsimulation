# Phase 2: Fees Architecture Spec & Roadmap (v3)

**Version:** 3 — reflects discovery that seeded PRNG + delta rebalancing already exist in codebase

## Discovery from Phase 1 code review

Git log ของ `js/simulation.js` เปิดเผยว่า **2 infrastructure pieces ที่เราคิดว่าต้องสร้างใน Phase 2 มีอยู่แล้ว**:

1. **Seeded PRNG** (commit `3d3ec00`) — "add seeded PRNG for reproducible Monte Carlo simulations"
2. **Delta rebalancing** (commit `17da9a1`) — "fix rebalance: apply spread only on traded delta, not full portfolio"

### ผลต่อ Phase 2 roadmap:
- Phase 2a.5 scope ลดลง 40-50% (ไม่ต้องสร้าง PRNG)
- Phase 2e (What-if) ใช้ seeded PRNG ที่มีอยู่แล้วได้ทันที
- Risk ลดลง: ไม่ต้อง refactor PRNG code ที่ pass tests มาแล้ว

## Design decisions (all finalized)

| Decision | Choice |
|---|---|
| Product config location | Hard-coded in `js/products/` |
| Initial product count | 3 (investment-only + 99/99 UL + 10/99 UL) |
| SA patterns supported | Fixed + User-selectable with age-banded ranges |
| SA reduction in Monte Carlo | ไม่ model baseline; **What-if analysis** ใน Phase 2e |
| What-if scope | SA reduction เท่านั้น (1 baseline vs 1 modified) |
| SA reduction granularity | Single point (ลดครั้งเดียวที่อายุ X) |
| Coverage term | Per-product: support ทั้ง `coverageEndAge` และ `coverageYears` |
| Premium Payment Term (PPT) | Per-product: `premiumPaymentYears` |
| COI basis | Per-product: `nar` หรือ `sa` |
| COI table | TMO2560 Ordinary (age-gender, male/female) |
| COI monthly conversion | Constant force: `1 - (1-qx)^(1/12)` |
| COI loading factor | Per-product (1.0 placeholder pending insurer) |
| Admin fee type | % of AUM monthly (0.0583%) — ไม่ใช่ fixed amount |
| Admin fee + COI timing | Same AUM snapshot (หลัง premium top-up) |
| Premium charge | ปี 1-5 มี rate, ปี 6+ = 0% |
| Premium charge timing | หักทุกครั้งที่จ่ายเบี้ย; policy year = payment count |
| Payment frequency | User selectable (preserve Phase 1 UX) |
| Output default | Toggle-able gross/net (default = net) |
| Mortality modeling | ไม่ model (investment simulator) |
| Lapse behavior | Stop scenario เมื่อ AV ≤ 0 |
| Lapse display (Phase 2e) | % lapse + avg lapse age |
| **RNG** | **Seeded PRNG — ALREADY IMPLEMENTED (commit 3d3ec00)** |
| **Rebalancing** | **Delta-based — ALREADY IMPLEMENTED (commit 17da9a1)** |
| Phase 1 preservation | Git tag `v1.0-phase1-complete` + `INVESTMENT-ONLY` product |

## Existing infrastructure (from Phase 1)

ก่อนเริ่ม Phase 2 ต้องรับรู้ว่าสิ่งเหล่านี้**มีอยู่แล้ว**ใน `js/simulation.js`:

### 1. Seeded PRNG
- Function ที่สร้างจาก seed เช่น `createPRNG(seed)` หรือ similar
- `runMonteCarlo` รับ seed parameter (อาจแล้ว หรืออาจต้อง expose)
- **Action ต้องทำใน Phase 2:** verify signature + expose seed to caller ถ้ายังไม่ได้ทำ

### 2. Delta rebalancing
- `rebalance()` function ที่ L.445 (ตาม 708-line version)
- Trades only the delta — skips funds at target
- **Action:** ไม่ต้องทำอะไร แค่อย่าไปแตะ

### 3. Regime switching (Markov)
- `computeStationaryDist()` + regime-aware mu/sigma scaling
- Per-fund regime scales พร้อม muOverride
- **Action:** ใน Phase 2 อย่า break interaction กับ regime + fees

## File structure
```
js/
├── simulation.js              (engine — ห้ามแตะเกินจำเป็น)
├── app.js                     (UI controller)
├── products/
│   ├── index.js               (PRODUCTS registry + helpers)
│   ├── ul-99-99.js            (whole life)
│   ├── ul-10-99.js            (limited pay)
│   ├── investment-only.js     (Phase 1 equivalent)
│   └── coi-tables.js          (TMO2560 table + monthly conversion helpers)
├── fees.js                    (NEW — Phase 2b onwards)
└── charts.js, export.js       (unchanged)
```

**หมายเหตุ:** `prng.js` **ไม่ต้องสร้าง** (มี seeded PRNG ใน simulation.js แล้ว)

## Product config shape (summary)
- Identity: id, name, displayName, versionDate, sourceDoc
- term: { premiumPaymentYears, coverage: { type, value } }
- sumAssured: fixed-multiple | user-selectable with age-banded ranges
- premiumCharge: year-based rates (payment-count basis)
- adminFee: percent-of-aum-monthly
- coi: { basis, tableId, loadingFactor, conversionMethod }
- loyaltyBonus: first-year-premium-based | aum-based | none

## State additions
- state.product: { id, age, gender, sumAssuredMultiplier, outputMode }
- state.lastRun: { seed, productConfig snapshot, inputs, results }
- state.whatIfResults: null (populated on rerun)

## Roadmap (6 sub-phases)

### Phase 2a: Product config foundation ⭐ START HERE
- Create products directory + 3 products (investment-only, ul-99-99, ul-10-99)
- Create TMO2560 COI table + monthly conversion helpers
- Step 2 UI: product dropdown, age, gender, SA inputs
- Hide duration selector for UL; show for investment-only
- `applyFees()` remains no-op
- Preserve Phase 1 behavior via investment-only product
- **Does NOT touch simulation.js**

### Phase 2a.5: Term handling (SHORTENED)
**Scope reduced** — seeded PRNG already exists, don't rebuild
- Loop uses coverageMonths (not user duration) for UL products
- Premium intake stops after premiumPaymentYears (payment count basis)
- Expose `seed` parameter in `runMonteCarlo()` signature if not already
- Save `state.lastRun.seed` for What-if reuse
- **FIRST TOUCH of simulation.js since Phase 1**
- CLAUDE.md Invariants update required

### Phase 2b: Admin fee + lapse detection ✅ DONE (2026-04-25)
- ✅ `applyFees()` implemented in `js/fees.js` — admin fee, pro-rata across funds
- ✅ Loop reorder per spec timing (premium → snapshot → fees → market shock)
- ✅ Lapse detection (AUM ≤ 0 after fees → set lapseMonth, skip rest)
- ✅ Track `lapseMonth`, `survivalMonthly`, `survivalYearly`, `avgLapseAge`
- ✅ In-force percentile filter (D3) — exclude lapsed paths from percentile/mean per month
- ✅ `totalAdminFee` per scenario + `avgAdminFee` aggregate (verified fee deduction)
- ✅ UI: lapse stats card + survival curve chart + fee summary banner
- ✅ Tests: 107/107 passing (78 baseline + 29 Phase 2b in Suite 9)
- ✅ CLAUDE.md Invariants + Pitfalls updated
- See `prompts/prompt-phase2b-v1.md` for D1-D6 decisions; finished commit on `worktree-phase2b`

### Phase 2c: Premium charge + COI + Loyalty bonus + monthly fee tracking
**Fee implementations:**
- Premium charge (year-based rate, payment-count policy year) — function `applyPremiumCharge(premium, feeParams, paymentCount) → netPremium`; called BEFORE buy-at-offer in scenario loop
- COI inside `applyFees`: NAR basis (`max(0, SA - AUM)/1000 × monthly_coi_rate × loading`) or SA basis switch via product config
- TMO2560 age-gender lookup + monthly conversion; edge cases: age out of range, AUM > SA for NAR basis (COI = 0)
- Loyalty bonus types: `first-year-premium-based` | `aum-based` | `none`; does NOT apply to lapsed scenarios; for 99/99 UL with `loyaltyBonus: none` maturity = final AUM

**Data layer (REQUIRED — Phase 2d depends on this):**
- runScenario tracks **per-month arrays** (not just totals):
  - `monthlyAdminFee[m]`, `monthlyCOI[m]`, `monthlyPremiumCharge[m]`
  - `monthlyPremiumPaid[m]` (gross premium paid that month, 0 if not premium month or post-lapse)
  - `monthlyLoyaltyBonus[m]` (bonus units credited)
- runMonteCarlo aggregates monthly arrays → **yearly percentiles** P25/P50/P75 of each (for Phase 2d table)
- Expose `getSumAssured(product, age)` from product registry — Phase 2d displays per-year SA
- Track `monthlyAvgPremium` separately for break-even / TPP overlay (Phase 2e)

**Tests to add:**
- COI deterministic (closed-form for known age, sex, NAR)
- Premium charge first-year vs subsequent-year ratio
- Loyalty bonus credit at correct year + does not credit post-lapse
- All 3 fee components sum correctly to `monthlyTotalFee`
- Monthly arrays length = months; sum across months = scenario total

### Phase 2d: Sale illustration table (3 tables — P25 / P50 / P75)
**Goal:** Render Thai-insurance-standard sale illustration table comparable to insurer documents (e.g., AIA Life Issara). 3 tables stacked or tabbed: bad / medium / good case from Monte Carlo percentiles.

**Why P25/P50/P75 instead of regulator's −1%/2%/5%:**
- คปภ requires deterministic assumed-rate format (-1%, 2%, 5%) for sales documents
- Our Monte Carlo gives stochastic percentiles using historical volatility + correlation + regime switching → richer + more realistic
- 3-bucket display matches industry mental model (bad / mid / good) so agents recognise the format

**Columns to render** (per row = year):
| Col | Source |
|---|---|
| ปีที่ / อายุ | year index + userAge |
| ความคุ้มครอง RPP | `getSumAssured(product, age)` |
| ความคุ้มครองรวม | RPP + rider SA (riders = future) |
| เบี้ย RPP | yearly aggregate of `monthlyPremiumPaid` |
| เบี้ย RSP / Top Up | reserved cols (RSP = Phase 3+, default 0) |
| รวมค่าธรรมเนียม | yearly sum of (admin + COI + premium charge) |
| มูลค่ารับซื้อคืน (P25/P50/P75) | yearly percentile of portfolio value |
| ความคุ้มครองชีวิต | SA + max(0, AUM - SA) for "เพิ่มจำนวนเงินเอาประกัน" mode |

**UI considerations:**
- 3 tables side-by-side (desktop) or tabbed (mobile)
- Highlight rows where lapse occurs (per percentile if applicable)
- Footer row = totals (เบี้ยรวม, ค่าธรรมเนียมรวม)
- Export CSV (per table) for compare with insurer document
- Toggle option (later in 2e): **deterministic mode** (-1%/2%/5%) for agents who prefer คปภ format

**Scope:**
- Pure UI rendering layer if Phase 2c data layer is complete
- ~300-500 lines of HTML + JS table rendering
- No new simulation logic

### Phase 2e: UI polish + What-if analysis
- Gross/Net toggle
- Fee breakdown expandable section
- % lapse + avg lapse age display
- What-if inputs (atAge, newMultiplier)
- "รันใหม่ด้วยตัวเลขสุ่มชุดเดิม" button reuses state.lastRun.seed (existing PRNG)
- Comparison table (baseline vs modified)
- **TPP (Total Premium Paid) overlay line on chart** — visualizes break-even point where
  portfolio crosses cumulative paid-in. For UL-10-99: rising 0→600K over 10 yr, then flat;
  makes PPT cap visible at a glance. For INVESTMENT-ONLY/UL-99-99: monotonic rising line.
  Source: cumulative `state.premium × paymentsTakenSoFar` capped by `pptMonths`.
- **Fix duplicate "ถัดไป: ตั้งค่า →" button on Step 1** — both `flBtnProceed`
  ([index.html:116](index.html:116)) and `btnNext1` ([index.html:122](index.html:122)) render.
  Pre-existing UI bug surfaced during Phase 2a.5 testing; cosmetic, both work. Decide which
  to keep (likely `flBtnProceed` since it lives in the fund-library card context) and
  remove the other.

## Monthly fee timing (CRITICAL for Phase 2b/2c)

Each simulation month, in this exact order:

1. (If premium month & within PPT) รับเบี้ย
2. หัก Premium Charge จากเบี้ย (rate ตาม policy year = payment count)
3. เบี้ยสุทธิ → ซื้อหน่วยที่ Offer → AUM เพิ่ม
4. 📸 **SNAPSHOT AUM at bid** (after premium top-up)
5. คำนวณ Admin Fee = snapshot × 0.000583
6. คำนวณ COI = (max(0, SA − snapshot) / 1000) × monthly_coi_rate × loading
7. หักทั้ง 2 พร้อมกันจาก portfolio (pro-rata by fund)
8. Check lapse: ถ้า AUM ≤ 0 → scenario จบ
9. Market shock (existing regime + Cholesky logic)

## Questions parked for later phases
- **Phase 3:** Multi-step SA reduction, premium top-up, allocation change
- **Phase 4:** Mortality modeling (expected death benefit)
- **Phase 5:** Multi-product comparison
- **Phase 6:** Save/load simulation runs

## Next action
- ✅ Phase 2a / 2a.5 / 2b — done
- ⏭️ **Phase 2c prompt design** — focus on COI + premium charge + loyalty + monthly fee tracking (data layer for 2d)
- 🆕 Phase 2d — sale illustration tables (P25/P50/P75)
- 🚀 Phase 2e — UI polish + what-if + TPP overlay (existing parking lot)
