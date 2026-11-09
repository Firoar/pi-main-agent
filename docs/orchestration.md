# Delegated work protocol

This is a small operating protocol for the engineering lead, not a built-in scheduler. Execution requires an installed delegation extension that can start workers and return their results. Use only lifecycle operations that extension exposes; report any gap instead of pretending work is queued, observed, cancelled, or resumed.

## Before delegation

1. Check `tracker_status` and confirm the configured tracker can represent the work. For MCP, inspect the configured server's actual tools; do not infer capabilities from its name.
2. Confirm a delegation tool is available. If Pi exposes `tool_search`, search for the executor (for Herdr, `subagent` and `subagents_list`) before concluding it is missing. `/main-status` labels searchable deferred tools without activating them. If it is not, leave the confirmed plan as a handoff.
3. Keep the tracker as the source of truth. Use one issue per independently verifiable slice, with explicit acceptance criteria and dependencies. Select only tickets whose blockers are resolved.
4. Do not delegate a ticket that still contains a material user decision. Ask the user, or mark the issue blocked with the unanswered question.

## Assignment contract

Send the executor one bounded task with:

- the full issue URL or canonical local issue path;
- repository and the worker's branch/worktree scope;
- task and acceptance criteria copied from the confirmed issue;
- repository instructions the worker must read;
- expected verification and known constraints;
- a request for a result in the executor response, not a message to a person.

The worker result must report: `status` (`complete`, `blocked`, `failed`, or `cancelled`), issue reference, concise summary, changed paths, checks run and outcomes, branch/worktree reference, PR URL if one was created, and unresolved risks/questions. A PR URL is a result pointer; it is not approval to merge.

## Bounded execution

- Run at most three workers concurrently, or fewer if the user or executor sets a lower limit. Start newly ready work only when a slot opens.
- Allow one retry for a failed or timed-out task after inspecting the failure and narrowing the assignment. A second failure stops automatic retries and returns the issue to the user with evidence.
- Before starting, check the issue and active worker references for an existing claim. When tracker updates are authorized, record a claim using `tracker_comment_issue` for GitHub/local or the configured MCP comment tool, with owner, executor/run reference, and timestamp. The latest claim or release comment determines ownership; do not maintain a second claim state through direct file edits. If claim state cannot be represented, say so and avoid duplicate execution.
- Keep dependencies in the configured tracker. Do not launch blocked work because a worker slot is free.

## Observe and verify

Wait for or inspect results using the installed executor's supported operations. Never report completion based only on a worker's assertion or an issue label. Compare the result with each acceptance criterion using read-only inspection of the available diff, artifacts, and check output. If criteria cannot be checked by the lead, ask a verifier worker when available or state clearly what remains unverified.

Keep implementation, PR creation, merge, and release as separate actions. A user request to implement may authorize the worker to produce a branch or draft PR when that is part of the agreed acceptance criteria; it does not authorize merging or releasing. Obtain approval for those steps unless the user already explicitly authorized them.

Close an issue only after its acceptance criteria are verified and only when tracker updates are within the user's authorization. Include the evidence in the resolution. A worker saying "done" is not sufficient.

## Interrupted work and handoff

For blocked, failed, timed-out, cancelled, or interrupted work, preserve the tracker issue and record the state in the handoff: worker/executor reference, branch or worktree, last observed result, retry count, blocker, and next action. Release a claim with a tracker comment when authorized, including the outcome and timestamp. Do not start a replacement worker until checking the latest claim/release comments and whether the prior worker is still active. On resume, inspect those active references first and continue or cancel only through supported executor operations.

Tracker comments, issue edits, and notifications are external writes. Use them only when the user explicitly requested that tracker action or authorized it as part of the confirmed workflow. Deliver ordinary worker progress in the executor response; do not contact people through email, chat, or other messaging tools without explicit authorization.

## Pi Herdr Agents

Install the personal `pi-herdr-agents` checkout as a Pi package available to both
parent and children, and start `pi-main` inside Herdr. Adding only the host file
to this launcher's `extensions` does not install the team roles and skills in
child sessions. Do not install both the personal fork and the upstream package.

For the bundled team, launch `team-senior` with `persistent: true`, the source
repository's absolute `cwd`, a unique worktree branch, and the confirmed issue
criteria copied into the brief. Untracked `.scratch` tickets and planning files
are not copied into a new worktree. The default team models are pinned; pass
explicit authenticated model/thinking overrides when needed.

A `started` response only acknowledges acquisition. Results arrive automatically;
do not poll or tail session files. Answer a senior's `caller_ping` with
`subagent_send`, and use `subagent_stop` when the persistent senior is no longer
needed. Successful senior tasks call `subagent_done` and remain available. The
team does not push, create PRs, merge, or update the tracker.

Keep this parent process alive until results arrive. A fresh pi-main handoff does
not adopt an earlier process's live supervisors. Record outstanding run and
worktree references in the handoff before leaving. The pi-main guard, memory,
and tracker extensions disable themselves in `PI_SUBAGENT_ID` child contexts.
