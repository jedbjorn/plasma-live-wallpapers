#!/usr/bin/env bash
# Install or upgrade the "Live Scenes" wallpaper plugin for the current user.
#   ./install.sh            install or upgrade
#   ./install.sh --restart  ... and restart plasmashell afterwards
set -euo pipefail

ID="com.designsos.livescenes"
TYPE="Plasma/Wallpaper"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$HERE/package"
RESTART=0

for arg in "$@"; do
    case "$arg" in
        --restart) RESTART=1 ;;
        -h|--help)
            echo "Usage: $0 [--restart]"
            echo "  --restart  restart plasmashell after installing (needed to pick up an upgrade)"
            exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "kpackagetool6 not found. It is part of the 'kpackage' package; install Plasma 6 first." >&2
    echo "  sudo pacman -S --needed kpackage" >&2
    exit 1
fi

if [ ! -d /usr/lib/qt6/qml/QtWebEngine ]; then
    echo "The QtWebEngine QML module is missing (/usr/lib/qt6/qml/QtWebEngine)." >&2
    echo "On Arch/CachyOS install it with:" >&2
    echo "  sudo pacman -S --needed qt6-webengine" >&2
    exit 1
fi

if [ ! -f "$PKG/metadata.json" ]; then
    echo "package/metadata.json not found next to this script." >&2
    exit 1
fi

# "--list" prints installed package ids; match the exact id.
if kpackagetool6 --type "$TYPE" --list 2>/dev/null | grep -qx "$ID"; then
    echo "Upgrading $ID ..."
    kpackagetool6 --type "$TYPE" --upgrade "$PKG"
    UPGRADED=1
else
    echo "Installing $ID ..."
    kpackagetool6 --type "$TYPE" --install "$PKG"
    UPGRADED=0
fi

echo
echo "Done. To use it: right-click the desktop > Configure Desktop and Wallpaper >"
echo "Wallpaper type > Live Scenes, then pick a Scene."

if [ "$RESTART" -eq 1 ]; then
    echo
    echo "Restarting plasmashell ..."
    systemctl --user restart plasma-plasmashell.service
elif [ "$UPGRADED" -eq 1 ]; then
    echo
    echo "plasmashell caches the old files: to pick up this upgrade, restart it with"
    echo "  systemctl --user restart plasma-plasmashell.service"
    echo "(or run ./install.sh --restart next time)."
fi
