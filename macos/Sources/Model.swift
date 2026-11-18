// App state shared by the menu, the settings window and the wallpaper: the store, the catalog and the
// preview being shown.

import Foundation

final class Model: ObservableObject {
    let store = Store()

    // catalog
    @Published var catalog: [CatalogEntry] = []
    @Published var catalogLoading = false
    @Published var catalogError: String?
    @Published var catalogURL: String {
        didSet { UserDefaults.standard.set(catalogURL, forKey: "CatalogUrl") }
    }
    var effectiveCatalogURL: String {
        let u = catalogURL.trimmingCharacters(in: .whitespaces)
        return u.isEmpty ? defaultCatalog : u
    }

    // preview: the catalog look downloading or on the desktop, not yet saved
    @Published private(set) var previewEntry: CatalogEntry?
    @Published private(set) var previewProgress: Double = 0
    @Published private(set) var preview: Playable?
    private var previewDir: URL?
    @Published var error: String?
    private var previewTask: Task<Void, Never>?
    private var catalogTask: Task<Void, Never>?

    // a saved look's level being downloaded (one at a time)
    @Published private(set) var levelJob: (look: String, level: String)?
    @Published private(set) var levelProgress: Double = 0
    private var levelTask: Task<Void, Never>?

    /// A video that failed to play; the wallpaper shows the bundled look instead.
    @Published var failedFile: URL?

    init() {
        catalogURL = UserDefaults.standard.string(forKey: "CatalogUrl") ?? ""
        store.clearPreviews()   // leftovers of a run that ended while previewing
        // a look repaired or replaced from outside (`livescenes add`): try it again
        store.onExternalChange = { [weak self] in self?.failedFile = nil }
    }

    /// What the wallpaper shows: the preview, else the active profile, else the bundled look.
    var playable: Playable? {
        if let p = preview { return p }
        if let p = store.playable, p.file != failedFile { return p }
        return store.bundled
    }

    func loadCatalog() {
        catalogLoading = true
        catalogError = nil
        let url = effectiveCatalogURL
        catalogTask?.cancel()   // only the newest request may fill the list
        catalogTask = Task { @MainActor in
            do {
                let list = try await Catalog.fetch(url)
                guard !Task.isCancelled else { return }
                catalog = list
                adoptLevels()
            } catch {
                guard !Task.isCancelled else { return }
                catalog = []
                catalogError = "Couldn't load the catalog: \(error.localizedDescription)"
            }
            catalogLoading = false
        }
    }

    /// Saved looks without levels whose video is the catalog's default level get the catalog's levels.
    private func adoptLevels() {
        var changed = false
        for e in catalog where store.scene(e.id) != nil && store.level(e.id) == nil {
            if Catalog.adoptLevels(e, in: store.lookDir(e.id)) { changed = true }
        }
        if changed { store.objectWillChange.send() }
    }

    /// Changes a saved look's level (for every profile of the look): downloads that level's video from the
    /// catalog in place of the old one.
    func setLevel(look: String, _ level: String) {
        guard levelJob == nil, store.level(look)?.level != level else { return }
        levelJob = (look, level)
        levelProgress = 0
        error = nil
        let url = effectiveCatalogURL
        levelTask = Task { @MainActor in
            do {
                var e = catalog.first { $0.id == look }
                if e?.levels?.videos[level] == nil {   // not loaded yet, or older than the release
                    let fresh = try await Catalog.fetch(url)
                    if effectiveCatalogURL == url { catalog = fresh }
                    e = fresh.first { $0.id == look }
                }
                guard let e else { throw StoreError.message("the catalog has no look \(look)") }
                do {
                    try await Catalog.changeLevel(e, to: level, in: store.lookDir(look)) { [weak self] f in
                        self?.levelProgress = f
                    }
                } catch where !(error is CancellationError) && !Task.isCancelled {
                    // the list may be older than the release: once more with a fresh catalog
                    let fresh = try await Catalog.fetch(url)
                    guard let n = fresh.first(where: { $0.id == look }),
                          n.levels?.videos[level]?.url != e.levels?.videos[level]?.url else { throw error }
                    if effectiveCatalogURL == url { catalog = fresh }
                    try await Catalog.changeLevel(n, to: level, in: store.lookDir(look)) { [weak self] f in
                        self?.levelProgress = f
                    }
                }
                failedFile = nil
                store.objectWillChange.send()   // the wallpaper picks up the new file
            } catch {
                if !(error is CancellationError) && !Task.isCancelled {
                    self.error = "Couldn't change the \(store.level(look)?.label.lowercased() ?? "level") of "
                        + "\(store.lookTitle(look)): \(error.localizedDescription)"
                }
            }
            levelJob = nil
        }
    }

    func cancelLevel() {
        levelTask?.cancel()
        levelTask = nil
    }

    func startPreview(_ e: CatalogEntry) {
        discardPreview()
        previewEntry = e
        previewProgress = 0
        error = nil
        // a folder per attempt: a cancelled download that is still finishing can't touch the new one
        let dir = store.previewDir.appendingPathComponent("\(e.id)-\(UUID().uuidString.prefix(8))")
        previewDir = dir
        let catalogURL = effectiveCatalogURL
        previewTask = Task { @MainActor in
            var e = e
            do {
                let id = e.id
                let progress: (Double) -> Void = { [weak self] f in
                    if self?.previewEntry?.id == id { self?.previewProgress = f }
                }
                do {
                    try await Catalog.downloadPreview(e, into: dir, progress: progress)
                } catch where !(error is CancellationError) && !Task.isCancelled {
                    // The list may be older than the release (a new release can rename or replace a look's
                    // videos, and the old URLs then 404): fetch the catalog again and retry once if this
                    // look's video changed.
                    guard let fresh = try? await Catalog.fetch(catalogURL), !Task.isCancelled,
                          let n = fresh.first(where: { $0.id == e.id }),
                          n.video != e.video || n.sha256 != e.sha256 else { throw error }
                    if effectiveCatalogURL == catalogURL { catalog = fresh }
                    e = n
                    if previewDir == dir { previewEntry = n; previewProgress = 0 }
                    try await Catalog.downloadPreview(e, into: dir, progress: progress)
                }
                try Task.checkCancellation()
                guard previewDir == dir else { throw CancellationError() }
                guard let s = store.readScene(dir), let p = Playable(scene: s, dir: dir) else {
                    throw StoreError.message("the downloaded look can't be read")
                }
                preview = p
            } catch {
                try? FileManager.default.removeItem(at: dir)
                if !Task.isCancelled && previewDir == dir && !(error is CancellationError) {
                    self.error = "Couldn't preview \(e.title): \(error.localizedDescription)"
                    previewEntry = nil
                    previewDir = nil
                }
            }
        }
    }

    func savePreview() {
        guard let e = previewEntry, preview != nil, let dir = previewDir else { return }
        do {
            _ = try store.install(previewDir: dir)
            failedFile = nil
        } catch {
            self.error = "Couldn't save \(e.title): \(error.localizedDescription)"
        }
        previewEntry = nil
        preview = nil
        previewDir = nil
        store.clearPreviews()
    }

    /// Leaves the preview without saving: its files are deleted.
    func discardPreview() {
        previewTask?.cancel()
        previewTask = nil
        guard previewEntry != nil || preview != nil else { return }
        previewEntry = nil
        preview = nil
        if let dir = previewDir { try? FileManager.default.removeItem(at: dir) }
        previewDir = nil
    }
}
