# 把多个 Agent 组织成一支队伍

> 状态：DRAFT FOR OWNER REVIEW
>
> 版本：0.2
>
> 日期：2026-08-13
>
> 文档性质：多 Agent 管理与编排的研究性经验文章，不是 AgentDesk 当前功能说明，也不是产品实施授权。

## 摘要

同时使用多个 Agent 以后，问题不再只是如何写好提示词。不同模型、推理档位、客户端、工具和权限会形成不同的工作表现；一项任务也会分出研究、判断、实现、验证和集成等不同责任。管理的重点随之从“让 Agent 回答问题”，转向“了解差异、安排责任、处理依赖、保存共同事实，并决定哪些结果能够进入最终成果”。

本文把多 Agent 管理理解成一个持续修正的循环。我们先依据公开资料和真实合作形成 Agent 画像，再根据工作状态安排临时责任；任务一旦分开，编排的核心便不再是 Agent 数量，而是依赖、共享状态和决策权；Git 用来保存这些工作的基线、分叉、交接与采纳过程；测试和评审提供结果证据；最后，真实结果反过来更新下一次派工。

```mermaid
flowchart LR
  A["Agent 画像<br/>能力、倾向、成本、失误"] --> B["工作责任<br/>探索、判断、执行、审查"]
  B --> C["依赖结构<br/>并行、接力、竞争、监督"]
  C --> D["Git 工作图<br/>基线、分支、现场、提交"]
  D --> E["验证与采纳<br/>测试、证据、集成决定"]
  E --> F["合作记录<br/>成功、失败、返工、成本"]
  F -.->|"修正下一次认识"| A
```

*图 1：全文只有一条主线。模型研究解决“怎样认识”，编排解决“怎样发生关系”，Git 解决“共同事实在哪里”，验证解决“凭什么采纳”。*

读完本文，希望留下的不是一套固定流程，而是六个彼此区分的对象：

| 对象 | 它回答的问题 |
|---|---|
| Agent 画像 | 这个 Agent 在什么配置下怎样工作 |
| 工作责任 | 当前真正需要它承担什么判断或产出 |
| 依赖结构 | 各项工作能否并行，谁等待谁，谁拥有决定 |
| Git 工作图 | 每项工作从哪里开始、在哪里发生、怎样分叉和交接 |
| 验证证据 | 结果为什么可以接受，而不只是由 Agent 自报完成 |
| 合作记录 | 这次经历怎样改变下一次派工和配置选择 |

## 文档边界

本文与仓库中其他文档的职责不同：

- [`PERSONAL_AGENT_MESH_PLAN.md`](./PERSONAL_AGENT_MESH_PLAN.md) 是 Personal Agent Mesh 的产品、领域、安全和实施权威；
- [`PRODUCT.md`](./PRODUCT.md) 记录 AgentDesk 当前产品事实和拒绝清单；
- [`AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V4.md`](./AGENTDESK_MULTI_ACCOUNT_MANAGEMENT_ARTICLE_V4.md) 说明一个人怎样管理多账号、多设备和工作连续性；
- 本文讨论人在外部工具和工程环境中怎样管理多个 Agent 的工作关系。

AgentDesk 当前不承担 worktree、任务队列或自动 Agent 流程编排。本文提到的 Git 和协作方式不改变这一边界。如果以后希望把其中一部分做成产品能力，应另行完成产品立项、交互、安全和实施审阅。

## 一、认识的不是品牌，而是一个工作配置

“这是 GPT”或者“这是 Claude”不足以说明一个 Agent 会怎样完成工作。真实可用的 Agent 是多个条件共同作用的结果。

```mermaid
flowchart TB
  M["基础模型<br/>知识、代码、语言、多模态"] --> O["实际工作表现"]
  P["后训练与行为原则<br/>指令、风险、表达、拒绝"] --> O
  R["推理投入<br/>effort、时间、Token"] --> O
  H["客户端与工具<br/>规划循环、终端、浏览器、权限"] --> O
  C["工作现场<br/>上下文、记忆、压缩、Provider、环境"] --> O
  O --> X["本次可观察结果<br/>质量、速度、成本、失误方式"]
```

*图 2：模型品牌只是输入之一。改变 effort、客户端、工具权限或上下文策略，都可能改变同一模型的工作表现。*

这也是为什么模型经验必须绑定版本和运行条件。网页里的同一模型、编码 CLI 里的同一模型，以及拥有浏览器或计算机控制工具的同一模型，不能直接当成一个稳定不变的成员。

### 1.1 画像需要保留哪些维度

一个综合跑分很难支持派工。更有用的是观察六种相互独立的工作性质：

| 维度 | 观察重点 | 常见误判 |
|---|---|---|
| 问题判断 | 能否区分事实、假设和约束，能否找到真正瓶颈 | 把表达完整当成判断正确 |
| 执行纪律 | 能否遵守范围、可靠操作工具、避免无关修改 | 把生成代码速度当成执行稳定 |
| 状态保持 | 长任务中能否维持目标、接口和已知决定 | 把上下文窗口长度当成可靠记忆 |
| 失败恢复 | 工具失败、测试失败或证据不足时怎样调整 | 只统计最终成功，不看恢复代价 |
| 交接质量 | 能否留下事实、改动、验证和未决问题 | 把长篇解释当成完整交接 |
| 经济性 | 达到可交付结果所需的时间、Token 和人工返工 | 只比较每百万 Token 单价 |

[Artificial Analysis](https://artificialanalysis.ai/methodology/intelligence-benchmarking)、[METR Time Horizons](https://metr.org/time-horizons/) 和 [Terminal-Bench](https://www.tbench.ai/leaderboard/terminal-bench/2.1) 分别测量综合能力、可独立完成的任务时长和终端执行。它们能提供初始信号，却不能互相替代，也不能直接代表某个 Agent 在本地客户端和仓库里的完整表现。

### 1.2 企业取向主要改变行为边界

预训练更直接地影响知识、语言、代码和多模态表征；后训练、系统规则和产品默认值则明显影响指令遵循、风险处理、表达方式、工具行为与拒绝边界。

OpenAI 的 [Model Spec](https://openai.com/index/our-approach-to-the-model-spec/) 强调指令层级、真实性、人的自主权、可控性和副作用；Anthropic 的 [Claude Constitution](https://www.anthropic.com/constitution) 讨论安全、伦理、合规和“真正有帮助”的行为目标。它们有助于理解模型行为倾向，但描述的是设计原则，不是每次运行的能力保证。

因此，公司价值观可以进入 Agent 画像，却不适合直接换算成“智力分”。从几次回答的语气判断底层能力同样不可靠，因为我们看到的性格还混合了系统提示、检索工具、权限和当前上下文。

### 1.3 推理档位是一次任务的投入

low、medium、high、xhigh、max 更接近本次任务投入多少测试时计算，而不是从初级到高级的永久职级。更高档位可能增加推理、工具调用和检查，也会增加延迟、Token 和过度分析的可能。

不同厂商同名档位并不等价。Anthropic 明确说明 effort 会影响思考、正文和工具行为；OpenAI 将 reasoning effort 与部分运行模式分开；DeepSeek 某些 API 档位会映射到同一实际级别；xAI 的部分多 Agent 模式会用 effort 改变参与 Agent 数量。[Anthropic effort](https://platform.claude.com/docs/en/build-with-claude/effort)、[OpenAI model selection](https://developers.openai.com/api/docs/guides/latest-model)、[DeepSeek thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)、[xAI multi-agent](https://docs.x.ai/developers/model-capabilities/text/multi-agent)

档位因此需要和模型 ID 一起进入合作记录。它适合按照判断杠杆、错误代价和验证难度调整，而不是默认所有 Agent 都使用最高档。

### 1.4 模型家族只提供初始假设

截至 2026-08-13，公开资料可以提供一些值得优先验证的岗位倾向，但还不能代替自己的任务数据。

| 模型家族 | 值得优先验证的倾向 | 最容易产生的误判 |
|---|---|---|
| GPT | 通用协调、工具执行、代码和跨领域整合；型号与 effort 形成能力—成本梯度 | 把 Codex 等 harness 的收益全部归给基础模型 |
| Claude | 长代码库理解、长周期实现、研究写作和独立审查 | 把审慎、解释充分等同于一定正确；忽略高 effort 的过度思考 |
| Gemini | 原生多模态、长文档、图像与高吞吐子任务 | 把能理解截图等同于具有稳定 UI 审美和产品判断 |
| Grok | 实时 Web/X 搜索、时效性研究和大范围线索发现 | 把检索到最新内容等同于基础知识可靠；忽略来源噪音 |
| Kimi | 中文知识工作、开放权重、长上下文、原生多模态和自主部署 | 把开放权重等同于低部署成本或无许可证约束 |
| DeepSeek | 低成本文本推理、批量执行、测试生成和私有部署 | 用旧检查点评测代表新版本；忽略与原生多模态模型的岗位差异 |

对应的官方资料包括 [OpenAI models](https://developers.openai.com/api/docs/models)、[Claude models](https://platform.claude.com/docs/en/about-claude/models/overview)、[Gemini models](https://ai.google.dev/gemini-api/docs/latest-model)、[Grok 4.6](https://docs.x.ai/developers/grok-4-6)、[Kimi K3](https://github.com/MoonshotAI/Kimi-K3) 和 [DeepSeek current models](https://api-docs.deepseek.com/quick_start/pricing/)。这些资料确认规格和厂商定位；横向岗位判断仍应由独立评测和内部任务补足。

### 1.5 合作记录比第一次印象更重要

公开资料形成的是先验画像。真正合作以后，需要把“这个模型很强”逐渐改写成更具体的认识，例如：它在什么任务和配置下稳定、常怎样偏离边界、失败是否容易发现、需要多少提示与返工、与哪种评审方式配合更好。

画像的基本记录单位不是品牌，而是：

```text
模型 checkpoint
+ effort
+ 客户端/harness
+ 工具与权限
+ 上下文策略
+ Provider 与日期
+ 任务类型和验证结果
```

只要其中重要条件发生变化，过去的结论就应降低置信度，而不是继续当作稳定性格。

## 二、岗位来自工作状态，不来自模型名称

认识 Agent 之后，还不能从模型名称直接跳到派工。一项“修复 Bug”的工作，在尚未复现、根因已经确认和准备合并时，需要的是完全不同的责任。

| 工作所处状态 | 当前需要的责任 | 更重要的 Agent 性质 | 管理上最怕发生什么 |
|---|---|---|---|
| 事实不足、问题模糊 | 探索证据，提出可证伪假设 | 问题分解、来源意识、愿意承认未知 | 过早选定一个听起来合理的解释 |
| 方向未定、选择影响大 | 比较方案，说明取舍和副作用 | 约束保持、全局判断、校准 | 用实现细节掩盖尚未作出的产品决定 |
| 方向明确、工作可验证 | 按边界实现或批量执行 | 范围纪律、工具可靠、成本与速度 | 顺手扩大范围或重做既定架构 |
| 结果重要、错误隐蔽 | 独立审查和寻找反证 | 不同视角、证据敏感、失败路径意识 | 复述实现者的解释而没有检查交付物 |
| 多项工作准备汇合 | 处理依赖、冲突和最终验收 | 全局状态、决策能力、集成责任 | 把各分支“分别通过”当成组合后仍然正确 |

由此形成的“负责人、探索者、实现者、评审者”只是一次任务里的责任，不是某个 Agent 的永久头衔。同一个 Agent 可以在一个阶段负责探索，在方向确定后退出；高成本模型也不需要从头到尾占据所有环节。

比较合理的经济关系通常是：把昂贵推理放在会改变方向、错误代价高的判断上，把大量执行交给边界清楚且容易验证的配置；多模态、实时检索和开放权重则根据工作现场进入，而不是按品牌排座次。

## 三、编排的核心是依赖、共享状态和决策权

一旦工作被分给多个 Agent，管理对象就从“有哪些成员”转向“这些工作怎样彼此发生关系”。是否能并行，取决于输出能否独立产生、是否存在共同判定器，以及是否争用同一份状态。

```mermaid
flowchart TD
  T["准备拆分的工作"] --> I{"各方向能否独立前进？"}
  I -->|"可以"| V{"是否有共同判定器？"}
  V -->|"有"| P["并行方案或实验<br/>共同基线，统一比较"]
  V -->|"没有"| R["并行研究<br/>分别取证，集中综合"]
  I -->|"不可以"| C{"依赖能否先稳定成契约？"}
  C -->|"可以"| S["接力或堆叠工作<br/>上游交付契约，下游继续"]
  C -->|"还不可以"| O["先保留单一所有者<br/>把接口或根因收敛"]
  P --> G["集成与独立验证"]
  R --> G
  S --> G
  O --> T
```

*图 3：先看依赖形状，再决定组织形式。多开 Agent 不是第一步；无法形成契约的共享问题，应先由明确所有者收敛。*

### 3.1 四种结构解决不同问题

| 依赖形状 | 合作结构 | 它利用的价值 | 必须保护的条件 |
|---|---|---|---|
| 多个独立方向 | 展开—汇合 | 扩大资料或问题覆盖 | 来源边界、去重、统一综合者 |
| 稳定的前后依赖 | 接力或流水线 | 让每个环节保持专注 | 可引用的交付物和明确上游版本 |
| 多个候选假设 | 并行竞争 | 降低过早锁定错误方向 | 相同基线、相同预算、共同判定器 |
| 重要且容易自证的结果 | 产出—质疑 | 引入不同训练和观察路径 | 评审独立、直接检查 diff 和证据 |

Anthropic 的多 Agent 研究系统适合把搜索空间横向拆开，同时也披露了约十五倍于普通聊天的 Token 消耗；其 C 编译器实验在任务锁、环境隔离和测试判定明确后较为稳定，而多个 Agent 聚集到同一目标时出现重复与覆盖。[Multi-agent research](https://www.anthropic.com/engineering/multi-agent-research-system)、[C compiler experiment](https://www.anthropic.com/engineering/building-c-compiler)

Karpathy 的 autoresearch 则展示了另一类结构：目标固定、变量较小、评价指标明确，因而能够低成本运行大量独立实验。[autoresearch notes](https://x.com/karpathy/status/2030777122223173639)

这些案例共同支持一个有限结论：多 Agent 的收益通常来自独立搜索或独立假设，而不是简单增加“总智力”。当共享状态和判断成本上升时，协调也会成为主要工作。

### 3.2 负责人维护的是工作关系

负责人未必亲自完成最多修改。它需要持续维护：哪些是事实、哪些仍是假设，谁拥有某个接口，哪些工作可以开始，哪些必须等待，以及最后由谁决定采纳。

这种责任可以压缩成一张很短的任务合同：

| 必须明确的内容 | 作用 |
|---|---|
| 目标与非目标 | 防止 Agent 用扩大范围掩盖困难 |
| 输入基线 | 保证不同工作建立在同一事实之上 |
| 所有权和允许修改范围 | 避免共享状态处于人人可改的状态 |
| 交付物 | 让下一位接到代码、证据或契约，而不是整段聊天 |
| 验证与停止条件 | 说明如何判断完成，以及什么时候应停下上报 |

任务合同不是为了把 Agent 变成机械执行器，而是把协作中最容易漂移的关系外显出来。

## 四、Git 把协作关系变成可引用的事实

多个 Agent 只通过聊天交换信息时，很难维持共同状态：决定散落在会话里，失败路径无法引用，接手者也不知道当前代码究竟基于哪个版本。

不同载体各自保存一种事实：

| 载体 | 适合保存 | 不适合替代 |
|---|---|---|
| 会话 | 探索、推理和临时讨论 | 当前代码状态和正式决定 |
| 任务/设计文档 | 目标、边界、接口和决定 | 实际发生的文件变化 |
| Git | 基线、修改、分叉、交接和集成历史 | 结果是否符合产品目标 |
| 测试与验收 | 可重复的正确性证据 | 为什么选择某个设计 |

在个人开发里，Git 常被当作版本控制；在多 Agent 开发里，它进一步承担共同基线、工作所有权、并发隔离、实验谱系和交接记录。

### 4.1 Git 对象与组织含义

| Git 对象 | 工程含义 | 多 Agent 协作中的含义 |
|---|---|---|
| commit | 带父关系的内容快照 | 可引用、可复现的工作事实 |
| base SHA | 一条工作的共同祖先 | 多个 Agent 认可的起点和比较基准 |
| branch | 指向提交的可移动引用 | 一项任务、假设或方案的演化路径 |
| worktree | 独立检出的目录 | 该路径自己的文件和运行现场 |
| diff | 两个状态之间的变化 | Agent 实际交付了什么 |
| merge/rebase | 组合或重放历史 | 接受依赖变化、进入共同成果的方式 |
| tag/release | 稳定引用 | 已验证、可发布或可恢复的里程碑 |
| remote ref | 远端可交换引用 | 设备和 Agent 共享已提交进度的会合点 |

Git 分支本质上是引用，并不隔离文件；worktree 提供独立目录，却不保证设计兼容。[Git branches](https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell)、[`git-worktree`](https://git-scm.com/docs/git-worktree)

### 4.2 提交图应当表达工作依赖

```mermaid
flowchart LR
  B0["B0<br/>共同 base SHA"] --> A1["A1<br/>接口契约<br/>worktree A"]
  B0 --> T1["T1<br/>独立测试<br/>worktree T"]
  A1 --> B1["B1<br/>依赖接口的实现<br/>worktree B"]
  A1 --> I["I<br/>集成候选"]
  T1 --> I
  B1 --> I
  I --> V["V<br/>合并状态下验证"]
```

*图 4：T1 可以从共同基线独立展开；B1 依赖 A1，应当让父关系表达依赖；三条工作只有进入 I 后重新验证，才知道组合是否成立。*

这里有三个重要区别：

1. `base SHA` 是比较基准。几个 Agent 都说“基于 main”并不足够，因为它们可能在不同时间取得了不同 main；
2. branch 表达任务或假设，不适合永久以 `agent-a`、`claude-1` 命名。Agent 可以更换，工作路径的含义应当保留；
3. 分支内测试通过，只说明它与自己的基线兼容。多个分支组合以后仍需要在集成状态重新验证。

Git 的 `merge-base` 可以确定提交之间的共同祖先，也是比较两条工作路径的基础。[`git-merge-base`](https://git-scm.com/docs/git-merge-base)

### 4.3 worktree 只隔离文件现场

独立 worktree 能避免一个 Agent 的未提交修改、生成文件和调试过程直接污染另一个 Agent。Codex App 和 Claude Code 都将 worktree 用作并行会话的隔离基础。[Codex app](https://openai.com/index/introducing-the-codex-app/)、[Claude Code worktrees](https://code.claude.com/docs/en/worktrees)

运行现场还可能通过 Git 之外的资源发生冲突：

| 冲突类型 | 例子 | 仅靠 worktree 是否解决 |
|---|---|---|
| 文件冲突 | 同时修改同一文件和相同行 | 部分解决；合并时仍需处理 |
| 语义冲突 | 分别设计出不兼容接口 | 不能 |
| 环境冲突 | 共用端口、数据库、测试账号、远程环境 | 不能 |
| 事实冲突 | 使用不同 base、不同数据或不同测试预算 | 不能 |

所以，一个完整的 Agent 工作现场除了 worktree，还可能需要独立端口、临时目录、数据库、测试数据和缓存命名空间。Git 保存历史，运行环境隔离负责让实验互不干扰。

### 4.4 共享热点需要短期所有权

数据库 Schema、迁移、核心接口、锁文件、生成配置和全局设计文档等热点资源，不适合由多个 Agent 在各自分支顺手改写。分支能够保存多份冲突历史，却不能替团队决定哪套契约有效。

更容易维持的关系是：先由一个明确所有者稳定契约并形成 commit，下游 Agent 基于该 commit 工作；契约需要变化时，先更新上游，再由依赖分支选择是否重放。所有权可以是一张任务卡或短期 lease，不一定需要复杂锁服务，但不能处于“人人都能改、没人负责集成”的状态。

### 4.5 堆叠分支表达前后依赖

如果实现 B 依赖尚未进入 main 的接口 A，B 应建立在 A 的提交之上，而不是假装两者可以从 main 独立并行。A 改变后，由 B 的所有者更新自己的分支并重新验证。

已经被其他分支依赖的公开历史不适合任意 rebase。重写会让下游的 base 失效；即便使用 `--force-with-lease` 检查远端是否出现未知更新，它也更适合分支所有者维护自己的工作，而不是多人共享分支的常规操作。[`git-rebase`](https://git-scm.com/docs/git-rebase)、[`git-push`](https://git-scm.com/docs/git-push)

### 4.6 checkpoint commit 是长任务的交接点

未提交修改只存在于一个 worktree，没有稳定身份，也无法被另一台设备准确引用。长任务如果一直等到最后才提交，一旦会话中断或更换 Agent，接手者仍要从混杂的工作树猜测意图。

适合交接的 checkpoint commit 不必代表最终完成，但应当是一个连贯的中间状态，并关联：完成内容、验证结果、已知缺口和下一项依赖。任务分支上的临时提交以后可以整理，协作过程中更重要的是存在可恢复、可比较的节点。

### 4.7 并行实验需要形成实验谱系

多个方案只有从同一 base 开始、使用同一数据和判定器，才有比较意义。每条实验分支最好只改变一个主要变量，并记录模型配置、运行命令、成本、延迟和指标；commit SHA 随后成为该结果的可复现身份。

胜出方案不一定要整分支合并。可独立采用的原子提交可以 `cherry-pick`；需要保留完整并行关系时可以使用 merge commit；只关心最终变更时可以 squash。三种方式表达不同的追溯取舍，不存在脱离仓库需求的唯一答案。[`git-cherry-pick`](https://git-scm.com/docs/git-cherry-pick)

### 4.8 跨设备交接包含三种不同状态

```mermaid
sequenceDiagram
  participant A as 设备 A / Agent 工作区
  participant R as Git remote
  participant P as 会话定位信息
  participant B as 设备 B / 接手 Agent
  A->>A: 形成 checkpoint commit C1
  A->>R: push task branch @ C1
  A->>P: 发送会话位置 + workspaceRevision C1
  P->>B: 告知会话来源和代码版本
  B->>R: fetch 对应 remote ref
  R-->>B: 返回已提交的代码事实
  Note over A,B: dirty 文件、本地数据库、依赖和运行环境不会因此自动同步
```

*图 5：会话接续、Git 代码同步和本机工作树迁移是三件事。只有提交并推送的代码能通过 remote ref 被另一台设备稳定取得。*

跨设备交接最好显式携带 repository、base SHA、head SHA、branch、dirty 状态和 upstream。接收设备先 `fetch` 远端事实，再决定检出分支或建立 worktree。AgentDesk 的 SessionPointer 已为 `workspaceRevision` 预留 Git commit 语义，但现有产品不负责自动同步项目或执行 Git 操作。

### 4.9 PR 和集成队列保存采纳过程

Git 提供提交图；PR、代码评审和 CI 在其上增加讨论、审批和自动验证。对多 Agent 工作而言，PR 最有价值的地方不是生成一段摘要，而是把任务目标、base/head、diff、测试和采纳决定放在同一个审查面上。

合并还需要顺序。几个分支都基于 B0 通过，不代表它们同时合并仍然通过。集成队列应当把每个候选更新到当前集成基准，重新运行必要测试，再决定进入 main。这里的串行不是并行失败，而是多个独立结果成为一个共同产品时不可省略的收敛过程。

### 4.10 客户端 Git 真正可以减少的是认知负担

如果未来独立开发工具在 Git 之上辅助多 Agent，它需要维护的最小关系更接近：

```text
taskId
+ repository
+ owner Agent/session
+ baseSha
+ branch
+ worktreePath
+ headSha / dirty
+ upstream / ahead / behind
+ dependencies / hot-resource lease
+ validation commands and results
```

客户端可以帮助创建工作区、分配端口、显示依赖和 dirty 状态、发现热点重叠、安排评审与集成顺序，并在清理 worktree 前确认提交和推送状态。它降低的是人必须记住的隐性关系。

自动 rebase、自动解决冲突、自动合并和自动删除工作区则属于另一层责任。它们会改变代码历史或丢失工作，需要单独的权限、恢复和产品审阅，不能从“方便管理”自然推导为默认行为。

### 4.11 Git 保存差异，不判断差异是否正确

没有文本冲突不代表没有语义冲突，漂亮的提交历史也不能证明方案符合产品目标。Git 的价值在于把基线、变化和分叉保存清楚，让测试、评审和负责人面对同一份事实作出判断。

## 五、验证把“完成”分成不同状态

多 Agent 工作中，“完成了”至少可能表示四种不同状态：

| 状态 | 已经具备的证据 | 仍然不能说明 |
|---|---|---|
| Agent 自报完成 | 有一段结果说明 | 实际文件和运行状态已经改变 |
| 已形成 commit | 变化可以引用和审查 | 变化能够正确运行 |
| 分支测试通过 | 与该分支基线兼容 | 与其他分支合并后仍然正确 |
| 集成与产品验收通过 | 共同状态下满足既定判定 | 上线后的全部真实环境都不会出现新问题 |

验证通常沿着证据强度推进：格式、编译、Lint 和类型检查先排除机械错误；单元测试检查局部行为；集成和真实环境测试检查组合结果；独立评审寻找需求遗漏和失败路径；产品或领域验收判断结果是否真的解决了原问题。

任务不同，判定器也不同。资料研究需要原始来源和日期；性能实验需要统一数据、基线与统计；UI 需要真实尺寸下的渲染和交互；跨设备能力需要物理设备与真实网络，不能用单机双端点代替。

### 5.1 评审应直接面对交付物

评审 Agent 更适合获得原始目标、base/head SHA、diff、测试结果和已知风险。实现者的解释可以帮助理解背景，但不应成为主要证据；否则评审者容易沿着同一叙事重复确认。

不同模型家族交叉评审有机会降低共同盲点，但“另一个模型没有发现问题”仍不是正确性证明。编译、测试、运行证据和人的产品判断各自承担不同责任。

### 5.2 失败也需要留下可复用结论

被放弃的分支可能说明某条路线为什么行不通、某项指标为什么无法提升，或者某个 Agent 在什么条件下容易失控。有解释价值的失败可以留下 commit、尝试内容、失败证据和放弃原因；worktree 可以清理，但不应让重要结论随会话一起消失。

## 六、历史结果反过来改进下一次派工

公开评测和模型卡只能提供初始认识。一个团队真正可靠的 Agent 档案来自自己的任务历史。

| 记录 | 形成的认识 |
|---|---|
| 模型 ID、effort、harness、工具、日期 | 这次观察究竟对应哪个工作配置 |
| 任务责任、依赖形状、base/head SHA | 它承担了什么工作，建立在什么事实上 |
| 成本、延迟、人工提示和管理时间 | 表面并行是否真的降低了总投入 |
| 测试、评审、返工和最终结果 | 它是自报成功，还是达到可交付标准 |
| 失败类型和恢复路径 | 它怎样犯错，错误是否容易被发现和纠正 |

长期以后，派工依据会从“听说某模型擅长代码”变成更具体的内部经验：谁适合在问题模糊时探索，谁在边界明确后执行稳定，哪种档位已经足够，哪些错误需要另一个训练路线才能发现，哪些任务拆分以后反而增加集成成本。

最终值得比较的不是 Token 单价，而是可交付结果的总成本：

```text
可交付结果总成本
= 模型与工具成本
+ 等待时间
+ 协调和管理时间
+ 验证时间
+ 返工与集成成本
```

模型、客户端或系统提示变化以后，过去画像的置信度也应随之下降。多 Agent 管理不是一次性找到正确排班，而是不断用结果校正对成员、任务和协作结构的认识。

## 结语

把多个 Agent 当成一支队伍，真正有用的不是把它们想象成完全像人的数字员工，而是承认它们存在可观察的能力差异，并让责任、依赖、工作现场和采纳决定都能够被追踪。

模型提供个体能力，任务状态决定临时岗位，依赖关系决定编排结构，Git 保存共同事实，验证决定结果能否进入共同成果，历史结果再修正下一次安排。缺少其中任何一环，多 Agent 都可能停留在多个彼此独立的会话，而没有形成持续的团队能力。

## 参考资料

### 多 Agent 与工程实践

- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- Anthropic, [Building a C compiler with a team of parallel Claudes](https://www.anthropic.com/engineering/building-c-compiler)
- Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/harness-design-long-running-apps)
- OpenAI, [Introducing the Codex app](https://openai.com/index/introducing-the-codex-app/)
- OpenAI, [How OpenAI uses Codex](https://openai.com/business/guides-and-resources/how-openai-uses-codex/)
- OpenAI, [Harness engineering](https://openai.com/index/harness-engineering/)
- Andrej Karpathy, [autoresearch experiment notes](https://x.com/karpathy/status/2030777122223173639)
- Boris Cherny, [larger-repository Agent workflow note](https://x.com/bcherny/status/2009878642256691704)

### Git

- Git, [Branches in a Nutshell](https://git-scm.com/book/en/v2/Git-Branching-Branches-in-a-Nutshell)
- Git, [`git-worktree`](https://git-scm.com/docs/git-worktree)
- Git, [`git-merge-base`](https://git-scm.com/docs/git-merge-base)
- Git, [`git-rebase`](https://git-scm.com/docs/git-rebase)
- Git, [`git-cherry-pick`](https://git-scm.com/docs/git-cherry-pick)
- Git, [`git-push`](https://git-scm.com/docs/git-push)

### 模型、档位与行为原则

- OpenAI, [Models](https://developers.openai.com/api/docs/models)
- OpenAI, [Model selection and reasoning](https://developers.openai.com/api/docs/guides/latest-model)
- OpenAI, [Model Spec](https://openai.com/index/our-approach-to-the-model-spec/)
- Anthropic, [Claude models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
- Anthropic, [Effort](https://platform.claude.com/docs/en/build-with-claude/effort)
- Anthropic, [Claude's Constitution](https://www.anthropic.com/constitution)
- Google, [Gemini latest models](https://ai.google.dev/gemini-api/docs/latest-model)
- Google, [Gemini thinking](https://ai.google.dev/gemini-api/docs/thinking)
- xAI, [Grok 4.6](https://docs.x.ai/developers/grok-4-6)
- xAI, [Multi-agent](https://docs.x.ai/developers/model-capabilities/text/multi-agent)
- Moonshot AI, [Kimi K3](https://github.com/MoonshotAI/Kimi-K3)
- DeepSeek, [Pricing and current models](https://api-docs.deepseek.com/quick_start/pricing/)
- DeepSeek, [Thinking mode](https://api-docs.deepseek.com/guides/thinking_mode/)

### 评测方法

- Artificial Analysis, [Intelligence benchmark methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking)
- METR, [Measuring AI ability to complete long tasks](https://metr.org/time-horizons/)
- Terminal-Bench, [Terminal-Bench 2.1 leaderboard](https://www.tbench.ai/leaderboard/terminal-bench/2.1)
- Stanford CRFM, [HELM Long Context](https://crfm.stanford.edu/helm/long-context/latest/)
- Stanford CRFM, [HELM Safety](https://crfm.stanford.edu/2024/11/08/helm-safety.html)
- Vals AI, [Evaluation methodology](https://www.vals.ai/methodology)
- OpenAI, [Why we no longer evaluate SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/)

## 审阅重点

本轮建议先审阅四件事：

1. 图 1 是否建立了全文稳定的认知主线；
2. 图 3 是否能帮助读者从依赖形状推导协作结构，而不是记忆一组流程；
3. 图 4、图 5 是否把 Git 的任务拓扑和跨设备交接讲到了足够深度；
4. 模型表格是否已经成为派工先验，而没有重新变成品牌排行榜。
