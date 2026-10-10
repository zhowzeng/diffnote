<script lang="ts">
  import { onMount } from "svelte";
  import DiffPanel from "./components/DiffPanel.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Topbar from "./components/Topbar.svelte";
  import QueueDrawer from "./components/QueueDrawer.svelte";
  import QueueFab from "./components/QueueFab.svelte";
  import CommandPalette from "./components/CommandPalette.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import Button from "$lib/components/Button.svelte";
  import SettingsModal from "$lib/components/SettingsModal.svelte";
  import { reviewState } from "./state.svelte";
  import { commentQueue } from "./comment-queue.svelte";
  import { selection } from "./selection.svelte";
  import { resolveAgainstWorktree } from "./handoff";
  import { adjacentChangedFile, formatForAgent, formatQueueForAgent, pruneToChanged } from "./helpers";
  import { copyAllShortcut, nextFileShortcut, paletteShortcut, prevFileShortcut, refreshShortcut } from "./shortcuts";
  import { toast } from "$lib/toast/state.svelte";
  import { DIFF_FONT_SIZE_PX, settings, updateSettings } from "$lib/settings/state.svelte";
  import type { DiffMode, Repo } from "./types";

  onMount(() => {
    reviewState.loadRepos();
  });

  let settingsOpen = $state(false);
  let paletteOpen = $state(false);
  let removeTarget = $state<Repo | null>(null);

  let changedTree = $derived(pruneToChanged(reviewState.tree));
  // Nothing has been added on this machine yet, so the reviewer's next step is the
  // folder picker rather than the Repo dropdown.
  let noRepos = $derived(reviewState.repos.length === 0);
  let loadingFiles = $derived(reviewState.loadingRepos || reviewState.loadingBranches || reviewState.loadingTree);

  // A queue belongs to one Repo (docs/decisions/0009), so everything read out of it
  // here is scoped to the Repo being reviewed.
  let queueItems = $derived(commentQueue.itemsFor(reviewState.repoId));

  // These shortcuts live here rather than beside the buttons that print them: the drawer
  // is only rendered while it is open, Refresh has to swallow its keystroke whether or
  // not there is a Repo to reload, and j / k need the whole tree — see shortcuts.ts.
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (paletteShortcut.matches(e)) {
        e.preventDefault();
        if (reviewState.repoId && !settingsOpen && !removeTarget) paletteOpen = !paletteOpen;
        return;
      }
      if (refreshShortcut.matches(e)) {
        e.preventDefault();
        refresh();
        return;
      }
      const step = nextFileShortcut.matches(e) ? 1 : prevFileShortcut.matches(e) ? -1 : 0;
      // A Modal is in front of the tree, so the file behind it isn't the reviewer's to
      // switch right now.
      if (step !== 0 && !settingsOpen && !removeTarget && !paletteOpen) {
        const path = adjacentChangedFile(reviewState.tree, reviewState.selectedFile, step);
        if (path) selectFile(path);
        return;
      }
      // Nothing to copy means nothing to swallow the keystroke for.
      if (!copyAllShortcut.matches(e) || queueItems.length === 0) return;
      e.preventDefault();
      copyAllForAgent();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Fired from the drawer's button and from the shortcut, which can run with the drawer
  // closed — so the toast is the only feedback that anything happened.
  //
  // Every comment is checked against the worktree on the way out (docs/decisions/0013):
  // the files may have been edited since the comments were written, and this is the
  // moment the line numbers are promised to mean something.
  async function copyAllForAgent() {
    const repoId = reviewState.repoId;
    if (!repoId) return;
    const prefix = settings.usePrefixPrompt ? settings.prefixPrompt.trim() : "";
    const comments = await resolveAgainstWorktree(repoId, queueItems);
    try {
      await navigator.clipboard.writeText(formatQueueForAgent(comments, prefix));
    } catch (e) {
      toast(`複製到剪貼簿失敗：${e}`, { variant: "danger" });
      return;
    }
    // The copy is the hand-off, and a comment that has been handed off has done its job,
    // so the copy empties the queue (docs/decisions/0014). A copy that went to the wrong
    // window took the queue with it — that is what the undo is for, and it is only on
    // offer while the toast is, so this toast stands longer than a plain report.
    const handedOff = commentQueue.takeFor(repoId);
    // The open thread rendered one of those comments; with it gone the thread would
    // linger as an empty reply box, so it closes with the queue. Undo reopens it, but
    // only if the same file and Diff Mode are still on screen — the range is flat line
    // indexes into that diff and means nothing against another.
    const reopen = selection.range;
    const { selectedFile, diffMode } = reviewState;
    selection.close();
    toast(`已複製 ${comments.length} 則 comment，queue 已清空`, {
      variant: "success",
      duration: 8000,
      action: {
        label: "復原",
        onclick: () => {
          commentQueue.restore(handedOff);
          if (
            reopen &&
            !selection.range &&
            reviewState.repoId === repoId &&
            reviewState.selectedFile === selectedFile &&
            reviewState.diffMode === diffMode
          ) {
            selection.openAt(reopen.lo, reopen.hi);
          }
        },
      },
    });
  }

  // The drawer's per-comment copy runs the same check, but it re-copies one comment
  // rather than handing the queue over, so it leaves the queue alone — only the bulk
  // copy empties it (docs/decisions/0014). It lives here rather than in the drawer
  // because that check needs the Repo.
  async function copyOneForAgent(id: string) {
    const repoId = reviewState.repoId;
    const item = queueItems.find((i) => i.id === id);
    if (!repoId || !item) return;
    const [comment] = await resolveAgainstWorktree(repoId, [item]);
    try {
      await navigator.clipboard.writeText(formatForAgent(comment));
    } catch (e) {
      toast(`複製到剪貼簿失敗：${e}`, { variant: "danger" });
      return;
    }
    toast("已複製這則評論", { variant: "success" });
  }

  // Anything that replaces the diff on screen drops the selection with it: the lines it
  // named are no longer the lines on screen.
  function addRepo() {
    selection.close();
    reviewState.addRepo();
  }
  // Removing a Repo discards its Comment Queue (docs/decisions/0009), so it asks first
  // — but only when there is something to lose.
  function requestRemoveRepo(id: string) {
    const repo = reviewState.repos.find((r) => r.id === id);
    if (!repo) return;
    if (commentQueue.itemsFor(id).length === 0) {
      removeRepo(repo.id);
      return;
    }
    removeTarget = repo;
  }
  function removeRepo(id: string) {
    removeTarget = null;
    selection.close();
    reviewState.removeRepo(id);
  }
  function selectRepo(id: string) {
    selection.close();
    reviewState.selectRepo(id);
  }
  function setBaseBranch(name: string) {
    selection.close();
    reviewState.setBaseBranch(name);
  }
  function setDiffMode(mode: string) {
    selection.close();
    reviewState.setDiffMode(mode as DiffMode);
  }
  function selectFile(path: string) {
    selection.close();
    reviewState.selectFile(path);
  }
  // Refresh keeps the reviewer on their file, but the diff under them is re-read, so an
  // open selection still has to go — the lines it named are not the lines coming back.
  //
  // The queue is re-checked against the re-read files as well: a comment whose lines
  // moved would otherwise keep marking the lines it used to be on (docs/decisions/0013).
  async function refresh() {
    selection.close();
    await reviewState.refresh();
    const repoId = reviewState.repoId;
    if (repoId) await resolveAgainstWorktree(repoId, commentQueue.itemsFor(repoId));
  }
</script>

<div class="app" style="--diff-font-size:{DIFF_FONT_SIZE_PX[settings.diffFontSize]}">
  <Topbar
    repos={reviewState.repos}
    repoId={reviewState.repoId}
    branch={reviewState.branch}
    detachedHead={reviewState.detachedHead}
    branches={reviewState.branches}
    baseBranch={reviewState.baseBranch}
    diffMode={reviewState.diffMode}
    fetching={reviewState.fetching}
    lastFetched={reviewState.lastFetched}
    onSelectRepo={selectRepo}
    onAddRepo={addRepo}
    onRemoveRepo={requestRemoveRepo}
    onSetBaseBranch={setBaseBranch}
    onFetch={() => reviewState.fetchRemoteBranch()}
    refreshing={reviewState.loadingTree}
    onRefresh={refresh}
    onOpenPalette={() => (paletteOpen = true)}
  />

  <div class="body">
    <Sidebar
      tree={reviewState.tree}
      {changedTree}
      diffMode={reviewState.diffMode}
      repoId={reviewState.repoId}
      detachedHead={reviewState.detachedHead}
      selectedFile={reviewState.selectedFile}
      loading={loadingFiles}
      {noRepos}
      onSetDiffMode={setDiffMode}
      onSelectFile={selectFile}
      onOpenSettings={() => (settingsOpen = true)}
    />

    <DiffPanel
      repoId={reviewState.repoId}
      selectedFile={reviewState.selectedFile}
      selectedRenamedFrom={reviewState.selectedRenamedFrom}
      selectedView={reviewState.selectedView}
      view={reviewState.view}
      onViewChange={(v) => (reviewState.view = v)}
      diffMode={reviewState.diffMode}
      diffHunks={reviewState.diffHunks}
      diffBinary={reviewState.diffBinary}
      loadingDiff={reviewState.loadingDiff}
      fileLines={reviewState.fileLines}
      fileBinary={reviewState.fileBinary}
      loadingFile={reviewState.loadingFile}
      oldTokens={reviewState.oldTokens}
      newTokens={reviewState.newTokens}
      fileTokens={reviewState.fileTokens}
      loading={loadingFiles}
      {noRepos}
      hasChanges={changedTree.length > 0}
      lineWrap={settings.lineWrap}
      detachedHead={reviewState.detachedHead}
      onAddRepo={addRepo}
    />

    {#if commentQueue.open}
      <QueueDrawer
        items={queueItems}
        repoName={reviewState.repo?.name}
        onRemove={(id) => commentQueue.remove(id)}
        onCopyOne={copyOneForAgent}
        onCopyAll={copyAllForAgent}
        onClose={() => (commentQueue.open = false)}
      />
    {/if}
  </div>

  <CommandPalette
    open={paletteOpen}
    tree={changedTree}
    selectedFile={reviewState.selectedFile}
    onSelect={selectFile}
    onClose={() => (paletteOpen = false)}
  />
  <QueueFab count={queueItems.length} open={commentQueue.open} onclick={() => (commentQueue.open = !commentQueue.open)} />
  <SettingsModal open={settingsOpen} onClose={() => (settingsOpen = false)} {settings} onChange={updateSettings} />

  <Modal open={removeTarget !== null} onClose={() => (removeTarget = null)} title="移除 repo？" width={400}>
    {#if removeTarget}
      <p class="modal-text">
        <strong>{removeTarget.name}</strong> 會從 Redline 的清單移除，資料夾本身不會被刪除，之後可以再加回來。
      </p>
      <p class="modal-text modal-warning">
        這會一併丟掉 {commentQueue.itemsFor(removeTarget.id).length} 則還沒交出去的 comment。
      </p>
    {/if}
    {#snippet footer()}
      <Button size="sm" onclick={() => (removeTarget = null)}>取消</Button>
      <Button variant="danger" size="sm" onclick={() => removeTarget && removeRepo(removeTarget.id)}>移除</Button>
    {/snippet}
  </Modal>
</div>

<style>
  :global(html, body) {
    height: 100%;
  }

  .app {
    animation: z-fade-in var(--dur-slow) ease-out;
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: var(--font-sans);
  }

  .modal-text {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--text-secondary);
  }
  .modal-warning {
    margin-top: 10px;
    color: var(--danger-emphasis);
  }
  /* The sidebar, diff and drawer float as cards on the tinted canvas. */
  .body {
    display: flex;
    flex: 1;
    min-height: 0;
    gap: 10px;
    padding: 0 10px 10px;
  }
</style>
