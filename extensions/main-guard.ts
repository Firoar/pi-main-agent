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
  contextUsageBucket,
  formatContextPercent,
  handoffDir,
  isSafeBashCommand,
  loadConfig,
  memoryDir,
  nowStamp,
  projectRoot,
} from "./lib.ts";

function isEnabled(): boolean {
  // These extensions belong to the planning parent, even if its environment
  // or globally installed extensions are inherited by a delegated Pi process.
  return process.env.PI_MAIN_AGENT === "1" && !process.env.PI_SUBAGENT_ID;
}

function delegationTools(pi: ExtensionAPI): string[] {
  const active = new Set(pi.getActiveTools());
  return pi
    .getAllTools()
    .filter(
      ({ name, exposure }) =>
        exposure !== "hidden" &&
        (active.has(name) || (exposure === "deferred" && active.has("tool_search"))) &&
        !name.startsWith("memory_") &&
        !name.startsWith("tracker_") &&
        /(^|_)(subagent|delegate|agent|task)/i.test(name),
    )
    .map(({ name }) => (active.has(name) ? name : `${name} (deferred; load with tool_search)`))
    .sort();
}

function formatPercent(usage: { percent: number | null; tokens: number | null; contextWindow: number } | undefined): string {
  if (!usage || usage.percent === null || usage.tokens === null) return "unknown";
  return `${formatContextPercent(usage.percent)} (${Math.round(usage.tokens / 1000)}k / ${Math.round(usage.contextWindow / 1000)}k)`;
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

function uniqueHandoffPath(topic: string, config = loadConfig()): string {
  const file = handoffPath(topic, config);
  return fs.existsSync(file) ? file.replace(/\.md$/, `-${Date.now()}.md`) : file;
}

function validateHandoffPath(file: string, config: ReturnType<typeof loadConfig>, ctx: ExtensionContext): string | null {
  try {
    const check = checkWritePath(file, config, projectRoot(), ctx.cwd);
    return check.allowed ? null : check.reason ?? "Blocked: unsafe handoff location.";
  } catch {
    return "Blocked: could not safely validate the handoff path.";
  }
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
status: draft
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
- Preserve the YAML frontmatter and set status: complete only after every relevant section has useful content. Leave status: draft if the session lacks enough information.
- Use memory_write with target "open" to record unresolved questions that are not already in the issue tracker.
- Do not start new work.
- After writing the file, tell the user to run: pi-main --continue-from-handoff`;
}

export default function mainGuard(pi: ExtensionAPI): void {
  if (!isEnabled()) return;

  const config = loadConfig();
  let lastContextBucket = 0;
  let pendingContextMessage: string | null = null;

  function contextStatus(ctx: ExtensionContext): string | null {
    const usage = ctx.getContextUsage();
    const percent = usage?.percent ?? null;
    if (percent === null) return null;

    const pct = Math.round(percent);
    ctx.ui.setStatus("pi-main-context", `ctx ${formatContextPercent(percent)}`);

    const bucket = contextUsageBucket(percent, config.handoff.warnAt, config.handoff.hardWarnAt);
    if (bucket > lastContextBucket) {
      lastContextBucket = bucket;
      const message =
        bucket === 2
          ? `Context is ${pct}% full. Create a handoff now before continuing.`
          : `Context is ${pct}% full. Create a handoff before moving into another phase.`;
      if (ctx.hasUI) ctx.ui.notify(message, bucket === 2 ? "warning" : "info");
      pendingContextMessage = message;
    }
    if (bucket < lastContextBucket) {
      lastContextBucket = bucket;
      pendingContextMessage = null;
    }
    return null;
  }

  pi.on("session_start", async (_event, ctx) => {
    lastContextBucket = 0;
    pendingContextMessage = null;
    const root = projectRoot();
    ctx.ui.setStatus(
      "pi-main",
      ctx.ui.theme.fg("accent", `main · ${path.basename(root)}`),
    );
    ctx.ui.setStatus("pi-main-memory", ctx.ui.theme.fg("muted", "memory: project"));
    contextStatus(ctx);
  });

  // The context event runs for every model call, including long tool loops.
  // Inject an ephemeral message without starting a new user turn.
  pi.on("context", async (event, ctx) => {
    contextStatus(ctx);
    const message = pendingContextMessage;
    pendingContextMessage = null;
    if (!message) return;
    const topic = "context-handoff";
    const file = uniqueHandoffPath(topic, config);
    const blockedReason = validateHandoffPath(file, config, ctx);
    if (blockedReason) {
      event.messages.push({
        role: "custom",
        customType: "pi-main-context",
        content: `${message} The configured handoff path was rejected by the path guard (${blockedReason}). Stop expanding work, continue briefly, and tell the user a handoff could not be written safely.`,
        display: false,
        timestamp: Date.now(),
      });
      return { messages: event.messages };
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) fs.writeFileSync(file, handoffSkeleton(topic, ctx), "utf8");
    event.messages.push({
      role: "custom",
      customType: "pi-main-context",
      content: `${message} Complete the current thought briefly, then fill in this handoff file using the write tool: ${file}. Preserve the YAML frontmatter. Keep status: draft until each relevant section has useful content; set status: complete only when the handoff is ready for continuation. Use memory_write with target "open" for unresolved questions not already tracked. Do not start new work.`,
      display: false,
      timestamp: Date.now(),
    });
    return { messages: event.messages };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("edit", event) || isToolCallEventType("write", event)) {
      const inputPath = event.input?.path;
      if (!inputPath || typeof inputPath !== "string") {
        return { block: true, reason: "Blocked: write/edit call has no path." };
      }
      try {
        const check = checkWritePath(inputPath, config, projectRoot(), ctx.cwd);
        if (!check.allowed) return { block: true, reason: check.reason ?? "Blocked by pi-main." };
      } catch {
        return { block: true, reason: "Blocked: could not safely validate the write path." };
      }
      return;
    }

    if (isToolCallEventType("bash", event)) {
      if (config.guard.bash === "unrestricted") return;
      if (config.guard.bash === "off") {
        return { block: true, reason: "Blocked: bash is disabled for pi-main." };
      }
      if (typeof event.input?.command !== "string") {
        return { block: true, reason: "Blocked: bash call has no command string." };
      }
      try {
        const result = isSafeBashCommand(event.input.command, { ...config, tracker: loadConfig().tracker });
        if (!result.safe) return { block: true, reason: result.reason ?? "Blocked by pi-main." };
      } catch {
        return { block: true, reason: "Blocked: could not safely validate the bash command." };
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
      const file = uniqueHandoffPath(topic, config);
      const blockedReason = validateHandoffPath(file, config, ctx);
      if (blockedReason) {
        ctx.ui.notify(blockedReason, "warning");
        return;
      }
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, handoffSkeleton(topic, ctx), "utf8");
      pi.sendUserMessage(handoffPrompt(file, topic));
    },
  });

  pi.registerCommand("main-status", {
    description: "Show pi-main project, memory, tracker, delegation, and context status",
    handler: async (_args, ctx) => {
      const root = projectRoot();
      const tracker = loadConfig().tracker;
      const usage = ctx.getContextUsage();
      const tools = delegationTools(pi);
      const lines = [
        "pi-main status",
        `project: ${root}`,
        `memory: ${path.relative(root, memoryDir(config, root)).split(path.sep).join("/")}`,
        `handoffs: ${path.relative(root, handoffDir(config, root)).split(path.sep).join("/")}`,
        `tracker: ${tracker.provider}${tracker.mcpServer ? ` (${tracker.mcpServer})` : ""}`,
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
