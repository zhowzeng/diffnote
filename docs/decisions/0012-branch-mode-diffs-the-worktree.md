# Branch mode diffs the worktree, not the branch tip

[[Diff Mode]] `Branch` compared the merge-base of the [[Base Branch]] and the checked-out [[Branch]] against that Branch's tip, so it hid every uncommitted change — the work most likely to need a second look — and its line numbers drifted from the worktree a CLI agent resolves `path:L12` against. It now compares that merge-base against the worktree, which shows everything done on the Branch, committed or not, and closes the drift ADR 0010 accepted rather than solved. Only `Staged` still compares something the worktree isn't.

## Consequences

Diffnote no longer offers the PR-shaped diff of committed work alone. Nothing in the worktree backs that comparison, so no [[Comment]] written against it could anchor (ADR 0010) — it would be a browse-only mode.

## Considered Options

- **Keep the tip as the new side**: rejected — it hides uncommitted work and leaves line numbers that drift from the worktree the agent edits.
- **A fourth Diff Mode, so both comparisons exist**: rejected — the tip-vs-base one would be browse-only for the reason above, and `git diff` already gives it from a terminal.
