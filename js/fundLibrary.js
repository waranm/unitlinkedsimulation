'use strict';

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
