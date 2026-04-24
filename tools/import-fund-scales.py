"""
import-fund-scales.py
Usage: python tools/import-fund-scales.py
       (run from the project root)

Reads docs/fundScales_recommendation.xlsx and rewrites the regimes[].fundScales
blocks inside js/app.js.

Excel column layout (1-indexed row 5 onward, header rows 1-4 are skipped):
  A  Fund code  (matches funds-index.json "name")
  B  Asset class
  C  Status
  D  Bull muScale
  E  Bull sigmaScale
  F  Bear muScale
  G  Bear sigmaScale
  H  Crisis muScale
  I  Crisis sigmaScale
  J  Has muOverride? ("YES" / "no")
  K  Override Values e.g. "Bull:0.003 | Bear:0.002 | Crisis:-0.002"
  L  Notes

For muOverride funds the override value replaces muScale in that regime's entry.
"""

import re
import sys
import os

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl not found — run: pip install openpyxl")

EXCEL_PATH  = os.path.join('docs', 'fundScales_recommendation.xlsx')
APP_JS_PATH = os.path.join('js', 'app.js')

# ── helpers ──────────────────────────────────────────────────────────────────

def fmt(v):
    """Format a number for JS: drop .0 suffix on whole numbers."""
    if v is None:
        return 'null'
    f = float(v)
    if f == int(f) and abs(f) < 1e12:
        return str(int(f))
    # Trim unnecessary trailing zeros
    s = f'{f:.10g}'
    return s

def parse_overrides(cell):
    """'Bull:0.003 | Bear:0.002 | Crisis:-0.002' → {Bull: 0.003, ...}"""
    result = {}
    if not cell:
        return result
    for part in str(cell).split('|'):
        part = part.strip()
        if ':' in part:
            k, v = part.split(':', 1)
            result[k.strip()] = float(v.strip())
    return result

# ── read Excel ───────────────────────────────────────────────────────────────

wb = openpyxl.load_workbook(EXCEL_PATH)
sh = wb.worksheets[0]

funds = []
for row in sh.iter_rows(min_row=5, values_only=True):   # rows 1-4 are headers
    code = row[0]
    if not code:
        continue
    code = str(code).strip()
    has_override = str(row[9] or '').strip().upper() == 'YES'
    overrides    = parse_overrides(row[10]) if has_override else {}

    funds.append({
        'code':       code,
        'bull_mu':    row[3],  'bull_sig':   row[4],
        'bear_mu':    row[5],  'bear_sig':   row[6],
        'crisis_mu':  row[7],  'crisis_sig': row[8],
        'has_override': has_override,
        'overrides':  overrides,
    })

print(f"Read {len(funds)} funds from {EXCEL_PATH}")

# ── build fundScales JS for one regime ───────────────────────────────────────

REGIMES = ['Bull', 'Bear', 'Crisis']

def scale_obj(fund, regime):
    r = regime.lower()
    sig = fund[f'{r}_sig']
    if fund['has_override'] and regime in fund['overrides']:
        ov = fund['overrides'][regime]
        return f'{{ muOverride: {fmt(ov)}, sigmaScale: {fmt(sig)} }}'
    else:
        mu = fund[f'{r}_mu']
        return f'{{ muScale: {fmt(mu)}, sigmaScale: {fmt(sig)} }}'

def build_fund_scales_block(regime, funds, base_indent='          '):
    max_key_len = max(len(f"'{f['code']}'") for f in funds)
    lines = []
    for f in funds:
        key     = f"'{f['code']}'"
        padding = ' ' * (max_key_len - len(key))
        obj     = scale_obj(f, regime)
        lines.append(f"{base_indent}{key}:{padding} {obj},")
    return '\n'.join(lines)

# ── assemble the full regimes block ──────────────────────────────────────────

def regimes_block(funds):
    bull   = build_fund_scales_block('Bull',   funds)
    bear   = build_fund_scales_block('Bear',   funds)
    crisis = build_fund_scales_block('Crisis', funds)
    return (
        "    regimes: [\n"
        "      {\n"
        "        name: 'Bull',\n"
        "        defaultScale: { muScale: 1.0, sigmaScale: 1.0 },\n"
        "        fundScales: {\n"
        f"{bull}\n"
        "        },\n"
        "      },\n"
        "      {\n"
        "        name: 'Bear',\n"
        "        defaultScale: { muScale: -0.5, sigmaScale: 1.5 },\n"
        "        fundScales: {\n"
        f"{bear}\n"
        "        },\n"
        "      },\n"
        "      {\n"
        "        name: 'Crisis',\n"
        "        defaultScale: { muScale: -2.0, sigmaScale: 2.5 },\n"
        "        fundScales: {\n"
        f"{crisis}\n"
        "        },\n"
        "      },\n"
        "    ],"
    )

# ── patch app.js ─────────────────────────────────────────────────────────────

with open(APP_JS_PATH, 'r', encoding='utf-8') as fh:
    original = fh.read()

# Match the entire regimes: [ ... ], block (greedy-safe via bracket counting)
pattern = r'( {4}regimes: \[)[\s\S]*?\n( {4}\],)'

def replacer(m):
    return regimes_block(funds)

new_content, n = re.subn(pattern, replacer, original)

if n == 0:
    sys.exit("ERROR: could not locate 'regimes: [...],' block in app.js — no changes written")

with open(APP_JS_PATH, 'w', encoding='utf-8') as fh:
    fh.write(new_content)

print(f"Done — {len(funds)} fund entries written to {APP_JS_PATH}")
print("Regimes: Bull / Bear / Crisis   |   fundScales blocks replaced.")
