<script lang="ts">
  import DiffHunk from "./DiffHunk.svelte";
  import DiffLine from "./DiffLine.svelte";
  import DiffLineSplit from "./DiffLineSplit.svelte";
  import FileHeader from "./FileHeader.svelte";
  import FileLine from "./FileLine.svelte";
  import InlineText from "./InlineText.svelte";
  import CommentThread from "./CommentThread.svelte";
  import Avatar from "$lib/components/Avatar.svelte";
  import EmptyState from "$lib/components/EmptyState.svelte";
  import Welcome from "./Welcome.svelte";
  import Segmented from "$lib/components/Segmented.svelte";
  import { commentQueue } from "../comment-queue.svelte";
  import { selection } from "../selection.svelte";
  import { nextFileShortcut, nextHunkShortcut, prevFileShortcut, prevHunkShortcut } from "../shortcuts";
  import { formatTime } from "../helpers";
  import { copyNow as copyNowForAgent } from "../handoff";
  import { diffLines, fileViewLines, type DiffLines, type SplitRow } from "../lines";
  import type { SyntaxToken } from "../highlight";
  import type { ViewMode } from "../state.svelte";
  import type { DiffHunk as DiffHunkData, DiffLine as DiffLineData, DiffMode } from "../types";

  const VIEW_MODES = [
    { value: "unified", label: "Unified" },
    { value: "split", label: "Split" },
  ];

  interface Props {
    repoId: string | null;
    selectedFile: string | null;
    selectedRenamedFrom: string | null;
    /** Which view the selected file opens in — an unchanged file has no diff, so it
     *  opens in File View instead (CONTEXT.md). */
    selectedView: "diff" | "file" | null;
    view: ViewMode;
    onViewChange: (view: ViewMode) => void;
    /** Which Diff Mode a comment written here is being written against — kept with the
     *  comment, for the hand-off to say so when the worktree has moved since. */
    diffMode: DiffMode;
    diffHunks: DiffHunkData[];
    diffBinary: boolean;
    loadingDiff: boolean;
    fileLines: string[];
    fileBinary: boolean;
    loadingFile: boolean;
    /** Syntax colours by line number - 1: the diff's old and new sides, and File View's
     *  file. Null while highlighting is still on its way, or for a file it can't do. */
    oldTokens: SyntaxToken[][] | null;
    newTokens: SyntaxToken[][] | null;
    fileTokens: SyntaxToken[][] | null;
    /** The repo/branch/tree load, which has to finish before any of this means anything. */
    loading: boolean;
    noRepos: boolean;
    hasChanges: boolean;
    /** Wrap long lines in the panel's width; otherwise the panel scrolls sideways. */
    lineWrap: boolean;
    /** Short commit id when HEAD is on no branch, so there is nothing to diff. */
    detachedHead: string | null;
    /** Opens the folder picker, for the first-run screen's button. */
    onAddRepo: () => void;
  }
  let {
    repoId,
    selectedFile,
    selectedRenamedFrom,
    selectedView,
    view,
    onViewChange,
    diffMode,
    diffHunks,
    diffBinary,
    loadingDiff,
    fileLines,
    fileBinary,
    loadingFile,
    oldTokens,
    newTokens,
    fileTokens,
    loading,
    noRepos,
    hasChanges,
    lineWrap,
    detachedHead,
    onAddRepo,
  }: Props = $props();

  let isFileView = $derived(selectedView === "file");

  $effect(() => {
    function onUp() {
      selection.commitDrag();
    }
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  });

  // Esc closes the open comment thread, the same way it closes a Modal — the x in its
  // corner was the only way out of it.
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !selection.range) return;
      selection.close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // n / p scroll the next or previous hunk header up to just under the sticky file
  // header. Handled here rather than at page level because this panel owns the scroll
  // position; File View has no hunk headers, so there it finds nothing to jump to.
  let panel = $state<HTMLElement | null>(null);
  // Without wrapping the lines scroll sideways, and the comment thread is held to this
  // width so it stays in view instead of stretching to the widest line.
  let panelWidth = $state(0);
  $effect(() => {
    function onKey(e: KeyboardEvent) {
      const step = nextHunkShortcut.matches(e) ? 1 : prevHunkShortcut.matches(e) ? -1 : 0;
      if (step !== 0 && panel) jumpToHunk(panel, step);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function jumpToHunk(el: HTMLElement, step: 1 | -1) {
    const stickyHeight = el.querySelector<HTMLElement>(".diff-panel-header")?.offsetHeight ?? 0;
    const top = el.getBoundingClientRect().top + stickyHeight;
    // Each header's distance below the top of the visible diff. A header already sitting
    // there (within a pixel of rounding) is the current one, not the next or previous.
    const offsets = [...el.querySelectorAll<HTMLElement>("[data-hunk-header]")].map(
      (h) => h.getBoundingClientRect().top - top,
    );
    const target = step > 0 ? offsets.find((d) => d > 1) : offsets.filter((d) => d < -1).pop();
    if (target !== undefined) el.scrollBy({ top: target });
  }

  function gutterDown(i: number) {
    selection.startDrag(i);
  }
  function gutterEnter(i: number) {
    const start = selection.dragStart;
    if (start === null || !lines.canExtend(start, i)) return;
    selection.extendDrag(i);
  }

  // The lines on screen, laid out and anchored by lines.ts: the diff's, or File View's.
  let diff = $derived(diffLines(diffHunks));
  let lines = $derived(isFileView ? fileViewLines(fileLines) : diff);

  // Which hunks are collapsed, kept against the diff they were collapsed in: loading
  // another diff replaces `diff`, and everything is expanded again with no effect
  // syncing the two. Raw state on purpose — the record is replaced whole on every
  // change, and a reactive proxy would hand back a copy that fails the identity check.
  const NONE_COLLAPSED: ReadonlySet<number> = new Set();
  let collapsedIn = $state.raw<{ of: DiffLines | null; hunks: Set<number> }>({ of: null, hunks: new Set() });
  let collapsedHunks = $derived(collapsedIn.of === diff ? collapsedIn.hunks : NONE_COLLAPSED);
  let allCollapsed = $derived(diff.hunkCount > 0 && collapsedHunks.size === diff.hunkCount);

  function setCollapsed(hunks: Set<number>) {
    collapsedIn = { of: diff, hunks };
    // A collapsed hunk takes its lines off screen, and the open thread is anchored to
    // one of them.
    const hunk = selection.range ? diff.hunkOf(selection.range.hi) : undefined;
    if (hunk !== undefined && hunks.has(hunk)) selection.close();
  }
  function toggleHunk(hunk: number) {
    const hunks = new Set(collapsedHunks);
    if (!hunks.delete(hunk)) hunks.add(hunk);
    setCollapsed(hunks);
  }
  function toggleAllHunks() {
    setCollapsed(allCollapsed ? new Set() : new Set(diffHunks.map((_, i) => i)));
  }

  // Where a comment written here is anchored, and the Anchor Text it carries
  // (docs/decisions/0013): the selected lines as they are on screen right now, which is
  // what the reviewer is commenting on — nothing is re-read to build it.
  let thread = $derived(selection.range ? lines.anchorFor(selection.range.lo, selection.range.hi) : null);
  let threadRange = $derived(thread?.anchor ?? null);

  // The thread renders straight out of the Comment Queue rather than keeping its own
  // copy, so an edit here reaches the text that gets handed to the CLI agent, and
  // reopening a commented range edits that comment instead of starting a second one.
  let threadItem = $derived(
    threadRange && selectedFile ? commentQueue.find(repoId, selectedFile, threadRange) : null,
  );
  let threadComments = $derived.by(() => {
    const item = threadItem;
    if (!item) return [];
    return [
      {
        time: formatTime(item.createdAt),
        text: item.text,
        editable: true,
        onEdit: (text: string) => commentQueue.update(item.id, text),
      },
    ];
  });

  // A queue belongs to one Repo (docs/decisions/0009), so everything read out of it
  // here is scoped to the Repo being reviewed.
  let commentedKeys = $derived(commentQueue.lineKeys(repoId, selectedFile ?? ""));

  // A del line exists only on the old side; every other line is coloured from the new.
  function lineTokens(line: DiffLineData) {
    return line.kind === "del" ? oldTokensAt(line.oldNo) : newTokensAt(line.newNo);
  }
  function oldTokensAt(no: number | null | undefined) {
    return no ? oldTokens?.[no - 1] : undefined;
  }
  function newTokensAt(no: number | null | undefined) {
    return no ? newTokens?.[no - 1] : undefined;
  }

  function addToQueue() {
    if (!selection.draft.trim() || !thread || !selectedFile || !repoId) return;
    commentQueue.add({
      repoId,
      file: selectedFile,
      ...thread.anchor,
      text: selection.draft.trim(),
      anchorText: thread.anchorText,
      diffMode,
    });
    selection.draft = "";
  }

  // Copy Now is used-once (docs/decisions/0001): it never touches the Comment Queue, so
  // the thread closes instead of reopening onto a saved comment there is none of.
  async function copyNow() {
    if (!selection.draft.trim() || !threadRange || !selectedFile) return;
    if (await copyNowForAgent({ file: selectedFile, ...threadRange, text: selection.draft.trim() })) selection.close();
  }

  let rows = $derived(diff.unifiedRows(collapsedHunks));
  let splitRows = $derived(diff.splitRows(collapsedHunks));

  // A del line paired with an add sits on the left of its row, so matching only the
  // right side would drop the thread when the reviewer switches to Split view.
  function splitRowHasIdx(row: SplitRow & { kind: "row" }, idx: number) {
    return row.left?.idx === idx || row.right?.idx === idx;
  }
</script>

{#snippet commentBlock()}
  <div class="thread-anchor">
    <div class="thread-avatar">
      <Avatar name="Yu-Chen" size={24} />
    </div>
    <div class="thread-body">
      <CommentThread
        file={selectedFile}
        lineStart={threadRange?.lineStart}
        lineEnd={threadRange?.lineEnd}
        comments={threadComments}
        bind:replyValue={selection.draft}
        onAddToQueue={addToQueue}
        onCopyNow={copyNow}
        onClose={() => selection.close()}
      />
    </div>
  </div>
{/snippet}

{#if loading}
  <main class="diff-panel diff-panel-empty">
    <EmptyState size="md" icon="loader" title="載入中…" />
  </main>
{:else if noRepos}
  <main class="diff-panel diff-panel-empty">
    <Welcome {onAddRepo} />
  </main>
{:else if !repoId}
  <main class="diff-panel diff-panel-empty">
    <EmptyState
      size="md"
      icon="folder-git-2"
      title="選擇一個 repo 開始"
      hint="從左上角選擇 repo 與 branch，即可檢視變更並開始留言。"
    />
  </main>
{:else if detachedHead}
  <main class="diff-panel diff-panel-empty">
    <EmptyState size="md" icon="git-commit-horizontal" title="HEAD 沒有指向分支" hint={`目前停在 ${detachedHead}。先 checkout 一個分支再回來 review。`} />
  </main>
{:else if !selectedFile && !hasChanges}
  <main class="diff-panel diff-panel-empty">
    <EmptyState size="md" icon="git-compare" title="這個分支目前沒有變更" hint="切換到有 commit 差異的分支，或建立新的變更後再回來查看。" />
  </main>
{:else if !selectedFile}
  <main class="diff-panel diff-panel-empty">
    <EmptyState size="md" icon="file-code" title="選擇一個檔案查看 diff" hint={`從左側的檔案清單選擇一個變更的檔案，或按 ${nextFileShortcut.label} / ${prevFileShortcut.label} 逐一切換。`} />
  </main>
{:else}
  <main class="diff-panel" bind:this={panel} bind:clientWidth={panelWidth}>
    <div class="diff-panel-header">
      <div class="file-header-wrap">
        <FileHeader
          path={selectedFile}
          renamedFrom={selectedRenamedFrom}
          {allCollapsed}
          onToggleHunks={isFileView ? null : toggleAllHunks}
        />
      </div>
      {#if !isFileView}
        <div class="view-toggle-wrap"><Segmented value={view} onChange={(v) => onViewChange(v as ViewMode)} options={VIEW_MODES} /></div>
      {/if}
    </div>

    <div class="diff-body" class:nowrap={!lineWrap} style:--diff-white-space={lineWrap ? "pre-wrap" : "pre"} style:--panel-width={`${panelWidth}px`}>
      {#if isFileView}
        {#if loadingFile}
          <div class="diff-body-empty"><EmptyState size="md" icon="loader" title="載入檔案…" /></div>
        {:else if fileBinary}
          <div class="diff-body-empty">
            <EmptyState size="md" icon="binary" title="二進位檔" hint="這個檔案不是文字檔，無法逐行顯示，也無法留言。" />
          </div>
        {:else if fileLines.length === 0}
          <div class="diff-body-empty">
            <EmptyState size="md" icon="file" title="這個檔案是空的" hint="檔案沒有任何內容可以顯示。" />
          </div>
        {:else}
          {#each fileLines as content, i (i)}
            <FileLine
              lineNo={i + 1}
              {content}
              tokens={fileTokens?.[i]}
              index={i}
              selected={selection.includes(i)}
              commented={lines.isCommented(i, commentedKeys)}
              onGutterDown={gutterDown}
              onGutterEnter={gutterEnter}
            />
            {#if selection.range && i === selection.range.hi}
              {@render commentBlock()}
            {/if}
          {/each}
        {/if}
      {:else if loadingDiff}
        <div class="diff-body-empty"><EmptyState size="md" icon="loader" title="載入 diff…" /></div>
      {:else if diffBinary}
        <div class="diff-body-empty">
          <EmptyState size="md" icon="binary" title="二進位檔" hint="這個檔案有變更，但不是文字檔，無法逐行顯示 diff，也無法留言。" />
        </div>
      {:else if diffHunks.length === 0}
        <div class="diff-body-empty">
          <EmptyState size="md" icon="file-check" title="這個檔案沒有變更" hint="選擇左側標示變更行數的檔案，才會顯示 diff。" />
        </div>
      {:else if view === "unified"}
        {#each rows as row, i (i)}
          {#if row.kind === "header"}
            <DiffHunk label={row.label} collapsed={collapsedHunks.has(row.hunk)} onToggle={() => toggleHunk(row.hunk)} />
          {:else}
            <DiffLine
              kind={row.line.kind}
              oldNo={row.line.oldNo}
              newNo={row.line.newNo}
              index={row.idx}
              selected={selection.includes(row.idx)}
              commented={diff.isCommented(row.idx, commentedKeys)}
              onGutterDown={gutterDown}
              onGutterEnter={gutterEnter}
            >
              <InlineText text={row.line.content} segments={row.segments} tokens={lineTokens(row.line)} kind={row.line.kind} />
            </DiffLine>
            {#if selection.range && row.idx === selection.range.hi}
              {@render commentBlock()}
            {/if}
          {/if}
        {/each}
      {:else}
        <div class="split-grid">
        {#each splitRows as row, i (i)}
          {#if row.kind === "header"}
            <div class="split-span">
              <DiffHunk label={row.label} collapsed={collapsedHunks.has(row.hunk)} onToggle={() => toggleHunk(row.hunk)} />
            </div>
          {:else}
            <DiffLineSplit
              left={row.left}
              right={row.right}
              leftSegments={row.left?.segments}
              rightSegments={row.right?.segments}
              leftTokens={oldTokensAt(row.left?.no)}
              rightTokens={newTokensAt(row.right?.no)}
              leftCommented={row.left !== null && diff.isCommented(row.left.idx, commentedKeys)}
              rightCommented={row.right !== null && diff.isCommented(row.right.idx, commentedKeys)}
              leftSelected={row.left !== null && selection.includes(row.left.idx)}
              rightSelected={row.right !== null && selection.includes(row.right.idx)}
              onGutterDown={gutterDown}
              onGutterEnter={gutterEnter}
            />
            {#if selection.range && splitRowHasIdx(row, selection.range.hi)}
              <div class="split-span">{@render commentBlock()}</div>
            {/if}
          {/if}
        {/each}
        </div>
      {/if}
    </div>
  </main>
{/if}

<style>
  .diff-body {
    animation: z-fade-in var(--dur-base) ease-out;
  }

  .diff-panel {
    flex: 1;
    min-width: 0;
    overflow: auto;
    background: var(--bg-surface);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-sm);
  }

  /* Without wrapping, every row is as wide as the widest line, so its background runs
     the full width while the panel scrolls sideways to it. */
  .diff-body.nowrap {
    width: max-content;
    min-width: 100%;
  }

  /* One grid for the whole Split view, so each side's column is as wide as its widest
     line and every row's divider lines up. */
  .split-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 1px minmax(0, 1fr);
  }

  /* Both sides as wide as the widest line on either, so the divider stays centred. */
  .nowrap .split-grid {
    grid-template-columns: 1fr 1px 1fr;
  }

  .split-span {
    grid-column: 1 / -1;
  }

  .diff-panel-empty {
    display: flex;
  }

  .diff-body-empty {
    display: flex;
    min-height: 240px;
  }

  .diff-panel-header {
    display: flex;
    align-items: stretch;
    background: var(--bg-glass);
    backdrop-filter: blur(14px) saturate(1.3);
    -webkit-backdrop-filter: blur(14px) saturate(1.3);
    border-bottom: 1px solid var(--border-default);
    position: sticky;
    top: 0;
    left: 0;
    z-index: 5;
  }

  .file-header-wrap {
    flex: 1;
    min-width: 0;
    overflow: hidden;
  }

  .view-toggle-wrap {
    padding: 0 12px 0 4px;
    display: flex;
    align-items: center;
  }

  .thread-anchor {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--bg-subtle);
    border-top: 1px solid var(--border-muted);
    border-bottom: 1px solid var(--border-muted);
    animation: z-fade-up var(--dur-slow) var(--ease-out);
  }

  .thread-avatar {
    flex-shrink: 0;
    padding-top: 2px;
  }

  /* The thread stays panel-wide and in view while the lines scroll sideways under it. */
  .nowrap .thread-anchor {
    position: sticky;
    left: 0;
    box-sizing: border-box;
    width: var(--panel-width);
  }

  .thread-body {
    flex: 1;
    min-width: 0;
  }
</style>
