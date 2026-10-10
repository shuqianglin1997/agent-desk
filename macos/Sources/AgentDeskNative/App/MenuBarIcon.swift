import AppKit

/// A standard system glyph, shared by the menu bar and static desktop entry point.
enum MenuBarIcon {
    static func make() -> NSImage {
        let image = NSImage(systemSymbolName: "square.stack.3d.up", accessibilityDescription: "AgentDesk Native") ?? NSImage(size: NSSize(width: 18, height: 18))
        image.isTemplate = true
        return image
    }
}
