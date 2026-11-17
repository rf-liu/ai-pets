import Foundation

public struct CompletionReminderState {
    public enum Surface: Equatable { case foreground, background }
    public private(set) var pending = false
    public private(set) var surface: Surface?
    public private(set) var deadline: TimeInterval = 0
    public private(set) var acknowledgedAt: TimeInterval = 0
    public private(set) var pendingEndedAt: TimeInterval?
    public static let maximumDeliveryAge: TimeInterval = 15
    private var latestEndedAt: TimeInterval = 0
    public init() {}
    @discardableResult public mutating func receive(endedAt: TimeInterval, now: TimeInterval) -> Bool {
        guard Self.fresh(endedAt, now: now), endedAt > acknowledgedAt, endedAt >= latestEndedAt else { return false }
        latestEndedAt = endedAt; pendingEndedAt = endedAt; pending = true
        return true
    }
    @discardableResult public mutating func discardExpired(now: TimeInterval) -> Bool {
        guard pending else { return false }
        if let at = pendingEndedAt, Self.fresh(at, now: now) { return false }
        cancelPending(); return true
    }
    public mutating func cancelPending() { pending = false; pendingEndedAt = nil }
    @discardableResult public mutating func show(_ target: Surface, now: TimeInterval, openingDelay: TimeInterval = 0) -> Bool {
        discardExpired(now: now)
        guard surface == nil, pending else { return false }
        // A shown notice is consumed. Losing focus or becoming busy must not
        // put that same notice back in the delivery queue.
        cancelPending()
        surface = target; deadline = now + openingDelay + 5
        return true
    }
    public mutating func pause() { surface = nil; deadline = 0 }
    public mutating func dismiss(now: TimeInterval, keepPending: Bool = false) {
        if !keepPending { cancelPending() }
        acknowledgedAt = now; pause()
    }
    private static func fresh(_ endedAt: TimeInterval, now: TimeInterval) -> Bool {
        endedAt.isFinite && now.isFinite && now >= endedAt && now - endedAt <= maximumDeliveryAge
    }
}
