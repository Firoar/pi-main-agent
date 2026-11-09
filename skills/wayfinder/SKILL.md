---
name: wayfinder
description: Plan a large effort as decision tickets on the configured tracker, then resolve the open decisions one at a time.
---

When this skill names another skill, read that skill's `SKILL.md` from the installed skills directory. Follow the Orchestration protocol listed in Runtime paths for delegated work. Wayfinder is a dispatcher; research and prototype skills contain worker instructions, and a worker must not spawn another worker.

## Purpose

Use Wayfinder only when the destination is clear but the route still has substantial fog and spans more than one session. It maps decisions and investigations; it does not silently turn unresolved decisions into implementation tasks. For a small, clear effort, use the direct planning flow.

The map lives in the configured tracker and acts as an index. The issue tracker is the source of truth for decisions, ticket state, and dependencies. If no tracker is configured, ask the user to run `/skill:setup-matt-pocock-skills`.

## Map and tickets

Create one map issue with:

```markdown
## Destination
<what reaching the end of this map means>

## Notes
<relevant domain, skills, constraints, and preferences>

## Decisions so far
<!-- one-line answers with links to resolved tickets -->

## Not yet specified
<!-- in-scope questions that cannot yet be stated precisely -->

## Out of scope
<!-- work ruled beyond the destination -->
```

Each decision ticket states one question under `## Question`. Give it a type: `research`, `prototype`, `grilling`, or `task`. On GitHub, use the matching `wayfinder:<type>` label and native parent/blocking relationships where the tracker supports them. In local markdown, use `Type:` and full relative issue paths for parent and blockers. For MCP, use only the relationships exposed by the configured tools and say when a capability is unavailable.

The frontier is the open, unblocked, unclaimed child tickets. A dependency is satisfied only when the blocker is resolved/closed. Sort local tickets by numeric prefix when choosing among equivalent frontier items. Refer to tickets by their title with a link, not by a bare number.

## Ticket types

- **Research (AFK):** a fact-finding task for primary sources. Assign it to one worker through the installed executor; the worker follows `research` and returns findings with sources. Do not ask that worker to spawn another worker.
- **Prototype (HITL):** a concrete rough artifact for the user to react to. Assign one worker using `prototype`; the worker builds the artifact, then the user and lead evaluate it.
- **Grilling (HITL):** resolve a decision through conversation with the user. The lead follows `grilling` and `domain-modeling` when appropriate; never answer on the user's behalf.
- **Task (HITL or AFK):** a concrete prerequisite that must happen before a decision can be made. Delegate only when authorized and suitable; otherwise give the user a precise checklist. Capture the resulting facts in the resolution.

## Chart the map

1. Establish the destination and scope with the user. Ask only about currently material decisions; group dependent questions into later rounds.
2. Look across the whole effort, then create tickets only for questions that can be stated precisely now. Put coarser unknowns under **Not yet specified** and explicit exclusions under **Out of scope**.
3. Show the proposed map and tickets. Publish only when the user has authorized publication; do not ask again for authorization already given.
4. Create the map and child issues, then add dependencies once their referenced issues exist. Use `tracker_create_issue` for GitHub/local or the configured MCP tools. Local issues use `.scratch/<effort>/issues/NN-<slug>.md`; use each full path returned by the tool as the stable identity. Do not use shell commands to write GitHub tracker state.
5. If research tickets are authorized for delegation, dispatch only the currently unblocked ones within the concurrency and retry limits in the Orchestration protocol. Capture results through the executor. Do not push branches, open PRs, or message people unless explicitly authorized.
6. Stop after charting; do not resolve HITL decisions during the same charting pass.

## Work through the map

Resolve at most one HITL decision ticket in a user-facing session. Authorized research workers may run in parallel within the Orchestration protocol's limit; they return facts for the lead and do not resolve HITL tickets.

1. Read the map first. Load only the chosen ticket and directly relevant artifacts; follow links progressively as needed.
2. If the user named a ticket, choose it. Otherwise choose an unblocked frontier ticket. Check for an existing claim before starting. When tracker updates are authorized, claim with `tracker_comment_issue` or the configured MCP comment tool, naming owner, executor/run reference, and timestamp. Use the latest claim/release comment as the ownership record, without direct file edits. If claims cannot be represented, state that limit and avoid duplicate execution.
3. Resolve the ticket according to its type. For a HITL ticket, keep the user in the decision loop. Research and prototype workers return results; they do not resolve user decisions.
4. Record findings and decision in the ticket. Close it only after the result or answer is checked. Update **Decisions so far** with a short pointer and answer gist, using a tracker comment when no supported edit operation exists.
5. Add newly specifiable tickets, wire their dependencies, and remove graduated items from **Not yet specified**. Close tickets ruled out of scope and record the reason under **Out of scope**.

Do not close a ticket just because a worker says it is done. Follow the Orchestration protocol for result inspection and verification. Treat closing, PR creation, merge, release, and external messages as separate actions with their own authorization requirements.
