import Foundation

// Pipes carry volatile snapshots/heartbeats. No timer needs a disk mailbox.
final class BackendPipeInbox: @unchecked Sendable {
    private let lock = NSLock()
    private var token = UUID()
    private var pending = Data()
    private var messages: [Data] = []
    private var discarding = false
    func reset() -> UUID {
        lock.lock(); defer { lock.unlock() }
        token = UUID(); pending.removeAll(); messages.removeAll(); discarding = false
        return token
    }
    func append(_ data: Data, token expected: UUID) {
        lock.lock(); defer { lock.unlock() }
        guard token == expected else { return }
        for byte in data {
            if byte == 10 {
                if !discarding && !pending.isEmpty {
                    if messages.count == 64 { messages.removeFirst() }
                    messages.append(pending)
                }
                pending.removeAll(keepingCapacity: true); discarding = false
            } else if !discarding {
                if pending.count < 512 * 1024 { pending.append(byte) }
                else { pending.removeAll(); discarding = true }
            }
        }
    }
    func drain() -> [Data] {
        lock.lock(); defer { lock.unlock() }
        let result = messages; messages.removeAll(keepingCapacity: true); return result
    }
}
