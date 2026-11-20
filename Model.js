// Sun times and schedule rules for the night light. Plain functions with no QML,
// so tests/model.test.js can run them under node.

var MIN_TEMP = 500
var HYPRSUNSET_MIN = 1000 // hyprsunset refuses anything lower
var EXTRA_STEPS = 10 // Shader strengths below HYPRSUNSET_MIN
// The mildest setting. Kept below FRESH_TEMP, which is how a restarted hyprsunset
// is recognized, and below the 6000K line that this plugin and
// omarchy-toggle-nightlight both read as off.
var MAX_TEMP = 5500
var OFF_TEMP = 6500 // Reported while off, matching omarchy-toggle-nightlight
var FRESH_TEMP = 6000 // hyprsunset's default; only ever reported right after it starts
var DAY_MS = 86400000
// Sun and Custom follow a schedule; Always is warm whenever Locus is on.
var MODES = ["sun", "custom", "always"]
var MINUTE_MS = 60000
var RAMP_IN_MS = 3600000 // Default warm-up, from the moment the schedule turns on
var RAMP_OUT_MS = 1800000 // Default clear-down, ending the moment the schedule turns off
var MAX_FADE_MINUTES = 180
var MIN_SUNSET_OFFSET = -120 // Minutes; negative starts after sunset
var MAX_SUNSET_OFFSET = 180 // Minutes; positive starts before sunset
var FADE_MS = 2000 // Flipping the switch
var MOVED_DEGREES = 0.05 // About 5 km, or a few seconds of sunset
// Fade steps are spaced about this many mireds apart, under the ~5 the eye can
// just tell apart, and never more often than MIN_STEP_MS. A change under half a
// step isn't worth sending: that's what a check between steps sees, while a due
// step always clears it, even after rounding to 10K (about 1 mired at 3000K).
var STEP_MIREDS = 3
var MIN_SEND_MIREDS = STEP_MIREDS / 2
var MIN_STEP_MS = 5000
var CHECK_MS = 60000 // Longest gap between looks at hyprsunset when nothing is due
var PROFILE_RECHECK_MS = [2000, 62000] // After a hyprsunset.conf switch time; it can land up to a minute late
var MAX_HOLD_MINUTES = 720
// One-click temperatures, mildest first, the way the slider runs.
var PRESETS = [
  { name: "mild", kelvin: 4500 },
  { name: "night", kelvin: 3400 },
  { name: "warm", kelvin: 2700 },
  { name: "candle", kelvin: 1900 }
]
// Movie mode, after f.lux: milder for long enough to watch a film, then the schedule again.
var MOVIE_TEMP = 5000
var MOVIE_MINUTES = 150
var MAX_WEEKEND_DELAY = 180
// Late-night dimming through hyprsunset's gamma, in percent of full brightness.
var FULL_GAMMA = 100
var MIN_DIM_PERCENT = 50
var DIM_EASE_MS = 15 * MINUTE_MS
var PAUSE_APPS_MAX = 32
var APP_NAME_MAX = 64

function isLatitude(value) {
  return Number.isFinite(value) && Math.abs(value) <= 90
}

function isLongitude(value) {
  return Number.isFinite(value) && Math.abs(value) <= 180
}

function defaultSettings() {
  return {
    mode: "sun",
    temperature: 3000,
    // Locus on or off: the panel's switch. Off does nothing until turned on again.
    enabled: true,
    onTime: "21:00",
    offTime: "07:00",
    latitude: null,
    longitude: null,
    placeName: "", // The city typed for those coordinates, if one was
    override: null,
    ramp: true,
    rampSkipUntil: 0,
    autoLocation: false,
    detected: null,
    sunsetOffset: 0,
    fadeIn: RAMP_IN_MS / MINUTE_MS,
    fadeOut: RAMP_OUT_MS / MINUTE_MS,
    pauseFullscreen: false,
    pauseApps: [],
    // A second, warmer level later in the night (f.lux's bedtime).
    bedtime: false,
    bedtimeAt: "22:30",
    bedtimeTemperature: 2200,
    weekendDelay: 60, // Minutes later when the night starts on a Friday or Saturday
    // Dimmer late at night, below what the screen's own brightness goes down to.
    dim: false,
    dimFrom: "23:30",
    dimPercent: 80,
    // Sun mode's fades follow twilight instead of fadeIn and fadeOut.
    twilight: false,
    // Shell commands run as the schedule turns on and off (a dark theme at night).
    onCommand: "",
    offCommand: ""
  }
}

// Where each setting lives. Settings are the user's choices, in locus.json, which
// people keep in their dotfiles. State changes by itself (holds, on/off) or is
// private (typed coordinates, the detected place), in locus-state.json, which
// is never tracked. Every key of defaultSettings has exactly one home; a test
// enforces it, so a new setting can't be added without picking one.
var SETTING_KEYS = ["mode", "temperature", "onTime", "offTime", "ramp", "fadeIn", "fadeOut",
                    "sunsetOffset", "pauseFullscreen", "pauseApps", "autoLocation",
                    "bedtime", "bedtimeAt", "bedtimeTemperature", "weekendDelay",
                    "dim", "dimFrom", "dimPercent", "twilight", "onCommand", "offCommand"]
var STATE_KEYS = ["enabled", "override", "rampSkipUntil", "latitude", "longitude", "placeName", "detected"]

function pickKeys(object, keys) {
  var out = {}
  if (!object || typeof object !== "object" || Array.isArray(object)) return out
  for (var i = 0; i < keys.length; i++)
    if (Object.prototype.hasOwnProperty.call(object, keys[i])) out[keys[i]] = object[keys[i]]
  return out
}

// The combined settings, as the two files to save.
function splitSettings(settings) {
  return { settings: pickKeys(settings, SETTING_KEYS), state: pickKeys(settings, STATE_KEYS) }
}

// The combined settings from the two files' parsed contents. Each key is read
// from its own file only. A settings file that still holds state (the single
// file from before the split, or Sundown's imported one) lends it to the state
// where the state file has none, and asks to be split once (migrate).
function combineSettings(settingsRaw, stateRaw) {
  var chosen = pickKeys(settingsRaw, SETTING_KEYS)
  var state = pickKeys(stateRaw, STATE_KEYS)
  var stray = pickKeys(settingsRaw, STATE_KEYS)
  var migrate = Object.keys(stray).length > 0
  for (var key in stray)
    if (!Object.prototype.hasOwnProperty.call(state, key)) state[key] = stray[key]
  // Before Locus had its own on/off switch, Manual mode's switch (manualOn)
  // said whether the screen was warm. Manual becomes Always, and Locus is on
  // only if that switch was; in Sun and Custom modes it's on.
  var oldSwitch = legacyValue(stateRaw, settingsRaw, "manualOn")
  if (oldSwitch !== undefined) migrate = true
  if (chosen.mode === "manual") {
    chosen.mode = "always"
    migrate = true
    if (!Object.prototype.hasOwnProperty.call(state, "enabled")) state.enabled = oldSwitch === true
  }
  var merged = {}
  for (var s in state) merged[s] = state[s]
  for (var c in chosen) merged[c] = chosen[c]
  return { settings: normalizeSettings(merged), migrate: migrate }
}

function legacyValue(first, second, key) {
  var objects = [first, second]
  for (var i = 0; i < objects.length; i++) {
    var object = objects[i]
    if (object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key)) return object[key]
  }
  return undefined
}

function clampInt(value, low, high) {
  return Math.max(low, Math.min(high, Math.round(Number(value))))
}

// An app class to step aside for, as typed or taken from the app in front:
// letters, digits and . _ + - and inner spaces, with an optional * at the end
// matching any class that starts with the rest (steam_app_* for every Steam game).
function cleanAppName(value) {
  if (typeof value !== "string") return null
  var name = value.trim()
  if (name.length === 0 || name.length > APP_NAME_MAX) return null
  return /^[A-Za-z0-9][A-Za-z0-9._+ -]*\*?$/.test(name) && name !== "*" ? name : null
}

// The apps list, from an array or a comma-separated string: cleaned, without
// repeats (ignoring case), and bounded.
function appList(value) {
  var items = Array.isArray(value) ? value : (typeof value === "string" ? value.split(",") : [])
  var out = []
  var seen = {}
  for (var i = 0; i < items.length && out.length < PAUSE_APPS_MAX; i++) {
    var name = cleanAppName(items[i])
    if (name === null || seen[name.toLowerCase()]) continue
    seen[name.toLowerCase()] = true
    out.push(name)
  }
  return out
}

function appMatches(pattern, appClass) {
  var want = String(pattern).toLowerCase()
  var have = String(appClass).toLowerCase()
  if (want.charAt(want.length - 1) === "*") return have.indexOf(want.slice(0, -1)) === 0
  return have === want
}

// Whether the screen should stay neutral for the app in front: a real
// fullscreen window when that's turned on, or a class in the list.
function pausedFor(settings, appClass, fullscreen) {
  if (settings.pauseFullscreen && fullscreen === true) return true
  if (!appClass) return false
  for (var i = 0; i < settings.pauseApps.length; i++)
    if (appMatches(settings.pauseApps[i], appClass)) return true
  return false
}

// The pause list with one app added or taken out. Taking out removes every
// entry that matches it exactly, ignoring case; wildcards stay unless named.
function withPausedApp(settings, appClass, on) {
  var name = cleanAppName(appClass)
  if (name === null) return settings.pauseApps.slice()
  var rest = settings.pauseApps.filter(function(app) { return app.toLowerCase() !== name.toLowerCase() })
  return on ? appList(rest.concat([name])) : rest
}

// A name from outside (an app's class or title) made safe and short for a
// label: no control characters, nothing that reads as markup, at most 60
// characters.
function displayName(value) {
  var text = String(value === undefined || value === null ? "" : value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/</g, "‹").replace(/>/g, "›").replace(/&/g, "＆")
    .trim()
  return text.length > 60 ? text.slice(0, 59) + "…" : text
}

function parseTime(text) {
  var match = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/.exec(String(text))
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

function formatTime(minutes) {
  var hours = Math.floor(minutes / 60)
  var rest = minutes % 60
  return (hours < 10 ? "0" : "") + hours + ":" + (rest < 10 ? "0" : "") + rest
}

function stepTime(text, deltaMinutes) {
  var minutes = parseTime(text)
  if (minutes === null) return text
  return formatTime(((minutes + deltaMinutes) % 1440 + 1440) % 1440)
}

function clampTemp(kelvin) {
  return Math.max(MIN_TEMP, Math.min(MAX_TEMP, Math.round(Number(kelvin))))
}

// What hyprsunset is told. It stops at 1000K, so below that it stays there and
// a screen shader (warm-shader.sh) takes away the rest of the green.
function hyprsunsetKelvin(kelvin) {
  return Math.max(HYPRSUNSET_MIN, kelvin)
}

// How much of that shader, from 0 (none) to EXTRA_STEPS (red only, at MIN_TEMP).
// In steps, so a fade or ramp recompiles the shader a few times, not every frame.
function extraWarmStep(kelvin) {
  if (!(kelvin < HYPRSUNSET_MIN)) return 0
  var share = (HYPRSUNSET_MIN - Math.max(MIN_TEMP, kelvin)) / (HYPRSUNSET_MIN - MIN_TEMP)
  return Math.max(1, Math.round(share * EXTRA_STEPS))
}

// A command to run, as typed: trimmed, bounded, and without the NUL that no
// process argument can hold. Only the user can set it (their own settings
// file, or the command line), so it runs as written.
var COMMAND_MAX = 2000
function cleanCommand(value) {
  if (typeof value !== "string") return ""
  return value.replace(/\u0000/g, "").trim().slice(0, COMMAND_MAX)
}

// Bad or missing values fall back to the defaults, one field at a time.
function normalizeSettings(raw) {
  var result = defaultSettings()
  if (!raw || typeof raw !== "object") return result
  var mode = raw.mode === "manual" ? "always" : raw.mode
  if (MODES.indexOf(mode) !== -1) result.mode = mode
  if (Number.isFinite(raw.temperature)) result.temperature = clampTemp(raw.temperature)
  if (typeof raw.enabled === "boolean") result.enabled = raw.enabled
  if (parseTime(raw.onTime) !== null) result.onTime = formatTime(parseTime(raw.onTime))
  if (parseTime(raw.offTime) !== null) result.offTime = formatTime(parseTime(raw.offTime))
  if (isLatitude(raw.latitude) && isLongitude(raw.longitude)) {
    result.latitude = raw.latitude
    result.longitude = raw.longitude
    if (typeof raw.placeName === "string") result.placeName = displayName(raw.placeName)
  }
  var override = raw.override
  if (override && typeof override.on === "boolean" && Number.isFinite(override.until)) {
    result.override = { on: override.on, until: override.until }
    // A warm hold can carry its own temperature (Movie mode).
    if (override.on && Number.isFinite(override.temperature)) result.override.temperature = clampTemp(override.temperature)
  }
  if (typeof raw.ramp === "boolean") result.ramp = raw.ramp
  if (Number.isFinite(raw.rampSkipUntil)) result.rampSkipUntil = raw.rampSkipUntil
  if (typeof raw.autoLocation === "boolean") result.autoLocation = raw.autoLocation
  var detected = raw.detected
  if (detected && isLatitude(detected.latitude) && isLongitude(detected.longitude)) {
    result.detected = {
      latitude: detected.latitude,
      longitude: detected.longitude,
      name: typeof detected.name === "string" ? detected.name.slice(0, 64) : ""
    }
  }
  if (Number.isFinite(raw.sunsetOffset)) result.sunsetOffset = clampInt(raw.sunsetOffset, MIN_SUNSET_OFFSET, MAX_SUNSET_OFFSET)
  if (Number.isFinite(raw.fadeIn)) result.fadeIn = clampInt(raw.fadeIn, 0, MAX_FADE_MINUTES)
  if (Number.isFinite(raw.fadeOut)) result.fadeOut = clampInt(raw.fadeOut, 0, MAX_FADE_MINUTES)
  if (typeof raw.pauseFullscreen === "boolean") result.pauseFullscreen = raw.pauseFullscreen
  result.pauseApps = appList(raw.pauseApps)
  if (typeof raw.bedtime === "boolean") result.bedtime = raw.bedtime
  if (parseTime(raw.bedtimeAt) !== null) result.bedtimeAt = formatTime(parseTime(raw.bedtimeAt))
  if (Number.isFinite(raw.bedtimeTemperature)) result.bedtimeTemperature = clampTemp(raw.bedtimeTemperature)
  if (Number.isFinite(raw.weekendDelay)) result.weekendDelay = clampInt(raw.weekendDelay, 0, MAX_WEEKEND_DELAY)
  if (typeof raw.dim === "boolean") result.dim = raw.dim
  if (parseTime(raw.dimFrom) !== null) result.dimFrom = formatTime(parseTime(raw.dimFrom))
  if (Number.isFinite(raw.dimPercent)) result.dimPercent = clampInt(raw.dimPercent, MIN_DIM_PERCENT, FULL_GAMMA)
  if (typeof raw.twilight === "boolean") result.twilight = raw.twilight
  result.onCommand = cleanCommand(raw.onCommand)
  result.offCommand = cleanCommand(raw.offCommand)
  return result
}

// "52.52, 13.40", as typed into the panel. Null when it isn't a place on Earth.
function parseCoordinates(text) {
  var match = /^\s*(-?\d+(?:\.\d+)?)[\s,]+(-?\d+(?:\.\d+)?)\s*$/.exec(String(text))
  if (!match) return null
  var latitude = Number(match[1])
  var longitude = Number(match[2])
  return isLatitude(latitude) && isLongitude(longitude) ? { latitude: latitude, longitude: longitude } : null
}

// What the panel's location field (or the location command) asks for: back
// to automatic ("clear"), coordinates, or a city to look up. Null when it
// can't be any of them.
var CITY_MAX = 64
function locationRequest(text) {
  var typed = String(text === undefined || text === null ? "" : text).trim()
  if (typed === "") return { kind: "clear" }
  var place = parseCoordinates(typed)
  if (place) return { kind: "coordinates", latitude: place.latitude, longitude: place.longitude }
  // Something that looks like numbers but isn't a place on Earth is a typo,
  // not a city.
  if (/^[\s\d.,+-]+$/.test(typed)) return null
  if (typed.length > CITY_MAX || /[\u0000-\u001f\u007f-\u009f]/.test(typed)) return null
  return { kind: "city", query: typed }
}

// Open-Meteo's geocoding answer: the first place it found, with a short name
// for the panel ("Berlin, Germany"). Null when it found nothing or the answer
// doesn't make sense. The text comes from outside, so it goes through
// displayName.
function geocodeResult(text) {
  var parsed = null
  try { parsed = JSON.parse(text) } catch (error) { parsed = null }
  var first = parsed && Array.isArray(parsed.results) ? parsed.results[0] : null
  if (!first || typeof first !== "object") return null
  var latitude = Number(first.latitude)
  var longitude = Number(first.longitude)
  if (!isLatitude(latitude) || !isLongitude(longitude)) return null
  var parts = [first.name, first.country].filter(function(part) { return typeof part === "string" && part.trim() !== "" })
  return { latitude: latitude, longitude: longitude, name: displayName(parts.join(", ")) }
}

// Omarchy's weather.json. It often holds only a name, which is no use here,
// because turning a name into coordinates would mean a network call.
function weatherLocation(text) {
  var parsed = null
  try { parsed = JSON.parse(text) } catch (error) { parsed = null }
  if (!parsed || typeof parsed !== "object") return null
  var latitude = parseFloat(parsed.latitude)
  var longitude = parseFloat(parsed.longitude)
  if (!isLatitude(latitude) || !isLongitude(longitude)) return null
  var name = typeof parsed.name === "string" ? parsed.name.trim().slice(0, 64) : ""
  return { latitude: latitude, longitude: longitude, name: name }
}

// ISO 6709 as used by zone1970.tab: +404251-0740023 or +4043-07400.
function parseIso6709(text) {
  var match = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(String(text))
  if (!match) return null
  var part = function(sign, whole, minutes, seconds) {
    var value = Number(whole) + Number(minutes) / 60 + Number(seconds || 0) / 3600
    return sign === "-" ? -value : value
  }
  return { latitude: part(match[1], match[2], match[3], match[4]), longitude: part(match[5], match[6], match[7], match[8]) }
}

// The target of /etc/localtime, without the zoneinfo folder.
function zoneName(path) {
  var match = /zoneinfo\/([A-Za-z0-9_+\/-]+)\s*$/.exec(String(path))
  return match ? match[1] : ""
}

// Where the system's time zone says we are, from the system's own table. Only
// roughly right, since it's the zone's main city, but it needs no network.
function zoneCoordinates(table, zone) {
  if (!zone) return null
  var lines = String(table).split("\n")
  for (var i = 0; i < lines.length; i++) {
    var columns = lines[i].split("\t")
    if (columns[2] !== zone) continue
    var place = parseIso6709(columns[1])
    return place ? { latitude: place.latitude, longitude: place.longitude, zone: zone } : null
  }
  return null
}

// Worth saving a new detected place? IP locations jitter, and a few km changes
// sunset by seconds, so small moves are ignored.
function movedFar(previous, next) {
  if (!next) return false
  if (!previous) return true
  return Math.abs(previous.latitude - next.latitude) >= MOVED_DEGREES
    || Math.abs(previous.longitude - next.longitude) >= MOVED_DEGREES
}

// Your own coordinates, then the detected place if that's on, then Omarchy's
// weather location, then the time zone.
// Null means Sun mode has nothing to go on.
function resolveLocation(settings, weather, zone) {
  if (settings.latitude !== null && settings.longitude !== null)
    return { latitude: settings.latitude, longitude: settings.longitude, source: "custom", label: settings.placeName }
  if (settings.autoLocation && settings.detected)
    return { latitude: settings.detected.latitude, longitude: settings.detected.longitude, source: "detected", label: settings.detected.name }
  if (weather) return { latitude: weather.latitude, longitude: weather.longitude, source: "weather", label: weather.name }
  if (zone) return { latitude: zone.latitude, longitude: zone.longitude, source: "timezone", label: zone.zone }
  return null
}

function radians(degrees) { return degrees * Math.PI / 180 }
function degrees(value) { return value * 180 / Math.PI }

var SUNRISE_ZENITH = 90.833 // The sun's top edge on the horizon, with refraction
var CIVIL_ZENITH = 96 // The sun 6 degrees below the horizon: the end of civil dusk

// NOAA solar equations: minutes after 00:00 UTC on the given date, for the sun
// crossing `zenith` degrees (sunrise and sunset by default). When it never
// gets that far that day, sunrise and sunset fall back to noon or midnight
// (as they always have), and anything else is NaN.
// One check asks for the same few sun times dozens of times, so answers are
// kept (a pure function: same inputs, same answer).
var sunCache = {}
var sunCacheSize = 0
function sunMinutesUtc(year, month, day, latitude, longitude, rising, zenith) {
  var key = year + "/" + month + "/" + day + "/" + latitude + "/" + longitude + "/" + rising + "/" + zenith
  if (Object.prototype.hasOwnProperty.call(sunCache, key)) return sunCache[key]
  if (sunCacheSize >= 256) {
    sunCache = {}
    sunCacheSize = 0
  }
  var minutes = sunMinutesUncached(year, month, day, latitude, longitude, rising, zenith)
  sunCache[key] = minutes
  sunCacheSize++
  return minutes
}

function sunMinutesUncached(year, month, day, latitude, longitude, rising, zenith) {
  var target = zenith === undefined ? SUNRISE_ZENITH : zenith
  var julianDay = Date.UTC(year, month, day) / DAY_MS + 2440587.5
  var minutes = 720
  for (var i = 0; i < 3; i++) {
    var t = (julianDay + minutes / 1440 - 2451545) / 36525
    var l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
    var m = radians(357.52911 + t * (35999.05029 - 0.0001537 * t))
    var e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    var center = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
      + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
      + Math.sin(3 * m) * 0.000289
    var omega = radians(125.04 - 1934.136 * t)
    var sunLongitude = radians(l0 + center - 0.00569 - 0.00478 * Math.sin(omega))
    var obliquity = radians(23
      + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
      + 0.00256 * Math.cos(omega))
    var declination = Math.asin(Math.sin(obliquity) * Math.sin(sunLongitude))
    var y = Math.pow(Math.tan(obliquity / 2), 2)
    var l0r = radians(l0)
    var equationOfTime = 4 * degrees(
      y * Math.sin(2 * l0r)
      - 2 * e * Math.sin(m)
      + 4 * e * y * Math.sin(m) * Math.cos(2 * l0r)
      - 0.5 * y * y * Math.sin(4 * l0r)
      - 1.25 * e * e * Math.sin(2 * m))
    var lat = radians(latitude)
    var cosHourAngle = (Math.cos(radians(target)) - Math.sin(lat) * Math.sin(declination))
      / (Math.cos(lat) * Math.cos(declination))
    if (zenith !== undefined && Math.abs(cosHourAngle) > 1) return NaN
    var hourAngle = degrees(Math.acos(Math.max(-1, Math.min(1, cosHourAngle))))
    var noon = 720 - 4 * longitude - equationOfTime
    minutes = rising ? noon - 4 * hourAngle : noon + 4 * hourAngle
  }
  return minutes
}

function sunTimes(nowMs, latitude, longitude) {
  var now = new Date(nowMs)
  var year = now.getFullYear()
  var month = now.getMonth()
  var day = now.getDate()
  var midnight = Date.UTC(year, month, day)
  return {
    sunrise: midnight + sunMinutesUtc(year, month, day, latitude, longitude, true) * 60000,
    sunset: midnight + sunMinutesUtc(year, month, day, latitude, longitude, false) * 60000
  }
}

// Civil dawn and dusk on the local day of nowMs: the sun 6 degrees below the
// horizon. NaN where it never gets that low (summer, far north).
function twilightTimes(nowMs, latitude, longitude) {
  var now = new Date(nowMs)
  var year = now.getFullYear()
  var month = now.getMonth()
  var day = now.getDate()
  var midnight = Date.UTC(year, month, day)
  return {
    dawn: midnight + sunMinutesUtc(year, month, day, latitude, longitude, true, CIVIL_ZENITH) * 60000,
    dusk: midnight + sunMinutesUtc(year, month, day, latitude, longitude, false, CIVIL_ZENITH) * 60000
  }
}

// Whether Sun mode's fades follow twilight.
function followsTwilight(settings, location) {
  return settings.twilight === true && settings.mode === "sun" && !!location
}

// How long the warm-up of the night starting at nightStart lasts: until civil
// dusk when following twilight (so, with Start before sunset, the offset plus
// twilight), otherwise fadeIn. Falls back to fadeIn when there's no dusk, or
// the night starts after it.
function fadeInMs(settings, location, nightStart) {
  if (followsTwilight(settings, location)) {
    // The dusk of the evening the night belongs to: a night starting after
    // midnight (Start after a late sunset) belongs to the day before, not to
    // the coming evening's dusk 20 hours away.
    var dusk = twilightTimes(nightStart - 12 * 3600000, location.latitude, location.longitude).dusk
    if (Number.isFinite(dusk) && dusk > nightStart) return dusk - nightStart
  }
  return settings.fadeIn * MINUTE_MS
}

// How long the clear-down before the night ends at nightEnd (sunrise) lasts:
// from civil dawn when following twilight, otherwise fadeOut.
function fadeOutMs(settings, location, nightEnd) {
  if (followsTwilight(settings, location)) {
    var dawn = twilightTimes(nightEnd, location.latitude, location.longitude).dawn
    if (Number.isFinite(dawn) && dawn < nightEnd) return nightEnd - dawn
  }
  return settings.fadeOut * MINUTE_MS
}

// The fades of the night under way, or of the next one, for the panel.
function fadeLengths(settings, location, nowMs) {
  if (noSchedule(settings, location)) return { inMs: settings.fadeIn * MINUTE_MS, outMs: settings.fadeOut * MINUTE_MS }
  var schedule = scheduleAt(settings, location, nowMs)
  var start = schedule.on ? scheduleStart(settings, location, nowMs) : schedule.next
  var end = schedule.on ? schedule.next : scheduleAt(settings, location, schedule.next).next
  return { inMs: fadeInMs(settings, location, start), outMs: fadeOutMs(settings, location, end) }
}

function localAt(nowMs, dayOffset, minutes) {
  var now = new Date(nowMs)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset,
    Math.floor(minutes / 60), minutes % 60).getTime()
}

// When Sun mode turns on, on the day of `sun`: sunsetOffset minutes before
// sunset (after it, when negative), and never before that day's sunrise.
function sunOn(settings, sun) {
  return Math.max(sun.sunrise, sun.sunset - settings.sunsetOffset * MINUTE_MS)
}

// What the schedule alone says now, and when it next changes its mind.
function scheduleAt(settings, location, nowMs) {
  if (settings.mode === "sun") {
    var today = sunTimes(nowMs, location.latitude, location.longitude)
    var on = sunOn(settings, today)
    if (nowMs < today.sunrise) return { on: true, next: today.sunrise }
    if (nowMs < on) return { on: false, next: on }
    var tomorrow = sunTimes(localAt(nowMs, 1, 720), location.latitude, location.longitude)
    return { on: true, next: tomorrow.sunrise }
  }

  var onMinutes = parseTime(settings.onTime)
  var offMinutes = parseTime(settings.offTime)
  if (onMinutes === offMinutes) return { on: false, next: nowMs + DAY_MS }

  var now = new Date(nowMs)
  var minute = now.getHours() * 60 + now.getMinutes()
  var on = onMinutes < offMinutes
    ? minute >= onMinutes && minute < offMinutes
    : minute >= onMinutes || minute < offMinutes
  var target = on ? offMinutes : onMinutes
  var next = localAt(nowMs, target > minute ? 0 : 1, target)
  return { on: on, next: next }
}

// When the schedule most recently turned on. Only meaningful while it says on.
function scheduleStart(settings, location, nowMs) {
  if (settings.mode === "sun") {
    var today = sunTimes(nowMs, location.latitude, location.longitude)
    var on = sunOn(settings, today)
    if (nowMs >= on) return on
    return sunOn(settings, sunTimes(localAt(nowMs, -1, 720), location.latitude, location.longitude))
  }
  var onMinutes = parseTime(settings.onTime)
  var now = new Date(nowMs)
  var minute = now.getHours() * 60 + now.getMinutes()
  return localAt(nowMs, minute >= onMinutes ? 0 : -1, onMinutes)
}

// Always mode has no schedule, and nor does Sun mode with nowhere to take the
// sun from: either is warm whenever Locus is on.
function noSchedule(settings, location) {
  return settings.mode === "always" || (settings.mode === "sun" && !location)
}

// Whether the screen should be warm now, and until when (0: nothing will
// change it). A hold comes first, even while Locus is off ("warm for an hour"
// then back to off). Then Locus off is off, Always is warm, and Sun and
// Custom follow their schedule. Turning Locus on or off clears any hold.
function desiredState(settings, location, nowMs) {
  var override = settings.override
  if (override && nowMs < override.until) return { on: override.on, until: override.until }
  if (!settings.enabled) return { on: false, until: 0 }
  if (noSchedule(settings, location)) return { on: true, until: 0 }
  var schedule = scheduleAt(settings, location, nowMs)
  return { on: schedule.on, until: schedule.next }
}

// A step between two temperatures, even to the eye rather than even in Kelvin, so
// the change doesn't bunch up at the warm end. Rounded to 10K, which is under a
// mired from 2500K up, and to 1K below that, where 10K grows to 10 mireds at
// 1000K and fades would step visibly. Never exactly FRESH_TEMP, which is how a
// restarted hyprsunset is recognized.
var FINE_ROUNDING_BELOW = 2500
function mixKelvin(from, to, progress) {
  if (progress <= 0) return from
  if (progress >= 1) return to
  return roundKelvin(exactMix(from, to, progress))
}

function exactMix(from, to, progress) {
  var share = Math.max(0, Math.min(1, progress))
  return 1000000 / (1000000 / from + share * (1000000 / to - 1000000 / from))
}

function roundKelvin(kelvin) {
  var unit = kelvin < FINE_ROUNDING_BELOW ? 1 : 10
  var rounded = Math.round(kelvin / unit) * unit
  return rounded === FRESH_TEMP ? rounded + 10 : rounded
}

// A whole number of Kelvin (a saved temperature, or a fade's end) goes out as it
// is; anything in between is rounded as mixKelvin rounds it.
function sendableKelvin(kelvin) {
  return Number.isInteger(kelvin) && kelvin !== FRESH_TEMP ? kelvin : roundKelvin(kelvin)
}

function movieKelvin(settings, nowMs) {
  var override = settings.override
  if (override && nowMs < override.until && override.on && Number.isFinite(override.temperature)) return override.temperature
  return null
}

// The night under way, if the schedule (and no hold off) has the night light on:
// its start and end, and the evening it belongs to, for placing clock times
// like bedtime in it. Null otherwise, and in Manual mode.
function nightAt(settings, location, nowMs) {
  if (!settings.enabled || noSchedule(settings, location)) return null
  if (!desiredState(settings, location, nowMs).on) return null
  var schedule = scheduleAt(settings, location, nowMs)
  if (!schedule.on) return null
  var start = scheduleStart(settings, location, nowMs)
  return { start: start, end: schedule.next, evening: start - 12 * 3600000 }
}

// A clock time (minutes after midnight) placed in the night under way: its
// first time inside the night, so 00:30 belongs to the night that started the
// evening before and 03:30 to a 17-hour winter night that started at 15:10;
// otherwise its last time before the night started, if that was within 12
// hours (it has already passed, so it covers the whole night); otherwise null
// (it falls in the day, after the night ends).
function clockInNight(night, minute) {
  var next = nextClock(night.start - 1, minute)
  if (next < night.end) return next
  var previous = localAt(next, -1, minute)
  return night.start - previous <= 12 * 3600000 ? previous : null
}

// Bedtime in the night under way: when its fade starts and how long it takes
// (0 for at once, as with Gradual off). The time is placed in the night by
// clockInNight; one already past when the night starts covers the whole night.
// Nights starting on a Friday or Saturday evening move it weekendDelay minutes
// later. Null when there's none: bedtime off, no schedule, the night light
// held off, or bedtime falling after the night ends.
function bedtimeAt(settings, location, nowMs) {
  if (!settings.bedtime) return null
  var night = nightAt(settings, location, nowMs)
  if (!night) return null
  var at = clockInNight(night, parseTime(settings.bedtimeAt))
  if (at === null) return null
  var weekday = new Date(night.evening).getDay()
  if (weekday === 5 || weekday === 6) at += settings.weekendDelay * MINUTE_MS
  if (at >= night.end) return null
  if (at <= night.start) return { start: night.start, lengthMs: 0 }
  return { start: at, lengthMs: settings.ramp ? settings.fadeIn * MINUTE_MS : 0 }
}

// Dimming in the night under way: when it starts easing in (at dimFrom, placed
// in the night like bedtime, or the night's start if that's later) and over how
// long (0 with Gradual off). Null when there's none, including in Movie mode.
function dimAt(settings, location, nowMs) {
  if (!settings.dim || movieKelvin(settings, nowMs) !== null) return null
  var night = nightAt(settings, location, nowMs)
  if (!night) return null
  var at = clockInNight(night, parseTime(settings.dimFrom))
  if (at === null) return null
  return { start: Math.max(at, night.start), easeMs: settings.ramp ? DIM_EASE_MS : 0 }
}

// How much of the night's tint the morning's clear-down has left: 1 before it,
// falling to 0 as the night ends. Worked out on its own rather than from
// rampAt, which on a short night switches from the warm-up to the clear-down
// halfway and would make dimming jump. 1 when there's no clear-down.
function clearDownShare(settings, location, nowMs) {
  if (!settings.ramp || noSchedule(settings, location)) return 1
  if (settings.override && nowMs < settings.override.until) return 1
  var schedule = scheduleAt(settings, location, nowMs)
  if (!schedule.on) return 1
  var outMs = fadeOutMs(settings, location, schedule.next)
  if (!(outMs > 0)) return 1
  return Math.max(0, Math.min(1, (schedule.next - nowMs) / outMs))
}

// How far below full brightness dimming is now, in percent, unrounded: easing
// in from its start, and back out with the morning's clear-down.
function dimDepth(settings, location, nowMs) {
  var dim = dimAt(settings, location, nowMs)
  if (!dim || nowMs < dim.start) return 0
  var depth = (FULL_GAMMA - settings.dimPercent) * (dim.easeMs > 0 ? Math.min(1, (nowMs - dim.start) / dim.easeMs) : 1)
  return depth * clearDownShare(settings, location, nowMs)
}

// The gamma hyprsunset should have now, a whole percent. Full brightness
// unless dimming is on and under way; a paused app gets full brightness too.
function gammaAt(settings, location, nowMs, paused) {
  if (paused === true) return FULL_GAMMA
  return Math.round(FULL_GAMMA - dimDepth(settings, location, nowMs))
}

// How long dimming takes to move a whole percent while it's easing in or out,
// never under MIN_STEP_MS. Null while it holds still.
function gammaStepMs(settings, location, nowMs) {
  var dim = dimAt(settings, location, nowMs)
  if (!dim || nowMs < dim.start) return null
  var full = FULL_GAMMA - settings.dimPercent
  if (full <= 0) return null
  var lengths = []
  if (dim.easeMs > 0 && nowMs < dim.start + dim.easeMs) lengths.push(dim.easeMs)
  if (clearDownShare(settings, location, nowMs) < 1) {
    var schedule = scheduleAt(settings, location, nowMs)
    lengths.push(fadeOutMs(settings, location, schedule.next))
  }
  if (lengths.length === 0) return null
  // Easing in and clearing down at once (a short night) adds the two rates.
  var rate = 0
  for (var i = 0; i < lengths.length; i++) rate += full / lengths[i]
  return Math.max(MIN_STEP_MS, 1 / rate)
}

// Whether bedtime has come (its fade may still be under way).
function bedtimeReached(settings, location, nowMs) {
  var bed = bedtimeAt(settings, location, nowMs)
  return bed !== null && nowMs >= bed.start
}

// The temperature the night light is heading for now, before any warm-up or
// clear-down: a hold's own (Movie mode), otherwise the saved one, moving to
// the bedtime one from bedtime. Not rounded during bedtime's fade, so a warm-up
// or clear-down mixed with it is rounded once, not twice (twice let steps
// reach 6 mireds).
function exactTargetKelvin(settings, location, nowMs) {
  var movie = movieKelvin(settings, nowMs)
  if (movie !== null) return movie
  var bed = bedtimeAt(settings, location, nowMs)
  if (!bed || nowMs < bed.start) return settings.temperature
  if (bed.lengthMs <= 0 || nowMs >= bed.start + bed.lengthMs) return settings.bedtimeTemperature
  return exactMix(settings.temperature, settings.bedtimeTemperature, (nowMs - bed.start) / bed.lengthMs)
}

function targetKelvin(settings, location, nowMs) {
  return sendableKelvin(exactTargetKelvin(settings, location, nowMs))
}

// Where the night settles once any fade in progress ends: what a fade lands
// on, which is always sent (isVisibleStep).
function restingKelvin(settings, location, nowMs) {
  var movie = movieKelvin(settings, nowMs)
  if (movie !== null) return movie
  return bedtimeReached(settings, location, nowMs) ? settings.bedtimeTemperature : settings.temperature
}

// The temperature the screen should be at now, including any ramp in progress.
// Worked out from the clock alone, so a restart or suspend lands in the right place.
// A paused app in front keeps the screen neutral whatever the schedule says.
function kelvinAt(settings, location, nowMs, paused) {
  if (paused === true || !desiredState(settings, location, nowMs).on) return OFF_TEMP
  var target = exactTargetKelvin(settings, location, nowMs)
  var ramp = rampAt(settings, location, nowMs)
  if (!ramp || ramp.progress >= 1) return sendableKelvin(target)
  if (ramp.progress <= 0) return OFF_TEMP
  return roundKelvin(exactMix(OFF_TEMP, target, ramp.progress))
}

// The fade the schedule is in now: how far it is from the daytime value (0) to
// the temperature (1), how long it lasts in all and how long it has left, and
// whether it's the warm-up. The warm-up's progress rises and the clear-down's
// falls. The two can overlap on a short night; the one nearer the daytime value
// wins. Null outside a fade.
function rampAt(settings, location, nowMs) {
  if (!settings.ramp || noSchedule(settings, location)) return null
  if (settings.override && nowMs < settings.override.until) return null
  if (!desiredState(settings, location, nowMs).on) return null
  var ramp = null
  var nightEnd = scheduleAt(settings, location, nowMs).next
  var outMs = fadeOutMs(settings, location, nightEnd)
  if (outMs > 0) {
    var outProgress = (nightEnd - nowMs) / outMs
    // The clear-down's first instant counts, so the step after it gets scheduled.
    if (outProgress <= 1)
      ramp = { progress: Math.max(0, outProgress), lengthMs: outMs, remainingMs: Math.max(0, outProgress) * outMs, warming: false }
  }
  var nightStart = scheduleStart(settings, location, nowMs)
  var inMs = fadeInMs(settings, location, nightStart)
  if (inMs > 0 && nowMs >= settings.rampSkipUntil) {
    var inProgress = (nowMs - nightStart) / inMs
    if (inProgress < 1 && (!ramp || inProgress < ramp.progress))
      ramp = { progress: Math.max(0, inProgress), lengthMs: inMs, remainingMs: (1 - Math.max(0, inProgress)) * inMs, warming: true }
  }
  return ramp
}

// A hold that was keeping the night light on has ended while the schedule says
// on. Skip that evening's warm-up, or the screen would clear and start again.
// A warm hold ending in the day leaves the evening's warm-up alone. (Without a
// location, as in older callers, it skips it either way.)
function holdEndPatch(override, settings, location) {
  var patch = { override: null }
  if (!override || !override.on) return patch
  var scheduled = settings && location !== undefined && !noSchedule(settings, location)
  if (scheduled && !scheduleAt(settings, location, override.until).on) return patch
  var warmUp = settings && Number.isFinite(settings.fadeIn) ? settings.fadeIn * MINUTE_MS : RAMP_IN_MS
  if (scheduled) warmUp = fadeInMs(settings, location, scheduleStart(settings, location, override.until))
  patch.rampSkipUntil = override.until + warmUp
  return patch
}

function mireds(kelvin) {
  return 1000000 / kelvin
}

// Whether moving the screen from `from` to `to` is worth telling hyprsunset:
// always for the first value and for the end of a fade (the temperature itself,
// or off); otherwise only a change of at least MIN_SEND_MIREDS.
function isVisibleStep(from, to, target) {
  if (from === null || from === undefined) return true
  if (from === to) return false
  if (to === target || to === OFF_TEMP) return true
  return Math.abs(mireds(from) - mireds(to)) >= MIN_SEND_MIREDS
}

// A change too big to be a fade's next step, which looks better faded over a
// couple of seconds than snapped to.
function isBigJump(from, to) {
  if (from === null || from === undefined || to === null || to === undefined) return false
  return Math.abs(mireds(from) - mireds(to)) > 4 * STEP_MIREDS
}

// How long the fades in progress take to move STEP_MIREDS between them (a
// warm-up or clear-down, and bedtime's, which can overlap), never under
// MIN_STEP_MS and never past the shorter fade's length. Null outside a fade.
function fadeStepMs(settings, location, nowMs) {
  var ramp = rampAt(settings, location, nowMs)
  var bed = bedtimeAt(settings, location, nowMs)
  var bedFading = bed !== null && bed.lengthMs > 0 && nowMs >= bed.start && nowMs < bed.start + bed.lengthMs
  if (!ramp && !bedFading) return null
  var rate = 0 // Mireds per millisecond, at most
  var longest = Infinity
  if (ramp) {
    rate += Math.abs(mireds(OFF_TEMP) - mireds(exactTargetKelvin(settings, location, nowMs))) / ramp.lengthMs
    longest = ramp.lengthMs
  }
  if (bedFading) {
    rate += Math.abs(mireds(settings.temperature) - mireds(settings.bedtimeTemperature)) / bed.lengthMs
    longest = Math.min(longest, bed.lengthMs)
  }
  var step = rate > 0 ? Math.min(STEP_MIREDS / rate, longest) : longest
  return Math.max(MIN_STEP_MS, step)
}

// The next time `minute` (minutes after local midnight) comes round after nowMs.
function nextClock(nowMs, minute) {
  var today = localAt(nowMs, 0, minute)
  return today > nowMs ? today : localAt(nowMs, 1, minute)
}

// The next moment the screen should change by itself, so the service can sleep
// until then instead of checking all the time: a scheduled switch, the start of
// the clear-down, bedtime, dimming, the next visible fade step or the end of the fade, a
// hold ending, or just after one of hyprsunset.conf's own switch times. Null
// when nothing is due.
function nextDueAt(settings, location, nowMs, profileMinutes) {
  var due = []
  if (settings.enabled && !noSchedule(settings, location)) {
    var schedule = scheduleAt(settings, location, nowMs)
    due.push(schedule.next)
    if (schedule.on && settings.ramp) {
      var outMs = fadeOutMs(settings, location, schedule.next)
      if (outMs > 0) due.push(schedule.next - outMs)
    }
  }
  if (settings.override) due.push(settings.override.until)
  if (settings.rampSkipUntil) due.push(settings.rampSkipUntil)
  var stepMs = fadeStepMs(settings, location, nowMs)
  if (stepMs !== null) due.push(nowMs + stepMs)
  var ramp = rampAt(settings, location, nowMs)
  if (ramp) due.push(nowMs + ramp.remainingMs)
  var bed = bedtimeAt(settings, location, nowMs)
  if (bed) {
    due.push(bed.start)
    due.push(bed.start + bed.lengthMs)
  }
  var dim = dimAt(settings, location, nowMs)
  if (dim) {
    due.push(dim.start)
    due.push(dim.start + dim.easeMs)
    var gammaStep = gammaStepMs(settings, location, nowMs)
    if (gammaStep !== null) due.push(nowMs + gammaStep)
  }
  var minutes = Array.isArray(profileMinutes) ? profileMinutes : []
  var lastRecheck = PROFILE_RECHECK_MS[PROFILE_RECHECK_MS.length - 1]
  for (var i = 0; i < minutes.length; i++) {
    // The switch coming up, and one that has just passed but whose rechecks haven't.
    var times = [nextClock(nowMs - lastRecheck, minutes[i]), nextClock(nowMs, minutes[i])]
    for (var t = 0; t < times.length; t++)
      for (var r = 0; r < PROFILE_RECHECK_MS.length; r++) due.push(times[t] + PROFILE_RECHECK_MS[r])
  }
  var next = null
  for (var k = 0; k < due.length; k++)
    if (due[k] > nowMs && (next === null || due[k] < next)) next = due[k]
  return next
}

// hyprsunset.conf's own profiles: the minute of the day each one switches at, and
// the temperature hyprsunset reports afterwards. An identity profile, or one
// without a temperature, reports hyprsunset's default, FRESH_TEMP. Comments are
// ignored, so Omarchy's commented-out example doesn't count.
function hyprsunsetProfiles(text) {
  var minutes = []
  var values = []
  var lines = String(text === undefined || text === null ? "" : text).slice(0, 65536).split("\n")
  var inside = false
  var time = null
  var temperature = null
  var identity = false
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/#.*/, "")
    if (/^\s*profile\s*\{/.test(line)) {
      inside = true
      time = null
      temperature = null
      identity = false
      line = line.replace(/^\s*profile\s*\{/, "")
    }
    if (!inside) continue
    var clock = /\btime\s*=\s*(\d{1,2}:\d{2})/.exec(line)
    if (clock) time = parseTime(clock[1])
    var kelvin = /\btemperature\s*=\s*(\d{3,5})\b/.exec(line)
    if (kelvin) temperature = Number(kelvin[1])
    if (/\bidentity\s*=\s*true\b/.test(line)) identity = true
    if (line.indexOf("}") !== -1) {
      if (time !== null) {
        minutes.push(time)
        values.push(identity || temperature === null ? FRESH_TEMP : temperature)
      }
      inside = false
    }
  }
  return { minutes: minutes, values: values }
}

// Whether one of hyprsunset.conf's switch times fell between two looks.
// hyprsunset can carry out a switch up to a minute late, so one scheduled just
// before the earlier look still counts.
function profileSwitchBetween(minutes, fromMs, toMs) {
  if (!(fromMs > 0) || !(toMs >= fromMs) || toMs - fromMs > DAY_MS) return false
  var list = Array.isArray(minutes) ? minutes : []
  for (var i = 0; i < list.length; i++)
    if (nextClock(fromMs - MINUTE_MS - 1, list[i]) <= toMs) return true
  return false
}

function isProfileValue(reading, values) {
  return Array.isArray(values) && values.indexOf(reading) !== -1
}

// Whether the schedule alone (no holds, no pausing) says on, or null when there
// is none: Locus off, Always mode, or Sun mode with no location.
function scheduleOn(settings, location, nowMs) {
  if (!settings.enabled || noSchedule(settings, location)) return null
  return scheduleAt(settings, location, nowMs).on
}

// The command to run for a change in the schedule seen between two checks:
// onCommand as it turns on, offCommand as it turns off, "" otherwise. Nothing
// runs for the first look (null), so a shell restart doesn't run either.
function scheduleCommand(settings, previous, current) {
  if (previous === null || previous === undefined || current === null || previous === current) return ""
  return current ? settings.onCommand : settings.offCommand
}

// Locus on or off (the panel's switch, right-click on the icon). Either way
// any hold ends: on follows the mode again, off stays off until turned on.
function enablePatch(on) {
  return { enabled: on === true, override: null }
}

// The next moment the screen will actually warm or clear by itself, or 0 when
// nothing will change it: the end of a hold only if the screen changes then
// (an "off till morning" hold ends in daylight, so the next change is sunset).
function nextChange(settings, location, nowMs) {
  var state = desiredState(settings, location, nowMs)
  var at = state.until
  for (var i = 0; i < 4 && at > nowMs; i++) {
    var then = desiredState(settings, location, at)
    if (then.on !== state.on) return at
    if (!(then.until > at)) return 0
    at = then.until
  }
  return 0
}

// What the panel's status line and the icon's tooltip say: Movie mode and its
// end; warm until the next change (or just warm); off with when it warms
// next; or plain off, when nothing will turn it on.
function statusAt(settings, location, nowMs) {
  if (movieKelvin(settings, nowMs) !== null) return { kind: "movieUntil", at: settings.override.until }
  var on = desiredState(settings, location, nowMs).on
  var at = nextChange(settings, location, nowMs)
  if (on) return { kind: at ? "warmUntil" : "warm", at: at }
  return { kind: at ? "warmsAt" : "off", at: at }
}

// A hold chosen from the panel or the command line: "off" or "on" for a number
// of minutes (1 to 12 hours), "movie" (milder, MOVIE_TEMP, for MOVIE_MINUTES
// unless given a length), "morning" (off until the night ends; in the day, that
// skips tonight), or "clear" (back to the schedule). Null when it doesn't apply:
// "morning" needs a schedule (and Locus on), and an unknown kind or length.
function holdPatch(settings, location, nowMs, kind, minutes) {
  if (kind === "clear") return { override: null }
  if (kind === "movie") {
    var movieMinutes = Number(minutes) > 0 ? clampInt(minutes, 1, MAX_HOLD_MINUTES) : MOVIE_MINUTES
    return { override: { on: true, until: nowMs + movieMinutes * MINUTE_MS, temperature: MOVIE_TEMP } }
  }
  if (kind === "morning") {
    if (!settings.enabled || noSchedule(settings, location)) return null
    var schedule = scheduleAt(settings, location, nowMs)
    var end = schedule.on ? schedule.next : scheduleAt(settings, location, schedule.next).next
    return { override: { on: false, until: end } }
  }
  if (kind !== "on" && kind !== "off") return null
  if (!Number.isFinite(Number(minutes)) || Number(minutes) <= 0) return null
  var length = clampInt(minutes, 1, MAX_HOLD_MINUTES)
  return { override: { on: kind === "on", until: nowMs + length * MINUTE_MS } }
}

// Choosing a temperature: during Movie mode it changes the hold's own
// temperature, for the rest of the hold, and saves nothing (a tweak for one
// film shouldn't change tomorrow night). Otherwise it saves the temperature
// showing: the bedtime one once bedtime has come, else the evening one.
function temperaturePatch(settings, location, kelvin, nowMs) {
  var clamped = clampTemp(kelvin)
  if (movieKelvin(settings, nowMs) !== null)
    return { override: { on: true, until: settings.override.until, temperature: clamped } }
  var patch = {}
  patch[bedtimeReached(settings, location, nowMs) ? "bedtimeTemperature" : "temperature"] = clamped
  return patch
}

// The temperature the slider, presets and steps start from: Movie mode's own
// while it lasts, the bedtime one once bedtime has come, else the saved one.
function shownTemperature(settings, location, nowMs) {
  var movie = movieKelvin(settings, nowMs)
  if (movie !== null) return movie
  return bedtimeReached(settings, location, nowMs) ? settings.bedtimeTemperature : settings.temperature
}

// A preset's temperature by name, or null.
function presetKelvin(name) {
  for (var i = 0; i < PRESETS.length; i++)
    if (PRESETS[i].name === name) return PRESETS[i].kelvin
  return null
}

// The preset a temperature matches, or "".
function presetName(kelvin) {
  for (var i = 0; i < PRESETS.length; i++)
    if (PRESETS[i].kelvin === kelvin) return PRESETS[i].name
  return ""
}

// The colour white takes on at a temperature, for drawing: Tanner Helland's
// fit to the blackbody curve, as 0 to 1 channels. Below 1000K, where the
// shader takes green away, green fades to none at MIN_TEMP.
function kelvinColor(kelvin) {
  var k = Math.max(MIN_TEMP, Math.min(40000, Number(kelvin)))
  var t = Math.max(HYPRSUNSET_MIN, k) / 100
  var r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  var g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  var b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307)
  if (k < HYPRSUNSET_MIN) g *= (k - MIN_TEMP) / (HYPRSUNSET_MIN - MIN_TEMP)
  var channel = function(value) { return Math.max(0, Math.min(255, value)) / 255 }
  return { r: channel(r), g: channel(g), b: channel(b) }
}

// How strongly the 24-hour view shows a temperature, from 0 (off) to 1 (the
// night's own temperature, or warmer), so a fade shows as a tint growing
// evenly to the eye.
function viewStrength(kelvin, nightKelvin) {
  var span = mireds(nightKelvin) - mireds(OFF_TEMP)
  if (!(span > 0)) return kelvin === OFF_TEMP ? 0 : 1
  return Math.max(0, Math.min(1, (mireds(kelvin) - mireds(OFF_TEMP)) / span))
}

// How the view paints one sample, as 0 to 1 channels and alpha: in the
// night's colour (nightKelvin, the saved temperature) or a warmer one
// (bedtime), as opaque as the tint is strong, darker by any dimming. A fade
// keeps the night's colour and only grows stronger: drawing its milder
// temperatures in their own, lighter colours made a bright seam at each end.
function viewPaint(sample, nightKelvin) {
  var colour = kelvinColor(Math.min(sample.kelvin, nightKelvin))
  var light = Math.max(0, Math.min(FULL_GAMMA, sample.gamma)) / FULL_GAMMA
  return { r: colour.r * light, g: colour.g * light, b: colour.b * light, a: viewStrength(sample.kelvin, nightKelvin) }
}

// Where the 24-hour view starts: the most recent local noon, so the night sits
// in the middle.
function viewStart(nowMs) {
  var noon = localAt(nowMs, 0, 720)
  return noon <= nowMs ? noon : localAt(nowMs, -1, 720)
}

// The day as the panel draws it: `count` samples from fromMs, stepMs apart,
// each the temperature and gamma the schedule and any hold give then (an app's
// pause is momentary, so it isn't shown).
function daySamples(settings, location, fromMs, stepMs, count) {
  var out = []
  for (var i = 0; i < count; i++) {
    var t = fromMs + i * stepMs
    out.push({ kelvin: kelvinAt(settings, location, t, false), gamma: gammaAt(settings, location, t, false) })
  }
  return out
}

// Changing the mode ends any hold. "manual" is the old name for Always.
function modePatch(settings, mode) {
  return { mode: mode === "manual" ? "always" : mode, override: null, rampSkipUntil: 0 }
}

if (typeof module !== "undefined") {
  module.exports = {
    MIN_TEMP: MIN_TEMP,
    MAX_TEMP: MAX_TEMP,
    OFF_TEMP: OFF_TEMP,
    FRESH_TEMP: FRESH_TEMP,
    RAMP_IN_MS: RAMP_IN_MS,
    RAMP_OUT_MS: RAMP_OUT_MS,
    FADE_MS: FADE_MS,
    MAX_FADE_MINUTES: MAX_FADE_MINUTES,
    MIN_SUNSET_OFFSET: MIN_SUNSET_OFFSET,
    MAX_SUNSET_OFFSET: MAX_SUNSET_OFFSET,
    STEP_MIREDS: STEP_MIREDS,
    MIN_SEND_MIREDS: MIN_SEND_MIREDS,
    MIN_STEP_MS: MIN_STEP_MS,
    CHECK_MS: CHECK_MS,
    PAUSE_APPS_MAX: PAUSE_APPS_MAX,
    APP_NAME_MAX: APP_NAME_MAX,
    SETTING_KEYS: SETTING_KEYS,
    STATE_KEYS: STATE_KEYS,
    splitSettings: splitSettings,
    combineSettings: combineSettings,
    cleanAppName: cleanAppName,
    appList: appList,
    pausedFor: pausedFor,
    withPausedApp: withPausedApp,
    displayName: displayName,
    sunOn: sunOn,
    rampAt: rampAt,
    isVisibleStep: isVisibleStep,
    isBigJump: isBigJump,
    fadeStepMs: fadeStepMs,
    nextClock: nextClock,
    nextDueAt: nextDueAt,
    hyprsunsetProfiles: hyprsunsetProfiles,
    profileSwitchBetween: profileSwitchBetween,
    isProfileValue: isProfileValue,
    scheduleStart: scheduleStart,
    defaultSettings: defaultSettings,
    parseTime: parseTime,
    stepTime: stepTime,
    clampTemp: clampTemp,
    hyprsunsetKelvin: hyprsunsetKelvin,
    extraWarmStep: extraWarmStep,
    normalizeSettings: normalizeSettings,
    parseCoordinates: parseCoordinates,
    locationRequest: locationRequest,
    geocodeResult: geocodeResult,
    weatherLocation: weatherLocation,
    zoneName: zoneName,
    zoneCoordinates: zoneCoordinates,
    movedFar: movedFar,
    resolveLocation: resolveLocation,
    sunTimes: sunTimes,
    twilightTimes: twilightTimes,
    fadeLengths: fadeLengths,
    scheduleAt: scheduleAt,
    desiredState: desiredState,
    mixKelvin: mixKelvin,
    kelvinAt: kelvinAt,
    holdEndPatch: holdEndPatch,
    enablePatch: enablePatch,
    nextChange: nextChange,
    statusAt: statusAt,
    modePatch: modePatch,
    holdPatch: holdPatch,
    scheduleOn: scheduleOn,
    scheduleCommand: scheduleCommand,
    targetKelvin: targetKelvin,
    kelvinColor: kelvinColor,
    viewStrength: viewStrength,
    viewPaint: viewPaint,
    viewStart: viewStart,
    daySamples: daySamples,
    restingKelvin: restingKelvin,
    bedtimeAt: bedtimeAt,
    bedtimeReached: bedtimeReached,
    MAX_WEEKEND_DELAY: MAX_WEEKEND_DELAY,
    FULL_GAMMA: FULL_GAMMA,
    MIN_DIM_PERCENT: MIN_DIM_PERCENT,
    dimAt: dimAt,
    gammaAt: gammaAt,
    gammaStepMs: gammaStepMs,
    presetKelvin: presetKelvin,
    temperaturePatch: temperaturePatch,
    shownTemperature: shownTemperature,
    presetName: presetName,
    PRESETS: PRESETS,
    MOVIE_TEMP: MOVIE_TEMP,
    MOVIE_MINUTES: MOVIE_MINUTES,
    MAX_HOLD_MINUTES: MAX_HOLD_MINUTES
  }
}
