import QtQuick
import Quickshell
import qs.Ui
import qs.Commons
import qs.Commons as Commons
import "Registry.js" as Registry

// The bar icon and the night light dropdown. Service.qml does the work. With
// showIcon off, Indicator.qml is the icon instead, and this takes up no room on
// the bar, so the dropdown holds still while that icon moves between stacks.
Panel {
  id: root
  moduleName: "io.github.williamjohndavisiii.heliotrope"
  ipcTarget: "io.github.williamjohndavisiii.heliotrope"

  readonly property int stepTemp: 100
  readonly property int snapTemp: 50
  readonly property int stepMinutes: 15

  // Services can finish loading after the bar, and looking one up isn't a
  // binding, so keep asking until it answers.
  property var service: null
  readonly property bool serviceReady: service !== null && service !== undefined

  readonly property int minTemp: serviceReady ? service.minTemp : 500
  readonly property int maxTemp: serviceReady ? service.maxTemp : 5500
  readonly property bool nightOn: serviceReady && service.nightOn
  readonly property bool switchOn: serviceReady && service.switchOn
  readonly property bool previewing: serviceReady && service.previewing
  readonly property string mode: serviceReady ? service.mode : "sun"
  readonly property int temperature: serviceReady ? service.temperature : 3000
  readonly property int shownTemp: serviceReady && service.actualTemp !== null ? service.actualTemp : temperature
  readonly property real untilMs: serviceReady ? service.plan.until : 0

  property bool editingLocation: false
  property real wheelAccumulator: 0

  readonly property bool showIcon: setting("showIcon", true) !== false
  readonly property bool vertical: !!bar && bar.vertical === true

  // Not zero without the icon, or the bar leaves it out when Tab moves between panels.
  implicitWidth: showIcon ? button.implicitWidth : (vertical ? 0 : 1)
  implicitHeight: showIcon ? button.implicitHeight : (vertical ? 1 : 0)

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  Timer {
    interval: 250
    running: !root.serviceReady
    repeat: true
    triggeredOnStart: true
    onTriggered: root.service = (root.bar && root.bar.shell && root.bar.shell.serviceFor("io.github.williamjohndavisiii.heliotrope")) || Registry.service
  }

  onOpenedChanged: {
    editingLocation = false
    if (!serviceReady) return
    service.panelOpen = opened
    if (!opened) service.endPreview()
  }

  Component.onDestruction: if (serviceReady) service.panelOpen = false

  function clockText(milliseconds) {
    if (!milliseconds) return ""
    // Qt puts a narrow no-break space before AM/PM. The bar font lacks it, and the
    // fallback font's taller line would make any row showing a time taller.
    return new Date(milliseconds)
      .toLocaleTimeString(Qt.locale(Commons.I18n.formatLocale), Locale.ShortFormat)
      .replace(/[   ]/g, " ")
  }

  function timeText(text) {
    var parts = String(text).split(":")
    var date = new Date()
    date.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
    return clockText(date.getTime())
  }

  // The slider runs from cooler on the left to warmer on the right, so more
  // fill means a stronger effect.
  function sliderValueFor(kelvin) { return minTemp + maxTemp - kelvin }

  function kelvinFor(sliderValue) {
    var kelvin = minTemp + maxTemp - sliderValue
    return Math.max(minTemp, Math.min(maxTemp, Math.round(kelvin / snapTemp) * snapTemp))
  }

  function adjust(warmerSteps) {
    if (serviceReady) service.setTemperature(temperature - warmerSteps * stepTemp)
  }

  function flipSwitch() {
    if (serviceReady) service.setSwitch(!switchOn)
  }

  // Just the place. Where it came from shows in the buttons beside it.
  function locationText() {
    var place = serviceReady ? service.location : null
    if (!place) return strings.t("location.none")
    if (place.source === "custom")
      return Commons.I18n.formatNumber(place.latitude, 2) + ", " + Commons.I18n.formatNumber(place.longitude, 2)
    if (place.source === "timezone") {
      var parts = String(place.label).split("/")
      return parts[parts.length - 1].replace(/_/g, " ")
    }
    return place.label || Commons.I18n.formatNumber(place.latitude, 2) + ", " + Commons.I18n.formatNumber(place.longitude, 2)
  }


  function cycleMode() {
    if (!serviceReady) return
    var modes = ["manual", "sun", "custom"]
    service.setMode(modes[(modes.indexOf(mode) + 1) % modes.length])
  }

  function statusText() {
    if (previewing) return strings.t("status.preview")
    if (switchOn && untilMs) return strings.t("status.onUntil").arg(clockText(untilMs))
    if (!switchOn && untilMs) return strings.t("status.offUntil").arg(clockText(untilMs))
    return switchOn ? strings.t("status.on") : strings.t("status.off")
  }

  Item {
    id: anchorPoint
    anchors.fill: parent
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    visible: root.showIcon
    bar: root.bar
    text: "󰔎"
    dimmed: !root.nightOn
    tooltipText: root.nightOn ? strings.t("tooltip.on").arg(root.shownTemp) : strings.t("tooltip.off")
    onPressed: function(pressedButton) {
      if (pressedButton === Qt.RightButton) root.flipSwitch()
      else root.toggle()
    }
    onWheelMoved: function(delta) {
      var wheel = Util.wheelSteps(root.wheelAccumulator, delta)
      root.wheelAccumulator = wheel.remainder
      if (wheel.steps !== 0) root.adjust(wheel.steps)
    }
  }

  // Each monitor has its own bar, so only answer the icon on this one.
  Connections {
    target: root.service
    ignoreUnknownSignals: true
    function onPanelToggleRequested(window) {
      if (anchorPoint.QsWindow.window === window) root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: anchorPoint
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight, Style.space(460))

    content: PanelKeyCatcher {
      id: keys
      // The location field takes every key while it's open.
      blocked: root.editingLocation
      implicitHeight: panelColumn.implicitHeight
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { if (dx !== 0) root.adjust(dx) }
      onActivateRequested: root.flipSwitch()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) { if (text === "m") root.cycleMode() }

      Column {
        id: panelColumn
        width: parent.width
        spacing: Style.space(14)

        PanelHero {
          width: parent.width
          title: strings.t("title")
          meta: root.statusText()
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          iconOpacity: root.nightOn ? 1.0 : 0.5
          iconComponent: Component {
            Text {
              textFormat: Text.PlainText
              text: "󰔎"
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.display
            }
          }
          trailingControl: Component {
            ToggleSwitch {
              checked: root.switchOn
              foreground: root.bar.foreground
              onToggled: root.flipSwitch()
            }
          }
        }

        PanelSeparator {
          foreground: root.bar.foreground
        }

        Column {
          width: parent.width
          spacing: Style.space(6)

          Item {
            width: parent.width
            implicitHeight: Math.max(temperatureHeader.implicitHeight, temperatureValue.implicitHeight)

            PanelSectionHeader {
              id: temperatureHeader
              text: strings.t("temperature")
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
              anchors.left: parent.left
              anchors.verticalCenter: parent.verticalCenter
            }

            Text {
              id: temperatureValue
              textFormat: Text.PlainText
              text: strings.t("kelvin").arg(slider.dragging ? root.kelvinFor(slider.liveValue) : root.temperature)
              color: Qt.darker(root.bar.foreground, 1.4)
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
              font.bold: true
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
            }
          }

          PanelSlider {
            id: slider
            bar: root.bar
            width: parent.width
            minimum: root.minTemp
            maximum: root.maxTemp
            step: root.stepTemp
            integer: true
            value: root.sliderValueFor(root.temperature)
            onMoved: function(sliderValue) { if (root.serviceReady) root.service.preview(root.kelvinFor(sliderValue)) }
            onReleased: function(sliderValue) { if (root.serviceReady) root.service.setTemperature(root.kelvinFor(sliderValue)) }
          }
        }

        PanelSeparator {
          foreground: root.bar.foreground
        }

        Column {
          width: parent.width
          spacing: Style.space(10)

          PanelSectionHeader {
            text: strings.t("schedule")
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          ButtonGroup {
            value: root.mode
            focusable: false
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            options: [
              { value: "manual", label: strings.t("mode.manual") },
              { value: "sun", label: strings.t("mode.sun") },
              { value: "custom", label: strings.t("mode.custom") }
            ]
            onChanged: function(value) { if (root.serviceReady) root.service.setMode(value) }
          }

          TimeRow {
            visible: root.mode === "custom"
            label: strings.t("time.on")
            timeKey: "onTime"
            timeValue: root.serviceReady ? root.service.onTime : ""
          }

          TimeRow {
            visible: root.mode === "custom"
            label: strings.t("time.off")
            timeKey: "offTime"
            timeValue: root.serviceReady ? root.service.offTime : ""
          }

          // The sun's times, shown rather than explained.
          Item {
            width: parent.width
            visible: root.mode === "sun" && root.serviceReady && root.service.location !== null
            implicitHeight: sunsetText.implicitHeight

            Text {
              id: sunsetText
              textFormat: Text.PlainText
              anchors.left: parent.left
              text: "󰖛  " + root.clockText(root.serviceReady ? root.service.sunset : 0)
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.body
            }

            Text {
              textFormat: Text.PlainText
              anchors.right: parent.right
              text: "󰖜  " + root.clockText(root.serviceReady ? root.service.sunrise : 0)
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.body
            }
          }

          SwitchRow {
            visible: root.mode !== "manual"
            label: strings.t("ramp")
            checked: root.serviceReady && root.service.ramp
            onToggled: if (root.serviceReady) root.service.setRamp(!root.service.ramp)
          }

          Item {
            width: parent.width
            visible: root.mode === "sun" && !root.editingLocation
            implicitHeight: Math.max(placeText.implicitHeight, editButton.implicitHeight)

            Text {
              id: placeText
              textFormat: Text.PlainText
              anchors.left: parent.left
              anchors.right: locationButtons.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: "󰍎  " + root.locationText()
              color: root.bar.foreground
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.body
              elide: Text.ElideRight
            }

            Row {
              id: locationButtons
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)

              Button {
                iconText: "󰆤"
                tooltipText: strings.t("location.detect")
                bordered: true
                selected: root.serviceReady && root.service.autoLocation
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                onClicked: if (root.serviceReady) root.service.setAutoLocation(!root.service.autoLocation)
              }

              Button {
                id: editButton
                iconText: "󰏫"
                tooltipText: strings.t("location.edit")
                bordered: true
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                // Here rather than on root: the field lives inside the panel's
                // content, which root can't see into.
                onClicked: {
                  var place = root.serviceReady ? root.service.location : null
                  locationField.text = place && place.source === "custom" ? place.latitude + ", " + place.longitude : ""
                  root.editingLocation = true
                  locationField.forceActiveFocus()
                }
              }
            }
          }

          TextField {
            id: locationField
            width: parent.width
            visible: root.mode === "sun" && root.editingLocation
            placeholderText: strings.t("location.placeholder")
            foreground: root.bar.foreground
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.body
            onAccepted: {
              // Empty goes back to finding it automatically. Anything unreadable stays
              // selected, ready to be typed over.
              if (root.serviceReady && root.service.setLocation(text)) {
                root.editingLocation = false
                keys.forceActiveFocus()
              } else {
                selectAll()
              }
            }
            Keys.onEscapePressed: {
              root.editingLocation = false
              keys.forceActiveFocus()
            }
          }
        }
      }
    }
  }

  component SwitchRow: Item {
    id: switchRow

    property string label: ""
    property bool checked: false
    signal toggled()

    width: parent.width
    implicitHeight: Math.max(switchLabel.implicitHeight, rowSwitch.implicitHeight)

    Text {
      id: switchLabel
      textFormat: Text.PlainText
      text: switchRow.label
      color: root.bar.foreground
      font.family: root.bar.fontFamily
      font.pixelSize: Style.font.body
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
    }

    ToggleSwitch {
      id: rowSwitch
      checked: switchRow.checked
      foreground: root.bar.foreground
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      onToggled: switchRow.toggled()
    }
  }

  component TimeRow: Item {
    id: timeRow

    property string label: ""
    property string timeKey: ""
    property string timeValue: ""

    width: parent.width
    implicitHeight: Math.max(timeLabel.implicitHeight, earlier.implicitHeight)

    Text {
      id: timeLabel
      textFormat: Text.PlainText
      text: timeRow.label
      color: root.bar.foreground
      font.family: root.bar.fontFamily
      font.pixelSize: Style.font.body
      anchors.left: parent.left
      anchors.verticalCenter: parent.verticalCenter
    }

    Row {
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(8)

      Button {
        id: earlier
        text: "−"
        bordered: true
        foreground: root.bar.foreground
        fontFamily: root.bar.fontFamily
        onClicked: if (root.serviceReady) root.service.stepTime(timeRow.timeKey, -root.stepMinutes)
      }

      Text {
        textFormat: Text.PlainText
        text: root.timeText(timeRow.timeValue)
        width: Style.space(76)
        horizontalAlignment: Text.AlignHCenter
        color: root.bar.foreground
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
        anchors.verticalCenter: parent.verticalCenter
      }

      Button {
        text: "+"
        bordered: true
        foreground: root.bar.foreground
        fontFamily: root.bar.fontFamily
        onClicked: if (root.serviceReady) root.service.stepTime(timeRow.timeKey, root.stepMinutes)
      }
    }

    WheelHandler {
      acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
      onWheel: function(event) {
        if (root.serviceReady) root.service.stepTime(timeRow.timeKey, event.angleDelta.y > 0 ? root.stepMinutes : -root.stepMinutes)
      }
    }
  }
}
