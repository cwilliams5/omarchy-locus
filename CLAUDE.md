# CLAUDE.md: Locus

For an agent (or the maintainer, months later) picking this up with no memory
of how it was built. Read this first, then `README.md` (what users see) and
`branding/BRANDING.md` (the name and the logo). The reasons below matter as
much as the rules.

## What Locus is

Locus is a night light for Omarchy, written as an Omarchy shell plugin (QML
and JavaScript inside the long-running Quickshell shell). It warms the
screen through `hyprsunset`: at sunset (optionally earlier or later), at
hours you pick, or by hand. It fades in and out over lengths you choose (or
with twilight), has a temperature slider from 500K to 5500K with presets
(below 1000K a screen shader takes over), holds for a set time (Off 1 h,
Warm 1 h, Movie mode, Off till morning), an optional warmer bedtime level
and late-night dimming (`hyprsunset` gamma), a 24-hour view in its panel,
location by city name, commands at sunset and sunrise, and keeps the screen
neutral while a chosen app, or any real fullscreen app, is in front.

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
  kept: their commits stay theirs. `LICENSE` keeps their copyright line with
  Cody's under it, and the README credits them near the top. Keep all three
  that way. The git remote `sundown` points at their repository (listed in
  the marketplace as Heliotrope). Cody is he/him; William John Davis III,
  they/them.
- **The old fork** `cwilliams5/omarchy-sundown` exists only to carry two pull
  requests to the original (#1: run the shader script only while the shader
  is on; #2: allow up to 5500K). They are left open on purpose. Don't touch
  them, and don't open more: Locus is its own project now.
- **Ideas from elsewhere** are credited in the README's Credits section:
  Dusk (`ReidenXerx/omarchy-dusk`), f.lux, Kenny Keeton's Night Light,
  agkrishnendu's Sunset Night Light, Moonshine, Redshift and gammastep. When
  a feature borrows an idea, add its source there in the same commit. Ideas
  only: no code was copied from any of them.
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
  `~/.local/state/omarchy/settings/locus.json`, which the dotfiles track;
  holds, Locus on/off and coordinates in `locus-state.json`, never
  tracked.

## Layout

```
manifest.json      plugin id io.github.cwilliams5.locus; service + bar widget
Model.js           all the logic that can be tested: sun times, schedules,
                   fades, what's due next, pausing, settings, hyprsunset.conf
Service.qml        the one part that talks to hyprsunset: checks, decides,
                   sends, holds, pausing, the IPC commands
Panel.qml          the bar icon and its panel
ArcIcon.qml        the Locus mark drawn in QML, for the bar icon and the panel header
Indicator.qml      optional: the icon among Omarchy's indicators instead
Registry.js        hands the service to widgets under replacement bars
warm-shader.sh     the screen shader for temperatures below 1000K
i18n/en.json       the panel's strings (Omarchy picks the language)
tests/model.test.js  node tests for Model.js
docs/PLAN.md       the development plan and its status list
branding/          the name, logo and palette (BRANDING.md, build.py)
media/             README images; tint.sh applies hyprsunset's matrix to a screenshot
icon.svg           the app tile
preview.png        the marketplace listing card (a smaller copy of media/hero.png)
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
   With a threshold of 3, real steps doubled to 6 mireds. The tests simulate
   whole fades and days and fail on that. (On screen, hyprsunset 0.4.0 only
   changes colour at whole hundreds of Kelvin, see the platform facts; Locus
   stays fine-grained so it's right the day hyprsunset is.)
4. **Real fullscreen only: Hyprland's fullscreen bit 2.** A maximized window
   reports fullscreen 1 (Cody's Super+Shift+F uses maximized mode), and a
   workspace reports both as `hasFullscreen`. Omarchy's own bar uses the same
   bit-2 test.
5. **`MAX_TEMP` stays below `FRESH_TEMP` (6000K).** 6000K is what a
   just-started hyprsunset reports, and how Locus recognizes a restart (or an
   identity profile in `hyprsunset.conf`); it's also the line both Locus and
   `omarchy-toggle-nightlight` read as off. A test enforces it.
6. **The shader script runs only when its step changes** (`shaderStep`), after
   Hyprland's `configreloaded` event (a reload drops the shader, so the step
   goes back to -1), and once after a shell start to clear a leftover. Running
   it on every check cost about 29,000 short-lived processes a day (and each
   run is about 80 ms and a dozen processes). Removing Locus while it's on
   runs it once with 0 (`Component.onDestruction`).
7. **Two files, each written only when its half changed.** Settings (Cody's
   choices) in `locus.json`, tracked by his dotfiles; state (holds, Locus
   on/off, typed and detected coordinates) in `locus-state.json`,
   never tracked, so location never reaches git and a hold never rewrites the
   tracked file. Every key has one home (`Model.SETTING_KEYS` /
   `STATE_KEYS`; a test fails if a new setting has none). Both files are mode
   600. Only the service writes them (`updateSettings` -> `saveHalves`). An
   empty read is treated as a brand-new file and filled from memory, so a
   non-atomic outside write (`cat >`) gets overwritten; an atomic one (a temp
   file renamed over it, as chezmoi does) is read normally. Change settings
   through the panel or the IPC commands.
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
11. **Gamma (late-night dimming) is sent only when the wanted value changes,
    and not read back on every check** (`syncGamma`, `gammaSent`). Nothing
    in Omarchy sets gamma, so reading it would cost a second process per
    check for nothing. What does reset it is known: a restarted hyprsunset
    starts at 100%, and a `hyprsunset.conf` switch sets the profile's, so
    `handleProbe` marks it 100 or unknown there and it is sent again.
12. **Run the privacy scan before the repo goes public, and before every push
    once it is** (`~/.claude/skills/go-public/scripts/privacy-scan.sh .`),
    as the last step, after every file (this one included) is final.

## How it works, in one screen

- `Model.kelvinAt(settings, location, now, paused)` is the whole schedule as
  a pure function of the time: off, the temperature, or a point along a fade
  (`rampAt`; even steps in mireds via `mixKelvin`). A paused app forces off.
- `Model.desiredState` holds the on/off logic: a hold first (`override`: a
  set time or till morning, optionally with its own temperature for Movie
  mode; it works even while Locus is off), then Locus off (`enabled`, the
  panel's switch: off until turned on), then the mode: Sun, Custom, or
  Always (warm whenever on; Sun mode with no location acts the same).
  `Model.statusAt` / `nextChange` give the status line the next time the
  screen really changes, not when a hold expires. The switch used to mean
  "warm now" and held until the next change; Cody found that confusing (off
  read "off until 6:30 AM"), so it became Omarchy-style on/off on 2026-11-20.
  Old files migrate in `combineSettings` (Manual becomes Always, on only if
  its `manualOn` was).
- Over the night, `Model.targetKelvin` moves from the saved temperature to
  the bedtime level (`bedtimeAt`), and `Model.gammaAt` eases dimming in
  (`dimAt`) and back out with the clear-down (`clearDownShare`). `nightAt`
  is the night under way and `clockInNight` places clock times like bedtime
  in it: their first time inside the night, else a time within 12 hours
  before the start covers the whole night. (Placing them "nearest the
  start" broke nights longer than 12 hours.) With twilight on, `fadeInMs` /
  `fadeOutMs` come from civil dusk and dawn (`twilightTimes`).
- `Model.nextDueAt` lists every moment something changes by itself (switches,
  fade steps, bedtime, dimming, hold ends, `hyprsunset.conf` times); the
  service sleeps until the next, never more than a minute.
- `Service.tick()` runs on `checkTimer`: work out the plan, start a look,
  sync the shader, schedule the next check. `handleProbe` reads the answer,
  spots a restarted hyprsunset (6000K), a `hyprsunset.conf` switch (put it
  back) or a hand (hold until the next change), then calls `step()`, which
  sends a change if one is due and visible, fading big jumps over 2 s.
- Gamma (dimming) has its own process, `syncGamma`, run only when the wanted
  value changes (rule 11). The schedule's own on and off edges run the
  user's `onCommand` / `offCommand` (`scheduleCommand`; never on the first
  look after a restart).
- The panel's 24-hour strip comes from `Model.daySamples`, worked out only
  while the panel is open.
- Pausing is bindings, not polling: `ToplevelManager.activeToplevel` for the
  app's class, `Hyprland.activeToplevel.lastIpcObject.fullscreen` for real
  fullscreen, refreshed on Hyprland's `fullscreen`/`activewindowv2`/
  `closewindow` events only while "pause for fullscreen" is on.
- Location, in order: a city or coordinates typed in the panel (a city is
  looked up once with Open-Meteo's geocoding, on Enter, never in the
  background), IP detection (off by default, `geo.omarchy.org`), Omarchy's
  weather location if it has coordinates, the time zone's main city from
  `zone1970.tab`.
- Settings load from two files (`Model.combineSettings`) and save back split
  (`Model.splitSettings`). The first time Locus runs with no settings, it
  copies Sundown's `heliotrope.json` once (owner-only); a settings file that
  still holds state (that import, or the single file from before the split)
  is split into the two files once.

## Platform facts this depends on (re-check after updates)

Tested on Omarchy 4.5.0, Hyprland 0.56.2 (Lua config), hyprsunset 0.4.0,
Quickshell 0.3.2.

- **Locus talks to hyprsunset over its socket**,
  `$XDG_RUNTIME_DIR/hypr/$HYPRLAND_INSTANCE_SIGNATURE/.hyprsunset.sock`, the
  one `hyprctl hyprsunset` uses (`sunsetRequest` in Service.qml): one request
  per connection (`temperature`, `temperature 3000`, `identity`, `gamma 80`),
  a reply without a newline (`6500`, `ok`, or an error message), and the
  connection left open, so the client must close it (a client waiting for
  the server to close hangs). About 0.1 ms against 9 ms for a `hyprctl`
  process; in normal running Locus starts no processes. If the socket errors
  or is silent for 2 s, that one request goes through `hyprctl` instead.
  Re-check this after hyprsunset updates (it's hyprctl's protocol, not a
  documented API).
- `hyprctl hyprsunset temperature [K]`, `identity`, `gamma`. Even 6500K tints
  slightly, so "off" also sends `identity`, which then reads back as 6500K.
- An identity profile in `hyprsunset.conf` (Omarchy ships one at 07:00), or a
  profile without a temperature, reads back as 6000K afterwards.
- hyprsunset waits for its next profile in one-minute naps on a clock that
  stops during sleep, so a switch time passed while asleep lands up to a
  minute late. Locus looks at +2 s and +62 s and keeps a two-minute grace.
- **hyprsunset applies colour in whole steps of 100K.** `matrixForKelvin`
  takes an integer and divides it by 100, truncating; upstream issue #94 was
  closed with `temp /= 100.F`, which still truncates because `temp` stays an
  integer (checked 2026-11-20 by compiling it: 3000 to 3099 give the same
  matrix). So a 6500K-to-3000K fade changes the screen 35 times, steps of
  about 2 mireds near 6500K and 11 near 3000K. The README's Known limits say
  so. Reported as hyprwm/hyprsunset#103 (2026-11-20, approved by Cody).
  Re-check after hyprsunset updates, and when #103 is fixed, update the README.
- **Screenshots don't show hyprsunset's tint** (it's a CTM applied after
  capture); they do show the below-1000K screen shader. README images apply
  hyprsunset's own matrix with `media/tint.sh` and say so.
- `hyprctl hyprsunset gamma [percent]`: gamma multiplies whatever matrix is
  set, identity included, so dimming works with the tint off. hyprsunset
  starts at 100%, and every profile switch sets the profile's gamma (100%
  unless it names one).
- Hyprland reports a cleared `decoration:screen_shader` as `""` with
  `set: true` once anything has set it, not `[[EMPTY]]`.
- The Omarchy UI kit (`qs.Ui`: `KeyboardPanel`, `Button`, `PanelHero`...)
  renders text as plain text.
- **Clipboard reads** (Qt 6.12, QTBUG-149610, omarchy#15083): editable text
  fields are reported to make the shell read the whole clipboard on every
  copy. Measured 2026-11-21 with
  `~/.claude/skills/go-public/scripts/omarchy-qt-pitfalls.sh --measure`
  (an 8 MB copy): **any open shell panel with keyboard focus reads it**,
  Locus's (7,993 KiB, with or without its text field) and Omarchy's own
  audio panel with no text field at all (8,010 KiB); with every panel closed,
  nothing, even after Locus's panel had been opened (its content stays
  loaded). Wayland offers the clipboard only to the focused window, so the
  cost is limited to while a panel is open. Locus keeps its location field
  in a `Loader` active only while editing anyway (a test enforces it). Don't
  toggle `readOnly` instead: setting it triggers a read too.
- **Never declare a QML property named `enabled`** (or another `Item`
  property) on a component: it hides the built-in one, and Omarchy's bar
  (`Util.itemContainsPoint`) reads `item.enabled` up the parent chain to
  decide what can be clicked. Locus's on/off is `locusOn` for that reason.
- Touching a plugin file in the installed copy makes the shell reload that
  plugin in place ("Local plugin changed, reloading"): the service's
  `Component.onDestruction` runs (gamma goes back to 100%), then a new one
  starts. `omarchy restart shell` kills the process instead, so teardown code
  doesn't run there.
- `omarchy plugin update` fetches `origin HEAD` and only fast-forwards: a
  commit made inside the installed copy blocks updates.
- `omarchy plugin add` and `update` sometimes print "omarchy-shell is not
  responding" for their rescan; harmless.

## Working on it

- Tests: `TZ=America/New_York node tests/model.test.js`. They also pass in Los Angeles and UTC; the "sun schedule
  follows the day" test assumes New York and fails in Asia/Tokyo (inherited).
- `omarchy plugin validate .` checks the manifest.
- To try a branch live: `git -C ~/.config/omarchy/plugins/io.github.cwilliams5.locus fetch ~/Work/omarchy-locus <branch>`,
  check out `FETCH_HEAD`, `omarchy restart shell`. Afterwards put it back on
  `main` and `omarchy plugin update`. QML already loaded stays cached, so
  always restart the shell after changing it.
- Status: `omarchy-shell io.github.cwilliams5.locus.control status` (includes
  `nextCheckSeconds`, `paused`, `frontApp`).
- The shell log: `/run/user/$UID/quickshell/by-pid/<pid>/log.log`, pid from
  `pgrep -f 'quickshell -n -p /usr/share/omarchy/shell'`. Right after
  `omarchy restart shell` the pid can still change; the newest folder
  (`ls -t /run/user/$UID/quickshell/by-pid | head -1`) is safer. Locus logs
  as `locus: ...`.
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

## Status and open ideas (2026-11-20)

The go-public run (Cody's skill) has done naming, logo and branding, and is
**paused for development**. **The working plan, with designs, order and a
status list, is `docs/PLAN.md`: read it before starting work.** After the
features: the README with screenshots, publishing (the repo is private until
then), and the marketplace.

Done in the development phase: settings and state in two files, finer
rounding for deep red, timed holds, presets and Movie mode, the bedtime
level, late-night dimming, the Arc mark as the bar icon, the 24-hour view,
twilight fades, location by city name, commands at sunset and sunrise, and
the header switch as Locus on/off.

Decided on 2026-11-20: no daytime tint (B8), none of the heavier features
(screen effects, ambient light sensor, calls, per-monitor, smart bulbs) for
now, and the header switch became Locus on/off (B11). Next: Cody validates
that, then go-public resumes at stage 4.

2026-11-20 overnight: go-public stage 4 done (README, media), and stages 5
and 6 prepared but not done: making the repo public, the v2.0.0 release and
the marketplace issue all wait for Cody's go on the exact text (drafts kept
outside the repo). `preview.png` at the root is the marketplace card.

When Locus goes public, point the old fork's README at it.

## Distribution

The Omarchy plugin marketplace, once public: it's a shell plugin, so users
install it with `omarchy plugin add https://github.com/cwilliams5/omarchy-locus.git --enable`.
No `git clone` install alternative in the README: the marketplace's security
baseline flags it.
