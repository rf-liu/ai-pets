import Foundation

struct ThreadSpeedRow: Decodable, Identifiable {
    let id: String
    let title: String
    let tokensPerSecond: Double?
    let sampleAt: Double?
    let state: String
    let outputTokens: Int?
    let intervalSeconds: Double?
    let measurement: String?
    let modelName: String?
    let timeToFirstTokenSeconds: Double?
    let streamingSeconds: Double?
    let unavailableReason: String?
    let reasoningOutputTokens: Int?
    let thinkingOutputTokens: Int?
    let responseOutputTokens: Int?
    let estimatedCost: Double?
    let recentSamples: [RecentModelSpeedSample]?
    let recentPartial: Bool?
}

struct RecentModelSpeedSample: Decodable {
    let modelName: String
    let outputTokens: Int
    let intervalSeconds: Double
    let sampleCount: Int
    var valid: Bool { outputTokens >= 0 && intervalSeconds.isFinite && intervalSeconds > 0 && sampleCount > 0 }
}

struct RecentSpeedSummary {
    let count: Int
    let sampleCount: Int
    let outputTokens: Double
    let seconds: Double
    var tokensPerSecond: Double? { count > 0 && seconds > 0 ? outputTokens / seconds : nil }
    init(samples: [RecentModelSpeedSample], conversationCount: Int) {
        let valid = samples.filter(\.valid)
        count = conversationCount
        sampleCount = valid.reduce(0) { $0 + $1.sampleCount }
        outputTokens = valid.reduce(0) { $0 + Double($1.outputTokens) }
        seconds = valid.reduce(0) { $0 + $1.intervalSeconds }
    }
}

struct ModelSpeedSummary: Identifiable {
    let modelName: String
    let summary: RecentSpeedSummary
    var id: String { modelName }

    static func groups(rows: [ThreadSpeedRow]) -> [ModelSpeedSummary] {
        var grouped: [String: [(String, RecentModelSpeedSample)]] = [:]
        for row in rows {
            for sample in row.recentSamples ?? [] where sample.valid {
                let name = sample.modelName.trimmingCharacters(in: .whitespacesAndNewlines)
                grouped[name.isEmpty ? "未識別模型" : name, default: []].append((row.id, sample))
            }
        }
        return grouped.compactMap { name, samples in
            let summary = RecentSpeedSummary(samples: samples.map(\.1), conversationCount: Set(samples.map(\.0)).count)
            return summary.count > 0 ? ModelSpeedSummary(modelName: name, summary: summary) : nil
        }.sorted { $0.modelName.localizedStandardCompare($1.modelName) == .orderedAscending }
    }
}
