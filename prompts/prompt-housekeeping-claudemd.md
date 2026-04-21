Housekeeping — Update CLAUDE.md สะท้อน state shape ใหม่ + เพิ่ม pitfall ที่เพิ่งเจอ

## Context
หลัง implement features ช่วง 2 วัน (redesign summary, auto-run 4 frequencies, single-fund handling) CLAUDE.md มี 2 จุดที่ out-of-sync กับโค้ดจริง:

1. **Architecture section** — ไม่ได้บอกเรื่อง state shape ใหม่ (`state.allResults`, `state.recommendedMode`, `state.recommendConfidence`, `state.isSingleFund`) และไม่ได้บอกว่า tool รัน 4 frequencies auto
2. **Common pitfalls section** — ไม่มี pitfall ที่เพิ่งเจอ (hide-but-still-compute pattern)

งานนี้เป็น **docs-only update** — ห้ามแตะโค้ด

## ต้องเพิ่ม/แก้ 2 จุด

### จุดที่ 1: Architecture section — เพิ่มเรื่อง Run Flow และ State shape

ภายใต้ "### Simulation engine (simulation.js)" เดิม **เพิ่ม subsection ใหม่**:

```markdown
### Run flow (app.js)

Tool รัน simulation auto 4 rebalancing frequencies (none/monthly/quarterly/annual) ทุกครั้ง 
แล้วแนะนำตัวที่ดีสุดให้ user — user ไม่ต้องเลือก frequency เอง ยกเว้นกรณี single fund

**Key state fields:**
- `state.allResults` — object เก็บผล Monte Carlo ของแต่ละ frequency
  - Multi-fund: `{ none, monthly, quarterly, annual }` — 4 keys
  - Single fund: `{ none }` — 1 key เท่านั้น
- `state.recommendedMode` — frequency ที่ tool แนะนำ (`'none'|'monthly'|'quarterly'|'annual'`)
- `state.recommendConfidence` — `'high'|'low'|'n/a'`
  - `'high'` — spread ≥ 1%, แสดง ⭐ แนะนำ badge
  - `'low'` — spread < 1%, ซ่อน badge แต่ยัง highlight row
  - `'n/a'` — single fund, ไม่มี recommendation concept
- `state.recommendMessage` — copy text (อ่านเป็น display เท่านั้น ห้าม logic read)
- `state.isSingleFund` — boolean, recompute ก่อน run ทุกครั้ง (ป้องกัน stale state)

**Single-fund branch:** allocation 100% ในกองเดียวเป๊ะ → รัน 1 ครั้งเท่านั้น + 
ซ่อน section "เปรียบเทียบความถี่" + chart header แสดง "(ไม่มีการปรับสมดุล — กองทุนเดียว)"

### Decision logic separation

`recommendFrequency()` return `{mode, confidence, message}` — confidence เป็น enum แยกจาก message 
เพื่อให้ logic (badge conditional) แยกจาก copywriting เปลี่ยนข้อความได้โดยไม่กระทบ behavior
```

### จุดที่ 2: Common pitfalls — เพิ่ม item ใหม่

ภายใต้ "Common pitfalls ที่เคยเจอ" (ถ้ามี) หรือสร้าง section ใหม่:

```markdown
❌ Hide-but-still-compute pattern — `.style.display = 'none'` หรือ `display:none` ใน CSS 
ซ่อนแค่ visual rendering ไม่ได้ป้องกัน JS function ที่ populate section จาก execute

ถ้า function นั้นอ่าน data structure ที่อาจไม่มี (เช่น loop ผ่าน keys ที่ assume ว่ามีครบ) 
จะ crash ด้วย "Cannot read properties of undefined"

**Guard pattern ที่ถูก:** early return ใน function เอง ตาม state flag
```js
function renderRebalCompareInsight() {
  if (state.isSingleFund) return;   // ← guard ก่อนเข้า logic
  // ... existing code
}
```

**อย่าพึ่งแค่ CSS display** — ถ้า function ถูก call ตรง ๆ (ไม่ผ่าน DOM event) CSS ไม่ช่วย
```

### จุดที่ 3 (optional): Invariants table — update ถ้าจำเป็น

ตรวจดูว่าในตาราง Invariants มี keyword ไหนที่ไม่ relevant อีกต่อไปหรือเปล่า:

- `cholesky`, `computeCovMatrix`, `choleskyL`, `bidRatio`, `offerRatio`, `applyFees` — ยังคงอยู่ ✅

ถ้าจะเพิ่ม invariants ใหม่จาก state shape (เช่น `recommendFrequency`, `isSingleFund`) — **ต้องคิดก่อน** ว่ามันสำคัญพอที่จะเป็น invariant ไหม:
- Invariant = สิ่งที่ถ้าหายไปจะเป็น regression ร้ายแรง
- State field ใน app.js อาจไม่เข้าข่าย invariant (เพราะเปลี่ยนได้ใน UI refactor)

แนะนำ: **ไม่เพิ่ม** ใน Invariants table เก็บไว้ใน Architecture section เพียงพอ

## Pre-check
```bash
git status
grep -n "Common pitfalls\|Run flow\|state.allResults" CLAUDE.md
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
```

สรุปแผน:
1. CLAUDE.md ปัจจุบันมี section "Architecture" และ "Common pitfalls" อยู่ตรงไหน (line numbers)
2. จะ insert subsection ใหม่ที่ไหน
3. ยืนยันว่าจะไม่แตะ Invariants table

รออนุมัติก่อนเริ่ม edit

## Verification หลัง edit
```bash
# 1. Content ใหม่อยู่ใน CLAUDE.md
grep -n "state.allResults\|state.isSingleFund\|state.recommendConfidence" CLAUDE.md
grep -n "Hide-but-still-compute" CLAUDE.md
grep -n "Run flow" CLAUDE.md

# 2. Invariants 31 hits ใน simulation.js ไม่เปลี่ยน
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js

# 3. Test ยัง pass (sanity — CLAUDE.md ไม่ควรกระทบ test แต่รันเพื่อยืนยัน)
node tools/test-simulation.js

# 4. git diff — ควรแตะแค่ CLAUDE.md
git diff --stat
```

## ข้อห้าม
- ❌ ห้ามแตะ js/simulation.js, js/app.js, index.html, css/style.css
- ❌ ห้ามลบ/แก้ content เดิมใน CLAUDE.md ที่ไม่ได้ระบุในงานนี้ (append เท่านั้น)
- ❌ ห้ามเพิ่ม invariants ใหม่ใน Invariants table (เก็บใน Architecture แทน)
- ❌ ห้ามบอก "เสร็จแล้ว" โดยไม่มี grep evidence

ทำตาม CLAUDE.md: verify ทุก claim ด้วย grep, สรุปแผนรอไฟเขียว, str_replace ทีละจุด
