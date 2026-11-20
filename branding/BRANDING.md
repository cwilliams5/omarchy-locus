# Locus branding

Picked (2026-11-19): **Locus**, logo option **Arc**, in `arc/`. The other
options are in `alternatives/`.

## The name

- **The Planckian locus** is the curve of colours a glowing object passes
  through as it heats or cools: bluish daylight white, warm white, candle
  orange. Every temperature Locus puts on the screen sits on that curve, and
  its fades walk along it, a few mireds at a time.
- **A locus is the path a moving point traces.** That's the logo: a point on
  its path. The same arc reads as the sun's path across the sky, which the
  schedule follows.
- **Locus is Latin for "place".** It follows the sun where you are.
- It joins the science-and-physics vein of Cody's names (Resonance, Worldline).

What it isn't: no relation to Locust (the load-testing tool), "locus of
control", or the Locus Map app.

Where it came from: Locus is a hard fork of
[Sundown](https://github.com/WilliamJohnDavisIII/omarchy-sundown) by William
John Davis III, renamed for its new direction. Other candidates, for the
record: Rayleigh (Rayleigh scattering removes blue from sunlight; strong, but
its marks read as a brightness icon or a striped box), Alpenglow (the glow on
peaks at dusk and dawn, with a nod to Arch; a lovely story, but long, and its
mark read as a stock tracker small), Louver (a window part; awkward spelling),
Shade (crowded: many screen dimmers are called Shade), Fanlight and Leadlight
(window parts with fewer layers). Scrim, Candela, Hearth and Lantern were
already Omarchy plugins; Shoji is an active Wayland compositor.

## The logo

**Arc:** an arc with a warm point on it. It echoes two layers at once: the
point on its path (the colour curve, with "you are here" on it) and the sun on
its daily arc. It won because it's the most distinctive of the options, simple
enough to read at 16px, and owns no stock meaning.

Alternatives:

- **Pin** (`alternatives/pin/`): a location pin with a warm core, for "place". The
  clearest at 16px, but it looks like any maps app.
- Marks drawn for the other finalist names, kept for context: Rayleigh Scatter
  (a sun whose upper rays scatter into dots; small, it reads as a brightness
  icon), Rayleigh Bands (a window of warming bands; one-color it's a striped
  box), Alpenglow Peak (a summit lit warm; small, it reads as a market chart),
  Alpenglow Window (a lit peak in a frame; the universal image-placeholder
  icon).

## Voice

Plain and practical. Windows terms where they help. No hype, no emoji.
"Locus" in sentences; the lowercase wordmark only as a logo.

- "Night light" in lowercase for the general thing; Locus is one.
- Temperatures as `3000K` (no space), fades in minutes.
- Say what it does to the screen, not what it does for your body: no claims
  about sleep, eye strain or health.
- The original project's name appears only where it's credited.

## Palette

| Role | Name | Hex |
|---|---|---|
| Background | Ink | `#14161D` |
| Accent | Amber | `#F2A33A` |
| Highlight | Daylight | `#CFE0F5` |
| Text | Parchment | `#EFE7DA` |
| Accent on light backgrounds | Deep amber | `#D07A1A` |

Contrast: Parchment on Ink 14.7:1, Amber on Ink 8.7:1. Amber on white is only
2.1:1, too faint for the mark's point, so the light lockup uses Deep amber
(3.2:1, above the 3:1 wanted for graphics).

Amber is the screen at night, Daylight the screen by day, the two ends of the
curve the name comes from. Locus itself follows the user's Omarchy theme: this
palette is for the logo, README art and the social preview, not the panel.

## Rules for the logo

- **One color first** (`currentColor`), so it can follow a theme. The accent
  is optional.
- **It reads at 16px.**
- **Drawn as paths:** no fonts needed.
- **`build.py` regenerates everything:** `python3 branding/build.py`.

## Files

```
branding/
  BRANDING.md          this file
  build.py             regenerates everything below: python3 branding/build.py
  arc/                 the logo
    icon.svg             one color (currentColor); icon-color.svg in the palette
    wordmark.svg         lowercase, drawn as paths; wordmark-color.svg in the palette
    lockup-light.svg     mark and wordmark, dark ink, for light backgrounds
    lockup-dark.svg      mark and wordmark, light ink, for dark backgrounds
    tile.svg             the mark on an Ink rounded square (the app icon)
    preview.png          the sheet: sizes, wordmark, palette, bar mock
  alternatives/        the other marks, each with its own preview sheet
    pin/  rayleigh-scatter/  rayleigh-bands/  alpenglow-peak/  alpenglow-window/
    naming-comparisons/  the side-by-side images the name was picked from
icon.svg               (repo root) the tile, for listings and the README
```
