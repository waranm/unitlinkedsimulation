# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pure-frontend Monte Carlo simulation tool for Unit Linked insurance products.  
No build step, no dependencies to install — open `index.html` directly in a browser (or via a local static server).

## Running the App

```bash
# Option A: Python quick server (any directory)
python -m http.server 8080
# then open http://localhost:8080

# Option B: Node
npx serve .

# Option C: Just open index.html directly in Chrome/Edge
```

There are no tests, no linting config, and no build process.

## File Structure

```
index.html          — Single-page UI; all four steps live here as .section divs
css/style.css       — All styles; uses CSS custom properties (--primary, etc.)
js/simulation.js    — Monte Carlo engine (pure functions, no DOM)
js/charts.js        — Chart.js wrapper; renderChart(), exportChartPNG()
js/export.js        — CSV export helpers; exportSummaryCSV(), exportCSV()
js/app.js           — UI controller: state object, step navigation, wiring
sample-nav.csv      — Example CSV for manual testing
```

## Architecture

### State
A single `state` object in `app.js` is the source of truth. All steps read/write it directly — no events or reactive system.

### Step flow
`goToStep(idx)` swaps `.active` on `.section` divs and updates the stepper UI. Step 2→3 patches `goToStep` to inject a run-summary before simulation.

### Simulation engine (`simulation.js`)
- `calcFundStats(navData)` → per-fund monthly log-return mean & std
- `runScenario(params)` → single path: simulate NAV month-by-month via Box-Muller normal, buy units on premium months, call `applyFees()` hook, optionally rebalance
- `runMonteCarlo(config, onProgress)` → async; yields every 100 scenarios so the progress bar updates; returns `{ percentiles: {25,50,75,98}: number[], months }`

### Adding fees (v2 hook)
`applyFees(portfolio, navPrices, feeParams, month)` in `simulation.js` is currently a no-op. Implement it there; pass fee config via `feeParams` in `runMonteCarlo()` → `runScenario()`. No other files need changing.

### CSV format expected
Column 0 = date (YYYY-MM-DD, DD/MM/YYYY, or MM/DD/YYYY). Columns 1+ = NAV values per fund. `parseCSV()` in `app.js` handles parsing and rejects funds with < 2 valid rows.

## Key Design Decisions

- **Joint inception date** = latest first-date among all loaded funds; determines which period options are shown.
- **Premium months** are pre-computed as a `Set` of 0-based month indices by `buildPremiumMonths()` — avoids per-step conditionals inside the hot loop.
- **Rebalancing** occurs *after* fee deduction and *after* premium contribution each month.
- Chart.js is loaded from CDN (`chart.umd.min.js` v4). If offline, swap for a local copy.
