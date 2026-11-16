import QtQuick
import QtMultimedia

// Plays one seamlessly looping video, scaled to fill this item (aspect fill), with the crop shifted
// so that the focus point (fractions of the video's width and height) is as close to the centre as
// the video's edges allow (sdk/FORMAT.md, "Playing"). No audio.
Item {
    id: root

    property url source
    property real speed: 1.0                 // playback rate: 0.5, 1 or 2
    property bool running: true              // false pauses on the current frame
    property real focusX: 0.5
    property real focusY: 0.5
    // the video's size from scene.json; 0 = take it from the file once it is loaded
    property int videoWidth: 0
    property int videoHeight: 0

    // the video cannot be played (missing file, unsupported codec, ...)
    signal failed(string errorString)

    readonly property alias player: mediaPlayer
    readonly property alias output: output
    readonly property bool hasVideo: mediaPlayer.hasVideo && mediaPlayer.mediaStatus !== MediaPlayer.InvalidMedia
    readonly property string errorString: mediaPlayer.error === MediaPlayer.NoError ? "" : mediaPlayer.errorString

    // the size the file reports, used when scene.json gives none
    readonly property size metaSize: mediaPlayer.metaData.value(MediaMetaData.Resolution) ?? Qt.size(0, 0)
    readonly property real srcW: videoWidth > 0 ? videoWidth : metaSize.width
    readonly property real srcH: videoHeight > 0 ? videoHeight : metaSize.height
    readonly property bool sized: srcW > 0 && srcH > 0 && width > 0 && height > 0

    clip: true

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }

    MediaPlayer {
        id: mediaPlayer
        source: root.source
        loops: MediaPlayer.Infinite
        playbackRate: root.speed > 0 ? root.speed : 1.0
        videoOutput: output
        // no audioOutput: nothing is decoded for audio and nothing reaches the sound server

        onSourceChanged: root.sync()
        onMediaStatusChanged: {
            if (mediaStatus === MediaPlayer.LoadedMedia)
                root.sync()
        }
        onErrorOccurred: (error, errorString) => {
            console.warn("Live Scenes: cannot play", source, ":", errorString);
            root.failed(errorString);
        }
    }

    VideoOutput {
        id: output
        // scale so the video covers the item, then centre the focus point, clamped to the edges
        readonly property real fill: root.sized ? Math.max(root.width / root.srcW, root.height / root.srcH) : 1
        width: root.sized ? Math.ceil(root.srcW * fill) : root.width
        height: root.sized ? Math.ceil(root.srcH * fill) : root.height
        x: root.sized ? Math.round(root.clamp(root.width / 2 - root.focusX * width, root.width - width, 0)) : 0
        y: root.sized ? Math.round(root.clamp(root.height / 2 - root.focusY * height, root.height - height, 0)) : 0
        // the size above already has the video's aspect; before it is known, crop around the centre
        fillMode: root.sized ? VideoOutput.Stretch : VideoOutput.PreserveAspectCrop
    }

    function sync() {
        if (root.running && root.source.toString() !== "")
            mediaPlayer.play()
        else
            mediaPlayer.pause()
    }

    onRunningChanged: sync()
    Component.onCompleted: sync()
}
