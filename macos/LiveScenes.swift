// Live Scenes for macOS: runs the scene pages from package/contents/web as the
// desktop wallpaper. One borderless window per screen sits at desktop level,
// below the icons, and ignores the mouse. Settings live in the menu bar.

import AppKit
import ServiceManagement
import WebKit

struct Scene { let title: String; let folder: String }

let scenes = [
    Scene(title: "Hall", folder: "hall"),
    Scene(title: "Smoke Signal", folder: "smoke-signal"),
    Scene(title: "Living Water", folder: "living-water"),
]

final class Settings {
    private let d = UserDefaults.standard
    init() {
        d.register(defaults: [
            "Scene": "hall", "Fps": 30, "Mode": 0, "LoopSeconds": 84,
            "RenderScale": 100, "Shots": true, "SwimSpeed": 100, "Paused": false,
        ])
    }
    var scene: String { get { d.string(forKey: "Scene")! } set { d.set(newValue, forKey: "Scene") } }
    var fps: Int { get { d.integer(forKey: "Fps") } set { d.set(newValue, forKey: "Fps") } }
    var mode: Int { get { d.integer(forKey: "Mode") } set { d.set(newValue, forKey: "Mode") } }
    var loopSeconds: Int { get { d.integer(forKey: "LoopSeconds") } set { d.set(newValue, forKey: "LoopSeconds") } }
    var renderScale: Int { get { d.integer(forKey: "RenderScale") } set { d.set(newValue, forKey: "RenderScale") } }
    var shots: Bool { get { d.bool(forKey: "Shots") } set { d.set(newValue, forKey: "Shots") } }
    var swimSpeed: Int { get { d.integer(forKey: "SwimSpeed") } set { d.set(newValue, forKey: "SwimSpeed") } }
    var paused: Bool { get { d.bool(forKey: "Paused") } set { d.set(newValue, forKey: "Paused") } }

    // same query string main.qml builds
    var query: String {
        var q = "fps=\(fps)"
        switch scene {
        case "hall":
            q += "&mode=\(mode == 1 ? "clock" : "loop")&loop=\(loopSeconds)&scale=\(renderScale)"
        case "smoke-signal":
            if !shots { q += "&shots=0" }
        case "living-water":
            q += "&speed=\(Double(swimSpeed) / 100)"
        default: break
        }
        return q
    }
}

final class WallpaperWindow: NSWindow, WKNavigationDelegate {
    let web: WKWebView

    init(screen: NSScreen) {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: .zero, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        ignoresMouseEvents = true
        isOpaque = true
        hasShadow = false
        backgroundColor = NSColor(red: 0x05 / 255, green: 0x06 / 255, blue: 0x08 / 255, alpha: 1)
        isReleasedWhenClosed = false
        contentView = web
        setFrame(screen.frame, display: true)
        web.navigationDelegate = self
    }

    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { NSLog("LiveScenes: loaded \(w.url?.absoluteString ?? "-")") }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { NSLog("LiveScenes: failed \(e)") }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { NSLog("LiveScenes: failed \(e)") }
    // if the page process dies (GPU reset etc.) just load it again
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { NSLog("LiveScenes: page process died, reloading"); w.reload() }

    func load(scene: String, query: String, webRoot: URL) {
        let page = webRoot.appendingPathComponent(scene).appendingPathComponent("index.html")
        var comps = URLComponents(url: page, resolvingAgainstBaseURL: true)!
        comps.query = query
        web.loadFileURL(comps.url!, allowingReadAccessTo: webRoot)
    }
}

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate {
    let settings = Settings()
    var windows: [WallpaperWindow] = []
    var statusItem: NSStatusItem!
    var sleeping = false
    let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")

    func applicationDidFinishLaunching(_ note: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "sparkles.tv", accessibilityDescription: "Live Scenes")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(rebuild),
                       name: NSApplication.didChangeScreenParametersNotification, object: nil)
        // stop rendering while the displays are off or the session is locked/switched away
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(goDark), name: NSWorkspace.screensDidSleepNotification, object: nil)
        ws.addObserver(self, selector: #selector(wake), name: NSWorkspace.screensDidWakeNotification, object: nil)
        ws.addObserver(self, selector: #selector(goDark), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        ws.addObserver(self, selector: #selector(wake), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        let dnc = DistributedNotificationCenter.default()
        dnc.addObserver(self, selector: #selector(goDark), name: .init("com.apple.screenIsLocked"), object: nil)
        dnc.addObserver(self, selector: #selector(wake), name: .init("com.apple.screenIsUnlocked"), object: nil)

        rebuild()
    }

    var running: Bool { !settings.paused && !sleeping }

    @objc func rebuild() {
        windows.forEach { $0.web.loadHTMLString("", baseURL: nil); $0.orderOut(nil); $0.close() }
        windows = []
        guard running else { return }
        for screen in NSScreen.screens {
            let w = WallpaperWindow(screen: screen)
            w.load(scene: settings.scene, query: settings.query, webRoot: webRoot)
            w.orderFrontRegardless()
            windows.append(w)
        }
    }

    @objc func goDark() { sleeping = true; rebuild() }
    @objc func wake() { sleeping = false; rebuild() }

    // MARK: menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let s = settings

        for sc in scenes {
            menu.addItem(item(sc.title, #selector(pickScene(_:)), sc.folder, on: s.scene == sc.folder))
        }
        menu.addItem(.separator())

        menu.addItem(submenu("Frames per second", [15, 24, 30, 60, 120].map {
            item("\($0)", #selector(pickFps(_:)), $0, on: s.fps == $0)
        }))

        switch s.scene {
        case "hall":
            menu.addItem(submenu("Daylight", [
                item("Loop through a day", #selector(pickMode(_:)), 0, on: s.mode == 0),
                item("Follow the real clock", #selector(pickMode(_:)), 1, on: s.mode == 1),
            ]))
            if s.mode == 0 {
                menu.addItem(submenu("One day lasts", [
                    (84, "84 seconds"), (300, "5 minutes"), (900, "15 minutes"),
                    (3600, "1 hour"), (86400, "24 hours"),
                ].map { item($0.1, #selector(pickLoop(_:)), $0.0, on: s.loopSeconds == $0.0) }))
            }
            menu.addItem(submenu("Render resolution", [25, 50, 75, 100].map {
                item("\($0)%", #selector(pickScale(_:)), $0, on: s.renderScale == $0)
            }))
        case "smoke-signal":
            menu.addItem(item("Gun fires", #selector(toggleShots), nil, on: s.shots))
        case "living-water":
            menu.addItem(submenu("Swim speed", [25, 50, 100, 150, 200, 400].map {
                item("\($0)%", #selector(pickSwim(_:)), $0, on: s.swimSpeed == $0)
            }))
        default: break
        }

        menu.addItem(.separator())
        menu.addItem(item(s.paused ? "Resume" : "Pause", #selector(togglePause), nil, on: false))
        menu.addItem(item("Open at Login", #selector(toggleLogin), nil,
                          on: SMAppService.mainApp.status == .enabled))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Live Scenes", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }

    func item(_ title: String, _ action: Selector, _ value: Any?, on: Bool) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
        i.target = self
        i.representedObject = value
        i.state = on ? .on : .off
        return i
    }

    func submenu(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        let m = NSMenu()
        items.forEach(m.addItem)
        i.submenu = m
        return i
    }

    @objc func pickScene(_ i: NSMenuItem) { settings.scene = i.representedObject as! String; rebuild() }
    @objc func pickFps(_ i: NSMenuItem) { settings.fps = i.representedObject as! Int; rebuild() }
    @objc func pickMode(_ i: NSMenuItem) { settings.mode = i.representedObject as! Int; rebuild() }
    @objc func pickLoop(_ i: NSMenuItem) { settings.loopSeconds = i.representedObject as! Int; rebuild() }
    @objc func pickScale(_ i: NSMenuItem) { settings.renderScale = i.representedObject as! Int; rebuild() }
    @objc func pickSwim(_ i: NSMenuItem) { settings.swimSpeed = i.representedObject as! Int; rebuild() }
    @objc func toggleShots() { settings.shots.toggle(); rebuild() }
    @objc func togglePause() { settings.paused.toggle(); rebuild() }

    @objc func toggleLogin() {
        let svc = SMAppService.mainApp
        do {
            if svc.status == .enabled { try svc.unregister() } else { try svc.register() }
        } catch {
            let a = NSAlert()
            a.messageText = "Couldn't change Open at Login"
            a.informativeText = error.localizedDescription
            a.runModal()
        }
    }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
