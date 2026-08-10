import ApplicationServices
import Foundation

private final class InputState {
    private let lock = NSLock()
    private var pressedKeys = Set<CGKeyCode>()
    private var pressedButtons = Set<CGMouseButton>()
    private var cursor = CGPoint.zero
    private var lastHeartbeat = Date()

    func handle(_ line: String) {
        let parts = line.split(separator: "\t", omittingEmptySubsequences: false).map(String.init)
        guard let command = parts.first else { return }
        lock.lock()
        defer { lock.unlock() }
        lastHeartbeat = Date()
        switch command {
        case "PING":
            return
        case "RELEASE":
            releaseAllLocked()
        case "MOVE" where parts.count == 3:
            guard let x = Double(parts[1]), let y = Double(parts[2]) else { return }
            cursor = CGPoint(x: x, y: y)
            postPointer(type: dragType(), button: activeButton(), point: cursor)
        case "BUTTON" where parts.count == 5:
            guard let button = mouseButton(parts[2]), let x = Double(parts[3]), let y = Double(parts[4]) else { return }
            cursor = CGPoint(x: x, y: y)
            let down = parts[1] == "DOWN"
            let type = mouseEventType(button: button, down: down)
            postPointer(type: type, button: button, point: cursor)
            if down { pressedButtons.insert(button) } else { pressedButtons.remove(button) }
        case "SCROLL" where parts.count == 3:
            guard let dx = Int32(parts[1]), let dy = Int32(parts[2]) else { return }
            CGEvent(
                scrollWheelEvent2Source: nil,
                units: .pixel,
                wheelCount: 2,
                wheel1: -dy,
                wheel2: -dx,
                wheel3: 0
            )?.post(tap: .cghidEventTap)
        case "KEY" where parts.count == 5:
            guard let code = keyCode(parts[2]), let mask = Int(parts[3]) else { return }
            let down = parts[1] == "DOWN"
            let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down)
            event?.flags = flags(mask)
            event?.post(tap: .cghidEventTap)
            if down { pressedKeys.insert(code) } else { pressedKeys.remove(code) }
        case "TEXT" where parts.count == 2:
            guard let data = Data(base64Encoded: parts[1]), let text = String(data: data, encoding: .utf8) else { return }
            postText(text)
        default:
            return
        }
    }

    func releaseIfExpired() {
        lock.lock()
        defer { lock.unlock() }
        if Date().timeIntervalSince(lastHeartbeat) > 3.5 { releaseAllLocked() }
    }

    func releaseAll() {
        lock.lock()
        defer { lock.unlock() }
        releaseAllLocked()
    }

    private func releaseAllLocked() {
        for code in pressedKeys {
            CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap)
        }
        pressedKeys.removeAll()
        for button in pressedButtons {
            postPointer(type: mouseEventType(button: button, down: false), button: button, point: cursor)
        }
        pressedButtons.removeAll()
    }

    private func postText(_ text: String) {
        let units = Array(text.utf16.prefix(2048))
        guard !units.isEmpty else { return }
        units.withUnsafeBufferPointer { buffer in
            guard let address = buffer.baseAddress else { return }
            let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: address)
            down?.post(tap: .cghidEventTap)
            let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: buffer.count, unicodeString: address)
            up?.post(tap: .cghidEventTap)
        }
    }

    private func postPointer(type: CGEventType, button: CGMouseButton, point: CGPoint) {
        CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: button)?.post(tap: .cghidEventTap)
    }

    private func activeButton() -> CGMouseButton {
        if pressedButtons.contains(.left) { return .left }
        if pressedButtons.contains(.right) { return .right }
        return .center
    }

    private func dragType() -> CGEventType {
        if pressedButtons.contains(.left) { return .leftMouseDragged }
        if pressedButtons.contains(.right) { return .rightMouseDragged }
        if pressedButtons.contains(.center) { return .otherMouseDragged }
        return .mouseMoved
    }
}

private func mouseButton(_ value: String) -> CGMouseButton? {
    switch value {
    case "LEFT": return .left
    case "RIGHT": return .right
    case "MIDDLE": return .center
    default: return nil
    }
}

private func mouseEventType(button: CGMouseButton, down: Bool) -> CGEventType {
    switch button {
    case .left: return down ? .leftMouseDown : .leftMouseUp
    case .right: return down ? .rightMouseDown : .rightMouseUp
    default: return down ? .otherMouseDown : .otherMouseUp
    }
}

private func flags(_ mask: Int) -> CGEventFlags {
    var result = CGEventFlags()
    if mask & 1 != 0 { result.insert(.maskShift) }
    if mask & 2 != 0 { result.insert(.maskControl) }
    if mask & 4 != 0 { result.insert(.maskAlternate) }
    if mask & 8 != 0 { result.insert(.maskCommand) }
    return result
}

private let fixedKeyCodes: [String: CGKeyCode] = [
    "KeyA": 0, "KeyS": 1, "KeyD": 2, "KeyF": 3, "KeyH": 4, "KeyG": 5, "KeyZ": 6,
    "KeyX": 7, "KeyC": 8, "KeyV": 9, "KeyB": 11, "KeyQ": 12, "KeyW": 13, "KeyE": 14,
    "KeyR": 15, "KeyY": 16, "KeyT": 17, "Digit1": 18, "Digit2": 19, "Digit3": 20,
    "Digit4": 21, "Digit6": 22, "Digit5": 23, "Equal": 24, "Digit9": 25, "Digit7": 26,
    "Minus": 27, "Digit8": 28, "Digit0": 29, "BracketRight": 30, "KeyO": 31, "KeyU": 32,
    "BracketLeft": 33, "KeyI": 34, "KeyP": 35, "Enter": 36, "KeyL": 37, "KeyJ": 38,
    "Quote": 39, "KeyK": 40, "Semicolon": 41, "Backslash": 42, "Comma": 43, "Slash": 44,
    "KeyN": 45, "KeyM": 46, "Period": 47, "Tab": 48, "Space": 49, "Backquote": 50,
    "Backspace": 51, "Escape": 53, "MetaLeft": 55, "ShiftLeft": 56, "CapsLock": 57,
    "AltLeft": 58, "ControlLeft": 59, "ShiftRight": 60, "AltRight": 61, "ControlRight": 62,
    "F17": 64, "NumpadDecimal": 65, "NumpadMultiply": 67, "NumpadAdd": 69, "NumLock": 71,
    "NumpadDivide": 75, "NumpadEnter": 76, "NumpadSubtract": 78, "F18": 79, "F19": 80,
    "NumpadEqual": 81, "Numpad0": 82, "Numpad1": 83, "Numpad2": 84, "Numpad3": 85,
    "Numpad4": 86, "Numpad5": 87, "Numpad6": 88, "Numpad7": 89, "F20": 90,
    "Numpad8": 91, "Numpad9": 92, "F5": 96, "F6": 97, "F7": 98, "F3": 99,
    "F8": 100, "F9": 101, "F11": 103, "F13": 105, "F16": 106, "F14": 107,
    "F10": 109, "F12": 111, "F15": 113, "Home": 115, "PageUp": 116, "Delete": 117,
    "F4": 118, "End": 119, "F2": 120, "PageDown": 121, "F1": 122, "ArrowLeft": 123,
    "ArrowRight": 124, "ArrowDown": 125, "ArrowUp": 126
]

private func keyCode(_ value: String) -> CGKeyCode? {
    if value == "MetaRight" { return fixedKeyCodes["MetaLeft"] }
    return fixedKeyCodes[value]
}

private let state = InputState()
private let watchdog = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
watchdog.schedule(deadline: .now() + 1, repeating: 1)
watchdog.setEventHandler { state.releaseIfExpired() }
watchdog.resume()

while let line = readLine(strippingNewline: true) {
    state.handle(line)
}
state.releaseAll()
watchdog.cancel()
