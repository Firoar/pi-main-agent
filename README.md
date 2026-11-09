# pi-main-agent

[![test](https://github.com/Firoar/pi-main-agent/actions/workflows/test.yml/badge.svg)](https://github.com/Firoar/pi-main-agent/actions/workflows/test.yml)

A launcher for **Pi** that turns it into an engineering-lead planning agent:

- interviews you with Matt Pocock's grilling / domain-modeling workflow
- publishes confirmed requirements to GitHub issues (or local markdown)
- delegates implementation, research, and prototypes to worker subagents
- keeps a small project-local memory
- writes handoff files so a fresh main agent can continue when context fills

It is intentionally **not** installed globally as a Pi package. Only sessions started with `pi-main` load the lead prompt, guard, memory, and tracker extensions. Normal `pi` sessions are unchanged.

## Requirements

- Pi 1.5+ on `PATH`
- Node.js 22+
- `git`
- `gh` for the default GitHub tracker (authenticated with `gh auth login`)
- optional: a delegation extension such as `pi-subagents`, `pi-herdr-agents`, or your own

`gh` 2.94+ gives native sub-issues and blocking edges; the tracker helper uses them automatically. Older versions fall back to `Part of #...` and `Blocked by: #...` lines in the issue body.

## Install

```bash
git clone https://github.com/Firoar/pi-main-agent.git
cd pi-main-agent
./install.sh
```

This symlinks `bin/pi-main.mjs` to `~/.local/bin/pi-main`. No global `pi install` is performed.

Uninstall:

```bash
./install.sh --uninstall
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and [SECURITY.md](SECURITY.md) for the security model.

## Start

```bash
cd your-repo
pi-main
```

The first time in a repo, run the one-time setup:

```text
/skill:setup-matt-pocock-skills
```

Choose GitHub (recommended) or local markdown as the tracker. The setup writes:

- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- an `## Agent skills` block in `AGENTS.md` or `CLAUDE.md`

It also creates the Wayfinder labels when GitHub is used.

If the repo has no GitHub remote yet, run `git init` / `git remote add origin ...` yourself before setup. The pi-main guard allows read-only git commands and tracker writes, not repository initialization.

## Core flow

```text
grill-with-docs / wayfinder
        ↓
requirements confirmed
        ↓
draft spec / tickets
        ↓
preview + confirmation
        ↓
publish issue(s)
        ↓
delegate worker with issue URL
```

Small work becomes one issue. Larger work becomes a spec issue plus child tracer-bullet tickets. Wayfinder maps are collapsed into a spec with `to-spec` when the route is clear.

## Commands

| Command | Purpose |
|---|---|
| `/handoff [topic]` | Write `.pi-main/handoffs/<timestamp>-<topic>.md` |
| `pi-main --continue-from-handoff` | Start a fresh session from the newest handoff |
| `pi-main --continue-from-handoff <topic>` | Pick a handoff by topic fragment |
| `pi-main --handoff <file>` | Start from an explicit handoff file |
| `pi-main --list-handoffs` | List handoffs |
| `/main-status` | Show project, memory, tracker, delegation tools, context usage |
| `/skill:grilling` | Force the interview skill |
| `/skill:wayfinder` | Force the Wayfinder flow for a large effort |

## Context handoff

The main agent monitors context usage and warns at 70% / 85%. When a phase ends or context gets heavy:

```text
/handoff auth-flow
```

Then:

```bash
pi-main --continue-from-handoff
```

The new session reads the handoff, then the linked issues/ADRs/map, summarizes the state, and waits for confirmation before acting.

## Memory

Project-local, explicit-only:

```text
<repo>/.pi-main/
├── .gitignore          # memory/, tmp/, handoffs/
└── memory/
    ├── MEMORY.md       # preferences, facts, pointers
    ├── OPEN.md         # unresolved questions
    ├── daily/
    └── backups/
```

Memory is for agent context, **not decisions**. Decisions belong in issues and ADRs.

Only `pi-main` loads the memory tools, and the guard blocks its direct `edit`/`write` access to the memory directory. Other processes running as your user can still edit those files; use OS permissions or a container if you need a hard boundary.

In linked Git worktrees, the project root is the main checkout's common `.git` directory. Memory and handoffs are shared across worktrees.

## Tracker configuration

Default:

```json
{
  "tracker": {
    "provider": "github"
  }
}
```

Local markdown fallback:

```json
{
  "tracker": {
    "provider": "local",
    "localDir": ".scratch"
  }
}
```

Linear/Jira through MCP:

```json
{
  "tracker": {
    "provider": "mcp",
    "mcpServer": "linear",
    "allowedTools": ["mcp__linear__*"]
  }
}
```

For MCP providers, the lead uses the configured MCP issue tools. The `tracker_*` helper tools return an error explaining that the MCP provider is active.

## Delegation

No delegation extension is hardcoded. `pi-main` loads your normal global extensions, plus any paths in `extensions`:

```json
{
  "extensions": [
    "/home/you/code/pi-herdr-agents"
  ]
}
```

Examples:

- inside Herdr: point at `pi-personal-herdr-agents` or `pi-herdr-agents`
- outside Herdr: point at `pi-interactive-subagents` or `pi-subagents`
- or use any extension that exposes a `subagent` / `delegate` tool

If no delegation tool is available, the lead publishes the plan and stops with a handoff instead of pretending to implement.

## Guard

Allowed writes:

- `GLOSSARY.md`, `GLOSSARY-MAP.md`
- `AGENTS.md`, `CLAUDE.md`
- `docs/**`
- `.scratch/**`
- `plans/**`, `specs/**`
- `.pi-main/tmp/**`
- `.pi-main/handoffs/**`

Blocked:

- source code and config files
- `.git`, `node_modules`
- direct writes to `.pi-main/memory/` (use `memory_*` tools)
- destructive or write-capable shell commands
- arbitrary `gh api`

The guard is a behavioural boundary, not an OS sandbox. A different process running as your user can still edit files directly.

## Config reference

See `pi-main.config.json`. The trusted base config is loaded from:

1. `PI_MAIN_CONFIG` env var (full control)
2. `~/.config/pi-main/config.json`
3. this package's `pi-main.config.json`

A repo-local `pi-main.config.json` or `.pi-main/config.json` may override only `tracker`, `memory`, and `handoff`. It cannot add extensions, loosen the guard, or change the model. Those paths must also resolve inside the project, so a cloned repo cannot redirect memory or handoffs through a symlink.

Main keys:

| Key | Meaning |
|---|---|
| `extensions` | Extra extension paths or package specs loaded only by pi-main |
| `skills` | Skill directory names loaded from `skills/` |
| `tracker.provider` | `github`, `local`, or `mcp` |
| `guard.bash` | `off`, `read-only`, or `unrestricted` |
| `guard.allowedWritePaths` | Planning paths the lead may write |
| `memory.dir` | Project-local memory directory |
| `handoff.dir` | Handoff directory |
| `handoff.warnAt` / `hardWarnAt` | Context-warning thresholds |
| `model` / `thinking` | Optional overrides; default inherits Pi |

## Limitations

- GitHub planning is visible to anyone with repo access. Use a private repo or `local` tracker for sensitive work.
- `gh` older than 2.94 lacks native sub-issues/blocking; body conventions are used.
- The custom memory has keyword search only (no embeddings/qmd).
- The guard prevents accidental source edits, not a determined same-user process.
- The vendored Matt Pocock skills are MIT; see `skills/LICENSE`.

## Links

- Repository: https://github.com/Firoar/pi-main-agent
- Issues: https://github.com/Firoar/pi-main-agent/issues
- Security: https://github.com/Firoar/pi-main-agent/security/advisories/new
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
