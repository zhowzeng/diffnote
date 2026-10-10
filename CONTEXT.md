# Diffnote

Diffnote is a desktop app for reviewing local git diffs — reading changed files, leaving comments anchored to diff lines, and copying review notes to CLI coding agents.

## Language

**Comment Queue**:
The list of comments a reviewer has saved to hand off to a CLI coding agent later, in bulk — one list per Repo, since a comment belongs to the Repo it was written in and is only ever handed off alongside that Repo's others. Comments are added one at a time (via the "Add to Queue" choice at submit) and reviewed/copied together.
_Avoid_: Context, Context Kit, Queue (alone), saved context

**Copy Now**:
Copying a single comment straight to the clipboard at the moment it's submitted, bypassing the Comment Queue entirely — used-once, not saved anywhere in the app. Chosen per comment, alongside "Add to Queue", at submit time.
_Avoid_: Quick copy, instant copy, direct copy

**Repo**:
A local git repository (backed by a GitHub repo) the reviewer has added to Diffnote. Selecting one sets what Diffnote diffs, against whichever Branch that Repo has checked out.
_Avoid_: Project, repository, workspace

**Branch**:
The branch a Repo currently has checked out — always the one under review, never one the reviewer picks.
_Avoid_: Current branch, HEAD, source branch, selected branch

**Diff Mode**:
How the diff shown is computed: Unstaged (working tree vs index), Staged (index vs HEAD), or Branch (the working tree vs where the Branch and its Base Branch last met — everything done on the Branch, committed or not).
_Avoid_: Compare mode

**Base Branch**:
The branch a Branch-mode diff is compared against. Defaults to the Repo's default branch, but the reviewer can pick any other branch instead.
_Avoid_: Target branch, main (not always main)

**Comment**:
A single note the reviewer leaves anchored to a line or line range — either a diff line the worktree still has, or a line of a file open in `File View`. Diffnote is a solo-review tool — comments are the reviewer's own notes, not a multi-party discussion, so there's no reply/thread model. Revising one means editing it in place, not replying to it.
_Avoid_: Comment thread, thread, reply

**Context line**:
A git diff term (unchanged line shown for surrounding context) — general to diffs, not a Diffnote-specific concept. Not `Comment Queue`.

**File View**:
Viewing a file's complete current (worktree) content, with no diff highlighting — separate from the diff view shown for changed files. A file with no changes opens here instead of the diff view. Comments can be left here too, anchored to the file's own (worktree) line numbers.
_Avoid_: File browser, source view

**Command Palette**:
The `Ctrl/⌘ + K` box that jumps straight to one of the Repo's changed files by typing part of its path. It lists changed files only — the same ones the sidebar shows by default — and opens the file in its diff view.
_Avoid_: Quick open, file finder, spotlight

**Anchor Text**:
The content of the lines a Comment covers, kept with the Comment as it was when the Comment was written. It is what decides whether the worktree still holds the code the Comment was about — the line numbers are only a pointer, the Anchor Text is what the Comment refers to.
_Avoid_: Snapshot, quote, cached lines

**Re-anchor**:
Moving a Comment's line numbers to wherever its Anchor Text now sits in the file. The same Comment with a corrected pointer, not a new one.
_Avoid_: Remap, relocate, rebind

**Orphaned**:
A Comment whose Anchor Text is nowhere in the file any more — the code it was written about is gone. The only state in which a Comment is handed to a CLI agent as something other than `path:L12`.
_Avoid_: Stale, dangling, broken, 失效
