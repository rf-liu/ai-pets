import AppKit

// Window followers consume memory snapshots. Workspace/display notifications
// refresh them instead of querying LaunchServices and NSScreen every frame.
@MainActor final class WorkspaceSnapshot {
    static let shared = WorkspaceSnapshot()
    private(set) var frontmost: NSRunningApplication?
    private(set) var screens: [NSScreen] = []
    private(set) var mainDisplayHeight: CGFloat = 0
    private var applications: [String: NSRunningApplication] = [:]
    private let frontmostProvider: () -> NSRunningApplication?
    private let runningProvider: () -> [NSRunningApplication]
    private let screensProvider: () -> [NSScreen]
    private var observers: [NSObjectProtocol] = []
    init(observe: Bool = true,
         frontmost: @escaping () -> NSRunningApplication? = { NSWorkspace.shared.frontmostApplication },
         running: @escaping () -> [NSRunningApplication] = { NSWorkspace.shared.runningApplications },
         screens: @escaping () -> [NSScreen] = { NSScreen.screens }) {
        frontmostProvider = frontmost; runningProvider = running; screensProvider = screens
        refresh()
        guard observe else { return }
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.refreshApplications() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshScreens() }
        })
    }
    func application(bundleID: String) -> NSRunningApplication? {
        guard let app = applications[bundleID], !app.isTerminated else { return nil }
        return app
    }
    func refresh() { refreshApplications(); refreshScreens() }
    private func refreshApplications() {
        frontmost = frontmostProvider(); applications.removeAll(keepingCapacity: true)
        for app in runningProvider() { if let id = app.bundleIdentifier { applications[id] = app } }
    }
    private func refreshScreens() {
        screens = screensProvider(); mainDisplayHeight = CGDisplayBounds(CGMainDisplayID()).height
    }
}
