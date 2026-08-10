#define WIN32_LEAN_AND_MEAN
#include <windows.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <iostream>
#include <map>
#include <mutex>
#include <set>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

static std::mutex stateMutex;
static std::set<WORD> pressedKeys;
static std::set<DWORD> pressedButtons;
static std::atomic<long long> lastPing{0};
static std::atomic<bool> running{true};

static long long nowMs() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();
}

static std::vector<std::string> split(const std::string& line) {
  std::vector<std::string> parts;
  std::stringstream stream(line);
  std::string part;
  while (std::getline(stream, part, '\t')) parts.push_back(part);
  return parts;
}

static WORD keyFor(const std::string& code) {
  if (code.size() == 4 && code.rfind("Key", 0) == 0) return static_cast<WORD>(code[3]);
  if (code.size() == 6 && code.rfind("Digit", 0) == 0) return static_cast<WORD>(code[5]);
  static const std::map<std::string, WORD> keys = {
    {"Backspace", VK_BACK}, {"Tab", VK_TAB}, {"Enter", VK_RETURN}, {"ShiftLeft", VK_LSHIFT},
    {"ShiftRight", VK_RSHIFT}, {"ControlLeft", VK_LCONTROL}, {"ControlRight", VK_RCONTROL},
    {"AltLeft", VK_LMENU}, {"AltRight", VK_RMENU}, {"MetaLeft", VK_LWIN}, {"MetaRight", VK_RWIN},
    {"CapsLock", VK_CAPITAL}, {"Escape", VK_ESCAPE}, {"Space", VK_SPACE}, {"PageUp", VK_PRIOR},
    {"PageDown", VK_NEXT}, {"End", VK_END}, {"Home", VK_HOME}, {"ArrowLeft", VK_LEFT},
    {"ArrowUp", VK_UP}, {"ArrowRight", VK_RIGHT}, {"ArrowDown", VK_DOWN}, {"Insert", VK_INSERT},
    {"Delete", VK_DELETE}, {"Semicolon", VK_OEM_1}, {"Equal", VK_OEM_PLUS}, {"Comma", VK_OEM_COMMA},
    {"Minus", VK_OEM_MINUS}, {"Period", VK_OEM_PERIOD}, {"Slash", VK_OEM_2}, {"Backquote", VK_OEM_3},
    {"BracketLeft", VK_OEM_4}, {"Backslash", VK_OEM_5}, {"BracketRight", VK_OEM_6}, {"Quote", VK_OEM_7},
    {"NumpadMultiply", VK_MULTIPLY}, {"NumpadAdd", VK_ADD}, {"NumpadSubtract", VK_SUBTRACT},
    {"NumpadDecimal", VK_DECIMAL}, {"NumpadDivide", VK_DIVIDE}, {"NumpadEnter", VK_RETURN},
    {"NumLock", VK_NUMLOCK}
  };
  auto found = keys.find(code);
  if (found != keys.end()) return found->second;
  if (code.rfind("Numpad", 0) == 0 && code.size() == 7 && code[6] >= '0' && code[6] <= '9') {
    return static_cast<WORD>(VK_NUMPAD0 + (code[6] - '0'));
  }
  if (!code.empty() && code[0] == 'F') {
    int number = std::atoi(code.c_str() + 1);
    if (number >= 1 && number <= 24) return static_cast<WORD>(VK_F1 + number - 1);
  }
  return 0;
}

static void sendKey(WORD vk, bool down) {
  if (!vk) return;
  INPUT input{};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = vk;
  input.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
  SendInput(1, &input, sizeof(INPUT));
}

static void movePointer(long x, long y) {
  const int left = GetSystemMetrics(SM_XVIRTUALSCREEN);
  const int top = GetSystemMetrics(SM_YVIRTUALSCREEN);
  const int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
  const int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);
  if (width <= 1 || height <= 1) return;
  INPUT input{};
  input.type = INPUT_MOUSE;
  input.mi.dx = static_cast<LONG>((x - left) * 65535LL / (width - 1));
  input.mi.dy = static_cast<LONG>((y - top) * 65535LL / (height - 1));
  input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK;
  SendInput(1, &input, sizeof(INPUT));
}

static DWORD buttonFlag(const std::string& button, bool down) {
  if (button == "LEFT") return down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
  if (button == "RIGHT") return down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
  if (button == "MIDDLE") return down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
  return 0;
}

static void releaseAll() {
  std::lock_guard<std::mutex> guard(stateMutex);
  for (WORD key : pressedKeys) sendKey(key, false);
  pressedKeys.clear();
  for (DWORD flag : pressedButtons) {
    INPUT input{};
    input.type = INPUT_MOUSE;
    input.mi.dwFlags = flag;
    SendInput(1, &input, sizeof(INPUT));
  }
  pressedButtons.clear();
}

static std::vector<unsigned char> decodeBase64(const std::string& value) {
  static const std::string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::vector<unsigned char> output;
  int accumulator = 0;
  int bits = -8;
  for (unsigned char character : value) {
    if (character == '=') break;
    auto position = alphabet.find(character);
    if (position == std::string::npos) return {};
    accumulator = (accumulator << 6) + static_cast<int>(position);
    bits += 6;
    if (bits >= 0) {
      output.push_back(static_cast<unsigned char>((accumulator >> bits) & 0xff));
      bits -= 8;
    }
  }
  return output;
}

static void sendText(const std::string& encoded) {
  auto bytes = decodeBase64(encoded);
  if (bytes.empty() || bytes.size() > 8192) return;
  int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(bytes.data()),
                                  static_cast<int>(bytes.size()), nullptr, 0);
  if (length <= 0 || length > 2048) return;
  std::wstring text(length, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(bytes.data()),
                      static_cast<int>(bytes.size()), text.data(), length);
  for (wchar_t unit : text) {
    INPUT input[2]{};
    input[0].type = INPUT_KEYBOARD;
    input[0].ki.wScan = unit;
    input[0].ki.dwFlags = KEYEVENTF_UNICODE;
    input[1] = input[0];
    input[1].ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP;
    SendInput(2, input, sizeof(INPUT));
  }
}

int main() {
  lastPing.store(nowMs());
  std::thread watchdog([] {
    while (running.load()) {
      std::this_thread::sleep_for(std::chrono::milliseconds(500));
      if (nowMs() - lastPing.load() > 3500) releaseAll();
    }
  });

  std::string line;
  while (std::getline(std::cin, line)) {
    lastPing.store(nowMs());
    auto parts = split(line);
    if (parts.empty()) continue;
    if (parts[0] == "PING") continue;
    if (parts[0] == "RELEASE") { releaseAll(); continue; }
    if (parts[0] == "MOVE" && parts.size() == 3) {
      movePointer(std::strtol(parts[1].c_str(), nullptr, 10), std::strtol(parts[2].c_str(), nullptr, 10));
      continue;
    }
    if (parts[0] == "BUTTON" && parts.size() == 5) {
      long x = std::strtol(parts[3].c_str(), nullptr, 10);
      long y = std::strtol(parts[4].c_str(), nullptr, 10);
      bool down = parts[1] == "DOWN";
      DWORD flag = buttonFlag(parts[2], down);
      if (!flag) continue;
      movePointer(x, y);
      INPUT input{};
      input.type = INPUT_MOUSE;
      input.mi.dwFlags = flag;
      SendInput(1, &input, sizeof(INPUT));
      std::lock_guard<std::mutex> guard(stateMutex);
      DWORD upFlag = buttonFlag(parts[2], false);
      if (down) pressedButtons.insert(upFlag); else pressedButtons.erase(upFlag);
      continue;
    }
    if (parts[0] == "SCROLL" && parts.size() == 3) {
      INPUT inputs[2]{};
      int count = 0;
      long dx = std::strtol(parts[1].c_str(), nullptr, 10);
      long dy = std::strtol(parts[2].c_str(), nullptr, 10);
      if (dy) { inputs[count].type = INPUT_MOUSE; inputs[count].mi.dwFlags = MOUSEEVENTF_WHEEL; inputs[count++].mi.mouseData = static_cast<DWORD>(-dy); }
      if (dx) { inputs[count].type = INPUT_MOUSE; inputs[count].mi.dwFlags = MOUSEEVENTF_HWHEEL; inputs[count++].mi.mouseData = static_cast<DWORD>(-dx); }
      if (count) SendInput(count, inputs, sizeof(INPUT));
      continue;
    }
    if (parts[0] == "KEY" && parts.size() == 5) {
      WORD key = keyFor(parts[2]);
      if (!key) continue;
      bool down = parts[1] == "DOWN";
      sendKey(key, down);
      std::lock_guard<std::mutex> guard(stateMutex);
      if (down) pressedKeys.insert(key); else pressedKeys.erase(key);
      continue;
    }
    if (parts[0] == "TEXT" && parts.size() == 2) sendText(parts[1]);
  }

  running.store(false);
  watchdog.join();
  releaseAll();
  return 0;
}
