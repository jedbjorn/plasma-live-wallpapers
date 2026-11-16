.pragma library
// Shared by the wallpaper (main.qml) and its settings page (config.qml): parsing what
// helper.sh prints, and the profile -> look -> video resolution described in sdk/FORMAT.md.

var DEFAULT_CATALOG = "https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/catalog.json";
var SPEEDS = [0.5, 1.0, 2.0];

function validId(id) {
    return typeof id === "string" && /^[a-z0-9-]{1,64}$/.test(id) && id[0] !== "-";
}

function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { return null; }
}

// "file://" URL for a local path (each path segment percent-encoded)
function fileUrl(path) {
    return "file://" + path.split("/").map(encodeURIComponent).join("/");
}

// a local path from a "file://" URL
function localPath(url) {
    return decodeURIComponent(String(url).replace(/^file:\/\//, ""));
}

function speed(value) {
    var v = Number(value);
    return SPEEDS.indexOf(v) >= 0 ? v : 1.0;
}

// Output of `helper.sh state` -> { dataDir, profiles: {format, active, profiles: []}, looks: {id: look}, bundled }
// where a look is { id, dir, bytes, scene }.
function parseState(text) {
    // profilesRaw: profiles.json as read, so that rewriting it keeps keys this version does not know
    var state = { dataDir: "", profiles: { format: 1, active: "", profiles: [] },
                  profilesRaw: { format: 1, active: "", profiles: [] }, looks: {}, bundled: null, ok: false };
    var sections = String(text).split(/^@@/m);
    for (var i = 0; i < sections.length; i++) {
        var s = sections[i];
        var nl = s.indexOf("\n");
        var head = (nl >= 0 ? s.slice(0, nl) : s).trim().split(" ");
        var body = nl >= 0 ? s.slice(nl + 1) : "";
        var kind = head[0];
        if (kind === "data") {
            state.dataDir = head.slice(1).join(" ");
        } else if (kind === "profiles") {
            var p = parseJson(body);
            state.profilesBroken = !(p && Array.isArray(p.profiles));
            if (p && Array.isArray(p.profiles)) {
                state.profilesRaw = p;
                state.profiles = {
                    format: p.format || 1,
                    active: typeof p.active === "string" ? p.active : "",
                    profiles: p.profiles.filter(function (q) {
                        return q && typeof q.id === "string" && q.id !== "" && validId(q.look);
                    }).map(function (q) {
                        return { id: q.id, name: String(q.name || q.look), look: q.look, speed: speed(q.speed) };
                    })
                };
            }
        } else if (kind === "look" || kind === "bundled") {
            var id = head[1];
            var scene = parseJson(body);
            if (!validId(id) || !scene || typeof scene.videos !== "object")
                continue;
            var at = kind === "look" ? 3 : 2;    // @@look <id> <bytes> <videos> <dir> / @@bundled <id> <videos> <dir>
            var look = {
                id: id,
                bytes: kind === "look" ? Number(head[2]) || 0 : 0,
                files: head[at] === "-" ? [] : String(head[at]).split(","),
                dir: head.slice(at + 1).join(" "),
                scene: scene
            };
            if (kind === "look")
                state.looks[id] = look;
            else if (!state.bundled)
                state.bundled = look;
        } else if (kind === "end") {
            state.ok = true;
        }
    }
    return state;
}

function lookTitle(state, id) {
    var look = state && state.looks[id];
    return look && look.scene.title ? String(look.scene.title) : id;
}

function fraction(v) {
    v = Number(v);
    return isNaN(v) ? 0.5 : Math.max(0, Math.min(1, v));
}

// The video of a look to play on a screen: the one matching the orientation, else the other one.
// -> { url, width, height, focusX, focusY } or null
function pickVideo(look, landscape) {
    if (!look || !look.scene || !look.scene.videos)
        return null;
    var v = look.scene.videos;
    var order = landscape ? ["landscape", "portrait"] : ["portrait", "landscape"];
    for (var i = 0; i < order.length; i++) {
        var e = v[order[i]];
        if (!e || typeof e.file !== "string" || e.file === "" || e.file.indexOf("/") >= 0)
            continue;
        if (look.files && look.files.indexOf(e.file) < 0)
            continue;                                   // listed in scene.json but not on disk
        var f = Array.isArray(e.focus) && e.focus.length === 2 ? e.focus : [0.5, 0.5];
        return {
            url: fileUrl(look.dir + "/" + e.file),
            width: Number(e.width) || 0,
            height: Number(e.height) || 0,
            focusX: fraction(f[0]),
            focusY: fraction(f[1])
        };
    }
    return null;
}

// What a wallpaper shows: the configured profile, else profiles.json's active one, else the first,
// else the bundled look. -> { profile (or null), look, video, speed, bundled }
function resolve(state, profileId, landscape) {
    if (!state)
        return null;
    var list = state.profiles.profiles;
    var tries = [profileId, state.profiles.active];
    for (var t = 0; t < tries.length; t++) {
        for (var i = 0; i < list.length; i++) {
            if (tries[t] && list[i].id === tries[t]) {
                var r = resolveProfile(state, list[i], landscape);
                if (r)
                    return r;
            }
        }
    }
    for (var j = 0; j < list.length; j++) {
        var r2 = resolveProfile(state, list[j], landscape);
        if (r2)
            return r2;
    }
    return resolveBundled(state, landscape);
}

function resolveProfile(state, profile, landscape) {
    var look = state.looks[profile.look];
    var video = pickVideo(look, landscape);
    return video ? { profile: profile, look: look, video: video, speed: profile.speed, bundled: false } : null;
}

function resolveBundled(state, landscape) {
    var video = pickVideo(state && state.bundled, landscape);
    return video ? { profile: null, look: state.bundled, video: video, speed: 1.0, bundled: true } : null;
}

// the profile id a wallpaper instance shows (for the settings page)
function shownProfileId(state, profileId) {
    var r = resolve(state, profileId, true);
    return r && r.profile ? r.profile.id : "";
}

// Profiles that use a look
function profilesUsing(state, lookId) {
    return state.profiles.profiles.filter(function (p) { return p.look === lookId; });
}

function newProfileId(state, lookId) {
    var ids = state.profiles.profiles.map(function (p) { return p.id; });
    if (ids.indexOf(lookId) < 0)
        return lookId;
    for (var n = 2; ; n++)
        if (ids.indexOf(lookId + "-" + n) < 0)
            return lookId + "-" + n;
}

// Resolve a catalog URL (may be relative) against the catalog's own URL
function resolveUrl(base, rel) {
    rel = String(rel || "");
    if (rel === "")
        return "";
    if (/^[a-z][a-z0-9+.-]*:/i.test(rel))
        return rel;
    var m = String(base).match(/^([a-z][a-z0-9+.-]*:\/\/[^\/]*)([^?#]*)/i);
    if (!m)
        return rel;
    if (rel.indexOf("//") === 0)
        return base.split(":")[0] + ":" + rel;
    if (rel[0] === "/")
        return m[1] + rel;
    var dir = m[2].replace(/[^\/]*$/, "");
    return m[1] + (dir || "/") + rel;
}

function formatBytes(n) {
    n = Number(n) || 0;
    if (n >= 1024 * 1024 * 1024)
        return (n / 1024 / 1024 / 1024).toFixed(1) + " GB";
    if (n >= 1024 * 1024)
        return (n / 1024 / 1024).toFixed(n >= 100 * 1024 * 1024 ? 0 : 1) + " MB";
    return Math.max(1, Math.round(n / 1024)) + " KB";
}

function speedLabel(v) {
    return (v === 0.5 ? "0.5" : String(v)) + "×";
}
