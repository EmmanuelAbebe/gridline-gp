#!/bin/sh
# Runs a Blender script of this folder headless: tools/blender/run.sh trees [preview=dir]
# Blender: $BLENDER, else `blender` on the PATH, else the Flathub app (org.blender.Blender).
# Paths are made absolute (the Flatpak starts in its own folder).
set -e
root=$(cd "$(dirname "$0")/../.." && pwd)
script="$root/tools/blender/$1.py"; shift
if [ -n "$BLENDER" ]; then cmd=$BLENDER
elif command -v blender >/dev/null 2>&1; then cmd=blender
elif flatpak info org.blender.Blender >/dev/null 2>&1; then cmd="flatpak run org.blender.Blender"
else echo "Blender not found: install it or set BLENDER=/path/to/blender" >&2; exit 1; fi
args=""
for a in "$@"; do
  case "$a" in
    *=/*) args="$args $a" ;;
    *=*) args="$args ${a%%=*}=$root/${a#*=}" ;;
    *) args="$args $a" ;;
  esac
done
# shellcheck disable=SC2086
exec $cmd -b --factory-startup --python "$script" -- out="$root/src/game/models/$(basename "$script" .py).glb" $args
