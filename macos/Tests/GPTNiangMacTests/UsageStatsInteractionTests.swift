import XCTest
import Foundation
import GPTNiangCore
@testable import GPTNiangMac

final class UsageStatsInteractionTests: XCTestCase {
    @MainActor func testGeminiCyclesQuotaUsageQuoteWhileGptRemainsTwoState() async throws {
        let data = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: data) }

        // When quota is unavailable, Gemini opens Usage directly on first click and advances to Quote on second click.
        let geminiUnavailable = WidgetModel(dataDirectory: data, resources: data, profile: .gemini)
        XCTAssertFalse(geminiUnavailable.bubble)
        geminiUnavailable.characterClick()
        XCTAssertTrue(geminiUnavailable.bubble); XCTAssertEqual(geminiUnavailable.bubbleScene, .usage); XCTAssertNil(geminiUnavailable.message)
        geminiUnavailable.characterClick()
        XCTAssertTrue(geminiUnavailable.bubble); XCTAssertEqual(geminiUnavailable.bubbleScene, .quote); XCTAssertNotNil(geminiUnavailable.message)
        geminiUnavailable.showQuota()
        XCTAssertEqual(geminiUnavailable.bubbleScene, .quota)

        // When quota is available, Gemini cycles Quota -> Usage -> Quote.
        let gemini = WidgetModel(dataDirectory: data, resources: data, profile: .gemini)
        gemini.snapshot = UsageSnapshot(ok: true, queryOk: true, observedAt: Date().timeIntervalSince1970 * 1000, windows: [QuotaWindow(minutes: 300, remaining: 80)])
        XCTAssertFalse(gemini.bubble)
        gemini.characterClick()
        XCTAssertTrue(gemini.bubble); XCTAssertEqual(gemini.bubbleScene, .quota); XCTAssertNil(gemini.message)
        gemini.characterClick()
        XCTAssertTrue(gemini.bubble); XCTAssertEqual(gemini.bubbleScene, .usage); XCTAssertNil(gemini.message)
        gemini.characterClick()
        XCTAssertTrue(gemini.bubble); XCTAssertEqual(gemini.bubbleScene, .quote); XCTAssertNotNil(gemini.message)
        gemini.characterClick()
        XCTAssertTrue(gemini.bubble); XCTAssertEqual(gemini.bubbleScene, .quote); XCTAssertNotNil(gemini.message)
        gemini.hideBubble()
        gemini.characterClick()
        XCTAssertTrue(gemini.bubble); XCTAssertEqual(gemini.bubbleScene, .quota); XCTAssertNil(gemini.message)

        let gpt = WidgetModel(dataDirectory: data, resources: data, profile: .gpt)
        gpt.characterClick()
        XCTAssertEqual(gpt.bubbleScene, .quota)
        gpt.characterClick()
        XCTAssertEqual(gpt.bubbleScene, .quote)
    }

    @MainActor func testGeminiLoadsCachedUsageStatsAndReceivesPipeUpdates() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let cached = """
        {"version":1,"updatedAt":1795252500000,"todayDate":"2026-11-21","disclaimer":"test","pricingUpdatedAt":1795248000000,"pricingSource":"litellm","pricingStale":false,"today":{"totalTokens":5000,"inputTokens":4000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":1000,"responseOutputTokens":1000,"thinkingOutputTokens":0,"calls":2,"estimatedCostUsd":0.02,"hasUnknownPrice":false,"topModels":[],"models":[]},"last7Days":{"totalTokens":5000,"inputTokens":4000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":1000,"responseOutputTokens":1000,"thinkingOutputTokens":0,"calls":2,"estimatedCostUsd":0.02,"hasUnknownPrice":false,"topModels":[],"models":[]}}
        """
        try Data(cached.utf8).write(to: root.appendingPathComponent("usage-stats.json"))
        let model = WidgetModel(dataDirectory: root, resources: root, profile: .gemini)
        XCTAssertEqual(model.usageStats?.today.totalTokens, 5000)
        XCTAssertEqual(model.usageStats?.today.costText, "$0.02")
    }
}
