import AppKit
import ServiceManagement

enum CompanionProfile: String, CaseIterable, Identifiable {
    case gpt, gemini, claude, deepseek
    var id: String { rawValue }
    var title: String { switch self { case .gpt: "GPT"; case .gemini: "Gemini"; case .claude: "Claude"; case .deepseek: "DS" } }
    var petName: String { title + " 娘" }
    var hostName: String { switch self { case .gpt: "Codex"; case .gemini: "Antigravity"; case .claude: "Claude"; case .deepseek: "DeepSeek Harness" } }
    var hostBundleID: String { switch self { case .gpt: "com.openai.codex"; case .gemini: "com.google.antigravity"; case .claude: "com.anthropic.claudefordesktop"; case .deepseek: "com.deepseek.dsh" } }
    var imageFile: String { switch self { case .gpt: "gpt-dragon-niang-bust.png"; case .gemini: "gemini-original.png"; case .claude: "claude-bust.png"; case .deepseek: "deepseek-original.png" } }
    func completionImageFile(skin: String) -> String {
        switch self {
        case .gpt: "gpt-smile.png"
        case .gemini: skin == "gemini-hd" ? "gemini-hd-smile.png" : "gemini-original-smile.png"
        case .claude: "claude-smile.png"
        case .deepseek: "deepseek-smile.png"
        }
    }
    // Only artwork drawn for this identity and skin may enter its click pool.
    func clickExpressionFiles(skin: String) -> [String] {
        switch self {
        case .gpt: ["gpt-closed-eyes.png", "gpt-pout.png", "gpt-surprised.png"]
        case .gemini: skin == "gemini-hd" ? ["gemini-hd-sleepy.png", "gemini-hd-wink.png", "gemini-hd-pout.png"] : []
        case .claude: ["claude-thoughtful.png", "claude-closed-eyes.png", "claude-wink.png"]
        case .deepseek: [] // DS retains its existing ten-expression pool.
        }
    }
    var quotesFile: String { self == .gpt ? "quotes.json" : rawValue + "-quotes.json" }
    var workerScript: String { self == .gpt ? "watch.mjs" : rawValue + "-watch.mjs" }
    var completionScript: String { self == .gpt ? "completion-monitor.mjs" : rawValue + "-completion-monitor.mjs" }
    var speedScript: String { self == .gpt ? "thread-speed.mjs" : rawValue + "-thread-speed.mjs" }
    var slogan: String { switch self {
        case .gpt: "讓小龍娘陪你掌握 Codex 額度。"
        case .gemini: "讓貓娘陪你掌握 Antigravity 額度。"
        case .claude: "小克陪你聊兩句，點一下換句語錄。"
        case .deepseek: "讓小鯨魚陪你掌握 DeepSeek 用量與餘額。"
    } }
    static let dsExpressions: [(id: String, name: String)] = [
        ("main", "普通"), ("stroking", "摸头"),
        ("angry", "生气"), ("disappointed", "失落"), ("exhausted", "疲惫"),
        ("half_closed_eyes", "半闭眼"), ("close_eyes", "闭眼"), ("half_open_eyes", "半睁眼")
    ]
    var defaultSkin: String { self == .gemini ? "gemini-hd" : self == .deepseek ? "ds-desktop-auto" : "default" }
    var quotaEnabled: Bool { self != .claude }
    var artworkInset: CGFloat { self == .deepseek ? 8 : 0 }
    func artworkURL(skin: String, resources: URL, data: URL, originalDS: Bool = false) -> URL {
        if self == .deepseek {
            let expression = skin == "ds-desktop-auto" ? "main" : String(skin.dropFirst("ds-desktop-".count))
            if skin.hasPrefix("ds-desktop-"), Self.dsExpressions.contains(where: { $0.id == expression }) {
                let repaired = data.deletingLastPathComponent().appendingPathComponent("artwork/ds-restored/" + expression + ".png")
                if !originalDS, FileManager.default.fileExists(atPath: repaired.path) { return repaired }
                let bundledRepair = resources.appendingPathComponent("ds-restored/" + expression + ".png")
                if !originalDS, FileManager.default.fileExists(atPath: bundledRepair.path) { return bundledRepair }
                let local = data.deletingLastPathComponent().appendingPathComponent("artwork/ds-desktop/" + expression + ".png")
                if FileManager.default.fileExists(atPath: local.path) { return local }
            }
        }
        let name = self == .gemini && skin == "gemini-hd" ? "gemini-catgirl-hd.webp" : imageFile
        let local = data.deletingLastPathComponent().appendingPathComponent("artwork/" + name)
        if FileManager.default.fileExists(atPath: local.path) { return local }
        let bundled = resources.appendingPathComponent(name)
        if FileManager.default.fileExists(atPath: bundled.path) { return bundled }
        return resources.appendingPathComponent(imageFile)
    }
}

@MainActor enum UnifiedStartup {
    static let service = SMAppService.loginItem(identifier: "io.github.t7moris.AICompanionLauncher")
    static var enabled: Bool { service.status == .enabled || service.status == .requiresApproval }
    static func setEnabled(_ value: Bool) throws {
        if value && !enabled { try service.register() }
        else if !value && enabled { try service.unregister() }
        NotificationCenter.default.post(name: .init("AICompanionStartupChanged"), object: nil)
    }
}
