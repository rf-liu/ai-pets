import XCTest
import AppKit
@testable import GPTNiangMac

final class WorkspaceSnapshotTests: XCTestCase {
    @MainActor func testRepeatedFrameReadsDoNotQueryWorkspaceOrScreensAgain() {
        var frontReads = 0, runningReads = 0, screenReads = 0
        let cache = WorkspaceSnapshot(observe: false,
            frontmost: { frontReads += 1; return .current },
            running: { runningReads += 1; return [.current] },
            screens: { screenReads += 1; return [] })
        for _ in 0..<1800 {
            XCTAssertEqual(cache.frontmost?.processIdentifier, getpid())
            XCTAssertTrue(cache.screens.isEmpty)
            XCTAssertNil(cache.application(bundleID: "missing.fixture"))
        }
        XCTAssertEqual(frontReads, 1); XCTAssertEqual(runningReads, 1); XCTAssertEqual(screenReads, 1)
    }
    @MainActor func testNotificationRefreshReplacesOldForegroundState() {
        var active = true
        let cache = WorkspaceSnapshot(observe: false, frontmost: { active ? .current : nil }, running: { [] }, screens: { [] })
        XCTAssertNotNil(cache.frontmost); active = false; cache.refresh(); XCTAssertNil(cache.frontmost)
    }
}
