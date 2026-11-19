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
