import QtQuick
import QtQuick.Controls as QQC2
import org.kde.kirigami as Kirigami

Kirigami.FormLayout {
    id: page
    twinFormLayouts: parentLayout

    property string cfg_Scene
    property alias cfg_Fps: fps.value
    property alias cfg_Mode: mode.currentIndex
    property alias cfg_LoopSeconds: loopSeconds.value
    property alias cfg_RenderScale: renderScale.value
    property alias cfg_Shots: shots.checked
    property alias cfg_SwimSpeed: swimSpeed.value

    QQC2.ComboBox {
        id: scene
        Kirigami.FormData.label: "Scene:"
        textRole: "text"
        valueRole: "value"
        model: [
            { text: "Hall (concrete hall, day to night)", value: "hall" },
            { text: "Smoke Signal (cyberpunk, smoke and glitches)", value: "smoke-signal" },
            { text: "Living Water (koi pond)", value: "living-water" }
        ]
        Component.onCompleted: currentIndex = Math.max(0, indexOfValue(page.cfg_Scene))
        onActivated: page.cfg_Scene = currentValue
    }
    QQC2.SpinBox {
        id: fps
        Kirigami.FormData.label: "Frames per second:"
        from: 5; to: 120; stepSize: 5
    }

    QQC2.ComboBox {
        id: mode
        visible: page.cfg_Scene === "hall"
        Kirigami.FormData.label: "Daylight:"
        model: ["Loop through a day", "Follow the real clock"]
    }
    QQC2.SpinBox {
        id: loopSeconds
        visible: page.cfg_Scene === "hall"
        Kirigami.FormData.label: "One day lasts (seconds):"
        enabled: mode.currentIndex === 0
        from: 20; to: 86400; stepSize: 10
    }
    QQC2.SpinBox {
        id: renderScale
        visible: page.cfg_Scene === "hall"
        Kirigami.FormData.label: "Render resolution (%):"
        from: 25; to: 100; stepSize: 5
    }
    QQC2.CheckBox {
        id: shots
        visible: page.cfg_Scene === "smoke-signal"
        Kirigami.FormData.label: "Gun:"
        text: "Fires now and then"
    }
    QQC2.SpinBox {
        id: swimSpeed
        visible: page.cfg_Scene === "living-water"
        Kirigami.FormData.label: "Swim speed (%):"
        from: 10; to: 400; stepSize: 10
    }
}
