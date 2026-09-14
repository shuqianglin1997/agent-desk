import AppKit
import Foundation

// This helper intentionally uses NSRunningApplication only. It avoids all
// privacy-controlled input, capture, scripting, shell and automation APIs, so
// foregrounding an exact PID does not request macOS privacy access.

guard CommandLine.arguments.count == 3,
      CommandLine.arguments[1] == "--pid",
      let rawPid = Int32(CommandLine.arguments[2]),
      rawPid > 1 else {
    exit(64)
}

guard let application = NSRunningApplication(processIdentifier: pid_t(rawPid)),
      !application.isTerminated else {
    exit(3)
}

application.unhide()
let activated = application.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
exit(activated ? 0 : 4)
