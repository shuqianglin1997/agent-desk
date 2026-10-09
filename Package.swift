// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "AgentDeskNative",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "AgentDeskNative", targets: ["AgentDeskNative"])],
    targets: [
        .target(name: "AgentDeskNativeCore", linkerSettings: [.linkedLibrary("sqlite3")]),
        .executableTarget(name: "AgentDeskNative", dependencies: ["AgentDeskNativeCore"]),
        .testTarget(name: "AgentDeskNativeCoreTests", dependencies: ["AgentDeskNativeCore"]),
        .testTarget(name: "AgentDeskNativeTests", dependencies: ["AgentDeskNative"])
    ],
    swiftLanguageModes: [.v5]
)
