import { settings } from '$lib/settings/state.svelte';
import { toast } from '$lib/toast/state.svelte';
import { commentQueue } from './comment-queue.svelte';
import {
  addRepo as addRepoCommand,
  fetchRemote,
  getFileContent,
  getFileDiff,
  getFileTree,
  listBranches,
  listRepos,
  pickRepoFolder,
  removeRepo as removeRepoCommand,
} from './api';
import { fileAfterReload, findFileNode } from './helpers';
import { highlightLines, type SyntaxToken } from './highlight';
import type { Branch, DiffHunk, DiffMode, DiffSpec, FileContent, FileDiff, Repo, TreeNode } from './types';

export type ViewMode = 'unified' | 'split';

// A file the reviewer opened recently, kept so going back to it paints at once and skips
// re-highlighting when it hasn't changed. `tokens` stays unset until highlighting lands.
type RecentFile =
  | { view: 'diff'; diff: FileDiff; tokens?: [SyntaxToken[][] | null, SyntaxToken[][] | null] }
  | { view: 'file'; content: FileContent; tokens?: SyntaxToken[][] | null };

// Each one holds both sides of a file and their tokens, so only the last few stay.
const RECENT_FILES = 5;

class ReviewState {
  repos = $state<Repo[]>([]);
  repoId = $state<string | null>(null);
  branches = $state<Branch[]>([]);
  branch = $state<string | null>(null);
  // Set when HEAD is on no branch at all. The topbar is a read-only indicator of what's
  // checked out (docs/decisions/0010), so it has to be able to say that.
  detachedHead = $state<string | null>(null);
  // What a Branch-mode diff compares against (CONTEXT.md: Base Branch). Starts at the
  // Repo's default branch, and the reviewer can pick any other branch instead.
  baseBranch = $state<string | null>(null);
  // Only the mode the app opens in: changing the setting later doesn't move the
  // reviewer out of the mode they're in.
  diffMode = $state<DiffMode>(settings.defaultDiffMode);
  view = $state<ViewMode>('unified');

  tree = $state<TreeNode[]>([]);
  selectedFile = $state<string | null>(null);
  // Which view the selected file opens in: a changed file shows its diff, an unchanged
  // one shows File View — its full worktree content (CONTEXT.md: File View).
  selectedView = $state<'diff' | 'file' | null>(null);
  diffHunks = $state<DiffHunk[]>([]);
  // A changed file with no lines to diff. Not the same as having no changes, so the
  // diff view says so rather than showing the "no changes" empty state.
  diffBinary = $state(false);
  fileLines = $state<string[]>([]);
  fileBinary = $state(false);
  // Syntax colours for each side of the diff and for File View, by line number - 1.
  // Null until highlighting lands, and for a file with no grammar — the lines then
  // show as plain text. Raw: replaced whole, and large enough that proxying costs.
  oldTokens = $state.raw<SyntaxToken[][] | null>(null);
  newTokens = $state.raw<SyntaxToken[][] | null>(null);
  fileTokens = $state.raw<SyntaxToken[][] | null>(null);

  loadingRepos = $state(false);
  loadingBranches = $state(false);
  loadingTree = $state(false);
  loadingDiff = $state(false);
  loadingFile = $state(false);
  fetching = $state(false);
  lastFetched = $state<string | null>(null);

  // Bumped on every load. A response only lands if its sequence number is still
  // the current one, so a slow reply for a repo/branch/file the reviewer has
  // already switched away from can't overwrite the newer state.
  #branchSeq = 0;
  #treeSeq = 0;
  #diffSeq = 0;

  // Most recently opened last. Keyed by the spec as well as the path, so a file seen in
  // another Diff Mode or against another Base Branch is never shown for this one.
  #recent = new Map<string, RecentFile>();

  repo = $derived(this.repos.find((r) => r.id === this.repoId) ?? null);

  // Where the selected file was before it was moved, so the file header can say so
  // rather than leaving the reviewer to spot it.
  selectedRenamedFrom = $derived.by(() => {
    if (!this.selectedFile) return null;
    const node = findFileNode(this.tree, this.selectedFile);
    return node?.type === 'file' ? (node.renamedFrom ?? null) : null;
  });

  spec = $derived.by<DiffSpec | null>(() => {
    if (!this.repoId || !this.branch) return null;
    const spec: DiffSpec = { repoId: this.repoId, branch: this.branch, diffMode: this.diffMode };
    if (this.diffMode === 'branch' && this.baseBranch) spec.baseBranch = this.baseBranch;
    return spec;
  });

  async loadRepos() {
    this.loadingRepos = true;
    try {
      this.repos = await listRepos();
      if (this.repos.length) await this.selectRepo(this.repos[0].id);
    } catch (e) {
      toast(`載入 repo 清單失敗：${e}`, { variant: 'danger' });
    } finally {
      this.loadingRepos = false;
    }
  }

  // Picks a folder, registers it as a Repo, and opens it for review. A folder that's
  // already registered just gets selected again.
  async addRepo() {
    let path: string | null;
    try {
      path = await pickRepoFolder();
    } catch (e) {
      toast(`開啟資料夾選擇器失敗：${e}`, { variant: 'danger' });
      return;
    }
    if (!path) return;
    try {
      const repo = await addRepoCommand(path);
      if (!this.repos.some((r) => r.id === repo.id)) this.repos = [...this.repos, repo];
      await this.selectRepo(repo.id);
    } catch (e) {
      toast(`新增 repo 失敗：${e}`, { variant: 'danger' });
    }
  }

  // Drops the Repo from Diffnote — never the folder on disk. Its Comment Queue goes with
  // it (docs/decisions/0009); the caller is the one that warns about unsent comments.
  async removeRepo(id: string) {
    try {
      await removeRepoCommand(id);
    } catch (e) {
      toast(`移除 repo 失敗：${e}`, { variant: 'danger' });
      return;
    }
    this.repos = this.repos.filter((r) => r.id !== id);
    commentQueue.removeRepo(id);
    if (this.repoId !== id) return;
    // Nothing is selected any more, and a load still in flight for the removed Repo
    // must not land on top of that.
    this.#branchSeq++;
    this.#treeSeq++;
    this.#diffSeq++;
    this.repoId = null;
    this.branch = null;
    this.branches = [];
    this.detachedHead = null;
    this.baseBranch = null;
    this.tree = [];
    this.#clearSelection();
  }

  async selectRepo(id: string) {
    this.repoId = id;
    this.branch = null;
    this.branches = [];
    this.detachedHead = null;
    this.tree = [];
    // Each Repo brings its own default branch, so the previous Repo's base branch
    // doesn't carry over.
    this.baseBranch = this.repo?.defaultBranch ?? null;
    this.#clearSelection();
    this.#treeSeq++;
    this.#diffSeq++;

    const seq = ++this.#branchSeq;
    this.loadingBranches = true;
    try {
      const { branches, detachedHead } = await listBranches(id);
      if (seq !== this.#branchSeq) return;
      this.branches = branches;
      this.detachedHead = detachedHead;
      // The branch under review is whichever one is checked out (docs/decisions/0010).
      // A detached HEAD has none, and falling back to some other branch would label the
      // topbar with a branch the reviewer isn't on — exactly what that ADR rules out.
      const current = branches.find((b) => b.isCurrent);
      if (current) await this.#selectBranch(current.name);
    } catch (e) {
      if (seq !== this.#branchSeq) return;
      toast(`載入分支清單失敗：${e}`, { variant: 'danger' });
    } finally {
      if (seq === this.#branchSeq) this.loadingBranches = false;
    }
  }

  // Internal only: the reviewer doesn't pick the branch under review, it's whichever
  // one the Repo has checked out (docs/decisions/0010).
  async #selectBranch(name: string) {
    this.branch = name;
    await this.reloadTree();
  }

  async setBaseBranch(name: string) {
    this.baseBranch = name;
    await this.reloadTree();
  }

  async setDiffMode(mode: DiffMode) {
    this.diffMode = mode;
    await this.reloadTree();
  }

  // The one action the agent workflow needs and the diff never had: re-read the tree
  // and the open diff straight off disk, with no ssh round-trip (docs/decisions/0011)
  // and no bouncing the reviewer off the file they were reading. The branch is re-read
  // too: a checkout in the terminal changes what's under review (docs/decisions/0010).
  async refresh() {
    await this.#reloadBranches();
    await this.reloadTree({ keepSelection: true });
  }

  async reloadTree({ keepSelection = false } = {}) {
    const spec = this.spec;
    if (!spec) {
      // No branch under review (a detached HEAD), so whatever tree was showing belongs
      // to a branch the Repo is no longer on.
      this.#treeSeq++;
      this.#diffSeq++;
      this.tree = [];
      this.#clearSelection();
      return;
    }
    const seq = ++this.#treeSeq;
    this.#diffSeq++;
    // Refresh keeps showing the file it is reloading, so its selection can only be
    // dropped once the new tree says whether that file is still there. Switching Repo,
    // Diff Mode or Base Branch shows something else entirely, so theirs goes now.
    const previous = keepSelection ? this.selectedFile : null;
    if (!keepSelection) this.#clearSelection();
    this.loadingTree = true;
    try {
      const tree = await getFileTree(spec);
      if (seq !== this.#treeSeq) return;
      this.tree = tree;
      const path = fileAfterReload(tree, previous);
      if (path) await this.selectFile(path);
      else this.#clearSelection();
    } catch (e) {
      if (seq !== this.#treeSeq) return;
      toast(`載入變更檔案清單失敗：${e}`, { variant: 'danger' });
    } finally {
      if (seq === this.#treeSeq) this.loadingTree = false;
    }
  }

  async selectFile(path: string) {
    const seq = ++this.#diffSeq;
    const spec = this.spec;
    if (!spec) return;
    const node = findFileNode(this.tree, path);
    // Only a changed file has a diff to show; anything else opens in File View.
    const view = node?.type === 'file' && node.changes ? 'diff' : 'file';
    this.selectedFile = path;
    this.selectedView = view;
    this.diffHunks = [];
    this.diffBinary = false;
    this.fileLines = [];
    this.fileBinary = false;
    this.#clearTokens();
    const key = JSON.stringify([spec, view, path]);
    if (view === 'diff') await this.#loadDiff(spec, path, key, seq);
    else await this.#loadFileContent(spec.repoId, path, key, seq);
  }

  // A file opened recently shows what it had straight away, and is read off disk again
  // all the same: an agent may have changed it since, and the reviewer sees that without
  // a Refresh, as before there was anything kept.
  async #loadDiff(spec: DiffSpec, path: string, key: string, seq: number) {
    const recent = this.#recent.get(key);
    const shown = recent?.view === 'diff' ? recent : undefined;
    if (shown) {
      this.diffHunks = shown.diff.hunks;
      this.diffBinary = shown.diff.binary;
      if (shown.tokens) [this.oldTokens, this.newTokens] = shown.tokens;
    }
    this.loadingDiff = !shown;
    try {
      const diff = await getFileDiff(spec, path);
      if (seq !== this.#diffSeq) return;
      if (shown && sameDiff(shown.diff, diff)) {
        this.#remember(key, shown);
        if (shown.tokens === undefined) void this.#highlightDiff(path, shown, seq);
        return;
      }
      const entry: RecentFile = { view: 'diff', diff };
      this.#remember(key, entry);
      this.diffHunks = diff.hunks;
      this.diffBinary = diff.binary;
      this.#clearTokens();
      void this.#highlightDiff(path, entry, seq);
    } catch (e) {
      this.#recent.delete(key);
      if (seq !== this.#diffSeq) return;
      // What was kept is no longer known to be what's on disk.
      this.diffHunks = [];
      this.diffBinary = false;
      this.#clearTokens();
      toast(`載入 diff 失敗：${e}`, { variant: 'danger' });
    } finally {
      if (seq === this.#diffSeq) this.loadingDiff = false;
    }
  }

  async #loadFileContent(repoId: string, path: string, key: string, seq: number) {
    const recent = this.#recent.get(key);
    const shown = recent?.view === 'file' ? recent : undefined;
    if (shown) {
      this.fileLines = shown.content.lines;
      this.fileBinary = shown.content.binary;
      if (shown.tokens !== undefined) this.fileTokens = shown.tokens;
    }
    this.loadingFile = !shown;
    try {
      const content = await getFileContent(repoId, path);
      if (seq !== this.#diffSeq) return;
      if (shown && sameContent(shown.content, content)) {
        this.#remember(key, shown);
        if (shown.tokens === undefined) void this.#highlightFile(path, shown, seq);
        return;
      }
      const entry: RecentFile = { view: 'file', content };
      this.#remember(key, entry);
      this.fileLines = content.lines;
      this.fileBinary = content.binary;
      this.#clearTokens();
      void this.#highlightFile(path, entry, seq);
    } catch (e) {
      this.#recent.delete(key);
      if (seq !== this.#diffSeq) return;
      this.fileLines = [];
      this.fileBinary = false;
      this.#clearTokens();
      toast(`載入檔案內容失敗：${e}`, { variant: 'danger' });
    } finally {
      if (seq === this.#diffSeq) this.loadingFile = false;
    }
  }

  #remember(key: string, entry: RecentFile) {
    this.#recent.delete(key);
    this.#recent.set(key, entry);
    if (this.#recent.size > RECENT_FILES) this.#recent.delete(this.#recent.keys().next().value!);
  }

  // Colours land after the lines are already on screen, so a grammar loading for the
  // first time never holds up the diff. A file that fails to highlight stays plain
  // text: nothing the reviewer needs is missing, so there is nothing to tell them.
  // The colours are kept with the file even once the reviewer has moved on, so going
  // back to it doesn't highlight it again.
  async #highlightDiff(path: string, entry: RecentFile & { view: 'diff' }, seq: number) {
    try {
      const [oldTokens, newTokens] = await Promise.all([
        highlightLines(path, entry.diff.oldText),
        highlightLines(path, entry.diff.newText),
      ]);
      entry.tokens = [oldTokens, newTokens];
      if (seq !== this.#diffSeq) return;
      this.oldTokens = oldTokens;
      this.newTokens = newTokens;
    } catch {
      // Plain text it is.
    }
  }

  async #highlightFile(path: string, entry: RecentFile & { view: 'file' }, seq: number) {
    try {
      const tokens = await highlightLines(path, entry.content.lines.join('\n'));
      entry.tokens = tokens;
      if (seq !== this.#diffSeq) return;
      this.fileTokens = tokens;
    } catch {
      // Plain text it is.
    }
  }

  #clearTokens() {
    this.oldTokens = null;
    this.newTokens = null;
    this.fileTokens = null;
  }

  #clearSelection() {
    this.selectedFile = null;
    this.selectedView = null;
    this.diffHunks = [];
    this.diffBinary = false;
    this.fileLines = [];
    this.fileBinary = false;
    this.#clearTokens();
  }

  async fetchRemoteBranch() {
    if (!this.repoId || this.fetching) return;
    this.fetching = true;
    try {
      const result = await fetchRemote(this.repoId);
      if (!result.success) {
        toast(result.message, { variant: 'danger' });
        return;
      }
      this.lastFetched = new Date().toLocaleString('zh-TW', { hour12: false });
      toast(result.message, { variant: 'success' });
      await this.#reloadBranches();
      await this.reloadTree();
    } catch (e) {
      toast(`Fetch 失敗：${e}`, { variant: 'danger' });
    } finally {
      this.fetching = false;
    }
  }

  // Refreshes ahead/behind counts and follows whatever branch is now checked out,
  // keeping the current file selection.
  async #reloadBranches() {
    const id = this.repoId;
    if (!id) return;
    const seq = ++this.#branchSeq;
    try {
      const { branches, detachedHead } = await listBranches(id);
      if (seq !== this.#branchSeq) return;
      this.branches = branches;
      this.detachedHead = detachedHead;
      this.branch = branches.find((b) => b.isCurrent)?.name ?? null;
      // Checking out the Base Branch itself leaves nothing branch-specific to compare,
      // so fall back to the Repo's default branch when that is a different one.
      const defaultBranch = this.repo?.defaultBranch ?? null;
      if (this.branch && this.branch === this.baseBranch && defaultBranch !== this.branch) {
        this.baseBranch = defaultBranch;
      }
    } catch (e) {
      toast(`載入分支清單失敗：${e}`, { variant: 'danger' });
    }
  }
}

export const reviewState = new ReviewState();

// The hunks come from the two sides, so the same sides mean the same diff.
function sameDiff(a: FileDiff, b: FileDiff) {
  return a.binary === b.binary && a.oldText === b.oldText && a.newText === b.newText;
}

function sameContent(a: FileContent, b: FileContent) {
  return a.binary === b.binary && a.lines.length === b.lines.length && a.lines.every((line, i) => line === b.lines[i]);
}
