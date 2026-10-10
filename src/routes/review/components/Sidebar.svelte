<script lang="ts">
  import FileTree from "./FileTree.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import Input from "$lib/components/Input.svelte";
  import Segmented from "$lib/components/Segmented.svelte";
  import Checkbox from "$lib/components/Checkbox.svelte";
  import { allDirPaths, pruneByName } from "../helpers";
  import type { DiffMode, TreeNode } from "../types";

  const DIFF_MODES = [
    { value: "unstaged", label: "Unstaged" },
    { value: "branch", label: "Branch" },
    { value: "staged", label: "Staged" },
  ];

  interface Props {
    tree: TreeNode[];
    /** The changed-file subtree, so the "no diff" state and the default expansion agree
     *  with what the diff panel is showing. */
    changedTree: TreeNode[];
    diffMode: DiffMode;
    repoId: string | null;
    detachedHead: string | null;
    selectedFile: string | null;
    loading: boolean;
    /** Nothing has been added on this machine yet, so the reviewer's next step is the
     *  folder picker rather than the Repo dropdown. */
    noRepos: boolean;
    onSetDiffMode: (mode: string) => void;
    onSelectFile: (path: string) => void;
    onOpenSettings: () => void;
  }
  let {
    tree,
    changedTree,
    diffMode,
    repoId,
    detachedHead,
    selectedFile,
    loading,
    noRepos,
    onSetDiffMode,
    onSelectFile,
    onOpenSettings,
  }: Props = $props();

  // Both only ever narrow what this sidebar lists, so they live here rather than in the
  // page.
  let showAllFiles = $state(false);
  let fileFilter = $state("");

  let baseTree = $derived(showAllFiles ? tree : changedTree);
  let shownTree = $derived(fileFilter.trim() ? pruneByName(baseTree, fileFilter.trim().toLowerCase()) : baseTree);
  // "No diff" is about what the sidebar would actually list: the changed files, or
  // the whole tree when the reviewer asked to see every file.
  function countFiles(nodes: TreeNode[]): number {
    return nodes.reduce((n, node) => n + (node.type === "dir" ? countFiles(node.children) : 1), 0);
  }
  let fileCount = $derived(countFiles(shownTree));
  let emptyState = $derived.by(() => {
    if (baseTree.length === 0) return "no-diff";
    if (fileFilter.trim() && shownTree.length === 0) return "no-match";
    return null;
  });
</script>

<aside class="sidebar">
  <div class="sidebar-toolbar">
    <Segmented value={diffMode} onChange={onSetDiffMode} options={DIFF_MODES} />
  </div>
  <div class="sidebar-filter">
    <div class="filter-input-wrap">
      <Icon name="search" size={13} color="var(--text-tertiary)" class="filter-icon" />
      <Input placeholder="Filter files…" size="sm" bind:value={fileFilter} disabled={!repoId} style="padding-left:26px" />
    </div>
    <Checkbox bind:checked={showAllFiles} disabled={!repoId} label="顯示所有檔案" />
  </div>
  {#if repoId && !detachedHead && !loading}
    <div class="sidebar-heading">
      <span>{showAllFiles ? "All files" : "Changed files"}</span>
      <span class="count">{fileCount}</span>
    </div>
  {/if}
  <div class="sidebar-tree">
    {#if loading}
      <div class="skeleton" aria-label="載入中" role="status">
        {#each [62, 48, 74, 56, 66, 44] as w, i (i)}
          <span style:width="{w}%" style:animation-delay="{i * 90}ms"></span>
        {/each}
      </div>
    {:else if !repoId}
      <EmptyState
        size="sm"
        icon="folder-git-2"
        title={noRepos ? "尚未加入 repo" : "尚未選擇 repo"}
        hint={noRepos
          ? "從上方 Repo 選單的「Add repo…」加入本機 git repo。"
          : "從上方選擇 repo 與 branch 後，這裡會顯示變更的檔案。"}
      />
    {:else if detachedHead}
      <EmptyState
        size="sm"
        icon="git-commit-horizontal"
        title="HEAD 沒有指向分支"
        hint={`目前停在 ${detachedHead}。Redline review 的是已 checkout 的分支，先 checkout 一個分支再回來。`}
      />
    {:else if emptyState === "no-diff"}
      <EmptyState size="sm" icon="git-compare" title="此分支沒有變更" hint="切換到有變更的分支，或勾選「顯示所有檔案」瀏覽整個專案。" />
    {:else if emptyState === "no-match"}
      <EmptyState size="sm" icon="search-x" title="找不到符合的檔案" hint={`沒有檔案名稱包含「${fileFilter.trim()}」`} />
    {:else}
      {#key tree}
        <FileTree tree={shownTree} selected={selectedFile ?? undefined} onSelect={onSelectFile} defaultExpanded={allDirPaths(changedTree)} />
      {/key}
    {/if}
  </div>
  <button class="settings-entry" onclick={onOpenSettings}>
    <Icon name="settings" size={14} color="var(--text-tertiary)" />
    Settings
  </button>
</aside>

<style>
  .sidebar {
    width: 264px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    background: var(--bg-surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    min-height: 0;
  }

  .sidebar-toolbar {
    padding: var(--space-3) var(--space-3) var(--space-2);
    flex-shrink: 0;
  }
  .sidebar-toolbar :global(.group) {
    display: grid;
    width: 100%;
  }

  .sidebar-filter {
    padding: 0 var(--space-3) var(--space-3);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .filter-input-wrap {
    position: relative;
  }
  .filter-input-wrap :global(.filter-icon) {
    position: absolute;
    left: 9px;
    top: 8px;
    pointer-events: none;
  }

  .sidebar-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--border-muted);
    font-family: var(--font-sans);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .count {
    min-width: 20px;
    padding: 1px 6px;
    border-radius: var(--radius-full);
    background: var(--bg-inset);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    text-align: center;
    letter-spacing: 0;
  }

  .sidebar-tree {
    flex: 1;
    min-height: 0;
    padding: 0 var(--space-3) var(--space-3);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .skeleton {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: var(--space-3) var(--space-2);
  }
  .skeleton span {
    height: 12px;
    border-radius: var(--radius-sm);
    background: linear-gradient(90deg, var(--bg-inset) 0%, var(--border-muted) 50%, var(--bg-inset) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
  }
  @keyframes shimmer {
    from { background-position: 100% 0; }
    to { background-position: -100% 0; }
  }

  .settings-entry {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 var(--space-4);
    border: none;
    border-top: 1px solid var(--border-default);
    background: transparent;
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
  }
  .settings-entry:hover {
    background: var(--bg-subtle);
    color: var(--text-primary);
  }
</style>
