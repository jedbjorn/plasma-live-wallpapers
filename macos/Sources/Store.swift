// Saved looks and profiles, laid out as sdk/FORMAT.md says:
//   ~/Library/Application Support/LiveScenes/looks/<id>/{scene.json, landscape.mp4, poster.jpg}
//   ~/Library/Application Support/LiveScenes/profiles.json
// Previews live in ~/Library/Caches/LiveScenes/preview/ and are deleted unless saved.

import CryptoKit
import Foundation

let speeds: [Double] = [0.5, 1, 2]

func nearestSpeed(_ s: Double) -> Double {
    speeds.min(by: { abs($0 - s) < abs($1 - s) }) ?? 1
}

struct Profile: Identifiable, Equatable {
    var id: String
    var name: String
    var look: String
    var speed: Double
}

/// What the wallpaper needs: one video file and how to crop it.
struct Playable: Equatable {
    var look: String
    var title: String
    var file: URL
    var width: Int
    var height: Int
    var focusX: Double = 0.5
    var focusY: Double = 0.5
    var speed: Double = 1
    var bundled = false
    /// The file's identity on disk, so a look replaced at the same path counts as a change.
    var stamp = ""

    /// Built from a scene.json in `dir`, preferring the landscape video. Nil if no listed video is on disk.
    init?(scene: [String: Any], dir: URL) {
        let videos = scene["videos"] as? [String: Any] ?? [:]
        for o in ["landscape", "portrait"] {
            guard let e = videos[o] as? [String: Any] else { continue }
            let f = dir.appendingPathComponent(e["file"] as? String ?? "\(o).mp4")
            guard FileManager.default.fileExists(atPath: f.path) else { continue }
            look = scene["id"] as? String ?? dir.lastPathComponent
            title = scene["title"] as? String ?? look
            file = f
            if let a = try? FileManager.default.attributesOfItem(atPath: f.path) {
                stamp = "\((a[.systemFileNumber] as? NSNumber)?.intValue ?? 0):\((a[.size] as? NSNumber)?.intValue ?? 0):"
                    + "\((a[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0)"
            }
            width = (e["width"] as? NSNumber)?.intValue ?? 0
            height = (e["height"] as? NSNumber)?.intValue ?? 0
            if let focus = e["focus"] as? [NSNumber], focus.count == 2 {
                focusX = min(1, max(0, focus[0].doubleValue))
                focusY = min(1, max(0, focus[1].doubleValue))
            }
            return
        }
        return nil
    }
}

enum StoreError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let m) = self { return m }; return nil }
}

final class Store: ObservableObject {
    let root: URL
    let looksDir: URL
    let profilesFile: URL
    let previewDir: URL
    /// The look shipped inside the app (Resources/default), used when no profile exists. Never copied.
    let bundledDir: URL

    @Published private(set) var profiles: [Profile] = []
    @Published private(set) var active: String?
    /// Set when profiles.json can't be parsed; edits are refused so the user's file isn't overwritten.
    @Published private(set) var broken: String?

    /// The file as read, so keys and entries this app doesn't know survive a rewrite.
    private var raw: [String: Any] = [:]
    private var rawList: [Any] = []
    private var rawProfiles: [String: [String: Any]] = [:]
    /// profiles.json's modification date when last read or written; a different one means someone else
    /// (for example `livescenes add`) wrote it.
    private var fileDate: Date?
    /// Called when profiles.json or the looks were changed by someone else.
    var onExternalChange: (() -> Void)?
    private var watcher: DispatchSourceFileSystemObject?
    private var reloadPending = false

    init() {
        let fm = FileManager.default
        root = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LiveScenes")
        looksDir = root.appendingPathComponent("looks")
        profilesFile = root.appendingPathComponent("profiles.json")
        previewDir = fm.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("LiveScenes").appendingPathComponent("preview")
        bundledDir = Bundle.main.resourceURL!.appendingPathComponent("default")
        try? fm.createDirectory(at: looksDir, withIntermediateDirectories: true)
        load()
        watch()
    }

    // MARK: profiles.json

    func load() {
        var profiles: [Profile] = []
        raw = [:]
        rawList = []
        rawProfiles = [:]
        broken = nil
        fileDate = modificationDate(profilesFile)
        if let data = try? Data(contentsOf: profilesFile) {
            if let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                raw = o
                rawList = o["profiles"] as? [Any] ?? []
                for case let p as [String: Any] in rawList {
                    guard let id = p["id"] as? String, let look = p["look"] as? String,
                          !profiles.contains(where: { $0.id == id }) else { continue }
                    profiles.append(Profile(id: id, name: p["name"] as? String ?? id, look: look,
                                            speed: nearestSpeed((p["speed"] as? NSNumber)?.doubleValue ?? 1)))
                    rawProfiles[id] = p
                }
            } else {
                broken = "\(profilesFile.path) is not valid JSON: fix or remove it."
                NSLog("LiveScenes: %@", broken!)
            }
        }
        var active = raw["active"] as? String
        if !profiles.contains(where: { $0.id == active }) { active = profiles.first?.id }
        if profiles != self.profiles { self.profiles = profiles }
        if active != self.active { self.active = active }
    }

    /// Reads profiles.json again if someone else wrote it since, so an edit never overwrites their change.
    /// Returns false if the file can't be edited now.
    private func fresh() -> Bool {
        if modificationDate(profilesFile) != fileDate { load(); onExternalChange?() }
        return broken == nil
    }

    private func save() {
        guard broken == nil else { return }
        var o = raw
        o["format"] = o["format"] ?? 1
        o["active"] = active ?? NSNull()
        func entry(_ p: Profile) -> [String: Any] {
            var d = rawProfiles[p.id] ?? [:]
            d["id"] = p.id
            d["name"] = p.name
            d["look"] = p.look
            d["speed"] = p.speed
            rawProfiles[p.id] = d
            return d
        }
        // keep the file's order and the entries this app couldn't read; drop deleted ones; append new ones
        var list: [Any] = [], written = Set<String>()
        for item in rawList {
            if let d = item as? [String: Any], let id = d["id"] as? String, rawProfiles[id] != nil || deleted.contains(id),
               !written.contains(id), d["look"] is String {
                if let p = profiles.first(where: { $0.id == id }) { list.append(entry(p)) }
                written.insert(id)
            } else {
                list.append(item)
            }
        }
        for p in profiles where !written.contains(p.id) { list.append(entry(p)) }
        deleted = []
        o["profiles"] = list
        raw = o
        rawList = list
        do {
            let data = try JSONSerialization.data(withJSONObject: o, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: profilesFile, options: .atomic)
            fileDate = modificationDate(profilesFile)
        } catch {
            NSLog("LiveScenes: can't write profiles.json: %@", "\(error)")
        }
    }

    private var deleted: Set<String> = []

    /// Re-reads profiles.json when it changes on disk (for example after `livescenes add`).
    private func watch() {
        let fd = open(root.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let src = DispatchSource.makeFileSystemObjectSource(fileDescriptor: fd, eventMask: [.write, .rename, .delete], queue: .main)
        src.setEventHandler { [weak self] in
            guard let self, !self.reloadPending else { return }
            self.reloadPending = true
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                self.reloadPending = false
                if modificationDate(self.profilesFile) != self.fileDate {
                    self.load()
                    self.onExternalChange?()
                }
                self.objectWillChange.send()   // a look's files may have changed too
            }
        }
        src.setCancelHandler { close(fd) }
        src.resume()
        watcher = src
    }

    var activeProfile: Profile? { profiles.first { $0.id == active } }

    func setActive(_ id: String) {
        guard fresh(), id != active, profiles.contains(where: { $0.id == id }) else { return }
        active = id
        save()
    }

    func setSpeed(_ id: String, _ speed: Double) {
        guard fresh(), let i = profiles.firstIndex(where: { $0.id == id }), profiles[i].speed != speed else { return }
        profiles[i].speed = nearestSpeed(speed)
        save()
    }

    func rename(_ id: String, _ name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard fresh(), !name.isEmpty, let i = profiles.firstIndex(where: { $0.id == id }), profiles[i].name != name else { return }
        profiles[i].name = name
        save()
    }

    /// Deletes a profile (never the active one), and its look's files if no other profile uses them.
    @discardableResult
    func delete(_ id: String) -> Bool {
        guard fresh(), id != active, let i = profiles.firstIndex(where: { $0.id == id }) else { return false }
        let look = profiles.remove(at: i).look
        rawProfiles[id] = nil
        deleted.insert(id)
        if !profiles.contains(where: { $0.look == look }) {
            try? FileManager.default.removeItem(at: lookDir(look))
        }
        save()
        return true
    }

    /// A new profile for a saved look; it becomes the active one.
    @discardableResult
    func addProfile(look: String, name: String) -> Profile {
        var n = name, i = 2
        while profiles.contains(where: { $0.name == n }) { n = "\(name) \(i)"; i += 1 }
        var pid = String(UUID().uuidString.lowercased().prefix(8))
        while profiles.contains(where: { $0.id == pid }) { pid = String(UUID().uuidString.lowercased().prefix(8)) }
        let p = Profile(id: pid, name: n, look: look, speed: 1)
        profiles.append(p)
        active = p.id
        save()
        return p
    }

    // MARK: looks

    func lookDir(_ id: String) -> URL { looksDir.appendingPathComponent(id) }

    func scene(_ look: String) -> [String: Any]? { readScene(lookDir(look)) }

    func readScene(_ dir: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: dir.appendingPathComponent("scene.json")) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// A saved look's level knob: its label and the level on disk, or nil for a look without levels.
    func level(_ look: String) -> (label: String, level: String)? {
        guard let s = scene(look), let l = s["levels"] as? [String: Any] else { return nil }
        let label = l["label"] as? String ?? "Level"
        if let v = s["level"] as? String, levelNames.contains(v) { return (label, v) }
        let d = l["default"] as? String ?? "strong"
        return (label, levelNames.contains(d) ? d : "strong")
    }

    func lookTitle(_ look: String) -> String { scene(look)?["title"] as? String ?? look }

    func poster(_ look: String) -> URL? {
        let f = lookDir(look).appendingPathComponent("poster.jpg")
        return FileManager.default.fileExists(atPath: f.path) ? f : nil
    }

    func lookBytes(_ look: String) -> Int64 { treeBytes(lookDir(look)) }

    var totalBytes: Int64 { treeBytes(looksDir) }

    var bundled: Playable? {
        guard let s = readScene(bundledDir), var p = Playable(scene: s, dir: bundledDir) else { return nil }
        p.bundled = true
        return p
    }

    /// The active profile's video, or the bundled look if there is none (or its files are gone).
    var playable: Playable? {
        if let p = activeProfile {
            if let s = scene(p.look), var v = Playable(scene: s, dir: lookDir(p.look)) {
                v.speed = p.speed
                return v
            }
            NSLog("LiveScenes: look %@ has no playable video, using the bundled one", p.look)
        }
        return bundled
    }

    // MARK: saving a preview

    /// Moves a downloaded preview (scene.json + video + poster in `dir`) into storage, replacing an older
    /// copy of the look, and makes a new active profile for it.
    func install(previewDir dir: URL) throws -> Profile {
        guard fresh() else { throw StoreError.message(broken ?? "profiles.json can't be read") }
        guard let scene = readScene(dir), let id = scene["id"] as? String,
              id.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil else {
            throw StoreError.message("the preview has no valid scene.json")
        }
        let fm = FileManager.default
        let dest = lookDir(id), old = looksDir.appendingPathComponent(".\(id).old")
        try? fm.removeItem(at: old)
        if fm.fileExists(atPath: dest.path) { try fm.moveItem(at: dest, to: old) }
        do {
            try fm.moveItem(at: dir, to: dest)
        } catch {
            if fm.fileExists(atPath: old.path) { try? fm.moveItem(at: old, to: dest) }
            throw error
        }
        try? fm.removeItem(at: old)   // a player still reading the old file keeps it until it closes it
        return addProfile(look: id, name: scene["title"] as? String ?? id)
    }

    func clearPreviews() {
        try? FileManager.default.removeItem(at: previewDir)
    }
}

// MARK: files

func modificationDate(_ url: URL) -> Date? {
    (try? FileManager.default.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date
}

func treeBytes(_ url: URL) -> Int64 {
    guard let e = FileManager.default.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
    var n: Int64 = 0
    for case let f as URL in e {
        n += Int64((try? f.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0)
    }
    return n
}

func sha256(of url: URL) throws -> String {
    let h = try FileHandle(forReadingFrom: url)
    defer { try? h.close() }
    var hasher = SHA256()
    while let chunk = try h.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

func humanBytes(_ n: Int64) -> String {
    ByteCountFormatter.string(fromByteCount: n, countStyle: .file)
}
