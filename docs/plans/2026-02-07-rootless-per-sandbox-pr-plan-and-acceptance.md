# agent-rig 分阶段 PR 实施方案与验收标准（v3）

## 1. 文档目标

本文件定义从现有实现迁移到 `rootless-per-sandbox` 的完整执行路径，覆盖以下目标：

- 提供对 coding agent 友好的隔离运行环境，sandbox 内具备高自治执行能力。
- 支持 Docker/Compose 工作流，允许在 sandbox 内启动项目依赖容器与项目服务。
- 支持工具组合与复用（例如 `jvm17`、`node22`），并具备可控缓存机制。
- 支持 Linux 与 macOS（shared VM）双平台，且 Linux 不依赖嵌套虚拟化。
- 支持端口映射全生命周期管理，包含“已存在 sandbox 动态追加映射”。
- 提供清晰升级与回滚路径。

配套文档：

- 方案总览：`docs/plans/2026-02-07-rootless-per-sandbox-design.md`
- `arigd` 细化：`docs/plans/2026-02-07-arigd-runtime-design.md`

## 2. 前置架构决议（编码前锁定）

## 2.1 `arigd` 协议与状态

- 控制通道：Unix socket + JSON-RPC。
- 运行态存储：SQLite + WAL（`~/.agent-rig/runtime/state.db`）。
- CLI 与 daemon 分离：`arig` 管配置态，`arigd` 管运行态。

## 2.2 交互会话策略（exec/attach）

- `exec/attach` 不走 JSON-RPC 流式传输。
- JSON-RPC 仅负责 `startSession` 控制请求。
- 真实交互走 session 流通道（PTY stream），由 `DaemonTransport.openStream()` 建连。

## 2.3 Linux 权限模型

- `arigd` 常驻进程保持 rootless。
- `arig setup` 一次性安装受限 root helper（sudoers 白名单）。
- 仅“用户创建/删除、资源回收”等动作使用 helper。

## 2.4 端口转发机制

- 采用 `arigd` 内置 userspace TCP proxy。
- 首版只支持 `tcp`。

## 2.5 二进制与分发模型

- `arig` 与 `arigd` 使用同一二进制，不同运行模式。
- macOS shared VM 使用 Linux 目标二进制，由 `runtime init/upgrade` 推送与原子替换。

## 2.6 迁移策略

- 本次迁移为破坏式迁移，不承诺旧 Lima sandbox 继续可用。
- 升级前需备份并重建 sandbox。
- 发布文档必须提供升级前检查、备份与重建步骤。

## 3. 阶段与 PR 序列

### 阶段 A：基础设施与协议（A1-A5）

- PR-01: Runtime 抽象层 + 结构化日志 + 命令迁移波次1（`list/info`）
- PR-02: Sandbox 配置模型升级（runtime/tools/ports）
- PR-03a: `arigd` skeleton + JSON-RPC + client + `DaemonTransport`(local)
- PR-03b: `state.db` + reconcile（启动与周期）
- PR-04: Linux 权限路径（`arig setup` + root helper，幂等）

### 阶段 B：Linux Beta（B1-B3）

- PR-05a: Linux rootless driver 生命周期（create/start/stop/destroy）
- PR-05b: `exec/attach` session 通道 + 命令迁移波次2（`create/start/stop/destroy/exec/attach`）
- PR-06: Linux 端口映射数据面（userspace proxy）与在线追加

### 阶段 C：macOS Beta（C1-C2）

- PR-07: shared VM bootstrap/upgrade/repair + VM 内二进制部署
- PR-08: macOS transport + runtime driver + 双跳端口 relay

### 阶段 D：GA 收敛（D1-D2）

- PR-09: 工具缓存 v2（脚本 hash + runtime version）与 `node-22/java-17`
- PR-10: 发布收口（迁移文档、诊断、模板路径下线）

## 4. PR 详细定义

## PR-01 Runtime 抽象层 + 日志 + 命令迁移波次1

**目标**
- 完成 runtime 抽象与日志前置，建立后续改造骨架。

**主要变更**
- 新增 `src/lib/runtime/types.ts`
- 新增 `src/lib/runtime/index.ts`
- 新增 `src/lib/logging.ts`
- `list/info` 切换到 runtime 抽象

**测试要求**
- 单测：factory、日志格式。
- 集成：`list/info` 无回归。

**验收标准**
- 命令行为稳定。
- 日志包含 `requestId/sandbox/event/error`。

## PR-02 配置模型升级

**目标**
- 扩展 sandbox 配置：`runtime/tools/ports`。

**主要变更**
- 修改 `src/lib/types.ts`
- 修改 `src/lib/sandbox.ts`

**测试要求**
- 单测：新 config 读写幂等。

**验收标准**
- 新字段持久化正确。

## PR-03a `arigd` skeleton + transport 抽象

**目标**
- 先跑通 daemon 与控制通道，不引入状态层复杂度。

**主要变更**
- 新增 `src/daemon/arigd.ts`
- 新增 `src/lib/runtime/daemon-protocol.ts`
- 新增 `src/lib/runtime/daemon-client.ts`
- 新增 `src/lib/runtime/transports/DaemonTransport.ts`
- 新增 `src/lib/runtime/transports/LocalSocketTransport.ts`

**实现范围**
- `runtime.ping/version`。
- 错误码、超时、重试基线。

**测试要求**
- 集成：CLI 可连接 daemon 并完成 ping/version。

**验收标准**
- Linux 本机可稳定启动/连接 daemon。
- transport 接口可扩展到 macOS SSH/vsock。

## PR-03b `state.db` + reconcile

**目标**
- 引入运行态持久化与恢复框架。

**主要变更**
- 新增 `src/daemon/store/*`
- 新增 `src/daemon/reconcile/*`
- 接入启动 reconcile 与周期 reconcile（默认 60s）

**测试要求**
- 集成：daemon 重启后 state 恢复。
- 故障：漂移场景可被 reconcile 修正。

**验收标准**
- 运行态可恢复。
- reconcile 可观测（日志可追踪）。

## PR-04 Linux 权限模型与 `arig setup`

**目标**
- 明确 root 边界并提供稳定安装路径。

**主要变更**
- 新增 `src/commands/setup.tsx`
- 新增 root helper 客户端/调用封装
- 新增 sudoers 模板与安装逻辑

**测试要求**
- 集成：未 setup 时报错明确。
- 集成：setup 后创建/删除用户路径可用。
- 集成：重复执行 setup 幂等。

**验收标准**
- `arigd` 本体 rootless。
- helper 白名单与审计生效。

## PR-05a Linux 生命周期（不含交互流）

**目标**
- 打通 Linux rootless sandbox 生命周期主路径。

**主要变更**
- 新增 `src/lib/runtime/linux-rootless.ts`
- 新增 `src/lib/runtime/linux/*`（user/daemon/workspace）
- 接入 `sandbox.create/start/stop/destroy`
- 实现 destroy 清理序列（含部分失败状态）

**测试要求**
- 集成：create/start/stop/destroy 正常。
- 故障：destroy 中断后可由 `runtime.gc` 补偿。

**验收标准**
- Linux 创建不依赖 VM/嵌套虚拟化。
- destroy 不产生长期孤儿资源。

## PR-05b 交互会话 + 命令迁移波次2

**目标**
- 实现 `exec/attach` 交互通道并完成核心命令迁移。

**主要变更**
- 新增 `src/daemon/session/*`
- 接入 `sandbox.exec.startSession` / `sandbox.attach.startSession`
- CLI 通过 `DaemonTransport.openStream()` 进入 PTY 流
- 迁移命令：`create/start/stop/destroy/exec/attach`

**测试要求**
- 集成：`exec` 非交互/交互两种模式可用。
- 集成：`attach` 稳定连接并可退出。

**验收标准**
- 交互命令稳定，不依赖 JSON-RPC 传输原始流。

## PR-06 Linux 端口映射数据面

**目标**
- 支持已存在 sandbox 在线追加端口映射。

**主要变更**
- 新增 `src/commands/port.tsx`
- 修改 `src/index.tsx` 注册 `port` 子命令
- 新增 `src/lib/ports.ts`
- 新增 `src/lib/runtime/linux/port-proxy.ts`

**测试要求**
- 集成：运行中追加端口可访问。
- 集成：停止态追加，启动后恢复。
- 冲突：端口占用时报错且不污染 active 状态。

**验收标准**
- `port add/remove/list` 全链路可用。

## PR-07 macOS shared VM bootstrap 与二进制部署

**目标**
- 解决 macOS 路径初始化、升级、修复与二进制分发。

**主要变更**
- 新增 `src/lib/runtime/macos/bootstrap.ts`
- 新增 `runtime init/status/upgrade/repair`
- 实现 Linux 目标二进制推送与原子替换

**测试要求**
- 首次 init、warm 启动、upgrade、repair。
- 二进制校验失败时可回滚。

**验收标准**
- shared VM 可维护且升级链路清晰。

## PR-08 macOS transport + runtime driver + relay

**目标**
- 打通 macOS host -> shared VM -> sandbox 全链路。

**主要变更**
- 新增 `src/lib/runtime/transports/SSHTransport.ts`（可预留 vsock）
- 新增 `src/lib/runtime/macos-sharedvm.ts`
- 新增 `src/lib/runtime/macos/relay.ts`

**测试要求**
- 集成：`exec/attach` 流通道在 macOS 可用。
- 集成：端口映射语义与 Linux 对齐。

**验收标准**
- macOS runtime 与 Linux 行为一致。

## PR-09 工具缓存 v2

**目标**
- 工具缓存可失效、可追踪。

**主要变更**
- 扩展 `packages/` 与别名映射（`jvm17`、`node22`）
- 缓存 key 引入脚本 hash 与 runtime version

**测试要求**
- 单测：key 幂等、失效触发。
- 集成：脚本更新触发重建。

**验收标准**
- `java-17 + node-22` 可组合可复用。

## PR-10 发布收口与迁移

**目标**
- 形成可发布版本并明确破坏式迁移操作。

**主要变更**
- 更新 `README.md` 与 `docs/ARCHITECTURE.md`
- 新增升级前检查、备份、重建指引
- 下线 `core/template` VM 模板路径
- 强化 `arig diagnose`

**测试要求**
- Linux/macOS E2E 冒烟。
- 故障注入：daemon 崩溃、端口冲突、VM 不可达。

**验收标准**
- 文档可独立指导升级与重建。

## 5. 分级验收标准

## 5.1 PR 级通用门禁

- `npm run build` 成功。
- `npm run test:run` 全绿。
- 每个新能力都有测试用例。
- CLI 变更需更新帮助与文档。

## 5.2 阶段门禁

### 阶段 A 完成标准

- daemon 可运行可连接，协议稳定。
- `arig setup` 可重复执行且幂等。
- transport 抽象可复用于 macOS。

### 阶段 B 完成标准（Linux Beta）

- Linux 生命周期与交互命令走新 runtime。
- 已存在 sandbox 支持 `port add` 在线生效。
- destroy 部分失败可恢复。

### 阶段 C 完成标准（macOS Beta）

- shared VM 可 init/upgrade/repair。
- macOS 交互与端口映射语义与 Linux 对齐。

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
- 升级流程对破坏式迁移有明确操作指引。

## 6. 风险与回滚

- 风险：root helper 配置错误导致创建失败。
  - 回滚：回退到上一稳定版本发布包，并重跑 `arig setup repair`。
- 风险：port proxy 稳定性不足。
  - 回滚：保持 pending，不中断 sandbox 主流程。
- 风险：shared VM 升级失败。
  - 回滚：保留上一个可用 VM 快照，CLI 提示降级运行。

## 7. 执行建议

- 每个 PR 控制净改动规模，优先小步快跑。
- 03/05 明确拆分为 a/b 两段，降低审查风险。
- 每阶段结束输出 Beta 里程碑报告（问题、风险、下一阶段入口条件）。

