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

// ---- Holds for a set time ---------------------------------------------------------

test("off for an hour, then the schedule again", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  const now = at(2026, 11, 5, 22)
  const held = settings(Object.assign({}, s, Model.holdPatch(s, place, now, "off", 60)))
  assert.deepStrictEqual(Model.desiredState(held, place, now + 30 * MIN), { on: false, until: now + 60 * MIN })
  assert.strictEqual(Model.kelvinAt(held, place, now + 30 * MIN), Model.OFF_TEMP)
  assert.strictEqual(Model.desiredState(held, place, now + 60 * MIN).on, true, "the hold ends on time")
  assert.strictEqual(Model.nextDueAt(held, place, now + 30 * MIN, []), now + 60 * MIN, "and a check comes then")
})

test("warm for an hour in the day, at the full temperature", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  const noon = at(2026, 11, 5, 12)
  const held = settings(Object.assign({}, s, Model.holdPatch(s, place, noon, "on", 60)))
  assert.strictEqual(Model.kelvinAt(held, place, noon + MIN), 2000, "no warm-up for a hold")
  assert.strictEqual(Model.kelvinAt(held, place, noon + 61 * MIN), Model.OFF_TEMP)
})

test("off until morning: the rest of tonight, or all of tonight from the day", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  const night = Model.holdPatch(s, place, at(2026, 11, 5, 23), "morning")
  assert.deepStrictEqual(night.override, { on: false, until: at(2026, 11, 6, 7) })
  const day = Model.holdPatch(s, place, at(2026, 11, 5, 15), "morning")
  assert.deepStrictEqual(day.override, { on: false, until: at(2026, 11, 6, 7) }, "skips tonight")
  const sun = settings({ mode: "sun" })
  const rise = Model.sunTimes(at(2026, 11, 6, 12), place.latitude, place.longitude).sunrise
  assert.strictEqual(Model.holdPatch(sun, place, at(2026, 11, 5, 23), "morning").override.until, rise)
  assert.strictEqual(Model.holdPatch(settings({ mode: "manual" }), place, at(2026, 11, 5, 23), "morning"), null, "needs a schedule")
  assert.strictEqual(Model.holdPatch(sun, null, at(2026, 11, 5, 23), "morning"), null, "and a location in Sun mode")
})

test("timed holds work in Manual mode, and the switch clears them", () => {
  const manual = settings({ mode: "manual", manualOn: false, temperature: 2000 })
  const now = at(2026, 11, 5, 14)
  const held = settings(Object.assign({}, manual, Model.holdPatch(manual, place, now, "on", 30)))
  assert.deepStrictEqual(Model.desiredState(held, place, now), { on: true, until: now + 30 * MIN })
  assert.deepStrictEqual(Model.desiredState(held, place, now + 31 * MIN), { on: false, until: 0 })
  const flipped = settings(Object.assign({}, held, Model.switchPatch(held, place, now, false)))
  assert.strictEqual(flipped.override, null)
})

test("a hold is cleared, and bad requests change nothing", () => {
  const s = settings({ override: { on: false, until: at(2030, 1, 1) } })
  assert.deepStrictEqual(Model.holdPatch(s, place, at(2026, 11, 5, 22), "clear"), { override: null })
  for (const [kind, minutes] of [["sideways", 60], ["off", 0], ["off", -5], ["on", "soon"], ["on", NaN]])
    assert.strictEqual(Model.holdPatch(s, place, at(2026, 11, 5, 22), kind, minutes), null, kind + " " + minutes)
  const long = Model.holdPatch(s, place, at(2026, 11, 5, 22), "off", 5000)
  assert.strictEqual(long.override.until, at(2026, 11, 5, 22) + Model.MAX_HOLD_MINUTES * MIN, "at most 12 hours")
})

test("a hold changes only the state file", () => {
  const s = settings({ mode: "custom", temperature: 2000 })
  const held = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 22), "off", 60)))
  assert.deepStrictEqual(Model.splitSettings(held).settings, Model.splitSettings(s).settings)
})

// ---- Presets and Movie mode ---------------------------------------------------

test("presets are fixed temperatures, mildest first like the slider", () => {
  assert.deepStrictEqual(Model.PRESETS.map((p) => p.name), ["mild", "night", "warm", "candle"])
  assert.strictEqual(Model.presetKelvin("candle"), 1900)
  assert.strictEqual(Model.presetKelvin("warm"), 2700)
  assert.strictEqual(Model.presetKelvin("night"), 3400)
  assert.strictEqual(Model.presetKelvin("mild"), 4500)
  assert.strictEqual(Model.presetKelvin("disco"), null)
  for (let i = 0; i < Model.PRESETS.length; i++) {
    const kelvin = Model.PRESETS[i].kelvin
    assert.strictEqual(Model.clampTemp(kelvin), kelvin, "inside the slider's range")
    if (i > 0) assert.ok(kelvin < Model.PRESETS[i - 1].kelvin, "each warmer than the last")
    assert.strictEqual(Model.presetName(kelvin), Model.PRESETS[i].name)
  }
  assert.strictEqual(Model.presetName(3000), "", "a temperature between presets matches none")
})

test("Movie mode is milder for two and a half hours, then the schedule again", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  const now = at(2026, 11, 5, 21, 30)
  const patch = Model.holdPatch(s, place, now, "movie")
  assert.deepStrictEqual(patch.override, { on: true, until: now + 150 * MIN, temperature: Model.MOVIE_TEMP })
  const held = settings(Object.assign({}, s, patch))
  assert.deepStrictEqual(held.override, patch.override, "the temperature survives saving")
  assert.strictEqual(Model.kelvinAt(held, place, now + MIN), 5000)
  assert.strictEqual(Model.kelvinAt(held, place, now + 149 * MIN), 5000)
  assert.strictEqual(Model.targetKelvin(held, place, now + MIN), 5000)
  assert.strictEqual(Model.kelvinAt(held, place, now + 150 * MIN), 2000, "back to the night's temperature")
  assert.strictEqual(Model.targetKelvin(held, place, now + 150 * MIN), 2000)
  assert.strictEqual(Model.nextDueAt(held, place, now + 60 * MIN, []), now + 150 * MIN, "and a check comes then")
  assert.strictEqual(Model.kelvinAt(held, place, now + MIN, true), Model.OFF_TEMP, "a paused app still wins")
})

test("Movie mode works in the day and in Manual mode, and takes a length", () => {
  const noon = at(2026, 11, 5, 12)
  const day = settings({ mode: "sun", temperature: 2000 })
  const held = settings(Object.assign({}, day, Model.holdPatch(day, place, noon, "movie")))
  assert.strictEqual(Model.kelvinAt(held, place, noon + MIN), 5000)
  const manual = settings({ mode: "manual", manualOn: false })
  const film = settings(Object.assign({}, manual, Model.holdPatch(manual, place, noon, "movie", 100)))
  assert.deepStrictEqual(Model.desiredState(film, place, noon + 99 * MIN), { on: true, until: noon + 100 * MIN })
  assert.strictEqual(Model.kelvinAt(film, place, noon + 101 * MIN), Model.OFF_TEMP)
  const long = Model.holdPatch(manual, place, noon, "movie", 5000)
  assert.strictEqual(long.override.until, noon + Model.MAX_HOLD_MINUTES * MIN, "at most 12 hours")
  assert.deepStrictEqual(Model.splitSettings(film).settings, Model.splitSettings(manual).settings, "only the state file changes")
})

test("choosing a temperature during Movie mode shows it for the rest of the hold", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  const now = at(2026, 11, 5, 21, 30)
  const film = settings(Object.assign({}, s, Model.holdPatch(s, place, now, "movie")))
  const patch = Model.temperaturePatch(film, place, 2700, now + 10 * MIN)
  assert.deepStrictEqual(patch, { temperature: 2700, override: { on: true, until: now + 150 * MIN } })
  const after = settings(Object.assign({}, film, patch))
  assert.strictEqual(Model.kelvinAt(after, place, now + 11 * MIN), 2700)
  assert.strictEqual(Model.desiredState(after, place, now + 149 * MIN).until, now + 150 * MIN, "the hold keeps its end")
  // Any other time it saves the temperature and nothing else.
  assert.deepStrictEqual(Model.temperaturePatch(s, place, 9000, now), { temperature: Model.MAX_TEMP })
  const off = settings(Object.assign({}, s, Model.holdPatch(s, place, now, "off", 60)))
  assert.deepStrictEqual(Model.temperaturePatch(off, place, 2700, now), { temperature: 2700 })
})

test("a hold's own temperature is checked, and only a warm hold keeps one", () => {
  const until = at(2026, 11, 5, 23)
  assert.strictEqual(settings({ override: { on: true, until, temperature: 9000 } }).override.temperature, Model.MAX_TEMP)
  assert.strictEqual(settings({ override: { on: true, until, temperature: 100 } }).override.temperature, Model.MIN_TEMP)
  assert.deepStrictEqual(settings({ override: { on: true, until, temperature: "hot" } }).override, { on: true, until })
  assert.deepStrictEqual(settings({ override: { on: false, until, temperature: 4000 } }).override, { on: false, until })
  // A plain warm hold ("Warm 1 h") still uses the saved temperature.
  const warm = settings({ temperature: 2200, override: { on: true, until } })
  assert.strictEqual(Model.targetKelvin(warm, place, until - MIN), 2200)
})

test("a warm hold ending in the day leaves that evening's warm-up alone", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000, fadeIn: 60 })
  // Movie mode from 18:00 ends at 20:30, half an hour before the schedule turns on.
  const film = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 18), "movie")))
  const patch = Model.holdEndPatch(film.override, film, place)
  assert.deepStrictEqual(patch, { override: null })
  const after = settings(Object.assign({}, film, patch))
  assert.ok(Model.kelvinAt(after, place, at(2026, 11, 5, 21, 15)) > 2000, "still warms up gradually at 21:00")
  // Ending at night still skips the warm-up, as before.
  const night = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 20), "movie")))
  assert.strictEqual(Model.holdEndPatch(night.override, night, place).rampSkipUntil, at(2026, 11, 5, 22, 30) + 60 * MIN)
  // Manual mode has no warm-up to protect either way.
  const manual = settings({ mode: "manual" })
  assert.strictEqual(Model.kelvinAt(settings(Object.assign({}, manual, Model.holdEndPatch({ on: true, until: at(2026, 11, 5, 20) }, manual, place))), place, at(2026, 11, 5, 21)), Model.OFF_TEMP)
})

test("leaving Movie mode at night fades to the night's temperature", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 2000 })
  const start = at(2026, 11, 5, 21, 30)
  const film = settings(Object.assign({}, s, Model.holdPatch(s, place, start, "movie")))
  const run = simulate(film, place, start, start + 140 * MIN)
  assert.strictEqual(run.last, 5000)
  assert.strictEqual(run.steps.length, 1, "one send for the whole film")
  const end = start + 150 * MIN
  const after = settings(Object.assign({}, film, Model.holdEndPatch(film.override, film, place)))
  assert.strictEqual(Model.kelvinAt(after, place, end), 2000)
  assert.ok(Model.isBigJump(5000, 2000), "a jump the service fades over two seconds")
})

// ---- Settings and state, in two files ------------------------------------------

test("every setting has exactly one home", () => {
  const all = Object.keys(Model.defaultSettings()).sort()
  const homes = Model.SETTING_KEYS.concat(Model.STATE_KEYS).sort()
  assert.deepStrictEqual(homes, all, "add a new key to SETTING_KEYS or STATE_KEYS")
  for (const key of Model.SETTING_KEYS) assert.ok(!Model.STATE_KEYS.includes(key), key + " has two homes")
})

const populated = () => settings({
  mode: "custom", temperature: 2700, onTime: "20:30", offTime: "06:45", ramp: true, fadeIn: 45, fadeOut: 20,
  sunsetOffset: 30, pauseFullscreen: true, pauseApps: ["gimp", "steam_app_*"], autoLocation: true,
  manualOn: true, override: { on: false, until: at(2026, 11, 6, 7) }, rampSkipUntil: at(2026, 11, 5, 22),
  latitude: 47.6, longitude: -122.3, detected: { latitude: 47.61, longitude: -122.33, name: "Somewhere" }
})

test("settings and state split and combine without loss", () => {
  const s = populated()
  const parts = Model.splitSettings(s)
  const back = Model.combineSettings(parts.settings, parts.state)
  assert.deepStrictEqual(back.settings, s)
  assert.strictEqual(back.migrate, false)
  // Through JSON, as on disk.
  const disk = Model.combineSettings(JSON.parse(JSON.stringify(parts.settings)), JSON.parse(JSON.stringify(parts.state)))
  assert.deepStrictEqual(disk.settings, s)
})

test("coordinates and holds stay in the private state file", () => {
  const parts = Model.splitSettings(populated())
  for (const key of ["latitude", "longitude", "detected", "override", "manualOn", "rampSkipUntil"]) {
    assert.ok(key in parts.state, key + " in state")
    assert.ok(!(key in parts.settings), key + " kept out of the tracked file")
  }
  assert.ok(!JSON.stringify(parts.settings).includes("47.6"), "no coordinates in the tracked file")
})

test("a hold or the manual switch changes only the state file", () => {
  const before = populated()
  const held = settings(Object.assign({}, before, { override: { on: true, until: at(2026, 11, 7, 7) }, manualOn: false }))
  assert.deepStrictEqual(Model.splitSettings(held).settings, Model.splitSettings(before).settings)
  assert.notDeepStrictEqual(Model.splitSettings(held).state, Model.splitSettings(before).state)
})

test("the old single file is split once, its state kept", () => {
  const old = JSON.parse(JSON.stringify(populated()))
  const fresh = Model.combineSettings(old, null)
  assert.strictEqual(fresh.migrate, true)
  assert.deepStrictEqual(fresh.settings, populated())
  // If the state file already has a key, it wins over the old file's copy.
  const newer = { override: { on: true, until: at(2026, 11, 9, 7) } }
  const both = Model.combineSettings(old, newer)
  assert.strictEqual(both.migrate, true)
  assert.deepStrictEqual(both.settings.override, newer.override)
  assert.strictEqual(both.settings.latitude, 47.6, "the rest comes from the old file")
})

test("each key is read only from its own file", () => {
  const d = Model.defaultSettings()
  const mixed = Model.combineSettings({ temperature: 2500 }, { temperature: 1000, mode: "manual", latitude: 10, longitude: 20 })
  assert.strictEqual(mixed.settings.temperature, 2500, "temperature only from the settings file")
  assert.strictEqual(mixed.settings.mode, d.mode, "mode only from the settings file")
  assert.strictEqual(mixed.settings.latitude, 10)
  assert.strictEqual(mixed.migrate, false)
})

test("garbage in either file falls back to defaults for that file", () => {
  const d = Model.defaultSettings()
  assert.deepStrictEqual(Model.combineSettings("nonsense", 5).settings, d)
  assert.deepStrictEqual(Model.combineSettings(null, null).settings, d)
  assert.deepStrictEqual(Model.combineSettings([1, 2], { override: "x" }).settings, d)
  const half = Model.combineSettings({ temperature: 2000 }, "nonsense")
  assert.strictEqual(half.settings.temperature, 2000)
  assert.strictEqual(half.settings.override, null)
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
    if (Model.isVisibleStep(last, level, Model.restingKelvin(s, location, now))) {
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

test("fades to deep red step finely too", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 1000 })
  const run = simulate(s, place, at(2026, 11, 5, 20, 50), at(2026, 11, 5, 22, 10))
  const fade = run.steps.filter((x) => x.from !== null && x.to !== 1000 && x.to !== Model.OFF_TEMP)
  assert.ok(fade.length > 100, fade.length + " steps")
  for (const x of fade) assert.ok(miredGap(x.from, x.to) <= 5, "a step the eye could catch: " + x.from + " to " + x.to)
  // Above 2500K it still rounds to 10K, so readings stay tidy.
  assert.strictEqual(Model.mixKelvin(Model.OFF_TEMP, 3000, 0.37) % 10, 0)
  assert.strictEqual(Model.mixKelvin(Model.OFF_TEMP, 1000, 0.9) % 10 === 0, false, "fine below 2500K")
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

// ---- Bedtime ---------------------------------------------------------------------

// Thursday 5 November 2026 to Sunday the 8th; the 1st is the night the clocks go back.
const bedNight = (patch) => settings(Object.assign({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000,
  bedtime: true, bedtimeAt: "22:30", bedtimeTemperature: 2200, weekendDelay: 60, fadeIn: 60, fadeOut: 30 }, patch))
const steadySteps = (run, s) => run.steps.filter((x) => x.from !== null)
  .forEach((x) => assert.ok(miredGap(x.from, x.to) <= 5, "a step the eye could catch: " + x.from + " to " + x.to + " at " + new Date(x.at).toString()))

test("bedtime is off by default and changes nothing until turned on", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000 })
  assert.strictEqual(s.bedtime, false)
  assert.strictEqual(s.bedtimeAt, "22:30")
  assert.strictEqual(s.bedtimeTemperature, 2200)
  assert.strictEqual(s.weekendDelay, 60)
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 5, 23)), null)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 2)), 3000)
})

test("bedtime settings are checked and clamped field by field", () => {
  const s = settings({ bedtime: "yes", bedtimeAt: "25:00", bedtimeTemperature: 99999, weekendDelay: 1000 })
  assert.strictEqual(s.bedtime, false)
  assert.strictEqual(s.bedtimeAt, "22:30")
  assert.strictEqual(s.bedtimeTemperature, Model.MAX_TEMP)
  assert.strictEqual(s.weekendDelay, Model.MAX_WEEKEND_DELAY)
  const t = settings({ bedtime: true, bedtimeAt: "7:05", bedtimeTemperature: 100, weekendDelay: -30 })
  assert.deepStrictEqual([t.bedtime, t.bedtimeAt, t.bedtimeTemperature, t.weekendDelay], [true, "07:05", Model.MIN_TEMP, 0])
})

test("from bedtime the night warms to the bedtime level over the warm-up length", () => {
  const s = bedNight()
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 22)), 3000)
  assert.strictEqual(Model.nextDueAt(s, place, at(2026, 11, 5, 22), []), at(2026, 11, 5, 22, 30), "a check at bedtime")
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 22, 30)), 3000)
  const halfway = Model.kelvinAt(s, place, at(2026, 11, 5, 23))
  assert.ok(halfway < 3000 && halfway > 2200, String(halfway))
  assert.ok(Math.abs(miredGap(3000, halfway) - miredGap(halfway, 2200)) < 1, "even to the eye")
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 23, 30)), 2200)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 3)), 2200)
  const clearing = Model.kelvinAt(s, place, at(2026, 11, 6, 6, 45))
  assert.ok(clearing > 2200 && clearing < Model.OFF_TEMP, "the morning clears from the bedtime level")
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 7)), Model.OFF_TEMP)
  assert.strictEqual(Model.restingKelvin(s, place, at(2026, 11, 5, 22)), 3000)
  assert.strictEqual(Model.restingKelvin(s, place, at(2026, 11, 5, 22, 45)), 2200, "a fade lands on where it's heading")
})

test("Friday and Saturday nights reach bedtime later", () => {
  const s = bedNight()
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 5, 23)).start, at(2026, 11, 5, 22, 30), "Thursday")
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 6, 23)).start, at(2026, 11, 6, 23, 30), "Friday")
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 8, 2)).start, at(2026, 11, 7, 23, 30), "Saturday, after midnight")
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 8, 23)).start, at(2026, 11, 8, 22, 30), "Sunday")
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 23)), 3000)
  const none = bedNight({ weekendDelay: 0 })
  assert.strictEqual(Model.bedtimeAt(none, place, at(2026, 11, 6, 23)).start, at(2026, 11, 6, 22, 30))
})

test("a bedtime after midnight belongs to the night before", () => {
  const s = bedNight({ bedtimeAt: "00:30" })
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 5, 21, 30)).start, at(2026, 11, 6, 0, 30))
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 23, 59)), 3000)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 6, 2)), 2200)
  // A night that starts after midnight still finds its bedtime.
  const late = bedNight({ onTime: "01:00", bedtimeAt: "02:00" })
  assert.strictEqual(Model.bedtimeAt(late, place, at(2026, 11, 6, 1, 30)).start, at(2026, 11, 6, 2))
})

test("a bedtime already past when the night starts covers the whole night", () => {
  const custom = bedNight({ onTime: "23:00" })
  assert.deepStrictEqual(Model.bedtimeAt(custom, place, at(2026, 11, 5, 23, 10)), { start: at(2026, 11, 5, 23), lengthMs: 0 })
  assert.strictEqual(Model.kelvinAt(custom, place, at(2026, 11, 6, 0, 30)), 2200)
  const warming = Model.kelvinAt(custom, place, at(2026, 11, 5, 23, 30))
  assert.ok(warming < Model.OFF_TEMP && warming > 2200, "the warm-up heads straight for the bedtime level")
  // Sun mode, with a bedtime an hour before sunset.
  const sunset = sunsetOn(5).sunset
  const early = new Date(sunset - 60 * MIN)
  const sun = bedNight({ mode: "sun", bedtimeAt: String(early.getHours()).padStart(2, "0") + ":" + String(early.getMinutes()).padStart(2, "0") })
  assert.strictEqual(Model.kelvinAt(sun, place, sunset + 61 * MIN), 2200)
  const run = simulate(sun, place, sunset - 10 * MIN, sunset + 70 * MIN)
  steadySteps(run, sun)
  assert.strictEqual(run.last, 2200)
})

test("a bedtime after the night ends is ignored", () => {
  const s = bedNight({ onTime: "18:00", offTime: "22:00" })
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 11, 5, 21)), null)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 21)), 3000)
})

test("bedtime needs a schedule and the night light on", () => {
  const night = at(2026, 11, 5, 23, 45)
  assert.strictEqual(Model.kelvinAt(bedNight({ mode: "manual", manualOn: true }), place, night), 3000, "Manual mode")
  assert.strictEqual(Model.kelvinAt(bedNight({ mode: "sun", manualOn: true }), null, night), 3000, "Sun mode with no location")
  const s = bedNight()
  const off = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 23), "off", 60)))
  assert.strictEqual(Model.kelvinAt(off, place, night), Model.OFF_TEMP)
  assert.strictEqual(Model.bedtimeAt(off, place, night), null)
  assert.strictEqual(Model.kelvinAt(s, place, night, true), Model.OFF_TEMP, "a paused app still wins")
})

test("holds at bedtime: warm keeps the bedtime level, Movie mode is milder, then bedtime again", () => {
  const s = bedNight()
  const warm = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 23, 40), "on", 60)))
  assert.strictEqual(Model.kelvinAt(warm, place, at(2026, 11, 5, 23, 45)), 2200)
  const film = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 22), "movie")))
  assert.strictEqual(Model.kelvinAt(film, place, at(2026, 11, 5, 23, 45)), 5000)
  assert.strictEqual(Model.restingKelvin(film, place, at(2026, 11, 5, 23, 45)), 5000)
  const after = settings(Object.assign({}, film, Model.holdEndPatch(film.override, film, place)))
  assert.strictEqual(Model.kelvinAt(after, place, at(2026, 11, 6, 0, 30)), 2200)
})

test("Gradual off reaches the bedtime level at once", () => {
  const s = bedNight({ ramp: false })
  assert.deepStrictEqual(Model.bedtimeAt(s, place, at(2026, 11, 5, 22)), { start: at(2026, 11, 5, 22, 30), lengthMs: 0 })
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 22, 29)), 3000)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 5, 22, 30)), 2200)
})

test("the temperature chosen after bedtime is the bedtime one", () => {
  const s = bedNight()
  assert.deepStrictEqual(Model.temperaturePatch(s, place, 2700, at(2026, 11, 5, 22)), { temperature: 2700 })
  assert.deepStrictEqual(Model.temperaturePatch(s, place, 1900, at(2026, 11, 5, 22, 40)), { bedtimeTemperature: 1900 })
  assert.strictEqual(Model.bedtimeReached(s, place, at(2026, 11, 5, 22, 29)), false)
  assert.strictEqual(Model.bedtimeReached(s, place, at(2026, 11, 5, 22, 30)), true)
  assert.strictEqual(Model.bedtimeReached(s, place, at(2026, 11, 6, 12)), false, "not in the day")
})

test("a night with bedtime steps evenly and still checks about once a minute", () => {
  const s = bedNight()
  const day = simulate(s, place, at(2026, 11, 5, 12), at(2026, 11, 6, 12))
  steadySteps(day, s)
  assert.ok(day.checks.length < 1600, day.checks.length + " checks")
  const bedFade = day.steps.filter((x) => x.at > at(2026, 11, 5, 22, 29) && x.at <= at(2026, 11, 5, 23, 31))
  assert.ok(bedFade.length >= 30 && bedFade.length <= 50, bedFade.length + " steps from 3000K to 2200K")
  assert.strictEqual(bedFade[bedFade.length - 1].to, 2200)
  assert.ok(bedFade[bedFade.length - 1].at - at(2026, 11, 5, 23, 30) < 2000, "lands as the fade ends")
  assert.strictEqual(day.last, Model.OFF_TEMP)
})

test("bedtime overlapping the warm-up or the clear-down still steps evenly", () => {
  const early = bedNight({ bedtimeAt: "21:30" })
  steadySteps(simulate(early, place, at(2026, 11, 5, 20, 50), at(2026, 11, 5, 23)), early)
  const short = bedNight({ onTime: "21:00", offTime: "23:00", fadeOut: 45 })
  const run = simulate(short, place, at(2026, 11, 5, 20, 50), at(2026, 11, 5, 23, 10))
  steadySteps(run, short)
  assert.strictEqual(run.last, Model.OFF_TEMP)
  const deep = bedNight({ bedtimeTemperature: 1000, fadeIn: 30 })
  steadySteps(simulate(deep, place, at(2026, 11, 5, 22), at(2026, 11, 5, 23, 30)), deep)
})

test("bedtime on the night the clocks go back", () => {
  // Saturday 31 October: a weekend night, so bedtime is 23:30; at 02:00 the clocks go back to 01:00.
  const s = bedNight()
  assert.strictEqual(Model.bedtimeAt(s, place, at(2026, 10, 31, 23)).start, at(2026, 10, 31, 23, 30))
  const run = simulate(s, place, at(2026, 10, 31, 20), at(2026, 11, 1, 8))
  steadySteps(run, s)
  assert.strictEqual(Model.kelvinAt(s, place, at(2026, 11, 1, 1, 30)), 2200)
  assert.strictEqual(run.last, Model.OFF_TEMP)
  const late = bedNight({ bedtimeAt: "01:30", weekendDelay: 0 })
  const lateRun = simulate(late, place, at(2026, 10, 31, 20), at(2026, 11, 1, 8))
  steadySteps(lateRun, late)
  assert.ok(lateRun.steps.some((x) => x.to === 2200), "reaches the bedtime level")
})

test("nothing due is ever in the past, with bedtime too", () => {
  const all = [bedNight(), bedNight({ bedtimeAt: "00:30", ramp: false }), bedNight({ mode: "sun", bedtimeAt: "16:00" }),
    bedNight({ mode: "sun", sunsetOffset: 120, fadeIn: 180, bedtimeAt: "18:00" }), bedNight({ onTime: "18:00", offTime: "22:00" })]
  for (const s of all) {
    for (let minute = 0; minute < 2880; minute += 7) {
      const now = at(2026, 11, 5, 0, minute) + 1234
      const due = Model.nextDueAt(s, place, now, [420])
      assert.ok(due !== null && due > now, s.mode + " " + s.bedtimeAt + " at minute " + minute)
    }
  }
})

// ---- Late-night dimming -------------------------------------------------------------

const dimNight = (patch) => settings(Object.assign({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000,
  dim: true, dimFrom: "23:30", dimPercent: 80, fadeIn: 60, fadeOut: 30 }, patch))

// Checks as the service makes them, recording each change of gamma.
function simulateGamma(s, location, from, to) {
  let now = from
  let last = null
  const checks = []
  const changes = []
  while (now < to) {
    checks.push(now)
    const gamma = Model.gammaAt(s, location, now)
    if (gamma !== last) {
      changes.push({ at: now, from: last, to: gamma })
      last = gamma
    }
    const due = Model.nextDueAt(s, location, now, [])
    now += Math.max(1000, Math.min(due === null ? Model.CHECK_MS : due - now + 250, Model.CHECK_MS))
  }
  return { checks, changes, last }
}

test("dimming is off by default and leaves gamma alone", () => {
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00" })
  assert.deepStrictEqual([s.dim, s.dimFrom, s.dimPercent], [false, "23:30", 80])
  for (let hour = 0; hour < 24; hour++) assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 5, hour, 45)), Model.FULL_GAMMA)
})

test("dimming settings are checked and clamped field by field", () => {
  const s = settings({ dim: 1, dimFrom: "noon", dimPercent: 10 })
  assert.deepStrictEqual([s.dim, s.dimFrom, s.dimPercent], [false, "23:30", Model.MIN_DIM_PERCENT])
  assert.strictEqual(settings({ dimPercent: 150 }).dimPercent, Model.FULL_GAMMA)
})

test("dimming eases in from its time and out with the clear-down", () => {
  const s = dimNight()
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 5, 23, 29)), 100)
  assert.strictEqual(Model.nextDueAt(s, place, at(2026, 11, 5, 23, 20), []), at(2026, 11, 5, 23, 30), "a check when it starts")
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 5, 23, 30)), 100)
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 5, 23, 37) + 30000), 90, "halfway through 15 minutes")
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 5, 23, 45)), 80)
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 6, 3)), 80)
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 6, 6, 45)), 90, "halfway through the clear-down")
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 6, 7)), 100)
  assert.strictEqual(Model.gammaAt(s, place, at(2026, 11, 6, 12)), 100)
})

test("dimming eases a percent at a time and adds checks only while it moves", () => {
  const s = dimNight()
  const night = simulateGamma(s, place, at(2026, 11, 5, 12), at(2026, 11, 6, 12))
  for (const x of night.changes.slice(1)) assert.ok(Math.abs(x.to - x.from) <= 1, "a jump of " + (x.to - x.from) + "% at " + new Date(x.at))
  assert.strictEqual(night.last, 100)
  const plain = simulate(settings(Object.assign({}, s, { dim: false })), place, at(2026, 11, 5, 12), at(2026, 11, 6, 12))
  const extra = night.checks.length - plain.checks.length
  assert.ok(extra >= 0 && extra <= 25, extra + " extra checks a day")
  const steady = (run) => run.checks.filter((t) => t >= at(2026, 11, 6, 0) && t < at(2026, 11, 6, 6)).length
  assert.strictEqual(steady(night), steady(plain), "none once it's dimmed")
})

test("dimming at once with Gradual off, and from the start when its time has passed", () => {
  const instant = dimNight({ ramp: false })
  assert.strictEqual(Model.gammaAt(instant, place, at(2026, 11, 5, 23, 30)), 80)
  assert.strictEqual(Model.gammaAt(instant, place, at(2026, 11, 6, 6, 59)), 80)
  assert.strictEqual(Model.gammaAt(instant, place, at(2026, 11, 6, 7)), 100)
  const early = dimNight({ dimFrom: "20:00" })
  assert.strictEqual(Model.dimAt(early, place, at(2026, 11, 5, 21, 5)).start, at(2026, 11, 5, 21))
  assert.strictEqual(Model.gammaAt(early, place, at(2026, 11, 5, 21, 15)), 80)
  const late = dimNight({ dimFrom: "01:00" })
  assert.strictEqual(Model.dimAt(late, place, at(2026, 11, 5, 22)).start, at(2026, 11, 6, 1))
  assert.strictEqual(Model.dimAt(dimNight({ onTime: "18:00", offTime: "23:00" }), place, at(2026, 11, 5, 22)), null, "after the night ends")
})

test("dimming needs the night light on: not off, paused, in Manual mode or in Movie mode", () => {
  const s = dimNight()
  const deep = at(2026, 11, 6, 2)
  assert.strictEqual(Model.gammaAt(s, place, deep, true), 100, "a paused app gets full brightness")
  const off = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 6, 1), "off", 120)))
  assert.strictEqual(Model.gammaAt(off, place, deep), 100)
  const warm = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 6, 1), "on", 120)))
  assert.strictEqual(Model.gammaAt(warm, place, deep), 80, "a warm hold keeps it")
  const film = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 6, 1), "movie")))
  assert.strictEqual(Model.gammaAt(film, place, deep), 100)
  assert.strictEqual(Model.gammaAt(dimNight({ mode: "manual", manualOn: true }), place, deep), 100)
})

test("a short night eases in and clears down without a jump", () => {
  const s = dimNight({ onTime: "23:00", offTime: "23:50", fadeOut: 30 })
  const run = simulateGamma(s, place, at(2026, 11, 5, 22, 50), at(2026, 11, 6, 0))
  for (const x of run.changes.slice(1)) assert.ok(Math.abs(x.to - x.from) <= 1, (x.from + " to " + x.to))
  assert.strictEqual(run.last, 100)
})

test("nothing due is ever in the past, with dimming too", () => {
  const all = [dimNight(), dimNight({ ramp: false, dimFrom: "01:00" }), dimNight({ mode: "sun", dimFrom: "16:00" }),
    dimNight({ bedtime: true, dimFrom: "22:30" }), dimNight({ dimPercent: 100 })]
  for (const s of all) {
    for (let minute = 0; minute < 2880; minute += 7) {
      const now = at(2026, 11, 5, 0, minute) + 1234
      const due = Model.nextDueAt(s, place, now, [420])
      assert.ok(due !== null && due > now, s.mode + " " + s.dimFrom + " at minute " + minute)
    }
  }
})

// ---- The 24-hour view ---------------------------------------------------------------

test("the view's colours run from white to red as the temperature drops", () => {
  const white = Model.kelvinColor(Model.OFF_TEMP)
  assert.ok(white.r === 1 && white.g > 0.97 && white.b > 0.95, JSON.stringify(white))
  let previous = null
  for (const kelvin of [6500, 5000, 4000, 3000, 2200, 1500, 1000, 750, 500]) {
    const c = Model.kelvinColor(kelvin)
    for (const channel of ["r", "g", "b"]) assert.ok(c[channel] >= 0 && c[channel] <= 1)
    assert.strictEqual(c.r, 1, kelvin + "K keeps full red")
    if (previous) assert.ok(c.g <= previous.g && c.b <= previous.b, kelvin + "K is no bluer or greener than the one before")
    previous = c
  }
  assert.strictEqual(Model.kelvinColor(500).g, 0, "only red at the shader's end")
  assert.strictEqual(Model.kelvinColor(1500).b, 0)
})

test("the view's strength grows with the tint and is full at the night's temperature", () => {
  assert.strictEqual(Model.viewStrength(Model.OFF_TEMP, 3000), 0)
  assert.strictEqual(Model.viewStrength(3000, 3000), 1)
  assert.strictEqual(Model.viewStrength(2200, 3000), 1)
  const half = Model.viewStrength(1000000 / ((1000000 / 6500 + 1000000 / 3000) / 2), 3000)
  assert.ok(Math.abs(half - 0.5) < 1e-9, "even to the eye: " + half)
  assert.ok(Model.viewStrength(5000, 3000) < 0.3, "Movie mode shows faint")
})

test("the view runs noon to noon around the night", () => {
  assert.strictEqual(Model.viewStart(at(2026, 11, 5, 15)), at(2026, 11, 5, 12))
  assert.strictEqual(Model.viewStart(at(2026, 11, 6, 2)), at(2026, 11, 5, 12))
  assert.strictEqual(Model.viewStart(at(2026, 11, 5, 12)), at(2026, 11, 5, 12))
  const s = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", temperature: 3000, bedtime: true, dim: true })
  const from = at(2026, 11, 5, 12)
  const samples = Model.daySamples(s, place, from, 5 * MIN, 288)
  assert.strictEqual(samples.length, 288)
  const sampleAt = (h, m) => samples[Math.round((at(2026, 11, h < 12 ? 6 : 5, h, m) - from) / (5 * MIN))]
  assert.deepStrictEqual(sampleAt(15, 0), { kelvin: Model.OFF_TEMP, gamma: 100 })
  assert.ok(sampleAt(21, 30).kelvin < Model.OFF_TEMP && sampleAt(21, 30).kelvin > 3000, "warming up")
  assert.deepStrictEqual(sampleAt(2, 0), { kelvin: 2200, gamma: 80 }, "bedtime and dimming")
  assert.deepStrictEqual(sampleAt(8, 0), { kelvin: Model.OFF_TEMP, gamma: 100 })
  // A hold shows as what will happen: off until it ends.
  const held = settings(Object.assign({}, s, Model.holdPatch(s, place, at(2026, 11, 5, 15), "morning")))
  assert.ok(Model.daySamples(held, place, from, 5 * MIN, 288).every((x) => x.kelvin === Model.OFF_TEMP))
})

test("the view paints fades as a growing tint in the night's colour, darker where dimmed", () => {
  assert.strictEqual(Model.viewPaint({ kelvin: Model.OFF_TEMP, gamma: 100 }, 3000).a, 0)
  const night = Model.kelvinColor(3000)
  for (const kelvin of [6000, 5000, 4000, 3000]) {
    const paint = Model.viewPaint({ kelvin, gamma: 100 }, 3000)
    assert.deepStrictEqual([paint.r, paint.g, paint.b], [night.r, night.g, night.b], kelvin + "K: no lighter seam")
  }
  const bed = Model.viewPaint({ kelvin: 2200, gamma: 100 }, 3000)
  assert.ok(bed.g < night.g && bed.a === 1, "bedtime shows deeper")
  const dimmed = Model.viewPaint({ kelvin: 2200, gamma: 80 }, 3000)
  assert.ok(Math.abs(dimmed.r - 0.8 * bed.r) < 1e-9 && Math.abs(dimmed.g - 0.8 * bed.g) < 1e-9)
})

// ---- Fades that follow twilight ----------------------------------------------------

const dusky = (patch) => settings(Object.assign({ mode: "sun", temperature: 3000, twilight: true, fadeIn: 60, fadeOut: 30 }, patch))

test("twilight fades are off by default", () => {
  assert.strictEqual(settings({}).twilight, false)
  assert.strictEqual(settings({ twilight: "yes" }).twilight, false)
  const sun = sunsetOn(5)
  assert.strictEqual(Model.rampAt(settings({ mode: "sun" }), place, sun.sunset + 10 * MIN).lengthMs, 60 * MIN)
})

test("with twilight, the warm-up runs from sunset to civil dusk and the clear-down from civil dawn", () => {
  const s = dusky()
  const day = at(2026, 11, 5, 12)
  const sun = Model.sunTimes(day, place.latitude, place.longitude)
  const civil = Model.twilightTimes(day, place.latitude, place.longitude)
  const twilight = civil.dusk - sun.sunset
  assert.ok(twilight > 25 * MIN && twilight < 33 * MIN, "about half an hour in November: " + twilight / MIN)
  const warming = Model.rampAt(s, place, sun.sunset + 10 * MIN)
  assert.strictEqual(warming.lengthMs, twilight)
  assert.strictEqual(Model.kelvinAt(s, place, civil.dusk), 3000, "fully warm at dusk")
  assert.ok(Model.kelvinAt(s, place, civil.dusk - MIN) > 3000)
  const morning = Model.sunTimes(at(2026, 11, 6, 12), place.latitude, place.longitude).sunrise
  const dawn = Model.twilightTimes(at(2026, 11, 6, 12), place.latitude, place.longitude).dawn
  assert.strictEqual(Model.nextDueAt(s, place, dawn - 20 * MIN, []), dawn, "a check as the clear-down starts")
  assert.strictEqual(Model.kelvinAt(s, place, dawn - MIN), 3000)
  assert.strictEqual(Model.rampAt(s, place, dawn + MIN).lengthMs, morning - dawn)
  assert.strictEqual(Model.kelvinAt(s, place, morning), Model.OFF_TEMP)
})

test("twilight is longer in June than in March, and Start before sunset adds to the warm-up", () => {
  const length = (y, mo, d) => {
    const t = at(y, mo, d, 12)
    return Model.twilightTimes(t, place.latitude, place.longitude).dusk - Model.sunTimes(t, place.latitude, place.longitude).sunset
  }
  assert.ok(length(2026, 6, 21) > length(2026, 3, 20) + 3 * MIN)
  const early = dusky({ sunsetOffset: 60 })
  const day = at(2026, 11, 5, 12)
  const start = Model.sunTimes(day, place.latitude, place.longitude).sunset - 60 * MIN
  assert.strictEqual(Model.rampAt(early, place, start + MIN).lengthMs, Model.twilightTimes(day, place.latitude, place.longitude).dusk - start)
})

test("where twilight never ends, or the night starts after dusk, the set lengths apply", () => {
  const far = { latitude: 64, longitude: -21, source: "custom", label: "" }
  assert.ok(Number.isNaN(Model.twilightTimes(at(2026, 6, 21, 12), far.latitude, far.longitude).dusk))
  const s = dusky()
  const lengths = Model.fadeLengths(s, far, at(2026, 6, 21, 12))
  assert.deepStrictEqual(lengths, { inMs: 60 * MIN, outMs: 30 * MIN })
  const late = dusky({ sunsetOffset: -60 })
  const start = Model.sunTimes(at(2026, 11, 5, 12), place.latitude, place.longitude).sunset + 60 * MIN
  assert.strictEqual(Model.rampAt(late, place, start + MIN).lengthMs, 60 * MIN, "starting an hour after sunset is past dusk")
})

test("twilight is for Sun mode only", () => {
  const custom = settings({ mode: "custom", onTime: "21:00", offTime: "07:00", twilight: true })
  assert.strictEqual(Model.rampAt(custom, place, at(2026, 11, 5, 21, 10)).lengthMs, 60 * MIN)
  assert.deepStrictEqual(Model.fadeLengths(custom, place, at(2026, 11, 5, 15)), { inMs: 60 * MIN, outMs: 30 * MIN })
})

test("a hold ending at a twilight night's start skips that warm-up", () => {
  const s = dusky()
  const day = at(2026, 11, 5, 12)
  const sunset = Model.sunTimes(day, place.latitude, place.longitude).sunset
  const patch = Model.holdEndPatch({ on: true, until: sunset }, s, place)
  assert.strictEqual(patch.rampSkipUntil, Model.twilightTimes(day, place.latitude, place.longitude).dusk)
})

test("twilight fades step evenly and keep the checks down", () => {
  const s = dusky()
  const run = simulate(s, place, at(2026, 11, 5, 12), at(2026, 11, 6, 12))
  for (const x of run.steps) if (x.from !== null) assert.ok(miredGap(x.from, x.to) <= 5, x.from + " to " + x.to)
  assert.ok(run.checks.length < 1600, run.checks.length + " checks")
  assert.strictEqual(run.last, Model.OFF_TEMP)
  const june = simulate(s, place, at(2026, 6, 21, 12), at(2026, 6, 22, 12))
  for (const x of june.steps) if (x.from !== null) assert.ok(miredGap(x.from, x.to) <= 5)
  for (let minute = 0; minute < 2880; minute += 7) {
    const now = at(2026, 11, 5, 0, minute) + 1234
    const due = Model.nextDueAt(s, place, now, [420])
    assert.ok(due !== null && due > now, "nothing due in the past at minute " + minute)
  }
})

// ---- Location by city name ------------------------------------------------------------

test("the location field takes coordinates, a city, or nothing", () => {
  assert.deepStrictEqual(Model.locationRequest(""), { kind: "clear" })
  assert.deepStrictEqual(Model.locationRequest("   "), { kind: "clear" })
  assert.deepStrictEqual(Model.locationRequest("52.52, 13.40"), { kind: "coordinates", latitude: 52.52, longitude: 13.4 })
  assert.deepStrictEqual(Model.locationRequest("  Berlin "), { kind: "city", query: "Berlin" })
  assert.deepStrictEqual(Model.locationRequest("São Paulo"), { kind: "city", query: "São Paulo" })
  assert.strictEqual(Model.locationRequest("95, 200"), null, "numbers off the Earth are a typo, not a city")
  assert.strictEqual(Model.locationRequest("x".repeat(65)), null)
  assert.strictEqual(Model.locationRequest("Ber\nlin"), null)
})

test("a geocoding answer gives the first place, named briefly and safely", () => {
  const berlin = JSON.stringify({ results: [{ name: "Berlin", latitude: 52.52437, longitude: 13.41053, country: "Germany", admin1: "State of Berlin" }] })
  assert.deepStrictEqual(Model.geocodeResult(berlin), { latitude: 52.52437, longitude: 13.41053, name: "Berlin, Germany" })
  assert.strictEqual(Model.geocodeResult(JSON.stringify({ generationtime_ms: 0.2 })), null, "nothing found")
  assert.strictEqual(Model.geocodeResult("<html>"), null)
  assert.strictEqual(Model.geocodeResult(JSON.stringify({ results: [{ name: "Nowhere", latitude: 123, longitude: 0 }] })), null)
  const sly = Model.geocodeResult(JSON.stringify({ results: [{ name: "<b>Town</b>", latitude: 1, longitude: 2 }] }))
  assert.ok(!/[<>]/.test(sly.name), sly.name)
  assert.strictEqual(Model.geocodeResult(JSON.stringify({ results: [{ name: "Island", latitude: 1, longitude: 2 }] })).name, "Island", "no country")
})

test("a found city's name shows with its coordinates and stays in the state file", () => {
  const s = settings({ latitude: 52.52, longitude: 13.41, placeName: "Berlin, Germany" })
  assert.strictEqual(Model.resolveLocation(s, null, null).label, "Berlin, Germany")
  assert.strictEqual(Model.splitSettings(s).state.placeName, "Berlin, Germany")
  assert.ok(!("placeName" in Model.splitSettings(s).settings))
  assert.strictEqual(settings({ placeName: "Berlin" }).placeName, "", "no name without coordinates")
  assert.strictEqual(settings({ latitude: 1, longitude: 2, placeName: "<i>x</i>" }).placeName.indexOf("<"), -1)
})
