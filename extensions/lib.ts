/**
 * Shared helpers for the pi-main extensions.
 *
 * Kept dependency-free so the guard, memory, and tracker extensions can use
 * the same config and path rules.
 */

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
      "AGENTS.override.md",
      "AGENTS.MD",
      "CLAUDE.md",
      "CLAUDE.MD",
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

function defaultConfigCopy(): PiMainConfig {
  return {
    ...DEFAULT_CONFIG,
    tracker: { ...DEFAULT_CONFIG.tracker, allowedTools: [...(DEFAULT_CONFIG.tracker.allowedTools ?? [])] },
    guard: { ...DEFAULT_CONFIG.guard, allowedWritePaths: [...DEFAULT_CONFIG.guard.allowedWritePaths] },
    memory: { ...DEFAULT_CONFIG.memory },
    handoff: { ...DEFAULT_CONFIG.handoff },
    extensions: [...DEFAULT_CONFIG.extensions],
    skills: [...DEFAULT_CONFIG.skills],
  };
}

export function loadConfig(): PiMainConfig {
  const configPath = process.env.PI_MAIN_CONFIG;
  let config = defaultConfigCopy();
  try {
    if (configPath) {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<PiMainConfig>;
      config = {
        ...config,
        ...raw,
        tracker: { ...config.tracker, ...(raw.tracker ?? {}) },
        guard: { ...config.guard, ...(raw.guard ?? {}) },
        memory: { ...config.memory, ...(raw.memory ?? {}) },
        handoff: { ...config.handoff, ...(raw.handoff ?? {}) },
      };
    }
  } catch (error) {
    if (configPath) throw new Error(`Could not load trusted pi-main config at ${configPath}: ${(error as Error).message}`);
    config = defaultConfigCopy();
  }
  const projectConfigPath = process.env.PI_MAIN_PROJECT_CONFIG;
  if (!projectConfigPath) return config;
  try {
    const raw = JSON.parse(fs.readFileSync(projectConfigPath, "utf8")) as { tracker?: Partial<TrackerConfig> };
    const tracker = raw.tracker ?? {};
    const provider = tracker.provider;
    if (provider !== undefined && !["github", "local", "mcp"].includes(provider)) return config;
    const nextTracker = { ...config.tracker, provider: provider ?? config.tracker.provider };
    if (typeof tracker.mcpServer === "string") nextTracker.mcpServer = tracker.mcpServer;
    if (typeof tracker.localDir === "string") {
      const root = realpathLoose(projectRoot());
      const localDir = realpathLoose(resolveProjectPath(tracker.localDir, root));
      if (!isWithin(root, localDir)) return config;
      // Preserve the configured path spelling so the tracker layer can still
      // detect an in-project symlink that resolves somewhere else inside root.
      nextTracker.localDir = tracker.localDir;
    }
    config.tracker = nextTracker;
  } catch {
    // A bad project-local preference file cannot invalidate the trusted base config.
  }
  return config;
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

export function contextUsageBucket(percent: number, warnAt: number, hardWarnAt: number): 0 | 1 | 2 {
  const fraction = percent / 100;
  return fraction >= hardWarnAt ? 2 : fraction >= warnAt ? 1 : 0;
}

export function formatContextPercent(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function realpathLoose(target: string): string {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync.native(absolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw error;
    let entryExists = false;
    try { fs.lstatSync(absolute); entryExists = true; }
    catch (statError) { if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError; }
    if (entryExists) throw error;
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
  let canonicalRoot: string;
  let sharedRoot: string;
  let canonicalTarget: string;
  try {
    canonicalRoot = realpathLoose(process.env.PI_MAIN_WORKTREE_ROOT || root);
    sharedRoot = realpathLoose(root);
    canonicalTarget = realpathLoose(absolutePath);
  } catch {
    return { allowed: false, reason: "Blocked: could not safely resolve the write path.", absolutePath, relativePath: "" };
  }
  const inWorktree = isWithin(canonicalRoot, canonicalTarget);
  let handoffBase: string;
  let tmpBase: string;
  try {
    handoffBase = realpathLoose(handoffDir(config, sharedRoot));
    tmpBase = realpathLoose(path.join(sharedRoot, ".pi-main", "tmp"));
  } catch {
    return { allowed: false, reason: "Blocked: could not safely resolve shared state paths.", absolutePath, relativePath: "" };
  }
  const handoffName = path.basename(canonicalTarget);
  const sharedHandoff = isWithin(sharedRoot, handoffBase) && isWithin(handoffBase, canonicalTarget) &&
    /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-.+\.md$/.test(handoffName);
  const sharedTmp = isWithin(sharedRoot, tmpBase) && isWithin(tmpBase, canonicalTarget);
  const relativePath = path.relative(inWorktree ? canonicalRoot : sharedRoot, canonicalTarget).split(path.sep).join("/");

  if (!inWorktree && !sharedHandoff && !sharedTmp) {
    return {
      allowed: false,
      reason: `Blocked: writes must stay inside the project (${canonicalRoot}).`,
      absolutePath,
      relativePath,
    };
  }

  let writesToMemory = false;
  try {
    const memoryPaths = [memoryDir(config, root), memoryDir(config, canonicalRoot)];
    writesToMemory = memoryPaths.some((dir) => isWithin(realpathLoose(dir), canonicalTarget));
  } catch {
    return { allowed: false, reason: "Blocked: could not safely resolve the memory path.", absolutePath, relativePath };
  }
  if (writesToMemory) {
    return {
      allowed: false,
      reason:
        "Blocked: project memory is writable only through the pi-memory tools (memory_write/memory_forget).",
      absolutePath,
      relativePath,
    };
  }

  if (relativePath.split("/").some((part) => part === ".git" || part === "node_modules")) {
    return {
      allowed: false,
      reason: "Blocked: .git and node_modules are off-limits.",
      absolutePath,
      relativePath,
    };
  }

  if (!sharedHandoff && !sharedTmp && !matchesAnyPath(relativePath, config.guard.allowedWritePaths)) {
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

function shellWords(input: string): string[] | null {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | null = null;
  for (const ch of input) {
    if (ch === "\n" || ch === "\r") return null;
    if (quote === "'") { if (ch === "'") quote = null; else word += ch; }
    else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (/[$\\`]/.test(ch)) return null;
      else word += ch;
    }
    else if (ch === "'" || ch === '"') quote = ch;
    else if (/\s/.test(ch)) { if (word) words.push(word); word = ""; }
    else if (/[;|&<>`\\$*?\[\]{}()]/.test(ch)) return null;
    else word += ch;
  }
  if (quote) return null;
  if (word) words.push(word);
  return words;
}
function positionalArgs(args: string[]): string[] { return args.filter((arg) => !arg.startsWith("-")); }
export function isSafeBashCommand(command: string, config = loadConfig()): { safe: boolean; reason?: string } {
  const trimmed = command.trim();
  if (!trimmed) return { safe: false, reason: "Empty command." };
  const parts = shellWords(trimmed);
  if (!parts?.length) return { safe: false, reason: "Blocked: shell syntax, expansion, chaining, redirection, and command substitution are disabled in pi-main." };
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
      args.some((arg) => ["-delete", "-exec", "-execdir", "-ok", "-okdir"].includes(arg) || /^-(?:fprint|fprintf|fls)/.test(arg))
    ) {
      return { safe: false, reason: "Blocked: find may not delete, execute, or write files." };
    }
    return { safe: true };
  }

  if (head === "sort") {
    if (args.some((arg) => arg.startsWith("--o") || arg.startsWith("--comp")) || args.some((arg) => /^-[^-]*o/.test(arg)) || positionalArgs(args).length > 1) {
      return { safe: false, reason: "Blocked: sort may not write output files." };
    }
    return { safe: true };
  }

  if (head === "rg") {
    if (args.some((arg) => arg.startsWith("--pre") || arg.startsWith("--hostname-bin"))) {
      return { safe: false, reason: "Blocked: ripgrep preprocessors may execute commands." };
    }
    return { safe: true };
  }

  if (head === "tree") {
    if (args.some((arg) => arg.startsWith("--o")) || args.some((arg) => /^-[^-]*o/.test(arg)) || positionalArgs(args).length > 1) {
      return { safe: false, reason: "Blocked: tree may write only to stdout." };
    }
    return { safe: true };
  }
  if (head === "file") {
    if (args.some((arg) => arg.startsWith("--comp") || /^-[^-]*C/.test(arg))) return { safe: false, reason: "Blocked: file may not compile or update its magic database." };
    return { safe: true };
  }
  if (head === "date") {
    const flags = new Set(["-u", "--utc", "--universal", "--rfc-3339", "--iso-8601"]);
    const safe = args.every((arg) => flags.has(arg) || arg.startsWith("--rfc-3339=") || arg.startsWith("--iso-8601=") || arg.startsWith("+")) &&
      positionalArgs(args).every((arg) => arg.startsWith("+"));
    return safe ? { safe: true } : { safe: false, reason: "Blocked: date accepts display-only formats and timezone flags." };
  }

  if (head === "uniq") {
    const flags = new Set(["-c", "--count", "-d", "--repeated", "-u", "--unique", "-i", "--ignore-case"]);
    if (positionalArgs(args).length > 1 || args.some((arg) => arg.startsWith("-") && !flags.has(arg) && !/^-w\d+$/.test(arg))) return { safe: false, reason: "Blocked: uniq may read one input file and write only to stdout." };
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
      const valueFlags = new Set(["--contains", "--merged", "--no-merged", "--points-at", "--format", "--sort"]);
      const readOnlyFlags = new Set(["-a", "--all", "-r", "--remotes", "--list", "-l", "-v", "-vv", "--verbose", "--color", "--no-color", "--show-current", "--ignore-case"]);
      const listing = branchArgs.includes("--list") || branchArgs.includes("-l");
      for (let i = 0; i < branchArgs.length; i++) {
        const arg = branchArgs[i]!;
        if (valueFlags.has(arg)) {
          if (branchArgs[i + 1] && !branchArgs[i + 1]!.startsWith("-")) i++;
          continue;
        }
        if (arg.startsWith("--format=") || arg.startsWith("--sort=")) continue;
        if (arg.startsWith("-")) {
          if (!readOnlyFlags.has(arg)) return { safe: false, reason: "Blocked: git branch accepts read-only list/filter options only." };
          continue;
        }
        if (!listing) return { safe: false, reason: "Blocked: git branch positional arguments create branches." };
      }
    }
    if (sub === "remote") {
      const remoteArgs = args.slice(1);
      const safeRemote = remoteArgs.length === 0 || (remoteArgs.length === 1 && ["-v", "--verbose"].includes(remoteArgs[0]!)) ||
        (["show", "get-url"].includes(remoteArgs[0] ?? "") && remoteArgs.length <= 2);
      if (!safeRemote) return { safe: false, reason: "Blocked: only git remote listing/show/get-url commands are allowed." };
    }
    if (args.some((arg) => arg.startsWith("--out") || ["--ext-diff", "--textconv", "--open-files-in-pager"].includes(arg) || (sub === "grep" && /^-[^-]*O/.test(arg))) || args.some((arg) => /^-[^-]*o/.test(arg))) {
      return { safe: false, reason: "Blocked: git read commands may not write output files." };
    }
    return { safe: true };
  }

  if (head === "npm") {
    const sub = args[0] ?? "";
    if (["list", "ls", "view", "info", "search", "outdated"].includes(sub)) return { safe: true };
    return { safe: false, reason: `Blocked: npm ${sub || "(none)"} may modify the project.` };
  }

  if (head === "yarn" || head === "pnpm") {
    const sub = args[0] ?? "";
    if (["list", "info", "why", "outdated"].includes(sub)) return { safe: true };
    return { safe: false, reason: `Blocked: ${head} ${sub || "(none)"} may modify the project.` };
  }

  if (head === "node" && args.length === 1 && args[0] === "--version") return { safe: true };
  if ((head === "python" || head === "python3") && args.length === 1 && args[0] === "--version") return { safe: true };

  if (head === "gh") {
    if (!config.guard.allowGithubTrackerWrites || config.tracker.provider !== "github") {
      return { safe: false, reason: "Blocked: GitHub tracker writes are disabled in pi-main config." };
    }
    const domain = args[0] ?? "";
    const sub = args[1] ?? "";
    if (domain === "issue") {
      if (["list", "view", "status"].includes(sub)) return { safe: true };
      return {
        safe: false,
        reason: `Blocked: gh issue ${sub || "(none)"} writes tracker state. Use tracker_create_issue, tracker_comment_issue, or tracker_close_issue.`,
      };
    }
    if (domain === "label") {
      if (sub === "list") return { safe: true };
      return { safe: false, reason: "Blocked: label writes go through tracker_configure." };
    }
    if (domain === "repo" && sub === "view") return { safe: true };
    if (domain === "auth" && sub === "status") return { safe: true };
    return {
      safe: false,
      reason: "Blocked: only read-only gh issue/label/repo/auth commands are allowed through the shell.",
    };
  }

  return {
    safe: false,
    reason: `Blocked: ${head} is not on the pi-main read-only allowlist.`,
  };
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
