ขอบคุณที่จับประเด็น — ก่อนจะตัดสินใจว่า rebalance logic เป็น delta หรือ naive ขอให้ verify ให้ชัดเจนด้วย concrete math example ก่อน

## โจทย์ตัวอย่างให้ trace logic

Portfolio เริ่มต้น (หลัง market move):
- Fund A: 100 units @ NAV 1.20 (offer 1.21, bid 1.19)
- Fund B: 100 units @ NAV 1.00 (offer 1.01, bid 0.99)
- Fund C: 100 units @ NAV 1.10 (offer 1.11, bid 1.09)

Target allocation: 33/33/34

**ขอให้ trace ผ่าน rebalance() function ที่ L.445 ทีละขั้น:**

1. คำนวณ bidValues ของแต่ละกอง (L.447-452)
2. คำนวณ total (sum ของ bidValues)
3. Loop ทุก allocation:
   - targetValue = total × pct
   - currentValue = bidValues[fund]
   - delta = targetValue − currentValue
   - ถ้า delta < 0: portfolio[fund] += delta / bidPrice
   - ถ้า delta > 0: portfolio[fund] += delta / offerPrice

## คำถาม 3 ข้อที่ต้องตอบด้วย concrete numbers

**Q1: หลัง rebalance — Fund A มี units เท่าไหร่?**
ช่วยแสดงการคำนวณทีละขั้น

**Q2: Fund B — delta เป็นบวก (ซื้อ) → ซื้อที่ offer price 1.01
การเพิ่ม units คือ `delta / offer` — นี่หมายถึง:
- A) เอา delta (ที่คำนวณจาก bid valuation) หารด้วย offer → ได้ units เพิ่ม
- B) อย่างอื่น?

ถ้าเป็น A — ต้องวิเคราะห์ต่อ: delta ที่คำนวณใช้ **bid valuation** แต่หารด้วย **offer price** → นี่คือ mismatch?

**Q3: Naive (sell-all-buy-all) ทางเลือก ควรเป็นแบบไหน?**
- Sell all units ทุกกองที่ bid → ได้เงินสดรวม
- ซื้อใหม่ทุกกองตาม target ที่ offer → ได้ units ใหม่

เทียบกับ current code: result ต่างกันยังไงในโจทย์ตัวอย่างข้างบน?

## ขอให้รายงานก่อน update docs

1. Final Fund A/B/C units ตาม current code
2. Final Fund A/B/C units ตาม naive sell-all-buy-all
3. ถ้าตัวเลขต่างกัน → current = delta (skip unchanged funds)
4. ถ้าตัวเลขเท่ากัน → current = naive (masquerading as delta)

**ห้าม update CLAUDE.md จนกว่า math จะ clear**
