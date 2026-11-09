import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const typeboxStub = `export const Type = new Proxy({}, { get: (_, key) => (...args) => ({ kind: String(key), args }) });`;

export async function loadExtension(name, root) {
  const extensions = path.join(root, "extensions");
  fs.mkdirSync(extensions, { recursive: true });
  for (const file of ["lib.ts", `${name}.ts`]) {
    let source = fs.readFileSync(new URL(`../extensions/${file}`, import.meta.url), "utf8");
    source = source.replace('import { Type } from "typebox";', 'import { Type } from "./typebox-stub.mjs";');
    fs.writeFileSync(path.join(extensions, file), source);
  }
  fs.writeFileSync(path.join(extensions, "typebox-stub.mjs"), typeboxStub);
  return import(`${pathToFileURL(path.join(extensions, `${name}.ts`)).href}?test=${Date.now()}`);
}

export function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-state-")));
  const keys = ["PI_SUBAGENT_ID", "PI_MAIN_PROJECT_ROOT", "PI_MAIN_WORKTREE_ROOT", "PI_MAIN_AGENT", "PI_MAIN_PROJECT_CONFIG", "PI_MEMORY_DIR", "PI_MAIN_CONFIG", "PATH", "GH_LABEL_LOG"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.PI_MAIN_PROJECT_ROOT = root;
  process.env.PI_MAIN_WORKTREE_ROOT = root;
  process.env.PI_MAIN_AGENT = "1";
  delete process.env.PI_MAIN_PROJECT_CONFIG;
  delete process.env.PI_MEMORY_DIR;
  delete process.env.PI_SUBAGENT_ID;
  process.env.PI_MAIN_CONFIG = path.join(root, "config.json");
  fs.writeFileSync(process.env.PI_MAIN_CONFIG, JSON.stringify({
    tracker: { provider: "local", localDir: ".scratch" },
    guard: { allowGithubTrackerWrites: false },
    memory: { dir: ".pi-main/memory", maxChars: 3000, dailyMaxChars: 1500, openMaxChars: 1500 },
  }));
  return root;
}

export function register(extension, events = {}) {
  const tools = new Map();
  extension.default({
    registerTool(tool) { tools.set(tool.name, tool); },
    on(name, handler) { events[name] = handler; },
  });
  return { tools, events };
}

export async function callTool(tools, name, params = {}) {
  return tools.get(name).execute("test-call", params, undefined, undefined, { sessionManager: { getSessionId: () => "test-session" } });
}
