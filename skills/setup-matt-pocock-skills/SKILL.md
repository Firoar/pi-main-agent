---
name: setup-matt-pocock-skills
description: "Configure this repo for the engineering skills: set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills."
disable-model-invocation: true
---

# Setup Matt Pocock's Skills

Scaffold the per-repo configuration that the engineering skills assume:

- **Issue tracker**: where issues live (GitHub, local markdown, or a configured MCP server)
- **Triage labels**: the strings used for the five canonical triage roles
- **Domain docs**: where `GLOSSARY.md` and ADRs live, and the consumer rules for reading them

This is a prompt-driven skill, not a deterministic script. Explore, present what you found, confirm with the user, then write.

## Process

### 1. Explore

Look at the current repo to understand its starting state. Read whatever exists; don't assume:

- `git remote -v` and `.git/config`: is this a GitHub repo? Which one?
- Agent instructions in Pi's precedence order: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`; find the applicable file and whether it has an `## Agent skills` section.
- `GLOSSARY.md` and `GLOSSARY-MAP.md` at the repo root, legacy `CONTEXT.md` / `CONTEXT-MAP.md`, and established domain docs. If legacy files exist, report them and offer a migration plan; do not run `git mv` or mutate Git state. Preserve and map established domain docs rather than overwriting them.
- `docs/adr/`, `docs/domains/`, and established ADR directories, including any `src/*/docs/adr/` directories
- `docs/agents/`: does this skill's prior output already exist?
- `.scratch/`: a sign that a local-markdown issue tracker convention is already in use
- Is the `triage` skill installed? (a `triage` skill folder alongside this one, or `triage` in your available skills.) This decides whether Section B runs at all.
- Monorepo signals: a `pnpm-workspace.yaml`, a `workspaces` field in `package.json`, or populated packages with their own source. Treat these as clues, not proof of multiple domain contexts.

### 2. Present findings and ask

Summarise what's present and what's missing. Then take the sections in order. One section, one answer, then the next.

Lead each section with the recommended answer so the user can accept it in a word. Give a one-line explainer only when the choice genuinely branches; skip the section entirely when exploration already settled it (Section B when `triage` isn't installed, Section C when a single-context layout is clear and no user choice remains).

**Section A: Issue tracker.**

> Explainer: The "issue tracker" is where issues live for this repo. Skills like `to-tickets`, `triage`, and `to-spec` need to know whether to use the built-in GitHub or local tracker, or the issue tools exposed by a configured MCP server.

Offer only supported choices:

- **GitHub**: issues live in the repo's GitHub Issues (writes go through the guarded tracker tools)
- **Local markdown**: issues live as files under `.scratch/<feature>/issues/` in this repo
- **MCP**: an already-configured MCP issue server such as Linear; record its server name and use its exposed issue tools

If the repo has a GitHub remote, recommend GitHub; otherwise recommend local markdown. A GitLab remote does not make `glab` a supported built-in provider: use GitLab only when the user explicitly chooses an already-configured MCP server for it. Show a concise preview with the selected provider and `localDir` or `mcpServer`, then get user confirmation before changing persistent config or writing setup files. After confirmation, call `tracker_configure` with `{provider: "github"}`, `{provider: "local", localDir: ".scratch"}`, or `{provider: "mcp", mcpServer: "<configured server name>"}`. Never put `allowedTools` in project tracker configuration. The tool writes only the selected tracker fields to project config and bootstraps GitHub's `ready-for-agent` and required Wayfinder labels while preserving existing labels. If the tool fails or explicit `PI_MAIN_CONFIG` prevents this, report its result and stop before writing setup files.

Do not run `git init`, `git remote add`, `git mv`, or other Git state mutations. If a provider is not ready, explain the missing prerequisite and have the user perform it or specifically delegate that repository operation. Proceed only when the selected tracker is usable.

GitHub needs a reachable GitHub repo and authenticated `gh`. Check the repo with the read-only `gh repo view`; if it is not ready, explain that the user must configure it or delegate that operation. An MCP choice requires the named server and suitable issue tools to already be available in Pi. Local markdown needs no remote.

**Section B: Triage label vocabulary.** Skip this section entirely if the `triage` skill isn't installed (exploration told you), since an uninstalled skill needs no labels.

If it is installed, ask exactly one question:

> Do you want to keep the default triage labels? (recommended: **yes**)

The defaults are the five canonical roles, each label string equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. On **yes**, write them as-is. Only if the user says no, usually because their tracker already uses other names (e.g. `bug:triage` for `needs-triage`), collect the overrides so `triage` applies existing labels instead of creating duplicates.

**Section C: Domain docs.** Default to **single-context** (one root `GLOSSARY.md` plus system-wide `docs/adr/`) unless a context map or established multi-context docs already exist. New context docs use `docs/domains/<context>/` with `GLOSSARY.md` and `adr/`.

Offer multi-context only when exploration found multiple bounded contexts or an existing map; monorepo structure is a clue, not a requirement. Preserve established docs in place and point the map at them. Do not move or overwrite them as part of setup.

### 3. Confirm and edit

Show the user a concise draft preview of:

- The `## Agent skills` block to add to the first applicable Pi instruction file (see step 4)
- The contents of `docs/agents/issue-tracker.md`, `docs/agents/domain.md`, and `docs/agents/triage-labels.md` (the last only when `triage` is installed)

Let them edit before writing.

### 4. Write

**Pick the applicable file to edit**, in Pi's instruction precedence order: `AGENTS.override.md`, `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, then `CLAUDE.MD`. Edit only the first applicable file. If none exists, create `AGENTS.md`, which Pi loads by default. Preserve all surrounding user content.

If an `## Agent skills` block already exists in the chosen file, update its contents in-place rather than appending a duplicate. Don't overwrite user edits to the surrounding sections.

The block:

```markdown
## Agent skills

### Issue tracker

[one-line summary of where issues are tracked]. See `docs/agents/issue-tracker.md`.

### Triage labels

[one-line summary of the label vocabulary]. See `docs/agents/triage-labels.md`.

### Domain docs

[one-line summary of layout: "single-context" or "multi-context"]. See `docs/agents/domain.md`.
```

Include the `### Triage labels` sub-block, and write `docs/agents/triage-labels.md`, only when `triage` is installed and Section B ran. When it isn't, both are omitted.

`ready-for-agent` is required for agent-ready work independently of whether the optional `triage` skill is installed. GitHub setup bootstraps that label; local issues receive `Status: ready-for-agent`. For MCP, use a supported matching status/label if one exists; if not, report the limitation and do not claim the tracker marked work ready. Configure other triage-specific labels only when `triage` is installed and Section B ran. Do not create labels with shell commands.

Then write the docs files using the seed templates in this skill folder as a starting point:

- [issue-tracker-github.md](./issue-tracker-github.md): GitHub issue tracker
- [issue-tracker-local.md](./issue-tracker-local.md): local-markdown issue tracker
- [triage-labels.md](./triage-labels.md): label mapping (only if `triage` is installed)
- [domain.md](./domain.md): domain doc consumer rules + layout

For an MCP tracker, write `docs/agents/issue-tracker.md` with the configured server name, exposed issue tools, and tracker-specific conventions the user confirmed. Do not invent tool names.

### 5. Done

Tell the user the setup is complete and which engineering skills will now read from these files. Mention they can edit `docs/agents/*.md` directly later; re-running this skill is only necessary if they want to switch issue trackers or restart from scratch.

The GitHub label bootstrap is performed by `tracker_configure`; for local markdown, record issue and Wayfinder types in the issue file.
