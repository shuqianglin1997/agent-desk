# AgentDesk 全局员工库与按需就绪实施细化

> 状态：OWNER APPROVED — IMPLEMENTATION AUTHORIZED
>
> 日期：2026-08-13
>
> 权威关系：本文细化 `PERSONAL_AGENT_MESH_PLAN.md` 1.20；如有冲突，以后者为准。

## 1. 产品结论

AgentDesk 保存一份全局员工库。Agent 是长期存在的员工，Device 是工作环境，AgentDeployment 是这名员工在某台电脑上的就绪结果，AgentSlot/Profile 只是准备完成后的具体客户端位置。

用户动作统一为：

    选择员工和工作环境
      -> 确保这名员工在目标设备已就绪
      -> 打开

普通首次使用不再要求用户手工同步账号、创建运行位置、选择归属或填写路径。

## 2. 当前实现状态

截至 2026-08-13，本地代码已实现：

- Agent 与 Slot/Binding 解耦，零账号、零运行位置时仍保持员工生命周期；
- schema v5、Blueprint、Deployment、ProvisioningJob 和迁移前备份；
- 本机幂等、可恢复的 ensure-ready 准备链；
- 每个工作环境都投影完整员工库，没有 Slot 时显示首次准备；
- 独立于 inventory 的签名 `catalog.snapshot`，零 Slot 员工也可传播；
- 已就绪远端的 `profile.launch` 和未就绪远端的有人值守 `agent.prepare`。

尚未完成的是 causal catalog event 增量、CLI/Kimi/Cursor 准备适配、技能/工具要求恢复，以及两台物理电脑、真实 NAT/TURN 与跨平台权限矩阵验收。

## 3. 领域对象

### 3.1 AgentIdentity

长期员工。可在零 AccountBinding、零 Deployment、零 Slot 状态存在。只有显式删除才产生 tombstone。

### 3.2 AccountBinding

员工的一张平台工作证。保存 provider、安全别名、Mesh 范围不可逆账号关联键和验证状态，不保存邮箱、原始账号 ID 或凭据。可在零设备登录。

### 3.3 AgentBlueprint

员工需要的非敏感工作配置：

- 首选 provider 与客户端形态；
- 需要的 AccountBinding；
- 适配器允许的 portable settings；
- 技能 ID、版本和可信来源；
- 固定工具目录中的 toolId 和版本要求；
- ProjectIdentity 引用。

不包含整个用户目录、官方客户端数据库、项目内容、密码、Token、Cookie 或任意 dotfiles。

### 3.4 AgentDeployment

`(agentId, deviceId)` 的设备事实，状态为：

    absent
    planning
    preparing
    waiting-install
    waiting-login
    verifying
    ready
    error
    unsupported
    retired

目标设备是唯一写入者；其他设备只缓存签名摘要。

### 3.5 AgentSlot/Profile

准备成功后的具体客户端位置。继续使用 `deviceId + profileId` 作为动作稳定键。普通用户不再通过它建立员工生命周期。

### 3.6 ProvisioningJob

一次可恢复的首次准备事务。`(agentId, deviceId, clientForm)` 同时最多一个活动 Job，重复请求复用；每一步幂等，身份验证成功后才提交正式 Profile/Slot/Deployment。

## 4. 不变量

1. 删除 Deployment 不删除 Agent。
2. 删除最后 Slot 不删除 Agent 或 AccountBinding。
3. 删除最后 AccountBinding 不删除 Agent。
4. 只有显式“删除 Agent”删除员工。
5. 新设备没有任何本地 Profile 时也必须显示完整员工库。
6. 工作环境选择不能用 Slot 是否存在决定 Agent 可见性。
7. 登录身份不匹配时不得静默改绑。
8. 一个准备事务不能产生两个 Profile 或两个等价 Slot。
9. 远端请求只包含稳定 ID 和受限枚举。
10. 密码、Token、Cookie、原始账号 ID、任意安装命令和来源绝对路径不进入目录同步。

## 5. 首次准备状态机

    absent
      -> planning
      -> preparing
      -> waiting-install  --安装完成--> preparing
      -> waiting-login    --登录完成--> verifying
      -> verifying
      -> ready

    任一步 -> error -> retry -> 最近安全检查点
    任一步 -> cancelled
    不支持 -> unsupported

执行步骤：

1. 读取 Agent、Blueprint、目标设备能力和适配器版本。
2. 解析首选 AccountBinding 与客户端形态；只有存在真实歧义时询问一次并记住。
3. 获取 `(agentId, deviceId, clientForm)` Job 锁。
4. 检查客户端、工具、磁盘、系统权限和适配器兼容性。
5. 在 AgentDesk 私有 staging 根创建受管目录，不提前发布正式 Slot。
6. 应用适配器白名单内的 portable settings。
7. 检查并恢复可信技能/工具要求；任意第三方安装需要明确确认。
8. 客户端缺失时进入 `waiting-install`；完成后自动续跑。
9. 没有正确登录时启动官方登录入口并进入 `waiting-login`。
10. 适配器观察安全身份指纹，验证或首次建立预期 AccountBinding。
11. 原子写入 Profile、Slot、Deployment 与审计；广播新的设备事实。
12. 调用已有本地启动器并记录 `lastOpenedAt`。

取消或失败只清理 AgentDesk staging 记录；不删除官方客户端数据、现有用户 Profile、项目或完成的登录。

## 6. 客户端适配器契约

`apps.js` 的现有目录继续负责路径、扫描和启动。新增 provisioning adapter，固定暴露：

    inspect(deviceContext)
    plan(agentBlueprint, deviceContext)
    prepareStaging(job)
    applyPortableSettings(job)
    installRequirement(job)
    beginOfficialLogin(job)
    observeIdentity(job)
    verifyIdentity(job, accountBinding)
    commit(job)
    rollbackStaging(job)

每个适配器声明：

- 支持平台与架构；
- 支持的客户端形态；
- 允许写入的配置字段；
- 是否能自动发现安装；
- 安装是否只提供官方入口；
- 登录完成检测方式；
- 强账号身份是否可用；
- 回滚只涉及哪些 AgentDesk 私有对象。

没有完整适配器的客户端显示准确限制，不得虚假标记 ready。

## 7. 同步分层

### 7.1 签名全局目录

独立 `catalog` 通道同步：

- AgentIdentity；
- AccountBinding；
- AgentBlueprint；
- 显式 tombstone；
- 因果 head 和 revision。

新设备加入时先取得完整目录快照，再补事件。目录中零 Slot 员工仍传播。

### 7.2 来源设备库存

inventory 只同步来源设备自己的：

- AgentDeployment；
- AgentSlot；
- 活动和额度来源；
- SessionReplica；
- freshness 与 revision。

接收端不能用 inventory 缺少某个 Agent 推导删除全局员工。

## 8. UI 接线

固定 1040 × 840、58/244/316/38 和 Header/Footer/三面板不变。

### Header

Device Lens 对用户显示为“工作环境”。具体设备下仍展示完整员工库；“全部设备”是聚合总览。

### 顶部 Agent 面板

- 庭院/卡片始终渲染 AgentIdentity；
- 当前环境状态只显示一个：已就绪、首次准备、需登录、缺客户端、不支持、离线或错误；
- 运行位置已有 Slot 时列 Slot，没有 Slot 时显示 Blueprint 首选客户端；
- 主按钮为“打开”或“首次准备并打开”；
- “新增运行位置”降为管理/修复入口。

### 左下会话

继续按工作环境和 Agent 范围过滤现有会话。零 Slot 员工在该设备自然显示空会话，不从员工库消失。

### 右下详情

继续只承载会话、额度和隔离远控。首次准备使用固定 Header/Footer 的事务弹窗；后台任务进入活动弹窗。

### Footer

可显示“正在准备 1 名员工”等全局摘要，不承载单个员工设置或动作。

## 9. 远端动作

### 9.1 已就绪打开

使用固定消息：

    profile.launch { phase: request }
    profile.launch { phase: result }

请求只包含 `requestId、agentId、profileId`。目标 Main 重新查本机 ready Deployment、linked Slot 和 Profile，检查 `profile.launch` 后再由本地启动器执行。

### 9.2 有人值守准备

使用固定消息：

    agent.prepare { phase: request }
    agent.prepare.status

检查 `agent.prepare` 后，目标设备按自己的 Blueprint、适配器和路径执行。远端不能提交命令、URL、安装参数、配置正文、环境变量或绝对路径。

每次远端首次准备先在目标设备显示来源设备、Agent 和客户端的确认对话框。目录创建与已批准非敏感配置可在确认后执行；软件安装、官方登录、系统权限和管理员权限仍由目标设备上的人完成。无人值守准备不在本阶段。

## 10. 存储与迁移

`mesh.db` schema v5 新增：

- `agent_blueprints`；
- `agent_deployments`；
- `provisioning_jobs`；
- 完整 `catalog_events` 与 snapshot head。

迁移：

1. 备份 v4 数据库。
2. 现有 Agent 原样成为长期员工。
3. 从现有 Slot 推断 Blueprint 首选客户端。
4. 从 `(agentId, deviceId)` 生成 Deployment。
5. linked 且可启动的本地 Slot 标 ready，其余保守降级。
6. 保留 suppressed Slot 和既有 tombstone。
7. 停止 orphan pruning 隐式删除员工。
8. 旧协议端进入目录只读兼容模式，避免反向删除零 Slot 员工。

`profiles.json` 继续保存本地 Profile。ProvisioningService 使用 saga：先 staging，后原子提交 Mesh 关系；跨 JSON/SQLite 失败时记录可恢复 Job，而不是删除用户数据。

## 11. 实施顺序

1. 权威文档、领域测试和 schema v5。
2. 永久 Agent 生命周期与独立 catalog 同步。
3. AgentBlueprint、AgentDeployment、ProvisioningJob 领域与持久化。
4. 本机 ensure-ready 服务及首批桌面适配器。
5. 固定三面板 UI 接线。
6. 远端 `profile.launch`。
7. 有人值守 `agent.prepare`。
8. CLI、Kimi、Cursor 和技能/工具要求扩展。
9. 物理双机、真实网络、三语、双主题和安装权限矩阵。
10. 免登录凭据迁移如有需要另立评审。

## 12. 验收

- 新设备加入后立即看到完整员工库；
- 某设备没有 Slot 的员工显示“首次准备”，不被隐藏；
- 删除最后 Slot/Binding 不删除 Agent；
- 首次点击不要求手工新增、归属或路径；
- 重复点击、崩溃恢复和重试不制造重复对象；
- 登录错误账号不提交 Deployment；
- 后续打开直接启动；
- 已就绪远端可固定语义打开；
- 远端首次准备遵守目标端确认；
- 目录和协议不含凭据、任意命令或路径；
- 现有会话、复制、发送、文件、远控、安全和固定布局契约继续通过。
