# 猫猫庭院

猫猫庭院是账号与会话数据的可视化皮肤。它和经典名册共用同一份 profile、session、activity、quota 和 settings，不形成第二套业务状态。

## 数据映射

- 一个身份组对应一只猫；组内多个客户端槽位在账号控制条中切换。
- 猫名牌使用账号名，外观保存在 profile 的 `cat` 字段。
- 会话内容时间驱动 working/onduty/play/rest/nap/hibernate。
- 路径不存在或不可读时进入 confused。
- Codex 额度单独映射为 fresh/steady/tired/exhausted/unknown，不覆盖活动状态。
- 日/暮/夜和晴/云/雨/雪只是本地视觉氛围。

## 逻辑画布

- 固定逻辑尺寸：480 × 236。
- 画布按自然比例铺满横向场景，外层木框裁切超出区域。
- 角色脚底坐标用于命中、排序和拖放；名牌位于 HTML overlay。
- 保存位置会归一化并限界；旧位置落在已裁掉的前景带时回退默认布局。

## 拖放语义

拖动时才显示命中区域。放下只产生 intent，由 renderer 决定执行、确认或解释。

| 区域 | 行为 | 条件 |
|---|---|---|
| 工作亭 `workshop` | 打开账号；若已运行则聚焦状态 | 打开动作需要确认 |
| 池塘 `attention` | 聚焦当前会话详情 | 必须存在可选会话 |
| 树下草坪 `meadow` | 保存猫位置 | 无额外条件 |
| 普通地面 | 保存猫位置 | 无额外条件 |

庭院没有终端入口、任务队列、会话交接或远程执行区域。

## 模块

```text
src/yard/
  cats.js          活动信号 → 猫状态，外观归一化
  energy.js        额度 → 独立能量状态
  workload.js      今日工作量评分与排行
  companion.js     今日陪伴账本
  atmosphere.js    时间和天气纯函数
  interactions.js  三个命中区域与 drop intent
  palettes.js      场景配色
  sprites.js       程序化像素角色
  scene.js         Canvas 场景、overlay、拖拽与动画
  yard.css         庭院皮肤
```

Renderer 负责把主进程数据聚合为 scene 输入；scene 不访问文件系统，不调用 Electron IPC。

## 状态规则

`cats.js` 优先使用会话内容时间，不把文件 mtime 或 CPU 当成唯一工作证据：

- App 正在运行且会话 90 秒内活跃：working；
- App 正在运行但会话安静：onduty；
- 刚点击打开但尚未探测到进程：arriving；
- 未运行时按最近活动分为 play/rest/nap/hibernate；
- 全新空槽位保持 rest，不直接进入 hibernate。

`energy.js` 只接受新鲜且状态为 ok 的额度快照。已过 reset 边界或过旧的快照返回 unknown。

## 交互安全

- 动画完成不能触发系统动作。
- 拖放产生 intent，不直接启动 App。
- 需要副作用的打开动作必须由 renderer 走确认流程。
- 位置写入只更新 settings 中对应 profile 的一项。
- 未知区域一律退化为保存位置。

## 验证

相关测试：

- `test/cats.test.js`
- `test/energy.test.js`
- `test/atmosphere.test.js`
- `test/interactions.test.js`
- `test/ui.test.js`
- `test/workload.test.js`

美术资产约束见 [YARD_ART_ASSETS.md](YARD_ART_ASSETS.md)。
