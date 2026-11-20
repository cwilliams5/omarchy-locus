import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import "Registry.js" as Registry
import "Status.js" as Status
import qs.Ui

// Optional: the night light icon as one of Omarchy's indicators instead of its
// own bar icon. Add this file's path, without .qml and relative to Omarchy's
// indicators folder, to the omarchy.indicators `items` in shell.json, and set this
// widget's showIcon to false. It sits with the active icons while on, and among
// the inactive ones on hover while off.
//
// Left-click opens the panel, right-click flips the main switch, and scrolling
// changes the temperature.
BarIndicator {
  id: root

  property var service: null
  readonly property bool serviceReady: service !== null && service !== undefined
  readonly property int shownTemp: serviceReady && service.actualTemp !== null ? service.actualTemp : (serviceReady ? service.temperature : 0)
  property real wheelAccumulator: 0

  active: serviceReady && service.nightOn
  activeText: "󰔎"
  activeTooltipText: Status.tooltip(serviceReady ? service : null, function(key) { return strings.t(key) }, clockText, shownTemp)
  inactiveTooltipText: activeTooltipText

  // As the panel shows times (Panel.qml's clockText).
  function clockText(milliseconds) {
    if (!milliseconds) return ""
    return new Date(milliseconds)
      .toLocaleTimeString(Qt.locale(Commons.I18n.formatLocale), Locale.ShortFormat)
      .replace(/[\u202f\u2009\u00a0]/g, " ")
  }

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  // Services can finish loading after the bar, and looking one up isn't a
  // binding, so keep asking until it answers.
  Timer {
    interval: 250
    running: !root.serviceReady
    repeat: true
    triggeredOnStart: true
    onTriggered: root.service = (root.bar && root.bar.shell && root.bar.shell.serviceFor("io.github.cwilliams5.locus")) || Registry.service
  }

  // The panel counts as hovering the bar, so the peek stays open and the icon
  // doesn't vanish while its panel is showing. The inactive stack's copy does
  // this because the stock widget rebuilds the active stack's as the state flips.
  readonly property bool wantsPeekHeld: indicatorBlock === "inactive" && serviceReady && service.panelOpen
  property bool peekHeld: false

  function setPeekHeld(held) {
    if (held === peekHeld || !bar || typeof bar.setBarHovered !== "function") return
    peekHeld = held
    bar.setBarHovered(held)
  }

  onWantsPeekHeldChanged: setPeekHeld(wantsPeekHeld)
  Component.onDestruction: setPeekHeld(false)

  onPressed: function(pressedButton) {
    if (!root.serviceReady) return
    if (pressedButton === Qt.RightButton) root.service.setEnabled(!root.service.enabled)
    else root.service.panelToggleRequested(root.QsWindow.window)
  }

  onWheelMoved: function(delta) {
    var wheel = Util.wheelSteps(root.wheelAccumulator, delta)
    root.wheelAccumulator = wheel.remainder
    if (wheel.steps !== 0 && root.serviceReady) root.service.setTemperature(root.service.activeTemperature - wheel.steps * 100)
  }
}
