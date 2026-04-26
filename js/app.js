/**
 * app.js — Main application controller
 *
 * Supported file formats:
 *   1. XLS/XLSX (row-per-day): Col A=FundName | B=Date(DD/MM/YYYY) | C=NAV | D=Offer | E=BID
 *   2. CSV (column-per-fund): header row with date + fund columns
 *
 * Persistence: fund data is saved to localStorage so it survives page refresh.
 * Multiple uploads are merged — each fund is stored independently.
 */

'use strict';

const LS_KEY = 'ulSimFunds'; // localStorage key

// ─── App state ────────────────────────────────────────────────────────────────
const state = {
  navData: null,            // { fundName: [{ date, nav, offer, bid }] }
  fundNames: [],
  jointInceptionDate: null,
  jointEndDate: null,
  jointMonths: 0,

  premium: 5000,
  paymentMode: 'monthly',
  selectedPeriod: null,
  allResults: null,
  recommendedMode: null,
  recommendMessage: '',
  N: 1000,
  allocation: {},

  results: null,
  selectedPcts: [25, 50, 75, 98],
  showMean: true,           // toggle for mean overlay on chart

  compareResults: null,     // { monthly, quarterly, annual } — cached when compare mode runs

  loadedFundIds: new Set(), // codes currently loaded from fund library

  product: {
    id: "INVESTMENT-ONLY",
    age: 30,
    gender: "male",
    sumAssuredMultiplier: null
  }
};

// ─── Step management ─────────────────────────────────────────────────────────
const STEPS = ['step-upload', 'step-params', 'step-run', 'step-results'];

function goToStep(idx) {
  STEPS.forEach((id, i) => {
    document.getElementById(id).classList.toggle('active', i === idx);
  });
  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i < idx) el.classList.add('done');
    else if (i === idx) el.classList.add('active');
  });
  document.querySelectorAll('.step-connector').forEach((el, i) => {
    el.classList.toggle('done', i < idx);
  });
  if (idx === 2) renderRunSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function parseDate(str) {
  if (!str) return null;
  str = String(str).trim();
  let m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

function monthsBetween(d1, d2) {
  return (d2.getFullYear() - d1.getFullYear()) * 12 + (d2.getMonth() - d1.getMonth());
}

function fmtDate(d) {
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Joint inception = latest first date across all funds */
function calcJointInception(navData) {
  let latest = null;
  for (const rows of Object.values(navData)) {
    const first = rows[0]?.date;
    if (!first) continue;
    if (!latest || first > latest) latest = first;
  }
  return latest;
}

/** Joint end = earliest last date across all funds */
function calcJointEnd(navData) {
  let earliest = null;
  for (const rows of Object.values(navData)) {
    const last = rows[rows.length - 1]?.date;
    if (!last) continue;
    if (!earliest || last < earliest) earliest = last;
  }
  return earliest;
}

// ─── localStorage persistence ─────────────────────────────────────────────────

/**
 * Save a single fund's rows to localStorage.
 * Dates are stored as ISO strings to survive JSON serialisation.
 */
function saveFundToStorage(fundName, rows) {
  const store = loadStorageRaw();
  store[fundName] = {
    rows: rows.map(r => ({
      dateStr: r.date.toISOString(),
      nav: r.nav,
      offer: r.offer,
      bid: r.bid,
    })),
    savedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('localStorage quota exceeded — data not saved', e);
  }
}

function deleteFundFromStorage(fundName) {
  const store = loadStorageRaw();
  delete store[fundName];
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

function clearAllStorage() {
  localStorage.removeItem(LS_KEY);
}

/** Raw object from localStorage (no date parsing) */
function loadStorageRaw() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch { return {}; }
}

/** Load all stored funds → navData format (dates as Date objects) */
function loadStoredFunds() {
  const store = loadStorageRaw();
  const navData = {};
  for (const [name, entry] of Object.entries(store)) {
    if (!entry?.rows?.length) continue;
    navData[name] = entry.rows.map(r => ({
      date:  new Date(r.dateStr),
      nav:   r.nav,
      offer: r.offer ?? r.nav,
      bid:   r.bid   ?? r.nav,
    }));
  }
  return navData;
}

// ─── Build active state from navData ─────────────────────────────────────────

function applyNavData(navData) {
  state.navData = navData;
  state.fundNames = Object.keys(navData);
  state.jointInceptionDate = state.fundNames.length ? calcJointInception(navData) : null;
  state.jointEndDate       = state.fundNames.length ? calcJointEnd(navData)       : null;
  state.jointMonths        = (state.jointInceptionDate && state.jointEndDate)
    ? monthsBetween(state.jointInceptionDate, state.jointEndDate)
    : 0;

  renderSavedFundsList();
  const hasData = state.fundNames.length > 0;
  document.getElementById('btnNext1').disabled = !hasData;
  if (hasData) showActiveDataPreview();
  else document.getElementById('dataPreview').style.display = 'none';
}

// ─── Saved Funds List UI ──────────────────────────────────────────────────────

function renderSavedFundsList() {
  const container = document.getElementById('savedFundsList');
  const store = loadStorageRaw();
  const names = Object.keys(store);

  if (names.length === 0) {
    container.innerHTML = '<p style="color:var(--gray-400);font-size:13px">ยังไม่มีกองทุนที่บันทึกไว้</p>';
    document.getElementById('btnClearAll').style.display = 'none';
    return;
  }

  document.getElementById('btnClearAll').style.display = 'inline-flex';

  container.innerHTML = names.map(name => {
    const entry = store[name];
    const rows = entry.rows || [];
    const first = rows[0]  ? fmtDate(new Date(rows[0].dateStr))              : '-';
    const last  = rows.length ? fmtDate(new Date(rows[rows.length-1].dateStr)) : '-';
    const saved = entry.savedAt ? new Date(entry.savedAt).toLocaleDateString('th-TH') : '';
    const latestNAV = rows.length ? rows[rows.length - 1].nav?.toFixed(4) : '-';

    return `
      <div class="fund-card" id="fc-${CSS.escape(name)}">
        <div class="fund-card-info">
          <div class="fund-card-name">${name}</div>
          <div class="fund-card-meta">
            ${rows.length.toLocaleString()} วัน &nbsp;·&nbsp; ${first} → ${last}
            &nbsp;·&nbsp; NAV ล่าสุด: <strong>${latestNAV}</strong>
            ${saved ? `&nbsp;·&nbsp; บันทึกเมื่อ ${saved}` : ''}
          </div>
        </div>
        <button class="btn btn-sm fund-delete-btn" data-fund="${name}" title="ลบกองทุนนี้">✕ ลบ</button>
      </div>
    `;
  }).join('');

  // Wire delete buttons
  container.querySelectorAll('.fund-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.fund;
      if (!confirm(`ลบข้อมูลกองทุน "${name}" ออกจากหน่วยความจำ?`)) return;
      deleteFundFromStorage(name);
      unloadFund(name);          // bidirectional sync: update library loaded state
      const updated = loadStoredFunds();
      applyNavData(updated);
    });
  });
}

// ─── Active data preview (after upload / on load) ─────────────────────────────

function showActiveDataPreview() {
  const { navData, fundNames, jointInceptionDate, jointEndDate, jointMonths } = state;
  if (!fundNames.length) return;

  const fmt = d => d ? fmtDate(d) : '-';
  const sample = navData[fundNames[0]]?.slice(-1)[0];
  const priceInfo = sample
    ? `NAV: <strong>${sample.nav.toFixed(4)}</strong>
       &nbsp;·&nbsp; Offer: <strong style="color:var(--primary)">${sample.offer.toFixed(4)}</strong>
       &nbsp;·&nbsp; BID: <strong style="color:var(--success)">${sample.bid.toFixed(4)}</strong>`
    : '';

  const el = document.getElementById('dataPreview');
  el.style.display = 'block';
  el.innerHTML = `
    <div class="preview-row">
      <div class="preview-item"><strong>กองทุนที่ใช้งาน:</strong> ${fundNames.length} กอง</div>
      <div class="preview-item"><strong>Joint Inception:</strong> ${fmt(jointInceptionDate)}</div>
      <div class="preview-item"><strong>ข้อมูลล่าสุด:</strong> ${fmt(jointEndDate)}</div>
      <div class="preview-item"><strong>ระยะเวลา:</strong> ${(jointMonths/12).toFixed(1)} ปี (${jointMonths} เดือน)</div>
    </div>
    ${priceInfo ? `<div style="margin-top:8px;font-size:12px;color:var(--gray-500)">ราคาล่าสุด (${fundNames[0]}) — ${priceInfo}</div>` : ''}
  `;
}

function showUploadError(msg) {
  document.getElementById('uploadStatus').innerHTML =
    `<div class="upload-status error">⚠️ ${msg}</div>`;
}

function showUploadSuccess(msg) {
  document.getElementById('uploadStatus').innerHTML =
    `<div class="upload-status success">✓ ${msg}</div>`;
  setTimeout(() => { document.getElementById('uploadStatus').innerHTML = ''; }, 4000);
}

// ─── XLS Parser ───────────────────────────────────────────────────────────────

function parseXLSRows(rows) {
  const data = {};
  for (const row of rows) {
    if (!row || row.length < 3) continue;
    const rawFund = String(row[0] ?? '').trim().replace(/^'/, '');
    const rawDate = String(row[1] ?? '').trim().replace(/^'/, '');
    const nav   = parseFloat(row[2]);
    const offer = row[3] != null ? parseFloat(row[3]) : nav;
    const bid   = row[4] != null ? parseFloat(row[4]) : nav;

    if (!rawFund || !rawDate) continue;
    const date = parseDate(rawDate);
    if (!date || isNaN(nav) || nav <= 0) continue;

    if (!data[rawFund]) data[rawFund] = [];
    data[rawFund].push({
      date, nav,
      offer: isNaN(offer) || offer <= 0 ? nav : offer,
      bid:   isNaN(bid)   || bid   <= 0 ? nav : bid,
    });
  }

  for (const f of Object.keys(data)) {
    data[f].sort((a, b) => a.date - b.date);
    if (data[f].length < 2) delete data[f];
  }

  if (Object.keys(data).length === 0)
    throw new Error('ไม่พบข้อมูล NAV ที่ใช้ได้ในไฟล์');

  return data;
}

// ─── CSV Parser ───────────────────────────────────────────────────────────────

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('ไฟล์ CSV ต้องมีอย่างน้อย 2 แถว');

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  if (headers.length < 2) throw new Error('CSV ต้องมีคอลัมน์วันที่และ NAV อย่างน้อย 1 กองทุน');

  const fundCols = headers.slice(1);
  const data = {};
  for (const f of fundCols) data[f] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const date = parseDate(cells[0]);
    if (!date) continue;

    for (let j = 0; j < fundCols.length; j++) {
      const nav = parseFloat((cells[j + 1] || '').replace(/,/g, ''));
      if (!isNaN(nav) && nav > 0)
        data[fundCols[j]].push({ date, nav, offer: nav, bid: nav });
    }
  }

  for (const f of [...fundCols]) {
    data[f].sort((a, b) => a.date - b.date);
    if (data[f].length < 2) delete data[f];
  }

  if (Object.keys(data).length === 0)
    throw new Error('ไม่พบข้อมูล NAV ที่ใช้ได้ในไฟล์');

  return data;
}

// ─── File handling ────────────────────────────────────────────────────────────
const uploadZone = document.getElementById('uploadZone');
const fileInput  = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { handleFile(fileInput.files[0]); fileInput.value = ''; });

function handleFile(file) {
  if (!file) return;
  const name = file.name.toLowerCase();

  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    readAsArrayBuffer(file).then(buf => {
      try {
        const wb = XLSX.read(buf, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
        mergeUploadedData(parseXLSRows(rows), file.name);
      } catch (err) { showUploadError(err.message); }
    });
  } else if (name.endsWith('.csv')) {
    readAsText(file).then(text => {
      try { mergeUploadedData(parseCSV(text), file.name); }
      catch (err) { showUploadError(err.message); }
    });
  } else {
    showUploadError('รองรับเฉพาะไฟล์ .xls, .xlsx หรือ .csv เท่านั้น');
  }
}

/** Merge newly parsed data into localStorage, then rebuild state */
function mergeUploadedData(newData, filename) {
  const newFunds = Object.keys(newData);

  // Save each fund to localStorage (overwrites if same name)
  for (const [name, rows] of Object.entries(newData)) {
    saveFundToStorage(name, rows);
  }

  // Reload all stored funds (merged)
  const allData = loadStoredFunds();
  applyNavData(allData);

  showUploadSuccess(
    `เพิ่ม ${newFunds.length} กองทุนจาก "${filename}" — รวมทั้งหมด ${Object.keys(allData).length} กอง`
  );
}

function readAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(new Uint8Array(e.target.result));
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function readAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.onerror = rej;
    r.readAsText(file, 'UTF-8');
  });
}

// Clear all button
document.getElementById('btnClearAll').addEventListener('click', () => {
  if (!confirm('ลบข้อมูลกองทุนทั้งหมดออกจากหน่วยความจำ?')) return;
  clearAllStorage();
  applyNavData({});
});

document.getElementById('btnNext1').addEventListener('click', () => {
  buildParamsStep();
  goToStep(1);
});

// ─── Step 2: Parameters ───────────────────────────────────────────────────────
function buildParamsStep() {
  buildProductUI();
  buildPeriodOptions();
  buildAllocationTable();
}

function buildProductUI() {
  const { PRODUCTS, getProduct, isInvestmentOnly, getSAMultiplierRange,
          validateSAMultiplier, computeSumAssured, getPremiumPaymentMonths,
          getCoverageMonths } = window.ProductLib;

  const sel = document.getElementById('productSelect');
  if (!sel.options.length) {
    Object.values(PRODUCTS).forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.displayName;
      sel.appendChild(opt);
    });
    sel.value = state.product.id;
    sel.addEventListener('change', () => {
      state.product.id = sel.value;
      state.product.sumAssuredMultiplier = null;
      document.getElementById('saMultiplier').value = '';
      refreshProductUI();
    });
  }

  document.getElementById('userAge').addEventListener('change', () => {
    state.product.age = parseInt(document.getElementById('userAge').value) || 30;
    state.product.sumAssuredMultiplier = null;
    document.getElementById('saMultiplier').value = '';
    refreshProductUI();
  });

  document.querySelectorAll('input[name="gender"]').forEach(r => {
    r.addEventListener('change', () => {
      state.product.gender = r.value;
      state.product.sumAssuredMultiplier = null;
      document.getElementById('saMultiplier').value = '';
      refreshProductUI();
    });
  });

  document.getElementById('saMultiplier').addEventListener('input', () => {
    const v = parseFloat(document.getElementById('saMultiplier').value);
    state.product.sumAssuredMultiplier = isNaN(v) ? null : v;
    refreshProductUI();
  });

  document.getElementById('inputPremium').addEventListener('input', () => {
    state.premium = parseFloat(document.getElementById('inputPremium').value) || 5000;
    refreshProductUI();
  });

  document.getElementById('selectPayment').addEventListener('change', () => {
    state.paymentMode = document.getElementById('selectPayment').value;
    refreshProductUI();
  });

  refreshProductUI();
}

function refreshProductUI() {
  const { getProduct, isInvestmentOnly, getSAMultiplierRange,
          validateSAMultiplier, computeSumAssured,
          getPremiumPaymentMonths, getCoverageMonths } = window.ProductLib;

  const product = getProduct(state.product.id);
  const isInvOnly = isInvestmentOnly(product);
  const { age, gender, sumAssuredMultiplier } = state.product;

  // Show/hide policyholder inputs
  document.getElementById('policyholderInputs').style.display = isInvOnly ? 'none' : '';

  // Show/hide duration card
  document.getElementById('durationCard').style.display = isInvOnly ? '' : 'none';

  // Show/hide fee summary
  const feeSummaryEl = document.getElementById('feeSummary');
  feeSummaryEl.style.display = isInvOnly ? 'none' : '';
  if (!isInvOnly) renderFeeDetails(product);

  if (isInvOnly) {
    updateNextButton();
    return;
  }

  // SA input row
  const needsSA = product.sumAssured.type === "user-selectable";
  document.getElementById('saInputRow').style.display = needsSA ? '' : 'none';

  if (needsSA) {
    const range = getSAMultiplierRange(product, age, gender);
    const saMultiplierEl = document.getElementById('saMultiplier');
    const saHintEl = document.getElementById('saHint');
    const saComputedEl = document.getElementById('saComputed');
    const saErrorEl = document.getElementById('saError');
    const genderLabel = gender === 'male' ? 'ชาย' : 'หญิง';

    if (!range) {
      saHintEl.textContent = 'อายุเกินเงื่อนไขการรับประกัน';
      saMultiplierEl.disabled = true;
      saComputedEl.style.display = 'none';
      saErrorEl.style.display = 'none';
    } else {
      saMultiplierEl.disabled = false;
      saHintEl.textContent = `กรอกตัวเลข ${range.min}–${range.max} สำหรับอายุ ${age} ${genderLabel}`;

      const validation = validateSAMultiplier(product, age, gender, sumAssuredMultiplier);
      if (!validation.valid) {
        saErrorEl.textContent = validation.reason;
        saErrorEl.style.display = sumAssuredMultiplier != null && sumAssuredMultiplier !== '' ? '' : 'none';
        saComputedEl.style.display = 'none';
      } else {
        saErrorEl.style.display = 'none';
        const freqMap = { monthly: 12, quarterly: 4, 'semi-annual': 2, annual: 1 };
        const freqLabel = { monthly: 'รายเดือน', quarterly: 'รายไตรมาส', 'semi-annual': 'ราย 6 เดือน', annual: 'รายปี' };
        const mode = state.paymentMode || 'monthly';
        const freq = freqMap[mode];
        const premium = state.premium || 5000;
        const annualPremium = premium * freq;
        const sa = computeSumAssured(product, annualPremium, sumAssuredMultiplier);
        saComputedEl.innerHTML =
          `<span style="color:var(--gray-600);font-weight:400;font-size:13px">` +
          `฿${premium.toLocaleString('th-TH')} (${freqLabel[mode]}) × ${freq} งวด/ปี × ${sumAssuredMultiplier} = </span>` +
          `฿${sa.toLocaleString('th-TH')}`;
        saComputedEl.style.display = '';
      }
    }
  }

  // Product info block (PPT + sim duration)
  const infoEl = document.getElementById('productInfo');
  const pptMonths = getPremiumPaymentMonths(product, age);
  const covMonths = getCoverageMonths(product, age);
  if (pptMonths != null && covMonths != null) {
    const pptYears = Math.round(pptMonths / 12);
    const covYears = Math.round(covMonths / 12);
    infoEl.innerHTML = pptYears === covYears
      ? `📋 จ่ายเบี้ย ${pptYears} ปี | ระยะเวลาความคุ้มครอง ${covYears} ปี (อายุ ${age}–99)`
      : `📋 จ่ายเบี้ย ${pptYears} ปี (อายุ ${age}–${age + pptYears})<br>📋 ระยะเวลาความคุ้มครอง ${covYears} ปี (อายุ ${age}–99)`;
    infoEl.style.display = '';
  } else {
    infoEl.style.display = 'none';
  }

  updateNextButton();
}

function renderFeeDetails(product) {
  const { isInvestmentOnly } = window.ProductLib;
  if (isInvestmentOnly(product)) return;
  const rates = product.premiumCharge.rates;
  const premChargeDisplay = Object.entries(rates)
    .map(([year, rate]) => `ปี ${year}: ${(rate * 100).toFixed(0)}%`)
    .join(', ');
  document.getElementById('feeDetails').innerHTML = `
    <p><strong>Premium Charge:</strong> ${premChargeDisplay} (ปีอื่นไม่มี)</p>
    <p><strong>Admin Fee:</strong> ${(product.adminFee.rate * 100 * 12).toFixed(2)}% ต่อปี ของ AUM (${(product.adminFee.rate * 100).toFixed(4)}%/เดือน)</p>
    <p><strong>COI:</strong> ${product.coi.tableId} (basis: ${product.coi.basis}, loading: ${product.coi.loadingFactor}×)</p>
    <p class="form-hint">⚠️ COI loading factor = 1.0 (placeholder) — pending insurer confirmation</p>
  `;
}

function canRunSimulation() {
  const { getProduct, validateSAMultiplier } = window.ProductLib;
  const product = getProduct(state.product.id);
  if (product.sumAssured.type === "user-selectable") {
    const { age, gender, sumAssuredMultiplier } = state.product;
    const v = validateSAMultiplier(product, age, gender, sumAssuredMultiplier);
    if (!v.valid) return false;
  }
  return true;
}

function updateNextButton() {
  const btn = document.getElementById('btnNext2');
  if (btn) btn.disabled = !canRunSimulation();
}

function buildPeriodOptions() {
  const container = document.getElementById('periodOptions');
  container.innerHTML = '';

  const DEFAULT_YEARS = 10;
  state.selectedPeriod = DEFAULT_YEARS * 12;

  // ── Preset buttons ──────────────────────────────────────────────
  const presetsRow = document.createElement('div');
  presetsRow.className = 'period-presets';

  [5, 10, 20].forEach(years => {
    const btn = document.createElement('button');
    btn.className = 'period-btn' + (years === DEFAULT_YEARS ? ' selected' : '');
    btn.textContent = `${years} ปี`;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      customInput.value = '';
      state.selectedPeriod = years * 12;
    });
    presetsRow.appendChild(btn);
  });
  container.appendChild(presetsRow);

  // ── Custom input ─────────────────────────────────────────────────
  const customRow = document.createElement('div');
  customRow.className = 'period-custom-row';
  customRow.innerHTML = `
    <span class="period-custom-label">กำหนดเอง</span>
    <input type="number" class="period-custom-input" min="1" max="30" step="1" placeholder="1–30" />
    <span class="period-custom-unit">ปี</span>
  `;
  container.appendChild(customRow);

  const customInput = customRow.querySelector('.period-custom-input');
  customInput.addEventListener('input', () => {
    const v = parseInt(customInput.value);
    if (v >= 1 && v <= 30) {
      container.querySelectorAll('.period-btn').forEach(b => b.classList.remove('selected'));
      state.selectedPeriod = v * 12;
    }
  });

  // ── Helper text ───────────────────────────────────────────────────
  const hint = document.createElement('p');
  hint.className = 'period-hint';
  hint.textContent = 'ระยะเวลาที่ยาวขึ้นมาพร้อมกับความไม่แน่นอนที่สูงขึ้น';
  container.appendChild(hint);

  updateJointInfo();
}

function updateJointInfo() {
  const { jointInceptionDate, jointEndDate, jointMonths } = state;
  const box = document.getElementById('jointInfo');
  if (!jointInceptionDate) { box.style.display = 'none'; return; }
  const fmt = d => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long' });
  box.style.display = 'block';
  box.innerHTML = `
    📊 ใช้ข้อมูลย้อนหลัง <strong>${(jointMonths / 12).toFixed(1)} ปี</strong>
    (${fmt(jointInceptionDate)} – ${fmt(jointEndDate)})
    เพื่อประมาณค่า return และความผันผวน — ไม่ส่งผลต่อระยะเวลาที่เลือก
  `;
}

function buildAllocationTable() {
  const { fundNames } = state;
  const tbody = document.querySelector('#allocTable tbody');
  tbody.innerHTML = '';

  const equalPct = +(100 / fundNames.length).toFixed(2);
  fundNames.forEach((f, i) => {
    state.allocation[f] = i === fundNames.length - 1
      ? +(100 - equalPct * (fundNames.length - 1)).toFixed(2)
      : equalPct;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${f}</td>
      <td><input type="number" min="0" max="100" step="0.01"
           value="${state.allocation[f]}" data-fund="${f}"> %</td>
    `;
    tbody.appendChild(tr);
  });

  document.querySelectorAll('#allocTable input').forEach(inp => {
    inp.addEventListener('input', () => {
      state.allocation[inp.dataset.fund] = parseFloat(inp.value) || 0;
      updateAllocTotal();
    });
  });
  updateAllocTotal();
}

function updateAllocTotal() {
  // Sum only current funds (prevents stale keys from blowing past 100%)
  const total = state.fundNames.reduce((s, f) => s + (state.allocation[f] || 0), 0);
  const el = document.getElementById('allocTotal');
  el.textContent = `รวม: ${total.toFixed(2)}%`;
  el.className = 'alloc-total ' + (Math.abs(total - 100) < 0.01 ? 'ok' : 'err');

  const warnings = [];

  const activeFunds = state.fundNames.filter(f => (state.allocation[f] || 0) > 0);
  if (activeFunds.length > 10) {
    warnings.push(`⚠️ เลือกได้สูงสุด 10 กองทุน (ปัจจุบัน: ${activeFunds.length} กองทุน)`);
  }

  const underMin = state.fundNames.filter(f => {
    const v = state.allocation[f] || 0;
    return v > 0 && v < 5;
  });
  if (underMin.length > 0) {
    warnings.push(`⚠️ แต่ละกองทุนต้องมีสัดส่วนอย่างน้อย 5% (หรือ 0% เพื่อข้าม): ${underMin.join(', ')}`);
  }

  const warnEl = document.getElementById('allocWarnings');
  if (warnEl) {
    warnEl.innerHTML = warnings.map(w => `<div class="alloc-warning">${w}</div>`).join('');
  }
}

document.getElementById('btnNext2').addEventListener('click', () => {
  state.premium       = parseFloat(document.getElementById('inputPremium').value) || 5000;
  state.paymentMode   = document.getElementById('selectPayment').value;
  state.N                = parseInt(document.getElementById('inputN').value) || 1000;

  if (!state.selectedPeriod) { alert('กรุณาเลือกระยะเวลา Simulation'); return; }

  const allocTotal = state.fundNames.reduce((s, f) => s + (state.allocation[f] || 0), 0);
  if (Math.abs(allocTotal - 100) > 0.01) {
    alert('การจัดสรรสินทรัพย์ต้องรวมเป็น 100% (ปัจจุบัน: ' + allocTotal.toFixed(2) + '%)'); return;
  }

  const underMin = state.fundNames.filter(f => { const v = state.allocation[f] || 0; return v > 0 && v < 5; });
  if (underMin.length > 0) {
    alert('แต่ละกองทุนต้องมีสัดส่วนอย่างน้อย 5% (หรือ 0% เพื่อข้าม)\nกองทุนที่มีปัญหา: ' + underMin.join(', ')); return;
  }

  const activeFunds = state.fundNames.filter(f => (state.allocation[f] || 0) > 0);
  if (activeFunds.length > 10) {
    alert('เลือกได้สูงสุด 10 กองทุน (ปัจจุบัน: ' + activeFunds.length + ' กองทุน)'); return;
  }
  if (activeFunds.length === 0) {
    alert('กรุณาระบุสัดส่วนอย่างน้อย 1 กองทุน'); return;
  }

  if (state.premium < 1000 || state.premium > 100000) {
    alert('เบี้ยประกันต้องอยู่ระหว่าง 1,000 - 100,000 บาท'); return;
  }
  goToStep(2);
});

document.getElementById('btnBack2').addEventListener('click', () => goToStep(0));

document.getElementById('btnResetAlloc').addEventListener('click', () => {
  buildAllocationTable();
});

// ─── Step 3: Run ──────────────────────────────────────────────────────────────
document.getElementById('btnRun').addEventListener('click', runSimulation);
document.getElementById('btnBack3').addEventListener('click', () => goToStep(1));

function renderRunSummary() {
  const s = state;
  if (!s.fundNames.length) return;
  const periodLabel = s.selectedPeriod
    ? s.selectedPeriod % 12 === 0 ? `${s.selectedPeriod / 12} ปี` : `${s.selectedPeriod} เดือน`
    : '-';
  const modeLabel  = { monthly:'รายเดือน', quarterly:'รายไตรมาส', 'semi-annual':'ราย 6 เดือน', annual:'รายปี' };
  const funds = s.fundNames.map(f => `${f} ${s.allocation[f]}%`).join(', ');
  document.getElementById('simSummary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 28px">
      <div>💰 <strong>เบี้ย:</strong> ฿${(s.premium||0).toLocaleString()} / ${modeLabel[s.paymentMode]||s.paymentMode}</div>
      <div>📅 <strong>ระยะเวลา:</strong> ${periodLabel}</div>
      <div>🎲 <strong>Monte Carlo N:</strong> ${(s.N||0).toLocaleString()} รอบ</div>
      <div style="grid-column:1/-1">🥧 <strong>Allocation:</strong> ${funds}</div>
      <div style="grid-column:1/-1;font-size:12px;color:var(--gray-500)">
        ราคาซื้อ: Offer price &nbsp;|&nbsp; มูลค่าพอร์ต: BID price
      </div>
    </div>
  `;
}

async function runSimulation() {
  const btn = document.getElementById('btnRun');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> กำลังคำนวณ...';
  document.getElementById('runProgress').style.display = 'block';
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('progressText').textContent = '0%';

  function setProgress(pct) {
    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('progressText').textContent = Math.round(pct) + '%';
  }

  const { getProduct, getCoverageMonths, getPremiumPaymentMonths } = window.ProductLib;
  const _product = getProduct(state.product.id);
  const _covMonths = getCoverageMonths(_product, state.product.age);
  const _pptMonths = getPremiumPaymentMonths(_product, state.product.age);
  const simMonths = (_covMonths !== null) ? _covMonths : state.selectedPeriod;

  const baseConfig = {
    navData: state.navData, allocation: state.allocation,
    premium: state.premium, paymentMode: state.paymentMode,
    months: simMonths, N: state.N,
    feeParams: { adminFeeRate: (_product?.adminFee?.rate) || 0 },
    userAge: state.product.age,
    premiumPaymentMonths: _pptMonths,
    product: state.product,
    regimeSwitching: true,
    regimes: [
      {
        name: 'Bull',
        defaultScale: { muScale: 1.0, sigmaScale: 1.0 },
        fundScales: {
          'tsp1-preserver':        { muScale: 1, sigmaScale: 0.8 },
          'tsp2-nurturer':         { muScale: 1.1, sigmaScale: 0.85 },
          'tsp3-balancer':         { muScale: 1.2, sigmaScale: 0.9 },
          'tsp4-explorer':         { muScale: 1.3, sigmaScale: 0.9 },
          'tsp5-gogetter':         { muScale: 1.4, sigmaScale: 0.9 },
          'TISCOMS-A':             { muScale: 1.85, sigmaScale: 0.85 },
          'TISCOSTF':              { muOverride: 0.0005, sigmaScale: 0.5 },
          'TISCOEU-A':             { muScale: 1.25, sigmaScale: 0.8 },
          'TISCOUS-A':             { muScale: 1.45, sigmaScale: 0.8 },
          'TINC-A':                { muOverride: 0.0035, sigmaScale: 0.7 },
          'TISCOCH':               { muScale: 1.3, sigmaScale: 0.8 },
          'UOBSMG':                { muScale: 1.3, sigmaScale: 0.85 },
          'UOBSHC':                { muScale: 1.15, sigmaScale: 0.8 },
          'UOBSJSM':               { muScale: 1.35, sigmaScale: 0.85 },
          'USUS':                  { muScale: 1.25, sigmaScale: 0.8 },
          'UIFT-N':                { muOverride: 0.003, sigmaScale: 0.6 },
          'UGFT':                  { muScale: 1.5, sigmaScale: 0.9 },
          'USI':                   { muOverride: 0.004, sigmaScale: 0.7 },
          'UCHINA':                { muScale: 1.4, sigmaScale: 0.8 },
          'UIDPLUS':               { muOverride: 0.001, sigmaScale: 0.4 },
          'UEMIF-N':               { muOverride: 0.0035, sigmaScale: 0.85 },
          'UPOP':                  { muScale: 1.2, sigmaScale: 0.85 },
          'UROCK':                 { muScale: 1.3, sigmaScale: 0.9 },
          'UJAZZ':                 { muScale: 1.4, sigmaScale: 0.9 },
          'UFIN-N':                { muOverride: 0.0035, sigmaScale: 0.7 },
          'UGQG':                  { muScale: 1.3, sigmaScale: 0.8 },
          'UGD':                   { muScale: 1.25, sigmaScale: 0.8 },
          'UGBF-N':                { muScale: 1.2, sigmaScale: 0.85 },
          'UGIS-N':                { muOverride: 0.0035, sigmaScale: 0.7 },
          'UNI':                   { muScale: 1.55, sigmaScale: 0.8 },
          'UDB-N':                 { muOverride: 0.0035, sigmaScale: 0.7 },
          'ABSM':                  { muScale: 1.7, sigmaScale: 0.8 },
          'ABIG':                  { muScale: 1.6, sigmaScale: 0.8 },
          'ABAPAC':                { muScale: 1.4, sigmaScale: 0.85 },
          'ABCC':                  { muOverride: 0.0005, sigmaScale: 0.4 },
          'ABV':                   { muScale: 1.15, sigmaScale: 0.85 },
          'ABG':                   { muScale: 1.55, sigmaScale: 0.85 },
          'TBF':                   { muScale: 1.2, sigmaScale: 0.85 },
          'KF-CINCOME-A':          { muOverride: 0.0035, sigmaScale: 0.7 },
          'KF-GCHINAD':            { muScale: 1.55, sigmaScale: 0.85 },
          'KF-HJAPAND':            { muScale: 1.25, sigmaScale: 0.8 },
          'KFAFIX-A':              { muOverride: 0.003, sigmaScale: 0.6 },
          'KFHEALTH-D':            { muScale: 1.2, sigmaScale: 0.8 },
          'TSF-A':                 { muScale: 1.2, sigmaScale: 0.85 },
          'TGINC-A':               { muOverride: 0.003, sigmaScale: 0.7 },
          'PRINCIPAL iFIXED-C':    { muOverride: 0.0005, sigmaScale: 0.6 },
          'PRINCIPAL GSA':         { muScale: 1.1, sigmaScale: 0.8 },
          'ES-ULTIMATE GA1':       { muScale: 1, sigmaScale: 0.8 },
          'ES-ULTIMATE GA2':       { muScale: 1.2, sigmaScale: 0.85 },
          'ES-ULTIMATE GA3':       { muScale: 1.4, sigmaScale: 0.9 },
          'ES-ASIA-A':             { muScale: 1.5, sigmaScale: 0.85 },
          'ES-COF':                { muScale: 1.65, sigmaScale: 0.85 },
          'ES-GF-A':               { muOverride: 0.003, sigmaScale: 0.65 },
          'ES-GCORE':              { muScale: 1.25, sigmaScale: 0.8 },
          'ES-GDIV-Acc':           { muScale: 1.15, sigmaScale: 0.8 },
          'ES-GQG':                { muScale: 1.25, sigmaScale: 0.8 },
          'ES-GTECH':              { muScale: 1.65, sigmaScale: 0.85 },
          'ES-IPLUS':              { muOverride: 0.003, sigmaScale: 0.8 },
          'ES-LOWBETA':            { muScale: 0.95, sigmaScale: 0.75 },
          'ES-PIPF':               { muOverride: 0.004, sigmaScale: 0.75 },
          'ES-USTECH':             { muScale: 1.75, sigmaScale: 0.75 },
          'ES-TM':                 { muOverride: 0.0012, sigmaScale: 0.5 },
          'ES-CASH':               { muOverride: 0.0005, sigmaScale: 0.4 },
          'ES-STSD':               { muOverride: 0.003, sigmaScale: 0.6 },
          'KKP CorePath Balanced': { muScale: 1.2, sigmaScale: 0.85 },
          'KKP ACT EQ-D':          { muScale: 1.5, sigmaScale: 0.85 },
          'SCBPOPA':               { muScale: 1.2, sigmaScale: 0.85 },
          'SCBBANKINGA':           { muScale: 1.3, sigmaScale: 0.85 },
          'SCBLEQA':               { muScale: 1, sigmaScale: 0.85 },
          'SCBOPPA':               { muScale: 1.6, sigmaScale: 0.9 },
          'SCBFINA':               { muScale: 1.35, sigmaScale: 0.85 },
          'SCBDIGI':               { muScale: 1.5, sigmaScale: 0.8 },
          'SCBGSIF':               { muScale: 1.15, sigmaScale: 0.75 },
          'SCBSEA':                { muScale: 1.4, sigmaScale: 0.85 },
          'SCBSFFPLUS-I':          { muOverride: 0.0006, sigmaScale: 0.5 },
          'SCBMSE':                { muScale: 1.65, sigmaScale: 0.8 },
          'SCBEUSM':               { muScale: 1.35, sigmaScale: 0.85 },
          'SCBWINA':               { muScale: 1.4, sigmaScale: 0.8 },
          'SCBAEMHA':              { muScale: 1.4, sigmaScale: 0.9 },
          'SCBAPLUSA':             { muScale: 1.4, sigmaScale: 0.8 },
          'SCBGOLDH':              { muScale: 0.75, sigmaScale: 0.9 },
          'SCBGEQA':               { muScale: 1.25, sigmaScale: 0.85 },
          'SCBGINA':               { muOverride: 0.0025, sigmaScale: 0.75 },
          'SCBROBOA':              { muScale: 1.45, sigmaScale: 0.8 },
        },
      },
      {
        name: 'Bear',
        defaultScale: { muScale: -0.5, sigmaScale: 1.5 },
        fundScales: {
          'tsp1-preserver':        { muScale: -0.25, sigmaScale: 1.2 },
          'tsp2-nurturer':         { muScale: -0.3, sigmaScale: 1.3 },
          'tsp3-balancer':         { muScale: -0.4, sigmaScale: 1.4 },
          'tsp4-explorer':         { muScale: -0.5, sigmaScale: 1.5 },
          'tsp5-gogetter':         { muScale: -0.6, sigmaScale: 1.6 },
          'TISCOMS-A':             { muScale: -0.85, sigmaScale: 1.9 },
          'TISCOSTF':              { muOverride: 0.0005, sigmaScale: 0.8 },
          'TISCOEU-A':             { muScale: -0.45, sigmaScale: 1.5 },
          'TISCOUS-A':             { muScale: -0.45, sigmaScale: 1.55 },
          'TINC-A':                { muOverride: 0.0025, sigmaScale: 1.1 },
          'TISCOCH':               { muScale: -0.6, sigmaScale: 2 },
          'UOBSMG':                { muScale: -0.4, sigmaScale: 1.5 },
          'UOBSHC':                { muScale: -0.25, sigmaScale: 1.35 },
          'UOBSJSM':               { muScale: -0.5, sigmaScale: 1.8 },
          'USUS':                  { muScale: -0.35, sigmaScale: 1.45 },
          'UIFT-N':                { muOverride: 0.0025, sigmaScale: 0.9 },
          'UGFT':                  { muScale: -0.6, sigmaScale: 1.8 },
          'USI':                   { muOverride: 0.0025, sigmaScale: 1.1 },
          'UCHINA':                { muScale: -0.6, sigmaScale: 2 },
          'UIDPLUS':               { muOverride: 0.0009, sigmaScale: 0.6 },
          'UEMIF-N':               { muOverride: 0.0045, sigmaScale: 1.45 },
          'UPOP':                  { muScale: -0.3, sigmaScale: 1.4 },
          'UROCK':                 { muScale: -0.4, sigmaScale: 1.5 },
          'UJAZZ':                 { muScale: -0.5, sigmaScale: 1.6 },
          'UFIN-N':                { muOverride: 0.0025, sigmaScale: 1.1 },
          'UGQG':                  { muScale: -0.4, sigmaScale: 1.5 },
          'UGD':                   { muScale: -0.35, sigmaScale: 1.4 },
          'UGBF-N':                { muScale: -0.3, sigmaScale: 1.4 },
          'UGIS-N':                { muOverride: 0.0025, sigmaScale: 1.2 },
          'UNI':                   { muScale: -0.55, sigmaScale: 1.9 },
          'UDB-N':                 { muOverride: 0.002, sigmaScale: 1.2 },
          'ABSM':                  { muScale: -0.75, sigmaScale: 1.75 },
          'ABIG':                  { muScale: -0.5, sigmaScale: 1.8 },
          'ABAPAC':                { muScale: -0.45, sigmaScale: 1.6 },
          'ABCC':                  { muOverride: 0.0005, sigmaScale: 0.7 },
          'ABV':                   { muScale: -0.3, sigmaScale: 1.4 },
          'ABG':                   { muScale: -0.65, sigmaScale: 1.75 },
          'TBF':                   { muScale: -0.3, sigmaScale: 1.4 },
          'KF-CINCOME-A':          { muOverride: 0.002, sigmaScale: 1.1 },
          'KF-GCHINAD':            { muScale: -0.5, sigmaScale: 1.9 },
          'KF-HJAPAND':            { muScale: -0.4, sigmaScale: 1.5 },
          'KFAFIX-A':              { muOverride: 0.0025, sigmaScale: 0.9 },
          'KFHEALTH-D':            { muScale: -0.25, sigmaScale: 1.35 },
          'TSF-A':                 { muScale: -0.3, sigmaScale: 1.4 },
          'TGINC-A':               { muOverride: 0.0025, sigmaScale: 1.1 },
          'PRINCIPAL iFIXED-C':    { muOverride: 0.0005, sigmaScale: 0.9 },
          'PRINCIPAL GSA':         { muScale: -0.25, sigmaScale: 1.3 },
          'ES-ULTIMATE GA1':       { muScale: -0.25, sigmaScale: 1.2 },
          'ES-ULTIMATE GA2':       { muScale: -0.3, sigmaScale: 1.4 },
          'ES-ULTIMATE GA3':       { muScale: -0.5, sigmaScale: 1.6 },
          'ES-ASIA-A':             { muScale: -0.5, sigmaScale: 1.8 },
          'ES-COF':                { muScale: -0.7, sigmaScale: 2.1 },
          'ES-GF-A':               { muOverride: 0.002, sigmaScale: 1.1 },
          'ES-GCORE':              { muScale: -0.35, sigmaScale: 1.45 },
          'ES-GDIV-Acc':           { muScale: -0.4, sigmaScale: 1.45 },
          'ES-GQG':                { muScale: -0.3, sigmaScale: 1.45 },
          'ES-GTECH':              { muScale: -0.65, sigmaScale: 2 },
          'ES-IPLUS':              { muOverride: 0.002, sigmaScale: 1.2 },
          'ES-LOWBETA':            { muScale: -0.2, sigmaScale: 1.2 },
          'ES-PIPF':               { muOverride: 0.002, sigmaScale: 1.2 },
          'ES-USTECH':             { muScale: -0.7, sigmaScale: 2.1 },
          'ES-TM':                 { muOverride: 0.001, sigmaScale: 0.8 },
          'ES-CASH':               { muOverride: 0.0005, sigmaScale: 0.7 },
          'ES-STSD':               { muOverride: 0.0025, sigmaScale: 0.9 },
          'KKP CorePath Balanced': { muScale: -0.3, sigmaScale: 1.4 },
          'KKP ACT EQ-D':          { muScale: -0.6, sigmaScale: 1.7 },
          'SCBPOPA':               { muScale: -0.3, sigmaScale: 1.4 },
          'SCBBANKINGA':           { muScale: -0.5, sigmaScale: 1.8 },
          'SCBLEQA':               { muScale: -0.2, sigmaScale: 1.3 },
          'SCBOPPA':               { muScale: -0.7, sigmaScale: 1.8 },
          'SCBFINA':               { muScale: -0.65, sigmaScale: 1.8 },
          'SCBDIGI':               { muScale: -0.55, sigmaScale: 1.85 },
          'SCBGSIF':               { muScale: -0.3, sigmaScale: 1.35 },
          'SCBSEA':                { muScale: -0.5, sigmaScale: 1.7 },
          'SCBSFFPLUS-I':          { muOverride: 0.0007, sigmaScale: 0.8 },
          'SCBMSE':                { muScale: -0.75, sigmaScale: 2 },
          'SCBEUSM':               { muScale: -0.5, sigmaScale: 1.7 },
          'SCBWINA':               { muScale: -0.4, sigmaScale: 1.5 },
          'SCBAEMHA':              { muScale: -0.55, sigmaScale: 1.8 },
          'SCBAPLUSA':             { muScale: -0.45, sigmaScale: 1.55 },
          'SCBGOLDH':              { muScale: 0.9, sigmaScale: 1.2 },
          'SCBGEQA':               { muScale: -0.45, sigmaScale: 1.5 },
          'SCBGINA':               { muOverride: 0.004, sigmaScale: 1.2 },
          'SCBROBOA':              { muScale: -0.6, sigmaScale: 1.9 },
        },
      },
      {
        name: 'Crisis',
        defaultScale: { muScale: -2.0, sigmaScale: 2.5 },
        fundScales: {
          'tsp1-preserver':        { muScale: -0.8, sigmaScale: 1.8 },
          'tsp2-nurturer':         { muScale: -1, sigmaScale: 2 },
          'tsp3-balancer':         { muScale: -1.3, sigmaScale: 2.2 },
          'tsp4-explorer':         { muScale: -1.5, sigmaScale: 2.4 },
          'tsp5-gogetter':         { muScale: -1.7, sigmaScale: 2.6 },
          'TISCOMS-A':             { muScale: -3.7, sigmaScale: 3.7 },
          'TISCOSTF':              { muOverride: 0.0007, sigmaScale: 1 },
          'TISCOEU-A':             { muScale: -2, sigmaScale: 2.5 },
          'TISCOUS-A':             { muScale: -2.3, sigmaScale: 2.7 },
          'TINC-A':                { muOverride: 0.001, sigmaScale: 1.5 },
          'TISCOCH':               { muScale: -2.7, sigmaScale: 3 },
          'UOBSMG':                { muScale: -2.1, sigmaScale: 2.5 },
          'UOBSHC':                { muScale: -1.4, sigmaScale: 2.1 },
          'UOBSJSM':               { muScale: -2.7, sigmaScale: 3.1 },
          'USUS':                  { muScale: -1.9, sigmaScale: 2.4 },
          'UIFT-N':                { muOverride: 0.0015, sigmaScale: 1.3 },
          'UGFT':                  { muScale: -3, sigmaScale: 3.2 },
          'USI':                   { muOverride: -0.002, sigmaScale: 1.6 },
          'UCHINA':                { muScale: -2.9, sigmaScale: 3 },
          'UIDPLUS':               { muOverride: 0.0007, sigmaScale: 0.8 },
          'UEMIF-N':               { muOverride: 0.0062, sigmaScale: 2.6 },
          'UPOP':                  { muScale: -1.3, sigmaScale: 2.2 },
          'UROCK':                 { muScale: -1.6, sigmaScale: 2.4 },
          'UJAZZ':                 { muScale: -1.7, sigmaScale: 2.6 },
          'UFIN-N':                { muOverride: 0.001, sigmaScale: 1.6 },
          'UGQG':                  { muScale: -2, sigmaScale: 2.5 },
          'UGD':                   { muScale: -1.7, sigmaScale: 2.3 },
          'UGBF-N':                { muScale: -1.3, sigmaScale: 2.2 },
          'UGIS-N':                { muOverride: -0.003, sigmaScale: 1.8 },
          'UNI':                   { muScale: -2.7, sigmaScale: 3.1 },
          'UDB-N':                 { muOverride: -0.003, sigmaScale: 1.7 },
          'ABSM':                  { muScale: -3.3, sigmaScale: 3.4 },
          'ABIG':                  { muScale: -2.9, sigmaScale: 3.2 },
          'ABAPAC':                { muScale: -1.2, sigmaScale: 2.5 },
          'ABCC':                  { muOverride: 0.0008, sigmaScale: 0.9 },
          'ABV':                   { muScale: -1.7, sigmaScale: 2.2 },
          'ABG':                   { muScale: -3, sigmaScale: 3.1 },
          'TBF':                   { muScale: -1.2, sigmaScale: 2 },
          'KF-CINCOME-A':          { muOverride: -0.003, sigmaScale: 1.6 },
          'KF-GCHINAD':            { muScale: -2.2, sigmaScale: 2.8 },
          'KF-HJAPAND':            { muScale: -2, sigmaScale: 2.5 },
          'KFAFIX-A':              { muOverride: 0.0015, sigmaScale: 1.3 },
          'KFHEALTH-D':            { muScale: -1.35, sigmaScale: 2 },
          'TSF-A':                 { muScale: -1.3, sigmaScale: 2.2 },
          'TGINC-A':               { muOverride: 0.001, sigmaScale: 1.6 },
          'PRINCIPAL iFIXED-C':    { muOverride: 0.001, sigmaScale: 1.2 },
          'PRINCIPAL GSA':         { muScale: -1, sigmaScale: 2 },
          'ES-ULTIMATE GA1':       { muScale: -0.8, sigmaScale: 1.8 },
          'ES-ULTIMATE GA2':       { muScale: -1.3, sigmaScale: 2.2 },
          'ES-ULTIMATE GA3':       { muScale: -1.7, sigmaScale: 2.6 },
          'ES-ASIA-A':             { muScale: -1.4, sigmaScale: 2.7 },
          'ES-COF':                { muScale: -3.2, sigmaScale: 3.2 },
          'ES-GF-A':               { muOverride: -0.002, sigmaScale: 1.6 },
          'ES-GCORE':              { muScale: -1.9, sigmaScale: 2.4 },
          'ES-GDIV-Acc':           { muScale: -1.8, sigmaScale: 2.3 },
          'ES-GQG':                { muScale: -1.9, sigmaScale: 2.4 },
          'ES-GTECH':              { muScale: -3.2, sigmaScale: 3.4 },
          'ES-IPLUS':              { muOverride: -0.003, sigmaScale: 1.8 },
          'ES-LOWBETA':            { muScale: -1.1, sigmaScale: 1.8 },
          'ES-PIPF':               { muOverride: -0.004, sigmaScale: 1.8 },
          'ES-USTECH':             { muScale: -3.3, sigmaScale: 3.6 },
          'ES-TM':                 { muOverride: 0.0008, sigmaScale: 1.2 },
          'ES-CASH':               { muOverride: 0.0008, sigmaScale: 0.9 },
          'ES-STSD':               { muOverride: 0.0015, sigmaScale: 1.3 },
          'KKP CorePath Balanced': { muScale: -1.3, sigmaScale: 2.2 },
          'KKP ACT EQ-D':          { muScale: -2.9, sigmaScale: 3 },
          'SCBPOPA':               { muScale: -1.3, sigmaScale: 2.2 },
          'SCBBANKINGA':           { muScale: -2.8, sigmaScale: 3 },
          'SCBLEQA':               { muScale: -1.2, sigmaScale: 2 },
          'SCBOPPA':               { muScale: -3.2, sigmaScale: 3.3 },
          'SCBFINA':               { muScale: -2.8, sigmaScale: 3 },
          'SCBDIGI':               { muScale: -2.9, sigmaScale: 3.1 },
          'SCBGSIF':               { muScale: -1.5, sigmaScale: 2.1 },
          'SCBSEA':                { muScale: -1.3, sigmaScale: 2.6 },
          'SCBSFFPLUS-I':          { muOverride: 0.001, sigmaScale: 1.1 },
          'SCBMSE':                { muScale: -3.4, sigmaScale: 3.6 },
          'SCBEUSM':               { muScale: -2.5, sigmaScale: 2.9 },
          'SCBWINA':               { muScale: -2.2, sigmaScale: 2.6 },
          'SCBAEMHA':              { muScale: -1.5, sigmaScale: 2.8 },
          'SCBAPLUSA':             { muScale: -2.2, sigmaScale: 2.6 },
          'SCBGOLDH':              { muScale: 1.2, sigmaScale: 1.6 },
          'SCBGEQA':               { muScale: -2, sigmaScale: 2.5 },
          'SCBGINA':               { muOverride: 0.007, sigmaScale: 1.7 },
          'SCBROBOA':              { muScale: -3.1, sigmaScale: 3.3 },
        },
      },
    ],
    transitionMatrix: [
      [0.90, 0.09, 0.01],
      [0.15, 0.75, 0.10],
      [0.25, 0.45, 0.30],
    ],
  };

  const nonZeroFunds = Object.entries(state.allocation).filter(([, v]) => v > 0);
  const isSingleFund = nonZeroFunds.length === 1 && nonZeroFunds[0][1] === 100;
  state.isSingleFund = isSingleFund;

  try {
    const seed       = Date.now();
    state.lastRun    = { seed, pptMonths: _pptMonths };
    const allResults = {};

    if (isSingleFund) {
      allResults['none'] = await runMonteCarlo(
        { ...baseConfig, rebalanceMode: 'none', seed },
        pct => setProgress(pct)
      );
      state.allResults       = allResults;
      state.recommendedMode  = 'none';
      state.recommendConfidence = 'n/a';
      state.recommendMessage = '';
      state.results          = allResults['none'];
    } else {
      // Run all 4 frequencies with a shared seed so variance is eliminated
      // from the comparison — any difference reflects rebalancing only.
      const modes = ['none', 'monthly', 'quarterly', 'annual'];
      for (let i = 0; i < modes.length; i++) {
        allResults[modes[i]] = await runMonteCarlo(
          { ...baseConfig, rebalanceMode: modes[i], seed },
          pct => setProgress((i * 100 + pct) / modes.length)
        );
      }
      state.allResults = allResults;
      const rec = recommendFrequency(allResults);
      state.recommendedMode     = rec.mode;
      state.recommendConfidence = rec.confidence;
      state.recommendMessage    = rec.message;
      state.results             = allResults[rec.mode];
    }

    buildResultsStep();
    goToStep(3);
  } catch (err) {
    alert('เกิดข้อผิดพลาดในการคำนวณ: ' + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '▶ เริ่มการ Simulation';
    document.getElementById('runProgress').style.display = 'none';
  }
}

// ─── Step 4: Results helpers ──────────────────────────────────────────────────

/** Total premium paid over the simulation period (capped by PPT for UL products). */
function simTotalPremium() {
  const step = simPaymentStep();
  const { months } = state.results;
  const pptMonths = state.lastRun && state.lastRun.pptMonths;
  const limit = (pptMonths != null) ? Math.min(months, pptMonths) : months;
  let n = 0;
  for (let m = 0; m < limit; m += step) n++;
  return state.premium * n;
}

/** Number of months between premium payments (1 = monthly, 3 = quarterly, …). */
function simPaymentStep() {
  return { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 }[state.paymentMode] || 1;
}

/** Format IRR as "+X.XX%" / "-X.XX%" string, or "-" if null. */
function fmtIRR(irr) {
  if (irr === null) return '-';
  return (irr >= 0 ? '+' : '') + irr.toFixed(2) + '%';
}

// ─── Step 4: Results ──────────────────────────────────────────────────────────

function buildResultsStep() {
  document.querySelector('.pct-options').style.display         = '';
  document.getElementById('rebalCompareInsight').style.display = state.isSingleFund ? 'none' : '';

  const covBanner = document.getElementById('covWarningBanner');
  if (covBanner) {
    const bestResult = state.allResults[state.recommendedMode] || state.allResults['none'];
    const diag = bestResult && bestResult.covDiagnostics;
    const msg = diag ? buildCovWarningMessage(diag, Object.keys(state.navData).length) : null;
    if (msg) {
      covBanner.innerHTML = `<div class="alloc-warning">${msg}</div>`;
      covBanner.style.display = '';
    } else {
      covBanner.style.display = 'none';
    }
  }

  renderOutcomeSummary();

  const chartTitleEl = document.getElementById('chartSectionTitle');
  if (chartTitleEl) {
    if (state.isSingleFund) {
      chartTitleEl.innerHTML = `<span class="icon">📈</span> ผลการ Simulation — เส้นผลลัพธ์ <span style="color:var(--gray-500)">(ไม่มีการปรับสมดุล — กองทุนเดียว)</span>`;
    } else {
      const freqLabelMap = { none: 'ไม่ปรับสมดุล', monthly: 'รายเดือน', quarterly: 'รายไตรมาส', annual: 'รายปี' };
      const freqLabel = freqLabelMap[state.recommendedMode] || 'รายไตรมาส';
      chartTitleEl.innerHTML = `<span class="icon">📈</span> ผลการ Simulation — เส้นผลลัพธ์ (ใช้การปรับสมดุล${freqLabel})`;
    }
  }

  renderPercentileChart();
  renderRebalCompareInsight();
  renderLapseStats();
  buildSummaryTable();
}

/**
 * Render lapse statistics: avg lapse age + yearly survival curve.
 * Hidden when no scenarios lapsed (avgLapseAge === null).
 */
let _survivalChartInstance = null;
function renderLapseStats() {
  const card = document.getElementById('lapseStats');
  const body = document.getElementById('lapseStatsBody');
  if (!card || !body) return;

  const r = state.results;
  if (!r || r.avgLapseAge == null) {
    card.style.display = 'none';
    return;
  }

  card.style.display = '';

  // Final survival = last yearly point
  const finalSurvival = r.survivalYearly[r.survivalYearly.length - 1];
  const lapseRate = (1 - finalSurvival) * 100;

  body.innerHTML = `
    <p>อายุเฉลี่ยเมื่อขาดอายุ: <strong>${r.avgLapseAge.toFixed(1)}</strong> ปี</p>
    <p style="color:var(--gray-600);font-size:.875rem">
      สิ้นสุดปีที่ ${r.survivalYearly.length - 1}: ยังถืออยู่ ${(finalSurvival * 100).toFixed(1)}%
      (ขาดอายุสะสม ${lapseRate.toFixed(1)}%)
    </p>
  `;

  // Yearly survival line chart
  const ctx = document.getElementById('survivalChart')?.getContext('2d');
  if (!ctx || typeof Chart === 'undefined') return;
  if (_survivalChartInstance) _survivalChartInstance.destroy();

  const labels = r.survivalYearly.map((_, y) => `ปีที่ ${y}`);
  const data   = r.survivalYearly.map(v => +(v * 100).toFixed(2));

  _survivalChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: '% ในระบบ',
        data,
        borderColor: '#dc2626',
        backgroundColor: 'rgba(220, 38, 38, 0.1)',
        tension: 0.2,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      scales: {
        y: { min: 0, max: 100, title: { display: true, text: '% ในระบบ' } },
        x: { title: { display: true, text: 'ปี' } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function renderPercentileChart() {
  const ctx = document.getElementById('simulationChart').getContext('2d');
  renderChart(
    ctx,
    state.results.percentiles,
    state.results.months,
    state.selectedPcts,
    new Date(),
    { meanSeries: state.showMean ? state.results.meanSeries : null }
  );
}

/**
 * Pick the recommended rebalance frequency from 4 simulation results.
 * If max P50 − min P50 < 1% of min → all similar → recommend quarterly.
 * Otherwise recommend the mode with highest P50.
 */
function recommendFrequency(allResults) {
  const modes   = ['none', 'monthly', 'quarterly', 'annual'];
  const nameMap = { none: 'ไม่ปรับสมดุล', monthly: 'รายเดือน', quarterly: 'รายไตรมาส', annual: 'รายปี' };

  const p50s = {};
  for (const mode of modes) {
    const m = allResults[mode].months;
    p50s[mode] = allResults[mode].percentiles[50][m - 1];
  }

  const values = Object.values(p50s);
  const maxP50 = Math.max(...values);
  const minP50 = Math.min(...values);
  const spread = minP50 > 0 ? (maxP50 - minP50) / minP50 : 0;

  if (spread < 0.01) {
    return { mode: 'quarterly', confidence: 'low', message: 'ทุกความถี่ให้ผลใกล้เคียงกัน (<1% ต่างกัน) เลือกตามความสะดวก' };
  }

  const bestMode   = modes.find(m => p50s[m] === maxP50);
  const noneP50    = p50s['none'];
  const diffVsNone = noneP50 > 0 ? ((maxP50 - noneP50) / noneP50 * 100) : 0;
  return {
    mode: bestMode,
    confidence: 'high',
    message: `กลยุทธ์${nameMap[bestMode]}ให้ผลลัพธ์ทั่วไปสูงกว่า ${diffVsNone.toFixed(1)}% เมื่อเทียบกับไม่ปรับสมดุล`,
  };
}

/** Generate the compare-rebalance insight card with side-by-side table + insight text. */
function renderRebalCompareInsight() {
  if (state.isSingleFund) return;
  const el = document.getElementById('rebalCompareInsight');
  if (!el || !state.allResults) return;

  const cr       = state.allResults;
  const months   = state.results.months;
  const totalPaid = simTotalPremium();
  const step     = simPaymentStep();
  const recMode  = state.recommendedMode || 'quarterly';

  const MODES    = ['none', 'monthly', 'quarterly', 'annual'];
  const nameMap  = { none: 'ไม่ปรับสมดุล', monthly: 'รายเดือน', quarterly: 'รายไตรมาส', annual: 'รายปี' };
  const colorMap = { none: '#9ca3af', monthly: '#1a56a0', quarterly: '#e8a020', annual: '#16a34a' };

  const rows = MODES.map(mode => {
    const p50    = cr[mode].percentiles[50][months - 1];
    const profit = p50 - totalPaid;
    const irr    = calcIRR(state.premium, step, months, p50, state.lastRun && state.lastRun.pptMonths);
    return { mode, p50, profit, irr };
  });

  const rowsHTML = rows.map(r => {
    const isRec     = r.mode === recMode;
    const profitCls = r.profit >= 0 ? 'positive' : 'negative';
    const irrCls    = r.irr !== null && r.irr >= 0 ? 'positive' : 'negative';
    const badge     = isRec && state.recommendConfidence === 'high' ? `<span class="rc-badge rc-badge--best">⭐ แนะนำ</span>` : '';

    return `
      <tr class="${isRec ? 'rc-row--best' : ''}">
        <td>
          <span class="rc-dot" style="background:${colorMap[r.mode]}"></span>
          ${nameMap[r.mode]}${badge}
        </td>
        <td class="rc-num">${fmtTHB(r.p50)}</td>
        <td class="rc-num ${profitCls}">${r.profit >= 0 ? '+' : ''}${fmtTHB(r.profit)}</td>
        <td class="rc-num ${irrCls}">${r.irr !== null ? fmtIRR(r.irr) : '—'}</td>
      </tr>`;
  }).join('');

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon">⚖️</span> เปรียบเทียบความถี่การปรับสมดุล (Auto Rebalancing)</div>

      <table class="rc-table">
        <thead>
          <tr>
            <th>ความถี่</th>
            <th class="rc-num">ผลลัพธ์ทั่วไป (P50)</th>
            <th class="rc-num">กำไร / ขาดทุน</th>
            <th class="rc-num">IRR</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>

      <p class="rc-insight">💡 ${state.recommendMessage || ''}</p>
    </div>
  `;
}

/**
 * Render the top-of-results summary panel.
 * Shows Average / Typical (Median) / Downside side-by-side,
 * plus a mean-vs-median comparison block explaining the skew.
 */
function renderOutcomeSummary() {
  const el = document.getElementById('resultSummaryPanel');
  if (!el) return;

  const { percentiles, months } = state.results;
  const step = simPaymentStep();

  const p75Final = percentiles[75][months - 1];
  const p50Final = percentiles[50][months - 1];
  const p25Final = percentiles[25][months - 1];

  const _ppt = state.lastRun && state.lastRun.pptMonths;
  const p75IRR = calcIRR(state.premium, step, months, p75Final, _ppt);
  const p50IRR = calcIRR(state.premium, step, months, p50Final, _ppt);
  const p25IRR = calcIRR(state.premium, step, months, p25Final, _ppt);

  function irrCls(irr) { return irr === null ? '' : irr >= 0 ? 'positive' : 'negative'; }

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon">📊</span> สรุปผลลัพธ์</div>

      <div class="outcome-grid">
        <!-- P75 — Upside -->
        <div class="outcome-col">
          <span class="outcome-badge up">กรณีที่ดีกว่าปกติ (P75)</span>
          <div class="outcome-value">${fmtTHB(p75Final)}</div>
          <div class="outcome-irr ${irrCls(p75IRR)}">IRR: ${fmtIRR(p75IRR)}</div>
          <div class="outcome-desc">มีโอกาส 1 ใน 4 ที่ผลลัพธ์จะสูงกว่านี้</div>
        </div>

        <!-- P50 — Median, highlighted as planning anchor -->
        <div class="outcome-col outcome-col--highlight">
          <span class="outcome-badge med">ผลลัพธ์โดยทั่วไป (P50)</span>
          <div class="outcome-value">${fmtTHB(p50Final)}</div>
          <div class="outcome-irr ${irrCls(p50IRR)}">IRR: ${fmtIRR(p50IRR)}</div>
          <div class="outcome-desc">ค่ากลางของผลลัพธ์ทั้งหมด ใช้เป็นตัววางแผน</div>
        </div>

        <!-- P25 — Downside -->
        <div class="outcome-col">
          <span class="outcome-badge down">กรณีที่ควรเตรียมรับมือ (P25)</span>
          <div class="outcome-value">${fmtTHB(p25Final)}</div>
          <div class="outcome-irr ${irrCls(p25IRR)}">IRR: ${fmtIRR(p25IRR)}</div>
          <div class="outcome-desc">มีโอกาส 1 ใน 4 ที่ผลลัพธ์จะต่ำกว่านี้</div>
        </div>
      </div>

      <div class="planning-banner">
        <span class="planning-banner-icon">ⓘ</span>
        <span>กรอบการวางแผนที่สมเหตุสมผล: <strong>${fmtTHB(p25Final)}</strong> – <strong>${fmtTHB(p75Final)}</strong> ครอบคลุมสถานการณ์ส่วนใหญ่ที่อาจเกิดขึ้น</span>
      </div>
      ${renderFeeSummary()}
    </div>
  `;
}

/**
 * Render fee summary line — shows actual admin fee paid by the P50 scenario
 * (correlated with the P50 portfolio displayed in the outcome card).
 * Returns empty string when fee is 0 (INVESTMENT-ONLY or all lapsed).
 */
function renderFeeSummary() {
  const r = state.results;
  if (!r || !r.p50AdminFee || r.p50AdminFee <= 0) return '';

  const totalPaid = state.premium * paymentCount();
  const feePct = totalPaid > 0 ? (r.p50AdminFee / totalPaid * 100) : 0;

  return `
    <div class="planning-banner" style="background:#fef3c7;border-color:#f59e0b;margin-top:.5rem">
      <span class="planning-banner-icon">💰</span>
      <span>ค่าธรรมเนียมบริหาร (กรณี P50): <strong>${fmtTHB(r.p50AdminFee)}</strong>
        (≈ ${feePct.toFixed(1)}% ของเบี้ยที่ชำระทั้งหมด)</span>
    </div>
  `;
}

function paymentCount() {
  const _ppt = state.lastRun && state.lastRun.pptMonths;
  const months = _ppt != null ? Math.min(state.results.months, _ppt) : state.results.months;
  return Math.ceil(months / simPaymentStep());
}

function buildSummaryTable() {
  const { percentiles, months } = state.results;
  const tbody = document.querySelector('#summaryTable tbody');
  tbody.innerHTML = '';

  const step       = simPaymentStep();
  const totalPremium = simTotalPremium();
  const years      = months / 12;

  // Row label: plain language instead of "percentile N"
  const rowLabels = {
    98: 'กรณีดีมาก (P98)',
    75: 'กรณีที่ดีกว่าปกติ (P75)',
    50: 'ผลลัพธ์โดยทั่วไป (P50)',
    25: 'กรณีที่ควรเตรียมรับมือ (P25)',
  };

  for (const p of [98, 75, 50, 25]) {
    if (!state.selectedPcts.includes(p)) continue;
    const final  = percentiles[p][months - 1] || 0;
    const ret    = final - totalPremium;
    const retPct = totalPremium > 0 ? (ret / totalPremium * 100) : 0;

    // IRR: annualised money-weighted return accounting for DCA timing
    let cagrStr = '-';
    if (final > 0 && totalPremium > 0 && years > 0) {
      const irr = calcIRR(state.premium, step, months, final, state.lastRun && state.lastRun.pptMonths);
      if (irr !== null) cagrStr = fmtIRR(irr);
    }

    const cls     = ret >= 0 ? 'positive' : 'negative';
    const cagrCls = (final >= totalPremium) ? 'positive' : 'negative';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${rowLabels[p]}</td>
      <td>${fmtTHB(totalPremium)}</td>
      <td>${fmtTHB(final)}</td>
      <td class="${cls}">${ret >= 0 ? '+' : ''}${fmtTHB(ret)}</td>
      <td class="${cls}">${ret >= 0 ? '+' : ''}${retPct.toFixed(1)}%</td>
      <td class="${cagrCls}">${cagrStr}</td>
    `;
    tbody.appendChild(tr);
  }
}

function fmtTHB(v) {
  return '฿' + Math.round(v).toLocaleString('th-TH');
}

document.querySelectorAll('.pct-check').forEach(cb => {
  cb.addEventListener('change', () => {
    const p = parseInt(cb.value);
    if (cb.checked) { if (!state.selectedPcts.includes(p)) state.selectedPcts.push(p); }
    else            { state.selectedPcts = state.selectedPcts.filter(x => x !== p); }
    if (state.results) { renderPercentileChart(); buildSummaryTable(); }
  });
});

// Mean overlay toggle
document.getElementById('cbMean').addEventListener('change', e => {
  state.showMean = e.target.checked;
  if (state.results) renderPercentileChart();
});

document.getElementById('btnExportCSV').addEventListener('click', () => {
  if (!state.results) return;
  exportSummaryCSV(
    state.results.percentiles, state.results.months,
    { premium: state.premium, paymentMode: state.paymentMode,
      months: state.results.months, rebalanceMode: state.recommendedMode, N: state.N,
      pptMonths: state.lastRun && state.lastRun.pptMonths },
    state.selectedPcts
  );
});
document.getElementById('btnExportPNG').addEventListener('click', () => exportChartPNG('unit-linked-simulation.png'));
document.getElementById('btnRerun').addEventListener('click', () => goToStep(1));

// ─── Fund Library controller ──────────────────────────────────────────────────

let flActiveTab = 'all';
let flSearchQuery = '';

const FL_RISK_COLORS = {
  1: '#22c55e', 2: '#4ade80', 3: '#a3e635', 4: '#facc15',
  5: '#fb923c', 6: '#f97316', 7: '#ef4444', 8: '#b91c1c',
};
const FL_RISK_TEXT = { 2: '#166534', 3: '#3f6212', 4: '#854d0e' };

function filterFunds() {
  let list = FUND_LIBRARY;
  if (flActiveTab !== 'all') list = list.filter(f => f.risk === flActiveTab);
  if (flSearchQuery.trim()) {
    const q = flSearchQuery.toLowerCase();
    list = list.filter(f =>
      f.nameTH.toLowerCase().includes(q) ||
      f.code.toLowerCase().includes(q)
    );
  }
  return list;
}

function setRiskTab(level) {
  flActiveTab = level;
  renderFundLibrary();
}

function setSearchQuery(q) {
  flSearchQuery = q;
  const clearBtn = document.getElementById('flSearchClear');
  if (clearBtn) clearBtn.style.display = q ? 'block' : 'none';
  renderFundLibrary();
}

function loadFund(code) {
  const fund = FUND_LIBRARY.find(f => f.code === code);
  if (!fund || state.loadedFundIds.has(code)) return;
  state.loadedFundIds.add(code);
  _fetchAndStoreFund(fund);
}

function unloadFund(code) {
  state.loadedFundIds.delete(code);
  renderFundLibrary();
  _updateFlFooter();
}

async function _fetchAndStoreFund(fund) {
  const btn = document.getElementById('fl-btn-' + CSS.escape(fund.code));
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังโหลด...'; }

  try {
    const res = await fetch('data/' + fund.file);
    if (!res.ok) throw new Error('โหลดไฟล์ไม่ได้: ' + fund.file);
    const json = await res.json();

    const rows = (json.rows || []).map(r => ({
      date:  new Date(r.date),
      nav:   r.nav,
      offer: r.offer ?? r.nav,
      bid:   r.bid   ?? r.nav,
    })).filter(r => !isNaN(r.date) && r.nav > 0);

    if (rows.length < 2) throw new Error('ข้อมูลในไฟล์ไม่เพียงพอ');

    saveFundToStorage(fund.code, rows);
    const allData = loadStoredFunds();
    applyNavData(allData);
    showUploadSuccess('โหลด "' + fund.code + '" จากคลังกองทุนเรียบร้อย');
    renderFundLibrary();
    _updateFlFooter();
  } catch (err) {
    state.loadedFundIds.delete(fund.code);
    if (btn) { btn.disabled = false; btn.textContent = '+ โหลด'; btn.className = 'fl-btn-load not-loaded'; }
    showUploadError(err.message);
  }
}

function renderFundLibrary() {
  if (!FUND_LIBRARY.length) return;

  // Compute risk counts
  const riskCounts = {};
  FUND_LIBRARY.forEach(f => { riskCounts[f.risk] = (riskCounts[f.risk] || 0) + 1; });
  const availableRisks = Object.keys(riskCounts).map(Number).sort((a, b) => a - b);

  // Risk mini-squares
  const squaresEl = document.getElementById('flRiskSquares');
  if (squaresEl) {
    squaresEl.innerHTML = availableRisks.map(r => {
      const active = flActiveTab === r;
      const tc = FL_RISK_TEXT[r] || '#fff';
      return '<div class="fl-risk-sq' + (active ? ' active' : '') + '"'
        + ' style="background:' + FL_RISK_COLORS[r] + ';color:' + tc + '"'
        + ' onclick="setRiskTab(flActiveTab === ' + r + ' ? \'all\' : ' + r + ')"'
        + ' title="ระดับความเสี่ยง ' + r + '">' + r + '</div>';
    }).join('');
  }

  // Risk tabs
  const tabsEl = document.getElementById('flRiskTabs');
  if (tabsEl) {
    const allActive = flActiveTab === 'all';
    let html = '<button class="fl-risk-tab' + (allActive ? ' active' : '')
      + '" onclick="setRiskTab(\'all\')">ทั้งหมด'
      + ' <span class="fl-risk-count">' + FUND_LIBRARY.length + '</span></button>';
    html += availableRisks.map(r => {
      const active = flActiveTab === r;
      return '<button class="fl-risk-tab' + (active ? ' active' : '') + '" onclick="setRiskTab(' + r + ')">'
        + '<span class="fl-risk-dot" style="background:' + FL_RISK_COLORS[r] + '"></span>'
        + 'ระดับ ' + r
        + ' <span class="fl-risk-count">' + riskCounts[r] + '</span>'
        + '</button>';
    }).join('');
    tabsEl.innerHTML = html;
  }

  // Filter
  const filtered = filterFunds();

  // Summary bar
  const summaryEl = document.getElementById('flSummary');
  if (summaryEl) {
    const tabLabel = flActiveTab !== 'all' ? ' · ระดับความเสี่ยง <strong>' + flActiveTab + '</strong>' : '';
    const searchLabel = flSearchQuery ? ' · ค้นหา "<strong>' + flSearchQuery + '</strong>"' : '';
    const loadedCount = state.loadedFundIds.size;
    summaryEl.innerHTML =
      '<span>แสดง <strong>' + filtered.length + '</strong> กองทุน' + tabLabel + searchLabel + '</span>'
      + '<span>โหลดแล้ว <strong style="color:var(--accent-green)">' + loadedCount + '</strong> กองทุน</span>';
  }

  // Fund list
  const listEl = document.getElementById('flList');
  if (!listEl) return;

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="fl-empty-state">ไม่พบกองทุนที่ตรงกับการค้นหา</div>';
    _updateFlFooter();
    return;
  }

  listEl.innerHTML = filtered.map(fund => {
    const isLoaded = state.loadedFundIds.has(fund.code);
    const safeCode = CSS.escape(fund.code);
    const escapedName = fund.nameTH.replace(/"/g, '&quot;');
    const btnHtml = isLoaded
      ? '<button class="fl-btn-load is-loaded" id="fl-btn-' + safeCode + '">✓ โหลดแล้ว</button>'
      : '<button class="fl-btn-load not-loaded" id="fl-btn-' + safeCode + '" data-code="' + fund.code.replace(/"/g, '&quot;') + '">+ โหลด</button>';

    return '<div class="fl-fund-row' + (isLoaded ? ' loaded' : '') + '" id="fl-row-' + safeCode + '">'
      + '<div class="fl-risk-pill fl-r' + fund.risk + '" title="ระดับความเสี่ยง ' + fund.risk + '">' + fund.risk + '</div>'
      + '<div class="fl-fund-info">'
      + '<div class="fl-fund-name" title="' + escapedName + '">' + fund.nameTH + '</div>'
      + '<div class="fl-fund-meta">'
      + '<span style="font-weight:600;color:#4a5568">' + fund.code + '</span>'
      + '<span>' + fund.days.toLocaleString() + ' วัน · ' + fund.dateFrom + ' — ' + fund.dateTo + '</span>'
      + '<span>NAV ล่าสุด: <span class="fl-nav">' + fund.nav.toFixed(4) + '</span></span>'
      + '</div></div>'
      + btnHtml
      + '</div>';
  }).join('');

  _updateFlFooter();
}

function _updateFlFooter() {
  const count = state.loadedFundIds.size;
  const hasData = state.fundNames.length > 0;
  const summaryEl = document.getElementById('flLoadedSummary');
  const btnEl = document.getElementById('flBtnProceed');
  if (summaryEl) {
    summaryEl.innerHTML = count > 0
      ? '<strong>' + count + '</strong> กองทุนถูกเลือก · จะถูกเพิ่มในกองทุนที่บันทึกไว้'
      : '<strong>0</strong> กองทุนถูกเลือก';
  }
  if (btnEl) btnEl.disabled = !hasData;
}

// ─── Init: load stored funds on page start ────────────────────────────────────
applyNavData(loadStoredFunds());
goToStep(0);

// Wire fund list — event delegation (single listener, survives re-renders)
document.getElementById('flList').addEventListener('click', e => {
  const btn = e.target.closest('.fl-btn-load.not-loaded');
  if (!btn) return;
  const code = btn.dataset.code;
  if (code) loadFund(code);
});

// Wire search
document.getElementById('flSearchInput').addEventListener('input', e => setSearchQuery(e.target.value));
document.getElementById('flSearchClear').addEventListener('click', () => {
  document.getElementById('flSearchInput').value = '';
  setSearchQuery('');
  document.getElementById('flSearchInput').focus();
});

// Wire footer proceed button
document.getElementById('flBtnProceed').addEventListener('click', () => {
  if (state.fundNames.length === 0) return;
  buildParamsStep();
  goToStep(1);
});

// Init fund library
initFundLibrary().then(() => {
  if (!FUND_LIBRARY.length) {
    document.getElementById('fundLibraryCard').style.display = 'none';
    return;
  }
  // Sync loadedFundIds from localStorage on first load
  const stored = loadStorageRaw();
  FUND_LIBRARY.forEach(f => { if (stored[f.code]) state.loadedFundIds.add(f.code); });
  renderFundLibrary();
  _updateFlFooter();
});
