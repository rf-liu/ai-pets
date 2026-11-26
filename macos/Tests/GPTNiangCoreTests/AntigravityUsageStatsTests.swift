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
}
