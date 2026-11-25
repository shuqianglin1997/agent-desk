# 发布短片的制作源文件

脚本和规矩见 [docs/LAUNCH_VIDEO_PLAN.md](../../docs/LAUNCH_VIDEO_PLAN.md)。这个目录只放制作用的东西，不进应用安装包（`package.json` 的 `build.files` 只收 `src/`、`assets/`）。成片、帧和声音都写在 `out/`，不入库。

## 怎么出片

```bash
node media/launch-video/build.js film zh 0 14 sample   # 中文 0–14 秒样片 → out/catshelf-sample-zh.mp4
node media/launch-video/build.js film en 0 14 sample
node media/launch-video/build.js stills zh 7.5,13.8    # 单帧 → out/stills/
node media/launch-video/tools/verify.js zh sample 0 14 # 切点是否落在拍子上、帧数对不对
node media/launch-video/tools/sheet.js zh out/stills/sheet.png 4 4 12 13.5 6   # 一段动作逐帧排成一张，用来看动效
```

不显示任何窗口、不启动客户端、不下载。用到的只有仓库里已有的 Electron（`node_modules`）和系统自带的 Swift。

## 画面怎么来的

全片是画出来的，一套画风：`film/film.js` 的 `render(ctx, t, lang)` 是时间和语言的纯函数，第 n 帧画的是 n/60 秒，和画得多快无关。

| 文件 | 画什么 |
|---|---|
| `film/draw.js` | 画法：应用的 `--px-*` 颜色、2px 像素边框、朱印按钮、点阵字（只用 12 的整数倍）、8×8 图标、猫（`src/yard/cat-art.js`）、台阶式的动法 |
| `film/app.js` | 猫架窗口：顶栏、搁板、名牌、账本、页脚、空台面 |
| `film/recruit.js` | 招募弹窗 |
| `film/hook.js` | 片头：一张桌子，六只猫轮流坐 |
| `film/desktop.js` | 桌面、程序坞、别家客户端的中性窗口、连到猫的虚线 |
| `film/film.js` | 时间线：镜头、每个时刻窗口是什么状态、光标、字幕 |
| `film/strings.js` | 字：界面上的字全部取自 `src/i18n/zh.js`、`src/i18n/en.js`；这里只写应用里没有的（字幕、片尾、编出来的账号名和会话标题、别家窗口里的字） |
| `film/cues.js` | 每个音效在什么时刻响 |

猫架窗口照真实窗口量出来的尺寸画：`reference/capture.js` 用不显示的窗口跑真实应用（960×840、两倍像素、成片里的六个账号），存下截图和每个元素的位置、颜色、字体，画的时候逐项对照。它只是对照工具，出片时不用。

镜头只有两个位置：贴近猫架窗口（窗口放大两倍，看到其中 960×540，上下摇），或拉远到整个桌面（窗口按原大放在左上角）。两个位置之间走三格台阶。

## 声音和编码

- `audio/bgm.js` 是示意版的配乐寄存器表，`audio/mix.js` 把它和音效一起交给应用的芯片发声器（`src/pixel/chip.js`）渲染，48kHz、峰值 −1 dBFS。整片用同一个增益，所以样片的响度就是成片的响度。
- `render/` 是不显示窗口的 Electron 页面，逐帧画、逐帧存 PNG；和上一帧一样的帧不重复存，`manifest.txt` 记下每一帧用哪张。
- `encode/encode.swift` 用 AVFoundation 把帧和 WAV 写成 mp4（H.264 + AAC，60 帧，颜色标成 sRGB）。`encode/inspect.swift` 把成片读回来：真实的帧数、帧率、时长，并能导出任意一帧。

## 和方案不一样的地方

- **名牌比应用里窄**：应用里一张名牌宽 172px，960 宽的画面里只放得下四只猫；片子要六只猫坐在一条搁板上，所以名牌画成 126px。名牌上写的字和每行的位置照应用不变。
- **名牌照应用写**：第一行是名字，“本机 · 平台”在第四行，不写成“名字 · 平台”一行。
- **第五、六只猫换了平台**：原来是 Claude 团队、Kimi 个人。后面“调用”那一段要叫醒睡着的那只去干活，而 Kimi Code 不能被调用（见 docs/PRODUCT.md 调度中枢），所以睡着的那只改成 Qwen Code；见底的那只是 Kimi Code。
- **招募从空台面开始**：开灯后是真实的“台面上还没有猫”，点的是“招募第一只猫”。点击从 6.0 秒挪到 6.5 秒（镜头先在 6.0 秒推近）。
- **招募弹窗看不到标题那一截**：真实弹窗高 519px（英文 559px），比画面高；镜头对着它的下半截，名字、客户端、登录方式和朱印按钮都在字幕上面。
- **还没打开客户端的猫是“玩耍”**：应用里“在岗”指客户端开着。点了“打开”先是“开工路上”，窗口起来以后才是“在岗”。
- **连线从猫身后穿过**：虚线画在窗口上、猫的后面，不挡猫脸。
- **片头最后一次换座改成亮灯泡**：3.5 秒那一拍。

## 没验证的

- 声音没有人听过，只核对了数值（时刻、峰值）。
- 成片没有在真实播放器里逐一看过，只把 mp4 读回来核对了帧数、时长、颜色标记，并导出帧看过。
