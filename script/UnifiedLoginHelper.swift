import AppKit

@main struct UnifiedLoginHelper {
    @MainActor static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.prohibited)
        var root = Bundle.main.bundleURL.deletingLastPathComponent()
        while root.pathExtension != "app" && root.path != "/" { root.deleteLastPathComponent() }
        guard root.pathExtension == "app" else { return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        configuration.arguments = ["--background"]
        NSWorkspace.shared.openApplication(at: root, configuration: configuration) { _, _ in
            DispatchQueue.main.async { app.terminate(nil) }
        }
        app.run()
    }
}
