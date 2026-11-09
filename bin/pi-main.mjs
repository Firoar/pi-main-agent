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

const DEFAULT_CONFIG = {
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
  tracker: { provider: "github", localDir: ".scratch", allowedTools: [] },
  guard: { bash: "read-only", allowedWritePaths: [] },
  memory: { dir: ".pi-main/memory" },
  handoff: { dir: ".pi-main/handoffs", warnAt: 0.7, hardWarnAt: 0.85 },
  model: null,
  thinking: null,
};

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
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (process.env.PI_MAIN_CONFIG) fail(`cannot read PI_MAIN_CONFIG at ${file}: ${error.message}`);
    console.error(`pi-main: warning: cannot read ${file}: ${error.message}`);
    return {};
  }
}

function mergeConfig(raw) {
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

  // A cloned repo may contain a config file. Allow it to choose the tracker,
  // memory location, and handoff location, but never to enable extra
  // extensions or loosen the guard. Those require an explicit PI_MAIN_CONFIG
  // or the user-level config.
  if (!explicit) {
    const projectConfig = [path.join(root, "pi-main.config.json"), path.join(root, ".pi-main", "config.json")].find(
      (candidate) => fs.existsSync(candidate) && path.resolve(candidate) !== path.resolve(basePath),
    );
    if (projectConfig) {
      const project = readJson(projectConfig);
      const disallowed = ["extensions", "guard", "skills", "model", "thinking"].filter((key) => key in project);
      if (disallowed.length) {
        console.error(
          `pi-main: warning: ${path.relative(root, projectConfig)} may only override tracker, memory, and handoff; ignoring ${disallowed.join(", ")}.`,
        );
      }
      raw = {
        ...base,
        tracker: { ...(base.tracker ?? {}), ...(project.tracker ?? {}) },
        memory: { ...(base.memory ?? {}), ...(project.memory ?? {}) },
        handoff: { ...(base.handoff ?? {}), ...(project.handoff ?? {}) },
      };

      const insideProject = (value) => {
        if (!value) return true;
        const resolved = resolveFrom(root, value);
        return resolved === root || resolved.startsWith(`${root}${path.sep}`);
      };
      if (!insideProject(raw.memory?.dir)) {
        console.error("pi-main: warning: repo config memory.dir must stay inside the project; using default.");
        raw.memory = { ...raw.memory, dir: DEFAULT_CONFIG.memory.dir };
      }
      if (!insideProject(raw.handoff?.dir)) {
        console.error("pi-main: warning: repo config handoff.dir must stay inside the project; using default.");
        raw.handoff = { ...raw.handoff, dir: DEFAULT_CONFIG.handoff.dir };
      }
      if (!insideProject(raw.tracker?.localDir)) {
        console.error("pi-main: warning: repo config tracker.localDir must stay inside the project; using default.");
        raw.tracker = { ...raw.tracker, localDir: DEFAULT_CONFIG.tracker.localDir };
      }
    }
  }

  const config = mergeConfig(raw);
  let configPath = basePath;

  // Extensions read PI_MAIN_CONFIG. Write the merged, sanitized config to the
  // per-project state directory so project-level tracker/memory overrides are
  // visible to them without exposing unsafe keys.
  if (!explicit && raw !== base) {
    fs.mkdirSync(stateDir, { recursive: true });
    configPath = path.join(stateDir, "config.json");
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  return { path: configPath, basePath, config };
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
    return resolved;
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

function assertInsideProject(label, target, root) {
  const realRoot = fs.realpathSync(root);
  let realTarget;
  try {
    realTarget = fs.realpathSync(target);
  } catch {
    const parent = path.dirname(path.resolve(target));
    try {
      realTarget = path.join(fs.realpathSync(parent), path.basename(target));
    } catch {
      realTarget = path.resolve(target);
    }
  }
  if (realTarget !== realRoot && !realTarget.startsWith(`${realRoot}${path.sep}`)) {
    fail(`${label} resolves outside the project: ${target}`);
  }
}

function ensureProjectState(config, root) {
  const state = path.join(root, ".pi-main");
  for (const dir of [
    state,
    path.join(state, "memory", "daily"),
    path.join(state, "memory", "backups"),
    path.join(state, "tmp"),
    path.join(state, "handoffs"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const gitignore = path.join(state, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(gitignore, "memory/\ntmp/\nhandoffs/\n", "utf8");
  }

  // Custom locations from config.
  const memory = resolveProjectPath(root, config.memory.dir);
  fs.mkdirSync(path.join(memory, "daily"), { recursive: true });
  fs.mkdirSync(path.join(memory, "backups"), { recursive: true });
  fs.mkdirSync(resolveProjectPath(root, config.handoff.dir), { recursive: true });
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
    .map((name) => {
      const file = path.join(dir, name);
      return { file, name, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function pickHandoff(dir, selector) {
  const handoffs = listHandoffs(dir);
  if (!handoffs.length) return undefined;
  if (!selector) return handoffs[0];

  const expanded = expandHome(selector);
  if (path.isAbsolute(expanded) || selector.includes("/") || selector.endsWith(".md")) {
    const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(CWD, expanded);
    return fs.existsSync(candidate)
      ? { file: candidate, name: path.basename(candidate), mtime: fs.statSync(candidate).mtimeMs }
      : undefined;
  }

  const needle = selector.toLowerCase();
  return handoffs.find((entry) => entry.name.toLowerCase().includes(needle));
}

function frontmatterProject(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return undefined;
  const line = match[1]
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith("project:"));
  if (!line) return undefined;
  return line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
}

function handoffPrompt(file) {
  const content = fs.readFileSync(file, "utf8").trim();
  return `You are continuing a pi-main session from a handoff.

Handoff file: ${file}

<handoff>
${content}
</handoff>

Read the linked issues, ADRs, spec, and Wayfinder map before acting. Then summarize:
1. the goal
2. the current state
3. decisions already settled
4. the open frontier
5. the single next action

Wait for the user to confirm the next action before changing files or delegating work. Do not redo settled work.`;
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
  const root = gitProjectRoot(CWD);
  const slug = projectSlug(root);
  const stateDir = path.join(os.homedir(), ".pi/agent/pi-main/projects", slug);
  const sessionsDir = path.join(stateDir, "sessions");
  const { path: configPath, basePath, config } = loadConfigFile(root, stateDir);
  fs.mkdirSync(sessionsDir, { recursive: true });
  assertInsideProject("memory.dir", resolveProjectPath(root, config.memory.dir), root);
  assertInsideProject("handoff.dir", resolveProjectPath(root, config.handoff.dir), root);
  assertInsideProject("tracker.localDir", resolveProjectPath(root, config.tracker.localDir || ".scratch"), root);
  ensureProjectState(config, root);

  const memory = resolveProjectPath(root, config.memory.dir);
  const handoffs = resolveProjectPath(root, config.handoff.dir);
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.listHandoffs) {
    const entries = listHandoffs(handoffs);
    if (!entries.length) {
      console.log(`No handoffs in ${handoffs}`);
      return;
    }
    for (const entry of entries) {
      console.log(`${new Date(entry.mtime).toISOString()}  ${path.relative(root, entry.file)}`);
    }
    return;
  }

  const piArgs = [
    "--append-system-prompt",
    path.join(PACKAGE_ROOT, "prompts/main-agent.md"),
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
          : `no handoffs found in ${handoffs}. Run /handoff in a pi-main session first.`,
      );
    }
    const content = fs.readFileSync(picked.file, "utf8");
    if (!content.trim()) fail(`handoff is empty: ${picked.file}`);
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
    PI_MAIN_CONFIG: configPath,
    PI_MAIN_STATE_DIR: stateDir,
    PI_MEMORY_DIR: memory,
    PI_MAIN_HANDOFF_DIR: handoffs,
    PI_MAIN_TRACKER_PROVIDER: config.tracker.provider,
  };

  if (process.env.PI_MAIN_DRY_RUN === "1") {
    console.log(
      JSON.stringify(
        {
          command: "pi",
          args: piArgs,
          env: {
            PI_MAIN_AGENT: env.PI_MAIN_AGENT,
            PI_MAIN_ROOT: env.PI_MAIN_ROOT,
            PI_MAIN_PROJECT_ROOT: env.PI_MAIN_PROJECT_ROOT,
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
