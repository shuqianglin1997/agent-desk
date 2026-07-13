# Windows 版说明

## 产物

Windows portable 版：

`release/AgentDesk 0.2.0.exe`

这是便携版，不需要安装。双击即可运行。

## 默认路径

Claude 默认数据目录：

`%APPDATA%/Claude`

Codex 默认数据目录：

`%APPDATA%/Codex`

Codex 会话目录：

`%USERPROFILE%/.codex`

新增账号槽位会创建在：

`%APPDATA%/AgentDesk/Profiles`

## 启动官方 App

工具会尝试查找这些位置：

- `%LOCALAPPDATA%/Programs/Claude/Claude.exe`
- `%LOCALAPPDATA%/Programs/Codex/Codex.exe`
- `%ProgramFiles%/Claude/Claude.exe`
- `%ProgramFiles%/Codex/Codex.exe`
- `%ProgramFiles%/Anthropic/Claude/Claude.exe`

如果找不到官方 App，账号和会话扫描仍可用，但「打开账号」会提示需要先安装官方 App。

应用内「诊断」会列出当前 Windows 机器上检查过的关键路径，并显示账号目录、会话根目录和扫描位置是否可读。

## 构建命令

```bash
npm install
npm run build:win
```

生成的 `.exe` 在 `release/` 目录下。
