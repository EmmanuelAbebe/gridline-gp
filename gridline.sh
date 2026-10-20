#!/usr/bin/env bash
# Gridline GP launcher: opens the game as its own desktop app (Electron; no browser window or tabs).
#   ./gridline.sh              open the game (full screen; the game's FULL SCREEN button switches to a window)
#   ./gridline.sh --windowed   open as a maximised window instead
#   ./gridline.sh --vulkan     WebGL through ANGLE on Vulkan (needed on the old Intel HD 520 laptop for speed)
#   ./gridline.sh --install    add Gridline GP to the applications menu
#   ./gridline.sh --uninstall  remove it from the menu
# First time only: run `npm install` in this folder (Electron, Vite, Three.js).
# The game is built into dist/index.html; this script rebuilds it when anything in the source is newer.
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ELECTRON="$DIR/node_modules/.bin/electron"
BUILT="$DIR/dist/index.html"
DESKTOP="$HOME/.local/share/applications/gridline-gp.desktop"

case "${1:-}" in
  --install)
    mkdir -p "$(dirname "$DESKTOP")"
    cat > "$DESKTOP" <<DESK
[Desktop Entry]
Type=Application
Name=Gridline GP
Comment=F1-style racing game
Exec="$DIR/gridline.sh"
Icon=$DIR/public/icons/icon-512.png
Terminal=false
Categories=Game;
StartupWMClass=gridline-gp
DESK
    command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
    echo "Added Gridline GP to the applications menu." ;;
  --uninstall)
    rm -f "$DESKTOP"; echo "Removed Gridline GP from the applications menu." ;;
  ""|--windowed|--vulkan)
    if [ ! -x "$ELECTRON" ]; then echo "Gridline GP: Electron is not installed. Run 'npm install' in $DIR first." >&2; exit 1; fi
    if [ ! -f "$BUILT" ] || [ -n "$(find "$DIR/src" "$DIR/index.html" "$DIR/public" -newer "$BUILT" -print -quit)" ]; then
      echo "Gridline GP: building..."; (cd "$DIR" && "$DIR/node_modules/.bin/vite" build --logLevel warn)
    fi
    # the phone page (phone-wheel/web) has its own build
    PHONE="$DIR/phone-wheel/web/dist/index.html"
    if [ ! -f "$PHONE" ] || [ -n "$(find "$DIR/phone-wheel/web/src" "$DIR/phone-wheel/web/index.html" -newer "$PHONE" -print -quit)" ]; then
      echo "Gridline GP: building the phone page..."; (cd "$DIR" && "$DIR/node_modules/.bin/vite" build --config phone-wheel/web/vite.config.ts --logLevel warn)
    fi
    [ "${1:-}" = "--vulkan" ] && export GRIDLINE_GPU=vulkan
    exec "$ELECTRON" "$DIR" $([ "${1:-}" = "--windowed" ] && echo --windowed) ;;
  *)
    sed -n '2,8p' "$0"; exit 1 ;;
esac
