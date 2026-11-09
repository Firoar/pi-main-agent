import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { callTool, fixture, loadExtension, register } from "./state-helpers.mjs";

test("local tracker uses qualified paths, rejects ambiguous numbers, and updates canonical status", async (t) => {
  const root = fixture(t);
  const extension = await loadExtension("tracker", root);
  const { tools } = register(extension);
  const created = await callTool(tools, "tracker_create_issue", { title: "First", body: "Details", feature: "alpha", type: "task" });
  const createdPath = created.content[0].text;
  assert.match(createdPath, /^\.scratch\/alpha\/issues\/01-first\.md$/);
  const file = path.join(root, createdPath);
  assert.match(fs.readFileSync(file, "utf8"), /\*\*Type:\*\* task/);

  await callTool(tools, "tracker_create_issue", { title: "Second", body: "Details", feature: "beta" });
  const child = await callTool(tools, "tracker_create_issue", { title: "Child", body: "Details", feature: "alpha", parent: createdPath, blockedBy: [".scratch/beta/issues/01-second.md"] });
  const childFile = fs.readFileSync(path.join(root, child.content[0].text), "utf8");
  assert.match(childFile, new RegExp(`\\*\\*Part of:\\*\\* ${createdPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(childFile, /\*\*Blocked by:\*\* \.scratch\/beta\/issues\/01-second\.md/);
  const ambiguous = await callTool(tools, "tracker_comment_issue", { issue: "1", body: "wrong target" });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /ambiguous.*full relative issue file path/i);

  const commented = await callTool(tools, "tracker_comment_issue", { issue: createdPath, body: "qualified comment" });
  assert.equal(commented.isError, false);
  fs.appendFileSync(file, "\n**Status:** done\n");
  const closed = await callTool(tools, "tracker_close_issue", { issue: createdPath, comment: "done" });
  assert.equal(closed.isError, false);
  const contents = fs.readFileSync(file, "utf8");
  assert.equal((contents.match(/^\*\*Status:\*\*/gm) ?? []).length, 1);
  assert.match(contents, /^\*\*Status:\*\* resolved$/m);
});

test("tracker configuration persists only project tracker settings and bootstraps missing labels safely", async (t) => {
  const root = fixture(t);
  const extension = await loadExtension("tracker", root);
  const { tools } = register(extension);
  const configFile = path.join(root, "pi-main.config.json");
  process.env.PI_MAIN_PROJECT_CONFIG = configFile;
  fs.writeFileSync(configFile, JSON.stringify({ name: "unchanged", tracker: { allowedTools: ["trusted-tool"], localDir: ".scratch" } }));

  const setupLocal = await callTool(tools, "tracker_configure", { provider: "local", localDir: ".scratch/custom" });
  assert.equal(setupLocal.isError, undefined, setupLocal.content[0].text);
  const saved = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.deepEqual(saved, { name: "unchanged", tracker: { allowedTools: ["trusted-tool"], localDir: ".scratch/custom", provider: "local" } });
  const issue = await callTool(tools, "tracker_create_issue", { title: "Configured", body: "works" });
  assert.match(issue.content[0].text, /^\.scratch\/custom\//);

  const beforeReject = fs.readFileSync(configFile, "utf8");
  const rejected = await callTool(tools, "tracker_configure", { provider: "local", localDir: "../outside" });
  assert.equal(rejected.isError, true);
  assert.equal(fs.readFileSync(configFile, "utf8"), beforeReject);
  fs.mkdirSync(path.join(root, "src"));
  fs.symlinkSync(path.join(root, "src"), path.join(root, "jump"));
  const symlinked = await callTool(tools, "tracker_configure", { provider: "local", localDir: "jump/new" });
  assert.equal(symlinked.isError, true);
  assert.equal(fs.readFileSync(configFile, "utf8"), beforeReject);

  const bin = path.join(root, "fake-bin");
  fs.mkdirSync(bin);
  const log = path.join(root, "label-create.log");
  const gh = path.join(bin, "gh");
  fs.writeFileSync(gh, `#!/bin/sh\nif [ "$1" = auth ]; then exit 0; fi\nif [ "$1" = repo ] && [ "$2" = view ]; then printf 'Firoar/example\\n'; exit 0; fi\nif [ "$1" = api ] && [ "$2" = --paginate ]; then printf 'ready-for-agent\\nwayfinder:task\\n'; exit 0; fi\nif [ "$1" = label ] && [ "$2" = create ]; then printf '%s\\n' "$3" >> "$GH_LABEL_LOG"; exit 0; fi\nexit 1\n`);
  fs.chmodSync(gh, 0o755);
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.GH_LABEL_LOG = log;
  const base = JSON.parse(fs.readFileSync(process.env.PI_MAIN_CONFIG, "utf8"));
  base.guard.allowGithubTrackerWrites = true;
  fs.writeFileSync(process.env.PI_MAIN_CONFIG, JSON.stringify(base));
  const setupGithub = await callTool(tools, "tracker_configure", { provider: "github" });
  assert.equal(setupGithub.isError, undefined);
  const createdLabels = fs.readFileSync(log, "utf8").trim().split("\n");
  assert.deepEqual(createdLabels.sort(), ["wayfinder:grilling", "wayfinder:map", "wayfinder:prototype", "wayfinder:research"].sort());

  base.guard.allowGithubTrackerWrites = false;
  fs.writeFileSync(process.env.PI_MAIN_CONFIG, JSON.stringify(base));
  const writesBefore = fs.readFileSync(log, "utf8");
  const skipped = await callTool(tools, "tracker_configure", { provider: "github" });
  assert.equal(skipped.isError, true);
  assert.match(skipped.content[0].text, /bootstrap was skipped/);
  assert.equal(fs.readFileSync(log, "utf8"), writesBefore);

  const beforeMcp = fs.readFileSync(configFile, "utf8");
  const missingMcp = await callTool(tools, "tracker_configure", { provider: "mcp" });
  assert.equal(missingMcp.isError, true);
  assert.equal(fs.readFileSync(configFile, "utf8"), beforeMcp);
  const configuredMcp = await callTool(tools, "tracker_configure", { provider: "mcp", mcpServer: "linear" });
  assert.match(configuredMcp.content[0].text, /verify that issue tools are available/);

  delete process.env.PI_MAIN_PROJECT_CONFIG;
  const explicitConfig = await callTool(tools, "tracker_configure", { provider: "local" });
  assert.equal(explicitConfig.isError, true);
  assert.match(explicitConfig.content[0].text, /explicit PI_MAIN_CONFIG/);
});

test("local tracker rejects traversal and GitHub writes respect the guard", async (t) => {
  const root = fixture(t);
  const extension = await loadExtension("tracker", root);
  const { tools } = register(extension);
  const traversal = await callTool(tools, "tracker_create_issue", { title: "Bad", body: "x", feature: ".." });
  assert.equal(traversal.isError, true);
  assert.match(traversal.content[0].text, /must not be/);
  const config = JSON.parse(fs.readFileSync(process.env.PI_MAIN_CONFIG, "utf8"));
  config.tracker.provider = "github";
  fs.writeFileSync(process.env.PI_MAIN_CONFIG, JSON.stringify(config));
  const blocked = await callTool(tools, "tracker_create_issue", { title: "No", body: "write" });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /disabled by guard/);

  const linkRoot = path.join(root, ".scratch", "feature");
  fs.mkdirSync(path.dirname(linkRoot), { recursive: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.symlinkSync(path.join(root, "src"), linkRoot);
  config.tracker.provider = "local";
  fs.writeFileSync(process.env.PI_MAIN_CONFIG, JSON.stringify(config));
  const linked = await callTool(tools, "tracker_create_issue", { title: "Link attack", body: "x", feature: "feature" });
  assert.equal(linked.isError, true);
});

test("memory search excludes backups after forget and rejects paths outside the project", async (t) => {
  const root = fixture(t);
  const extension = await loadExtension("pi-memory", root);
  const { tools, events } = register(extension);
  await callTool(tools, "memory_write", { target: "memory", text: "unique-state-token" });
  await callTool(tools, "memory_write", { target: "memory", text: "retained-fact" });
  fs.writeFileSync(path.join(root, ".pi-main/memory/note.md"), "unique-state-token is unrelated to memory entries\n");
  assert.match((await events.before_agent_start({ systemPrompt: "base" })).systemPrompt, /unique-state-token/);
  const removed = await callTool(tools, "memory_forget", { query: "unique-state-token" });
  assert.match(removed.content[0].text, /Removed 1/);
  const search = await callTool(tools, "memory_search", { query: "unique-state-token" });
  assert.equal(search.content[0].text, "No matches.");
  assert.doesNotMatch((await events.before_agent_start({ systemPrompt: "base" })).systemPrompt, /unique-state-token/);
  const withoutRg = path.join(root, "no-executables");
  fs.mkdirSync(withoutRg);
  const originalPath = process.env.PATH;
  process.env.PATH = withoutRg;
  assert.equal((await callTool(tools, "memory_search", { query: "unique-state-token" })).content[0].text, "No matches.");
  assert.match((await callTool(tools, "memory_search", { query: "retained-fact" })).content[0].text, /retained-fact/);
  process.env.PATH = originalPath;
  const secondRemoval = await callTool(tools, "memory_forget", { query: "retained-fact" });
  assert.notEqual(removed.details.backups[0], secondRemoval.details.backups[0]);
  assert.equal(fs.readdirSync(path.join(root, ".pi-main/memory/backups")).length, 2);

  process.env.PI_MEMORY_DIR = path.join(root, "..", "outside-memory");
  await assert.rejects(callTool(tools, "memory_write", { target: "memory", text: "escape" }), /escapes its configured project directory/);
  delete process.env.PI_MEMORY_DIR;
});
