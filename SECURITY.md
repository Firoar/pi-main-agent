# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting:

https://github.com/Firoar/pi-main-agent/security/advisories/new

Please do not open a public issue for a vulnerability. Include:

- affected version or commit
- reproduction steps
- impact
- any suggested fix

## Security model

`pi-main` is a **launcher and tool-level guard**, not an operating-system sandbox.

- It blocks built-in `edit`/`write` outside planning paths.
- It restricts `bash` to a read-only allowlist.
- It blocks GitHub tracker writes through the shell; tracker writes use the `tracker_*` tools.
- It loads project memory and handoff paths that are private by default.
- The guard, memory, and tracker extensions disable themselves when `PI_SUBAGENT_ID` is set, so delegated child sessions do not inherit parent commands or planning-state tools even if the extensions are installed globally.
- It does not prevent another process running as the same user from editing files.
- It does not sandbox extensions, MCP servers, or delegation children.
- Project-local `pi-main.config.json` may only override `tracker`, `memory`, and `handoff`; it cannot add extensions or loosen the guard.
- Project-local tracker setup writes only `tracker.provider`, `tracker.localDir`, and `tracker.mcpServer`. Tracker tool permissions and MCP availability remain controlled by the user's trusted Pi configuration.
- `pi-main add` and `remove` edit only the trusted user config or an explicit `--config` file. They do not execute the extension or run `pi install`.
- Memory and handoff directories must resolve inside the project; symlink escapes are rejected.

Use OS permissions, a dedicated user, or a container if you need a hard security boundary.

## Secrets

Never commit:

- `.pi-main/` (memory, handoffs, temp issue bodies)
- `.scratch/` when it contains private local issues or research artifacts
- API keys, tokens, or `gh` credentials
- personal `PI_MAIN_CONFIG` files containing private extension paths
- `node_modules/` or local logs

The project has no runtime npm dependencies. `gh` authentication is managed by the `gh` CLI, not this repository.
