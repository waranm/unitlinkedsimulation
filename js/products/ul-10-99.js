export default {
  id: "UL-10-99",
  name: "10/99 UL",
  displayName: "10/99 UL (Limited Pay)",
  versionDate: "2024-placeholder",
  sourceDoc: "placeholder",
  term: {
    premiumPaymentYears: 10,
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
    rates: { 1: 0.55, 2: 0.40, 3: 0.20, 4: 0.10, 5: 0.05 }
  },
  adminFee: {
    type: "percent-of-aum-monthly",
    rate: 0.000583
  },
  coi: {
    basis: "nar",
    tableId: "thai-mortality-2560-ordinary",
    loadingFactor: 1.0,
    conversionMethod: "constant-force"
  },
  loyaltyBonus: { type: "none" }
}
