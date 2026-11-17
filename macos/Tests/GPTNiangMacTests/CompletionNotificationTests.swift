import XCTest
import AppKit
import GPTNiangCore
@testable import GPTNiangMac

final class CompletionNotificationTests: XCTestCase {
    @MainActor private func withController(_ body: (WidgetModel, CompletionNotificationController) -> Void) {
        _ = NSApplication.shared
        let data = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let model = WidgetModel(dataDirectory: data, resources: data); model.completionEnabled = true
        let panel = NSPanel(contentRect: CGRect(x: 100, y: 100, width: 378, height: 378), styleMask: [.borderless], backing: .buffered, defer: false)
        panel.isReleasedWhenClosed = false
        let controller = CompletionNotificationController(model: model, panel: panel, openDestination: { _ in })
        defer { controller.stop(); panel.close(); model.stop(); try? FileManager.default.removeItem(at: data) }
        body(model, controller)
    }
    @MainActor func testDelayedNoticeExpiresWhileSettingsOrAnotherInteractionIsBusy() {
        withController { model, controller in
            let now = floor(Date().timeIntervalSince1970)
            controller.receiveCompletion(conversationID: nil, endedAt: now * 1000, sessionID: "a", turnID: "1", now: now)
            controller.tick(codexFrontmost: false, busy: true, now: now)
            controller.tick(codexFrontmost: false, busy: false, now: now + 20)
            XCTAssertFalse(model.isCompletionMessage)
        }
    }
    @MainActor func testShownNoticeDoesNotReappearAfterBusyPauseAndDuplicatePipeEvents() {
        withController { model, controller in
            let now = floor(Date().timeIntervalSince1970)
            controller.receiveCompletion(conversationID: nil, endedAt: now * 1000, sessionID: "a", turnID: "1", now: now)
            controller.tick(codexFrontmost: false, busy: false, now: now); XCTAssertTrue(model.isCompletionMessage)
            controller.tick(codexFrontmost: false, busy: true, now: now + 1); XCTAssertFalse(model.isCompletionMessage)
            controller.receiveCompletion(conversationID: nil, endedAt: now * 1000, sessionID: "a", turnID: "1", now: now + 2)
            controller.tick(codexFrontmost: false, busy: false, now: now + 2); XCTAssertFalse(model.isCompletionMessage)
        }
    }
    @MainActor func testResumedSessionWithdrawsItsOwnNoticeWithoutDiscardingAnotherConversation() {
        withController { model, controller in
            let now = floor(Date().timeIntervalSince1970)
            controller.receiveCompletion(conversationID: nil, title: "first", endedAt: now * 1000, sessionID: "a", turnID: "1", now: now)
            controller.tick(codexFrontmost: false, busy: false, now: now)
            controller.receiveCompletion(conversationID: nil, title: "second", endedAt: (now + 1) * 1000, sessionID: "b", turnID: "1", now: now + 1)
            controller.resumed(sessionID: "a", now: now + 1)
            XCTAssertFalse(model.isCompletionMessage)
            controller.tick(codexFrontmost: false, busy: false, now: now + 2)
            XCTAssertTrue(model.isCompletionMessage); XCTAssertEqual(model.completionConversationTitle, "second")
        }
    }
    @MainActor func testWithdrawalPreservesMouseCaptureUntilInteractionEnds() {
        withController { model, controller in
            let now = floor(Date().timeIntervalSince1970)
            controller.receiveCompletion(conversationID: nil, endedAt: now * 1000, sessionID: "a", turnID: "1", now: now)
            controller.tick(codexFrontmost: false, busy: false, now: now)
            model.interactionActive = true; controller.resumed(sessionID: "a", now: now + 1)
            XCTAssertTrue(model.isCompletionMessage)
            model.interactionActive = false; controller.tick(codexFrontmost: false, busy: false, now: now + 2)
            XCTAssertFalse(model.isCompletionMessage)
        }
    }
    @MainActor func testDefaultsAndNotificationPreferencesPreserveExistingValues() throws {
        let data = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: data) }
        try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
        let file = data.appendingPathComponent("preferences.json")
        try Data(#"{"scale":0.6,"volume":0.37,"x":0.25,"followCodex":true,"futureSetting":"keep"}"#.utf8).write(to: file)
        let model = WidgetModel(dataDirectory: data, resources: data)
        XCTAssertFalse(model.completionEnabled)
        model.completionEnabled = true; model.savePreferences()
        let restored = WidgetModel(dataDirectory: data, resources: data)
        XCTAssertTrue(restored.completionEnabled)
        XCTAssertEqual(restored.scale, 0.6); XCTAssertEqual(restored.volume, 0.37); XCTAssertEqual(restored.x, 0.25)
        let values = try JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any]
        XCTAssertEqual(values?["futureSetting"] as? String, "keep")
    }
    @MainActor func testCompletionUsesFixedTwoLinesWithoutQuotaRefreshAndManualTakeoverClearsItsMode() {
        let data = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: data) }
        let model = WidgetModel(dataDirectory: data, resources: data)
        model.showCompletion()
        XCTAssertTrue(model.bubble); XCTAssertTrue(model.isCompletionMessage)
        XCTAssertEqual(model.message?.components(separatedBy: "\n").count, 2)
        XCTAssertFalse(FileManager.default.fileExists(atPath: data.appendingPathComponent("refresh.flag").path))
        model.showQuota(); XCTAssertFalse(model.isCompletionMessage); XCTAssertNil(model.message)
        model.showCompletion(); model.hideBubble(); XCTAssertFalse(model.bubble); XCTAssertFalse(model.isCompletionMessage)
    }
}
