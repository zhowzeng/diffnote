// Mirrors the camelCase JSON shape serde produces for src-tauri/src/types.rs.

export type DiffMode = 'unstaged' | 'staged' | 'branch';

export interface Repo {
  id: string;
  name: string;
  path: string;
  defaultBranch: string;
}

export interface Branch {
  name: string;
  isCurrent: boolean;
  /** Commits this branch has that its upstream doesn't, or null with no upstream. */
  ahead: number | null;
  behind: number | null;
}

/** What `list_branches` returns: the branches, plus what HEAD is doing when it's on
 *  none of them. */
export interface BranchList {
  branches: Branch[];
  /** Short commit id when HEAD is detached, null when it's on a branch. */
  detachedHead: string | null;
}

export interface DiffSpec {
  repoId: string;
  branch: string;
  diffMode: DiffMode;
  baseBranch?: string;
}

export interface Changes {
  add: number;
  del: number;
}

export type TreeNode =
  | { type: 'dir'; name: string; path: string; children: TreeNode[] }
  | {
      type: 'file';
      name: string;
      path: string;
      changes?: Changes;
      /** Where this file used to be, when it was renamed into `path`. */
      renamedFrom: string | null;
    };

export type LineKind = 'context' | 'add' | 'del';

export interface DiffLine {
  kind: LineKind;
  oldNo: number | null;
  newNo: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

/** One file's line-level diff between the two sides of a Diff Mode. */
export interface FileDiff {
  hunks: DiffHunk[];
  /** A file with no lines to diff, so the diff view says so instead of showing nothing. */
  binary: boolean;
  /** Both sides in full, highlighted whole rather than hunk by hunk. Empty when binary. */
  oldText: string;
  newText: string;
}

export interface FileContent {
  lines: string[];
  /** A file Redline cannot number by line, so File View says so instead of showing it. */
  binary: boolean;
}

export interface FetchResult {
  success: boolean;
  message: string;
}
