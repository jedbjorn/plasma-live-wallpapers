import QtQuick
import QtQuick.Window
import QtMultimedia
import Qt.labs.folderlistmodel
import org.kde.plasma.plasmoid
import org.kde.taskmanager as TaskManager
import "Store.js" as Store

// Live Scenes: plays the chosen profile's look, a seamlessly looping video (sdk/FORMAT.md).
WallpaperItem {
    id: root

    // what helper.sh reported: profiles.json, the saved looks and the bundled look
    property var store: null
    readonly property bool landscape: width >= height
    // the configured profile of this screen/activity, else profiles.json's active one, else the bundled look
    readonly property var current: Store.resolve(store, root.configuration.Profile, landscape)
    // the chosen video failed to play: show the bundled look instead
    property string failedUrl: ""
    readonly property var shown: current && current.video.url !== failedUrl ? current
                                 : (store ? Store.resolveBundled(store, landscape) : null)

    // ---- pausing: play only while the wallpaper can be seen ----
    // 1. a maximized or full-screen window on this screen (current desktop and activity)
    readonly property bool covered: coveringWindows > 0
    property int coveringWindows: 0
    // 2. the compositor stopped showing the desktop window (locked, screen off, fully covered):
    //    on Wayland it then stops sending frame callbacks and Qt stops rendering the window
    property bool rendering: true
    property double lastFrame: Date.now()
    readonly property bool playing: root.visible && !covered && rendering

    Rectangle {
        anchors.fill: parent
        color: "#050608"
    }

    LoopPlayer {
        id: video
        anchors.fill: parent
        source: root.shown ? root.shown.video.url : ""
        videoWidth: root.shown ? root.shown.video.width : 0
        videoHeight: root.shown ? root.shown.video.height : 0
        focusX: root.shown ? root.shown.video.focusX : 0.5
        focusY: root.shown ? root.shown.video.focusY : 0.5
        speed: root.shown ? root.shown.speed : 1.0
        running: root.playing
        onFailed: {
            if (root.shown && !root.shown.bundled)
                root.failedUrl = root.shown.video.url
        }
    }

    // ---- profiles and looks ----
    Helper {
        id: helper
    }

    function refresh() {
        helper.run(["state"], out => {
            const state = Store.parseState(out);
            if (!state.ok) {
                console.warn("Live Scenes: cannot read the saved profiles:", out);
                return;
            }
            if (!state.bundled)
                state.bundled = root.bundledFallback();
            root.store = state;
            root.failedUrl = "";
        });
    }

    // the look shipped in the package, if the helper cannot be run at all
    function bundledFallback() {
        return {
            id: "living-water", bytes: 0, dir: Store.localPath(Qt.resolvedUrl("../looks/living-water")),
            scene: { videos: { landscape: { file: "landscape.mp4", width: 2560, height: 1440, focus: [0.5, 0.5] } } }
        };
    }

    Timer {
        id: helperTimeout
        interval: 5000
        running: true
        onTriggered: {
            if (!root.store)
                root.store = { dataDir: "", profiles: { format: 1, active: "", profiles: [] }, looks: {},
                               bundled: root.bundledFallback(), ok: false };
        }
    }

    // profiles.json changes (settings page, `livescenes add`): re-read it
    FolderListModel {
        id: watcher
        folder: root.store && root.store.dataDir ? Store.fileUrl(root.store.dataDir) : ""
        nameFilters: ["profiles.json"]
        showDirs: false
        onDataChanged: reread.restart()
        onRowsInserted: reread.restart()
        onRowsRemoved: reread.restart()
    }
    Timer {
        id: reread
        interval: 500
        onTriggered: root.refresh()
    }

    Component.onCompleted: {
        refresh();
        // leftover previews of a settings page that was closed without saving
        helper.run(["clear-previews", "60"]);
    }

    // ---- covering windows ----
    TaskManager.VirtualDesktopInfo {
        id: desktopInfo
    }
    TaskManager.ActivityInfo {
        id: activityInfo
    }
    TaskManager.TasksModel {
        id: tasks
        groupMode: TaskManager.TasksModel.GroupDisabled
        filterByScreen: true
        screenGeometry: (root.parent && root.parent.screenGeometry && root.parent.screenGeometry.width > 0)
                        ? root.parent.screenGeometry
                        : Qt.rect(root.Screen.virtualX, root.Screen.virtualY, root.Screen.width, root.Screen.height)
        filterByVirtualDesktop: true
        virtualDesktop: desktopInfo.currentDesktop
        filterByActivity: true
        activity: activityInfo.currentActivity
        filterMinimized: true
        filterHidden: true
    }
    Instantiator {
        id: windows
        model: tasks
        delegate: QtObject {
            required property var model
            readonly property bool covers: !!(model.IsWindow && (model.IsMaximized || model.IsFullScreen))
            onCoversChanged: root.countCovering()
        }
        onObjectAdded: root.countCovering()
        onObjectRemoved: root.countCovering()
    }
    function countCovering() {
        let n = 0;
        for (let i = 0; i < windows.count; i++) {
            const o = windows.objectAt(i);
            if (o && o.covers)
                n++;
        }
        coveringWindows = n;
    }

    // ---- is the desktop window still being drawn? ----
    Connections {
        target: root.Window.window
        function onFrameSwapped() {
            root.lastFrame = Date.now();
            if (!root.rendering)
                root.rendering = true;
        }
    }
    Timer {
        interval: 1000
        repeat: true
        running: root.visible && !root.covered
        onTriggered: {
            // a playing video makes the window draw every frame; nothing drawn for 2 s while playing
            // means the window is not shown
            if (root.rendering && video.player.playbackState === MediaPlayer.PlayingState
                    && Date.now() - root.lastFrame > 2000)
                root.rendering = false;
            // ask for a frame now and then: drawn (frameSwapped) only once the window is shown again
            if (!root.rendering && root.Window.window)
                root.Window.window.update();
        }
    }
}
