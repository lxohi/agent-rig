# Architectural Review: Rootless Per-Sandbox Rebuild Plan (Round 2)

## Review Scope

This is the second review pass, covering the updated versions of:

- `2026-02-07-rootless-per-sandbox-design.md`
- `2026-02-07-rootless-per-sandbox-pr-plan-and-acceptance.md`
- `2026-02-07-arigd-runtime-design.md` (new)

---

## Round 1 Issue Tracker

All 6 critical/significant issues from the first review have been resolved:

| # | Original Issue | Resolution | Status |
|---|---|---|---|
| 1 | `arigd` daemon under-specified | Dedicated `arigd-runtime-design.md` with API, state, lifecycle, recovery | Closed |
| 2 | Linux user creation needs root | `arig setup` + root helper with sudoers whitelist (arigd doc Section 4) | Closed |
| 3 | No `arigd` PR in sequence | PR-03 (arigd skeleton) + PR-04 (permission model) added | Closed |
| 4 | PR-08 command migration landmine | Split into wave 1 (PR-01: list/info) + wave 2 (PR-05: core commands) | Closed |
| 5 | macOS shared VM bootstrap missing | arigd doc Section 8 + PR-07 dedicated to init/upgrade/repair | Closed |
| 6 | Port forwarding mechanism undecided | Decided: userspace TCP proxy in `arigd` (arigd doc Section 7) | Closed |

Suggestions also adopted: cache key now includes script hash + runtime version (PR-09), logging starts at PR-01, `runtime.gc` in API.

---

## New Issues (Round 2)

### 1. `arigd` binary distribution model is unspecified

**Severity: High**

The project compiles to a Bun binary. Is `arigd` the same binary invoked differently (e.g., `arig daemon start` forks itself), or a separate compiled binary? This matters critically for macOS where `arigd` must be deployed *inside* the shared VM. If it's the same binary, a Linux-compiled version must be pushed into the VM. If separate, a second build target is needed.

**Recommendation:** Add a "Binary & Packaging" subsection to the arigd doc specifying: same binary with subcommand mode, cross-compiled for VM deployment, and the mechanism for pushing the binary into the shared VM on updates.

### 2. Interactive operations (exec/attach) don't fit JSON-RPC

**Severity: High**

The API lists `sandbox.exec` as a JSON-RPC method, but exec is a streaming/interactive operation (stdin/stdout/stderr). JSON-RPC 2.0 is request/response — it has no native streaming. Similarly, `attach` (tmux) is fundamentally a PTY session, not an RPC call.

Options:
- `sandbox.exec` via JSON-RPC returns a PTY path or port, and the CLI connects directly.
- exec/attach bypass `arigd` entirely (CLI runs `su - arig_sb_<id>` via root helper or SSH).
- Add a streaming sidecar protocol alongside JSON-RPC.

**Recommendation:** Clarify in the arigd doc whether exec/attach go through the daemon at all, or if they are direct-path operations that bypass `arigd`. This affects the core API contract and must be decided before PR-05.

### 3. PR-03 and PR-05 are oversized

**Severity: Medium**

PR-03 includes: daemon entry point + JSON-RPC protocol + SQLite state layer + reconcile framework — 4 distinct subsystems. PR-05 includes: Linux rootless driver + 4 linux/* submodules + migrating 6 commands. Both will exceed the "每个 PR 控制净改动规模" guidance from Section 7.

**Recommendation:** Split PR-03 into:
- PR-03a: daemon skeleton + protocol + client (can ping/version)
- PR-03b: SQLite state layer + reconcile framework

Split PR-05 into:
- PR-05a: Linux rootless driver (create/destroy lifecycle only)
- PR-05b: start/stop/exec/attach + command migration wave 2

### 4. Transport abstraction for macOS is missing from the client design

**Severity: Medium**

`daemon-client.ts` needs to handle two transports:
- Linux: direct Unix socket connection
- macOS: SSH-tunneled or vsock connection to VM-internal socket

This isn't called out. The client should have a `DaemonTransport` interface from day one (PR-03), not retrofitted in PR-08. Otherwise PR-08 will require rewriting the client.

**Recommendation:** Define a `DaemonTransport` interface in PR-03 with a `LocalSocketTransport` implementation. PR-08 adds `SSHTransport` / `VsockTransport`. This is a small upfront cost that prevents a painful retrofit.

### 5. Legacy driver story has a gap between the two docs

**Severity: Medium**

The design doc removed `legacy-lima` from the driver enum and code module list. But the PR plan still references legacy compatibility (PR-05: "核心命令均走 runtime 抽象"). There is no PR that wraps the existing Lima path behind `RuntimeDriver`. This means:

- Existing sandboxes created with Lima cannot be managed after the migration, or
- There is an implicit assumption that users destroy and recreate.

**Recommendation:** Either add a `legacy-lima` driver in PR-01 (wrap existing `lima.ts` behind `RuntimeDriver` for backward compat), or explicitly state in the design doc that migration is destructive and existing sandboxes must be recreated. The current silence on this will confuse implementers.

### 6. Destroy cleanup sequence needs definition

**Severity: Medium**

`sandbox.destroy` must clean up in order: stop proxy listeners, stop dockerd-rootless, kill user processes, remove workspace, delete user account (via root helper), remove cgroup slice, purge state.db entries. Partial failure at any step leaves orphaned resources. The arigd doc mentions reconcile for port bindings but not for destroy.

**Recommendation:** Add a "Destroy Sequence & Partial Failure" subsection to the arigd doc with explicit step ordering and rollback/retry behavior per step.

---

## Minor Notes

- The design doc Section 9 (代码落地建议) no longer lists `src/daemon/*` files — it is out of sync with the arigd doc Section 11. Consider either removing Section 9 from the design doc (since the arigd doc covers it) or keeping them aligned.
- Consider adding periodic reconcile (e.g., every 60s) in addition to startup reconcile, to catch drift during long-running sessions.
- The `arig setup` flow should detect if it has already been run and be idempotent — worth noting in PR-04 acceptance criteria.
- The design doc Section 10 (实施路线) step 5 says "下线 core/template VM 模板路径" but no PR covers this deprecation. Either add it to PR-10 scope or remove the claim.

---

## Updated PR Assessment

| PR | Assessment |
|----|-----------|
| PR-01 | Good. Clarify whether a legacy-lima driver wrapper is included. |
| PR-02 | Clean and low-risk. Fine as-is. |
| PR-03 | Oversized — consider splitting into skeleton + state/reconcile. Add `DaemonTransport` interface. |
| PR-04 | Good. Add idempotency requirement for `arig setup`. |
| PR-05 | Oversized — consider splitting into lifecycle + command migration. Needs exec/attach transport decision first. |
| PR-06 | Good. Well-scoped. |
| PR-07 | Good. Needs binary deployment mechanism decided (see issue #1). |
| PR-08 | Good. Needs `DaemonTransport` from PR-03 to avoid client rewrite. |
| PR-09 | Good. Well-scoped. |
| PR-10 | Add legacy deprecation story if not covered elsewhere. |

---

## Summary

The updated plan is significantly stronger than round 1. The `arigd` design doc fills the biggest gap. The front-loaded architecture decisions (Section 2 of PR plan) and wave-based command migration are the right calls.

**Remaining items to resolve before coding:**

1. **Binary packaging model** — how `arigd` is built, distributed, and deployed into the macOS shared VM.
2. **exec/attach transport** — whether these interactive operations go through JSON-RPC, bypass the daemon, or use a sidecar protocol.
3. **Legacy sandbox migration** — explicit decision on backward compatibility vs. destructive migration.
4. **PR-03 / PR-05 sizing** — split to stay within manageable review scope.
5. **Destroy cleanup sequence** — ordered steps with partial-failure handling.
6. **`DaemonTransport` interface** — design for multi-transport from day one.

None of these are architectural blockers — they are specification gaps that can be closed with targeted additions to the arigd doc. The overall architecture is sound and ready for implementation once these are addressed.
