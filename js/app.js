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
  rebalanceMode: 'none',
  N: 1000,
  allocation: {},

  results: null,
  selectedPcts: [25, 50, 75, 98],
  showMean: true,           // toggle for mean overlay on chart

  compareRebalance: false,  // compare-mode toggle
  compareResults: null,     // { monthly, quarterly, annual } — cached when compare mode runs
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
  buildPeriodOptions();
  buildAllocationTable();
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
  const total = Object.values(state.allocation).reduce((s, v) => s + v, 0);
  const el = document.getElementById('allocTotal');
  el.textContent = `รวม: ${total.toFixed(2)}%`;
  el.className = 'alloc-total ' + (Math.abs(total - 100) < 0.01 ? 'ok' : 'err');
}

document.getElementById('btnNext2').addEventListener('click', () => {
  state.premium       = parseFloat(document.getElementById('inputPremium').value) || 5000;
  state.paymentMode   = document.getElementById('selectPayment').value;
  state.rebalanceMode    = document.querySelector('input[name="rebalance"]:checked')?.value || 'none';
  state.N                = parseInt(document.getElementById('inputN').value) || 1000;
  state.compareRebalance = document.getElementById('cbCompareRebalance').checked;

  if (!state.selectedPeriod) { alert('กรุณาเลือกระยะเวลา Simulation'); return; }
  const allocTotal = Object.values(state.allocation).reduce((s, v) => s + v, 0);
  if (Math.abs(allocTotal - 100) > 0.01) {
    alert('การจัดสรรสินทรัพย์ต้องรวมเป็น 100% (ปัจจุบัน: ' + allocTotal.toFixed(2) + '%)'); return;
  }
  if (state.premium < 1000 || state.premium > 100000) {
    alert('เบี้ยประกันต้องอยู่ระหว่าง 1,000 - 100,000 บาท'); return;
  }
  goToStep(2);
});

document.getElementById('btnBack2').addEventListener('click', () => goToStep(0));

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
  const rebalLabel = { none:'ไม่มี', monthly:'รายเดือน', quarterly:'รายไตรมาส', annual:'รายปี' };
  const funds = s.fundNames.map(f => `${f} ${s.allocation[f]}%`).join(', ');
  const rebalDisplay = s.compareRebalance
    ? '<span style="color:var(--primary);font-weight:700">เปรียบเทียบ 4 กลยุทธ์ (ไม่ปรับ / รายเดือน / รายไตรมาส / รายปี)</span>'
    : (rebalLabel[s.rebalanceMode] || s.rebalanceMode);
  document.getElementById('simSummary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 28px">
      <div>💰 <strong>เบี้ย:</strong> ฿${(s.premium||0).toLocaleString()} / ${modeLabel[s.paymentMode]||s.paymentMode}</div>
      <div>📅 <strong>ระยะเวลา:</strong> ${periodLabel}</div>
      <div>⚖️ <strong>Rebalancing:</strong> ${rebalDisplay}</div>
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

  const baseConfig = {
    navData: state.navData, allocation: state.allocation,
    premium: state.premium, paymentMode: state.paymentMode,
    months: state.selectedPeriod, N: state.N, feeParams: {},
  };

  try {
    if (state.compareRebalance) {
      // All modes share the same seed so Monte Carlo variance is eliminated
      // from the comparison — any difference reflects rebalancing only.
      const compareSeed = Date.now();
      const modes = ['none', 'monthly', 'quarterly', 'annual'];
      const compareResults = {};
      for (let i = 0; i < modes.length; i++) {
        compareResults[modes[i]] = await runMonteCarlo(
          { ...baseConfig, rebalanceMode: modes[i], seed: compareSeed },
          pct => setProgress((i * 100 + pct) / modes.length)
        );
      }
      state.compareResults = compareResults;
      // Primary mode drives the summary panel
      const primary = modes.includes(state.rebalanceMode) ? state.rebalanceMode : 'none';
      state.results = compareResults[primary];
    } else {
      state.compareResults = null;
      state.results = await runMonteCarlo(
        { ...baseConfig, rebalanceMode: state.rebalanceMode },
        setProgress
      );
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

/** Total premium paid over the simulation period. */
function simTotalPremium() {
  const step = simPaymentStep();
  const { months } = state.results;
  let n = 0;
  for (let m = 0; m < months; m += step) n++;
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
  const isCompare = state.compareRebalance && state.compareResults;

  // Toggle chart-area elements depending on mode
  document.querySelector('.pct-options').style.display        = isCompare ? 'none' : '';
  document.getElementById('rebalCompareInsight').style.display = isCompare ? '' : 'none';

  renderOutcomeSummary();    // 3-column summary — always uses state.results (primary mode)

  if (isCompare) {
    renderCompareRebalChart();    // P50 overlay of all 3 frequencies
    renderRebalCompareInsight();  // dynamic insight text
  } else {
    renderPercentileChart();      // normal percentile chart with mean overlay
  }

  renderRiskFraming();      // probability statements
  buildSummaryTable();      // detailed table
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

/** Render P50-only comparison chart for all 3 rebalance frequencies. */
function renderCompareRebalChart() {
  const ctx = document.getElementById('simulationChart').getContext('2d');
  const primaryMode = ['none', 'monthly', 'quarterly', 'annual'].includes(state.rebalanceMode)
    ? state.rebalanceMode : null;
  renderCompareRebalanceChart(ctx, state.compareResults, primaryMode, new Date());
}

/** Generate the compare-rebalance insight card with side-by-side table + insight text. */
function renderRebalCompareInsight() {
  const el = document.getElementById('rebalCompareInsight');
  if (!el || !state.compareResults) return;

  const cr         = state.compareResults;
  const months     = state.results.months;
  const totalPaid  = simTotalPremium();
  const step       = simPaymentStep();
  const primaryMode = ['none', 'monthly', 'quarterly', 'annual'].includes(state.rebalanceMode)
    ? state.rebalanceMode : null;

  const MODES = ['none', 'monthly', 'quarterly', 'annual'];
  const nameMap  = { none: 'ไม่ปรับสมดุล', monthly: 'รายเดือน', quarterly: 'รายไตรมาส', annual: 'รายปี' };
  const colorMap = { none: '#9ca3af',       monthly: '#1a56a0',  quarterly: '#e8a020',   annual: '#16a34a' };

  // Compute per-mode stats
  const rows = MODES.map(mode => {
    const p50   = cr[mode].percentiles[50][months - 1];
    const profit = p50 - totalPaid;
    const irr   = calcIRR(state.premium, step, months, p50);
    return { mode, p50, profit, irr };
  });

  // Find best P50
  const bestP50 = Math.max(...rows.map(r => r.p50));

  // Build table rows
  const rowsHTML = rows.map(r => {
    const isBest    = r.p50 === bestP50;
    const isPrimary = r.mode === primaryMode;
    const profitCls = r.profit >= 0 ? 'positive' : 'negative';
    const irrCls    = r.irr !== null && r.irr >= 0 ? 'positive' : 'negative';

    const badge = isBest
      ? `<span class="rc-badge rc-badge--best">ดีที่สุด</span>`
      : isPrimary
        ? `<span class="rc-badge rc-badge--primary">ที่เลือก</span>`
        : '';

    return `
      <tr class="${isBest ? 'rc-row--best' : ''}">
        <td>
          <span class="rc-dot" style="background:${colorMap[r.mode]}"></span>
          ${nameMap[r.mode]}${badge}
        </td>
        <td class="rc-num">${fmtTHB(r.p50)}</td>
        <td class="rc-num ${profitCls}">${r.profit >= 0 ? '+' : ''}${fmtTHB(r.profit)}</td>
        <td class="rc-num ${irrCls}">${r.irr !== null ? fmtIRR(r.irr) : '—'}</td>
      </tr>`;
  }).join('');

  // Insight text
  const worstP50 = Math.min(...rows.map(r => r.p50));
  const diffPct  = worstP50 > 0 ? ((bestP50 - worstP50) / worstP50 * 100) : 0;
  const bestModeName = nameMap[rows.find(r => r.p50 === bestP50).mode];

  let insight;
  if (diffPct < 1) {
    insight = 'ทั้ง 3 ความถี่ให้ผลลัพธ์ใกล้เคียงกันมาก สำหรับพอร์ตนี้การปรับสมดุลบ่อยหรือน้อยแทบไม่มีผลต่อมูลค่าสุดท้าย';
  } else if (diffPct < 5) {
    insight = `กลยุทธ์${bestModeName}ให้ผลลัพธ์ทั่วไปสูงกว่าเล็กน้อย (${diffPct.toFixed(1)}%) แต่ความแตกต่างไม่มาก — ทุกความถี่เหมาะสมสำหรับพอร์ตนี้`;
  } else {
    insight = `กลยุทธ์${bestModeName}ให้ผลลัพธ์ทั่วไปดีที่สุดสำหรับพอร์ตและระยะเวลานี้ สูงกว่าความถี่ที่ด้อยที่สุดประมาณ ${diffPct.toFixed(1)}%`;
  }

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon">⚖️</span> เปรียบเทียบความถี่การปรับสมดุล</div>

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

      <p class="rc-insight">💡 ${insight}</p>
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

  const { percentiles, months, meanSeries } = state.results;
  const totalPaid = simTotalPremium();
  const step      = simPaymentStep();

  // Guard: meanSeries may be absent if simulation.js was cached before mean was added.
  // In that case fall back to the P75 value as a rough proxy and show a warning.
  const hasMean   = Array.isArray(meanSeries) && meanSeries.length === months;
  const meanFinal = hasMean ? meanSeries[months - 1] : null;
  const p50Final  = percentiles[50][months - 1];
  const p25Final  = percentiles[25][months - 1];

  const meanIRR = hasMean ? calcIRR(state.premium, step, months, meanFinal) : null;
  const p50IRR  = calcIRR(state.premium, step, months, p50Final);
  const p25IRR  = calcIRR(state.premium, step, months, p25Final);

  // Positive/negative class for IRR display
  function irrCls(irr) { return irr === null ? '' : irr >= 0 ? 'positive' : 'negative'; }

  // The gap between mean and median (mean > median for a right-skewed distribution)
  const gap        = hasMean ? (meanFinal - p50Final) : null;
  const gapPct     = (hasMean && totalPaid > 0) ? (gap / totalPaid * 100) : null;
  // Relative gap vs median — drives insight tone
  const relGapPct  = (hasMean && p50Final > 0) ? ((meanFinal - p50Final) / p50Final * 100) : null;

  function mmcInsight(relGap) {
    if (relGap === null) return '';
    if (relGap < 5)
      return 'ค่าเฉลี่ยอาจสูงกว่าเล็กน้อย'
           + ' แต่ผลลัพธ์ที่คนส่วนใหญ่จะเจอคือ <strong>ผลลัพธ์ทั่วไป</strong>'
           + ' — ควรใช้ค่านี้ในการวางแผน';
    if (relGap < 20)
      return 'ค่าเฉลี่ยถูกดึงสูงขึ้นจากบางกรณีที่ได้ผลดีมาก'
           + ' ผลลัพธ์ที่คุณมีโอกาสได้รับจริงใกล้เคียงกับ <strong>ผลลัพธ์ทั่วไป</strong>'
           + ' มากกว่า — ใช้ตัวเลขนี้เป็นเกณฑ์หลักในการวางแผน';
    return 'ค่าเฉลี่ยสูงกว่าผลลัพธ์จริงที่คนส่วนใหญ่จะได้รับ'
         + ' เพราะถูกดึงขึ้นโดยกรณีที่ดีที่สุดเพียงไม่กี่กรณี'
         + ' — <strong>ผลลัพธ์ทั่วไป</strong>สะท้อนสิ่งที่คุณควรใช้วางแผนจริงๆ';
  }

  // Average column — show placeholder when meanSeries is unavailable
  const avgColHTML = hasMean ? `
        <div class="outcome-col">
          <span class="outcome-badge avg">ค่าเฉลี่ย (Average)</span>
          <div class="outcome-value">${fmtTHB(meanFinal)}</div>
          <div class="outcome-irr ${irrCls(meanIRR)}">IRR: ${fmtIRR(meanIRR)}</div>
          <div class="outcome-desc">
            อาจถูกดึงขึ้นจากบางกรณีที่ได้ผลดีมาก<br>
            ไม่ใช่สิ่งที่ทุกคนจะได้รับ
          </div>
        </div>` : `
        <div class="outcome-col" style="opacity:.45">
          <span class="outcome-badge avg">ค่าเฉลี่ย (Average)</span>
          <div class="outcome-value" style="font-size:16px;color:var(--gray-400)">—</div>
          <div class="outcome-desc" style="font-size:12px">
            รีเฟรชหน้าเว็บแล้วรัน<br>
            เพื่อดูค่าเฉลี่ย
          </div>
        </div>`;

  // Mean vs Median comparison block — hide when mean unavailable
  const compareHTML = hasMean ? `
      <div class="mean-median-note">
        <div class="mean-median-compare">
          <span class="mmc-label">ค่าเฉลี่ย</span>
          <span class="mmc-val">${fmtTHB(meanFinal)}</span>
          <span class="mmc-sep" style="color:var(--gray-300);padding:0 4px">vs</span>
          <span class="mmc-label">ผลลัพธ์ทั่วไป</span>
          <span class="mmc-val">${fmtTHB(p50Final)}</span>
          <span class="mmc-sep" style="color:var(--gray-300);padding:0 4px">→</span>
          <span class="mmc-diff-label">ค่าเฉลี่ยสูงกว่าประมาณ</span>
          <span class="mmc-diff ${gap >= 0 ? 'positive' : 'negative'}">
            ${fmtTHB(Math.abs(gap))} (${Math.abs(gapPct).toFixed(1)}%)
          </span>
        </div>
        <p class="mmc-explanation">ℹ️ ${mmcInsight(relGapPct)}</p>
      </div>` : '';

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon">📊</span> สรุปผลลัพธ์</div>

      <!-- ── 3-column outcome grid ── -->
      <div class="outcome-grid">
        ${avgColHTML}

        <!-- Typical / Median — highlighted as most decision-relevant -->
        <div class="outcome-col outcome-col--highlight">
          <span class="outcome-badge med">ผลลัพธ์ทั่วไป (Most Likely)</span>
          <div class="outcome-value">${fmtTHB(p50Final)}</div>
          <div class="outcome-irr ${irrCls(p50IRR)}">IRR: ${fmtIRR(p50IRR)}</div>
          <div class="outcome-desc">
            มีโอกาส 50% ได้มากกว่านี้<br>
            และ 50% ได้น้อยกว่านี้
          </div>
        </div>

        <!-- Downside / P25 -->
        <div class="outcome-col">
          <span class="outcome-badge down">กรณีที่ควรเตรียมรับมือ</span>
          <div class="outcome-value">${fmtTHB(p25Final)}</div>
          <div class="outcome-irr ${irrCls(p25IRR)}">IRR: ${fmtIRR(p25IRR)}</div>
          <div class="outcome-desc">
            มีโอกาส 1 ใน 4 ที่ผลลัพธ์อาจต่ำกว่านี้<br>
            ควรเตรียมรับความผันผวนไว้ด้วย
          </div>
        </div>
      </div>

      ${compareHTML}
    </div>
  `;
}

/**
 * Render the probability framing section below the chart.
 * Plain-language statements — no jargon, no "percentile".
 */
function renderRiskFraming() {
  const el = document.getElementById('resultRiskFraming');
  if (!el) return;

  const { percentiles, months } = state.results;
  const p25 = percentiles[25][months - 1];
  const p50 = percentiles[50][months - 1];
  const p75 = percentiles[75][months - 1];

  el.innerHTML = `
    <div class="card">
      <div class="card-title"><span class="icon">🎯</span> โอกาสของผลลัพธ์</div>
      <div class="risk-grid">

        <div class="risk-item risk-up">
          <div class="risk-pct">50%</div>
          <div class="risk-direction">ผลลัพธ์ทั่วไป</div>
          <div class="risk-phrase">มีโอกาส 50% ที่มูลค่าจะสูงกว่า</div>
          <div class="risk-value">${fmtTHB(p50)}</div>
        </div>

        <div class="risk-item risk-down">
          <div class="risk-pct">1 ใน 4</div>
          <div class="risk-direction">ควรเตรียมรับมือ</div>
          <div class="risk-phrase">มีโอกาส 1 ใน 4 ที่มูลค่าอาจต่ำกว่า</div>
          <div class="risk-value">${fmtTHB(p25)}</div>
        </div>

        <div class="risk-item risk-up2">
          <div class="risk-pct">1 ใน 4</div>
          <div class="risk-direction">กรณีที่ดี</div>
          <div class="risk-phrase">มีโอกาส 1 ใน 4 ที่มูลค่าจะเกิน</div>
          <div class="risk-value">${fmtTHB(p75)}</div>
        </div>

      </div>
    </div>
  `;
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
    98: 'กรณีดีมาก (98%)',
    75: 'กรณีดี (75%)',
    50: 'ผลลัพธ์ทั่วไป (50%)',
    25: 'กรณีที่ควรเตรียมรับมือ (25%)',
  };

  for (const p of [98, 75, 50, 25]) {
    if (!state.selectedPcts.includes(p)) continue;
    const final  = percentiles[p][months - 1] || 0;
    const ret    = final - totalPremium;
    const retPct = totalPremium > 0 ? (ret / totalPremium * 100) : 0;

    // IRR: annualised money-weighted return accounting for DCA timing
    let cagrStr = '-';
    if (final > 0 && totalPremium > 0 && years > 0) {
      const irr = calcIRR(state.premium, step, months, final);
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

// Compare-rebalance toggle — show/hide hint text in step 2
document.getElementById('cbCompareRebalance').addEventListener('change', e => {
  document.getElementById('compareToggleHint').style.display = e.target.checked ? 'block' : 'none';
});

document.getElementById('btnExportCSV').addEventListener('click', () => {
  if (!state.results) return;
  exportSummaryCSV(
    state.results.percentiles, state.results.months,
    { premium: state.premium, paymentMode: state.paymentMode,
      months: state.results.months, rebalanceMode: state.rebalanceMode, N: state.N },
    state.selectedPcts
  );
});
document.getElementById('btnExportPNG').addEventListener('click', () => exportChartPNG('unit-linked-simulation.png'));
document.getElementById('btnRerun').addEventListener('click', () => goToStep(1));

// ─── Fund Library (pre-hosted data files) ────────────────────────────────────

async function loadFundLibrary() {
  const container = document.getElementById('fundLibrary');
  try {
    const res = await fetch('data/funds-index.json');
    if (!res.ok) throw new Error('ไม่พบ funds-index.json');
    const index = await res.json();

    if (!index.length) {
      container.innerHTML = '<p style="color:var(--gray-400);font-size:13px">ยังไม่มีกองทุนในคลัง</p>';
      return;
    }

    // Check which funds are already loaded
    const stored = loadStorageRaw();

    container.innerHTML = index.map(entry => {
      const isLoaded = !!stored[entry.name];
      const dateRange = `${entry.firstDate} → ${entry.lastDate}`;
      return `
        <div class="fund-lib-card" id="lib-${CSS.escape(entry.name)}">
          <div class="fund-card-info">
            <div class="fund-card-name">${entry.name}</div>
            <div class="fund-card-meta">
              ${entry.count.toLocaleString()} วัน &nbsp;·&nbsp; ${dateRange}
              &nbsp;·&nbsp; NAV ล่าสุด: <strong>${entry.latestNAV}</strong>
            </div>
          </div>
          <button class="btn btn-sm lib-load-btn ${isLoaded ? 'btn-loaded' : 'btn-primary'}"
            data-file="${entry.file}" data-name="${entry.name}">
            ${isLoaded ? '✓ โหลดแล้ว' : '+ โหลด'}
          </button>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.lib-load-btn').forEach(btn => {
      btn.addEventListener('click', () => loadFundFromLibrary(btn));
    });

  } catch (err) {
    // No library available (running locally without server) — hide section silently
    container.closest('.card').style.display = 'none';
  }
}

async function loadFundFromLibrary(btn) {
  const file = btn.dataset.file;
  const name = btn.dataset.name;

  btn.disabled = true;
  btn.textContent = 'กำลังโหลด...';

  try {
    const res = await fetch(`data/${file}`);
    if (!res.ok) throw new Error(`โหลดไฟล์ไม่ได้: ${file}`);
    const json = await res.json();

    // Parse rows — dates are ISO strings
    const rows = (json.rows || []).map(r => ({
      date:  new Date(r.date),
      nav:   r.nav,
      offer: r.offer ?? r.nav,
      bid:   r.bid   ?? r.nav,
    })).filter(r => !isNaN(r.date) && r.nav > 0);

    if (rows.length < 2) throw new Error('ข้อมูลในไฟล์ไม่เพียงพอ');

    saveFundToStorage(name, rows);
    const allData = loadStoredFunds();
    applyNavData(allData);

    btn.textContent = '✓ โหลดแล้ว';
    btn.className = 'btn btn-sm btn-loaded';
    btn.disabled = false;

    showUploadSuccess(`โหลด "${name}" จากคลังกองทุนเรียบร้อย`);
  } catch (err) {
    btn.textContent = '+ โหลด';
    btn.disabled = false;
    showUploadError(err.message);
  }
}

// ─── Init: load stored funds on page start ────────────────────────────────────
applyNavData(loadStoredFunds());
loadFundLibrary();
goToStep(0);
