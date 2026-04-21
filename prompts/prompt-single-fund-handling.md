จัดการกรณี single fund (100% allocation ในกองเดียว) — ซ่อน rebalancing comparison

## Context
เมื่อ user เลือก allocation 100% ในกองเดียว การปรับสมดุลไม่มีผลใดๆ (ไม่มีอะไรให้ rebalance) การรัน simulation 4 frequencies และแสดงตารางเปรียบเทียบเป็นการเสียเวลาและทำให้ user งง

**นิยาม single fund:** `allocations.filter(a => a.percent > 0).length === 1 && allocations[activeIdx].percent === 100`
(เข้ม: ต้องมีกองเดียวที่ 100% เป๊ะ 99% + 1% ยังนับเป็น multi-fund)

## ต้องแก้

### 1. Run logic (app.js)
- ถ้า single fund → รัน `runMonteCarlo` แค่ 1 ครั้ง (rebalanceMode = 'none') — ประหยัด runtime 4x
- ถ้า multi-fund → รัน 4 ครั้ง (เหมือนปัจจุบัน)
- Progress bar reflect load จริง (ไม่ต้องหาร 4 ถ้ารันรอบเดียว)

### 2. state.allResults structure
- Single fund: `state.allResults = { none: {...} }` — มี key เดียว
- Multi-fund: `state.allResults = { none, monthly, quarterly, annual }` (เหมือนเดิม)
- `state.recommendedMode`:
  - Single fund: `'none'` (เพราะไม่มีตัวเลือก)
  - Multi-fund: ตาม recommendFrequency() (เหมือนเดิม)
- เพิ่ม `state.isSingleFund = boolean`

### 3. Step 4 UI

**Summary cards + chart + ตารางสรุปผลลัพธ์:** ทำงานปกติ ใช้ข้อมูลจาก `state.allResults[state.recommendedMode]`

**Chart header subtitle:**
- Multi-fund: `(ใช้การปรับสมดุล{freqLabel})` — สีปกติ
- Single fund: `(ไม่มีการปรับสมดุล — กองทุนเดียว)` — สีเทา (`color: var(--color-text-secondary)` หรือ class `.text-muted` ที่มีอยู่)

**Section "เปรียบเทียบความถี่การปรับสมดุล":**
- Multi-fund: แสดงตาม logic ปัจจุบัน (rows + badge + highlight + message)
- Single fund: **ซ่อน section ทั้งหมด** (ทั้ง header + table + message)

### 4. renderRunSummary() — step 3
ถ้า single fund:
- แสดงข้อความว่า "รัน simulation 1 รอบ (กองทุนเดียว)" แทน "รัน 4 ความถี่"
(หรือถ้า renderRunSummary ไม่มีข้อความเกี่ยวกับ frequency อยู่แล้ว ก็ไม่ต้องแก้)

## ไม่แตะ
- simulation.js
- recommendFrequency() logic — ใช้เฉพาะ multi-fund path
- Logic ของ summary cards, chart rendering, ตารางสรุป, export
- CSS ของ comparison table (ถ้าซ่อนก็พอ ไม่ต้องลบ class)

## Pre-check
```bash
git status
grep -n "allocations\|percent" js/app.js | head -20
grep -n "state.allResults\|recommendFrequency\|rebalanceMode" js/app.js
grep -n "เปรียบเทียบความถี่\|ใช้การปรับสมดุล" js/app.js
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
```

สรุปแผน:
1. ตรวจ single fund ตรงไหน ด้วย logic อะไร
2. Branching ใน run flow — แยก 2 path ยังไง
3. การซ่อน comparison section ใช้ `display: none` หรือ conditional render
4. Chart header subtitle logic เปลี่ยนตรงไหน

รออนุมัติก่อนเริ่ม edit

## Verification หลัง edit
```bash
# 1. Logic single fund detection
grep -n "isSingleFund\|nonZeroFunds\|percent === 100" js/app.js

# 2. Branching ใน run
grep -n "runMonteCarlo" js/app.js
# ควรเห็นทั้ง single path (1 call) และ multi path (loop 4)

# 3. Chart header grey
grep -n "ไม่มีการปรับสมดุล" js/app.js

# 4. Comparison section conditional
grep -n "เปรียบเทียบความถี่" js/app.js
# ควรเห็น conditional ที่ check isSingleFund

# 5. Invariants
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
# ต้อง 31 hits

# 6. Test
node tools/test-simulation.js
# ต้อง 78/78 pass

# 7. Browser tests
# Case A: 3 funds 33/33/34 → เห็น comparison section + 4 runs
# Case B: 1 fund 100% → ซ่อน comparison + 1 run + header สีเทา
# Case C: 2 funds 99/1 → ยังเป็น multi-fund (4 runs + comparison section)
# Case D: เปลี่ยนจาก 3 funds เป็น 1 fund แล้วรันใหม่ → UI update ถูกต้อง (ไม่มี stale state)
```

## ข้อห้าม
- ห้ามแตะ simulation.js
- ห้ามเปลี่ยน threshold ของ multi-fund logic
- ห้าม rewrite function ทั้งก้อน ถ้าไม่ขออนุญาต
- ห้ามบอก "เสร็จ" โดยไม่มี grep + browser evidence ครบ

ทำตาม CLAUDE.md: verify ทุก claim ด้วย grep, สรุปแผนรอไฟเขียว, str_replace ทีละจุด
