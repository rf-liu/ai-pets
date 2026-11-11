import AppKit

/// Coordinates match WidgetView's unscaled 378-point, top-left canvas.
@MainActor final class WidgetHitMap {
    enum Target { case character, settings }
    private let width: Int
    private let height: Int
    private let alpha: [UInt8]
    private let aspect: CGFloat

    private let inset: CGFloat
    init(image: NSImage?, inset: CGFloat = 0) {
        self.inset = max(0, min(50, inset))
        guard let image, let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
            width = 0; height = 0; alpha = []; aspect = 1; return
        }
        let factor = min(1, 512 / CGFloat(max(cg.width, cg.height)))
        width = max(1, Int(CGFloat(cg.width) * factor))
        height = max(1, Int(CGFloat(cg.height) * factor))
        aspect = CGFloat(cg.width) / CGFloat(cg.height)
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let w = width, h = height
        pixels.withUnsafeMutableBytes { buffer in
            guard let context = CGContext(data: buffer.baseAddress, width: w, height: h,
                bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return }
            context.interpolationQuality = .high
            context.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        alpha = stride(from: 3, to: pixels.count, by: 4).map { pixels[$0] }
    }
    private func stagePoint(_ point: CGPoint, mirrored: Bool) -> CGPoint {
        let x = point.x - 14
        return CGPoint(x: mirrored ? 350 - x : x, y: point.y - 14)
    }
    func inCharacterBounds(_ point: CGPoint, mirrored: Bool) -> Bool {
        CGRect(x: 142, y: 142, width: 208, height: 208).contains(stagePoint(point, mirrored: mirrored))
    }
    func target(at point: CGPoint, mirrored: Bool, completion: Bool, settings: Bool) -> Target? {
        let p = stagePoint(point, mirrored: mirrored)
        if !completion && settings && CGRect(x: 320, y: 162, width: 24, height: 24).contains(p) { return .settings }
        if width > 0 {
            let side = 208 - inset * 2
            let size = aspect >= 1 ? CGSize(width: side, height: side / aspect) : CGSize(width: side * aspect, height: side)
            let rect = CGRect(x: 142 + (208 - size.width) / 2, y: 142 + (208 - size.height) / 2, width: size.width, height: size.height)
            if rect.contains(p) {
                let x = min(width - 1, Int((p.x - rect.minX) / rect.width * CGFloat(width)))
                let y = min(height - 1, Int((p.y - rect.minY) / rect.height * CGFloat(height)))
                if alpha[y * width + x] >= 16 { return .character }
            }
        }
        return nil
    }
}
