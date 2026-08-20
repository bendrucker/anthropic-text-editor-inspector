"""Generate the app icon SVGs plus HTML wrappers for headless-Chrome rasterizing.

Colors come from `styles/globals.css`, converted out of oklch: the blue is the
app's primary accent and the amber is `--edit-ambiguous`.

`icon.svg` is the desktop icon, drawn on Apple's macOS grid: an 824x824 rounded
body floating in a 1024 canvas, because macOS and Windows want that margin.
`icon-web.svg` is the same artwork cropped to the body, because a browser tab
and an iOS home screen supply their own margin and mask.

To change the icon, edit the constants below, then:

- rasterize `icon.svg` to a 1024x1024 PNG and run `bunx tauri icon <png>` from
  the repo root, which rewrites everything under `src-tauri/icons/`
- rasterize `icon-web.svg` to `public/apple-touch-icon.png` at 180x180

No rasterizer is installed here, so the HTML wrappers exist to screenshot the
SVGs with headless Chrome. Headless clamps the window to a few hundred pixels,
so 180 has to come from a downscale rather than from `--window-size`:

    chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    "$chrome" --headless --disable-gpu --hide-scrollbars \\
      --screenshot=tmp/touch-720.png --window-size=720,720 \\
      design/app-icon/icon-web.html
    sips -z 180 180 tmp/touch-720.png --out public/apple-touch-icon.png

The favicon needs no rasterizing. `vite.config.ts` reads `icon-web.svg` and
inlines it into the document as a `data:` URI.
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


def svg(crop=False):
    body = squircle_path(INSET, INSET, BODY, CORNER_R, SMOOTHING)
    view = f'{INSET:g} {INSET:g} {BODY} {BODY}' if crop else f'0 0 {CANVAS} {CANVAS}'
    # Cropping throws away the transparent margin, and with it the only thing
    # that made the rounded corners read as corners. An iOS home screen would
    # fill them with black, so the cropped variant paints them instead. The
    # backdrop is the same gradient as the body, so the seam is invisible.
    backdrop = (
        f'<rect x="{INSET:g}" y="{INSET:g}" width="{BODY}" height="{BODY}" fill="url(#bg)"/>\n  '
        if crop
        else ''
    )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" viewBox="{view}">
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

  {backdrop}<path d="{body}" fill="url(#bg)"/>

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
    # Sizing the SVG to the viewport lets `--window-size` pick the raster size,
    # so the artwork is drawn at that size rather than resampled down from 1024.
    return f'''<!doctype html>
<meta charset="utf-8">
<style>
  html, body {{ margin: 0; padding: 0; background: transparent; }}
  svg {{ display: block; width: 100vw; height: 100vh; }}
</style>
{markup}
'''


for name, crop in (('icon', False), ('icon-web', True)):
    markup = svg(crop)
    (TMP / f'{name}.svg').write_text(markup)
    (TMP / f'{name}.html').write_text(html(markup))
    print(f'wrote {name}.svg and {name}.html')
