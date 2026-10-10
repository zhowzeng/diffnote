// Checking a queued Comment against the worktree before it is handed to a CLI agent
// (docs/decisions/0013). Diffnote is read-only over the Repo (docs/decisions/0003) and
// nothing tells it when a file changes, so a Comment's line numbers can be wrong by
// the time the hand-off happens: another agent, the reviewer's own editor, or the
// agent acting on an earlier hand-off may have moved or rewritten those lines.
//
// This module is the comparison itself, which is pure logic. Reading the file it
// compares against belongs to Rust (docs/decisions/0005) and happens in handoff.ts.

export type AnchorResolution =
  | { kind: 'anchored'; lineStart: number; lineEnd?: number }
  | { kind: 'orphaned' };

// Whether `lines` holds `anchorText` starting at the 0-based `at`.
function matchesAt(lines: string[], at: number, anchorText: string[]) {
  if (at < 0 || at + anchorText.length > lines.length) return false;
  return anchorText.every((line, i) => lines[at + i] === line);
}

// Where a Comment's lines are now: unmoved, moved, or gone. `lines` is the worktree
// file, or null when there is nothing to compare against — the file was deleted, or
// is binary.
//
// The position the Comment already names wins over a search: a file where the same
// lines appear twice would otherwise orphan a Comment sitting on code that never
// changed. Everywhere else an exact match is required — a re-indented Anchor Text
// orphans, which is the second step the issue leaves for when it actually bites.
export function resolveAnchor(
  lines: string[] | null,
  item: { lineStart: number; anchorText: string[] }
): AnchorResolution {
  if (!lines) return { kind: 'orphaned' };
  const { anchorText } = item;
  if (matchesAt(lines, item.lineStart - 1, anchorText)) {
    return anchored(item.lineStart, anchorText.length);
  }
  let found = -1;
  for (let at = 0; at + anchorText.length <= lines.length; at++) {
    if (!matchesAt(lines, at, anchorText)) continue;
    // Two places it could be is no better than none: Diffnote cannot tell which one the
    // reviewer meant, so it hands off the quote rather than guessing.
    if (found !== -1) return { kind: 'orphaned' };
    found = at;
  }
  return found === -1 ? { kind: 'orphaned' } : anchored(found + 1, anchorText.length);
}

function anchored(lineStart: number, length: number): AnchorResolution {
  return { kind: 'anchored', lineStart, lineEnd: length > 1 ? lineStart + length - 1 : undefined };
}
