#!/usr/bin/env bash
# Gridline GP launcher: opens the game as its own desktop app (Electron; no browser window or tabs).
#   ./gridline.sh              open the game (full screen; the game's FULL SCREEN button switches to a window)
#   ./gridline.sh --windowed   open as a maximised window instead
#   ./gridline.sh --safe-gpu   use Electron's default GPU settings (try this if the screen stays black)
#   ./gridline.sh --install    add Gridline GP to the applications menu
#   ./gridline.sh --uninstall  remove it from the menu
# First time only: run `npm install` in this folder to download Electron.
set -euo pipefail
DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
ELECTRON="$DIR/node_modules/.bin/electron"
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
Icon=$DIR/icons/icon-512.png
Terminal=false
Categories=Game;
StartupWMClass=gridline-gp
DESK
    command -v update-desktop-database >/dev/null && update-desktop-database "$(dirname "$DESKTOP")" 2>/dev/null || true
    echo "Added Gridline GP to the applications menu." ;;
  --uninstall)
    rm -f "$DESKTOP"; echo "Removed Gridline GP from the applications menu." ;;
  ""|--windowed|--safe-gpu)
    if [ ! -x "$ELECTRON" ]; then echo "Gridline GP: Electron is not installed. Run 'npm install' in $DIR first." >&2; exit 1; fi
    [ "${1:-}" = "--safe-gpu" ] && export GRIDLINE_GPU=default
    exec "$ELECTRON" "$DIR" ${1:+"$1"} ;;
  *)
    sed -n '2,8p' "$0"; exit 1 ;;
esac
