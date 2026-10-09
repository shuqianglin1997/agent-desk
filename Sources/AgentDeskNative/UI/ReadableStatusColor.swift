import AppKit
import SwiftUI

/// Deeper hues in light mode keep small status glyphs and warning numbers readable over glass.
enum ReadableStatusColor {
    static let green = adaptive(light: (0.10, 0.40, 0.20), dark: (0.45, 0.84, 0.55))
    static let red = adaptive(light: (0.66, 0.10, 0.14), dark: (1.0, 0.48, 0.46))
    static let amber = adaptive(light: (0.52, 0.30, 0.02), dark: (1.0, 0.74, 0.35))

    private static func adaptive(light: (Double, Double, Double), dark: (Double, Double, Double)) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let rgb = appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
            return NSColor(srgbRed: rgb.0, green: rgb.1, blue: rgb.2, alpha: 1)
        })
    }
}
