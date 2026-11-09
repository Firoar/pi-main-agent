# Changelog

All notable changes to this project are documented here.

## [0.3.0] - 2026-11-09

### Added

- `pi-main add <source>` for trusted user-config extension management.
- `pi-main remove <source>` with normalized duplicate/path handling.
- `pi-main list` for configured extension sources and local availability.
- `--config <path>` and `--dry-run` for extension commands.
- Atomic `0600` config writes that preserve unrelated keys.

### Changed

- Extension commands never write project config, the packaged config, or global Pi settings.
- Local extension sources are canonicalized and must exist; `npm:`, `git:`, and HTTPS sources are validated without execution.

## [0.2.0] - 2026-11-09

### Changed

- Clarify supported tracker setup, tracker configuration confirmation, Git boundaries, domain documentation layout, handoff behavior, and the limits of executor-based orchestration.
- Correct vendored skill guidance to match available tracker operations and avoid nested worker spawning.
- Record that the vendored baseline's upstream commit was not captured rather than inventing a revision.
- Add structured `ask_user_question` rounds when available, with numbered chat fallback.
- Block GitHub tracker writes through the shell; require the `tracker_*` tools.

### Fixed

- Prevent tracker tool patterns from bypassing built-in write and shell guards; reject write-capable shell options and unsafe state paths.
- Keep planning writes in the active worktree while sharing project memory and handoffs. Make help, listing, and dry-run commands read-only.
- Persist tracker setup and apply it immediately, bootstrap missing GitHub labels, and use unambiguous local issue paths and canonical status updates.
- Interpret Pi context usage on its 0–100 scale, inject handoff instructions during tool loops, skip incomplete handoffs, and support explicit handoffs outside the default directory.
- Exclude backups and unrelated files from memory searches, refresh memory after changes, and avoid backup filename collisions.
- Isolate test fixtures from the user's Pi configuration and cover launcher, guard, tracker, memory, and worktree regressions.

## [0.1.0] - 2026-11-09

### Added

- `pi-main` launcher with a dedicated session directory and project state.
- Engineering-lead system prompt with grilling-first behavior.
- Docs-only guard:
  - planning-doc writes allowed
  - source/config writes blocked
  - read-only bash allowlist
  - GitHub tracker command allowlist
- Project-local memory extension:
  - `MEMORY.md`
  - `OPEN.md`
  - daily logs
  - explicit `memory_write` / `memory_read` / `memory_search` / `memory_forget` / `memory_status`
- Tracker extension:
  - GitHub issues via `gh`
  - local markdown fallback
  - MCP provider pass-through
  - native sub-issues/blocking on `gh` 2.94+, body fallback otherwise
- `/handoff` command and `pi-main --continue-from-handoff`.
- Vendored and adapted Matt Pocock skills:
  - `grilling`
  - `domain-modeling`
  - `grill-with-docs`
  - `setup-matt-pocock-skills`
  - `to-spec`
  - `to-tickets`
  - `wayfinder`
  - `research`
  - `prototype`
  - `handoff`
- Installer, package metadata, tests, and GitHub Actions CI.
