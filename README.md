> [!IMPORTANT]
> **This is a fork** of [WilliamJohnDavisIII/omarchy-sundown](https://github.com/WilliamJohnDavisIII/omarchy-sundown). It adds two changes, both offered upstream:
>
> - [#1](https://github.com/WilliamJohnDavisIII/omarchy-sundown/pull/1): the extra-warm shader script runs only while that shader is on, not on every 15-second check (about 29,000 fewer processes a day).
> - [#2](https://github.com/WilliamJohnDavisIII/omarchy-sundown/pull/2): the mildest temperature is 5500K instead of 4500K.
>
> Install this fork with `omarchy plugin add https://github.com/cwilliams5/omarchy-sundown.git --enable`. Once both are merged, use the original instead.

# Sundown

A night light for [Omarchy](https://omarchy.org) that follows the sun. It warms the screen at sunset and clears it at sunrise, with a temperature slider and a custom schedule if you'd rather pick the hours.

It's built on `hyprsunset`, which Omarchy already ships. Sun times are calculated on your computer, so it makes no network requests unless you turn on location detection.

## Install

```bash
omarchy plugin add https://github.com/WilliamJohnDavisIII/omarchy-sundown.git --enable
omarchy restart shell
```

Omarchy's own night light icon stays in the indicators widget. To leave only Sundown's, take `NightLight` out of that widget's `items`.

## Use

| Do this | And |
|---|---|
| Left-click the icon | Open the panel |
| Right-click the icon | Flip the switch |
| Scroll on the icon | Change the temperature |

In the panel, Left and Right change the temperature, Enter flips the switch, and `m` changes the mode.

The modes are:

- **Sun:** on from sunset to sunrise
- **Custom:** on between two times you choose
- **Manual:** stays how you set it

With **Gradual** on, which is the default, Sun and Custom modes warm the screen over the hour after they turn on, and clear it over the 30 minutes before they turn off. Turn it off to change at the scheduled time instead. Flipping the switch always takes about 2 seconds.

Flipping the switch during a schedule holds until the next scheduled change, even across restarts. Moving the slider while the night light is off previews that temperature for 10 seconds.

`hyprsunset` stops at 1000K, and on some screens that is more orange than red. Below 1000K, Sundown leaves `hyprsunset` there and adds a Hyprland screen shader that takes away more green and blue, until 500K shows only red. A screen shader you already use, like a grayscale one, keeps working underneath. The shader goes away on a config reload and comes back within 15 seconds.

`omarchy toggle nightlight` still works. It uses Omarchy's fixed 4000K, and that stays until the next scheduled change, even during a gradual change.

## Location

Sun mode uses the first of these it finds:

1. Coordinates you enter with the pencil button in the panel
2. Your detected location, if the crosshairs button is on
3. Omarchy's weather location, if it has coordinates and not only a name
4. The main city of your system time zone, from `/usr/share/zoneinfo/zone1970.tab`

The time zone is only a rough guide, so sunset can be off by a while if you live far from that city. If none of these is available, the switch stays how you set it until you enter a location.

Location detection is off by default. It asks `geo.omarchy.org` for the city of your IP address, as Omarchy's weather widget does, when the shell starts, every few hours, and after a long sleep. The last answer is kept so it works offline, and is deleted when you turn this off. A VPN will make it report the VPN's location.

Coordinates you enter, and the detected location, are saved in `~/.local/state/omarchy/settings/heliotrope.json`, a name kept from when the plugin was called Heliotrope. Sundown keeps that file readable only by your account.

## Commands

```bash
ID=io.github.williamjohndavisiii.heliotrope.control

omarchy-shell $ID status
omarchy-shell $ID on
omarchy-shell $ID off
omarchy-shell $ID toggle
omarchy-shell $ID set 3000              # Save a temperature, from 500 to 5500
omarchy-shell $ID schedule sun          # Or manual, or custom
omarchy-shell $ID hours 21:00 07:00     # Custom on and off times
omarchy-shell $ID location "52.52, 13.40"
omarchy-shell $ID location ""           # Back to the automatic location
omarchy-shell $ID ramp off              # Or on: change gradually
omarchy-shell $ID autolocation on       # Or off: detect location from your IP
```

## Show it with Omarchy's indicators (optional)

To have the icon appear among Omarchy's indicators instead of on its own:

1. Set `showIcon` to `false` on the Sundown entry in `~/.config/omarchy/shell.json`.
2. Add this to the `omarchy.indicators` `items`, using your own home folder:

```
../../../../../../../home/YOU/.config/omarchy/plugins/io.github.williamjohndavisiii.heliotrope/Indicator
```

The path is relative to Omarchy's indicators folder, because Omarchy has no supported way to load another plugin's indicator yet.

## Remove

```bash
omarchy plugin remove io.github.williamjohndavisiii.heliotrope
hyprctl hyprsunset identity
rm ~/.local/state/omarchy/settings/heliotrope.json
```

The second line clears any tint left on the screen, and the third deletes your settings.

## Requirements

Omarchy's Quickshell-based shell and `hyprsunset`, both of which come with Omarchy.

## Tested on

One MacBook Air (M1, 2020) running Asahi, where the tint survived a suspend and resume.

Omarchy's stock `~/.config/hypr/hyprsunset.conf` clears the tint at 07:00. If the schedule still has the night light on then, Sundown puts it back at its next check, within about 15 seconds. To avoid that, remove the profile from the file.

Not verified yet: suspend and resume on other hardware. [omacom/omarchy#16052](https://github.com/omacom/omarchy/issues/16052) reports the tint disappearing on an AMD Framework laptop, and Sundown doesn't reapply it.

## Tests

```bash
TZ=America/New_York node tests/model.test.js
```

## License

MIT
