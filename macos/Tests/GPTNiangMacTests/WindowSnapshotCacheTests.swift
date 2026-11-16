import XCTest
import AppKit
@testable import GPTNiangMac

final class WindowSnapshotCacheTests: XCTestCase {
    @MainActor func testThreeStationaryPetsShareDiscoveryAndOnlyForegroundGetsLiveGeometry() {
        var calls = 0
        let windows: [[String: Any]] = (1...3).map { [kCGWindowNumber as String: $0] }
        let cache = WindowSnapshotCache { _, _ in calls += 1; return windows }
        for tick in 0..<600 {
            let now = Double(tick) / 60
            for id in 1...3 {
                if tick % 15 == 0 { _ = cache.full(now: now) }
                else { _ = cache.window(id, now: now, foreground: id == 1, dragging: false) }
            }
        }
        XCTAssertLessThan(calls, 260, "Three 60 Hz followers previously required about 1800 WindowServer queries in this interval")
        XCTAssertGreaterThan(calls, 100)
    }
    @MainActor func testDraggingKeepsEveryFrameFreshAndForegroundEventsRefreshDiscovery() {
        var calls = 0
        let cache = WindowSnapshotCache { _, number in calls += 1; return [[kCGWindowNumber as String: Int(number), "revision": calls]] }
        for tick in 0..<60 {
            let values = cache.window(8, now: Double(tick) / 60, foreground: true, dragging: true)
            XCTAssertEqual(values?.first?["revision"] as? Int, tick + 1)
        }
        XCTAssertEqual(calls, 60)
        _ = cache.full(now: 2, force: true); _ = cache.full(now: 2, force: true)
        XCTAssertEqual(calls, 61, "The same activation event is coalesced across pets")
        _ = cache.full(now: 2.02, force: true); XCTAssertEqual(calls, 62)
    }
    @MainActor func testMissingWindowAndClockResetNeverKeepAStaleHost() {
        var available = true
        let cache = WindowSnapshotCache { _, _ in available ? [[kCGWindowNumber as String: 1]] : [] }
        XCTAssertNotNil(cache.window(1, now: 10, foreground: true, dragging: false))
        available = false
        XCTAssertNil(cache.window(1, now: 9, foreground: true, dragging: false))
    }
}
