.pragma library

// The status line (the panel's header) and the icon's tooltip, shared by
// Panel.qml and Indicator.qml so they always say the same thing. `t` looks up
// a string in i18n/en.json; `clock` formats a time the way the panel does.
// What happens next comes from the service (Model.statusAt): the next time
// the screen really warms or clears, not when a hold happens to expire.

function line(service, t, clock) {
  if (!service) return t("status.off")
  if (service.previewing) return t("status.preview")
  if (service.pausedNow)
    return service.frontLabel !== "" ? t("status.paused").arg(service.frontLabel) : t("status.pausedPlain")
  var status = service.status
  if (status.kind === "movieUntil") return t("status.movieUntil").arg(clock(status.at))
  if (status.kind === "warmUntil") return t("status.warmUntil").arg(clock(status.at))
  if (status.kind === "warm") return t("status.warm")
  if (status.kind === "warmsAt") return t("status.warmsAt").arg(clock(status.at))
  return t("status.off")
}

function tooltip(service, t, clock, kelvin) {
  var text = line(service, t, clock)
  if (service && service.nightOn) text = t("tooltip.withKelvin").arg(text).arg(kelvin)
  return (service && service.locusOn ? t("tooltip.turnOff") : t("tooltip.turnOn")).arg(text)
}
