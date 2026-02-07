# agent-rig 分阶段 PR 实施方案与验收标准

## 1. 文档目标

本文件给出可直接执行的分阶段 PR 计划，覆盖：

- 从当前 Lima VM 主路径迁移到 `rootless-per-sandbox`。
- 支持 Linux 与 macOS（shared VM）双平台。
- 新增端口映射能力，且支持对已存在 sandbox 动态追加。
- 每个 PR 的验收标准、测试要求与回滚策略。

配套设计文档：`docs/plans/2026-02-07-rootless-per-sandbox-design.md`

## 2. 里程碑与阶段划分

### 阶段 A（架构落地）

- PR-01: Runtime 抽象层 + legacy 适配
- PR-02: 数据模型升级（ports/runtime/tools）
- PR-03: `port` CLI 子命令与配置层落地

### 阶段 B（Linux 主路径可用）

- PR-04: Linux `rootless-per-sandbox` 生命周期
- PR-05: Linux 动态端口映射引擎（运行中即时生效）

### 阶段 C（macOS 主路径可用）

- PR-06: macOS shared VM 控制通道与 runtime 驱动
- PR-07: macOS 端口 relay 与持久化

### 阶段 D（体验收敛与 GA）

- PR-08: 命令迁移与 legacy 兼容闭环
- PR-09: 工具组合与缓存升级（node-22/java-17）
- PR-10: 发布收口（文档、观测、迁移工具）

## 3. PR 详细计划

## PR-01 Runtime 抽象层 + Legacy 适配

**目标**
- 去除命令层对 `lima.ts` 的直接强耦合，为新旧 runtime 共存打基础。

**主要变更**
- 新增 `src/lib/runtime/types.ts`
- 新增 `src/lib/runtime/index.ts`
- 新增 `src/lib/runtime/legacy-lima.ts`
- 局部改造命令，先接入 `runtimeFactory`（功能不变）

**接口建议**
- `RuntimeDriver.createSandbox(...)`
- `RuntimeDriver.startSandbox(...)`
- `RuntimeDriver.stopSandbox(...)`
- `RuntimeDriver.destroySandbox(...)`
- `RuntimeDriver.exec(...)`
- `RuntimeDriver.getStatus(...)`

**测试要求**
- 单测：driver factory、legacy driver 参数映射。
- 集成：`create/list/start/stop/destroy` 现有行为不回归。

**PR 验收标准**
- 所有现有命令对 legacy sandbox 行为一致。
- `npm run test:run` 全绿。
- 无新增 breaking CLI 参数。

**回滚策略**
- 保留原 `lima.ts`，可将 factory 默认固定回 legacy。

## PR-02 数据模型升级（ports/runtime/tools）

**目标**
- 扩展 sandbox 配置结构，支持 runtime 元数据和端口映射持久化。

**主要变更**
- 修改 `src/lib/types.ts`
- 修改 `src/lib/sandbox.ts`
- 新增兼容迁移函数（旧 config 自动补默认值）

**数据结构新增**
- `sandbox.runtime`
- `sandbox.tools`
- `sandbox.ports[]`

**测试要求**
- 单测：旧配置读取后自动补齐字段。
- 单测：新配置读写幂等（save/load 不丢字段）。

**PR 验收标准**
- 旧 sandbox 可正常 `list/info/start/stop`。
- 新增字段在 `config.yml` 持久化正确。

**回滚策略**
- 新字段均为可选，legacy 读取不受影响。

## PR-03 port CLI 子命令与配置层落地

**目标**
- 先完成控制面 API：新增/删除/查看端口映射，先以配置持久化为主。

**主要变更**
- 新增 `src/commands/port.tsx`
- 修改 `src/index.tsx` 注册 `port` 子命令
- 新增 `src/lib/ports.ts`（校验、冲突检测、序列化）

**命令形态**
- `arig port add <sandbox> --host <h> --target <t> --proto tcp`
- `arig port remove <sandbox> --host <h>`
- `arig port list <sandbox>`

**测试要求**
- 单测：参数校验、重复规则检测、`--host 0` 分配逻辑。
- 集成：对已存在 sandbox 执行 `port add/list/remove`。

**PR 验收标准**
- 已存在 sandbox 可成功写入端口配置。
- 错误输入有明确报错信息（端口范围、协议、重复冲突）。

**回滚策略**
- `port` 命令可 feature flag 控制隐藏，不影响主流程。

## PR-04 Linux rootless-per-sandbox 生命周期

**目标**
- Linux 上新建 sandbox 不再依赖 VM，跑在 rootless-per-sandbox。

**主要变更**
- 新增 `src/lib/runtime/linux-rootless.ts`
- 新增 `src/lib/runtime/linux/*`（用户、daemon、workspace、session）
- 命令层在 Linux 默认切换新 driver

**实现要点**
- 每 sandbox 独立用户与 rootless dockerd。
- 独立 `DOCKER_HOST` 与 `data-root`。
- start/stop 管理 daemon 与 agent session 生命周期。

**测试要求**
- 集成：Linux create -> exec docker -> stop -> start -> attach。
- 健康检查：daemon socket 可连接、`docker ps` 可执行。

**PR 验收标准**
- Linux 运行不依赖 KVM/嵌套虚拟化。
- 基础开发流程可用：git clone、docker compose、agent attach。

**回滚策略**
- 增加 `ARIG_RUNTIME=legacy-lima` 强制回退。

## PR-05 Linux 动态端口映射引擎

**目标**
- 在 Linux 实现端口映射运行态：运行中即时生效，停止后持久恢复。

**主要变更**
- 新增 `src/lib/runtime/linux/port-forward.ts`
- 修改 `start/stop/info` 命令关联端口状态
- `port add/remove` 调用 runtime apply/revoke

**实现要点**
- 运行中 `port add` 立即创建 listener。
- 停止中 `port add` 记录 `pending`，start 时 apply。
- 支持 `bind=127.0.0.1` 默认策略，`--public` 显式开启。

**测试要求**
- 集成：对运行中 sandbox 动态添加端口后可访问。
- 集成：sandbox 停止后添加端口，重启后自动生效。
- 冲突测试：端口占用时报错并不污染配置。

**PR 验收标准**
- 已存在 sandbox 的 `port add` 可在线生效。
- `port list` 能展示 `active/pending/error` 状态。

**回滚策略**
- runtime apply 失败时仅保留 pending 配置，不中断 sandbox 主流程。

## PR-06 macOS shared VM 驱动

**目标**
- macOS 统一迁移到 shared VM + rootless-per-sandbox 模型。

**主要变更**
- 新增 `src/lib/runtime/macos-sharedvm.ts`
- 新增 `src/lib/runtime/macos/*`（VM boot、通信、远程执行）
- 新增 `arig runtime init/status`（可选）

**实现要点**
- 首次初始化 shared VM，后续复用。
- `arig` 与 VM 内 `arigd` 建立稳定通道。
- sandbox 生命周期委托给 VM 内 Linux 逻辑。

**测试要求**
- 集成：macOS 首次初始化、二次热启动。
- 集成：create/start/exec/attach 正常。

**PR 验收标准**
- macOS 不再按 sandbox 创建 VM。
- warm 状态 attach 延迟达到预期阈值（见第 4 节）。

**回滚策略**
- 支持 `ARIG_RUNTIME=legacy-lima` 回退老路径。

## PR-07 macOS 端口 relay 与持久化

**目标**
- 打通 macOS 端口映射双跳链路，并确保重启恢复。

**主要变更**
- 新增 `src/lib/runtime/macos/port-relay.ts`
- `port add/remove/list` 支持 macOS driver
- 状态文件记录 relay listener 与映射关系

**实现要点**
- `macHost:hostPort -> sharedVM relay -> sandbox:targetPort`
- CLI 退出后 relay 不中断。

**测试要求**
- 集成：运行中动态加端口、停止后加端口并重启恢复。
- 异常：relay crash 自动恢复或状态可见。

**PR 验收标准**
- 与 Linux 语义一致：在线追加、持久化恢复、冲突可报错。

**回滚策略**
- relay 失败时降级为 pending，提示用户重试。

## PR-08 命令迁移与 legacy 兼容闭环

**目标**
- 所有命令统一走 runtime 层，legacy 与新 runtime 并存可用。

**主要变更**
- 改造 `src/commands/create.tsx`
- 改造 `src/commands/start.tsx`
- 改造 `src/commands/stop.tsx`
- 改造 `src/commands/destroy.tsx`
- 改造 `src/commands/exec.tsx`
- 改造 `src/commands/attach.tsx`
- 改造 `src/commands/info.tsx`（展示端口与 runtime）

**测试要求**
- 回归：所有命令帮助文本与基础交互稳定。
- 混合场景：legacy sandbox + 新 sandbox 同机操作。

**PR 验收标准**
- 用户不需要理解 runtime 差异即可完成日常操作。
- `info` 输出包含端口映射与状态。

**回滚策略**
- 按 sandbox 粒度选择 driver，不需全局回滚。

## PR-09 工具组合与缓存升级

**目标**
- 完成 `node-22`、`java-17` 组合能力及缓存复用。

**主要变更**
- 扩展 `packages/`（新增/升级工具定义）
- 新增工具别名解析（`jvm17 -> java-17`, `node22 -> node-22`）
- 调整 hash 与缓存策略（工具顺序无关）

**测试要求**
- 单测：工具解析、hash 幂等。
- 集成：不同顺序工具组合命中同一缓存。

**PR 验收标准**
- 典型组合可用：`java-17 + node-22`。
- 重复创建命中缓存，创建耗时明显下降。

**回滚策略**
- 工具安装失败不污染基础 runtime，可重试安装。

## PR-10 发布收口（文档、观测、迁移工具）

**目标**
- 形成可发布版本，补齐运维可观测与迁移说明。

**主要变更**
- 更新 `README.md`、`docs/ARCHITECTURE.md`
- 新增迁移文档（legacy -> rootless）
- 新增日志与诊断命令（可选 `arig diagnose`）

**测试要求**
- E2E 冒烟：Linux/macOS 主流程。
- 失败场景演练：端口冲突、daemon 失败、shared VM 不可达。

**PR 验收标准**
- 文档可独立指导安装、迁移、排障。
- 发布分支满足质量门禁（见第 4 节）。

**回滚策略**
- 发布包可快速切回上一版本，配置向后兼容。

## 4. 验收标准（分级）

## 4.1 PR 级通用门禁

每个 PR 必须满足：

- `npm run build` 成功。
- `npm run test:run` 全绿。
- 新增能力有对应测试（单测或集成测试）。
- 无未说明的 CLI 行为变更。

## 4.2 阶段门禁

### 阶段 A 完成标准

- Runtime 抽象存在且 legacy 可正常工作。
- `port` 配置能力可用（即使尚未全部运行时 apply）。

### 阶段 B 完成标准（Linux Beta）

- Linux create/start/stop/exec/attach 全链路可用。
- 运行中 `port add` 即时生效。
- 停止态 `port add` 在下次 start 自动生效。

### 阶段 C 完成标准（macOS Beta）

- shared VM 稳定复用，不按 sandbox 创建 VM。
- macOS 端口 relay 语义与 Linux 对齐。

### 阶段 D 完成标准（GA）

- 新旧 sandbox 并存可稳定运行。
- 文档、观测、迁移、回滚路径完备。

## 4.3 量化指标（建议）

- Linux：
  - warm 创建（同工具缓存命中）P50 <= 20s
  - `arig attach`（已运行）P50 <= 3s
- macOS：
  - shared VM warm 下 `arig attach` P50 <= 5s
  - 端口映射新增到可访问 P50 <= 2s
- 稳定性：
  - 连续 100 次 create/start/stop/destroy 成功率 >= 99%
  - 端口映射恢复成功率 >= 99%

## 4.4 功能验收清单（最终）

- 能创建 sandbox 并执行 agent 自动任务。
- sandbox 内可 `docker compose up` 启动依赖服务。
- 已存在 sandbox 可执行 `arig port add` 并立刻访问。
- 可查看端口状态并删除映射。
- 同时支持 Linux 与 macOS。
- 对 legacy sandbox 无破坏性回归。

## 5. 风险与应对

- 风险：rootless Docker 对部分场景兼容性不足。
  - 应对：保留可选增强 profile（未来可扩展 sysbox）。
- 风险：macOS relay 链路故障定位困难。
  - 应对：加入端口状态机与诊断日志。
- 风险：新旧路径并存增加复杂度。
  - 应对：driver 边界严格，legacy 冻结新功能。

## 6. 执行建议

- 合并节奏建议：每个 PR 控制在 300~800 行净改动（除测试外）。
- 强制要求：每个 PR 必带测试与迁移说明。
- 发布建议：阶段 B/C 先打 Beta tag，阶段 D 再 GA。

