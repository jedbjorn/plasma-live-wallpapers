// The Live Scenes window: saved profiles (use, speed, rename, delete), the catalog with preview and
// save, and the catalog URL.

import SwiftUI

struct SettingsView: View {
    @ObservedObject var model: Model
    @ObservedObject var store: Store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let e = model.error ?? store.broken {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.yellow)
                        Text(e).textSelection(.enabled)
                        Spacer()
                        if model.error != nil { Button("Dismiss") { model.error = nil } }
                    }
                    .padding(10)
                    .background(.yellow.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                }
                PreviewBar(model: model)
                ProfilesSection(model: model, store: store)
                CatalogSection(model: model, store: store)
                AdvancedSection(model: model)
            }
            .padding(20)
        }
        .frame(minWidth: 620, minHeight: 520)
        // every time the window opens: a release since the last load may have renamed or replaced videos
        .onAppear { if !model.catalogLoading { model.loadCatalog() } }
    }
}

struct PreviewBar: View {
    @ObservedObject var model: Model

    var body: some View {
        if let e = model.previewEntry {
            HStack(spacing: 12) {
                if model.preview == nil {
                    ProgressView(value: model.previewProgress).frame(width: 160)
                    Text("Downloading \(e.title)… \(Int(model.previewProgress * 100))%")
                    Spacer()
                    Button("Cancel") { model.discardPreview() }
                } else {
                    Image(systemName: "play.display")
                    Text("Previewing **\(e.title)** on your desktop")
                    Spacer()
                    Button("Discard") { model.discardPreview() }
                    Button("Save as Profile") { model.savePreview() }.keyboardShortcut(.defaultAction)
                }
            }
            .padding(12)
            .background(Color.accentColor.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

struct ProfilesSection: View {
    @ObservedObject var model: Model
    @ObservedObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("Profiles").font(.title2.bold())
                Spacer()
                Text("Saved looks use \(humanBytes(store.totalBytes))").foregroundStyle(.secondary)
            }
            if store.profiles.isEmpty {
                Text("No profiles yet. The built-in Living Water look is showing; preview a look from the catalog and save it as a profile.")
                    .foregroundStyle(.secondary)
            }
            ForEach(store.profiles) { p in
                ProfileRow(model: model, store: store, profile: p)
                Divider()
            }
        }
    }
}

struct ProfileRow: View {
    @ObservedObject var model: Model
    @ObservedObject var store: Store
    let profile: Profile
    @State private var name = ""
    @State private var confirmDelete = false

    var isActive: Bool { store.active == profile.id }

    var body: some View {
        HStack(spacing: 12) {
            Button { store.setActive(profile.id) } label: {
                Image(systemName: isActive ? "checkmark.circle.fill" : "circle")
                    .font(.title2)
                    .foregroundStyle(isActive ? Color.accentColor : .secondary)
            }
            .buttonStyle(.plain)
            .help(isActive ? "In use" : "Use this profile")

            Poster(url: store.poster(profile.look)).frame(width: 96, height: 54)

            VStack(alignment: .leading, spacing: 2) {
                TextField("Name", text: $name)
                    .textFieldStyle(.plain)
                    .font(.headline)
                    .onSubmit { store.rename(profile.id, name) }
                if let j = model.levelJob, j.look == profile.look {
                    HStack(spacing: 6) {
                        ProgressView(value: model.levelProgress).frame(width: 80).controlSize(.small)
                        Text("Downloading \(levelLabel(j.level))… \(Int(model.levelProgress * 100))%")
                        Button("Cancel") { model.cancelLevel() }.buttonStyle(.link)
                    }
                    .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("\(store.lookTitle(profile.look)) · \(humanBytes(store.lookBytes(profile.look)))")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let lv = store.level(profile.look) {
                Picker(lv.label, selection: Binding(get: { lv.level }, set: { model.setLevel(look: profile.look, $0) })) {
                    ForEach(levelNames, id: \.self) { l in Text("\(lv.label): \(levelLabel(l))").tag(l) }
                }
                .labelsHidden()
                .fixedSize()
                .disabled(model.levelJob != nil)
                .help("\(lv.label) (every profile of this look)")
            }
            Picker("Speed", selection: Binding(get: { profile.speed }, set: { store.setSpeed(profile.id, $0) })) {
                ForEach(speeds, id: \.self) { s in Text(speedLabel(s)).tag(s) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 150)

            Button { confirmDelete = true } label: { Image(systemName: "trash") }
                .disabled(isActive)
                .help(isActive ? "The profile in use can't be deleted" : "Delete this profile")
                .confirmationDialog("Delete \(profile.name)?", isPresented: $confirmDelete) {
                    Button("Delete", role: .destructive) { store.delete(profile.id) }
                } message: {
                    Text(store.profiles.contains { $0.id != profile.id && $0.look == profile.look }
                         ? "Another profile still uses this look, so its video is kept."
                         : "Its video is deleted too.")
                }
        }
        .onAppear { name = profile.name }
        .onChange(of: profile.name) { name = $0 }
    }
}

struct CatalogSection: View {
    @ObservedObject var model: Model
    @ObservedObject var store: Store

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Catalog").font(.title2.bold())
                Spacer()
                if model.catalogLoading { ProgressView().controlSize(.small) }
                Button("Reload") { model.loadCatalog() }.disabled(model.catalogLoading)
            }
            if let e = model.catalogError { Text(e).foregroundStyle(.red).textSelection(.enabled) }
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 16)], spacing: 16) {
                ForEach(model.catalog) { e in
                    VStack(alignment: .leading, spacing: 6) {
                        Poster(url: e.poster).aspectRatio(16 / 9, contentMode: .fit)
                        HStack(alignment: .firstTextBaseline) {
                            Text(e.title).font(.headline)
                            Spacer()
                            Text(humanBytes(e.bytes)).font(.caption).foregroundStyle(.secondary)
                        }
                        Text(e.description).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                        HStack {
                            if store.profiles.contains(where: { $0.look == e.id }) {
                                Label("Saved", systemImage: "checkmark").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(model.previewEntry?.id == e.id ? "Previewing" : "Preview") { model.startPreview(e) }
                                .disabled(model.previewEntry?.id == e.id)
                        }
                    }
                }
            }
        }
    }
}

struct AdvancedSection: View {
    @ObservedObject var model: Model

    var body: some View {
        DisclosureGroup("Advanced") {
            HStack {
                TextField("Catalog URL", text: $model.catalogURL, prompt: Text(defaultCatalog))
                    .onSubmit { model.loadCatalog() }
                Button("Default") { model.catalogURL = ""; model.loadCatalog() }
                    .disabled(model.catalogURL.isEmpty)
            }
            .padding(.top, 6)
        }
    }
}

struct Poster: View {
    let url: URL?

    var body: some View {
        ZStack {
            Color(red: 0x05 / 255, green: 0x06 / 255, blue: 0x08 / 255)
            if let url {
                AsyncImage(url: url) { img in img.resizable().aspectRatio(contentMode: .fill) } placeholder: { EmptyView() }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

func speedLabel(_ s: Double) -> String { s == 0.5 ? "0.5×" : "\(Int(s))×" }
