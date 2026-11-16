#!/usr/bin/env bash
# Remove the "Live Scenes" wallpaper plugin for the current user.
set -euo pipefail

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "kpackagetool6 not found." >&2
    exit 1
fi

kpackagetool6 --type Plasma/Wallpaper --remove com.designsos.livescenes
# previews are disposable; saved looks and profiles are kept
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/live-scenes"
echo "Removed. If Live Scenes was your wallpaper, pick another wallpaper type in the desktop settings."
DATA="${XDG_DATA_HOME:-$HOME/.local/share}/live-scenes"
if [ -d "$DATA" ]; then
    echo "Your saved looks and profiles are still in $DATA ($(du -sh "$DATA" | cut -f1));"
    echo "delete that folder to free the space."
fi
