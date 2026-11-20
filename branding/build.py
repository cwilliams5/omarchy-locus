#!/usr/bin/env python3
"""Locus's logo kit (go-public skill): the Arc mark, plus the naming-stage alternatives.

Started from the skill's brand_starter.py.

Copy it into the project as branding/build.py, then edit the marked parts:
the ICONS, the letters your wordmark needs, and OPTIONS (name, palette, which
icon, which letters). Run:

    python3 branding/build.py            # writes into the folder it lives in

It writes, per option: icon.svg / icon-color.svg, wordmark.svg /
wordmark-color.svg, and preview.png (a sheet: big icon, 64/32/24/16 px, the
wordmark on dark and light, the palette, the icon on a mock bar, the
one-color icon in several theme colors). For the option marked
"picked": True it also writes lockup-light.svg, lockup-dark.svg, tile.svg and
the repo's icon.svg (one folder up).

As shipped it rebuilds Transom's three options (Crossbar, Fanlight, T-bar):
run it in a scratch folder to see the output, then replace them with yours.

Letters are drawn as paths (no font needed): the functions below cover
t, r, a, n, s, o, m (monoline lowercase, 40-unit x-height, baseline y=60) and
T, R, A, N, S, O, M (capitals). Add the letters your name needs in the same
style: each returns (path data, advance width) for a letter starting at x.
Look at every preview before showing it: overlaps and clipped corners only
show up rendered.
"""
import pathlib
import subprocess

HERE = pathlib.Path(__file__).resolve().parent  # the output folder: branding/

# ------------------------------------------------------------------ letters (EDIT: add yours)
# Monoline lowercase on a 40-unit x-height (baseline y=60, x-height y=20).
# Each returns (path data, advance width) for a letter starting at x.

def t(x):
    return (f"M{x+10} 6 V48 A12 12 0 0 0 {x+22} 60 M{x} 22 H{x+23}", 26)

def r(x):
    return (f"M{x} 22 V60 M{x} 38 A18 18 0 0 1 {x+18} 20 H{x+22}", 26)

def a(x):
    return (f"M{x+40} 40 A20 20 0 1 0 {x} 40 A20 20 0 1 0 {x+40} 40 Z M{x+40} 22 V60", 44)

def n(x):
    return (f"M{x} 22 V60 M{x} 38 A16 16 0 0 1 {x+32} 38 V60", 36)

def s(x):
    return (f"M{x+27} 25 C{x+24} 21 {x+19} 20 {x+14} 20 C{x+7} 20 {x+2} 24 {x+2} 30 "
            f"C{x+2} 36 {x+9} 38 {x+15} 40 C{x+21} 42 {x+28} 44 {x+28} 51 "
            f"C{x+28} 57 {x+22} 60 {x+14} 60 C{x+8} 60 {x+3} 58 {x+1} 54", 32)

def o(x):
    return (f"M{x+40} 40 A20 20 0 1 0 {x} 40 A20 20 0 1 0 {x+40} 40 Z", 44)

def o_window(x):
    # A rounded square with a mullion and transom: a window for an "o".
    return (f"M{x+6} 20 H{x+34} A6 6 0 0 1 {x+40} 26 V54 A6 6 0 0 1 {x+34} 60 H{x+6} "
            f"A6 6 0 0 1 {x} 54 V26 A6 6 0 0 1 {x+6} 20 Z M{x} 49 H{x+40}", 44)

def m(x):
    return (f"M{x} 22 V60 M{x} 36 A13 13 0 0 1 {x+26} 36 V60 M{x+26} 36 A13 13 0 0 1 {x+52} 36 V60", 52)

def word(letters, x=8, gap=10):
    parts = []
    for letter in letters:
        d, w = letter(x)
        parts.append(d)
        x += w + gap
    return " ".join(parts), x - gap

# Monoline capitals on a 40-unit cap height (y=20..60), for option 2.
def T(x):  return (f"M{x} 20 H{x+30} M{x+15} 20 V60", 30)
def R(x):  return (f"M{x} 60 V20 H{x+16} A10 10 0 0 1 {x+16} 40 H{x} M{x+14} 40 L{x+28} 60", 28)
def A(x):  return (f"M{x} 60 L{x+16} 20 L{x+32} 60 M{x+6} 46 H{x+26}", 32)
def N(x):  return (f"M{x} 60 V20 L{x+28} 60 V20", 28)
def S(x):  return (f"M{x+26} 26 C{x+23} 21 {x+18} 20 {x+13} 20 C{x+6} 20 {x+1} 24 {x+1} 30 "
                   f"C{x+1} 37 {x+8} 38 {x+14} 40 C{x+20} 42 {x+27} 44 {x+27} 51 "
                   f"C{x+27} 57 {x+21} 60 {x+13} 60 C{x+7} 60 {x+2} 58 {x} 54", 28)
def O(x):  return (f"M{x+40} 40 A20 20 0 1 0 {x} 40 A20 20 0 1 0 {x+40} 40 Z", 40)
def M(x):  return (f"M{x} 60 V20 L{x+18} 46 L{x+36} 20 V60", 36)

# Added for Locus and Rayleigh, in the same monoline style. Descenders (y, g)
# reach y=78, so options using them set "descender": True for a taller box.
def l(x):
    return (f"M{x} 4 V48 A12 12 0 0 0 {x+12} 60", 14)

def c(x):
    return (f"M{x+34.1} 25.9 A20 20 0 1 0 {x+34.1} 54.1", 38)

def u(x):
    return (f"M{x} 22 V42 A16 16 0 0 0 {x+32} 42 M{x+32} 22 V60", 36)

def y(x):
    return (f"M{x} 22 V40 A16 16 0 0 0 {x+32} 40 M{x+32} 22 V64 A14 14 0 0 1 {x+18} 78 H{x+8}", 36)

def e(x):
    return (f"M{x+1} 40 H{x+40} A20 20 0 1 0 {x+34.1} 54.1", 44)

def i(x):
    return (f"M{x+2} 22 V60 M{x+2} 7 V8", 4)

def g(x):
    return (f"M{x+40} 40 A20 20 0 1 0 {x} 40 A20 20 0 1 0 {x+40} 40 Z "
            f"M{x+40} 22 V64 A14 14 0 0 1 {x+26} 78 H{x+10}", 44)

def h(x):
    return (f"M{x} 4 V60 M{x} 38 A16 16 0 0 1 {x+32} 38 V60", 36)

def L(x):  return (f"M{x} 20 V60 H{x+24}", 24)
def C(x):  return (f"M{x+34.1} 25.9 A20 20 0 1 0 {x+34.1} 54.1", 36)
def U(x):  return (f"M{x} 20 V44 A14 14 0 0 0 {x+28} 44 V20", 28)
def Y(x):  return (f"M{x} 20 L{x+15} 40 L{x+30} 20 M{x+15} 40 V60", 30)
def E(x):  return (f"M{x+24} 20 H{x} V60 H{x+24} M{x} 40 H{x+20}", 24)
def I(x):  return (f"M{x+2} 20 V60", 4)
def G(x):  return (f"M{x+34.1} 25.9 A20 20 0 1 0 {x+40} 40 H{x+24}", 40)
def H(x):  return (f"M{x} 20 V60 M{x+28} 20 V60 M{x} 40 H{x+28}", 28)

def p(x):
    return (f"M{x} 22 V78 M{x} 40 A20 20 0 1 1 {x+40} 40 A20 20 0 1 1 {x} 40", 44)

def w(x):
    return (f"M{x} 22 L{x+12} 60 L{x+24} 30 L{x+36} 60 L{x+48} 22", 48)

def P(x):  return (f"M{x} 60 V20 H{x+16} A10 10 0 0 1 {x+16} 40 H{x}", 28)
def W(x):  return (f"M{x} 20 L{x+10} 60 L{x+20} 30 L{x+30} 60 L{x+40} 20", 40)

# -------------------------------------------------------------------- icons
# 64x64, drawn to read at 16px. Lines in currentColor; the accent part in
# var(--accent, currentColor), so one-color use just works.

# EDIT: your marks. 64x64, readable at 16px; lines in currentColor, the
# accent part in var(--accent, currentColor).
ICONS = {
    # Locus: a point on its path. The colour curve with "you are here" on it,
    # and the sun on its daily arc.
    "locus-arc": """
  <path d="M6 45 A26 26 0 0 1 58 45" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>
  <circle cx="51.9" cy="28.3" r="9" fill="var(--accent, currentColor)"/>""",
    # Locus: a place. A location pin with a warm core.
    "locus-pin": """
  <path d="M32 58 C27 51 13 39 13 26 A19 19 0 0 1 51 26 C51 39 37 51 32 58 Z" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linejoin="round"/>
  <circle cx="32" cy="26" r="8" fill="var(--accent, currentColor)"/>""",
    # Rayleigh: a warm sun whose upper rays have scattered into dots, the way
    # the air scatters blue out of sunlight.
    "rayleigh-scatter": """
  <circle cx="32" cy="32" r="10.5" fill="var(--accent, currentColor)"/>
  <path d="M48.0 32.0 L55.5 32.0 M43.3 43.3 L48.6 48.6 M32.0 48.0 L32.0 55.5 M20.7 43.3 L15.4 48.6 M16.0 32.0 L8.5 32.0" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/>
  <circle cx="17.2" cy="17.2" r="3.6" fill="currentColor"/>
  <circle cx="32.0" cy="11.0" r="3.6" fill="currentColor"/>
  <circle cx="46.8" cy="17.2" r="3.6" fill="currentColor"/>""",
    # Rayleigh: the sky through a window, cool and thin at the top, warm and
    # heavy at the bottom. The bands also read as louver slats.
    "rayleigh-bands": """
  <rect x="8" y="8" width="48" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>
  <rect x="8" y="14" width="48" height="3" fill="currentColor"/>
  <rect x="8" y="21" width="48" height="4.5" fill="currentColor"/>
  <rect x="8" y="29.5" width="48" height="6.5" fill="var(--accent, currentColor)"/>
  <path d="M8 40 H56 V48 A6 6 0 0 1 50 54 H14 A6 6 0 0 1 8 48 Z" fill="var(--accent, currentColor)"/>""",
    # Alpenglow: the warm light on a summit just after sunset and before
    # sunrise. A plain peak, so it doesn't imitate Arch's own logo.
    "alpenglow-peak": """
  <path d="M4 54 L28 14 L40 34 L46 26 L60 54" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M28 12.5 L20.5 25 H35.5 Z" fill="var(--accent, currentColor)" stroke="var(--accent, currentColor)" stroke-width="2" stroke-linejoin="round"/>""",
    # Alpenglow seen through a window: the lit peak, in Sash and Transom's family.
    "alpenglow-window": """
  <rect x="8" y="8" width="48" height="48" rx="8" fill="none" stroke="currentColor" stroke-width="4"/>
  <path d="M10 46 L30 20 L41 36 L47 29 L54 38 V48 A6 6 0 0 1 48 54 H16 A6 6 0 0 1 10 48 Z" fill="currentColor"/>
  <path d="M30 19 L23.8 28 H35.6 Z" fill="var(--accent, currentColor)" stroke="var(--accent, currentColor)" stroke-width="1.5" stroke-linejoin="round"/>""",
}

# ----------------------------------------------------------------- options

# Locus's mark is Arc (picked 2026-11-19); the rest are the naming-stage
# alternatives, kept for context. Lockups and the tile are built for the pick.
OPTIONS = [
    {
        "slug": "arc",
        "picked": True,
        "lockup_scale": 32 / 56,
        "lockup_dy": 48 - 60 * 32 / 56,
        "accent_on_light": "#D07A1A",
        "name": "Locus",
        "icon": "locus-arc",
        "letters": [l, o, c, u, s],
        "stroke": 7,
        "underline": False,
        "palette": [("Ink", "#14161D", "background"), ("Amber", "#F2A33A", "accent"),
                    ("Daylight", "#CFE0F5", "highlight"), ("Parchment", "#EFE7DA", "text")],
    },
    {
        "slug": "alternatives/pin",
        "name": "Locus \u00b7 Pin",
        "icon": "locus-pin",
        "letters": [L, O, C, U, S],
        "stroke": 5,
        "gap": 14,
        "underline": False,
        "palette": [("Graphite", "#1E1F23", "background"), ("Ember", "#E8743B", "accent"),
                    ("Candle", "#F6C177", "highlight"), ("Bone", "#F2EDE4", "text")],
    },
    {
        "slug": "alternatives/rayleigh-scatter",
        "name": "Rayleigh \u00b7 Scatter",
        "icon": "rayleigh-scatter",
        "letters": [r, a, y, l, e, i, g, h],
        "stroke": 7,
        "underline": False,
        "descender": True,
        "palette": [("Deep sky", "#0E1A2C", "background"), ("Coral", "#FF8A5B", "accent"),
                    ("Scatter", "#6EA8FE", "highlight"), ("Cloud", "#EEF2F7", "text")],
    },
    {
        "slug": "alternatives/rayleigh-bands",
        "name": "Rayleigh \u00b7 Bands",
        "icon": "rayleigh-bands",
        "letters": [R, A, Y, L, E, I, G, H],
        "stroke": 5,
        "gap": 12,
        "underline": False,
        "palette": [("Night", "#1A1624", "background"), ("Apricot", "#F4A259", "accent"),
                    ("Mauve", "#B48EAD", "highlight"), ("Linen", "#F3EEE7", "text")],
    },
    {
        "slug": "alternatives/alpenglow-peak",
        "name": "Alpenglow \u00b7 Peak",
        "icon": "alpenglow-peak",
        "letters": [a, l, p, e, n, g, l, o, w],
        "stroke": 7,
        "underline": False,
        "descender": True,
        "palette": [("Ridge night", "#1B2033", "background"), ("Glow", "#F28C6B", "accent"),
                    ("Peach", "#F7C59F", "highlight"), ("Snow", "#EEF0F5", "text")],
    },
    {
        "slug": "alternatives/alpenglow-window",
        "name": "Alpenglow \u00b7 Window",
        "icon": "alpenglow-window",
        "letters": [A, L, P, E, N, G, L, O, W],
        "stroke": 5,
        "gap": 12,
        "underline": False,
        "palette": [("Plum dusk", "#201A24", "background"), ("Salmon", "#F4A28C", "accent"),
                    ("Glacier", "#9DB4D3", "highlight"), ("Linen", "#F5EFE8", "text")],
    },
]


def icon_svg(body, size=64, color=None, accent=None):
    style = ""
    if color or accent:
        style = f' style="color:{color or "currentColor"};--accent:{accent or color or "currentColor"}"'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{size}" height="{size}"{style}>'
            f'{resolve_accent(body, accent or color)}\n</svg>\n')


def resolve_accent(body, accent):
    # rsvg doesn't do CSS variables; spell the accent out when one is given.
    return body.replace("var(--accent, currentColor)", accent or "currentColor")


def wordmark(option):
    gap = option.get("gap", 10)
    d, width = word(option["letters"], gap=gap)
    stroke = option["stroke"]
    under = ""
    height = 84 if option.get("descender") else 72
    if option["underline"]:
        under = f'<path d="M8 {height + 4} H{width}" stroke="ACCENT" stroke-width="{stroke + 1}" stroke-linecap="round"/>'
        height += 14
    return d, width + 8, height, stroke, under


def wordmark_svg(option, color="currentColor", accent="currentColor"):
    d, width, height, stroke, under = wordmark(option)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width * 2}" height="{height * 2}">'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'{under.replace("ACCENT", accent)}</svg>\n')


def sheet_svg(option):
    """A 1200x760 preview: icon big, icon small sizes, wordmark on dark and
    light, the palette, the icon as a start button on a bar, and the
    one-color icon in several theme colors."""
    pal = {role: hexv for _, hexv, role in option["palette"]}
    bg, accent, hi, text = pal["background"], pal["accent"], pal["highlight"], pal["text"]
    body = ICONS[option["icon"]]
    d, ww, wh, stroke, under = wordmark(option)
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" '
           f'font-family="JetBrainsMono Nerd Font, Liberation Mono, monospace">',
           f'<rect width="1200" height="760" fill="{bg}"/>']
    # Big icon
    out.append(f'<g transform="translate(60 60) scale(5)" style="color:{text}">{resolve_accent(body, accent)}</g>')
    # Small sizes
    x = 420
    for size in (64, 32, 24, 16):
        out.append(f'<g transform="translate({x} {60 + (64 - size)}) scale({size / 64})" style="color:{text}">{resolve_accent(body, accent)}</g>')
        out.append(f'<text x="{x}" y="150" fill="{text}" opacity="0.6" font-size="13">{size}px</text>')
        x += size + 40
    # Wordmark on dark
    scale = 560 / ww
    out.append(f'<g transform="translate(420 190) scale({scale:.3f})">'
               f'<path d="{d}" fill="none" stroke="{text}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>'
               f'{under.replace("ACCENT", accent)}</g>')
    # Light panel with wordmark and icon in background color
    out.append(f'<rect x="60" y="420" width="520" height="150" rx="14" fill="{text}"/>')
    out.append(f'<g transform="translate(90 455) scale(1.25)" style="color:{bg}">{resolve_accent(body, accent)}</g>')
    s2 = 340 / ww
    out.append(f'<g transform="translate(200 {470 - 10 * s2:.1f}) scale({s2:.3f})">'
               f'<path d="{d}" fill="none" stroke="{bg}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>'
               f'{under.replace("ACCENT", accent)}</g>')
    # Palette
    x = 620
    for name, hexv, role in option["palette"]:
        out.append(f'<rect x="{x}" y="420" width="120" height="96" rx="12" fill="{hexv}" stroke="{text}" stroke-opacity="0.25"/>')
        out.append(f'<text x="{x}" y="540" fill="{text}" font-size="15">{name}</text>')
        out.append(f'<text x="{x}" y="560" fill="{text}" opacity="0.7" font-size="13">{hexv}</text>')
        out.append(f'<text x="{x}" y="578" fill="{text}" opacity="0.5" font-size="13">{role}</text>')
        x += 135
    # A bar with the icon as the start button
    out.append(f'<rect x="0" y="690" width="1200" height="70" fill="#000" opacity="0.35"/>')
    out.append(f'<g transform="translate(24 703) scale(0.69)" style="color:{text}">{resolve_accent(body, accent)}</g>')
    for i, w in enumerate((210, 210, 210)):
        bx = 300 + i * 220
        out.append(f'<rect x="{bx}" y="702" width="{w}" height="46" rx="8" fill="{text}" opacity="{0.16 if i == 1 else 0.06}"/>')
        out.append(f'<rect x="{bx + 14}" y="716" width="18" height="18" rx="4" fill="{text}" opacity="0.5"/>')
        out.append(f'<rect x="{bx + 44}" y="721" width="{w - 70}" height="8" rx="4" fill="{text}" opacity="0.45"/>')
    out.append(f'<rect x="{300 + 220 + 20}" y="744" width="170" height="4" rx="2" fill="{accent}"/>')
    # One-color icon following theme colors
    x = 60
    out.append(f'<text x="60" y="618" fill="{text}" opacity="0.6" font-size="13">one color, following themes:</text>')
    for color in ("#F8F8F2", "#A6E3A1", "#7AA2F7", "#EBDBB2", "#F5C2E7", "#E0DEF4", "#1E1E2E"):
        out.append(f'<rect x="{x}" y="630" width="48" height="48" rx="8" fill="{"#E6E6E6" if color == "#1E1E2E" else "#16161E"}"/>')
        out.append(f'<g transform="translate({x + 8} 638) scale(0.5)" style="color:{color}">{resolve_accent(body, color)}</g>')
        x += 58
    out.append(f'<text x="1140" y="660" text-anchor="end" fill="{text}" font-size="34" opacity="0.9">{option["name"]}</text>')
    out.append('</svg>\n')
    return "\n".join(out)


def lockup_svg(option, text, accent):
    """The icon and the wordmark side by side, for the README's header."""
    body = resolve_accent(ICONS[option["icon"]], accent)
    d, ww, wh, stroke, under = wordmark(option)
    # The wordmark's height matched to the mark's. The starter's default (64/86)
    # suits a square mark beside an underlined wordmark; Locus's arc is 32
    # units tall, so its ascenders (y 4 to 60) are scaled to match and the
    # baseline sits on the arc's feet.
    scale = option.get("lockup_scale", 64 / 86)
    dy = option.get("lockup_dy", 2)
    width = 64 + 18 + ww * scale
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} 64" width="{width * 3:.0f}" height="192">'
            f'<g style="color:{text}">{body}</g>'
            f'<g transform="translate(82 {dy:.2f}) scale({scale:.4f})">'
            f'<path d="{d}" fill="none" stroke="{text}" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'{under.replace("ACCENT", accent)}</g></svg>\n')


def tile_svg(option, background, text, accent):
    """The icon on a rounded tile: an app icon that reads on any background."""
    body = resolve_accent(ICONS[option["icon"]], accent)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="256" height="256">'
            f'<rect width="64" height="64" rx="14" fill="{background}"/>'
            f'<g transform="translate(9 9) scale(0.72)" style="color:{text}">{body}</g></svg>\n')


def main():
    for option in OPTIONS:
        folder = HERE / option["slug"]
        folder.mkdir(parents=True, exist_ok=True)
        body = ICONS[option["icon"]]
        pal = {role: hexv for _, hexv, role in option["palette"]}
        (folder / "icon.svg").write_text(icon_svg(body))
        (folder / "icon-color.svg").write_text(icon_svg(body, color=pal["text"], accent=pal["accent"]))
        (folder / "wordmark.svg").write_text(wordmark_svg(option))
        (folder / "wordmark-color.svg").write_text(wordmark_svg(option, color=pal["text"], accent=pal["accent"]))
        if option.get("picked"):
            (folder / "lockup-dark.svg").write_text(lockup_svg(option, pal["text"], pal["accent"]))
            # A deeper accent where it sits on white, so the mark's point keeps 3:1.
            (folder / "lockup-light.svg").write_text(lockup_svg(option, pal["background"], option.get("accent_on_light", pal["accent"])))
            (folder / "tile.svg").write_text(tile_svg(option, pal["background"], pal["text"], pal["accent"]))
            # The repo's own icon (marketplace listings, the README).
            (HERE.parent / "icon.svg").write_text(tile_svg(option, pal["background"], pal["text"], pal["accent"]))
        sheet = folder / "preview.svg"
        sheet.write_text(sheet_svg(option))
        subprocess.run(["rsvg-convert", "-w", "1200", "-o", str(folder / "preview.png"), str(sheet)], check=True)
        sheet.unlink()
        print("built", option["slug"])


if __name__ == "__main__":
    main()
