#!/bin/sh
# Builds LiveScenes.apk with the Android SDK's own tools (no Gradle, no Android Studio).
#   ./android/build.sh            build android/build/LiveScenes.apk
#   ./android/build.sh --install  also install it on the connected device (adb)
#   ./android/build.sh --run      install, then open the live wallpaper preview to set it
# Needs: a JDK (17+), and from the SDK: platform-tools, build-tools, and a platforms;android-<api>.
# Bundles the default look (Living Water) from build/packs/living-water/, a look pack made by the SDK
# (sdk/FORMAT.md); set LIVESCENES_DEFAULT_PACK to use another pack folder.
# The version comes from the VERSION file: versionName as it is, versionCode 2.1.0 -> 20100.
# Signing: the standard debug key, or a release key with
#   LIVESCENES_KEYSTORE=<keystore file>  LIVESCENES_KEY_ALIAS=<alias, if the keystore has several>
#   LIVESCENES_KEYSTORE_PASS=<password>  (if unset, apksigner asks for it)
# Android only installs an update signed with the same key as the installed app, so every published
# APK must be signed with the same release key (release.sh).
# LIVESCENES_DEBUG=1 makes a debuggable build, the only kind that accepts another update manifest:
#   adb shell am start -n com.designsos.livescenes/.SettingsActivity --es updateUrl http://127.0.0.1:8000/update.json
set -eu
cd "$(dirname "$0")/.."

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}
[ -d "$sdk" ] || { echo "Android SDK not found: set ANDROID_HOME (tried $sdk)" >&2; exit 1; }
bt=$(ls -d "$sdk"/build-tools/*/ 2>/dev/null | sort -V | tail -n1)
platform=$(ls -d "$sdk"/platforms/android-*/ 2>/dev/null | sort -V | tail -n1)
[ -n "$bt" ] || { echo "no build-tools in $sdk: sdkmanager 'build-tools;35.0.0'" >&2; exit 1; }
[ -n "$platform" ] || { echo "no platform in $sdk: sdkmanager 'platforms;android-35'" >&2; exit 1; }
jar=${platform}android.jar
for t in javac keytool zip; do command -v $t >/dev/null || { echo "missing: $t" >&2; exit 1; }; done
echo "build-tools $(basename "$bt"), $(basename "$platform")"
pack=${LIVESCENES_DEFAULT_PACK:-build/packs/living-water}
[ -f "$pack/scene.json" ] && [ -f "$pack/poster.jpg" ] && { [ -f "$pack/portrait.mp4" ] || [ -f "$pack/landscape.mp4" ]; } || {
  echo "no default look pack in $pack: make it with the SDK (sdk/livescenes), or set LIVESCENES_DEFAULT_PACK" >&2; exit 1; }
echo "default look: $pack"
version=$(tr -d '[:space:]' < VERSION)
IFS=. read -r major minor patch <<EOF
$version
EOF
case "$major$minor$patch" in ''|*[!0-9]*) echo "VERSION must be <major>.<minor>.<patch>, not '$version'" >&2; exit 1 ;; esac
[ "$minor" -lt 100 ] && [ "$patch" -lt 100 ] || { echo "VERSION: minor and patch must be below 100" >&2; exit 1; }
code=$(( major * 10000 + minor * 100 + patch ))
echo "version $version (versionCode $code)${LIVESCENES_DEBUG:+, debuggable}"

out=android/build
rm -rf "$out"
mkdir -p "$out/res" "$out/gen" "$out/classes" "$out/assets"

# resources, plus the default look's poster as the picker thumbnail; the look itself as assets
# (only the portrait video: phones; the landscape one only if there is no portrait one)
cp -R android/res/. "$out/res/"
mkdir -p "$out/res/drawable-nodpi" "$out/assets/default"
cp "$pack/poster.jpg" "$out/res/drawable-nodpi/thumb.jpg"
cp "$pack/scene.json" "$pack/poster.jpg" "$out/assets/default/"
if [ -f "$pack/portrait.mp4" ]; then cp "$pack/portrait.mp4" "$out/assets/default/"
else cp "$pack/landscape.mp4" "$out/assets/default/"; fi

"$bt/aapt2" compile --dir "$out/res" -o "$out/res.zip"
"$bt/aapt2" link -o "$out/base.apk" -I "$jar" --manifest android/AndroidManifest.xml \
  --version-name "$version" --version-code "$code" ${LIVESCENES_DEBUG:+--debug-mode} \
  -A "$out/assets" -0 mp4 --java "$out/gen" "$out/res.zip"
echo "$code" > "$out/version-code"

javac --release 17 -nowarn -Xlint:-options -encoding UTF-8 -cp "$jar" -d "$out/classes" \
  $(find android/src "$out/gen" -name '*.java')
"$bt/d8" --release --min-api 29 --lib "$jar" --output "$out" $(find "$out/classes" -name '*.class')

cp "$out/base.apk" "$out/unsigned.apk"
(cd "$out" && zip -q unsigned.apk classes.dex)
"$bt/zipalign" -f -p 4 "$out/unsigned.apk" "$out/aligned.apk"

if [ -n "${LIVESCENES_KEYSTORE:-}" ]; then
  # a release key
  [ -f "$LIVESCENES_KEYSTORE" ] || { echo "LIVESCENES_KEYSTORE: no such file: $LIVESCENES_KEYSTORE" >&2; exit 1; }
  "$bt/apksigner" sign --ks "$LIVESCENES_KEYSTORE" \
    ${LIVESCENES_KEY_ALIAS:+--ks-key-alias "$LIVESCENES_KEY_ALIAS"} \
    ${LIVESCENES_KEYSTORE_PASS:+--ks-pass env:LIVESCENES_KEYSTORE_PASS} \
    --out "$out/LiveScenes.apk" "$out/aligned.apk"
else
  # the standard debug key, made once if this machine has none
  ks=$HOME/.android/debug.keystore
  if [ ! -f "$ks" ]; then
    mkdir -p "$HOME/.android"
    keytool -genkeypair -keystore "$ks" -storepass android -keypass android -alias androiddebugkey \
      -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
  fi
  "$bt/apksigner" sign --ks "$ks" --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey --out "$out/LiveScenes.apk" "$out/aligned.apk"
fi
echo "built $out/LiveScenes.apk"
"$bt/apksigner" verify --print-certs "$out/LiveScenes.apk" \
  | sed -n 's/^Signer #1 certificate SHA-256 digest: /signing key (sha256): /p'

case "${1:-}" in
  --install|--run)
    adb=$sdk/platform-tools/adb
    [ -x "$adb" ] || adb=adb
    "$adb" install -r "$out/LiveScenes.apk"
    if [ "$1" = --run ]; then
      "$adb" shell am start -a android.service.wallpaper.CHANGE_LIVE_WALLPAPER \
        --ecn android.service.wallpaper.extra.LIVE_WALLPAPER_COMPONENT \
        com.designsos.livescenes/.LiveWallpaperService
    fi
    ;;
esac
