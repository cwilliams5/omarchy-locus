// Run with: TZ=America/New_York node tests/model.test.js
// Pass SUN_FIXTURE=<json file> to also compare sun times with a reference list
// of { "date": "YYYY-MM-DD", "sunrise": ms, "sunset": ms } entries.
const assert = require("assert")
const fs = require("fs")
const path = require("path")
const Model = require(path.join(__dirname, "..", "Model.js"))

const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime()
const place = { latitude: 40.71, longitude: -74.01, source: "custom", label: "" } // New York, for TZ above
const settings = (patch) => Model.normalizeSettings(Object.assign(Model.defaultSettings(), patch))
const test = (name, run) => { run(); console.log("ok - " + name) }

test("sun schedule follows the day", () => {
  const s = settings({ mode: "sun" })
  const times = Model.sunTimes(at(2026, 11, 5, 12), place.latitude, place.longitude)
  const before = Model.scheduleAt(s, place, times.sunrise - 60000)
  assert.strictEqual(before.on, true)
  assert.strictEqual(before.next, times.sunrise)
  const day = Model.scheduleAt(s, place, times.sunrise + 60000)
  assert.strictEqual(day.on, false)
  assert.strictEqual(day.next, times.sunset)
  const night = Model.scheduleAt(s, place, times.sunset + 60000)
  assert.strictEqual(night.on, true)
  assert.ok(night.next > at(2026, 11, 6) && night.next < at(2026, 11, 6, 12), "next is tomorrow's sunrise")
})

test("custom hours across midnight", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 5, 20, 59)), { on: false, next: at(2026, 11, 5, 21) })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 5, 21)), { on: true, next: at(2026, 11, 6, 7) })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 6, 3)), { on: true, next: at(2026, 11, 6, 7) })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 6, 7)), { on: false, next: at(2026, 11, 6, 21) })
})

test("custom hours within a day", () => {
  const s = settings({ mode: "custom", onTime: "09:00", offTime: "17:00" })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 5, 8)), { on: false, next: at(2026, 11, 5, 9) })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 5, 12)), { on: true, next: at(2026, 11, 5, 17) })
  assert.deepStrictEqual(Model.scheduleAt(s, place, at(2026, 11, 5, 18)), { on: false, next: at(2026, 11, 6, 9) })
})

test("matching custom hours never turn on", () => {
  const s = settings({ mode: "custom", onTime: "09:00", offTime: "09:00" })
  const now = at(2026, 11, 5, 9)
  assert.strictEqual(Model.scheduleAt(s, place, now).on, false)
})

test("main switch during a schedule holds until the next change", () => {
  const now = at(2026, 11, 5, 22)
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  const offPatch = Model.switchPatch(s, place, now, false)
  assert.deepStrictEqual(offPatch.override, { on: false, until: at(2026, 11, 6, 7) })

  const held = settings(Object.assign({}, s, offPatch))
  assert.deepStrictEqual(Model.desiredState(held, place, now), { on: false, until: at(2026, 11, 6, 7) })

  // Flipping back returns to following the schedule.
  const backPatch = Model.switchPatch(held, place, now, true)
  assert.strictEqual(backPatch.override, null)

  // Once the hold ends, the schedule leads again, and it says off at 7:00.
  assert.strictEqual(Model.desiredState(held, place, at(2026, 11, 6, 7)).on, false)
  assert.strictEqual(Model.desiredState(held, place, at(2026, 11, 6, 21)).on, true)
})

test("turning on during the off hours holds until they end", () => {
  const now = at(2026, 11, 5, 10)
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  const patch = Model.switchPatch(s, place, now, true)
  assert.deepStrictEqual(patch.override, { on: true, until: at(2026, 11, 5, 21) })
  const held = settings(Object.assign({}, s, patch))
  // At 21:00 the hold ends and the schedule keeps it on, with no gap.
  assert.strictEqual(Model.desiredState(held, place, at(2026, 11, 5, 20, 59)).on, true)
  assert.strictEqual(Model.desiredState(held, place, at(2026, 11, 5, 21)).on, true)
})

test("manual mode has no end time and keeps the current state", () => {
  const s = settings({ mode: "sun" })
  const patch = Model.modePatch(s, "manual", true)
  const manual = settings(Object.assign({}, s, patch))
  assert.deepStrictEqual(Model.desiredState(manual, place, at(2026, 11, 5, 12)), { on: true, until: 0 })
  const off = settings(Object.assign({}, manual, Model.switchPatch(manual, place, at(2026, 11, 5, 12), false)))
  assert.deepStrictEqual(Model.desiredState(off, place, at(2026, 11, 5, 12)), { on: false, until: 0 })
})

test("changing modes drops any hold", () => {
  const s = settings({ mode: "sun", override: { on: true, until: at(2030, 1, 1) } })
  assert.strictEqual(Model.modePatch(s, "custom", true).override, null)
  assert.strictEqual(Model.modePatch(s, "manual", true).override, null)
})

test("bad settings fall back field by field", () => {
  const s = Model.normalizeSettings({ mode: "nope", temperature: 99999, onTime: "25:00", offTime: "6:30", latitude: 200, override: { on: "yes" } })
  const d = Model.defaultSettings()
  assert.strictEqual(s.mode, d.mode)
  assert.strictEqual(s.temperature, Model.MAX_TEMP)
  assert.strictEqual(s.onTime, d.onTime)
  assert.strictEqual(s.offTime, "06:30")
  assert.strictEqual(s.latitude, d.latitude)
  assert.strictEqual(s.override, null)
  assert.deepStrictEqual(Model.normalizeSettings("garbage"), d)
  assert.deepStrictEqual(Model.normalizeSettings(null), d)
})

test("half a location in the settings counts as none", () => {
  assert.strictEqual(settings({ latitude: 45 }).latitude, null)
  assert.strictEqual(settings({ latitude: 45, longitude: 500 }).latitude, null)
})

test("nothing ships with a location", () => {
  const d = Model.defaultSettings()
  assert.strictEqual(d.latitude, null)
  assert.strictEqual(d.longitude, null)
})

test("typed coordinates", () => {
  assert.deepStrictEqual(Model.parseCoordinates(" 52.52, 13.40 "), { latitude: 52.52, longitude: 13.4 })
  assert.deepStrictEqual(Model.parseCoordinates("-33.9 151.2"), { latitude: -33.9, longitude: 151.2 })
  assert.strictEqual(Model.parseCoordinates("91, 0"), null)
  assert.strictEqual(Model.parseCoordinates("Berlin"), null)
  assert.strictEqual(Model.parseCoordinates(""), null)
})

test("weather location needs coordinates", () => {
  assert.strictEqual(Model.weatherLocation('{"name":"Oslo"}'), null)
  assert.strictEqual(Model.weatherLocation("not json"), null)
  assert.strictEqual(Model.weatherLocation('{"latitude":500,"longitude":20}'), null)
  assert.deepStrictEqual(Model.weatherLocation('{"name":" Oslo ","latitude":"59.9","longitude":10.7}'), { latitude: 59.9, longitude: 10.7, name: "Oslo" })
})

test("time zone table gives coordinates", () => {
  const table = "#comment\nUS\t+404251-0740023\tAmerica/New_York\nAU\t-3352+15113\tAustralia/Sydney\n"
  const york = Model.zoneCoordinates(table, "America/New_York")
  assert.ok(Math.abs(york.latitude - 40.714) < 0.01 && Math.abs(york.longitude + 74.006) < 0.01)
  const sydney = Model.zoneCoordinates(table, "Australia/Sydney")
  assert.ok(Math.abs(sydney.latitude + 33.867) < 0.01 && Math.abs(sydney.longitude - 151.217) < 0.01)
  assert.strictEqual(Model.zoneCoordinates(table, "Mars/Base"), null)
  assert.strictEqual(Model.zoneCoordinates(table, ""), null)
  assert.strictEqual(Model.zoneName("/usr/share/zoneinfo/America/New_York\n"), "America/New_York")
  assert.strictEqual(Model.zoneName("/etc/localtime"), "")
})

test("the real time zone table parses every zone", () => {
  if (!fs.existsSync("/usr/share/zoneinfo/zone1970.tab")) return console.log("   skipped, no table")
  const table = fs.readFileSync("/usr/share/zoneinfo/zone1970.tab", "utf8")
  const zones = table.split("\n").filter((line) => line && line[0] !== "#").map((line) => line.split("\t")[2])
  assert.ok(zones.length > 100)
  for (const zone of zones) {
    const found = Model.zoneCoordinates(table, zone)
    assert.ok(found && Math.abs(found.latitude) <= 90 && Math.abs(found.longitude) <= 180, zone)
  }
})

test("location prefers your own, then weather, then time zone", () => {
  const zone = { latitude: 40, longitude: -74, zone: "America/New_York" }
  const weather = { latitude: 59.9, longitude: 10.7, name: "Oslo" }
  assert.strictEqual(Model.resolveLocation(settings({ latitude: 1, longitude: 2 }), weather, zone).source, "custom")
  assert.strictEqual(Model.resolveLocation(settings({}), weather, zone).source, "weather")
  assert.strictEqual(Model.resolveLocation(settings({}), null, zone).source, "timezone")
  assert.strictEqual(Model.resolveLocation(settings({}), null, null), null)
})

test("sun mode with no location follows the switch", () => {
  const now = at(2026, 11, 5, 22)
  const s = settings({ mode: "sun" })
  assert.deepStrictEqual(Model.desiredState(s, null, now), { on: false, until: 0 })
  const patch = Model.switchPatch(s, null, now, true)
  assert.deepStrictEqual(patch, { manualOn: true, override: null })
  assert.deepStrictEqual(Model.desiredState(settings(Object.assign({}, s, patch)), null, now), { on: true, until: 0 })
})

test("custom hours don't need a location", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  assert.strictEqual(Model.desiredState(s, null, at(2026, 11, 5, 22)).on, true)
})

test("time steps wrap around midnight", () => {
  assert.strictEqual(Model.stepTime("23:45", 15), "00:00")
  assert.strictEqual(Model.stepTime("00:00", -15), "23:45")
  assert.strictEqual(Model.stepTime("nonsense", 15), "nonsense")
})

test("daylight saving changes keep custom hours on the clock", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  // US clocks fall back on 2026-11-01 and spring forward on 2027-03-14.
  assert.strictEqual(Model.scheduleAt(s, place, at(2026, 10, 31, 22)).next, at(2026, 11, 1, 7))
  assert.strictEqual(Model.scheduleAt(s, place, at(2027, 3, 13, 22)).next, at(2027, 3, 14, 7))
})

const MIN = 60000

test("sun ramp warms for an hour from sunset", () => {
  const s = settings({ mode: "sun", temperature: 1000 })
  const set = Model.sunTimes(at(2026, 11, 5, 12), place.latitude, place.longitude).sunset
  assert.strictEqual(Model.kelvinAt(s, place, set - MIN), Model.OFF_TEMP)
  assert.strictEqual(Model.kelvinAt(s, place, set), Model.OFF_TEMP)
  let previous = Model.OFF_TEMP
  for (let minute = 1; minute < 60; minute++) {
    const kelvin = Model.kelvinAt(s, place, set + minute * MIN)
    assert.ok(kelvin <= previous && kelvin > 1000, "minute " + minute + ": " + kelvin)
    previous = kelvin
  }
  assert.strictEqual(Model.kelvinAt(s, place, set + 60 * MIN), 1000)
  assert.strictEqual(Model.kelvinAt(s, place, set + 120 * MIN), 1000)
})

test("sun ramp clears over the half hour before sunrise", () => {
  const s = settings({ mode: "sun", temperature: 1000 })
  const rise = Model.sunTimes(at(2026, 11, 6, 12), place.latitude, place.longitude).sunrise
  assert.strictEqual(Model.kelvinAt(s, place, rise - 31 * MIN), 1000)
  let previous = 1000
  for (let minute = 29; minute >= 1; minute--) {
    const kelvin = Model.kelvinAt(s, place, rise - minute * MIN)
    assert.ok(kelvin >= previous && kelvin < Model.OFF_TEMP, "minute " + minute + ": " + kelvin)
    previous = kelvin
  }
  assert.strictEqual(Model.kelvinAt(s, place, rise), Model.OFF_TEMP)
})

test("a ramp reaches a target that isn't a round number", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3333 })
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 22, 30)), 3333)
})

test("custom hours ramp the same way, including just after midnight", () => {
  const s = settings({ mode: "custom", onTime: "23:30", offTime: "07:00", temperature: 1000 })
  const middle = Model.kelvinAt(s, place, at(2026, 11, 5, 23, 45))
  assert.ok(middle < Model.OFF_TEMP && middle > 1000)
  const later = Model.kelvinAt(s, place, at(2026, 11, 6, 0, 15))
  assert.ok(later < middle && later > 1000, "still warming after midnight")
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 3)), 1000)
})

test("turning the ramp off goes straight to the temperature", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000, ramp: false })
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 21, 0)), 2000)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 6, 59)), 2000)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 7, 0)), Model.OFF_TEMP)
})

test("holds and manual mode ignore the ramp", () => {
  const now = at(2026, 11, 5, 10)
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  const on = settings(Object.assign({}, s, Model.switchPatch(s, place, now, true)))
  assert.strictEqual(Model.kelvinAt(on, place, now), 2000)
  const night = at(2026, 11, 5, 21, 30)
  const off = settings(Object.assign({}, s, Model.switchPatch(s, place, night, false)))
  assert.strictEqual(Model.kelvinAt(off, place, night), Model.OFF_TEMP)
  const manual = settings({ mode: "manual", manualOn: true, temperature: 2000 })
  assert.strictEqual(Model.kelvinAt(manual, place, night), 2000)
})

test("a hold ending at the schedule's start stays warm with no restart", () => {
  const until = at(2026, 11, 5, 21)
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000, override: { on: true, until: until } })
  const after = settings(Object.assign({}, s, Model.holdEndPatch(s.override)))
  assert.strictEqual(after.override, null)
  assert.strictEqual(Model.kelvinAt(after, place, until), 2000)
  assert.strictEqual(Model.kelvinAt(after, place, until + 30 * MIN), 2000)
  assert.strictEqual(Model.kelvinAt(after, place, until + 61 * MIN), 2000)
  // The morning still clears gradually.
  assert.ok(Model.kelvinAt(after, place, at(2026, 11, 6, 6, 45)) > 2000)
  // A hold that kept it off has nothing to protect.
  assert.deepStrictEqual(Model.holdEndPatch({ on: false, until: until }), { override: null })
})

test("a ramp never lands on hyprsunset's just-restarted value", () => {
  for (let progress = 0; progress <= 1; progress += 0.0005) {
    assert.notStrictEqual(Model.mixKelvin(Model.OFF_TEMP, 1000, progress), Model.FRESH_TEMP)
    assert.notStrictEqual(Model.mixKelvin(1000, Model.OFF_TEMP, progress), Model.FRESH_TEMP)
  }
})

test("a night shorter than its ramps never goes past the temperature", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "21:40", temperature: 1000 })
  const kelvin = Model.kelvinAt(s, place, at(2026, 11, 5, 21, 20))
  assert.ok(kelvin > 1000 && kelvin < Model.OFF_TEMP, String(kelvin))
})

test("detected location ranks below your own and above weather, only when on", () => {
  const weather = { latitude: 59.9, longitude: 10.7, name: "Oslo" }
  const detected = { latitude: 42.6, longitude: -70.9, name: "Topsfield" }
  assert.strictEqual(Model.resolveLocation(settings({ autoLocation: true, detected }), weather, null).source, "detected")
  assert.strictEqual(Model.resolveLocation(settings({ autoLocation: false, detected }), weather, null).source, "weather")
  assert.strictEqual(Model.resolveLocation(settings({ autoLocation: true }), weather, null).source, "weather")
  assert.strictEqual(Model.resolveLocation(settings({ autoLocation: true, detected, latitude: 1, longitude: 2 }), weather, null).source, "custom")
})

test("detected location ignores small moves", () => {
  const home = { latitude: 42.66, longitude: -71 }
  assert.strictEqual(Model.movedFar(null, home), true)
  assert.strictEqual(Model.movedFar(home, null), false)
  assert.strictEqual(Model.movedFar(home, { latitude: 42.64, longitude: -70.97 }), false)
  assert.strictEqual(Model.movedFar(home, { latitude: 40.96, longitude: -80.56 }), true)
})

test("settings without the newer fields keep working", () => {
  const s = Model.normalizeSettings({ mode: "sun", temperature: 1000 })
  assert.strictEqual(s.ramp, true)
  assert.strictEqual(s.autoLocation, false)
  assert.strictEqual(s.detected, null)
  assert.strictEqual(Model.normalizeSettings({ detected: { latitude: 500, longitude: 0 } }).detected, null)
})

test("below 1000K hyprsunset stays at its floor and the shader takes over", () => {
  assert.strictEqual(Model.clampTemp(100), Model.MIN_TEMP)
  assert.strictEqual(Model.hyprsunsetKelvin(700), 1000)
  assert.strictEqual(Model.hyprsunsetKelvin(3000), 3000)
  assert.strictEqual(Model.extraWarmStep(1000), 0)
  assert.strictEqual(Model.extraWarmStep(Model.OFF_TEMP), 0)
  assert.strictEqual(Model.extraWarmStep(990), 1, "any amount below shows")
  assert.strictEqual(Model.extraWarmStep(750), 5)
  assert.strictEqual(Model.extraWarmStep(Model.MIN_TEMP), 10)
  assert.strictEqual(Model.normalizeSettings({ temperature: 600 }).temperature, 600)
})

test("the mildest temperature stays clear of hyprsunset's just-started value", () => {
  assert.ok(Model.MAX_TEMP < Model.FRESH_TEMP, "a saved temperature must never look like a restart")
  assert.strictEqual(Model.normalizeSettings({ temperature: Model.MAX_TEMP }).temperature, Model.MAX_TEMP)
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: Model.MAX_TEMP })
  for (let minute = 0; minute <= 60; minute++) {
    const kelvin = Model.kelvinAt(s, place, at(2026, 11, 5, 21, minute))
    assert.notStrictEqual(kelvin, Model.FRESH_TEMP, "ramp at 21:" + minute)
    assert.ok(kelvin >= Model.MAX_TEMP && kelvin <= Model.OFF_TEMP, "ramp at 21:" + minute)
  }
})

// ---- Start before sunset ----------------------------------------------------

const sunsetOn = (day) => Model.sunTimes(at(2026, 11, day, 12), place.latitude, place.longitude)

test("new settings default to the old behaviour", () => {
  const d = Model.defaultSettings()
  assert.strictEqual(d.sunsetOffset, 0)
  assert.strictEqual(d.fadeIn, 60)
  assert.strictEqual(d.fadeOut, 30)
  assert.strictEqual(d.pauseFullscreen, false)
  assert.deepStrictEqual(d.pauseApps, [])
  // A settings file from before these existed reads the same way.
  const old = Model.normalizeSettings({ mode: "sun", temperature: 3000, ramp: true })
  assert.strictEqual(old.sunsetOffset, 0)
  assert.strictEqual(old.fadeIn * MIN, Model.RAMP_IN_MS)
  assert.strictEqual(old.fadeOut * MIN, Model.RAMP_OUT_MS)
})

test("new settings are checked and clamped field by field", () => {
  const s = Model.normalizeSettings({ sunsetOffset: 999, fadeIn: -5, fadeOut: 500, pauseFullscreen: "yes", pauseApps: 42 })
  assert.strictEqual(s.sunsetOffset, Model.MAX_SUNSET_OFFSET)
  assert.strictEqual(s.fadeIn, 0)
  assert.strictEqual(s.fadeOut, Model.MAX_FADE_MINUTES)
  assert.strictEqual(s.pauseFullscreen, false)
  assert.deepStrictEqual(s.pauseApps, [])
  assert.strictEqual(Model.normalizeSettings({ sunsetOffset: -999 }).sunsetOffset, Model.MIN_SUNSET_OFFSET)
  assert.strictEqual(Model.normalizeSettings({ sunsetOffset: 12.6 }).sunsetOffset, 13)
  assert.strictEqual(Model.normalizeSettings({ sunsetOffset: "30" }).sunsetOffset, 0, "a string is not a number")
  assert.strictEqual(Model.normalizeSettings({ fadeIn: NaN }).fadeIn, 60)
})

test("sun mode can start before sunset", () => {
  const s = settings({ mode: "sun", sunsetOffset: 30 })
  const set = sunsetOn(5).sunset
  const start = set - 30 * MIN
  assert.deepStrictEqual(Model.scheduleAt(s, place, start - MIN), { on: false, next: start })
  assert.strictEqual(Model.scheduleAt(s, place, start).on, true)
  assert.strictEqual(Model.scheduleAt(s, place, start + MIN).on, true)
  assert.strictEqual(Model.scheduleStart(s, place, start + 10 * MIN), start)
  // The warm-up runs from the new start, for its usual hour.
  assert.strictEqual(Model.kelvinAt(s, place, start), Model.OFF_TEMP)
  assert.ok(Model.kelvinAt(s, place, start + 30 * MIN) < Model.OFF_TEMP)
  assert.strictEqual(Model.kelvinAt(s, place, start + 60 * MIN), s.temperature)
  // Morning still ends at sunrise.
  const rise = sunsetOn(6).sunrise
  assert.deepStrictEqual(Model.scheduleAt(s, place, rise - MIN), { on: true, next: rise })
})

test("sun mode can start after sunset, and 0 means at sunset", () => {
  const set = sunsetOn(5).sunset
  const late = settings({ mode: "sun", sunsetOffset: -45 })
  assert.deepStrictEqual(Model.scheduleAt(late, place, set), { on: false, next: set + 45 * MIN })
  assert.strictEqual(Model.scheduleStart(late, place, set + 50 * MIN), set + 45 * MIN)
  const exact = settings({ mode: "sun", sunsetOffset: 0 })
  assert.deepStrictEqual(Model.scheduleAt(exact, place, set - MIN), { on: false, next: set })
})

test("a start before sunset never moves before sunrise", () => {
  // Far north in December the day is shorter than three hours.
  const north = { latitude: 66, longitude: -74, source: "custom", label: "" }
  const s = settings({ mode: "sun", sunsetOffset: 180 })
  const sun = Model.sunTimes(at(2026, 12, 15, 12), north.latitude, north.longitude)
  assert.ok(sun.sunset - 180 * MIN < sun.sunrise, "the test needs a day this short")
  assert.strictEqual(Model.sunOn(s, sun), sun.sunrise)
  for (let minute = 0; minute < 1440; minute += 7) {
    const now = at(2026, 12, 15, 0, minute)
    const kelvin = Model.kelvinAt(s, north, now)
    assert.ok(Number.isFinite(kelvin) && kelvin >= s.temperature && kelvin <= Model.OFF_TEMP, "minute " + minute)
    const due = Model.nextDueAt(s, north, now, [])
    assert.ok(due === null || due > now)
  }
})

// ---- Fade lengths -------------------------------------------------------------

test("the warm-up takes as long as it's set to, evenly to the eye", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000, fadeIn: 120 })
  const on = at(2026, 11, 5, 21)
  assert.strictEqual(Model.kelvinAt(s, place, on), Model.OFF_TEMP)
  assert.strictEqual(Model.kelvinAt(s, place, on + 60 * MIN), Model.mixKelvin(Model.OFF_TEMP, 3000, 0.5))
  assert.strictEqual(Model.kelvinAt(s, place, on + 119 * MIN) > 3000, true)
  assert.strictEqual(Model.kelvinAt(s, place, on + 120 * MIN), 3000)
  // Equal minutes move equal mireds, within the 10K rounding.
  const mired = (k) => 1000000 / k
  const steps = []
  for (let minute = 10; minute <= 110; minute += 10)
    steps.push(mired(Model.kelvinAt(s, place, on + minute * MIN)) - mired(Model.kelvinAt(s, place, on + (minute - 10) * MIN)))
  for (const step of steps) assert.ok(Math.abs(step - steps[0]) < 1.5, steps.join(", "))
})

test("the clear-down takes as long as it's set to", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000, fadeOut: 90 })
  const off = at(2026, 11, 6, 7)
  assert.strictEqual(Model.kelvinAt(s, place, off - 91 * MIN), 3000)
  assert.strictEqual(Model.kelvinAt(s, place, off - 45 * MIN), Model.mixKelvin(Model.OFF_TEMP, 3000, 0.5))
  assert.ok(Model.kelvinAt(s, place, off - MIN) > Model.kelvinAt(s, place, off - 45 * MIN))
  assert.strictEqual(Model.kelvinAt(s, place, off), Model.OFF_TEMP)
})

test("a fade of 0 switches at once, and Gradual off ignores the lengths", () => {
  const instant = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000, fadeIn: 0, fadeOut: 0 })
  assert.strictEqual(Model.kelvinAt(instant, place, at(2026, 11, 5, 21)), 2000)
  assert.strictEqual(Model.kelvinAt(instant, place, at(2026, 11, 6, 6, 59)), 2000)
  assert.strictEqual(Model.rampAt(instant, place, at(2026, 11, 5, 21)), null)
  const off = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000, ramp: false, fadeIn: 120 })
  assert.strictEqual(Model.kelvinAt(off, place, at(2026, 11, 5, 21, 30)), 2000)
})

test("a hold ending at the start skips a warm-up of the set length", () => {
  const until = at(2026, 11, 5, 21)
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000, fadeIn: 90, override: { on: true, until: until } })
  const patch = Model.holdEndPatch(s.override, s)
  assert.strictEqual(patch.rampSkipUntil, until + 90 * MIN)
  const after = settings(Object.assign({}, s, patch))
  assert.strictEqual(Model.kelvinAt(after, place, until + 45 * MIN), 2000)
})

test("long fades on a short night still never pass the temperature", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "22:00", temperature: 2000, fadeIn: 180, fadeOut: 180 })
  for (let minute = 0; minute < 60; minute++) {
    const kelvin = Model.kelvinAt(s, place, at(2026, 11, 5, 21, minute))
    assert.ok(kelvin > 2000 && kelvin <= Model.OFF_TEMP, "minute " + minute + ": " + kelvin)
  }
})

// ---- Pausing for apps ---------------------------------------------------------

test("pausing matches the app in front, ignoring case", () => {
  const s = settings({ pauseApps: ["GIMP", "org.darktable.darktable"] })
  assert.strictEqual(Model.pausedFor(s, "gimp", false), true)
  assert.strictEqual(Model.pausedFor(s, "org.darktable.Darktable", false), true)
  assert.strictEqual(Model.pausedFor(s, "gimp-2.10", false), false, "a whole name, not a prefix")
  assert.strictEqual(Model.pausedFor(s, "", false), false)
  assert.strictEqual(Model.pausedFor(settings({}), "gimp", false), false)
})

test("a trailing * pauses for every app whose class starts with it", () => {
  const s = settings({ pauseApps: ["steam_app_*"] })
  assert.strictEqual(Model.pausedFor(s, "steam_app_1091500", false), true)
  assert.strictEqual(Model.pausedFor(s, "Steam_App_7", false), true)
  assert.strictEqual(Model.pausedFor(s, "steam", false), false)
  assert.strictEqual(Model.pausedFor(s, "steam_app_", false), true)
})

test("fullscreen pauses only when that's turned on", () => {
  assert.strictEqual(Model.pausedFor(settings({ pauseFullscreen: false }), "mpv", true), false)
  assert.strictEqual(Model.pausedFor(settings({ pauseFullscreen: true }), "mpv", true), true)
  assert.strictEqual(Model.pausedFor(settings({ pauseFullscreen: true }), "mpv", false), false)
  assert.strictEqual(Model.pausedFor(settings({ pauseFullscreen: true }), "", true), true, "even with no class")
})

test("paused means neutral, whatever the schedule, a hold or manual mode says", () => {
  const night = at(2026, 11, 5, 23)
  const custom = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  assert.strictEqual(Model.kelvinAt(custom, place, night), 2000)
  assert.strictEqual(Model.kelvinAt(custom, place, night, true), Model.OFF_TEMP)
  const held = settings(Object.assign({}, custom, { override: { on: true, until: night + 60 * MIN } }))
  assert.strictEqual(Model.kelvinAt(held, place, night, true), Model.OFF_TEMP)
  const manual = settings({ mode: "manual", manualOn: true, temperature: 2000 })
  assert.strictEqual(Model.kelvinAt(manual, place, night, true), Model.OFF_TEMP)
  // Pausing changes nothing that's saved: the schedule is the same once the app goes.
  assert.deepStrictEqual(Model.desiredState(custom, place, night), { on: true, until: at(2026, 11, 6, 7) })
})

test("the pause list is cleaned, without repeats, and bounded", () => {
  assert.deepStrictEqual(Model.appList("Steam, gimp , steam,,  "), ["Steam", "gimp"])
  assert.deepStrictEqual(Model.appList(["<img src=x>", "a*b", "*", "x".repeat(65), 123, null, "", " ok "]), ["ok"])
  assert.deepStrictEqual(Model.appList(["Minecraft 1.20", "steam_app_*", "jetbrains-idea"]), ["Minecraft 1.20", "steam_app_*", "jetbrains-idea"])
  const many = []
  for (let i = 0; i < 40; i++) many.push("app" + i)
  assert.strictEqual(Model.appList(many).length, Model.PAUSE_APPS_MAX)
  for (const name of Model.appList(["a<b", "a>b", "a&b", "a\"b", "fine"])) assert.ok(!/[<>&"]/.test(name), name)
})

test("adding and removing the app in front", () => {
  const s = settings({ pauseApps: ["gimp", "steam_app_*"] })
  assert.deepStrictEqual(Model.withPausedApp(s, "Krita", true), ["gimp", "steam_app_*", "Krita"])
  assert.deepStrictEqual(Model.withPausedApp(s, "GIMP", true), ["steam_app_*", "GIMP"], "no repeats, newest spelling")
  assert.deepStrictEqual(Model.withPausedApp(s, "Gimp", false), ["steam_app_*"])
  assert.deepStrictEqual(Model.withPausedApp(s, "steam_app_5", false), ["gimp", "steam_app_*"], "a wildcard goes only when named")
  assert.deepStrictEqual(Model.withPausedApp(s, "<script>", true), ["gimp", "steam_app_*"])
  const full = settings({ pauseApps: Array.from({ length: Model.PAUSE_APPS_MAX }, (_, i) => "app" + i) })
  assert.strictEqual(Model.withPausedApp(full, "one-more", true).length, Model.PAUSE_APPS_MAX)
})

test("names from outside can't carry markup into a label", () => {
  const shown = Model.displayName('<img src="https://example.invalid/t">&amp;')
  assert.ok(!/[<>&]/.test(shown), shown)
  assert.strictEqual(Model.displayName("Fire\u0000fox\u001b"), "Firefox")
  assert.strictEqual(Model.displayName("x".repeat(80)).length, 60)
  assert.strictEqual(Model.displayName(null), "")
  assert.strictEqual(Model.displayName(undefined), "")
  assert.strictEqual(Model.displayName("  org.gnome.Nautilus "), "org.gnome.Nautilus")
})

// ---- Lighter checking -----------------------------------------------------------

// Steps through time the way Service.qml does: check, send a visible change,
// then sleep until the next thing is due, never longer than a minute.
function simulate(s, location, from, to, profileMinutes) {
  let now = from
  let last = null
  const checks = []
  const steps = []
  while (now < to) {
    checks.push(now)
    const level = Model.kelvinAt(s, location, now)
    if (Model.isVisibleStep(last, level, s.temperature)) {
      steps.push({ at: now, from: last, to: level })
      last = level
    }
    const due = Model.nextDueAt(s, location, now, profileMinutes || [])
    const wait = Math.min(due === null ? Model.CHECK_MS : due - now + 250, Model.CHECK_MS)
    now += Math.max(1000, wait)
  }
  return { checks, steps, last }
}

const miredGap = (a, b) => Math.abs(1000000 / a - 1000000 / b)

test("only a visible change is sent to hyprsunset", () => {
  assert.strictEqual(Model.isVisibleStep(null, 5000, 3000), true, "the first value always goes")
  assert.strictEqual(Model.isVisibleStep(5000, 5000, 3000), false)
  assert.strictEqual(Model.isVisibleStep(5000, 4990, 3000), false, "0.4 mired")
  assert.strictEqual(Model.isVisibleStep(5000, 4950, 3000), true, "2 mireds")
  assert.strictEqual(Model.isVisibleStep(3010, 3000, 3000), true, "the end of a fade always lands")
  assert.strictEqual(Model.isVisibleStep(6490, Model.OFF_TEMP, 3000), true, "so does off")
})

test("a big change fades over two seconds instead of snapping", () => {
  assert.strictEqual(Model.isBigJump(Model.OFF_TEMP, 3000), true)
  assert.strictEqual(Model.isBigJump(3100, 3000), false, "under four steps")
  assert.strictEqual(Model.isBigJump(null, 3000), false)
})

test("fade steps are spaced by what the eye can see", () => {
  const evening = (temperature, fadeIn) => settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature, fadeIn })
  const during = at(2026, 11, 5, 21, 2)
  // 6500K to 3000K is about 180 mireds: an hour makes ~60 steps, a minute apart.
  const step = Model.fadeStepMs(evening(3000, 60), place, during)
  assert.ok(Math.abs(step - 3600000 * Model.STEP_MIREDS / miredGap(Model.OFF_TEMP, 3000)) < 1, String(step))
  // A light tint has far fewer steps, so they're further apart.
  assert.ok(Model.fadeStepMs(evening(5500, 60), place, during) > 5 * step)
  // A short fade to deep red would step faster than every 5 seconds; it doesn't.
  assert.strictEqual(Model.fadeStepMs(evening(1000, 5), place, during), Model.MIN_STEP_MS)
  assert.strictEqual(Model.fadeStepMs(evening(3000, 60), place, at(2026, 11, 5, 23)), null, "outside a fade")
})

test("an hour's warm-up sends about one small step a minute and lands exactly", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000 })
  const run = simulate(s, place, at(2026, 11, 5, 20, 50), at(2026, 11, 5, 22, 30))
  const warmUp = run.steps.filter((x) => x.from !== null && x.at > at(2026, 11, 5, 21) && x.at <= at(2026, 11, 5, 22) + 2000)
  assert.ok(warmUp.length >= 50 && warmUp.length <= 70, warmUp.length + " steps")
  for (const x of warmUp) assert.ok(miredGap(x.from, x.to) <= 5, "a step the eye could catch: " + x.from + " to " + x.to)
  const end = warmUp[warmUp.length - 1]
  assert.strictEqual(end.to, 3000)
  assert.ok(end.at - at(2026, 11, 5, 22) < 2000, "lands as the warm-up ends")
  assert.ok(run.checks.length <= 110, run.checks.length + " checks; every 15 s would be 400")
})

test("a whole day takes about a check a minute instead of four", () => {
  const custom = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000 })
  const day = simulate(custom, place, at(2026, 11, 5, 12), at(2026, 11, 6, 12))
  assert.ok(day.checks.length < 1600, day.checks.length + " checks; every 15 s would be 5760")
  assert.ok(day.steps.length < 200, day.steps.length + " steps sent")
  assert.strictEqual(day.last, Model.OFF_TEMP)
  for (const x of day.steps) if (x.from !== null && x.to !== custom.temperature && x.to !== Model.OFF_TEMP) assert.ok(miredGap(x.from, x.to) <= 5, x.from + " to " + x.to)
  // Never longer than a minute between looks, so a change made elsewhere is seen.
  for (let i = 1; i < day.checks.length; i++) assert.ok(day.checks[i] - day.checks[i - 1] <= Model.CHECK_MS)
  const sun = settings({ mode: "sun", sunsetOffset: 30, temperature: 2500, fadeIn: 90, fadeOut: 45 })
  const sunDay = simulate(sun, place, at(2026, 11, 5, 12), at(2026, 11, 6, 12))
  assert.ok(sunDay.checks.length < 1600, sunDay.checks.length + " checks")
  for (const x of sunDay.steps) if (x.from !== null && x.to !== sun.temperature && x.to !== Model.OFF_TEMP) assert.ok(miredGap(x.from, x.to) <= 5)
})

test("the clear-down steps as evenly as the warm-up and ends on time", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000, fadeOut: 30 })
  const run = simulate(s, place, at(2026, 11, 6, 6, 20), at(2026, 11, 6, 7, 10))
  const down = run.steps.filter((x) => x.from !== null)
  assert.ok(down.length >= 50 && down.length <= 70, down.length + " steps")
  for (const x of down.slice(0, -1)) assert.ok(miredGap(x.from, x.to) <= 5, x.from + " to " + x.to)
  assert.strictEqual(down[down.length - 1].to, Model.OFF_TEMP)
  assert.ok(down[down.length - 1].at - at(2026, 11, 6, 7) < 2000)
  // No burst of checks at the start of the fade.
  const early = run.checks.filter((t) => t >= at(2026, 11, 6, 6, 30) && t < at(2026, 11, 6, 6, 31))
  assert.ok(early.length <= 3, early.length + " checks in the fade's first minute")
  // A check that lands on the fade's very first instant still sees the fade.
  const start = at(2026, 11, 6, 6, 30)
  assert.strictEqual(Model.nextDueAt(s, place, start, []), start + Model.fadeStepMs(s, place, start))
  assert.strictEqual(Model.kelvinAt(s, place, start), 3000)
  const ramp = Model.rampAt(s, place, at(2026, 11, 6, 6, 45))
  assert.strictEqual(ramp.warming, false)
  assert.ok(Math.abs(ramp.remainingMs - 15 * MIN) < 1)
  assert.ok(Math.abs(Model.rampAt(s, place, at(2026, 11, 5, 21, 15)).remainingMs - 45 * MIN) < 1, "and the warm-up's")
})

test("the next check comes when something is due", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000 })
  assert.strictEqual(Model.nextDueAt(s, place, at(2026, 11, 5, 20), []), at(2026, 11, 5, 21), "the switch on")
  assert.strictEqual(Model.nextDueAt(s, place, at(2026, 11, 6, 6, 10), []), at(2026, 11, 6, 6, 30), "the clear-down starting")
  const held = settings(Object.assign({}, s, { override: { on: false, until: at(2026, 11, 5, 20, 15) } }))
  assert.strictEqual(Model.nextDueAt(held, place, at(2026, 11, 5, 20), []), at(2026, 11, 5, 20, 15), "a hold ending")
  const during = at(2026, 11, 5, 21, 10)
  assert.strictEqual(Model.nextDueAt(s, place, during, []), during + Model.fadeStepMs(s, place, during), "the next fade step")
  assert.strictEqual(Model.nextDueAt(settings({ mode: "manual", manualOn: true }), place, during, []), null, "manual mode has nothing due")
  assert.strictEqual(Model.nextDueAt(settings({ mode: "sun" }), null, during, []), null, "nor does Sun mode with no location")
})

test("checks follow hyprsunset.conf's own switch times, and one just after", () => {
  const manual = settings({ mode: "manual", manualOn: true })
  assert.strictEqual(Model.nextDueAt(manual, place, at(2026, 11, 6, 6, 59), [420]), at(2026, 11, 6, 7) + 2000)
  // hyprsunset can switch up to a minute late, so there's a second look.
  assert.strictEqual(Model.nextDueAt(manual, place, at(2026, 11, 6, 7) + 3000, [420]), at(2026, 11, 6, 7) + 62000)
  assert.strictEqual(Model.nextDueAt(manual, place, at(2026, 11, 6, 7, 5), [420]), at(2026, 11, 7, 7) + 2000)
  const run = simulate(manual, place, at(2026, 11, 6, 6, 55), at(2026, 11, 6, 7, 5), [420])
  assert.ok(run.checks.some((t) => t >= at(2026, 11, 6, 7) && t <= at(2026, 11, 6, 7) + 5000))
  assert.ok(run.checks.some((t) => t >= at(2026, 11, 6, 7, 1) && t <= at(2026, 11, 6, 7, 1) + 5000))
})

test("nothing due is ever in the past", () => {
  const all = [
    settings({ mode: "custom", onTime: "21:00", offTime: "07:00" }),
    settings({ mode: "custom", onTime: "09:00", offTime: "17:00", fadeIn: 0, fadeOut: 180 }),
    settings({ mode: "sun", sunsetOffset: 120, fadeIn: 180 }),
    settings({ mode: "sun", sunsetOffset: -60, ramp: false }),
    settings({ mode: "manual" })
  ]
  for (const s of all) {
    for (let minute = 0; minute < 2880; minute += 13) {
      const now = at(2026, 11, 5, 0, minute) + 1234
      const due = Model.nextDueAt(s, place, now, [420])
      assert.ok(due !== null && due > now, s.mode + " at minute " + minute)
    }
  }
})

// ---- hyprsunset.conf ------------------------------------------------------------

const STOCK_HYPRSUNSET = [
  "# Makes hyprsunset do nothing to the screen by default",
  "# Without this, the default applies some tint to the monitor",
  "profile {",
  "    time = 07:00",
  "    identity = true",
  "}",
  "",
  "# To enable auto switch to nightlight, add to your .config/hypr/autostart.lua:",
  "# o.launch_on_start(\"hyprsunset\")",
  "# and use the following:",
  "# profile {",
  "#     time = 20:00",
  "#     temperature = 4000",
  "# }",
  ""
].join("\n")

test("Omarchy's hyprsunset.conf switches once, at 07:00, back to 6000K", () => {
  assert.deepStrictEqual(Model.hyprsunsetProfiles(STOCK_HYPRSUNSET), { minutes: [420], values: [Model.FRESH_TEMP] })
  const installed = "/usr/share/omarchy/config/hypr/hyprsunset.conf"
  if (fs.existsSync(installed))
    assert.deepStrictEqual(Model.hyprsunsetProfiles(fs.readFileSync(installed, "utf8")), { minutes: [420], values: [Model.FRESH_TEMP] })
})

test("profiles with a temperature read back as that temperature", () => {
  const text = "profile {\n  time = 7:30\n  identity = true\n}\nprofile {\n  time = 20:00 # evening\n  temperature = 4000\n  gamma = 0.8\n}\nprofile {\n  temperature = 3000\n}\n"
  assert.deepStrictEqual(Model.hyprsunsetProfiles(text), { minutes: [450, 1200], values: [Model.FRESH_TEMP, 4000] })
  assert.deepStrictEqual(Model.hyprsunsetProfiles(""), { minutes: [], values: [] })
  assert.deepStrictEqual(Model.hyprsunsetProfiles(null), { minutes: [], values: [] })
  assert.strictEqual(Model.isProfileValue(4000, [6000, 4000]), true)
  assert.strictEqual(Model.isProfileValue(3990, [6000, 4000]), false)
})

test("a switch time between two looks is hyprsunset's, not a hand", () => {
  const seven = at(2026, 11, 6, 7)
  assert.strictEqual(Model.profileSwitchBetween([420], seven - 30000, seven + 5000), true)
  assert.strictEqual(Model.profileSwitchBetween([420], seven + 30000, seven + 90000), true, "landed late, after the earlier look")
  assert.strictEqual(Model.profileSwitchBetween([420], seven + 120000, seven + 180000), false)
  assert.strictEqual(Model.profileSwitchBetween([0], at(2026, 11, 5, 23, 59, 30), at(2026, 11, 6, 0, 0) + 10000), true, "across midnight")
  assert.strictEqual(Model.profileSwitchBetween([420], 0, seven), false, "no earlier look")
  assert.strictEqual(Model.profileSwitchBetween([420], seven - 3 * 86400000, seven), false, "a gap too long to say")
  assert.strictEqual(Model.profileSwitchBetween([], seven - 30000, seven + 5000), false)
})

if (process.env.SUN_FIXTURE) {
  test("sun times match the reference list within a second", () => {
    const fixture = JSON.parse(fs.readFileSync(process.env.SUN_FIXTURE, "utf8"))
    for (const row of fixture) {
      const [y, mo, d] = row.date.split("-").map(Number)
      const times = Model.sunTimes(at(y, mo, d, 12), place.latitude, place.longitude)
      assert.ok(Math.abs(times.sunrise - row.sunrise) < 1000, "sunrise " + row.date)
      assert.ok(Math.abs(times.sunset - row.sunset) < 1000, "sunset " + row.date)
    }
    console.log("   compared " + fixture.length + " days")
  })
}
