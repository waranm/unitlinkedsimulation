# Phase 2: Fees Architecture Spec & Roadmap (v2)

**Version:** 2 — expanded with PPT/Coverage, Lapse, Seedable PRNG, What-if

## Design decisions (all finalized)

| Decision | Choice |
|---|---|
| Product config location | Hard-coded in `js/products/` |
| Initial product count | 1 (architecture test) |
| SA patterns supported | Fixed + User-selectable with age-banded ranges |
| SA reduction in Monte Carlo | ไม่ model baseline; **What-if analysis** ใน Phase 2e |
| What-if scope | SA reduction เท่านั้น (1 baseline vs 1 modified) |
| SA reduction granularity | Single point (ลดครั้งเดียวที่อายุ X) |
| Coverage term | Per-product: support ทั้ง `coverageEndAge` และ `coverageYears` |
| Premium Payment Term (PPT) | Per-product: `premiumPaymentYears` |
| COI basis | Per-product: `nar` หรือ `sa` |
| COI table | Age-gender (male/female) |
| Output default | Toggle-able gross/net (default = net) |
| Mortality modeling | ไม่ model (investment simulator) |
| Lapse behavior | Stop scenario เมื่อ AV ≤ 0 |
| Lapse display (Phase 2e) | % lapse + avg lapse age |
| RNG | **Seedable PRNG** — support seed reuse for What-if |
| Phase 1 preservation | Git tag `v1.0-phase1-complete` + `INVESTMENT-ONLY` product |

## File structure
```
js/
├── simulation.js              (engine — touched minimally)
├── app.js                     (UI controller)
├── products/
│   ├── index.js               (PRODUCTS registry + helpers)
│   ├── product-alpha.js       (1st UL product)
│   ├── investment-only.js     (Phase 1 equivalent)
│   └── coi-tables.js          (shared COI tables)
├── fees.js                    (NEW)
├── prng.js                    (NEW — Mulberry32)
└── charts.js, export.js       (unchanged)
```

## Product config shape (summary)
- Identity: id, name, displayName, versionDate, sourceDoc
- term: { premiumPaymentYears, coverage: { type, value } }
- sumAssured: fixed-multiple | user-selectable with age-banded ranges
- premiumCharge: year-based rates
- adminFee: fixed-monthly amount
- coi: { basis: 'nar'|'sa', tableId }
- loyaltyBonus: first-year-premium-based | aum-based | none

## State additions
- state.product: { id, age, gender, sumAssuredMultiplier, outputMode }
- state.lastRun: { seed, productConfig snapshot, inputs, results }
- state.whatIfResults: null (populated on rerun)

## Roadmap (6 sub-phases)

### Phase 2a: Product config foundation
- Create products directory + 2 products (alpha, investment-only)
- Step 2 UI: product dropdown, age, gender, SA inputs
- Hide duration selector for UL; show for investment-only
- applyFees() remains no-op
- Preserve Phase 1 behavior via investment-only product
- **Does NOT touch simulation.js**

### Phase 2a.5: Seedable PRNG + term handling
- Create js/prng.js (Mulberry32)
- Replace Math.random() in simulation.js with seeded PRNG
- runMonteCarlo(config, onProgress, seed) — seed required
- Loop uses coverageMonths (not user duration) for UL products
- Premium intake stops after premiumPaymentYears
- **FIRST TOUCH of simulation.js since Phase 1**
- CLAUDE.md Invariants update required

### Phase 2b: Admin fee + lapse detection
- Implement applyFees() — admin fee only
- Wire into simulation.js (replace no-op)
- Lapse detection (AV ≤ 0 → stop scenario)
- Track lapseRate, avgLapseAge
- Update CLAUDE.md Invariants

### Phase 2c: Premium charge + COI
- Premium charge (year-based)
- COI with basis switch (nar | sa)
- Age-gender table lookup
- Edge cases: age out of range, AV > SA for NAR

### Phase 2d: Loyalty bonus
- first-year-premium-based, aum-based, none types
- Bonus does not apply to lapsed scenarios

### Phase 2e: UI polish + What-if analysis
- Gross/Net toggle
- Fee breakdown expandable section
- % lapse + avg lapse age display
- What-if inputs (atAge, newMultiplier)
- "รันใหม่ด้วยตัวเลขสุ่มชุดเดิม" button reuses state.lastRun.seed
- Comparison table (baseline vs modified)

## Next action
Phase 2a prompt — to be created separately
