// The hand-off: everything between the reviewer pressing a copy button and a CLI agent
// reading the text — checking queued Comments against the worktree (docs/decisions/0013),
// writing the clipboard, emptying the Comment Queue once it has been handed over
// (docs/decisions/0014), and telling the reviewer how that went. Copy All, the drawer's
// per-comment copy and Copy Now (docs/decisions/0001) all go through here, and so does
// Refresh's re-check.

import { settings } from '$lib/settings/state.svelte';
import { toast } from '$lib/toast/state.svelte';
import { resolveAnchor, type AnchorResolution } from './anchor';
import { getFileContent } from './api';
import { commentQueue, type QueueItem } from './comment-queue.svelte';
import type { CommentAnchor } from './helpers';

// Hands the Repo's whole Comment Queue to the clipboard as one block, and empties the
// queue: the copy is the hand-off, and a Comment that has been handed off has done its
// job (docs/decisions/0014). A copy that went to the wrong window took the queue with
// it, which is what the toast's undo is for — it puts the same Comments back, then
// calls `onUndo`. Resolves to whether the queue was handed off.
export async function handOffQueue(repoId: string, { onUndo }: { onUndo?: () => void } = {}): Promise<boolean> {
  const items = commentQueue.itemsFor(repoId);
  if (items.length === 0) return false;
  const comments = await resolveAgainstWorktree(repoId, items);
  const prefix = settings.usePrefixPrompt ? settings.prefixPrompt.trim() : '';
  if (!(await copy(formatQueueForAgent(comments, prefix)))) return false;
  const handedOff = commentQueue.takeFor(repoId);
  // The undo is only on offer while the toast is, so this one stands longer than a
  // plain report.
  toast(`已複製 ${comments.length} 則 comment，queue 已清空`, {
    variant: 'success',
    duration: 8000,
    action: {
      label: '復原',
      onclick: () => {
        commentQueue.restore(handedOff);
        onUndo?.();
      },
    },
  });
  return true;
}

// Re-copies one queued Comment, checked against the worktree like the rest. It leaves
// the queue alone: only handing over the whole queue empties it (docs/decisions/0014).
export async function copyOne(repoId: string, id: string): Promise<void> {
  const item = commentQueue.itemsFor(repoId).find((i) => i.id === id);
  if (!item) return;
  const [comment] = await resolveAgainstWorktree(repoId, [item]);
  if (await copy(formatForAgent(comment))) toast('已複製這則評論', { variant: 'success' });
}

// Copies a Comment the moment it is written, without it ever entering the queue
// (docs/decisions/0001). Its lines are on screen right now, so there is nothing to check
// them against. Resolves to whether it was copied.
export async function copyNow(comment: CommentAnchor & { file: string; text: string }): Promise<boolean> {
  const { file, lineStart, lineEnd, text } = comment;
  if (!(await copy(formatForAgent({ file, lineStart, lineEnd, text })))) return false;
  toast('已複製這則評論', { variant: 'success' });
  return true;
}

// Checks the Repo's queue against the files Refresh just re-read, so a Comment whose
// lines moved marks the lines it is on now rather than the ones it used to be on.
export async function recheckQueue(repoId: string): Promise<void> {
  await resolveAgainstWorktree(repoId, commentQueue.itemsFor(repoId));
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    toast(`複製到剪貼簿失敗：${e}`, { variant: 'danger' });
    return false;
  }
}

// A comment in the shape it is handed to a CLI agent: the line numbers already checked
// against the worktree, so the formatter only has to print them.
interface AgentComment {
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

// The worktree file, or null when the Comment's code cannot be there to find: a
// deleted or unreadable file rejects, and a binary one has no lines to compare.
async function readWorktree(repoId: string, file: string): Promise<string[] | null> {
  try {
    const content = await getFileContent(repoId, file);
    return content.binary ? null : content.lines;
  } catch {
    return null;
  }
}

// Checks every Comment in `items` against the worktree, writes the result back to the
// Comment Queue — re-anchored line numbers, or Orphaned — and returns the comments in
// hand-off form.
async function resolveAgainstWorktree(repoId: string, items: QueueItem[]): Promise<AgentComment[]> {
  const files = new Map<string, string[] | null>();
  const comments: AgentComment[] = [];
  for (const item of items) {
    if (!files.has(item.file)) files.set(item.file, await readWorktree(repoId, item.file));
    const resolution = resolveAnchor(files.get(item.file) ?? null, item);
    commentQueue.applyResolution(item.id, resolution);
    comments.push(toAgentComment(item, resolution));
  }
  return comments;
}

// An Orphaned Comment keeps the line numbers it was written at — they are what the
// hand-off reports it was commented at, alongside the quote that replaces them.
function toAgentComment(item: QueueItem, resolution: AnchorResolution): AgentComment {
  if (resolution.kind === 'anchored') {
    return {
      file: item.file,
      lineStart: resolution.lineStart,
      lineEnd: resolution.lineEnd,
      text: item.text,
    };
  }
  return {
    file: item.file,
    lineStart: item.lineStart,
    lineEnd: item.lineEnd,
    text: item.text,
    orphaned: { anchorText: item.anchorText, staged: item.diffMode === 'staged' },
  };
}

// The text handed to a CLI coding agent, for the Comment Queue and Copy Now alike — one
// formatter so the two can't drift apart.
//
// Deliberately ASCII-only (not helpers.ts's rangeLabel, which uses an en dash) — this
// text is copied straight into a CLI agent's prompt.
function formatForAgent(comment: AgentComment) {
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
function formatQueueForAgent(items: AgentComment[], prefix: string) {
  const comments = items.map(formatForAgent).join('\n\n');
  return prefix ? `${prefix}\n\n${comments}` : comments;
}
