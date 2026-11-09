# pi-main-agent

[![test](https://github.com/Firoar/pi-main-agent/actions/workflows/test.yml/badge.svg)](https://github.com/Firoar/pi-main-agent/actions/workflows/test.yml)

A launcher for **Pi** that turns it into an engineering-lead planning agent:

- uses focused clarification for clear tasks and Matt Pocock's grilling / domain-modeling workflow when decisions remain
- publishes confirmed requirements to the configured GitHub, local, or MCP tracker
- delegates implementation, research, and prototypes to worker subagents
- keeps a small project-local memory
- writes handoff files so a fresh main agent can continue when context fills

It is intentionally **not** installed globally as a Pi package. Only sessions started with `pi-main` load the lead prompt, guard, memory, and tracker extensions. Normal `pi` sessions are unchanged.

## Requirements

- Pi 1.5+ on `PATH`
- Node.js 22.19+
- `git`
- `gh` for the default GitHub tracker (authenticated with `gh auth login`)
- optional: `@juicesharp/rpiv-ask-user-question` for structured grilling questionnaires; without it, the lead uses numbered chat questions
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

The runtime default tracker is GitHub. The first time in a repo, run the one-time setup to choose and persist the provider:

```text
/skill:setup-matt-pocock-skills
```

Choose GitHub, local markdown, or an already configured MCP issue server. GitHub is recommended when the repo has a GitHub remote; otherwise setup recommends local markdown. Setup previews the selected settings and asks for confirmation before changing tracker configuration or writing setup files. It writes:

- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- an `## Agent skills` block in the first applicable Pi instruction file

When GitHub is selected, `tracker_configure` bootstraps the `ready-for-agent` and required Wayfinder labels while preserving existing labels.

If the repo has no GitHub remote yet, configure it yourself or delegate that exact Git operation before setup. The pi-main guard does not allow repository initialization or remote mutation. GitLab has no built-in `glab` provider; use it only through an already configured MCP issue server that exposes the needed tools.

## Core flow

```text
grill-with-docs / wayfinder
        ↓
requirements confirmed
        ↓
draft spec / tickets
        ↓
preview + confirmation when not already authorized
        ↓
publish issue(s)
        ↓
delegate worker with issue URL
```

Small work becomes one issue. Larger work becomes a spec issue plus child tracer-bullet tickets. Wayfinder maps are collapsed into a spec with `to-spec` when the route is clear.

When `ask_user_question` is available, bounded rounds use the structured questionnaire with recommended options. Open-ended questions, rounds with more than three questions, and headless runs fall back to numbered chat.

## Commands

| Command | Purpose |
|---|---|
| `/handoff [topic]` | Write `.pi-main/handoffs/<timestamp>-<topic>.md` |
| `pi-main --continue-from-handoff` | Start a fresh session from the newest handoff |
| `pi-main --continue-from-handoff <topic>` | Pick a handoff by topic fragment |
| `pi-main --handoff <file>` | Start from an explicit handoff file |
| `pi-main --list-handoffs` | List handoffs |
| `pi-main --main-help` | Show launcher help without starting Pi |
| `PI_MAIN_DRY_RUN=1 pi-main` | Print resolved launch configuration without starting Pi |
| `/main-status` | Show project, memory, tracker, delegation tools, context usage |
| `/skill:grilling` | Force the interview skill |
| `/skill:wayfinder` | Force the Wayfinder flow for a large effort |
| `pi-main add <source>` | Add a trusted extension source to the user config |
| `pi-main remove <source>` | Remove a trusted extension source |
| `pi-main list` | List configured extension sources |

## Managing extensions

`pi-main` keeps its extension list in the trusted user config:

```text
~/.config/pi-main/config.json
```

Add a local checkout, npm package, git source, or URL:

```bash
pi-main add /home/drc_xor/Desktop/code/pi-personal-herdr-agents
pi-main add npm:some-pi-extension
pi-main add git:github.com/example/pi-extension
pi-main list
```

Remove one:

```bash
pi-main remove /home/drc_xor/Desktop/code/pi-personal-herdr-agents
```

Preview without writing:

```bash
pi-main add --dry-run /path/to/extension
```

Behavior:

- writes only the trusted user config, or the file passed with `--config`
- uses `PI_MAIN_CONFIG` when set
- never writes project config or global Pi settings
- never runs `pi install`
- does not execute the extension during `add`
- requires local paths to exist and stores canonical paths
- deduplicates equivalent sources
- preserves unrelated config keys
- writes atomically with mode `0600`

Do not add `pi-personal-herdr-agents` to a repo config. Extension paths are trusted user configuration so a cloned repo cannot inject code.

`pi-main add` affects the parent session only. For Herdr team roles and skills in child sessions, install the package with `pi install -l` as described under [Delegation](#delegation).

## Context handoff

The main agent monitors context usage and warns at 70% / 85%. `--main-help`, `PI_MAIN_DRY_RUN=1`, and `--list-handoffs` are read-only and do not create project snapshots or state files. Automatic handoff selection skips drafts and incomplete handoffs; include substantive **Goal**, **Current state**, and **Next action** sections. Legacy handoffs without status frontmatter remain eligible when those sections are present.

When a phase ends or context gets heavy:

```text
/handoff auth-flow
```

Then:

```bash
pi-main --continue-from-handoff
```

The new session reads the handoff and only the linked issues/ADRs needed for the next action, then summarizes the state. It continues work already authorized in the chat. If the handoff is the only record of authorization, it asks before changing files or delegating; it also asks when a material decision or new authorization is still needed.

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

In linked Git worktrees, planning documents stay in the active worktree. pi-main uses the main checkout root (the parent of the common `.git` directory) for project configuration, memory, and handoffs, so those state files are shared across worktrees. Default memory and handoff files are ignored by Git. If you configure custom memory or handoff directories, add them to `.gitignore` yourself if they should remain untracked; custom paths are not automatically ignored.

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

Linear/Jira through MCP (the server and issue tools must already be configured in Pi):

```json
{
  "tracker": {
    "provider": "mcp",
    "mcpServer": "linear"
  }
}
```

Setup persists only `provider`, `localDir`, and `mcpServer` in project config. It does not configure MCP permissions or tool allowlists. For MCP providers, the lead uses available configured MCP issue tools; the built-in `tracker_*` helpers explain that the MCP provider is active.

## Delegation

No delegation extension is hardcoded. Orchestration is a lead protocol over an installed executor; pi-main does not provide a built-in scheduler or job engine. It loads your normal global extensions, plus any sources added with `pi-main add`:

```bash
pi-main add /home/you/code/pi-herdr-agents
```

Examples:

- inside Herdr: add `pi-personal-herdr-agents` or `pi-herdr-agents`
- outside Herdr: add `pi-interactive-subagents` or `pi-subagents`
- or use any extension that exposes a `subagent` / `delegate` tool

Do not load two subagent extensions at once; they register the same `subagent` tool.

For the bundled Herdr team and child roles/skills, install the personal package where both parent and child Pi sessions load it:

```bash
cd your-project
pi install -l /home/drc_xor/Desktop/code/pi-personal-herdr-agents
```

`pi-main add` only loads the host extension in the parent session; it does not install team roles and skills into child sessions. Do not install both the personal fork and the upstream package.

If no delegation tool is available, use `tool_search` for the executor before concluding it is missing. The lead leaves the confirmed plan as a handoff instead of pretending to implement. The package’s orchestration protocol covers assignment, concurrency, retry, verification, and resume rules.

Parent guard, memory, and tracker tools disable themselves in `PI_SUBAGENT_ID` child contexts, even if the extensions are installed globally.

## Guard

Allowed writes:

- `GLOSSARY.md`, `GLOSSARY-MAP.md`
- `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`
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
- GitHub tracker writes through the shell; use `tracker_create_issue`, `tracker_comment_issue`, `tracker_close_issue`, or `tracker_configure`
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

## Pi Herdr Agents compatibility

Install the personal fork as a Pi package in the configuration used by parent and child Pi sessions, then run `pi-main` inside Herdr. `/main-status` includes delegation tools available through active `tool_search` and labels them deferred. The planning guard, shared-memory tools, and tracker tools are parent-only and stay disabled in delegated child sessions, even if their extensions are loaded.

See [the compatibility notes](docs/herdr-compatibility.md) and [the delegation protocol](docs/orchestration.md#pi-herdr-agents) for worktree briefs, automatic results, persistent seniors, and handoff limits.

## Links

- Repository: https://github.com/Firoar/pi-main-agent
- Issues: https://github.com/Firoar/pi-main-agent/issues
- Security: https://github.com/Firoar/pi-main-agent/security/advisories/new
- Changelog: [CHANGELOG.md](CHANGELOG.md)
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Herdr compatibility: [docs/herdr-compatibility.md](docs/herdr-compatibility.md)
