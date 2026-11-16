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
                    sha256: v["sha256"] as? String ?? ""))
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

        let video = dir.appendingPathComponent("\(e.orientation).mp4")
        try await Downloader(expected: e.bytes, progress: progress).download(e.video, to: video)
        if !e.sha256.isEmpty, try sha256(of: video).caseInsensitiveCompare(e.sha256) != .orderedSame {
            throw StoreError.message("the download is damaged (sha256 mismatch)")
        }

        if let p = e.poster, let (data, r) = try? await URLSession.shared.data(from: p),
           (r as? HTTPURLResponse)?.statusCode == 200 {
            try? data.write(to: dir.appendingPathComponent("poster.jpg"))
        }
        try Task.checkCancellation()

        var scene: [String: Any] = ["format": 1]
        for k in ["id", "title", "author", "license", "description", "loop", "rotate"] { scene[k] = e.json[k] }
        var v = (e.json["videos"] as? [String: Any])?[e.orientation] as? [String: Any] ?? [:]
        v["url"] = nil
        v["file"] = "\(e.orientation).mp4"
        scene["videos"] = [e.orientation: v]
        let data = try JSONSerialization.data(withJSONObject: scene, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: dir.appendingPathComponent("scene.json"), options: .atomic)
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
