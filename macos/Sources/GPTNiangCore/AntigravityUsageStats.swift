import Foundation

public struct AntigravityModelUsage: Decodable, Equatable, Identifiable {
    public let modelId: String
    public let displayName: String
    public let totalTokens: Int
    public let inputTokens: Int
    public let cacheReadTokens: Int
    public let cacheWriteTokens: Int
    public let outputTokens: Int
    public let responseOutputTokens: Int
    public let thinkingOutputTokens: Int
    public let calls: Int
    public let priceKnown: Bool
    public let estimatedCostUsd: Double?

    public var id: String { modelId }

    public init(
        modelId: String,
        displayName: String,
        totalTokens: Int,
        inputTokens: Int,
        cacheReadTokens: Int = 0,
        cacheWriteTokens: Int = 0,
        outputTokens: Int,
        responseOutputTokens: Int = 0,
        thinkingOutputTokens: Int = 0,
        calls: Int,
        priceKnown: Bool,
        estimatedCostUsd: Double?
    ) {
        self.modelId = modelId
        self.displayName = displayName
        self.totalTokens = totalTokens
        self.inputTokens = inputTokens
        self.cacheReadTokens = cacheReadTokens
        self.cacheWriteTokens = cacheWriteTokens
        self.outputTokens = outputTokens
        self.responseOutputTokens = responseOutputTokens
        self.thinkingOutputTokens = thinkingOutputTokens
        self.calls = calls
        self.priceKnown = priceKnown
        self.estimatedCostUsd = estimatedCostUsd
    }

    public var costText: String {
        AntigravityUsageFormat.cost(usd: estimatedCostUsd, priceKnown: priceKnown, hasUnknownPrice: false)
    }
}

public struct AntigravityUsagePeriod: Decodable, Equatable {
    public let totalTokens: Int
    public let inputTokens: Int
    public let cacheReadTokens: Int
    public let cacheWriteTokens: Int
    public let outputTokens: Int
    public let responseOutputTokens: Int
    public let thinkingOutputTokens: Int
    public let calls: Int
    public let estimatedCostUsd: Double?
    public let hasUnknownPrice: Bool
    public let topModels: [AntigravityModelUsage]
    public let models: [AntigravityModelUsage]

    public init(
        totalTokens: Int = 0,
        inputTokens: Int = 0,
        cacheReadTokens: Int = 0,
        cacheWriteTokens: Int = 0,
        outputTokens: Int = 0,
        responseOutputTokens: Int = 0,
        thinkingOutputTokens: Int = 0,
        calls: Int = 0,
        estimatedCostUsd: Double? = 0,
        hasUnknownPrice: Bool = false,
        topModels: [AntigravityModelUsage] = [],
        models: [AntigravityModelUsage] = []
    ) {
        self.totalTokens = totalTokens
        self.inputTokens = inputTokens
        self.cacheReadTokens = cacheReadTokens
        self.cacheWriteTokens = cacheWriteTokens
        self.outputTokens = outputTokens
        self.responseOutputTokens = responseOutputTokens
        self.thinkingOutputTokens = thinkingOutputTokens
        self.calls = calls
        self.estimatedCostUsd = estimatedCostUsd
        self.hasUnknownPrice = hasUnknownPrice
        self.topModels = topModels
        self.models = models
    }

    public var costText: String {
        if totalTokens == 0 { return "$0.00" }
        guard let usd = estimatedCostUsd, usd.isFinite else { return "价格未知" }
        return AntigravityUsageFormat.cost(usd: usd, priceKnown: true, hasUnknownPrice: hasUnknownPrice)
    }
}

public struct AntigravityUsageScanInfo: Decodable, Equatable {
    public let rpcConversationsScanned: Int
    public let dbFilesOpened: Int
    public let dbFilesSkipped: Int
    public let desktopRpcAvailable: Bool
}

public struct AntigravityUsageStats: Decodable, Equatable {
    public let version: Int
    public let updatedAt: Double
    public let todayDate: String
    public let disclaimer: String
    public let pricingUpdatedAt: Double?
    public let pricingSource: String?
    public let pricingStale: Bool?
    public let today: AntigravityUsagePeriod
    public let last3Days: AntigravityUsagePeriod?
    public let last7Days: AntigravityUsagePeriod
    public let last30Days: AntigravityUsagePeriod?
    public let scan: AntigravityUsageScanInfo?

    public func period(days: Int) -> AntigravityUsagePeriod? {
        switch days {
        case 1: return today
        case 3: return last3Days
        case 7: return last7Days
        case 30: return last30Days
        default: return nil
        }
    }

    public func updatedTimeText(timeZone: TimeZone = .current) -> String {
        AntigravityUsageFormat.timeHHmm(updatedAt, timeZone: timeZone)
    }

    public func pricingUpdatedText(timeZone: TimeZone = .current) -> String? {
        guard let pricingUpdatedAt, pricingUpdatedAt.isFinite else { return nil }
        return AntigravityUsageFormat.dateTimeMMddHHmm(pricingUpdatedAt, timeZone: timeZone)
    }
}

public enum AntigravityUsageFormat {
    public static func tokens(_ count: Int) -> String {
        let value = max(0, count)
        let locale = Locale(identifier: "en_US_POSIX")
        if value >= 1_000_000_000 {
            return String(format: "%.2fB", locale: locale, Double(value) / 1_000_000_000)
        }
        if value >= 100_000_000 {
            return String(format: "%.1fM", locale: locale, Double(value) / 1_000_000)
        }
        if value >= 1_000_000 {
            return String(format: "%.2fM", locale: locale, Double(value) / 1_000_000)
        }
        if value >= 10_000 {
            return String(format: "%.1fK", locale: locale, Double(value) / 1_000)
        }
        if value >= 1_000 {
            let formatter = NumberFormatter()
            formatter.locale = Locale(identifier: "en_US")
            formatter.numberStyle = .decimal
            formatter.usesGroupingSeparator = true
            formatter.groupingSeparator = ","
            return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
        }
        return "\(value)"
    }

    public static func cost(usd: Double?, priceKnown: Bool, hasUnknownPrice: Bool = false) -> String {
        guard priceKnown, let usd, usd.isFinite, usd >= 0 else { return "价格未知" }
        let suffix = hasUnknownPrice ? "+" : ""
        if usd == 0 { return "$0.00" + suffix }
        if usd < 0.01 { return "<$0.01" + suffix }
        let locale = Locale(identifier: "en_US_POSIX")
        return String(format: "$%.2f", locale: locale, usd) + suffix
    }

    public static func timeHHmm(_ epochMs: Double?, timeZone: TimeZone = .current) -> String {
        guard let epochMs, epochMs.isFinite, epochMs > 0 else { return "--:--" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: epochMs / 1000))
    }

    public static func dateTimeMMddHHmm(_ epochMs: Double?, timeZone: TimeZone = .current) -> String {
        guard let epochMs, epochMs.isFinite, epochMs > 0 else { return "--" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "MM-dd HH:mm"
        return formatter.string(from: Date(timeIntervalSince1970: epochMs / 1000))
    }
}
