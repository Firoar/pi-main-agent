import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contextUsageBucket, formatContextPercent } from "../extensions/lib.ts";

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

test("context thresholds use Pi's 0–100 percentage scale", () => {
  assert.equal(formatContextPercent(0.7), "1%");
  assert.equal(formatContextPercent(70), "70%");
  assert.equal(contextUsageBucket(69, 0.7, 0.85), 0);
  assert.equal(contextUsageBucket(70, 0.7, 0.85), 1);
  assert.equal(contextUsageBucket(84, 0.7, 0.85), 1);
  assert.equal(contextUsageBucket(85, 0.7, 0.85), 2);
});

async function loadGuardModule(t) {
  let source = fs.readFileSync(new URL("../extensions/main-guard.ts", import.meta.url), "utf8");
  source = source.replace(/^import type \{ ExtensionAPI, ExtensionContext \}[^\n]*\n/m, "");
  source = source.replace(
    /^import \{ isToolCallEventType \} from "@earendil-works\/pi-coding-agent";$/m,
    'const isToolCallEventType = (kind, event) => event.toolName === kind;',
  );
  const libPath = fileURLToPath(new URL("../extensions/lib.ts", import.meta.url));
  source = source.replace('from "./lib.ts";', `from "${pathToFileURL(libPath).href}";`);
  const directory = makeTempDir(t, "pi-main-guard-module-");
  const file = path.join(directory, "main-guard.ts");
  fs.writeFileSync(file, source);
  return (await import(pathToFileURL(file).href)).default;
}

test("registered guard handler protects writes even for tracker-named tools", async (t) => {
  isolatePiEnv(t);
  const root = makeTempDir(t, "pi-main-guard-handler-");
  const configPath = path.join(root, "pi-main.json");
  const projectConfigPath = path.join(root, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ tracker: { allowedTools: ["*"] }, guard: { allowedWritePaths: ["docs/**"] } }));
  fs.writeFileSync(projectConfigPath, JSON.stringify({ tracker: { provider: "local" } }));
  process.env.PI_MAIN_AGENT = "1";
  process.env.PI_MAIN_PROJECT_ROOT = root;
  process.env.PI_MAIN_CONFIG = configPath;
  process.env.PI_MAIN_PROJECT_CONFIG = projectConfigPath;
  const handlers = new Map();
  const pi = {
    on: (name, handler) => handlers.set(name, handler),
    registerCommand: () => {},
    getActiveTools: () => [],
    getAllTools: () => [],
    sendUserMessage: () => {},
  };
  const mainGuard = await loadGuardModule(t);
  mainGuard(pi);
  const ctx = { cwd: root, hasUI: false, ui: { setStatus: () => {}, notify: () => {}, theme: { fg: (_c, s) => s } }, getContextUsage: () => ({ percent: 0 }), sessionManager: { getSessionId: () => "test-session" } };
  const writeHandler = handlers.get("tool_call");
  const result = await writeHandler({ type: "tool_call", toolName: "write", input: { path: "src/private.ts" } }, ctx);
  assert.equal(result.block, true);
  assert.match(result.reason, /not a planning-doc path/);
  const bash = await writeHandler({ type: "tool_call", toolName: "bash", input: { command: "sort -oout input" } }, ctx);
  assert.equal(bash.block, true);
  const localTracker = await writeHandler({ type: "tool_call", toolName: "bash", input: { command: "gh issue list" } }, ctx);
  assert.equal(localTracker.block, true);
  fs.writeFileSync(projectConfigPath, JSON.stringify({ tracker: { provider: "github" } }));
  const githubTracker = await writeHandler({ type: "tool_call", toolName: "bash", input: { command: "gh issue list" } }, ctx);
  assert.equal(githubTracker, undefined);
});

test("context guard injects an actionable custom message and creates a draft handoff", async (t) => {
  isolatePiEnv(t);
  const root = makeTempDir(t, "pi-main-context-handler-");
  process.env.PI_MAIN_AGENT = "1";
  process.env.PI_MAIN_PROJECT_ROOT = root;
  delete process.env.PI_MAIN_CONFIG;
  const handlers = new Map();
  const pi = { on: (name, handler) => handlers.set(name, handler), registerCommand: () => {}, getActiveTools: () => [], getAllTools: () => [], sendUserMessage: () => {} };
  (await loadGuardModule(t))(pi);
  const ctx = { cwd: root, hasUI: false, ui: { setStatus: () => {}, notify: () => {}, theme: { fg: (_c, s) => s } }, getContextUsage: () => ({ percent: 70 }), sessionManager: { getSessionId: () => "test-session" } };
  const event = { messages: [] };
  await handlers.get("context")(event, ctx);
  assert.equal(event.messages.length, 1);
  assert.equal(event.messages[0].customType, "pi-main-context");
  assert.match(event.messages[0].content, /using the write tool/);
  const files = fs.readdirSync(path.join(root, ".pi-main", "handoffs"));
  assert.equal(files.length, 1);
  assert.match(fs.readFileSync(path.join(root, ".pi-main", "handoffs", files[0]), "utf8"), /status: draft/);
});
