import AppKit

// Window followers consume memory snapshots. Workspace/display notifications
// refresh them instead of querying LaunchServices and NSScreen every frame.
@MainActor final class WorkspaceSnapshot {
    static let shared = WorkspaceSnapshot()
    struct ApplicationState {
        let processIdentifier: Int32
        let bundleIdentifier: String?
        let isHidden: Bool
        let isTerminated: Bool
        init(_ app: NSRunningApplication) {
            processIdentifier = app.processIdentifier; bundleIdentifier = app.bundleIdentifier
            isHidden = app.isHidden; isTerminated = app.isTerminated
        }
    }
    private(set) var frontmost: ApplicationState?
    private(set) var screens: [NSScreen] = []
    private(set) var mainDisplayHeight: CGFloat = 0
    private var applications: [String: ApplicationState] = [:]
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
        for name in [NSWorkspace.didActivateApplicationNotification, NSWorkspace.didLaunchApplicationNotification, NSWorkspace.didTerminateApplicationNotification, NSWorkspace.didHideApplicationNotification, NSWorkspace.didUnhideApplicationNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.refreshApplications() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refreshScreens() }
        })
    }
    func application(bundleID: String) -> ApplicationState? {
        guard let app = applications[bundleID], !app.isTerminated else { return nil }
        return app
    }
    func refresh() { refreshApplications(); refreshScreens() }
    private func refreshApplications() {
        frontmost = frontmostProvider().map(ApplicationState.init); applications.removeAll(keepingCapacity: true)
        let hosts = Set(CompanionProfile.allCases.map(\.hostBundleID))
        for app in runningProvider() { if let id = app.bundleIdentifier, hosts.contains(id) { applications[id] = ApplicationState(app) } }
    }
    private func refreshScreens() {
        screens = screensProvider(); mainDisplayHeight = CGDisplayBounds(CGMainDisplayID()).height
    }
}
