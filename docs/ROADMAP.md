# AgentDesk 演进路线（Roadmap）

> 记录产品演进的分期计划与「当前在做的一期」详细设计。定位与产品边界见 [PRODUCT.md](PRODUCT.md)；本文只回答「接下来做什么、为什么、怎么验证」。
>
> 依据：2026-07 竞品全景 + 用户需求两份独立调研（结论互相印证）。

## 定位收敛（一句话）

不做「全能 agent 管理器」，做 **「同时用多账号 × 多 agent 的人的横切指挥台」**。

- **目标用户门槛 = 乱**：必须同时满足「多个官方账号」+「多 / 重度 agent」；只满足一个的人官方 CLI 已够，不是目标用户。
- **护城河 = 全行业集体回避的一条轴**：多官方账号身份并发隔离 + 跨账号 session 元数据交接。
- **不正面竞争的红海**：「真跑 runtime」「worktree 并行编排」是标配，不是差异化。

## 分期总览

| 期 | 主题 | 目标 | 主要能力 |
|---|---|---|---|
| **一** | 加固账号轴 | 把「多账号」从隐性能力变成显性主场 | 跨账号额度总览 · 每项目默认账号 |
| 二 | 从「在跑」到「能盯」 | 并行监督不漏人 | 「谁需要我」通知 / 收件箱 · 审计日志 · 庭院卡住可视化 |
| 三 | session 连续性 | 跨账号接续不手打 | 跨账号搜索 · handoff 直接入队到就绪 runtime |
| 四 | 基建 | 覆盖面与自适应 | PTY / ConPTY · 能力驱动 UI |

**拒绝清单（明确不做）**：provider / API key 路由（让给 cc-switch / CCR）、又一个 worktree 看板编排器、统一聊天壳（用户要原生 CLI）、20-agent 全自动舰队（真瓶颈是人的审阅带宽）、自动 transcript 迁移（保真度存疑）、跨机云同步（与「本地优先、不碰 token」立场冲突）。

---

## 一期详细设计：加固账号轴

### 为什么先做这个
- 命中最痛需求：成本 / 额度不透明（需求 #1）+ 多账号切换（需求 #4，官方零解）。
- 最干净的空白：没有竞品把「多账号额度并排」做进来。
- 踩现有资产、风险最低：数据层大部分已就绪（见下）。

### Feature A — 跨账号额度总览

**现状（已核实代码，非推测）：**
- `src/quota-service.js` 的 `getAll(profiles)` 已对**所有**账号槽位并发查询（并发上限 2）、分账号缓存（成功 5min / stale 1min / error 30s / unsupported 10min TTL）、失败降级。
- IPC `quota:all`（preload 暴露为 `listQuotas`）已返回**全部**账号的额度快照。
- `src/renderer.js` 的 `state.quotas` 已是 `{profileId: 额度}` 全量映射，每 `QUOTA_REFRESH_INTERVAL` 刷新。
- **缺口只在 UI**：当前只渲染 `selectedQuota()`（选中账号那一个），`#quotaSummary / #quotaMeters` 是单账号视角。

**要做：** 一个「所有账号额度并排」的总览——复用已有全量 `state.quotas`，逐账号列出：最紧的百分比、重置时间、套餐、状态（ok / stale / error / unsupported），按「最紧程度」排序，一眼看出哪个号快没了、哪个号还能用。

**落点（预估，实现前以代码为准）：**
- 纯函数：新增额度总览「聚合 + 排序」纯函数（可单测，`src/quota.js` 内或新建 `src/quota-overview.js`），输入 `state.quotas` + profiles，输出排序后的总览行。
- UI：renderer 新增总览渲染 + 入口（经典视图信息轨顶部一栏 / 庭院一个「全院总览」面板）。
- **不改**：`main.js`、`quota-service.js`、`codex-quota.js`。

**边界 / 风险：**
- 只有 Codex 有官方额度；Claude / Cursor 继续显式 `unsupported`，总览如实标注，绝不假装成 0 或错误。
- 限流已由 quota-service 保证；总览只读 `state.quotas` 缓存，**不新增额度请求**。

**验收：**
- N 个 Codex 账号时，总览并排显示各自剩余 % / 重置 / 套餐，按最紧排序。
- 非 Codex 账号显示 unsupported，不显示为 0 或报错。
- 不增加额度请求量（复用缓存）；刷新仍走现有 `loadQuotas`。

### Feature B — 每个项目记住默认账号

**现状：** `profiles.json` 存账号槽位；起 runtime 时 `identityProfileId` 每次手选；workspace 是一次性 owner-bound grant，**renderer 不持有原始 cwd**（安全边界）。

**要做：** 让「某项目 / 工作区默认用某账号」可持久化，下次在该项目起 agent 自动预选身份。

**关键设计点（需人工拍板，勿默选）：**
1. **默认映射存哪？** 倾向 `settings.json`（偏好类）而非 `profiles.json`（身份本身）。
2. **key 用什么？** 项目路径需规范化（大小写 / 软链 / 尾斜杠）；但 renderer 不持有原始 cwd，所以映射的建立与读取必须在 **main 侧**完成，renderer 只拿 grantId 与展示路径。**这条是硬约束，不能破。**
3. **悬空清理**：账号被删除后，其默认映射跟随 profile 级联清除。

**落点（预估）：** `settings.js`（映射结构 + 迁移）、`main.js`（读写映射 IPC + 起 runtime 时按项目预选）、`renderer.js`（起 agent 面板提示「已按项目预选 X，可改」）。遵循 immutable + 原子写入（现有 `json-store`）。

**风险：** 涉及新持久化 + 触及安全边界（路径规范化必须在 main），比 A 更需要先审设计再动手。

**验收：** 在项目 X 用账号 A 起过 agent 后，下次在 X 起 agent 默认预选 A；可改、可清；profile 删除后映射不悬空；renderer 全程不接触原始 cwd。

### 实现顺序（遵循 TDD + 分期验证）
1. **先 A**（纯读、复用现有栈、风险低）：先写额度总览聚合纯函数 + 单测，再接 UI，可独立发一版验证。
2. **后 B**（新持久化 + 安全边界）：先敲定上面三个设计点，再 TDD 落地。

---

## 决策（2026-07-20 已定）
- [x] Feature B 默认映射存 **`settings.json`**（偏好类，不放进 `profiles.json`）。
- [x] 额度总览入口：**经典视图信息轨 + 庭院面板都做**。
- [x] 总览纳入**所有账号**：Codex 显示真实额度，Claude / Cursor 显式 `unsupported`（无官方 API，不抓 cookie/token）。
- [x] **直接连做 A + B**，TDD 自测通过即提交，不停下等预览；UI 效果留待人工上手验证。
