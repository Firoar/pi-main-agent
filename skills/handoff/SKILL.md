---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
---

Write a handoff document so a fresh pi-main session can continue the work. Save it at the absolute path supplied for the current session. If no path is supplied, use `<project root>/.pi-main/handoffs/` (create the directory if needed).

Use frontmatter `status: draft` while the handoff is incomplete. Mark it `status: complete` when it has substantive **Goal**, **Current state**, and **Next action** sections; complete describes the handoff, not completion of the project work. The launcher skips drafts and incomplete handoffs when choosing an automatic continuation.

Include a "suggested skills" section naming which Pi skills the next agent should read and follow.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Rehydrate progressively: list the direct tracker/artifact references and read only the material needed for the next action. Include active executor/worker references, branch or worktree, last observed result, retry count, blockers, and whether a follow-up remains when delegated work is active.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
