'use strict';

// ─── COI Tables ───────────────────────────────────────────────────────────────
// Thai Mortality Table 2560 (TMO17) — Ordinary (สามัญ) — No Margin
// Source: สมาคมนักคณิตศาสตร์ประกันภัยแห่งประเทศไทย (SOAT)

const COI_TABLES = {
  "none": { source: null, male: {}, female: {} },
  "thai-mortality-2560-ordinary": {
    source: "สมาคมนักคณิตศาสตร์ประกันภัยแห่งประเทศไทย (SOAT)",
    unit: "annual_qx_per_1000_no_margin",
    male: {
      0: 1.3208, 1: 0.2705, 2: 0.2613, 3: 0.2521, 4: 0.2430,
      5: 0.2338, 6: 0.2246, 7: 0.2154, 8: 0.2149, 9: 0.1820,
      10: 0.2077, 11: 0.2777, 12: 0.3791, 13: 0.5005, 14: 0.6322,
      15: 0.7657, 16: 0.8942, 17: 1.0124, 18: 1.1165, 19: 1.2040,
      20: 1.2743, 21: 1.3280, 22: 1.3673, 23: 1.3960, 24: 1.4196,
      25: 1.4368, 26: 1.4514, 27: 1.4674, 28: 1.4886, 29: 1.5183,
      30: 1.5586, 31: 1.6107, 32: 1.6747, 33: 1.7501, 34: 1.8358,
      35: 1.9307, 36: 2.0338, 37: 2.1451, 38: 2.2649, 39: 2.3942,
      40: 2.5348, 41: 2.6888, 42: 2.8585, 43: 3.0462, 44: 3.2543,
      45: 3.4846, 46: 3.7386, 47: 4.0174, 48: 4.3215, 49: 4.6514,
      50: 5.0075, 51: 5.3909, 52: 5.8038, 53: 6.2505, 54: 6.7375,
      55: 7.2739, 56: 7.8713, 57: 8.5426, 58: 9.3015, 59: 10.1621,
      60: 11.1381, 61: 12.2434, 62: 13.4927, 63: 14.9020, 64: 16.4902,
      65: 18.2798, 66: 20.2984, 67: 22.5797, 68: 25.1631, 69: 28.0915,
      70: 31.4089, 71: 35.1557, 72: 39.3650, 73: 44.0585, 74: 49.2451,
      75: 54.9201, 76: 61.0680, 77: 67.6655, 78: 74.6857, 79: 82.1014,
      80: 89.8893, 81: 98.0345, 82: 106.5369, 83: 115.4175, 84: 124.7211,
      85: 134.5142, 86: 144.8791, 87: 155.9076, 88: 170.3675, 89: 186.1685,
      90: 203.4350, 91: 222.3030, 92: 242.9208, 93: 265.4509, 94: 287.7722,
      95: 311.5438, 96: 336.7781, 97: 363.4698, 98: 391.5927, 99: 1000.0000
    },
    female: {
      0: 1.0585, 1: 0.2333, 2: 0.2280, 3: 0.2227, 4: 0.2175,
      5: 0.2122, 6: 0.2069, 7: 0.2016, 8: 0.2046, 9: 0.2128,
      10: 0.2232, 11: 0.2356, 12: 0.2496, 13: 0.2651, 14: 0.2815,
      15: 0.2983, 16: 0.3152, 17: 0.3317, 18: 0.3477, 19: 0.3629,
      20: 0.3774, 21: 0.3911, 22: 0.4041, 23: 0.4163, 24: 0.4280,
      25: 0.4392, 26: 0.4502, 27: 0.4612, 28: 0.4728, 29: 0.4854,
      30: 0.4998, 31: 0.5166, 32: 0.5368, 33: 0.5611, 34: 0.5904,
      35: 0.6255, 36: 0.6668, 37: 0.7150, 38: 0.7701, 39: 0.8326,
      40: 0.9024, 41: 0.9798, 42: 1.0648, 43: 1.1574, 44: 1.2576,
      45: 1.3655, 46: 1.4816, 47: 1.6069, 48: 1.7430, 49: 1.8927,
      50: 2.0594, 51: 2.2473, 52: 2.4608, 53: 2.7044, 54: 2.9825,
      55: 3.2988, 56: 3.6568, 57: 4.0603, 58: 4.5136, 59: 5.0228,
      60: 5.5964, 61: 6.2463, 62: 6.9888, 63: 7.8450, 64: 8.8415,
      65: 10.0098, 66: 11.3864, 67: 13.0107, 68: 14.9239, 69: 17.1660,
      70: 19.7730, 71: 22.7740, 72: 26.1888, 73: 30.0267, 74: 34.2878,
      75: 38.9651, 76: 44.0499, 77: 49.5364, 78: 55.4271, 79: 61.7360,
      80: 68.4894, 81: 75.7265, 82: 83.4974, 83: 91.8619, 84: 100.8872,
      85: 110.6464, 86: 121.2165, 87: 132.6760, 88: 146.8471, 89: 162.5318,
      90: 179.8918, 91: 199.1061, 92: 220.3726, 93: 243.9106, 94: 267.8928,
      95: 293.7395, 96: 321.4867, 97: 351.1441, 98: 382.6892, 99: 1000.0000
    }
  }
};

// ─── Product definitions ───────────────────────────────────────────────────────

const _UL_SA_RANGES = [
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
];

const _UL_PREMIUM_CHARGE = {
  type: "year-based",
  rates: { 1: 0.55, 2: 0.40, 3: 0.20, 4: 0.10, 5: 0.05 }
};

const _UL_ADMIN_FEE = {
  type: "percent-of-aum-monthly",
  rate: 0.000583
};

const _UL_COI = {
  basis: "nar",
  tableId: "thai-mortality-2560-ordinary",
  loadingFactor: 1.0,
  conversionMethod: "constant-force"
};

const PRODUCTS = {
  "INVESTMENT-ONLY": {
    id: "INVESTMENT-ONLY",
    name: "การลงทุนล้วน",
    displayName: "จำลองการลงทุนล้วน (ไม่มีค่าธรรมเนียมประกัน)",
    versionDate: "phase1-legacy",
    sourceDoc: null,
    term: { premiumPaymentYears: null, coverage: { type: "userChosen", value: null } },
    sumAssured: { type: "fixed-multiple", multiplier: 0 },
    premiumCharge: { type: "year-based", rates: { "1+": 0 } },
    adminFee: { type: "none", rate: 0 },
    coi: { basis: "sa", tableId: "none", loadingFactor: 0 },
    loyaltyBonus: { type: "none" }
  },
  "UL-99-99": {
    id: "UL-99-99",
    name: "99/99 UL",
    displayName: "99/99 UL (Whole Life)",
    versionDate: "2024-placeholder",
    sourceDoc: "placeholder",
    term: { premiumPaymentYears: 99, coverage: { type: "endAge", value: 99 } },
    sumAssured: { type: "user-selectable", unit: "multiplier-of-annual-premium", appliesAt: "current-age", ranges: _UL_SA_RANGES },
    premiumCharge: _UL_PREMIUM_CHARGE,
    adminFee: _UL_ADMIN_FEE,
    coi: _UL_COI,
    loyaltyBonus: { type: "none" }
  },
  "UL-10-99": {
    id: "UL-10-99",
    name: "10/99 UL",
    displayName: "10/99 UL (Limited Pay)",
    versionDate: "2024-placeholder",
    sourceDoc: "placeholder",
    term: { premiumPaymentYears: 10, coverage: { type: "endAge", value: 99 } },
    sumAssured: { type: "user-selectable", unit: "multiplier-of-annual-premium", appliesAt: "current-age", ranges: _UL_SA_RANGES },
    premiumCharge: _UL_PREMIUM_CHARGE,
    adminFee: _UL_ADMIN_FEE,
    coi: _UL_COI,
    loyaltyBonus: { type: "none" }
  }
};

// ─── COI helpers ───────────────────────────────────────────────────────────────

function getAnnualQx(tableId, age, gender) {
  const table = COI_TABLES[tableId];
  if (!table) return null;
  const genderTable = table[gender];
  if (!genderTable) return null;
  const value = genderTable[age];
  return value != null ? value : null;
}

function annualToMonthlyQx(annualQxPer1000) {
  const annualQx = annualQxPer1000 / 1000;
  if (annualQx >= 1) return 1000;
  return (1 - Math.pow(1 - annualQx, 1 / 12)) * 1000;
}

function getMonthlyCOIRate(product, age, gender) {
  if (product.coi.tableId === "none") return 0;
  const annualQx = getAnnualQx(product.coi.tableId, age, gender);
  if (annualQx == null) return null;
  return annualToMonthlyQx(annualQx) * (product.coi.loadingFactor ?? 1.0);
}

// ─── Product helpers ───────────────────────────────────────────────────────────

function getProduct(id) {
  return PRODUCTS[id] || null;
}

function listProducts() {
  return Object.values(PRODUCTS);
}

function isInvestmentOnly(product) {
  return product.id === "INVESTMENT-ONLY";
}

function getCoverageMonths(product, userAge) {
  if (isInvestmentOnly(product)) return null;
  const cov = product.term.coverage;
  if (cov.type === "endAge") return (cov.value - userAge) * 12;
  if (cov.type === "years") return cov.value * 12;
  return null;
}

function getPremiumPaymentMonths(product, userAge) {
  if (isInvestmentOnly(product)) return null;
  const ppt = product.term.premiumPaymentYears;
  if (ppt == null) return null;
  if (product.id === "UL-99-99") return (ppt - userAge) * 12;
  return ppt * 12;
}

function getSAMultiplierRange(product, age, gender) {
  if (product.sumAssured.type !== "user-selectable") return null;
  const band = product.sumAssured.ranges.find(r => age >= r.ageMin && age <= r.ageMax);
  if (!band) return null;
  return band[gender];
}

function validateSAMultiplier(product, age, gender, multiplier) {
  if (product.sumAssured.type !== "user-selectable") return { valid: true };
  const range = getSAMultiplierRange(product, age, gender);
  if (!range) return { valid: false, reason: "อายุเกินเงื่อนไขการรับประกัน" };
  if (multiplier == null || multiplier === '' || isNaN(multiplier)) {
    return { valid: false, reason: "กรุณากรอกตัวคูณความคุ้มครอง" };
  }
  const genderLabel = gender === 'male' ? 'ชาย' : 'หญิง';
  if (multiplier < range.min) {
    return { valid: false, reason: `ต่ำกว่าขั้นต่ำ (${range.min}× สำหรับอายุ ${age} ${genderLabel})` };
  }
  if (multiplier > range.max) {
    return { valid: false, reason: `สูงกว่าขั้นสูง (${range.max}× สำหรับอายุ ${age} ${genderLabel})` };
  }
  return { valid: true };
}

function computeSumAssured(product, annualPremium, userMultiplier) {
  const sa = product.sumAssured;
  if (sa.type === "fixed-multiple") return sa.multiplier * annualPremium;
  if (sa.type === "user-selectable") {
    if (userMultiplier == null || userMultiplier === '') return null;
    return userMultiplier * annualPremium;
  }
  return 0;
}

// ─── Expose globals ───────────────────────────────────────────────────────────
window.ProductLib = {
  PRODUCTS,
  COI_TABLES,
  getProduct,
  listProducts,
  isInvestmentOnly,
  getCoverageMonths,
  getPremiumPaymentMonths,
  getSAMultiplierRange,
  validateSAMultiplier,
  computeSumAssured,
  getMonthlyCOIRate,
  getAnnualQx,
  annualToMonthlyQx
};
