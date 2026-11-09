# Pi Herdr Agents compatibility

Compatibility pass from 2026-11-10.

This update lets `pi-main-agent` coordinate the bundled Herdr team while keeping
its planning state in the parent session. The Herdr host remains responsible for
execution and automatic child-result delivery; `pi-main-agent` remains the
planning parent and tracker owner.

## Parent/child split

- The guard, project memory, and tracker extensions register only when
  `PI_MAIN_AGENT=1` and `PI_SUBAGENT_ID` is unset.
- A delegated child can inherit the parent's environment and installed
  extensions without inheriting parent commands or access to planning memory and
  tracker tools.
- `/main-status` lists active delegation tools and searchable deferred tools
  while `tool_search` is active. Deferred entries are labeled with how to load
  them. Hidden tools and inactive tools that are not searchable through active
  `tool_search` remain out of the list.
- Status inspection does not change Pi's tool activation policy.

## Herdr setup

- Install the personal `pi-herdr-agents` checkout as a Pi package available to
  both parent and child Pi sessions. Adding only the host file to `pi-main`'s
  `extensions` loads it in the parent, not the team roles and skills in children.
- Do not install both the personal fork and the upstream package.
- Start `pi-main` inside Herdr.
- For the bundled team, launch `team-senior` with `persistent: true`, the source
  repository's absolute `cwd`, a unique worktree branch, and the confirmed issue
  criteria in the brief.
- Untracked `.scratch` tickets and planning files are not copied into a new
  worktree. The default team models are pinned; pass explicit authenticated
  model/thinking overrides when needed.

## Result lifecycle

- `started` only acknowledges acquisition. Results arrive automatically; do not
  poll or tail session files.
- Answer a senior's `caller_ping` with `subagent_send`.
- Use `subagent_stop` when the persistent senior is no longer needed.
- Successful senior tasks call `subagent_done` and remain available.
- The team does not push, create PRs, merge, or update the tracker.
- Keep the parent process alive until results arrive.
- A fresh `pi-main` handoff does not adopt an earlier process's live supervisors.
  Record outstanding run and worktree references in the handoff before leaving.

See [the delegation protocol](orchestration.md#pi-herdr-agents) for the operating
rules.
