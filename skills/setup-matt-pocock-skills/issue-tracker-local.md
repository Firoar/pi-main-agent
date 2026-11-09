# Issue tracker: Local Markdown

Issues live under the configured project-relative `localDir`, normally `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/issues/`.
- Every artifact with tracker identity, including a spec or Wayfinder map, is an issue file: `issues/<NN>-<slug>.md`. Do not create `spec.md` or `map.md` beside the issues directory.
- An issue has a unique numeric prefix, a `Type:` line, and a canonical `Status:` line. `Type` may be `spec`, `issue`, `map`, `research`, `prototype`, `grilling`, or `task`. `Status` is `ready-for-agent`, `claimed`, or `resolved`.
- Newly created implementation work is `ready-for-agent` by default. A map's Wayfinder type and ticket type are recorded in `Type:`; there are no tracker labels.
- Comments are appended as timestamped entries by the tracker helper.

## Stable references

Use the full relative issue path returned by `tracker_create_issue` as the stable identity in narration and in `parent` / `blockedBy` references. Numeric shorthand is accepted only when it identifies exactly one issue; if it is ambiguous, ask for or resolve the full path rather than guessing. Dependencies should use full paths.

## Tool operations

- Create via `tracker_create_issue`; include `feature`, `type`, `parent`, and `blockedBy` as applicable. The tool returns the canonical path.
- Read the issue file through Pi's read tool using that returned path.
- Comment via `tracker_comment_issue`.
- Resolve via `tracker_close_issue`; closing sets `Status: resolved`.
- Check availability with `tracker_status`.

Do not edit issue files directly to simulate tracker operations when a tracker tool exists.

## Wayfinding operations

- The map is an issue of `Type: map` under `.scratch/<effort>/issues/`.
- Child decision tickets are separate issue files in the same directory and carry a `Type:` such as `research`, `prototype`, `grilling`, or `task`.
- `Blocked by:` contains full relative paths. A ticket is ready when every referenced blocker is `resolved`.
- The frontier is ready, unclaimed child issues sorted by numeric prefix.
- Claim with `tracker_comment_issue` before the work, naming the owner, executor/run reference, and timestamp. Use the latest claim/release comment as the ownership record without direct file edits. A release comment also clears a legacy `Status: claimed` assignment.
- Resolve with `tracker_close_issue`, passing the answer as its final comment so it sets `Status: resolved`; then add a Decisions-so-far comment to the map with a context pointer.
