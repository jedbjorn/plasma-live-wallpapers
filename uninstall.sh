#!/usr/bin/env bash
# Remove the "Live Scenes" wallpaper plugin for the current user.
set -euo pipefail

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "kpackagetool6 not found." >&2
    exit 1
fi

kpackagetool6 --type Plasma/Wallpaper --remove com.designsos.livescenes
echo "Removed. If Live Scenes was your wallpaper, pick another wallpaper type in the desktop settings."
