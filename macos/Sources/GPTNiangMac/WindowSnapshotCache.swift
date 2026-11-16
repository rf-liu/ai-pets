import AppKit

// All pets share one discovery snapshot. Only the foreground host needs live
// geometry; dragging keeps frame-rate tracking without querying every pet.
@MainActor final class WindowSnapshotCache {
    static let shared = WindowSnapshotCache()
    typealias Windows = [[String: Any]]
    private let query: (CGWindowListOption, CGWindowID) -> Windows?
    private var list: Windows?
    private var fullAt = -Double.infinity
    private var byID: [Int: [String: Any]] = [:]
    private var liveAt: [Int: TimeInterval] = [:]
    init(query: @escaping (CGWindowListOption, CGWindowID) -> Windows? = {
        CGWindowListCopyWindowInfo($0, $1) as? [[String: Any]]
    }) { self.query = query }

    func full(now: TimeInterval, force: Bool = false) -> Windows? {
        let interval = force ? 1.0 / 120 : 0.25
        guard now < fullAt || now - fullAt >= interval else { return list }
        fullAt = now
        list = query([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        byID.removeAll(keepingCapacity: true); liveAt.removeAll(keepingCapacity: true)
        for window in list ?? [] {
            if let number = window[kCGWindowNumber as String] as? Int { byID[number] = window }
        }
        return list
    }
    func window(_ number: Int, now: TimeInterval, foreground: Bool, dragging: Bool) -> Windows? {
        if foreground {
            let interval = dragging ? 1.0 / 120 : 0.05
            let previous = liveAt[number] ?? -Double.infinity
            if now < previous || now - previous >= interval {
                liveAt[number] = now
                let values = query([.optionIncludingWindow], CGWindowID(number))
                byID[number] = values?.first(where: { ($0[kCGWindowNumber as String] as? Int) == number })
            }
        } else { _ = full(now: now) }
        return byID[number].map { [$0] }
    }
}
