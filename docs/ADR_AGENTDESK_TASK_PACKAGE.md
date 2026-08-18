# ADR：AgentDesk TaskPackage 的交接、加密与原生会话边界

> 状态：ACCEPTED — IMPLEMENTED
>
> 日期：2026-08-14
>
> 对应产品基线：`PERSONAL_AGENT_MESH_PLAN.md` 1.32
>
> 首个格式版本：`.agentdesk-task` schema v1

## 1. 背景

一项工作在 Agent、设备或人员之间接续时，需要同时取得四组事实：当前要完成什么，前面的讨论形成了什么上下文，项目位于哪个版本和修改状态，以及哪些额外材料确实属于这次交接。

AgentDesk 已有的几种传输能力各自覆盖其中一部分：

| 能力 | 适合解决的问题 |
|---|---|
| 会话库存 | 在多台可信设备上搜索会话目录 |
| `复制会话信息` | 给人一份最小的路径与坐标 |
| `SessionPointer` | 在同一 Personal Mesh 中发送会话位置 |
| 选定文件传输 | 发送用户明确选择的有限文件 |

整项交接需要一个在某个时刻已经固定、接收方可以独立验证的载体。该载体还要服务两种距离：同一个人的 Agent/设备之间接续，以及两个没有建立共同 Personal Mesh 的人之间交接。

## 2. 两个对象

工程方法中的 `WorkPackage` 表示一项仍在推进的责任节点。它有负责人、依赖、状态和持续变化的结果。

产品中的 `TaskPackage` 表示这项责任在时间点 T 的不可变快照。它保存当时的人工检查点、会话、代码检查点和明确附件。接收方取得快照以后继续推进自己的 WorkPackage；来源 WorkPackage 和来源文件继续存在。

两者的关系为：

```text
持续推进的 WorkPackage
          │ 在 T 时刻固定
          ▼
不可变 TaskPackage ──验证与导入──▶ 接收方继续推进的 WorkPackage
          │
          └──来源现场保持原状
```

因此，TaskPackage 没有双向同步、自动合并、远端删除或“唯一当前副本”语义。安全移动由人按“复制、验证、导入、按需归档来源”的顺序完成。

## 3. 当前决策

AgentDesk 生成一种标准加密快照，并提供便携文件与同 Mesh Preview 直送两种交接通道：

- 用户在一条来源明确的本机会话上选择“交接任务”；
- 用户亲自填写目标、已完成、下一步、阻塞/风险和验收标准；
- Main 在导出时重新解析来源 Profile 与 Session，固定会话和项目现场；
- 便携模式使用 `.agentdesk-task`，包与一次性解锁码分开发送；
- 同 Mesh 模式要求认证目标设备、`task.package.transfer.v1` feature、`task.package.receive` capability 和接收端逐次确认；密文分块传送，一次性码只进入目标设备独占 envelope；
- 接收方先验证整包，再选择本机 Agent、Profile 和任务资料目录；
- Codex schema v1 支持原生 rollout 导入；已有 Markdown 导出能力的其他客户端接收只读会话内容；
- 本地历史只记录包的方向、展示信息、模式、时间和位置，不记录解锁码。

便携文件可以通过用户选择的任意文件通道交给另一个人。同 Mesh 直送复用 `TransferService` 的分块、背压、续传和整包哈希，但传输的仍是同一个不可变密文快照；协议不兼容、接收权限关闭、接收方拒绝或发送失败时，可以把同一密文快照保存为便携文件。跨 Mesh 直连仍需要双方身份、接受权限、滥用控制和审计设计，当前实现不宣称具备这些能力。

## 4. 容器格式

文件由未加密外层和经过认证加密的内层顺序组成：

```text
ADTASK01
外层长度 + 外层 JSON
AES-256-GCM(
  ADINNER1
  清单长度 + 清单 JSON
  entry[0] bytes
  entry[1] bytes
  ...
)
GCM authentication tag
```

外层只包含解析加密所需的固定字段：格式、schema、AES-GCM、scrypt 参数、salt 和 IV。标题、Agent、项目、文件名和内容类型全部位于密文内。

解锁码使用去除易混字符的 32 字符表，从 20 个随机字节逐字生成，并以四组五字符显示。scrypt 固定使用 `N=32768, r=8, p=1` 派生 256 位密钥；AES-256-GCM 同时保护机密性和完整性，外层前缀作为 AAD 参与认证。

清单为每一项保存顺序索引、稳定 entryId、类型、规范化逻辑路径、长度、SHA-256 和有界元数据。读取时必须满足：

- 最多 64 项；
- 单项不超过 4 GiB，整包明文不超过 8 GiB；
- 清单不超过 1 MiB；
- 逻辑路径没有绝对路径、盘符、空段、`.`、`..` 或跨平台危险字符；
- entryId 与大小写不敏感的逻辑路径均不重复；
- 会话、子记录和 Git patch 引用的 entry 类型与清单声明一致；
- 每项内容重新计算 SHA-256，所有项结束后不得存在尾随数据。

加密和解密均采用流式读写。错误密钥、密文篡改、长度越界、哈希不符或清单关系错误会在导入事务之前终止。

## 5. 导出事务

### 5.1 人工检查点

目标是必填项。其余字段允许在当次没有内容时留空，但导入预览和生成的 `交接说明.md` 会明确显示“未填写”。AgentDesk 不读取会话后替用户生成目标、进展、下一步、风险或验收标准。

### 5.2 会话固定

导出确认后不复用打开弹窗时的旧对象。Main 重新扫描 Profile 和 Session，再由对应适配器取得内容。

Codex 适配器执行以下步骤：

1. 对来源路径求真实路径，并确认它位于该 Profile 的 `sessions` 或 `archived_sessions` 下；
2. 对仍在追加的 JSONL 取得完整行边界，复制后重新计算同长度来源前缀哈希，证明既有内容没有被原地改写；不稳定时最多重试三次；
3. 逐行解析快照，限制单条 JSONL 记录不超过 64 MiB，并重新确认第一条是目标 conversationId 的 `session_meta` 用户根记录；
4. 扫描同一 SessionRoot 中归属于该根的 guardian/subagent 内部记录；
5. 逐个固定并复核 child 的父会话身份；
6. 任一记录重复、变化过快、格式损坏或目录超过安全扫描上限时拒绝生成。

其他客户端只有在现有适配器能稳定导出 Markdown 时进入 transcript 模式。它们不会以只读 Markdown 冒充官方客户端可以继续写入的原生历史。

### 5.3 Git 检查点

当会话项目位于 Git 仓库时，包记录：

- 仓库名称与 `remote.origin.url`；
- 当前分支与 `HEAD`；
- `git status --porcelain=v1` 的有界摘要；
- 以同一个 `HEAD` 执行 `git diff --binary <head> --` 生成的已跟踪工作树差异。

Main 在一次尝试中读取 `HEAD`、分支、远端、状态和二进制差异，再复读状态与差异；只有前后完全一致才接受，最多重试三次。未跟踪文件名可以出现在状态摘要中，文件正文不会自动进入 patch。需要交接的未跟踪文件必须由用户在附件选择器中明确加入。Git 差异超过 32 MiB 或无法取得稳定现场时，导出失败并保留来源现场。

### 5.4 附件与发布

附件只能来自 Main 打开的系统文件选择器，一次最多 32 个。目录和符号链接被拒绝；同名附件生成稳定的安全文件名，不发生静默覆盖。每个附件先通过只读文件描述符复制到私有 staging，并在复制前后核对设备号、inode、大小和修改时间；正在变化的附件会使导出停止，已经生成的包不会继续读取来源文件。

全部内容先写入私有 staging。完成逐项描述后生成清单，以流式加密写入目标目录中的临时文件，`fsync` 成功后再发布到用户选择的位置。任何中途失败都会删除临时输出和 staging。

## 6. 导入事务

导入分成验证和提交两个阶段。

### 6.1 验证阶段

1. Main 通过系统选择器取得包路径并创建 30 分钟有效的随机 draft token；Renderer 不持有实际路径。
2. 用户输入解锁码后，Main 把明文内层写入私有临时目录。
3. GCM、清单、关系、上限和每项哈希全部通过后，Renderer 才取得去路径化的公开清单。
4. 接收方在选择目标前看到目标、已完成、下一步、阻塞/风险、验收标准、项目检查点、会话形态和附件数量。
5. Main 只列出本机兼容 Profile：原生 Codex 包只列 Codex；transcript 可以保存给任一本机 Agent 运行位置；同一来源设备上的原来源 Profile 不作为自己的导入目标。

验证失败时，本机 Profile、客户端会话目录和用户选择的资料目录均未写入。

### 6.2 提交阶段

接收方选择目标 Profile 和资料目录以后：

1. 在资料目录下创建不会覆盖旧内容的独立子目录；
2. 写入人工检查点 `交接说明.md`；
3. 提取 transcript、Git patch 和附件；
4. 原生模式再由目标适配器执行客户端会话导入；
5. 上述任一步失败，删除本次资料目录，原生适配器删除本次新建文件；
6. 全部成功后删除解密 draft，记录本地历史；
7. 最后按用户选择尝试打开客户端。

历史记账和客户端启动位于提交点之后。二者失败只产生提示，不能反向删除已经导入的会话或资料。

应用退出、用户取消、导入成功或 draft 过期会清理当前解密目录；启动时还会清理 24 小时以上的遗留 staging。

成功提交直送包时，Main 还会把 packageId/transferId 写入独立的 consumed ledger。它与可以裁剪或清理的展示历史分离；应用重启、历史清理或发送端重放都不能使同一包再次进入导入事务。

## 7. Codex 原生导入

原生导入重新验证每个提取出的 JSONL：

- 根记录必须是包内 sessionId 对应的 conversation-root；
- 每个 child 必须是指向该 sessionId 的 internal-child；
- physicalRecordId 在整次导入中唯一；
- 目标端存在同 conversationId 的根记录时，所有现存根都必须与包内根哈希相同；
- 目标端存在同 physicalRecordId 的 child 时，哈希必须相同；
- 同 ID 不同内容直接报冲突，绝不覆盖；
- 新记录写入 `sessions/YYYY/MM/DD`，文件名冲突时使用可追溯的安全名称；
- 重复导入同一内容保持幂等，不重复追加相同标题索引；
- 标题写为 `原标题 · 来自「交接人 / 来源 Agent」`。

导入完成代表目标 Codex 扫描器能够发现这条根会话及其内部记录。当前 `launchProfile` 只能打开目标客户端，不能保证官方客户端直接聚焦到指定 thread；界面和文档都不能把“已打开客户端”写成“已精确打开导入会话”。

## 8. 进程与 IPC 边界

Renderer 只提交稳定 ID、人工文本、布尔选项、draft token、解锁码和目标 Profile ID。它不能提交保存路径、附件路径、资料目录、目标客户端文件路径或任意命令。

Main 负责：

- 重新解析 Profile 与 Session；
- 打开保存、附件、导入文件和资料目录选择器；
- 文件系统、Git、加密、哈希、暂存与原生适配器；
- 目标 Profile 兼容性复核；
- 历史位置的受控 reveal。

Preload 继续暴露逐项白名单方法，没有通用 `invoke(channel, payload)` 或任意路径打开接口。

直送时，发送 Main 把目标设备 Ed25519 身份转换为 X25519 公钥，使用临时 ECDH、HKDF-SHA-256 和 AES-256-GCM 封装一次性码；AAD 绑定 Mesh、来源/目标设备、transferId、packageId、密文哈希和目标公钥指纹。目标 Main 只有在用户接受、完整密文与 SHA-256 通过、当前 feature/capability 仍有效时才短时解封。第三台设备即使持有同一 Mesh linkKey 也不能解封；Renderer、历史、日志和持久化任务状态均不取得明文码。只有用户显式把失败直送保存为便携包时，Main 才一次返回该便携包的解锁码。

直送历史中的来源设备 ID 与名称取自认证传输事实。`sourceAgentName` 和交接人标签仍是受包完整性保护的发送方声明，不是经来源 catalog 验证的 Agent 身份。

## 9. 界面位置

- “交接任务”位于右下单会话动作坞，是次级动作；
- `复制会话信息` 仍是唯一填充主按钮，文本继续只有路径和坐标；
- 批量勾选状态不显示“交接任务”，避免把多条会话误装成一个没有明确根的工作；
- 导入入口和本地历史位于“活动”弹窗；
- 导出与导入都使用固定 Header、可滚动 Content 和固定事务 Footer；关闭、取消与提交不随长内容滚走；
- 弹窗不会增加主窗口永久区域，也不会改变底层 Device Lens、Agent、Slot 或会话选择。

## 10. 安全与隐私结果

任务包可能含有完整会话正文，因此 UI 在导出前持续显示敏感内容提醒。加密保护文件在传输和静态保存时的内容；解锁后接收方能够读取全部包内容，发送人仍需控制接收对象和解锁码通道。

当前实现主动排除：

- 密码、Token、Cookie、浏览器登录状态和官方客户端凭据；
- 整个项目目录、依赖目录和本机环境；
- 未跟踪文件正文，除非它被明确选为附件；
- 自动摘要、自动附件猜测、自动接收人选择；
- 导入后的双向同步、消息合并和来源删除。

会话正文自身可能包含用户曾经粘贴的秘密。系统无法可靠判断自然语言中的秘密，因此采用导出前提醒、整包加密、一次性高熵码和分开发送，而不宣称自动脱敏。

## 11. 当前限制与后续扩展

1. 原生适配器当前只有 Codex rollout schema v1；Claude CLI、Kimi Code、Kimi Work 等使用 transcript。
2. 同 Mesh 直送已经接入 Preview 代码路径，但真实 Electron WebRTC 数据面、物理双机接受/拒绝/撤权/断线恢复和 Windows 文件句柄清理矩阵尚未验收。
3. 跨 Mesh 直接传送尚未设计双方身份和接受权限。
4. Git patch 只覆盖已跟踪工作树差异；完整项目继续依赖正常 Git 远端或用户现有同步方式。
5. TaskPackage 是检查点，不持续反映来源端后来发生的修改。

新增原生适配器必须单独证明：来源快照一致、格式版本受限、身份可重验、目标不覆盖、失败可回滚、重复导入幂等、凭据不进入包、目标客户端能够重新扫描。

## 12. 实现与测试索引

主要实现：

- `src/task-package/format.js`
- `src/task-package/codex-adapter.js`
- `src/task-package/service.js`
- `src/mesh/domain/task-package-transfer.js`
- `src/mesh/main/transfer-service.js`
- `src/mesh/main/peer-manager.js`
- `src/main/ipc/task-package-transfer.js`
- `src/main.js`
- `src/preload.js`
- `src/renderer.js`
- `src/index.html`
- `src/workspace.css`

回归测试：

- `test/task-package.test.js`：容器加密、错误码、清单与类型关系、跨平台路径碰撞、稳定 Git 现场、附件不可变快照、Codex 根/child、冲突、幂等、标题和启动失败提交点；
- `test/task-package-ui.test.js`：动作层级、接收预览、弹窗固定头尾、滚动所有权和窄 IPC；
- `test/task-package-transfer.test.js`、`test/mesh-transfer.test.js`、`test/mesh-peer-compatibility.test.js`：目标设备独占 envelope、逐消息 feature/capability、逐次接受、完整哈希后解封、TTL、consumed ledger、清理和同快照便携回退；Windows 受控清理根使用目标平台路径规则，只把大小写/分隔符等价的同一精确根视为相同，兄弟目录、子目录和异盘继续拒绝；
- 当前全量 Node 527 项中 526 通过、1 项仅 Windows 跳过、0 失败；TaskPackage 安全定向 25/25，真实 Electron UI 21/21 中的直送只覆盖资格与状态投影。现有隔离双 endpoint E2E 尚未发送 TaskPackage；
- 全量 `npm test`、`npm run check` 与真实 Electron UI 验收继续作为提交门禁。
