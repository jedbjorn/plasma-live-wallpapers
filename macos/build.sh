#!/bin/sh
# Builds LiveScenes.app and installs it to ~/Applications.
#   ./macos/build.sh          build and install
#   ./macos/build.sh --run    also (re)start it
#
# Bundles the default look (Living Water, landscape video only) from build/packs/living-water/, a look
# pack made by the SDK (set LIVESCENES_DEFAULT_PACK to use another). Without one, it is downloaded once
# from the catalog (LIVESCENES_CATALOG, default: the latest release), checksummed, and kept in
# macos/build/default/ for later builds.
set -eu
cd "$(dirname "$0")/.."

CATALOG="${LIVESCENES_CATALOG:-https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/catalog.json}"
pack=${LIVESCENES_DEFAULT_PACK:-build/packs/living-water}
cached=macos/build/default
out=macos/build/LiveScenes.app

# ---- the default look: Resources/default/{scene.json,landscape.mp4,poster.jpg}
default_look() {
    if [ -f "$pack/scene.json" ]; then
        echo "Bundling the default look from $pack"
        rm -rf "$cached.new" && mkdir -p "$cached.new" || return 1
        file=$(python3 - "$pack/scene.json" "$cached.new/scene.json" <<'EOF'
import json, sys
s = json.load(open(sys.argv[1], encoding="utf-8"))
v = s["videos"]
kind = "landscape" if "landscape" in v else "portrait"
s["videos"] = {kind: v[kind]}
json.dump(s, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
print(v[kind]["file"])
EOF
) || return 1
        cp "$pack/$file" "$cached.new/$file" || return 1
        if [ -f "$pack/poster.jpg" ]; then cp "$pack/poster.jpg" "$cached.new/poster.jpg" || return 1; fi
        rm -rf "$cached" && mv "$cached.new" "$cached" || return 1
        return 0
    fi
    if [ -f "$cached/scene.json" ]; then
        return 0
    fi
    echo "Downloading the default look (living-water) from $CATALOG ..."
    rm -rf "$cached.new" && mkdir -p "$cached.new" || return 1
    curl -fsSL --max-filesize 4194304 -o "$cached.new/catalog.json" -- "$CATALOG" || return 1
    # prints: video URL, sha256, poster URL (empty if none), and writes scene.json
    info=$(python3 - "$cached.new/catalog.json" "$CATALOG" "$cached.new/scene.json" <<'EOF'
import json, sys
from urllib.parse import urljoin
path, base, scene_out = sys.argv[1:4]
looks = [l for l in json.load(open(path, encoding="utf-8")).get("looks", []) if l.get("id") == "living-water"]
if not looks:
    sys.exit("living-water is not in the catalog")
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
) || return 1
    kind=$(echo "$info" | sed -n 1p)
    url=$(echo "$info" | sed -n 2p)
    sha=$(echo "$info" | sed -n 3p)
    poster=$(echo "$info" | sed -n 4p)
    curl -fL --progress-bar -o "$cached.new/$kind.mp4" -- "$url" || return 1
    if [ "$(shasum -a 256 "$cached.new/$kind.mp4" | cut -d' ' -f1)" != "$sha" ]; then
        echo "Checksum mismatch for $url" >&2
        return 1
    fi
    if [ -n "$poster" ]; then
        curl -fsSL -o "$cached.new/poster.jpg" -- "$poster" || rm -f "$cached.new/poster.jpg"
    fi
    rm -f "$cached.new/catalog.json"
    rm -rf "$cached" && mv "$cached.new" "$cached" || return 1
}

mkdir -p macos/build
if ! default_look; then
    rm -rf "$cached.new"
    echo "Warning: could not get the default look (living-water); building without it." >&2
    echo "  The wallpaper stays dark until you save a profile." >&2
fi

# ---- the app
rm -rf "$out"
mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"

cat > "$out/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.designsos.livescenes</string>
  <key>CFBundleName</key><string>Live Scenes</string>
  <key>CFBundleDisplayName</key><string>Live Scenes</string>
  <key>CFBundleExecutable</key><string>LiveScenes</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.0</string>
  <key>CFBundleVersion</key><string>2</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

swiftc -O -swift-version 5 -target "$(uname -m)-apple-macos13.0" \
    -o "$out/Contents/MacOS/LiveScenes" macos/Sources/*.swift
if [ -f "$cached/scene.json" ]; then cp -R "$cached" "$out/Contents/Resources/default"; fi
codesign --force --sign - "$out"

mkdir -p "$HOME/Applications"
pkill -x LiveScenes 2>/dev/null && while pgrep -x LiveScenes >/dev/null; do sleep 0.2; done || true
rm -rf "$HOME/Applications/LiveScenes.app"
cp -R "$out" "$HOME/Applications/"
echo "installed $HOME/Applications/LiveScenes.app"

if [ "${1:-}" = "--run" ]; then
  open "$HOME/Applications/LiveScenes.app"
fi
