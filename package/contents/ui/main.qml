import QtQuick
import QtWebEngine
import org.kde.plasma.plasmoid

WallpaperItem {
    id: root

    // each scene is a folder under contents/web with its own index.html; all take ?fps=
    readonly property string scene: root.configuration.Scene || "hall"
    readonly property string query: "?fps=" + root.configuration.Fps
        + (scene === "hall"
            ? "&mode=" + (root.configuration.Mode === 1 ? "clock" : "loop")
              + "&loop=" + root.configuration.LoopSeconds
              + "&scale=" + root.configuration.RenderScale
            : "")
        + (scene === "smoke-signal" && !root.configuration.Shots ? "&shots=0" : "")
        + (scene === "living-water" ? "&speed=" + (root.configuration.SwimSpeed / 100) : "")

    Rectangle {
        anchors.fill: parent
        color: "#050608"
    }

    WebEngineView {
        anchors.fill: parent
        enabled: false                 // the desktop keeps its clicks and its context menu
        backgroundColor: "#050608"
        url: Qt.resolvedUrl("../web/" + root.scene + "/index.html") + root.query
        settings.showScrollBars: false
        settings.localContentCanAccessFileUrls: true
        onContextMenuRequested: request => { request.accepted = true }
    }
}
