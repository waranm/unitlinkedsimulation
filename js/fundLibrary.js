'use strict';

// ─── Asset class classification ───────────────────────────────────────────────
// Used by simulation.js shrinkMean() to select the long-run μ prior.
// Funds not listed here fall back to 'mixed'.
//
// ⚠️  Verify list (flagged): UIDPLUS (money_market?), UEMIF-N (bond vs equity?)
const ASSET_CLASS_MAP = {
  // ── Gold ──────────────────────────────────────────────────────────────────
  'SCBGOLDH':           'gold',

  // ── Bonds / Fixed-income ──────────────────────────────────────────────────
  'TISCOSTF':           'bond',   // พันธบัตรระยะสั้น
  'UGIS-N':             'bond',   // Global Income Strategic Bond
  'UDB-N':              'bond',   // Global Dynamic Bond
  'KFAFIX-A':           'bond',   // แอคทีฟตราสารหนี้
  'PRINCIPAL iFIXED-C': 'bond',   // คอร์ ฟิกซ์ อินคัม
  'ES-GF-A':            'bond',   // GIS Global Bond
  'SCBFINA':            'bond',   // โกลบอล ฟิกซ์ อินคัม
  'SCBOPPA':            'bond',   // เครดิตออพพอทูนิตี้
  'SCBSFFPLUS-I':       'bond',   // ตราสารหนี้ระยะสั้นพลัส

  // ── Money market ──────────────────────────────────────────────────────────
  'ABCC':               'money_market', // แคช ครีเอชั่น
  'ES-CASH':            'money_market', // บริหารเงิน
  'UIDPLUS':            'bond', // อินคัม เดลี่ อัลตร้า พลัส ⚠️ verify

  // ── REIT / Property ───────────────────────────────────────────────────────
  'ES-PIPF':            'reit',   // Property and Infrastructure Income Plus Flexible

  // ── Mixed / Balanced / Income ─────────────────────────────────────────────
  'TINC-A':             'mixed',  // อินคัมพลัส
  'UFIN-N':             'mixed',  // เฟล็กซิเบิ้ล อินคัม
  'UGBF-N':             'mixed',  // โกลบอล บาลานซ์
  'TBF':                'mixed',  // ไทย บาลานซ์ฟันด์
  'TSF-A':              'mixed',  // ทิสโก้ สแตรทิจิก ฟันด์
  'TGINC-A':            'mixed',  // ทิสโก้โกลบอลอินคัมพลัส
  'KF-CINCOME-A':       'mixed',  // กรุงศรีคอลเล็คทีฟโกลบอลอินคัม
  'ES-ULTIMATE GA1':    'mixed',  // Ultimate Global Allocation 1
  'ES-ULTIMATE GA2':    'mixed',  // Ultimate Global Allocation 2
  'ES-ULTIMATE GA3':    'mixed',  // Ultimate Global Allocation 3
  'ES-IPLUS':           'mixed',  // Income Plus
  'KKP CorePath Balanced': 'mixed', // CorePath Balanced
  'SCBGSIF':            'mixed',  // โกลบอล สตราทีจิก อินเวสเมนท์
  'SCBWINA':            'mixed',  // เวิลด์อินคัม
  'SCBGINA':            'mixed',  // โกลบอลอินคัม

  // ── Equity (sector, country, global) ──────────────────────────────────────
  'TISCOEU-A':          'equity', // ยุโรป อิควิตี้
  'TISCOUS-A':          'equity', // ยูเอส อิควิตี้
  'TISCOCH':            'equity', // ไชน่า H-Shares อิควิตี้
  'UOBSMG':             'equity', // มิเลนเนียม โกรว์ธ
  'UOBSHC':             'equity', // โกลบอล เฮลท์แคร์
  'UOBSJSM':            'equity', // เจแปนสมอลแอนด์มิดแคป
  'USUS':               'equity', // ซัสเทนเนเบิล อิควิตี้
  'UCHINA':             'equity', // ออล ไชน่า อิควิตี้
  'UEMIF-N':            'mixed', // อีเมอร์จิ้ง มาร์เก็ต อินคัม ⚠️ verify (could be bond)
  'UGD':                'equity', // โกลบอล ดูเรเบิ้ล อิควิตี้
  'UNI':                'equity', // โกลบอล อินโนเวชั่น
  'ABSM':               'equity', // สมอล-มิดแค็พ
  'ABIG':               'equity', // อินเดีย โกรท
  'ABAPAC':             'equity', // เอเชีย แปซิฟิค เอคควิตี้
  'ABV':                'equity', // แวลู
  'ABG':                'equity', // โกรท
  'KF-GCHINAD':         'equity', // เกรทเทอร์ไชน่าอิควิตี้เฮดจ์
  'KF-HJAPAND':         'equity', // เจแปนเฮดจ์
  'KFHEALTH-D':         'equity', // โกลบอลเฮลธ์แคร์อิควิตี้
  'PRINCIPAL GSA':      'equity', // โกลบอล ซิลเวอร์ เอจ
  'ES-ASIA-A':          'equity', // Asia Active Equity
  'ES-COF':             'equity', // China Opportunity
  'ES-GQG':             'equity', // Global Quality Growth
  'ES-GTECH':           'equity', // Global Technology
  'KKP ACT EQ-D':       'equity', // แอ็กทิฟ อิควิตี้
  'SCBPOPA':            'equity', // Global Population Trend
  'SCBBANKINGA':        'equity', // SET BANKING SECTOR INDEX
  'SCBLEQA':            'equity', // หุ้น LOW VOLATILITY
  'SCBDIGI':            'equity', // โกลบอลดิจิตอล
  'SCBSEA':             'equity', // ซีเล็คท์ อิควิตี้
  'SCBMSE':             'equity', // หุ้นทุน Mid/Small Cap
  'SCBEUSM':            'equity', // หุ้นยุโรปสมอลแคป
  'SCBAEMHA':           'equity', // เอเชียน อีเมอร์จิ้ง
  'SCBGEQA':            'equity', // โกลบอล อิควิตี้
  'SCBROBOA':           'equity', // โกลบอลโรโบติกส์
};

/**
 * Look up asset class for a fund by code.
 * Falls back to 'mixed' for unknown/user-uploaded funds.
 * @param {string} fundCode
 * @returns {string}  one of: 'equity'|'bond'|'gold'|'mixed'|'reit'|'commodity'|'money_market'
 */
function getAssetClassForFund(fundCode) {
  const ac = ASSET_CLASS_MAP[fundCode];
  if (!ac) {
    console.warn(`fundLibrary: unknown fund "${fundCode}", using assetClass='mixed'`);
    return 'mixed';
  }
  return ac;
}

// Expose for simulation.js and tests
if (typeof window !== 'undefined') {
  window.FundLib = { ASSET_CLASS_MAP, getAssetClassForFund };
}

function buildFundLibrary(fundsIndex, riskLevels) {
  return fundsIndex
    .map(entry => ({
      code:     entry.name,
      nameTH:   entry.longname || entry.name,
      risk:     riskLevels[entry.name] ?? 0,
      days:     entry.count,
      dateFrom: entry.firstDate,
      dateTo:   entry.lastDate,
      nav:      entry.latestNAV,
      file:     entry.file,
    }))
    .filter(f => f.risk > 0);
}

let FUND_LIBRARY = [];

async function initFundLibrary() {
  try {
    const [fiRes, rlRes] = await Promise.all([
      fetch('data/funds-index.json'),
      fetch('data/risk-levels.json'),
    ]);
    if (!fiRes.ok || !rlRes.ok) throw new Error('fetch failed');
    const fundsIndex = await fiRes.json();
    const riskLevels = await rlRes.json();
    FUND_LIBRARY = buildFundLibrary(fundsIndex, riskLevels);
  } catch (e) {
    console.warn('fundLibrary: failed to load data', e);
    FUND_LIBRARY = [];
  }
  return FUND_LIBRARY;
}
