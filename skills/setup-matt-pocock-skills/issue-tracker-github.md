# Issue tracker: GitHub

Issues and specs for this repo live in its GitHub Issues. Use the `tracker_*` tools for writes; the guard does not permit GitHub write commands through the shell.

## Conventions

- Read a known issue with the approved `gh issue view <number>` read command.
- Create issues with `tracker_create_issue` only after the user confirms the preview. Pass `parent` and `blockedBy` when applicable; the helper uses supported native relationships or records fallback references.
- Add comments with `tracker_comment_issue` and close verified work with `tracker_close_issue`.
- For a Wayfinder map or decision ticket, apply its `wayfinder:<type>` label. Implementation tickets use `ready-for-agent` when fully specified and agent-ready.
- Do not use `gh api`, `gh issue edit`, `gh label create`, shell redirection, or shell commands to write tracker state. `tracker_configure` bootstraps `ready-for-agent` and required Wayfinder labels idempotently after the user confirms setup.

Check the target repository with `gh repo view` before the first issue is created. If the remote points to a fork or upstream repository that the user does not own, confirm the destination before publishing.

## Pull requests as a triage surface

**PRs as a request surface: no.** Change this setting only when the repo intentionally triages external pull requests as requests.

GitHub uses one number space for issues and pull requests. For an ambiguous `#42`, inspect whether it is a PR or issue before treating it as a ticket.

## Wayfinding operations

- The map is a GitHub issue labelled `wayfinder:map`.
- Each child decision ticket is a GitHub issue labelled `wayfinder:<type>` where type is `research`, `prototype`, `grilling`, or `task`; create it with `tracker_create_issue` and set `parent` to the map number.
- Set `blockedBy` at issue creation so the dependency is native where supported.
- The frontier is open child issues that have no open blockers and no active claim comment. Use available read-only issue views to inspect them; do not use blocked shell write commands to assign or edit labels.
- Claim with `tracker_comment_issue` only when the user authorized tracker updates. Include owner, executor/run reference, and timestamp; check the latest claim/release comment before replacing an assignment. If another session already claimed it, avoid duplicate work and coordinate through the executor or user.
- Resolve with `tracker_close_issue` and the answer as its final comment, then append a context pointer to the map's Decisions-so-far using `tracker_comment_issue`.
