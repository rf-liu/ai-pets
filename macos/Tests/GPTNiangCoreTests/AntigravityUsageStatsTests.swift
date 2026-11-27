import XCTest
import Foundation
import GPTNiangCore

final class AntigravityUsageStatsTests: XCTestCase {
    func testDecodesUsageStatsAndFormatsKnownAndUnknownPricing() throws {
        let json = """
        {
          "version": 1,
          "updatedAt": 1795252500000,
          "todayDate": "2026-11-21",
          "disclaimer": "Antigravity 为订阅制，金额按官方 API 公开单价折算，非实际扣费。",
          "pricingUpdatedAt": 1795248000000,
          "pricingSource": "litellm",
          "pricingStale": false,
          "today": {
            "totalTokens": 364746306,
            "inputTokens": 143097456,
            "cacheReadTokens": 217878545,
            "cacheWriteTokens": 0,
            "outputTokens": 3770305,
            "responseOutputTokens": 1972685,
            "thinkingOutputTokens": 1797620,
            "calls": 1441,
            "estimatedCostUsd": 517.058,
            "hasUnknownPrice": true,
            "topModels": [
              {
                "modelId": "gemini-4-neon",
                "displayName": "Gemini 4 Neon",
                "totalTokens": 362505376,
                "inputTokens": 142588017,
                "cacheReadTokens": 216224666,
                "cacheWriteTokens": 0,
                "outputTokens": 3692693,
                "responseOutputTokens": 1933484,
                "thinkingOutputTokens": 1759209,
                "calls": 1367,
                "priceKnown": true,
                "estimatedCostUsd": 517.058
              },
              {
                "modelId": "gemini-9-unknown",
                "displayName": "Gemini 9 Unknown",
                "totalTokens": 2240930,
                "inputTokens": 509439,
                "cacheReadTokens": 1653879,
                "cacheWriteTokens": 0,
                "outputTokens": 77612,
                "responseOutputTokens": 39201,
                "thinkingOutputTokens": 38411,
                "calls": 74,
                "priceKnown": false,
                "estimatedCostUsd": null
              }
            ],
            "models": []
          },
          "last7Days": {
            "totalTokens": 1187254651,
            "inputTokens": 200000000,
            "cacheReadTokens": 980000000,
            "cacheWriteTokens": 0,
            "outputTokens": 7254651,
            "responseOutputTokens": 4000000,
            "thinkingOutputTokens": 3254651,
            "calls": 8200,
            "estimatedCostUsd": null,
            "hasUnknownPrice": true,
            "topModels": [],
            "models": []
          }
        }
        """
        let stats = try JSONDecoder().decode(AntigravityUsageStats.self, from: Data(json.utf8))
        XCTAssertEqual(stats.today.costText, "$517.06+")
        XCTAssertEqual(stats.today.topModels[0].costText, "$517.06")
        XCTAssertEqual(stats.today.topModels[1].costText, "价格未知")
        XCTAssertEqual(stats.last7Days.costText, "价格未知")
        XCTAssertNil(stats.last3Days)
        XCTAssertNil(stats.last30Days)
        XCTAssertEqual(stats.period(days: 1), stats.today)
        XCTAssertEqual(stats.period(days: 7), stats.last7Days)
        XCTAssertNil(stats.period(days: 3))
        XCTAssertNil(stats.period(days: 30))
        XCTAssertEqual(AntigravityUsageFormat.tokens(0), "0")
        XCTAssertEqual(AntigravityUsageFormat.tokens(4850), "4,850")
        XCTAssertEqual(AntigravityUsageFormat.tokens(485200), "485.2K")
        XCTAssertEqual(AntigravityUsageFormat.tokens(12450000), "12.45M")
        XCTAssertEqual(AntigravityUsageFormat.tokens(364746306), "364.7M")
        XCTAssertEqual(AntigravityUsageFormat.tokens(1187254651), "1.19B")
        XCTAssertEqual(AntigravityUsageFormat.cost(usd: 0.002, priceKnown: true), "<$0.01")
        XCTAssertEqual(AntigravityUsageFormat.cost(usd: 0, priceKnown: true), "$0.00")
        XCTAssertEqual(AntigravityUsageFormat.cost(usd: nil, priceKnown: false), "价格未知")
    }

    func testDecodesThreeDayAndThirtyDayPeriods() throws {
        let json = """
        {
          "version": 2,
          "updatedAt": 1795252500000,
          "todayDate": "2026-11-27",
          "disclaimer": "test",
          "today": {"totalTokens": 100, "inputTokens": 80, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 20, "responseOutputTokens": 20, "thinkingOutputTokens": 0, "calls": 1, "estimatedCostUsd": 0.05, "hasUnknownPrice": false, "topModels": [], "models": []},
          "last3Days": {"totalTokens": 300, "inputTokens": 240, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 60, "responseOutputTokens": 60, "thinkingOutputTokens": 0, "calls": 3, "estimatedCostUsd": 0.15, "hasUnknownPrice": false, "topModels": [], "models": []},
          "last7Days": {"totalTokens": 700, "inputTokens": 560, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 140, "responseOutputTokens": 140, "thinkingOutputTokens": 0, "calls": 7, "estimatedCostUsd": 0.35, "hasUnknownPrice": false, "topModels": [], "models": []},
          "last30Days": {"totalTokens": 3000, "inputTokens": 2400, "cacheReadTokens": 0, "cacheWriteTokens": 0, "outputTokens": 600, "responseOutputTokens": 600, "thinkingOutputTokens": 0, "calls": 30, "estimatedCostUsd": 1.50, "hasUnknownPrice": false, "topModels": [], "models": []}
        }
        """
        let stats = try JSONDecoder().decode(AntigravityUsageStats.self, from: Data(json.utf8))
        XCTAssertEqual(stats.period(days: 1)?.totalTokens, 100)
        XCTAssertEqual(stats.period(days: 3)?.totalTokens, 300)
        XCTAssertEqual(stats.period(days: 7)?.totalTokens, 700)
        XCTAssertEqual(stats.period(days: 30)?.totalTokens, 3000)
        XCTAssertEqual(stats.last3Days?.costText, "$0.15")
        XCTAssertEqual(stats.last30Days?.costText, "$1.50")
    }
}
