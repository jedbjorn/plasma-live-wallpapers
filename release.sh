#!/usr/bin/env bash
# Build the files a release needs for in-app updates (nothing is uploaded):
#   ./release.sh [--no-android] [-o <folder>]      default folder: build/release/
#
#   live-scenes-plasma-<version>.tar.gz   the Plasma plugin: package/ without a look (an update keeps
#                                         the look that is installed)
#   LiveScenes-<version>.apk              the Android app, built by android/build.sh
#   update.json                           the update manifest the apps read (sdk/FORMAT.md)
#
# The version is the one in the VERSION file. Upload the files to the GitHub release v<version>
# together with the catalog (sdk/livescenes catalog ... -o the same folder): the apps read both from
# the latest release.
#
# Android only installs an update signed with the same key as the installed app. Sign every release
# with one release key: set LIVESCENES_KEYSTORE (see android/build.sh) and keep that keystore safe.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/build/release"
ANDROID=1
REPO="https://github.com/jedbjorn/plasma-live-wallpapers"

while [ $# -gt 0 ]; do
    case "$1" in
        --no-android) ANDROID=0 ;;
        -o) OUT="${2:?-o needs a folder}"; shift ;;
        -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
    shift
done

VERSION="$(tr -d '[:space:]' < "$HERE/VERSION")"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "VERSION must be <major>.<minor>.<patch>, not '$VERSION'." >&2
    exit 1
fi
# the Plasma plugin carries the version twice: for kpackagetool6, and for the code plasmashell has loaded
in_metadata="$(sed -n 's/.*"Version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$HERE/package/metadata.json")"
in_store="$(sed -n 's/^var VERSION = "\([^"]*\)".*/\1/p' "$HERE/package/contents/ui/Store.js")"
if [ "$in_metadata" != "$VERSION" ] || [ "$in_store" != "$VERSION" ]; then
    echo "The version is $VERSION in VERSION, but '$in_metadata' in package/metadata.json and '$in_store'" >&2
    echo "in package/contents/ui/Store.js: make them the same." >&2
    exit 1
fi

mkdir -p "$OUT"
entry() {   # "url", "bytes" and "sha256" of a file in $OUT, as JSON members
    printf '"url": "%s", "bytes": %s, "sha256": "%s"' \
        "$1" "$(wc -c < "$OUT/$1" | tr -d ' ')" "$(sha256sum "$OUT/$1" | cut -d' ' -f1)"
}

PLUGIN="live-scenes-plasma-$VERSION.tar.gz"
tar -C "$HERE" --exclude=package/contents/looks --sort=name --owner=0 --group=0 --numeric-owner \
    -cf - package | gzip -n > "$OUT/$PLUGIN"
echo "built $OUT/$PLUGIN"
MANIFEST="  \"plasma\": { $(entry "$PLUGIN") }"

if [ "$ANDROID" -eq 1 ]; then
    "$HERE/android/build.sh"
    APK="LiveScenes-$VERSION.apk"
    cp "$HERE/android/build/LiveScenes.apk" "$OUT/$APK"
    MANIFEST="$MANIFEST,
  \"android\": { \"versionCode\": $(cat "$HERE/android/build/version-code"), $(entry "$APK") }"
fi

cat > "$OUT/update.json" <<EOF
{
  "format": 1,
  "version": "$VERSION",
  "notes": "$REPO/releases/tag/v$VERSION",
$MANIFEST
}
EOF
echo "wrote $OUT/update.json"

echo
if [ "$ANDROID" -eq 0 ]; then
    echo "No Android app in this release: phones will not be offered it as an update."
elif [ -z "${LIVESCENES_KEYSTORE:-}" ]; then
    echo "WARNING: the APK is signed with this machine's debug key (~/.android/debug.keystore)."
    echo "  Phones only accept an update signed with the key of the app they have. For releases, make a"
    echo "  release key once, keep it safe, and build with LIVESCENES_KEYSTORE set (android/build.sh)."
fi
echo "To publish: add the catalog and its looks to the same folder (sdk/livescenes catalog <packs> -o $OUT),"
echo "then create the release, for example:"
echo "  gh release create v$VERSION --title v$VERSION $OUT/*"
