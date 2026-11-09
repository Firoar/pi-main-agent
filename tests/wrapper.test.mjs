import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const LAUNCHER = path.join(PACKAGE_ROOT, "bin", "pi-main.mjs");

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-wrapper-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const home = path.join(base, "user");
  fs.mkdirSync(root);
  fs.mkdirSync(home);
  // The production launcher gets its normal os.homedir(). Tests isolate it
  // without changing the user's HOME or writing to real Pi configuration.
  const preload = path.join(base, "test-home.cjs");
  fs.writeFileSync(preload, `require('node:os').homedir = () => ${JSON.stringify(home)}; require('node:module').syncBuiltinESMExports();`);
  const env = { ...process.env, PI_MAIN_DRY_RUN: "1" };
  for (const key of ["PI_MAIN_CONFIG", "PI_MAIN_PROJECT_CONFIG", "PI_MAIN_WORKTREE_ROOT", "PI_MAIN_PROJECT_ROOT"]) delete env[key];
  const run = (args = [], overrides = {}) => spawnSync(process.execPath, ["--require", preload, LAUNCHER, ...args], {
    cwd: overrides.cwd || root,
    env: { ...env, ...overrides.env },
    encoding: "utf8",
  });
  const resolve = (args = [], overrides = {}) => {
    const result = run(args, overrides);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const config = (value) => fs.writeFileSync(path.join(root, "pi-main.config.json"), JSON.stringify(value));
  return { base, root, home, run, resolve, config };
}

function handoff(root, title, status = "complete") {
  return `---\nproject: ${JSON.stringify(root)}\n${status ? `status: ${status}\n` : ""}---\n# ${title}\n\n## Goal\nDeliver ${title}.\n\n## Current state\nRequirements are recorded in the linked issue.\n\n## Next action\nReview acceptance criteria before dispatch.\n`;
}

function git(root, args) {
  return execFileSync("git", ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
}

test("launcher resolves the lead stack without creating state in dry-run", (t) => {
  const f = fixture(t);
  const resolved = f.resolve();
  assert.equal(resolved.command, "pi");
  assert.equal(resolved.env.PI_MAIN_AGENT, "1");
  assert.equal(resolved.env.PI_MAIN_PROJECT_ROOT, f.root);
  assert.equal(resolved.env.PI_MAIN_WORKTREE_ROOT, f.root);
  assert.equal(resolved.env.PI_MAIN_PROJECT_CONFIG, path.join(f.root, ".pi-main/config.json"));
  const prompt = resolved.args[resolved.args.indexOf("--append-system-prompt") + 1];
  assert.ok(prompt.includes(path.join(PACKAGE_ROOT, "docs/orchestration.md")));
  assert.ok(prompt.includes(f.root));
  for (const file of ["extensions/main-guard.ts", "extensions/pi-memory.ts", "extensions/tracker.ts", "skills/grilling"]) {
    assert.ok(resolved.args.includes(path.join(PACKAGE_ROOT, file)));
  }
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.deepEqual(fs.readdirSync(f.home), []);
});

test("repo config cannot loosen policy through top-level or tracker fields", (t) => {
  const f = fixture(t);
  f.config({ tracker: { provider: "local", localDir: ".tickets", allowedTools: ["*"] }, guard: { bash: "unrestricted" }, extensions: ["/tmp/evil"] });
  const { config } = f.resolve();
  assert.equal(config.tracker.provider, "local");
  assert.equal(config.tracker.localDir, ".tickets");
  assert.deepEqual(config.tracker.allowedTools, []);
  assert.equal(config.guard.bash, "read-only");
  assert.deepEqual(config.extensions, []);
});

test("real launch passes the sanitized config and project overlay to Pi", (t) => {
  const f = fixture(t);
  f.config({ tracker: { provider: "local", allowedTools: ["*"] } });
  const bin = path.join(f.base, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "pi"), "#!/usr/bin/env node\nconsole.log(JSON.stringify({config:process.env.PI_MAIN_CONFIG,overlay:process.env.PI_MAIN_PROJECT_CONFIG,worktree:process.env.PI_MAIN_WORKTREE_ROOT}));\n", { mode: 0o755 });
  const result = f.run([], { env: { PI_MAIN_DRY_RUN: "0", PATH: `${bin}${path.delimiter}${process.env.PATH}` } });
  assert.equal(result.status, 0, result.stderr);
  const launched = JSON.parse(result.stdout);
  const config = JSON.parse(fs.readFileSync(launched.config, "utf8"));
  assert.equal(config.tracker.provider, "local");
  assert.deepEqual(config.tracker.allowedTools, []);
  assert.equal(launched.overlay, path.join(f.root, "pi-main.config.json"));
  assert.equal(launched.worktree, f.root);
  assert.ok(fs.existsSync(path.join(f.root, ".pi-main/memory/daily")));
});

test("trusted partial configuration keeps defaults and its policy", (t) => {
  const f = fixture(t);
  const userConfig = path.join(f.home, ".config/pi-main/config.json");
  fs.mkdirSync(path.dirname(userConfig), { recursive: true });
  fs.writeFileSync(userConfig, JSON.stringify({ tracker: { allowedTools: ["mcp__linear__*"] } }));
  f.config({ tracker: { provider: "local", allowedTools: ["*"] } });
  const { config } = f.resolve();
  assert.deepEqual(config.tracker.allowedTools, ["mcp__linear__*"]);
  assert.ok(config.guard.allowedWritePaths.includes("docs/**"));
  assert.equal(config.memory.maxChars, 3000);
});

test("explicit configuration disables project configuration overlays", (t) => {
  const f = fixture(t);
  f.config({ tracker: { provider: "local" } });
  const trusted = path.join(f.base, "trusted.json");
  fs.writeFileSync(trusted, JSON.stringify({ tracker: { provider: "github" } }));
  const resolved = f.resolve([], { env: { PI_MAIN_CONFIG: trusted, PI_MAIN_PROJECT_CONFIG: path.join(f.root, "pi-main.config.json") } });
  assert.equal(resolved.config.tracker.provider, "github");
  assert.equal(resolved.env.PI_MAIN_PROJECT_CONFIG, undefined);
});

test("invalid config fails clearly before creating state", (t) => {
  const f = fixture(t);
  for (const value of [{ tracker: "local" }, { tracker: { provider: "gitlab" } }, { handoff: { warnAt: 85 } }, { memory: { dir: 42 } }]) {
    f.config(value);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /pi-main:/);
    assert.equal(fs.existsSync(path.join(f.home, ".pi")), false);
  }
});

for (const [section, key] of [["memory", "dir"], ["handoff", "dir"], ["tracker", "localDir"]]) {
  test(`${section} rejects symlink escapes through missing ancestors`, (t) => {
    const f = fixture(t);
    const outside = path.join(f.base, "outside");
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.root, "jump"));
    f.config({ [section]: { [key]: "jump/missing/deep/state" } });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /outside the project/);
    assert.deepEqual(fs.readdirSync(outside), []);
  });
}

test("initial state rejects a symlinked default child before writing anything", (t) => {
  const f = fixture(t);
  const outside = path.join(f.base, "outside");
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(f.root, ".pi-main"));
  fs.symlinkSync(outside, path.join(f.root, ".pi-main/tmp"));
  const result = f.run([], { env: { PI_MAIN_DRY_RUN: "0" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the project/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.deepEqual(fs.readdirSync(path.join(f.root, ".pi-main")), ["tmp"]);
});

test("configured state cannot target git administration or dependencies", (t) => {
  const f = fixture(t);
  for (const value of [{ memory: { dir: ".git" } }, { tracker: { localDir: "node_modules/tickets" } }]) {
    f.config(value);
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /protected/);
  }
});

test("state initialization cannot follow an internal symlink into source", (t) => {
  const f = fixture(t);
  const source = path.join(f.root, "src");
  fs.mkdirSync(source);
  fs.symlinkSync(source, path.join(f.root, ".pi-main"));
  const result = f.run([], { env: { PI_MAIN_DRY_RUN: "0" } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /symbolic link inside the project/);
  assert.deepEqual(fs.readdirSync(source), []);
});

test("help and handoff listing do not initialize a project", (t) => {
  const f = fixture(t);
  for (const args of [["--main-help"], ["--list-handoffs"]]) {
    assert.equal(f.run(args).status, 0);
  }
  assert.deepEqual(fs.readdirSync(f.root), []);
  assert.deepEqual(fs.readdirSync(f.home), []);
});

test("automatic handoff resume skips newer drafts and empty skeletons", (t) => {
  const f = fixture(t);
  const dir = path.join(f.root, ".pi-main/handoffs");
  fs.mkdirSync(dir, { recursive: true });
  const complete = path.join(dir, "old-complete.md");
  fs.writeFileSync(complete, handoff(f.root, "Complete work"));
  fs.utimesSync(complete, new Date(0), new Date(0));
  fs.writeFileSync(path.join(dir, "new-draft.md"), handoff(f.root, "Draft work", "draft"));
  fs.writeFileSync(path.join(dir, "empty-skeleton.md"), "## Goal\n<!-- goal -->\n## Current state\n## Next action\n");
  const resolved = f.resolve(["--continue-from-handoff"]);
  const prompt = resolved.args.at(-1);
  assert.match(prompt, /# Complete work/);
  assert.doesNotMatch(prompt, /# Draft work/);
  assert.match(prompt, /only the linked artifacts needed/);
  assert.match(f.run(["--list-handoffs"]).stdout, /incomplete/);
});

test("explicit handoff resumes even without any default handoff directory", (t) => {
  const f = fixture(t);
  const file = path.join(f.root, "saved.md");
  fs.writeFileSync(file, handoff(f.root, "Explicit handoff", ""));
  const resolved = f.resolve(["--handoff", file]);
  assert.match(resolved.args.at(-1), /# Explicit handoff/);
});

test("explicit draft and falsely completed skeletons are rejected", (t) => {
  const f = fixture(t);
  const file = path.join(f.root, "saved.md");
  fs.writeFileSync(file, handoff(f.root, "Incomplete", "draft"));
  assert.match(f.run(["--handoff", file]).stderr, /not complete/);
  fs.writeFileSync(file, "---\nstatus: complete\n---\n## Goal\n<!-- explain -->\n## Current state\nTODO\n## Next action\nTODO\n");
  assert.match(f.run(["--handoff", file]).stderr, /missing substantive Goal/);
});

test("linked worktrees keep shared state and expose their own write root", (t) => {
  const f = fixture(t);
  git(f.root, ["init", "-q"]);
  git(f.root, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "fixture"]);
  const worktree = path.join(f.base, "worktree");
  git(f.root, ["worktree", "add", "-qb", "test-worktree", worktree]);
  const main = f.resolve();
  const linked = f.resolve([], { cwd: worktree });
  assert.equal(linked.env.PI_MAIN_PROJECT_ROOT, f.root);
  assert.equal(linked.env.PI_MAIN_WORKTREE_ROOT, worktree);
  assert.equal(linked.env.PI_MEMORY_DIR, main.env.PI_MEMORY_DIR);
  assert.equal(linked.env.PI_MAIN_HANDOFF_DIR, main.env.PI_MAIN_HANDOFF_DIR);
});
