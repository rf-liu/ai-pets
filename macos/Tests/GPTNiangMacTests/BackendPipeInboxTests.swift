import XCTest
@testable import GPTNiangMac

final class BackendPipeInboxTests: XCTestCase {
    func testSplitFramesAndUnicodeStayInMemory() {
        let inbox = BackendPipeInbox(), token = inbox.reset()
        let bytes = Data("{\"text\":\"猫娘\"}\n{\"type\":\"health\"}\n".utf8)
        for byte in bytes { inbox.append(Data([byte]), token: token) }
        XCTAssertEqual(inbox.drain().map { String(decoding: $0, as: UTF8.self) }, ["{\"text\":\"猫娘\"}", "{\"type\":\"health\"}"])
        XCTAssertTrue(inbox.drain().isEmpty)
    }
    func testPreviousWorkerCallbacksCannotReplayAfterReset() {
        let inbox = BackendPipeInbox(), old = inbox.reset()
        inbox.append(Data("old".utf8), token: old)
        let next = inbox.reset()
        inbox.append(Data("stale\n".utf8), token: old)
        inbox.append(Data("new\n".utf8), token: next)
        XCTAssertEqual(inbox.drain(), [Data("new".utf8)])
    }
    func testOversizeFrameRecoversAtNextLineAndQueueIsBounded() {
        let inbox = BackendPipeInbox(), token = inbox.reset()
        inbox.append(Data(repeating: 65, count: 512 * 1024 + 1), token: token)
        inbox.append(Data("\nok\n".utf8), token: token)
        XCTAssertEqual(inbox.drain(), [Data("ok".utf8)])
        for i in 0..<100 { inbox.append(Data("\(i)\n".utf8), token: token) }
        let values = inbox.drain(); XCTAssertEqual(values.count, 64)
        XCTAssertEqual(String(decoding: values[0], as: UTF8.self), "36")
    }
}
