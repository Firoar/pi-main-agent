/**
 * tracker: GitHub and local-markdown issue creation for pi-main.
 *
 * GitHub is the default. Local markdown is the offline / no-remote fallback.
 * Linear and Jira are expected to be driven through configured MCP tools; the
 * guard allows those tools by name (tracker.allowedTools).
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureDir, loadConfig, nowStamp, projectRoot, resolveProjectPath } from "./lib.ts";

const execFileAsync = promisify(execFile);
let ghVersionCache: string | undefined;

function isEnabled(): boolean {
  return process.env.PI_MAIN_AGENT === "1";
}

function slugify(input: string): string {
  return (
    input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "issue"
  );
}

function normalizeIssue(issue: string | number): string {
  return String(issue).trim().replace(/^#/, "");
}

async function run(
  command: string,
  args: string[],
  cwd = projectRoot(),
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync(command, args, { cwd, encoding: "utf8", timeout: 30000 });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: err.stdout ?? "",
      stderr: err.stderr || err.message || String(error),
    };
  }
}

async function ghVersion(): Promise<string> {
  if (ghVersionCache) return ghVersionCache;
  const result = await run("gh", ["--version"]);
  const match = /gh version (\d+)\.(\d+)\.(\d+)/.exec(result.stdout);
  ghVersionCache = match ? `${match[1]}.${match[2]}.${match[3]}` : "0.0.0";
  return ghVersionCache;
}

async function supportsNativeIssueEdges(): Promise<boolean> {
  const version = await ghVersion();
  const [major, minor] = version.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 94);
}

function tempBody(body: string): string {
  const dir = resolveProjectPath(".pi-main/tmp", projectRoot());
  ensureDir(dir);
  const file = path.join(dir, `issue-${Date.now()}-${slugify(body.slice(0, 40))}.md`);
  fs.writeFileSync(file, body, "utf8");
  return file;
}

function withMeta(body: string, parent?: number, blockedBy?: number[]): string {
  const meta: string[] = [];
  if (parent) meta.push(`Part of #${parent}`);
  if (blockedBy?.length) meta.push(`Blocked by: ${blockedBy.map((n) => `#${n}`).join(", ")}`);
  if (!meta.length) return body;
  return `${meta.join("\n")}\n\n${body}`;
}

async function githubCreate(
  title: string,
  body: string,
  labels: string[],
  parent?: number,
  blockedBy?: number[],
): Promise<{ ok: boolean; text: string }> {
  const nativeEdges = await supportsNativeIssueEdges();
  const file = tempBody(nativeEdges ? body : withMeta(body, parent, blockedBy));
  const args = ["issue", "create", "--title", title, "--body-file", file];
  for (const label of labels) args.push("--label", label);
  if (nativeEdges && parent) args.push("--parent", String(parent));
  if (nativeEdges && blockedBy?.length) args.push("--blocked-by", blockedBy.join(","));
  const result = await run("gh", args);
  if (!result.ok) {
    return {
      ok: false,
      text: `GitHub issue creation failed.\n${result.stderr}\n\nCheck gh auth and labels. Missing labels must be created first. Body kept at: ${file}`,
    };
  }
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore cleanup failure
  }
  return { ok: true, text: result.stdout.trim() };
}

function localRoot(): string {
  const config = loadConfig();
  return resolveProjectPath(config.tracker.localDir || ".scratch", projectRoot());
}

function localCreate(
  title: string,
  body: string,
  labels: string[],
  parent?: number,
  blockedBy?: number[],
  feature?: string,
): { ok: boolean; text: string } {
  const root = localRoot();
  const dir = path.join(root, slugify(feature || "planning"), "issues");
  ensureDir(dir);

  let max = 0;
  for (const name of fs.readdirSync(dir)) {
    const match = /^(\d+)-/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const number = String(max + 1).padStart(2, "0");
  const file = path.join(dir, `${number}-${slugify(title)}.md`);

  const meta = [
    `# ${number}: ${title}`,
    "",
    `**Status:** ready-for-agent`,
  ];
  if (labels.length) meta.push(`**Labels:** ${labels.join(", ")}`);
  if (parent) meta.push(`**Part of:** #${parent}`);
  if (blockedBy?.length) meta.push(`**Blocked by:** ${blockedBy.map((n) => `#${n}`).join(", ")}`);
  meta.push("", body, "");
  fs.writeFileSync(file, meta.join("\n"), "utf8");
  return { ok: true, text: path.relative(projectRoot(), file) };
}

function localComment(issue: string, body: string): { ok: boolean; text: string } {
  const root = localRoot();
  const target = findLocalIssue(root, issue);
  if (!target) return { ok: false, text: `Local issue #${issue} not found under ${root}.` };
  fs.appendFileSync(target, `\n\n---\n\n**Comment ${nowStamp()}:**\n\n${body}\n`, "utf8");
  return { ok: true, text: path.relative(projectRoot(), target) };
}

function localClose(issue: string, body?: string): { ok: boolean; text: string } {
  const root = localRoot();
  const target = findLocalIssue(root, issue);
  if (!target) return { ok: false, text: `Local issue #${issue} not found under ${root}.` };
  if (body) fs.appendFileSync(target, `\n\n**Comment ${nowStamp()}:**\n\n${body}\n`, "utf8");
  fs.appendFileSync(target, `\n**Status:** done\n`, "utf8");
  return { ok: true, text: path.relative(projectRoot(), target) };
}

function findLocalIssue(root: string, issue: string): string | undefined {
  const target = issue.replace(/^#/, "").padStart(2, "0");
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && entry.name.startsWith(`${target}-`) && entry.name.endsWith(".md")) return full;
    }
  }
  return undefined;
}

export default function tracker(pi: ExtensionAPI): void {
  if (!isEnabled()) return;

  pi.registerTool({
    name: "tracker_create_issue",
    label: "tracker_create_issue",
    description:
      "Create an issue in the configured tracker after the user has confirmed the plan preview. GitHub is default; local markdown is the fallback.",
    promptSnippet: "Create a confirmed issue in the configured tracker",
    promptGuidelines: [
      "Use tracker_create_issue only after showing the user a preview and getting confirmation to publish.",
      "Prefer one issue for small work; for larger work create a spec issue and child tracer-bullet tickets.",
      "Pass parent and blockedBy issue numbers when the tracker supports blocking edges; otherwise they are recorded in the body.",
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1, description: "Issue title." }),
      body: Type.String({ minLength: 1, description: "Full Markdown issue body." }),
      labels: Type.Optional(Type.Array(Type.String(), { description: "Labels to apply." })),
      parent: Type.Optional(Type.Number({ description: "Parent issue number (for spec/ticket hierarchies)." })),
      blockedBy: Type.Optional(
        Type.Array(Type.Number(), { description: "Issue numbers that must close before this one starts." }),
      ),
      feature: Type.Optional(Type.String({ description: "Local tracker feature slug. Default: planning." })),
      provider: Type.Optional(
        Type.String({
          enum: ["github", "local"],
          description: "Override the configured provider, for example local fallback when GitHub is unavailable.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const config = loadConfig();
      const provider = ((params.provider as string | undefined) ?? config.tracker.provider) as
        | "github"
        | "local"
        | "mcp";
      const labels = (params.labels as string[] | undefined) ?? [];

      if (provider === "mcp") {
        return {
          content: [
            {
              type: "text",
              text: `Tracker provider is "mcp". Use the configured MCP issue tools directly (allowed: ${(config.tracker.allowedTools ?? []).join(", ") || "none"}).`,
            },
          ],
          isError: true,
          details: {},
        };
      }

      const result =
        provider === "local"
          ? localCreate(
              params.title as string,
              params.body as string,
              labels,
              params.parent as number | undefined,
              params.blockedBy as number[] | undefined,
              params.feature as string | undefined,
            )
          : await githubCreate(
              params.title as string,
              params.body as string,
              labels,
              params.parent as number | undefined,
              params.blockedBy as number[] | undefined,
            );

      return {
        content: [{ type: "text", text: result.text }],
        isError: !result.ok,
        details: { provider, labels },
      };
    },
  });

  pi.registerTool({
    name: "tracker_comment_issue",
    label: "tracker_comment_issue",
    description: "Add a comment to an existing issue.",
    promptSnippet: "Comment on an existing issue",
    parameters: Type.Object({
      issue: Type.String({ minLength: 1, description: "Issue number (with or without #)." }),
      body: Type.String({ minLength: 1, description: "Comment body." }),
      provider: Type.Optional(Type.String({ enum: ["github", "local"], description: "Override the configured provider." })),
    }),
    async execute(_toolCallId, params) {
      const config = loadConfig();
      const issue = normalizeIssue(params.issue as string);
      const provider = ((params.provider as string | undefined) ?? config.tracker.provider) as string;
      if (provider === "local") {
        const result = localComment(issue, params.body as string);
        return { content: [{ type: "text", text: result.text }], isError: !result.ok, details: {} };
      }
      if (provider === "mcp") {
        return {
          content: [{ type: "text", text: "Tracker provider is mcp; use the configured MCP comment tool." }],
          isError: true,
          details: {},
        };
      }
      const file = tempBody(params.body as string);
      const result = await run("gh", ["issue", "comment", issue, "--body-file", file]);
      try {
        fs.unlinkSync(file);
      } catch {
        // ignore
      }
      return {
        content: [{ type: "text", text: result.ok ? result.stdout.trim() || "Commented." : result.stderr }],
        isError: !result.ok,
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "tracker_close_issue",
    label: "tracker_close_issue",
    description: "Close an existing issue, optionally with a final comment.",
    promptSnippet: "Close an issue after the work is verified",
    parameters: Type.Object({
      issue: Type.String({ minLength: 1, description: "Issue number (with or without #)." }),
      comment: Type.Optional(Type.String({ description: "Final comment to post before closing." })),
      provider: Type.Optional(Type.String({ enum: ["github", "local"], description: "Override the configured provider." })),
    }),
    async execute(_toolCallId, params) {
      const config = loadConfig();
      const issue = normalizeIssue(params.issue as string);
      const comment = params.comment as string | undefined;
      const provider = ((params.provider as string | undefined) ?? config.tracker.provider) as string;
      if (provider === "local") {
        const result = localClose(issue, comment);
        return { content: [{ type: "text", text: result.text }], isError: !result.ok, details: {} };
      }
      if (provider === "mcp") {
        return {
          content: [{ type: "text", text: "Tracker provider is mcp; use the configured MCP close tool." }],
          isError: true,
          details: {},
        };
      }
      if (comment) {
        const file = tempBody(comment);
        const first = await run("gh", ["issue", "comment", issue, "--body-file", file]);
        try {
          fs.unlinkSync(file);
        } catch {
          // ignore
        }
        if (!first.ok) return { content: [{ type: "text", text: first.stderr }], isError: true, details: {} };
      }
      const result = await run("gh", ["issue", "close", issue]);
      return {
        content: [{ type: "text", text: result.ok ? result.stdout.trim() || `Closed #${issue}.` : result.stderr }],
        isError: !result.ok,
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "tracker_status",
    label: "tracker_status",
    description: "Show the configured tracker, gh authentication, and repository.",
    promptSnippet: "Show tracker configuration and health",
    parameters: Type.Object({}),
    async execute() {
      const config = loadConfig();
      const lines = [`provider: ${config.tracker.provider}`];
      if (config.tracker.provider === "local") {
        lines.push(`local dir: ${path.relative(projectRoot(), localRoot())}`);
      } else if (config.tracker.provider === "github") {
        const auth = await run("gh", ["auth", "status"]);
        lines.push(`gh auth: ${auth.ok ? "ok" : "not ready"}`);
        lines.push(`gh version: ${await ghVersion()}`);
        lines.push(`native issue edges: ${(await supportsNativeIssueEdges()) ? "yes" : "no (body fallback)"}`);
        if (!auth.ok) lines.push(auth.stderr.trim());
        const repo = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
        lines.push(`repo: ${repo.ok ? repo.stdout.trim() : "unknown"}`);
        if (!repo.ok) lines.push(repo.stderr.trim());
      } else {
        lines.push(`mcp server: ${config.tracker.mcpServer ?? "(not set)"}`);
        lines.push(`allowed tools: ${(config.tracker.allowedTools ?? []).join(", ") || "(none)"}`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
    },
  });
}
