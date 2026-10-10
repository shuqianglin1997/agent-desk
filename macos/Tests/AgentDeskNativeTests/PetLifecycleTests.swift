import XCTest
@testable import AgentDeskNative

final class PetLifecycleTests: XCTestCase {
    private func defaults() throws -> (UserDefaults, String) {
        let suite = "agentdesk-native-pet-test-\(UUID().uuidString)"
        return (try XCTUnwrap(UserDefaults(suiteName: suite)), suite)
    }

    func testDisabledByDefaultAndCannotShowWithoutCapability() throws {
        let (settings, suite) = try defaults()
        defer { settings.removePersistentDomain(forName: suite) }
        settings.set(true, forKey: "companionVisible")
        let pet = PetModel(defaults: settings)
        XCTAssertFalse(pet.enabled)
        XCTAssertFalse(pet.visible)
        pet.setVisible(true)
        XCTAssertFalse(pet.visible)
    }

    func testEnableHideAndRestartPreserveIndependentChoices() throws {
        let (settings, suite) = try defaults()
        defer { settings.removePersistentDomain(forName: suite) }
        let pet = PetModel(defaults: settings)
        pet.setEnabled(true)
        XCTAssertTrue(pet.visible)
        pet.setVisible(false)
        let restored = PetModel(defaults: settings)
        XCTAssertTrue(restored.enabled)
        XCTAssertFalse(restored.visible)
        restored.setVisible(true)
        XCTAssertTrue(PetModel(defaults: settings).visible)
        restored.setEnabled(false)
        XCTAssertFalse(PetModel(defaults: settings).enabled)
        XCTAssertFalse(PetModel(defaults: settings).visible)
    }

    func testConfigurationCallbackOnlyOnChanges() throws {
        let (settings, suite) = try defaults()
        defer { settings.removePersistentDomain(forName: suite) }
        let pet = PetModel(defaults: settings)
        var changes = 0
        pet.configurationChanged = { changes += 1 }
        pet.setEnabled(true)
        pet.setEnabled(true)
        pet.setVisible(false)
        pet.setVisible(false)
        pet.setEnabled(false)
        XCTAssertEqual(changes, 3)
    }
}
