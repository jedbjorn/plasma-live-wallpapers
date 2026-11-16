#!/usr/bin/env bash
# Install or upgrade the "Live Scenes" wallpaper plugin for the current user.
#   ./install.sh            install or upgrade
#   ./install.sh --restart  ... and restart plasmashell afterwards
#
# The package is staged in a temporary folder together with the default look (Living Water), which
# the wallpaper shows until a profile is saved. The look comes from build/packs/living-water/ (made
# with sdk/livescenes) if it exists, else it is downloaded from the latest release.
set -euo pipefail

ID="com.designsos.livescenes"
TYPE="Plasma/Wallpaper"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG="$HERE/package"
DEFAULT_LOOK="living-water"
PACK="$HERE/build/packs/$DEFAULT_LOOK"
CATALOG="${LIVESCENES_CATALOG:-https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/catalog.json}"
RESTART=0

for arg in "$@"; do
    case "$arg" in
        --restart) RESTART=1 ;;
        -h|--help)
            echo "Usage: $0 [--restart]"
            echo "  --restart  restart plasmashell after installing (needed to pick up an upgrade)"
            echo "The default look is taken from build/packs/$DEFAULT_LOOK/ if present, else downloaded"
            echo "from the catalog (\$LIVESCENES_CATALOG overrides its URL)."
            exit 0 ;;
        *) echo "Unknown option: $arg" >&2; exit 2 ;;
    esac
done

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "kpackagetool6 not found. It is part of the 'kpackage' package; install Plasma 6 first." >&2
    echo "  sudo pacman -S --needed kpackage" >&2
    exit 1
fi

# videos are played with QtMultimedia and its FFmpeg backend (hardware decoding through VA-API)
QT6_QML=/usr/lib/qt6/qml
QT6_PLUGINS=/usr/lib/qt6/plugins
if command -v qtpaths6 >/dev/null 2>&1; then
    QT6_QML="$(qtpaths6 --query QT_INSTALL_QML 2>/dev/null || echo "$QT6_QML")"
    QT6_PLUGINS="$(qtpaths6 --query QT_INSTALL_PLUGINS 2>/dev/null || echo "$QT6_PLUGINS")"
fi
if [ ! -d "$QT6_QML/QtMultimedia" ]; then
    echo "The QtMultimedia QML module is missing ($QT6_QML/QtMultimedia)." >&2
    echo "On Arch/CachyOS install it with:" >&2
    echo "  sudo pacman -S --needed qt6-multimedia qt6-multimedia-ffmpeg" >&2
    exit 1
fi
if ! ls "$QT6_PLUGINS"/multimedia/libffmpegmediaplugin.so >/dev/null 2>&1; then
    echo "The FFmpeg backend of QtMultimedia is missing ($QT6_PLUGINS/multimedia/libffmpegmediaplugin.so)." >&2
    echo "On Arch/CachyOS install it with:" >&2
    echo "  sudo pacman -S --needed qt6-multimedia-ffmpeg" >&2
    exit 1
fi
for tool in curl sha256sum; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "$tool not found: the wallpaper's settings use it to download looks." >&2
        exit 1
    fi
done

if [ ! -f "$PKG/metadata.json" ]; then
    echo "package/metadata.json not found next to this script." >&2
    exit 1
fi

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/live-scenes-install.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
cp -r "$PKG" "$STAGE/package"
LOOK="$STAGE/package/contents/looks/$DEFAULT_LOOK"

# scene.json keeping only the video that is bundled: filter_scene <in> <out> <landscape|portrait>
filter_scene() {
    if command -v python3 >/dev/null 2>&1; then
        python3 - "$1" "$2" "$3" <<'EOF'
import json, sys
src, dst, kind = sys.argv[1:4]
scene = json.load(open(src, encoding="utf-8"))
scene["videos"] = {kind: scene["videos"][kind]}
json.dump(scene, open(dst, "w", encoding="utf-8"), indent=2)
EOF
    else
        cp "$1" "$2"    # the wallpaper skips videos that scene.json lists but that are not there
    fi
}

# the default look from a local pack
stage_pack() {
    local kind
    for kind in landscape portrait; do
        [ -f "$PACK/$kind.mp4" ] || continue
        mkdir -p "$LOOK"
        cp "$PACK/$kind.mp4" "$LOOK/$kind.mp4"
        [ -f "$PACK/poster.jpg" ] && cp "$PACK/poster.jpg" "$LOOK/poster.jpg"
        filter_scene "$PACK/scene.json" "$LOOK/scene.json" "$kind"
        [ "$kind" = landscape ] || echo "Note: $PACK has no landscape video; bundling the portrait one (cropped)."
        return 0
    done
    return 1
}

# the default look from the catalog (landscape video, poster, scene.json)
download_look() {
    if ! command -v python3 >/dev/null 2>&1; then
        echo "python3 is needed to read the catalog." >&2
        return 1
    fi
    local dl="$STAGE/download"
    mkdir -p "$dl"
    echo "Downloading the default look ($DEFAULT_LOOK) from $CATALOG ..."
    curl -fsSL --max-filesize 4194304 -o "$dl/catalog.json" -- "$CATALOG" || return 1
    # prints: kind, video URL, sha256, poster URL (empty if none), and writes scene.json
    local info
    info="$(python3 - "$dl/catalog.json" "$CATALOG" "$DEFAULT_LOOK" "$dl/scene.json" <<'EOF'
import json, sys
from urllib.parse import urljoin
path, base, look_id, scene_out = sys.argv[1:5]
looks = [l for l in json.load(open(path, encoding="utf-8")).get("looks", []) if l.get("id") == look_id]
if not looks:
    sys.exit(f"{look_id} is not in the catalog")
look = looks[0]
kind = "landscape" if "landscape" in look["videos"] else "portrait"
v = dict(look["videos"][kind])
url = urljoin(base, v.pop("url"))
v = {"file": f"{kind}.mp4", **v}
scene = {"format": 1}
for k in ("id", "title", "author", "license", "description", "loop"):
    if k in look:
        scene[k] = look[k]
scene["videos"] = {kind: v}
json.dump(scene, open(scene_out, "w", encoding="utf-8"), indent=2)
print(kind)
print(url)
print(v["sha256"])
print(urljoin(base, look["poster"]) if look.get("poster") else "")
EOF
)" || return 1
    local kind url sha poster
    { read -r kind; read -r url; read -r sha; read -r poster; } <<< "$info"
    curl -fL --progress-bar -o "$dl/$kind.mp4" -- "$url" || return 1
    if [ "$(sha256sum "$dl/$kind.mp4" | cut -d' ' -f1)" != "$sha" ]; then
        echo "Checksum mismatch for $url" >&2
        return 1
    fi
    mkdir -p "$LOOK"
    mv "$dl/$kind.mp4" "$LOOK/$kind.mp4"
    mv "$dl/scene.json" "$LOOK/scene.json"
    if [ -n "$poster" ]; then
        curl -fsSL -o "$LOOK/poster.jpg" -- "$poster" || rm -f "$LOOK/poster.jpg"
    fi
}

if [ -f "$PACK/scene.json" ] && stage_pack; then
    echo "Bundling the default look from $PACK"
elif download_look; then
    :
else
    rm -rf "$LOOK"
    echo "Warning: could not get the default look ($DEFAULT_LOOK); installing without it." >&2
    echo "  The wallpaper stays dark until you save a profile in its settings." >&2
fi

# "--list" prints installed package ids; match the exact id.
if kpackagetool6 --type "$TYPE" --list 2>/dev/null | grep -qx "$ID"; then
    echo "Upgrading $ID ..."
    kpackagetool6 --type "$TYPE" --upgrade "$STAGE/package"
    UPGRADED=1
else
    echo "Installing $ID ..."
    kpackagetool6 --type "$TYPE" --install "$STAGE/package"
    UPGRADED=0
fi

echo
echo "Done. To use it: right-click the desktop > Configure Desktop and Wallpaper >"
echo "Wallpaper type > Live Scenes, then preview a look from the catalog and save it as a profile."

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
