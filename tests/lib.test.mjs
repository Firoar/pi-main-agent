import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  checkWritePath,
  DEFAULT_CONFIG,
  globToRegExp,
  isSafeBashCommand,
  loadConfig,
  matchesAnyPath,
} from "../extensions/lib.ts";

const PI_ENV = ["PI_MAIN_AGENT", "PI_MAIN_PROJECT_ROOT", "PI_MAIN_PROJECT_CONFIG", "PI_MAIN_CONFIG", "PI_MAIN_WORKTREE_ROOT"];

function makeTempDir(t, prefix) {
  const tmp = fs.realpathSync.native(os.tmpdir());
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(tmp, prefix)));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function isolatePiEnv(t) {
  const previous = Object.fromEntries(PI_ENV.map((name) => [name, process.env[name]]));
  for (const name of PI_ENV) delete process.env[name];
  t.after(() => {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}

test("glob matching", () => {
  assert.equal(globToRegExp("docs/**").test("docs/adr/0001.md"), true);
  assert.equal(globToRegExp("docs/**").test("docs/adr"), true);
  assert.equal(globToRegExp("*.md").test("GLOSSARY.md"), true);
  assert.equal(globToRegExp("*.md").test("docs/GLOSSARY.md"), false);
  assert.equal(matchesAnyPath("docs/adr/0001.md", ["src/**", "docs/**"]), true);
});

test("write path guard", (t) => {
  isolatePiEnv(t);
  const root = makeTempDir(t, "pi-main-test-");
  fs.mkdirSync(path.join(root, "docs", "adr"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });

  assert.equal(checkWritePath("docs/adr/0001-test.md", undefined, root).allowed, true);
  assert.equal(checkWritePath("GLOSSARY.md", undefined, root).allowed, true);
  assert.equal(checkWritePath("src/index.ts", undefined, root).allowed, false);
  assert.equal(checkWritePath(".pi-main/memory/MEMORY.md", undefined, root).allowed, false);
  assert.equal(checkWritePath("../outside.md", undefined, root).allowed, false);
  assert.equal(checkWritePath("src/index.ts", undefined, root, path.join(root, "sub")).allowed, false);
  assert.equal(checkWritePath("../docs/adr/0002-test.md", undefined, root, path.join(root, "sub")).allowed, true);
});

test("worktree writes stay local except shared handoffs and scratch files", (t) => {
  isolatePiEnv(t);
  const shared = makeTempDir(t, "pi-main-shared-");
  const worktree = makeTempDir(t, "pi-main-worktree-");
  const sibling = makeTempDir(t, "pi-main-sibling-");
  fs.mkdirSync(path.join(worktree, "docs"), { recursive: true });
  fs.mkdirSync(path.join(shared, ".pi-main", "handoffs"), { recursive: true });
  fs.mkdirSync(path.join(shared, ".pi-main", "tmp"), { recursive: true });
  fs.mkdirSync(path.join(shared, ".pi-main", "tmp", "node_modules"), { recursive: true });
  process.env.PI_MAIN_WORKTREE_ROOT = worktree;
  const handoff = path.join(shared, ".pi-main", "handoffs", "2026-11-09-10-11-12-topic.md");
  assert.equal(checkWritePath("docs/plan.md", undefined, shared, worktree).allowed, true);
  assert.equal(checkWritePath(handoff, undefined, shared, worktree).allowed, true);
  assert.equal(checkWritePath(path.join(shared, ".pi-main", "handoffs", "notes.md"), undefined, shared, worktree).allowed, false);
  assert.equal(checkWritePath(path.join(shared, ".pi-main", "tmp", "draft.md"), undefined, shared, worktree).allowed, true);
  assert.equal(checkWritePath(path.join(shared, ".pi-main", "tmp", "node_modules", "pkg", "index.js"), undefined, shared, worktree).allowed, false);
  const escaped = path.join(shared, ".pi-main", "tmp", "escaped");
  fs.symlinkSync(sibling, escaped, "dir");
  assert.equal(checkWritePath(path.join(escaped, "draft.md"), undefined, shared, worktree).allowed, false);
  const escapedHandoffs = path.join(shared, ".pi-main", "handoffs-link");
  fs.symlinkSync(sibling, escapedHandoffs, "dir");
  const customHandoffConfig = { ...DEFAULT_CONFIG, handoff: { ...DEFAULT_CONFIG.handoff, dir: ".pi-main/handoffs-link" } };
  assert.equal(checkWritePath(path.join(escapedHandoffs, "2026-11-09-10-11-12-topic.md"), customHandoffConfig, shared, worktree).allowed, false);
  assert.equal(checkWritePath(path.join(shared, "docs", "shared.md"), undefined, shared, worktree).allowed, false);
  assert.equal(checkWritePath(path.join(sibling, "docs", "other.md"), undefined, shared, worktree).allowed, false);
});

test("project-local config overlays only tracker preferences and confines localDir", (t) => {
  isolatePiEnv(t);
  const root = makeTempDir(t, "pi-main-config-");
  const outside = makeTempDir(t, "pi-main-outside-");
  const projectConfig = path.join(root, "config.json");
  const trustedConfig = path.join(root, "trusted.json");
  process.env.PI_MAIN_PROJECT_ROOT = root;
  process.env.PI_MAIN_PROJECT_CONFIG = projectConfig;
  fs.mkdirSync(path.join(root, "src"));
  fs.symlinkSync(path.join(root, "src"), path.join(root, "scratch-link"), "dir");
  fs.writeFileSync(projectConfig, JSON.stringify({ tracker: { provider: "local", localDir: "scratch-link", allowedTools: ["*"] }, guard: { bash: "unrestricted" } }));
  let config = loadConfig();
  assert.equal(config.tracker.provider, "local");
  assert.equal(config.tracker.localDir, "scratch-link", "preserve path spelling for downstream symlink rejection");
  fs.writeFileSync(projectConfig, JSON.stringify({ tracker: { provider: "local", localDir: ".scratch", allowedTools: ["*"] }, guard: { bash: "unrestricted" } }));
  config = loadConfig();
  assert.equal(config.tracker.provider, "local");
  assert.equal(config.tracker.localDir, ".scratch");
  assert.deepEqual(config.tracker.allowedTools, []);
  assert.equal(config.guard.bash, "read-only");
  fs.writeFileSync(projectConfig, JSON.stringify({ tracker: { localDir: outside } }));
  config = loadConfig();
  assert.equal(config.tracker.localDir, ".scratch");
  fs.writeFileSync(trustedConfig, "{");
  process.env.PI_MAIN_CONFIG = trustedConfig;
  assert.throws(() => loadConfig(), /Could not load trusted pi-main config/);
});

test("read-only bash policy", (t) => {
  isolatePiEnv(t);
  assert.equal(isSafeBashCommand("git status").safe, true);
  assert.equal(isSafeBashCommand("git diff --stat").safe, true);
  assert.equal(isSafeBashCommand("git log --oneline").safe, true);
  assert.equal(isSafeBashCommand("git log --oneline --all").safe, true);
  assert.equal(isSafeBashCommand("git branch").safe, true);
  assert.equal(isSafeBashCommand("git branch -a").safe, true);
  assert.equal(isSafeBashCommand("git branch --list foo").safe, true);
  assert.equal(isSafeBashCommand("git branch foo").safe, false);
  assert.equal(isSafeBashCommand("rg -n foo src").safe, true);
  assert.equal(isSafeBashCommand("rg -n rm src").safe, true);
  assert.equal(isSafeBashCommand("find . -name '*.ts'").safe, true);
  assert.equal(isSafeBashCommand("jq -r '.items[] | .name' data.json").safe, true, "quoted jq filters are passed as a single read-only argument");
  assert.equal(isSafeBashCommand("jq -r '.items[]' data.json | cat").safe, false);
  assert.equal(isSafeBashCommand("uniq input.txt").safe, true);
  assert.equal(isSafeBashCommand("uniq input.txt output.txt").safe, false);
  assert.equal(isSafeBashCommand("uniq *").safe, false);
  assert.equal(isSafeBashCommand("uniq input{,output}").safe, false);
  assert.equal(isSafeBashCommand("find . -name *.ts").safe, false);
  assert.equal(isSafeBashCommand("find . -name '*.ts'").safe, true);
  assert.equal(isSafeBashCommand("sort input.txt output.txt").safe, false);
  assert.equal(isSafeBashCommand("sort -o result.txt input.txt").safe, false);
  assert.equal(isSafeBashCommand("sort -roFILE input.txt").safe, false);
  assert.equal(isSafeBashCommand("sort --output=result.txt input.txt").safe, false);
  assert.equal(isSafeBashCommand("sort --compress-program=touch input.txt").safe, false);
  assert.equal(isSafeBashCommand("tree -o tree.txt").safe, false);
  assert.equal(isSafeBashCommand("file -Cm").safe, false);
  assert.equal(isSafeBashCommand("date -s2020-01-01").safe, false);
  assert.equal(isSafeBashCommand("npm audit fix").safe, false);
  assert.equal(isSafeBashCommand("npm audit --json fix").safe, false);
  assert.equal(isSafeBashCommand("pnpm audit --fix").safe, false);
  assert.equal(isSafeBashCommand("git remote set-head origin main").safe, false);
  assert.equal(isSafeBashCommand("git diff --output=result.patch").safe, false);
  assert.equal(isSafeBashCommand("git grep -Osh pattern").safe, false);
  assert.equal(isSafeBashCommand("git branch --set-upstream-to=origin/main").safe, false);
  assert.equal(isSafeBashCommand("git branch --contains --set-upstream-to=origin/main").safe, false);
  assert.equal(isSafeBashCommand("node --version --eval 'touch pwned'").safe, false);
  assert.equal(isSafeBashCommand("find . -fprint0 output.txt").safe, false);
  assert.equal(isSafeBashCommand("find . -fprintf output.txt '%p'").safe, false);
  assert.equal(isSafeBashCommand("cat $(touch pwned)").safe, false);
  assert.equal(isSafeBashCommand('cat "$(touch pwned)"').safe, false);
  assert.equal(isSafeBashCommand('cat "`touch pwned`"').safe, false);
  assert.equal(isSafeBashCommand("cat file\n; touch pwned").safe, false);
  assert.equal(isSafeBashCommand("gh issue list").safe, true);
  assert.equal(isSafeBashCommand("gh issue view 42").safe, true);
  assert.equal(isSafeBashCommand("gh label list").safe, true);
  assert.equal(isSafeBashCommand("gh issue create --title x --body-file body.md").safe, false);
  assert.equal(isSafeBashCommand("gh issue comment 42 --body-file body.md").safe, false);
  assert.equal(isSafeBashCommand("gh issue close 42").safe, false);
  assert.equal(isSafeBashCommand("gh label create test").safe, false);

  assert.equal(isSafeBashCommand("touch src/x.ts").safe, false);
  assert.equal(isSafeBashCommand("echo hi > file").safe, false);
  assert.equal(isSafeBashCommand("git commit -m x").safe, false);
  assert.equal(isSafeBashCommand("gh api repos/x/y").safe, false);
  assert.equal(isSafeBashCommand("find . -delete").safe, false);
  assert.equal(isSafeBashCommand("curl https://example.com").safe, false);
});
