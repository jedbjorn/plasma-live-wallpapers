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
    var options: CatalogOptions?  // the look's video options and variants (sdk/FORMAT.md, Options), for `orientation`
}

/// One row of a look's options (sdk/FORMAT.md, Options): its label and the values to pick from.
struct LookOption {
    struct Value: Identifiable { var id: String; var label: String }
    var label: String
    var values: [Value]
    var `default`: String
}

/// A look's video options, in order, or nil if it has none. Theme options (every value carries a `theme`)
/// only choose Android's colors and take no part in variant keys, so the desktop leaves them out.
func videoOptions(_ j: Any?) -> [LookOption]? {
    guard let list = j as? [Any], !list.isEmpty else { return nil }
    var out: [LookOption] = []
    for item in list {
        guard let o = item as? [String: Any], let vs = o["values"] as? [Any], !vs.isEmpty else { return nil }
        var values: [LookOption.Value] = [], themes = 0
        for case let v as [String: Any] in vs {
            guard let id = v["id"] as? String, id.range(of: "^[a-z0-9]+$", options: .regularExpression) != nil else { return nil }
            values.append(.init(id: id, label: (v["label"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? id))
            if let t = v["theme"], !(t is NSNull) { themes += 1 }
        }
        guard values.count == vs.count else { return nil }
        if themes == values.count { continue }
        let d = o["default"] as? String ?? ""
        out.append(LookOption(label: o["label"] as? String ?? "Option", values: values,
                              default: values.contains { $0.id == d } ? d : values[0].id))
    }
    return out.isEmpty ? nil : out
}

/// The variant key of the options' defaults: their value ids joined with "-".
func defaultKey(_ opts: [LookOption]) -> String { opts.map(\.default).joined(separator: "-") }

/// A variant key with option i set to value id.
func withValue(_ key: String, _ i: Int, _ id: String) -> String {
    var parts = key.components(separatedBy: "-")
    if i < parts.count { parts[i] = id }
    return parts.joined(separator: "-")
}

/// A variant key in words: the labels of its values ("Strong", "Strong, Heavy rain").
func choiceLabel(_ opts: [LookOption], _ key: String) -> String {
    let ids = key.components(separatedBy: "-")
    return opts.enumerated().map { i, o in
        let id = i < ids.count ? ids[i] : ""
        return o.values.first { $0.id == id }?.label ?? id
    }.joined(separator: ", ")
}

/// The variant a saved scene's video is: its `choice` if that names a value of every video option, else
/// the default.
func sceneChoice(_ scene: [String: Any], _ opts: [LookOption]) -> String {
    if let c = scene["choice"] as? String {
        let ids = c.components(separatedBy: "-")
        if ids.count == opts.count, zip(opts, ids).allSatisfy({ o, id in o.values.contains { $0.id == id } }) { return c }
    }
    return defaultKey(opts)
}

/// A catalog look's options: one video per variant, in the entry's orientation.
struct CatalogOptions {
    struct Video { var json: [String: Any]; var url: URL; var bytes: Int64; var sha256: String }
    var json: Any                 // the catalog's `options`, as is (theme options too; a saved scene.json keeps it)
    var list: [LookOption]        // the video options
    var `default`: String         // the default variant's key
    var videos: [String: Video]   // by variant key

    init?(options: Any?, variants: Any?, orientation o: String, base: URL) {
        guard let opts = options, let list = videoOptions(opts), let vs = variants as? [String: Any] else { return nil }
        json = opts
        self.list = list
        `default` = defaultKey(list)
        videos = [:]
        for (k, x) in vs {
            guard let v = (x as? [String: Any])?[o] as? [String: Any], let u = v["url"] as? String,
                  let url = URL(string: u, relativeTo: base)?.absoluteURL else { continue }
            videos[k] = Video(json: v, url: url, bytes: (v["bytes"] as? NSNumber)?.int64Value ?? 0,
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
                    options: CatalogOptions(options: l["options"], variants: l["variants"], orientation: o, base: base)))
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

        // a look with options is saved as its default variant (the plain videos), as <orientation>-<key>.mp4
        let key = e.options?.default
        let file = key.map { "\(e.orientation)-\($0).mp4" } ?? "\(e.orientation).mp4"
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
        if let o = e.options, let key {
            scene["options"] = o.json   // theme options too, as the catalog has them
            scene["choice"] = key
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

    /// Changes a saved look in `dir` to another variant (an option changed): downloads that variant's video
    /// next to the old one, points scene.json at it, then deletes the old video. Only the chosen variant's
    /// video stays on disk.
    static func changeChoice(_ e: CatalogEntry, to key: String, in dir: URL,
                             progress: @escaping (Double) -> Void) async throws {
        guard let o = e.options, let v = o.videos[key] else {
            throw StoreError.message("the catalog has no \(e.options.map { choiceLabel($0.list, key) } ?? key) of \(e.title)")
        }
        let sceneFile = dir.appendingPathComponent("scene.json")
        guard var scene = (try? JSONSerialization.jsonObject(with: Data(contentsOf: sceneFile))) as? [String: Any] else {
            throw StoreError.message("\(e.title) has no readable scene.json")
        }
        let file = "\(e.orientation)-\(key).mp4"
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
        scene["options"] = o.json
        scene["choice"] = key
        scene["levels"] = nil   // the older level knob, which options replace
        scene["level"] = nil
        let data = try JSONSerialization.data(withJSONObject: scene, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: sceneFile, options: .atomic)
        // a player still reading the old file keeps it until it closes it
        for f in old where f != file && !f.contains("/") { try? fm.removeItem(at: dir.appendingPathComponent(f)) }
    }

    /// A saved look whose video is one of the catalog entry's variants gets the entry's options, as Android
    /// does (sdk/FORMAT.md, Options): its file is named <orientation>-<key>.mp4 (a look saved with levels,
    /// or whose options changed since), or it is a plain file with a variant's sha256 (saved before the look
    /// had options, or by an app that ignored them). No download. Returns true if the scene.json changed.
    static func adoptOptions(_ e: CatalogEntry, in dir: URL) -> Bool {
        let sceneFile = dir.appendingPathComponent("scene.json")
        guard let o = e.options,
              var scene = (try? JSONSerialization.jsonObject(with: Data(contentsOf: sceneFile))) as? [String: Any],
              let v = (scene["videos"] as? [String: Any])?[e.orientation] as? [String: Any] else { return false }
        let file = v["file"] as? String ?? ""
        var key: String?
        let prefix = "\(e.orientation)-"
        if file.hasPrefix(prefix), file.hasSuffix(".mp4") {
            key = String(file.dropFirst(prefix.count).dropLast(4))
        } else if let sha = v["sha256"] as? String, !sha.isEmpty {
            key = o.videos.first { $0.value.sha256.caseInsensitiveCompare(sha) == .orderedSame }?.key
        }
        guard let key, o.videos[key] != nil else { return false }
        if scene["choice"] as? String == key, let saved = scene["options"], sameJSON(saved, o.json) { return false }
        scene["options"] = o.json
        scene["choice"] = key
        scene["levels"] = nil
        scene["level"] = nil
        guard let data = try? JSONSerialization.data(withJSONObject: scene, options: [.prettyPrinted, .sortedKeys]),
              (try? data.write(to: sceneFile, options: .atomic)) != nil else { return false }
        return true
    }

    private static func sameJSON(_ a: Any, _ b: Any) -> Bool {
        guard JSONSerialization.isValidJSONObject([a]), JSONSerialization.isValidJSONObject([b]) else { return false }
        return (try? JSONSerialization.data(withJSONObject: [a], options: .sortedKeys))
            == (try? JSONSerialization.data(withJSONObject: [b], options: .sortedKeys))
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
