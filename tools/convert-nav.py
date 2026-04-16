"""
convert-nav.py — แปลงไฟล์ XLS/XLSX NAV → JSON สำหรับ Fund Library

วิธีใช้:
  python tools/convert-nav.py path/to/NAV_file.xls
  python tools/convert-nav.py path/to/NAV_file.xls path/to/another.xls ...

ไฟล์ JSON จะถูกบันทึกลงใน data/ และ funds-index.json จะถัปเดตอัตโนมัติ

รูปแบบ XLS ที่รองรับ:
  Col A: ชื่อกองทุน  |  B: วันที่ (DD/MM/YYYY)  |  C: NAV  |  D: Offer  |  E: BID
  ไม่มี header row, หลายกองทุนเรียงต่อกันได้
"""

import sys, os, json, re
from pathlib import Path

try:
    import xlrd
except ImportError:
    print("กรุณาติดตั้ง xlrd ก่อน: pip install xlrd openpyxl")
    sys.exit(1)

try:
    import openpyxl
    HAS_OPENPYXL = True
except ImportError:
    HAS_OPENPYXL = False

ROOT     = Path(__file__).parent.parent
DATA_DIR = ROOT / 'data'
DATA_DIR.mkdir(exist_ok=True)
INDEX_FILE = DATA_DIR / 'funds-index.json'


def parse_date(s):
    s = str(s).strip().lstrip("'")
    m = re.match(r'^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$', s)
    if m:
        return f'{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}'
    m = re.match(r'^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$', s)
    if m:
        return f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
    return None


def safe_slug(name):
    """Generate a safe ASCII filename slug from a fund name."""
    # Keep ASCII alphanumeric + hyphens; strip Thai chars for filename safety
    ascii_part = re.sub(r'[^\x00-\x7F]', '', name).strip()
    if not ascii_part:
        ascii_part = f'fund-{abs(hash(name)) % 100000}'
    slug = re.sub(r'[^\w\s\-]', '', ascii_part)
    slug = re.sub(r'[\s_]+', '-', slug).strip('-')
    return slug[:60] or 'fund'


def read_xls(path):
    wb = xlrd.open_workbook(str(path))
    ws = wb.sheet_by_index(0)
    return [[ws.cell_value(i, j) for j in range(ws.ncols)] for i in range(ws.nrows)]


def read_xlsx(path):
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    ws = wb.active
    return [[cell.value for cell in row] for row in ws.iter_rows()]


def parse_rows(raw_rows):
    funds = {}
    for row in raw_rows:
        if not row or len(row) < 3:
            continue
        fund  = str(row[0] or '').strip().lstrip("'")
        raw_d = str(row[1] or '').strip().lstrip("'")
        if not fund or not raw_d:
            continue
        date = parse_date(raw_d)
        if not date:
            continue
        try:
            nav   = float(row[2])
            offer = float(row[3]) if len(row) > 3 and row[3] not in (None, '') else nav
            bid   = float(row[4]) if len(row) > 4 and row[4] not in (None, '') else nav
        except (ValueError, TypeError):
            continue
        if nav <= 0:
            continue
        if fund not in funds:
            funds[fund] = []
        funds[fund].append({
            'date':  date,
            'nav':   round(nav,   4),
            'offer': round(offer, 4),
            'bid':   round(bid,   4),
        })
    return funds


def load_index():
    if INDEX_FILE.exists():
        with open(INDEX_FILE, encoding='utf-8') as f:
            return {e['name']: e for e in json.load(f)}
    return {}


def save_index(index_map):
    entries = sorted(index_map.values(), key=lambda e: e['name'])
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(entries, f, ensure_ascii=False, indent=2)
    print(f'  ✓ funds-index.json ({len(entries)} กองทุน)')


def process_file(path):
    path = Path(path)
    if not path.exists():
        print(f'  ✗ ไม่พบไฟล์: {path}')
        return {}

    print(f'\nกำลังแปลง: {path.name}')
    suffix = path.suffix.lower()
    if suffix == '.xls':
        raw = read_xls(path)
    elif suffix in ('.xlsx',):
        if not HAS_OPENPYXL:
            print('  ✗ กรุณาติดตั้ง openpyxl: pip install openpyxl')
            return {}
        raw = read_xlsx(path)
    else:
        print(f'  ✗ ไม่รองรับไฟล์ {suffix}')
        return {}

    funds = parse_rows(raw)
    results = {}
    for name, rows in funds.items():
        rows.sort(key=lambda r: r['date'])
        slug  = safe_slug(name)
        fname = f'{slug}.json'
        out   = DATA_DIR / fname
        with open(out, 'w', encoding='utf-8') as f:
            json.dump({'name': name, 'rows': rows}, f, ensure_ascii=False)
        print(f'  ✓ {fname}  ({len(rows)} rows)  {rows[0]["date"]} → {rows[-1]["date"]}')
        results[name] = {
            'name':      name,
            'file':      fname,
            'firstDate': rows[0]['date'],
            'lastDate':  rows[-1]['date'],
            'count':     len(rows),
            'latestNAV': rows[-1]['nav'],
        }
    return results


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)

    index = load_index()
    for path in sys.argv[1:]:
        new_entries = process_file(path)
        index.update(new_entries)

    save_index(index)
    print('\nเสร็จแล้ว! deploy ไฟล์ใน data/ ขึ้น GitHub/Netlify ได้เลย')


if __name__ == '__main__':
    main()
