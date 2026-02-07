# agent-rig 新方案设计（Rootless Per Sandbox）

## 1. 背景与目标

当前实现以 Lima VM 为中心，存在以下问题：

- 可维护性差：`provision` 脚本和 VM 生命周期深度耦合，改动半径大。
- macOS 启动慢：`core -> template -> sandbox` 多层 VM 克隆链路较长。
- Linux 受限：沿用 VM 路径，容易依赖嵌套虚拟化能力。
- 能力缺口：缺少端口映射管理，且无法对已存在环境动态追加映射。

本方案目标：

- 在 sandbox 内提供接近“无权限限制”的自动执行能力。
- 保持基础权限隔离（用户、资源、网络、文件边界）。
- 支持工具组合（如 `jvm17`、`node22`）并可缓存复用。
- 支持 macOS + Linux，且 Linux 不依赖嵌套虚拟化。
- 支持 Docker/Compose，允许 agent 拉起依赖容器和项目容器。
- 新增端口映射能力，要求已存在 sandbox 可追加端口映射。
- 提供明确升级策略：新架构切换为破坏式迁移，旧 VM sandbox 需重建。

## 2. 总体架构

采用 `控制面 arig CLI + 数据面 arigd runtime`：

- `arig`（Host）：
  - 负责命令、状态文件、用户交互。
  - 通过统一 `RuntimeDriver` 调用运行时，不直接耦合 Lima。
- `arigd`（Runtime）：
  - Linux：本机常驻服务。
  - macOS：运行于单个常驻 `shared VM` 内。
  - 负责 sandbox 生命周期、rootless dockerd、port forward、资源限制。

关键变化：

- sandbox 从“每个 sandbox 一个 VM”改为“每个 sandbox 一个用户 + 一个 rootless Docker daemon”。
- macOS 仅保留一个 shared VM，不再每个 sandbox 创建 VM。

## 3. 平台策略

### 3.1 Linux

- 默认后端：`linux-rootless`。
- 每个 sandbox 创建独立 Linux 用户（如 `arig_sb_<id>`）。
- 每个 sandbox 用户运行独立 `dockerd-rootless`（独立 `DOCKER_HOST`、独立 data-root）。
- 不使用 VM，不依赖嵌套虚拟化。

### 3.2 macOS

- 默认后端：`macos-sharedvm-rootless`。
- 启动一个常驻 shared VM（首启慢，后续热启动快）。
- 在 VM 内采用与 Linux 相同的 `rootless-per-sandbox` 模型。
- `arig` 通过 SSH/vsock 调用 VM 内 `arigd`。

## 4. Rootless Per Sandbox 设计

每个 sandbox 最小单元：

- `sandboxUser`: 独立 Linux 用户。
- `dockerd-rootless`: 独立 daemon 与 socket。
- `workspace`: 独立目录挂载。
- `session`: 独立 tmux/agent 进程。

隔离边界：

- 用户隔离：不同 sandbox 互不可见 home/workspace。
- 资源隔离：cgroup v2 约束 CPU/Memory/PIDs。
- 网络隔离：sandbox 出口受控，入口仅通过显式端口映射。
- 文件隔离：仅挂载所需目录，默认最小可写。

## 5. 工具组合（jvm17/node22）

将当前 `packages/` 机制升级为“工具声明 + 安装器插件”：

- 工具标识标准化：`java-17`、`node-22`（CLI 可接受别名 `jvm17`、`node22`）。
- 根据工具集合计算 hash，命中缓存即复用。
- 工具安装在 sandbox 用户域，避免全局污染。
- 保留 preset 语义：`--preset`、`--packages` 继续可用。

## 6. Docker 能力

每个 sandbox 拥有自己的 Docker daemon：

- `DOCKER_HOST=unix:///run/user/<uid>/docker.sock`
- `data-root=/home/<sandboxUser>/.local/share/docker`
- 支持 `docker compose up` 拉起 nginx/mysql/minio/项目容器。

优势：

- 故障域更小（单 sandbox daemon 异常不影响其他 sandbox）。
- 安全面更清晰（daemon 权限与 sandbox 用户一致）。
- 与跨平台架构一致（Linux 与 macOS shared VM 内行为统一）。

## 7. 新增能力：端口映射（重点）

### 7.1 需求定义

- 创建时可声明端口映射。
- 已存在 sandbox 可动态添加/删除端口映射。
- 映射应可持久化，重启后恢复。
- 避免端口冲突，支持自动分配端口。

### 7.2 CLI 设计

- `arig port add <sandbox> --host 18080 --target 8080 --proto tcp`
- `arig port remove <sandbox> --host 18080`
- `arig port list <sandbox>`
- `arig create ... --port 18080:8080/tcp --port 13306:3306/tcp`

可选参数：

- `--bind 127.0.0.1`（默认）
- `--public`（等价 `--bind 0.0.0.0`）
- `--host 0`（自动分配随机可用端口）

### 7.3 运行时行为

- sandbox 运行中：
  - `port add` 立即生效（创建 listener + forward 规则）。
- sandbox 停止中：
  - 规则写入配置为 `pending`。
  - 下次 `start` 自动应用并转 `active`。
- `port remove`：
  - 运行中立即撤销 listener。
  - 停止中仅更新配置。

### 7.4 平台转发路径

- Linux：
  - `host:hostPort -> sandbox:targetPort`
- macOS：
  - `macHost:hostPort -> sharedVM relay:vmPort -> sandbox:targetPort`
  - relay 由 `arigd` 管理，CLI 退出后仍持续。

### 7.5 冲突与错误处理

- 添加前检测 `hostPort` 占用。
- 同 sandbox 内禁止重复 `hostPort/proto`。
- 目标端口未监听不阻止配置写入，但标记健康状态为 `degraded` 并提示。

## 8. 数据模型改造

在 `SandboxConfig` 新增：

- `runtime`:
  - `driver` (`linux-rootless` | `macos-sharedvm-rootless`)
  - `sandboxId`
  - `sandboxUser`
  - `stateVersion`
- `tools: string[]`
- `ports: PortMapping[]`

`PortMapping` 建议结构：

```yaml
id: "pm_01J..."
hostPort: 18080
targetPort: 8080
protocol: tcp
bindAddress: 127.0.0.1
status: active   # active | pending | error
createdAt: "2026-02-07T12:00:00Z"
lastError: ""
```

状态分层：

- 配置态：`~/.agent-rig/sandboxes/<name>/config.yml`
- 运行态：`arigd` 内存态 + 本地 runtime 状态文件（pid、socket、listener）

## 9. 代码落地建议（面向当前仓库）

新增模块：

- `src/lib/runtime/types.ts`
- `src/lib/runtime/linux-rootless.ts`
- `src/lib/runtime/macos-sharedvm.ts`
- `src/lib/ports.ts`
- `src/commands/port.tsx`
- `src/daemon/arigd.ts`
- `src/daemon/services/*`
- `src/daemon/store/*`
- `src/lib/runtime/daemon-client.ts`
- `src/lib/runtime/transports/*`

改造模块：

- `src/lib/types.ts`：扩展 `SandboxConfig`、新增 `PortMapping`。
- `src/lib/sandbox.ts`：支持新字段读写与默认值处理。
- `src/commands/create.tsx`：改为调用 runtime 抽象，支持 `--port`。
- `src/commands/start.tsx`：启动时 apply pending ports。
- `src/commands/stop.tsx`：优雅回收转发进程。
- `src/commands/info.tsx`：展示端口映射状态。
- `src/index.tsx`：注册 `port` 子命令。
- `src/commands/exec.tsx`：改为 session 模式（非 JSON-RPC 流）。
- `src/commands/attach.tsx`：改为 session 模式（非 JSON-RPC 流）。

## 10. 实施路线

1. 引入 `RuntimeDriver` 抽象并切换命令层调用。
2. 上线 Linux `linux-rootless`。
3. 上线 macOS `shared VM` + `rootless-per-sandbox`。
4. 上线 `port` 子命令与 create 时 `--port`。
5. 下线 `core/template` VM 模板路径，统一到 runtime 模型。
6. 发布升级指南并执行破坏式迁移：备份后重建 sandbox。

## 11. 安全与运维要点

- 默认仅 `127.0.0.1` 绑定，降低误暴露风险。
- `--public` 需显式确认或配置白名单策略。
- 端口映射变更记录审计日志（谁在何时新增/删除）。
- daemon 崩溃自动拉起，超过阈值进入熔断并提示人工介入。

## 12. 验收标准

- Linux 上创建 sandbox 不依赖 KVM/嵌套虚拟化。
- macOS 在 shared VM warm 状态下可快速 attach。
- 已存在 sandbox 可执行 `arig port add` 并即时生效。
- 端口冲突有明确报错，`--host 0` 可自动分配端口。
- `java-17 + node-22` 可组合安装且具备缓存复用。

## 13. 风险与缓解

- 风险：rootless Docker 某些高级场景兼容性不足。
  - 缓解：保留可选增强 profile（后续可评估 sysbox）。
- 风险：macOS 双跳转发链路复杂。
  - 缓解：统一由 `arigd` 维护 listener 生命周期与健康检查。
- 风险：运行时能力增多导致代码复杂。
  - 缓解：driver 分层与模块边界清晰，按阶段收敛。
