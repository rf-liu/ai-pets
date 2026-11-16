import XCTest
import Foundation
import Darwin
@testable import GPTNiangMac

final class WorkerPipeTests: XCTestCase {
    @MainActor func testOwnedNativeWorkerReceivesSnapshotsWithoutDiskMailboxes() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let runtime = root.appendingPathComponent("Backend/runtime")
        try FileManager.default.createDirectory(at: runtime, withIntermediateDirectories: true)
        try Data().write(to: runtime.appendingPathComponent("gui-worker.mjs"))
        try Data(#"{"version":1,"mode":"custom"}"#.utf8).write(to: root.appendingPathComponent("audio-preferences.json"))
        let executable = root.appendingPathComponent("pipe-fixture")
        let script = """
        #!/bin/sh
        printf '{"type":"health","pid":%s}\\n' "$$"
        while IFS= read -r line; do
          case "$line" in
            *refresh*) printf '%s\\n' '{"type":"snapshot","snapshot":{"ok":true,"queryOk":true,"windows":[],"checkedAt":123}}' ;;
          esac
        done
        """
        try Data(script.utf8).write(to: executable)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: executable.path)
        let previous = getenv("GPT_NIANG_NODE").map { String(cString: $0) }
        setenv("GPT_NIANG_NODE", executable.path, 1)
        let model = WidgetModel(dataDirectory: root, resources: root)
        defer {
            model.stop()
            if let previous { setenv("GPT_NIANG_NODE", previous, 1) } else { unsetenv("GPT_NIANG_NODE") }
            try? FileManager.default.removeItem(at: root)
        }
        model.tick(); XCTAssertTrue(model.workerRunning)
        for _ in 0..<100 { model.writePresence(visible: true) }
        model.refresh()
        for _ in 0..<100 {
            try await Task.sleep(nanoseconds: 10_000_000); model.tick()
            if model.snapshot.ok { break }
        }
        XCTAssertTrue(model.snapshot.ok)
        for name in ["presence.json", "status.json", "refresh.flag"] {
            XCTAssertFalse(FileManager.default.fileExists(atPath: root.appendingPathComponent(name).path))
        }
    }
}
