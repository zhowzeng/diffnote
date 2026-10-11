// A comment selection names line indexes into the lines on screen when it was made, so
// it has to be gone once those lines are replaced — or the thread sits on whatever
// lines now have those indexes, and Add to Queue anchors the comment there. It used to
// be closed by hand before every reviewState call that could replace them, and Fetch
// was one that didn't. These go through reviewState itself, so a new path that
// replaces the lines is covered without anyone remembering to add it here.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchList, FileDiff, TreeNode } from './types';

vi.mock('./api', () => ({
  listRepos: vi.fn(),
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  pickRepoFolder: vi.fn(),
  listBranches: vi.fn(),
  getFileTree: vi.fn(),
  getFileDiff: vi.fn(),
  getFileContent: vi.fn(),
  fetchRemote: vi.fn(),
}));

vi.mock('$lib/toast/state.svelte', () => ({ toast: vi.fn() }));

vi.mock('./highlight', () => ({ highlightLines: vi.fn(async () => null) }));

type ReviewState = typeof import('./state.svelte').reviewState;
type Selection = typeof import('./selection.svelte').selection;
type Api = { [K in keyof typeof import('./api')]: ReturnType<typeof vi.fn> };

let reviewState: ReviewState;
let selection: Selection;
let api: Api;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  api = (await import('./api')) as unknown as Api;
  ({ reviewState } = await import('./state.svelte'));
  ({ selection } = await import('./selection.svelte'));
});

const branchList: BranchList = {
  branches: [{ name: 'main', isCurrent: true, ahead: null, behind: null }],
  detachedHead: null,
};

const tree: TreeNode[] = ['a.ts', 'b.ts'].map((path) => ({
  type: 'file',
  name: path,
  path,
  changes: { add: 1, del: 0 },
  renamedFrom: null,
}));

const diff = (text: string): FileDiff => ({
  hunks: [{ header: '@@ -0,0 +1 @@', lines: [{ kind: 'add', oldNo: null, newNo: 1, content: text }] }],
  binary: false,
  oldText: '',
  newText: text,
});

/** A Repo open on a.ts, with a comment thread open on its first line. */
async function openThread() {
  api.listBranches.mockResolvedValue(branchList);
  api.getFileTree.mockResolvedValue(tree);
  api.getFileDiff.mockResolvedValue(diff('a'));
  await reviewState.selectRepo('repo');
  expect(reviewState.selectedFile).toBe('a.ts');
  selection.openAt(0);
  selection.draft = 'half-written';
}

describe('selection', () => {
  it('closes when another file is opened', async () => {
    await openThread();
    api.getFileDiff.mockResolvedValue(diff('b'));
    await reviewState.selectFile('b.ts');
    expect(selection.range).toBeNull();
    expect(selection.includes(0)).toBe(false);
  });

  it('closes when a Fetch reloads the tree', async () => {
    await openThread();
    api.fetchRemote.mockResolvedValue({ success: true, message: 'ok' });
    await reviewState.fetchRemoteBranch();
    expect(selection.range).toBeNull();
  });

  it('stays open, draft and all, when a Refresh re-reads the same lines', async () => {
    await openThread();
    await reviewState.refresh();
    expect(selection.range).toEqual({ lo: 0, hi: 0 });
    expect(selection.draft).toBe('half-written');
  });

  it('closes when a Refresh brings back different lines', async () => {
    await openThread();
    api.getFileDiff.mockResolvedValue(diff('edited by an agent'));
    await reviewState.refresh();
    expect(selection.range).toBeNull();
  });

  it('does not come back when the reviewer returns to the file it was on', async () => {
    await openThread();
    api.getFileDiff.mockResolvedValueOnce(diff('b'));
    await reviewState.selectFile('b.ts');
    await reviewState.selectFile('a.ts');
    expect(selection.range).toBeNull();
  });

  it('drops a drag whose lines were replaced before the mouse came up', async () => {
    await openThread();
    selection.close();
    selection.startDrag(0);
    api.getFileDiff.mockResolvedValue(diff('b'));
    await reviewState.selectFile('b.ts');
    selection.commitDrag();
    expect(selection.range).toBeNull();
  });

  it('does not bring back a closed-by-replacement range when a new drag starts', async () => {
    await openThread();
    api.getFileDiff.mockResolvedValue(diff('b'));
    await reviewState.selectFile('b.ts');
    selection.startDrag(0);
    expect(selection.range).toBeNull();
  });
});
