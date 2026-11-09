# Contributing

## Development

Requirements:

- Node.js 22.19+
- Pi 1.5+
- `git`
- optional: `gh` for the GitHub tracker

Run the tests:

```bash
npm test
```

Check packaging and the installer:

```bash
npm pack --dry-run
node --check bin/pi-main.mjs
bash -n install.sh
```

Try the launcher in a throwaway repo:

```bash
cd /tmp
mkdir pi-main-dev && cd pi-main-dev
PI_MAIN_DRY_RUN=1 node /path/to/pi-main-agent/bin/pi-main.mjs
```

## Ground rules

- Do not commit `.pi-main/`, memory files, handoffs, or personal config.
- Keep the launcher opt-in. Do not turn this into a globally installed Pi package that loads the lead prompt and memory into every session.
- Keep the guard narrow. New allowed write paths or bash commands need a clear justification.
- Keep project-local config limited to `tracker`, `memory`, and `handoff`.
- Keep extension commands (`add`, `remove`, `list`) scoped to trusted user config or an explicit `--config` file. Never let them write project config or run `pi install`.
- Parent-only extensions must gate registration on `PI_MAIN_AGENT=1` and no `PI_SUBAGENT_ID`; add a child no-registration test when touching them.
- Keep setup aligned with the supported trackers: GitHub, local markdown, and already configured MCP issue servers. Do not add a built-in GitLab CLI workflow or tracker write shell examples.
- Reference issues/ADRs in memory and handoffs instead of duplicating them.
- Update `CHANGELOG.md` for user-visible changes.
- Keep delegation guidance honest: execution requires an installed executor extension; pi-main does not provide a scheduler.

## Skills

The skills under `skills/` are vendored from `mattpocock/skills` (MIT). If you update them:

- preserve the upstream license and attribution
- keep the Pi-specific adaptations documented
- do not re-add `disable-model-invocation` to skills the lead should invoke
- keep `setup-matt-pocock-skills` explicit-only

## Pull requests

Use the PR template. Include:

- what changed and why
- how you verified it
- any guard/security impact
- whether you tested a real `pi-main` session
