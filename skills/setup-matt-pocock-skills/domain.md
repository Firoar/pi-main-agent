# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`GLOSSARY.md`** at the repo root, or
- **`GLOSSARY-MAP.md`** at the repo root if it exists: it points at one `GLOSSARY.md` per context. Read each one relevant to the topic.
- **`docs/adr/`**: read system-wide ADRs that touch the area you're about to work in.
- **`docs/domains/<context>/`**: when `GLOSSARY-MAP.md` points here, read the relevant context glossary and ADRs.
- **Established domain docs**: read existing context glossaries and ADRs where the repo already keeps them, including under `src/`. Preserve their locations and map them; do not overwrite or move them as part of setup. If consolidation is desired, propose a specific migration for the user or a delegated worker.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/skill:domain-modeling` skill creates files lazily when terms or decisions actually get resolved. Follow paths in the map; the presence of a context map does not authorize moving existing docs.

## File structure

Single-context repo (most repos):

```
/
├── GLOSSARY.md
├── docs/adr/                         ← system-wide ADRs
│   └── 0001-platform-decision.md
└── src/
```

Multi-context repo (presence of `GLOSSARY-MAP.md` at the root):

```
/
├── GLOSSARY-MAP.md
├── docs/adr/                          ← system-wide decisions
└── docs/domains/
    ├── ordering/
    │   ├── GLOSSARY.md
    │   └── adr/
    └── billing/
        ├── GLOSSARY.md
        └── adr/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/skill:domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
