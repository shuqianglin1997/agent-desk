# 双端设计规范

换算规则：macOS 中 ≥12pt 的字号原样使用；≤11pt 的加 1，因为 Windows 在 100% 缩放下最小可读字号约为 11px。宽高和圆角与 macOS 保持一致。

**排版**

| 用途 | macOS | Windows | 字重 / 颜色 |
|---|---|---|---|
| 页面标题 | 14 | 14 | SemiBold / 主色 |
| 账号名 | 13 | 13 | SemiBold / 主色 |
| 会话行标题 | 12 | 12 | Regular / 主色 |
| 正文、设置项、额度行 | 11 | 12 | Regular / 主色；标签用次要色 |
| 分组名、节标题 | 11 半粗 | 12 | SemiBold / 次要色 |
| 元信息（时间、状态、缓存） | 10 | 11 | Regular / 次要色 |

字体：`Segoe UI Variable Text, Segoe UI, Microsoft YaHei UI`。窗口根节点设置 `TextOptions.TextFormattingMode="Display"` 和 `UseLayoutRounding="True"`。百分比用 `Typography.NumeralAlignment="Tabular"`（等宽数字）。

**颜色令牌**（浅 / 深两套，放在 `Theme/*.xaml` 里切换）

| 令牌 | 浅色 | 深色 | 说明 |
|---|---|---|---|
| `TextPrimary` | `#E4000000` | `#FFFFFFFF` | Fluent 默认值 |
| `TextSecondary` | `#9E000000` | `#C5FFFFFF` | 用于标签、时间、说明 |
| `TextTertiary` | `#72000000` | `#87FFFFFF` | 用于 chevron、数量 |
| `CardFill` | `#0B000000` | `#0BFFFFFF` | 对应 primary × 4.5% |
| `Divider` | `#14000000` | `#18FFFFFF` | |
| `ControlFill` / `ControlStroke` | `#B3FFFFFF` / `#0F000000` | `#0FFFFFFF` / `#12FFFFFF` | 带边框的小按钮 |
| `Accent` | 系统强调色 | 系统强调色 | 用 WinRT `UISettings.GetColorValue(UIColorType.Accent)` 获取（TFM 已含 19041） |
| `StatusGreen` / `Red` / `Amber` | `#1A6633` / `#A81A24` / `#854D05` | `#73D68C` / `#FF7A75` / `#FFBD59` | 直接取自 `ReadableStatusColor.swift` |

监听 `SystemEvents.UserPreferenceChanged`（或 `WM_SETTINGCHANGE "ImmersiveColorSet"`），系统切换主题时同步切换，并设置 `DWMWA_USE_IMMERSIVE_DARK_MODE (20)`。

**间距与形状**

面板固定 340×570，内边距 14；内容区 = 340 − 28。卡片内边距 10、圆角 10，卡片之间间距 8，卡片内部元素间距 6。设置页节之间 16，节标题与内容 8。按钮圆角 4（与 Windows 11 一致），卡片和面板圆角 8–10。

**组件清单**（在 `Controls.xaml` 里补齐，代码中只引用样式名，不再手写 Margin 和颜色）

- `SubtleButton`：左对齐，无边框，悬停时显示 `CardFill`。用于会话行、折叠行、记录行、底栏“＋ 新建账号”。
- `StandardButton`：高 24，左右内边距 10，1px `ControlStroke`，填充 `ControlFill`。用于启动/前台、复制提示词、立即同步、退出。
- `AccentButton`：强调色填充，白字，设 `IsDefault=True`。用于创建并启动、继续接力。
- `IconButton`：24×24 点击区，图标 16，默认次要色，选中时强调色。用于底栏、刷新。
- `Disclosure`：整行可点，左侧 chevron 9px 旋转 90°。“最近会话”“桌宠选项”“数据与限制”都用这一个。
- `SegmentedControl`：两段，用于 Codex / Claude。
- `TextBox`：带占位文本，圆角 4，聚焦时底边显示强调色。
- `ContextMenu` / `MenuItem` / `Separator` / `ToolTip`：圆角 8，内边距 4，菜单项高 28，背景使用主题令牌。
- 改名、删除确认：改用面板内的行内编辑或同主题的小对话框，回车确认、Esc 取消，删除需要二次确认。
- 托盘菜单：WinForms 菜单无法主题化。建议托盘右键直接弹出同一个 WPF `ContextMenu`（在托盘位置用 `Popup` 或隐藏的宿主窗口显示），保证外观一致。

**背景材质**：Windows 11 上把窗口背景设为透明，调用 `DwmExtendFrameIntoClientArea(-1)` 和 `DWMWA_SYSTEMBACKDROP_TYPE = 3`（Acrylic），再叠一层 35% 的主题底色，与 macOS 的处理方式对应；Windows 10 回退到不透明的主题底色。


用户验收修订（2026-10-10）：系统强调色若为无彩色（RGB 最大最小差 <16），原生主题使用 Fluent 蓝（浅 #0067C0、深 #60CDFF），避免选中图标与普通文字无差别；不修改系统设置。信息页标题图标使用统一16px线性矢量图形，不使用字符字形。
