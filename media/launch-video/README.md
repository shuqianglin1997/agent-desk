# 发布短片的制作源文件

脚本和规矩见 [docs/LAUNCH_VIDEO_PLAN.md](../../docs/LAUNCH_VIDEO_PLAN.md)。这个目录只放制作用的东西，不进应用安装包（`package.json` 的 `build.files` 只收 `src/`、`assets/`）。成片、帧和声音都写在 `out/`，不入库；只有 README 用的两张循环动图写到 `docs/media/`，入库。

这里出三样东西：一分钟成片；它的 15 秒短版（16:9 和 3:4 各一种构图）；README 顶部的循环动图。后两样是从成片的画法和状态里重新剪、重新排的（方案第 11 节），没有另一套画风。

## 怎么出片

```bash
node media/launch-video/build.js film zh              # 中文全片 → out/catshelf-film-zh.mp4（约 50 秒）
node media/launch-video/build.js film en
node media/launch-video/build.js cover zh             # 封面 1280×720 → out/catshelf-cover-zh.png
node media/launch-video/build.js film zh 0 14 sample  # 只出一段 → out/catshelf-sample-zh.mp4
node media/launch-video/build.js stills zh 7.5,13.8   # 单帧 → out/stills/
node media/launch-video/tools/verify.js zh film       # 帧数、切点和镜头移动是否落在拍子上、字幕是否在画内且不超长、音效名是否都是应用里有的
node media/launch-video/tools/sheet.js zh out/stills/sheet.png 4 4 12 13.5 6   # 一段动作逐帧排成一张，用来看动效
out/bin/inspect out/catshelf-film-zh.mp4 26.6 out/check.png                    # 把成片读回来：真实帧数、帧率、时长；导出一帧

node media/launch-video/build.js short zh             # 15 秒短版 1920×1080 → out/catshelf-short-zh.mp4（en 同理）
node media/launch-video/build.js short zh tall        # 15 秒短版 1080×1440（3:4）→ out/catshelf-short-3x4-zh.mp4
node media/launch-video/build.js short en reel        # 15 秒短版 1080×1920（9:16）→ out/catshelf-short-9x16-en.mp4
node media/launch-video/build.js cover-tall zh        # 3:4 封面 → out/catshelf-cover-3x4-zh.png
node media/launch-video/build.js poster bilibili zh   # 别处的封面 → out/cover-bilibili-zh.png（还有 youtube、wechat、wechat-square）
node media/launch-video/build.js print wechat zh      # 公众号正文配图五张 → out/stills-wechat/
node media/launch-video/build.js social               # 仓库链接的分享预览图 1280×640 → out/social-preview.png
node media/launch-video/build.js loop zh              # README 循环动图 → docs/media/catshelf-loop-zh.gif（写完自动读回核对两遍，对不上就不留）
node media/launch-video/build.js stills zh 9.6,13.5 short-tall                 # 短版或动图的单帧（short、short-tall、loop）
node media/launch-video/tools/verify.js zh short tall                          # 短版同一套验收（wide、tall、reel）；动图是 verify.js zh loop；分享预览图是 verify.js en social
node media/launch-video/tools/verify.js zh cover                               # 3:4 封面：字都在画内、在 4px 格上、字号是 12 的整数倍、互不压住
node media/launch-video/tools/verify.js en cover youtube                       # 别的封面同理；要裁的两张（bilibili、wechat）还核对裁剩的那块里该有的都在
node media/launch-video/tools/thumbs.js                                        # 各张封面缩到实际显示的大小，排成 out/covers-as-seen.png
node media/launch-video/tools/sheet.js frames out/frames/short-3x4-zh out/stills/a.png 8 4 540 633 3   # 已渲染的帧逐帧排开
node media/launch-video/tools/gif.js docs/media/catshelf-loop-zh.gif           # 把动图读回来：大小、帧数、时长、是否永远循环
node media/launch-video/tools/fingerprint.js out/frames/film-zh                # 一段帧的指纹：改了画法以后核对成片有没有变
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
| `film/panels.js` | 窗口上再打开的小件：行上的标签菜单、“送出”菜单、“发送到设备”弹窗、编辑弹窗里改毛色项圈配饰的那一块 |
| `film/overlay.js` | 片子自己叠上去的东西：字幕、光标、信封、小锁、另一台电脑、终端、片尾、封面 |
| `film/times.js` | 每件事发生在第几秒 |
| `film/state.js` | 每一刻窗口是什么状态：架子上有谁、各在干嘛、账本里列着什么 |
| `film/film.js` | 镜头、光标的路线、桌面上的客户端窗口，把上面这些合成一帧 |
| `film/strings.js` | 字：界面上的字全部取自 `src/i18n/zh.js`、`src/i18n/en.js`；这里只写应用里没有的（字幕、片尾、编出来的账号名和会话标题、别家窗口里的字） |
| `film/cues.js` | 每个音效在什么时刻响 |
| `film/cut.js` | 15 秒短版：取成片的哪几段、接在哪一拍、三种构图各自的镜头位置、字幕、音效；9:16 上下那两条也在这里画 |
| `film/ending.js` | 短版的片尾（白天的桌面、名字、一句话、“在 GitHub 搜 catshelf”的大名牌、六只猫） |
| `film/poster.js` | 仓库链接的分享预览图（`social`）；封面：两行大字、搁板上四只猫各带一枚小标、桌沿上一行“在 GitHub 搜 catshelf · 开源免费”；同一个构图按小红书、B 站、YouTube、公众号各自的尺寸排（`FORMATS`） |
| `film/stills.js` | 给文章用的静帧：取成片的第几秒、镜头站哪、带不带字幕和光标 |
| `film/loop.js` | README 循环动图：826×690 的窗口里每一刻是什么状态 |
| `film/pieces.js` | 能出哪几样：成片、短版、3:4 短版、动图，各自的尺寸和帧率 |

猫架窗口照真实窗口量出来的尺寸画：`reference/capture.js` 用不显示的窗口跑真实应用（960×840、两倍像素、成片里的六个账号），存下截图和每个元素的位置、颜色、字体，画的时候逐项对照。它只是对照工具，出片时不用。

镜头只有两个位置：贴近猫架窗口（窗口放大两倍，看到其中 960×540，上下摇），或拉远到整个桌面（窗口按原大放在左上角）。两个位置之间走三格台阶。3:4 的短版画面窄，只有贴近这一个位置：看窗口的 540×720，上下左右都能移，别家客户端窗口开在猫架窗口上面（`film/film.js` 的 `TALL`）。9:16 的短版是这幅 3:4 的画面夹在上下两条之间（`REEL`）：上面一条站在窗口顶栏的位置上写名字和一句话，下面一条是桌沿，写怎么找到它。

猫架窗口可以按别的尺寸画（`film/app.js`，`state.size`）：贴右边和底边的东西跟着走，表格各列照应用的规则分宽度。成片用 960×840，3:4 短版用 960×870，动图用 826×690。

## 声音和编码

- `audio/bgm.js` 是示意版的配乐寄存器表，`audio/mix.js` 把它和音效一起交给应用的芯片发声器（`src/pixel/chip.js`）渲染，48kHz、峰值 −1 dBFS。整片用同一个增益，所以样片的响度就是成片的响度。
- `render/` 是不显示窗口的 Electron 页面，逐帧画、逐帧存 PNG；和上一帧一样的帧不重复存，`manifest.txt` 记下每一帧用哪张。
- `encode/encode.swift` 用 AVFoundation 把帧和 WAV 写成 mp4（H.264 + AAC，60 帧，颜色标成 sRGB）。`encode/inspect.swift` 把成片读回来：真实的帧数、帧率、时长，并能导出任意一帧。
- 短版的配乐是同一套寄存器表重新编的 15 秒（`audio/bgm.js` 的 `composeShort`），和成片共用一套乐器写法；音效是成片里落在各段内的那些，跟着段搬过去。
- 动图：`tools/palette.js` 把整段帧归到同一张 255 色的调色板，`encode/gif.js` 写成 GIF（整段一张调色板；第一帧整幅，之后每帧只存变了的像素；画面没变的时刻并成一帧），`tools/gif.js` 和 `encode/gifcheck.swift`（走系统的 ImageIO）各读回一遍，逐像素和来源核对；`tools/gif.js <gif> browser <帧目录>` 再让 Chromium 的解码器（出片用的那个不显示的页面）读一遍。

## 和方案不一样的地方

画的每个状态都照应用真实的样子来，所以有几处和方案里写的示意不同：

- **名牌比应用里窄**：应用里一张名牌宽 172px，960 宽的画面里只放得下四只猫；片子要六只猫坐在一条搁板上，所以名牌画成 126px。名牌上写的字和每行的位置照应用不变。
- **名牌照应用写**：第一行是名字，“本机 · 平台”在第四行，不写成“名字 · 平台”一行。
- **第五、六只猫换了平台**：原来是 Claude 团队、Kimi 个人。“调用”那一段要叫醒睡着的那只去干活，而 Kimi Code 不能被调用（见 docs/PRODUCT.md 调度中枢），所以睡着的那只改成 Qwen Code（名字“开源”），见底的那只是 Kimi Code。
- **招募从空台面开始**：开灯后是真实的“台面上还没有猫”，点的是“招募第一只猫”。点击从 6.0 秒挪到 6.5 秒（镜头先在 6.0 秒推近）。
- **招募弹窗看不到标题那一截**：真实弹窗高 519px（英文 559px），比画面高；镜头对着它的下半截，名字、客户端、登录方式和朱印按钮都在字幕上面。
- **还没打开客户端的猫是“玩耍”**：应用里“在岗”指客户端开着。点了“打开”先是“开工路上”，窗口起来以后才是“在岗”，头顶飘一下“开工”。
- **连线从猫身后穿过**：虚线画在窗口上、猫的后面，不挡猫脸。
- **片头最后一次换座改成亮灯泡**：3.5 秒那一拍。
- **“快没电”是片子加的小标**：应用里额度见底时猫摊成饼、能量格变红、响一声，头顶没有字。片子在它头上加了一个蜂蜜色的小标，写的是应用自己的“快没电”。
- **复制的反馈照应用**：红印落在被复制那一行的行尾，一张小条飞到页脚的猫那里，猫跳一下，飘出“已复制 1 条”，页脚写“已复制 1 条会话信息。”，不是“已复制：路径 + 坐标”。
- **账本的工具栏**：勾了一行以后，应用把“打开目录”“导出”“送出”收成图标、“新回复”三个字收起来，片子照这样画。标题那枚深色标签不截断。
- **调用的那三行**：照应用的样子，标题前一盏灯，副行是“后台对话 · 个人 → 工作”，右边是“运行 0:01”和“停止”。发起的那只在同时叫着两只以上时才戴领结。
- **发送到设备**：照应用走“送出 → 发送到设备 → 选目标设备 → 发送会话信息”，弹窗里写“已送达 1 条会话信息。”；另一台电脑上那句是应用的“收到来自“这台电脑”的 1 条会话信息。”
- **四种办法**：
  - “新来一只”用的是弹窗默认的客户端 Codex；
  - “把已有的领回来”是两个勾（三行放不进字幕上面那块地方），所以这一步上来两只；
  - “拖进来”拖的是一个没有名字的文件夹；
  - “交给 AI”的终端里是应用里显示的两条命令（`profiles discover --scan home` 和 `profiles register …`）。
  - 这四步一共多出五只猫，搁板跟着往左滚，最早的几只在“全部”旁边化进桌面，和应用一样。
- **换装**：在应用的编辑弹窗里点，五种毛色加三种配饰，预览的猫跟着变；架子上的猫被弹窗挡着。
- **关灯**：灯先灭掉灯芯，再用网点压暗，没有半透明。
- **最后一只猫**：58.0 秒睁开一只眼叫一声（落在拍子上），59.0 秒配乐最后一个音时又闭上。示意版写的 58.5 秒不在拍子上。
- **片尾的地址**：按方案写的是改名后的 `github.com/shuqianglin1997/catshelf`。GitHub 上的仓库现在还叫 `agent-desk`，发布前要先在网页上改名。

短版和动图另外有这几处：

- **短版开头不演“轮流登”**：第一帧就是搁板和猫，五只猫半拍一只跳上来；“轮流登”只在字幕里一句带过。成片片头那张夜里的桌子没有搁板，放在开头就成了慢开场。
- **3:4 没有桌面**：别家客户端窗口直接开在猫架窗口上面，虚线从名牌下沿垂直连下去；16:9 的短版照成片拉远到桌面。
- **3:4 的窗口高 870**：比成片高 30px，是把真实窗口拉高一点的样子。
- **短版片尾不写仓库地址**：只留名字、一句话和“在 GitHub 搜 catshelf · 开源免费”，最后这一行放在大号名牌上，停 2 秒。3:4 里这一行排不下，分成两行。
- **3:4“复制”那一段有一个段内的切**：勾选在 9.25 秒，按“复制会话信息”在 9.5 秒，两处在窗口里隔着近 790px，画面只看得到 540px。三格台阶的移动第一格只走到一半多：从按下那一拍开始移，按下的那一帧按钮还有一半在画外；从勾选那一拍开始移，勾的那一帧行已经出画。所以 9.5 秒那一拍直接切到按钮（短版别的切点也都是直接切），9.75 秒再照常三格台阶移回那一行。16:9 的短版这一段画面放得下整个窗口，不动。
- **3:4 封面不是片尾的静帧**：另画的一张（`film/poster.js`），东西都是现成的：桌面和搁板是短版片尾的，猫是 `cat-art.js` 里那一帧，小标是成片 25 秒“快没电”那一枚放大到四倍（字 48px，和字幕一样大）。
- **封面小标写的是应用自己的话**：敲键盘的“1 条在跑”、摞纸冒汗的“3 条在跑”是名牌上那一行，“快没电”是额度状态，“打盹”是猫的状态。应用里这些字在名牌上，不在猫头顶。
- **有三张封面的小标是三倍大**：YouTube、公众号横图和方图放不下四倍大的小标，用三倍（字 36px）。三倍大的小标边线是 6px，不是 4 的整数倍；它的左上角还是放在 4px 格上。
- **YouTube 封面的猫一格是 10px**：720 高里要放两行 108px 的字、小标、猫和桌沿，12px 一格的猫放不下。
- **公众号横图的两行字只有 84px**：要落在转发时裁出的正方形里。
- **文章配图有两张镜头另站**：`03-copy` 比成片高 4px（成片那一帧工具栏顶上被切掉 2px），`05-recruit` 对着整个弹窗（成片只看上半截，字幕还压在上面，这张不带字幕）。五张里除了点着按钮的 `03-copy` 都不画光标。
- **9:16 的字幕没有放到最下面那一条**：Shorts 的界面压在片子底部，字幕留在画面里它压不到的高度。压住多少没有官方数字，是按第三方整理的数估的。
- **9:16 最下面那句“Search catshelf on GitHub”大半会被 Shorts 的界面压住**：所以片尾仍然在画面中间把这句停 2 秒。
- **9:16 看不到窗口自己的顶栏**：上面那一条站在它的位置上；灯泡、收件箱、系统这几样这一条里没有。
- **英文 3:4 短版没有按英文另调镜头**：和中文那条同一组位置。“贴给另一只”那一段右上角的“Quota overview”被画面边切掉后半个词（中文那条同一处切的是“额”）。
- **封面最下面一行写在桌沿上**：和 16:9 封面写地址的位置一样，不用名牌。底色是木头，朱红在上面看不清，所以 catshelf 用的是应用顶栏里“shelf”那个黄色，其余是顶栏的米白。
- **动图的窗口是 826×690**：真实窗口拉窄以后的样子，对照过真实应用（工具栏收成图标的几档、各列宽度）。和成片一样，名牌画成 126px、标题标签不截断（真实窗口在这个宽度会把“全部会话”截成“全部…”）；所以工具栏右半边几个按钮和真实窗口差 2–4px，搜索框比真实的宽一些。
- **动图不用 ImageIO 写**：试过，每帧存整幅、各带调色板，10 MB，颜色还有偏差；改成自己写，约 180 KB。ImageIO 只用来读回核对。
- **动图去掉了边缘的平滑**：GIF 只有 256 色，字的边缘和窗口三个圆钮上的平滑色取了最近的一色（万分之三的像素），变成硬边。
- **动图里睡着的那只坐第三个**：别的位置上它头上的“Z”会压到“招募”或英文的“Quota overview”。成片里它坐最右边，“Z”偶尔碰到“招募”，没有动。

## 指纹

`tools/fingerprint.js` 给一段渲染出的帧算一个指纹（帧的清单加每一张不同的画面）。改了画法或者应用的字表以后重新渲染一遍，对一下就知道哪一条变了。下面是 2026-11-26 的源码渲染出来的：

| 哪一条 | 帧数 | 指纹（sha256 开头） | `out/` 里的 mp4 是不是这一版 |
|---|---|---|---|
| 成片 中文 | 3600 | `c69710a3b1e51bf4` | 是 |
| 成片 英文 | 3600 | `7dfa91515929850b` | 是（2026-11-26 重出，给 YouTube；README 里嵌的是 `447629ee8a39ada1` 那一版，见下） |
| 短版 16:9 中文 | 900 | `9f17ca0a19673efc` | 是 |
| 短版 16:9 英文 | 900 | `ace832656b4be670` | 是（2026-11-26 重出；之前是 `4b6a3ab6b3cf89b6`） |
| 短版 3:4 中文 | 900 | `397af2d1ba47e9e6` | 是（2026-11-26 重出；之前是 `0d4396269d74c676`） |
| 短版 3:4 英文 | 900 | `10fd7fe9732d0a9c` | 是（2026-11-26 新出） |
| 短版 9:16 英文 | 900 | `4003eed36b3ffbf2` | 是（2026-11-26 新出） |

**已知差异：README 里嵌的一分钟英文成片。** 它是 2026-11-25 上传的那一版（指纹 `447629ee8a39ada1`），不换。26 日应用的英文字表改了单复数（提交 ec1b42d），片子上的界面字取自应用，所以现在的源码画出来有 90 帧和它不同，别的 3510 帧一样。`out/catshelf-film-en.mp4` 26 日按现在的源码重出了（给 YouTube 整条上传），和 README 里那一版差的就是下面这三处：

| 秒 | 帧 | 那一版写的 | 现在画的 |
|---|---|---|---|
| 9.5–10.0 | 570–599 | “全部”名牌：1 cats · 0 | 1 cat · 0 |
| 40.5–41.0 | 2430–2459 | 发送弹窗：1 sessions selected. Choose a target device. | 1 session selected. Choose a target device. |
| 41.5–42.0 | 2490–2519 | 发送弹窗：1 session references delivered.；另一台电脑：Received 1 session references from … | 1 session reference delivered.；Received 1 session reference from … |

中文表没动，中文各条不受影响。两张 README 动图两种语言都拿现在的源码重新渲染对过，逐像素一致。

## 没验证的

- 声音没有人听过，只核对了数值（时刻、峰值 −1 dBFS、音效名都是应用里有的）；短版另外核对了结尾是衰减到静音的。
- 各张封面没有在小红书、B 站、YouTube、公众号真实的页面和 App 里看过；做的是缩到各处实际显示的大小看两行大字还读不读得出（`tools/thumbs.js`），裁切的位置按居中算。
- 成片没有在真实播放器里逐一看过；做的是把 mp4 读回来核对帧数（3600）、时长（60.000 秒）、帧率和颜色标记，并从成片里每个镜头导出一帧看过。短版同样（各 900 帧、15.000 秒，每条解出十帧看过）。
- 动图没有在浏览器窗口和 GitHub 页面上看过；做的是三个解码器（自己的、ImageIO、Chromium）逐像素读回，和把帧缩到一半（普通屏上的样子）看过。GitHub 的 README 一栏实际多宽、手机上缩成什么样，没有实测。
