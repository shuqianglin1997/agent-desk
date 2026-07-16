# 猫猫庭院（Cat Yard）

庭院视图把 AgentDesk 的账号槽位画成一片像素庭院：**每个账号是一只猫**，它的作息由账号的真实活动驱动。经典三栏视图完整保留，账号操作栏的「⇄」随时切换。界面偏好以 `userData/settings.json` 为准，并兼容迁移旧版 `localStorage`。

这份文档说明庭院的映射、状态机、模块结构和边界。产品定位与经典视图见 [PRODUCT.md](PRODUCT.md) / [INTERNAL.md](INTERNAL.md)。

## 核心映射

| 现实 | 庭院 |
|---|---|
| 账号槽位 | 一只猫（头顶常驻名牌 = 账号名称，可点选） |
| 分组 | 庭院分区（木牌写组名） |
| 会话最后活跃时间 | 猫的作息状态 |
| 应用（Claude / Codex） | 猫脖子上的吊牌（橙 / 青）；默认槽位挂金铃铛 |
| `profiles.json` 的 `cat` 字段 | 猫的外观（毛色 / 项圈 / 配饰） |

**为什么猫 = 账号而不是会话**：槽位数量少、长期存在、有身份感，且自带状态信号，符合「宠物」的性质；会话成百上千、生命周期短，画不下也养不熟。

## 状态机

状态由 `deriveState(now, profile, activity)`（[src/yard/cats.js](../src/yard/cats.js)，纯函数）按优先级从上到下取第一个命中项：

| 状态 | 触发条件 | 表现 |
|---|---|---|
| `confused` 迷路 | 会话根目录不存在 / 不可读 | 头顶 ? 气泡，原地转小圈（问题优先可见） |
| `working` 干活中 | App 在跑 **且会话记录 90 秒内还活跃**（刚刚在动） | 工作亭书桌前打字（屏幕闪烁），深夜亮台灯 |
| `onduty` 在岗 | 官方 App 在运行 但会话记录已一阵没动静 | 在自家区域醒着待命，**不占工作亭书桌** |
| `arriving` 开工路上 | App 未探测到，但 `lastLaunchedAt` < 3 分钟 | 举「开工」小木牌，走向工作亭 |
| `play` 玩耍 | App 没运行，24 小时内活跃过 | 区域内散步、去池边看锦鲤 |
| `rest` 面包猫 | App 没运行，1〜3 天没活跃（全新槽位也归此档） | 趴成面包待机 |
| `nap` 打盹 | App 没运行，3〜7 天没活跃 | 蜷睡，Zzz 上浮 |
| `hibernate` 冬眠 | App 没运行，超过 7 天没活跃 | 睡进纸箱盖毯子 |

**「干活中 vs 在岗」到底怎么判（关键）**：App 在跑时，看**会话记录里的最后活跃时间**（`contentActiveAt`）——90 秒内还活跃 = 干活中，否则在岗。不是「App 开着」，不是文件 mtime，也不是 CPU。这版是踩过两个坑后定的：
- **文件 mtime 是坏信号**：各 App 乱 touch 索引/临时文件（Codex 尤甚），mtime 常常虚高，`probeActivity` 扫「所有文件的最新 mtime」会被带偏。
- **CPU 也不行**：实测空闲 Claude 都能吃 ~17% CPU、还会瞬间蹦到 50-100%，固定门槛又飘又misfire；而且 Claude 桌面版生成时根本不写它的会话文件，CPU 和文件都抓不到。
- **会话记录的内容时间戳才对**：直接读「这个账号的会话刚刚在不在动」——Claude 读最新 `local_*.json` 的 `lastActivityAt`；Codex 读最新 rollout `.jsonl` 末行事件的 timestamp（生成时逐事件实时追加）；Cursor 读 SQLite `MAX(lastUpdatedAt)`。每个 app 一个便宜取数器（实测全账号一轮 ~12ms），挂在注册表的 `latestActivityAt` 上。窗口 `WORKING_WINDOW = 90s`（[src/yard/cats.js](../src/yard/cats.js)），可调。
- App 是否在跑由 [src/process.js](../src/process.js) 确认：独立槽位按 `--user-data-dir=<profilePath>` 精确匹配（含空格/前缀边界处理）；Windows 默认 Store/MSIX 槽位改按“不带隔离参数的桌面 App 进程”识别，并排除 CLI shim。App 明确没跑(`running===false`)时，近期活跃只算「玩耍」不算干活；探测整体失败(`running===null`)时，会话记录窗口内还活跃仍尽力判干活。

**活跃度探测**：[src/activity.js](../src/activity.js) 的 `probeActivity` 主体只做 `stat`（返回 `latestMtime / fileCount / activeToday / createdToday`），再调各 app 适配器的 `latestActivityAt` 读**会话记录内容**里的最后活跃时间戳（`contentActiveAt`，拿不到退回 `latestMtime`）；主进程 IPC `activity:all` 补上 `running`（一次 `ps -axww` 供所有账号匹配）。renderer **仅在庭院视图可见时** 8 秒轮询一次（带防堆积），并在从后台/最小化切回时立刻刷新；后台 / 经典视图不扫。

## 外观与自定义

- 8 毛色 × 6 项圈 × 5 配饰，分层合成（[src/yard/sprites.js](../src/yard/sprites.js) 的 `drawCat`），一套像素底图靠调色板交换服务所有品种。
- 默认外观由账号 `id` 哈希确定性生成（`defaultCatFor`）：旧 `profiles.json` 无损升级，每只猫天生长得不同，不配置也好看。
- 编辑账号对话框内可换装，实时预览，存进 `profiles.json` 的 `cat` 字段。`normalizeCat` 白名单校验（毛色 / 配饰枚举、项圈 `#rrggbb`），非法值回落默认。

## 陪伴账本

[src/yard/companion.js](../src/yard/companion.js) 的 `tick(prev, { now, workingIds, remindersOn })` 是纯函数 reducer，产出今日账本 + 该播报的事件：

- **今日小账本**：收工次数 + 累计陪你干活分钟，跨天自动清零，存进稳定的 `settings.json`（同日重启和 portable 更新后保留）。
- **收工播报**：某账号连续 `GRACE`（10 分钟）无写入判定为一次收工，`completed +1`。10 分钟宽限避免写入间隙误判。
- **伸懒腰提醒**：有账号连续干活超 `STRETCH_AFTER`（90 分钟）→ 状态栏轻提醒 + 干活的猫冒音符，90 分钟冷却。中断超宽限期会重置连续工时起点，时长不虚报。
- **总开关**：🔔/🔕，存进 `settings.json`。关掉后收工仍照记，只是不再发提醒。

所有提醒只到**状态栏级别**，不弹窗、不阻塞。账本只在庭院视图可见时推进（轮询同源）；`runCompanion` 全程 try/catch，账本异常绝不连累庭院刷新。

## 模块结构

```text
src/
  activity.js          活跃度探测（stat-only，纯 Node，可单测）
  yard/
    cats.js            状态机 + 外观默认值（纯函数，UMD，可单测）
    companion.js       陪伴账本 reducer（纯函数，UMD，可单测）
    sprites.js         像素猫资产 + 分层合成
    palettes.js        时段调色板（白天/黄昏/夜晚）+ 天气枚举（渲染无关数据）
    scene.js           画布引擎：8fps tick、角色移动、命中检测、时间天气、fx
    yard.css           庭院布局与像素皮肤（scoped 到 body[data-view=yard]）
```

- **渲染层与业务解耦**：`scene.js` 只吃 renderer 喂的数据（`update` / `setAtmosphere`），不碰 IPC、不碰业务状态。
- **时间**：庭院右上角控件 `跟随 / 白天 / 黄昏 / 夜晚`。「跟随」时随主题（◐ 深色=夜晚，暖窗 + 台灯 + 萤火虫）；也可手动锁定某时段。深夜（真实 23:00〜05:00 且处于夜晚时段）没在干活的猫都睡下——手动锁夜但非真实深夜时不会硬让猫睡。时段决定地形离屏缓存的 key。
- **天气**：控件 `晴 / 多云 / 雨 / 雪`。多云 / 雨压暗光照并遮住日月、加密云；雨落斜丝、雪飘白点（逐帧粒子，不进地形缓存）；萤火虫仅晴天出现。时间与天气选择存进 `settings.json`。
- **性能**：8fps；窗口失焦 / 隐藏时暂停心跳；`prefers-reduced-motion` 时全静帧、猫瞬移到位。静态地形（地面 / 栅栏 / 花圃 / 树 / 工作亭）离屏预渲染，只在昼夜切换时重建，每帧仅 blit 一次——实测省掉约 320 次 fillRect/帧（约 42%）。

## 边界与已知取舍

- 运行探测在主进程同步执行一次 `ps -axww`（本机实测约 40ms，8s 一次且仅庭院可见时）；Windows 优先走 PowerShell `Get-CimInstance Win32_Process`，旧系统才回退 `wmic`。会话记录最后活跃时间由各 app 适配器的 `latestActivityAt` 便宜取数（全账号一轮 ~12ms）。
- `WORKING_WINDOW = 90s` 是经验值：会话记录 90 秒内活跃过就算干活。窗口越大越「黏」（活跃后余温更久），越小越灵敏，可按习惯调。
- 活跃度扫描在主进程同步执行（有 12000 条上限）；会话目录在网络盘上的极端情况可能有短暂卡顿。8s 轮询 + 仅可见时扫，后台不耗。
- 账本只在庭院视图可见时推进——这是为省 CPU 刻意把轮询限定在庭院视图的直接结果。
- 「干活中」看会话记录最后活跃、轮询 8 秒一次，所以「陪你干活 N 分钟」是估算：会话记录在两次真实活跃之间不刷新时，间隙这几分钟可能没被计入。account 状态本身不受影响，`companion` 的 10 分钟宽限也保证不会因此误判收工。
- 像素资产为程序化绘制，零外部图片；后续可整体替换为手绘 atlas（如 hatch-pet 流水线产物）而不动状态机与布局。

## 测试

```bash
npm test        # sessions / activity / process / cats / companion 单测
npm run check   # 全部源文件语法检查
```

`cats.js`、`companion.js`、`activity.js` 都是纯逻辑、无 Electron 依赖，可直接 `node --test`。
