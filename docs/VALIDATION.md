# AgentDesk 验证记录

本页是测试结果与开放门禁的唯一当前入口。产品/场景/路线不再复制总数；检查器核对日期、环境、完整 Git 基线和源码 SHA-256，避免源码更新后继续引用旧结果。

## 当前工作树

2026-11-23 提交前整理：保留现有账号导入、安装包 CLI、历史维护、会话批量操作和卡片／额度浮层改动；后台完整 Node 回归共 868 项，866 通过、2 项平台跳过、0 失败，仓库语法与文档检查通过。发布安全检查明确限定两个既有 CLI launcher 和已启用策略的固定历史维护 worker。本次仅整理源码与 Git，没有重新构建、安装、启动或执行 GUI／物理设备验收；既有安装证据保留原日期与源码摘要，不升级为本次成品证据。

正式源码仓库为 `shuqianglin1997/agent-desk`，唯一活跃分支为 `main`。未合入的 `develop` 和 `fork-snapshot-20261009` 历史分别保留在 `archive/develop-20261123`、`archive/fork-snapshot-20261009` 标签，不作为当前产品行为或已合并能力。

2026-10-22 历史维护与部署：定向 Node 28/28，通过成功项与已结束轮次分别判定，覆盖中断/失败轮次内的成功图片、嵌套 MCP 文本、图片保全、在线闲置核验、每小时周期、锁恢复、重开等待与保留客户端安装。六个存储已核对 72,473 条既有用户/助手原始 JSON 和全部既有唯一图片哈希；原生 `thread/read`、`thread/items/list` 的 12 个归档会话、16 页通过，聊天项与游标不变。

此次已通过原有安装器部署到 `/Applications/AgentDesk.app`，128 个 ASAR 文件、fuse/头绑定、签名与实际包内 worker 通过；六个启用根均观测到自动执行，worker SHA-256 与已安装代码相同。安装包从此前已安装包冻结构建，只修改 profile-runtime 并新增清理模块，其余 ASAR 文件逐字节相同，未混入其他工作树改动。原有两个聊天客户端进程不变、settings 精确恢复。自动维护在退出及既有监管循环每小时执行；有原始记录、超过一天闲置且无未完成轮次/文件持有者的未归档会话也可维护。在线只回收可复用页，整库收缩等客户端关闭，避免读事务钉住大 WAL。此次为本机 ad-hoc 部署与原生数据读取验证，不代替完整 GUI、Windows 或公开发行验收。2026-10-19 的源码未部署结论已由本次安装读回与自动执行证据替换；其他日期的旧 checks 保留原始范围。

2026-10-08 额度修复：新版 ChatGPT 将内置 Codex 从 `Resources/codex` 移到 `Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`，现已兼容新旧应用名称、系统/用户安装目录、原生程序和 shell 启动器，并保留显式覆盖路径。额度 RPC 先识别认证类型，API Key 不请求订阅额度；卡片、本号与总览明确标为“不适用”，混合账号仍优先展示可信订阅额度。旧缓存继续不能冒充实时额度。

本次后台 Node 共 843 项：841 通过、2 跳过、0 失败；额度与只读 CLI 定向 54 项通过，120 项语法检查通过。本机六个明确 Profile 在 Finder 精简 PATH 下无需覆盖启动器即完成官方只读查询：四个订阅实时成功、两个 API Key 正确识别；没有模型推理请求或直接读取凭据。所有者已要求修复后重新安装；新包与安装读回、额度界面定向检查结果以 `current.json` 的 artifact/checks 为准。公开发布、完整 GUI 三次首启及 Windows/物理设备门禁未由本次额度修复替代。

新包已安装并启动于 `/Applications/AgentDesk.app`，安装读回与已验证 ASAR 一致，原有官方客户端进程保留。真实用户界面的定向检查通过：四个订阅卡片显示实时每周剩余比例，API 卡片显示“不适用”，本号与全院额度入口显示正确比例，所选订阅详情含进度条及“官方实时数据”。该检查仅覆盖额度显示，不代替完整窗口验收。

以下 2026-09-26 CLI 迭代记录保留作历史，不替代本次源码、包和安装证据。

机器可核对结果见 [current.json](validation/current.json)。该记录区分验证时的 `baseCommit` 与工作树 `sourceSha256`；`uncommitted` 指验证时状态，后续本地提交不改变源码摘要。摘要覆盖 src、test、scripts 与 package/lock。运行 `node scripts/validation-source.js` 可复核；本地提交不等于发布。

当前原始结果：[Node 回归](validation/node-results.txt)；未完成的 [Electron 窗口验证记录](validation/ui-results.txt) 单独列出，不标为 PASS。2026-09-14 同源活动的历史合成测量见 [结果](validation/activity-benchmark.json)；在仓库根运行 `node docs/validation/activity-benchmark.cjs` 可重测。它不是本次重新测量的性能结果。

2026-09-26 先将精简版与 PR 融合现状提交为 `1ca42ec78da8c25948cc3d6217dd39a6a6191485`（本地，未推送），随后迭代 [AI 接口与定制指南](AI_INTERFACE.md) 和源码 Node CLI。当前接口只读发现能力、检查精确 Profile、扫描/定位本机会话并预检公司环境根；不增加 provider 配置写入、启动、API 请求、Mesh/Keychain、HTTP/MCP 或第二写入者。

贡献署名补正：按所有者要求，上述融合提交仅修改提交说明与共同作者署名，现为 `9a08fc9abf9faf6d4a4ed773bb25efd02b34c636`，Git tree 与原提交完全相同。原始验证元数据和历史记录中的 `1ca42ec` 保留为当时的提交标识，查阅当前历史时使用新的等价提交；原本地历史现保留在 `archive/before-contributor-attribution-20260926` 标签。源码摘要、测试结果及安装包没有因此改变。

感谢 [0mn1si2i5](https://github.com/0mn1si2i5) 的贡献，融合提交已保留其原始提交邮箱的 `Co-authored-by` 署名及两个 PR 的来源和原始 tip。[PR #2](https://github.com/shuqianglin1997/agent-desk/pull/2) 采纳 Claude/DSH CLI 启动、配置根隔离、Node shebang 启动器发现与本机遗留登记清理相关改进，并作本地适配修正；[PR #3](https://github.com/shuqianglin1997/agent-desk/pull/3) 仅采纳名册排序、横向滚轮及滚动位置保持，不采纳 VHS 外观，也不恢复退休功能。此记录表示贡献被吸收，不表示原 PR 全量或已在 GitHub 正式合并；本次没有推送或操作远端 PR。

本轮最终后台 Node 共 585 项：584 通过、1 项 Windows 专用跳过、0 失败；其中 CLI 定向 12 项全部通过，覆盖契约/参数、无写入/凭据读取、固定工具不执行、根会话分类/分页/定位、符号链接相交、坏存储不恢复和安全错误。完整语法检查通过。新文档与 AGENTS 已纳入既有文档链接/状态检查，没有另建重复验证脚本。

本机只读 CLI 抽查：显式选择实际 AgentDesk userData，读取到 6 个 Codex Profile，两个根目录均可读取，固定 Codex CLI 被发现；只记录汇总，不读取认证/配置正文或发起模型请求。这不证明任何公司 API、登录或订阅额度可用。当前新增 CLI 直接从源码运行，本轮没有重新打包、安装或启动桌面端。

## 上一融合包（历史安装记录）

`release/local-integration-20260926/mac-arm64/AgentDesk.app` 对应上述 `1ca42ec` 源码基线，版本 `0.10.1-preview.1`。该批以精简版为底吸收 PR #2 与 PR #3 的名册排序/滚轮/滚动保持，未引入 VHS 或退休功能；当时 Node 共 573 项、572 通过、1 Windows 专用跳过。原始报告保留在该本地提交的 `docs/validation/node-results.txt`。

该包当时通过 ad-hoc 签名、五项 fuse、125 个 ASAR 文件/块与内嵌头校验，120 个 src 文件与当时工作树逐字节一致。随后用户明确要求安装并打开，已安装到 `/Applications/AgentDesk.app`；读回 ASAR SHA-256 为 `ea28845467572928cd5a83238abb49f3afa2a822456ce07416d4327a320b6717`，规范路径主进程及 Renderer 已观察到，原有 Agent 客户端保留。普通启动观察不等于完整 GUI 或三次首用验收。

该包没有当轮新增 CLI 模块，不能用旧包完整性结果冒充新源码打包证据。`current.json` 中 `previousArtifact.matchesCurrentSource=false`，历史包检查独立为 `previousArtifactChecks`；当前额度修复安装包另记为 `artifact`。融合前源码备份仍在 `/tmp/agentdesk-integration.lMPQWq/before-integration.tgz`。

先前窗口测试曾通过名册交互与排序重启断言，但在遗留登记按钮可见性处发现融合错误；已修正并通过 Node 结构回归。所有者要求不中断电脑使用后，停止全部测试窗口，不再执行最终整套窗口复验或成品三次首启。首次使用恢复曾有一次超时，随后尝试通过；不能据此宣称最终 GUI 稳定验收已关闭。真实 Claude/DSH 登录、Windows 原生终端与物理设备没有验证。

## 历史证据（不能替代当前工作树）

- `3a4919a14c05e4db1c828cccad3ec9e024023efe`，2026-09-14，本机 macOS：上一轮 Node 共 549 项，548 通过、1 个 Windows 专用项跳过；语法检查、文档检查与 universal native helper 编译通过。这是精简前的基线。
- 2026-08-14，1.28 方案记录：发布安全 14/14、TaskPackage 安全 25/25、Electron UI 21/21，以及当时 arm64 unpacked 的 fuse/ASAR 与 mock-Keychain 三次首用。这里保留当时记录，不把无完整构建摘要的历史材料升级为本次成品证明。
- 2026-08-13，0.9.4，两台物理 Mac 同局域网：认证 host/UDP 通道，562,009 字节库存、9 个 Slot、638 条 SessionReplica，revision 7 → 8 → 9，连续 5 分钟稳定。只关闭该局域网库存/显式与周期刷新基线。
- 历史隔离双 endpoint 的 LAN 与本机 signaling 验证覆盖认证、目录/库存、刷新、SessionPointer、184,333 字节文件和合成屏幕；runner 尚未发送 TaskPackage。

## 仍需真实环境的门禁

- 物理双机 TaskPackage 直送、接受/拒绝、撤权、断线恢复与导入后的官方客户端继续工作。
- 公网 NAT/CGNAT、强制 coturn UDP/TCP/TLS 中继、断网/睡眠与长期连接恢复。
- macOS/Windows 四向屏幕/输入权限、多显示器、DPI、IME 与 Windows 文件句柄清理。
- 签名、公证、真实受保护 Preview Tag、Draft 双原生重下载、公开匿名重下载、浏览器 quarantine、MOTW/SmartScreen/Defender/UAC 与物理干净机首启。

本轮 CLI 迭代没有执行这些物理或发布门禁，没有重启或安装覆盖正在使用的应用，没有推送。发布策略继续是 Preview-only、`stableAllowed=false`；本地 ad-hoc 包不等于签名公证公开发行版，当前没有与本批源码匹配的公开 Preview。
