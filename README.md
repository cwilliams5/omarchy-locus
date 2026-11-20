# Locus

A night light for [Omarchy](https://omarchy.org). It warms the screen at sunset, or at hours you pick, and clears it at sunrise, fading so gently you don't see it happen. A slider sets how warm, and it steps aside for apps that need true colour.

Locus started as a fork of [Sundown](https://github.com/WilliamJohnDavisIII/omarchy-sundown) by William John Davis III and has gone its own way since. See [Credits](#credits).

It's built on `hyprsunset`, which Omarchy already ships. Sun times are calculated on your computer, so it makes no network requests unless you turn on location detection.

## Install

```bash
omarchy plugin add https://github.com/cwilliams5/omarchy-locus.git --enable
omarchy restart shell
```

Omarchy's own night light icon stays in the indicators widget. To leave only Locus's, take `NightLight` out of that widget's `items`.

## Use

| Do this | And |
|---|---|
| Left-click the icon | Open the panel |
| Right-click the icon | Flip the switch |
| Scroll on the icon | Change the temperature |

In the panel, Left and Right change the temperature, Enter flips the switch, and `m` changes the mode.

Under the hold buttons, a strip shows the day from noon to noon: when the screen warms and clears, how strong the tint is, bedtime and dimming, any hold, and a mark for now. It's worked out when the panel opens or a setting changes, so it costs nothing while the panel is closed.

The modes are:

- **Sun:** on from sunset to sunrise. **Start** moves the beginning up to 3 hours before sunset or 2 hours after it, in 15-minute steps.
- **Custom:** on between two times you choose
- **Manual:** stays how you set it

With **Gradual** on, which is the default, Sun and Custom modes warm the screen over the hour after they turn on, and clear it over the 30 minutes before they turn off. **Warm up over** and **Clear over** change those lengths, from at once to 3 hours. Turn Gradual off to change at the scheduled time instead. Flipping the switch always takes about 2 seconds.

In Sun mode, **Follow twilight** times the fades by the sky instead: the screen warms from the start until civil dusk (when the sun is 6 degrees below the horizon) and clears from civil dawn until sunrise, so the fades are longer in summer and in the far north. With **Start** before sunset, the warm-up starts that much earlier. Where the sun never gets that low, as on summer nights in the far north, the lengths you set apply.

A fade moves in steps of about 3 mireds, under what the eye can tell apart, so an hour from 6500K to 3000K is about 60 steps. Locus looks at `hyprsunset` when something is due (a scheduled change, the next fade step, a switch time in `hyprsunset.conf`) and otherwise once a minute, so a change made elsewhere is noticed within a minute. It always looks before it sends anything, so it never overwrites a change it hasn't seen yet.

Flipping the switch during a schedule holds until the next scheduled change, even across restarts. The buttons under it hold for a set time instead: **Off 1 h** and **Warm 1 h**, then back to the schedule; **Movie 2.5 h**, milder (5000K) for long enough to watch a film; **Off till morning** for the rest of the night (or for tonight, if it's still day); and **Back to schedule** ends any hold. Timed holds work in Manual mode too. Choosing a temperature during Movie mode keeps the hold but shows the temperature you chose.

Under the slider, **Mild**, **Night**, **Warm** and **Candle** set 4500K, 3400K, 2700K and 1900K in one click. Moving the slider while the night light is off previews that temperature for 10 seconds.

**Warmer from bedtime** adds a second, warmer level later in the night, in Sun and Custom modes. From **Bedtime** (22:30 unless you change it), the screen moves to the **Bedtime level** (2200K) over the warm-up length, or at once with Gradual off. Nights that start on a Friday or Saturday reach bedtime later (**Fri and Sat nights**, an hour unless you change it). A bedtime after midnight counts for the night before it, and one that has already passed when the night starts covers the whole night. Once bedtime has come, the slider, the presets and scrolling on the icon change the bedtime level.

**Dimmer late at night** turns brightness down past what the screen's own controls reach, through `hyprsunset`'s gamma, in Sun and Custom modes. From **From** (23:30 unless you change it) it eases down to **Brightness** (80%) over 15 minutes, or at once with Gradual off, and comes back up with the morning's clear-down. It stays at full brightness while an app has the night light paused, during a hold that turns it off, and in Movie mode. Both bedtime and dimming are off until you turn them on.

`hyprsunset` stops at 1000K, and on some screens that is more orange than red. Below 1000K, Locus leaves `hyprsunset` there and adds a Hyprland screen shader that takes away more green and blue, until 500K shows only red. A screen shader you already use, like a grayscale one, keeps working underneath. The shader goes away on a config reload and comes back within a minute.

`omarchy toggle nightlight` still works. It uses Omarchy's fixed 4000K, and that stays until the next scheduled change, even during a gradual change.

## Pausing for apps

Some apps need true colour, like games and photo or video editors. Locus can keep the screen neutral while one of them is in front, and warm it again when you leave it. The **Pause** section of the panel has:

- **For fullscreen apps:** any app in real fullscreen (Super+F). A maximized window doesn't count.
- **The app in front**, with a button to pause whenever it's in front, or to stop. The apps you've added are listed under it, each with a button to take it off.

A name ending in `*` matches every app whose class starts with the rest, so `steam_app_*` covers every game started from Steam. Add one like that with the `pauseapp` command below.

While an app has it paused, the switch still shows what the schedule says, and the icon's tooltip names the app. Locus hears about focus and fullscreen changes from Hyprland, so pausing adds no checking of its own.

## Location

Sun mode uses the first of these it finds:

1. Coordinates you enter with the pencil button in the panel
2. Your detected location, if the crosshairs button is on
3. Omarchy's weather location, if it has coordinates and not only a name
4. The main city of your system time zone, from `/usr/share/zoneinfo/zone1970.tab`

The time zone is only a rough guide, so sunset can be off by a while if you live far from that city. If none of these is available, the switch stays how you set it until you enter a location.

Location detection is off by default. It asks `geo.omarchy.org` for the city of your IP address, as Omarchy's weather widget does, when the shell starts, every few hours, and after a long sleep. The last answer is kept so it works offline, and is deleted when you turn this off. A VPN will make it report the VPN's location.

Your settings are saved in `~/.local/state/omarchy/settings/locus.json`. Coordinates you enter, the detected location, and holds go in `locus-state.json` beside it, so you can back up or sync your settings without your location. Locus keeps both files readable only by your account. If you used Sundown, Locus copies its settings (`heliotrope.json`) once, the first time it runs, and sorts them into the two files.

## Commands

```bash
ID=io.github.cwilliams5.locus.control

omarchy-shell $ID status
omarchy-shell $ID on
omarchy-shell $ID off
omarchy-shell $ID toggle
omarchy-shell $ID set 3000              # Save a temperature, from 500 to 5500
omarchy-shell $ID preset candle         # Or mild, night, warm
omarchy-shell $ID schedule sun          # Or manual, or custom
omarchy-shell $ID hours 21:00 07:00     # Custom on and off times
omarchy-shell $ID location "52.52, 13.40"
omarchy-shell $ID location ""           # Back to the automatic location
omarchy-shell $ID ramp off              # Or on: change gradually
omarchy-shell $ID autolocation on       # Or off: detect location from your IP
omarchy-shell $ID hold off 60           # Off for 60 minutes; or hold on 60: warm for 60
omarchy-shell $ID movie                 # 5000K for 2.5 hours; or hold movie 100 for 100 minutes
omarchy-shell $ID bedtime on            # Or off, or a time: bedtime 22:30
omarchy-shell $ID bedtimetemp 2200      # The bedtime level
omarchy-shell $ID weekend 60            # Bedtime this much later on Friday and Saturday nights
omarchy-shell $ID dim on                # Or off, or the time it starts: dim 23:30
omarchy-shell $ID dimlevel 80           # Brightness at its dimmest, 50 to 100 percent
omarchy-shell $ID morning               # Off for the rest of the night
omarchy-shell $ID resume                # End any hold
omarchy-shell $ID offset 30             # Sun mode starts 30 min before sunset; negative is after
omarchy-shell $ID fade 60 30            # Warm-up and clear-down in minutes, 0 to 180
omarchy-shell $ID twilight on           # Or off: Sun mode's fades follow dusk and dawn
omarchy-shell $ID pausefullscreen on    # Or off
omarchy-shell $ID pauseapp gimp on      # Or off; steam_app_* matches every Steam game
omarchy-shell $ID pausefront            # Pause for the app in front, or stop
```

## Show it with Omarchy's indicators (optional)

To have the icon appear among Omarchy's indicators instead of on its own:

1. Set `showIcon` to `false` on the Locus entry in `~/.config/omarchy/shell.json`.
2. Add this to the `omarchy.indicators` `items`, using your own home folder:

```
../../../../../../../home/YOU/.config/omarchy/plugins/io.github.cwilliams5.locus/Indicator
```

The path is relative to Omarchy's indicators folder, because Omarchy has no supported way to load another plugin's indicator yet.

## Remove

```bash
omarchy plugin remove io.github.cwilliams5.locus
hyprctl hyprsunset identity
rm ~/.local/state/omarchy/settings/locus.json ~/.local/state/omarchy/settings/locus-state.json
```

The second line clears any tint left on the screen, and the third deletes your settings.

## Requirements

Omarchy's Quickshell-based shell and `hyprsunset`, both of which come with Omarchy.

## Tested on

An Intel laptop on Omarchy 4.5.0 with Hyprland 0.56.2. Sundown, which Locus builds on, was tested on a MacBook Air (M1, 2020) running Asahi, where the tint survived a suspend and resume.

Omarchy's stock `~/.config/hypr/hyprsunset.conf` clears the tint at 07:00. Locus reads that file, looks just after each of its switch times, and puts the tint back if the schedule still has it on, within a few seconds (a minute if `hyprsunset` switches late, as it can after a sleep). To avoid it altogether, remove the profile from the file.

Not verified yet: suspend and resume on other hardware. [omacom/omarchy#16052](https://github.com/omacom/omarchy/issues/16052) reports the tint disappearing on an AMD Framework laptop, and Locus doesn't reapply it.

## Tests

```bash
TZ=America/New_York node tests/model.test.js
```

## Credits

Locus is a hard fork of [Sundown](https://github.com/WilliamJohnDavisIII/omarchy-sundown) by [William John Davis III](https://github.com/WilliamJohnDavisIII) (MIT). Its foundation is his work: the sun times and location, the way it drives `hyprsunset` and notices changes made elsewhere, the panel, and the extra-warm shader. His commits are kept in this repository's history.

Ideas, not code, from:

- [Dusk](https://github.com/ReidenXerx/omarchy-dusk) by ReidenXerx (MIT): starting before sunset; a fade length you choose; stepping aside for fullscreen apps and apps you name, with a button for the app in front; spacing fade steps by what the eye can tell apart (a few mireds) and looking about once a minute; reading `hyprsunset.conf`'s own switch times so they aren't taken for you; "off until morning" and "warm for an hour"; dimming late at night, below the screen's own minimum, eased in.
- [f.lux](https://justgetflux.com): the night light the rest descend from, including disabling for fullscreen apps, for the app in front, and for an hour; Movie mode; named colour presets like Candle; a warmer bedtime, and sleeping in at weekends.
- [Sunset Night Light](https://github.com/agkrishnendu/omarchy-nightlight) by agkrishnendu: a second, warmer temperature later in the evening.
- [Redshift](https://github.com/jonls/redshift) and [gammastep](https://gitlab.com/chinstrap/gammastep): changing with the sun's height through twilight rather than by the clock.
- [Moonshine](https://github.com/tiagoabiramia/omarchy-moonshine) by Tiago Abi-Ramia: software dimming for Omarchy.
- [Night Light](https://github.com/key-tone/omarchy-nightlight) by Kenny Keeton: pausing for an hour, or until sunrise; one-click presets, including Night at 3400K and Candle at 1900K.

## License

MIT
