/**
 * pi-main guard.
 *
 * - Blocks source-code writes and keeps bash read-only.
 * - Allows planning docs, issue body files, and handoff files.
 * - Adds /handoff and /main-status commands.
 * - Warns as the context window fills.
 *
 * This is a tool-level guard, not an OS sandbox. It makes the lead agent's
 * behaviour predictable; it does not protect against a malicious process
 * running as the same user.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
  checkWritePath,
  handoffDir,
  isSafeBashCommand,
  isTrackerTool,
  loadConfig,
  memoryDir,
  nowStamp,
  projectRoot,
} from "./lib.ts";

function isEnabled(): boolean {
  return process.env.PI_MAIN_AGENT === "1";
}

function delegationTools(pi: ExtensionAPI): string[] {
  const active = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .map((tool) => tool.name)
    .filter(
      (name) =>
        active.has(name) &&
        !name.startsWith("memory_") &&
        !name.startsWith("tracker_") &&
        /(^|_)(subagent|delegate|agent|task)/i.test(name),
    )
    .sort();
}

function formatPercent(usage: { percent: number | null; tokens: number | null; contextWindow: number } | undefined): string {
  if (!usage || usage.percent === null || usage.tokens === null) return "unknown";
  const pct = Math.round(usage.percent * 100);
  return `${pct}% (${Math.round(usage.tokens / 1000)}k / ${Math.round(usage.contextWindow / 1000)}k)`;
}

function slugify(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "handoff";
}

function handoffPath(topic: string, config = loadConfig()): string {
  const root = projectRoot();
  const dir = handoffDir(config, root);
  return path.join(dir, `${nowStamp().replace(/[: ]/g, "-")}-${slugify(topic)}.md`);
}

function handoffSkeleton(topic: string, ctx: ExtensionContext): string {
  const root = projectRoot();
  let session = "";
  try {
    session = ctx.sessionManager.getSessionId();
  } catch {
    // session id is optional
  }
  return `---
created: "${new Date().toISOString()}"
project: "${root}"
session: "${session}"
---

# Handoff: ${topic || "planning session"}

## Goal

## Current state

## Decisions
<!-- Link issues/ADRs/specs. Do not restate their bodies. -->

## Open frontier
<!-- Link the Wayfinder map, decision tickets, or spec. -->

## Next action

## Key files / commands

## Suggested skills

## What not to redo
`;
}

function handoffPrompt(file: string, topic: string): string {
  return `Fill in the handoff skeleton at: ${file}

The file already exists. Use this absolute path exactly, especially when running inside a git worktree. Replace the placeholder sections with the current state of this pi-main session.

Use this structure:
# Handoff: ${topic || "planning session"}

## Goal
## Current state
## Decisions
- Reference issues/ADRs/specs by number, URL, or path. Do not restate their bodies.
## Open frontier
- Link the relevant Wayfinder map / decision tickets / spec.
## Next action
One concrete next step.
## Key files / commands
Only what the next agent needs.
## Suggested skills
## What not to redo

Rules:
- Keep it short and reference durable artifacts instead of duplicating them.
- Update OPEN.md with unresolved questions that are not already in the issue tracker.
- Do not start new work.
- After writing the file, tell the user to run: pi-main --continue-from-handoff`;
}

export default function mainGuard(pi: ExtensionAPI): void {
  if (!isEnabled()) return;

  const config = loadConfig();
  let lastContextBucket = 0;

  function contextStatus(ctx: ExtensionContext): void {
    const usage = ctx.getContextUsage();
    const percent = usage?.percent ?? null;
    if (percent === null) return;

    const pct = Math.round(percent * 100);
    ctx.ui.setStatus("pi-main-context", `ctx ${pct}%`);

    const bucket = percent >= config.handoff.hardWarnAt ? 2 : percent >= config.handoff.warnAt ? 1 : 0;
    if (bucket > lastContextBucket) {
      lastContextBucket = bucket;
      const message =
        bucket === 2
          ? `Context is ${pct}% full. Run /handoff now, then start a fresh session with pi-main --continue-from-handoff.`
          : `Context is ${pct}% full. This is a good point to run /handoff before the next phase.`;
      if (ctx.hasUI) ctx.ui.notify(message, bucket === 2 ? "warning" : "info");
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    lastContextBucket = 0;
    const root = projectRoot();
    ctx.ui.setStatus(
      "pi-main",
      ctx.ui.theme.fg("accent", `main · ${path.basename(root)}`),
    );
    ctx.ui.setStatus("pi-main-memory", ctx.ui.theme.fg("muted", "memory: project"));
    contextStatus(ctx);
  });

  // Check before each model request rather than at turn boundaries. This keeps
  // the context warning out of the turn_end boundary path, which can be
  // fragile when a command starts a follow-up turn.
  pi.on("before_agent_start", async (_event, ctx) => {
    contextStatus(ctx);
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isTrackerTool(event.toolName, config)) return;

    if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
      const inputPath = event.input.path;
      if (!inputPath || typeof inputPath !== "string") {
        return { block: true, reason: "Blocked: write/edit call has no path." };
      }
      const check = checkWritePath(inputPath, config, projectRoot(), ctx.cwd);
      if (!check.allowed) {
        return { block: true, reason: check.reason ?? "Blocked by pi-main." };
      }
      return;
    }

    if (isToolCallEventType("bash", event)) {
      if (config.guard.bash === "unrestricted") return;
      if (config.guard.bash === "off") {
        return { block: true, reason: "Blocked: bash is disabled for pi-main." };
      }
      const result = isSafeBashCommand(event.input.command, config);
      if (!result.safe) {
        return { block: true, reason: result.reason ?? "Blocked by pi-main." };
      }
      return;
    }

    if (isToolCallEventType("powershell", event)) {
      return { block: true, reason: "Blocked: powershell is not part of the pi-main toolset." };
    }
  });

  pi.registerCommand("handoff", {
    description: "Write a handoff file for the next pi-main session",
    handler: async (args, ctx) => {
      const topic = args.trim();
      const file = handoffPath(topic, config);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, handoffSkeleton(topic, ctx), "utf8");
      pi.sendUserMessage(handoffPrompt(file, topic));
    },
  });

  pi.registerCommand("main-status", {
    description: "Show pi-main project, memory, tracker, delegation, and context status",
    handler: async (_args, ctx) => {
      const root = projectRoot();
      const usage = ctx.getContextUsage();
      const tools = delegationTools(pi);
      const lines = [
        "pi-main status",
        `project: ${root}`,
        `memory: ${path.relative(root, memoryDir(config, root)).split(path.sep).join("/")}`,
        `handoffs: ${path.relative(root, handoffDir(config, root)).split(path.sep).join("/")}`,
        `tracker: ${config.tracker.provider}`,
        `model: ${ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "unknown"}`,
        `context: ${formatPercent(usage)}`,
        `delegation: ${tools.length ? tools.join(", ") : "none detected"}`,
        `bash: ${config.guard.bash}`,
        "allowed writes:",
        ...config.guard.allowedWritePaths.map((p) => `  - ${p}`),
      ];
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // Keep the tracker honest: if the user runs pi-main in a repo with no
  // GitHub remote, tell them once rather than letting gh fail mid-flow.
  pi.on("session_start", async (_event, ctx) => {
    if (config.tracker.provider !== "github" || !ctx.hasUI) return;
    const result = spawnSync("git", ["remote", "-v"], { cwd: projectRoot(), encoding: "utf8" });
    const hasGithub = result.status === 0 && /github\.com/i.test(result.stdout || "");
    if (!hasGithub) {
      ctx.ui.notify(
        "pi-main: no GitHub remote detected. Tracker writes will fail; set tracker.provider to \"local\" in pi-main.config.json or add a GitHub remote.",
        "warning",
      );
    }
  });
}
