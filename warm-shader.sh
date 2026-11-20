#!/bin/bash
# Warmer than hyprsunset's 1000K floor. Sets a Hyprland screen shader that scales
# green and blue down by STEP tenths, so 10 leaves only red, and 0 takes it off.
# Usage: warm-shader.sh STEP
#
# Another screen shader that is already set, like a grayscale one, is kept: its
# main() is renamed and run first, then the warmth goes on top. A config reload
# drops the shader, and Locus runs this again within a minute to put it back.
set -u

step=${1:-0}
[[ $step =~ ^([0-9]|10)$ ]] || { echo "STEP must be 0 to 10" >&2; exit 2; }

# Only the session's own runtime folder: never a shared one like /tmp, where
# someone else could leave a "base" file for us to read.
[[ -n ${XDG_RUNTIME_DIR:-} ]] || { echo "XDG_RUNTIME_DIR isn't set" >&2; exit 1; }
dir="$XDG_RUNTIME_DIR/locus"
mkdir -p -m 700 "$dir" || exit 1
[[ -d $dir && ! -L $dir && -O $dir ]] || { echo "$dir isn't ours" >&2; exit 1; }
chmod 700 "$dir"

current=$(hyprctl getoption decoration:screen_shader -j 2>/dev/null | jq -r '.str // ""') || exit 1
[[ $current == "[[EMPTY]]" ]] && current=""

# The shader that was there before ours, remembered across runs.
if [[ $current == "$dir/"* ]]; then
  base=$(cat "$dir/base" 2>/dev/null)
else
  base=$current
  printf '%s' "$base" >"$dir/base"
fi

set_shader() {
  [[ $1 == "$current" ]] && return 0
  # The path goes inside a Lua long string: refuse anything that could end it.
  case $1 in *']]'* | *$'\n'*) echo "refusing an unusual shader path" >&2; return 1 ;; esac
  hyprctl eval "hl.config({ decoration = { screen_shader = [[$1]] } })" >/dev/null
}

if ((step == 0)); then
  set_shader "$base"
  exit
fi

keep=$(awk -v s="$step" 'BEGIN { printf "%.2f", 1 - s / 10 }')
out="$dir/warm-$step-$(printf '%s' "$base" | cksum | cut -d' ' -f1).frag"

# Hyprland can read the file at any moment, so it is never rewritten in place:
# a new version is built beside it and swapped in whole, and only if it changed.
tmp=$(mktemp "$dir/.warm-XXXXXX") || exit 1
trap 'rm -f "$tmp"' EXIT

if [[ -z $base ]]; then
  cat >"$tmp" <<GLSL
#version 300 es
// Made by Locus's warm-shader.sh: hyprsunset at 1000K, then less green and blue.
precision highp float;
in vec2 v_texcoord;
uniform sampler2D tex;
out vec4 fragColor;

void main() {
  vec4 pixel = texture(tex, v_texcoord);
  fragColor = vec4(pixel.r, pixel.gb * $keep, pixel.a);
}
GLSL
else
  # Wrap the other shader. One we can't make sense of is left alone.
  [[ -r $base ]] || exit 1
  color=$(grep -oP '^\s*out\s+(highp\s+|mediump\s+|lowp\s+)?vec4\s+\K\w+' "$base" | head -1)
  color=${color:-gl_FragColor}
  grep -qE 'void[[:space:]]+main[[:space:]]*\([[:space:]]*(void)?[[:space:]]*\)' "$base" || exit 1
  {
    sed -E 's/void[[:space:]]+main[[:space:]]*\([[:space:]]*(void)?[[:space:]]*\)/void locusBase()/' "$base"
    cat <<GLSL

// Added by Locus's warm-shader.sh: the shader above, then less green and blue.
void main() {
  locusBase();
  $color.gb *= $keep;
}
GLSL
  } >"$tmp"
fi

cmp -s "$tmp" "$out" || mv -f "$tmp" "$out"

set_shader "$out"
