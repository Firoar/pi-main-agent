---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user with focused, high-impact questions until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it. Do not interrogate the user about implementation details that do not change the outcome.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask no more than three high-impact questions in one round: number each question and give your recommended answer and why it matters. Then wait for the user's answers before the next round. Group smaller or dependent questions into later rounds.

If `ask_user_question` is available and the round has three or fewer bounded choices, use it once for the whole round. Put the recommended option first, label it `(Recommended)`, and describe the trade-off in each option. Use the custom-answer row for anything not covered. Do not stack multiple calls, do not use it for open-ended questions, and do not use it as a reason to ask fewer questions. If it is unavailable, use the numbered text format below.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

Do not answer material decisions yourself or silently assume them. If a material question blocks progress, state the blocker and ask it plainly. The session is done when the frontier is empty: every relevant branch of the design tree visited, nothing material left silently assumed. Do not act on a grilling plan until the user confirms shared understanding.
