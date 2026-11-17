import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import QtQuick.Window
import Qt.labs.folderlistmodel
import org.kde.kirigami as Kirigami
import "Store.js" as Store

// Settings of one Live Scenes wallpaper (one screen/activity):
//  - Profiles: which saved profile this wallpaper shows (cfg_Profile), their speed, rename, delete.
//  - Catalog: browse looks, preview one (downloaded to the cache), save it as a profile or discard it.
// Profile edits are written to ~/.local/share/live-scenes/profiles.json right away (they are shared by
// every screen); only the choice of profile for this wallpaper waits for Apply.
ColumnLayout {
    id: page

    property var configDialog
    property var wallpaperConfiguration

    property string cfg_Profile
    property string cfg_ProfileDefault
    property string cfg_CatalogUrl
    property string cfg_CatalogUrlDefault

    // helper.sh state: profiles.json, saved looks, bundled look
    property var store: null
    readonly property var profiles: store ? store.profiles.profiles : []
    readonly property string shownId: Store.shownProfileId(store, cfg_Profile)
    readonly property real storageBytes: {
        let n = 0;
        if (store)
            for (const id in store.looks)
                n += store.looks[id].bytes;
        return n;
    }
    property string error: ""

    // catalog
    readonly property string catalogUrl: cfg_CatalogUrl.trim() !== "" ? cfg_CatalogUrl.trim() : Store.DEFAULT_CATALOG
    property var catalog: []
    property bool catalogLoading: false
    property string catalogError: ""

    // preview: the catalog look being previewed, and its download progress
    property var preview: null
    property var progress: ({ state: "", bytes: 0, message: "", file: "" })
    property bool saving: false

    // a saved look's level being downloaded: { id, level, kind, video, scene, bytes }
    property var levelJob: null

    // updates of the plugin itself: the installed version (metadata.json on disk), the newer release
    // if there is one ({ version, notes, url, sha256, bytes }), and what is going on
    property string installedVersion: ""
    property var update: null
    property string updateState: ""           // "", "checking", "installing"
    property string updateError: ""
    property string updateNote: ""            // the answer to "Check for updates"
    // an upgrade is on disk, but plasmashell still runs the code it loaded before
    readonly property bool restartNeeded: Store.validVersion(installedVersion)
                                          && Store.compareVersions(installedVersion, Store.VERSION) > 0
    readonly property string restartCommand: "systemctl --user restart plasma-plasmashell.service"

    spacing: Kirigami.Units.largeSpacing

    Helper {
        id: helper
    }

    // ---------------------------------------------------------------- logic

    function refresh() {
        helper.run(["state"], out => {
            const state = Store.parseState(out);
            if (state.ok)
                page.store = state;
            else
                page.error = "Cannot read the saved profiles: " + out;
        });
    }

    // Read profiles.json again, let edit(raw, state) change it, write it back. Edits run one after
    // the other, so that each starts from the file the previous one wrote.
    property var edits: []
    property bool editBusy: false

    function editProfiles(edit, done) {
        edits.push({ edit: edit, done: done });
        if (!editBusy)
            nextEdit();
    }

    function nextEdit() {
        const job = edits.shift();
        editBusy = job !== undefined;
        if (!job) {
            refresh();
            return;
        }
        const edit = job.edit, done = job.done;
        helper.run(["state"], out => {
            const state = Store.parseState(out);
            if (!state.ok || state.profilesBroken) {
                page.error = state.profilesBroken
                    ? "profiles.json in " + state.dataDir + " is not valid JSON: fix or remove it."
                    : "Cannot read the saved profiles: " + out;
                page.nextEdit();
                return;
            }
            const raw = JSON.parse(JSON.stringify(state.profilesRaw));
            if (!Array.isArray(raw.profiles))
                raw.profiles = [];
            raw.format = raw.format || 1;
            edit(raw, state);
            helper.run(["write-profiles", JSON.stringify(raw, null, 2)], res => {
                const r = Store.parseJson(res);
                if (!r || !r.ok)
                    page.error = "Cannot write profiles.json: " + res;
                else if (done)
                    done(raw, state);
                page.nextEdit();
            });
        });
    }

    function setSpeed(id, speed) {
        editProfiles(raw => raw.profiles.forEach(p => { if (p && p.id === id) p.speed = speed; }));
    }

    function rename(id, name) {
        name = name.trim();
        if (name !== "")
            editProfiles(raw => raw.profiles.forEach(p => { if (p && p.id === id) p.name = name; }));
    }

    function deleteProfile(id) {
        if (id === page.shownId)
            return;
        let lookId = "";
        editProfiles(raw => {
            raw.profiles = raw.profiles.filter(p => {
                if (p && p.id === id) {
                    lookId = p.look;
                    return false;
                }
                return true;
            });
            if (raw.active === id || !raw.profiles.some(p => p && p.id === raw.active))
                raw.active = raw.profiles.length > 0 && raw.profiles[0].id ? raw.profiles[0].id : "";
        }, raw => {
            // a look's files go when no profile uses it any more
            if (Store.validId(lookId) && !raw.profiles.some(p => p && p.look === lookId))
                helper.run(["delete-look", lookId], () => page.refresh());
            if (page.cfg_Profile === id)
                page.cfg_Profile = "";
        });
    }

    // a new profile for a saved look; this wallpaper shows it after Apply
    function addProfile(lookId, name, speed) {
        editProfiles((raw, state) => {
            const id = Store.newProfileId(state, lookId);
            raw.profiles.push({ id: id, name: name, look: lookId, speed: speed });
            if (!raw.active || !raw.profiles.some(p => p && p.id === raw.active))
                raw.active = id;
            page.cfg_Profile = id;
        });
    }

    function loadCatalog() {
        const url = page.catalogUrl;
        page.catalogLoading = true;
        page.catalogError = "";
        helper.run(["catalog", url], out => {
            if (url !== page.catalogUrl)
                return;                       // the URL changed meanwhile
            page.catalogLoading = false;
            if (out.indexOf("@@error") === 0) {
                page.catalogError = "Cannot load the catalog: " + out.slice(8).trim();
                page.catalog = [];
                return;
            }
            const c = Store.parseJson(out);
            if (!c || !Array.isArray(c.looks)) {
                page.catalogError = "The catalog at " + url + " is not a Live Scenes catalog.";
                page.catalog = [];
                return;
            }
            page.catalog = c.looks.map(l => catalogLook(l, url)).filter(l => l !== null);
        });
    }

    // a catalog entry with resolved URLs and the video a desktop downloads (landscape, else portrait);
    // a look with levels also has levels: { label, default, raw, videos: { <level>: video } }
    function catalogLook(l, base) {
        if (!l || !Store.validId(l.id) || !l.videos)
            return null;
        const pick = catalogVideo(l.videos, base);
        let levels = null;
        if (l.levels && l.levels.videos) {
            levels = { label: String(l.levels.label || "Level"), "default": Store.level({ levels: l.levels }),
                       raw: l.levels, videos: {} };
            for (const lv of Store.LEVELS) {
                const p = catalogVideo(l.levels.videos[lv] || {}, base);
                levels.videos[lv] = p.kind === pick.kind ? p.video : null;
            }
        }
        return {
            id: l.id,
            title: String(l.title || l.id),
            author: String(l.author || ""),
            license: String(l.license || ""),
            description: String(l.description || ""),
            loop: Number(l.loop) || 0,
            posterUrl: l.poster ? Store.resolveUrl(base, l.poster) : "",
            kind: pick.kind,
            video: pick.video,
            levels: levels
        };
    }

    // the video of a catalog "videos" object a desktop downloads -> { kind, video }
    function catalogVideo(videos, base) {
        for (const k of ["landscape", "portrait"]) {
            const v = videos[k];
            if (v && typeof v.url === "string" && /^[0-9a-f]{64}$/.test(v.sha256) && Number(v.bytes) > 0)
                return { kind: k, video: {
                    url: Store.resolveUrl(base, v.url), width: Number(v.width) || 0, height: Number(v.height) || 0,
                    fps: Number(v.fps) || 0, bytes: Number(v.bytes), sha256: v.sha256,
                    focus: Array.isArray(v.focus) && v.focus.length === 2 ? [Store.fraction(v.focus[0]), Store.fraction(v.focus[1])] : [0.5, 0.5]
                } };
        }
        return { kind: "", video: null };
    }

    // the scene.json entry of a downloaded video, saved as `file`
    function savedEntry(v, file) {
        const entry = { file: file, width: v.width, height: v.height, bytes: v.bytes, sha256: v.sha256, focus: v.focus };
        if (v.fps)
            entry.fps = v.fps;
        return entry;
    }

    function startPreview(look) {
        if (!look.video)
            return;
        stopPreview();
        page.preview = look;
        page.progress = { state: "downloading", bytes: 0, message: "", file: "" };
        previewName.text = look.title;
        previewSpeed.currentIndex = 1;
        helper.run(["fetch", look.id, look.kind, look.video.url, look.video.sha256, String(look.video.bytes), look.posterUrl],
                   out => {
            const r = Store.parseJson(out);
            if (!r || !r.ok)
                page.progress = { state: "error", bytes: 0, message: r && r.error ? r.error : out, file: "" };
        });
    }

    function stopPreview() {
        if (page.preview)
            helper.run(["discard", page.preview.id]);
        page.preview = null;
        page.progress = { state: "", bytes: 0, message: "", file: "" };
    }

    function pollPreview() {
        if (!page.preview)
            return;
        const id = page.preview.id;
        helper.run(["progress", id], out => {
            const r = Store.parseJson(out);
            if (!page.preview || page.preview.id !== id || !r)
                return;
            if (r.state === "none")
                page.progress = { state: "error", bytes: 0, message: "the preview was removed", file: "" };
            else if (r.state !== page.progress.state || r.bytes !== page.progress.bytes || r.file !== page.progress.file)
                page.progress = r;
        });
    }

    function savePreview() {
        const look = page.preview;
        if (!look || page.progress.state !== "done")
            return;
        // a look with levels is saved at its default level (the plain videos), its file named after it
        const file = look.kind + (look.levels ? "-" + look.levels["default"] : "") + ".mp4";
        const scene = { format: 1, id: look.id, title: look.title, author: look.author, license: look.license,
                        description: look.description, loop: look.loop, videos: {} };
        scene.videos[look.kind] = savedEntry(look.video, file);
        if (look.levels) {
            scene.levels = look.levels.raw;
            scene.level = look.levels["default"];
        }
        const name = previewName.text.trim() || look.title;
        const speed = Store.SPEEDS[previewSpeed.currentIndex];
        page.saving = true;
        helper.run(["save", look.id, JSON.stringify(scene, null, 2), file], out => {
            page.saving = false;
            const r = Store.parseJson(out);
            if (!r || !r.ok) {
                page.error = "Cannot save the look: " + (r && r.error ? r.error : out);
                return;
            }
            page.preview = null;              // the preview folder is gone now
            page.progress = { state: "", bytes: 0, message: "", file: "" };
            page.addProfile(look.id, name, speed);
        });
    }

    // Change a saved look's level: download that level's video from the catalog (as a preview), then
    // it replaces the saved one, which is deleted. Every profile of the look plays the new level.
    function setLevel(lookId, level) {
        const saved = page.store ? page.store.looks[lookId] : null;
        const c = page.catalog.find(l => l.id === lookId);
        const v = c && c.levels ? c.levels.videos[level] : null;
        if (!saved || page.levelJob)
            return;
        if (!v) {
            page.error = c ? "The catalog has no " + level + " level of " + c.title + "."
                           : "Load the catalog first: the levels come from it.";
            return;
        }
        page.levelJob = { id: lookId, level: level, kind: c.kind, video: v, scene: saved.scene, bytes: 0 };
        helper.run(["fetch", lookId, c.kind, v.url, v.sha256, String(v.bytes)], out => {
            const r = Store.parseJson(out);
            if (!r || !r.ok)
                page.levelFailed(r && r.error ? r.error : out);
        });
    }

    function levelFailed(message) {
        if (page.levelJob)
            page.error = "Cannot change the level: " + message;
        page.levelJob = null;
    }

    function pollLevel() {
        const job = page.levelJob;
        if (!job || job.saving)
            return;
        helper.run(["progress", job.id], out => {
            const r = Store.parseJson(out);
            if (page.levelJob !== job || !r)
                return;
            if (r.state === "error" || r.state === "none") {
                helper.run(["discard", job.id]);
                page.levelFailed(r.message || "the download was removed");
            } else if (r.state === "done") {
                job.saving = true;
                const file = job.kind + "-" + job.level + ".mp4";
                const scene = JSON.parse(JSON.stringify(job.scene));
                scene.level = job.level;
                scene.videos = {};
                scene.videos[job.kind] = page.savedEntry(job.video, file);
                helper.run(["save", job.id, JSON.stringify(scene, null, 2), file], res => {
                    const s = Store.parseJson(res);
                    if (!s || !s.ok) {
                        helper.run(["discard", job.id]);
                        page.levelFailed(s && s.error ? s.error : res);
                        return;
                    }
                    page.levelJob = null;
                    page.editProfiles(raw => {});    // rewriting profiles.json makes the wallpapers re-read the looks
                });
            } else if (r.bytes !== job.bytes) {
                page.levelJob = Object.assign({}, job, { bytes: r.bytes });
            }
        });
    }

    // Is there a newer release? helper.sh asks GitHub at most once a day, unless `force` (the
    // "Check for updates" button). Being offline is only reported when the user asked.
    function checkUpdate(force) {
        if (page.updateState !== "")
            return;
        page.updateState = "checking";
        page.updateNote = "";
        helper.run(["version"], version => {
            page.installedVersion = version.trim();
            helper.run(force ? ["update-check", "force"] : ["update-check"], out => {
                page.updateState = "";
                const u = Store.parseUpdate(out);
                const newer = u !== null && Store.validVersion(page.installedVersion)
                    && Store.compareVersions(u.version, page.installedVersion) > 0;
                page.update = newer ? u : null;
                if (!force || newer)
                    return;
                if (out.indexOf("@@error") === 0)
                    page.updateNote = "Couldn't check: " + out.slice(8).trim();
                else
                    page.updateNote = u ? "This is the latest version." : "The latest release has no Plasma update.";
            });
        });
    }

    // Download the release's plugin archive and upgrade the installed package. plasmashell is not
    // restarted: the new version is used from its next start on.
    function installUpdate() {
        const u = page.update;
        if (!u || page.updateState !== "")
            return;
        page.updateState = "installing";
        page.updateError = "";
        helper.run(["update-install", u.url, u.sha256, String(u.bytes)], out => {
            page.updateState = "";
            const r = Store.parseJson(out);
            if (!r || !r.ok) {
                page.updateError = r && r.error ? r.error : out;
                return;
            }
            page.update = null;
            page.installedVersion = r.version;
        });
    }

    // Start a moment after creation: Plasma creates this page once just to read its cfg_ keys and
    // destroys it right away; that copy must not touch any files.
    Timer {
        interval: 200
        running: true
        onTriggered: {
            helper.run(["clear-previews"], () => page.refresh());   // leftovers of earlier visits
            page.loadCatalog();
            page.checkUpdate(false);
        }
    }

    // download progress; while a preview exists, polling also keeps it alive (helper.sh deletes
    // previews nobody polls, e.g. after this page is closed)
    Timer {
        interval: page.progress.state === "done" || page.progress.state === "error" ? 4000 : 400
        repeat: true
        running: page.preview !== null
        onTriggered: page.pollPreview()
    }
    Timer {
        interval: 400
        repeat: true
        running: page.levelJob !== null
        onTriggered: page.pollLevel()
    }

    // profiles.json changed elsewhere (another screen's settings, `livescenes add`): show it
    FolderListModel {
        folder: page.store && page.store.dataDir ? Store.fileUrl(page.store.dataDir) : ""
        nameFilters: ["profiles.json"]
        showDirs: false
        onDataChanged: reread.restart()
        onRowsInserted: reread.restart()
        onRowsRemoved: reread.restart()
    }
    Timer {
        id: reread
        interval: 500
        onTriggered: if (!page.editBusy) page.refresh()
    }

    // leaving the page without saving deletes the preview
    Component.onDestruction: {
        if (page.preview)
            helper.run(["discard", page.preview.id]);
        if (page.levelJob && !page.levelJob.saving)
            helper.run(["discard", page.levelJob.id]);
    }

    // ---------------------------------------------------------------- profiles

    Kirigami.InlineMessage {
        Layout.fillWidth: true
        type: Kirigami.MessageType.Error
        text: page.error
        visible: text !== ""
        showCloseButton: true
        onVisibleChanged: if (!visible) page.error = ""
    }

    // ---------------------------------------------------------------- updates

    Kirigami.InlineMessage {
        Layout.fillWidth: true
        type: Kirigami.MessageType.Information
        visible: page.update !== null
        text: {
            if (!page.update)
                return "";
            if (page.updateState === "installing")
                return "Installing Live Scenes " + page.update.version + "…";
            return "Live Scenes " + page.update.version + " is available (" + page.installedVersion
                + " is installed). Updating downloads " + Store.formatBytes(page.update.bytes)
                + "; your profiles and saved looks are kept.";
        }
        actions: [
            Kirigami.Action {
                text: "Update"
                icon.name: "update-none"
                enabled: page.updateState === ""
                onTriggered: page.installUpdate()
            },
            Kirigami.Action {
                text: "What's new"
                icon.name: "internet-services"
                visible: page.update !== null && page.update.notes !== ""
                onTriggered: Qt.openUrlExternally(page.update.notes)
            }
        ]
    }
    Kirigami.InlineMessage {
        Layout.fillWidth: true
        type: Kirigami.MessageType.Error
        text: page.updateError !== "" ? "The update failed: " + page.updateError : ""
        visible: text !== ""
        showCloseButton: true
        onVisibleChanged: if (!visible) page.updateError = ""
    }
    Kirigami.InlineMessage {
        Layout.fillWidth: true
        type: Kirigami.MessageType.Positive
        visible: page.restartNeeded
        text: "Live Scenes " + page.installedVersion + " is installed. Plasma keeps running version "
            + Store.VERSION + " until plasmashell restarts: log out and back in, or run\n" + page.restartCommand
        actions: [
            Kirigami.Action {
                text: "Copy command"
                icon.name: "edit-copy"
                onTriggered: {
                    clipboard.text = page.restartCommand;
                    clipboard.selectAll();
                    clipboard.copy();
                }
            }
        ]
    }
    TextEdit {
        id: clipboard                         // QML's only way to the clipboard
        visible: false
    }

    Kirigami.FormLayout {
        Layout.fillWidth: true
        twinFormLayouts: parentLayout

        QQC2.Label {
            Kirigami.FormData.label: "Showing:"
            text: {
                if (!page.store)
                    return "…";
                const r = Store.resolve(page.store, page.cfg_Profile, true);
                if (!r || r.bundled)
                    return "Living Water (built in)";
                return r.profile.name + " (" + Store.lookTitle(page.store, r.profile.look) + ", "
                    + Store.speedLabel(r.profile.speed) + ")";
            }
        }
        QQC2.Label {
            Kirigami.FormData.label: "Storage:"
            text: page.store
                  ? Store.formatBytes(page.storageBytes) + " in " + Object.keys(page.store.looks).length
                    + (Object.keys(page.store.looks).length === 1 ? " look" : " looks")
                  : "…"
        }
    }

    Kirigami.Heading {
        level: 3
        text: "Profiles"
    }

    QQC2.Label {
        Layout.fillWidth: true
        visible: page.store !== null && page.profiles.length === 0
        wrapMode: Text.Wrap
        text: "No saved profiles yet, so this wallpaper shows the built-in Living Water. Preview a look "
            + "from the catalog below and save it as a profile."
    }

    QQC2.ButtonGroup {
        id: shownGroup
    }

    Repeater {
        model: page.profiles

        delegate: RowLayout {
            id: row
            required property var modelData
            readonly property bool shown: modelData.id === page.shownId
            readonly property var look: page.store ? page.store.looks[modelData.look] : null
            property bool editing: false

            Layout.fillWidth: true
            spacing: Kirigami.Units.smallSpacing

            QQC2.RadioButton {
                QQC2.ButtonGroup.group: shownGroup
                checked: row.shown
                onToggled: if (checked) page.cfg_Profile = row.modelData.id
                QQC2.ToolTip.text: "Show this profile on this screen"
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
            }

            Rectangle {
                implicitWidth: Kirigami.Units.gridUnit * 4
                implicitHeight: implicitWidth * 9 / 16
                color: "#050608"
                Image {
                    anchors.fill: parent
                    source: row.look ? Store.fileUrl(row.look.dir + "/poster.jpg") : ""
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    sourceSize.width: 256
                }
            }

            ColumnLayout {
                Layout.fillWidth: true
                spacing: 0
                QQC2.Label {
                    Layout.fillWidth: true
                    visible: !row.editing
                    text: row.modelData.name
                    font.bold: row.shown
                    elide: Text.ElideRight
                }
                QQC2.TextField {
                    id: nameField
                    Layout.fillWidth: true
                    visible: row.editing
                    onAccepted: {
                        page.rename(row.modelData.id, text);
                        row.editing = false;
                    }
                    Keys.onEscapePressed: row.editing = false
                }
                QQC2.Label {
                    Layout.fillWidth: true
                    text: {
                        const job = page.levelJob;
                        if (job && job.id === row.modelData.look)
                            return "Downloading " + job.level + ": " + Store.formatBytes(job.bytes) + " of "
                                + Store.formatBytes(job.video.bytes) + "…";
                        return Store.lookTitle(page.store, row.modelData.look)
                            + (row.look ? " · " + Store.formatBytes(row.look.bytes) : " · missing")
                            + (row.modelData.id === page.store.profiles.active ? " · default" : "");
                    }
                    font: Kirigami.Theme.smallFont
                    opacity: 0.7
                    elide: Text.ElideRight
                }
            }

            // the look's level knob (sdk/FORMAT.md, "Levels"): shared by every profile of the look
            QQC2.ComboBox {
                readonly property var levels: row.look && row.look.scene.levels ? row.look.scene.levels : null
                visible: levels !== null
                enabled: page.levelJob === null
                model: Store.LEVELS.map(Store.levelLabel)
                displayText: (levels ? String(levels.label || "Level") + ": " : "") + currentText
                // the saved level until the new one is in place
                currentIndex: Math.max(0, Store.LEVELS.indexOf(Store.level(row.look ? row.look.scene : null)))
                onActivated: index => {
                    const level = Store.LEVELS[index];
                    currentIndex = Qt.binding(() => Math.max(0, Store.LEVELS.indexOf(Store.level(row.look ? row.look.scene : null))));
                    if (level !== Store.level(row.look.scene))
                        page.setLevel(row.modelData.look, level);
                }
                QQC2.ToolTip.text: (levels ? String(levels.label || "Level") : "") + " (every profile of this look)"
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
            }

            QQC2.ComboBox {
                model: Store.SPEEDS.map(Store.speedLabel)
                currentIndex: Math.max(0, Store.SPEEDS.indexOf(row.modelData.speed))
                onActivated: index => page.setSpeed(row.modelData.id, Store.SPEEDS[index])
                QQC2.ToolTip.text: "Playback speed"
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
            }

            QQC2.ToolButton {
                icon.name: row.editing ? "dialog-ok-apply" : "edit-rename"
                display: QQC2.AbstractButton.IconOnly
                text: row.editing ? "Done" : "Rename"
                QQC2.ToolTip.text: text
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                onClicked: {
                    if (row.editing) {
                        page.rename(row.modelData.id, nameField.text);
                        row.editing = false;
                    } else {
                        nameField.text = row.modelData.name;
                        row.editing = true;
                        nameField.forceActiveFocus();
                        nameField.selectAll();
                    }
                }
            }

            QQC2.ToolButton {
                icon.name: "edit-delete"
                display: QQC2.AbstractButton.IconOnly
                text: "Delete"
                enabled: !row.shown
                QQC2.ToolTip.text: row.shown ? "Shown on this screen: pick another profile first" : "Delete"
                QQC2.ToolTip.visible: hovered
                QQC2.ToolTip.delay: Kirigami.Units.toolTipDelay
                onClicked: {
                    deleteDialog.profile = row.modelData;
                    deleteDialog.open();
                }
            }
        }
    }

    Kirigami.PromptDialog {
        id: deleteDialog
        property var profile: null
        title: "Delete profile"
        subtitle: {
            if (!profile || !page.store)
                return "";
            const others = Store.profilesUsing(page.store, profile.look).length > 1;
            return "Delete “" + profile.name + "”?" + (others ? ""
                : " The look's video is deleted too (" + Store.formatBytes(page.store.looks[profile.look]
                    ? page.store.looks[profile.look].bytes : 0) + ").")
                + " Other screens showing it switch to the default profile.";
        }
        standardButtons: Kirigami.Dialog.Ok | Kirigami.Dialog.Cancel
        onAccepted: page.deleteProfile(profile.id)
    }

    // ---------------------------------------------------------------- preview

    Kirigami.Separator {
        Layout.fillWidth: true
        visible: page.preview !== null
    }

    ColumnLayout {
        Layout.fillWidth: true
        visible: page.preview !== null
        spacing: Kirigami.Units.smallSpacing

        Kirigami.Heading {
            level: 3
            text: page.preview ? "Preview: " + page.preview.title : ""
        }

        // download progress (a plain bar: Breeze's ProgressBar logs errors while its layout settles)
        Rectangle {
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 36
            implicitHeight: Kirigami.Units.smallSpacing * 1.5
            radius: height / 2
            visible: page.progress.state === "downloading" || page.progress.state === "verifying"
            color: Qt.alpha(Kirigami.Theme.textColor, 0.15)
            Rectangle {
                height: parent.height
                radius: parent.radius
                color: Kirigami.Theme.highlightColor
                width: parent.width * (page.preview && page.preview.video && page.preview.video.bytes > 0
                                       ? Math.min(1, page.progress.bytes / page.preview.video.bytes) : 0)
            }
        }
        QQC2.Label {
            Layout.fillWidth: true
            visible: text !== ""
            wrapMode: Text.Wrap
            text: {
                const p = page.progress;
                if (!page.preview)
                    return "";
                if (p.state === "downloading")
                    return "Downloading " + Store.formatBytes(p.bytes) + " of " + Store.formatBytes(page.preview.video.bytes) + "…";
                if (p.state === "verifying")
                    return "Checking the download…";
                if (p.state === "done" && page.preview.kind === "portrait")
                    return "This look has only a portrait video: it is cropped to fill the screen.";
                return "";
            }
        }
        Kirigami.InlineMessage {
            Layout.fillWidth: true
            type: Kirigami.MessageType.Error
            visible: page.progress.state === "error"
            text: "The preview failed: " + page.progress.message
            actions: [
                Kirigami.Action {
                    text: "Retry"
                    icon.name: "view-refresh"
                    onTriggered: page.startPreview(page.preview)
                }
            ]
        }

        // the video as this screen would show it
        LoopPlayer {
            id: previewPlayer
            readonly property real screenAspect: Screen.height > 0 ? Screen.width / Screen.height : 16 / 9
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 36
            Layout.preferredHeight: width / screenAspect
            visible: page.progress.state === "done" && page.progress.file !== ""
            source: visible ? Store.fileUrl(page.progress.file) : ""
            videoWidth: page.preview && page.preview.video ? page.preview.video.width : 0
            videoHeight: page.preview && page.preview.video ? page.preview.video.height : 0
            focusX: page.preview && page.preview.video ? page.preview.video.focus[0] : 0.5
            focusY: page.preview && page.preview.video ? page.preview.video.focus[1] : 0.5
            speed: Store.SPEEDS[previewSpeed.currentIndex]
            running: visible
        }

        RowLayout {
            Layout.fillWidth: true
            QQC2.Label {
                text: "Name:"
            }
            QQC2.TextField {
                id: previewName
                Layout.fillWidth: true
                Layout.maximumWidth: Kirigami.Units.gridUnit * 14
            }
            QQC2.ComboBox {
                id: previewSpeed
                model: Store.SPEEDS.map(Store.speedLabel)
                currentIndex: 1
            }
            QQC2.Button {
                text: "Save as profile"
                icon.name: "document-save"
                enabled: page.progress.state === "done" && !page.saving
                onClicked: page.savePreview()
            }
            QQC2.Button {
                text: "Discard"
                icon.name: "edit-delete-remove"
                onClicked: page.stopPreview()
            }
        }
    }

    // ---------------------------------------------------------------- catalog

    Kirigami.Separator {
        Layout.fillWidth: true
    }

    RowLayout {
        Layout.fillWidth: true
        Kirigami.Heading {
            Layout.fillWidth: true
            level: 3
            text: "Catalog"
        }
        QQC2.BusyIndicator {
            visible: page.catalogLoading
            running: visible
            implicitHeight: Kirigami.Units.iconSizes.medium
            implicitWidth: implicitHeight
        }
        QQC2.ToolButton {
            icon.name: "view-refresh"
            text: "Reload"
            onClicked: page.loadCatalog()
        }
    }

    Kirigami.InlineMessage {
        Layout.fillWidth: true
        type: Kirigami.MessageType.Warning
        text: page.catalogError
        visible: text !== ""
    }

    Flow {
        Layout.fillWidth: true
        spacing: Kirigami.Units.largeSpacing

        Repeater {
            model: page.catalog

            delegate: ColumnLayout {
                id: card
                required property var modelData
                readonly property bool saved: page.store !== null && page.store.looks[modelData.id] !== undefined
                readonly property bool previewing: page.preview !== null && page.preview.id === modelData.id

                width: Kirigami.Units.gridUnit * 12
                spacing: Kirigami.Units.smallSpacing

                Rectangle {
                    Layout.fillWidth: true
                    Layout.preferredHeight: width * 9 / 16
                    color: "#050608"
                    border.width: card.previewing ? 2 : 0
                    border.color: Kirigami.Theme.highlightColor
                    Image {
                        anchors.fill: parent
                        anchors.margins: parent.border.width
                        source: card.modelData.posterUrl
                        fillMode: Image.PreserveAspectCrop
                        asynchronous: true
                        sourceSize.width: 480
                    }
                }
                QQC2.Label {
                    Layout.fillWidth: true
                    text: card.modelData.title
                    font.bold: true
                    elide: Text.ElideRight
                }
                QQC2.Label {
                    Layout.fillWidth: true
                    font: Kirigami.Theme.smallFont
                    opacity: 0.7
                    elide: Text.ElideRight
                    text: {
                        const l = card.modelData;
                        if (!l.video)
                            return "No video for this device";
                        return (l.kind === "landscape" ? "Landscape" : "Portrait only") + " · "
                            + Store.formatBytes(l.video.bytes) + (l.author ? " · " + l.author : "");
                    }
                }
                QQC2.Button {
                    Layout.fillWidth: true
                    visible: !card.saved
                    enabled: card.modelData.video !== null && !card.previewing
                    text: card.previewing ? "Previewing" : "Preview"
                    icon.name: "media-playback-start"
                    onClicked: page.startPreview(card.modelData)
                }
                QQC2.Button {
                    Layout.fillWidth: true
                    visible: card.saved
                    text: "Saved · add another profile"
                    icon.name: "list-add"
                    onClicked: page.addProfile(card.modelData.id, card.modelData.title, 1.0)
                }
            }
        }
    }

    // ---------------------------------------------------------------- advanced

    QQC2.CheckBox {
        id: advanced
        text: "Advanced"
    }

    Kirigami.FormLayout {
        Layout.fillWidth: true
        visible: advanced.checked
        twinFormLayouts: parentLayout

        QQC2.TextField {
            id: catalogField
            Kirigami.FormData.label: "Catalog URL:"
            Layout.fillWidth: true
            Layout.minimumWidth: Kirigami.Units.gridUnit * 20
            text: page.cfg_CatalogUrl
            placeholderText: Store.DEFAULT_CATALOG
            onEditingFinished: {
                if (text.trim() !== page.cfg_CatalogUrl) {
                    page.cfg_CatalogUrl = text.trim();
                    page.loadCatalog();
                }
            }
        }
        QQC2.Label {
            Layout.fillWidth: true
            Layout.maximumWidth: Kirigami.Units.gridUnit * 24
            wrapMode: Text.Wrap
            font: Kirigami.Theme.smallFont
            opacity: 0.7
            text: "Empty uses the official catalog. Saved looks and profiles are kept in "
                + (page.store ? page.store.dataDir : "~/.local/share/live-scenes")
                + "; looks added with the SDK (livescenes add) show up here too."
        }
        RowLayout {
            Kirigami.FormData.label: "Version:"
            QQC2.Label {
                text: Store.VERSION
            }
            QQC2.Button {
                text: "Check for updates"
                icon.name: "view-refresh"
                enabled: page.updateState === ""
                onClicked: page.checkUpdate(true)
            }
            QQC2.Label {
                text: page.updateState === "checking" ? "Checking…" : page.updateNote
                opacity: 0.7
            }
        }
    }
}
