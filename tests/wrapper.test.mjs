import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const LAUNCHER = path.join(PACKAGE_ROOT, "bin", "pi-main.mjs");

test("launcher resolves the main-agent stack", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-wrapper-"));
  const output = execFileSync(process.execPath, [LAUNCHER], {
    cwd: root,
    env: { ...process.env, PI_MAIN_DRY_RUN: "1" },
    encoding: "utf8",
  });
  const resolved = JSON.parse(output);

  assert.equal(resolved.command, "pi");
  assert.equal(resolved.env.PI_MAIN_AGENT, "1");
  assert.equal(resolved.env.PI_MAIN_PROJECT_ROOT, root);
  assert.ok(resolved.args.includes("--append-system-prompt"));
  assert.ok(resolved.args.includes(path.join(PACKAGE_ROOT, "extensions/main-guard.ts")));
  assert.ok(resolved.args.includes(path.join(PACKAGE_ROOT, "extensions/pi-memory.ts")));
  assert.ok(resolved.args.includes(path.join(PACKAGE_ROOT, "extensions/tracker.ts")));
  assert.ok(resolved.args.includes(path.join(PACKAGE_ROOT, "skills/grilling")));
});

test("repo config cannot loosen the guard or add extensions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-config-"));
  fs.writeFileSync(
    path.join(root, "pi-main.config.json"),
    JSON.stringify({
      tracker: { provider: "local", localDir: ".tickets" },
      guard: { bash: "unrestricted" },
      extensions: ["/tmp/evil-extension"],
    }),
    "utf8",
  );

  const output = execFileSync(process.execPath, [LAUNCHER], {
    cwd: root,
    env: { ...process.env, PI_MAIN_DRY_RUN: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const resolved = JSON.parse(output);
  const merged = JSON.parse(fs.readFileSync(resolved.env.PI_MAIN_CONFIG, "utf8"));

  assert.equal(merged.tracker.provider, "local");
  assert.equal(merged.guard.bash, "read-only");
  assert.deepEqual(merged.extensions, []);
});

test("launcher continues from the newest handoff", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-handoff-"));
  const handoffs = path.join(root, ".pi-main", "handoffs");
  fs.mkdirSync(handoffs, { recursive: true });
  fs.writeFileSync(
    path.join(handoffs, "2026-01-01-1200-old.md"),
    "---\nproject: " + JSON.stringify(root) + "\n---\n# Old\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(handoffs, "2026-01-02-1200-new.md"),
    "---\nproject: " + JSON.stringify(root) + "\n---\n# New\n",
    "utf8",
  );
  fs.utimesSync(path.join(handoffs, "2026-01-01-1200-old.md"), new Date(0), new Date(0));
  fs.utimesSync(path.join(handoffs, "2026-01-02-1200-new.md"), new Date(), new Date());

  const output = execFileSync(process.execPath, [LAUNCHER, "--continue-from-handoff"], {
    cwd: root,
    env: { ...process.env, PI_MAIN_DRY_RUN: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const resolved = JSON.parse(output);
  const prompt = resolved.args[resolved.args.length - 1];
  assert.match(prompt, /# New/);
  assert.doesNotMatch(prompt, /# Old/);
  assert.match(prompt, /Wait for the user to confirm/);
});
