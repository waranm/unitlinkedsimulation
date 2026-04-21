ปรับ UX ของ rebalancing recommendation หลังจากรอบแรก — แก้ 3 จุด

## Context ของการเปลี่ยนแปลง

หลัง implement รอบแรก พบว่า badge "⭐ แนะนำ" ในตารางขัดแย้งกับ message "เลือกตามสะดวก" เมื่อ confidence ต่ำ ต้องแยก 2 signal:

* Row highlight = "chart ใช้ตัวนี้" (แสดงตลอด)
* ⭐ Badge = "tool แนะนำจริงๆ" (แสดงเฉพาะ confidence สูง)

## 3 จุดที่ต้องแก้

### 1\. ย้าย "💡 ตัวเลขนี้ใช้การปรับสมดุล: {freq}" badge

* **ลบ** badge เดิมที่อยู่เหนือ/ใน "สรุปผลลัพธ์" section
* **ย้าย** เป็น subtitle ของหัวข้อ "ผลการ Simulation — เส้นผลลัพธ์" แทน
* Format: `ผลการ Simulation — เส้นผลลัพธ์ (ใช้การปรับสมดุล{freqLabel})`
* `{freqLabel}` มาจาก recommendedMode: none→"ไม่ปรับสมดุล", monthly→"รายเดือน", quarterly→"รายไตรมาส", annual→"รายปี"
* แสดงตลอด ทั้ง confidence สูงและต่ำ (เปลี่ยนแค่ {freqLabel})

### 2\. ปรับ logic ⭐ แนะนำ ในตาราง "เปรียบเทียบความถี่การปรับสมดุล"

* **Confidence สูง (spread ≥ 1%):** แสดง badge ⭐ แนะนำ บน row ของ recommendedMode + row highlight (เหมือนเดิม)
* **Confidence ต่ำ (spread < 1%):** **ซ่อน** badge ⭐ แนะนำ แต่**ยังคง** row highlight บน row ของ recommendedMode (quarterly default)
* Message ใต้ตาราง: เหมือนเดิม (เปลี่ยนตาม confidence ตาม logic ที่มีอยู่)

### 3\. ไม่แตะ

* simulation.js — ไม่แตะ
* Logic ของ recommendFrequency() — ไม่แตะ (ยังคง return {mode, confidence, message} เหมือนเดิม)
* Row highlight CSS — ไม่แตะ
* Message text logic — ไม่แตะ

## Pre-check

```bash
git status
grep -n "ตัวเลขนี้ใช้การปรับสมดุล\\\\|ผลการ Simulation" js/app.js index.html
grep -n "recommendFrequency\\\\|confidence" js/app.js
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
```

สรุปแผนให้ฟังก่อน:

1. Badge เดิม "ตัวเลขนี้ใช้การปรับสมดุล" ตอนนี้อยู่ที่ไหน บรรทัดไหน
2. หัวข้อ "ผลการ Simulation — เส้นผลลัพธ์" อยู่ที่ไหน จะ inject freqLabel ยังไง
3. ⭐ แนะนำ ตอนนี้ render อย่างไร จะเพิ่ม conditional ที่จุดไหน

รออนุมัติก่อนเริ่ม edit

## Verification หลัง edit

```bash
# 1. Badge เก่าหายไป (ถ้าเคยมี text นี้)
grep -n "ตัวเลขนี้ใช้การปรับสมดุล" js/app.js index.html
# ควรไม่เจอ หรือเจอเฉพาะใน header chart

# 2. Subtitle ใหม่อยู่ครบ
grep -n "ใช้การปรับสมดุล" js/app.js
# ต้องเจอใน render chart header

# 3. Conditional ⭐ แนะนำ
grep -n "แนะนำ\\\\|confidence" js/app.js | head -10
# ควรเห็น branch ที่แสดง/ซ่อน badge ตาม confidence

# 4. Invariants
grep -cE "bidRatio|offerRatio|applyFees|cholesky|computeCovMatrix|choleskyL" js/simulation.js
# ต้อง 31 hits

# 5. Test
node tools/test-simulation.js
# ต้อง 78/78 pass

# 6. Browser sanity:
# - Confidence สูง: เห็น ⭐ แนะนำ + highlight + message "X% สูงกว่า"
# - Confidence ต่ำ: ไม่มี ⭐ แต่ยังมี highlight + message "ใกล้เคียงกัน เลือกตามสะดวก"
# - Chart header แสดง "(ใช้การปรับสมดุล...)" ทั้ง 2 กรณี
```

## ข้อห้าม

* ห้ามแตะ simulation.js
* ห้าม rewrite function ใดทั้งก้อน ถ้าไม่ขออนุญาต
* ห้ามเปลี่ยน logic ของ recommendFrequency()
* ห้ามเปลี่ยน threshold 1%
* ห้ามบอก "เสร็จ" โดยไม่มี grep evidence

ทำตาม CLAUDE.md: verify ทุก claim ด้วย grep, สรุปแผนรอไฟเขียว, str\_replace ทีละจุด

