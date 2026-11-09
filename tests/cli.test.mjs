import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..");
const LAUNCHER = path.join(PACKAGE_ROOT, "bin", "pi-main.mjs");

function fixture(t) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-cli-")));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, "project");
  const home = path.join(base, "user");
  fs.mkdirSync(root);
  fs.mkdirSync(home);

  const preload = path.join(base, "test-home.cjs");
  fs.writeFileSync(
    preload,
    `require("node:os").homedir = () => ${JSON.stringify(home)}; require("node:module").syncBuiltinESMExports();`,
  );

  const env = { ...process.env };
  for (const key of ["PI_MAIN_CONFIG", "PI_MAIN_PROJECT_CONFIG", "PI_MAIN_PROJECT_ROOT", "PI_MAIN_WORKTREE_ROOT"]) {
    delete env[key];
  }

  const run = (args, overrides = {}) =>
    spawnSync(process.execPath, ["--require", preload, LAUNCHER, ...args], {
      cwd: overrides.cwd || root,
      env: { ...env, ...overrides.env },
      encoding: "utf8",
    });

  const configPath = path.join(home, ".config", "pi-main", "config.json");
  const writeConfig = (value, file = configPath) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  };
  const readConfig = (file = configPath) => JSON.parse(fs.readFileSync(file, "utf8"));

  return { base, root, home, configPath, run, writeConfig, readConfig };
}

function assertOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function assertFail(result, pattern) {
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, pattern);
}

test("add stores a canonical local path in a 0600 config", (t) => {
  const f = fixture(t);
  const source = path.join(f.base, "extension.ts");
  fs.writeFileSync(source, "export default function () {}\n");

  const result = f.run(["add", source]);
  assertOk(result);
  assert.match(result.stdout, /Added:/);

  const config = f.readConfig();
  assert.deepEqual(config.extensions, [fs.realpathSync(source)]);
  assert.equal(fs.statSync(f.configPath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(f.configPath)).filter((name) => name.includes(".tmp-")), []);
});

test("add resolves relative and home-relative local paths", (t) => {
  const f = fixture(t);
  const relative = path.join(f.root, "relative.ts");
  const homeSource = path.join(f.home, "home.ts");
  fs.writeFileSync(relative, "export default function () {}\n");
  fs.writeFileSync(homeSource, "export default function () {}\n");

  assertOk(f.run(["add", "relative.ts"]));
  assertOk(f.run(["add", "~/home.ts"]));

  const config = f.readConfig();
  assert.deepEqual(config.extensions, [fs.realpathSync(relative), fs.realpathSync(homeSource)]);
});

test("add accepts local directories and package specs", (t) => {
  const f = fixture(t);
  const extensionDir = path.join(f.base, "extension-dir");
  fs.mkdirSync(extensionDir);
  fs.writeFileSync(path.join(extensionDir, "index.ts"), "export default function () {}\n");

  assertOk(f.run(["add", extensionDir]));
  assertOk(f.run(["add", "npm:pi-example@1.2.3"]));
  assertOk(f.run(["add", "git:github.com/example/pi-example"]));
  assertOk(f.run(["add", "https://example.com/pi-example.ts"]));

  const config = f.readConfig();
  assert.deepEqual(config.extensions, [
    fs.realpathSync(extensionDir),
    "npm:pi-example@1.2.3",
    "git:github.com/example/pi-example",
    "https://example.com/pi-example.ts",
  ]);
});

test("add is idempotent and preserves unrelated config keys", (t) => {
  const f = fixture(t);
  const source = path.join(f.base, "extension.ts");
  fs.writeFileSync(source, "export default function () {}\n");
  f.writeConfig({ name: "keep-me", extensions: [], guard: { bash: "read-only" } });

  assertOk(f.run(["add", source]));
  const first = fs.readFileSync(f.configPath, "utf8");
  const second = f.run(["add", source]);
  assertOk(second);
  assert.match(second.stdout, /Already configured/);
  assert.equal(fs.readFileSync(f.configPath, "utf8"), first);
  assert.equal(f.readConfig().name, "keep-me");
  assert.equal(f.readConfig().extensions.length, 1);
});

test("add rejects missing, empty, malformed, and unknown sources without writing", (t) => {
  const f = fixture(t);
  assertFail(f.run(["add", "missing.ts"]), /does not exist/);
  assertFail(f.run(["add", "npm:"]), /missing its target/);
  assertFail(f.run(["add", "https://"]), /missing its target|invalid/);
  assertFail(f.run(["add", "--bogus"]), /unknown option/);
  assertFail(f.run(["add", "one", "two"]), /unexpected extra argument/);
  assertFail(f.run(["add", "npm:pi-example", "--config="]), /non-empty path/);
  assert.equal(fs.existsSync(f.configPath), false);
});

test("list is read-only when no config exists", (t) => {
  const f = fixture(t);
  const result = f.run(["list"]);
  assertOk(result);
  assert.match(result.stdout, /not created/);
  assert.match(result.stdout, /No extensions configured/);
  assert.equal(fs.existsSync(path.dirname(f.configPath)), false);
});

test("list reports local existence and source types", (t) => {
  const f = fixture(t);
  const source = path.join(f.base, "extension.ts");
  fs.writeFileSync(source, "export default function () {}\n");
  f.writeConfig({ extensions: [source, "npm:pi-example", "git:github.com/example/pi-example"] });

  fs.unlinkSync(source);
  const result = f.run(["list"]);
  assertOk(result);
  assert.match(result.stdout, /\[local, missing\]/);
  assert.match(result.stdout, /\[npm\]/);
  assert.match(result.stdout, /\[git\]/);
});

test("remove finds canonical, relative, and home-relative spellings", (t) => {
  const f = fixture(t);
  const source = path.join(f.home, "extension.ts");
  fs.writeFileSync(source, "export default function () {}\n");
  f.writeConfig({ extensions: [fs.realpathSync(source)] });

  assertOk(f.run(["remove", "~/extension.ts"]));
  assert.deepEqual(f.readConfig().extensions, []);

  f.writeConfig({ extensions: [fs.realpathSync(source)] });
  assertOk(f.run(["remove", path.relative(f.root, source)]));
  assert.deepEqual(f.readConfig().extensions, []);
});

test("remove missing and malformed config fail without writing", (t) => {
  const f = fixture(t);
  f.writeConfig({ extensions: [] });
  const before = fs.readFileSync(f.configPath, "utf8");
  assertFail(f.run(["remove", "npm:missing"]), /not configured/);
  assert.equal(fs.readFileSync(f.configPath, "utf8"), before);

  f.writeConfig("{");
  const malformed = fs.readFileSync(f.configPath, "utf8");
  assertFail(f.run(["remove", "whatever"]), /cannot read config/);
  assert.equal(fs.readFileSync(f.configPath, "utf8"), malformed);
});

test("invalid extensions fields fail without overwrite", (t) => {
  const f = fixture(t);
  for (const value of [{ extensions: "x" }, { extensions: [""] }, { extensions: [42] }]) {
    f.writeConfig(value);
    const before = fs.readFileSync(f.configPath, "utf8");
    assertFail(f.run(["add", "npm:pi-example"]), /config\.extensions/);
    assert.equal(fs.readFileSync(f.configPath, "utf8"), before);
  }
});

test("dry-run and explicit config paths do not touch the default config", (t) => {
  const f = fixture(t);
  const source = path.join(f.base, "extension.ts");
  const explicit = path.join(f.base, "custom", "config.json");
  fs.writeFileSync(source, "export default function () {}\n");
  f.writeConfig({ extensions: ["npm:old"] }, explicit);

  const dry = f.run(["add", source, "--config", explicit, "--dry-run"]);
  assertOk(dry);
  assert.match(dry.stdout, /"extensions"/);
  assert.deepEqual(f.readConfig(explicit).extensions, ["npm:old"]);

  assertOk(f.run(["add", source, "--config", explicit]));
  assert.deepEqual(f.readConfig(explicit).extensions, ["npm:old", fs.realpathSync(source)]);
  assert.equal(fs.existsSync(f.configPath), false);

  const envConfig = path.join(f.base, "env-config.json");
  assertOk(f.run(["add", "npm:env"], { env: { PI_MAIN_CONFIG: envConfig } }));
  assert.deepEqual(f.readConfig(envConfig).extensions, ["npm:env"]);
  assert.equal(fs.existsSync(f.configPath), false);
});

test("config and project config are never modified by add", (t) => {
  const f = fixture(t);
  const source = path.join(f.base, "extension.ts");
  fs.writeFileSync(source, "export default function () {}\n");
  const projectConfig = path.join(f.root, "pi-main.config.json");
  fs.writeFileSync(projectConfig, JSON.stringify({ name: "project" }), "utf8");

  assertOk(f.run(["add", source]));
  assert.equal(fs.readFileSync(projectConfig, "utf8"), JSON.stringify({ name: "project" }));
  assert.equal(fs.existsSync(path.join(f.root, ".pi-main")), false);
});

test("symlinked config paths are rejected", (t) => {
  const f = fixture(t);
  const target = path.join(f.base, "target.json");
  fs.writeFileSync(target, JSON.stringify({ extensions: [] }), "utf8");
  fs.mkdirSync(path.dirname(f.configPath), { recursive: true });
  fs.symlinkSync(target, f.configPath);

  assertFail(f.run(["add", "npm:pi-example"]), /must not be a symlink/);
  assert.equal(fs.readFileSync(target, "utf8"), JSON.stringify({ extensions: [] }));
});

test("list does not create a config and dry-run is rejected", (t) => {
  const f = fixture(t);
  assertOk(f.run(["list"]));
  assert.equal(fs.existsSync(path.dirname(f.configPath)), false);
  assertFail(f.run(["list", "--dry-run"]), /not supported/);
});
