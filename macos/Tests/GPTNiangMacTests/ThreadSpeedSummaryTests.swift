import XCTest
@testable import GPTNiangMac

final class ThreadSpeedSummaryTests: XCTestCase {
    private func rows(_ json: String) throws -> [ThreadSpeedRow] {
        try JSONDecoder().decode([ThreadSpeedRow].self, from: Data(json.utf8))
    }
    func testHistoricalModelsAreIndependentOfTheLatestCardAndUseWeightedTotals() throws {
        let values = try rows(#"""
        [{"id":"a","title":"first","state":"idle","modelName":"latest-model","tokensPerSecond":99,"outputTokens":99,"intervalSeconds":1,
        "recentSamples":[{"modelName":"sol · max","outputTokens":100,"intervalSeconds":10,"sampleCount":2},{"modelName":"astra","outputTokens":300,"intervalSeconds":3,"sampleCount":1}]},
        {"id":"b","title":"second","state":"idle","recentSamples":[{"modelName":"sol · max","outputTokens":200,"intervalSeconds":5,"sampleCount":1}]}]
        """#)
        let groups = ModelSpeedSummary.groups(rows: values)
        XCTAssertEqual(Set(groups.map(\.modelName)), ["sol · max", "astra"])
        let sol = try XCTUnwrap(groups.first { $0.modelName == "sol · max" })
        XCTAssertEqual(sol.summary.tokensPerSecond, 20)
        XCTAssertEqual(sol.summary.count, 2)
        XCTAssertEqual(sol.summary.sampleCount, 3)
        XCTAssertEqual(values[0].tokensPerSecond, 99)
        XCTAssertEqual(values[0].outputTokens, 99)
        XCTAssertEqual(values[0].intervalSeconds, 1)
    }
    func testEmptyOrMissingHistoryDoesNotFallBackToAnOldSingleTurn() throws {
        let values = try rows(#"""
        [{"id":"old","title":"old","state":"idle","tokensPerSecond":200,"outputTokens":200,"intervalSeconds":1,"recentSamples":[]},
        {"id":"legacy","title":"legacy","state":"idle","tokensPerSecond":500,"outputTokens":500,"intervalSeconds":1}]
        """#)
        XCTAssertTrue(ModelSpeedSummary.groups(rows: values).isEmpty)
    }
    func testInvalidHistoryIsRejectedEvenIfTheLatestRateIsValid() throws {
        let values = try rows(#"""
        [{"id":"x","title":"x","state":"idle","tokensPerSecond":10,"recentSamples":[
        {"modelName":"zero","outputTokens":100,"intervalSeconds":0,"sampleCount":1},
        {"modelName":"negative","outputTokens":-1,"intervalSeconds":10,"sampleCount":1},
        {"modelName":"missing","outputTokens":100,"intervalSeconds":10,"sampleCount":0}]}]
        """#)
        XCTAssertTrue(ModelSpeedSummary.groups(rows: values).isEmpty)
    }
}
