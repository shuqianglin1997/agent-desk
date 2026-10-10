import AppKit

/// Static frosted orb: no sprite atlas, animation timer, or media access.
final class PetView: NSView {
    var onClick: (() -> Void)?
    var onDoubleClick: (() -> Void)?
    var onMenu: ((NSEvent) -> Void)?
    private var mouseAnchor = NSPoint.zero
    private var windowAnchor = NSPoint.zero
    private var dragging = false
    private var clickGeneration = 0
    private let nativeOrb = NSVisualEffectView()
    private let nativeIcon = NSImageView()

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        nativeOrb.material = .popover
        nativeOrb.blendingMode = .behindWindow
        nativeOrb.state = .active
        nativeOrb.wantsLayer = true
        nativeOrb.layer?.cornerRadius = 22
        nativeOrb.layer?.masksToBounds = true
        nativeOrb.layer?.borderWidth = 0.5
        nativeIcon.image = MenuBarIcon.make()
        nativeIcon.imageScaling = .scaleProportionallyUpOrDown
        nativeOrb.addSubview(nativeIcon)
        addSubview(nativeOrb)
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel("原生桌宠")
        setAccessibilityHelp("单击打开面板，双击调出忙碌账号，拖动移动，右键打开菜单")
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    var petRect: NSRect { NSRect(x: (bounds.width - 44) / 2, y: (bounds.height - 44) / 2, width: 44, height: 44) }

    override func layout() {
        super.layout()
        nativeOrb.frame = petRect
        nativeOrb.layer?.borderColor = NSColor.separatorColor.cgColor
        nativeIcon.frame = NSRect(x: 10, y: 10, width: 24, height: 24)
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        guard !isHidden, bounds.contains(convert(point, from: superview)) else { return nil }
        return self
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func accessibilityPerformPress() -> Bool { onClick?(); return true }
    override func mouseDown(with event: NSEvent) {
        mouseAnchor = NSEvent.mouseLocation; windowAnchor = window?.frame.origin ?? .zero
        dragging = false; clickGeneration += 1
    }
    override func mouseDragged(with event: NSEvent) {
        let current = NSEvent.mouseLocation
        let dx = current.x - mouseAnchor.x, dy = current.y - mouseAnchor.y
        if !dragging && hypot(dx, dy) > 4 {
            dragging = true
        }
        if dragging { window?.setFrameOrigin(NSPoint(x: windowAnchor.x + dx, y: windowAnchor.y + dy)) }
    }
    override func mouseUp(with event: NSEvent) {
        if dragging {
            dragging = false
            if let window { clampToScreen(window); savePosition(window) }
        } else if event.clickCount >= 2 {
            onDoubleClick?()
        } else {
            let token = clickGeneration
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.24) { [weak self] in
                guard let self, token == self.clickGeneration else { return }; self.onClick?()
            }
        }
    }
    override func rightMouseDown(with event: NSEvent) { onMenu?(event) }

    func clampToScreen(_ window: NSWindow) {
        let frame = window.frame
        guard let screen = NSScreen.screens.max(by: {
            let a = $0.visibleFrame.intersection(frame), b = $1.visibleFrame.intersection(frame)
            return a.width * a.height < b.width * b.height
        }) else { return }
        let visible = screen.visibleFrame
        window.setFrameOrigin(NSPoint(x: min(max(frame.minX, visible.minX), visible.maxX - frame.width),
                                      y: min(max(frame.minY, visible.minY), visible.maxY - frame.height)))
    }
    func savePosition(_ window: NSWindow) {
        UserDefaults.standard.set(window.frame.origin.x, forKey: "petX")
        UserDefaults.standard.set(window.frame.origin.y, forKey: "petY")
    }
}
