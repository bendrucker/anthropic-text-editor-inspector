"""Generate the app icon SVG plus an HTML wrapper for headless-Chrome rasterizing.

Colors come from `styles/globals.css`, converted out of oklch: the blue is the
app's primary accent and the amber is `--edit-ambiguous`.

To change the icon, edit the constants below, then rasterize `icon.svg` to a
1024x1024 PNG and run `bunx tauri icon <png>` from the repo root, which rewrites
everything under `src-tauri/icons/`. No rasterizer is installed here, so the
HTML wrapper exists to screenshot the SVG with headless Chrome.
"""

import math
from pathlib import Path

CANVAS = 1024
BODY = 824                      # Apple's macOS grid: 824x824 body inside a 1024 canvas
INSET = (CANVAS - BODY) / 2     # 100
CORNER_R = 185.4                # 22.5% of the body, Apple's macOS rounded-rect radius
SMOOTHING = 0.6                 # continuous-curvature corners

BG_TOP = '#1a72d4'
BG_BOTTOM = '#07357c'
INK = '#ffffff'
AMBER = '#f4b32e'
GLASS = '#031f4d'    # darkens the lens interior so the hole survives at 16px

TMP = Path(__file__).resolve().parent


def squircle_path(x, y, size, radius, smoothing):
    """Rounded rect with G2 continuous corners, as Figma/Apple draw them."""
    rad = math.radians
    p = (1 + smoothing) * radius
    arc_measure = 90 * (1 - smoothing)
    arc = math.sin(rad(arc_measure / 2)) * radius * math.sqrt(2)
    alpha = (90 - arc_measure) / 2
    p3p4 = radius * math.tan(rad(alpha / 2))
    beta = 45 * smoothing
    c = p3p4 * math.cos(rad(beta))
    d = c * math.tan(rad(beta))
    b = (p - arc - c - d) / 3
    a = 2 * b
    r = radius
    w = h = size

    def n(v):
        return f'{v:.3f}'

    seg = [
        f'M {n(x + w - p)} {n(y)}',
        f'c {n(a)} 0 {n(a + b)} 0 {n(a + b + c)} {n(d)}',
        f'a {n(r)} {n(r)} 0 0 1 {n(arc)} {n(arc)}',
        f'c {n(d)} {n(c)} {n(d)} {n(b + c)} {n(d)} {n(a + b + c)}',
        f'L {n(x + w)} {n(y + h - p)}',
        f'c 0 {n(a)} 0 {n(a + b)} {n(-d)} {n(a + b + c)}',
        f'a {n(r)} {n(r)} 0 0 1 {n(-arc)} {n(arc)}',
        f'c {n(-c)} {n(d)} {n(-(b + c))} {n(d)} {n(-(a + b + c))} {n(d)}',
        f'L {n(x + p)} {n(y + h)}',
        f'c {n(-a)} 0 {n(-(a + b))} 0 {n(-(a + b + c))} {n(-d)}',
        f'a {n(r)} {n(r)} 0 0 1 {n(-arc)} {n(-arc)}',
        f'c {n(-d)} {n(-c)} {n(-d)} {n(-(b + c))} {n(-d)} {n(-(a + b + c))}',
        f'L {n(x)} {n(y + p)}',
        f'c 0 {n(-a)} 0 {n(-(a + b))} {n(d)} {n(-(a + b + c))}',
        f'a {n(r)} {n(r)} 0 0 1 {n(arc)} {n(-arc)}',
        f'c {n(c)} {n(-d)} {n(b + c)} {n(-d)} {n(a + b + c)} {n(-d)}',
        'Z',
    ]
    return ' '.join(seg)


# The T ---------------------------------------------------------------------
BAR_X, BAR_W = 180, 500
BAR_Y, BAR_H = 190, 128
STEM_W = 116
STEM_X = BAR_X + (BAR_W - STEM_W) / 2
STEM_BOTTOM = 660
GLYPH_R = 14

# The magnifier -------------------------------------------------------------
LENS_CX, LENS_CY = 636, 602
LENS_OUTER = 176
RING_W = 62
RING_R = LENS_OUTER - RING_W / 2
LENS_INNER = LENS_OUTER - RING_W
HANDLE_W = 66
HANDLE_FROM, HANDLE_TO = 166, 276
DIAG = math.sqrt(2) / 2
HX1, HY1 = LENS_CX + HANDLE_FROM * DIAG, LENS_CY + HANDLE_FROM * DIAG
HX2, HY2 = LENS_CX + HANDLE_TO * DIAG, LENS_CY + HANDLE_TO * DIAG

GAP = 18  # blue separation cut into the T where the magnifier crosses it


def svg():
    body = squircle_path(INSET, INSET, BODY, CORNER_R, SMOOTHING)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="0 0 {CANVAS} {CANVAS}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="{BG_TOP}"/>
      <stop offset="1" stop-color="{BG_BOTTOM}"/>
    </linearGradient>
    <clipPath id="body">
      <path d="{body}"/>
    </clipPath>
    <mask id="knockout">
      <path d="{body}" fill="#fff"/>
      <circle cx="{LENS_CX}" cy="{LENS_CY}" r="{RING_R}" fill="none" stroke="#000" stroke-width="{RING_W + 2 * GAP}"/>
      <line x1="{HX1:.2f}" y1="{HY1:.2f}" x2="{HX2:.2f}" y2="{HY2:.2f}" stroke="#000" stroke-width="{HANDLE_W + 2 * GAP}" stroke-linecap="round"/>
    </mask>
  </defs>

  <path d="{body}" fill="url(#bg)"/>

  <g clip-path="url(#body)">
    <circle cx="{LENS_CX}" cy="{LENS_CY}" r="{LENS_INNER}" fill="{GLASS}" opacity="0.34"/>

    <g mask="url(#knockout)" fill="{INK}">
      <rect x="{BAR_X}" y="{BAR_Y}" width="{BAR_W}" height="{BAR_H}" rx="{GLYPH_R}"/>
      <rect x="{STEM_X}" y="{BAR_Y}" width="{STEM_W}" height="{STEM_BOTTOM - BAR_Y}" rx="{GLYPH_R}"/>
    </g>

    <g fill="none" stroke="{AMBER}" stroke-linecap="round">
      <line x1="{HX1:.2f}" y1="{HY1:.2f}" x2="{HX2:.2f}" y2="{HY2:.2f}" stroke-width="{HANDLE_W}"/>
      <circle cx="{LENS_CX}" cy="{LENS_CY}" r="{RING_R}" stroke-width="{RING_W}"/>
    </g>
  </g>
</svg>
'''


def html(markup):
    return f'''<!doctype html>
<meta charset="utf-8">
<style>
  html, body {{ margin: 0; padding: 0; background: transparent; }}
  svg {{ display: block; }}
</style>
{markup}
'''


markup = svg()
(TMP / 'icon.svg').write_text(markup)
(TMP / 'icon.html').write_text(html(markup))
print('wrote icon.svg and icon.html')
