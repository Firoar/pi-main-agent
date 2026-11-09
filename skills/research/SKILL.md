---
name: research
description: Investigate an assigned question against primary sources and return concise, cited findings.
---

# Research worker instructions

This skill is for the worker assigned a research question. Do the research yourself; never spawn or delegate to another worker.

1. Investigate the assigned question against primary sources: official documentation, source code, standards, specifications, or first-party APIs. Follow each material claim to the source that owns it.
2. Return a concise finding that answers the assigned question, with links/citations near the claims they support. Separate verified facts from inference and call out any uncertainty that remains.
3. Respect the assigned repository, branch/worktree, and output path. If the task specifies a Markdown artifact, write one file there and include its path in your result. If no path is specified, return the findings in the executor response instead of inventing a branch, pushing changes, or opening a PR.
4. Report `complete`, `blocked`, or `failed` and state what evidence or access is missing. Do not answer material user decisions on the user's behalf.
