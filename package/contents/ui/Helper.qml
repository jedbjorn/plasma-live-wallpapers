import QtQuick
import org.kde.plasma.plasma5support as P5Support

// Runs contents/code/helper.sh through Plasma's "executable" data engine (QML itself cannot write
// files). Every argument is single-quoted for the shell, so untrusted strings are never interpreted.
P5Support.DataSource {
    id: source
    engine: "executable"

    readonly property string script: decodeURIComponent(Qt.resolvedUrl("../code/helper.sh").toString().replace(/^file:\/\//, ""))
    property var pending: ({})
    property int serial: 0

    function quote(s) {
        return "'" + String(s).replace(/'/g, "'\\''") + "'";
    }

    // run(["command", args...], function (stdout, exitCode) {...})
    function run(args, callback) {
        // the trailing comment makes every command string unique, so it always runs again
        const cmd = "sh " + quote(script) + " " + args.map(quote).join(" ") + " # " + (++serial);
        pending[cmd] = callback || null;
        connectSource(cmd);
    }

    onNewData: (sourceName, data) => {
        const callback = pending[sourceName];
        delete pending[sourceName];
        disconnectSource(sourceName);
        if (callback)
            callback(data["stdout"] || "", data["exit code"]);
    }
}
