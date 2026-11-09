---
name: handoff
description: Compact the current conversation into a handoff document for another agent to pick up.
argument-hint: "What will the next session be used for?"
---

Write a handoff document summarising the current conversation so a fresh pi-main session can continue the work. Save it at the absolute path provided by the `/handoff` command. If writing manually, use `<project root>/.pi-main/handoffs/` (create the directory if needed).

Include a "suggested skills" section naming which Pi skills the next agent should read and follow.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.
