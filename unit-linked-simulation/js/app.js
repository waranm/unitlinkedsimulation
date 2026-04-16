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
  const { jointMonths, jointInceptionDate, jointEndDate } = state;
  const container = document.getElementById('periodOptions');
  container.innerHTML = '';
  state.selectedPeriod = null;

  const opts = [];
  if (jointMonths >= 12)  opts.push({ label: '1 ปี',  months: 12 });
  if (jointMonths >= 36)  opts.push({ label: '3 ปี',  months: 36 });
  if (jointMonths >= 60)  opts.push({ label: '5 ปี',  months: 60 });

  const sinceLabel = jointInceptionDate
    ? `ตั้งแต่ Joint Inception (${(jointMonths / 12).toFixed(1)} ปี)`
    : 'ตั้งแต่ Joint Inception';
  opts.push({ label: sinceLabel, months: jointMonths });

  opts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'period-btn';
    btn.textContent = opt.label;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedPeriod = opt.months;
      updateJointInfo();
    });
    container.appendChild(btn);
  });

  updateJointInfo();
}

function updateJointInfo() {
  const { jointInceptionDate, jointEndDate, jointMonths } = state;
  const box = document.getElementById('jointInfo');
  if (!jointInceptionDate) { box.style.display = 'none'; return; }
  const fmt = d => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  box.style.display = 'block';
  box.innerHTML = `
    <strong>Joint Inception:</strong> ${fmt(jointInceptionDate)}
    &nbsp;→&nbsp;
    <strong>ข้อมูลล่าสุด:</strong> ${fmt(jointEndDate)}
    &nbsp;|&nbsp;
    <strong>ระยะเวลา:</strong> ${(jointMonths / 12).toFixed(2)} ปี (${jointMonths} เดือน)
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
  state.rebalanceMode = document.querySelector('input[name="rebalance"]:checked')?.value || 'none';
  state.N             = parseInt(document.getElementById('inputN').value) || 1000;

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
  document.getElementById('simSummary').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px 28px">
      <div>💰 <strong>เบี้ย:</strong> ฿${(s.premium||0).toLocaleString()} / ${modeLabel[s.paymentMode]||s.paymentMode}</div>
      <div>📅 <strong>ระยะเวลา:</strong> ${periodLabel}</div>
      <div>⚖️ <strong>Rebalancing:</strong> ${rebalLabel[s.rebalanceMode]||s.rebalanceMode}</div>
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

  try {
    const results = await runMonteCarlo({
      navData: state.navData, allocation: state.allocation,
      premium: state.premium, paymentMode: state.paymentMode,
      months: state.selectedPeriod, rebalanceMode: state.rebalanceMode,
      N: state.N, feeParams: {},
    }, pct => {
      document.getElementById('progressBar').style.width = pct + '%';
      document.getElementById('progressText').textContent = pct + '%';
    });

    state.results = results;
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

// ─── Step 4: Results ──────────────────────────────────────────────────────────
function buildResultsStep() {
  renderPercentileChart();
  buildSummaryTable();
}

function renderPercentileChart() {
  const ctx = document.getElementById('simulationChart').getContext('2d');
  renderChart(ctx, state.results.percentiles, state.results.months, state.selectedPcts, new Date());
}

function buildSummaryTable() {
  const { percentiles, months } = state.results;
  const tbody = document.querySelector('#summaryTable tbody');
  tbody.innerHTML = '';

  const intervals = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 };
  const step = intervals[state.paymentMode] || 1;
  let payments = 0;
  for (let m = 0; m < months; m += step) payments++;
  const totalPremium = state.premium * payments;

  for (const p of [98, 75, 50, 25]) {
    if (!state.selectedPcts.includes(p)) continue;
    const final  = percentiles[p][months - 1] || 0;
    const ret    = final - totalPremium;
    const retPct = totalPremium > 0 ? (ret / totalPremium * 100) : 0;
    const cls    = ret >= 0 ? 'positive' : 'negative';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>เปอร์เซ็นไทล์ที่ ${p}</td>
      <td>${fmtTHB(totalPremium)}</td>
      <td>${fmtTHB(final)}</td>
      <td class="${cls}">${ret >= 0 ? '+' : ''}${fmtTHB(ret)}</td>
      <td class="${cls}">${ret >= 0 ? '+' : ''}${retPct.toFixed(1)}%</td>
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
