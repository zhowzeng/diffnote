# A Comment can only anchor to a line the worktree has

A [[Comment]] is handed to a CLI agent as `path:L12` (ADR 0007) and the agent resolves that against the worktree, so Diffnote only offers to anchor a comment where that number means the same thing on both sides. Two things follow. The [[Branch]] under review is the checked-out one rather than a pick: Branch mode's new side was the selected branch's tip and Diffnote never checks anything out (ADR 0003), so a branch the reviewer isn't on produces line numbers their worktree doesn't have — the topbar's branch control becomes a read-only indicator of what's checked out, and the [[Base Branch]] picker is the only branch the reviewer chooses. And a deleted line can't be commented on, because its number belongs to the old side the worktree no longer has and `path:L11` would name unrelated content — Unified view now withholds the add-comment affordance on a del line, matching what Split view already did, and `CommentAnchor` drops its `old` side.

## Consequences

- `Unstaged` and `Staged` never depended on the branch choice anyway: they diff the working tree, index and HEAD of whatever is checked out.
- A worktree with uncommitted changes sat slightly off its branch tip, so a Branch-mode line number could drift by the reviewer's own unstaged edits. Accepted rather than solved here, and closed since by ADR 0012, which moved Branch mode's new side to the worktree.
- `Staged` mode's new side is the index, not the worktree, so a file with unstaged changes on top has the same mismatch there. Untouched here, and closed since by ADR 0013: a Comment written against the index is checked against the worktree before hand-off like any other, and Orphaned when the lines it was written on are no longer there.

## Considered Options

- **Carry more in the hand-off text** (commit sha, side, or the line's own content, so any anchor can be resolved): rejected — it re-contracts what Diffnote hands an agent and undoes ADR 0007's reason for `path:L12` being enough. Worth revisiting if reviewing a branch you're not on ever becomes a real need.
- **Let Diffnote check out the branch under review**: rejected — ADR 0003 keeps Diffnote read-only over the Repo, and silently moving a reviewer's HEAD is a far bigger promise than a review tool should make.
- **Warn instead of withhold** (keep commenting everywhere, flag the anchors that may not resolve): rejected — the handed-off text would still be wrong, just with a disclaimer attached somewhere the agent never sees.
- **Translate a deleted line to the nearest surviving line**: rejected — the number would resolve, which is worse: it points at content the reviewer didn't select, with nothing to reveal the substitution.
