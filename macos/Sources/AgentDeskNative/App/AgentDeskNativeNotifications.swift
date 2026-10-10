import AppKit
import UserNotifications

/// One exit for background events. A failed/disabled delivery returns to the panel.
final class AgentDeskNativeNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = AgentDeskNativeNotifications()
    var openPanel: (() -> Void)?

    private var center: UNUserNotificationCenter? {
        // UNUserNotificationCenter cannot run from an unbundled command-line binary.
        guard Bundle.main.bundleIdentifier == "com.agentdesk.native",
              Bundle.main.bundleURL.pathExtension == "app" else { return nil }
        return UNUserNotificationCenter.current()
    }

    func configure(openPanel: @escaping () -> Void) {
        self.openPanel = openPanel
        center?.delegate = self
    }

    /// Read-only runtime evidence for `--diagnose`; never requests permission or sends a notification.
    func diagnose() {
        guard let center else { print("notificationStatus=unbundled"); return }
        center.getNotificationSettings { settings in
            print("notificationAuthorization=\(settings.authorizationStatus.rawValue) notificationAlerts=\(settings.alertSetting.rawValue)")
        }
    }

    func send(title: String, body: String, completion: @escaping (Bool) -> Void) {
        guard let center else { completion(false); return }
        center.getNotificationSettings { settings in
            let deliver = {
                let content = UNMutableNotificationContent()
                content.title = title
                content.body = body
                content.sound = .default
                let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
                center.add(request) { error in completion(error == nil) }
            }
            switch settings.authorizationStatus {
            case .notDetermined:
                center.requestAuthorization(options: [.alert, .sound]) { granted, error in
                    if granted && error == nil { deliver() } else { completion(false) }
                }
            case .authorized, .provisional:
                if settings.alertSetting == .enabled { deliver() } else { completion(false) }
            default:
                completion(false)
            }
        }
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { [weak self] in
            self?.openPanel?()
            completionHandler()
        }
    }
}
