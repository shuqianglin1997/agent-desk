#!/usr/bin/env bash

set -euo pipefail

release_dir="${1:-release}"
dmg_paths=()
while IFS= read -r dmg_path; do
  dmg_paths+=("$dmg_path")
done < <(find "$release_dir" -maxdepth 1 -type f -name 'AgentDesk-*-universal.dmg' -print | sort)

if [ "${#dmg_paths[@]}" -ne 1 ]; then
  echo "::error::Expected exactly one universal AgentDesk DMG in ${release_dir}; found ${#dmg_paths[@]}." >&2
  exit 1
fi

dmg_path="${dmg_paths[0]}"
mount_point="$(mktemp -d /tmp/agentdesk-release.XXXXXX)"
mounted=0

cleanup() {
  if [ "$mounted" -eq 1 ]; then
    hdiutil detach -quiet "$mount_point" || true
  fi
  rmdir "$mount_point" 2>/dev/null || true
}
trap cleanup EXIT

echo "Verifying disk image: ${dmg_path}"
hdiutil verify "$dmg_path"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$mount_point" "$dmg_path"
mounted=1

app_path="${mount_point}/AgentDesk.app"
if [ ! -d "$app_path" ]; then
  echo "::error::AgentDesk.app is missing from ${dmg_path}." >&2
  exit 1
fi

expected_version="$(node -p "require('./package.json').version")"
actual_version="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")"
if [ "$actual_version" != "$expected_version" ]; then
  echo "::error::DMG contains AgentDesk ${actual_version}; expected ${expected_version}." >&2
  exit 1
fi

expected_identifier="$(node -p "require('./package.json').build.appId")"
actual_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_path/Contents/Info.plist")"
if [ "$actual_identifier" != "$expected_identifier" ]; then
  echo "::error::DMG bundle identifier is ${actual_identifier}; expected ${expected_identifier}." >&2
  exit 1
fi

repository_root="$(cd "$(dirname "$0")/.." && pwd)"
echo "Verifying Electron fuses and packaged ASAR integrity"
node "$repository_root/scripts/verify-electron-package-integrity.js" --artifact "$app_path"

app_executable="${app_path}/Contents/MacOS/AgentDesk"
architectures="$(lipo -archs "$app_executable")"
if [[ " ${architectures} " != *" arm64 "* ]] || [[ " ${architectures} " != *" x86_64 "* ]]; then
  echo "::error::Expected a universal executable; found architectures: ${architectures}." >&2
  exit 1
fi

input_helper="${app_path}/Contents/Resources/native/AgentDeskInputHelper"
if [ ! -f "$input_helper" ] || [ ! -x "$input_helper" ]; then
  echo "::error::Signed input helper is missing or not executable in the final DMG." >&2
  exit 1
fi
helper_architectures="$(lipo -archs "$input_helper")"
if [[ " ${helper_architectures} " != *" arm64 "* ]] || [[ " ${helper_architectures} " != *" x86_64 "* ]]; then
  echo "::error::Expected a universal input helper; found architectures: ${helper_architectures}." >&2
  exit 1
fi

echo "Verifying Developer ID signature"
codesign --verify --deep --strict --verbose=2 "$app_path"
signature_details="$(codesign -dvvv "$app_path" 2>&1)"
printf '%s\n' "$signature_details"
if ! grep -q '^Authority=Developer ID Application:' <<<"$signature_details"; then
  echo "::error::AgentDesk is not signed with a Developer ID Application certificate." >&2
  exit 1
fi
expected_team_identifier="${APPLE_TEAM_ID:-}"
if [ -z "$expected_team_identifier" ]; then
  echo "::error::APPLE_TEAM_ID is required to verify the signing identity." >&2
  exit 1
fi
team_line="$(grep -m1 '^TeamIdentifier=' <<<"$signature_details" || true)"
actual_team_identifier="${team_line#TeamIdentifier=}"
if [ -z "$actual_team_identifier" ] || [ "$actual_team_identifier" = "not set" ]; then
  echo "::error::AgentDesk signature has no Apple Developer team identifier." >&2
  exit 1
fi
if [ "$actual_team_identifier" != "$expected_team_identifier" ]; then
  echo "::error::AgentDesk was signed by team ${actual_team_identifier}; expected ${expected_team_identifier}." >&2
  exit 1
fi


echo "Verifying bundled input helper signature"
codesign --verify --strict --verbose=2 "$input_helper"
helper_signature_details="$(codesign -dvvv "$input_helper" 2>&1)"
if ! grep -q '^Authority=Developer ID Application:' <<<"$helper_signature_details"; then
  echo "::error::AgentDeskInputHelper is not signed with a Developer ID Application certificate." >&2
  exit 1
fi
helper_team_line="$(grep -m1 '^TeamIdentifier=' <<<"$helper_signature_details" || true)"
helper_team_identifier="${helper_team_line#TeamIdentifier=}"
if [ "$helper_team_identifier" != "$expected_team_identifier" ]; then
  echo "::error::AgentDeskInputHelper was signed by team ${helper_team_identifier:-none}; expected ${expected_team_identifier}." >&2
  exit 1
fi

echo "Validating stapled notarization ticket"
xcrun stapler validate "$app_path"

echo "Running Gatekeeper assessment"
spctl --assess --type execute --verbose=4 "$app_path"

if command -v syspolicy_check >/dev/null 2>&1; then
  echo "Running macOS distribution policy checks"
  syspolicy_check distribution "$app_path"
fi

echo "macOS release verification passed for AgentDesk ${actual_version}."
