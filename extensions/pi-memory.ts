/**
 * pi-memory: small, project-local planning memory for pi-main.
 *
 * Files live under <repo>/.pi-main/memory by default:
 *   MEMORY.md          durable preferences, facts, decisions, pointers
 *   OPEN.md            unresolved questions / next actions
 *   daily/YYYY-MM-DD.md session notes
 *
 * Deliberately no qmd, embeddings, LLM summaries, or global store.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  dateStamp,
  ensureDir,
  isWithin,
  loadConfig,
  memoryDir,
  nowStamp,
  realpathLoose,
  readText,
  shortSessionId,
  tailLines,
  truncate,
} from "./lib.ts";

type MemoryTarget = "memory" | "open" | "daily";

function isEnabled(): boolean {
  return process.env.PI_MAIN_AGENT === "1";
}

function baseDir(): string {
  return path.resolve(projectRootSafe(), process.env.PI_MEMORY_DIR || memoryDir());
}

function assertMemoryPath(target: string): void {
  const root = realpathLoose(projectRootSafe());
  const configuredRoot = realpathLoose(baseDir());
  const canonical = realpathLoose(target);
  if (!isWithin(root, configuredRoot) || !isWithin(configuredRoot, canonical)) {
    throw new Error(`Memory path escapes its configured project directory: ${target}`);
  }
  const sensitive = path.relative(root, canonical).split(path.sep);
  if (sensitive.some((part) => part === ".git" || part === "node_modules")) {
    throw new Error(`Memory path may not use .git or node_modules: ${target}`);
  }
  const project = path.resolve(projectRootSafe());
  let current = path.resolve(target);
  while (isWithin(project, current) && current !== project) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Memory paths may not use symbolic links: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    current = path.dirname(current);
  }
}

function files() {
  const dir = baseDir();
  return {
    dir,
    memory: path.join(dir, "MEMORY.md"),
    open: path.join(dir, "OPEN.md"),
    daily: path.join(dir, "daily"),
    backups: path.join(dir, "backups"),
  };
}

function ensureDirs(): ReturnType<typeof files> {
  const f = files();
  assertMemoryPath(f.dir);
  assertMemoryPath(f.daily);
  assertMemoryPath(f.backups);
  ensureDir(f.dir);
  ensureDir(f.daily);
  ensureDir(f.backups);
  assertMemoryPath(f.dir);
  assertMemoryPath(f.daily);
  assertMemoryPath(f.backups);
  return f;
}

function dailyFile(date = dateStamp()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid date: ${date}`);
  const file = path.join(baseDir(), "daily", `${date}.md`);
  assertMemoryPath(file);
  return file;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStamp(d);
}

function buildSnapshot(): string {
  const config = loadConfig();
  const f = ensureDirs();

  assertMemoryPath(f.memory);
  assertMemoryPath(f.open);
  const memory = truncate(readText(f.memory), config.memory.maxChars);
  const open = truncate(readText(f.open), config.memory.openMaxChars);
  let daily = "";
  for (const date of [dateStamp(), yesterday()]) {
    const text = readText(dailyFile(date));
    if (text.trim()) daily += `### ${date}\n${tailLines(text, Math.floor(config.memory.dailyMaxChars / 2))}\n\n`;
  }
  daily = truncate(daily, config.memory.dailyMaxChars);

  const sections: string[] = [];
  if (memory.trim()) sections.push(`### MEMORY.md\n\n${memory.trim()}`);
  if (open.trim()) sections.push(`### OPEN.md\n\n${open.trim()}`);
  if (daily.trim()) sections.push(`### Recent daily log\n\n${daily.trim()}`);
  if (sections.length === 0) return "";

  return [
    "## Project memory (pi-main)",
    "",
    "Loaded at session start and refreshed after memory writes or removals. Use memory_read / memory_search for the authoritative latest state.",
    "This store is for preferences, project facts, session notes, and pointers to issues/ADRs.",
    "Decisions belong in the issue tracker and ADRs, not here.",
    "",
    sections.join("\n\n---\n\n"),
  ].join("\n");
}

function formatEntry(target: MemoryTarget, text: string, tags: string[] | undefined, sid: string): string {
  const tagLine = (tags ?? [])
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean)
    .map((tag) => `#${tag}`)
    .join(" ");
  const body = tagLine ? `${tagLine} ${text.trim()}` : text.trim();
  if (target === "open") return `<!-- ${nowStamp()} [${sid}] -->\n- [ ] ${body}\n`;
  if (target === "daily") return `\n## ${nowStamp().slice(11)} [${sid}]\n\n${body}\n`;
  return `\n<!-- ${nowStamp()} [${sid}] -->\n${body}\n`;
}

function appendEntry(target: MemoryTarget, text: string, tags: string[] | undefined, sid: string): string {
  const f = ensureDirs();
  const file = target === "memory" ? f.memory : target === "open" ? f.open : dailyFile();
  assertMemoryPath(file);
  if (target !== "memory" && target !== "open") ensureDir(f.daily);
  fs.appendFileSync(file, formatEntry(target, text, tags, sid), "utf8");
  return file;
}

function memorySearchTargets(): string[] {
  const f = files();
  const targets: string[] = [];
  for (const file of [f.memory, f.open]) {
    assertMemoryPath(file);
    try { if (fs.lstatSync(file).isFile()) targets.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  let dailyNames: string[] = [];
  try { dailyNames = fs.readdirSync(f.daily); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const name of dailyNames) {
    if (!name.endsWith(".md")) continue;
    const file = path.join(f.daily, name);
    assertMemoryPath(file);
    try { if (fs.lstatSync(file).isFile()) targets.push(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return targets;
}

function searchFallback(query: string, limit: number, targets = memorySearchTargets()): string[] {
  const f = files();
  const needle = query.toLowerCase();
  const hits: string[] = [];
  for (const file of targets) {
    const text = readText(file);
    if (!text) continue;
    text.split("\n").forEach((line, index) => {
      if (hits.length < limit && line.toLowerCase().includes(needle)) {
        hits.push(`${path.relative(f.dir, file)}:${index + 1}: ${line.trim()}`);
      }
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function searchMemory(query: string, limit: number): string[] {
  const f = files();
  ensureDirs();
  const targets = memorySearchTargets();
  if (!targets.length) return [];
  try {
    const output = execFileSync("rg", ["-n", "-F", "--no-heading", "--with-filename", "-i", "--", query, ...targets], {
      encoding: "utf8",
      timeout: 5000,
    });
    return output
      .split("\n")
      .filter(Boolean)
      .slice(0, limit)
      .map((line) => line.replace(`${f.dir}/`, ""));
  } catch (error) {
    const code = (error as { status?: number }).status;
    if (code === 1) return []; // no matches
    return searchFallback(query, limit, targets);
  }
}

function removeBlocks(content: string, query: string): { content: string; removed: number } {
  const needle = query.trim().toLowerCase();
  if (!needle) return { content, removed: 0 };

  // Memory blocks start at a timestamp comment. Keep the preamble intact.
  const lines = content.split("\n");
  const out: string[] = [];
  let block: string[] = [];
  let inBlock = false;
  let removed = 0;

  const flush = () => {
    if (!inBlock) return;
    const text = block.join("\n");
    if (text.toLowerCase().includes(needle)) removed++;
    else out.push(...block);
    block = [];
    inBlock = false;
  };

  for (const line of lines) {
    if (/^<!-- .* -->$/.test(line)) {
      flush();
      inBlock = true;
      block.push(line);
    } else if (inBlock) {
      block.push(line);
    } else if (line.toLowerCase().includes(needle)) {
      removed++;
      // Drop the timestamp comment directly above a matching line too.
      if (out.length > 0 && /^<!-- .* -->$/.test(out[out.length - 1] ?? "")) out.pop();
    } else {
      out.push(line);
    }
  }
  flush();

  const next = out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + (out.length ? "\n" : "");
  return { content: next, removed };
}

function forget(query: string): { removed: number; backups: string[]; files: string[] } {
  const f = ensureDirs();
  assertMemoryPath(f.memory);
  assertMemoryPath(f.open);
  const targets = [f.memory, f.open];
  try {
    for (const name of fs.readdirSync(f.daily)) {
      if (name.endsWith(".md")) targets.push(path.join(f.daily, name));
    }
  } catch {
    // no daily logs
  }

  let removed = 0;
  const backups: string[] = [];
  const changed: string[] = [];
  const stamp = nowStamp().replace(/[: ]/g, "-");

  for (const file of targets) {
    assertMemoryPath(file);
    const before = readText(file);
    if (!before.trim()) continue;
    const result = removeBlocks(before, query);
    if (result.removed === 0) continue;
    const backup = path.join(f.backups, `${stamp}-${randomUUID()}-${path.basename(file)}`);
    assertMemoryPath(backup);
    fs.writeFileSync(backup, before, "utf8");
    backups.push(backup);
    fs.writeFileSync(file, result.content, "utf8");
    removed += result.removed;
    changed.push(file);
  }

  return { removed, backups, files: changed };
}

function memoryStatus(): string {
  const f = ensureDirs();
  assertMemoryPath(f.memory);
  assertMemoryPath(f.open);
  const memory = readText(f.memory);
  const open = readText(f.open);
  const openCount = open.split("\n").filter((line) => /^- \[ \]/.test(line.trim())).length;
  let dailyCount = 0;
  try {
    dailyCount = fs.readdirSync(f.daily).filter((name) => name.endsWith(".md")).length;
  } catch {
    // none
  }
  return [
    `dir: ${f.dir}`,
    `MEMORY.md: ${memory.length} chars`,
    `OPEN.md: ${open.length} chars (${openCount} open)`,
    `daily logs: ${dailyCount}`,
    `backups: ${fs.existsSync(f.backups) ? fs.readdirSync(f.backups).length : 0}`,
  ].join("\n");
}

export default function piMemory(pi: ExtensionAPI): void {
  if (!isEnabled()) return;

  let snapshot: string | null = null;

  pi.on("session_start", async () => {
    snapshot = null;
  });

  pi.on("before_agent_start", async (event, _ctx: ExtensionContext) => {
    if (snapshot === null) snapshot = buildSnapshot();
    if (!snapshot) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${snapshot}`,
    };
  });

  pi.registerTool({
    name: "memory_write",
    label: "memory_write",
    description:
      "Append a durable entry to project memory. Use memory for preferences, project facts, session notes, and pointers to issues/ADRs. Decisions belong in the issue tracker and ADRs.",
    promptSnippet: "Append project memory entries (preferences, facts, notes, pointers)",
    promptGuidelines: [
      "Use memory_write for durable project preferences, facts, session notes, and pointers to issues/ADRs; put decisions in the issue tracker or an ADR instead.",
      "Use memory_write(target=\"open\") for unresolved questions that are not already tracker tickets.",
      "Use memory_write(target=\"daily\") for a short session log or handoff note.",
    ],
    parameters: Type.Object({
      target: Type.String({ enum: ["memory", "open", "daily"], description: "Which memory file to append to." }),
      text: Type.String({ minLength: 1, description: "The entry to save. Use #tags and [[links]] when useful." }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Optional tags, with or without a leading #." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const file = appendEntry(
        params.target as MemoryTarget,
        params.text,
        params.tags as string[] | undefined,
        shortSessionId(ctx),
      );
      snapshot = null;
      return {
        content: [
          {
            type: "text",
            text: `Saved to ${path.relative(projectRootSafe(), file)}.\n\n${truncate(params.text, 500)}`,
          },
        ],
        details: { file },
      };
    },
  });

  pi.registerTool({
    name: "memory_read",
    label: "memory_read",
    description: "Read project memory: MEMORY.md, OPEN.md, a daily log, or all files.",
    promptSnippet: "Read project memory files",
    parameters: Type.Object({
      target: Type.Optional(
        Type.String({ enum: ["memory", "open", "daily", "all"], description: "Which file to read. Default: all." }),
      ),
      date: Type.Optional(Type.String({ description: "Daily log date (YYYY-MM-DD). Default: today." })),
    }),
    async execute(_toolCallId, params) {
      const f = ensureDirs();
      const target = (params.target as string | undefined) ?? "all";
      const chunks: string[] = [];
      if (target === "memory" || target === "all") { assertMemoryPath(f.memory); chunks.push(`### MEMORY.md\n\n${readText(f.memory) || "(empty)"}`); }
      if (target === "open" || target === "all") { assertMemoryPath(f.open); chunks.push(`### OPEN.md\n\n${readText(f.open) || "(empty)"}`); }
      if (target === "daily" || target === "all") {
        const file = dailyFile((params.date as string | undefined) || dateStamp());
        chunks.push(`### ${path.basename(file)}\n\n${readText(file) || "(empty)"}`);
      }
      return { content: [{ type: "text", text: chunks.join("\n\n---\n\n") }], details: {} };
    },
  });

  pi.registerTool({
    name: "memory_search",
    label: "memory_search",
    description: "Keyword-search MEMORY.md, OPEN.md, and daily logs. Uses ripgrep when available.",
    promptSnippet: "Search project memory by keyword",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Keyword or phrase to find." }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 50, description: "Maximum matches. Default 10." })),
    }),
    async execute(_toolCallId, params) {
      const limit = Math.min(50, Math.max(1, Math.floor((params.limit as number | undefined) ?? 10)));
      const hits = searchMemory(params.query as string, limit);
      return {
        content: [{ type: "text", text: hits.length ? hits.join("\n") : "No matches." }],
        details: { hits },
      };
    },
  });

  pi.registerTool({
    name: "memory_forget",
    label: "memory_forget",
    description: "Remove matching entries from project memory after backing up the affected files.",
    promptSnippet: "Remove incorrect or obsolete project memory entries",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: "Text identifying the entries to remove." }),
    }),
    async execute(_toolCallId, params) {
      const result = forget(params.query as string);
      // Deletions are authority-changing: make the next prompt reflect them.
      if (result.removed > 0) snapshot = null;
      return {
        content: [
          {
            type: "text",
            text: result.removed
              ? `Removed ${result.removed} matching block(s).\nBackups:\n${result.backups.map((b) => `- ${b}`).join("\n")}`
              : "No matching entries found.",
          },
        ],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "memory_status",
    label: "memory_status",
    description: "Show project memory location, file sizes, open threads, and backups.",
    promptSnippet: "Show project memory status",
    parameters: Type.Object({}),
    async execute() {
      return { content: [{ type: "text", text: memoryStatus() }], details: {} };
    },
  });
}

function projectRootSafe(): string {
  return process.env.PI_MAIN_PROJECT_ROOT || process.cwd();
}
