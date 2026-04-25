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
