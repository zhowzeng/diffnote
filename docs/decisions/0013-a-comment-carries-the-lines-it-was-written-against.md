# A Comment carries the lines it was written against

Every [[Comment]] keeps its [[Anchor Text]] — those lines as the reviewer saw them, not a later re-read of the worktree — and Diffnote checks it against the worktree before handing the Comment to a CLI agent, because the worktree changes under a queued Comment whenever anything edits it: another agent in another window, the reviewer's own editor, or the agent acting on an earlier hand-off. When the Anchor Text has only moved, Diffnote [[Re-anchor]]s the Comment to where it now sits and hands off `path:L12` as before; when it is gone, the Comment is [[Orphaned]] and hands off as a quote of those lines, saying why the number was dropped, rather than a number that would resolve to unrelated code.

## Consequences

- [[Re-anchor]]ing is not the "translate a deleted line to the nearest surviving line" that ADR 0010 rejected. That was rejected for pointing at content the reviewer never selected, with nothing to reveal the substitution; a re-anchored Comment points at exactly the content the reviewer selected, which is what it always meant — the number was only ever a pointer to it.
- ADR 0010 also rejected carrying a line's content in the hand-off text, because it re-contracts ADR 0007's `path:L12`. That holds for every Comment that still has a number worth handing over. An Orphaned one does not, and the alternative is a number already known to be wrong.
- The `Staged` mismatch ADR 0010 left open closes here: a Comment written against the index, on lines the worktree has since changed, is Orphaned like any other rather than handed off with a number that means something else.

## Considered Options

- **Mark Orphaned Comments in the Comment Queue and hand them off anyway**: rejected — this is ADR 0010's "warn instead of withhold" again, and the badge stays where the agent never sees it.
- **Drop Orphaned Comments from the hand-off entirely**: rejected — the reviewer wrote something worth saying, and a quote the agent can search for is worth more than a Comment it never receives.
- **Take the Anchor Text from the worktree rather than from what the reviewer saw**: rejected — in `Staged`, where the two differ, Diffnote would be confirming a line number against content the reviewer never looked at.
