# Rust backend uses gix (gitoxide) for git access

Redline's [[Repo]] needs are read-heavy and scoped — worktree/index/HEAD/branch diffs with line-level hunks, plus a `Fetch` action to refresh remote refs, with no cloning, committing, merging or pushing — and `gix` covers all of it in pure Rust: `gix-status` for worktree-vs-index, tree-to-tree diffing for index-vs-HEAD and branch-vs-branch, `gix-diff`/`gix-imara-diff` for the hunks, without parsing CLI text output or taking a libgit2 C dependency.

## Consequences

- Rename/copy detection uses gix's first-candidate similarity heuristic, which can occasionally diverge from git CLI's up-to-four-candidate matching. Redline doesn't need byte-identical output to `git diff`.
- `Fetch` borrows the reviewer's own setup: gix's SSH transport shells out to the system `ssh` binary, and its HTTPS auth goes through git's credential-helper protocol. Redline is not fully dependency-free, but this matches what any GitHub-using developer already has configured.

## Considered Options

- **Shell out to the system `git` CLI**: rejected — it guarantees identical behavior to what the reviewer sees in their terminal (custom diff drivers, `diff.algorithm`), but at the price of parsing text output and depending on a `git` install.
- **git2-rs (libgit2 bindings)**: rejected — a structured API with no text parsing, but it pulls in a C dependency, and its own diff/rename behavior can diverge from git CLI too, without gix's advantage of being pure Rust and under active development.
