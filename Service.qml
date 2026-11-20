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
    previewTimer.stop()
    previewing = false
    externalHold = false
    switching = true
    updateSettings(Model.switchPatch(settings, location, Date.now(), turnOn))
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
    if (plan.on && currentLevel() === temperature) {
      previewing = false
    } else {
      previewing = true
      previewTimer.restart()
    }
    apply(clamped)
  }

  function setTemperature(kelvin) {
    var clamped = Model.clampTemp(kelvin)
    externalHold = false
    updateSettings({ temperature: clamped })
    preview(clamped)
  }

  // True when saved. Empty text goes back to the automatic location.
  function setLocation(text) {
    if (String(text).trim() === "") {
      updateSettings({ latitude: null, longitude: null })
      return true
    }
    var place = Model.parseCoordinates(text)
    if (!place) return false
    updateSettings({ latitude: place.latitude, longitude: place.longitude })
    return true
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

  function stepTime(key, deltaMinutes) {
    setTime(key, Model.stepTime(key === "onTime" ? onTime : offTime, deltaMinutes))
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
    fadeTimer.start()
  }

  function fadeStep() {
    var progress = (Date.now() - fadeStart) / Model.FADE_MS
    if (progress >= 1) fadeTimer.stop()
    apply(Model.mixKelvin(fadeFrom, fadeTarget, progress))
  }

  function tick() {
    if (!settingsLoaded || !locationChecked) return
    var now = Date.now()
    if (settings.override && now >= settings.override.until) {
      updateSettings(Model.holdEndPatch(settings.override, settings))
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
               && Model.isVisibleStep(lastLevel, level, temperature)) {
      // A fade's next step goes straight on; a bigger jump, like waking up in the
      // middle of a fade or changing a setting during one, fades over 2 seconds.
      var jump = Model.isBigJump(lastLevel, level)
      lastLevel = level
      if (jump) fadeTo(level)
      else apply(level)
    }
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
    if (profileSwitched) profileGraceUntil = now + 120000

    if (reported === null) {
      actualTemp = null
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
      fadeTimer.stop()
      externalHold = false
      lastLevel = currentLevel()
      apply(lastLevel)
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
        planOn: root.plan.on,
        until: root.plan.until ? new Date(root.plan.until).toLocaleString() : "",
        previewing: root.previewing,
        ramp: root.ramp,
        autoLocation: root.autoLocation,
        externalHold: root.externalHold,
        override: root.settings.override,
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
    function preview(kelvin: int): void { root.preview(kelvin) }
    function schedule(mode: string): void { root.setMode(mode) }
    function location(coordinates: string): string {
      return root.setLocation(coordinates) ? "ok" : "invalid"
    }
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
    // Pause for the app in front, or stop pausing for it.
    function pausefront(): string {
      if (!root.frontAppPausable) return "no app in front"
      root.toggleFrontApp()
      return (root.frontAppListed ? "pausing for " : "not pausing for ") + Model.displayName(root.frontApp)
    }
  }
}
