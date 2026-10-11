// The lines on screen, as the diff panel lays them out and as a Comment anchors to them.
//
// Each line has an idx: its position among all the lines on screen, counted across
// hunks. A comment selection is a range of idxs, and this module is what turns that
// range into a Comment's line numbers and Anchor Text (docs/decisions/0013) — both from
// the same lines, by the same rule, so the two can't disagree.
//
// That rule is docs/decisions/0010: a Comment anchors only to a line the worktree has.
// In the diff that is the new side; a del line exists only on the old side, so it never
// counts toward an anchor and is never marked as commented. File View is the worktree
// file itself, numbered from 1, with no second side to rule out.

import { inlineDiff, type CommentAnchor, type InlineSegment } from './helpers';
import type { DiffHunk, DiffLine } from './types';

/** What every kind of line space answers, whichever view it is shown in. */
export interface Lines {
  /** Whether a drag that started at `start` may grow to take in `i`. */
  canExtend(start: number, i: number): boolean;
  /** Where a Comment on the lines `lo`..`hi` is anchored, and the lines it covers. */
  anchorFor(lo: number, hi: number): { anchor: CommentAnchor; anchorText: string[] };
  /** Whether the line at `idx` is covered by one of `keys` (CommentQueue.lineKeys). */
  isCommented(idx: number, keys: ReadonlySet<string>): boolean;
}

export type HeaderRow = { kind: 'header'; label: string; hunk: number };

/** One line of Unified view. `segments` marks what changed within a paired del/add. */
export type UnifiedRow = HeaderRow | { kind: 'line'; idx: number; line: DiffLine; segments?: InlineSegment[] };

/** One side of a Split view row, or null where that side has no line. Only the right
 *  (new) side is commentable. */
export type SplitCell = {
  kind: DiffLine['kind'];
  no: number | null;
  text: string;
  idx: number;
  commentable?: boolean;
  segments?: InlineSegment[];
} | null;

export type SplitRow = HeaderRow | { kind: 'row'; left: SplitCell; right: SplitCell };

export interface DiffLines extends Lines {
  hunkCount: number;
  /** The hunk the line at `idx` belongs to. */
  hunkOf(idx: number): number | undefined;
  /** Every hunk header, and the lines of every hunk not in `collapsed`. */
  unifiedRows(collapsed: ReadonlySet<number>): UnifiedRow[];
  splitRows(collapsed: ReadonlySet<number>): SplitRow[];
}

type FlatLine = { line: DiffLine; idx: number; hunk: number };

export function diffLines(hunks: DiffHunk[]): DiffLines {
  const flat: FlatLine[] = [];
  const groups = hunks.map((h, hunk) => {
    const lines = h.lines.map((line, i) => ({ line, idx: flat.length + i, hunk }));
    flat.push(...lines);
    return { header: h.header, lines, pairs: pairLines(lines) };
  });

  // What changed within each del line and the add it sits beside in Split view: the n-th
  // del of a run with the n-th add after it. Unified view marks the same pairs.
  const segments = new Map<number, InlineSegment[]>();
  for (const g of groups) {
    for (const { left, right } of g.pairs) {
      if (left?.kind !== 'del' || right?.kind !== 'add') continue;
      const diff = inlineDiff(left.text, right.text);
      if (!diff) continue;
      segments.set(left.idx, diff.old);
      segments.set(right.idx, diff.new);
    }
  }
  const withSegments = (cell: SplitCell): SplitCell => {
    const segs = cell && segments.get(cell.idx);
    return segs ? { ...cell, segments: segs } : cell;
  };

  // The worktree's line number for the line at `idx`: null for a del line.
  const newNo = (idx: number) => flat[idx]?.line.newNo ?? null;

  return {
    hunkCount: hunks.length,
    hunkOf: (idx) => flat[idx]?.hunk,

    // Line numbers only run on within a hunk, so a range across two of them would name
    // lines the diff doesn't show.
    canExtend: (start, i) => flat[start] !== undefined && flat[start].hunk === flat[i]?.hunk,

    // A selection can sweep over del lines, but it can't start on one (the gutter
    // withholds the affordance there), so there is always a new-side number and the
    // range can't come out reversed.
    anchorFor(lo, hi) {
      const covered = flat.slice(lo, hi + 1).filter((f) => f.line.newNo !== null);
      const lineStart = covered[0]?.line.newNo ?? 0;
      const last = covered[covered.length - 1]?.line.newNo ?? lineStart;
      return {
        anchor: { lineStart, lineEnd: last === lineStart ? undefined : last, side: 'new' },
        anchorText: covered.map((f) => f.line.content),
      };
    },

    isCommented(idx, keys) {
      const no = newNo(idx);
      return no !== null && keys.has(`new:${no}`);
    },

    unifiedRows(collapsed) {
      const out: UnifiedRow[] = [];
      groups.forEach((g, hunk) => {
        out.push({ kind: 'header', label: g.header, hunk });
        if (collapsed.has(hunk)) return;
        for (const { idx, line } of g.lines) out.push({ kind: 'line', idx, line, segments: segments.get(idx) });
      });
      return out;
    },

    splitRows(collapsed) {
      const out: SplitRow[] = [];
      groups.forEach((g, hunk) => {
        out.push({ kind: 'header', label: g.header, hunk });
        if (collapsed.has(hunk)) return;
        for (const { left, right } of g.pairs) {
          out.push({ kind: 'row', left: withSegments(left), right: withSegments(right) });
        }
      });
      return out;
    },
  };
}

// File View shows the whole worktree file, so a line's idx is its line number - 1 and
// there is no hunk to stay inside of.
export function fileViewLines(lines: string[]): Lines {
  return {
    canExtend: () => true,
    anchorFor: (lo, hi) => ({
      anchor: { lineStart: lo + 1, lineEnd: hi === lo ? undefined : hi + 1, side: 'file' },
      anchorText: lines.slice(lo, hi + 1),
    }),
    isCommented: (idx, keys) => keys.has(`file:${idx + 1}`),
  };
}

// One hunk's lines side by side: a context line on both sides, and each run of dels
// beside the run of adds that follows it, the shorter run padded with empty cells.
function pairLines(lines: FlatLine[]): { left: SplitCell; right: SplitCell }[] {
  const result: { left: SplitCell; right: SplitCell }[] = [];
  let i = 0;
  while (i < lines.length) {
    const { line, idx } = lines[i];
    if (line.kind === 'context') {
      result.push({
        left: { kind: 'context', no: line.oldNo, text: line.content, idx },
        right: { kind: 'context', no: line.newNo, text: line.content, idx, commentable: true },
      });
      i++;
      continue;
    }
    const dels: FlatLine[] = [];
    while (i < lines.length && lines[i].line.kind === 'del') dels.push(lines[i++]);
    const adds: FlatLine[] = [];
    while (i < lines.length && lines[i].line.kind === 'add') adds.push(lines[i++]);
    for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
      const d = dels[j];
      const a = adds[j];
      result.push({
        left: d ? { kind: 'del', no: d.line.oldNo, text: d.line.content, idx: d.idx } : null,
        right: a ? { kind: 'add', no: a.line.newNo, text: a.line.content, idx: a.idx, commentable: true } : null,
      });
    }
  }
  return result;
}
