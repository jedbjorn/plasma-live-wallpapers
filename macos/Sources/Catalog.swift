// The catalog (sdk/FORMAT.md): a JSON list of looks to browse, with URLs relative to the catalog's own.

import Foundation

let defaultCatalog = "https://github.com/jedbjorn/plasma-live-wallpapers/releases/latest/download/catalog.json"

struct CatalogEntry: Identifiable {
    var json: [String: Any]       // the catalog's entry, as is
    var id: String
    var title: String
    var description: String
    var poster: URL?
    var orientation: String       // the video a desktop downloads: landscape if there is one
    var video: URL
    var bytes: Int64
    var sha256: String
    var levels: Levels?           // the look's level knob (sdk/FORMAT.md, Levels), for `orientation`
}

let levelNames = ["weak", "medium", "strong"]

func levelLabel(_ l: String) -> String { l.prefix(1).uppercased() + l.dropFirst() }

/// A catalog look's levels: one video per level, in the entry's orientation.
struct Levels {
    struct Video { var json: [String: Any]; var url: URL; var bytes: Int64; var sha256: String }
    var json: [String: Any]       // the catalog's `levels`, as is (a saved scene.json keeps it)
    var label: String
    var `default`: String
    var videos: [String: Video]

    init?(_ j: Any?, orientation o: String, base: URL) {
        guard let j = j as? [String: Any], let vs = j["videos"] as? [String: Any] else { return nil }
        json = j
        label = j["label"] as? String ?? "Level"
        let d = j["default"] as? String ?? "strong"
        `default` = levelNames.contains(d) ? d : "strong"
        videos = [:]
        for l in levelNames {
            guard let v = (vs[l] as? [String: Any])?[o] as? [String: Any], let u = v["url"] as? String,
                  let url = URL(string: u, relativeTo: base)?.absoluteURL else { continue }
            videos[l] = Video(json: v, url: url, bytes: (v["bytes"] as? NSNumber)?.int64Value ?? 0,
                              sha256: v["sha256"] as? String ?? "")
        }
        if videos.isEmpty { return nil }
    }
}

enum Catalog {
    static func fetch(_ urlString: String) async throws -> [CatalogEntry] {
        guard let base = URL(string: urlString), base.scheme != nil else {
            throw StoreError.message("not a valid catalog URL: \(urlString)")
        }
        let (data, resp) = try await URLSession.shared.data(from: base)
        if let h = resp as? HTTPURLResponse, h.statusCode != 200 {
            throw StoreError.message("HTTP \(h.statusCode) for \(base)")
        }
        guard let o = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            throw StoreError.message("not a catalog: \(base)")
        }
        var list: [CatalogEntry] = []
        for case let l as [String: Any] in o["looks"] as? [Any] ?? [] {
            guard let id = l["id"] as? String, id.range(of: "^[a-z0-9-]+$", options: .regularExpression) != nil,
                  let videos = l["videos"] as? [String: Any] else { continue }
            for o in ["landscape", "portrait"] {
                guard let v = videos[o] as? [String: Any], let u = v["url"] as? String,
                      let url = URL(string: u, relativeTo: base)?.absoluteURL else { continue }
                list.append(CatalogEntry(
                    json: l, id: id, title: l["title"] as? String ?? id,
                    description: l["description"] as? String ?? "",
                    poster: (l["poster"] as? String).flatMap { URL(string: $0, relativeTo: base)?.absoluteURL },
                    orientation: o, video: url,
                    bytes: (v["bytes"] as? NSNumber)?.int64Value ?? 0,
                    sha256: v["sha256"] as? String ?? "",
                    levels: Levels(l["levels"], orientation: o, base: base)))
                break
            }
        }
        return list
    }

    /// Downloads a look's video (checking its sha256) and poster into `dir`, and writes the scene.json a
    /// saved look has: only the downloaded video, with `file` instead of `url`.
    static func downloadPreview(_ e: CatalogEntry, into dir: URL, progress: @escaping (Double) -> Void) async throws {
        let fm = FileManager.default
        try? fm.removeItem(at: dir)
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)

        // a look with levels is saved at its default level, as <orientation>-<level>.mp4
        let level = e.levels?.default
        let file = level.map { "\(e.orientation)-\($0).mp4" } ?? "\(e.orientation).mp4"
        try await download(e.video, bytes: e.bytes, sha256: e.sha256, to: dir.appendingPathComponent(file),
                           progress: progress)

        if let p = e.poster, let (data, r) = try? await URLSession.shared.data(from: p),
           (r as? HTTPURLResponse)?.statusCode == 200 {
            try? data.write(to: dir.appendingPathComponent("poster.jpg"))
        }
        try Task.checkCancellation()

        var scene: [String: Any] = ["format": 1]
        for k in ["id", "title", "author", "license", "description", "loop", "rotate"] { scene[k] = e.json[k] }
        var v = (e.json["videos"] as? [String: Any])?[e.orientation] as? [String: Any] ?? [:]
        v["url"] = nil
        v["file"] = file
        scene["videos"] = [e.orientation: v]
        if let l = e.levels, let level {
            scene["levels"] = l.json
            scene["level"] = level
        }
        let data = try JSONSerialization.data(withJSONObject: scene, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appendingPathComponent("scene.json"), options: .atomic)
    }

    /// Downloads a file, checking its sha256 (when known). A damaged file is deleted.
    static func download(_ url: URL, bytes: Int64, sha256 expected: String, to file: URL,
                         progress: @escaping (Double) -> Void) async throws {
        try? FileManager.default.removeItem(at: file)
        try await Downloader(expected: bytes, progress: progress).download(url, to: file)
        if !expected.isEmpty, try sha256(of: file).caseInsensitiveCompare(expected) != .orderedSame {
            try? FileManager.default.removeItem(at: file)
            throw StoreError.message("the download is damaged (sha256 mismatch)")
        }
    }

    /// Changes a saved look in `dir` to another level: downloads that level's video next to the old one,
    /// points scene.json at it, then deletes the old video. Only the chosen level's video stays on disk.
    static func changeLevel(_ e: CatalogEntry, to level: String, in dir: URL,
                            progress: @escaping (Double) -> Void) async throws {
        guard let v = e.levels?.videos[level] else {
            throw StoreError.message("the catalog has no \(level) level of \(e.title)")
        }
        let sceneFile = dir.appendingPathComponent("scene.json")
        guard var scene = (try? JSONSerialization.jsonObject(with: Data(contentsOf: sceneFile))) as? [String: Any] else {
            throw StoreError.message("\(e.title) has no readable scene.json")
        }
        let file = "\(e.orientation)-\(level).mp4"
        let part = dir.appendingPathComponent(".\(file).part")
        do {
            try await download(v.url, bytes: v.bytes, sha256: v.sha256, to: part, progress: progress)
            try Task.checkCancellation()
        } catch {
            try? FileManager.default.removeItem(at: part)
            throw error
        }
        let fm = FileManager.default
        let dest = dir.appendingPathComponent(file)
        try? fm.removeItem(at: dest)
        try fm.moveItem(at: part, to: dest)

        let old = (scene["videos"] as? [String: Any])?.values.compactMap { ($0 as? [String: Any])?["file"] as? String } ?? []
        var nv = v.json
        nv["url"] = nil
        nv["file"] = file
        scene["videos"] = [e.orientation: nv]
        scene["levels"] = e.levels!.json
        scene["level"] = level
        let data = try JSONSerialization.data(withJSONObject: scene, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: sceneFile, options: .atomic)
        // a player still reading the old file keeps it until it closes it
        for f in old where f != file && !f.contains("/") { try? fm.removeItem(at: dir.appendingPathComponent(f)) }
    }

    /// A saved look without levels whose video is the catalog's default level (saved before the look got
    /// levels, or by an app that ignored them) gets the catalog's levels: no download. Returns true if the
    /// scene.json changed.
    static func adoptLevels(_ e: CatalogEntry, in dir: URL) -> Bool {
        let sceneFile = dir.appendingPathComponent("scene.json")
        guard let l = e.levels, let d = l.videos[l.default], !d.sha256.isEmpty,
              var scene = (try? JSONSerialization.jsonObject(with: Data(contentsOf: sceneFile))) as? [String: Any],
              scene["levels"] == nil,
              let v = (scene["videos"] as? [String: Any])?[e.orientation] as? [String: Any],
              (v["sha256"] as? String)?.caseInsensitiveCompare(d.sha256) == .orderedSame else { return false }
        scene["levels"] = l.json
        scene["level"] = l.default
        guard let data = try? JSONSerialization.data(withJSONObject: scene, options: [.prettyPrinted, .sortedKeys]),
              (try? data.write(to: sceneFile, options: .atomic)) != nil else { return false }
        return true
    }
}

/// One download to a file, with progress, as a session delegate (async `download(from:delegate:)`
/// doesn't report progress). Cancelling the calling task cancels the download.
private final class Downloader: NSObject, URLSessionDownloadDelegate {
    let expected: Int64
    let progress: (Double) -> Void
    private var dest: URL!
    private var moveError: Error?
    private var continuation: CheckedContinuation<Void, Error>?

    init(expected: Int64, progress: @escaping (Double) -> Void) { self.expected = expected; self.progress = progress }

    func download(_ url: URL, to dest: URL) async throws {
        self.dest = dest
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let task = session.downloadTask(with: url)
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (c: CheckedContinuation<Void, Error>) in
                continuation = c
                task.resume()
            }
        } onCancel: { task.cancel() }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64,
                    totalBytesWritten done: Int64, totalBytesExpectedToWrite total: Int64) {
        let t = total > 0 ? total : expected
        guard t > 0 else { return }
        let f = min(1, Double(done) / Double(t))
        DispatchQueue.main.async { self.progress(f) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // the temporary file is deleted when this returns: move it now
        if let h = downloadTask.response as? HTTPURLResponse, h.statusCode != 200 {
            moveError = StoreError.message("HTTP \(h.statusCode) for \(downloadTask.originalRequest?.url?.absoluteString ?? "?")")
            return
        }
        do { try FileManager.default.moveItem(at: location, to: dest) } catch { moveError = error }
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let c = continuation
        continuation = nil
        if let error = error ?? moveError { c?.resume(throwing: error) } else { c?.resume() }
    }
}
