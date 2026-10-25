# iOS wrapper

This Xcode project is a minimal SwiftUI launcher for the public Hendy App Store. It is intentionally not an App Store publishing configuration. To upload to App Store Connect, configure the bundle identifier, Apple signing certificate, provisioning profile, App Store Connect API key, privacy details, and required review metadata in protected CI environment secrets. OTA installation requires an eligible signing/provisioning setup and a valid HTTPS manifest.
