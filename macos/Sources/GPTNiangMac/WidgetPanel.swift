import AppKit
import GPTNiangCore

/// A fixed logical canvas inside a cropped native window. WindowServer clips
/// the viewport at display edges; the character and its pointer view never move
/// within, or shrink to fit, the remaining visible part of the host.
@MainActor
final class WidgetPanel: NSPanel {
    private let viewport = NSView()
    private var canvas: NSView?
    private var savedPlacement: CGRect?
    private weak var hitModel: WidgetModel?
    private var hitMap: WidgetHitMap?
    private var hitImage: NSImage?
    var placementFrame: CGRect { savedPlacement ?? frame }

    func configurePointerCapture(model: WidgetModel) {
        hitModel = model; hitImage = model.characterImage; hitMap = WidgetHitMap(image: model.characterImage, inset: model.profile.artworkInset)
        updatePointerCapture()
    }
    func updatePointerCapture(at screenPoint: CGPoint = NSEvent.mouseLocation) {
        guard let model = hitModel, let hitMap else { return }
        if hitImage !== model.characterImage {
            hitImage = model.characterImage; self.hitMap = WidgetHitMap(image: hitImage, inset: model.profile.artworkInset)
            updatePointerCapture(at: screenPoint); return
        }
        // Keep AppKit's mouse capture until a press/drag has received mouse-up.
        if model.interactionActive { ignoresMouseEvents = false; return }
        let scale = model.displayScale
        guard scale > 0 else { ignoresMouseEvents = true; return }
        let point = CGPoint(x: (screenPoint.x - placementFrame.minX) / scale,
                            y: (placementFrame.maxY - screenPoint.y) / scale)
        if !isVisible || !hitMap.inCharacterBounds(point, mirrored: model.facingLeft) {
            if model.characterHovered { model.characterHovered = false }
        }
        let target = hitMap.target(at: point, mirrored: model.facingLeft,
            completion: model.isCompletionMessage, settings: model.characterHovered && !model.hideMenu)
        let passThrough = !isVisible || !isOnActiveSpace || !frame.contains(screenPoint) || target == nil
        if ignoresMouseEvents != passThrough { ignoresMouseEvents = passThrough }
    }

    func install(_ content: NSView) {
        canvas?.removeFromSuperview()
        viewport.autoresizesSubviews = false
        viewport.wantsLayer = true
        viewport.layer?.masksToBounds = true
        content.autoresizingMask = []
        canvas = content
        contentView = viewport
        content.frame = viewport.bounds
        viewport.addSubview(content)
    }

    /// Cropping never writes preferences or changes window order/level.
    @discardableResult
    func place(_ desired: CGRect, clippedTo host: CGRect?) -> Bool {
        guard let visible = WidgetPlacement.viewport(frame: desired, host: host),
              let canvas else { orderOut(nil); return false }
        savedPlacement = desired
        if frame != visible { setFrame(visible, display: false) }
        let contentFrame = CGRect(x: desired.minX - visible.minX,
                                  y: desired.minY - visible.minY,
                                  width: desired.width, height: desired.height)
        if canvas.frame != contentFrame { canvas.frame = contentFrame }
        return true
    }
}
