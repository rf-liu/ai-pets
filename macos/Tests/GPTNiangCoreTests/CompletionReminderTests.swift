import XCTest
import GPTNiangCore
final class CompletionReminderTests: XCTestCase {
    func testCoalescingAndLateEventsDoNotReplay() {
        var s = CompletionReminderState(); s.receive(endedAt: 10, now: 10); s.show(.background, now: 11); s.receive(endedAt: 12, now: 12)
        XCTAssertEqual(s.deadline, 16); s.dismiss(now: 13); XCTAssertFalse(s.receive(endedAt: 12, now: 13)); XCTAssertFalse(s.pending)
    }
    func testShownNoticeIsConsumedAndFocusOrBusyPauseCannotReplayIt() {
        var s = CompletionReminderState(); s.receive(endedAt: 1, now: 1); s.show(.foreground, now: 2, openingDelay: 0.52); s.pause()
        XCTAssertFalse(s.pending); XCTAssertFalse(s.show(.background, now: 10)); XCTAssertNil(s.surface)
    }
    func testSurfaceCannotStartWithoutPendingAndDismissClearsIt() {
        var s = CompletionReminderState(); s.show(.background, now: 1); XCTAssertNil(s.surface)
        s.receive(endedAt: 2, now: 2); s.show(.background, now: 3); s.dismiss(now: 4); XCTAssertNil(s.surface); XCTAssertFalse(s.pending)
    }
    func testPendingNoticeExpiresDuringLongBusyPeriodOrSleep() {
        var s = CompletionReminderState(); s.receive(endedAt: 100, now: 101)
        XCTAssertFalse(s.show(.background, now: 116)); XCTAssertFalse(s.pending)
        XCTAssertFalse(s.receive(endedAt: 100, now: 1000))
    }
    func testFutureAndNonfiniteEventsNeverCreatePendingNotices() {
        var s = CompletionReminderState()
        for value in [Double.nan, .infinity, 101] { XCTAssertFalse(s.receive(endedAt: value, now: 100)) }
        XCTAssertFalse(s.pending)
    }
    func testNewerPendingNoticeSurvivesPauseWhileOldShownNoticeIsConsumed() {
        var s = CompletionReminderState(); s.receive(endedAt: 100, now: 100); s.show(.foreground, now: 101)
        s.receive(endedAt: 102, now: 102); s.pause()
        XCTAssertTrue(s.show(.background, now: 103)); XCTAssertFalse(s.pending)
    }
}
