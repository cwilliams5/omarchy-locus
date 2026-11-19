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
var RAMP_IN_MS = 3600000 // Warming up, from the moment the schedule turns on
var RAMP_OUT_MS = 1800000 // Clearing, ending the moment the schedule turns off
var FADE_MS = 2000 // Flipping the switch
var MOVED_DEGREES = 0.05 // About 5 km, or a few seconds of sunset

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
    detected: null
  }
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

// What the schedule alone says now, and when it next changes its mind.
function scheduleAt(settings, location, nowMs) {
  if (settings.mode === "sun") {
    var today = sunTimes(nowMs, location.latitude, location.longitude)
    if (nowMs < today.sunrise) return { on: true, next: today.sunrise }
    if (nowMs < today.sunset) return { on: false, next: today.sunset }
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
    if (nowMs >= today.sunset) return today.sunset
    return sunTimes(localAt(nowMs, -1, 720), location.latitude, location.longitude).sunset
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
function kelvinAt(settings, location, nowMs) {
  if (!desiredState(settings, location, nowMs).on) return OFF_TEMP
  var target = settings.temperature
  if (!settings.ramp || followsSwitch(settings, location)) return target
  if (settings.override && nowMs < settings.override.until) return target

  var progress = (scheduleAt(settings, location, nowMs).next - nowMs) / RAMP_OUT_MS
  if (nowMs >= settings.rampSkipUntil)
    progress = Math.min(progress, (nowMs - scheduleStart(settings, location, nowMs)) / RAMP_IN_MS)
  return mixKelvin(OFF_TEMP, target, progress)
}

// A hold that was keeping the night light on has ended at the moment the schedule
// takes over. Skip that evening's warm-up, or the screen would clear and start again.
function holdEndPatch(override) {
  var patch = { override: null }
  if (override && override.on) patch.rampSkipUntil = override.until + RAMP_IN_MS
  return patch
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
