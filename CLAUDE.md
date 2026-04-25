# CLAUDE.md

คู่มือสำหรับ Claude Code เมื่อทำงานใน repo นี้ — **อ่านทุกครั้งก่อนเริ่ม edit**

---

## 🔴 CRITICAL RULES (ห้ามข้าม)

### Rule 1: Verify Before Claiming Done
ห้ามพูดคำว่า "เพิ่มแล้ว / แก้แล้ว / เสร็จแล้ว" จนกว่าจะ verify ด้วยคำสั่งจริง

หลัง edit ทุกครั้ง:
```bash
grep -n "<keyword ที่เพิ่งเพิ่ม>" <file>    # ยืนยันว่าอยู่ในไฟล์จริง
git diff <file>                              # ยืนยันว่า tool apply สำเร็จ
```

ถ้า grep ไม่เจอ = การ edit ไม่สำเร็จ ต้องแก้ใหม่และแจ้ง user ทันที
ห้าม assume ว่า Edit/str_replace tool สำเร็จโดยไม่ verify

### Rule 2: No Silent Rewrites
ห้าม rewrite ทั้งไฟล์โดยไม่ได้รับอนุญาตชัดเจน

- Default คือใช้ `str_replace` / `Edit` แก้เฉพาะจุด
- ถ้าจำเป็นต้อง rewrite ทั้งไฟล์ ต้อง:
  1. อ่านไฟล์เดิม 100% ก่อน
  2. List function/feature ทั้งหมดที่มีอยู่เดิม
  3. ถาม user เพื่อยืนยันว่าจะ preserve อะไร
  4. หลัง rewrite ให้ diff กับของเดิม แจ้งว่าอะไรเปลี่ยน/หาย
- ห้ามลบฟังก์ชันที่ user ไม่ได้สั่งให้ลบ — โดยเฉพาะ feature ในรายการ **Invariants** ด้านล่าง

### Rule 3: Docs-Code Consistency
ห้าม update README / CLAUDE.md / comment ที่อ้างถึง feature **ก่อน** implement และ verify ในโค้ดจริง

ลำดับที่ถูกต้อง: แก้ code → grep verify → ค่อย update docs

ถ้าเจอว่า docs อ้างถึงฟังก์ชันที่ไม่มีในโค้ด = **bug** ต้องรายงาน user ทันที

---

## 📐 Project Invariants (ห้ามหายไป)

Feature เหล่านี้ต้องมีใน `js/simulation.js` เสมอ ก่อน edit ให้ grep เช็คก่อนว่าครบ ถ้าหายไปแม้แต่ข้อเดียว → **หยุดและแจ้ง user**

| Feature | Keyword ที่ต้อง grep เจอ | สถานะ |
|---|---|---|
| Log-return GBM per fund | `Math.exp(mean + ... * randNormal())` หรือ Box-Muller | ✅ implemented |
| Premium buys at Offer price | `offerPrice` / `offerRatio` ใน premium block | ✅ implemented |
| Portfolio valuation at BID | `bidPrice` / `bidRatio` ใน valuation block | ✅ implemented |
| Bid/Offer spread ใน rebalance | `bidRatio`, `offerRatio` | ✅ implemented |
| Fee hook | `applyFees(` | ✅ implemented (no-op) |
| Cholesky correlation between funds | `cholesky(`, `choleskyL`, `computeCovMatrix(` | ✅ implemented |
| Aligned returns for covariance | `getAlignedMonthlyReturns(` | ✅ implemented |
| Correlated shocks in scenario loop | `choleskyL[i][k] * z[k]` | ✅ implemented |
| PPT-capped premium months | `pptMonths` in `buildPremiumMonths(` | ✅ implemented (Phase 2a.5) |
| premiumPaymentMonths in runMonteCarlo | `premiumPaymentMonths` | ✅ implemented (Phase 2a.5) |

Quick check command:
```bash
grep -cE "bidRatio|offerRatio|applyFees" js/simulation.js
# ต้องเจอทุก keyword; ถ้าขาด = regression
```

### 🚧 Planned — NOT yet implemented

ขณะนี้ไม่มี feature ที่รอ implement — Cholesky correlation ถูก implement และ verify แล้ว (all 78 tests pass, verified 2026-04-18)

---

## Project Overview

Pure-frontend Monte Carlo simulation tool for Unit Linked insurance products (กรมธรรม์ประกันควบการลงทุน).

**Stack:** Vanilla JavaScript (ES6+), Chart.js via CDN. No build step, no dependencies to install, no test framework. Open `index.html` directly in a browser or via a local static server.

## Running the App

```bash
# Option A: Python
python -m http.server 8080
# then open http://localhost:8080

# Option B: Node
npx serve .

# Option C: Open index.html directly in Chrome/Edge
```

## File Structure

```
index.html          — Single-page UI; all four steps live here as .section divs
css/style.css       — All styles; uses CSS custom properties (--primary, etc.)
js/simulation.js    — Monte Carlo engine (pure functions, no DOM)
js/charts.js        — Chart.js wrapper; renderChart(), exportChartPNG()
js/export.js        — CSV export helpers; exportSummaryCSV(), exportCSV()
js/app.js           — UI controller: state object, step navigation, wiring
sample-nav.csv      — Example CSV for manual testing
```

## Architecture

### State
A single `state` object in `app.js` is the source of truth. All steps read/write it directly — no events, no reactive system.

### Step flow
`goToStep(idx)` swaps `.active` on `.section` divs and updates the stepper UI. Step 2→3 patches `goToStep` to inject a run-summary before simulation.

### Simulation engine (`simulation.js`)
- `calcFundStats(navData)` → per-fund monthly log-return mean & std
- `runScenario(params)` → single path: simulate NAV month-by-month via Box-Muller normal, buy units on premium months, call `applyFees()` hook, optionally rebalance
- `runMonteCarlo(config, onProgress)` → async; yields every 100 scenarios so the progress bar updates; returns `{ percentiles: {25,50,75,98}: number[], months }`

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

### Adding fees (v2 hook)
`applyFees(portfolio, navPrices, feeParams, month)` in `simulation.js` is currently a no-op. Implement it there; pass fee config via `feeParams` in `runMonteCarlo()` → `runScenario()`. No other files need changing.

### CSV format expected
Column 0 = date (`YYYY-MM-DD`, `DD/MM/YYYY`, or `MM/DD/YYYY`). Columns 1+ = NAV values per fund. `parseCSV()` in `app.js` handles parsing and rejects funds with < 2 valid rows.

## Key Design Decisions

- **Joint inception date** = latest first-date among all loaded funds; determines which period options are shown.
- **Premium months** are pre-computed as a `Set` of 0-based month indices by `buildPremiumMonths()` — avoids per-step conditionals inside the hot loop.
- **Rebalancing** occurs *after* fee deduction and *after* premium contribution each month.
- **Percentile aggregation:** P25, P50, P75, P98 เดือนต่อเดือน
- **Sample variance** (หาร n-1) ไม่ใช่ population variance (หาร n) — เคยเป็น bug
- Chart.js loaded from CDN (`chart.umd.min.js` v4). If offline, swap for a local copy.

---

## 🧪 Sanity Tests สำหรับ Simulation

หลังแก้ simulation logic ให้ suggest user ทดสอบดังนี้ (หรือเขียน test script):

1. **Single fund test** — allocation 100% ในกองเดียว ผลควรเหมือน GBM ปกติ
2. **High correlation test** — ถ้า force correlation = 0.99, rebalance ไม่ควรมีผลต่างจาก no-rebalance
3. **Negative correlation test** — correlation = -0.5, rebalance ควรให้ bonus ชัดเจน (IRR ต่างกัน > 0.3%)
4. **Zero volatility test** — set std = 0, ผลทุก scenario ควรเท่ากัน
5. **Percentile ordering** — P25 < P50 < P75 < P98 ทุกเดือน

ถ้า test ไหนไม่ผ่าน = มี bug ใน simulation logic

> **Note:** Tests 2-3 (correlation tests) ใช้งานได้แล้ว — Cholesky/correlation implement และ verify แล้ว (2026-04-18)

---

## 🔁 Workflow ที่ต้องทำทุกครั้ง

**ก่อนเริ่ม edit:**
1. `git status` — working tree clean?
2. `grep -n "<keyword invariant>" <file>` — ยืนยัน feature ปัจจุบัน
3. Read ไฟล์ที่จะแก้เต็ม ๆ ก่อน

**หลัง edit:**
1. `grep -n "<สิ่งที่เพิ่งเพิ่ม>" <file>` — ยืนยันโค้ดอยู่จริง
2. `git diff <file>` — ดูว่าเปลี่ยนอะไร
3. Re-check invariants list — ยังครบไหม?
4. ถ้ามี docs ที่เกี่ยวข้อง → check sync

**ก่อนตอบ user** รายงานแบบนี้:
```
✅ แก้แล้ว — verified:
- grep เจอ <keyword> ที่ L.XX, YY
- git diff แสดง +N -M บรรทัด
- Invariants ครบทุกข้อ
```

---

## 📝 Git Discipline

- ไม่ push / commit ถ้าไม่ได้รับอนุญาต
- ถ้า user ถามว่า "แก้แล้วใช่ไหม" → ตอบด้วย `git log` / `git diff` จริง ไม่ใช่จากความจำ
- Commit message: อธิบายว่าเพิ่ม/แก้อะไร ไม่ใช่แค่ "update simulation.js"
- ถ้าจะลบ feature → commit แยกจากการเพิ่ม feature เพื่อให้ revert ง่าย

---

## ❌ / ✅ Examples

**❌ ห้ามทำ:**
```
"ผมได้แก้ rebalance logic เสร็จแล้วครับ"
   (ไม่มี evidence ไม่ได้ verify — ต้อง grep และ git diff ก่อนพูด)

"น่าจะแก้ได้แล้ว ลองรันดูครับ"
   (เดา ไม่ได้ตรวจ)

Rewrite ทั้งไฟล์เพื่อ "clean up" โดยไม่ถาม
   (เสี่ยง regression)

Update README ก่อน implement โค้ด
   (ทำให้ docs ไม่ตรงกับความจริง)
```

**✅ ทำแบบนี้:**
```
"เพิ่ม Cholesky แล้วครับ — grep เจอ choleskyDecompose ที่ L.72,
 ใช้งานใน runScenario L.168. Invariants ครบทุกข้อ
 git diff: +48 -12"

"ก่อนแก้ ขอเช็คก่อน: grep เจอ bidRatio 5 จุด, offerRatio 4 จุด
 จะเริ่มแก้ส่วน rebalance ตามที่สั่ง"

"ไฟล์นี้มี 273 บรรทัด ผมขอ edit เฉพาะฟังก์ชัน rebalance (L.98-120)
 ไม่แตะส่วนอื่น ตกลงไหมครับ?"
```

---

## ⚠️ Common Pitfalls ที่เคยเจอ

❌ **Hide-but-still-compute pattern** — `.style.display = 'none'` หรือ `display:none` ใน CSS
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

❌ **Stale dev server in worktree workflow** — เมื่อทำงานใน git worktree ใหม่
dev server (เช่น `python -m http.server`) ที่ start ไว้ก่อนหน้านี้อาจยัง serve
ไฟล์จาก directory เก่า (main repo หรือ worktree อื่น)

อาการ: edit ไฟล์ใน worktree ปัจจุบันแล้ว → grep เจอใน disk → แต่ browser ไม่เห็นการเปลี่ยนแปลง
แม้จะ hard reload (Ctrl+Shift+R) แล้วก็ตาม

**Verify ก่อน browser test ทุกครั้ง:**
```bash
# ตรวจว่า server serve ไฟล์ที่เพิ่ง edit จริงไหม
curl -s http://localhost:8080/js/app.js | grep -c "<keyword ที่เพิ่งเพิ่ม>"
# ถ้าได้ 0 → server path ผิด ต้อง restart จาก worktree ปัจจุบัน
```

**ถ้าเจอ server เก่า:**
```bash
# 1. หา PID ที่ฟัง port 8080
netstat -ano | grep :8080
# 2. หยุด server เก่า
taskkill //F //PID <pid>
# 3. start ใหม่จาก worktree ปัจจุบัน
cd "<worktree path>" && python -m http.server 8080
```

---

## 🆘 เมื่อไม่แน่ใจ

- ถามก่อน ดีกว่า assume
- แจ้ง trade-off ก่อนตัดสินใจแทน user
- ถ้า edit fail → บอกตรง ๆ อย่าพยายามกลบเกลื่อน
- ถ้าเจอ regression จากรอบก่อน → แจ้งและเสนอให้ revert

> **หลักคิด:** user เสียเวลากับการ debug "โค้ดที่อ้างว่าเขียนแต่ไม่มีจริง" มากกว่าการรอ Claude ตรวจสอบให้แน่ใจ 10 วินาที
