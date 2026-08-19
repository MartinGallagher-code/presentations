#!/usr/bin/env python3
"""Build network_testing.pptx from network_testing_talk.md (python-pptx).

Corporate design pass: custom-drawn slides (no stock placeholders), a
consistent palette with per-section accent colors, styled tables, code
panels, flow diagrams and drawn illustrations -- all with plain shapes
and text for maximum PowerPoint compatibility.
"""
import re
from lxml import etree
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.ns import qn

MD, OUT = 'network_testing_talk.md', 'network_testing.pptx'

# ------------------------------------------------------------------ palette
NAVY  = RGBColor(0x10, 0x1E, 0x30)   # dark slides
NAVY2 = RGBColor(0x1A, 0x2C, 0x44)   # panels on dark
CODEBG= RGBColor(0x14, 0x24, 0x3B)
INK   = RGBColor(0x1C, 0x2B, 0x3A)
MUTED = RGBColor(0x5C, 0x6B, 0x7A)
FOG   = RGBColor(0x9F, 0xB0, 0xC1)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FAINT = RGBColor(0xF1, 0xF4, 0xF8)
LINE  = RGBColor(0xDC, 0xE4, 0xEC)
CODEFG= RGBColor(0xE8, 0xEE, 0xF6)
CODEMU= RGBColor(0x8A, 0x9B, 0xB0)

SLATE = RGBColor(0x3E, 0x5C, 0x76)
AMBER = RGBColor(0xC8, 0x72, 0x1C)
CRIM  = RGBColor(0xB0, 0x38, 0x4A)
TEAL  = RGBColor(0x0F, 0x7d, 0x71)
GREEN = RGBColor(0x35, 0x7C, 0x46)

F, FM = 'Calibri', 'Consolas'
W, H, MARG = 13.333, 7.5, 0.62
CW = W - 2 * MARG                     # content width

# ------------------------------------------------------------- text helpers
def clean(s):
    return s.replace('**', '').replace('`', '').strip()

TOK = re.compile(r'(\*\*.*?\*\*|`[^`]*`)')

def rich(par, text, size, color, bold=False, mono_color=None):
    """Render **bold** and `code` runs into a paragraph."""
    for part in TOK.split(text):
        if not part:
            continue
        r = par.add_run()
        if part.startswith('**') and part.endswith('**') and len(part) > 4:
            r.text = part[2:-2]
            r.font.bold = True
        elif part.startswith('`') and part.endswith('`') and len(part) > 2:
            r.text = part[1:-1]
            r.font.name = FM
            r.font.size = Pt(size - 1)
            if mono_color is not None:
                r.font.color.rgb = mono_color
        else:
            r.text = part
            r.font.bold = bold
        if r.font.size is None:
            r.font.size = Pt(size)
        if r.font.color and r.font.color.type is None:
            r.font.color.rgb = color
        r.font.name = r.font.name or F

def autofit_shrink(tf):
    bodyPr = tf._txBody.bodyPr
    for tag in ('a:noAutofit', 'a:normAutofit', 'a:spAutoFit'):
        for el in bodyPr.findall(qn(tag)):
            bodyPr.remove(el)
    etree.SubElement(bodyPr, qn('a:normAutofit'))

def est_lines(text, width_in, size):
    cpl = max(20, int(width_in * (110.0 / 13.33) * (13.0 / size)))
    return max(1, -(-len(clean(text)) // cpl))

# ---------------------------------------------------------------- md parser
slides = []
for chunk in open(MD).read().split('\n---\n'):
    lines = [l.rstrip() for l in chunk.strip('\n').split('\n')]
    if not any(l.strip() for l in lines):
        continue
    first = next(l for l in lines if l.strip())
    if first.startswith('# '):
        sub = next((clean(l[4:]) for l in lines[1:] if l.startswith('### ')), '')
        slides.append(dict(kind='title', title=clean(first[2:]), sub=sub, blocks=[], notes=''))
        continue
    if first.startswith('## '):
        slides.append(dict(kind='section', title=clean(first[3:]), blocks=[], notes=''))
        continue
    if not first.startswith('### Slide:'):
        continue
    title = clean(first[len('### Slide:'):])
    blocks, notes, table_rows, code_lines = [], '', [], []
    in_code = False
    def flush_table():
        if table_rows:
            blocks.append(('table', list(table_rows)))
            table_rows.clear()
    i = lines.index(first) + 1
    while i < len(lines):
        l = lines[i]
        if l.strip().startswith('```'):
            flush_table()
            if in_code:
                blocks.append(('code', code_lines))
                code_lines = []
            in_code = not in_code
        elif in_code:
            code_lines.append(l)
        elif l.strip().startswith('**Notes:**'):
            notes = clean(l.strip()[10:])
            i += 1
            while i < len(lines) and lines[i].strip():
                notes += ' ' + clean(lines[i]); i += 1
            continue
        elif l.strip().startswith('|'):
            cells = [c.strip() for c in l.strip().strip('|').split('|')]
            if not all(re.fullmatch(r'-{3,}', c) for c in cells):
                table_rows.append(cells)
        elif l.strip().startswith('=> '):
            flush_table()
            blocks.append(('flow', [seg.strip() for seg in l.strip()[3:].split(' -> ')]))
        elif l.strip().startswith('@@ '):
            flush_table()
            blocks.append(('diagram', l.strip()[3:].strip()))
        else:
            flush_table()
            m = re.match(r'^(\s*)- (.*)$', l)
            if m:
                blocks.append(('bullet', 1 if len(m.group(1)) >= 2 else 0, m.group(2).strip()))
            elif l.strip():
                blocks.append(('para', l.strip()))
        i += 1
    flush_table()
    if in_code and code_lines:
        blocks.append(('code', code_lines))
    slides.append(dict(kind='content', title=title, blocks=blocks, notes=notes))

# section accents assigned by walking dividers
SECTS = [('OVERVIEW', SLATE), ('IPERF_ORCHESTRATOR', AMBER),
         ('MATRIX_ORCHESTRATOR', CRIM), ('NETMESH', TEAL), ('WRAP-UP', SLATE)]

# ------------------------------------------------------------ deck scaffold
prs = Presentation()
prs.slide_width, prs.slide_height = Inches(W), Inches(H)
BLANK = prs.slide_layouts[6]

def new_slide(dark=False):
    s = prs.slides.add_slide(BLANK)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(W), Inches(H))
    bg.fill.solid(); bg.fill.fore_color.rgb = NAVY if dark else WHITE
    bg.line.fill.background(); bg.shadow.inherit = False
    return s

def box(s, x, y, w, h, fill, line_color=None, round_=True):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if round_ else MSO_SHAPE.RECTANGLE,
                             Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    if line_color is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line_color; shp.line.width = Pt(1)
    shp.shadow.inherit = False
    if round_:
        try:
            shp.adjustments[0] = 0.10
        except Exception:
            pass
    return shp

def txt(s, x, y, w, h, wrap=True):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = wrap
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    return tf

def set_notes(s, t):
    if t:
        s.notes_slide.notes_text_frame.text = t

def footer(s, n):
    tf = txt(s, MARG, H - 0.34, CW, 0.25)
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = 'Network Testing at Fleet Scale'
    r.font.size = Pt(9); r.font.color.rgb = FOG; r.font.name = F
    tf2 = txt(s, W - MARG - 0.8, H - 0.34, 0.8, 0.25)
    p2 = tf2.paragraphs[0]; p2.alignment = PP_ALIGN.RIGHT
    r2 = p2.add_run(); r2.text = str(n)
    r2.font.size = Pt(9); r2.font.color.rgb = FOG; r2.font.name = F

def motif(s, x, y, n, cell, accent, seed=0):
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            r = (i * 7 + j * 13 + seed * 5) % 17
            c = NAVY2
            if r in (3, 11): c = accent
            elif r in (6, 14): c = RGBColor(0x24, 0x3A, 0x58)
            b = box(s, x + j * cell * 1.22, y + i * cell * 1.22, cell, cell, c)

# --------------------------------------------------------------- renderers
def draw_bullet_group(s, group, x, y, w, accent):
    total = 0.0
    for b in group:
        size = 13 if (b[0] == 'para' or b[1] == 0) else 12
        total += est_lines(b[-1], w - 0.35, size) * (size * 1.32 / 72.0) + 0.10
    tf = txt(s, x, y, w, total)
    autofit_shrink(tf)
    firstp = True
    for b in group:
        p = tf.paragraphs[0] if firstp else tf.add_paragraph()
        firstp = False
        p.space_after = Pt(7)
        if b[0] == 'bullet':
            lvl = b[1]
            mk = p.add_run(); mk.text = ('▪  ' if lvl == 0 else '–  ')
            mk.font.color.rgb = accent; mk.font.size = Pt(12 if lvl == 0 else 11)
            mk.font.name = F; mk.font.bold = True
            rich(p, b[2], 13 if lvl == 0 else 12, INK, mono_color=accent)
            if lvl:
                p.level = 1
        else:
            rich(p, b[1], 13, INK, mono_color=accent)
    return total + 0.08

def draw_code(s, lines, x, y, w, accent):
    n = len(lines)
    h = 0.30 + 0.225 * n
    box(s, x, y, w, h, CODEBG)
    tf = txt(s, x + 0.28, y + 0.15, w - 0.5, h - 0.3)
    for j, line in enumerate(lines):
        p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
        r = p.add_run(); r.text = line if line else ' '
        r.font.name = FM; r.font.size = Pt(12)
        r.font.color.rgb = CODEMU if line.strip().startswith('#') else CODEFG
        if not line.strip().startswith('#') and line.strip():
            r.font.bold = True
    return h + 0.16

def col_widths(rows, total):
    ncol = len(rows[0])
    avg = [max(len(clean(r[c])) if c < len(r) else 0 for r in rows) for c in range(ncol)]
    wsum = sum(a ** 0.6 for a in avg)
    return [max(1.0, total * (a ** 0.6) / wsum) for a in avg]

def draw_table(s, rows, x, y, w, accent):
    nrow, ncol = len(rows), len(rows[0])
    widths = col_widths(rows, w)
    # estimate row heights
    hh = [0.0] * nrow
    for ri, row in enumerate(rows):
        size = 12 if ri else 12.5
        ml = 1
        for ci in range(ncol):
            cell = row[ci] if ci < len(row) else ''
            ml = max(ml, est_lines(cell, widths[ci] - 0.2, size))
        hh[ri] = 0.16 + ml * (size * 1.3 / 72.0)
    gfx = s.shapes.add_table(nrow, ncol, Inches(x), Inches(y), Inches(w), Inches(sum(hh)))
    tbl = gfx.table
    tbl.first_row = False
    tbl.horz_banding = False
    for ci, cw_ in enumerate(widths):
        tbl.columns[ci].width = Inches(cw_)
    for ri, row in enumerate(rows):
        tbl.rows[ri].height = Inches(hh[ri])
        for ci in range(ncol):
            cell = tbl.cell(ri, ci)
            cell.margin_left = cell.margin_right = Inches(0.10)
            cell.margin_top = cell.margin_bottom = Inches(0.05)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.fill.solid()
            if ri == 0:
                cell.fill.fore_color.rgb = NAVY
            else:
                cell.fill.fore_color.rgb = WHITE if ri % 2 else FAINT
            p = cell.text_frame.paragraphs[0]
            text = row[ci] if ci < len(row) else ''
            if ri == 0:
                r = p.add_run(); r.text = clean(text)
                r.font.bold = True; r.font.size = Pt(12); r.font.color.rgb = WHITE
                r.font.name = F
            else:
                first_col_cmd = ci == 0 and text.strip().startswith('`') and text.strip().endswith('`')
                if first_col_cmd:
                    r = p.add_run(); r.text = clean(text)
                    r.font.name = FM; r.font.size = Pt(11.5); r.font.bold = True
                    r.font.color.rgb = accent
                else:
                    rich(p, text, 12, INK, mono_color=accent)
    return sum(hh) + 0.18

def draw_flow(s, items, x, y, w, accent):
    n = len(items)
    gap = 0.34
    bw = (w - gap * (n - 1)) / n
    bh = 1.02
    cyc = [GREEN, TEAL, AMBER, CRIM, TEAL, SLATE]
    for k, item in enumerate(items):
        parts = item.split('|')
        cmd, cap = clean(parts[0]), clean(parts[1]) if len(parts) > 1 else ''
        b = box(s, x + k * (bw + gap), y, bw, bh, cyc[k % 6])
        tf = b.text_frame
        tf.word_wrap = True
        tf.margin_left = tf.margin_right = Inches(0.08)
        p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
        r = p.add_run(); r.text = cmd
        r.font.name = FM; r.font.size = Pt(11.5); r.font.bold = True; r.font.color.rgb = WHITE
        if cap:
            p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
            r2 = p2.add_run(); r2.text = cap
            r2.font.size = Pt(9.5); r2.font.color.rgb = RGBColor(0xF0, 0xF3, 0xF6); r2.font.name = F
        if k < n - 1:
            tfa = txt(s, x + (k + 1) * bw + k * gap, y + 0.32, gap, 0.4, wrap=False)
            pa = tfa.paragraphs[0]; pa.alignment = PP_ALIGN.CENTER
            ra = pa.add_run(); ra.text = '→'
            ra.font.size = Pt(15); ra.font.bold = True; ra.font.color.rgb = MUTED
    return bh + 0.22

# ---- illustrations --------------------------------------------------------
def label(s, x, y, w, text, size, color, align=PP_ALIGN.CENTER, bold=False, mono=False):
    tf = txt(s, x, y, w, 0.4)
    p = tf.paragraphs[0]; p.alignment = align
    r = p.add_run(); r.text = text
    r.font.size = Pt(size); r.font.color.rgb = color; r.font.bold = bold
    r.font.name = FM if mono else F

def node_box(s, x, y, w, h, title, sub, fill):
    b = box(s, x, y, w, h, fill)
    tf = b.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    r = p.add_run(); r.text = title
    r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = F
    p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
    r2 = p2.add_run(); r2.text = sub
    r2.font.size = Pt(11); r2.font.color.rgb = RGBColor(0xEA, 0xEF, 0xF5); r2.font.name = FM

def arrow(s, x, y, w, h, color, left=False):
    shp = s.shapes.add_shape(MSO_SHAPE.LEFT_ARROW if left else MSO_SHAPE.RIGHT_ARROW,
                             Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.solid(); shp.fill.fore_color.rgb = color
    shp.line.fill.background(); shp.shadow.inherit = False
    return shp

def diag_iperf_pair(s, y, accent):
    bw, bh = 2.7, 0.95
    xl, xr = MARG + 0.9, W - MARG - 0.9 - bw
    node_box(s, xl, y + 0.32, bw, bh, 'CLIENT', 'iperf -c <server>', SLATE)
    node_box(s, xr, y + 0.32, bw, bh, 'SERVER', 'iperf -s', SLATE)
    ax, aw = xl + bw + 0.25, xr - xl - bw - 0.5
    arrow(s, ax, y + 0.34, aw, 0.34, accent)
    arrow(s, ax, y + 0.86, aw, 0.34, RGBColor(0xD9, 0xB8, 0x8C), left=True)
    label(s, ax, y - 0.02, aw, 'bytes, as fast as TCP will go', 11, MUTED)
    label(s, ax, y + 1.26, aw, 'full-duplex: traffic back at the same time', 11, MUTED)
    label(s, MARG, y + 1.62, CW, 'run for 10 seconds  →  the achieved rate is the answer', 12.5, INK, bold=True)
    return 2.05

def diag_reqreply(s, y, accent):
    bw, bh = 2.7, 0.95
    xl, xr = MARG + 0.9, W - MARG - 0.9 - bw
    node_box(s, xl, y + 0.32, bw, bh, 'HOST A', 'mx agent', CRIM)
    node_box(s, xr, y + 0.32, bw, bh, 'HOST B', 'mx agent', CRIM)
    ax, aw = xl + bw + 0.25, xr - xl - bw - 0.5
    arrow(s, ax, y + 0.34, aw, 0.34, accent)
    arrow(s, ax, y + 0.86, aw, 0.34, RGBColor(0xD8, 0x9A, 0xA6), left=True)
    label(s, ax, y - 0.02, aw, 'request: 128 bytes · 20,000 per second', 11, MUTED)
    label(s, ax, y + 1.26, aw, 'reply: 8 KB — one per request, carrying its timestamp back', 11, MUTED)
    label(s, MARG, y + 1.62, CW, 'same packet rate both ways · 64× the bytes on the reply path · RTT for free', 12.5, INK, bold=True)
    return 2.05

def diag_mesh(s, y, accent):
    import math
    cx, cy, rad, n = MARG + 2.1, y + 1.15, 0.92, 8
    pts = [(cx + rad * math.cos(2 * math.pi * k / n), cy + rad * math.sin(2 * math.pi * k / n)) for k in range(n)]
    for a in range(n):
        for b in range(a + 1, n):
            ln = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(pts[a][0]), Inches(pts[a][1]), Inches(pts[b][0]), Inches(pts[b][1]))
            ln.line.color.rgb = LINE; ln.line.width = Pt(0.9); ln.shadow.inherit = False
    for (px, py) in pts:
        d = box(s, px - 0.09, py - 0.09, 0.18, 0.18, accent)
    tf = txt(s, MARG + 4.6, y + 0.28, CW - 4.7, 1.9)
    rows_ = [('8 hosts', '28 pairs'), ('100 hosts', '4,950 pairs'), ('every pair', 'both directions, at once')]
    firstp = True
    for a, b in rows_:
        p = tf.paragraphs[0] if firstp else tf.add_paragraph()
        firstp = False
        p.space_after = Pt(5)
        r = p.add_run(); r.text = a + '   '
        r.font.size = Pt(15); r.font.bold = True; r.font.color.rgb = accent; r.font.name = F
        r2 = p.add_run(); r2.text = b
        r2.font.size = Pt(14); r2.font.color.rgb = INK; r2.font.name = F
    return 2.35

def diag_heatmap(s, y, accent):
    cell, gp, n = 0.20, 0.045, 8
    hx, hy = MARG + 0.55, y + 0.18
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            r = (i * 5 + j * 11) % 13
            c = RGBColor(0xF2, 0xC9, 0x93)
            if r < 4: c = RGBColor(0xE8, 0xA9, 0x5B)
            if r >= 10: c = RGBColor(0xFB, 0xE6, 0xCA)
            if i == 5: c = RGBColor(0xC0, 0x39, 0x2B)
            if j == 2 and i != 5: c = RGBColor(0xD9, 0x5F, 0x4B)
            box(s, hx + j * (cell + gp), hy + i * (cell + gp), cell, cell, c)
    gw = n * (cell + gp)
    label(s, hx - 0.1, hy + gw + 0.05, gw + 0.4, 'rows = sender · columns = receiver', 10, MUTED, align=PP_ALIGN.LEFT)
    tf = txt(s, hx + gw + 0.55, hy + 0.1, CW - gw - 1.6, 2.0)
    p = tf.paragraphs[0]; p.space_after = Pt(6)
    rich(p, '**A red row** — that host sends slowly to everyone: its outbound is sick.', 12.5, INK, mono_color=accent)
    p2 = tf.add_paragraph(); p2.space_after = Pt(6)
    rich(p2, '**A red column** — everyone struggles to reach it: its inbound is sick.', 12.5, INK, mono_color=accent)
    p3 = tf.add_paragraph()
    rich(p3, 'Check `cpu_summary.csv` before blaming the network — a pegged host makes its own links look slow.', 12.5, INK, mono_color=accent)
    return gw + 0.55

DIAGRAMS = {'iperf-pair': diag_iperf_pair, 'reqreply': diag_reqreply,
            'mesh': diag_mesh, 'heatmap': diag_heatmap}

# ------------------------------------------------------------------- build
sect_i = 0
page = 0
for sl in slides:
    page += 1
    if sl['kind'] == 'title':
        s = new_slide(dark=True)
        motif(s, 9.1, 0.9, 7, 0.5, AMBER, seed=2)
        motif(s, 11.3, 4.9, 4, 0.34, TEAL, seed=7)
        label(s, MARG, 1.5, 9, 'FLEET NETWORK TESTING', 12, AMBER, align=PP_ALIGN.LEFT, bold=True)
        tf = txt(s, MARG, 1.95, 8.2, 1.8)
        p = tf.paragraphs[0]
        r = p.add_run(); r.text = sl['title']
        r.font.size = Pt(44); r.font.bold = True; r.font.color.rgb = WHITE; r.font.name = F
        tf2 = txt(s, MARG, 3.6, 8.4, 0.5)
        p2 = tf2.paragraphs[0]
        for i, (nm, c) in enumerate([('iperf_orchestrator', AMBER), ('matrix_orchestrator', CRIM), ('netmesh', TEAL)]):
            if i:
                rr = p2.add_run(); rr.text = '   ·   '
                rr.font.size = Pt(17); rr.font.color.rgb = FOG; rr.font.name = FM
            rr = p2.add_run(); rr.text = nm
            rr.font.size = Pt(17); rr.font.bold = True; rr.font.color.rgb = c; rr.font.name = FM
        label(s, MARG, 4.25, 8.2, 'and reachable, keeping the server list honest', 14, FOG, align=PP_ALIGN.LEFT)
        label(s, MARG, 6.3, 6, 'Martin Gallagher', 14, WHITE, align=PP_ALIGN.LEFT, bold=True)
        set_notes(s, sl['notes'])
        continue

    if sl['kind'] == 'section':
        s = new_slide(dark=True)
        name, accent = SECTS[min(sect_i + 1, len(SECTS) - 1)]
        sect_i += 1
        motif(s, 9.3, 1.6, 7, 0.5, accent, seed=sect_i)
        m = re.match(r'(Part \d+|Close)\s*(?:—\s*(.*))?', sl['title'])
        num = 'Part %d' % sect_i if sl['title'].lower().startswith('part') else ''
        title = sl['title'].split('—', 1)[-1].strip() if '—' in sl['title'] else sl['title']
        label(s, MARG, 2.2, 6, num.upper() if num else 'WRAP-UP', 14, accent, align=PP_ALIGN.LEFT, bold=True)
        tf = txt(s, MARG, 2.7, 8.6, 1.2)
        p = tf.paragraphs[0]
        r = p.add_run(); r.text = title
        r.font.size = Pt(40); r.font.bold = True; r.font.color.rgb = WHITE
        r.font.name = FM if '_' in title or title == 'netmesh' else F
        set_notes(s, sl['notes'])
        continue

    # content slide
    sect_name, accent = SECTS[min(sect_i, len(SECTS) - 1)]
    if sl['title'].lower().startswith('putting'):
        sect_name, accent = SECTS[4]
    s = new_slide()
    label(s, MARG, 0.42, CW, sect_name, 10.5, accent, align=PP_ALIGN.LEFT, bold=True)
    tf = txt(s, MARG, 0.68, CW, 0.62)
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = sl['title']
    r.font.size = Pt(27); r.font.bold = True; r.font.color.rgb = INK; r.font.name = F
    footer(s, page)
    y = 1.52
    group = []
    def flush_group():
        global y, group
        if group:
            y += draw_bullet_group(s, group, MARG, y, CW, accent)
            group = []
    for b in sl['blocks']:
        if b[0] in ('bullet', 'para'):
            group.append(b)
            continue
        flush_group()
        if b[0] == 'code':
            y += draw_code(s, b[1], MARG, y, CW, accent)
        elif b[0] == 'table':
            y += draw_table(s, b[1], MARG, y, CW, accent)
        elif b[0] == 'flow':
            y += draw_flow(s, b[1], MARG, y, CW, accent)
        elif b[0] == 'diagram':
            fn = DIAGRAMS.get(b[1])
            if fn:
                y += fn(s, y, accent)
    flush_group()
    set_notes(s, sl['notes'])

prs.save(OUT)
print('wrote %s with %d slides' % (OUT, page))
