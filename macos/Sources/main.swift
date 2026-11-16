// Live Scenes for macOS: plays the active profile's look, a seamlessly looping HEVC video
// (sdk/FORMAT.md), as the desktop wallpaper. The menu bar icon switches profiles and speed; the
// Live Scenes window has the profiles, the catalog and the preview.

import AppKit
import Combine
import ServiceManagement
import SwiftUI

final class App: NSObject, NSApplicationDelegate, NSMenuDelegate, NSWindowDelegate {
    let model = Model()
    let wallpaper = Wallpaper()
    var statusItem: NSStatusItem!
    var window: NSWindow?
    var subs: Set<AnyCancellable> = []
    var showPending = false

    func applicationDidFinishLaunching(_ note: Notification) {
        // settings of the old web-page version
        for k in ["Scene", "Fps", "Mode", "LoopSeconds", "RenderScale", "Shots", "SwimSpeed"] {
            UserDefaults.standard.removeObject(forKey: k)
        }
        wallpaper.paused = UserDefaults.standard.bool(forKey: "Paused")
        wallpaper.onFailure = { [weak self] p in
            guard let self, !p.bundled else { return }
            if self.model.preview?.file == p.file {
                self.model.error = "\(p.title) can't be played on this Mac."
                self.model.discardPreview()
            } else {
                self.model.failedFile = p.file
            }
        }

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = NSImage(systemSymbolName: "sparkles.tv", accessibilityDescription: "Live Scenes")
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu

        // any change to the profiles, the looks or the preview: show what should be shown now
        model.objectWillChange.merge(with: model.store.objectWillChange)
            .sink { [weak self] in self?.scheduleShow() }
            .store(in: &subs)
        wallpaper.show(model.playable)

        if model.store.profiles.isEmpty { openWindow() }
    }

    func scheduleShow() {
        guard !showPending else { return }
        showPending = true
        DispatchQueue.main.async { [self] in   // objectWillChange fires before the change lands
            showPending = false
            if model.playable != wallpaper.current { wallpaper.show(model.playable) }
        }
    }

    func applicationWillTerminate(_ note: Notification) {
        model.discardPreview()
    }

    // MARK: window

    @objc func openWindow() {
        if window == nil {
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 720, height: 640),
                             styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
            w.title = "Live Scenes"
            w.isReleasedWhenClosed = false
            w.contentViewController = NSHostingController(rootView: SettingsView(model: model, store: model.store))
            w.delegate = self
            w.center()
            window = w
        }
        NSApp.activate(ignoringOtherApps: true)
        window!.makeKeyAndOrderFront(nil)
    }

    // closing the window leaves the preview: it is deleted unless it was saved
    func windowWillClose(_ note: Notification) {
        model.discardPreview()
    }

    // MARK: menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let store = model.store

        if let e = model.previewEntry {
            menu.addItem(disabled(model.preview == nil ? "Downloading \(e.title)…" : "Previewing \(e.title)"))
            if model.preview != nil { menu.addItem(item("Save as Profile", #selector(savePreview), nil, on: false)) }
            menu.addItem(item("Discard Preview", #selector(discardPreview), nil, on: false))
            menu.addItem(.separator())
        }

        if store.profiles.isEmpty {
            menu.addItem(disabled("Living Water (built in)"))
        }
        for p in store.profiles {
            menu.addItem(item(p.name, #selector(pickProfile(_:)), p.id, on: p.id == store.active))
        }
        if let a = store.activeProfile {
            let sm = NSMenuItem(title: "Speed", action: nil, keyEquivalent: "")
            sm.submenu = NSMenu()
            for s in speeds { sm.submenu!.addItem(item(speedLabel(s), #selector(pickSpeed(_:)), s, on: a.speed == s)) }
            menu.addItem(sm)
        }
        menu.addItem(.separator())
        menu.addItem(item("Profiles and Catalog…", #selector(openWindow), nil, on: false))
        menu.addItem(item(wallpaper.paused ? "Resume" : "Pause", #selector(togglePause), nil, on: false))
        menu.addItem(item("Open at Login", #selector(toggleLogin), nil, on: SMAppService.mainApp.status == .enabled))
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

    func disabled(_ title: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        i.isEnabled = false
        return i
    }

    @objc func pickProfile(_ i: NSMenuItem) {
        model.discardPreview()
        model.store.setActive(i.representedObject as! String)
    }

    @objc func pickSpeed(_ i: NSMenuItem) {
        if let a = model.store.active { model.store.setSpeed(a, i.representedObject as! Double) }
    }

    @objc func savePreview() { model.savePreview() }
    @objc func discardPreview() { model.discardPreview() }

    @objc func togglePause() {
        wallpaper.paused.toggle()
        UserDefaults.standard.set(wallpaper.paused, forKey: "Paused")
    }

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
