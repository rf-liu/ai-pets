import AppKit

struct CompletionDestination: Equatable {
    let profile: CompanionProfile
    let conversationID: String?

    init(profile: CompanionProfile, conversationID: String?) {
        self.profile = profile
        self.conversationID = profile == .gpt ? conversationID.flatMap { UUID(uuidString: $0)?.uuidString.lowercased() } : nil
    }
    var conversationURL: URL? {
        guard let conversationID else { return nil }
        return URL(string: "codex://threads/" + conversationID)
    }

    @MainActor func open() {
        let workspace = NSWorkspace.shared
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: profile.hostBundleID).first?.bundleURL
                ?? workspace.urlForApplication(withBundleIdentifier: profile.hostBundleID) else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        if let url = conversationURL {
            workspace.open([url], withApplicationAt: app, configuration: configuration) { _, error in
                if error != nil {
                    Task { @MainActor in
                        let fallback = NSWorkspace.OpenConfiguration()
                        fallback.activates = true
                        NSWorkspace.shared.openApplication(at: app, configuration: fallback)
                    }
                }
            }
        } else {
            workspace.openApplication(at: app, configuration: configuration)
        }
    }
}
