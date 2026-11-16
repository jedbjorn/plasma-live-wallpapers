// The wallpaper: one borderless window per screen at desktop level (below the icons, ignoring the
// mouse), each showing the same looping video. One player decodes it for all screens, with the
// hardware HEVC decoder, and it is paused whenever no wallpaper window can be seen.

import AppKit
import AVFoundation

/// A view that shows the player scaled to fill it, with the crop shifted so that the focus point is as
/// close to the centre as the video's edges allow (sdk/FORMAT.md, "Playing").
final class VideoView: NSView {
    let playerLayer = AVPlayerLayer()
    var videoSize = CGSize.zero { didSet { needsLayout = true } }
    var focus = CGPoint(x: 0.5, y: 0.5) { didSet { needsLayout = true } }

    init(player: AVPlayer) {
        super.init(frame: .zero)
        layer = CALayer()   // layer-hosting: assigned before wantsLayer
        wantsLayer = true
        layer!.backgroundColor = NSColor(red: 0x05 / 255, green: 0x06 / 255, blue: 0x08 / 255, alpha: 1).cgColor
        layer!.masksToBounds = true
        playerLayer.player = player
        playerLayer.videoGravity = .resize
        layer!.addSublayer(playerLayer)
    }

    required init?(coder: NSCoder) { fatalError() }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        let W = bounds.width, H = bounds.height
        if videoSize.width > 0, videoSize.height > 0, W > 0, H > 0 {
            let fill = max(W / videoSize.width, H / videoSize.height)
            let w = (videoSize.width * fill).rounded(.up), h = (videoSize.height * fill).rounded(.up)
            let x = min(0, max(W - w, W / 2 - focus.x * w)).rounded()
            let top = min(0, max(H - h, H / 2 - focus.y * h)).rounded()   // focus y counts from the top
            playerLayer.videoGravity = .resize
            playerLayer.frame = CGRect(x: x, y: H - top - h, width: w, height: h)
        } else {
            playerLayer.videoGravity = .resizeAspectFill
            playerLayer.frame = bounds
        }
        playerLayer.contentsScale = window?.backingScaleFactor ?? 2
        CATransaction.commit()
    }
}

final class WallpaperWindow: NSWindow {
    let view: VideoView

    init(screen: NSScreen, player: AVPlayer) {
        view = VideoView(player: player)
        super.init(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle, .fullScreenNone]
        ignoresMouseEvents = true
        isOpaque = true
        hasShadow = false
        backgroundColor = .black
        isReleasedWhenClosed = false
        animationBehavior = .none
        contentView = view
        setFrame(screen.frame, display: false)
    }
}

final class Wallpaper: NSObject {
    private let player = AVQueuePlayer()
    private var looper: AVPlayerLooper?
    private var looperStatus: NSKeyValueObservation?
    private var windows: [WallpaperWindow] = []
    private(set) var current: Playable?

    /// The menu's Pause.
    var paused = false { didSet { update() } }
    // each hides the wallpaper on its own: waking the displays while locked must not resume playback
    private var displaysAsleep = false { didSet { update() } }
    private var locked = false { didSet { update() } }
    private var sessionInactive = false { didSet { update() } }
    /// Called when a video can't be played (missing file, unsupported codec).
    var onFailure: ((Playable) -> Void)?

    override init() {
        super.init()
        player.isMuted = true
        player.allowsExternalPlayback = false
        player.preventsDisplaySleepDuringVideoPlayback = false   // a wallpaper must never keep the display on
        player.actionAtItemEnd = .advance

        NotificationCenter.default.addObserver(self, selector: #selector(rebuildWindows),
                                               name: NSApplication.didChangeScreenParametersNotification, object: nil)
        let ws = NSWorkspace.shared.notificationCenter
        ws.addObserver(self, selector: #selector(displaysSlept), name: NSWorkspace.screensDidSleepNotification, object: nil)
        ws.addObserver(self, selector: #selector(displaysWoke), name: NSWorkspace.screensDidWakeNotification, object: nil)
        ws.addObserver(self, selector: #selector(sessionResigned), name: NSWorkspace.sessionDidResignActiveNotification, object: nil)
        ws.addObserver(self, selector: #selector(sessionBecameActive), name: NSWorkspace.sessionDidBecomeActiveNotification, object: nil)
        let dnc = DistributedNotificationCenter.default()
        dnc.addObserver(self, selector: #selector(screenLocked), name: .init("com.apple.screenIsLocked"), object: nil)
        dnc.addObserver(self, selector: #selector(screenUnlocked), name: .init("com.apple.screenIsUnlocked"), object: nil)

        rebuildWindows()
    }

    @objc private func displaysSlept() { displaysAsleep = true }
    @objc private func displaysWoke() { displaysAsleep = false }
    @objc private func screenLocked() { locked = true }
    @objc private func screenUnlocked() { locked = false }
    @objc private func sessionResigned() { sessionInactive = true }
    @objc private func sessionBecameActive() { sessionInactive = false }

    /// Shows `p` (nil: nothing, the dark background). A change of speed alone doesn't restart the video.
    func show(_ p: Playable?) {
        // a look replaced on disk (same path, new file) has a new stamp and is reloaded
        let sameFile = p?.file == current?.file && p?.stamp == current?.stamp && looper != nil
        current = p
        player.defaultRate = Float(p?.speed ?? 1)
        if !sameFile {
            looperStatus = nil
            looper?.disableLooping()
            looper = nil
            player.removeAllItems()
            if let p {
                let item = AVPlayerItem(asset: AVURLAsset(url: p.file))
                item.preferredForwardBufferDuration = 2
                looper = AVPlayerLooper(player: player, templateItem: item)
                looperStatus = looper!.observe(\.status, options: [.new]) { [weak self] l, _ in
                    guard l.status == .failed else { return }
                    DispatchQueue.main.async {
                        guard let self, let cur = self.current, cur.file == p.file else { return }
                        NSLog("LiveScenes: can't play %@: %@", p.file.path, "\(l.error.map { "\($0)" } ?? "?")")
                        self.onFailure?(cur)
                    }
                }
            }
        }
        for w in windows {
            w.view.videoSize = CGSize(width: p?.width ?? 0, height: p?.height ?? 0)
            w.view.focus = CGPoint(x: p?.focusX ?? 0.5, y: p?.focusY ?? 0.5)
        }
        update()
    }

    @objc private func rebuildWindows() {
        windows.forEach { w in
            NotificationCenter.default.removeObserver(self, name: NSWindow.didChangeOcclusionStateNotification, object: w)
            w.view.playerLayer.player = nil
            w.orderOut(nil)
            w.close()
        }
        windows = NSScreen.screens.map { screen in
            let w = WallpaperWindow(screen: screen, player: player)
            w.view.videoSize = CGSize(width: current?.width ?? 0, height: current?.height ?? 0)
            w.view.focus = CGPoint(x: current?.focusX ?? 0.5, y: current?.focusY ?? 0.5)
            NotificationCenter.default.addObserver(self, selector: #selector(occlusionChanged),
                                                   name: NSWindow.didChangeOcclusionStateNotification, object: w)
            w.orderFrontRegardless()
            return w
        }
        update()
    }

    @objc private func occlusionChanged() { update() }

    /// Some wallpaper window can be seen: not fully covered by windows, a full-screen app, or the lock screen.
    private var visible: Bool { windows.contains { $0.occlusionState.contains(.visible) } }

    var playing: Bool { current != nil && !paused && !displaysAsleep && !locked && !sessionInactive && visible }

    private func update() {
        if playing {
            if player.rate != player.defaultRate { player.rate = player.defaultRate }
        } else if player.rate != 0 {
            player.pause()
        }
    }
}
