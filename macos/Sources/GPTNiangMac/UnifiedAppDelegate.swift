import AppKit
import SwiftUI
import Darwin

@MainActor final class UnifiedAppDelegate: NSObject, NSApplicationDelegate {
    private var companions: [CompanionProfile: CompanionController] = [:]
    private var timer: Timer?
    private var observers: [NSObjectProtocol] = []
    private var lockDescriptor: Int32 = -1
    private var selected: CompanionProfile = .gpt
    private var root: URL!
    private var speedWindow: NSWindow?
    private var speedProfile: CompanionProfile = .gpt
    private let utilityWindows = UtilityWindowCoordinator()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let args = ProcessInfo.processInfo.arguments
        let previewData = Bundle.main.object(forInfoDictionaryKey: "AICompanionPreviewData") as? String
        if args.contains("--enable-login-item") {
            do { try UnifiedStartup.setEnabled(true); print("login-item-enabled=\(UnifiedStartup.service.status == .enabled) requires-approval=\(UnifiedStartup.service.status == .requiresApproval)") }
            catch { let value = error as NSError; print("login-item-registration-failed domain=\(value.domain) code=\(value.code)") }
            NSApp.terminate(nil); return
        }
        if let previewData { root = URL(fileURLWithPath: previewData, isDirectory: true) }
        else if let i = args.firstIndex(of: "--data-dir"), args.indices.contains(i+1) {
            root = URL(fileURLWithPath: args[i+1], isDirectory: true)
        } else {
            root = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/AIQuotaCompanion", isDirectory: true)
        }
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        lockDescriptor = Darwin.open(root.appendingPathComponent("unified.lock").path, O_CREAT | O_RDWR, 0o600)
        guard lockDescriptor >= 0, flock(lockDescriptor, LOCK_EX | LOCK_NB) == 0 else { NSApp.terminate(nil); return }
        utilityWindows.onChange = { [weak self] in self?.writeStatus() }
        migrateGPTPreferences()
        if previewData != nil {
            if Bundle.main.object(forInfoDictionaryKey: "AICompanionPreviewSpeed") as? Bool == true { showSpeed(.gpt) }
            else { showSettings(.gpt) }
            return
        }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.syncHosts() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: .init("AICompanionStartupChanged"), object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.companions.values.forEach { $0.syncLoginState() } }
        })
        syncHosts()
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.syncHosts() }
        }
        if companions.isEmpty && !args.contains("--background") && !args.contains("--probe-runtime") { showSettings(.gpt) }
    }
    private func migrateGPTPreferences() {
        let target = root.appendingPathComponent("gpt", isDirectory: true)
        guard !FileManager.default.fileExists(atPath: target.path) else { return }
        try? FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
        let old = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/GPTNiangUsage", isDirectory: true)
        for name in ["preferences.json", "quotes.json", "audio-preferences.json", "sounds"] {
            let source = old.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: source.path) { try? FileManager.default.copyItem(at: source, to: target.appendingPathComponent(name)) }
        }
    }
    private func ensure(_ profile: CompanionProfile) -> CompanionController {
        if let old = companions[profile] { return old }
        if profile != .gpt {
            let folder = root.appendingPathComponent(profile.rawValue, isDirectory: true)
            let file = folder.appendingPathComponent("preferences.json")
            if !FileManager.default.fileExists(atPath: file.path) {
                try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let source = root.appendingPathComponent("gpt/preferences.json")
                if let bytes = try? Data(contentsOf: source), var values = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
                    values["x"] = 0; values["desktopLeft"] = nil; values["desktopBottom"] = nil
                    values["randomExpressionStartTap"] = nil // A newly created pet starts at its own default of three.
                    if let copy = try? JSONSerialization.data(withJSONObject: values) { try? copy.write(to: file, options: .atomic) }
                }
                for name in ["audio-preferences.json", "sounds"] {
                    let source = root.appendingPathComponent("gpt", isDirectory: true).appendingPathComponent(name)
                    if FileManager.default.fileExists(atPath: source.path) { try? FileManager.default.copyItem(at: source, to: folder.appendingPathComponent(name)) }
                }
            }
        }
        let controller = CompanionController(profile: profile, dataDirectory: root.appendingPathComponent(profile.rawValue, isDirectory: true),
            onProfileSelection: { [weak self] profile in self?.showSettings(profile) },
            onSpeedSelection: { [weak self] profile in self?.showSpeed(profile) },
            isSpeedVisible: { [weak self] in self?.speedWindow?.isVisible == true && self?.speedProfile == profile },
            utilityWindows: utilityWindows)
        companions[profile] = controller
        controller.applicationDidFinishLaunching(Notification(name: NSApplication.didFinishLaunchingNotification))
        controller.syncLoginState()
        return controller
    }
    private func syncHosts() {
        for profile in CompanionProfile.allCases {
            if NSRunningApplication.runningApplications(withBundleIdentifier: profile.hostBundleID).contains(where: { !$0.isTerminated }) {
                _ = ensure(profile)
            }
        }
        writeStatus()
    }
    private func writeStatus() {
        let state: [String: Any] = ["pid": ProcessInfo.processInfo.processIdentifier,
            "profiles": companions.keys.map(\.rawValue).sorted(),
            "hostsRunning": CompanionProfile.allCases.filter { !NSRunningApplication.runningApplications(withBundleIdentifier: $0.hostBundleID).isEmpty }.map(\.rawValue),
            "loginEnabled": UnifiedStartup.enabled, "at": Date().timeIntervalSince1970,
            "activationPolicy": NSApp.activationPolicy() == .regular ? "regular" : NSApp.activationPolicy() == .accessory ? "accessory" : "prohibited",
            "visibleUtilityWindows": utilityWindows.visibleCount]
        if let bytes = try? JSONSerialization.data(withJSONObject: state, options: [.sortedKeys]) { try? bytes.write(to: root.appendingPathComponent("unified-status.json"), options: .atomic) }
    }
    private func showSettings(_ profile: CompanionProfile) {
        selected = profile
        if let window = speedWindow { utilityWindows.hide(window) }
        let frame = companions.values.compactMap(\.visibleSettingsFrame).first
        let controller = ensure(profile)
        companions.values.forEach { $0.hideSettingsWindow() }
        controller.presentSettings(frame: frame)
    }
    private func showSpeed(_ profile: CompanionProfile) {
        companions.values.forEach { $0.hideSettingsWindow() }
        if speedProfile != profile { companions[speedProfile]?.speedStore.stop() }
        speedProfile = profile
        let controller = ensure(profile)
        if speedWindow == nil {
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 620, height: 726), styleMask: [.titled,.closable,.miniaturizable], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false; window.center(); speedWindow = window
        }
        controller.speedStore.start(model: controller.speedModel)
        speedWindow?.title = "AI 聊天速度 · " + profile.title
        speedWindow?.contentView = NSHostingView(rootView: UnifiedThreadSpeedView(profile: profile, store: controller.speedStore, model: controller.speedModel, onSelection: { [weak self] in self?.showSpeed($0) }))
        if let window = speedWindow {
            utilityWindows.present(window, onDismiss: { [weak self] in self?.companions.values.forEach { $0.speedStore.stop() } })
        }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        guard root != nil else { return false }
        syncHosts()
        if utilityWindows.focusExistingWindow() || utilityWindows.isDismissing { return false }
        showSettings(selected)
        return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        companions.values.forEach { $0.applicationWillTerminate(notification) }
        for observer in observers { NSWorkspace.shared.notificationCenter.removeObserver(observer); NotificationCenter.default.removeObserver(observer) }
        if lockDescriptor >= 0 { Darwin.close(lockDescriptor) }
    }
}
