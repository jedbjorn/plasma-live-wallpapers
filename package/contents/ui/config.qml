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

    // a catalog entry with resolved URLs and the video a desktop downloads (landscape, else portrait)
    function catalogLook(l, base) {
        if (!l || !Store.validId(l.id) || !l.videos)
            return null;
        let kind = "";
        for (const k of ["landscape", "portrait"]) {
            const v = l.videos[k];
            if (v && typeof v.url === "string" && /^[0-9a-f]{64}$/.test(v.sha256) && Number(v.bytes) > 0) {
                kind = k;
                break;
            }
        }
        const v = kind ? l.videos[kind] : null;
        return {
            id: l.id,
            title: String(l.title || l.id),
            author: String(l.author || ""),
            license: String(l.license || ""),
            description: String(l.description || ""),
            loop: Number(l.loop) || 0,
            posterUrl: l.poster ? Store.resolveUrl(base, l.poster) : "",
            kind: kind,
            video: v ? {
                url: Store.resolveUrl(base, v.url), width: Number(v.width) || 0, height: Number(v.height) || 0,
                fps: Number(v.fps) || 0, bytes: Number(v.bytes), sha256: v.sha256,
                focus: Array.isArray(v.focus) && v.focus.length === 2 ? [Store.fraction(v.focus[0]), Store.fraction(v.focus[1])] : [0.5, 0.5]
            } : null
        };
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
        const v = look.video;
        const entry = { file: look.kind + ".mp4", width: v.width, height: v.height, bytes: v.bytes,
                        sha256: v.sha256, focus: v.focus };
        if (v.fps)
            entry.fps = v.fps;
        const scene = { format: 1, id: look.id, title: look.title, author: look.author, license: look.license,
                        description: look.description, loop: look.loop, videos: {} };
        scene.videos[look.kind] = entry;
        const name = previewName.text.trim() || look.title;
        const speed = Store.SPEEDS[previewSpeed.currentIndex];
        page.saving = true;
        helper.run(["save", look.id, JSON.stringify(scene, null, 2)], out => {
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

    // Start a moment after creation: Plasma creates this page once just to read its cfg_ keys and
    // destroys it right away; that copy must not touch any files.
    Timer {
        interval: 200
        running: true
        onTriggered: {
            helper.run(["clear-previews"], () => page.refresh());   // leftovers of earlier visits
            page.loadCatalog();
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
                    text: Store.lookTitle(page.store, row.modelData.look)
                        + (row.look ? " · " + Store.formatBytes(row.look.bytes) : " · missing")
                        + (row.modelData.id === page.store.profiles.active ? " · default" : "")
                    font: Kirigami.Theme.smallFont
                    opacity: 0.7
                    elide: Text.ElideRight
                }
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
    }
}
