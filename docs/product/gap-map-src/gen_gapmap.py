"""Build docs/product/gap-map.md from gap-map.src.md: render source citations, count statuses.
Tokens: O<page> → 'OPERA <page>', P<page> → 'Optima <page>' (citation only), anything else (e.g. sterni/Group) → `code`.
Usage: python gen_gapmap.py <gap-src.md> <hotel4u docs dir>
"""
import re, sys, os
src_path, docs = sys.argv[1], sys.argv[2]
src = open(src_path, encoding='utf8').read()



NAME = {'O': ('OPERA', 'opera'), 'P': ('Optima', 'optima')}
missing = []

def link(tok):
    m = re.fullmatch(r'([OP])(\d+)', tok)
    if not m: return f'`{tok}`'
    kind, page = m.group(1), int(m.group(2))
    return f'{NAME[kind][0]} {page}'  # citation only — we keep no copies of their docs

STAT = ['✅', '🟡', '❌', '🔍']
out, summary, cur, total = [], [], None, {k: 0 for k in STAT}
for line in src.split('\n'):
    h = re.match(r'## (\d+\. .*)', line)
    if h:
        cur = {'name': h.group(1), **{k: 0 for k in STAT}}; summary.append(cur)
    if line.startswith('| ') and not line.startswith('| יכולת') and cur:
        cells = line.split('|')
        if len(cells) >= 6:
            st = cells[2].strip()
            if st in STAT: cur[st] += 1; total[st] += 1
            cells[4] = ' ' + ' · '.join(link(t) for t in cells[4].split()) + ' '
            line = '|'.join(cells)
    out.append(line)

rows = ['## סיכום', '', '| מודול | ✅ קיים | 🟡 חלקי | ❌ חסר | 🔍 לבדוק | סה״כ |', '|---|---|---|---|---|---|']
for s in summary:
    rows.append(f"| {s['name']} | {s['✅']} | {s['🟡']} | {s['❌']} | {s['🔍']} | {sum(s[k] for k in STAT)} |")
rows.append(f"| **סה״כ** | **{total['✅']}** | **{total['🟡']}** | **{total['❌']}** | **{total['🔍']}** | **{sum(total.values())}** |")
doc = '\n'.join(out).replace('@@SUMMARY@@', '\n'.join(rows))
open(os.path.join(docs, 'product', 'gap-map.md'), 'w', encoding='utf8').write(doc)

import os as _os
kb_bad = [m.group(1) for m in re.finditer(r'\]\((knowledge/[^)]+)\)', doc) if not _os.path.exists(_os.path.join(docs, 'product', m.group(1)))]
print('total', total, 'rows', sum(total.values()), 'broken knowledge links', kb_bad)
