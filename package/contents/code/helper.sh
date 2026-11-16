#!/bin/sh
# Live Scenes: file helper for the Plasma wallpaper (QML cannot write files).
# Run as:  sh helper.sh <command> [args...]
# Storage (sdk/FORMAT.md): saved looks and profiles in ~/.local/share/live-scenes/,
# previews in ~/.cache/live-scenes/preview/.
#
#   catalog <url>                  print the catalog (or "@@error <message>")
#   state                          print profiles.json, saved looks and the bundled look (sections, see below)
#   fetch <id> <landscape|portrait> <url> <sha256> <bytes> [<poster url>]
#                                  start downloading a preview video in the background
#   progress <id>                  print {"state": "...", "bytes": n, "message": "...", "file": "..."}
#                                  and keep the preview alive (see below)
#   discard <id>                   stop and delete one preview
#   clear-previews [<minutes>]     stop and delete all previews (only those older than <minutes>)
#   save <id> <scene json>         move a finished preview into looks/<id>/ with this scene.json
#   write-profiles <json>          replace profiles.json (atomically)
#   delete-look <id>               delete looks/<id>/
#
# Ids are untrusted (they come from catalogs): every id must match [a-z0-9-]+.
#
# A preview deletes itself when nobody asks for its progress for $STALE seconds (the settings page
# polls it while open), so closing the settings page or a crash never leaves a video behind.
set -u
STALE=20

DATA="${XDG_DATA_HOME:-$HOME/.local/share}/live-scenes"
PREVIEW="${XDG_CACHE_HOME:-$HOME/.cache}/live-scenes/preview"
HERE=$(cd "$(dirname "$0")" && pwd)
BUNDLED="$HERE/../looks"

die() {
    printf '{"ok": false, "error": "%s"}\n' "$1"
    exit 1
}

valid_id() {
    case "$1" in
        ""|-*|*[!a-z0-9-]*) return 1 ;;
    esac
    [ "${#1}" -le 64 ]
}

valid_url() {
    case "$1" in
        *[[:space:]]*|*[[:cntrl:]]*) return 1 ;;
        http://?*|https://?*|file:///?*) return 0 ;;
    esac
    return 1
}

valid_sha() {
    case "$1" in
        *[!0-9a-f]*) return 1 ;;
    esac
    [ "${#1}" -eq 64 ]
}

valid_int() {
    case "$1" in
        ""|*[!0-9]*) return 1 ;;
    esac
    return 0
}

fsize() {
    if [ -f "$1" ]; then wc -c < "$1" | tr -d ' '; else echo 0; fi
}

# stop the background download of one preview dir (it runs in its own process group)
stop_worker() {
    if [ -f "$1/pid" ]; then
        pid=$(cat "$1/pid" 2>/dev/null)
        if valid_int "$pid"; then
            kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
            # wait (up to 2 s) until it is gone: it deletes its folder on the way out
            i=0
            while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do sleep 0.1; i=$((i + 1)); done
        fi
        rm -f "$1/pid"
    fi
}

# the video files present in a look folder: "landscape.mp4,portrait.mp4", or "-"
videos() {
    list=""
    for f in landscape.mp4 portrait.mp4; do
        [ -f "$1/$f" ] && list="$list${list:+,}$f"
    done
    echo "${list:--}"
}

cmd="${1:-}"
[ $# -gt 0 ] && shift

case "$cmd" in
state)
    # One section per file, each starting with a line "@@<kind> ...":
    #   @@data <dir>                  the saved-data folder
    #   @@profiles                    followed by profiles.json (if it exists)
    #   @@look <id> <bytes> <videos> <dir>   followed by that look's scene.json
    #   @@bundled <id> <videos> <dir>        followed by the bundled look's scene.json
    #   (<videos>: the video files present, comma-separated, or "-")
    #   @@end
    # The data folder is created so that the wallpaper can watch it for changes.
    mkdir -p "$DATA/looks"
    echo "@@data $DATA"
    if [ -f "$DATA/profiles.json" ]; then
        echo "@@profiles"
        cat "$DATA/profiles.json"
        echo
    fi
    for dir in "$DATA"/looks/*/; do
        [ -f "$dir/scene.json" ] || continue
        id=$(basename "$dir")
        valid_id "$id" || continue
        bytes=$(du -sb "$dir" 2>/dev/null | cut -f1)
        valid_int "$bytes" || bytes=$(( $(du -sk "$dir" | cut -f1) * 1024 ))
        echo "@@look $id $bytes $(videos "$dir") $(cd "$dir" && pwd)"
        cat "$dir/scene.json"
        echo
    done
    for dir in "$BUNDLED"/*/; do
        [ -f "$dir/scene.json" ] || continue
        id=$(basename "$dir")
        echo "@@bundled $id $(videos "$dir") $(cd "$dir" && pwd)"
        cat "$dir/scene.json"
        echo
    done
    echo "@@end"
    ;;

catalog)
    url="${1:-}"
    valid_url "$url" || { echo "@@error invalid catalog url"; exit 1; }
    out=$(curl -fsSL --proto '=http,https,file' --max-filesize 4194304 --max-time 60 -- "$url" 2>&1) \
        || { echo "@@error $(printf '%s' "$out" | tail -n 1)"; exit 1; }
    printf '%s\n' "$out"
    ;;

fetch)
    [ $# -ge 5 ] || die "usage: fetch <id> <landscape|portrait> <url> <sha256> <bytes> [<poster url>]"
    id=$1; kind=$2; url=$3; sha=$4; bytes=$5; poster="${6:-}"
    valid_id "$id" || die "invalid id"
    case "$kind" in landscape|portrait) ;; *) die "invalid video kind" ;; esac
    valid_url "$url" || die "invalid video url"
    valid_sha "$sha" || die "invalid sha256"
    valid_int "$bytes" || die "invalid size"
    if [ -n "$poster" ] && ! valid_url "$poster"; then poster=""; fi
    dir="$PREVIEW/$id"
    stop_worker "$dir"
    rm -rf "$dir"
    mkdir -p "$dir" || die "cannot create the preview folder"
    echo "downloading" > "$dir/status"
    date +%s > "$dir/heartbeat"
    # detach: own session/process group, no inherited stdout (the caller waits for it to close)
    setsid sh "$0" _worker "$id" "$kind" "$url" "$sha" "$bytes" "$poster" </dev/null >/dev/null 2>&1 &
    echo '{"ok": true}'
    ;;

_worker)
    id=$1; kind=$2; url=$3; sha=$4; bytes=$5; poster=$6
    valid_id "$id" || exit 1
    dir="$PREVIEW/$id"
    file="$dir/$kind.mp4"
    echo $$ > "$dir/pid"
    cpid=""
    # true when nobody polled the progress for $STALE seconds: then delete the preview
    abandoned() {
        [ -d "$dir" ] || return 0
        beat=$(cat "$dir/heartbeat" 2>/dev/null)
        valid_int "$beat" || return 0
        [ $(( $(date +%s) - beat )) -gt "$STALE" ]
    }
    cleanup() {
        [ -n "$cpid" ] && kill "$cpid" 2>/dev/null
        rm -rf "$dir"
        exit 0
    }
    trap cleanup TERM INT HUP
    # 5% slack on the size in the catalog, so a bad catalog cannot fill the disk
    max=$(( bytes + bytes / 20 + 65536 ))
    curl -fsSL --proto '=http,https,file' --max-filesize "$max" --retry 2 \
        -o "$file.part" -- "$url" 2> "$dir/curl.log" &
    cpid=$!
    while kill -0 "$cpid" 2>/dev/null; do
        abandoned && cleanup
        sleep 0.25
    done
    wait "$cpid"; rc=$?; cpid=""
    if [ "$rc" -ne 0 ]; then
        msg=$(tail -n 1 "$dir/curl.log" 2>/dev/null | tr -d '"\\' | cut -c1-200)
        rm -f "$file.part"
        echo "error download failed: ${msg:-curl exit code $rc}" > "$dir/status"
    else
        echo "verifying" > "$dir/status"
        got=$(sha256sum "$file.part" | cut -d' ' -f1)
        if [ "$got" != "$sha" ]; then
            rm -f "$file.part"
            echo "error checksum mismatch: the download is corrupt or the catalog is out of date" > "$dir/status"
        else
            mv "$file.part" "$file"
            if [ -n "$poster" ]; then
                curl -fsSL --proto '=http,https,file' --max-filesize 4194304 -o "$dir/poster.jpg" -- "$poster" \
                    2>/dev/null || rm -f "$dir/poster.jpg"
            fi
            echo "done" > "$dir/status"
        fi
    fi
    rm -f "$dir/curl.log"
    # stay around until the preview is saved (the folder disappears) or abandoned
    while [ -d "$dir" ] && ! abandoned; do
        sleep 2
    done
    cleanup
    ;;

progress)
    id="${1:-}"
    valid_id "$id" || die "invalid id"
    dir="$PREVIEW/$id"
    if [ ! -f "$dir/status" ]; then
        echo '{"state": "none", "bytes": 0, "message": "", "file": ""}'
        exit 0
    fi
    date +%s > "$dir/heartbeat"
    status=$(head -n 1 "$dir/status" | tr -d '"\\')
    state=${status%% *}
    message=""
    [ "$state" = "$status" ] || message=${status#* }
    file=""; n=0
    for kind in landscape portrait; do
        if [ -f "$dir/$kind.mp4" ]; then file="$dir/$kind.mp4"; n=$(fsize "$file")
        elif [ -f "$dir/$kind.mp4.part" ]; then n=$(fsize "$dir/$kind.mp4.part")
        fi
    done
    # a worker that died without writing a final status
    if [ "$state" = "downloading" ] || [ "$state" = "verifying" ]; then
        pid=$(cat "$dir/pid" 2>/dev/null)
        if ! valid_int "$pid" || ! kill -0 "$pid" 2>/dev/null; then
            state="error"; message="the download stopped"
        fi
    fi
    printf '{"state": "%s", "bytes": %s, "message": "%s", "file": "%s"}\n' \
        "$state" "$n" "$message" "$file"
    ;;

discard)
    id="${1:-}"
    valid_id "$id" || die "invalid id"
    stop_worker "$PREVIEW/$id"
    rm -rf "${PREVIEW:?}/$id"
    echo '{"ok": true}'
    ;;

clear-previews)
    age="${1:-}"
    [ -d "$PREVIEW" ] || { echo '{"ok": true}'; exit 0; }
    for dir in "$PREVIEW"/*/; do
        [ -d "$dir" ] || continue
        dir=${dir%/}
        if valid_int "$age" && [ "$age" -gt 0 ]; then
            # keep previews touched in the last <age> minutes (another settings page may be using it)
            [ -n "$(find "$dir" -maxdepth 1 -mmin -"$age" 2>/dev/null | head -n 1)" ] && continue
        fi
        stop_worker "$dir"
        rm -rf "$dir"
    done
    echo '{"ok": true}'
    ;;

save)
    [ $# -ge 2 ] || die "usage: save <id> <scene json>"
    id=$1; scene=$2
    valid_id "$id" || die "invalid id"
    case "$scene" in "{"*"}") ;; *) die "invalid scene.json" ;; esac
    src="$PREVIEW/$id"
    [ "$(head -n 1 "$src/status" 2>/dev/null)" = "done" ] || die "the preview is not ready"
    mkdir -p "$DATA/looks" || die "cannot create $DATA/looks"
    tmp="$DATA/looks/.$id.tmp"
    rm -rf "$tmp"
    mkdir "$tmp" || die "cannot create $tmp"
    moved=0
    for kind in landscape portrait; do
        [ -f "$src/$kind.mp4" ] || continue
        mv "$src/$kind.mp4" "$tmp/$kind.mp4" || { rm -rf "$tmp"; die "cannot move the video"; }
        moved=1
    done
    [ "$moved" -eq 1 ] || { rm -rf "$tmp"; die "the preview has no video"; }
    [ -f "$src/poster.jpg" ] && mv "$src/poster.jpg" "$tmp/poster.jpg"
    printf '%s\n' "$scene" > "$tmp/scene.json"
    rm -rf "${DATA:?}/looks/$id"
    mv "$tmp" "$DATA/looks/$id" || die "cannot move the look into place"
    rm -rf "${PREVIEW:?}/$id"
    echo '{"ok": true}'
    ;;

write-profiles)
    json="${1:-}"
    case "$json" in "{"*"}") ;; *) die "invalid profiles json" ;; esac
    mkdir -p "$DATA" || die "cannot create $DATA"
    tmp="$DATA/.profiles.json.$$"
    printf '%s\n' "$json" > "$tmp" && mv -f "$tmp" "$DATA/profiles.json" || { rm -f "$tmp"; die "cannot write profiles.json"; }
    echo '{"ok": true}'
    ;;

delete-look)
    id="${1:-}"
    valid_id "$id" || die "invalid id"
    rm -rf "${DATA:?}/looks/$id"
    echo '{"ok": true}'
    ;;

*)
    die "unknown command: $cmd"
    ;;
esac
