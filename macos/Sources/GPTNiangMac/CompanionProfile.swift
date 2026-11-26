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

    static let dsExpressions: [(id: String, name: String)] = [
        ("main", "普通"), ("stroking", "摸头"),
        ("angry", "生气"), ("disappointed", "失落"), ("exhausted", "疲惫"),
        ("half_closed_eyes", "半闭眼"), ("close_eyes", "闭眼"), ("half_open_eyes", "半睁眼")
    ]
    static let claudiaExpressions: [(id: String, name: String)] = [
        ("idle", "日常"), ("clawd", "抱 Clawd"), ("proud", "王冠开心"), ("sorry", "捂胸微笑"),
        ("asking", "翻书讲解"), ("reading", "认真看书"), ("listening", "倾听笔记"), ("forgiven", "遮脸害羞"),
        ("redhot", "赛博红温"), ("puffed", "鼓腮帮子"), ("sulk", "背身闷气"), ("coaxed", "傲娇斜眼"),
        ("tired", "委屈疲惫"), ("oops", "小惊慌"), ("annoyed", "微蹙眉"), ("dizzy", "转圈晕晕")
    ]
    static let gptGalleryItems: [(skin: String, name: String)] = [
        ("default", "日常"),
        ("gpt-expr:smile", "开心微笑"),
        ("gpt-expr:gpt-stroking.png", "按住摸头"),
        ("gpt-expr:gpt-smug.png", "傲娇得意"),
        ("gpt-expr:gpt-tired.png", "低电量委屈"),
        ("gpt-expr:gpt-pout.png", "鼓嘴"),
        ("gpt-expr:gpt-surprised.png", "惊讶"),
        ("gpt-expr:gpt-closed-eyes.png", "闭眼")
    ]
    static let geminiHDGalleryItems: [(skin: String, name: String)] = [
        ("gemini-hd", "日常"),
        ("gemini-hd-expr:smile", "开心微笑"),
        ("gemini-hd-expr:gemini-hd-stroking.png", "按住摸头"),
        ("gemini-hd-expr:gemini-hd-sparkle.png", "星星眼"),
        ("gemini-hd-expr:gemini-hd-flustered.png", "反重力慌张"),
        ("gemini-hd-expr:gemini-hd-pout.png", "鼓嘴"),
        ("gemini-hd-expr:gemini-hd-wink.png", "眨眼"),
        ("gemini-hd-expr:gemini-hd-sleepy.png", "困困")
    ]

    func isClaudia(skin: String) -> Bool {
        self == .claude && (skin == "claudia" || skin.hasPrefix("claudia-expr:"))
    }
    func isGeminiHD(skin: String) -> Bool {
        self == .gemini && (skin == "gemini-hd" || skin.hasPrefix("gemini-hd-expr:"))
    }
    func isLegacyClaudeBust(skin: String) -> Bool {
        self == .claude && (skin == "claude-bust" || skin == "default")
    }

    func completionImageFile(skin: String) -> String {
        switch self {
        case .gpt: "gpt-smile.png"
        case .gemini: isGeminiHD(skin: skin) ? "gemini-hd-smile.png" : "gemini-original-smile.png"
        case .claude: isClaudia(skin: skin) ? "claudia/proud.png" : "claude-smile.png"
        case .deepseek: "deepseek-smile.png"
        }
    }
    func completionImageRelativePath(skin: String) -> String {
        let file = completionImageFile(skin: skin)
        return file.contains("/") ? file : "completion-smiles/" + file
    }

    func pettingImageRelativePath(skin: String) -> String? {
        switch self {
        case .gpt: "click-expressions/gpt-stroking.png"
        case .gemini: isGeminiHD(skin: skin) ? "click-expressions/gemini-hd-stroking.png" : nil
        case .claude: isClaudia(skin: skin) ? "claudia/clawd.png" : nil
        case .deepseek: nil // DS resolves stroking through ds-restored / ds-desktop artworkURL.
        }
    }

    func defaultClickExpressionFile(skin: String) -> String? {
        isGeminiHD(skin: skin) ? "gemini-hd-wink.png" : nil
    }

    var bubbleStickerRelativePath: String {
        "bubble-stickers/sticker-" + rawValue + ".png"
    }

    // Only artwork drawn for this identity and skin may enter its click pool.
    func clickExpressionFiles(skin: String) -> [String] {
        switch self {
        case .gpt:
            return ["gpt-closed-eyes.png", "gpt-pout.png", "gpt-surprised.png", "gpt-smug.png", "gpt-tired.png", "gpt-stroking.png"]
        case .gemini:
            return isGeminiHD(skin: skin)
                ? ["gemini-hd-sleepy.png", "gemini-hd-wink.png", "gemini-hd-pout.png", "gemini-hd-sparkle.png", "gemini-hd-flustered.png", "gemini-hd-stroking.png"]
                : []
        case .claude:
            if isClaudia(skin: skin) {
                return Self.claudiaExpressions
                    .map(\.id)
                    .filter { $0 != "idle" && $0 != "proud" }
                    .map { "claudia/" + $0 + ".png" }
            }
            if isLegacyClaudeBust(skin: skin) {
                return ["claude-thoughtful.png", "claude-closed-eyes.png", "claude-wink.png"]
            }
            return []
        case .deepseek:
            return [] // DS retains its dedicated ten-expression pool.
        }
    }

    func expressionURL(for key: String, resources: URL, data: URL) -> URL {
        let relative = key.contains("/") ? key : "click-expressions/" + key
        let local = data.deletingLastPathComponent().appendingPathComponent("artwork/" + relative)
        if FileManager.default.fileExists(atPath: local.path) { return local }
        return resources.appendingPathComponent(relative)
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
    var defaultSkin: String {
        switch self {
        case .gpt: "default"
        case .gemini: "gemini-hd"
        case .claude: "claudia"
        case .deepseek: "ds-desktop-auto"
        }
    }
    var quotaEnabled: Bool { self != .claude }
    var usageStatsEnabled: Bool { self == .gemini }
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
        if self == .claude {
            if skin == "claudia" {
                let url = expressionURL(for: "claudia/idle.png", resources: resources, data: data)
                if FileManager.default.fileExists(atPath: url.path) { return url }
            } else if skin.hasPrefix("claudia-expr:") {
                let id = String(skin.dropFirst("claudia-expr:".count))
                if Self.claudiaExpressions.contains(where: { $0.id == id }) {
                    let url = expressionURL(for: "claudia/" + id + ".png", resources: resources, data: data)
                    if FileManager.default.fileExists(atPath: url.path) { return url }
                }
            } else if skin == "claude-original" {
                let bundled = resources.appendingPathComponent("claude-original.png")
                if FileManager.default.fileExists(atPath: bundled.path) { return bundled }
            }
        }
        if self == .gpt, skin.hasPrefix("gpt-expr:") {
            let token = String(skin.dropFirst("gpt-expr:".count))
            let relative = token == "smile" ? "completion-smiles/gpt-smile.png" : "click-expressions/" + token
            let url = expressionURL(for: relative, resources: resources, data: data)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        if self == .gemini, skin.hasPrefix("gemini-hd-expr:") {
            let token = String(skin.dropFirst("gemini-hd-expr:".count))
            let relative = token == "smile" ? "completion-smiles/gemini-hd-smile.png" : "click-expressions/" + token
            let url = expressionURL(for: relative, resources: resources, data: data)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        let name = self == .gemini && isGeminiHD(skin: skin) ? "gemini-catgirl-hd.webp" : imageFile
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
