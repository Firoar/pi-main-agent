/**
 * Shared helpers for the pi-main extensions.
 *
 * Kept dependency-free so the guard, memory, and tracker extensions can use
 * the same config and path rules.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type TrackerProvider = "github" | "local" | "mcp";

export interface TrackerConfig {
  provider: TrackerProvider;
  localDir?: string;
  mcpServer?: string;
  allowedTools?: string[];
}

export interface GuardConfig {
  allowedWritePaths: string[];
  bash: "off" | "read-only" | "unrestricted";
  allowGithubTrackerWrites: boolean;
  allowGhApi: boolean;
}

export interface MemoryConfig {
  dir: string;
  maxChars: number;
  dailyMaxChars: number;
  openMaxChars: number;
}

export interface HandoffConfig {
  dir: string;
  warnAt: number;
  hardWarnAt: number;
}

export interface PiMainConfig {
  extensions: string[];
  skills: string[];
  tracker: TrackerConfig;
  guard: GuardConfig;
  memory: MemoryConfig;
  handoff: HandoffConfig;
  model?: string | null;
  thinking?: string | null;
}

export const DEFAULT_CONFIG: PiMainConfig = {
  extensions: [],
  skills: [
    "grilling",
    "domain-modeling",
    "grill-with-docs",
    "setup-matt-pocock-skills",
    "to-spec",
    "to-tickets",
    "wayfinder",
    "research",
    "prototype",
    "handoff",
  ],
  tracker: {
    provider: "github",
    localDir: ".scratch",
    allowedTools: [],
  },
  guard: {
    allowedWritePaths: [
      "GLOSSARY.md",
      "GLOSSARY-MAP.md",
      "AGENTS.md",
      "CLAUDE.md",
      "docs/**",
      ".scratch/**",
      "plans/**",
      "specs/**",
      ".pi-main/tmp/**",
      ".pi-main/handoffs/**",
    ],
    bash: "read-only",
    allowGithubTrackerWrites: true,
    allowGhApi: false,
  },
  memory: {
    dir: ".pi-main/memory",
    maxChars: 3000,
    dailyMaxChars: 1500,
    openMaxChars: 1500,
  },
  handoff: {
    dir: ".pi-main/handoffs",
    warnAt: 0.7,
    hardWarnAt: 0.85,
  },
  model: null,
  thinking: null,
};

export function loadConfig(): PiMainConfig {
  const configPath = process.env.PI_MAIN_CONFIG;
  if (!configPath) return { ...DEFAULT_CONFIG };

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<PiMainConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...raw,
      tracker: { ...DEFAULT_CONFIG.tracker, ...(raw.tracker ?? {}) },
      guard: { ...DEFAULT_CONFIG.guard, ...(raw.guard ?? {}) },
      memory: { ...DEFAULT_CONFIG.memory, ...(raw.memory ?? {}) },
      handoff: { ...DEFAULT_CONFIG.handoff, ...(raw.handoff ?? {}) },
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function projectRoot(): string {
  const fromEnv = process.env.PI_MAIN_PROJECT_ROOT;
  if (fromEnv) return path.resolve(fromEnv);
  return process.cwd();
}

export function resolveProjectPath(input: string, root = projectRoot()): string {
  if (!input) return root;
  let expanded = input;
  if (expanded === "~") expanded = os.homedir();
  if (expanded.startsWith("~/")) expanded = path.join(os.homedir(), expanded.slice(2));
  return path.resolve(root, expanded);
}

export function memoryDir(config = loadConfig(), root = projectRoot()): string {
  return resolveProjectPath(config.memory.dir, root);
}

export function handoffDir(config = loadConfig(), root = projectRoot()): string {
  return resolveProjectPath(config.handoff.dir, root);
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function ensureProjectState(config = loadConfig(), root = projectRoot()): void {
  const state = path.join(root, ".pi-main");
  ensureDir(state);
  ensureDir(path.join(state, "memory", "daily"));
  ensureDir(path.join(state, "memory", "backups"));
  ensureDir(path.join(state, "tmp"));
  ensureDir(path.join(state, "handoffs"));

  const gitignore = path.join(state, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, "memory/\ntmp/\nhandoffs/\n", "utf8");
  }

  // Also honor custom directories if the config points elsewhere.
  ensureDir(memoryDir(config, root));
  ensureDir(path.join(memoryDir(config, root), "daily"));
  ensureDir(path.join(memoryDir(config, root), "backups"));
  ensureDir(handoffDir(config, root));
}

export function projectSlug(root = projectRoot()): string {
  const base = path.basename(root).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

export function nowStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function dateStamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function shortSessionId(ctx: { sessionManager?: { getSessionId?: () => string } }): string {
  try {
    const id = ctx.sessionManager?.getSessionId?.() ?? "";
    return id.slice(0, 8) || "session";
  } catch {
    return "session";
  }
}

export function globToRegExp(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  let out = "^";
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === "*") {
      if (normalized[i + 1] === "*") {
        i++;
        if (normalized[i + 1] === "/") {
          i++;
          out += "(?:.*/)?";
        } else {
          out += ".*";
        }
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$+?.()|{}[]".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  out += "$";
  return new RegExp(out);
}

export function matchesAnyPath(relPath: string, patterns: string[]): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return patterns.some((pattern) => {
    if (pattern.startsWith("!")) return false;
    return globToRegExp(pattern).test(normalized);
  });
}

export function isWithin(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function realpathLoose(target: string): string {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    // For a not-yet-created file, resolve the nearest existing parent.
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(realpathLoose(parent), path.basename(absolute));
  }
}

export interface WriteCheck {
  allowed: boolean;
  reason?: string;
  absolutePath: string;
  relativePath: string;
}

export function checkWritePath(
  inputPath: string,
  config = loadConfig(),
  root = projectRoot(),
  cwd = root,
): WriteCheck {
  const expanded = inputPath === "~" ? os.homedir() : inputPath.startsWith("~/") ? path.join(os.homedir(), inputPath.slice(2)) : inputPath;
  const absolutePath = path.isAbsolute(expanded) ? path.resolve(expanded) : path.resolve(cwd, expanded);
  const canonicalRoot = realpathLoose(root);
  const canonicalTarget = realpathLoose(absolutePath);
  const relativePath = path.relative(canonicalRoot, canonicalTarget).split(path.sep).join("/");

  if (!isWithin(canonicalRoot, canonicalTarget)) {
    return {
      allowed: false,
      reason: `Blocked: writes must stay inside the project (${canonicalRoot}).`,
      absolutePath,
      relativePath,
    };
  }

  const memory = realpathLoose(memoryDir(config, root));
  if (isWithin(memory, canonicalTarget)) {
    return {
      allowed: false,
      reason:
        "Blocked: project memory is writable only through the pi-memory tools (memory_write/memory_forget).",
      absolutePath,
      relativePath,
    };
  }

  if (relativePath === ".git" || relativePath.startsWith(".git/") || relativePath === "node_modules" || relativePath.startsWith("node_modules/")) {
    return {
      allowed: false,
      reason: "Blocked: .git and node_modules are off-limits.",
      absolutePath,
      relativePath,
    };
  }

  if (!matchesAnyPath(relativePath, config.guard.allowedWritePaths)) {
    return {
      allowed: false,
      reason: [
        `Blocked: ${relativePath || inputPath} is not a planning-doc path.`,
        "Allowed paths:",
        ...config.guard.allowedWritePaths.map((p) => `  - ${p}`),
        "Source code must be changed by a delegated worker, not by pi-main.",
      ].join("\n"),
      absolutePath,
      relativePath,
    };
  }

  return { allowed: true, absolutePath, relativePath };
}

const SHELL_META = /[\n\r;|&<>`]|\$\(/;

function hasAny(args: string[], needles: string[]): boolean {
  return args.some((arg) => needles.some((needle) => arg === needle || arg.startsWith(`${needle}=`)));
}

export function isSafeBashCommand(command: string, config = loadConfig()): { safe: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { safe: false, reason: "Empty command." };
  if (SHELL_META.test(trimmed)) {
    return {
      safe: false,
      reason:
        "Blocked: shell chaining, redirection, pipes, and command substitution are disabled in pi-main.",
    };
  }
  const parts = trimmed.split(/\s+/);
  const head = parts[0];
  const args = parts.slice(1);

  const allowedHeads = new Set([
    "cat",
    "head",
    "tail",
    "grep",
    "rg",
    "find",
    "ls",
    "pwd",
    "tree",
    "wc",
    "sort",
    "uniq",
    "diff",
    "file",
    "stat",
    "du",
    "df",
    "which",
    "whereis",
    "type",
    "uname",
    "whoami",
    "id",
    "date",
    "cal",
    "uptime",
    "ps",
    "free",
    "jq",
  ]);

  if (head === "find") {
    if (
      hasAny(args, ["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"])
    ) {
      return { safe: false, reason: "Blocked: find may not delete, execute, or write files." };
    }
    return { safe: true };
  }

  if (head === "sort") {
    if (hasAny(args, ["-o", "--output"])) {
      return { safe: false, reason: "Blocked: sort may not write output files." };
    }
    return { safe: true };
  }

  if (head === "rg") {
    if (hasAny(args, ["--pre", "--pre-glob"])) {
      return { safe: false, reason: "Blocked: ripgrep preprocessors may execute commands." };
    }
    return { safe: true };
  }

  if (allowedHeads.has(head)) return { safe: true };

  if (head === "git") {
    const sub = args[0] ?? "";
    const readOnly = new Set([
      "status",
      "log",
      "diff",
      "show",
      "branch",
      "remote",
      "ls-files",
      "rev-parse",
      "describe",
      "blame",
      "grep",
      "show-ref",
      "for-each-ref",
    ]);
    if (!readOnly.has(sub)) {
      return { safe: false, reason: `Blocked: git ${sub || "(none)"} is not read-only.` };
    }
    if (sub === "branch") {
      const branchArgs = args.slice(1);
      const unsafe = new Set([
        "-d",
        "-D",
        "-m",
        "-M",
        "-c",
        "-C",
        "-f",
        "--delete",
        "--move",
        "--copy",
        "--force",
        "--edit-description",
        "--set-upstream-to",
        "--unset-upstream",
        "--track",
        "--no-track",
        "-u",
        "--create-reflog",
      ]);
      if (branchArgs.some((arg) => unsafe.has(arg))) {
        return { safe: false, reason: "Blocked: git branch may not modify branches." };
      }
      // A bare positional argument creates a branch. Allow values consumed by
      // read-only flags such as --contains/--list/--format.
      const valueFlags = new Set([
        "--contains",
        "--merged",
        "--no-merged",
        "--points-at",
        "--format",
        "--sort",
        "--column",
        "--list",
        "-l",
      ]);
      for (let i = 0; i < branchArgs.length; i++) {
        const arg = branchArgs[i]!;
        if (arg.startsWith("-")) {
          if (valueFlags.has(arg)) i++;
          continue;
        }
        return { safe: false, reason: "Blocked: git branch positional arguments create branches." };
      }
    }
    if (sub === "remote" && hasAny(args, ["add", "remove", "rm", "set-url", "rename", "prune", "update"])) {
      return { safe: false, reason: "Blocked: git remote may not modify remotes." };
    }
    if (hasAny(args, ["--output", "-o"])) {
      return { safe: false, reason: "Blocked: git read commands may not write output files." };
    }
    return { safe: true };
  }

  if (head === "npm") {
    const sub = args[0] ?? "";
    if (["list", "ls", "view", "info", "search", "outdated", "audit"].includes(sub)) return { safe: true };
    return { safe: false, reason: `Blocked: npm ${sub || "(none)"} may modify the project.` };
  }

  if (head === "yarn" || head === "pnpm") {
    const sub = args[0] ?? "";
    if (["list", "info", "why", "audit", "outdated"].includes(sub)) return { safe: true };
    return { safe: false, reason: `Blocked: ${head} ${sub || "(none)"} may modify the project.` };
  }

  if (head === "node" && args[0] === "--version") return { safe: true };
  if ((head === "python" || head === "python3") && args[0] === "--version") return { safe: true };

  if (head === "gh") {
    if (!config.guard.allowGithubTrackerWrites || config.tracker.provider !== "github") {
      return { safe: false, reason: "Blocked: GitHub tracker writes are disabled in pi-main config." };
    }
    const domain = args[0] ?? "";
    const sub = args[1] ?? "";
    if (domain === "issue") {
      if (["create", "edit", "comment", "close", "reopen", "list", "view", "status"].includes(sub)) {
        return { safe: true };
      }
      return { safe: false, reason: `Blocked: gh issue ${sub || "(none)"} is not allowed.` };
    }
    if (domain === "label") {
      if (["list", "create"].includes(sub)) return { safe: true };
      return { safe: false, reason: `Blocked: gh label ${sub || "(none)"} is not allowed.` };
    }
    if (domain === "repo" && sub === "view") return { safe: true };
    if (domain === "auth" && sub === "status") return { safe: true };
    return { safe: false, reason: "Blocked: only gh issue/label/repo view/auth status are allowed." };
  }

  return {
    safe: false,
    reason: `Blocked: ${head} is not on the pi-main read-only allowlist.`,
  };
}

export function isTrackerTool(toolName: string, config = loadConfig()): boolean {
  if (toolName.startsWith("tracker_")) return true;
  return (config.tracker.allowedTools ?? []).some((pattern) => globToRegExp(pattern).test(toolName));
}

export function readText(filePath: string, fallback = ""): string {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 40))}\n\n[... truncated ...]`;
}

export function tailLines(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `[... truncated ...]\n${text.slice(-maxChars)}`;
}
