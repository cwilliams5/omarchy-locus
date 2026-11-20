import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import qs.Commons
import "Model.js" as Model
import "Registry.js" as Registry

// The single night light brain, one per shell however many bars are showing the
// button. It owns the settings and the schedule, and is the only part of the
// plugin that talks to hyprsunset.
//
// The screen follows Model.kelvinAt, which is steady except during a ramp. If
// `omarchy toggle nightlight` or a hand-typed hyprctl command changes it, that is
// noticed and stays put until the next scheduled change, even in mid-ramp.
//
// Every check looks at hyprsunset first and only then decides what to send
// (step), so nothing Locus sends can overwrite a change it hasn't seen yet.
// Checks happen when something is due (Model.nextDueAt) and at least once a
// minute, more often only while the panel is open or hyprsunset is starting.
Item {
  id: root

  Component.onCompleted: Registry.service = root
  Component.onDestruction: if (Registry.service === root) Registry.service = null

  readonly property int minTemp: Model.MIN_TEMP
  readonly property int maxTemp: Model.MAX_TEMP
  readonly property int previewMilliseconds: 10000
  readonly property string home: Quickshell.env("HOME")
  readonly property string settingsDirectory: home + "/.local/state/omarchy/settings"
  // Cody's choices, tracked by his dotfiles. Holds, the manual switch and typed
  // coordinates go in the state file instead: they change by themselves or are
  // private, so they never reach the dotfiles, and a hold never rewrites this.
  readonly property string settingsPath: settingsDirectory + "/locus.json"
  readonly property string statePath: settingsDirectory + "/locus-state.json"
  // Sundown, which Locus was forked from, kept its settings here. Read once, the
  // first time Locus runs, so switching over keeps them.
  readonly property string sundownSettingsPath: settingsDirectory + "/heliotrope.json"

  // A city typed into the panel is looked up once (Open-Meteo's geocoding),
  // never in the background: "searching", "notfound" or "failed" while the
  // panel should say so, "" otherwise.
  property string lookupState: ""
  property string lookupQuery: ""
  signal lookupFinished(bool found)

  // The icon asks for the panel through here; Panel.qml answers.
  signal panelToggleRequested(var window)
  // The icon holds the bar's hover peek open while this is true.
  property bool panelOpen: false

  property var settings: Model.normalizeSettings(null)
  property bool settingsLoaded: false
  // Each file as last read or written (parsed), whether it was read empty, and
  // its half as last saved, so a file is written only when its own half changed.
  property var settingsRaw: null
  property var stateRaw: null
  property bool settingsHalfLoaded: false
  property bool stateHalfLoaded: false
  property bool settingsHalfEmpty: false
  property bool stateHalfEmpty: false
  property string writtenSettingsJson: ""
  property string writtenStateJson: ""
  property bool directoryReady: false
  property bool settingsSecured: false

  property var weather: null
  property string zone: ""
  property var zoneLocation: null
  readonly property var location: Model.resolveLocation(settings, weather, zoneLocation)
  // Nothing happens to the screen until these have answered, or a restart at
  // night would briefly clear the tint while the location loads.
  property bool weatherChecked: false
  property bool zoneNameChecked: false
  property bool zoneTableChecked: false
  readonly property bool locationChecked: weatherChecked && zoneNameChecked && zoneTableChecked

  property var plan: ({ on: false, until: 0 })
  // Bedtime has come tonight, so the slider and presets set the bedtime level.
  // Worked out on each check, since it depends on the clock.
  property bool bedtimeNow: false
  // The fades of the night under way or the next one, in minutes: with
  // twilight they change with the date.
  property int fadeInNow: 0
  property int fadeOutNow: 0
  property real sunrise: 0
  property real sunset: 0

  // What hyprsunset last reported; null while it is not answering.
  property var actualTemp: null
  // Tinting while the plan says off, so it can be seen. Clears by itself.
  property bool previewing: false

  property var lastPlanOn: null
  // The temperature tick() last sent, to spot the next ramp step.
  property var lastLevel: null
  // Something else set the temperature, so ramp steps wait for the next change.
  property bool externalHold: false
  // setSwitch fades for itself, so tick() leaves the screen alone meanwhile.
  property bool switching: false
  property int fadeFrom: 0
  property int fadeTarget: 0
  property real fadeStart: 0
  property real lastTickAt: 0
  property bool detectSucceeded: false
  property int applyTarget: 0
  property bool applySettled: true
  property int applyAttempts: 0
  property int queuedTarget: 0
  property real lastStartAttempt: 0
  property bool shaderQueued: false
  // The step warm-shader.sh last applied, and the one it is applying now. -1
  // until a run has worked, so the first check clears a shader an earlier shell
  // left on the screen.
  property int shaderStep: -1
  property int shaderRunStep: 0
  readonly property string shaderScript: String(Qt.resolvedUrl("warm-shader.sh")).replace(/^file:\/\//, "")

  // Late-night dimming: the gamma last set (a whole percent), or null when not
  // known. Nothing else in Omarchy sets gamma, so it isn't read back on every
  // check; a restarted hyprsunset starts at 100, and a hyprsunset.conf switch
  // sets its own, so those reset it. Sent only when the wanted value changes.
  property var gammaSent: null
  property int gammaRunValue: 100
  property bool gammaQueued: false
  property var fadeGammaFrom: null

  // hyprsunset.conf's own switch times (Omarchy's goes neutral at 07:00), so a
  // change they make is put right promptly instead of taken for a hand.
  property var profiles: ({ minutes: [], values: [] })
  property real lastLookAt: 0
  property real profileGraceUntil: 0
  // When the next check is due, for the status command.
  property real nextCheckAt: 0

  // The app in front, and whether it's really fullscreen. Hyprland reports a
  // maximized window as fullscreen 1 and a real one with bit 2 set, so only bit
  // 2 counts, as in Omarchy's own bar.
  readonly property var frontWindow: ToplevelManager.activeToplevel
  readonly property string frontApp: frontWindow ? String(frontWindow.appId || "") : ""
  readonly property bool frontFullscreen: {
    var window = Hyprland.activeToplevel
    var ipc = window ? window.lastIpcObject : null
    return !!ipc && (Number(ipc.fullscreen) & 2) !== 0
  }
  readonly property bool pausedNow: settingsLoaded && Model.pausedFor(settings, frontApp, frontFullscreen)
  readonly property string frontLabel: Model.displayName(frontApp)
  readonly property bool frontAppPausable: Model.cleanAppName(frontApp) !== null
  readonly property bool frontAppListed: frontAppPausable
    && settings.pauseApps.some(function(app) { return app.toLowerCase() === frontApp.toLowerCase() })

  // Counts as on through the first, barely tinted part of a ramp, and shows where
  // a fade is heading so the switch doesn't flicker.
  readonly property bool nightOn: fadeTimer.running
    ? fadeTarget < Model.FRESH_TEMP
    : actualTemp !== null && (actualTemp < Model.FRESH_TEMP || (plan.on && !externalHold && !pausedNow))
  // The switch shows the schedule's answer, so it stays on while a paused app
  // keeps the screen neutral.
  readonly property bool switchOn: (nightOn || (pausedNow && plan.on && !externalHold)) && !(previewing && !plan.on)
  readonly property string mode: settings.mode
  readonly property int temperature: settings.temperature
  readonly property string onTime: settings.onTime
  readonly property string offTime: settings.offTime
  readonly property bool ramp: settings.ramp
  readonly property bool autoLocation: settings.autoLocation
  readonly property int sunsetOffset: settings.sunsetOffset
  readonly property int fadeIn: settings.fadeIn
  readonly property int fadeOut: settings.fadeOut
  readonly property bool pauseFullscreen: settings.pauseFullscreen
  readonly property var pauseApps: settings.pauseApps
  readonly property bool holding: settings.override !== null
  // A hold with its own, milder temperature.
  readonly property bool movie: holding && settings.override.temperature !== undefined
  readonly property int movieTemp: Model.MOVIE_TEMP
  readonly property var presets: Model.PRESETS
  // The temperature the slider shows and sets: the bedtime one once bedtime has come.
  readonly property int activeTemperature: bedtimeNow ? settings.bedtimeTemperature : settings.temperature
  // The preset that temperature matches, or "".
  readonly property string preset: Model.presetName(activeTemperature)
  readonly property bool bedtime: settings.bedtime
  readonly property string bedtimeAt: settings.bedtimeAt
  readonly property int bedtimeTemperature: settings.bedtimeTemperature
  readonly property int weekendDelay: settings.weekendDelay
  readonly property bool dim: settings.dim
  readonly property string dimFrom: settings.dimFrom
  readonly property int dimPercent: settings.dimPercent
  readonly property bool twilight: settings.twilight
  // Twilight fades apply in Sun mode with a location.
  readonly property bool followsTwilight: twilight && mode === "sun" && location !== null
  // Following a schedule, rather than the switch alone.
  readonly property bool scheduled: mode !== "manual" && !(mode === "sun" && location === null)
  // "Off until morning" needs a schedule to know when morning is.
  readonly property bool canHoldUntilMorning: scheduled

  onPausedNowChanged: tick()
  onPanelOpenChanged: tick()

  function updateSettings(patch) {
    // Saving before the file has loaded would replace it with the defaults.
    if (!settingsLoaded) {
      console.warn("locus: settings not loaded yet, ignoring change")
      return
    }
    var next = {}
    for (var key in settings) next[key] = settings[key]
    for (var changed in patch) next[changed] = patch[changed]
    settings = Model.normalizeSettings(next)
    saveHalves(false, false)
    tick()
  }

  // Writes each file only when its half changed, or when forced: a file just
  // created empty, or the one-time split of the old single file.
  function saveHalves(forceSettings, forceState) {
    var parts = Model.splitSettings(settings)
    var settingsJson = JSON.stringify(parts.settings)
    var stateJson = JSON.stringify(parts.state)
    if (forceSettings || settingsJson !== writtenSettingsJson) {
      writtenSettingsJson = settingsJson
      settingsRaw = parts.settings
      settingsFile.setText(JSON.stringify(parts.settings, null, 2) + "\n")
    }
    if (forceState || stateJson !== writtenStateJson) {
      writtenStateJson = stateJson
      stateRaw = parts.state
      stateFile.setText(JSON.stringify(parts.state, null, 2) + "\n")
    }
  }

  function setMode(value) {
    updateSettings(Model.modePatch(settings, value, switchOn))
  }

  function setSwitch(turnOn) {
    if (!settingsLoaded) return
    switchTo(Model.switchPatch(settings, location, Date.now(), turnOn))
  }

  // A hold from the panel or the command line: "off" or "on" for some minutes,
  // "morning" or "clear" (Model.holdPatch). False when it doesn't apply.
  function hold(kind, minutes) {
    if (!settingsLoaded) return false
    var patch = Model.holdPatch(settings, location, Date.now(), kind, minutes)
    if (!patch) return false
    switchTo(patch)
    return true
  }

  // Saves a change to the switch or a hold, then fades to where it leaves the screen.
  function switchTo(patch) {
    previewTimer.stop()
    previewing = false
    externalHold = false
    switching = true
    updateSettings(patch)
    switching = false
    lastPlanOn = wantOn()
    // Also covers a switch that already matched the plan, like after the menu's toggle.
    var level = currentLevel()
    lastLevel = level
    fadeTo(level)
  }

  function preview(kelvin) {
    if (!settingsLoaded) return
    var clamped = Model.clampTemp(kelvin)
    fadeTimer.stop()
    // In mid-ramp a preview has to end too, or the next step would snap it back early.
    if (plan.on && currentLevel() === Model.restingKelvin(settings, location, Date.now())) {
      previewing = false
    } else {
      previewing = true
      previewTimer.restart()
    }
    apply(clamped)
  }

  // The temperature showing now: the bedtime one once bedtime has come. In Movie
  // mode this also ends the milder temperature, keeping the hold's end.
  function setTemperature(kelvin) {
    var clamped = Model.clampTemp(kelvin)
    externalHold = false
    updateSettings(Model.temperaturePatch(settings, location, clamped, Date.now()))
    preview(clamped)
  }

  // True when it's a preset's name.
  function setPreset(name) {
    var kelvin = Model.presetKelvin(name)
    if (kelvin === null) return false
    setTemperature(kelvin)
    return true
  }

  // Coordinates, a city to look up, or empty for the automatic location.
  // "ok" when saved, "searching" while a city is looked up (lookupFinished
  // follows), "invalid" when it can't be either.
  function setLocation(text) {
    var request = Model.locationRequest(text)
    if (!request) return "invalid"
    if (request.kind !== "city") {
      geocodeProcess.running = false
      lookupState = ""
      if (request.kind === "clear") updateSettings({ latitude: null, longitude: null, placeName: "" })
      else updateSettings({ latitude: request.latitude, longitude: request.longitude, placeName: "" })
      return "ok"
    }
    geocodeProcess.running = false
    lookupQuery = request.query
    lookupState = "searching"
    // The name goes to curl as an argument, never through a shell; "name="
    // keeps --data-urlencode from reading a file for a name starting with @.
    geocodeProcess.command = ["curl", "-fsS", "--max-time", "6", "--get",
      "--data-urlencode", "name=" + request.query,
      "--data", "count=1", "--data", "language=en", "--data", "format=json",
      "https://geocoding-api.open-meteo.com/v1/search"]
    geocodeProcess.running = true
    return "searching"
  }

  // Empty means the request failed (offline, or an error from the service).
  function handleGeocode(text) {
    if (lookupState !== "searching") return
    if (String(text).trim() === "") {
      lookupState = "failed"
      lookupFinished(false)
      return
    }
    var place = Model.geocodeResult(text)
    if (!place) {
      lookupState = "notfound"
      lookupFinished(false)
      return
    }
    lookupState = ""
    updateSettings({ latitude: place.latitude, longitude: place.longitude, placeName: place.name })
    lookupFinished(true)
  }

  function setRamp(enabled) {
    updateSettings({ ramp: enabled })
  }

  // Turning it off forgets the detected place along with the lookups.
  function setAutoLocation(enabled) {
    if (enabled) {
      updateSettings({ autoLocation: true })
      detectLocation()
    } else {
      updateSettings({ autoLocation: false, detected: null })
    }
  }

  function detectLocation() {
    if (!settingsLoaded || !settings.autoLocation || detectProcess.running) return
    detectProcess.running = true
  }

  // A failed lookup keeps the last place, so this works offline.
  function handleDetected(text) {
    var place = Model.weatherLocation(text)
    detectSucceeded = place !== null
    if (settings.autoLocation && Model.movedFar(settings.detected, place))
      updateSettings({ detected: place })
  }

  function setTime(key, text) {
    var patch = {}
    patch[key] = text
    updateSettings(patch)
  }

  // onTime, offTime or bedtimeAt.
  function stepTime(key, deltaMinutes) {
    setTime(key, Model.stepTime(settings[key], deltaMinutes))
  }

  function setBedtime(enabled) {
    updateSettings({ bedtime: enabled === true })
  }

  function setBedtimeTemperature(kelvin) {
    updateSettings({ bedtimeTemperature: Model.clampTemp(kelvin) })
  }

  function stepBedtimeTemperature(deltaKelvin) {
    setBedtimeTemperature(bedtimeTemperature + deltaKelvin)
  }

  // How much later bedtime is when the night starts on a Friday or Saturday.
  function setWeekendDelay(minutes) {
    updateSettings({ weekendDelay: Number(minutes) })
  }

  function stepWeekendDelay(deltaMinutes) {
    setWeekendDelay(weekendDelay + deltaMinutes)
  }

  function setTwilight(enabled) {
    updateSettings({ twilight: enabled === true })
  }

  function setDim(enabled) {
    updateSettings({ dim: enabled === true })
  }

  // How bright the screen gets at its dimmest, 50 to 100 percent.
  function setDimPercent(percent) {
    updateSettings({ dimPercent: Number(percent) })
  }

  function stepDimPercent(delta) {
    setDimPercent(dimPercent + delta)
  }

  // Minutes before sunset that Sun mode turns on; negative is after it.
  function setSunsetOffset(minutes) {
    updateSettings({ sunsetOffset: Number(minutes) })
  }

  function stepSunsetOffset(deltaMinutes) {
    setSunsetOffset(sunsetOffset + deltaMinutes)
  }

  // Warm-up and clear-down lengths in minutes; 0 switches at once.
  function setFades(inMinutes, outMinutes) {
    updateSettings({ fadeIn: Number(inMinutes), fadeOut: Number(outMinutes) })
  }

  function stepFade(key, deltaMinutes) {
    var patch = {}
    patch[key] = (key === "fadeIn" ? fadeIn : fadeOut) + deltaMinutes
    updateSettings(patch)
  }

  function setPauseFullscreen(enabled) {
    updateSettings({ pauseFullscreen: enabled === true })
  }

  // True when saved; false for a name that can't be a window class.
  function setPausedApp(appClass, enabled) {
    if (Model.cleanAppName(appClass) === null) return false
    updateSettings({ pauseApps: Model.withPausedApp(settings, appClass, enabled) })
    return true
  }

  function toggleFrontApp() {
    if (frontAppPausable) setPausedApp(frontApp, !frontAppListed)
  }

  // Whether the screen should be warm now: the schedule (or a hold) says on,
  // and no paused app is in front.
  function wantOn() {
    return plan.on && !pausedNow
  }

  function endPreview() {
    if (!previewing) return
    previewTimer.stop()
    previewing = false
    externalHold = false
    lastLevel = currentLevel()
    apply(lastLevel)
  }

  // For the panel's 24-hour view: where it starts, and what the schedule does
  // across it (Model.daySamples). Worked out only while the panel is open.
  function dayView(nowMs, stepMs, count) {
    var from = Model.viewStart(nowMs)
    return { from: from, stepMs: stepMs, samples: Model.daySamples(settings, location, from, stepMs, count) }
  }

  function viewPaint(sample) { return Model.viewPaint(sample, settings.temperature) }

  function currentLevel() {
    return Model.kelvinAt(settings, location, Date.now(), pausedNow)
  }

  // A couple of seconds rather than a jump. Needs a temperature to start from, so
  // a hyprsunset that isn't answering is just told where to end up.
  function fadeTo(kelvin) {
    fadeTimer.stop()
    if (actualTemp === null || actualTemp === kelvin) {
      apply(kelvin)
      return
    }
    fadeFrom = actualTemp
    fadeTarget = kelvin
    fadeStart = Date.now()
    fadeGammaFrom = gammaSent
    fadeTimer.start()
  }

  function fadeStep() {
    var progress = (Date.now() - fadeStart) / Model.FADE_MS
    if (progress >= 1) fadeTimer.stop()
    apply(Model.mixKelvin(fadeFrom, fadeTarget, progress))
    syncGamma()
  }

  // Full brightness while something else holds the temperature; during the
  // switch's two-second fade, part way from where it was.
  function wantedGamma() {
    if (externalHold) return Model.FULL_GAMMA
    var target = Model.gammaAt(settings, location, Date.now(), pausedNow)
    if (fadeTimer.running && fadeGammaFrom !== null) {
      var progress = Math.min(1, (Date.now() - fadeStart) / Model.FADE_MS)
      return Math.round(fadeGammaFrom + (target - fadeGammaFrom) * progress)
    }
    return target
  }

  function syncGamma() {
    // A hyprsunset that isn't running has nothing to set, and starts at 100.
    if (actualTemp === null) return
    var want = wantedGamma()
    if (want === gammaSent) return
    if (gammaProcess.running) {
      gammaQueued = true
      return
    }
    gammaRunValue = want
    gammaProcess.command = ["hyprctl", "hyprsunset", "gamma", String(want)]
    gammaProcess.running = true
  }

  function tick() {
    if (!settingsLoaded || !locationChecked) return
    var now = Date.now()
    if (settings.override && now >= settings.override.until) {
      updateSettings(Model.holdEndPatch(settings.override, settings, location))
      return
    }

    // Asleep for a while, so this may be somewhere new.
    if (lastTickAt && now - lastTickAt > 300000) detectLocation()
    lastTickAt = now

    // The next of each, so the panel agrees with "on until" after today's has passed.
    if (location) {
      var today = Model.sunTimes(now, location.latitude, location.longitude)
      var tomorrow = Model.sunTimes(now + 86400000, location.latitude, location.longitude)
      sunrise = now < today.sunrise ? today.sunrise : tomorrow.sunrise
      sunset = now < today.sunset ? today.sunset : tomorrow.sunset
    } else {
      sunrise = 0
      sunset = 0
    }
    plan = Model.desiredState(settings, location, now)
    bedtimeNow = Model.bedtimeReached(settings, location, now)
    var lengths = Model.fadeLengths(settings, location, now)
    fadeInNow = Math.round(lengths.inMs / 60000)
    fadeOutNow = Math.round(lengths.outMs / 60000)
    // Look first; step() decides what to send once hyprsunset has answered. A
    // look already under way, or the one that follows a send, does the same.
    if (!probeProcess.running && !applyProcess.running) probeProcess.running = true
    syncShader()
    scheduleNext(now)
  }

  // What to send, now that hyprsunset's reading is known.
  function step() {
    if (switching || applyProcess.running || queuedTarget) return
    var level = currentLevel()
    var want = wantOn()
    if (lastPlanOn !== want) {
      // No fade the first time, or a restart at night would sweep up from nothing.
      var first = lastPlanOn === null
      lastPlanOn = want
      lastLevel = level
      externalHold = false
      previewTimer.stop()
      previewing = false
      if (first) apply(level)
      else fadeTo(level)
    } else if (!externalHold && !previewing && !fadeTimer.running
               && Model.isVisibleStep(lastLevel, level, Model.restingKelvin(settings, location, Date.now()))) {
      // A fade's next step goes straight on; a bigger jump, like waking up in the
      // middle of a fade or changing a setting during one, fades over 2 seconds.
      var jump = Model.isBigJump(lastLevel, level)
      lastLevel = level
      if (jump) fadeTo(level)
      else apply(level)
    }
    syncGamma()
  }

  // Sleep until the next thing is due, and never longer than a minute, so a
  // change made elsewhere (Omarchy's key, a restarted hyprsunset) is still seen.
  function scheduleNext(now) {
    var due = Model.nextDueAt(settings, location, now, profiles.minutes)
    var wait = due === null ? Model.CHECK_MS : due - now + 250
    wait = Math.min(wait, panelOpen ? 5000 : Model.CHECK_MS)
    if (!applySettled && applyAttempts < 30) wait = 1000
    checkTimer.interval = Math.max(1000, Math.round(wait))
    checkTimer.restart()
    nextCheckAt = now + checkTimer.interval
  }

  // While hyprsunset is starting or hasn't taken a change, look again every second.
  function checkSoon() {
    if (checkTimer.interval <= 1000 && checkTimer.running) return
    checkTimer.interval = 1000
    checkTimer.restart()
    nextCheckAt = Date.now() + 1000
  }

  function apply(kelvin) {
    applyTarget = kelvin
    applySettled = false
    applyAttempts = 0
    if (actualTemp !== null || kelvin < Model.FRESH_TEMP) actualTemp = kelvin
    runApply()
  }

  function runApply() {
    if (applyProcess.running) {
      queuedTarget = applyTarget
      return
    }
    // Even 6500K tints the screen, so off also restores the identity matrix.
    var target = Number(applyTarget)
    applyProcess.command = ["bash", "-c",
      "hyprctl hyprsunset temperature " + Model.hyprsunsetKelvin(target)
      + (target === Model.OFF_TEMP ? " && hyprctl hyprsunset identity" : "")]
    applyProcess.running = true
    syncShader()
  }

  // The part below hyprsunset's 1000K. While the shader is on, also run on every
  // check, to put it back after a config reload. Taking it off, including when
  // something else set the temperature, takes one run; after that there is
  // nothing of ours on the screen, so checks above 1000K skip the script.
  function syncShader() {
    if (!applyTarget) return
    // Queued even at 0: the run in progress may be putting the shader on.
    if (shaderProcess.running) {
      shaderQueued = true
      return
    }
    var step = externalHold ? 0 : Model.extraWarmStep(applyTarget)
    if (step === 0 && shaderStep === 0) return
    shaderRunStep = step
    shaderProcess.command = [shaderScript, String(step)]
    shaderProcess.running = true
  }

  function handleProbe(text) {
    var trimmed = String(text).trim()
    var reported = /^[0-9]+$/.test(trimmed) ? Number(trimmed) : null
    if (applyProcess.running || queuedTarget) return

    var now = Date.now()
    var profileSwitched = Model.profileSwitchBetween(profiles.minutes, lastLookAt, now)
    lastLookAt = now
    // hyprsunset can carry out its own switch up to a minute late, so for two
    // minutes a reading one of its profiles would leave counts as that switch.
    // A switch also sets the profile's gamma.
    if (profileSwitched) {
      profileGraceUntil = now + 120000
      gammaSent = null
    }

    if (reported === null) {
      actualTemp = null
      gammaSent = Model.FULL_GAMMA
      if (currentLevel() !== Model.OFF_TEMP || previewing) {
        // Not running, and needed. Starting it only when needed keeps days free of it.
        if (now - lastStartAttempt > 10000) {
          lastStartAttempt = now
          Quickshell.execDetached(["uwsm-app", "--", "hyprsunset"])
        }
        applySettled = false
        applyTarget = previewing ? applyTarget : currentLevel()
        applyAttempts++
        if (applyAttempts % 5 === 0 && applyAttempts <= 30) runApply()
        checkSoon()
      } else {
        // Off and not needed: nothing to send, but remember where things stand
        // so the next scheduled change fades instead of jumping.
        applySettled = true
        lastPlanOn = wantOn()
        lastLevel = Model.OFF_TEMP
      }
      return
    }

    // hyprsunset says 1000 for anything warmer, which the shader handles.
    if (reported === Model.hyprsunsetKelvin(applyTarget)) reported = applyTarget
    actualTemp = reported
    if (reported === Model.FRESH_TEMP) {
      // hyprsunset just restarted, or an identity profile in hyprsunset.conf
      // (Omarchy's 07:00 one) cleared it: either way, put the schedule back.
      // Both leave gamma at full brightness.
      fadeTimer.stop()
      externalHold = false
      gammaSent = Model.FULL_GAMMA
      lastLevel = currentLevel()
      apply(lastLevel)
      syncGamma()
      return
    }
    if (!applySettled && reported === applyTarget) {
      applySettled = true
    } else if (!applySettled && applyAttempts < 30) {
      applyAttempts++
      runApply()
      checkSoon()
      return
    } else if (applySettled && reported !== applyTarget && !fadeTimer.running) {
      if (profileSwitched || (now < profileGraceUntil && Model.isProfileValue(reported, profiles.values))) {
        // hyprsunset's own clock moved it, not a hand: put it back.
        externalHold = false
        lastLevel = currentLevel()
        apply(lastLevel)
        syncGamma()
        return
      }
      externalHold = true
    }
    step()
  }

  // One of the two files was read. Nothing is decided until both have been.
  function loadHalf(which, text) {
    var empty = String(text).trim() === ""
    var parsed = null
    if (!empty) {
      try {
        parsed = JSON.parse(text)
      } catch (error) {
        console.warn("locus: ignoring unreadable " + which + " file")
      }
    }
    if (which === "settings") {
      settingsRaw = parsed
      settingsHalfEmpty = empty
      settingsHalfLoaded = true
    } else {
      stateRaw = parsed
      stateHalfEmpty = empty
      stateHalfLoaded = true
    }
    if (settingsHalfLoaded && stateHalfLoaded) combineLoaded()
  }

  // A file that can't be created: run on the defaults for it, saving nothing.
  function markHalfMissing(which) {
    if (which === "settings") {
      settingsRaw = null
      settingsHalfEmpty = false
      settingsHalfLoaded = true
    } else {
      stateRaw = null
      stateHalfEmpty = false
      stateHalfLoaded = true
    }
    if (settingsHalfLoaded && stateHalfLoaded) combineLoaded()
  }

  function combineLoaded() {
    // A file read empty was just created by settingsSetup. Once running, fill
    // it from memory (it was deleted), so nothing already chosen is lost.
    var memory = Model.splitSettings(settings)
    var fromSettings = settingsHalfEmpty && settingsLoaded ? memory.settings : settingsRaw
    var fromState = stateHalfEmpty && settingsLoaded ? memory.state : stateRaw
    var result = Model.combineSettings(fromSettings, fromState)
    var changed = JSON.stringify(result.settings) !== JSON.stringify(settings)
    settings = result.settings
    var parts = Model.splitSettings(settings)
    writtenSettingsJson = JSON.stringify(parts.settings)
    writtenStateJson = JSON.stringify(parts.state)
    settingsLoaded = true
    var writeSettings = settingsHalfEmpty || result.migrate
    var writeState = stateHalfEmpty || result.migrate
    settingsHalfEmpty = false
    stateHalfEmpty = false
    if (writeSettings || writeState) saveHalves(writeSettings, writeState)
    if (changed || lastPlanOn === null) tick()
  }

  onLocationChanged: tick()
  onLocationCheckedChanged: tick()

  // Both files are owner-only before anything is saved to them (the state file
  // holds coordinates). Saves replace a file but keep its permissions, and this
  // also tightens a file made by an earlier version. With no settings yet,
  // Sundown's are copied over once, permissions and all, and split on load.
  Process {
    id: settingsSetup
    running: true
    command: ["sh", "-c",
      "mkdir -p \"$1\" && { [ -e \"$2\" ] || [ ! -f \"$3\" ] || cp -p \"$3\" \"$2\"; } && touch \"$2\" \"$4\" && chmod 600 \"$2\" \"$4\"",
      "locus", root.settingsDirectory, root.settingsPath, root.sundownSettingsPath, root.statePath]
    onExited: function(exitCode) {
      root.settingsSecured = exitCode === 0
      if (!root.settingsSecured)
        console.warn("locus: could not make the settings files private")
      root.directoryReady = true
    }
  }

  FileView {
    id: settingsFile
    path: root.directoryReady ? root.settingsPath : ""
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.loadHalf("settings", text())
    onLoadFailed: function(error) { root.halfLoadFailed("settings", error) }
  }

  FileView {
    id: stateFile
    path: root.directoryReady ? root.statePath : ""
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.loadHalf("state", text())
    onLoadFailed: function(error) { root.halfLoadFailed("state", error) }
  }

  function halfLoadFailed(which, error) {
    if (error !== FileViewError.FileNotFound) {
      console.warn("locus: could not read the " + which + " file: " + FileViewError.toString(error))
      return
    }
    // Deleted while running. A plain save would recreate it readable by others.
    if (settingsSecured) {
      settingsSecured = false
      directoryReady = false
      settingsSetup.running = true
      return
    }
    // Setup couldn't create it, so run on the defaults without saving a new file.
    markHalfMissing(which)
  }

  // Omarchy's own location, which owns this file's format (omarchy-weather-location).
  FileView {
    path: root.settingsDirectory + "/weather.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      root.weather = Model.weatherLocation(text())
      root.weatherChecked = true
    }
    onLoadFailed: function() {
      root.weather = null
      root.weatherChecked = true
    }
  }

  FileView {
    id: zoneTable
    path: "/usr/share/zoneinfo/zone1970.tab"
    printErrors: false
    onLoaded: {
      root.zoneLocation = Model.zoneCoordinates(text(), root.zone)
      root.zoneTableChecked = true
    }
    onLoadFailed: function() { root.zoneTableChecked = true }
  }

  Process {
    running: true
    command: ["readlink", "-f", "/etc/localtime"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.zone = Model.zoneName(text)
        root.zoneLocation = Model.zoneCoordinates(zoneTable.text(), root.zone)
        root.zoneNameChecked = true
      }
    }
  }

  Process {
    id: applyProcess
    onExited: function() {
      if (root.queuedTarget) {
        root.queuedTarget = 0
        root.runApply()
        return
      }
      if (!probeProcess.running) probeProcess.running = true
    }
  }

  Process {
    id: shaderProcess
    onExited: function(exitCode) {
      // A run that failed is tried again at the next check.
      root.shaderStep = exitCode === 0 ? root.shaderRunStep : -1
      if (!root.shaderQueued) return
      root.shaderQueued = false
      root.syncShader()
    }
  }

  Process {
    id: gammaProcess
    onExited: function(exitCode) {
      // A failed run is tried again at the next check.
      root.gammaSent = exitCode === 0 ? root.gammaRunValue : null
      if (!root.gammaQueued) return
      root.gammaQueued = false
      root.syncGamma()
    }
  }

  Process {
    id: probeProcess
    command: ["hyprctl", "hyprsunset", "temperature"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handleProbe(text)
    }
  }

  Timer {
    id: previewTimer
    interval: root.previewMilliseconds
    onTriggered: root.endPreview()
  }

  Timer {
    id: fadeTimer
    interval: 100
    repeat: true
    onTriggered: root.fadeStep()
  }

  // The same lookup the weather widget makes. Never waited for: the saved place,
  // or the next location in line, is used until it answers.
  Process {
    id: detectProcess
    command: ["curl", "-fsS", "--max-time", "4", "https://geo.omarchy.org/"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handleDetected(text)
    }
  }

  Process {
    id: geocodeProcess
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.handleGeocode(text)
    }
  }

  // Every few hours, or soon again if the network wasn't up yet.
  Timer {
    interval: root.detectSucceeded ? 10800000 : 300000
    running: root.settingsLoaded && root.settings.autoLocation
    repeat: true
    triggeredOnStart: true
    onTriggered: root.detectLocation()
  }

  // The next check. scheduleNext() sets the gap each time; repeating keeps it
  // going even if a check ever ends early.
  Timer {
    id: checkTimer
    interval: Model.CHECK_MS
    repeat: true
    onTriggered: root.tick()
  }

  FileView {
    path: (Quickshell.env("XDG_CONFIG_HOME") || (root.home + "/.config")) + "/hypr/hyprsunset.conf"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      root.profiles = Model.hyprsunsetProfiles(text())
      root.tick()
    }
    onLoadFailed: root.profiles = { minutes: [], values: [] }
  }

  // A window's fullscreen mode is only in Hyprland's window list, so refresh it
  // when focus or fullscreen changes, and only while it matters.
  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!root.settings.pauseFullscreen) return
      var name = String(event.name)
      if (name === "fullscreen" || name === "activewindowv2" || name === "closewindow") fullscreenRefresh.restart()
    }
  }

  Timer {
    id: fullscreenRefresh
    interval: 50
    onTriggered: Hyprland.refreshToplevels()
  }

  ShellIpc {
    target: "io.github.cwilliams5.locus.control"

    function status(): string {
      return JSON.stringify({
        on: root.nightOn,
        switchOn: root.switchOn,
        temperature: root.actualTemp,
        savedTemperature: root.temperature,
        mode: root.mode,
        location: root.location ? root.location.source : "none",
        place: root.location ? Model.displayName(root.location.label) : "",
        lookup: root.lookupState,
        planOn: root.plan.on,
        until: root.plan.until ? new Date(root.plan.until).toLocaleString() : "",
        previewing: root.previewing,
        ramp: root.ramp,
        autoLocation: root.autoLocation,
        externalHold: root.externalHold,
        override: root.settings.override,
        movie: root.movie,
        target: Model.targetKelvin(root.settings, root.location, Date.now()),
        bedtime: root.bedtime,
        bedtimeAt: root.bedtimeAt,
        bedtimeTemperature: root.bedtimeTemperature,
        weekendDelay: root.weekendDelay,
        bedtimeNow: root.bedtimeNow,
        dim: root.dim,
        dimFrom: root.dimFrom,
        dimPercent: root.dimPercent,
        gamma: root.gammaSent,
        twilight: root.twilight,
        fadeInNow: root.fadeInNow,
        fadeOutNow: root.fadeOutNow,
        sunsetOffset: root.sunsetOffset,
        fadeIn: root.fadeIn,
        fadeOut: root.fadeOut,
        paused: root.pausedNow,
        frontApp: Model.displayName(root.frontApp),
        frontFullscreen: root.frontFullscreen,
        pauseFullscreen: root.pauseFullscreen,
        pauseApps: root.pauseApps,
        nextCheckSeconds: Math.max(0, Math.round((root.nextCheckAt - Date.now()) / 1000))
      })
    }
    function on(): void { root.setSwitch(true) }
    function off(): void { root.setSwitch(false) }
    function toggle(): void { root.setSwitch(!root.switchOn) }
    function set(kelvin: int): void { root.setTemperature(kelvin) }
    // Save a preset's temperature: mild, night, warm or candle.
    function preset(name: string): string { return root.setPreset(name) ? "ok" : "invalid" }
    // A warmer level later in the night: on, off, or its time (22:30).
    function bedtime(value: string): string {
      if (value === "on" || value === "off") {
        root.setBedtime(value === "on")
        return "ok"
      }
      if (Model.parseTime(value) === null) return "invalid"
      root.setTime("bedtimeAt", value)
      return "ok"
    }
    function bedtimetemp(kelvin: int): void { root.setBedtimeTemperature(kelvin) }
    // Sun mode's fades follow twilight (sunset to civil dusk, civil dawn to sunrise): on or off.
    function twilight(value: string): void { root.setTwilight(value === "on") }
    // Dimmer late at night: on, off, or the time it starts (23:30).
    function dim(value: string): string {
      if (value === "on" || value === "off") {
        root.setDim(value === "on")
        return "ok"
      }
      if (Model.parseTime(value) === null) return "invalid"
      root.setTime("dimFrom", value)
      return "ok"
    }
    // How bright at the dimmest, 50 to 100 percent.
    function dimlevel(percent: int): void { root.setDimPercent(percent) }
    // Minutes later on Friday and Saturday nights, 0 to 180.
    function weekend(minutes: int): void { root.setWeekendDelay(minutes) }
    // Milder (5000K) for two and a half hours, then back to the schedule.
    function movie(): string { return root.hold("movie", 0) ? "ok" : "invalid" }
    function preview(kelvin: int): void { root.preview(kelvin) }
    function schedule(mode: string): void { root.setMode(mode) }
    // "52.52, 13.40", a city (looked up once; see status), or "" for automatic.
    function location(place: string): string { return root.setLocation(place) }
    function ramp(value: string): void { root.setRamp(value === "on") }
    function autolocation(value: string): void { root.setAutoLocation(value === "on") }
    function hours(onTime: string, offTime: string): void {
      root.updateSettings({ onTime: onTime, offTime: offTime })
    }
    // Minutes before sunset that Sun mode turns on; negative is after sunset.
    function offset(minutes: int): void { root.setSunsetOffset(minutes) }
    // Warm-up and clear-down lengths, in minutes.
    function fade(warmUp: int, clearDown: int): void { root.setFades(warmUp, clearDown) }
    function pausefullscreen(value: string): void { root.setPauseFullscreen(value === "on") }
    // An app class to keep neutral for, or a prefix ending in *: on or off.
    function pauseapp(appClass: string, value: string): string {
      return root.setPausedApp(appClass, value !== "off") ? "ok" : "invalid"
    }
    // Off or on for some minutes, then back to the schedule: hold off 60.
    function hold(kind: string, minutes: int): string {
      return root.hold(kind, minutes) ? "ok" : "invalid"
    }
    // Off for the rest of the night (tonight, if it's daytime).
    function morning(): string { return root.hold("morning", 0) ? "ok" : "needs a schedule" }
    // End any hold and follow the schedule again.
    function resume(): void { root.hold("clear", 0) }
    // Pause for the app in front, or stop pausing for it.
    function pausefront(): string {
      if (!root.frontAppPausable) return "no app in front"
      root.toggleFrontApp()
      return (root.frontAppListed ? "pausing for " : "not pausing for ") + Model.displayName(root.frontApp)
    }
  }
}
