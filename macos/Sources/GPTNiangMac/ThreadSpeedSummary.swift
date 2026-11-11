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
}

struct RecentSpeedSummary {
    let count: Int
    let outputTokens: Double
    let seconds: Double
    var tokensPerSecond: Double? { count > 0 && seconds > 0 ? outputTokens / seconds : nil }
    init(rows: [ThreadSpeedRow]) {
        let valid = rows.filter {
            guard let tokens = $0.outputTokens, let seconds = $0.intervalSeconds,
                  let rate = $0.tokensPerSecond else { return false }
            return tokens >= 0 && seconds.isFinite && seconds > 0 && rate.isFinite && rate >= 0
        }
        count = valid.count
        outputTokens = valid.reduce(0) { $0 + Double($1.outputTokens!) }
        seconds = valid.reduce(0) { $0 + $1.intervalSeconds! }
    }
}

struct ModelSpeedSummary: Identifiable {
    let modelName: String
    let summary: RecentSpeedSummary
    var id: String { modelName }

    static func groups(rows: [ThreadSpeedRow]) -> [ModelSpeedSummary] {
        let grouped = Dictionary(grouping: rows) { row in
            let name = row.modelName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return name.isEmpty ? "未識別模型" : name
        }
        return grouped.compactMap { name, rows in
            let summary = RecentSpeedSummary(rows: rows)
            return summary.count > 0 ? ModelSpeedSummary(modelName: name, summary: summary) : nil
        }.sorted { $0.modelName.localizedStandardCompare($1.modelName) == .orderedAscending }
    }
}
