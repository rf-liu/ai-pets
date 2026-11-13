import AppKit
#if WINDOW_LIFECYCLE_STANDALONE
class XCTestCase {}
@MainActor private var assertionCount = 0
@MainActor private func XCTAssertTrue(_ value: Bool, file: StaticString = #filePath, line: UInt = #line) {
    assertionCount += 1
    if !value { fatalError("Window lifecycle assertion failed at \(file):\(line)") }
}
@MainActor private func XCTAssertFalse(_ value: Bool, file: StaticString = #filePath, line: UInt = #line) { XCTAssertTrue(!value, file: file, line: line) }
@MainActor private func XCTAssertEqual<T: Equatable>(_ actual: T, _ expected: T, file: StaticString = #filePath, line: UInt = #line) { XCTAssertTrue(actual == expected, file: file, line: line) }
#else
import XCTest
@testable import GPTNiangMac
#endif

final class UtilityWindowCoordinatorTests: XCTestCase {
    @MainActor private final class Recorder {
        var policies: [NSApplication.ActivationPolicy] = []
        var jobs: [@MainActor () -> Void] = []
        var activations = 0
        func drain() { let pending = jobs; jobs.removeAll(); pending.forEach { $0() } }
    }
    @MainActor private func fixture() -> (UtilityWindowCoordinator, Recorder) {
        _ = NSApplication.shared
        let record = Recorder()
        return (UtilityWindowCoordinator(applyPolicy: { record.policies.append($0) },
            activate: { record.activations += 1 }, schedule: { record.jobs.append($0) }), record)
    }
    @MainActor private func window() -> NSWindow {
        let window = NSWindow(contentRect: CGRect(x: 100, y: 100, width: 240, height: 120),
            styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        return window
    }
    @MainActor func testRedCloseRemovesDockPolicyAndStopsTheSpeedHelperOnce() {
        let (coordinator, record) = fixture(), tool = window()
        var stopped = 0
        coordinator.present(tool, onDismiss: { stopped += 1 })
        XCTAssertEqual(record.policies.last, .regular)
        tool.performClose(nil)
        XCTAssertEqual(stopped, 1)
        XCTAssertTrue(coordinator.isDismissing)
        record.drain()
        XCTAssertEqual(record.policies.last, .accessory)
        XCTAssertEqual(coordinator.visibleCount, 0)
        XCTAssertFalse(tool.isVisible)
    }
    @MainActor func testSwitchingSettingsToSpeedLeavesNoHiddenMainPageKeepingTheDock() {
        let (coordinator, record) = fixture(), settings = window(), speed = window()
        coordinator.present(settings)
        coordinator.hide(settings)
        coordinator.present(speed)
        record.drain()
        XCTAssertFalse(settings.isVisible)
        XCTAssertEqual(coordinator.visibleCount, 1)
        XCTAssertEqual(record.policies.last, .regular)
        speed.performClose(nil); record.drain()
        XCTAssertEqual(record.policies.last, .accessory)
    }
    @MainActor func testAnotherExplicitlyVisibleToolKeepsTheDockUntilItCloses() {
        let (coordinator, record) = fixture(), first = window(), second = window()
        coordinator.present(first); coordinator.present(second)
        second.performClose(nil); record.drain()
        XCTAssertEqual(record.policies.last, .regular)
        first.performClose(nil); record.drain()
        XCTAssertEqual(record.policies.last, .accessory)
    }
    @MainActor func testNewWindowBeforeDeferredCloseIsNotHiddenByAStaleUpdate() {
        let (coordinator, record) = fixture(), first = window(), next = window()
        coordinator.present(first); first.performClose(nil)
        coordinator.present(next); record.drain()
        XCTAssertEqual(record.policies.last, .regular)
        XCTAssertTrue(next.isVisible)
        next.close(); record.drain()
    }
    @MainActor func testWindowDelegateReplacementCannotLoseTheCloseNotification() {
        final class OtherDelegate: NSObject, NSWindowDelegate {}
        let (coordinator, record) = fixture(), tool = window(), delegate = OtherDelegate()
        coordinator.present(tool); tool.delegate = delegate
        tool.performClose(nil); record.drain()
        XCTAssertEqual(record.policies.last, .accessory)
    }
    @MainActor func testPetPanelDoesNotKeepTheDockOrGetHiddenWhenToolCloses() {
        let (coordinator, record) = fixture(), tool = window()
        let pet = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 100, height: 100),
            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        pet.isReleasedWhenClosed = false; pet.orderFront(nil)
        coordinator.present(tool); tool.performClose(nil); record.drain()
        XCTAssertEqual(record.policies.last, .accessory)
        XCTAssertTrue(pet.isVisible)
        pet.close()
    }
    @MainActor func testReopenFocusesExistingToolWithoutAnotherActivationOrMainPage() {
        let (coordinator, record) = fixture(), tool = window()
        coordinator.present(tool)
        XCTAssertTrue(coordinator.focusExistingWindow())
        XCTAssertEqual(record.activations, 1)
        XCTAssertEqual(coordinator.visibleCount, 1)
        tool.close(); record.drain()
        XCTAssertFalse(coordinator.focusExistingWindow())
    }
    @MainActor func testHideAndRepeatedCloseDismissOnlyOncePerPresentation() {
        let (coordinator, record) = fixture(), tool = window()
        var count = 0
        coordinator.present(tool, onDismiss: { count += 1 })
        coordinator.hide(tool); tool.close(); record.drain()
        XCTAssertEqual(count, 1)
        coordinator.present(tool, onDismiss: { count += 1 })
        tool.performClose(nil); record.drain()
        XCTAssertEqual(count, 2)
    }
}

#if WINDOW_LIFECYCLE_STANDALONE
@main private struct WindowLifecycleChecks {
    @MainActor static func main() async throws {
        _ = NSApplication.shared; _ = NSApp.setActivationPolicy(.accessory); NSApp.finishLaunching()
        let tests = UtilityWindowCoordinatorTests()
        tests.testRedCloseRemovesDockPolicyAndStopsTheSpeedHelperOnce()
        tests.testSwitchingSettingsToSpeedLeavesNoHiddenMainPageKeepingTheDock()
        tests.testAnotherExplicitlyVisibleToolKeepsTheDockUntilItCloses()
        tests.testNewWindowBeforeDeferredCloseIsNotHiddenByAStaleUpdate()
        tests.testWindowDelegateReplacementCannotLoseTheCloseNotification()
        tests.testPetPanelDoesNotKeepTheDockOrGetHiddenWhenToolCloses()
        tests.testReopenFocusesExistingToolWithoutAnotherActivationOrMainPage()
        tests.testHideAndRepeatedCloseDismissOnlyOncePerPresentation()
        let coordinator = UtilityWindowCoordinator(activate: {})
        let pet = NSPanel(contentRect: CGRect(x: 0, y: 0, width: 80, height: 80), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        pet.isReleasedWhenClosed = false; pet.orderFront(nil)
        let tool = NSWindow(contentRect: CGRect(x: 100, y: 100, width: 240, height: 120), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        tool.isReleasedWhenClosed = false
        coordinator.present(tool)
        XCTAssertEqual(NSApp.activationPolicy(), .regular)
        tool.standardWindowButton(.closeButton)!.performClick(nil)
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(NSApp.activationPolicy(), .accessory)
        XCTAssertEqual(coordinator.visibleCount, 0)
        XCTAssertFalse(tool.isVisible)
        XCTAssertTrue(pet.isVisible)
        pet.close()
        print("PASS: \(assertionCount) window-lifecycle assertions, including actual close-button policy check; standalone, not XCTest")
    }
}
#endif
