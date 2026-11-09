import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  checkWritePath,
  globToRegExp,
  isSafeBashCommand,
  matchesAnyPath,
} from "../extensions/lib.ts";

test("glob matching", () => {
  assert.equal(globToRegExp("docs/**").test("docs/adr/0001.md"), true);
  assert.equal(globToRegExp("docs/**").test("docs/adr"), true);
  assert.equal(globToRegExp("*.md").test("GLOSSARY.md"), true);
  assert.equal(globToRegExp("*.md").test("docs/GLOSSARY.md"), false);
  assert.equal(matchesAnyPath("docs/adr/0001.md", ["src/**", "docs/**"]), true);
});

test("write path guard", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-main-test-"));
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

test("read-only bash policy", () => {
  assert.equal(isSafeBashCommand("git status").safe, true);
  assert.equal(isSafeBashCommand("git diff --stat").safe, true);
  assert.equal(isSafeBashCommand("git branch").safe, true);
  assert.equal(isSafeBashCommand("git branch -a").safe, true);
  assert.equal(isSafeBashCommand("git branch --list foo").safe, true);
  assert.equal(isSafeBashCommand("git branch foo").safe, false);
  assert.equal(isSafeBashCommand("rg -n foo src").safe, true);
  assert.equal(isSafeBashCommand("rg -n rm src").safe, true);
  assert.equal(isSafeBashCommand("find . -name '*.ts'").safe, true);
  assert.equal(isSafeBashCommand("gh issue list").safe, true);
  assert.equal(isSafeBashCommand("gh issue create --title x --body-file body.md").safe, true);

  assert.equal(isSafeBashCommand("touch src/x.ts").safe, false);
  assert.equal(isSafeBashCommand("echo hi > file").safe, false);
  assert.equal(isSafeBashCommand("git commit -m x").safe, false);
  assert.equal(isSafeBashCommand("gh api repos/x/y").safe, false);
  assert.equal(isSafeBashCommand("find . -delete").safe, false);
  assert.equal(isSafeBashCommand("curl https://example.com").safe, false);
});
