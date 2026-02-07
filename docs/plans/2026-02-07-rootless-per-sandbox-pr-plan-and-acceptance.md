# agent-rig 分阶段 PR 实施方案与验收标准（更新版）

## 1. 文档目标

本文件定义从当前实现迁移到 `rootless-per-sandbox` 的完整 PR 执行路径，覆盖以下整体目标：

- 提供对 coding agent 友好的隔离运行环境，sandbox 内具备高自治执行能力。
- 支持 Docker/Compose 工作流，允许在 sandbox 内启动项目依赖容器与项目服务。
- 支持工具组合与复用（例如 `jvm17`、`node22`），并具备可控缓存机制。
- 支持 Linux 与 macOS（shared VM）双平台，且 Linux 不依赖嵌套虚拟化。
- 支持端口映射全生命周期管理，包含“已存在 sandbox 动态追加映射”。
- 提供清晰升级与回滚路径。

在上述整体目标基础上，本版本同时闭环 review 提出的关键风险：

- `arigd` 规格与落地顺序不清。
- Linux 用户管理与 root 权限模型不清。
- 端口转发机制未决策。
- macOS shared VM bootstrap/升级/修复缺失。
- 命令迁移集中在单个高风险 PR。
- 日志与诊断上线过晚。

配套文档：

- 方案总览：`docs/plans/2026-02-07-rootless-per-sandbox-design.md`
- `arigd` 细化：`docs/plans/2026-02-07-arigd-runtime-design.md`

## 2. 前置架构决议（编码前锁定）

## 2.1 `arigd` 通信与状态

- 传输：Unix socket + JSON-RPC。
- 运行态存储：SQLite + WAL（`~/.agent-rig/runtime/state.db`）。
- CLI 与 daemon 分离：`arig` 管配置态，`arigd` 管运行态。

## 2.2 Linux 权限模型

- `arigd` 常驻进程保持 rootless。
- 通过 `arig setup` 一次性安装受限 root helper（sudoers 白名单）。
- 仅“用户创建/删除、资源回收”等动作使用 helper。

## 2.3 端口转发机制

- 采用 `arigd` 内置 userspace TCP proxy。
- 首版只支持 `tcp`，避免内核特权依赖。

## 2.4 日志策略

- PR-01 即启用结构化日志（JSON）。
- 不是 GA 才补；调试能力从基础阶段开始可用。

## 3. 阶段与 PR 序列

### 阶段 A：基础设施落地（A0-A3）

- PR-01: Runtime 抽象层 + 结构化日志 + 命令迁移波次1（低风险命令）
- PR-02: Sandbox 配置模型升级（runtime/tools/ports）
- PR-03: `arigd` 核心骨架（daemon、协议、状态库、reconcile 框架）
- PR-04: Linux 权限路径（`arig setup` + root helper）与安全边界

### 阶段 B：Linux Beta（B1-B2）

- PR-05: Linux rootless-per-sandbox 生命周期 + 命令迁移波次2
- PR-06: Linux 动态端口映射数据面（userspace proxy）与在线追加

### 阶段 C：macOS Beta（C1-C2）

- PR-07: shared VM bootstrap/升级/修复 + VM 内 `arigd` 部署
- PR-08: macOS runtime driver + 双跳端口 relay

### 阶段 D：GA 收敛（D1-D2）

- PR-09: 工具组合缓存 v2（含失效策略）与 `node-22/java-17` 完整支持
- PR-10: 发布收口（文档、迁移、诊断、观测基线）

## 4. PR 详细定义

## PR-01 Runtime 抽象层 + 日志 + 命令迁移波次1

**目标**
- 完成 runtime 抽象落地，减少命令层直接依赖 `lima.ts`。
- 提前上线结构化日志，便于后续排障。

**主要变更**
- 新增 `src/lib/runtime/types.ts`
- 新增 `src/lib/runtime/index.ts`
- 新增 `src/lib/logging.ts`（JSON logger）
- 迁移低风险命令：`list/info` 先走 runtime 抽象

**测试要求**
- 单测：driver factory、日志格式。
- 集成：`list/info` 行为无回归。

**验收标准**
- runtime 抽象可用，命令行为稳定。
- 日志文件可输出 `requestId/sandbox/event/error` 基础字段。

## PR-02 配置模型升级

**目标**
- 扩展配置模型，支持 ports/runtime/tools。

**主要变更**
- 修改 `src/lib/types.ts`
- 修改 `src/lib/sandbox.ts`

**测试要求**
- 单测：新 config 读写幂等。

**验收标准**
- 新字段可正确持久化并被命令读取。

## PR-03 `arigd` 核心骨架

**目标**
- 把 `arigd` 从“概念”变为可运行组件。

**主要变更**
- 新增 `src/daemon/arigd.ts`
- 新增 `src/lib/runtime/daemon-protocol.ts`
- 新增 `src/lib/runtime/daemon-client.ts`
- 新增 `src/daemon/store/*`（SQLite state）
- 新增 `src/daemon/reconcile/*`（恢复框架）

**实现范围**
- 先实现 `runtime.ping/version`、`sandbox.inspect`、`port.list`。
- 建立启动、连接、超时、错误码规范。

**测试要求**
- 集成：CLI 可发现 daemon 并完成 ping/version。
- 故障：daemon 重启后可加载 state.db。

**验收标准**
- Linux 本机可稳定运行 `arigd` 并被 CLI 调用。
- 协议、状态库和错误码具备文档化定义。

## PR-04 Linux 权限模型与 `arig setup`

**目标**
- 明确并落地 root 需求边界。

**主要变更**
- 新增 `src/commands/setup.tsx`
- 新增 root helper 客户端/调用封装
- 新增最小 sudoers 模板与安装逻辑（安全校验）

**测试要求**
- 集成：未 setup 时创建 sandbox 给出明确错误。
- 集成：setup 后可执行用户创建/删除路径。

**验收标准**
- `arigd` 本体仍为 rootless。
- root helper 仅允许白名单操作，审计日志可查。

## PR-05 Linux rootless-per-sandbox 生命周期 + 命令迁移波次2

**目标**
- Linux 默认路径切换到 rootless-per-sandbox。
- 把核心命令迁移到 runtime 层，避免后置大爆炸迁移。

**主要变更**
- 新增 `src/lib/runtime/linux-rootless.ts`
- 新增 `src/lib/runtime/linux/*`（user/daemon/workspace/session）
- 迁移命令：`create/start/stop/destroy/attach/exec`

**测试要求**
- 集成：create -> exec docker -> stop -> start -> attach。

**验收标准**
- Linux 创建不再依赖 VM 与嵌套虚拟化。
- 核心命令均走 runtime 抽象。

## PR-06 Linux 端口映射数据面（userspace proxy）

**目标**
- 支持已存在 sandbox 在线追加端口映射。

**主要变更**
- 新增 `src/commands/port.tsx`
- 修改 `src/index.tsx` 注册 `port` 子命令
- 新增 `src/lib/ports.ts`
- 新增 `src/lib/runtime/linux/port-proxy.ts`
- 扩展 `info` 展示 `active/pending/error`

**行为要求**
- running 时 `port add` 立即生效。
- stopped 时 `port add` 记录 `pending`，start 后自动应用。
- `port remove` 运行中即时撤销。

**测试要求**
- 集成：运行中追加端口并可访问。
- 集成：停止态追加，启动后恢复。
- 冲突：端口占用时明确报错且不污染 active 状态。

**验收标准**
- 已存在 sandbox 支持动态端口追加（核心需求）。

## PR-07 macOS shared VM bootstrap/升级/修复

**目标**
- 解决 macOS 路径的初始化与长期维护问题。

**主要变更**
- 新增 `src/lib/runtime/macos/bootstrap.ts`
- 新增 `runtime init/status/upgrade/repair`（命令或子命令）
- VM 内 `arigd` 与 helper 的部署逻辑

**测试要求**
- 首次 init、二次 warm 启动。
- 版本不兼容时 upgrade 提示与恢复流程。

**验收标准**
- macOS 不再每 sandbox 建 VM。
- shared VM 状态漂移时有可执行修复路径。

## PR-08 macOS runtime driver + 端口 relay

**目标**
- 打通 host -> shared VM -> sandbox 的统一运行语义。

**主要变更**
- 新增 `src/lib/runtime/macos-sharedvm.ts`
- 新增 `src/lib/runtime/macos/relay.ts`
- `port add/remove/list` 在 macOS 驱动下可用

**测试要求**
- 集成：运行中/停止态端口映射行为与 Linux 对齐。
- 故障：relay 中断后的恢复与状态可见性。

**验收标准**
- macOS 与 Linux 端口映射语义一致。

## PR-09 工具缓存 v2 + 失效策略

**目标**
- 工具组合缓存可控、可失效、可追踪。

**主要变更**
- 扩展 `packages/` 与别名映射（`jvm17`、`node22`）
- 缓存 key 从“工具列表”升级为：
  - 工具列表 hash
  - 安装脚本内容 hash
  - 基础 runtime 版本

**测试要求**
- 单测：缓存 key 幂等与失效触发。
- 集成：脚本变更后可触发重建。

**验收标准**
- `java-17 + node-22` 可组合可复用。
- 缓存失效行为符合预期。

## PR-10 发布收口

**目标**
- 收敛文档、迁移与稳定性门禁，形成可发布版本。

**主要变更**
- 更新 `README.md`
- 更新 `docs/ARCHITECTURE.md`
- 补充迁移与排障文档
- 强化 `arig diagnose` 输出

**测试要求**
- Linux/macOS E2E 冒烟。
- 故障注入：daemon 崩溃、端口冲突、VM 不可达。

**验收标准**
- 具备独立安装、迁移、诊断能力。

## 5. 分级验收标准

## 5.1 PR 级通用门禁

- `npm run build` 成功。
- `npm run test:run` 全绿。
- 每个新能力都有测试用例。
- CLI 变更必须更新帮助文本与文档。

## 5.2 阶段门禁

### 阶段 A 完成标准

- `arigd` 可运行可连接，协议稳定。
- `arig setup` 权限路径可执行。
- 日志可用于排障（非空字段、可关联 requestId）。

### 阶段 B 完成标准（Linux Beta）

- Linux 核心生命周期命令走新 runtime。
- 已存在 sandbox 支持 `port add` 在线生效。

### 阶段 C 完成标准（macOS Beta）

- shared VM 可 init/upgrade/repair。
- macOS 端口 relay 与 Linux 语义对齐。

### 阶段 D 完成标准（GA）

- 文档、观测、回滚路径完备。
- 稳定性与性能达到阈值（见 5.3）。

## 5.3 量化指标

- Linux：
  - warm 创建 P50 <= 20s
  - attach（运行中）P50 <= 3s
- macOS：
  - warm attach P50 <= 5s
  - 端口追加至可访问 P50 <= 2s
- 稳定性：
  - 100 次 create/start/stop/destroy 成功率 >= 99%
  - 端口映射恢复成功率 >= 99%

## 5.4 最终功能验收清单

- sandbox 可执行 agent 自动任务与 Docker/Compose 工作流。
- 已存在 sandbox 可动态添加和删除端口映射。
- 端口映射状态可见（active/pending/error）。
- Linux 无嵌套虚拟化依赖。
- macOS 使用 shared VM 且可维护。

## 6. 风险与回滚

- 风险：root helper 配置错误导致创建失败。
  - 回滚：回退到上一稳定版本发布包，并重跑 `arig setup repair`。
- 风险：port proxy 稳定性不足。
  - 回滚：保持 pending，不中断 sandbox 主流程。
- 风险：shared VM 升级失败。
  - 回滚：保留上一个可用 VM 快照，CLI 提示降级运行。

## 7. 执行建议

- 每个 PR 控制净改动规模，优先小步快跑。
- 命令迁移分波次并行推进，不再保留单一“大迁移 PR”。
- 每阶段结束输出一次 Beta 里程碑报告（问题、风险、下一阶段入口条件）。
