import Foundation
import Combine

/// A static desktop entry point. Capability and visibility are independent persisted choices.
final class PetModel: ObservableObject {
    @Published private(set) var enabled: Bool
    @Published private(set) var visible: Bool
    var configurationChanged: (() -> Void)?
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let initialEnabled = defaults.bool(forKey: "petEnabled")
        enabled = initialEnabled
        visible = initialEnabled && (defaults.object(forKey: "companionVisible") as? Bool ?? true)
    }

    func setEnabled(_ enabled: Bool) {
        guard self.enabled != enabled else { return }
        self.enabled = enabled
        visible = enabled
        persist()
    }

    func setVisible(_ visible: Bool) {
        guard enabled, self.visible != visible else { return }
        self.visible = visible
        persist()
    }

    private func persist() {
        defaults.set(enabled, forKey: "petEnabled")
        defaults.set(visible, forKey: "companionVisible")
        configurationChanged?()
    }
}
