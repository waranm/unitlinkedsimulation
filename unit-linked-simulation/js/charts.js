/**
 * charts.js — Chart rendering using Chart.js
 */

'use strict';

const PERCENTILE_COLORS = {
  98: { border: '#16a34a', bg: 'rgba(22,163,74,0.08)'  },
  75: { border: '#1a56a0', bg: 'rgba(26,86,160,0.10)'  },
  50: { border: '#e8a020', bg: 'rgba(232,160,32,0.10)' },
  25: { border: '#dc2626', bg: 'rgba(220,38,38,0.08)'  },
};

const PERCENTILE_LABELS = {
  98: 'เปอร์เซ็นไทล์ที่ 98 (Optimistic)',
  75: 'เปอร์เซ็นไทล์ที่ 75 (Above Average)',
  50: 'เปอร์เซ็นไทล์ที่ 50 (Median)',
  25: 'เปอร์เซ็นไทล์ที่ 25 (Conservative)',
};

let chartInstance = null;

/**
 * Render / update the percentile chart.
 * @param {CanvasRenderingContext2D|string} ctx  canvas id or context
 * @param {Object}  percentiles  { 25: [], 50: [], 75: [], 98: [] }
 * @param {number}  months       total months
 * @param {number[]} selected    which percentiles to show
 * @param {Date}    startDate    simulation start date (for x-axis labels)
 */
function renderChart(ctx, percentiles, months, selected, startDate) {
  if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

  const labels = [];
  const base = startDate ? new Date(startDate) : new Date();
  for (let m = 0; m < months; m++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + m + 1);
    labels.push(`${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  const datasets = [];
  // Render from highest to lowest so fills stack nicely
  for (const p of [98, 75, 50, 25]) {
    if (!selected.includes(p)) continue;
    const col = PERCENTILE_COLORS[p];
    datasets.push({
      label: PERCENTILE_LABELS[p],
      data: percentiles[p],
      borderColor: col.border,
      backgroundColor: col.bg,
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      tension: 0.3,
    });
  }

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { usePointStyle: true, pointStyleWidth: 16, padding: 16, font: { size: 12 } },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              return ` ${ctx.dataset.label}: ${formatTHB(ctx.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 12,
            font: { size: 11 },
            maxRotation: 45,
          }
        },
        y: {
          grid: { color: '#f3f4f6' },
          ticks: {
            font: { size: 11 },
            callback: v => formatTHBCompact(v),
          }
        }
      }
    }
  });

  return chartInstance;
}

function formatTHB(v) {
  return '฿' + v.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatTHBCompact(v) {
  if (Math.abs(v) >= 1_000_000) return '฿' + (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000)     return '฿' + (v / 1_000).toFixed(0) + 'K';
  return '฿' + v.toFixed(0);
}

/**
 * Export the current chart as PNG.
 */
function exportChartPNG(filename = 'simulation-chart.png') {
  if (!chartInstance) return;
  const url = chartInstance.toBase64Image('image/png', 1);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}
