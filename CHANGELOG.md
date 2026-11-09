# Changelog

All notable changes to this project are documented here.

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
