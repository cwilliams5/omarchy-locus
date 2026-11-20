# Locus development plan

The working plan for the development phase between branding and publishing.
It's written to survive a lost context: **if you're picking this up cold,
read "Resuming" first**, then the status list, then the item you're on.

Started 2026-11-19. Update the status list (and the item's notes) as you go,
in the same commit as the work.

## Resuming

1. Read `CLAUDE.md` (rules and why), then this file.
2. `git log --oneline -15` in `~/Work/omarchy-locus` to see what landed.
3. Check the live install matches: `git -C ~/.config/omarchy/plugins/io.github.cwilliams5.locus log --oneline -1`,
   and `omarchy-shell io.github.cwilliams5.locus.control status`.
4. Cody's dotfiles rules: `~/Work/dotfiles/CLAUDE.md` (start with
   `chezmoi status`). Claude's memory note `locus.md` has the short version.
5. This whole phase sits inside a run of Cody's go-public skill, which is
   paused at the end of stage 3. The candid trial log of that skill is
   `~/Work/go-public-trials/sundown.md` (outside every repo); after
   development, go-public resumes at stage 4 (README + media).

## Where things stand (update this when you stop)

- **2026-11-19, end of session 1:** A1, A2, B1 done, merged, pushed, tested
  live; the installed copy is on `main`; dotfiles updated.
- **2026-11-19, session 2:** phase B done except B8, held for Cody. **Next: Cody's calls on B8 and phase C, then D1 (go-public stage 4).**
- Cody's live Locus state at that point: Sun mode, 3000K, and a hold "off
  until morning" (ends at sunrise, 6:30 AM on 2026-11-20). If a test changes
  the hold at night, put it back with
  `omarchy-shell io.github.cwilliams5.locus.control morning`; after sunrise
  the hold has ended by itself and there's nothing to restore.

## Ground rules for every item

- **Resources:** a feature that only adds scheduled changes is free and can
  be on. Anything that adds steady work (polling, a per-frame screen shader)
  goes behind a toggle, off by default (Cody's rule).
- **Keep the loop shape** (CLAUDE.md rules 1 to 3): look before sending; every
  new timed behavior (a start time, a fade) must show up in `Model.nextDueAt`
  so the service wakes for it; never sleep past `CHECK_MS`. The day-long
  simulation tests must stay around 1,470 checks and steps under 5 mireds.
- **Logic in `Model.js`, tested in node.** Service and Panel stay thin. Every
  feature gets tests, including a simulation when it changes timing.
- **Test live before it lands on `main`** (CLAUDE.md "Working on it"): fetch
  the branch into the installed clone, restart the shell, check status and
  the log, try it. Save Cody's settings first and restore them through IPC,
  never by rewriting a file. Warn Cody before anything visible on screen.
- **Credits:** when a feature borrows an idea, add its source to the README's
  Credits in the same commit.
- **After it lands:** push, `omarchy plugin update io.github.cwilliams5.locus`,
  `omarchy restart shell` if QML changed, update the Locus row in
  `~/Work/dotfiles/docs/customizations.md`, commit and push the dotfiles.
- Commit messages say what changed and why, ending with the Co-Authored-By
  line.

## Status

Phase A, foundation:

- [x] A1. Split settings from state: `locus.json` (settings, tracked by Cody's dotfiles) and `locus-state.json` (holds, coordinates; untracked). Option (b), Cody's choice (9953ed0, tested live: the split, per-file writes, atomic outside writes)
- [x] A2. Finer rounding for very warm fades (5be21b1, tested live)

Phase B, features that cost nothing to run:

- [x] B1. Holds for a set time ("off for an hour", "warm for an hour") (8ae66f3, tested live: holds, expiry, resume, the panel)
- [x] B2. Presets, and Movie mode (88a000d, tested live: presets, Movie mode, a temperature chosen during it, the panel; also fixed B1's warm hold ending in the day skipping that evening's warm-up)
- [x] B3. Bedtime level, with weekend sleep-in (b74bb74, tested live: bedtime on, its level mid-fade, the slider setting the bedtime level after bedtime, bad input, the panel)
- [x] B4. Late-night dimming (287f41f, tested live: easing with the switch fade, put back after a simulated hyprsunset restart, full brightness in Movie mode)
- [x] B5. The Arc mark as the bar icon (tested live: bar off and on, the panel header; the vertical bar not tried, the icon is centred by Omarchy's own bounds code)
- [x] B6. A 24-hour view of the night in the panel (tested live: with bedtime and dimming, and with a hold)
- [x] B7. Fades that follow twilight (option) (4578241, tested live: the lengths for Los Angeles tonight, 27 min each, and the panel rows)
- [ ] B8. Daytime tint (off by default): **held for Cody** (see "Decisions waiting on Cody")
- [x] B9. Location by city name (74f87f4, tested live: Berlin found and shown, a miss, a typo, back to automatic)
- [x] B10. Run a command at sunset and sunrise (tested live: runcommand, and a real on and off edge, each run once, on the minute, under a hold)

Phase C, heavier, each behind a toggle, only if Cody wants them:

- [ ] C1. Screen effects (Darkroom red)
- [ ] C2. Ambient light sensor
- [ ] C3. Off during calls or screen sharing
- [ ] C4. A strength per monitor (probably skip)
- [ ] C5. Smart bulbs (skip unless Cody has them)

Phase D, back to go-public:

- [ ] D1. README and media (go-public stage 4), then publish (5), marketplace (6)
- [ ] D2. Point the old fork's README at Locus once Locus is public

## Working procedure (the exact steps used for A1 to B1)

```bash
cd ~/Work/omarchy-locus && git switch -c <item-branch>
# ... edit Model.js (+ tests), Service.qml, Panel.qml, i18n/en.json, README.md ...
for tz in America/New_York America/Los_Angeles UTC; do TZ=$tz node tests/model.test.js >/dev/null && echo "$tz ok"; done
omarchy plugin validate .
/usr/lib/qt6/bin/qmllint -I /usr/lib/qt6/qml -I /usr/share/omarchy/shell Service.qml Panel.qml 2>&1 | grep '^Error'
git commit ...                       # what and why, ending with the Co-Authored-By line
# Live test: load the branch into the installed clone and restart the shell
D=~/.config/omarchy/plugins/io.github.cwilliams5.locus
git -C $D fetch -q ~/Work/omarchy-locus <item-branch> && git -C $D checkout -q --detach FETCH_HEAD
omarchy restart shell; sleep 5
omarchy-shell io.github.cwilliams5.locus.control status | jq .
L=$(ls -td /run/user/$UID/quickshell/by-pid/*/ | head -1)log.log; grep -ciE 'ReferenceError|TypeError|SyntaxError' $L
# Panel screenshot (warn Cody; the panel opens on screen): grim takes LOGICAL
# coordinates (the laptop is 2400x1600 at scale 2 = 1200x800 logical)
omarchy-shell io.github.cwilliams5.locus open; sleep 0.8
grim -g "780,0 420x800" <scratch>/panel.png; omarchy-shell io.github.cwilliams5.locus close
# ...look at it, then delete it (it shows part of Cody's screen)
# Land it
git switch main && git merge --ff-only <item-branch> && git branch -d <item-branch>
# tick the item in this file's Status (with the commit and "tested live"), commit, push
git -C $D checkout -q main && omarchy plugin update io.github.cwilliams5.locus --yes
# (plus omarchy restart shell if QML changed since the live test)
# Dotfiles: update the Locus row in ~/Work/dotfiles/docs/customizations.md;
# if Locus's settings changed shape, chezmoi re-add ~/.local/state/omarchy/settings/locus.json
cd ~/Work/dotfiles && chezmoi status && chezmoi git -- add -A && chezmoi git -- commit -m ... && chezmoi git -- push
```

Gotchas met so far:
- `omarchy plugin add/update` and status calls right after them can print
  "omarchy-shell is not responding": the shell is rescanning. Wait and retry.
- Visible tests at night: warn Cody first, keep them to seconds, restore the
  hold afterwards (see "Where things stand").
- Never edit the settings files by hand (`cat >`): Locus reads a half-written
  file as empty and saves its memory over it. Use IPC; to simulate chezmoi,
  write a temp file and rename it over (keeps working).
- When a test should fail on the old code, prove it: `git stash push Model.js`,
  run, `git stash pop`.

## Code map, for adding a feature

- **`Model.js`** (pure, tested): `defaultSettings`, `normalizeSettings`
  (validate every new key here), `SETTING_KEYS` / `STATE_KEYS` (every new key
  needs a home; a test enforces it), `scheduleAt` / `scheduleStart` /
  `sunOn`, `desiredState` (holds first, then Manual, then the schedule),
  `kelvinAt` (the screen's temperature now) and `rampAt` (the fade in
  progress), `nextDueAt` (**every new timed change must appear here**),
  `fadeStepMs`, `isVisibleStep`, `isBigJump`, `holdPatch`, `switchPatch`,
  `modePatch`, `pausedFor`, `hyprsunsetProfiles`, exports at the bottom.
- **`Service.qml`**: `updateSettings(patch)` (saves each file's half only if
  changed), `switchTo(patch)` (holds and the switch, fading), `tick()` ->
  probe -> `handleProbe()` -> `step()`, `scheduleNext()`, `apply()` /
  `runApply()` (the hyprctl call; B4's gamma goes next to the temperature
  here), `syncShader()`, readonly properties the panel binds to, and the
  `ShellIpc` block at the end (one function per command; document each in the
  README's Commands).
- **`Panel.qml`** top to bottom: `PanelHero` (title, status, switch) -> the
  hold buttons (`Flow`) -> separator -> Temperature (`PanelSlider`; B2's
  preset buttons go here) -> separator -> Schedule column (mode
  `ButtonGroup`, Custom's `TimeRow`s, sunset/sunrise, Start `StepRow`,
  Gradual `SwitchRow`, the fade `StepRow`s, location row and field; B3's
  bedtime and B4's dimming rows go here, or in their own section) ->
  separator -> Pause column. Local components at the end: `SwitchRow`,
  `StepRow`, `TimeRow`. All text `Text.PlainText`; strings in `i18n/en.json`
  via `strings.t()`. The panel scrolls (`Flickable`) when the screen is short.
- **Holds with their own temperature** (B2's Movie mode): `override` is
  `{ on, until, temperature? }`; `Model.targetKelvin` is what the night light
  heads for now (the hold's temperature, else the saved one). Anything that
  compares against "the temperature" (the service's `step`, simulations)
  must use `targetKelvin`, not `settings.temperature`.
- **Bedtime** (B3): `bedtimeAt` (the night's bedtime fade: `{start, lengthMs}`),
  `bedtimeReached`; `exactTargetKelvin` is unrounded so a warm-up mixed with
  bedtime's fade rounds once (rounding twice made 5.8-mired steps);
  `fadeStepMs` adds the rates of overlapping fades.
- **Dimming** (B4): `nightAt` (the night under way; shared with bedtime),
  `dimAt`, `gammaAt`, `gammaStepMs`. The service's gamma is its own process
  (`syncGamma`, `gammaSent`), run only when the wanted value changes, and
  not read back (see CLAUDE.md rule 11).
- Screenshots: Cody's Bitwarden window blanks itself out of screen captures
  (a black rectangle), even under the panel. Don't move it; read around it.

## Phase A

### A1. Settings in Omarchy's settings panel

**Why first:** every later feature adds settings. Defining them once, in the
manifest schema, beats adding them to `locus.json` and migrating later.
Cody also gets them in Omarchy's own settings panel, and in his dotfiles
(which track `shell.json`) for free.

**What Omarchy offers** (read on 2026-11-19, `/usr/share/omarchy/shell`):
- `manifest.json` `barWidget.schema`: a list of `{ key, type, label,
  description, defaultValue, ... }`. Types seen: `boolean`, `integer`
  (`min`, `max`, `step`), `enum` (`options`), `string`, `path`.
- Values live in the widget's entry in `shell.json`'s `bar.layout` (or the
  top-level `plugins` list). Widgets read them with `setting(name, fallback)`.
- `shell.updateEntryInline(moduleName, settings)` (shell.qml ~line 1107)
  writes the *whole* merged settings object into that entry, only if it
  changed. Settings exist only while the entry exists (the widget on the bar,
  or listed in `plugins`).
- The service is not handed the bar entry. Dusk reads `shell.json` itself
  with a FileView and finds its entry; check first whether `shell.shellConfig`
  is reachable from the service (it would be a live binding, no file reads).

**Found on 2026-11-19, changes the premise (decision pending with Cody):**
- **There is no settings GUI for plugins**, in Omarchy 4.5.0 or in current
  upstream `omacom/omarchy` (code search). The registry keeps each widget's
  `schema` and `settingsForm`, but nothing renders them: they look reserved
  for a future UI. Dusk's README mentions "Shell Settings"; not found.
- What does exist: `omarchy bar set <id> <key> <value> [--json]` and
  `omarchy bar get <id> <key>` (they write the bar entry without checking the
  schema), and Cody's dotfiles already track `shell.json`.
- **The service can't rely on `shell.barConfig`:** a plugin service's copy is
  refreshed only when plugins or bar widgets change (`syncPluginApis`), not
  when a setting changes. So option (a) below must watch `shell.json` with a
  FileView (as Dusk does) and write through `shell.updateEntryInline`.
- Options put to Cody:
  - **(a) shell.json as designed below:** Omarchy-native, `omarchy bar set`
    works, captured by the dotfiles, ready if Omarchy ships a settings UI.
    Medium work; settings live only while the widget's entry exists.
  - **(b) Split files:** `locus.json` keeps settings only (tracked by the
    dotfiles as a private file), state moves to `locus-state.json`. Simpler,
    independent of Omarchy's internals; a later move to (a) would migrate again.
  - **(c) Skip for now,** revisit if Omarchy ships a settings UI.

**Decision (2026-11-19): option (b).** Cody's reasoning, agreed: the
benefit available today (settings in the dotfiles) is the same either way,
and Locus's own IPC already covers `omarchy bar set`. Move to (a) only once
Omarchy ships a settings UI, when its behavior can be seen rather than guessed.

**Design (option b, being built):**
- `locus.json` (settings, mode 600, Cody's dotfiles track it):
  `mode, temperature, onTime, offTime, ramp, fadeIn, fadeOut, sunsetOffset,
  pauseFullscreen, pauseApps, autoLocation`, and phase B's new settings.
- `locus-state.json` (state, mode 600, never tracked): `manualOn, override,
  rampSkipUntil, latitude, longitude, detected`. Coordinates live here so they
  never reach git.
- The rest of the code keeps one combined `settings` object. `Model.js`
  splits it for saving and combines the two files for loading; each key is
  read only from its home file.
- Each half is written only when it changed, so a hold never rewrites the
  tracked file (no dotfiles churn).
- Migration, once: a `locus.json` holding state keys (the old combined file,
  or Sundown's imported one) is split into the two files.
- After it lands: `chezmoi add ~/.local/state/omarchy/settings/locus.json`
  in the dotfiles, and document it.

**Design (option a, not chosen, kept for later):**
- **Settings** (user choices, in `shell.json`, tracked by Cody's dotfiles):
  `mode, temperature, onTime, offTime, ramp, fadeIn, fadeOut, sunsetOffset,
  pauseFullscreen, pauseApps` (a comma-separated string in the schema),
  `autoLocation`, and every new setting from phase B.
- **State** (changes on its own, private, untracked, `locus.json`, mode 600):
  `manualOn, override, rampSkipUntil, detected`, and **typed coordinates**
  (`latitude, longitude`). Coordinates stay out of `shell.json` because that
  file goes into Cody's dotfiles git repo.
- `Model.js` gets pure helpers, all tested: split a combined object into
  settings and state, merge them back into what the rest of the code uses
  today, validate both halves, and the one-time migration.
- **Migration, once:** if the bar entry has no Locus settings yet and
  `locus.json` holds the old combined object, write the settings half to the
  entry with `updateEntryInline` and rewrite `locus.json` as state only.
- The panel, the IPC commands and the rest of the service keep their current
  API (`updateSettings(patch)`), which now routes each key to its home.
- Schema labels and descriptions written for Omarchy's settings panel, in
  the voice of BRANDING.md. Check how the panel renders each type (find the
  settings UI in the shell source) and that a value edited there reaches the
  service live.

**Done when:** settings show in Omarchy's settings panel and edits there take
effect; the Locus panel and IPC still work; Cody's current settings and hold
survived the migration; `shell.json` re-added in the dotfiles; tests for
split, merge, validation and migration.

### A2. Finer rounding for very warm fades

`Model.mixKelvin` rounds to 10K, about 1 mired at 3000K but about 10 at
1000K, so fades to deep red step visibly. Round to 1K below about 2500K (keep
10K above, where it's invisible, so readings stay tidy). Keep the rule that a
fade never lands on exactly 6000K. Tests: the deep-red day simulation's
biggest step drops under 5 mireds.

## Phase B

### B1. Holds for a set time

Today the switch holds until the next scheduled change. Add "Off for an
hour", "Warm for an hour" and "Until morning" (the end of the night: sunrise
in Sun mode, the off time in Custom). The `override` becomes
`{ on, until, temperature? }` (a temperature only for B2's Movie mode). Panel:
a small row of hold buttons, and "Back to the schedule" while a hold is on.
IPC: `hold off 60`, `hold on 60`, `hold clear`. Holds stay in `locus.json`
(state). `nextDueAt` already wakes for `override.until`. Credit f.lux (disable
for an hour), Kenny's Night Light and Dusk.

### B2. Presets, and Movie mode

One-click temperatures (proposed: Candle 1900K, Warm 2700K, Night 3400K, Mild
4500K; Cody to confirm) that set the saved temperature. **Movie mode:** a
B1 hold at a milder temperature (proposed 5000K) for 2.5 hours, after f.lux.
IPC: `preset candle`, `movie`. Credit f.lux and Kenny's Night Light.

### B3. Bedtime level

A second, warmer level later in the night (f.lux's bedtime;
agkrishnendu's Sunset Night Light has a "late" level). Settings (proposed
defaults, Cody to confirm): `bedtime` off, `bedtimeAt` "22:30",
`bedtimeTemperature` 2200, `weekendDelay` 60 minutes (bedtime that much later
when the night starts on a Friday or Saturday, like f.lux's weekend
sleep-in). From bedtime, the night temperature fades to the bedtime one over
the warm-up length. Sun and Custom modes only. `kelvinAt`, `rampAt` and
`nextDueAt` learn the second level. Tests: weekday, weekend, DST night,
bedtime after the night ends (ignored), interaction with holds and pausing.
Credit f.lux and agkrishnendu.

### B4. Late-night dimming

Software dimming through `hyprctl hyprsunset gamma <percent>`, below the
panel's own minimum. Settings: `dim` off, `dimFrom` "23:30", `dimPercent` 80
(50 to 100). Eases in over 15 minutes, eases back out with the morning
clear-down. The service tracks the gamma it sent and re-sends it after a
hyprsunset restart, like the temperature. Gamma steps of about 2% go into
`nextDueAt`. Tests, including that dimming adds no checks outside its fades.
Credit Dusk, Moonshine and f.lux.

### B5. The Arc mark as the bar icon

Replace the font glyph with the Locus arc drawn in QML (QtQuick.Shapes, or
Canvas painted only on change): the arc in the bar's foreground colour, the
point in the accent while on, dimmed while off. It must stay crisp at bar
size (check 16 to 24 px and the vertical bar) and follow themes. Keep
`Indicator.qml` working (it may stay a glyph if indicators need text).

### B6. A 24-hour view of the night

In the panel: a ring or strip for the day with the warm hours, fades,
bedtime and dimming, and a "now" marker. Painted when the panel opens and
when the schedule changes, once a minute while open, never while closed.

### B7. Fades that follow twilight

Option `fadeWith`: `minutes` (today) or `twilight`. With twilight, the
warm-up runs from the start (sunset, with the offset) to the end of civil
dusk (sun 6 degrees below the horizon), and the clear-down from civil dawn to
sunrise, so fades stretch and shrink with the season. Sun mode only. Credit
Redshift and gammastep.

### B8. Daytime tint

Off by default: `dayTemperature` neutral. When set (say 5800K), days use it
instead of neutral, so hyprsunset must run all day (negligible). Never land
on exactly 6000K. Credit f.lux and Redshift.

### B9. Location by city name

Type a city in the panel's location field (today it takes coordinates). One
request when you press Enter, to Open-Meteo's geocoding API (no key), never
in the background. Saved in `locus.json` with the coordinates. README: say
it sends the typed name, and give Open-Meteo/GeoNames the attribution their
licence asks for. Credit Kenny's Night Light (which geocodes with
Open-Meteo).

### B10. Run a command at sunset and sunrise

Settings `onCommand`, `offCommand` (empty by default): run when the schedule
turns on and off (not for holds or pausing), detached. Use: switching to a
dark theme at night. Credit f.lux (dark mode at sunset) and Redshift's hooks.

## Phase C (ask Cody before starting any)

- **C1. Screen effects:** Darkroom (inverted red), pure red, grayscale, via a
  Hyprland screen shader like `warm-shader.sh`. A per-frame GPU cost while on:
  toggle, off by default.
- **C2. Ambient light sensor:** check what the Surface's sensor reports
  (`/sys/bus/iio/devices/*`); it may give brightness only, which could drive
  dimming. Needs polling: toggle, off by default.
- **C3. Off during calls or screen sharing:** find what Omarchy exposes (its
  screen-recording indicator). Pausing for Zoom or Teams by name already works.
- **C4. A strength per monitor:** hyprsunset applies one setting to every
  screen; this needs shaders or a helper program. Probably skip.
- **C5. Smart bulbs:** network calls; skip unless Cody has them.

## Decisions waiting on Cody

- ~~B2 preset temperatures and Movie mode's temperature.~~ **Settled
  2026-11-19:** Cody let the proposed defaults stand (Candle 1900K, Warm 2700K,
  Night 3400K, Mild 4500K; Movie mode 5000K for 2.5 h). Go ahead.
- ~~B3 default bedtime, bedtime temperature, weekend delay.~~ **Settled:**
  proposed defaults stand (bedtime off by default, 22:30, 2200K, 60 min later
  on Friday and Saturday nights).
- **B8 whether daytime tint is wanted at all.** Found while starting it: a
  day level under 6000K crosses the line Locus, Omarchy's Night Light icon
  and `omarchy toggle nightlight` all read as "on", so Omarchy's icon would
  show the night light on all day and its toggle would switch the day tint
  off (Locus would take that as a hold until sunset). Building it also means
  every fade mixes from a day level instead of neutral (rampAt, fadeStepMs,
  the 24-hour view) and "on" in the service compares against that level.
  Recommendation: skip it unless Cody wants it; the bedtime level covers the
  "warmer later" need, and nothing else asks for a daytime tint.
- Phase C: which, if any.
- Housekeeping, optional: hide Omarchy's own Night Light icon so there's one
  control (`omarchy.indicators` `items`, then re-add `shell.json`).
