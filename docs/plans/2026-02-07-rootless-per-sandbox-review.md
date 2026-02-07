# Architectural Review: Rootless Per-Sandbox Rebuild Plan

## Overall Assessment: Solid design with a few gaps worth addressing

The plan is well-structured and addresses real pain points (Lima per-sandbox VM overhead, macOS cold-start latency, no port mapping, Linux nested-virt dependency). The phased PR approach is pragmatic. Below are findings, organized by severity.

---

## Critical Issues

### 1. `arigd` daemon is under-specified

The design introduces `arigd` as the runtime data plane — it manages sandbox lifecycle, rootless dockerd, port forwarding, and health checks. But neither document specifies:

- How `arigd` is installed, started, or supervised (systemd unit? launchd? self-daemonizing?)
- Its API surface (gRPC? HTTP? Unix socket? raw CLI calls over SSH?)
- Its state management (in-memory only? WAL? crash recovery?)
- How `arig` CLI discovers and connects to `arigd`

This is the single most important architectural component in the new design, yet it reads like a hand-wave. **Recommendation:** Dedicate a section (or a separate design doc) to `arigd` — its lifecycle, API contract, failure modes, and upgrade path. Without this, PR-04 through PR-07 will be designed ad-hoc.

### 2. Linux rootless sandbox user management requires root

The plan says "each sandbox creates an independent Linux user (`arig_sb_<id>`)." But `useradd` requires root. This contradicts the "rootless" premise. Options:

- Require `arig` to run as root (or with sudo) for create/destroy — but then document this clearly.
- Use user namespaces (`unshare --user`) to avoid real user creation — but this changes the isolation model significantly.
- Use a privileged setup daemon that only handles user creation.

The plan doesn't address this. **Recommendation:** Explicitly state the privilege model. Suggestion: a one-time `arig setup` that runs as root to configure sudoers rules for user management only, keeping the runtime rootless.

### 3. No `arigd` in the PR plan for Linux

PR-04 jumps straight to "Linux rootless-per-sandbox lifecycle" but the design says `arigd` is the runtime daemon managing all of this. There's no PR that implements `arigd` itself. Is `arigd` a real daemon on Linux, or does `arig` CLI directly manage users/daemons/ports? The design doc says one thing, the PR plan implies another. **Recommendation:** Either add a PR-03.5 for `arigd` core daemon, or clarify that on Linux `arig` CLI directly orchestrates (no daemon), and `arigd` only exists inside the macOS shared VM.

---

## Significant Concerns

### 4. PR-08 is a landmine

PR-08 ("Command migration & legacy compat") modifies 7 command files simultaneously to route through the runtime abstraction. This is the highest-risk PR in the plan — it touches every user-facing command at once. If something breaks, the blast radius is the entire CLI.

**Recommendation:** Don't batch this. Instead, migrate commands incrementally inside PR-01 and PR-04/PR-06. By the time you reach "PR-08," every command should already be migrated. PR-08 as described is a sign that PR-01's "局部改造命令" scope is too narrow.

### 5. macOS shared VM bootstrap is glossed over

The plan says "首次初始化 shared VM，后续复用" but doesn't address:

- What image does the shared VM use? Same Ubuntu 24.04 as current?
- How is `arigd` installed inside it? Baked into the image? Provisioned on first boot?
- How does the shared VM get updated when `arig` is updated?
- What happens if the shared VM's state drifts or corrupts?

This is the macOS-specific complexity that will eat your schedule if not designed upfront.

### 6. Port forwarding implementation strategy is missing

The design says what port forwarding should do, but not how. On Linux, the options are:

- `socat` / `ssh -L` per mapping (simple, process-per-port)
- `iptables` / `nftables` DNAT rules (efficient, requires CAP_NET_ADMIN)
- Userspace proxy in `arigd` (most control, most code)

On macOS, the "double-hop" relay adds another layer. **Recommendation:** Pick the mechanism now. Suggestion: userspace proxy (Go's `io.Copy` pattern or Node's `net.createConnection` pipe) for portability and debuggability, with no kernel privilege requirements.

---

## Design Suggestions

### 7. Consider skipping the shared VM on Apple Silicon with native containers

Apple's Virtualization.framework and the emerging container runtimes (e.g., `colima` with VZ backend, or even Docker Desktop's managed VM) mean the shared VM approach may be obsolete before you ship. At minimum, design the `RuntimeDriver` interface so a future `macos-native` driver can slot in without touching commands.

### 8. The `tools` hash-cache model needs a cache invalidation story

The plan says "根据工具集合计算 hash，命中缓存即复用." But what invalidates the cache when:

- A tool's install script changes (same name, new version)?
- The base image / provision script changes?
- A security patch needs to propagate?

**Recommendation:** Include the provision script version and tool installer content hash in the cache key, not just the tool name list.

### 9. Missing: resource cleanup and garbage collection

With per-sandbox users, each sandbox leaves behind:

- A Linux user account
- A `~/.local/share/docker` directory (potentially gigabytes of images/layers)
- cgroup slices
- Port forwarding processes

`destroy` needs to clean all of this up. The plan mentions `destroySandbox()` in the interface but doesn't detail the cleanup sequence. Leaked resources will accumulate fast in a system that creates/destroys sandboxes frequently.

### 10. Missing: observability and debugging

The plan mentions "审计日志" and "诊断命令" only in PR-10 (the last PR). In practice, you'll need logging from day one to debug the rootless Docker and port forwarding work in PR-04/PR-05. **Recommendation:** Add structured logging to `arigd` / the runtime layer in PR-01, not PR-10.

---

## PR Plan Sequencing Feedback

| PR | Assessment |
|----|-----------|
| PR-01 | Good starting point. Expand scope to migrate more commands through the abstraction. |
| PR-02 | Clean and low-risk. Fine as-is. |
| PR-03 | Fine, but ensure `ports.ts` validation logic is thoroughly tested — it's reused everywhere. |
| PR-04 | Needs `arigd` / privilege model resolved first. Highest technical risk. |
| PR-05 | Depends on forwarding mechanism choice. Specify it before coding. |
| PR-06 | Second highest risk. Needs shared VM bootstrap design. |
| PR-07 | Straightforward if PR-05 and PR-06 are solid. |
| PR-08 | Should not exist as a separate PR. Distribute into earlier PRs. |
| PR-09 | Low risk, can be parallelized with PR-06/07. |
| PR-10 | Fine for GA, but pull logging into PR-01. |

---

## Summary

**Strengths:**
- Correct diagnosis of current architecture's problems
- Clean separation of control plane (`arig`) and data plane (`arigd`)
- Per-sandbox isolation model is sound
- Phased rollout with rollback strategies per PR
- Legacy compatibility is well-considered

**Gaps to close before coding:**
1. Fully design `arigd` — API, lifecycle, supervision, crash recovery
2. Resolve the privilege model for user creation on Linux
3. Pick the port forwarding mechanism
4. Design the shared VM bootstrap and update story for macOS
5. Eliminate PR-08 by distributing command migration across earlier PRs
6. Add structured logging from PR-01, not PR-10

The bones are right. The risk is in the under-specified runtime layer — `arigd` is doing the heavy lifting but has no spec. Nail that down and the rest follows.
