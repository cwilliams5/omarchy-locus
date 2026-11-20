import QtQuick
import QtQuick.Shapes

// The Locus mark (branding/arc): a warm point on an arc. Drawn here rather
// than from a font or an image, so it stays sharp at bar size and takes the
// theme's colours: the arc in the given colour, the point in pointColor (the
// accent while the night light is on). Geometry is the logo's 64-unit grid.
Item {
  id: root

  property real size: 64
  property color color: "white"
  property color pointColor: color
  // The logo's stroke is 6 units. Bar icons draw about 12 px wide, where 6
  // would be barely over a pixel, so the bar asks for a heavier one.
  property real stroke: 6
  readonly property real unit: size / 64

  width: size
  height: size
  implicitWidth: size
  implicitHeight: size

  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer

    ShapePath {
      strokeColor: root.color
      strokeWidth: root.stroke * root.unit
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap
      startX: 6 * root.unit
      startY: 45 * root.unit

      PathArc {
        x: 58 * root.unit
        y: 45 * root.unit
        radiusX: 26 * root.unit
        radiusY: 26 * root.unit
      }
    }
  }

  Rectangle {
    x: (51.9 - 9) * root.unit
    y: (28.3 - 9) * root.unit
    width: 18 * root.unit
    height: width
    radius: width / 2
    color: root.pointColor
  }
}
