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
var MODES = ["manual", "sun", "custom"]
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
    manualOn: false,
    onTime: "21:00",
    offTime: "07:00",
    latitude: null,
    longitude: null,
    override: null,
    ramp: true,
    rampSkipUntil: 0,
    autoLocation: false,
    detected: null,
    sunsetOffset: 0,
    fadeIn: RAMP_IN_MS / MINUTE_MS,
    fadeOut: RAMP_OUT_MS / MINUTE_MS,
    pauseFullscreen: false,
    pauseApps: []
  }
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

// Bad or missing values fall back to the defaults, one field at a time.
function normalizeSettings(raw) {
  var result = defaultSettings()
  if (!raw || typeof raw !== "object") return result
  if (MODES.indexOf(raw.mode) !== -1) result.mode = raw.mode
  if (Number.isFinite(raw.temperature)) result.temperature = clampTemp(raw.temperature)
  if (typeof raw.manualOn === "boolean") result.manualOn = raw.manualOn
  if (parseTime(raw.onTime) !== null) result.onTime = formatTime(parseTime(raw.onTime))
  if (parseTime(raw.offTime) !== null) result.offTime = formatTime(parseTime(raw.offTime))
  if (isLatitude(raw.latitude) && isLongitude(raw.longitude)) {
    result.latitude = raw.latitude
    result.longitude = raw.longitude
  }
  var override = raw.override
  if (override && typeof override.on === "boolean" && Number.isFinite(override.until))
    result.override = { on: override.on, until: override.until }
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
    return { latitude: settings.latitude, longitude: settings.longitude, source: "custom", label: "" }
  if (settings.autoLocation && settings.detected)
    return { latitude: settings.detected.latitude, longitude: settings.detected.longitude, source: "detected", label: settings.detected.name }
  if (weather) return { latitude: weather.latitude, longitude: weather.longitude, source: "weather", label: weather.name }
  if (zone) return { latitude: zone.latitude, longitude: zone.longitude, source: "timezone", label: zone.zone }
  return null
}

function radians(degrees) { return degrees * Math.PI / 180 }
function degrees(value) { return value * 180 / Math.PI }

// NOAA solar equations: minutes after 00:00 UTC on the given date.
function sunMinutesUtc(year, month, day, latitude, longitude, rising) {
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
    var cosHourAngle = (Math.cos(radians(90.833)) - Math.sin(lat) * Math.sin(declination))
      / (Math.cos(lat) * Math.cos(declination))
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

// Sun mode with nowhere to take the sun from has no schedule, so the switch rules.
function followsSwitch(settings, location) {
  return settings.mode === "manual" || (settings.mode === "sun" && !location)
}

// What the screen should be doing now. `until` is 0 when nothing will change it.
function desiredState(settings, location, nowMs) {
  if (followsSwitch(settings, location)) return { on: settings.manualOn, until: 0 }
  var override = settings.override
  if (override && nowMs < override.until) return { on: override.on, until: override.until }
  var schedule = scheduleAt(settings, location, nowMs)
  return { on: schedule.on, until: schedule.next }
}

// A step between two temperatures, even to the eye rather than even in Kelvin, so
// the change doesn't bunch up at the warm end. Rounded to 10K, and never exactly
// FRESH_TEMP, which is how a restarted hyprsunset is recognized.
function mixKelvin(from, to, progress) {
  if (progress <= 0) return from
  if (progress >= 1) return to
  var kelvin = 1000000 / (1000000 / from + progress * (1000000 / to - 1000000 / from))
  var rounded = Math.round(kelvin / 10) * 10
  return rounded === FRESH_TEMP ? rounded + 10 : rounded
}

// The temperature the screen should be at now, including any ramp in progress.
// Worked out from the clock alone, so a restart or suspend lands in the right place.
// A paused app in front keeps the screen neutral whatever the schedule says.
function kelvinAt(settings, location, nowMs, paused) {
  if (paused === true || !desiredState(settings, location, nowMs).on) return OFF_TEMP
  var ramp = rampAt(settings, location, nowMs)
  return ramp ? mixKelvin(OFF_TEMP, settings.temperature, ramp.progress) : settings.temperature
}

// The fade the schedule is in now: how far it is from the daytime value (0) to
// the temperature (1), how long it lasts in all and how long it has left, and
// whether it's the warm-up. The warm-up's progress rises and the clear-down's
// falls. The two can overlap on a short night; the one nearer the daytime value
// wins. Null outside a fade.
function rampAt(settings, location, nowMs) {
  if (!settings.ramp || followsSwitch(settings, location)) return null
  if (settings.override && nowMs < settings.override.until) return null
  if (!desiredState(settings, location, nowMs).on) return null
  var ramp = null
  var outMs = settings.fadeOut * MINUTE_MS
  if (outMs > 0) {
    var outProgress = (scheduleAt(settings, location, nowMs).next - nowMs) / outMs
    // The clear-down's first instant counts, so the step after it gets scheduled.
    if (outProgress <= 1)
      ramp = { progress: Math.max(0, outProgress), lengthMs: outMs, remainingMs: Math.max(0, outProgress) * outMs, warming: false }
  }
  var inMs = settings.fadeIn * MINUTE_MS
  if (inMs > 0 && nowMs >= settings.rampSkipUntil) {
    var inProgress = (nowMs - scheduleStart(settings, location, nowMs)) / inMs
    if (inProgress < 1 && (!ramp || inProgress < ramp.progress))
      ramp = { progress: Math.max(0, inProgress), lengthMs: inMs, remainingMs: (1 - Math.max(0, inProgress)) * inMs, warming: true }
  }
  return ramp
}

// A hold that was keeping the night light on has ended at the moment the schedule
// takes over. Skip that evening's warm-up, or the screen would clear and start again.
function holdEndPatch(override, settings) {
  var patch = { override: null }
  var warmUp = settings && Number.isFinite(settings.fadeIn) ? settings.fadeIn * MINUTE_MS : RAMP_IN_MS
  if (override && override.on) patch.rampSkipUntil = override.until + warmUp
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

// How long the fade in progress takes to move STEP_MIREDS, never under
// MIN_STEP_MS. Null outside a fade.
function fadeStepMs(settings, location, nowMs) {
  var ramp = rampAt(settings, location, nowMs)
  if (!ramp) return null
  var span = Math.abs(mireds(OFF_TEMP) - mireds(settings.temperature))
  var step = span > STEP_MIREDS ? ramp.lengthMs * STEP_MIREDS / span : ramp.lengthMs
  return Math.max(MIN_STEP_MS, step)
}

// The next time `minute` (minutes after local midnight) comes round after nowMs.
function nextClock(nowMs, minute) {
  var today = localAt(nowMs, 0, minute)
  return today > nowMs ? today : localAt(nowMs, 1, minute)
}

// The next moment the screen should change by itself, so the service can sleep
// until then instead of checking all the time: a scheduled switch, the start of
// the clear-down, the next visible fade step or the end of the fade, a hold
// ending, or just after one of hyprsunset.conf's own switch times. Null when
// nothing is due.
function nextDueAt(settings, location, nowMs, profileMinutes) {
  var due = []
  if (!followsSwitch(settings, location)) {
    var schedule = scheduleAt(settings, location, nowMs)
    due.push(schedule.next)
    if (schedule.on && settings.ramp && settings.fadeOut > 0) due.push(schedule.next - settings.fadeOut * MINUTE_MS)
  }
  if (settings.override) due.push(settings.override.until)
  if (settings.rampSkipUntil) due.push(settings.rampSkipUntil)
  var ramp = rampAt(settings, location, nowMs)
  if (ramp) {
    due.push(nowMs + fadeStepMs(settings, location, nowMs))
    due.push(nowMs + ramp.remainingMs)
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

// The main switch. With a schedule, flipping away from it holds until the next
// scheduled change, and flipping back simply follows the schedule again.
function switchPatch(settings, location, nowMs, turnOn) {
  if (followsSwitch(settings, location)) return { manualOn: turnOn, override: null }
  var schedule = scheduleAt(settings, location, nowMs)
  if (turnOn === schedule.on) return { override: null }
  return { override: { on: turnOn, until: schedule.next } }
}

function modePatch(settings, mode, currentlyOn) {
  if (mode === "manual") return { mode: mode, manualOn: currentlyOn, override: null, rampSkipUntil: 0 }
  return { mode: mode, override: null, rampSkipUntil: 0 }
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
    weatherLocation: weatherLocation,
    zoneName: zoneName,
    zoneCoordinates: zoneCoordinates,
    movedFar: movedFar,
    resolveLocation: resolveLocation,
    sunTimes: sunTimes,
    scheduleAt: scheduleAt,
    desiredState: desiredState,
    mixKelvin: mixKelvin,
    kelvinAt: kelvinAt,
    holdEndPatch: holdEndPatch,
    switchPatch: switchPatch,
    modePatch: modePatch
  }
}
