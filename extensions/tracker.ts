/**
 * tracker: GitHub and local-markdown issue creation for pi-main.
 *
 * GitHub is the default. Local markdown is the offline / no-remote fallback.
 * MCP providers are expected to be driven through their configured MCP tools;
 * tracker.allowedTools is trusted configuration for discovery, not a write bypass.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ensureDir, isWithin, loadConfig, nowStamp, projectRoot, realpathLoose, resolveProjectPath } from "./lib.ts";

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

function validGithubIssueRef(issue: string): boolean {
  return /^\d+$/.test(issue) || /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+(?:\?.*)?$/.test(issue);
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
  assertProjectPath(dir);
  rejectSymlinkComponents(dir);
  ensureDir(dir);
  const file = path.join(dir, `issue-${randomUUID()}-${slugify(body.slice(0, 40))}.md`);
  assertProjectPath(file);
  rejectSymlinkComponents(file);
  fs.writeFileSync(file, body, { encoding: "utf8", flag: "wx" });
  return file;
}

function withMeta(body: string, parent?: string | number, blockedBy?: Array<string | number>): string {
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
      text: `GitHub issue creation failed. The request may have reached GitHub before the client timed out, so inspect the repository for a matching title before retrying to avoid duplicates.\n${result.stderr}\n\nCheck gh auth and labels. Missing labels must be created first. Body kept at: ${file}`,
    };
  }
  try {
    fs.unlinkSync(file);
  } catch {
    // ignore cleanup failure
  }
  return { ok: true, text: result.stdout.trim() };
}

function assertProjectPath(target: string): void {
  const root = realpathLoose(projectRoot());
  const canonical = realpathLoose(target);
  if (!isWithin(root, canonical)) throw new Error(`Tracker path escapes the project root: ${target}`);
  rejectSensitivePath(canonical, root);
}

function assertLocalPath(target: string): void {
  const config = loadConfig();
  const root = realpathLoose(projectRoot());
  const configuredRoot = realpathLoose(resolveProjectPath(config.tracker.localDir || ".scratch", projectRoot()));
  const canonical = realpathLoose(target);
  if (!isWithin(root, configuredRoot) || !isWithin(configuredRoot, canonical)) {
    throw new Error(`Tracker path escapes its configured project directory: ${target}`);
  }
  rejectSymlinkComponents(target);
  rejectSensitivePath(canonical, root);
}

function rejectSensitivePath(target: string, root = realpathLoose(projectRoot())): void {
  const parts = path.relative(root, target).split(path.sep);
  if (parts.some((part) => part === ".git" || part === "node_modules")) {
    throw new Error(`Tracker path may not use .git or node_modules: ${target}`);
  }
}

function rejectSymlinkComponents(target: string): void {
  let current = path.resolve(target);
  const root = path.resolve(projectRoot());
  while (isWithin(root, current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Tracker path may not use symbolic links: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (current === root) return;
    current = path.dirname(current);
  }
}

function localRoot(): string {
  const config = loadConfig();
  const root = resolveProjectPath(config.tracker.localDir || ".scratch", projectRoot());
  assertLocalPath(root);
  return root;
}

function localCreate(
  title: string,
  body: string,
  labels: string[],
  parent?: string | number,
  blockedBy?: Array<string | number>,
  feature?: string,
  type?: string,
): { ok: boolean; text: string } {
  const root = localRoot();
  const featureSlug = slugify(feature || "planning");
  if (featureSlug === "." || featureSlug === "..") return { ok: false, text: "Feature must not be '.' or '..'." };
  const dir = path.join(root, featureSlug, "issues");
  assertLocalPath(dir);
  ensureDir(dir);
  assertLocalPath(dir);

  let max = 0;
  for (const name of fs.readdirSync(dir)) {
    const match = /^(\d+)-/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }
  const number = String(max + 1).padStart(2, "0");
  const file = path.join(dir, `${number}-${slugify(title)}.md`);
  assertLocalPath(file);
  const qualifyRef = (ref: string | number | undefined): string | undefined => {
    if (ref === undefined) return undefined;
    const resolved = findLocalIssue(root, String(ref));
    if (!resolved) throw new Error(localIssueFailure(root, String(ref)));
    return path.relative(projectRoot(), resolved);
  };
  let parentPath: string | undefined;
  let blockedPaths: string[] = [];
  try {
    parentPath = qualifyRef(parent);
    blockedPaths = (blockedBy ?? []).map((ref) => qualifyRef(ref)!);
  } catch (error) {
    return { ok: false, text: (error as Error).message };
  }

  const meta = [
    `# ${number}: ${title}`,
    "",
    `**Type:** ${type || "issue"}`,
    `**Status:** ready-for-agent`,
  ];
  if (labels.length) meta.push(`**Labels:** ${labels.join(", ")}`);
  if (parentPath) meta.push(`**Part of:** ${parentPath}`);
  if (blockedPaths.length) meta.push(`**Blocked by:** ${blockedPaths.join(", ")}`);
  meta.push("", body, "");
  try {
    fs.writeFileSync(file, meta.join("\n"), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, text: `Local issue file already exists: ${path.relative(projectRoot(), file)}. Choose a distinct title or feature.` };
    throw error;
  }
  return { ok: true, text: path.relative(projectRoot(), file) };
}

function localComment(issue: string, body: string): { ok: boolean; text: string } {
  const root = localRoot();
  const target = findLocalIssue(root, issue);
  if (!target) return { ok: false, text: localIssueFailure(root, issue) };
  assertLocalPath(target);
  fs.appendFileSync(target, `\n\n---\n\n**Comment ${nowStamp()}:**\n\n${body}\n`, "utf8");
  return { ok: true, text: path.relative(projectRoot(), target) };
}

function localClose(issue: string, body?: string): { ok: boolean; text: string } {
  const root = localRoot();
  const target = findLocalIssue(root, issue);
  if (!target) return { ok: false, text: localIssueFailure(root, issue) };
  assertLocalPath(target);
  if (body) fs.appendFileSync(target, `\n\n**Comment ${nowStamp()}:**\n\n${body}\n`, "utf8");
  const content = fs.readFileSync(target, "utf8");
  let foundStatus = false;
  const lines = content.split("\n").filter((line) => {
    if (!/^\*\*Status:\*\*/.test(line)) return true;
    if (foundStatus) return false;
    foundStatus = true;
    return true;
  });
  if (foundStatus) {
    const index = lines.findIndex((line) => /^\*\*Status:\*\*/.test(line));
    lines[index] = "**Status:** resolved";
  } else {
    lines.splice(Math.min(2, lines.length), 0, "", "**Status:** resolved");
  }
  const next = `${lines.join("\n").trimEnd()}\n`;
  fs.writeFileSync(target, next, "utf8");
  return { ok: true, text: path.relative(projectRoot(), target) };
}

function findLocalIssue(root: string, issue: string): string | undefined {
  const ref = issue.trim().replace(/^#/, "");
  if (ref.includes("/") || ref.endsWith(".md")) {
    const absolute = path.resolve(projectRoot(), ref);
    const relativeToProject = path.relative(projectRoot(), absolute);
    if (relativeToProject.startsWith("..") || path.isAbsolute(relativeToProject)) return undefined;
    assertLocalPath(absolute);
    rejectSymlinkComponents(absolute);
    const localRel = path.relative(path.resolve(root), absolute).split(path.sep);
    if (!/^[0-9]+-[^/]+\.md$/.test(localRel.at(-1) ?? "") || localRel.length !== 3 || localRel[1] !== "issues") return undefined;
    if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isFile() || fs.lstatSync(absolute).isSymbolicLink()) return undefined;
    return absolute;
  }
  if (!/^\d+$/.test(ref)) return undefined;
  const matches = localNumericMatches(root, ref);
  return matches.length === 1 ? matches[0] : undefined;
}

function localNumericMatches(root: string, ref: string): string[] {
  const matches: string[] = [];
  let features: fs.Dirent[] = [];
  try { features = fs.readdirSync(root, { withFileTypes: true }); } catch { return matches; }
  for (const feature of features) {
    if (!feature.isDirectory() || feature.isSymbolicLink()) continue;
    const issueDir = path.join(root, feature.name, "issues");
    let issues: fs.Dirent[] = [];
    try { issues = fs.readdirSync(issueDir, { withFileTypes: true }); } catch { continue; }
    for (const issue of issues) {
      if (issue.isFile() && !issue.isSymbolicLink() && issue.name.startsWith(`${ref.padStart(2, "0")}-`) && issue.name.endsWith(".md")) {
        matches.push(path.join(issueDir, issue.name));
      }
    }
  }
  return matches;
}

function localIssueFailure(root: string, issue: string): string {
  const ref = issue.trim().replace(/^#/, "");
  if (/^\d+$/.test(ref)) {
    const count = localNumericMatches(root, ref).length;
    if (count > 1) return `Local issue #${ref} is ambiguous (${count} matches). Use the full relative issue file path returned when it was created.`;
  }
  return `Local issue ${issue} not found under ${root}.`;
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
      "Use tracker_create_issue only after the user has authorized publishing, either explicitly in the request or after confirming a preview. Do not ask again when authorization is already explicit.",
      "Prefer one issue for small work; for larger work create a spec issue and child tracer-bullet tickets.",
      "Pass parent and blockedBy issue numbers when the tracker supports blocking edges; otherwise they are recorded in the body.",
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1, description: "Issue title." }),
      body: Type.String({ minLength: 1, description: "Full Markdown issue body." }),
      labels: Type.Optional(Type.Array(Type.String(), { description: "Labels to apply." })),
      type: Type.Optional(Type.String({ description: "Issue type, recorded in local Markdown issue files." })),
      parent: Type.Optional(Type.Union([Type.Number(), Type.String()], { description: "Parent issue number or qualified local issue path." })),
      blockedBy: Type.Optional(
        Type.Array(Type.Union([Type.Number(), Type.String()]), { description: "Issue numbers or qualified local issue paths that must close before this one starts." }),
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

      if (!["github", "local", "mcp"].includes(provider)) {
        return { content: [{ type: "text", text: `Unsupported tracker provider: ${provider}` }], isError: true, details: {} };
      }

      if (provider === "mcp") {
        return {
          content: [
            {
              type: "text",
              text: `Tracker provider is MCP${config.tracker.mcpServer ? ` server "${config.tracker.mcpServer}"` : " (no server configured)"}. Inspect that server's available issue tools before using them; repository config cannot grant tool permissions.`,
            },
          ],
          isError: true,
          details: {},
        };
      }

      let result: { ok: boolean; text: string };
      if (provider === "local") {
        try { result = localCreate(
              params.title as string,
              params.body as string,
              labels,
              params.parent as string | number | undefined,
              params.blockedBy as Array<string | number> | undefined,
              params.feature as string | undefined,
              params.type as string | undefined,
            ); } catch (error) { result = { ok: false, text: (error as Error).message }; }
      } else if (!config.guard.allowGithubTrackerWrites) {
        result = { ok: false, text: "GitHub tracker writes are disabled by guard.allowGithubTrackerWrites." };
      } else {
        const parent = params.parent as string | number | undefined;
        const blockedBy = params.blockedBy as Array<string | number> | undefined;
        if ((parent !== undefined && (typeof parent !== "number" || !Number.isInteger(parent) || parent < 1)) ||
            (blockedBy ?? []).some((value) => typeof value !== "number" || !Number.isInteger(value) || value < 1)) {
          result = { ok: false, text: "GitHub parent and blockedBy references must be positive issue numbers." };
        } else result = await githubCreate(
              params.title as string,
              params.body as string,
              labels,
              parent as number | undefined,
              blockedBy as number[] | undefined,
            );
      }

      return {
        content: [{ type: "text", text: result.text }],
        isError: !result.ok,
        details: { provider, labels },
      };
    },
  });

  pi.registerTool({
    name: "tracker_configure",
    label: "tracker_configure",
    description: "Configure this project's tracker after the user confirms the provider and settings. Changes only tracker.provider, tracker.localDir, and tracker.mcpServer in the project config.",
    promptSnippet: "Configure the project issue tracker after user confirmation",
    promptGuidelines: ["Show the provider and settings to the user and get confirmation before calling this tool."],
    parameters: Type.Object({
      provider: Type.String({ enum: ["github", "local", "mcp"] }),
      localDir: Type.Optional(Type.String({ description: "Project-relative local tracker root." })),
      mcpServer: Type.Optional(Type.String({ description: "Configured MCP server name." })),
    }),
    async execute(_toolCallId, params) {
      const configFile = process.env.PI_MAIN_PROJECT_CONFIG;
      if (!configFile) return { content: [{ type: "text", text: "Project tracker setup is unavailable while an explicit PI_MAIN_CONFIG is active." }], isError: true, details: {} };
      const root = realpathLoose(projectRoot());
      const absolute = path.resolve(root, path.relative(path.resolve(projectRoot()), path.resolve(configFile)));
      if (!isWithin(root, absolute)) return { content: [{ type: "text", text: "Project config path must be inside the project root." }], isError: true, details: {} };
      try {
        const provider = params.provider;
        if (!["github", "local", "mcp"].includes(provider as string)) throw new Error("Unknown tracker provider.");
        if (params.localDir !== undefined) {
          if (typeof params.localDir !== "string" || !params.localDir.trim()) throw new Error("localDir must be a non-empty project-relative path.");
          const requestedLocalDir = resolveProjectPath(params.localDir, root);
          rejectSymlinkComponents(requestedLocalDir);
          const localDir = realpathLoose(requestedLocalDir);
          if (!isWithin(root, localDir)) throw new Error("localDir must stay inside the project root.");
          rejectSensitivePath(localDir, root);
        }
        if (params.mcpServer !== undefined && (typeof params.mcpServer !== "string" || !params.mcpServer.trim())) throw new Error("mcpServer must be a non-empty server name.");
        rejectSymlinkComponents(absolute);
        if (fs.existsSync(absolute)) {
          if (fs.lstatSync(absolute).isSymbolicLink() || !isWithin(root, realpathLoose(absolute))) throw new Error("Project config is a symlink or resolves outside the project root.");
        } else assertProjectPath(absolute);
        const raw = fs.existsSync(absolute) ? JSON.parse(fs.readFileSync(absolute, "utf8")) : {};
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Project config must contain a JSON object.");
        if (raw.tracker !== undefined && (!raw.tracker || typeof raw.tracker !== "object" || Array.isArray(raw.tracker))) {
          throw new Error("Project config tracker settings must be an object.");
        }
        raw.tracker = raw.tracker ?? {};
        raw.tracker.provider = provider;
        if (params.localDir !== undefined) raw.tracker.localDir = params.localDir;
        if (params.mcpServer !== undefined) raw.tracker.mcpServer = params.mcpServer;
        if (provider === "mcp" && (typeof raw.tracker.mcpServer !== "string" || !raw.tracker.mcpServer.trim())) {
          throw new Error("MCP setup needs a non-empty mcpServer name, either already configured or provided now.");
        }
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        assertProjectPath(path.dirname(absolute));
        rejectSymlinkComponents(absolute);
        fs.writeFileSync(absolute, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
      } catch (error) {
        return { content: [{ type: "text", text: `Could not configure tracker: ${(error as Error).message}` }], isError: true, details: {} };
      }
      const provider = params.provider as string;
      if (provider === "github") {
        if (!loadConfig().guard.allowGithubTrackerWrites) return { content: [{ type: "text", text: "Saved provider=github, but label bootstrap was skipped because guard.allowGithubTrackerWrites is disabled." }], isError: true, details: { partial: true } };
        const auth = await run("gh", ["auth", "status"]);
        if (!auth.ok) return { content: [{ type: "text", text: "Saved provider=github, but gh authentication is not ready. Authenticate with gh auth login, then retry label bootstrap for ready-for-agent and wayfinder:* labels." }], isError: true, details: { partial: true } };
        const repository = await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
        const repo = repository.stdout.trim();
        if (!repository.ok || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
          return { content: [{ type: "text", text: `Saved provider=github, but the current GitHub repository could not be identified, so label bootstrap stopped.\n${repository.stderr || repository.stdout}` }], isError: true, details: { partial: true } };
        }
        const list = await run("gh", ["api", "--paginate", `repos/${repo}/labels`, "--jq", ".[].name"]);
        if (!list.ok) return { content: [{ type: "text", text: `Saved provider=github, but existing labels could not be checked, so bootstrap stopped without creating any.\n${list.stderr}` }], isError: true, details: { partial: true } };
        const labelOutput = list.stdout;
        const existing = new Set(labelOutput.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
        const failures: string[] = [];
        for (const label of ["ready-for-agent", "wayfinder:map", "wayfinder:research", "wayfinder:prototype", "wayfinder:grilling", "wayfinder:task"]) {
          if (existing.has(label)) continue;
          const created = await run("gh", ["label", "create", label, "--color", label.startsWith("wayfinder:") ? "5319e7" : "0e8a16"]);
          if (!created.ok) failures.push(`${label}: ${created.stderr.trim()}`);
        }
        if (failures.length) return { content: [{ type: "text", text: `Saved provider=github. Label setup was partial; existing labels were preserved.\n${failures.join("\n")}` }], isError: true, details: { partial: true } };
      }
      return {
        content: [{ type: "text", text: provider === "mcp"
          ? `Tracker routing configured for MCP server ${loadConfig().tracker.mcpServer}. The lead must verify that issue tools are available before using them.`
          : `Tracker configured: ${provider}.` }],
        details: { provider },
      };
    },
  });

  pi.registerTool({
    name: "tracker_comment_issue",
    label: "tracker_comment_issue",
    description: "Add a comment to an existing issue.",
    promptSnippet: "Comment on an existing issue",
    parameters: Type.Object({
      issue: Type.String({ minLength: 1, description: "For local issues, use the full relative path returned by tracker_create_issue; a unique number is supported. For GitHub, use an issue number or full issue URL." }),
      body: Type.String({ minLength: 1, description: "Comment body." }),
      provider: Type.Optional(Type.String({ enum: ["github", "local"], description: "Override the configured provider." })),
    }),
    async execute(_toolCallId, params) {
      const config = loadConfig();
      const issue = normalizeIssue(params.issue as string);
      const provider = ((params.provider as string | undefined) ?? config.tracker.provider) as string;
      if (!["github", "local", "mcp"].includes(provider)) return { content: [{ type: "text", text: `Unsupported tracker provider: ${provider}` }], isError: true, details: {} };
      if (provider === "local") {
        let result: { ok: boolean; text: string };
        try { result = localComment(issue, params.body as string); } catch (error) { result = { ok: false, text: (error as Error).message }; }
        return { content: [{ type: "text", text: result.text }], isError: !result.ok, details: {} };
      }
      if (provider === "mcp") {
        return {
          content: [{ type: "text", text: `Tracker provider is MCP${config.tracker.mcpServer ? ` server "${config.tracker.mcpServer}"` : " (no server configured)"}; inspect available comment tools before proceeding.` }],
          isError: true,
          details: {},
        };
      }
      if (!config.guard.allowGithubTrackerWrites) return { content: [{ type: "text", text: "GitHub tracker writes are disabled by guard.allowGithubTrackerWrites." }], isError: true, details: {} };
      if (!validGithubIssueRef(issue)) return { content: [{ type: "text", text: "Use a GitHub issue number or a full github.com/{owner}/{repo}/issues/{number} URL." }], isError: true, details: {} };
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
      issue: Type.String({ minLength: 1, description: "For local issues, use the full relative path returned by tracker_create_issue; a unique number is supported. For GitHub, use an issue number or full issue URL." }),
      comment: Type.Optional(Type.String({ description: "Final comment to post before closing." })),
      provider: Type.Optional(Type.String({ enum: ["github", "local"], description: "Override the configured provider." })),
    }),
    async execute(_toolCallId, params) {
      const config = loadConfig();
      const issue = normalizeIssue(params.issue as string);
      const comment = params.comment as string | undefined;
      const provider = ((params.provider as string | undefined) ?? config.tracker.provider) as string;
      if (!["github", "local", "mcp"].includes(provider)) return { content: [{ type: "text", text: `Unsupported tracker provider: ${provider}` }], isError: true, details: {} };
      if (provider === "local") {
        let result: { ok: boolean; text: string };
        try { result = localClose(issue, comment); } catch (error) { result = { ok: false, text: (error as Error).message }; }
        return { content: [{ type: "text", text: result.text }], isError: !result.ok, details: {} };
      }
      if (provider === "mcp") {
        return {
          content: [{ type: "text", text: `Tracker provider is MCP${config.tracker.mcpServer ? ` server "${config.tracker.mcpServer}"` : " (no server configured)"}; inspect available close tools before proceeding.` }],
          isError: true,
          details: {},
        };
      }
      if (!config.guard.allowGithubTrackerWrites) return { content: [{ type: "text", text: "GitHub tracker writes are disabled by guard.allowGithubTrackerWrites." }], isError: true, details: {} };
      if (!validGithubIssueRef(issue)) return { content: [{ type: "text", text: "Use a GitHub issue number or a full github.com/{owner}/{repo}/issues/{number} URL." }], isError: true, details: {} };
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
        lines.push(`tool discovery hints: ${(config.tracker.allowedTools ?? []).join(", ") || "(none)"} (inspect the server's actual tools before use)`);
      }
      return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
    },
  });
}
