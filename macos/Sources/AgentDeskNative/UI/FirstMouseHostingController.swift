import AppKit
import SwiftUI

/// All panel controls accept the activating click, including on a cold opening.
final class FirstMouseHostingView<Content: View>: NSHostingView<Content> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

final class FirstMouseHostingController<Content: View>: NSHostingController<Content> {
    override func loadView() {
        view = FirstMouseHostingView(rootView: rootView)
    }
}

enum PanelClickPolicy {
    static func isInside(_ point: NSPoint, frame: NSRect?) -> Bool {
        frame?.contains(point) == true
    }
}
