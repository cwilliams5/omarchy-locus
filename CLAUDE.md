# CLAUDE.md: Locus

For an agent (or the maintainer, months later) picking this up with no memory
of how it was built. Read this first, then `README.md` (what users see) and
`branding/BRANDING.md` (the name and the logo). The reasons below matter as
much as the rules.

## What Locus is

Locus is a night light for Omarchy, written as an Omarchy shell plugin (QML
and JavaScript inside the long-running Quickshell shell). It warms the
screen through `hyprsunset`: at sunset (optionally earlier or later), at
hours you pick, or by hand. It fades in and out over lengths you choose, has
a temperature slider from 500K to 5500K (below 1000K a screen shader takes
over), and keeps the screen neutral while a chosen app, or any real
fullscreen app, is in front.

It replaces nothing. Omarchy's own Night Light (a 4000K on/off toggle in the
menu and the indicators) keeps working; Locus treats a change made that way
as a hold until its next scheduled change. It never edits `hyprsunset.conf`
or anything else of Omarchy's; it reads `hyprsunset.conf` only to know when
hyprsunset will switch by itself.

## The people and the projects around it

- **Maintainer: Cody** (GitHub `cwilliams5`). Came to Linux from Windows and
  knows Windows deeply. Explain Linux things plainly, with Windows
  comparisons where they help. Cody reviews anything outward-facing
  (publishing, posting, filing upstream) before it happens.
- **Where it came from:** a hard fork of
  [Sundown](https://github.com/WilliamJohnDavisIII/omarchy-sundown) by
  William John Davis III (MIT), renamed on 2026-11-19. The full history is
  kept: his commits stay his. `LICENSE` keeps his copyright line with Cody's
  under it, and the README credits him near the top. Keep all three that
  way. The git remote `sundown` points at his repository.
- **The old fork** `cwilliams5/omarchy-sundown` exists only to carry two pull
  requests to the original (#1: run the shader script only while the shader
  is on; #2: allow up to 5500K). They are left open on purpose. Don't touch
  them, and don't open more: Locus is its own project now.
- **Ideas from elsewhere** are credited in the README's Credits section:
  Dusk (`ReidenXerx/omarchy-dusk`) and f.lux so far. When a feature borrows an
  idea, add its source there in the same commit. Ideas only: no code was
  copied from Dusk.
- **Sister projects** (Cody's, independent of Locus):
  - **Transom** (`cwilliams5/omarchy-transom`), the bottom taskbar.
  - **Sash** (`cwilliams5/omarchy-sash`), Windows-style maximize on floating
    workspaces. Sash catches Hyprland's maximize (fullscreen mode 1) there and
    turns it into a resize. Locus only pauses for real fullscreen (bit 2), so
    the two never interact.
- **On Cody's laptop:** the working copy is `~/Work/omarchy-locus`. The
  installed copy, `~/.config/omarchy/plugins/io.github.cwilliams5.locus`, is
  a plain clone that updates with `omarchy plugin update`. Cody's dotfiles
  (`~/Work/dotfiles`, chezmoi) list it by URL in `plugins.yaml` and describe
  it in `docs/customizations.md`. Settings live in
  `~/.local/state/omarchy/settings/locus.json` (not tracked).

## Layout

```
manifest.json      plugin id io.github.cwilliams5.locus; service + bar widget
Model.js           all the logic that can be tested: sun times, schedules,
                   fades, what's due next, pausing, settings, hyprsunset.conf
Service.qml        the one part that talks to hyprsunset: checks, decides,
                   sends, holds, pausing, the IPC commands
Panel.qml          the bar icon and its panel
Indicator.qml      optional: the icon among Omarchy's indicators instead
Registry.js        hands the service to widgets under replacement bars
warm-shader.sh     the screen shader for temperatures below 1000K
i18n/en.json       the panel's strings (Omarchy picks the language)
tests/model.test.js  node tests for Model.js
branding/          the name, logo and palette (BRANDING.md, build.py)
icon.svg           the app tile
```

## Rules that must not be broken (and why)

1. **Look before you send.** Every check reads `hyprctl hyprsunset
   temperature` first (`probeProcess` -> `handleProbe`) and only then decides
   what to send (`step`). Sending first let a fade step overwrite a change
   made elsewhere (Omarchy's toggle) before Locus had seen it.
2. **Never sleep longer than `Model.CHECK_MS` (60 s), and don't poll faster
   than needed.** `scheduleNext` wakes for whatever `Model.nextDueAt` says is
   due (a switch, the clear-down starting, the next visible fade step, a hold
   ending, just after a `hyprsunset.conf` switch time), 5 s while the panel
   is open, 1 s only while hyprsunset is starting. The fork began at a fixed
   15 s (5,760 checks a day); this is about 1,470. A one-minute ceiling is
   what lets changes made elsewhere, and a restarted hyprsunset, be noticed.
3. **Fade steps are spaced `STEP_MIREDS` (3) apart and sent only from
   `MIN_SEND_MIREDS` (1.5).** The half step is not a typo: temperatures are
   rounded to 10K (about 1 mired at 3000K), so a due step can measure 2.9.
   With a threshold of 3, real steps doubled to 6 mireds, which the eye sees.
   The tests simulate whole fades and days and fail on that.
4. **Real fullscreen only: Hyprland's fullscreen bit 2.** A maximized window
   reports fullscreen 1 (Cody's Super+Shift+F uses maximized mode), and a
   workspace reports both as `hasFullscreen`. Omarchy's own bar uses the same
   bit-2 test.
5. **`MAX_TEMP` stays below `FRESH_TEMP` (6000K).** 6000K is what a
   just-started hyprsunset reports, and how Locus recognizes a restart (or an
   identity profile in `hyprsunset.conf`); it's also the line both Locus and
   `omarchy-toggle-nightlight` read as off. A test enforces it.
6. **The shader script runs on every check only while the shader is on**
   (`shaderStep`). Running it on every check cost about 29,000 short-lived
   processes a day for nothing. Removing the shader takes one run; the first
   check after a shell start runs it once to clear a leftover.
7. **Settings are written only by the service** (`updateSettings`, an atomic
   FileView write), and the file stays mode 600 because it can hold
   coordinates. An empty read is treated as a brand-new file and filled from
   memory, so anything that writes the file non-atomically (`cat >`) gets
   overwritten. Change settings through the panel or the IPC commands.
8. **Text from outside is untrusted.** App classes and titles go through
   `Model.displayName` before any label, and through `Model.cleanAppName`
   before they're stored (no markup characters survive). Omarchy's plugin
   guide requires this; its components render plain text today, but that
   isn't something to rely on.
9. **Heavier features go behind a toggle, off by default.** Cody's rule:
   anything that adds steady work (a screen shader effect, polling a sensor)
   must be opt-in. Features that only add a scheduled change cost nothing and
   can just be on.
10. **Never edit Omarchy's files** (`/usr/share/omarchy`); read them freely.
11. **Run the privacy scan before the repo goes public, and before every push
    once it is** (`~/.claude/skills/go-public/scripts/privacy-scan.sh .`),
    as the last step, after every file (this one included) is final.

## How it works, in one screen

- `Model.kelvinAt(settings, location, now, paused)` is the whole schedule as
  a pure function of the time: off, the temperature, or a point along a fade
  (`rampAt`; even steps in mireds via `mixKelvin`). A paused app forces off.
- `Model.desiredState` holds the switch logic: Sun, Custom or Manual, a hold
  (`override`) that lasts until the next scheduled change, and Sun mode with
  no location following the switch instead.
- `Service.tick()` runs on `checkTimer`: work out the plan, start a look,
  sync the shader, schedule the next check. `handleProbe` reads the answer,
  spots a restarted hyprsunset (6000K), a `hyprsunset.conf` switch (put it
  back) or a hand (hold until the next change), then calls `step()`, which
  sends a change if one is due and visible, fading big jumps over 2 s.
- Pausing is bindings, not polling: `ToplevelManager.activeToplevel` for the
  app's class, `Hyprland.activeToplevel.lastIpcObject.fullscreen` for real
  fullscreen, refreshed on Hyprland's `fullscreen`/`activewindowv2`/
  `closewindow` events only while "pause for fullscreen" is on.
- Location, in order: coordinates typed in the panel, IP detection (off by
  default, `geo.omarchy.org`), Omarchy's weather location if it has
  coordinates, the time zone's main city from `zone1970.tab`.
- The settings file is `locus.json`. The first time Locus runs with none, it
  copies Sundown's `heliotrope.json` once (owner-only), so people switching
  over keep their settings.

## Platform facts this depends on (re-check after updates)

Tested on Omarchy 4.5.0, Hyprland 0.56.2 (Lua config), hyprsunset 0.4.0,
Quickshell 0.3.2.

- `hyprctl hyprsunset temperature [K]`, `identity`, `gamma`. Even 6500K tints
  slightly, so "off" also sends `identity`, which then reads back as 6500K.
- An identity profile in `hyprsunset.conf` (Omarchy ships one at 07:00), or a
  profile without a temperature, reads back as 6000K afterwards.
- hyprsunset waits for its next profile in one-minute naps on a clock that
  stops during sleep, so a switch time passed while asleep lands up to a
  minute late. Locus looks at +2 s and +62 s and keeps a two-minute grace.
- Hyprland reports a cleared `decoration:screen_shader` as `""` with
  `set: true` once anything has set it, not `[[EMPTY]]`.
- The Omarchy UI kit (`qs.Ui`: `KeyboardPanel`, `Button`, `PanelHero`...)
  renders text as plain text.
- `omarchy plugin update` fetches `origin HEAD` and only fast-forwards: a
  commit made inside the installed copy blocks updates.
- `omarchy plugin add` and `update` sometimes print "omarchy-shell is not
  responding" for their rescan; harmless.

## Working on it

- Tests: `TZ=America/New_York node tests/model.test.js` (63 as of
  2026-11-19). They also pass in Los Angeles and UTC; the "sun schedule
  follows the day" test assumes New York and fails in Asia/Tokyo (inherited).
- `omarchy plugin validate .` checks the manifest.
- To try a branch live: `git -C ~/.config/omarchy/plugins/io.github.cwilliams5.locus fetch ~/Work/omarchy-locus <branch>`,
  check out `FETCH_HEAD`, `omarchy restart shell`. Afterwards put it back on
  `main` and `omarchy plugin update`. QML already loaded stays cached, so
  always restart the shell after changing it.
- Status: `omarchy-shell io.github.cwilliams5.locus.control status` (includes
  `nextCheckSeconds`, `paused`, `frontApp`).
- The shell log: `/run/user/$UID/quickshell/by-pid/<pid>/log.log`, pid from
  `pgrep -f 'quickshell -n -p /usr/share/omarchy/shell'`. Locus logs as
  `locus: ...`.
- Before testing anything visible, save the user's settings with the status
  command and restore them through IPC afterwards, never by rewriting the
  file (rule 7).

## Releasing

1. Bump `version` in `manifest.json`; tests and `omarchy plugin validate .`
   pass; README up to date.
2. Privacy scan, commit, push.
3. Once listed on the marketplace: its "Plugin verification" issue form with
   the full commit SHA (see the go-public skill's `omarchy.md`).

## Voice and conventions

Plain, practical, Windows terms where they help, no hype, no emoji. See
`branding/BRANDING.md` for the project's own voice notes (no health claims;
temperatures as `3000K`). Commit messages say what changed and why.

## Status and open ideas (2026-11-19)

The go-public run (Cody's skill) has done naming, logo and branding, and is
**paused for development**. Next, in order: the features below, then the
README with screenshots, publishing (the repo is private until then), and
the marketplace.

Planned, all free to run:

- Holds for a set time: "off for an hour", "warm for an hour".
- A second, warmer bedtime level, set from a wake-up time, with an optional
  weekend sleep-in (f.lux).
- Late-night dimming through `hyprsunset gamma`, eased in after a set time.
- Settings in Omarchy's settings panel and `shell.json`, with holds kept in a
  separate state file so they don't churn Cody's dotfiles.
- Fades that follow twilight (an option).
- Presets: Candle, Movie mode (milder for 2.5 h).
- A daytime tint, off by default.
- A 24-hour view of the night in the panel, drawn only while it's open.
- Location by city name (one lookup when typed).
- Run a command at sunset or sunrise.
- The Arc mark as the bar icon, instead of the font glyph.
- Finer rounding below about 2000K: at 10K steps, fades to deep red step
  about 10 mireds, which shows.

Behind toggles, off by default: screen effects such as Darkroom, the ambient
light sensor, a different strength per monitor, switching off during calls,
smart bulbs.

When Locus goes public, point the old fork's README at it.

## Distribution

The Omarchy plugin marketplace, once public: it's a shell plugin, so users
install it with `omarchy plugin add https://github.com/cwilliams5/omarchy-locus.git --enable`.
No `git clone` install alternative in the README: the marketplace's security
baseline flags it.
