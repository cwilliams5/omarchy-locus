#!/bin/bash
# tint.sh in.png out.png kelvin [gamma-percent=100]
#
# Screenshots don't include hyprsunset's tint: it's a colour transform the
# compositor applies on the way to the screen, after capture. This applies
# the same transform to a screenshot instead, using hyprsunset 0.4.0's own
# formula (matrixForKelvin in src/Hyprsunset.cpp, Tanner Helland's fit, with
# the Kelvin truncated to whole hundreds as hyprsunset does), times gamma.
set -euo pipefail
in=${1:?in.png}; out=${2:?out.png}; kelvin=${3:?kelvin}; gamma=${4:-100}
read -r r g b < <(python3 -I - "$kelvin" "$gamma" <<'PY'
import math, sys
temp = int(sys.argv[1]) // 100
gamma = float(sys.argv[2]) / 100
clamp = lambda v: max(0.0, min(255.0, v))
if temp <= 66:
    r = 255.0
    g = clamp(99.4708025861 * math.log(temp) - 161.1195681661)
    b = 0.0 if temp <= 19 else clamp(math.log(temp - 10) * 138.5177312231 - 305.0447927307)
else:
    r = clamp(329.698727446 * (temp - 60) ** -0.1332047592)
    g = clamp(288.1221695283 * (temp - 60) ** -0.0755148492)
    b = 255.0
print(" ".join("%.6f" % (v / 255 * gamma) for v in (r, g, b)))
PY
)
magick "$in" -color-matrix "$r 0 0 0 $g 0 0 0 $b" "$out"
