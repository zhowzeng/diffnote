<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import Logo from "$lib/components/Logo.svelte";
  import Dropdown from "$lib/components/Dropdown.svelte";
  import FetchButton from "$lib/components/FetchButton.svelte";
  import { branchMeta } from "../helpers";
  import { paletteShortcut, refreshShortcut } from "../shortcuts";
  import type { Branch, DiffMode, Repo } from "../types";

  interface Props {
    repos: Repo[];
    repoId: string | null;
    branch: string | null;
    detachedHead: string | null;
    branches: Branch[];
    baseBranch: string | null;
    diffMode: DiffMode;
    fetching: boolean;
    lastFetched: string | null;
    refreshing: boolean;
    onSelectRepo: (id: string) => void;
    onAddRepo: () => void;
    onRemoveRepo: (id: string) => void;
    onSetBaseBranch: (name: string) => void;
    onFetch: () => void;
    onRefresh: () => void;
    onOpenPalette: () => void;
  }
  let {
    repos,
    repoId,
    branch,
    detachedHead,
    branches,
    baseBranch,
    diffMode,
    fetching,
    lastFetched,
    refreshing,
    onSelectRepo,
    onAddRepo,
    onRemoveRepo,
    onSetBaseBranch,
    onFetch,
    onRefresh,
    onOpenPalette,
  }: Props = $props();

  let repoOptions = $derived(repos.map((r) => ({ value: r.id, label: r.name, meta: r.path })));
  // Only the Base Branch is pickable now, so the branch under review is left out of
  // its options — a branch diffed against itself is always empty.
  let baseBranchOptions = $derived(
    branches.filter((b) => b.name !== branch).map((b) => ({ value: b.name, label: b.name, meta: branchMeta(b) })),
  );
</script>

<header class="topbar">
  <div class="brand">
    <Logo size={22} />
    <span class="wordmark">Redline</span>
  </div>
  <Dropdown
    icon="folder"
    label="Repo"
    options={repoOptions}
    value={repoId ?? ""}
    onChange={onSelectRepo}
    onAddNew={onAddRepo}
    addNewLabel="Add repo…"
    optionAction={{ icon: "trash-2", title: "從 Redline 移除（不會刪除資料夾）", onAction: onRemoveRepo }}
    placeholder="Select repo…"
    width={260}
  />
  {#if branch || detachedHead}<span class="sep" aria-hidden="true">/</span>{/if}
  <!-- Not a picker: a comment's path:L12 is read against the worktree, so the branch
       under review is always the checked-out one (docs/decisions/0010). -->
  {#if branch || detachedHead}
  <div class="topbar-branch" title={detachedHead ? "HEAD 沒有指向任何分支" : "目前 checkout 的分支"}>
    <Icon name={detachedHead ? "git-commit-horizontal" : "git-branch"} size={13} color="var(--text-tertiary)" />
    <span class="topbar-branch-name">
      {detachedHead ? `detached @ ${detachedHead}` : (branch ?? "")}
    </span>
  </div>
  {/if}
  {#if diffMode === "branch"}
    <!-- Only Branch mode compares against a Base Branch (CONTEXT.md: Diff Mode). -->
    <span class="topbar-vs">vs</span>
    <Dropdown
      icon="git-merge"
      label="Base Branch"
      sublabel="Base branch"
      options={baseBranchOptions}
      value={baseBranch ?? ""}
      onChange={onSetBaseBranch}
      width={280}
    />
  {/if}
  <div class="topbar-spacer"></div>
  <button class="jump" onclick={onOpenPalette} disabled={!repoId} title="Jump to file">
    <Icon name="search" size={13} color="var(--text-tertiary)" />
    <span>Jump to file</span>
    <kbd>{paletteShortcut.label}</kbd>
  </button>
  <!-- The local half of the pair beside it: Refresh re-reads the worktree, Fetch goes
       over ssh and may sit there for a minute (docs/decisions/0011). Different icon for
       that reason — they are not two ways to do the same thing. -->
  <button
    class="topbar-refresh"
    onclick={onRefresh}
    disabled={!repoId || refreshing}
    title={`重新讀取 diff（${refreshShortcut.label}）`}
  >
    <Icon name="rotate-cw" size={13} color="var(--text-tertiary)" class={refreshing ? "spin" : ""} />
    Refresh
  </button>
  <FetchButton {fetching} lastFetched={lastFetched ?? undefined} {onFetch} />
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 56px;
    padding: 0 var(--space-4) 0 var(--space-4);
    background: transparent;
    flex-shrink: 0;
    position: relative;
    z-index: 10;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-right: var(--space-3);
    margin-right: var(--space-1);
    border-right: 1px solid var(--border-default);
    height: 28px;
  }

  .wordmark {
    font-size: var(--text-md);
    font-weight: 700;
    letter-spacing: -0.03em;
    color: var(--text-primary);
  }

  .sep {
    color: var(--border-strong);
    font-size: var(--text-md);
    font-weight: 300;
    user-select: none;
  }

  .topbar-branch {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
    padding: 0 10px 0 8px;
    min-width: 0;
    max-width: 260px;
    border-radius: var(--radius-full);
    background: var(--accent-subtle);
    box-shadow: inset 0 0 0 1px var(--accent-muted-border);
  }
  .topbar-branch-name {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--accent-emphasis);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .topbar-vs {
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }
  .topbar-spacer {
    flex: 1;
    min-width: 8px;
  }

  .jump {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    min-width: 220px;
    padding: 0 6px 0 10px;
    border-radius: var(--radius-full);
    border: 1px solid var(--border-default);
    background: var(--bg-raised);
    color: var(--text-tertiary);
    font: 400 var(--text-xs) var(--font-sans);
    cursor: pointer;
    flex-shrink: 0;
    transition: border-color var(--dur-fast) ease, box-shadow var(--dur-base) var(--ease-out);
  }
  .jump:hover:not(:disabled) {
    border-color: var(--accent-muted-border);
  }
  .jump:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .jump span {
    flex: 1;
    text-align: left;
  }
  .jump kbd {
    padding: 2px 7px;
    border-radius: var(--radius-full);
    background: var(--bg-inset);
    font: 500 11px var(--font-mono);
    color: var(--text-secondary);
  }

  .topbar-refresh {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-default);
    background: var(--bg-raised);
    box-shadow: var(--shadow-sm);
    cursor: pointer;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    font-weight: 500;
    color: var(--text-secondary);
    flex-shrink: 0;
    transition: background var(--dur-fast) ease, border-color var(--dur-fast) ease;
  }
  .topbar-refresh:hover:not(:disabled) {
    background: var(--bg-subtle);
    border-color: var(--border-strong);
    color: var(--text-primary);
  }
  .topbar-refresh:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .topbar-refresh :global(.spin) {
    animation: z-spin 0.7s linear infinite;
  }
</style>
