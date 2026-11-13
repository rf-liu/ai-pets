import AppKit

// Only explicit settings/speed windows control Dock presence. Pet panels do not.
@MainActor
final class UtilityWindowCoordinator: NSObject {
    private final class Entry {
        weak var window: NSWindow?
        var active = true
        var onDismiss: (@MainActor () -> Void)?
        init(_ window: NSWindow) { self.window = window }
    }
    private var entries: [ObjectIdentifier: Entry] = [:]
    private var preferred: ObjectIdentifier?
    private var updateQueued = false
    private let center: NotificationCenter
    private let applyPolicy: @MainActor (NSApplication.ActivationPolicy) -> Void
    private let activate: @MainActor () -> Void
    private let schedule: @MainActor (@escaping @MainActor () -> Void) -> Void
    private(set) var isDismissing = false
    var onChange: (@MainActor () -> Void)?

    init(center: NotificationCenter = .default,
         applyPolicy: @escaping @MainActor (NSApplication.ActivationPolicy) -> Void = { policy in
             if NSApp.activationPolicy() != policy { _ = NSApp.setActivationPolicy(policy) }
         },
         activate: @escaping @MainActor () -> Void = { NSApp.activate(ignoringOtherApps: true) },
         schedule: @escaping @MainActor (@escaping @MainActor () -> Void) -> Void = { action in DispatchQueue.main.async { action() } }) {
        self.center = center; self.applyPolicy = applyPolicy; self.activate = activate; self.schedule = schedule
        super.init()
        // Observe close independently of a window's delegate or SwiftUI hosting.
        center.addObserver(self, selector: #selector(windowWillClose(_:)), name: NSWindow.willCloseNotification, object: nil)
    }
    deinit { center.removeObserver(self) }

    var visibleCount: Int { entries.values.filter(isAvailable).count }
    private func isAvailable(_ entry: Entry) -> Bool {
        guard entry.active, let window = entry.window else { return false }
        return window.isVisible || window.isMiniaturized
    }
    func present(_ window: NSWindow, onDismiss: (@MainActor () -> Void)? = nil) {
        let id = ObjectIdentifier(window), entry = entries[id] ?? Entry(window)
        entry.active = true; entry.onDismiss = onDismiss; entries[id] = entry
        preferred = id; isDismissing = false
        if window.isMiniaturized { window.deminiaturize(nil) }
        // Make the intended window available before activation can deliver a
        // reopen event, so it cannot accidentally create a settings page.
        window.makeKeyAndOrderFront(nil)
        applyPolicy(.regular); onChange?(); activate()
    }
    @discardableResult func focusExistingWindow() -> Bool {
        let entry = preferred.flatMap { entries[$0] }.flatMap { isAvailable($0) ? $0 : nil }
            ?? entries.values.first(where: isAvailable)
        guard let window = entry?.window else { return false }
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        return true
    }
    func hide(_ window: NSWindow) {
        dismiss(window)
        window.orderOut(nil)
    }
    @objc private func windowWillClose(_ notification: Notification) {
        guard let window = notification.object as? NSWindow else { return }
        dismiss(window)
    }
    private func dismiss(_ window: NSWindow) {
        guard let entry = entries[ObjectIdentifier(window)], entry.active else { return }
        entry.active = false; isDismissing = true
        entry.onDismiss?()
        guard !updateQueued else { return }; updateQueued = true
        // willClose arrives before isVisible changes. Reconcile after AppKit's
        // close pass, ignoring that closing window even during the transition.
        schedule { [weak self] in
            guard let self else { return }
            self.updateQueued = false
            self.entries = self.entries.filter { $0.value.window != nil }
            self.applyPolicy(self.visibleCount > 0 ? .regular : .accessory)
            self.isDismissing = false
            self.onChange?()
        }
    }
}
