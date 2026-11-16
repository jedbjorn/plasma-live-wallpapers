#!/bin/sh
# Builds LiveScenes.app and installs it to ~/Applications.
#   ./macos/build.sh          build and install
#   ./macos/build.sh --run    also (re)start it
set -eu
cd "$(dirname "$0")/.."

out=macos/build/LiveScenes.app
rm -rf "$out"
mkdir -p "$out/Contents/MacOS" "$out/Contents/Resources"

cat > "$out/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>com.designsos.livescenes</string>
  <key>CFBundleName</key><string>Live Scenes</string>
  <key>CFBundleExecutable</key><string>LiveScenes</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF

swiftc -O -o "$out/Contents/MacOS/LiveScenes" macos/LiveScenes.swift
cp -R scenes-src "$out/Contents/Resources/web"
codesign --force --sign - "$out"

mkdir -p "$HOME/Applications"
pkill -x LiveScenes 2>/dev/null && while pgrep -x LiveScenes >/dev/null; do sleep 0.2; done || true
rm -rf "$HOME/Applications/LiveScenes.app"
cp -R "$out" "$HOME/Applications/"
echo "installed $HOME/Applications/LiveScenes.app"

if [ "${1:-}" = "--run" ]; then
  open "$HOME/Applications/LiveScenes.app"
fi
