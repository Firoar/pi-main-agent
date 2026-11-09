#!/usr/bin/env node

/**
 * pi-main: launch Pi as an engineering-lead planning agent.
 *
 * This is intentionally a wrapper, not a globally installed Pi package:
 * the lead prompt, guard, memory, and tracker extensions are loaded only for
 * sessions started through this command.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CWD = process.cwd();

const DEFAULT_CONFIG = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "pi-main.config.json"), "utf8"));

function fail(message) {
  console.error(`pi-main: ${message}`);
  process.exit(1);
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function resolveFrom(base, value) {
  const expanded = expandHome(value);
  return path.isAbsolute(expanded) ? expanded : path.resolve(base, expanded);
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
    return value;
  } catch (error) {
    fail(`cannot read config at ${file}: ${error.message}`);
  }
}

function selectFields(value, keys, label) {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function validateConfig(config) {
  for (const key of ["extensions", "skills"]) {
    if (!Array.isArray(config[key]) || config[key].some((v) => typeof v !== "string" || !v.trim())) fail(`${key} must be an array of nonempty strings`);
  }
  if (!["github", "local", "mcp"].includes(config.tracker.provider)) fail("tracker.provider must be github, local, or mcp");
  for (const [key, value] of [["memory.dir", config.memory.dir], ["handoff.dir", config.handoff.dir], ["tracker.localDir", config.tracker.localDir]]) {
    if (typeof value !== "string" || !value.trim()) fail(`${key} must be a nonempty path`);
  }
  if (!["off", "read-only", "unrestricted"].includes(config.guard.bash)) fail("guard.bash must be off, read-only, or unrestricted");
  for (const [key, value] of [["guard.allowedWritePaths", config.guard.allowedWritePaths], ["tracker.allowedTools", config.tracker.allowedTools]]) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) fail(`${key} must be an array of strings`);
  }
  for (const key of ["allowGithubTrackerWrites", "allowGhApi"]) {
    if (typeof config.guard[key] !== "boolean") fail(`guard.${key} must be a boolean`);
  }
  for (const key of ["maxChars", "dailyMaxChars", "openMaxChars"]) {
    if (!Number.isInteger(config.memory[key]) || config.memory[key] <= 0) fail(`memory.${key} must be a positive integer`);
  }
  const { warnAt, hardWarnAt } = config.handoff;
  if (!(Number.isFinite(warnAt) && Number.isFinite(hardWarnAt) && warnAt > 0 && warnAt < hardWarnAt && hardWarnAt <= 1)) {
    fail("handoff thresholds must satisfy 0 < warnAt < hardWarnAt <= 1");
  }
  if (config.tracker.mcpServer !== undefined && (typeof config.tracker.mcpServer !== "string" || !config.tracker.mcpServer.trim())) fail("tracker.mcpServer must be a nonempty string");
}

function mergeConfig(raw) {
  for (const section of ["tracker", "guard", "memory", "handoff"]) selectFields(raw[section], [], section);
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    tracker: { ...DEFAULT_CONFIG.tracker, ...(raw.tracker ?? {}) },
    guard: { ...DEFAULT_CONFIG.guard, ...(raw.guard ?? {}) },
    memory: { ...DEFAULT_CONFIG.memory, ...(raw.memory ?? {}) },
    handoff: { ...DEFAULT_CONFIG.handoff, ...(raw.handoff ?? {}) },
  };
}

function loadConfigFile(root, stateDir) {
  const explicit = process.env.PI_MAIN_CONFIG ? resolveFrom(CWD, process.env.PI_MAIN_CONFIG) : undefined;
  const userConfig = path.join(os.homedir(), ".config", "pi-main", "config.json");
  const basePath =
    explicit ?? (fs.existsSync(userConfig) ? userConfig : path.join(PACKAGE_ROOT, "pi-main.config.json"));
  const base = readJson(basePath);
  let raw = base;
  let projectConfigPath;

  // A cloned repo may contain a config file. Allow it to choose the tracker,
  // memory location, and handoff location, but never to enable extra
  // extensions or loosen the guard. Those require an explicit PI_MAIN_CONFIG
  // or the user-level config.
  if (!explicit) {
    const projectConfig = [path.join(root, "pi-main.config.json"), path.join(root, ".pi-main", "config.json")].find(
      (candidate) => fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(basePath),
    );
    projectConfigPath = projectConfig ?? path.join(root, ".pi-main", "config.json");
    assertInsideProject("project config", projectConfigPath, root);
    if (projectConfig) {
      const project = readJson(projectConfig);
      const disallowed = ["extensions", "guard", "skills", "model", "thinking"].filter((key) => key in project);
      if (disallowed.length) {
        console.error(
          `pi-main: warning: ${path.relative(root, projectConfig)} may only override tracker, memory, and handoff; ignoring ${disallowed.join(", ")}.`,
        );
      }
      if (project.tracker && Object.hasOwn(project.tracker, "allowedTools")) {
        console.error("pi-main: warning: repo config cannot set tracker.allowedTools; use trusted user configuration.");
      }
      raw = {
        ...base,
        tracker: { ...(base.tracker ?? {}), ...selectFields(project.tracker, ["provider", "localDir", "mcpServer"], "tracker") },
        memory: { ...(base.memory ?? {}), ...selectFields(project.memory, ["dir", "maxChars", "dailyMaxChars", "openMaxChars"], "memory") },
        handoff: { ...(base.handoff ?? {}), ...selectFields(project.handoff, ["dir", "warnAt", "hardWarnAt"], "handoff") },
      };
    }
  }

  const config = mergeConfig(raw);
  validateConfig(config);
  assertInsideProject("memory.dir", resolveProjectPath(root, config.memory.dir), root);
  assertInsideProject("handoff.dir", resolveProjectPath(root, config.handoff.dir), root);
  assertInsideProject("tracker.localDir", resolveProjectPath(root, config.tracker.localDir), root);
  let configPath = basePath;

  // Extensions read PI_MAIN_CONFIG. Write the merged, sanitized config to the
  // per-project state directory so project-level tracker/memory overrides are
  // visible to them without exposing unsafe keys.
  if (!explicit && raw !== base) {
    configPath = path.join(stateDir, "config.json");
  }

  return { path: configPath, basePath, projectConfigPath, config, needsSnapshot: configPath !== basePath };
}

function gitWorktreeRoot(cwd) {
  return fs.realpathSync(spawnSyncText("git", ["rev-parse", "--show-toplevel"], cwd)?.trim() || cwd);
}

function gitProjectRoot(cwd) {
  try {
    const common =
      spawnSyncText("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd) ??
      spawnSyncText("git", ["rev-parse", "--git-common-dir"], cwd);
    if (!common) return cwd;
    const resolved = path.resolve(cwd, common.trim());
    // Normal repo: <root>/.git. Linked worktree: <main>/.git.
    if (path.basename(resolved) === ".git") return path.dirname(resolved);
    return gitWorktreeRoot(cwd);
  } catch {
    return cwd;
  }
}

function spawnSyncText(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout : undefined;
}

function projectSlug(root) {
  const base = path.basename(root).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha256").update(root).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

function resolveProjectPath(root, value) {
  return resolveFrom(root, value);
}

function realpathLoose(target) {
  const absolute = path.resolve(target);
  try {
    return fs.realpathSync(absolute);
  } catch (error) {
    // Resolve every existing ancestor, even if several intervening directories
    // have not been created. Do not follow a dangling symlink lexically.
    if (error.code !== "ENOENT") throw error;
    if (fs.lstatSync(absolute, { throwIfNoEntry: false })?.isSymbolicLink()) fail(`dangling symlink: ${absolute}`);
    const parent = path.dirname(absolute);
    if (parent === absolute) throw error;
    return path.join(realpathLoose(parent), path.basename(absolute));
  }
}

function assertInsideProject(label, target, root) {
  const realRoot = fs.realpathSync(root);
  const realTarget = realpathLoose(target);
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    fail(`${label} resolves outside the project: ${target}`);
  }
  if (path.relative(realRoot, realTarget).split(path.sep).some((part) => part === ".git" || part === "node_modules")) {
    fail(`${label} resolves into a protected .git or node_modules directory: ${target}`);
  }
  let current = path.resolve(target);
  while (current !== path.dirname(current)) {
    const entry = fs.lstatSync(current, { throwIfNoEntry: false });
    if (entry?.isSymbolicLink()) {
      const resolved = realpathLoose(current);
      if (resolved === realRoot || resolved.startsWith(`${realRoot}${path.sep}`)) {
        fail(`${label} must not use a symbolic link inside the project: ${current}`);
      }
    }
    if (current === path.resolve(root)) break;
    current = path.dirname(current);
  }
}

function ensureProjectState(config, root) {
  const state = path.join(root, ".pi-main");
  const memory = resolveProjectPath(root, config.memory.dir);
  const directories = [
    state,
    path.join(state, "memory", "daily"),
    path.join(state, "memory", "backups"),
    path.join(state, "tmp"),
    path.join(state, "handoffs"),
    path.join(memory, "daily"),
    path.join(memory, "backups"),
    resolveProjectPath(root, config.handoff.dir),
  ];
  const gitignore = path.join(state, ".gitignore");
  for (const target of [...directories, gitignore]) assertInsideProject("project state", target, root);
  for (const dir of directories) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, "memory/\ntmp/\nhandoffs/\n", "utf8");
  }
}

function frontmatterValue(content, key) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const line = match?.[1].split(/\r?\n/).find((entry) => entry.trim().startsWith(`${key}:`));
  return line?.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
}

function handoffProblem(content) {
  if (!content.trim()) return "empty handoff";
  const status = frontmatterValue(content, "status");
  if (status && status !== "complete") return `handoff status is ${status}, not complete`;
  for (const section of ["Goal", "Current state", "Next action"]) {
    const match = new RegExp(`^## ${section}\\s*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m").exec(content);
    const text = match?.[1].replace(/<!--[\s\S]*?-->/g, "").trim();
    if (!text || /^(?:TODO|TBD|N\/A|\[.*\]|[-*\s]+)$/i.test(text)) return `missing substantive ${section} section`;
  }
}

function listHandoffs(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith(".md"))
    .flatMap((name) => {
      const file = path.join(dir, name);
      try {
        if (!fs.lstatSync(file).isFile()) return [];
        const problem = handoffProblem(fs.readFileSync(file, "utf8"));
        return [{ file, name, mtime: fs.statSync(file).mtimeMs, problem }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function pickHandoff(dir, selector) {
  const expanded = selector ? expandHome(selector) : "";
  if (selector && (path.isAbsolute(expanded) || selector.includes("/") || selector.endsWith(".md"))) {
    const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(CWD, expanded);
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile()
      ? { file: candidate, name: path.basename(candidate), mtime: fs.statSync(candidate).mtimeMs }
      : undefined;
  }
  const handoffs = listHandoffs(dir).filter((entry) => !entry.problem);
  if (!selector) return handoffs[0];
  const needle = selector.toLowerCase();
  return handoffs.find((entry) => entry.name.toLowerCase().includes(needle));
}

function frontmatterProject(content) {
  return frontmatterValue(content, "project");
}

function handoffPrompt(file) {
  const content = fs.readFileSync(file, "utf8").trim();
  return `You are continuing a pi-main session from a handoff.

Handoff file: ${file}

<handoff>
${content}
</handoff>

Read the current issue or Wayfinder map first, then only the linked artifacts needed for the next action. Reconcile active worker identifiers and their latest state before dispatching replacements. Then summarize:
1. the goal
2. the current state
3. decisions already settled
4. the open frontier
5. the single next action

Continue work already authorized in this chat. If the handoff is the only record of authorization, ask the user to confirm the next action before changing files or delegating work. Do not redo settled work.`;
}

function printHelp() {
  console.log(`pi-main — engineering-lead launcher for Pi

Usage:
  pi-main [pi options] [messages...]
  pi-main --continue-from-handoff [topic|path]
  pi-main --handoff <file>
  pi-main --list-handoffs
  pi-main --main-help

Wrapper options:
  --continue-from-handoff [selector]
      Start a fresh session from the newest handoff. A selector can be a
      topic fragment or an explicit path.
  --handoff <file>
      Start a fresh session from a specific handoff file.
  --list-handoffs
      List handoff files newest first.
  --main-help
      Show this help.

Everything else is passed to pi. The lead prompt, guard, memory, and tracker
extensions are loaded only for this command.

Environment:
  PI_MAIN_CONFIG          Path to pi-main.config.json
  PI_MAIN_DRY_RUN=1       Print the resolved command and exit
`);
}

function parseArgs(argv) {
  const result = {
    passthrough: [],
    continueHandoff: false,
    handoffSelector: undefined,
    explicitHandoff: undefined,
    listHandoffs: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--continue-from-handoff") {
      result.continueHandoff = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        result.handoffSelector = next;
        i++;
      }
      continue;
    }
    if (arg.startsWith("--continue-from-handoff=")) {
      result.continueHandoff = true;
      result.handoffSelector = arg.slice("--continue-from-handoff=".length);
      continue;
    }
    if (arg === "--handoff") {
      const next = argv[i + 1];
      if (!next) fail("--handoff requires a file path");
      result.explicitHandoff = next;
      i++;
      continue;
    }
    if (arg.startsWith("--handoff=")) {
      result.explicitHandoff = arg.slice("--handoff=".length);
      continue;
    }
    if (arg === "--list-handoffs") {
      result.listHandoffs = true;
      continue;
    }
    if (arg === "--main-help") {
      result.help = true;
      continue;
    }
    result.passthrough.push(arg);
  }
  return result;
}

function resolveExtension(value, configBase) {
  const expanded = expandHome(value);
  if (
    expanded.startsWith("npm:") ||
    expanded.startsWith("git:") ||
    expanded.startsWith("http://") ||
    expanded.startsWith("https://") ||
    path.isAbsolute(expanded)
  ) {
    return expanded;
  }

  const packageCandidate = path.resolve(PACKAGE_ROOT, expanded);
  if (fs.existsSync(packageCandidate)) return packageCandidate;
  return path.resolve(configBase, expanded);
}

function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    printHelp();
    return;
  }
  const root = gitProjectRoot(CWD);
  const worktree = gitWorktreeRoot(CWD);
  const slug = projectSlug(root);
  const stateDir = path.join(os.homedir(), ".pi/agent/pi-main/projects", slug);
  const sessionsDir = path.join(stateDir, "sessions");
  const { path: configPath, basePath, projectConfigPath, config, needsSnapshot } = loadConfigFile(root, stateDir);

  const memory = resolveProjectPath(root, config.memory.dir);
  const handoffs = resolveProjectPath(root, config.handoff.dir);
  if (parsed.listHandoffs) {
    const entries = listHandoffs(handoffs);
    if (!entries.length) {
      console.log(`No handoffs in ${handoffs}`);
      return;
    }
    for (const entry of entries) {
      console.log(`${new Date(entry.mtime).toISOString()}  ${path.relative(root, entry.file)}${entry.problem ? `  [incomplete: ${entry.problem}]` : ""}`);
    }
    return;
  }

  const piArgs = [
    "--append-system-prompt",
    `${fs.readFileSync(path.join(PACKAGE_ROOT, "prompts/main-agent.md"), "utf8")}\n\n## Runtime paths\n\n` +
      `The active worktree is ${JSON.stringify(worktree)}. Planning documents belong there.\n` +
      `Shared project state belongs to ${JSON.stringify(root)}.\n` +
      `Memory directory: ${JSON.stringify(memory)} (use memory tools).\n` +
      `Handoff directory: ${JSON.stringify(handoffs)}.\n` +
      `Orchestration protocol path: ${JSON.stringify(path.join(PACKAGE_ROOT, "docs/orchestration.md"))}. Read it before delegating.\n`,
    "--session-dir",
    sessionsDir,
    "-e",
    path.join(PACKAGE_ROOT, "extensions/main-guard.ts"),
    "-e",
    path.join(PACKAGE_ROOT, "extensions/pi-memory.ts"),
    "-e",
    path.join(PACKAGE_ROOT, "extensions/tracker.ts"),
  ];

  for (const extension of config.extensions ?? []) {
    piArgs.push("-e", resolveExtension(extension, path.dirname(basePath)));
  }

  const skills = Array.isArray(config.skills) ? config.skills : [];
  if (!skills.length || skills.includes("*")) {
    piArgs.push("--skill", path.join(PACKAGE_ROOT, "skills"));
  } else {
    for (const skill of skills) {
      const skillPath = path.resolve(PACKAGE_ROOT, "skills", skill);
      if (fs.existsSync(skillPath)) piArgs.push("--skill", skillPath);
      else console.error(`pi-main: skill not found: ${skill}`);
    }
  }

  if (config.model) piArgs.push("--model", String(config.model));
  if (config.thinking) piArgs.push("--thinking", String(config.thinking));

  // Handoff mode: fresh session seeded with the handoff.
  if (parsed.continueHandoff || parsed.explicitHandoff) {
    const selector = parsed.explicitHandoff ?? parsed.handoffSelector;
    const picked = pickHandoff(handoffs, selector);
    if (!picked) {
      fail(
        selector
          ? `no handoff matching "${selector}" in ${handoffs}`
          : `no complete handoffs found in ${handoffs}. Run /handoff in a pi-main session first.`,
      );
    }
    const content = fs.readFileSync(picked.file, "utf8");
    const problem = handoffProblem(content);
    if (problem) fail(`cannot resume ${picked.file}: ${problem}`);
    const handoffProject = frontmatterProject(content);
    if (handoffProject && path.resolve(handoffProject) !== path.resolve(root)) {
      console.error(
        `pi-main: warning: handoff project is ${handoffProject}, current project is ${root}`,
      );
    }
    console.error(`pi-main: continuing from ${path.relative(root, picked.file)}`);
    piArgs.push(handoffPrompt(picked.file));
  }

  piArgs.push(...parsed.passthrough);

  const env = {
    ...process.env,
    PI_MAIN_AGENT: "1",
    PI_MAIN_ROOT: PACKAGE_ROOT,
    PI_MAIN_PROJECT_ROOT: root,
    PI_MAIN_WORKTREE_ROOT: worktree,
    PI_MAIN_CONFIG: configPath,
    PI_MAIN_STATE_DIR: stateDir,
    PI_MEMORY_DIR: memory,
    PI_MAIN_HANDOFF_DIR: handoffs,
    PI_MAIN_TRACKER_PROVIDER: config.tracker.provider,
  };
  if (projectConfigPath) env.PI_MAIN_PROJECT_CONFIG = projectConfigPath;
  else delete env.PI_MAIN_PROJECT_CONFIG;

  if (process.env.PI_MAIN_DRY_RUN === "1") {
    console.log(
      JSON.stringify(
        {
          command: "pi",
          args: piArgs,
          config,
          env: {
            PI_MAIN_AGENT: env.PI_MAIN_AGENT,
            PI_MAIN_ROOT: env.PI_MAIN_ROOT,
            PI_MAIN_PROJECT_ROOT: env.PI_MAIN_PROJECT_ROOT,
            PI_MAIN_WORKTREE_ROOT: env.PI_MAIN_WORKTREE_ROOT,
            PI_MAIN_PROJECT_CONFIG: env.PI_MAIN_PROJECT_CONFIG,
            PI_MAIN_CONFIG: env.PI_MAIN_CONFIG,
            PI_MAIN_STATE_DIR: env.PI_MAIN_STATE_DIR,
            PI_MEMORY_DIR: env.PI_MEMORY_DIR,
            PI_MAIN_HANDOFF_DIR: env.PI_MAIN_HANDOFF_DIR,
          },
        },
        null,
        2,
      ),
    );
    return;
  }

  ensureProjectState(config, root);
  fs.mkdirSync(sessionsDir, { recursive: true });
  if (needsSnapshot) fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  const child = spawn("pi", piArgs, { stdio: "inherit", env });

  child.on("error", (error) => {
    if (error.code === "ENOENT") {
      fail("cannot find `pi` on PATH. Install Pi first: https://pi.dev");
    }
    fail(`failed to launch pi: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

main();
