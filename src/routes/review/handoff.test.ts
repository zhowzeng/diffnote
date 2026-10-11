// The hand-off is where the line numbers are promised to mean something to a CLI agent,
// and where the Comment Queue is emptied (docs/decisions/0014). A copy that fails must
// leave the queue as it was; one that succeeds must take the queue with it and be
// undoable. These go through the real Comment Queue and settings, with the worktree
// read and the clipboard stood in for.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileContent } from './types';

vi.mock('./api', () => ({ getFileContent: vi.fn() }));
vi.mock('$lib/toast/state.svelte', () => ({ toast: vi.fn() }));

type Handoff = typeof import('./handoff');
type Queue = typeof import('./comment-queue.svelte').commentQueue;

let handoff: Handoff;
let commentQueue: Queue;
let updateSettings: typeof import('$lib/settings/state.svelte').updateSettings;
let getFileContent: ReturnType<typeof vi.fn>;
let toast: ReturnType<typeof vi.fn>;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  ({ getFileContent } = (await import('./api')) as unknown as { getFileContent: ReturnType<typeof vi.fn> });
  ({ toast } = (await import('$lib/toast/state.svelte')) as unknown as { toast: ReturnType<typeof vi.fn> });
  ({ updateSettings } = await import('$lib/settings/state.svelte'));
  ({ commentQueue } = await import('./comment-queue.svelte'));
  handoff = await import('./handoff');
});

/** The worktree as `getFileContent` reads it, file by file. */
function worktree(files: Record<string, string[]>) {
  getFileContent.mockImplementation(async (_repoId: string, file: string): Promise<FileContent> => {
    if (!(file in files)) throw new Error('not found');
    return { lines: files[file], binary: false };
  });
}

function queue(
  repoId: string,
  file: string,
  lineStart: number,
  anchorText: string[],
  text: string,
  diffMode: 'unstaged' | 'staged' | 'branch' = 'unstaged',
) {
  const lineEnd = anchorText.length > 1 ? lineStart + anchorText.length - 1 : undefined;
  commentQueue.add({ repoId, file, lineStart, lineEnd, side: 'new', text, anchorText, diffMode });
}

const copied = () => writeText.mock.calls.at(-1)?.[0];

describe('handOffQueue', () => {
  it('copies every comment of the Repo as one block and empties its queue', async () => {
    worktree({ 'src/a.ts': ['x', 'y', 'rename me'], 'src/b.ts': ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'p', 'q', 'r'] });
    queue('repo', 'src/a.ts', 3, ['rename me'], 'rename this');
    queue('repo', 'src/b.ts', 10, ['p', 'q', 'r'], 'extract a helper');
    expect(await handoff.handOffQueue('repo')).toBe(true);
    expect(copied()).toBe('src/a.ts:L3\nrename this\n\nsrc/b.ts:L10-L12\nextract a helper');
    expect(commentQueue.itemsFor('repo')).toEqual([]);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('2 則'), expect.objectContaining({ variant: 'success' }));
  });

  it('puts the prefix prompt in front once, not once per comment', async () => {
    worktree({ 'a.ts': ['one', 'two'] });
    updateSettings({ usePrefixPrompt: true, prefixPrompt: '  Apply these:  ' });
    queue('repo', 'a.ts', 1, ['one'], 'first');
    queue('repo', 'a.ts', 2, ['two'], 'second');
    await handoff.handOffQueue('repo');
    expect(copied()).toBe('Apply these:\n\na.ts:L1\nfirst\n\na.ts:L2\nsecond');
  });

  it('leaves the queue as it was when the clipboard refuses the copy', async () => {
    worktree({ 'a.ts': ['one'] });
    writeText.mockRejectedValue(new Error('denied'));
    queue('repo', 'a.ts', 1, ['one'], 'keep me');
    expect(await handoff.handOffQueue('repo')).toBe(false);
    expect(commentQueue.itemsFor('repo').map((i) => i.text)).toEqual(['keep me']);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('denied'), { variant: 'danger' });
  });

  it('puts the same comments back on undo, then hands over to onUndo', async () => {
    worktree({ 'a.ts': ['one'] });
    queue('repo', 'a.ts', 1, ['one'], 'undo me');
    const [before] = commentQueue.itemsFor('repo');
    const onUndo = vi.fn();
    await handoff.handOffQueue('repo', { onUndo });
    const [, { action }] = toast.mock.calls.at(-1)!;
    action.onclick();
    expect(commentQueue.itemsFor('repo').map((i) => i.id)).toEqual([before.id]);
    expect(onUndo).toHaveBeenCalledOnce();
  });

  it("hands off only the asking Repo's comments", async () => {
    worktree({ 'a.ts': ['one'] });
    queue('repo', 'a.ts', 1, ['one'], 'mine');
    queue('other', 'a.ts', 1, ['one'], 'theirs');
    await handoff.handOffQueue('repo');
    expect(copied()).toBe('a.ts:L1\nmine');
    expect(commentQueue.itemsFor('other').map((i) => i.text)).toEqual(['theirs']);
  });

  it('hands off a comment whose lines moved at the lines they are on now', async () => {
    worktree({ 'a.ts': ['new line', 'one', 'two'] });
    queue('repo', 'a.ts', 1, ['one', 'two'], 'moved');
    await handoff.handOffQueue('repo');
    expect(copied()).toBe('a.ts:L2-L3\nmoved');
  });

  it('quotes the lines instead of a line number once they are gone', async () => {
    worktree({ 'src/foo.rs': ['something else'] });
    queue('repo', 'src/foo.rs', 12, ['let x = foo()?;'], '這裡應該用 open_workbook_auto');
    await handoff.handOffQueue('repo');
    expect(copied()).toBe(
      'src/foo.rs (commented at L12; that code is no longer in the file)\n' +
        '> let x = foo()?;\n這裡應該用 open_workbook_auto',
    );
  });

  it('says the working tree moved when the comment was written against the index', async () => {
    worktree({ 'src/foo.rs': [] });
    queue('repo', 'src/foo.rs', 12, ['let x = foo()?;'], 'fix', 'staged');
    await handoff.handOffQueue('repo');
    expect(copied()).toBe(
      'src/foo.rs (commented at L12 as staged; the working tree has since changed)\n> let x = foo()?;\nfix',
    );
  });

  it('prefixes every quoted line, so a multi-line comment stays apart from the code', async () => {
    worktree({});
    queue('repo', 'src/foo.rs', 12, ['let x = foo()?;', 'let y = bar()?;'], 'first line\nsecond line');
    await handoff.handOffQueue('repo');
    expect(copied()).toBe(
      'src/foo.rs (commented at L12-L13; that code is no longer in the file)\n' +
        '> let x = foo()?;\n> let y = bar()?;\nfirst line\nsecond line',
    );
  });
});

describe('copyOne', () => {
  it('copies one comment checked against the worktree, and leaves the queue alone', async () => {
    worktree({ 'a.ts': ['added', 'one'] });
    queue('repo', 'a.ts', 1, ['one'], 'just this');
    const [item] = commentQueue.itemsFor('repo');
    await handoff.copyOne('repo', item.id);
    expect(copied()).toBe('a.ts:L2\njust this');
    expect(commentQueue.itemsFor('repo')).toHaveLength(1);
  });
});

describe('copyNow', () => {
  it('copies the comment as written, without the queue', async () => {
    expect(await handoff.copyNow({ file: 'a.ts', lineStart: 3, lineEnd: 4, side: 'new', text: 'now' })).toBe(true);
    expect(copied()).toBe('a.ts:L3-L4\nnow');
    expect(commentQueue.itemsFor('repo')).toEqual([]);
  });

  it('says so when the clipboard refuses it', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    expect(await handoff.copyNow({ file: 'a.ts', lineStart: 3, side: 'file', text: 'now' })).toBe(false);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('denied'), { variant: 'danger' });
  });
});

describe('recheckQueue', () => {
  it('moves a queued comment to where its lines are now, without copying anything', async () => {
    worktree({ 'a.ts': ['added', 'one'] });
    queue('repo', 'a.ts', 1, ['one'], 'follow me');
    await handoff.recheckQueue('repo');
    expect(commentQueue.itemsFor('repo')[0].lineStart).toBe(2);
    expect(writeText).not.toHaveBeenCalled();
  });
});
