import QtQuick
import Quickshell
import qs.Ui
import qs.Commons
import qs.Commons as Commons
import "Registry.js" as Registry
import "Status.js" as Status

// The bar icon and the night light dropdown. Service.qml does the work. With
// showIcon off, Indicator.qml is the icon instead, and this takes up no room on
// the bar, so the dropdown holds still while that icon moves between stacks.
Panel {
  id: root
  moduleName: "io.github.cwilliams5.locus"
  ipcTarget: "io.github.cwilliams5.locus"

  readonly property int stepTemp: 100
  readonly property int snapTemp: 50
  readonly property int stepMinutes: 15
  readonly property int fadeStepMinutes: 5

  // Services can finish loading after the bar, and looking one up isn't a
  // binding, so keep asking until it answers.
  property var service: null
  readonly property bool serviceReady: service !== null && service !== undefined

  readonly property int minTemp: serviceReady ? service.minTemp : 500
  readonly property int maxTemp: serviceReady ? service.maxTemp : 5500
  readonly property bool nightOn: serviceReady && service.nightOn
  // Locus on or off: the switch in the header, and right-click on the icon.
  // Not named "enabled", which would hide Item.enabled (Omarchy's bar reads it).
  readonly property bool locusOn: serviceReady && service.locusOn
  readonly property bool previewing: serviceReady && service.previewing
  readonly property string mode: serviceReady ? service.mode : "sun"
  // The temperature showing now: the bedtime one once bedtime has come.
  readonly property int temperature: serviceReady ? service.activeTemperature : 3000
  readonly property bool bedtimeNow: serviceReady && service.bedtimeNow
  readonly property int shownTemp: serviceReady && service.actualTemp !== null ? service.actualTemp : temperature

  property bool editingLocation: false
  // What the location field starts with when it opens: typed coordinates, or empty.
  property string locationPrefill: ""
  // The field says why Enter did nothing (not a place, or not found).
  property bool locationInvalid: false
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
    onTriggered: root.service = (root.bar && root.bar.shell && root.bar.shell.serviceFor("io.github.cwilliams5.locus")) || Registry.service
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
    if (serviceReady) service.setEnabled(!locusOn)
  }

  // Just the place. Where it came from shows in the buttons beside it.
  function locationText() {
    var place = serviceReady ? service.location : null
    if (!place) return strings.t("location.none")
    if (place.source === "custom" && place.label === "")
      return Commons.I18n.formatNumber(place.latitude, 2) + ", " + Commons.I18n.formatNumber(place.longitude, 2)
    if (place.source === "timezone") {
      var parts = String(place.label).split("/")
      return parts[parts.length - 1].replace(/_/g, " ")
    }
    return place.label || Commons.I18n.formatNumber(place.latitude, 2) + ", " + Commons.I18n.formatNumber(place.longitude, 2)
  }


  function cycleMode() {
    if (!serviceReady) return
    var modes = ["sun", "custom", "always"]
    service.setMode(modes[(modes.indexOf(mode) + 1) % modes.length])
  }

  // Minutes as the steppers show them, like "45 min" or "At once".
  function minutesText(minutes) {
    return minutes > 0 ? strings.t("fade.minutes").arg(Commons.I18n.formatNumber(minutes, 0)) : strings.t("fade.instant")
  }

  function weekendText(minutes) {
    return minutes > 0 ? strings.t("bedtime.later").arg(Commons.I18n.formatNumber(minutes, 0)) : strings.t("bedtime.same")
  }

  function offsetText(minutes) {
    if (minutes > 0) return strings.t("start.before").arg(Commons.I18n.formatNumber(minutes, 0))
    if (minutes < 0) return strings.t("start.after").arg(Commons.I18n.formatNumber(-minutes, 0))
    return strings.t("start.at")
  }

  function statusText() {
    return Status.line(serviceReady ? service : null, function(key) { return strings.t(key) }, clockText)
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
    // Without its point while Locus is off, so off looks different from daytime.
    iconComponent: Component {
      ArcIcon {
        stroke: 8
        color: button.foreground
        pointColor: !root.locusOn ? "transparent" : root.nightOn ? Commons.Color.accent : button.foreground
      }
    }
    dimmed: !root.nightOn
    tooltipText: Status.tooltip(root.serviceReady ? root.service : null, function(key) { return strings.t(key) }, root.clockText, root.shownTemp)
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
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight, Style.space(680))

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

      // Scrolls only when the screen is too short for everything.
      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: panelColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height

      Column {
        id: panelColumn
        width: panelFlick.width
        spacing: Style.space(14)

        PanelHero {
          width: parent.width
          title: strings.t("title")
          meta: root.statusText()
          foreground: root.bar.foreground
          fontFamily: root.bar.fontFamily
          iconOpacity: root.nightOn ? 1.0 : 0.5
          iconComponent: Component {
            ArcIcon {
              size: Style.font.display
              stroke: 7
              color: root.bar.foreground
              pointColor: !root.locusOn ? "transparent" : root.nightOn ? Commons.Color.accent : root.bar.foreground
            }
          }
          trailingControl: Component {
            ToggleSwitch {
              checked: root.locusOn
              foreground: root.bar.foreground
              onToggled: root.flipSwitch()
            }
          }
        }

        // Holds: a set time, or the rest of the night, then back to the schedule.
        Flow {
          width: parent.width
          spacing: Style.space(8)

          Button {
            visible: root.locusOn
            text: strings.t("hold.off")
            tooltipText: strings.t("hold.offTip")
            bordered: true
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: if (root.serviceReady) root.service.hold("off", 60)
          }

          Button {
            text: strings.t("hold.on")
            tooltipText: strings.t("hold.onTip")
            bordered: true
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: if (root.serviceReady) root.service.hold("on", 60)
          }

          Button {
            text: strings.t("hold.movie")
            tooltipText: strings.t("hold.movieTip").arg(root.serviceReady ? root.service.movieTemp : 5000)
            bordered: true
            selected: root.serviceReady && root.service.movie
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: if (root.serviceReady) root.service.hold("movie", 0)
          }

          Button {
            visible: root.serviceReady && root.service.canHoldUntilMorning
            text: strings.t("hold.morning")
            tooltipText: strings.t("hold.morningTip")
            bordered: true
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: if (root.serviceReady) root.service.hold("morning", 0)
          }

          Button {
            visible: root.serviceReady && root.service.holding
            text: root.locusOn ? strings.t("hold.resume") : strings.t("hold.end")
            tooltipText: root.locusOn ? strings.t("hold.resumeTip") : strings.t("hold.endTip")
            bordered: true
            selected: true
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            onClicked: if (root.serviceReady) root.service.hold("clear", 0)
          }
        }

        // The day at a glance, noon to noon: the warm hours and their fades,
        // bedtime and dimming, and a mark for now. Worked out when the panel
        // opens or a setting changes; only the mark moves after that.
        Item {
          id: dayView
          width: parent.width
          visible: root.serviceReady && root.service.scheduled
          implicitHeight: strip.height + Style.space(4) + dayLabels.height

          readonly property int samples: 288
          readonly property real stepMs: 300000
          readonly property real spanMs: samples * stepMs
          property var view: null
          property real nowMs: Date.now()

          function refresh() {
            if (!root.serviceReady || !root.opened || !visible) return
            nowMs = Date.now()
            view = root.service.dayView(nowMs, stepMs, samples)
            strip.requestPaint()
          }

          function xFor(ms) {
            return view ? Math.max(0, Math.min(width, (ms - view.from) / spanMs * width)) : 0
          }

          onVisibleChanged: refresh()
          onWidthChanged: strip.requestPaint()
          Component.onCompleted: refresh()

          // Settings can change several times a second (the wheel on a stepper).
          Timer {
            id: dayRefresh
            interval: 150
            onTriggered: dayView.refresh()
          }

          Connections {
            target: root.serviceReady ? root.service : null
            ignoreUnknownSignals: true
            function onSettingsChanged() { dayRefresh.restart() }
            function onLocationChanged() { dayRefresh.restart() }
          }

          Connections {
            target: root
            function onOpenedChanged() { if (root.opened) dayView.refresh() }
          }

          // Once a minute while the panel is open: move the mark, and start a
          // new day at noon.
          Timer {
            interval: 60000
            repeat: true
            running: root.opened && dayView.visible
            onTriggered: {
              if (dayView.view && Date.now() - dayView.view.from >= dayView.spanMs) dayView.refresh()
              else dayView.nowMs = Date.now()
            }
          }

          Canvas {
            id: strip
            width: parent.width
            height: Style.space(14)
            renderStrategy: Canvas.Cooperative

            onPaint: {
              var ctx = getContext("2d")
              ctx.reset()
              var view = dayView.view
              if (!view || width <= 0) return
              var radius = height / 2
              ctx.save()
              ctx.beginPath()
              ctx.roundedRect(0, 0, width, height, radius, radius)
              ctx.clip()
              ctx.fillStyle = Qt.rgba(root.bar.foreground.r, root.bar.foreground.g, root.bar.foreground.b, 0.12)
              ctx.fillRect(0, 0, width, height)
              var slice = width / view.samples.length
              for (var i = 0; i < view.samples.length; i++) {
                var paint = root.service.viewPaint(view.samples[i])
                if (paint.a <= 0) continue
                ctx.fillStyle = Qt.rgba(paint.r, paint.g, paint.b, paint.a)
                ctx.fillRect(Math.floor(i * slice), 0, Math.ceil(slice) + 1, height)
              }
              ctx.restore()
            }
          }

          Rectangle {
            id: nowMark
            width: Math.max(2, Style.space(2))
            height: strip.height + Style.space(4)
            y: -Style.space(2)
            radius: width / 2
            x: Math.max(0, Math.min(dayView.width - width, dayView.xFor(dayView.nowMs) - width / 2))
            color: root.bar.foreground
          }

          // 6 PM, midnight and 6 AM, in the panel's clock format.
          Item {
            id: dayLabels
            width: parent.width
            y: strip.height + Style.space(4)
            height: captionMetrics.height

            FontMetrics {
              id: captionMetrics
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.caption
            }

            Repeater {
              model: [18, 24, 30]

              delegate: Text {
                required property int modelData
                // The clock time itself, so a day the clocks change on still lines up.
                readonly property real at: {
                  if (!dayView.view) return 0
                  var start = new Date(dayView.view.from)
                  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.floor(modelData / 24), modelData % 24).getTime()
                }
                textFormat: Text.PlainText
                text: root.clockText(at)
                color: Qt.darker(root.bar.foreground, 1.4)
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.caption
                x: Math.max(0, Math.min(dayLabels.width - implicitWidth, dayView.xFor(at) - implicitWidth / 2))
              }
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
              text: root.serviceReady && root.service.movie ? strings.t("movie.temperature")
                : root.bedtimeNow ? strings.t("bedtime.temperatureNow") : strings.t("temperature")
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

          // One click to a common temperature, mildest first like the slider.
          ButtonGroup {
            value: root.serviceReady ? root.service.preset : ""
            focusable: false
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
            options: (root.serviceReady ? root.service.presets : []).map(function(preset) {
              return { value: preset.name, label: strings.t("preset." + preset.name), tooltip: strings.t("kelvin").arg(preset.kelvin) }
            })
            onChanged: function(value) { if (root.serviceReady) root.service.setPreset(value) }
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
              { value: "sun", label: strings.t("mode.sun") },
              { value: "custom", label: strings.t("mode.custom") },
              { value: "always", label: strings.t("mode.always") }
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

          StepRow {
            visible: root.mode === "sun"
            label: strings.t("start")
            valueText: root.offsetText(root.serviceReady ? root.service.sunsetOffset : 0)
            onStepped: function(direction) { if (root.serviceReady) root.service.stepSunsetOffset(direction * root.stepMinutes) }
          }

          SwitchRow {
            visible: root.mode !== "always"
            label: strings.t("ramp")
            checked: root.serviceReady && root.service.ramp
            onToggled: if (root.serviceReady) root.service.setRamp(!root.service.ramp)
          }

          SwitchRow {
            visible: root.mode === "sun" && root.serviceReady && root.service.ramp
            label: strings.t("twilight")
            checked: root.serviceReady && root.service.twilight
            onToggled: if (root.serviceReady) root.service.setTwilight(!root.service.twilight)
          }

          // With twilight, the lengths follow the sun and only show tonight's.
          StepRow {
            visible: root.mode !== "always" && root.serviceReady && root.service.ramp
            readonly property bool dusk: root.serviceReady && root.service.followsTwilight
            adjustable: !dusk
            label: dusk ? strings.t("fade.inDusk") : strings.t("fade.in")
            valueText: root.minutesText(root.serviceReady ? (dusk ? root.service.fadeInNow : root.service.fadeIn) : 0)
            onStepped: function(direction) { if (root.serviceReady) root.service.stepFade("fadeIn", direction * root.fadeStepMinutes) }
          }

          StepRow {
            visible: root.mode !== "always" && root.serviceReady && root.service.ramp
            readonly property bool dawn: root.serviceReady && root.service.followsTwilight
            adjustable: !dawn
            label: dawn ? strings.t("fade.outDawn") : strings.t("fade.out")
            valueText: root.minutesText(root.serviceReady ? (dawn ? root.service.fadeOutNow : root.service.fadeOut) : 0)
            onStepped: function(direction) { if (root.serviceReady) root.service.stepFade("fadeOut", direction * root.fadeStepMinutes) }
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
                  root.locationPrefill = place && place.source === "custom" ? place.latitude + ", " + place.longitude : ""
                  root.locationInvalid = false
                  root.editingLocation = true
                }
              }
            }
          }

          // The field exists only while editing: Qt 6.12 can make an editable
          // field that exists, even hidden, read the whole clipboard on every
          // copy (QTBUG-149610, omarchy#15083). Measured 2026-11-21, an open
          // panel reads it anyway (Omarchy's audio panel, with no text field,
          // too), and a closed one doesn't; this keeps Locus out of it.
          Loader {
            id: locationEditor
            width: parent.width
            active: root.mode === "sun" && root.editingLocation
            visible: active
            sourceComponent: Component {
              TextField {
                placeholderText: strings.t("location.placeholder")
                foreground: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.body
                Component.onCompleted: {
                  text = root.locationPrefill
                  forceActiveFocus()
                }
                onTextEdited: root.locationInvalid = false
                onAccepted: {
                  // Empty goes back to finding it automatically. A city stays
                  // open until it's found. Anything unreadable stays selected,
                  // ready to be typed over.
                  var result = root.serviceReady ? root.service.setLocation(text) : "invalid"
                  root.locationInvalid = result === "invalid"
                  if (result === "ok") {
                    root.editingLocation = false
                    keys.forceActiveFocus()
                  } else if (result === "invalid") {
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

          // How a city lookup is going.
          Text {
            width: parent.width
            visible: locationEditor.active && root.serviceReady && (root.locationInvalid || root.service.lookupState !== "")
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            text: !root.serviceReady ? "" : root.locationInvalid ? strings.t("location.invalid")
              : root.service.lookupState === "searching" ? strings.t("location.searching")
              : root.service.lookupState === "notfound" ? strings.t("location.notFound").arg(root.service.lookupQuery)
              : strings.t("location.failed")
            color: Qt.darker(root.bar.foreground, 1.4)
            font.family: root.bar.fontFamily
            font.pixelSize: Style.font.caption
          }

          Connections {
            target: root.serviceReady ? root.service : null
            ignoreUnknownSignals: true
            function onLookupFinished(found) {
              if (!root.editingLocation) return
              if (found) {
                root.editingLocation = false
                keys.forceActiveFocus()
              } else if (locationEditor.item) {
                locationEditor.item.selectAll()
              }
            }
          }
        }

        PanelSeparator {
          visible: root.mode !== "always"
          foreground: root.bar.foreground
        }

        // Later in the night: a second, warmer level, and dimming.
        Column {
          width: parent.width
          spacing: Style.space(10)
          visible: root.mode !== "always"

          SwitchRow {
            label: strings.t("bedtime.level")
            checked: root.serviceReady && root.service.bedtime
            onToggled: if (root.serviceReady) root.service.setBedtime(!root.service.bedtime)
          }

          TimeRow {
            visible: root.serviceReady && root.service.bedtime
            label: strings.t("bedtime.at")
            timeKey: "bedtimeAt"
            timeValue: root.serviceReady ? root.service.bedtimeAt : ""
          }

          StepRow {
            visible: root.serviceReady && root.service.bedtime
            label: strings.t("bedtime.temperature")
            valueText: strings.t("kelvin").arg(root.serviceReady ? root.service.bedtimeTemperature : 2200)
            onStepped: function(direction) { if (root.serviceReady) root.service.stepBedtimeTemperature(direction * root.stepTemp) }
          }

          StepRow {
            visible: root.serviceReady && root.service.bedtime
            label: strings.t("bedtime.weekend")
            valueText: root.weekendText(root.serviceReady ? root.service.weekendDelay : 0)
            onStepped: function(direction) { if (root.serviceReady) root.service.stepWeekendDelay(direction * root.stepMinutes) }
          }

          SwitchRow {
            label: strings.t("dim.level")
            checked: root.serviceReady && root.service.dim
            onToggled: if (root.serviceReady) root.service.setDim(!root.service.dim)
          }

          TimeRow {
            visible: root.serviceReady && root.service.dim
            label: strings.t("dim.from")
            timeKey: "dimFrom"
            timeValue: root.serviceReady ? root.service.dimFrom : ""
          }

          StepRow {
            visible: root.serviceReady && root.service.dim
            label: strings.t("dim.percent")
            valueText: strings.t("percent").arg(root.serviceReady ? root.service.dimPercent : 80)
            onStepped: function(direction) { if (root.serviceReady) root.service.stepDimPercent(direction * 5) }
          }
        }

        PanelSeparator {
          foreground: root.bar.foreground
        }

        // Apps that need true colour: the screen stays neutral while one is in front.
        Column {
          width: parent.width
          spacing: Style.space(10)

          PanelSectionHeader {
            text: strings.t("pause")
            foreground: root.bar.foreground
            fontFamily: root.bar.fontFamily
          }

          SwitchRow {
            label: strings.t("pause.fullscreen")
            checked: root.serviceReady && root.service.pauseFullscreen
            onToggled: if (root.serviceReady) root.service.setPauseFullscreen(!root.service.pauseFullscreen)
          }

          // The app in front, with a button to add it to the list or take it off.
          Item {
            width: parent.width
            implicitHeight: Math.max(frontText.implicitHeight, frontButton.implicitHeight)

            Text {
              id: frontText
              textFormat: Text.PlainText
              anchors.left: parent.left
              anchors.right: frontButton.left
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              text: "󰖯  " + (root.serviceReady && root.service.frontLabel !== "" ? root.service.frontLabel : strings.t("pause.none"))
              color: root.bar.foreground
              opacity: root.serviceReady && root.service.frontAppPausable ? 1 : 0.6
              font.family: root.bar.fontFamily
              font.pixelSize: Style.font.body
              elide: Text.ElideRight
            }

            Button {
              id: frontButton
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              iconText: "󰏤"
              tooltipText: root.serviceReady && root.service.frontAppListed ? strings.t("pause.frontStop") : strings.t("pause.front")
              bordered: true
              selected: root.serviceReady && root.service.frontAppListed
              enabled: root.serviceReady && root.service.frontAppPausable
              opacity: enabled ? 1 : 0.5
              foreground: root.bar.foreground
              fontFamily: root.bar.fontFamily
              onClicked: if (root.serviceReady) root.service.toggleFrontApp()
            }
          }

          Repeater {
            model: root.serviceReady ? root.service.pauseApps : []

            delegate: Item {
              id: appRow
              required property string modelData
              width: parent.width
              implicitHeight: Math.max(appText.implicitHeight, removeButton.implicitHeight)

              Text {
                id: appText
                textFormat: Text.PlainText
                anchors.left: parent.left
                anchors.right: removeButton.left
                anchors.rightMargin: Style.space(8)
                anchors.verticalCenter: parent.verticalCenter
                text: appRow.modelData
                color: root.bar.foreground
                font.family: root.bar.fontFamily
                font.pixelSize: Style.font.body
                elide: Text.ElideRight
              }

              Button {
                id: removeButton
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                iconText: "󰅖"
                tooltipText: strings.t("pause.remove")
                bordered: true
                foreground: root.bar.foreground
                fontFamily: root.bar.fontFamily
                onClicked: if (root.serviceReady) root.service.setPausedApp(appRow.modelData, false)
              }
            }
          }
        }
      }
      }
    }
  }

  // A label with − and + buttons either side of its value; scrolling steps too.
  component StepRow: Item {
    id: stepRow

    property string label: ""
    property string valueText: ""
    // False shows the value alone, without the buttons.
    property bool adjustable: true
    signal stepped(int direction)

    width: parent.width
    // The buttons' height even when hidden, so the rows stay evenly spaced.
    implicitHeight: Math.max(stepLabel.implicitHeight, stepDown.implicitHeight)

    Text {
      id: stepLabel
      textFormat: Text.PlainText
      text: stepRow.label
      color: root.bar.foreground
      font.family: root.bar.fontFamily
      font.pixelSize: Style.font.body
      anchors.left: parent.left
      anchors.right: stepButtons.left
      anchors.rightMargin: Style.space(8)
      anchors.verticalCenter: parent.verticalCenter
      elide: Text.ElideRight
    }

    Row {
      id: stepButtons
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      spacing: Style.space(8)

      Button {
        id: stepDown
        visible: stepRow.adjustable
        text: "−"
        bordered: true
        foreground: root.bar.foreground
        fontFamily: root.bar.fontFamily
        onClicked: stepRow.stepped(-1)
      }

      Text {
        textFormat: Text.PlainText
        text: stepRow.valueText
        width: Style.space(132)
        horizontalAlignment: Text.AlignHCenter
        color: root.bar.foreground
        font.family: root.bar.fontFamily
        font.pixelSize: Style.font.body
        font.bold: true
        elide: Text.ElideRight
        anchors.verticalCenter: parent.verticalCenter
      }

      Button {
        visible: stepRow.adjustable
        text: "+"
        bordered: true
        foreground: root.bar.foreground
        fontFamily: root.bar.fontFamily
        onClicked: stepRow.stepped(1)
      }
    }

    WheelHandler {
      enabled: stepRow.adjustable
      acceptedDevices: PointerDevice.Mouse | PointerDevice.TouchPad
      onWheel: function(event) { stepRow.stepped(event.angleDelta.y > 0 ? 1 : -1) }
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
