import AppKit
import SwiftUI
import GPTNiangCore

private struct CompletionNotice: Decodable {
    let type: String
    let sessionId: String
    let turnId: String
    let endedAt: Double
    let conversationId: String?
    let conversationTitle: String?
    let estimatedCost: Double?
}

// FileHandle callbacks run outside the main actor; keep the queue bounded and
// invalidate the token before stopping a child so old callbacks cannot replay.
private final class CompletionInbox: @unchecked Sendable {
    private let lock = NSLock()
    private var token: UUID?
    private var pending = Data()
    private var discarding = false
    private var notices: [CompletionNotice] = []
    func begin() -> UUID {
        lock.lock(); defer { lock.unlock() }
        let next = UUID(); token = next; pending.removeAll(); notices.removeAll(); discarding = false; return next
    }
    func invalidate() { lock.lock(); token = nil; pending.removeAll(); notices.removeAll(); lock.unlock() }
    func append(_ data: Data, token expected: UUID) {
        lock.lock(); defer { lock.unlock() }
        guard token == expected else { return }
        for byte in data {
            if byte == 10 {
                if !discarding, let notice = try? JSONDecoder().decode(CompletionNotice.self, from: pending),
                   notice.type == "completion", !notice.sessionId.isEmpty, !notice.turnId.isEmpty, notice.endedAt.isFinite {
                    if notices.count == 64 { notices.removeFirst() }; notices.append(notice)
                }
                pending.removeAll(keepingCapacity: true); discarding = false
            } else if !discarding {
                if pending.count < 2048 { pending.append(byte) } else { pending.removeAll(keepingCapacity: true); discarding = true }
            }
        }
    }
    func drain() -> [CompletionNotice] {
        lock.lock(); defer { lock.unlock() }; let result = notices; notices.removeAll(keepingCapacity: true); return result
    }
}

@MainActor
final class CompletionNotificationController {
    private struct OriginalLayer {
        let level: NSWindow.Level
        let visible: Bool
        let ignoresMouse: Bool
        let fullscreen: Bool
        let foregroundPID: Int32?
    }
    private let model: WidgetModel
    private let mainPanel: NSPanel
    private var state = CompletionReminderState()
    private let inbox = CompletionInbox()
    private var monitor: Process?
    private var input: Pipe?
    private var output: Pipe?
    private var nextStart: TimeInterval = 0
    private var lastPoll: TimeInterval = 0
    private var wasEnabled = false
    private var originalLayer: OriginalLayer?
    private var closingUntil: TimeInterval = 0
    private var lastFullscreenCheck: TimeInterval = 0
    private var destination: CompletionDestination?
    private var destinationEndedAt: Double = 0
    private var destinationTitle: String?
    private var destinationCost: Double?
    private var presentedDestination: CompletionDestination?
    private var presentedEndedAt: Double = 0
    private let openDestination: (CompletionDestination) -> Void
    var temporaryTopmost: Bool { originalLayer != nil }
    init(model: WidgetModel, panel: NSPanel, openDestination: ((CompletionDestination) -> Void)? = nil) {
        self.model = model; mainPanel = panel
        self.openDestination = openDestination ?? { $0.open() }
        model.onManualBubble = { [weak self] in
            guard let self, self.state.surface != nil else { return }; self.dismiss()
        }
        model.onCompletionClick = { [weak self] in self?.openCompletedConversation() }
    }
    func stop() { dismiss(); stopMonitor() }
    private func restoreLayer() {
        guard let old = originalLayer else { return }; originalLayer = nil
        mainPanel.level = old.level; mainPanel.ignoresMouseEvents = old.ignoresMouse
        if !old.visible { mainPanel.orderOut(nil) }
    }
    private func dismiss(keepPending: Bool = false) {
        restoreLayer(); model.hideCompletion(); state.dismiss(now: Date().timeIntervalSince1970, keepPending: keepPending)
        if !keepPending { destination = nil; destinationEndedAt = 0; destinationTitle = nil }
        presentedDestination = nil; presentedEndedAt = 0
        closingUntil = Date().timeIntervalSince1970 + 0.55
        (mainPanel as? WidgetPanel)?.updatePointerCapture()
    }
    func receiveCompletion(conversationID: String?, title: String? = nil, endedAt: Double, cost: Double? = nil) {
        guard endedAt.isFinite, endedAt / 1000 >= state.acknowledgedAt else { return }
        state.receive(endedAt: endedAt / 1000)
        if endedAt >= destinationEndedAt {
            destination = CompletionDestination(profile: model.profile, conversationID: conversationID)
            destinationEndedAt = endedAt
            destinationTitle = title.map { String($0.prefix(120)) }
            destinationCost = cost
        }
    }
    private func openCompletedConversation() {
        guard model.isCompletionMessage else { return }
        let target = presentedDestination ?? CompletionDestination(profile: model.profile, conversationID: nil)
        let hasNewer = destinationEndedAt > presentedEndedAt && destination != presentedDestination
        dismiss(keepPending: hasNewer)
        openDestination(target)
    }
    private func startMonitor(now: TimeInterval) {
        guard monitor?.isRunning != true, now >= nextStart else { return }
        stopMonitor(); nextStart = now + 5
        guard let node = model.findNode() else { return }
        let script = model.resources.appendingPathComponent("Backend/runtime/" + model.profile.completionScript)
        guard FileManager.default.fileExists(atPath: script.path) else { return }
        let process = Process(), stdin = Pipe(), stdout = Pipe(), token = inbox.begin(), queue = inbox
        process.executableURL = node; process.arguments = [script.path]
        if model.profile == .gpt { process.arguments?.append(model.dataDirectory.appendingPathComponent("completion-state.json").path) }
        process.standardInput = stdin; process.standardOutput = stdout; process.standardError = FileHandle.nullDevice
        process.environment = ProcessInfo.processInfo.environment
        process.environment?["AI_PETS_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)
        process.environment?["AI_PETS_HOST_STATE_FILE"] = model.dataDirectory.deletingLastPathComponent().appendingPathComponent("unified-status.json").path
        stdout.fileHandleForReading.readabilityHandler = { handle in
            let bytes = handle.availableData
            if bytes.isEmpty { handle.readabilityHandler = nil; return }; queue.append(bytes, token: token)
        }
        do { try process.run(); monitor = process; input = stdin; output = stdout }
        catch { stdout.fileHandleForReading.readabilityHandler = nil; inbox.invalidate(); try? stdin.fileHandleForWriting.close() }
    }
    private func stopMonitor() {
        inbox.invalidate(); output?.fileHandleForReading.readabilityHandler = nil
        try? input?.fileHandleForWriting.close(); try? output?.fileHandleForReading.close()
        if let process = monitor, process.isRunning {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { if process.isRunning { process.terminate() } }
        }
        monitor = nil; input = nil; output = nil
    }

    func tick(codexFrontmost: Bool, busy: Bool, now: TimeInterval = Date().timeIntervalSince1970) {
        if model.completionEnabled != wasEnabled {
            wasEnabled = model.completionEnabled
            if !wasEnabled { stop(); nextStart = 0 }
        }
        guard model.completionEnabled else { return }
        if now - lastPoll >= 1 {
            lastPoll = now
            for notice in inbox.drain() { receiveCompletion(conversationID: notice.conversationId, title: notice.conversationTitle, endedAt: notice.endedAt, cost: notice.estimatedCost) }
            startMonitor(now: now)
        }
        if let surface = state.surface {
            // Mouse-down belongs to this notification. Keep it alive until
            // mouse-up dispatches the click, even at the dismissal deadline.
            if model.isCompletionMessage && model.interactionActive && !busy { return }
            if now >= state.deadline { dismiss(); return }
            if busy {
                restoreLayer(); model.hideCompletion(); presentedDestination = nil; state.pause(); closingUntil = now + 0.55; return
            }
            if surface == .background {
                if codexFrontmost { dismiss(); return }
                if let old = originalLayer, old.fullscreen, now - lastFullscreenCheck >= 0.25 {
                    lastFullscreenCheck = now
                    if NSWorkspace.shared.frontmostApplication?.processIdentifier != old.foregroundPID || !foregroundFullscreen() { dismiss() }
                }
            } else if !codexFrontmost || !mainPanel.isVisible {
                model.hideCompletion(); state.pause(); closingUntil = now + 0.55
            }
            return
        }
        guard state.pending, !busy, !model.bubble, now >= closingUntil else { return }
        presentedDestination = destination; presentedEndedAt = destinationEndedAt
        if codexFrontmost {
            guard mainPanel.isVisible else { return }
            model.showCompletion(title: destinationTitle, cost: destinationCost); state.show(.foreground, now: now, openingDelay: 0.52)
        } else {
            originalLayer = OriginalLayer(level: mainPanel.level, visible: mainPanel.isVisible,
                ignoresMouse: mainPanel.ignoresMouseEvents, fullscreen: foregroundFullscreen(),
                foregroundPID: NSWorkspace.shared.frontmostApplication?.processIdentifier)
            // Reuse the original panel at its existing frame; never save a temporary position.
            if !(mainPanel is WidgetPanel) { mainPanel.ignoresMouseEvents = false }
            mainPanel.level = .floating; mainPanel.orderFrontRegardless()
            model.showCompletion(title: destinationTitle, cost: destinationCost); state.show(.background, now: now, openingDelay: 0.52)
        }
        (mainPanel as? WidgetPanel)?.updatePointerCapture()
    }
    private func foregroundFullscreen() -> Bool {
        guard let app = NSWorkspace.shared.frontmostApplication,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]],
              let item = windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }),
              let b = item[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
        let rect = WidgetPlacement.appKitRect(quartz: CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0), mainDisplayHeight: CGDisplayBounds(CGMainDisplayID()).height)
        return NSScreen.screens.contains { rect.insetBy(dx: -1, dy: -1).contains($0.frame) }
    }
}
