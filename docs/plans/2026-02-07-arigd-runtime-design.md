# arigd Runtime 详细设计

## 1. 目标与范围

本设计定义 `arigd`（agent-rig data plane）的可实现规格，是 `rootless-per-sandbox` 总体方案的数据面落地文档。其目标是同时服务以下整体设计要求：

- 让 sandbox 具备稳定、可恢复、可观测的运行时控制能力。
- 保障 Linux 与 macOS(shared VM) 语义一致，降低跨平台维护成本。
- 支持 Docker/Compose 与动态端口映射等核心开发能力。
- 保持最小特权原则：业务运行 rootless，特权动作边界可审计。

在此基础上，`arigd` 解决以下具体工程问题：

- `arig` CLI 与实际运行时编排解耦。
- Linux 与 macOS(shared VM) 提供一致的 sandbox 生命周期语义。
- 支持 rootless-per-sandbox、动态端口映射、崩溃恢复、结构化日志。

非目标：

- 首版不实现 UDP 转发（仅 `tcp`）。
- 首版不实现多机/远程集群调度。

## 2. 部署拓扑

## 2.1 Linux

- `arig` CLI 通过 Unix socket 调用本机 `arigd`。
- `arigd` 以普通用户运行（不常驻 root）。
- 需要 root 的动作通过受限 helper 执行（见第 4 节）。

## 2.2 macOS

- Host 只运行 `arig` CLI。
- 单个 shared VM 内运行 `arigd`（Linux 进程）与受限 helper。
- Host 通过 SSH 控制通道访问 VM 内 `arigd` socket（可替换为 vsock）。

## 2.3 二进制与发布模型

- `arig` 与 `arigd` 使用同一个可执行文件，运行模式不同：
  - CLI 模式：`arig <command>`
  - Daemon 模式：`arig daemon serve`
- release 构建产物同时包含 host 与 Linux 目标：
  - host: `arig-darwin-*` / `arig-linux-*`
  - shared VM: `arig-linux-x64` 或 `arig-linux-arm64`
- macOS `runtime init/upgrade` 负责把 Linux 目标二进制推送到 shared VM：
  - 上传到临时路径并校验 checksum
  - 原子替换 `/usr/local/bin/arig`
  - `systemctl restart arigd.service`
- VM 内 systemd 单元统一执行 `arig daemon serve`，不引入第二套独立二进制发布链路。

## 3. 进程生命周期与监督

## 3.1 Linux

- 优先方案：`systemd --user` 管理 `arigd.service` + `arigd.socket`（socket activation）。
- 回退方案：`arig daemon start` 拉起前台/后台进程并写 PID 文件。

`arig` CLI 连接流程：

1. 检查 socket 是否可连。
2. 不可连时尝试 `systemctl --user start arigd.socket`。
3. 仍失败则回退 `arig daemon start`。
4. 最终失败返回明确诊断信息。

## 3.2 macOS shared VM

- VM 内使用 systemd 管理 `arigd.service` + `arigd.socket`。
- Host `arig` 负责确保 shared VM 已启动并可达。
- 不在 host 侧持久化 `arigd` 逻辑，减少双端状态分叉。

## 4. 权限模型（关键）

rootless-per-sandbox 的业务进程是 rootless，但“创建/删除 Linux 用户”仍需 root。方案如下：

## 4.1 一次性初始化

- 新增 `arig setup`（需 sudo）：
  - 安装 `/usr/local/libexec/arigd-root-helper`。
  - 安装最小 sudoers 规则，仅允许调用该 helper 的白名单子命令。
  - 创建 `arig` 组并授权当前用户。

## 4.2 运行期权限边界

- `arigd` 作为普通用户运行。
- 仅在以下操作调用 root helper：
  - `create-user`
  - `delete-user`
  - `ensure-slice`（可选 cgroup/slice）
  - `cleanup-resources`
- helper 限制：
  - sandbox 用户名必须匹配 `^arig_sb_[a-z0-9_-]+$`
  - 拒绝任意路径与 shell 插值参数
  - 所有命令记录审计日志

## 4.3 macOS 对应策略

- root helper 安装在 shared VM 内，由 VM 初始化阶段完成。
- Host 不直接获取 VM root shell。

## 5. API 设计

控制通道：

- Unix domain socket（Linux: `~/.agent-rig/run/arigd.sock`; VM: `/run/arig/arigd.sock`）
- JSON-RPC 2.0（请求/响应可追踪、易扩展、可复用 idempotency key）

客户端传输抽象（从首版即引入）：

```ts
interface DaemonTransport {
  request(req: JsonRpcRequest): Promise<JsonRpcResponse>;
  openStream(endpoint: StreamEndpoint): Promise<Duplex>;
}
```

- Linux：`LocalSocketTransport`
- macOS(shared VM)：`SSHTransport`（后续可扩展 `VsockTransport`）

核心方法（首版）：

- `runtime.ping`
- `runtime.version`
- `sandbox.create`
- `sandbox.start`
- `sandbox.stop`
- `sandbox.destroy`
- `sandbox.exec.run`（非交互）
- `sandbox.exec.startSession`（交互）
- `sandbox.attach.startSession`（交互）
- `sandbox.inspect`
- `port.add`
- `port.remove`
- `port.list`
- `runtime.gc`

请求约束：

- 所有写操作支持 `requestId`（幂等键）。
- 超时、取消、重试语义明确（客户端指数退避）。

## 5.1 交互操作（exec/attach）数据通道

`exec/attach` 不走 JSON-RPC 流式传输。约定如下：

1. CLI 先发 JSON-RPC 控制请求（`sandbox.exec.startSession` 或 `sandbox.attach.startSession`）。
2. `arigd` 创建 PTY，会返回 `sessionId` 与 `StreamEndpoint`。
3. CLI 通过 `DaemonTransport.openStream()` 连接该 endpoint，进入原始字节流模式。
4. 会话结束后，CLI 上报退出码并由 daemon 做资源回收。

补充：

- 非交互命令使用 `sandbox.exec.run`，返回 `exitCode/stdout/stderr`（有大小上限）。
- 超出上限或需要 TTY 时，CLI 自动切换到 session 模式。

## 6. 状态管理与崩溃恢复

采用“配置态 + 运行态”双层模型：

- 配置态：`~/.agent-rig/sandboxes/<name>/config.yml`（由 `arig` 管理）。
- 运行态：`~/.agent-rig/runtime/state.db`（SQLite + WAL，由 `arigd` 管理）。

`state.db` 建议表：

- `sandboxes`
- `daemons`
- `port_bindings`
- `proxies`
- `events`

恢复流程：

1. `arigd` 启动读取 `state.db`。
2. 扫描运行中的 sandbox daemon 与 proxy 进程。
3. 对齐配置态和运行态，执行 reconcile：
  - 缺失 listener -> 补建
  - 孤儿 listener -> 清理
  - 失败项 -> 标记 `error` 并写 `lastError`

周期性 reconcile：

- 启动后立即执行一次。
- 运行期每 60s 执行一次轻量 reconcile（可配置）。
- 关键事件后触发增量 reconcile（daemon crash、port apply 失败、runtime upgrade）。

## 7. 端口映射实现（已决策）

结论：采用 `arigd` 内置 userspace TCP proxy。

选择理由：

- 不依赖 `iptables/nftables` 与 `CAP_NET_ADMIN`。
- Linux/macOS(shared VM) 能共用一套语义与状态机。
- 故障诊断成本低（进程内可观测）。

行为定义：

- `port.add`（sandbox running）：即时创建 listener，状态 `active`。
- `port.add`（sandbox stopped）：写入 `pending`，下次 `start` 自动 apply。
- `port.remove`：运行中即时撤销；停止中仅更新配置。
- 默认 `bind=127.0.0.1`，`--public` 才允许 `0.0.0.0`。

## 8. macOS shared VM bootstrap 与升级

## 8.1 首次初始化

- `arig runtime init`：
  - 拉起 shared VM（Ubuntu 24.04）。
  - 安装 `arigd`、root helper、依赖工具。
  - 写入 VM schema/version 标记。

## 8.2 版本升级

- `arig` 与 VM 内 `arigd` 维护最小兼容矩阵：
  - CLI 向后兼容 `N-1` 的 daemon 协议。
  - 不兼容时提示执行 `arig runtime upgrade` 并阻止高风险写操作。

## 8.3 漂移与损坏恢复

- 健康检查失败次数超阈值时标记 VM 为 `degraded`。
- 提供 `arig runtime repair`：
  - 重建 `arigd` 组件
  - 保留 sandbox 配置，必要时执行资源重扫

## 9. 日志、审计与诊断

从首个基础 PR 即启用结构化日志：

- 日志格式：JSON 行日志。
- 位置：
  - Linux: `~/.agent-rig/logs/arigd.log`
  - VM: `/var/log/arigd.log`（或用户域日志目录）
- 字段最小集合：
  - `timestamp`, `level`, `component`, `sandbox`, `requestId`, `event`, `error`

审计事件：

- 用户创建/删除
- 端口映射增删
- root helper 调用结果

诊断命令：

- `arig diagnose`
- `arig runtime status`
- `arig runtime logs --tail 200`

## 10. Destroy 序列与部分失败处理

`sandbox.destroy` 固定执行顺序：

1. 锁定 sandbox（阻止并发 start/exec/port 操作）。
2. 停止并移除端口 listener/proxy。
3. 停止 rootless dockerd。
4. 结束 sandbox 用户进程（tmux/agent/孤儿子进程）。
5. 删除 workspace 与用户态 Docker 数据目录（按配置可保留快照）。
6. 通过 root helper 删除 sandbox 用户与相关 slice。
7. 清理 `state.db` 运行态记录。
8. 释放锁并写入最终审计事件。

部分失败策略：

- 每步单独记录 `stepStatus` 与 `lastError`。
- 可重试步骤（2/3/4/7）自动重试并带指数退避。
- 不可重试步骤（6）失败时标记 `destroy_degraded`，由 `runtime.gc` 补偿清理。
- destroy 对调用方返回“成功/部分成功/失败”三态，避免静默失败。

## 11. 失败模式与处理

- socket 不可连：自动拉起服务，失败则输出启动路径诊断。
- root helper 权限失败：明确提示执行 `arig setup`。
- 端口占用：`port.add` 返回冲突，不污染 active 状态。
- daemon 崩溃：标记 sandbox `degraded`，自动重试重启（限次）。
- shared VM 不可达：返回 platform-specific 建议（启动/修复）。
- destroy 中断：进入 `destroy_degraded`，`runtime.gc` 周期补偿。

## 12. 与现有代码的映射

建议新增：

- `src/lib/runtime/daemon-client.ts`（CLI 到 arigd 的 RPC 客户端）
- `src/lib/runtime/daemon-protocol.ts`（请求/响应类型）
- `src/lib/runtime/transports/*`（`DaemonTransport` 及实现）
- `src/daemon/arigd.ts`（服务入口）
- `src/daemon/services/*`（sandbox/ports/runtime 逻辑）
- `src/daemon/store/*`（SQLite 状态层）
- `src/daemon/root-helper-client.ts`
- `src/daemon/session/*`（PTY session 管理）

建议改造：

- `src/commands/create.tsx`
- `src/commands/start.tsx`
- `src/commands/stop.tsx`
- `src/commands/destroy.tsx`
- `src/commands/exec.tsx`
- `src/commands/attach.tsx`
- `src/commands/info.tsx`
- `src/commands/port.tsx`（新增）

## 13. 验收标准

- `arigd` 可在 Linux 独立启动、被 CLI 发现并调用。
- root helper 权限路径可控且可审计。
- 端口映射支持“已存在 sandbox 在线追加”。
- `arigd` 崩溃重启后可恢复运行态并与配置态一致。
- macOS shared VM 内 `arigd` 可升级与修复。
- `exec/attach` 可通过 session 通道稳定交互。
- destroy 支持部分失败可恢复，不遗留长期孤儿资源。
