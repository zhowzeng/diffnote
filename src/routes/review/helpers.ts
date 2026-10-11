import type { Branch, TreeNode } from './types';

export function pruneToChanged(nodes: TreeNode[]): TreeNode[] {
  return nodes.reduce<TreeNode[]>((acc, n) => {
    if (n.type === 'file') {
      if (n.changes) acc.push(n);
      return acc;
    }
    const children = pruneToChanged(n.children);
    if (children.length) acc.push({ ...n, children });
    return acc;
  }, []);
}

export function pruneByName(nodes: TreeNode[], query: string): TreeNode[] {
  return nodes.reduce<TreeNode[]>((acc, n) => {
    if (n.type === 'file') {
      if (n.name.toLowerCase().includes(query)) acc.push(n);
      return acc;
    }
    const children = pruneByName(n.children, query);
    if (children.length) acc.push({ ...n, children });
    return acc;
  }, []);
}

export function firstFilePath(nodes: TreeNode[]): string | null {
  for (const n of nodes) {
    if (n.type === 'file') return n.path;
    const found = firstFilePath(n.children);
    if (found) return found;
  }
  return null;
}

// The changed file `step` places away from `current`, in the order the sidebar lists
// them — what j / k move through. Only changed files: they are what's under review, even
// when the sidebar is also listing unchanged ones. From a file that isn't one of them
// (nothing open yet, or an unchanged file opened from the full tree) it starts at
// whichever end it's heading away from. Stops at the ends rather than wrapping, so
// holding the key down doesn't quietly start the review over. Null when there is
// nowhere to go.
export function adjacentChangedFile(nodes: TreeNode[], current: string | null, step: 1 | -1): string | null {
  const paths: string[] = [];
  const walk = (ns: TreeNode[]) =>
    ns.forEach((n) => (n.type === 'file' ? paths.push(n.path) : walk(n.children)));
  walk(pruneToChanged(nodes));
  const i = current === null ? -1 : paths.indexOf(current);
  if (i === -1) return (step > 0 ? paths[0] : paths[paths.length - 1]) ?? null;
  return paths[i + step] ?? null;
}

export function allDirPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (ns: TreeNode[]) =>
    ns.forEach((n) => {
      if (n.type === 'dir') {
        paths.push(n.path);
        walk(n.children);
      }
    });
  walk(nodes);
  return paths;
}

export function branchMeta(b: Branch): string | undefined {
  if (b.isCurrent) return `目前分支${b.ahead ? ` · 領先 ${b.ahead} 個 commit` : ''}`;
  if (b.behind) return `落後 ${b.behind} 個 commit`;
  return undefined;
}

export function rangeLabel(lineStart: number, lineEnd?: number) {
  return lineEnd && lineEnd !== lineStart ? `L${lineStart}–L${lineEnd}` : `L${lineStart}`;
}

// A comment in the shape it is handed to a CLI agent: the line numbers already checked
// against the worktree (see handoff.ts), so the formatter below only has to print them.
export interface AgentComment {
  file: string;
  lineStart: number;
  lineEnd?: number;
  text: string;
  // Set when the Anchor Text is no longer in the worktree (docs/decisions/0013). The
  // hand-off then quotes those lines instead of a number that names other code now,
  // and says why the number was dropped. `staged` picks the reason: a comment written
  // against the index has a next step the agent can act on (`git show :path`).
  orphaned?: { anchorText: string[]; staged: boolean };
}

// The text handed to a CLI coding agent, for both the Comment Queue and Copy Now
// (docs/decisions/0001) — one formatter so the two can't drift apart.
//
// Deliberately ASCII-only (not rangeLabel above, which uses an en dash) — this text is
// copied straight into a CLI agent's prompt.
export function formatForAgent(comment: AgentComment) {
  const range =
    comment.lineEnd && comment.lineEnd !== comment.lineStart
      ? `L${comment.lineStart}-L${comment.lineEnd}`
      : `L${comment.lineStart}`;
  if (!comment.orphaned) return `${comment.file}:${range}\n${comment.text}`;
  const reason = comment.orphaned.staged
    ? `commented at ${range} as staged; the working tree has since changed`
    : `commented at ${range}; that code is no longer in the file`;
  // The comment's own text can run to several lines, so the quoted code is prefixed to
  // keep the agent from reading the reviewer's words as part of it.
  const quote = comment.orphaned.anchorText.map((line) => `> ${line}`).join('\n');
  return `${comment.file} (${reason})\n${quote}\n${comment.text}`;
}

// Every comment in the Comment Queue, as one block for the CLI agent. The prefix goes
// to the agent once, ahead of every comment, rather than per comment.
export function formatQueueForAgent(items: AgentComment[], prefix = '') {
  const comments = items.map(formatForAgent).join('\n\n');
  return prefix ? `${prefix}\n\n${comments}` : comments;
}

// Comments now outlive the thread that created them, so they show the wall-clock time
// they were written rather than a relative label that would silently go stale.
export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// Where a comment is anchored. `side` records which numbering space
// `lineStart`/`lineEnd` are counted in — the diff's new or old side, or `file` for a
// comment left in File View — so a range over one space can never be mistaken for a
// range over another that happens to share a number.
export interface CommentAnchor {
  lineStart: number;
  lineEnd?: number;
  side: 'new' | 'file';
}

// The tree node for `path`, or null when the tree doesn't list that file. A file node
// carries `changes` only when it differs in the current diff, which is what decides
// between the diff view and File View.
export function findFileNode(nodes: TreeNode[], path: string): TreeNode | null {
  for (const n of nodes) {
    if (n.type === 'file') {
      if (n.path === path) return n;
      continue;
    }
    const found = findFileNode(n.children, path);
    if (found) return found;
  }
  return null;
}

// The file a reloaded tree opens on. Refresh hands in the file the reviewer was
// reading and gets it back whenever the new tree still has it — being bounced to the
// top of the diff is exactly what makes a reload unusable mid-review. Everything else
// (a Repo, Diff Mode or Base Branch switch) hands in null and lands on the first
// changed file: the reviewer came here for the diff, even when the sidebar is also
// listing unchanged files.
export function fileAfterReload(nodes: TreeNode[], previous: string | null): string | null {
  if (previous && findFileNode(nodes, previous)) return previous;
  return firstFilePath(pruneToChanged(nodes));
}

// A run of one line's text, marked when it is part of what changed within the line —
// the darker highlight GitHub puts inside a changed line.
export type InlineSegment = { text: string; changed: boolean };

// Words, runs of whitespace, and single punctuation marks: the units a within-line diff
// matches, so `foo(bar)` -> `foo(baz)` marks `bar`, not the whole call.
const INLINE_TOKEN = /[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu;

// Past this many word pairs a line is too long to be worth the quadratic diff below.
const MAX_INLINE_CELLS = 100_000;

// What changed between a del line and the add line paired with it, as segments of each.
// Null when there is nothing worth marking: the lines share no word at all (a rewrite,
// where marking every word says nothing the line colour doesn't), or are too long.
export function inlineDiff(oldText: string, newText: string): { old: InlineSegment[]; new: InlineSegment[] } | null {
  const a = oldText.match(INLINE_TOKEN) ?? [];
  const b = newText.match(INLINE_TOKEN) ?? [];

  // Only words and punctuation are matched: whitespace is everywhere, so letting it
  // match pulls a word into line with a copy of itself further along. Whitespace takes
  // its marking from the words around it instead (see `segments`).
  const aw = a.flatMap((t, i) => (t.trim() ? [i] : []));
  const bw = b.flatMap((t, i) => (t.trim() ? [i] : []));
  if (aw.length * bw.length > MAX_INLINE_CELLS) return null;

  // Longest common subsequence of those tokens, filled from the end so the walk below
  // can go forward.
  const w = bw.length + 1;
  const lcs = new Uint32Array((aw.length + 1) * w);
  for (let i = aw.length - 1; i >= 0; i--) {
    for (let j = bw.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[aw[i]] === b[bw[j]] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const aChanged = a.map((t) => t.trim() !== '');
  const bChanged = b.map((t) => t.trim() !== '');
  let sharesWord = false;
  for (let i = 0, j = 0; i < aw.length && j < bw.length; ) {
    if (a[aw[i]] === b[bw[j]]) {
      aChanged[aw[i]] = bChanged[bw[j]] = false;
      sharesWord = true;
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) i++;
    else j++;
  }
  if (!sharesWord) return null;
  return { old: segments(a, aChanged), new: segments(b, bChanged) };
}

function segments(tokens: string[], changed: boolean[]): InlineSegment[] {
  const out: InlineSegment[] = [];
  tokens.forEach((text, i) => {
    // Whitespace between two changed words is marked with them, so `only the` reads as
    // one change rather than two with a gap.
    const mark = changed[i] || (!text.trim() && changed[i - 1] === true && changed[i + 1] === true);
    const last = out[out.length - 1];
    if (last && last.changed === mark) last.text += text;
    else out.push({ text, changed: mark });
  });
  return out;
}
