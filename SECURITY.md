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
- It loads project memory and handoff paths that are private by default.
- It does not prevent another process running as the same user from editing files.
- It does not sandbox extensions, MCP servers, or delegation children.
- Project-local `pi-main.config.json` may only override `tracker`, `memory`, and `handoff`; it cannot add extensions or loosen the guard.
- Memory and handoff directories must resolve inside the project; symlink escapes are rejected.

Use OS permissions, a dedicated user, or a container if you need a hard security boundary.

## Secrets

Never commit:

- `.pi-main/` (memory, handoffs, temp issue bodies)
- API keys, tokens, or `gh` credentials
- personal `PI_MAIN_CONFIG` files containing private extension paths
- `node_modules/` or local logs

The project has no runtime npm dependencies. `gh` authentication is managed by the `gh` CLI, not this repository.
